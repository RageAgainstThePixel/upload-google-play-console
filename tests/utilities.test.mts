import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    getExpansionFileType,
    getLatestVersion,
    parseApkPackageName,
    parseInAppUpdatePriority,
    parseUserFraction
} from '../src/utilities.ts';

describe('parseUserFraction', () => {
    it('accepts a fraction between 0 and 1', () => {
        assert.equal(parseUserFraction('0.1'), 0.1);
    });

    for (const input of ['0', '1', '-0.5', '1.5', '0.2junk', 'abc']) {
        it(`rejects ${input}`, () => {
            assert.throws(() => parseUserFraction(input), /Invalid user-fraction/);
        });
    }
});

describe('parseInAppUpdatePriority', () => {
    it('accepts the integers from 0 to 5', () => {
        for (let priority = 0; priority <= 5; priority++) {
            assert.equal(parseInAppUpdatePriority(`${priority}`), priority);
        }
    });

    for (const input of ['6', '-1', '4.9', '5anything', 'abc']) {
        it(`rejects ${input}`, () => {
            assert.throws(() => parseInAppUpdatePriority(input), /Invalid inAppUpdatePriority/);
        });
    }
});

describe('getExpansionFileType', () => {
    it('reads the type from the file name prefix', () => {
        assert.equal(getExpansionFileType('/build/main.42.com.example.app.obb'), 'main');
        assert.equal(getExpansionFileType('/build/patch.42.com.example.app.obb'), 'patch');
    });

    it('ignores the directory and the package name', () => {
        assert.equal(getExpansionFileType('/build/main/patch.42.com.example.app.obb'), 'patch');
        assert.equal(getExpansionFileType('/build/patch/main.42.com.domain.app.obb'), 'main');
    });

    it('returns null without a prefix', () => {
        assert.equal(getExpansionFileType('/build/main/com.domain.app.obb'), null);
    });
});

describe('parseApkPackageName', () => {
    it('reads the package name from badging output', () => {
        const output = `package: name='com.example.app' versionCode='1' versionName='1.0' platformBuildVersionName='14'\nsdkVersion:'24'\n`;
        assert.equal(parseApkPackageName(output), 'com.example.app');
    });

    it('returns null without a package line', () => {
        assert.equal(parseApkPackageName(`sdkVersion:'24'\n`), null);
    });
});

describe('getLatestVersion', () => {
    it('compares version components numerically', () => {
        assert.equal(getLatestVersion(['1.9.0', '1.18.0', '1.2.0']), '1.18.0');
    });
});
