# upload-google-play-console

A Github action to upload to google play console.

Specifically designed for [Unity Game Engine](https://unity.com) builds, but can be used for any Android app.

## How to use

> [!IMPORTANT]
> You must also have manually uploaded an initial version of your app to the Google Play Console to create the app record before using this action.

### workflow

> [!TIP]
> This example assumes you are using `google-github-actions/auth` to authenticate to [Google Cloud via Workload Identity Federation with a Service Account](#setup-google-cloud-authentication-via-workload-identity-federation-with-a-service-account). Adjust accordingly if you are using a different authentication method.
>
> It is possible to pass your own service account credentials file path via the `service-account-credentials-path` input or `GOOGLE_APPLICATION_CREDENTIALS` environment variable instead of using `google-github-actions/auth`.

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
          service_account: my-service-account@my-project.iam.gserviceaccount.com
          workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider
      - uses: RageAgainstThePixel/upload-google-play-console@v1
        with:
          service-account-credentials-path: ${{ steps.google-auth.outputs.credentials_file_path }} # Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment
          release-directory: path/to/build/folder # Required, path to the build directory that contains the apks/aabs to upload
          release-name: 1 (1.0.0) # Optional, defaults to reading manifest data (version code and version string)
          track: internal # Optional, defaults to 'internal'
          status: completed # Optional, defaults to 'completed'
          github-token: ${{ secrets.GITHUB_TOKEN }} # Required
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `service-account-credentials-path` | The service account credentials file path. | Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment. |
| `release-directory` | The directory containing the APKs/AABs to upload. | true |
| `release-name` | The name of the release. | Defaults to reading manifest data (version code and version string). |
| `track` | The track to upload the app to (e.g., `internal`, `alpha`, `beta`, `production`). | Defaults to `internal`. |
| `status` | The status of the release (e.g., `draft`, `inProgress`, `completed`, `halted`). | Defaults to `completed`. |
| `github-token` | GitHub token for authentication. Use either `secrets.GITHUB_TOKEN`, `github.token` or a personal access token. | true |

### Setup Google Cloud Authentication via Workload Identity Federation with a Service Account

> Resources:
>
> - [Android Publisher API Getting Started Guide](https://developers.google.com/android-publisher/getting_started)
> - [Google-GitHub-Actions Auth Action Documentation](https://github.com/google-github-actions/auth#indirect-wif)

1. Create a Google Cloud Project
1. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) for your project in the Google Cloud Console
1. Configure [GitHub authentication to Google Cloud via a Workload Identity Federation through a Service Account](https://github.com/google-github-actions/auth#indirect-wif)
    1. Create or take note of an existing Google Cloud Service Account

    ```bash
    gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" --project="${PROJECT_ID}"
    ```

    2. Create a Workload Identity Pool

    ```bash
    gcloud iam workload-identity-pools create "${POOL_NAME}" \
      --project="${PROJECT_ID}" \
      --location="global" \
      --display-name="${POOL_DISPLAY_NAME}"
    ```

    3. Get the full ID of the Workload Identity Pool

    ```bash
    gcloud iam workload-identity-pools describe "${POOL_NAME}" \
      --project="${PROJECT_ID}" \
      --location="global" \
      --format="value(name)"
    ```

    4. Create a Workload Identity Provider in the Pool

    ```bash
    gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
      --project="${PROJECT_ID}" \
      --location="global" \
      --workload-identity-pool="${POOL_NAME}" \
      --display-name="${PROVIDER_DISPLAY_NAME}" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
      --attribute-condition="attribute.repository=='${GITHUB_REPOSITORY}'" \
      --issuer-uri="https://token.actions.githubusercontent.com"
    ```

    5. Allow authentications from the Workload Identity Pool to your Google Cloud Service Account

    ```bash
    gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT_EMAIL}" \
      --project="${PROJECT_ID}" \
      --role="roles/iam.workloadIdentityUser" \
      --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL_FULL_ID}/attribute.repository/${GITHUB_REPOSITORY}"
    ```

    6. Extract the Workload Identity Provider resource name

    ```bash
    gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
      --project="${PROJECT_ID}" \
      --location="global" \
      --workload-identity-pool="${POOL_NAME}" \
      --format="value(name)"
    ```

    7. Go to the [Users & Permissions](https://play.google.com/console/users-and-permissions) page on the Google Play Console.
    8. Click ***Invite new users***
    9. Put an email address for your service account in the email address field
        1. Grant the service account ***Release Manager*** permissions
        1. Add additional permissions as needed
    10. Click ***Invite User***

1. Add `id-token: write` permission to your workflow job so that the `google-github-actions/auth` action can mint identity tokens
