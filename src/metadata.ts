
export interface Metadata {
    listing?: Listing | Listing[];
    releaseNotes?: LocalizedText | LocalizedText[];
    countryTargeting?: CountryTargeting;
}

export interface Listing {
    language: string;
    title: string;
    fullDescription: string;
    shortDescription: string;
    video?: string;
    images: Image[];
}

export interface Image {
    type:
    | 'phoneScreenshots'
    | 'sevenInchScreenshots'
    | 'tenInchScreenshots'
    | 'tvScreenshots'
    | 'wearScreenshots'
    | 'icon'
    | 'featureGraphic'
    | 'tvBanner';
    path: string;
}

export interface LocalizedText {
    language: string;
    text: string;
}

export interface CountryTargeting {
    countries?: string[];
    includeRestOfWorld?: boolean;
}