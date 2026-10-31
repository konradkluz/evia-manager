import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ALLOWED_PUBLIC_VARIABLES, checkFileList, E2E_HOOKS_MARKER, isScannable, scanText } from '../src/contents.mjs';

describe('contents of the built APK (EVM-009 AC6; SR-MOB-11 secrets in the package)', () => {
  it('EVM-009 AC6: the file list of the real package has nothing forbidden', () => {
    const paths = readFileSync(join(import.meta.dirname, 'fixtures', 'files-list.txt'), 'utf8').split(/\r?\n/);
    assert.deepEqual(checkFileList(paths), []);
  });

  it('EVM-009 AC6: keys, certificates, environment files, source maps and service accounts must not be shipped', () => {
    const paths = [
      '/assets/release.keystore',
      '/assets/upload.jks',
      '/res/raw/client.p12',
      '/assets/cert.pem',
      '/assets/.env',
      '/assets/.env.production',
      '/assets/index.android.bundle.map',
      '/google-services.json',
      '/assets/credentials-prod.json',
      '/assets/fine.png',
      '/AndroidManifest.xml',
    ];
    assert.deepEqual(checkFileList(paths), [
      'forbidden file /assets/release.keystore',
      'forbidden file /assets/upload.jks',
      'forbidden file /res/raw/client.p12',
      'forbidden file /assets/cert.pem',
      'forbidden file /assets/.env',
      'forbidden file /assets/.env.production',
      'forbidden file /assets/index.android.bundle.map',
      'forbidden file /google-services.json',
      'forbidden file /assets/credentials-prod.json',
    ]);
  });

  it('EVM-009 AC6: credentials in the bundle are found by rule and path, and the matched text is never in the finding', () => {
    // Synthetic credentials assembled at run time from fragments: no secret-shaped literal exists in the source (gitleaks).
    const part = (/** @type {string[]} */ ...pieces) => pieces.join('');
    const secrets = {
      'private-key-block': part('-----BEGIN RSA ', 'PRIVATE KEY-----'),
      'aws-access-key-id': part('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
      'google-api-key': part('AI', 'za', 'a'.repeat(35)),
      'github-token': part('gh', 'p_', 'a'.repeat(36)),
      'slack-token': part('xo', 'xb-', '1234567890-abcdef'),
      'stripe-key': part('sk', '_live_', 'a'.repeat(20)),
      'json-web-token': part('ey', 'JhbGciOiJIUzI1.', 'ey', 'JzdWIiOiIxMjM0.', 'SflKxwRJSMeKKF2QT4'),
      'credentials-in-url': part('https://user:', 'topsecret', '@example.test/path'),
      'password-assignment': part('pass', 'word = "', 'synthetic-pass-123', '"'),
    };
    for (const [rule, text] of Object.entries(secrets)) {
      const findings = scanText('/assets/index.android.bundle', `noise ${text} noise`);
      assert.deepEqual(findings, [`${rule} in /assets/index.android.bundle`], rule);
      assert.ok(!findings.join().includes('topsecret') && !findings.join().includes('synthetic-pass'), rule);
    }
  });

  it('EVM-093 AC1: the marker of the e2e hooks in the bundle or an asset is a finding (path only), also inside binary bytecode', () => {
    assert.equal(E2E_HOOKS_MARKER, 'evia-e2e-hooks-panel');
    // Hermes bytecode keeps ASCII literals in its string table: the bytes around the marker are binary, read as latin1 text
    const hbc = Buffer.concat([
      Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x00]),
      Buffer.from(E2E_HOOKS_MARKER),
      Buffer.from([0x00, 0xff, 0x01]),
    ]);
    assert.deepEqual(scanText('/assets/index.android.bundle', hbc.toString('latin1')), [
      'e2e hooks marker in /assets/index.android.bundle',
    ]);
    assert.deepEqual(scanText('/assets/app.json', `{"id":"${E2E_HOOKS_MARKER}"}`), ['e2e hooks marker in /assets/app.json']);
    // the slot of a release bundle has no marker; a similar name is not the marker
    assert.deepEqual(scanText('/assets/index.android.bundle', 'function E2eHooks(){return null} evia-e2e-hooks'), []);
  });

  it('EVM-009 AC6: ordinary bundle content has no findings', () => {
    assert.deepEqual(scanText('/assets/a.json', '{"name":"EVia Manager","url":"https://api.example.test/api/health","password":""}'), []);
  });

  it('EVM-009 AC6: the only public build variable of the bundle is EXPO_PUBLIC_API_BASE_URL', () => {
    assert.deepEqual([...ALLOWED_PUBLIC_VARIABLES], ['EXPO_PUBLIC_API_BASE_URL']);
    assert.deepEqual(scanText('/assets/b', 'x EXPO_PUBLIC_API_BASE_URL y'), []);
    assert.deepEqual(scanText('/assets/b', 'EXPO_PUBLIC_SENTRY_DSN and EXPO_PUBLIC_SENTRY_DSN again'), [
      'public variable EXPO_PUBLIC_SENTRY_DSN in /assets/b',
    ]);
  });

  it('EVM-009 AC6: only the assets worth reading are scanned (the bundle, JSON, text), not images, fonts or libraries', () => {
    assert.equal(isScannable('/assets/index.android.bundle'), true);
    assert.equal(isScannable('assets/app.json'), true);
    assert.equal(isScannable('/res/raw/config.txt'), true);
    assert.equal(isScannable('/assets/fonts/Inter.ttf'), false);
    assert.equal(isScannable('/assets/logo.PNG'), false);
    assert.equal(isScannable('/lib/x86_64/libhermes.so'), false);
    assert.equal(isScannable('/classes.dex'), false);
    assert.equal(isScannable('/assets/'), false);
    assert.equal(isScannable('/res/xml/a.xml'), false);
  });
});
