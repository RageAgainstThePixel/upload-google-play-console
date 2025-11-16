import * as google from '@googleapis/androidpublisher';
import * as tc from '@actions/tool-cache';
import * as github from '@actions/github';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import { exec } from '@actions/exec';
import * as io from '@actions/io';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { PackageInfo } from './package-info';
import { Metadata } from './metadata';

import TrackInfo = google.androidpublisher_v3.Schema$TrackRelease;

let octokit: ReturnType<typeof github.getOctokit>;

const main = async () => {
    try {
        const githubToken = core.getInput('github-token', { required: true });

        if (!githubToken || githubToken.trim().length === 0) {
            throw new Error('A github-token is required!');
        }

        octokit = github.getOctokit(githubToken);

        const credentialsPath = core.getInput('service-account-credentials');

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
        const releaseStatus = core.getInput('status') || 'completed';
        const userFractionInput = core.getInput('user-fraction');
        const inAppUpdatePriorityInput = core.getInput('in-app-update-priority');
        const metadataInput = core.getInput('metadata');
        const changesNotSentForReview = core.getInput('changes-not-sent-for-review') === 'true';

        core.info(`Uploading release from directory: ${releaseDirectory}`);
        if (releaseName) core.info(`Release name: ${releaseName}`);
        core.info(`Track: ${track}`);
        if (!['completed', 'draft', 'inProgress', 'halted'].includes(releaseStatus)) throw new Error(`Invalid release status: ${releaseStatus}. Valid values are: completed, draft, inProgress, halted.`);
        core.info(`Release status: ${releaseStatus}`);

        let userFraction: number | undefined = undefined;

        if (userFractionInput) {
            userFraction = parseFloat(userFractionInput);
            core.info(`User fraction: ${userFraction}`);

            if (isNaN(userFraction) || userFraction < 0 || userFraction > 1) {
                throw new Error(`Invalid user-fraction value: ${userFractionInput}. It must be a number between 0 and 1.`);
            }

            if (releaseStatus !== 'inProgress' && releaseStatus !== 'halted') {
                core.warning(`user-fraction is only applicable for releases with status 'inProgress' or 'halted'. Current status is '${releaseStatus}'. Ignoring user-fraction.`);
                userFraction = undefined;
            }
        }

        let inAppUpdatePriority: number | undefined = undefined;

        if (inAppUpdatePriorityInput) {
            inAppUpdatePriority = parseInt(inAppUpdatePriorityInput, 10);
            core.info(`In-app update priority: ${inAppUpdatePriority}`);

            if (isNaN(inAppUpdatePriority) || inAppUpdatePriority < 0 || inAppUpdatePriority > 5) {
                throw new Error(`Invalid inAppUpdatePriority value: ${inAppUpdatePriorityInput}. It must be an integer between 0 and 5.`);
            }
        }

        let metadata: Metadata | null = null;

        if (metadataInput) {
            let metadataContent: string = metadataInput;

            if (metadataInput.endsWith('.json') && fs.existsSync(metadataInput)) {
                core.debug(`Loading metadata from file: ${metadataInput}`);
                metadataContent = fs.readFileSync(metadataInput, 'utf-8');
            }

            metadata = JSON.parse(metadataContent) as Metadata;
            core.info(`Metadata:\n${JSON.stringify(metadata, null, 2)}`);
        }

        const items = fs.readdirSync(releaseDirectory);

        if (core.isDebug()) {
            core.info(`Items in release directory:`);
            items.forEach(item => {
                if (fs.statSync(path.join(releaseDirectory, item)).isFile()) {
                    core.info(`  > ${item}`);
                }
            });
        }

        if (items.length === 0) throw new Error(`Release directory is empty: ${releaseDirectory}`);

        const basePattern = `${releaseDirectory}/`;
        const patterns = ['*.aab', '*.apk', '*.obb', '*.zip'];
        const globPattern = patterns.map(pattern => `${basePattern}${pattern}`).join('\n');
        core.debug(`Using glob pattern to find release assets:\n${globPattern}`);
        const globber = await glob.create(globPattern);
        const releaseAssets = await globber.glob();

        if (releaseAssets.length === 0) throw new Error(`No release assets found in directory: ${releaseDirectory}`);

        core.info(`Found ${releaseAssets.length} release assets to upload:`);
        releaseAssets.forEach((asset: string) => core.info(`  > ${path.basename(asset)}`));

        let apkInfo: PackageInfo | null = null;
        let aabInfo: PackageInfo | null = null;
        const expansionFiles: string[] = [];
        const symbolFiles: string[] = [];
        let versionCode: number | null = null;

        for (const assetPath of releaseAssets) {
            if (assetPath.toLowerCase().endsWith('.apk')) {
                if (apkInfo) throw new Error(`Multiple APK files found in release assets. Only one APK is allowed per release when uploading APKs directly: ${apkInfo.filePath} and ${assetPath}`);
                apkInfo = await getPackageInfoApk(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.aab')) {
                if (aabInfo) throw new Error(`Multiple AAB files found in release assets. Only one AAB is allowed per release: ${aabInfo.filePath} and ${assetPath}`);
                aabInfo = await getPackageInfoAab(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.obb')) {
                expansionFiles.push(assetPath);
            } else if (assetPath.toLowerCase().endsWith('.zip')) {
                symbolFiles.push(assetPath);
            }
        }

        if (apkInfo && aabInfo) throw new Error('Cannot upload both APK and AAB files in the same release. Please choose one format.');

        //  At a high level, the expected workflow is to "insert" an Edit, make changes as necessary, and then "commit" it.

        const packageName = apkInfo ? apkInfo.packageName : aabInfo ? aabInfo.packageName : null;

        if (!packageName) throw new Error('Failed to determine package name from release assets.');

        core.info(`Inserting edit for package: ${packageName}...`);
        const insertResponse = await androidPublisherClient.edits.insert({
            auth: auth,
            packageName: packageName
        });

        if (!insertResponse.ok) throw new Error(`Failed to create edit: ${insertResponse.statusText}`);

        const editId = insertResponse.data.id;
        core.info(`Created edit: ${editId} for ${packageName}`);

        if (apkInfo) {
            core.info(`Uploading APK: ${apkInfo.filePath}...`);
            const resolvedApkPath = resolvePath(apkInfo.filePath);
            const uploadApkResponse = await androidPublisherClient.edits.apks.upload({
                auth: auth,
                editId: editId,
                packageName: apkInfo.packageName,
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(resolvedApkPath),
                }
            });

            if (!uploadApkResponse.ok) throw new Error(`Failed to upload APK ${apkInfo.filePath}: ${uploadApkResponse.statusText}`);
            if (!uploadApkResponse.data.versionCode) throw new Error(`Failed to retrieve version code from uploaded APK ${apkInfo.filePath}.`);
            core.info(`Successfully uploaded APK with version code: ${uploadApkResponse.data.versionCode}`);
            versionCode = uploadApkResponse.data.versionCode;

            for (const obbPath of expansionFiles) {
                try {
                    const expansionFileType: 'main' | 'patch' | null = obbPath.toLowerCase().includes('main')
                        ? 'main'
                        : obbPath.toLowerCase().includes('patch')
                            ? 'patch'
                            : null;

                    if (!expansionFileType) {
                        core.error(`Skipping OBB expansion file as it is neither prefixed with main nor patch: ${obbPath}`);
                        continue;
                    }

                    core.info(`Uploading expansion file: [${expansionFileType}] ${obbPath}...`);
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

                    if (!expansionFileResponse.ok) throw new Error(expansionFileResponse.statusText);
                    core.info(`Successfully uploaded expansion file: [${expansionFileType}] ${obbPath}`);
                } catch (error) {
                    core.error(`Error uploading expansion file ${obbPath}: ${error}`);
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

            if (!uploadBundleResponse.ok) throw new Error(`Failed to upload AAB ${aabInfo.filePath}: ${uploadBundleResponse.statusText}`);
            if (!uploadBundleResponse.data.versionCode) throw new Error(`Failed to retrieve version code from uploaded AAB ${aabInfo.filePath}.`);
            core.info(`Successfully uploaded AAB with version code: ${uploadBundleResponse.data.versionCode}`);
            versionCode = uploadBundleResponse.data.versionCode;
        }

        if (!versionCode) throw new Error('Failed to determine version code from uploaded release asset.');

        for (const symbolPath of symbolFiles) {
            try {
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

                if (!uploadDeobfuscationFileResponse.ok) throw new Error(uploadDeobfuscationFileResponse.statusText);
                core.info(`Successfully uploaded deobfuscation file: ${symbolPath}`);
            } catch (error) {
                core.error(`Error uploading deobfuscation file ${symbolPath}: ${error}`);
            }
        }

        const tracksResponse = await androidPublisherClient.edits.tracks.list({
            auth: auth,
            packageName: packageName,
            editId: editId
        });

        if (!tracksResponse.ok) throw new Error(`Failed to list tracks: ${tracksResponse.statusText}`);

        const existingTrack = tracksResponse.data.tracks?.find(t => t.track === track);
        if (!existingTrack) throw new Error(`Track does not exist: ${track}\nAvailable tracks:\n${tracksResponse.data.tracks?.map(t => `  > ${t.track}`).join('\n')}`);

        core.info(`Getting track info for track: ${track}...`);
        const getTrackResponse = await androidPublisherClient.edits.tracks.get({
            auth: auth,
            packageName: packageName,
            editId: editId,
            track: track
        });

        if (!getTrackResponse.ok) throw new Error(`Failed to get track info for track ${track}: ${getTrackResponse.statusText}`);

        const releaseNotes = Array.isArray(metadata?.releaseNotes)
            ? metadata!.releaseNotes
            : metadata?.releaseNotes
                ? [metadata!.releaseNotes]
                : undefined;

        const newRelease: TrackInfo = {
            name: releaseName || (apkInfo || aabInfo)!.getReleaseName(),
            status: releaseStatus,
            versionCodes: [`${versionCode}`],
            userFraction: userFraction,
            releaseNotes: releaseNotes,
            countryTargeting: metadata?.countryTargeting,
            inAppUpdatePriority: inAppUpdatePriority,
        };

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

        if (!trackUpdateResponse.ok) throw new Error(`Failed to update track ${track}: ${trackUpdateResponse.statusText}`);

        if (metadata?.listing) {
            const listings = Array.isArray(metadata.listing)
                ? metadata.listing
                : [metadata.listing];

            for (const listing of listings) {
                try {
                    core.info(`Updating listing for language: ${listing.language}...`);
                    const updateListingResponse = await androidPublisherClient.edits.listings.update({
                        auth: auth,
                        packageName: packageName,
                        editId: editId,
                        language: listing.language,
                        requestBody: listing
                    });

                    if (!updateListingResponse.ok) throw new Error(updateListingResponse.statusText);
                    core.info(`Successfully updated listing for language: ${listing.language}`);
                } catch (error) {
                    core.error(`Error updating listing for language ${listing.language}: ${error}`);
                }
            }
        }

        if (metadata?.images) {
            for (const image of metadata.images) {
                try {
                    core.info(`Uploading image for language: ${image.language}, type: ${image.type} from path: ${image.path}...`);
                    const resolvedPath = resolvePath(image.path);
                    const imageUploadResponse = await androidPublisherClient.edits.images.upload({
                        auth: auth,
                        packageName: packageName,
                        editId: editId,
                        language: image.language,
                        imageType: image.type,
                        media: {
                            mimeType: 'application/octet-stream',
                            body: fs.createReadStream(resolvedPath),
                        }
                    });

                    if (!imageUploadResponse.ok) throw new Error(imageUploadResponse.statusText);
                    core.info(`Successfully uploaded image for language: ${image.language}, type: ${image.type}`);
                } catch (error) {
                    core.error(`Error uploading image for language ${image.language}, type ${image.type}: ${error}`);
                }
            }
        }

        core.info(`Validating edit...`);
        const validateResponse = await androidPublisherClient.edits.validate({
            auth: auth,
            packageName: packageName,
            editId: editId
        });

        if (!validateResponse.ok) throw new Error(`Failed to validate edit: ${validateResponse.statusText}`);

        core.info(`Committing edit...`);
        const commitResponse = await androidPublisherClient.edits.commit({
            auth: auth,
            packageName: packageName,
            editId: editId,
            changesNotSentForReview: changesNotSentForReview
        });

        if (!commitResponse.ok) throw new Error(`Failed to commit edit: ${commitResponse.statusText}`);
        core.info(`Successfully committed edit for package: ${packageName}`);
    } catch (error) {
        core.setFailed(error);
    }
}

main();

function resolvePath(filePath: string): string {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File does not exist at path: ${resolvedPath}`);
    }

    return resolvedPath;
}

/**
 * Get package name from APK using aapt2 badging <file>
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

    let aaptPath: string;

    try {
        aaptPath = await io.which('aapt2', true);
    } catch {
        aaptPath = await getAaptPath();
    }

    if (!aaptPath) {
        throw new Error('Failed to locate aapt2!');
    } else {
        core.info(`aapt2:\n  > ${aaptPath}`);
    }

    try {
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
            throw new Error(`${aaptPath} exited with code ${result}\n${output}`);
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

async function getAaptPath(): Promise<string> {
    const androidSdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
    if (!androidSdkRoot) {
        throw new Error(`ANDROID_SDK_ROOT or ANDROID_HOME environment variable is not set. Cannot locate aapt tool.`);
    }

    const buildToolsDir = path.join(androidSdkRoot, 'build-tools');

    if (!fs.existsSync(buildToolsDir)) {
        throw new Error(`Build-tools directory does not exist at path: ${buildToolsDir}`);
    }

    const versions = fs.readdirSync(buildToolsDir).filter(dir => {
        const fullPath = path.join(buildToolsDir, dir);
        return fs.statSync(fullPath).isDirectory();
    });

    if (versions.length === 0) {
        throw new Error(`No build-tools versions found in directory: ${buildToolsDir}`);
    }

    // Sort versions in descending order to get the latest version
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const latestVersion = versions[0];
    const latestDir = path.join(buildToolsDir, latestVersion);
    const binaryNames = process.platform === 'win32'
        ? ['aapt2.exe', 'aapt.exe']
        : ['aapt2', 'aapt'];
    const searchDirs = [latestDir, path.join(latestDir, 'lib')];

    for (const candidate of binaryNames) {
        for (const dir of searchDirs) {
            const candidatePath = path.join(dir, candidate);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }
    }

    throw new Error(`Could not find aapt or aapt2 in ${latestDir}. Ensure Android build-tools are installed.`);
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
    const tempDir = process.env.RUNNER_TEMP ?? os.tmpdir();
    const shimDir = path.join(tempDir, '.bundletool');
    await io.mkdirP(shimDir);
    const isWindows = process.platform === 'win32';
    const shimFilename = isWindows ? 'bundletool.cmd' : 'bundletool';
    const shimPath = path.join(shimDir, shimFilename);
    const destPath = path.join(shimDir, jarFile.name);

    core.debug(`installing bundletool version: ${latestRelease.data.tag_name} from ${jarFile.browser_download_url} -> ${destPath}`);

    const downloadPath = await tc.downloadTool(jarFile.browser_download_url, destPath);

    core.debug(`downloaded: ${downloadPath}`);
    fs.accessSync(downloadPath, fs.constants.R_OK);
    const stat = fs.statSync(downloadPath);

    if (stat.size === 0) {
        throw new Error(`Downloaded bundletool jar is empty: ${downloadPath}`);
    }

    // create a shim script to run bundletool with java
    const shimContent = isWindows
        ? `@echo off\r\n"${javaPath}" -jar "${downloadPath}" %*\r\n`
        : `#!/bin/bash\n"${javaPath}" -jar "${downloadPath}" "$@"`;
    fs.writeFileSync(shimPath, shimContent, isWindows ? undefined : { mode: 0o755 });

    if (!isWindows) {
        fs.chmodSync(shimPath, 0o755);
    }

    core.debug(`Created bundletool shim at: ${shimPath}`);

    // cache the tool
    const toolPath = await tc.cacheDir(shimDir, 'bundletool', latestRelease.data.tag_name, process.arch);
    core.debug(`Cached bundletool v${latestRelease.data.tag_name}-${process.arch}: ${toolPath}`);
    core.addPath(toolPath);
    return toolPath;
}
