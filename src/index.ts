import * as google from 'googleapis';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import { exec } from '@actions/exec';
import * as fs from 'fs';

const main = async () => {
    try {
        const credentialsPath = core.getInput('service-account-credentials-json') || process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
        const releaseName = core.getInput('release-name', { required: true });
        const releaseNotes = core.getInput('release-notes');
        const track = core.getInput('track', { required: true });

        core.info(`Uploading release from directory: ${releaseDirectory}`);
        core.info(`Track: ${track}`);
        core.info(`Release name: ${releaseName}`);
        if (releaseNotes) {
            core.info(`Release notes: ${releaseNotes}`);
        }

        // glob to get the release assets from the input release-directory. Get the package name from the manifest of the aab/apk.
        const globber = await glob.create(`${releaseDirectory}/**/*.{aab,apk}`);
        const releaseAssets = await globber.glob();

        if (releaseAssets.length === 0) {
            throw new Error(`No release assets found in directory: ${releaseDirectory}`);
        }

        core.info(`Found ${releaseAssets.length} release assets to upload:\n${releaseAssets.join('\n  > ')}`);

        let packageName: string | undefined;

        for (const assetPath of releaseAssets) {
            if (assetPath.toLowerCase().endsWith('.apk')) {
                packageName = await getPackageNameApk(assetPath);
                break;
            } else if (assetPath.toLowerCase().endsWith('.aab')) {
                packageName = await getPackageNameAab(assetPath);
                break;
            }
        }

        if (!packageName) {
            throw new Error('Failed to determine package name from release assets.');
        }

        //  At a high level, the expected workflow is to "insert" an Edit, make changes as necessary, and then "commit" it.
        const editResponse = await androidPublisherClient.edits.insert({ packageName });
        const editId = editResponse.data.id;

        const uploadRequest: google.androidpublisher_v3.Params$Resource$Edits$Apks$Upload = {
            packageName,
            editId: editId!,
            media: {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(releaseAssets[0]),
            },
        };
        const uploadResponse = await androidPublisherClient.edits.apks.upload(uploadRequest);
    } catch (error) {
        core.setFailed(error);
    }
}

main();

/**
 * Get package name from APK using aapt badging <file>
 * @param filePath
 * @returns package name
 */
async function getPackageNameApk(filePath: string): Promise<string> {
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

        const match = output.match(/package: name='([^']+)'/);

        if (match && match[1]) {
            return match[1];
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
async function getPackageNameAab(filePath: string): Promise<string> {
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

        const match = output.match(/package='([^']+)'/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (error) {
        throw new Error(`Failed to get package name from AAB: ${error}`);
    }

    throw new Error(`Package name not found in the manifest of the release asset: ${filePath}`);
}