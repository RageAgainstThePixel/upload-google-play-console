import * as path from 'path';

/**
 * Parses the user-fraction input.
 * @param input the raw input value
 * @returns the fraction of users, exclusively between 0 and 1
 */
export function parseUserFraction(input: string): number {
    const userFraction = Number(input);

    if (!Number.isFinite(userFraction) || userFraction <= 0 || userFraction >= 1) {
        throw new Error(`Invalid user-fraction value: ${input}. It must be a number greater than 0 and less than 1.`);
    }

    return userFraction;
}

/**
 * Parses the in-app-update-priority input.
 * @param input the raw input value
 * @returns the priority, an integer between 0 and 5
 */
export function parseInAppUpdatePriority(input: string): number {
    if (!/^[0-5]$/.test(input)) {
        throw new Error(`Invalid inAppUpdatePriority value: ${input}. It must be an integer between 0 and 5.`);
    }

    return Number(input);
}

/**
 * Gets the expansion file type from the prefix of an OBB's file name.
 * @param filePath the path to the OBB
 * @returns the expansion file type, or null if the file name has neither prefix
 */
export function getExpansionFileType(filePath: string): 'main' | 'patch' | null {
    const fileName = path.basename(filePath).toLowerCase();

    if (fileName.startsWith('main.')) { return 'main'; }
    if (fileName.startsWith('patch.')) { return 'patch'; }
    return null;
}

/**
 * Gets the package name from the output of aapt2 dump badging.
 * @param output the badging output, for example `package: name='com.example.app' versionCode='1' versionName='1.0'`
 * @returns the package name, or null if the output has none
 */
export function parseApkPackageName(output: string): string | null {
    const match = output.match(/package:\s*name=["']([^"']+)["']/);
    return match ? match[1] : null;
}

/**
 * Gets the newest of a list of versions, comparing their components numerically.
 * @param versions the versions to compare
 * @returns the newest version
 */
export function getLatestVersion(versions: string[]): string {
    return [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}
