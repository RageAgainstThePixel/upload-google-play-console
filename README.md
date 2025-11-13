# upload-google-play-console

A Github action to upload to google play console.

## How to use

> [!IMPORTANT]
>
> You must also have manually uploaded an initial version of your app to the Google Play Console to create the app record before using this action.

### Setup Google Play Android Developer API credentials

1. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) for your project in the Google Cloud Console.

> [!TIP]
> This action is setup to use the `GOOGLE_APPLICATION_CREDENTIALS` Environment variable which can be easily set using the [`google-github-actions/auth`](https://github.com/google-github-actions/auth#usage) action. Please refer to their documentation for more details on setting up authentication using Workload Identity Federation or Service Account keys.

### workflow

```yaml
steps:
  - uses: google-github-actions/auth@v3
    with:
      project_id: my-project
      workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider
  - uses: RageAgainstThePixel/upload-google-play-console@v1
    with:
      release-directory: 'path/to/release/assets' # required, aabs/apks and other assets.
      release-name: 'My App v1.0.0' # optional, defaults to reading manifest data.
      release-notes: 'Initial release of my app.' # optional
      track: 'internal' # optional, defaults to 'internal'
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `service-account-credentials-json` | The service account credentials JSON file path. | Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment. |
| `release-directory` | The directory containing the APKs/AABs to upload. | true |
| `release-name` | The name of the release. | defaults to reading manifest data. |
| `release-notes` | The release notes for the upload. | false |
| `track` | The track to upload the app to (e.g., `internal`, `alpha`, `beta`, `production`). | Defaults to `internal`. |
