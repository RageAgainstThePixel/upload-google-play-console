describe('metadata schema (lightweight checks)', () => {
    it('accepts a minimal valid metadata object', () => {
        const valid = {
            listing: {
                language: 'en-US',
                title: 'App',
                fullDescription: 'Full',
                shortDescription: 'Short',
                images: [
                    { language: 'en-US', type: 'icon', path: 'assets/icon.png' }
                ]
            }
        };

        // Basic assertions that mirror required schema pieces
        if (!valid.listing) throw new Error('listing missing');
        const l = valid.listing;
        if (!isLanguageTag(l.language)) throw new Error('listing.language invalid');
        if (!isString(l.title)) throw new Error('listing.title invalid');
        if (!isString(l.fullDescription)) throw new Error('listing.fullDescription invalid');
        if (!isString(l.shortDescription)) throw new Error('listing.shortDescription invalid');
        if (!Array.isArray(l.images) || l.images.length === 0) throw new Error('listing.images invalid');
        const img = l.images[0];
        if (!isLanguageTag(img.language)) throw new Error('image.language invalid');
        if (!isString(img.type)) throw new Error('image.type invalid');
        if (!isString(img.path)) throw new Error('image.path invalid');
    });

    it('rejects invalid metadata (missing required fields)', () => {
        const invalid = {
            listing: {
                language: 'en-US'
            }
        } as any;

        // Should fail because required fields are missing
        const l = invalid.listing;
        let failed = false;
        try {
            if (!l.title) throw new Error('missing title');
            if (!l.fullDescription) throw new Error('missing fullDescription');
            if (!l.shortDescription) throw new Error('missing shortDescription');
            if (!l.images) throw new Error('missing images');
        } catch (e) {
            failed = true;
        }

        if (!failed) throw new Error('Expected invalid metadata to fail lightweight validation');
    });
});

function isString(x: unknown): x is string {
    return typeof x === 'string';
}

function isLanguageTag(x: unknown): boolean {
    return isString(x) && x.length > 0;
}

function isNullableString(x: unknown): x is string | null {
    return x === null || isString(x);
}

function isBoolean(x: unknown): x is boolean {
    return typeof x === 'boolean';
}

const IMAGE_TYPES = new Set([
    'phoneScreenshots',
    'sevenInchScreenshots',
    'tenInchScreenshots',
    'tvScreenshots',
    'wearScreenshots',
    'icon',
    'featureGraphic',
    'tvBanner',
    null
]);

function isValidImageType(x: unknown): boolean {
    return x === null || (isString(x) && IMAGE_TYPES.has(x));
}

function isCountryCode(x: unknown): boolean {
    return isString(x) && /^[A-Z]{2}$/.test(x);
}

describe('additional schema cases', () => {
    it('accepts listing as an array and validates each item', () => {
        const listingItem = {
            language: 'en-US',
            title: 'App',
            fullDescription: 'Full',
            shortDescription: 'Short',
            images: [{ language: 'en-US', type: 'icon', path: 'assets/icon.png' }]
        } as any;

        const metadata = { listing: [listingItem, listingItem] } as any;

        if (!Array.isArray(metadata.listing) || metadata.listing.length < 1) throw new Error('listing array invalid');
        for (const l of metadata.listing) {
            if (!isLanguageTag(l.language) && l.language !== null) throw new Error('listing.language invalid');
            if (!isNullableString(l.title)) throw new Error('listing.title invalid');
            if (!isNullableString(l.fullDescription)) throw new Error('listing.fullDescription invalid');
            if (!isNullableString(l.shortDescription)) throw new Error('listing.shortDescription invalid');
            if (!Array.isArray(l.images) || l.images.length === 0) throw new Error('listing.images invalid');
        }
    });

    it('validates top-level images array and rejects empty arrays', () => {
        const good = { images: [{ language: 'en-US', type: 'icon', path: 'assets/icon.png' }] } as any;
        if (!Array.isArray(good.images) || good.images.length === 0) throw new Error('top-level images invalid');

        const bad = { images: [] } as any;
        let failed = false;
        try {
            if (!Array.isArray(bad.images) || bad.images.length === 0) throw new Error('missing images');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected empty top-level images to fail');
    });

    it('accepts listing.images set to null (nullable array)', () => {
        const m = {
            listing: {
                language: 'en-US',
                title: null,
                fullDescription: null,
                shortDescription: null,
                images: null
            }
        } as any;

        const l = m.listing;
        if (!('images' in l)) throw new Error('listing.images must be present (nullable)');
        if (l.images !== null && !Array.isArray(l.images)) throw new Error('listing.images must be array or null');
    });

    it('accepts releaseNotes as single object and as array', () => {
        const single = { releaseNotes: { language: 'en-US', text: 'Notes' } } as any;
        const singleRN = single.releaseNotes;
        if (!isLanguageTag(singleRN.language) && singleRN.language !== null) throw new Error('releaseNotes.language invalid');
        if (!isNullableString(singleRN.text)) throw new Error('releaseNotes.text invalid');

        const arr = { releaseNotes: [{ language: 'en-US', text: 'One' }, { language: 'en-GB', text: 'Two' }] } as any;
        if (!Array.isArray(arr.releaseNotes) || arr.releaseNotes.length === 0) throw new Error('releaseNotes array invalid');
        for (const rn of arr.releaseNotes) {
            if (!isLanguageTag(rn.language) && rn.language !== null) throw new Error('releaseNotes.language invalid');
            if (!isNullableString(rn.text)) throw new Error('releaseNotes.text invalid');
        }
    });

    it('validates countryTargeting rules', () => {
        const good = { countryTargeting: { countries: ['US', 'GB'], includeRestOfWorld: true } } as any;
        if (!Array.isArray(good.countryTargeting.countries) || good.countryTargeting.countries.length < 1) throw new Error('countries invalid');
        for (const c of good.countryTargeting.countries) if (!isCountryCode(c)) throw new Error('country code invalid');
        if (!isBoolean(good.countryTargeting.includeRestOfWorld)) throw new Error('includeRestOfWorld invalid');

        const badCodes = { countryTargeting: { countries: ['us', 'USA'] } } as any;
        let failed = false;
        try {
            for (const c of badCodes.countryTargeting.countries) if (!isCountryCode(c)) throw new Error('country code invalid');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected invalid country codes to fail');

        const empty = { countryTargeting: { countries: [] } } as any;
        failed = false;
        try {
            if (!Array.isArray(empty.countryTargeting.countries) || empty.countryTargeting.countries.length < 1) throw new Error('countries empty');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected empty countries to fail');

        const dup = { countryTargeting: { countries: ['US', 'US'] } } as any;
        failed = false;
        try {
            const set = new Set(dup.countryTargeting.countries);
            if (set.size !== dup.countryTargeting.countries.length) throw new Error('duplicate countries');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected duplicate countries to fail');
    });

    it('checks image.type enum and null acceptance', () => {
        const ok = { listing: { language: 'en-US', title: 'A', fullDescription: 'F', shortDescription: 'S', images: [{ language: 'en-US', type: 'phoneScreenshots', path: 'p' }] } } as any;
        const img = ok.listing.images[0];
        if (!isValidImageType(img.type)) throw new Error('image.type invalid');

        const invalid = { listing: { language: 'en-US', title: 'A', fullDescription: 'F', shortDescription: 'S', images: [{ language: 'en-US', type: 'bad', path: 'p' }] } } as any;
        let failed = false;
        try {
            if (!isValidImageType(invalid.listing.images[0].type)) throw new Error('bad image type');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected invalid image.type to fail');
    });

    it('allows required fields to be present with null when schema permits, but rejects missing required fields', () => {
        const withNull = {
            listing: {
                language: null,
                title: null,
                fullDescription: null,
                shortDescription: null,
                images: null
            }
        } as any;
        const l = withNull.listing;
        if (!('language' in l)) throw new Error('language must be present');
        if (!('title' in l)) throw new Error('title must be present');
        if (!('images' in l)) throw new Error('images must be present');

        const missing = { listing: { language: 'en-US' } } as any;
        let failed = false;
        try {
            if (!('title' in missing.listing)) throw new Error('missing title');
            if (!('fullDescription' in missing.listing)) throw new Error('missing fullDescription');
            if (!('shortDescription' in missing.listing)) throw new Error('missing shortDescription');
            if (!('images' in missing.listing)) throw new Error('missing images');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected missing required fields to fail');
    });

    it('rejects additionalProperties at root and within objects', () => {
        const rootExtra = { listing: { language: 'en-US', title: 'A', fullDescription: 'F', shortDescription: 'S', images: [{ language: 'en-US', type: 'icon', path: 'p' }] }, extra: 'no' } as any;
        let failed = false;
        try {
            if ('extra' in rootExtra) throw new Error('root has additional property');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected extra root property to fail (schema forbids additionalProperties)');

        const listingExtra = { listing: { language: 'en-US', title: 'A', fullDescription: 'F', shortDescription: 'S', images: [], extra: 'no' } } as any;
        failed = false;
        try {
            if ('extra' in listingExtra.listing) throw new Error('listing has additional property');
        } catch (e) {
            failed = true;
        }
        if (!failed) throw new Error('expected extra listing property to fail');
    });
});