import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { digestSummary, sha256 } from '../src/digest.mjs';
import { main, parseArguments, USAGE } from '../src/main.mjs';
import { realHost } from '../src/process.mjs';

const APK_BYTES = new TextEncoder().encode('synthetic apk bytes');

/** @param {Partial<import('../src/main.mjs').Host>} [over] */
function fakeHost(over = {}) {
  /** @type {string[]} */
  const logs = [];
  /** @type {Record<string, string>} */
  const appended = {};
  /** @type {string[][]} */
  const processes = [];
  const host = /** @type {import('../src/main.mjs').Host} */ ({
    env: { ANDROID_HOME: '/sdk', JAVA_HOME: '/jdk', GITHUB_STEP_SUMMARY: '/summary.md' },
    platform: 'linux',
    readFile: () => APK_BYTES,
    appendFile: (path, text) => {
      appended[path] = (appended[path] ?? '') + text;
    },
    run: (command, args) => {
      processes.push([command, ...args]);
      return { status: 1, stdout: '' };
    },
    log: (line) => {
      logs.push(line);
    },
    ...over,
  });
  return { host, logs, appended, processes };
}

describe('arguments and commands of the APK verification (EVM-009 AC5, AC6)', () => {
  it('EVM-009 AC5: parses the command, the file, the application id and the signed flag', () => {
    assert.deepEqual(parseArguments(['verify', '--apk', 'a.apk']), {
      command: 'verify',
      apk: 'a.apk',
      applicationId: 'pl.eviacharge.manager',
      signed: false,
    });
    assert.deepEqual(parseArguments(['digest', '--apk', 'a.apk', '--signed', '--application-id', 'x.y']), {
      command: 'digest',
      apk: 'a.apk',
      applicationId: 'x.y',
      signed: true,
    });
  });

  it('EVM-009 AC5: unusable arguments are refused', () => {
    for (const argv of [
      [],
      ['sign'],
      ['verify'],
      ['verify', '--apk'],
      ['verify', '--apk', '--signed'],
      ['verify', '--apk', ''],
      ['verify', '--apk', 'a', '--x'],
      ['verify', '--apk', 'a', '--application-id', 'no spaces ok?'],
    ]) {
      assert.equal(parseArguments(argv), null, argv.join(' '));
    }
  });

  it('EVM-009 AC5: usage is printed with exit code 2', () => {
    const { host, logs } = fakeHost();
    assert.equal(main(['nope'], host), 2);
    assert.deepEqual(logs, [USAGE]);
  });

  it('EVM-009 AC5: digest prints the SHA-256 and writes the job summary: unsigned until the signing job signs', () => {
    const { host, logs, appended } = fakeHost();
    assert.equal(main(['digest', '--apk', join('out', 'app-release-unsigned.apk')], host), 0);
    const digest = sha256(APK_BYTES);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(logs, [`SHA-256 ${digest}  app-release-unsigned.apk`]);
    assert.match(appended['/summary.md'] ?? '', /NIEPODPISANY/);
    assert.match(appended['/summary.md'] ?? '', new RegExp(digest));
  });

  it('EVM-009 AC5: a signed package is announced as signed, and without a summary file nothing is written', () => {
    const signed = fakeHost();
    main(['digest', '--apk', 'app-release.apk', '--signed'], signed.host);
    assert.match(signed.appended['/summary.md'] ?? '', /podpisany/);
    assert.doesNotMatch(signed.appended['/summary.md'] ?? '', /NIEPODPISANY/);
    const none = fakeHost({ env: {} });
    assert.equal(main(['digest', '--apk', 'a.apk'], none.host), 0);
    assert.deepEqual(none.appended, {});
    const empty = fakeHost({ env: { GITHUB_STEP_SUMMARY: '' } });
    main(['digest', '--apk', 'a.apk'], empty.host);
    assert.deepEqual(empty.appended, {});
  });

  it('EVM-009 AC6: verify needs the Android SDK and stops with exit code 1 when apkanalyzer fails', () => {
    const noSdk = fakeHost({ env: {} });
    assert.equal(main(['verify', '--apk', 'a.apk'], noSdk.host), 1);
    assert.deepEqual(noSdk.logs, ['ANDROID_HOME is not set']);
    const failing = fakeHost();
    assert.equal(main(['verify', '--apk', 'a.apk'], failing.host), 1);
    assert.ok(failing.logs.some((line) => line.startsWith('APK: apkanalyzer failed')));
    assert.ok(failing.processes.every((process) => process[0] === join('/jdk', 'bin', 'java')));
  });

  it('EVM-009 AC6: verify uses java from the PATH when JAVA_HOME is unset, and the .exe on Windows; the SDK may come from ANDROID_SDK_ROOT', () => {
    const path = fakeHost({ env: { ANDROID_SDK_ROOT: '/sdk' } });
    main(['verify', '--apk', 'a.apk'], path.host);
    assert.equal(path.processes[0]?.[0], 'java');
    assert.ok(path.processes[0].some((part) => part.includes(join('/sdk', 'cmdline-tools', 'latest'))));
    const windows = fakeHost({ platform: 'win32', env: { ANDROID_HOME: 'C:/sdk', JAVA_HOME: 'C:/jdk' } });
    main(['verify', '--apk', 'a.apk'], windows.host);
    assert.equal(windows.processes[0]?.[0], join('C:/jdk', 'bin', 'java.exe'));
  });

  it('EVM-009 AC6: a package that passes is verified and its digest printed', () => {
    const analyzerAnswers = (/** @type {string[]} */ args) => {
      const key = args.slice(args.indexOf('com.android.tools.apk.analyzer.ApkAnalyzerCli') + 1).join(' ');
      const dir = join(import.meta.dirname, 'fixtures');
      const read = (/** @type {string} */ name) => readFileSync(join(dir, name), 'utf8');
      /** @type {Record<string, string>} */
      const answers = {
        'manifest print a.apk': read('manifest-print.txt'),
        'files list a.apk': read('files-list.txt'),
        'apk summary a.apk': read('apk-summary.txt'),
        'resources value --config default --type xml --name evia_network_security_config a.apk': 'x/n.xml',
        'resources value --config default --type xml --name evia_backup_rules a.apk': 'x/b.xml',
        'resources value --config default --type xml --name evia_data_extraction_rules a.apk': 'x/d.xml',
        'resources xml --file x/n.xml a.apk': read('evia_network_security_config.xml.txt'),
        'resources xml --file x/b.xml a.apk': read('evia_backup_rules.xml.txt'),
        'resources xml --file x/d.xml a.apk': read('evia_data_extraction_rules.xml.txt'),
      };
      return answers[key];
    };
    const { host, logs } = fakeHost({
      run: (_command, args) => {
        const stdout = analyzerAnswers(args);
        return stdout === undefined ? { status: 1, stdout: '' } : { status: 0, stdout };
      },
    });
    assert.equal(main(['verify', '--apk', 'a.apk'], host), 0, logs.join('\n'));
    assert.match(logs[0] ?? '', /^APK verified: application id pl\.eviacharge\.manager/);
    assert.match(logs[1] ?? '', /^SHA-256 [0-9a-f]{64} {2}a.apk$/);
  });

  it('EVM-009 AC5: the summary names the file, the digest and the notes', () => {
    const text = digestSummary({ name: 'a.apk', sha256: 'abc', signed: true, notes: ['n1'] });
    assert.match(text, /`a\.apk`/);
    assert.match(text, /SHA-256: `abc`/);
    assert.match(text, /- n1/);
  });
});

describe('wiring of the APK verification to the machine (EVM-009)', () => {
  it('EVM-009 AC5: files, processes and the log work on the real machine', () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-apk-'));
    try {
      const host = realHost();
      mkdirSync(root, { recursive: true });
      const file = join(root, 'a.bin');
      writeFileSync(file, Buffer.from([1, 2, 3]));
      assert.deepEqual([...host.readFile(file)], [1, 2, 3]);
      host.appendFile(join(root, 's.md'), 'x');
      host.appendFile(join(root, 's.md'), 'y');
      assert.equal(readFileSync(join(root, 's.md'), 'utf8'), 'xy');
      assert.deepEqual(host.run(process.execPath, ['-e', 'process.stdout.write("é")']), { status: 0, stdout: 'é' });
      assert.equal(host.run(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xe9]))'], { binary: true }).stdout, 'é');
      assert.equal(host.platform, process.platform);
      const write = mock.method(process.stdout, 'write', () => true);
      try {
        host.log('hi');
      } finally {
        write.mock.restore();
      }
      assert.deepEqual(
        write.mock.calls.map((call) => call.arguments[0]),
        ['hi\n'],
      );
      assert.equal(host.env, process.env);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
