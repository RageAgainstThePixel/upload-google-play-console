export class PackageInfo {
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