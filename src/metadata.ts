import * as google from '@googleapis/androidpublisher';

type Listing = google.androidpublisher_v3.Schema$Listing;
type LocalizedText = google.androidpublisher_v3.Schema$LocalizedText;
type CountryTargeting = google.androidpublisher_v3.Schema$CountryTargeting;

export interface Metadata {
    listing?: Listing | Listing[] | undefined;
    releaseNotes?: LocalizedText | LocalizedText[] | undefined;
    countryTargeting?: CountryTargeting | undefined;
    images?: Image[] | undefined;
}

export interface Image {
    language: string;
    type: ImageType;
    path: string;
}

export type ImageType =
    | 'phoneScreenshots'
    | 'sevenInchScreenshots'
    | 'tenInchScreenshots'
    | 'tvScreenshots'
    | 'wearScreenshots'
    | 'icon'
    | 'featureGraphic'
    | 'tvBanner';