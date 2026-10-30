import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { E2E_HOOKS_MARKER, PLACEHOLDER_API_HOST } from '../src/contents.mjs';
import { apkanalyzerCommand, verifyApk } from '../src/verify.mjs';

/** @param {string} name */
const read = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const OPTIONS = {
  apk: 'app.apk',
  applicationId: 'pl.eviacharge.manager',
  java: 'java',
  cmdlineTools: join('/sdk', 'cmdline-tools', 'latest'),
};

/**
 * A fake apkanalyzer that replays the recorded output of the real package (test/fixtures).
 * @param {Record<string, string | null>} [overrides] output by the joined analyzer arguments; null = the tool fails
 */
function analyzer(overrides = {}) {
  /** @type {string[][]} */
  const calls = [];
  /** @type {Record<string, string | null>} */
  const answers = {
    'manifest print app.apk': read('manifest-print.txt'),
    'resources value --config default --type xml --name evia_network_security_config app.apk': 'res/xml/evia_network_security_config.xml\n',
    'resources value --config default --type xml --name evia_backup_rules app.apk': 'res/xml/evia_backup_rules.xml\n',
    'resources value --config default --type xml --name evia_data_extraction_rules app.apk': 'res/xml/evia_data_extraction_rules.xml\n',
    'resources xml --file res/xml/evia_network_security_config.xml app.apk': read('evia_network_security_config.xml.txt'),
    'resources xml --file res/xml/evia_backup_rules.xml app.apk': read('evia_backup_rules.xml.txt'),
    'resources xml --file res/xml/evia_data_extraction_rules.xml app.apk': read('evia_data_extraction_rules.xml.txt'),
    'files list app.apk': `${read('files-list.txt')}\n/assets/index.android.bundle\n/assets/fonts/Inter.ttf\n`,
    'files cat --file assets/index.android.bundle app.apk': 'var url="https://api.example.test"',
    'apk summary app.apk': read('apk-summary.txt'),
    // a release package has no such resource: apkanalyzer fails to find it
    'resources value --config default --type bool --name evia_screenshots_allowed app.apk': null,
    ...overrides,
  };
  const run = (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {{ binary?: boolean } | undefined} */ options) => {
    const analyzerArgs = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1);
    calls.push([command, ...analyzerArgs, options?.binary === true ? 'BINARY' : '']);
    const key = analyzerArgs.join(' ');
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unexpected analyzer call: ${key}`);
    return answer === null ? { status: 1, stdout: '' } : { status: 0, stdout: answer };
  };
  return { host: { run }, calls };
}

describe('verification of the built APK (EVM-009 AC5, AC6)', () => {
  it('EVM-009 AC6: apkanalyzer is started through java and the class path of cmdline-tools, never a .bat or a shell', () => {
    const { command, args } = apkanalyzerCommand({
      java: 'java',
      cmdlineTools: '/sdk/cmdline-tools/latest',
      args: ['apk', 'summary', 'a.apk'],
    });
    assert.equal(command, 'java');
    assert.equal(args[0], '-Dcom.android.sdklib.toolsdir=/sdk/cmdline-tools/latest');
    assert.equal(args[2], join('/sdk/cmdline-tools/latest', 'lib', 'apkanalyzer-classpath.jar'));
    assert.deepEqual(args.slice(3), ['com.android.tools.apk.analyzer.ApkAnalyzerCli', 'apk', 'summary', 'a.apk']);
  });

  it('EVM-009 AC6: the real package passes: manifest, the three XML resources, the file list and the contents', () => {
    const { host, calls } = analyzer();
    const result = verifyApk(OPTIONS, host);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.notes, ['application id pl.eviacharge.manager, versionCode 1, versionName 0.1.0']);
    assert.ok(
      calls.some((call) => call.includes('BINARY') && call.includes('assets/index.android.bundle')),
      'the bundle is read as binary',
    );
    assert.ok(!calls.some((call) => call.some((part) => part.includes('Inter.ttf'))), 'fonts are not read');
  });

  it('EVM-100 AC1 (SR-MOB-08): a package of the e2e variant (screenshots allowed, FLAG_SECURE off) is rejected', () => {
    const key = 'resources value --config default --type bool --name evia_screenshots_allowed app.apk';
    for (const answer of ['true\n', '0xffffffff']) {
      const { host } = analyzer({ [key]: answer });
      assert.deepEqual(verifyApk(OPTIONS, host).problems, [
        'resource evia_screenshots_allowed is in the package (screenshots allowed, FLAG_SECURE off — an e2e build)',
      ]);
    }
    const { host } = analyzer({ [key]: 'false\n' });
    assert.deepEqual(verifyApk(OPTIONS, host).problems, []);
  });

  it('EVM-009 AC6: a failing apkanalyzer is a finding for that step, not a silent pass', () => {
    /** @type {[string, string][]} */
    const failures = [
      ['manifest print app.apk', 'apkanalyzer failed: manifest print'],
      ['files list app.apk', 'apkanalyzer failed: files list'],
      ['apk summary app.apk', 'apkanalyzer failed: apk summary'],
      ['resources xml --file res/xml/evia_backup_rules.xml app.apk', 'apkanalyzer failed: xml evia_backup_rules'],
      ['files cat --file assets/index.android.bundle app.apk', 'apkanalyzer failed: cat /assets/index.android.bundle'],
    ];
    for (const [key, message] of failures) {
      const result = verifyApk(OPTIONS, analyzer({ [key]: null }).host);
      assert.ok(result.problems.includes(message), `${key}: ${result.problems.join(' | ')}`);
    }
  });

  it('EVM-009 AC6: a resource that is not in the package, or whose lookup fails, is reported', () => {
    const key = 'resources value --config default --type xml --name evia_network_security_config app.apk';
    assert.deepEqual(verifyApk(OPTIONS, analyzer({ [key]: '\n' }).host).problems, [
      'resource evia_network_security_config is not in the package',
    ]);
    assert.deepEqual(verifyApk(OPTIONS, analyzer({ [key]: null }).host).problems, [
      'apkanalyzer failed: resource evia_network_security_config',
    ]);
  });

  it('EVM-009 AC6: findings of the checks are prefixed with the part of the package they come from', () => {
    const weakened = read('evia_network_security_config.xml.txt').replace(
      'cleartextTrafficPermitted="false"',
      'cleartextTrafficPermitted="true"',
    );
    const result = verifyApk(OPTIONS, analyzer({ 'resources xml --file res/xml/evia_network_security_config.xml app.apk': weakened }).host);
    assert.deepEqual(result.problems, ['evia_network_security_config: base-config does not forbid cleartext traffic']);
    const manifest = read('manifest-print.txt').replace('android:allowBackup="false"', 'android:allowBackup="true"');
    assert.deepEqual(verifyApk(OPTIONS, analyzer({ 'manifest print app.apk': manifest }).host).problems, [
      'manifest: allowBackup is not false',
    ]);
  });

  it('EVM-009 AC6: unreadable XML is a finding and does not crash the job', () => {
    const result = verifyApk(OPTIONS, analyzer({ 'manifest print app.apk': '<manifest><application></manifest>' }).host);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0] ?? '', /^manifest: unreadable \(XML: unbalanced closing tag manifest\)$/);
  });

  it('EVM-009 AC6: a secret or a second public variable in the bundle is a finding with the path, not the text', () => {
    const bundle = 'x -----BEGIN PRIVATE KEY----- y EXPO_PUBLIC_SENTRY_DSN';
    const result = verifyApk(OPTIONS, analyzer({ 'files cat --file assets/index.android.bundle app.apk': bundle }).host);
    assert.deepEqual(result.problems, [
      'private-key-block in /assets/index.android.bundle',
      'public variable EXPO_PUBLIC_SENTRY_DSN in /assets/index.android.bundle',
    ]);
  });

  it('EVM-093 AC1: the marker of the e2e hooks in the bundle of the package is a finding with the path', () => {
    const result = verifyApk(OPTIONS, analyzer({ 'files cat --file assets/index.android.bundle app.apk': `x${E2E_HOOKS_MARKER}y` }).host);
    assert.deepEqual(result.problems, ['e2e hooks marker in /assets/index.android.bundle']);
  });

  it('EVM-009 AC6: the stand-in API address of CI in the bundle is reported as a note and a flag, not as a finding', () => {
    const placeholder = verifyApk(
      OPTIONS,
      analyzer({ 'files cat --file assets/index.android.bundle app.apk': 'var url="https://' + PLACEHOLDER_API_HOST + '"' }).host,
    );
    assert.equal(placeholder.placeholderApi, true);
    assert.deepEqual(placeholder.problems, []);
    assert.ok(placeholder.notes.some((note) => /placeholder of CI/.test(note)));
    const real = verifyApk(OPTIONS, analyzer().host);
    assert.equal(real.placeholderApi, false);
    assert.ok(!real.notes.some((note) => /placeholder/.test(note)));
  });

  it('EVM-009 AC6: the stand-in address of the verification is the one that ci.yml builds with', () => {
    const workflow = readFileSync(join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.ok(workflow.includes("'https://" + PLACEHOLDER_API_HOST + "'"));
  });

  it('EVM-009 AC6: a keystore in the package is reported', () => {
    const listing = `${read('files-list.txt')}\n/assets/upload.keystore\n`;
    assert.deepEqual(
      verifyApk(OPTIONS, analyzer({ 'files list app.apk': listing, 'files cat --file assets/upload.keystore app.apk': 'binary' }).host)
        .problems,
      ['forbidden file /assets/upload.keystore'],
    );
  });

  it('EVM-009 AC5: a package with another application id than the build is reported', () => {
    const result = verifyApk(OPTIONS, analyzer({ 'apk summary app.apk': 'pl.other.app\t1\t0.1.0\n' }).host);
    assert.deepEqual(result.problems, ['application id of the package is not pl.eviacharge.manager']);
  });

  it('EVM-009 AC5: an incomplete summary line still produces notes with placeholders', () => {
    const result = verifyApk({ ...OPTIONS, applicationId: 'x.y' }, analyzer({ 'apk summary app.apk': 'x.y\n' }).host);
    assert.deepEqual(result.notes, ['application id x.y, versionCode ?, versionName ?']);
    const empty = verifyApk(OPTIONS, analyzer({ 'apk summary app.apk': '\n' }).host);
    assert.ok(empty.problems.includes('application id of the package is not pl.eviacharge.manager'));
  });
});
