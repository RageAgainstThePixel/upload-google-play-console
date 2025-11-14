# upload-google-play-console

A Github action to upload to google play console.

## How to use

> [!IMPORTANT]
> You must also have manually uploaded an initial version of your app to the Google Play Console to create the app record before using this action.

### Setup Google Play Android Developer API credentials

1. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) for your project in the Google Cloud Console.

> [!TIP]
> This action is setup to use the `GOOGLE_APPLICATION_CREDENTIALS` Environment variable which can be easily set using the [`google-github-actions/auth`](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation) action. Please refer to their documentation for more details on setting up authentication using Workload Identity Federation or Service Account keys.

2. Add `id-token: write` permission to your workflow so that the `google-github-actions/auth` action can mint identity tokens.

### workflow

```yaml
jobs:
  build-and-publish:
    permissions:
      contents: read
      id-token: write # required for google-github-actions/auth
    steps:
      # ... unity build steps ...
      - uses: google-github-actions/auth@v3
        id: google-auth
        with:
          project_id: my-project
          workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider
      - uses: RageAgainstThePixel/upload-google-play-console@v1
        with:
          service-account-credentials-path: ${{ steps.google-auth.outputs.credentials_file_path }}
          release-directory: 'path/to/build/folder' # required, path to the build directory that contains the apks/aabs to upload
          release-name: '1 (1.0.0)' # optional, defaults to reading manifest data (version code and version string).
          release-notes: 'Initial release of my app.' # optional
          track: 'internal' # optional, defaults to 'internal'
          release-status: 'draft' # optional, defaults to 'draft'
          github-token: ${{ secrets.GITHUB_TOKEN }} # Required.
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `service-account-credentials-path` | The service account credentials file path. | Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment. |
| `release-directory` | The directory containing the APKs/AABs to upload. | true |
| `release-name` | The name of the release. | Defaults to reading manifest data (version code and version string). |
| `track` | The track to upload the app to (e.g., `internal`, `alpha`, `beta`, `production`). | Defaults to `internal`. |
| `release-status` | The status of the release (e.g., `draft`, `inProgress`, `completed`, `halted`). | Defaults to `draft`. |
| `github-token` | GitHub token for authentication. Use either `secrets.GITHUB_TOKEN`, `github.token` or a personal access token. | true |
