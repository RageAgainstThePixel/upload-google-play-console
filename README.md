# upload-google-play-console

A Github action to upload abb/apk and build metadata artifacts to the Google Play Console.

Specifically designed for [Unity Game Engine](https://unity.com) builds, but can be used for any Android app.

## How to use

> [!IMPORTANT]
> You must also have manually uploaded an initial version of your app to the Google Play Console to create the app record before using this action.

> [!TIP]
> This example assumes you are using `google-github-actions/auth` to authenticate to [Google Cloud via Workload Identity Federation with a Service Account](#setup-google-cloud-authentication-via-workload-identity-federation-with-a-service-account). Adjust accordingly if you are using a different authentication method.
>
> It is possible to pass your own service account credentials file path via the `service-account-credentials` input or `GOOGLE_APPLICATION_CREDENTIALS` environment variable instead of using `google-github-actions/auth`.

> [!WARNING]
> This action requires Java 21 or higher to run. Make sure to set up Java in your workflow before using this action.
>
> You can use the [actions/setup-java](https://github.com/actions/setup-java) action to set up Java.

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
          service_account: my-service-account@my-project.iam.gserviceaccount.com
          workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: 21
      - uses: RageAgainstThePixel/upload-google-play-console@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }} # Required
          service-account-credentials: ${{ steps.google-auth.outputs.credentials_file_path }} # Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment
          release-directory: path/to/build/folder # Required, path to the build directory that contains the apks/aabs to upload
          release-name: 1 (1.0.0) # Optional, defaults to reading manifest data (version code and version string)
          track: internal # Optional, defaults to 'internal'
          status: completed # Optional, Must be one of `draft`, `inProgress`, `completed`, or `halted`.
          user-fraction: 0.1 # Optional, Fraction of users who are eligible for a staged release. 0 < fraction < 1. Can only be set when status is `inProgress` or `halted`.
          in-app-update-priority: 5 # Optional, In-app update priority of the release. Must be between 0 and 5.
          metadata: | # Optional, Json string or path to a JSON file that contains additional localized store listing metadata
            {
              "releaseNotes": {
                "language": "en-US",
                "text": "Bug fixes and performance improvements."
              }
            }
          changes-not-sent-for-review: 'false' # Optional, don't send the changes for review automatically
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `github-token` | GitHub token for authentication. Use either `secrets.GITHUB_TOKEN`, `github.token` or a personal access token. | true |
| `service-account-credentials` | The service account credentials file path. | Required if GOOGLE_APPLICATION_CREDENTIALS is not set in the environment. |
| `release-directory` | The directory containing the APKs/AABs to upload. | true |
| `release-name` | The name of the release. | Defaults to reading manifest data (version code and version string). |
| `track` | The track to upload the app to (e.g., `internal`, `alpha`, `beta`, `production`). | Defaults to `internal`. |
| `status` | The status of the release. Must be one of `draft`, `inProgress`, `completed`, or `halted`. | Defaults to `completed`. |
| `user-fraction` | Fraction of users who are eligible for a staged release. 0 < fraction < 1. Can only be set when status is `inProgress` or `halted`. | false |
| `in-app-update-priority` | In-app update priority of the release. All newly added APKs in the release will be considered at this priority. Can take values in the range [0, 5], with 5 the highest priority. Defaults to 0. `in-app-update-priority` can not be updated once the release is rolled out. See <https://developer.android.com/guide/playcore/in-app-updates>. | false |
| `metadata` | Json string or path to a JSON file that contains additional localized store listing metadata. [see Spec](#metadata-json-structure) | Defaults to `0`. |
| `changes-not-sent-for-review` | When a rejection happens, the parameter will make sure that the changes in this edit won't be reviewed until they are explicitly sent for review from within the Google Play Console UI. These changes will be added to any other changes that are not yet sent for review. | Defaults to `false` |

### Setup Google Cloud Authentication via Workload Identity Federation with a Service Account

> ***Additional Resources:***
>
> - [Android Publisher API Getting Started Guide](https://developers.google.com/android-publisher/getting_started)
> - [google-github-actions/auth Documentation](https://github.com/google-github-actions/auth#indirect-wif)
>

1. Create a Google Cloud Project
1. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) for your project in the Google Cloud Console
1. Enable the [IAM Service Account Credentials API](https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com) for your project in the Google Cloud Console
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

### Metadata JSON structure

The `metadata` input can be either a JSON string or a path to a JSON file that follows the schema defined in [`metadata.schema.json`](src/metadata.schema.json). You can load the schema into your editor or validator to get auto-complete, linting, and type safety for
`listing`, `releaseNotes`, `countryTargeting`, and `images` objects.

> [!TIP]
> Each of the top level properties are optional. You can include only the sections you need or all of them.
>
> `listing` and `releaseNotes` both accept a single object ***or*** an array of objects, so you can target multiple locales in one file.

At a high level the schema supports the following payloads:

- `listing`: one or more localized store listings. Each listing describes the metadata fields that mirror the [Android Publisher Listing resource](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings)
  including `language`, `title`, `shortDescription`, `fullDescription`, optional `video`, and an `images` array.
- `releaseNotes`: localized release notes following the [LocalizedText](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks#localizedtext) structure.
- `countryTargeting`: optional country targeting options with `countries` (ISO 3166-1 alpha-2 codes) and `includeRestOfWorld` flags.
- `images`: one or more images to upload that follow the [Android Publisher Image resource](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images) structure including `language`, `type`, and `path` to a local asset.
  - The supported `type` values (from the [Android Publisher API](https://developers.google.com/android-publisher/api-ref/rest/v3/AppImageType)) are:
    - `phoneScreenshots`
    - `sevenInchScreenshots`
    - `tenInchScreenshots`
    - `tvScreenshots`
    - `wearScreenshots`
    - `icon`
    - `featureGraphic`
    - `tvBanner`

Example snippet that shows how the metadata payload might be composed:

```json
{
  "listing": {
    "language": "en-US",
    "title": "Space Explorer",
    "shortDescription": "Blast through the cosmos.",
    "fullDescription": "Space Explorer is a fast-paced shooter...",
  },
  "releaseNotes": [
    {
      "language": "en-US",
      "text": "Bug fixes and polish."
    }
  ],
  "countryTargeting": {
    "countries": ["US", "CA"],
    "includeRestOfWorld": false
  },
  "images": [
    {
      "language": "en-US",
      "type": "phoneScreenshots",
      "path": "path/to/images/phone-1.png"
    },
    {
      "language": "en-US",
      "type": "icon",
      "path": "path/to/images/icon.png"
    }
  ]
}
```
