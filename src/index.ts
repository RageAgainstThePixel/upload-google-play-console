import * as google from '@googleapis/androidpublisher';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as github from '@actions/github';
import TrackInfo = google.androidpublisher_v3.Schema$TrackRelease;

let octokit: ReturnType<typeof github.getOctokit>;

const main = async () => {
    try {
        const githubToken = core.getInput('github-token', { required: false }) || process.env.GITHUB_TOKEN;

        if (!githubToken) {
            throw new Error('A GitHub token is required. Please provide it via the "github-token" input or set the GITHUB_TOKEN environment variable.');
        }

        octokit = github.getOctokit(githubToken);

        const credentialsPath = core.getInput('service-account-credentials-path');

        if (!credentialsPath && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            throw new Error('Missing service account credentials. Please provide the path to the service account JSON file or set the GOOGLE_APPLICATION_CREDENTIALS environment variable.');
        }

        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        }

        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/androidpublisher']
        });
        const androidPublisherClient = new google.androidpublisher_v3.Androidpublisher({ auth: auth });
        const releaseDirectory = core.getInput('release-directory', { required: true });
        const releaseName = core.getInput('release-name');
        const track = core.getInput('track') || 'internal';
        const releaseStatus = core.getInput('release-status') || 'completed';
        const normalizedReleaseStatus = releaseStatus.toLowerCase();

        core.info(`Uploading release from directory: ${releaseDirectory}`);

        if (releaseName) {
            core.info(`Release name: ${releaseName}`);
        }

        core.info(`Track: ${track}`);
        core.info(`Release status: ${releaseStatus}`);

        const items = fs.readdirSync(releaseDirectory);

        if (core.isDebug()) {
            core.info(`Items in release directory:`);
            items.forEach(item => {
                if (fs.statSync(path.join(releaseDirectory, item)).isFile()) {
                    core.info(`  > ${item}`);
                }
            });
        }

        if (items.length === 0) {
            throw new Error(`Release directory is empty: ${releaseDirectory}`);
        }

        const basePattern = `${releaseDirectory}/`;
        const patterns = ['*.aab', '*.apk', '*.obb', '*.zip'];
        const globPattern = patterns.map(pattern => `${basePattern}${pattern}`).join('\n');
        core.debug(`Using glob pattern to find release assets:\n${globPattern}`);
        const globber = await glob.create(globPattern);
        const releaseAssets = await globber.glob();

        if (releaseAssets.length === 0) {
            throw new Error(`No release assets found in directory: ${releaseDirectory}`);
        }

        core.info(`Found ${releaseAssets.length} release assets to upload:`);
        releaseAssets.forEach(asset => core.info(`  > ${path.basename(asset)}`));

        let apkInfo: PackageInfo | null = null;
        let aabInfo: PackageInfo | null = null;
        const expansionFiles: string[] = [];
        const symbolFiles: string[] = [];
        let versionCode: number | null = null;

        for (const assetPath of releaseAssets) {
            if (assetPath.toLowerCase().endsWith('.apk')) {
                apkInfo = await getPackageInfoApk(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.aab')) {
                aabInfo = await getPackageInfoAab(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.obb')) {
                expansionFiles.push(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.zip')) {
                symbolFiles.push(assetPath);
            }
        }

        if (apkInfo && aabInfo) {
            throw new Error('Cannot upload both APK and AAB files in the same release. Please choose one format.');
        }

        //  At a high level, the expected workflow is to "insert" an Edit, make changes as necessary, and then "commit" it.

        const packageName = apkInfo ? apkInfo.packageName : aabInfo ? aabInfo.packageName : null;

        if (!packageName) {
            throw new Error('Failed to determine package name from release assets.');
        }

        core.info(`Inserting edit for package: ${packageName}...`);
        const insertResponse = await androidPublisherClient.edits.insert({
            auth: auth,
            packageName: packageName
        });

        if (!insertResponse.ok) {
            throw new Error(`Failed to create edit: ${insertResponse.statusText}`);
        }

        const editId = insertResponse.data.id;
        core.info(`Created edit: ${editId} for ${packageName}`);

        if (apkInfo) {
            core.info(`Uploading APK: ${apkInfo.filePath}...`);
            const uploadApkResponse = await androidPublisherClient.edits.apks.upload({
                auth: auth,
                editId: editId,
                packageName: apkInfo.packageName,
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(apkInfo.filePath),
                }
            });

            if (!uploadApkResponse.ok) {
                throw new Error(`Failed to upload APK: ${uploadApkResponse.statusText}`);
            }

            if (!uploadApkResponse.data.versionCode) {
                throw new Error(`Failed to retrieve version code from uploaded APK ${apkInfo.filePath}.`);
            }

            core.info(`Successfully uploaded APK with version code: ${uploadApkResponse.data.versionCode}`);
            versionCode = uploadApkResponse.data.versionCode;

            // upload any obb expansion files
            for (const obbPath of expansionFiles) {
                const expansionFileType: 'main' | 'patch' | null = obbPath.toLowerCase().includes('main')
                    ? 'main'
                    : obbPath.toLowerCase().includes('patch')
                        ? 'patch'
                        : null;

                if (!expansionFileType) {
                    core.error(`Skipping OBB expansion file as it is neither prefixed with main nor patch: ${obbPath}`);
                    continue;
                }

                core.info(`Uploading expansion file: ${obbPath}...`);
                const expansionFileResponse = await androidPublisherClient.edits.expansionfiles.upload({
                    auth: auth,
                    editId: editId,
                    packageName: packageName,
                    apkVersionCode: uploadApkResponse.data.versionCode,
                    expansionFileType: expansionFileType,
                    media: {
                        mimeType: 'application/octet-stream',
                        body: fs.createReadStream(obbPath),
                    }
                });

                if (!expansionFileResponse.ok) {
                    core.error(`Failed to upload expansion file (${expansionFileType}): ${expansionFileResponse.statusText}`);
                }
            }
        }

        if (aabInfo) {
            core.info(`Uploading AAB: ${aabInfo.filePath}...`);
            const uploadBundleResponse = await androidPublisherClient.edits.bundles.upload({
                auth: auth,
                editId: editId,
                packageName: aabInfo.packageName,
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(aabInfo.filePath),
                }
            });

            if (!uploadBundleResponse.ok) {
                throw new Error(`Failed to upload AAB: ${uploadBundleResponse.statusText}`);
            }

            if (!uploadBundleResponse.data.versionCode) {
                throw new Error(`Failed to retrieve version code from uploaded AAB ${aabInfo.filePath}.`);
            }

            core.info(`Successfully uploaded AAB with version code: ${uploadBundleResponse.data.versionCode}`);
            versionCode = uploadBundleResponse.data.versionCode;
        }

        if (!versionCode) {
            throw new Error('Failed to determine version code from uploaded release asset.');
        }

        for (const symbolPath of symbolFiles) {
            core.info(`Uploading deobfuscation file: ${symbolPath}...`);
            const uploadDeobfuscationFileResponse = await androidPublisherClient.edits.deobfuscationfiles.upload({
                auth: auth,
                editId: editId,
                packageName: packageName,
                apkVersionCode: versionCode!,
                deobfuscationFileType: symbolPath.toLowerCase().endsWith('.zip') ? 'nativeCode' : 'proguard',
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(symbolPath),
                }
            });

            if (!uploadDeobfuscationFileResponse.ok) {
                core.error(`Failed to upload deobfuscation file: ${uploadDeobfuscationFileResponse.statusText}`);
            }
            else {
                core.info(`Successfully uploaded deobfuscation file: ${symbolPath}`);
            }
        }

        core.info(`Getting track info for track: ${track}...`);
        const getTrackResponse = await androidPublisherClient.edits.tracks.get({
            auth: auth,
            packageName: packageName,
            editId: editId,
            track: track
        });

        if (!getTrackResponse.ok) {
            throw new Error(`Failed to get track info for track ${track}: ${getTrackResponse.statusText}`);
        }

        const releases: TrackInfo[] = getTrackResponse.data.releases || [];

        core.info(`Found ${releases.length} existing releases on track ${track}:`);
        releases.forEach(release => {
            core.info(`  > ${release.name} [status: ${release.status}, version codes: ${release.versionCodes?.join(', ')}]`);
            release.status = 'halted';
        });

        const newRelease: TrackInfo = {
            name: releaseName || (apkInfo || aabInfo)!.getReleaseName(),
            status: releaseStatus,
            versionCodes: [`${versionCode}`]
        };

        releases.push(newRelease);

        core.info(`Updating track ${track} with new release ${newRelease.name} with status ${newRelease.status}...`);
        const trackUpdateResponse = await androidPublisherClient.edits.tracks.update({
            auth: auth,
            packageName: packageName,
            editId: editId,
            track: track,
            requestBody: {
                track: track,
                releases: [newRelease]
            }
        });

        if (!trackUpdateResponse.ok) {
            throw new Error(`Failed to update track ${track}: ${trackUpdateResponse.statusText}`);
        }

        core.info(`Validating edit...`);
        const validateResponse = await androidPublisherClient.edits.validate({
            auth: auth,
            packageName: packageName,
            editId: editId
        });

        if (!validateResponse.ok) {
            throw new Error(`Failed to validate edit: ${validateResponse.statusText}`);
        }

        core.info(`Committing edit...`);
        const commitResponse = await androidPublisherClient.edits.commit({
            auth: auth,
            packageName: packageName,
            editId: editId
        });

        if (!commitResponse.ok) {
            throw new Error(`Failed to commit edit: ${commitResponse.statusText}`);
        }

        core.info(`Successfully committed edit for package: ${packageName}`);
    } catch (error) {
        core.setFailed(error);
    }
}

main();

class PackageInfo {
    constructor(
        readonly packageName: string,
        readonly versionName: string,
        readonly versionCode: string,
        readonly filePath: string) {
    }

    /**
     * Get release name in format: versionCode (versionName)
     * @returns release name
     */
    public getReleaseName(): string {
        return `${this.versionCode} (${this.versionName})`;
    }
}

/**
 * Get package name from APK using aapt badging <file>
 * @param filePath
 * @returns package name
 */
async function getPackageInfoApk(filePath: string): Promise<PackageInfo> {
    if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path is required to get package name from APK.');
    }

    if (!filePath.toLowerCase().endsWith('.apk')) {
        throw new Error(`File is not an APK: ${filePath}`);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist at path: ${filePath}`);
    }

    try {
        const aaptPath = await io.which('aapt', true);
        let output = '';
        const result = await exec(aaptPath, ['dump', 'badging', filePath], {
            listeners: {
                stdout: (data: Buffer) => {
                    output += data.toString();
                }
            },
            ignoreReturnCode: true
        });
        if (result !== 0) {
            throw new Error(`aapt exited with code ${result}\n${output}`);
        }

        const pkgMatch = output.match(/package=["']([^"']+)["']/);
        const versionCodeMatch = output.match(/(?:android:)?versionCode=["']([^"']+)["']/);
        const versionNameMatch = output.match(/(?:android:)?versionName=["']([^"']+)["']/);

        if (pkgMatch && versionCodeMatch && versionNameMatch) {
            return new PackageInfo(
                pkgMatch[1],
                versionNameMatch[1],
                versionCodeMatch[1],
                filePath
            );
        }
    } catch (error) {
        throw new Error(`Failed to get package name from APK: ${error}`);
    }

    throw new Error(`Package name not found in the manifest of the release asset: ${filePath}`);
}

/**
 * Get package name from AAB using bundletool dump manifest --bundle <file>
 * @param filePath
 * @returns package name
 */
async function getPackageInfoAab(filePath: string): Promise<PackageInfo> {
    if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path is required to get package name from AAB.');
    }

    if (!filePath.toLowerCase().endsWith('.aab')) {
        throw new Error(`File is not an AAB: ${filePath}`);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist at path: ${filePath}`);
    }

    let bundletoolPath: string;

    try {
        bundletoolPath = await io.which('bundletool', true);
    } catch {
        await setupBundleTool();
        bundletoolPath = await io.which('bundletool', true);
    }

    if (!bundletoolPath) {
        throw new Error('Failed to locate bundletool!');
    } else {
        core.info(`bundletool:\n  > ${bundletoolPath}`);
    }

    try {
        let output = '';
        const result = await exec(bundletoolPath, ['dump', 'manifest', '--bundle', filePath], {
            listeners: {
                stdout: (data: Buffer) => {
                    output += data.toString();
                }
            },
            silent: !core.isDebug(),
            ignoreReturnCode: true
        });

        if (result !== 0) {
            throw new Error(`bundletool exited with code ${result}\n${output}`);
        }

        const pkgMatch = output.match(/package=["']([^"']+)["']/);
        const versionCodeMatch = output.match(/(?:android:)?versionCode=["']([^"']+)["']/);
        const versionNameMatch = output.match(/(?:android:)?versionName=["']([^"']+)["']/);

        if (pkgMatch && versionCodeMatch && versionNameMatch) {
            return new PackageInfo(
                pkgMatch[1],
                versionNameMatch[1],
                versionCodeMatch[1],
                filePath
            );
        }
    } catch (error) {
        throw new Error(`Failed to get package name from AAB: ${error}`);
    }

    throw new Error(`Package name not found in the manifest of the release asset: ${filePath}`);
}

async function setupBundleTool(): Promise<string> {
    core.debug('Setting up bundletool...');
    const javaPath = await io.which('java', false);

    if (!javaPath) {
        throw new Error(`bundletool requires Java to be installed. Use the 'actions/setup-java' action to install Java before this action.`);
    }

    const cachedTools = tc.findAllVersions('bundletool', process.arch);

    if (cachedTools && cachedTools.length > 0) {
        core.debug(`Found ${cachedTools.length} cached versions of bundletool for architecture: ${process.arch}`);
        const latestVersion = cachedTools.sort().reverse()[0];
        core.debug(`Using latest cached version: ${latestVersion}`);
        const toolPath = tc.find('bundletool', latestVersion, process.arch);
        core.debug(`Found cached bundletool v${latestVersion}-${process.arch} at ${toolPath}`);
        core.addPath(toolPath);
        return toolPath;
    }

    const latestRelease = await octokit.rest.repos.getLatestRelease({
        owner: 'google',
        repo: 'bundletool',
    });

    if (latestRelease.status !== 200) {
        throw new Error(`Failed to get latest bundletool release:\n${JSON.stringify(latestRelease, null, 2)}`);
    }

    core.debug(`google/bundletool latest release:\n${JSON.stringify(latestRelease.data, null, 2)}`);

    // bundletool-all-<version>.jar which means any architecture
    const jarFile = latestRelease.data?.assets?.find(asset => asset.name.endsWith('.jar'));

    if (!jarFile) {
        throw new Error(`Failed to find bundletool jar file in manifest release from ${latestRelease.data.url}`);
    }

    // create a shim script to run bundletool
    const shimDir = `${process.env.RUNNER_TEMP}/.bundletool`;
    await io.mkdirP(shimDir);
    const shimPath = `${shimDir}/bundletool`;
    const destPath = `${shimDir}/${jarFile.name}`;

    core.debug(`installing bundletool version: ${latestRelease.data.tag_name} from ${jarFile.browser_download_url} -> ${destPath}`);

    const downloadPath = await tc.downloadTool(jarFile.browser_download_url, destPath);

    core.debug(`downloaded: ${downloadPath}`);
    fs.accessSync(downloadPath, fs.constants.R_OK);
    const stat = fs.statSync(downloadPath);

    if (stat.size === 0) {
        throw new Error(`Downloaded bundletool jar is empty: ${downloadPath}`);
    }

    // create a shim script to run bundletool with java
    const shimContent = `#!/bin/bash\n"${javaPath}" -jar "${downloadPath}" "$@"`;
    fs.writeFileSync(shimPath, shimContent, { mode: 0o755 });
    fs.chmodSync(shimPath, 0o755);
    core.debug(`Created bundletool shim at: ${shimPath}`);

    // cache the tool
    const toolPath = await tc.cacheDir(shimDir, 'bundletool', latestRelease.data.tag_name, process.arch);
    core.debug(`Cached bundletool v${latestRelease.data.tag_name}-${process.arch}: ${toolPath}`);
    core.addPath(toolPath);
    return toolPath;
}
