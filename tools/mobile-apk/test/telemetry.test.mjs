import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { API_BASE_URL_META, STORAGE_HOSTS_META, checkTelemetry, clauseBlockers } from '../src/telemetry.mjs';
import { verifyApk } from '../src/verify.mjs';
import { DEX_PACKAGES } from './helpers.mjs';

const MANIFEST = readFileSync(join(import.meta.dirname, 'fixtures', 'manifest-print.txt'), 'utf8');

/** @param {string} inApplication @param {string} [permission] */
const manifestWith = (inApplication, permission = '') =>
  MANIFEST.replace('</application>', `${inApplication}</application>`).replace(
    '<queries>',
    `${permission === '' ? '' : `<uses-permission android:name="${permission}" />`}<queries>`,
  );
/** @param {string} name @param {string} value */
const meta = (name, value) => `<meta-data android:name="${name}" android:value="${value}" />`;

describe('static check of the package for telemetry (EVM-102 AC5)', () => {
  it('EVM-102 AC5: the real package of the app has no SDK of reporting, analytics or advertising', () => {
    assert.deepEqual(checkTelemetry({ manifest: MANIFEST, dexPackages: DEX_PACKAGES }), []);
  });

  it('EVM-102 AC5: components and meta-data of reporting, analytics and advertising SDKs are found in the manifest', () => {
    const cases = [
      ['<service android:name="com.google.firebase.messaging.FirebaseMessagingService" />', /service .*firebase/],
      ['<provider android:name="io.sentry.android.core.SentryInitProvider" android:exported="false" />', /provider io\.sentry/],
      [
        '<receiver android:name="com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver" />',
        /datatransport/,
      ],
      ['<activity android:name="com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity" />', /mlkit/],
      ['<service android:name="com.smartlook.android.core.RecordingService" />', /smartlook/],
      [meta('firebase_analytics_collection_enabled', 'false'), /meta-data firebase_analytics/],
      [meta('com.google.android.gms.ads.APPLICATION_ID', 'x'), /meta-data com\.google\.android\.gms\.ads/],
      [meta('io.sentry.dsn', 'x'), /meta-data io\.sentry\.dsn/],
    ];
    for (const [element, expected] of /** @type {[string, RegExp][]} */ (cases)) {
      const problems = checkTelemetry({ manifest: manifestWith(element), dexPackages: DEX_PACKAGES });
      assert.equal(problems.length, 1, `${element}: ${problems.join(' | ')}`);
      assert.match(problems[0] ?? '', expected);
    }
    // the prefix is a package boundary: a similarly named package of the app is not an SDK
    assert.deepEqual(
      checkTelemetry({ manifest: manifestWith('<service android:name="com.google.firebasefake.X" />'), dexPackages: '' }),
      [],
    );
  });

  it('EVM-102 AC5: the AD_ID permission, ad services and the capture of the screen are found', () => {
    for (const permission of [
      'com.google.android.gms.permission.AD_ID',
      'android.permission.ACCESS_ADSERVICES_AD_ID',
      'android.permission.CAPTURE_VIDEO_OUTPUT',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
    ]) {
      const problems = checkTelemetry({ manifest: manifestWith('', permission), dexPackages: DEX_PACKAGES });
      assert.deepEqual(problems, [`permission ${permission} (advertising identifier or capture of the screen)`]);
    }
    assert.deepEqual(
      checkTelemetry({
        manifest: manifestWith('').replace(
          '<queries>',
          '<uses-permission-sdk-23 android:name="com.google.android.gms.permission.AD_ID" /><queries>',
        ),
        dexPackages: '',
      }).length,
      1,
    );
  });

  it('EVM-102 AC5: DEX packages of SDKs are reported once per SDK, whatever the tool prints around the name', () => {
    const dex = [
      'P d 3 3 120 com.google.firebase.analytics',
      'P d 1 1 10 com.google.firebase',
      'P\td\t1\t1\t10\tio.sentry.android.core',
      'P d 1 1 10 com.google.android.gms.ads.identifier',
      'P d 1 1 10 androidx.core',
      'not a package line',
      '',
    ].join('\n');
    assert.deepEqual(checkTelemetry({ manifest: MANIFEST, dexPackages: dex }), [
      'DEX contains the package com.google.android.gms of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.firebase of a telemetry, analytics or advertising SDK',
      'DEX contains the package io.sentry of a telemetry, analytics or advertising SDK',
    ]);
  });

  it('EVM-102 AC5: a failed or absent DEX listing is skipped here (verify reports the failed tool); an unreadable manifest is left to checkManifest', () => {
    assert.deepEqual(checkTelemetry({ manifest: MANIFEST, dexPackages: null }), []);
    assert.deepEqual(checkTelemetry({ manifest: '<manifest><application></manifest>', dexPackages: 'P d 1 1 1 io.sentry' }), [
      'DEX contains the package io.sentry of a telemetry, analytics or advertising SDK',
    ]);
  });

  it('EVM-102 AC5: the addresses in the package configuration are the API (https) and the object storage only; absent meta-data are not required', () => {
    const good = manifestWith(
      meta(API_BASE_URL_META, 'https://api.example.test') + meta(STORAGE_HOSTS_META, 'storage.example.test, eu.storage.example.test'),
    );
    assert.deepEqual(checkTelemetry({ manifest: good, dexPackages: '' }), []);
    for (const [name, value, expected] of [
      [API_BASE_URL_META, 'http://api.example.test', /is not an https address/],
      [API_BASE_URL_META, 'https://user@api.example.test', /is not an https address/],
      [STORAGE_HOSTS_META, 'https://storage.example.test', /not a list of host names/],
      [STORAGE_HOSTS_META, '*.example.test', /not a list of host names/],
      [STORAGE_HOSTS_META, '', /not a list of host names/],
      ['pl.eviacharge.ANALYTICS_URL', 'https://stats.example.test', /unexpected address/],
      ['pl.eviacharge.REPORT_HOST', 'stats.example.test', /unexpected address/],
    ]) {
      const problems = checkTelemetry({ manifest: manifestWith(meta(String(name), String(value))), dexPackages: '' });
      assert.equal(problems.length, 1, `${String(name)}=${String(value)}: ${problems.join(' | ')}`);
      assert.match(problems[0] ?? '', /** @type {RegExp} */ (expected));
    }
  });

  describe('EVM-102 AC5: every http(s) address in meta-data and in `extra` belongs to the API or to the object storage', () => {
    const API = meta(API_BASE_URL_META, 'https://api.example.test/v1') + meta(STORAGE_HOSTS_META, 'storage.example.test');
    /** @param {unknown} extra */
    const appConfig = (extra) => [{ path: 'assets/app.config', text: JSON.stringify({ expo: { name: 'x', extra } }) }];

    it('passes the address of the API and of the storage in meta-data of any name and in extra (case of the host ignored)', () => {
      const manifest = manifestWith(API + meta('com.example.sdk.ENDPOINT', 'HTTPS://Storage.Example.TEST/bucket?x=1'));
      const files = appConfig({
        buildVariant: 'release',
        api: 'https://api.example.test/health',
        nested: [{ u: 'http://storage.example.test' }],
      });
      assert.deepEqual(checkTelemetry({ manifest, dexPackages: '', files }), []);
    });

    it('reports a foreign address in meta-data of any name (https and http), with the key and the host only', () => {
      for (const [name, value] of [
        ['com.example.sdk.ENDPOINT', 'https://stats.example.test/collect?token=SECRET'],
        ['io.vendor.config', 'http://stats.example.test'],
        ['pl.eviacharge.OTHER', 'see https://api.example.test and http://stats.example.test/x'],
      ]) {
        const problems = checkTelemetry({ manifest: manifestWith(API + meta(String(name), String(value))), dexPackages: '' });
        assert.deepEqual(problems, [
          `meta-data ${name} holds an address of the host stats.example.test; only the API and the object storage are allowed`,
        ]);
        assert.ok(problems.every((problem) => !/SECRET|collect/.test(problem)));
      }
    });

    it('reports a foreign address in extra with the key path, also in nested objects and arrays', () => {
      const files = appConfig({ eas: { projectId: 'x', url: 'https://u.example.test/p?k=SECRET' }, list: ['ok', 'http://v.example.test'] });
      const problems = checkTelemetry({ manifest: manifestWith(API), dexPackages: '', files });
      assert.deepEqual(problems, [
        'extra.eas.url holds an address of the host u.example.test; only the API and the object storage are allowed',
        'extra.list[1] holds an address of the host v.example.test; only the API and the object storage are allowed',
      ]);
      assert.ok(problems.every((problem) => !/SECRET/.test(problem)));
    });

    it('reads extra also at the top level of the configuration and ignores other files and unreadable configuration', () => {
      const top = [{ path: 'assets/app.config', text: JSON.stringify({ extra: { a: 'https://a.example.test' } }) }];
      assert.equal(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files: top }).length, 1);
      const other = [{ path: 'assets/other.json', text: JSON.stringify({ extra: { a: 'https://a.example.test' } }) }];
      assert.deepEqual(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files: other }), []);
      const broken = [{ path: 'assets/app.config', text: '{not json' }];
      assert.deepEqual(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files: broken }), []);
      const nullConfig = [{ path: 'assets/app.config', text: 'null' }];
      assert.deepEqual(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files: nullConfig }), []);
      const noExtra = [{ path: 'assets/app.config', text: JSON.stringify({ expo: { name: 'x' } }) }];
      assert.deepEqual(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files: noExtra }), []);
    });

    it('without the meta-data of the API every address is foreign, except the stand-in host of CI when the bundle holds it', () => {
      const files = appConfig({ a: 'https://api.example.invalid/x', b: 'https://b.example.test' });
      assert.equal(checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files }).length, 2);
      const problems = checkTelemetry({ manifest: manifestWith(''), dexPackages: '', files, placeholderApi: true });
      assert.deepEqual(problems, ['extra.b holds an address of the host b.example.test; only the API and the object storage are allowed']);
    });

    it('reports an address that cannot be parsed and ignores malformed meta-data of the API when collecting hosts', () => {
      const bad = manifestWith(meta(API_BASE_URL_META, 'not a url') + meta('io.vendor.x', 'https://[bad'));
      const problems = checkTelemetry({ manifest: bad, dexPackages: '' });
      assert.deepEqual(problems, [
        `${API_BASE_URL_META} is not an https address`,
        'meta-data io.vendor.x holds an address of the host ?; only the API and the object storage are allowed',
      ]);
    });

    it('the package of CI (fixture manifest, placeholder API, today extra) stays clean', () => {
      const files = appConfig({
        buildVariant: 'release',
        contactEmail: 'office@example.test',
        contactPhone: null,
        privacyClauses: { draft: true, markers: false, versions: '1.0' },
      });
      assert.deepEqual(checkTelemetry({ manifest: MANIFEST, dexPackages: DEX_PACKAGES, files, placeholderApi: true }), []);
    });
  });

  it('EVM-102 AC5: verify runs the check on the built package and says nothing about traffic', () => {
    /** @param {string} manifest @param {string} dex */
    const run = (manifest, dex) =>
      verifyApk(
        { apk: 'app.apk', applicationId: 'pl.eviacharge.manager', java: 'java', cmdlineTools: '/sdk/cmdline-tools/latest' },
        {
          run: (_command, args) => {
            const key = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1).join(' ');
            if (key === 'manifest print app.apk') return { status: 0, stdout: manifest };
            if (key === 'dex packages --defined-only app.apk') return dex === '' ? { status: 1, stdout: '' } : { status: 0, stdout: dex };
            return { status: 1, stdout: '' };
          },
        },
      );
    const result = run(manifestWith(meta('io.sentry.dsn', 'x')), DEX_PACKAGES);
    assert.ok(result.problems.some((problem) => problem.startsWith('telemetry: meta-data io.sentry.dsn')));
    assert.ok(result.problems.includes('apkanalyzer failed: files list'));
    assert.ok(result.notes.every((note) => !/traffic|ruch/i.test(note)));
    assert.ok(run(MANIFEST, '').problems.includes('apkanalyzer failed: dex packages'));
  });
});

describe('state of the privacy clauses in the package (EVM-102 AC6)', () => {
  /** @param {string} text */
  const files = (text) => [{ path: '/assets/app.config', text }];

  it('EVM-102 AC6: approved clauses leave no blocker', () => {
    assert.deepEqual(clauseBlockers(files('{"privacyClauses":{"draft":false,"markers":false,"versions":"1.0"}}')), []);
  });

  it('EVM-102 AC6: a draft and markers are blockers (any value but false counts, fail closed)', () => {
    assert.equal(clauseBlockers(files('{"privacyClauses":{"draft":true,"markers":false}}')).length, 1);
    assert.equal(clauseBlockers(files('{"privacyClauses":{"draft":false,"markers":true}}')).length, 1);
    assert.equal(clauseBlockers(files('{"privacyClauses":{"draft":true,"markers":true}}')).length, 2);
    assert.equal(clauseBlockers(files('{"privacyClauses":{"draft":false}}')).length, 1);
    assert.equal(clauseBlockers(files('{"privacyClauses":{"draft":"false","markers":false}}')).length, 1);
  });

  it('EVM-102 AC6: a missing or unreadable declaration blocks, and the declaration is found in any text asset', () => {
    assert.match(clauseBlockers([]).join(' '), /does not declare/);
    assert.match(clauseBlockers(files('{"extra":{}}')).join(' '), /does not declare/);
    assert.match(clauseBlockers(files('{"privacyClauses":{"draft":}}')).join(' '), /unreadable/);
    assert.match(clauseBlockers(files('{"privacyClauses":{}}')).join(' '), /draft/);
    assert.deepEqual(
      clauseBlockers([
        { path: '/assets/other.json', text: '{}' },
        { path: '/assets/x', text: 'a "privacyClauses" : {"draft":false,"markers":false} b' },
      ]),
      [],
    );
  });

  it('EVM-102 AC6: the blockers do not make verify fail (CI stays green while the clauses are a draft)', () => {
    const result = verifyApk(
      { apk: 'app.apk', applicationId: 'pl.eviacharge.manager', java: 'java', cmdlineTools: '/sdk/cmdline-tools/latest' },
      {
        run: (_command, args) => {
          const key = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1).join(' ');
          if (key === 'files list app.apk') return { status: 0, stdout: '/assets/app.config\n' };
          if (key === 'files cat --file assets/app.config app.apk') {
            return { status: 0, stdout: '{"privacyClauses":{"draft":true,"markers":true}}' };
          }
          return { status: 1, stdout: '' };
        },
      },
    );
    assert.equal(result.releaseBlockers.length, 2);
    assert.ok(result.problems.every((problem) => !/clauses/.test(problem)));
  });
});

describe('libraries of Google in the package (EVM-108 AC8; SR-MOB-12, SR-SUPPLY-06)', () => {
  it('EVM-108 AC8: the ML Kit meta-data of the camera library is a finding (it was a gap: only gms.* and firebase_* were caught)', () => {
    const problems = checkTelemetry({
      manifest: manifestWith(meta('com.google.mlkit.vision.DEPENDENCIES', 'barcode_ui')),
      dexPackages: DEX_PACKAGES,
    });
    assert.deepEqual(problems, ['meta-data com.google.mlkit.vision.DEPENDENCIES configures a telemetry, analytics or advertising SDK']);
  });

  it('EVM-108 AC8: DEX packages of all six forbidden groups are found, one finding per group (and the camera itself is not)', () => {
    const dex = [
      'P d 1 1 10 com.google.mlkit.vision.barcode',
      'P d 1 1 10 com.google.firebase.installations',
      'P d 1 1 10 com.google.android.gms.common',
      'P d 1 1 10 com.google.android.datatransport.runtime',
      'P d 1 1 10 com.google.android.odml.image',
      'P d 1 1 10 androidx.camera.mlkit.vision',
      'P d 1 1 10 androidx.camera.core',
      'P d 1 1 10 androidx.camera.camera2',
      'P d 1 1 10 expo.modules.camera',
    ].join('\n');
    assert.deepEqual(checkTelemetry({ manifest: MANIFEST, dexPackages: dex }), [
      'DEX contains the package androidx.camera.mlkit of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.android.datatransport of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.android.gms of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.android.odml of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.firebase of a telemetry, analytics or advertising SDK',
      'DEX contains the package com.google.mlkit of a telemetry, analytics or advertising SDK',
    ]);
  });

  it('EVM-108 AC8: a component of the new groups is found in the manifest', () => {
    for (const name of ['com.google.android.odml.image.X', 'androidx.camera.mlkit.vision.Y']) {
      const problems = checkTelemetry({ manifest: manifestWith(`<service android:name="${name}" />`), dexPackages: DEX_PACKAGES });
      assert.equal(problems.length, 1, name);
      assert.match(problems[0] ?? '', /belongs to a telemetry, analytics or advertising SDK/);
    }
  });
});
