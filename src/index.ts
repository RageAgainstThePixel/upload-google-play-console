import * as google from 'googleapis';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import { exec } from '@actions/exec';
import * as fs from 'fs';

const main = async () => {
    try {
        const credentialsPath = core.getInput('service-account-credentials-path') || process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (!credentialsPath) {
            throw new Error('Missing service account credentials. Please provide the path to the service account JSON file or set the GOOGLE_APPLICATION_CREDENTIALS environment variable.');
        }

        const androidPublisherClient = new google.androidpublisher_v3.Androidpublisher({
            http2: true,
            auth: new google.Auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/androidpublisher'],
            }),
        });

        const releaseDirectory = core.getInput('release-directory', { required: true });
        const releaseName = core.getInput('release-name');
        const track = core.getInput('track') || 'internal';
        const releaseStatus = core.getInput('release-status') || 'draft';

        core.info(`Uploading release from directory: ${releaseDirectory}`);

        if (releaseName) {
            core.info(`Release name: ${releaseName}`);
        }

        core.info(`Track: ${track}`);
        core.info(`Release status: ${releaseStatus}`);

        const globber = await glob.create(`${releaseDirectory}/**/*.{aab,apk,obb,zip}`);
        const releaseAssets = await globber.glob();

        if (releaseAssets.length === 0) {
            throw new Error(`No release assets found in directory: ${releaseDirectory}`);
        }

        core.info(`Found ${releaseAssets.length} release assets to upload:\n${releaseAssets.join('\n  > ')}`);

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

        const insertResponse = await androidPublisherClient.edits.insert({ packageName: packageName });
        const editId = insertResponse.data.id;

        if (apkInfo) {
            const uploadApkRequest: google.androidpublisher_v3.Params$Resource$Edits$Apks$Upload = {
                editId: editId,
                packageName: apkInfo.packageName,
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(apkInfo.filePath),
                }
            };

            const uploadApkResponse = await androidPublisherClient.edits.apks.upload(uploadApkRequest);

            if (uploadApkResponse.status !== 200) {
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

                const expansionFileRequest: google.androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Upload = {
                    editId: editId,
                    packageName: packageName,
                    apkVersionCode: uploadApkResponse.data.versionCode,
                    expansionFileType: expansionFileType,
                    media: {
                        mimeType: 'application/octet-stream',
                        body: fs.createReadStream(obbPath),
                    }
                };

                const expansionFileResponse = await androidPublisherClient.edits.expansionfiles.upload(expansionFileRequest);

                if (expansionFileResponse.status !== 200) {
                    core.error(`Failed to upload expansion file (${expansionFileType}): ${expansionFileResponse.statusText}`);
                }
            }
        }

        if (aabInfo) {
            const uploadBundleRequest: google.androidpublisher_v3.Params$Resource$Edits$Bundles$Upload = {
                editId: editId,
                packageName: aabInfo.packageName,
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(aabInfo.filePath),
                }
            };
            const uploadBundleResponse = await androidPublisherClient.edits.bundles.upload(uploadBundleRequest);

            if (uploadBundleResponse.status !== 200) {
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
            const uploadDeobfuscationFileRequest: google.androidpublisher_v3.Params$Resource$Edits$Deobfuscationfiles$Upload = {
                editId: editId,
                packageName: packageName,
                apkVersionCode: versionCode!,
                deobfuscationFileType: symbolPath.toLowerCase().endsWith('.zip') ? 'nativeCode' : 'proguard',
                media: {
                    mimeType: 'application/octet-stream',
                    body: fs.createReadStream(symbolPath),
                }
            };
            const uploadDeobfuscationFileResponse = await androidPublisherClient.edits.deobfuscationfiles.upload(uploadDeobfuscationFileRequest);

            if (uploadDeobfuscationFileResponse.status !== 200) {
                core.error(`Failed to upload deobfuscation file: ${uploadDeobfuscationFileResponse.statusText}`);
            }
        }

        // get track info and update with new version code
        const getTrackRequest: google.androidpublisher_v3.Params$Resource$Edits$Tracks$Get = {
            packageName: packageName,
            editId: editId,
            track: track
        };

        const getTrackResponse = await androidPublisherClient.edits.tracks.get(getTrackRequest);

        if (getTrackResponse.status !== 200) {
            throw new Error(`Failed to get track info for track ${track}: ${getTrackResponse.statusText}`);
        }

        const releases: google.androidpublisher_v3.Schema$TrackRelease[] = getTrackResponse.data.releases || [];

        releases.push({
            name: releaseName || (apkInfo || aabInfo)!.getReleaseName(),
            status: releaseStatus,
            versionCodes: [`${versionCode}`],
        });

        const trackUpdateRequest: google.androidpublisher_v3.Params$Resource$Edits$Tracks$Update = {
            packageName: packageName,
            editId: editId,
            track: track,
            requestBody: {
                track: track,
                releases: releases,
            }
        };

        const trackUpdateResponse = await androidPublisherClient.edits.tracks.update(trackUpdateRequest);

        if (trackUpdateResponse.status !== 200) {
            throw new Error(`Failed to update track ${track}: ${trackUpdateResponse.statusText}`);
        }

        // validate and commit the edit
        const validateResponse = await androidPublisherClient.edits.validate({
            packageName: packageName,
            editId: editId,
        });

        if (validateResponse.status !== 200) {
            throw new Error(`Failed to validate edit: ${validateResponse.statusText}`);
        }

        const commitResponse = await androidPublisherClient.edits.commit({
            packageName: packageName,
            editId: editId
        });

        if (commitResponse.status !== 200) {
            throw new Error(`Failed to commit edit: ${commitResponse.statusText}`);
        }
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
     * Get release name in format: versionName (versionCode)
     * @returns release name
     */
    public getReleaseName(): string {
        return `${this.versionName} (${this.versionCode})`;
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

        const match = output.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);

        if (match && match[1] && match[2] && match[3]) {
            return new PackageInfo(
                match[1],
                match[3],
                match[2],
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

    try {
        let bundletoolPath = await io.which('bundletool', true);
        let output = '';
        const result = await exec(bundletoolPath, ['dump', 'manifest', '--bundle', filePath], {
            listeners: {
                stdout: (data: Buffer) => {
                    output += data.toString();
                }
            },
            ignoreReturnCode: true
        });

        if (result !== 0) {
            throw new Error(`bundletool exited with code ${result}\n${output}`);
        }

        const match = output.match(/package="([^"]+)" versionCode="([^"]+)" versionName="([^"]+)"/);

        if (match && match[1] && match[2] && match[3]) {
            return new PackageInfo(
                match[1],
                match[3],
                match[2],
                filePath
            );
        }
    } catch (error) {
        throw new Error(`Failed to get package name from AAB: ${error}`);
    }

    throw new Error(`Package name not found in the manifest of the release asset: ${filePath}`);
}