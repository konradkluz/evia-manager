import assert from 'node:assert/strict';
import { basename, delimiter, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { sha256 } from '../src/digest.mjs';
import { main } from '../src/main.mjs';
import { compareVersions, DEFAULT_KEY_PASS_ENV, DEFAULT_KS_PASS_ENV, parseSignArguments, redact, signApk } from '../src/sign.mjs';
import { analyzerAnswers } from './helpers.mjs';

const UNSIGNED = Buffer.from('synthetic unsigned apk bytes');
const SIGNED = Buffer.from('synthetic signed apk bytes');
const IN_DIGEST = sha256(UNSIGNED);
const CERT = 'ab'.repeat(32);
const STORE_PW = 'synthetic-store-pw-7f3a';
const ENTRY_PW = 'synthetic-entry-pw-91bc';
const win = process.platform === 'win32';
const P = (/** @type {string} */ path) => resolve(path);
const OTHER_SECRET = 'synthetic-token-5d21';
/** The environment of the owner's shell: the SDK, the JDK, PATH, the password variables and an unrelated secret. */
const SHELL_ENV = {
  ANDROID_HOME: P('/sdk'),
  JAVA_HOME: P('/jdk'),
  PATH: P('/bin'),
  SOME_TOKEN: OTHER_SECRET,
};
const GIT = P(win ? '/bin/git.exe' : '/bin/git');

/**
 * @param {{ v2?: boolean, v3?: boolean, signers?: number, cert?: string, dn?: string }} [over]
 */
function report({ v2 = true, v3 = true, signers = 1, cert = CERT, dn = 'CN=Synthetic Owner' } = {}) {
  return [
    'Verifies',
    'Verified using v1 scheme (JAR signing): false',
    `Verified using v2 scheme (APK Signature Scheme v2): ${String(v2)}`,
    `Verified using v3 scheme (APK Signature Scheme v3): ${String(v3)}`,
    `Number of signers: ${String(signers)}`,
    `Signer #1 certificate DN: ${dn}`,
    cert === '' ? '' : `Signer #1 certificate SHA-256 digest: ${cert}`,
  ].join('\n');
}

/**
 * An in-memory machine: files, a git work tree at /repo, the build-tools of an SDK and a scripted apksigner/zipalign.
 * @param {Record<string, any>} [config]
 */
function world(config = {}) {
  const cfg = {
    env: { ...SHELL_ENV, [DEFAULT_KS_PASS_ENV]: STORE_PW, [DEFAULT_KEY_PASS_ENV]: ENTRY_PW },
    versions: ['9.0.0', '35.0.0', '36.0.0', '36.0.0-rc1', 'notes'],
    jar: true,
    zipalign: true,
    keystore: true,
    apk: true,
    outDirectory: true,
    repo: P('/repo'),
    gitMissing: false,
    gitInPath: true,
    gitError: '',
    bundle: /** @type {string | undefined} */ (undefined),
    ignored: false,
    alias: /** @type {Record<string, string>} */ ({}),
    signedAlready: false,
    zipStatus: 0,
    signStatus: 0,
    signStderr: '',
    verifyStatus: 0,
    report: report(),
    analyzerFails: /** @type {string[]} */ ([]),
    ...config,
  };
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  if (cfg.apk) files.set(P('/work/in.apk'), UNSIGNED);
  if (cfg.gitInPath) files.set(GIT, Buffer.from('git'));
  if (cfg.keystore) files.set(P('/keys/release.p12'), Buffer.from('synthetic keystore'));
  if (cfg.jar)
    for (const version of cfg.versions) files.set(join(P('/sdk'), 'build-tools', version, 'lib', 'apksigner.jar'), Buffer.from('jar'));
  if (cfg.zipalign)
    for (const version of cfg.versions)
      files.set(join(P('/sdk'), 'build-tools', version, win ? 'zipalign.exe' : 'zipalign'), Buffer.from('z'));
  const dirs = new Set([
    join(P('/sdk'), 'build-tools'),
    P('/work'),
    P('/keys'),
    P('/out'),
    P('/repo'),
    P('/repo/.scratch'),
    ...cfg.versions.map((v) => join(P('/sdk'), 'build-tools', v)),
  ]);
  if (!cfg.outDirectory) dirs.delete(P('/out'));
  /** @type {Array<{ command: string, args: string[], options: Record<string, unknown> }>} */
  const runs = [];
  /** @type {string[]} */
  const logs = [];
  const inRepo = (/** @type {string} */ path) => P(path) === cfg.repo || P(path).startsWith(cfg.repo + (win ? '\\' : '/'));
  const host = {
    env: cfg.env,
    platform: process.platform,
    cwd: () => P('/repo'),
    readFile: (/** @type {string} */ path) => files.get(P(path)) ?? new Uint8Array(),
    exists: (/** @type {string} */ path) => files.has(P(path)) || dirs.has(P(path)),
    realpath: (/** @type {string} */ path) => cfg.alias[P(path)] ?? P(path),
    listDir: (/** @type {string} */ path) => (dirs.has(P(path)) ? cfg.versions : []),
    remove: (/** @type {string} */ path) => {
      files.delete(P(path));
    },
    log: (/** @type {string} */ line) => {
      logs.push(line);
    },
    appendFile: () => undefined,
    run: (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {Record<string, unknown>} */ options = {}) => {
      runs.push({ command, args, options });
      if (basename(command).replace(/.exe$/, '') === 'git') {
        if (cfg.gitMissing) return { status: null, stdout: '', stderr: '' };
        const directory = args[1] ?? '';
        if (args[2] === 'check-ignore') return { status: cfg.ignored ? 0 : 1, stdout: '', stderr: '' };
        return inRepo(directory)
          ? { status: 0, stdout: `${cfg.repo}\n`, stderr: '' }
          : { status: 128, stdout: '', stderr: cfg.gitError === '' ? 'fatal: not a git repository' : cfg.gitError };
      }
      if (command.endsWith('zipalign') || command.endsWith('zipalign.exe')) {
        if (cfg.zipStatus === 0) files.set(P(args.at(-1) ?? ''), Buffer.from('aligned'));
        return { status: cfg.zipStatus, stdout: '', stderr: cfg.zipStatus === 0 ? '' : `cannot read ${args.at(-2) ?? ''}` };
      }
      if (args[0] === '-jar') {
        const verb = args[2];
        if (verb === 'sign') {
          if (cfg.signStatus === 0) files.set(P(args[args.indexOf('--out') + 1] ?? ''), SIGNED);
          return { status: cfg.signStatus, stdout: '', stderr: cfg.signStderr };
        }
        if (args.includes('--print-certs')) return { status: cfg.verifyStatus, stdout: cfg.report, stderr: '' };
        return { status: cfg.signedAlready ? 0 : 1, stdout: '', stderr: '' };
      }
      const target = args.at(-1) ?? '';
      if (cfg.analyzerFails.includes(P(target))) return { status: 1, stdout: '', stderr: '' };
      const stdout = analyzerAnswers(args, target, cfg.bundle);
      return stdout === undefined ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout, stderr: '' };
    },
  };
  return { host, files, runs, logs, cfg };
}

/** @template T @param {T | undefined} value @returns {T} */
function must(value) {
  assert.ok(value !== undefined);
  return value;
}

/** @param {Partial<import('../src/sign.mjs').SignOptions>} [over] */
const options = (over = {}) => ({
  apk: P('/work/in.apk'),
  expectSha256: IN_DIGEST,
  keystore: P('/keys/release.p12'),
  keyAlias: 'evia',
  out: P('/out/signed.apk'),
  expectedCertSha256: '',
  ksPassEnv: DEFAULT_KS_PASS_ENV,
  keyPassEnv: DEFAULT_KEY_PASS_ENV,
  buildTools: '',
  allowPlaceholderApi: false,
  ...over,
});

const ARGV = ['--apk', 'in.apk', '--expect-sha256', IN_DIGEST, '--keystore', 'k.p12', '--key-alias', 'evia', '--out', 'out.apk'];

describe('arguments of the local signing (EVM-009 AC5)', () => {
  it('EVM-009 AC5: parses the arguments, defaults the names of the password variables and normalizes the digests', () => {
    const parsed = parseSignArguments([...ARGV, '--expected-cert-sha256', CERT.toUpperCase().replace(/(..)(?!$)/g, '$1:')], {});
    assert.ok('options' in parsed);
    assert.deepEqual(parsed.options, {
      apk: 'in.apk',
      expectSha256: IN_DIGEST,
      keystore: 'k.p12',
      keyAlias: 'evia',
      out: 'out.apk',
      expectedCertSha256: CERT,
      ksPassEnv: 'EVIA_APK_KS_PASS',
      keyPassEnv: 'EVIA_APK_KEY_PASS',
      buildTools: '',
      allowPlaceholderApi: false,
    });
    const named = parseSignArguments([...ARGV, '--ks-pass-env', 'MY_STORE', '--key-pass-env', 'MY_KEY', '--build-tools', '36.0.0'], {});
    assert.ok('options' in named);
    assert.equal(named.options.ksPassEnv, 'MY_STORE');
    assert.equal(named.options.keyPassEnv, 'MY_KEY');
    assert.equal(named.options.buildTools, '36.0.0');
    assert.equal(named.options.allowPlaceholderApi, false);
    const allowed = parseSignArguments(['--allow-placeholder-api', ...ARGV], {});
    assert.ok('options' in allowed && allowed.options.allowPlaceholderApi);
    assert.equal(allowed.options.out, 'out.apk');
    const last = parseSignArguments([...ARGV, '--allow-placeholder-api'], {});
    assert.ok('options' in last && last.options.allowPlaceholderApi);
  });

  it('EVM-009 AC5: the keystore, the alias and the pinned certificate may come from the environment of the owner', () => {
    const argv = ['--apk', 'in.apk', '--expect-sha256', IN_DIGEST, '--out', 'out.apk'];
    const parsed = parseSignArguments(argv, { EVIA_APK_KEYSTORE: 'k.p12', EVIA_APK_KEY_ALIAS: 'evia', EVIA_APK_CERT_SHA256: CERT });
    assert.ok('options' in parsed);
    assert.equal(parsed.options.keystore, 'k.p12');
    assert.equal(parsed.options.keyAlias, 'evia');
    assert.equal(parsed.options.expectedCertSha256, CERT);
    assert.ok('error' in parseSignArguments(argv, {}));
  });

  it('EVM-009 AC5: passwords in the arguments are refused — options, pass:/file:/env:/stdin: forms and a typed secret', () => {
    for (const forbidden of ['--ks-pass', '--key-pass', '--pass', '--password', '--ks-password', '--key-password']) {
      const result = parseSignArguments([...ARGV, forbidden, STORE_PW], { EVIA_APK_KS_PASS: STORE_PW });
      assert.ok('error' in result && /passwords are never passed as arguments/.test(result.error), forbidden);
      assert.ok(!JSON.stringify(result).includes(STORE_PW));
    }
    for (const form of ['pass:abc', 'file:/x', 'stdin:', 'env:NAME', 'PASS:abc']) {
      const result = parseSignArguments([...ARGV, '--ks-pass-env', form], {});
      assert.ok('error' in result && /pass:, file:/.test(result.error), form);
    }
    const bad = parseSignArguments([...ARGV, '--key-pass-env', 'two words'], {});
    assert.ok('error' in bad && /identifier/.test(bad.error));
    const typed = parseSignArguments([...ARGV.slice(0, -1), STORE_PW], { EVIA_APK_KS_PASS: STORE_PW });
    assert.ok('error' in typed && /must not appear among the arguments/.test(typed.error));
    assert.ok(!JSON.stringify(typed).includes(STORE_PW));
  });

  it('EVM-009 AC5: unusable arguments are refused', () => {
    const cases = [
      [],
      ['--apk'],
      [...ARGV, '--unknown', 'x'],
      [...ARGV, '--build-tools', 'latest'],
      [...ARGV, '--expected-cert-sha256', 'abc'],
      ['--apk', 'a', '--expect-sha256', 'nothex', '--keystore', 'k', '--key-alias', 'x', '--out', 'o'],
      ['--apk', 'a', '--expect-sha256', IN_DIGEST, '--keystore', '--key-alias', 'x', '--out', 'o'],
    ];
    for (const argv of cases) assert.ok('error' in parseSignArguments(argv, {}), argv.join(' '));
  });

  it('EVM-009 AC5: the dispatcher prints the reason with exit code 2 and never echoes a password', () => {
    const { host, logs } = world();
    assert.equal(main(['sign', '--ks-pass', STORE_PW], host), 2);
    assert.equal(main(['sign'], host), 2);
    assert.ok(!logs.join('\n').includes(STORE_PW));
  });
});

describe('local signing of the package (EVM-009 AC5; security-engineer K-A)', () => {
  it('EVM-009 AC5: zipalign (16 KB pages), then apksigner from the highest build-tools through java, then verify; prints only path and digests', () => {
    const { host, runs, logs, files } = world();
    const code = signApk(options({ expectedCertSha256: CERT }), host);
    assert.equal(code, 0, logs.join('\n'));
    const tools = join(P('/sdk'), 'build-tools', '36.0.0');
    const align = must(runs.find((run) => basename(run.command).startsWith('zipalign')));
    assert.equal(align.command, join(tools, win ? 'zipalign.exe' : 'zipalign'));
    assert.deepEqual(align.args.slice(0, 4), ['-P', '16', '-f', '4']);
    const sign = must(runs.find((run) => run.args[2] === 'sign'));
    assert.equal(sign.command, join(P('/jdk'), 'bin', win ? 'java.exe' : 'java'));
    assert.deepEqual(sign.args.slice(0, 3), ['-jar', join(tools, 'lib', 'apksigner.jar'), 'sign']);
    assert.ok(sign.args.join(' ').includes('--ks-pass env:EVIA_APK_KS_PASS --key-pass env:EVIA_APK_KEY_PASS'));
    assert.ok(sign.args.includes('--v2-signing-enabled') && sign.args.includes('--v3-signing-enabled'));
    assert.equal(sign.options['quiet'], true);
    const order = runs.map((run) => (basename(run.command).startsWith('zipalign') ? 'zipalign' : (run.args[2] ?? run.command)));
    assert.ok(order.indexOf('zipalign') < order.indexOf('sign') && order.indexOf('sign') < order.lastIndexOf('verify'));
    assert.deepEqual(logs, [`Signed: ${P('/out/signed.apk')}`, `SHA-256 file: ${sha256(SIGNED)}`, `SHA-256 certificate: ${CERT}`]);
    assert.ok(!files.has(`${P('/out/signed.apk')}.aligned.tmp`), 'the intermediate file is removed');
    assert.ok(files.has(P('/out/signed.apk')));
  });

  it('EVM-009 AC5: no password ever reaches argv, the log or the summary; no process gets a shell', () => {
    const { host, runs, logs } = world();
    signApk(options(), host);
    const everything = JSON.stringify(runs.map(({ command, args }) => [command, ...args])) + logs.join('\n');
    assert.ok(!everything.includes(STORE_PW) && !everything.includes(ENTRY_PW));
    for (const run of runs) assert.ok(!('shell' in run.options) && !/\.(bat|cmd)$/i.test(run.command), run.command);
  });

  it('EVM-009 AC5: the passwords reach the environment of apksigner sign only; git, zipalign and every other process get the allow-list', () => {
    const { host, runs, logs } = world();
    assert.equal(signApk(options(), host), 0, logs.join('\n'));
    const envOf = (/** @type {{ options: Record<string, unknown> }} */ run) => /** @type {Record<string, string>} */ (run.options['env']);
    const signRuns = runs.filter((run) => run.args[2] === 'sign');
    assert.equal(signRuns.length, 1);
    const signEnv = envOf(must(signRuns[0]));
    assert.equal(signEnv[DEFAULT_KS_PASS_ENV], STORE_PW);
    assert.equal(signEnv[DEFAULT_KEY_PASS_ENV], ENTRY_PW);
    assert.ok(runs.some((run) => basename(run.command).startsWith('git')));
    assert.ok(runs.some((run) => basename(run.command).startsWith('zipalign')));
    assert.ok(runs.some((run) => run.args.includes('com.android.tools.apk.analyzer.ApkAnalyzerCli')));
    assert.ok(runs.some((run) => run.args.includes('verify')));
    for (const run of runs) {
      const env = envOf(run);
      assert.equal(env['NoDefaultCurrentDirectoryInExePath'], '1');
      assert.equal(env['JAVA_HOME'], P('/jdk'));
      assert.equal(env['SOME_TOKEN'], undefined, 'an unrelated variable is not passed on');
      if (run.args[2] === 'sign') continue;
      assert.ok(!(DEFAULT_KS_PASS_ENV in env) && !(DEFAULT_KEY_PASS_ENV in env), 'no password variable for ' + run.command);
      assert.ok(!JSON.stringify(env).includes(STORE_PW) && !JSON.stringify(env).includes(ENTRY_PW));
    }
    assert.ok(!JSON.stringify(signEnv).includes(OTHER_SECRET));
  });

  it('EVM-009 AC5: git runs by its absolute path found in PATH (never from the current folder) and in English', () => {
    const { host, runs } = world();
    signApk(options(), host);
    const gitRuns = runs.filter((run) => basename(run.command).startsWith('git'));
    assert.ok(gitRuns.length >= 3);
    for (const run of gitRuns) {
      assert.equal(run.command, GIT);
      assert.equal(/** @type {Record<string, string>} */ (run.options['env'])['LC_ALL'], 'C');
    }
    const relative = world({ env: { ...SHELL_ENV, PATH: '.' + delimiter + P('/other') } });
    assert.equal(signApk(options(), relative.host), 1);
    assert.match(relative.logs.join('\n'), /git was not found in PATH/);
    const absent = world({ gitInPath: false });
    assert.equal(signApk(options(), absent.host), 1);
    assert.match(absent.logs.join('\n'), /git is needed/);
    assert.ok(!absent.runs.some((run) => basename(run.command).startsWith('git')));
    const mixedCase = world({ env: { ANDROID_HOME: P('/sdk'), JAVA_HOME: P('/jdk'), Path: P('/bin') } });
    assert.equal(signApk(options(), mixedCase.host), 0, mixedCase.logs.join('\n'));
  });

  it('EVM-009 AC5: signing needs JAVA_HOME; a bare "java" is never started', () => {
    const { host, runs, logs } = world({ env: { ...SHELL_ENV, JAVA_HOME: undefined } });
    assert.equal(signApk(options(), host), 1);
    assert.deepEqual(logs, ['sign: JAVA_HOME is not set (signing needs an explicit JDK)']);
    assert.equal(runs.length, 0);
  });

  it('EVM-009 AC5: v4 signing is switched off explicitly, so that no .idsig file appears next to the result', () => {
    const { host, runs } = world();
    signApk(options(), host);
    const sign = must(runs.find((run) => run.args[2] === 'sign'));
    const at = sign.args.indexOf('--v4-signing-enabled');
    assert.ok(at > 0);
    assert.equal(sign.args[at + 1], 'false');
  });

  it('EVM-009 AC5: zipalign older than build-tools 35 gets a readable message with the required and the found version', () => {
    const { host, runs, logs, files } = world();
    assert.equal(signApk(options({ buildTools: '9.0.0' }), host), 1);
    assert.deepEqual(logs, [
      'sign: zipalign -P 16 needs build-tools 35.0.0 or newer, found 9.0.0 (install a newer one with sdkmanager or pass --build-tools)',
    ]);
    assert.ok(!runs.some((run) => basename(run.command).startsWith('zipalign')));
    assert.ok(!files.has(P('/out/signed.apk') + '.aligned.tmp'));
    const exact = world();
    assert.equal(signApk(options({ buildTools: '35.0.0' }), exact.host), 0, exact.logs.join('\n'));
  });

  it('EVM-009 AC5: git errors other than "not a git repository" (dubious ownership, no access) refuse signing with a clear reason', () => {
    for (const gitError of ['fatal: detected dubious ownership in repository', 'fatal: cannot change to the folder: Permission denied']) {
      const { host, logs, runs } = world({ gitError });
      assert.equal(signApk(options(), host), 1, gitError);
      assert.match(
        logs.join('\n'),
        /git is needed to prove that the keystore is outside the repository, but it failed or refused the folder/,
      );
      assert.ok(!runs.some((run) => run.args[2] === 'sign'));
    }
    // the keystore is fine, the current folder is refused: the check of the work tree cannot be skipped
    const { host, logs } = world();
    const run = host.run;
    host.run = (command, args, opts) =>
      args[0] === '-C' && args[1] === P('/repo')
        ? { status: 128, stdout: '', stderr: 'fatal: dubious ownership' }
        : run(command, args, opts);
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /read the work tree of the current folder/);
  });

  it('EVM-009 AC5: a git failure without any message is an error, not "not a repository"', () => {
    const { host: fake, logs } = world();
    const host = /** @type {import('../src/sign.mjs').SignHost} */ (fake);
    const run = host.run;
    host.run = (command, args, opts) => (args[0] === '-C' ? { status: 128, stdout: '' } : run(command, args, opts));
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /failed or refused the folder/);
  });

  it('EVM-009 AC5: build-tools versions are compared part by part and a missing part counts as zero', () => {
    assert.ok(compareVersions('35.0.0', '9.0.0') > 0);
    assert.ok(compareVersions('36.0.0', '36.0.1') < 0);
    assert.equal(compareVersions('35', '35.0.0'), 0);
    assert.ok(compareVersions('35.0.0', '35') === 0 && compareVersions('35.1', '35') > 0);
  });

  it('EVM-009 AC5: a git error for the output folder refuses signing, a non-repository output folder is fine', () => {
    const { host, logs } = world();
    const run = host.run;
    host.run = (command, args, opts) =>
      args[0] === '-C' && args[1] === P('/out')
        ? { status: 128, stdout: '', stderr: 'fatal: dubious ownership' }
        : run(command, args, opts);
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /check the place of the output, but it failed or refused/);
    const plain = world();
    assert.equal(signApk(options(), plain.host), 0, plain.logs.join('\n'));
  });

  it('EVM-009 AC5: a package with the placeholder API address is refused unless --allow-placeholder-api is given', () => {
    const bundle = 'var url="https://api.example.invalid"';
    const refused = world({ bundle });
    assert.equal(signApk(options(), refused.host), 1);
    assert.match(refused.logs.join('\n'), /placeholder API address/);
    assert.ok(!refused.runs.some((run) => run.args[2] === 'sign'));
    const allowed = world({ bundle });
    assert.equal(signApk(options({ allowPlaceholderApi: true }), allowed.host), 0, allowed.logs.join('\n'));
    const real = world({ bundle: 'var url="https://api.evia.example.test"' });
    assert.equal(signApk(options(), real.host), 0, real.logs.join('\n'));
  });

  it('EVM-009 AC5: without the password variables apksigner prompts on the inherited terminal and gets no password option', () => {
    const { host, runs, logs } = world({ env: { ...SHELL_ENV } });
    assert.equal(signApk(options(), host), 0, logs.join('\n'));
    const sign = must(runs.find((run) => run.args[2] === 'sign'));
    assert.equal(sign.options['interactive'], true);
    assert.equal(sign.options['quiet'], undefined);
    assert.ok(!sign.args.includes('--ks-pass') && !sign.args.includes('--key-pass'));
    assert.equal(sign.command, join(P('/jdk'), 'bin', win ? 'java.exe' : 'java'));
  });

  it('EVM-009 AC5: the key password defaults to the keystore password when only that variable is set', () => {
    const { host, runs } = world({ env: { ...SHELL_ENV, EVIA_APK_KS_PASS: STORE_PW } });
    signApk(options(), host);
    const sign = must(runs.find((run) => run.args[2] === 'sign'));
    assert.ok(sign.args.includes('--ks-pass') && !sign.args.includes('--key-pass'));
  });

  it('EVM-009 AC5: an explicit build-tools version is used and a missing one is reported; the SDK may come from ANDROID_SDK_ROOT', () => {
    const chosen = world({ env: { ...SHELL_ENV, ANDROID_HOME: undefined, ANDROID_SDK_ROOT: P('/sdk'), EVIA_APK_KS_PASS: STORE_PW } });
    assert.equal(signApk(options({ buildTools: '35.0.0' }), chosen.host), 0);
    assert.ok(chosen.runs.some((run) => run.args.includes(join(P('/sdk'), 'build-tools', '35.0.0', 'lib', 'apksigner.jar'))));
    const missing = world();
    assert.equal(signApk(options({ buildTools: '30.0.0' }), missing.host), 1);
    assert.match(missing.logs.join('\n'), /zipalign or apksigner\.jar not found/);
  });

  it('EVM-009 AC5: missing tools give a readable message and exit code 1 (no SDK, no jar, no zipalign, no build-tools)', () => {
    const noSdk = world({ env: {} });
    assert.equal(signApk(options(), noSdk.host), 1);
    assert.deepEqual(noSdk.logs, ['sign: ANDROID_HOME is not set']);
    for (const config of [{ jar: false }, { zipalign: false }, { versions: [] }]) {
      const { host, logs } = world(config);
      assert.equal(signApk(options(), host), 1, JSON.stringify(config));
      assert.match(logs.join('\n'), /not found in the build-tools/);
    }
  });

  it('EVM-009 AC5: a keystore inside the repository — also under .scratch or through an alias such as subst — is refused and its path not printed', () => {
    for (const keystore of [P('/repo/key.p12'), P('/repo/.scratch/key.p12')]) {
      const { host, logs, files } = world();
      files.set(keystore, Buffer.from('k'));
      assert.equal(signApk(options({ keystore }), host), 1);
      assert.match(logs.join('\n'), /is inside a git work tree/);
      assert.ok(!logs.join('\n').includes(P('/repo')), 'the path is not printed in full');
    }
    const aliased = world({ alias: { [P('/keys/release.p12')]: P('/repo/.scratch/release.p12') } });
    assert.equal(signApk(options(), aliased.host), 1);
    assert.match(aliased.logs.join('\n'), /release\.p12 is inside a git work tree/);
  });

  it('EVM-009 AC5: when git cannot prove where the keystore is, signing is refused', () => {
    const { host, logs } = world({ gitMissing: true });
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /git is needed/);
  });

  it('EVM-009 AC5: a missing keystore, package or output folder is reported', () => {
    for (const [config, pattern] of /** @type {const} */ ([
      [{ keystore: false }, /keystore file does not exist/],
      [{ apk: false }, /package does not exist/],
      [{ outDirectory: false }, /folder of --out does not exist/],
    ])) {
      const { host, logs } = world(config);
      assert.equal(signApk(options(), host), 1);
      assert.match(logs.join('\n'), pattern);
    }
  });

  it('EVM-009 AC5: the output never overwrites the input or an existing file, and never lands in a tracked part of the repository', () => {
    const same = world();
    assert.equal(signApk(options({ out: P('/work/in.apk') }), same.host), 1);
    assert.match(same.logs.join('\n'), /overwrite the input/);
    const existing = world();
    existing.files.set(P('/out/signed.apk'), Buffer.from('old'));
    assert.equal(signApk(options(), existing.host), 1);
    assert.match(existing.logs.join('\n'), /already exists/);
    const tracked = world();
    assert.equal(signApk(options({ out: P('/repo/signed.apk') }), tracked.host), 1);
    assert.match(tracked.logs.join('\n'), /tracked part of a git work tree/);
    const ignored = world({ ignored: true });
    ignored.files.set(P('/repo/.scratch/x'), Buffer.from('x'));
    assert.equal(signApk(options({ out: P('/repo/.scratch/signed.apk') }), ignored.host), 0, ignored.logs.join('\n'));
  });

  it('EVM-009 AC5: a package that is not the artifact of the CI run (digest differs) is refused before anything is signed', () => {
    const { host, runs, logs } = world();
    assert.equal(signApk(options({ expectSha256: '0'.repeat(64) }), host), 1);
    assert.match(logs.join('\n'), /differs from --expect-sha256/);
    assert.ok(!runs.some((run) => run.args[2] === 'sign'));
  });

  it('EVM-009 AC5: a package that is signed already (also with the debug key) is refused', () => {
    const { host, runs, logs } = world({ signedAlready: true });
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /signed already/);
    assert.ok(!runs.some((run) => run.args[2] === 'sign'));
  });

  it('EVM-009 AC6: a package that fails the verification (manifest, rules, contents) is refused before signing', () => {
    const { host, runs, logs } = world({ analyzerFails: [P('/work/in.apk')] });
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /does not pass the verification/);
    assert.ok(logs.some((line) => line.startsWith('sign: APK: apkanalyzer failed')));
    assert.ok(!runs.some((run) => run.args[2] === 'sign'));
  });

  it('EVM-009 AC5: zipalign failing gives exit 1 with a redacted message and no leftovers', () => {
    const { host, logs, files } = world({ zipStatus: 1 });
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /zipalign failed \(exit 1\)/);
    assert.ok(!logs.join('\n').includes(P('/work')), 'absolute paths are cut to file names');
    assert.ok(!files.has(`${P('/out/signed.apk')}.aligned.tmp`));
  });

  it('EVM-009 AC5: apksigner failing (wrong password) gives exit 1, redacts the secrets from its message and leaves no output', () => {
    const { host, logs, files } = world({
      signStatus: 1,
      signStderr: `Failed to load signer: password was incorrect (${STORE_PW}) for ${P('/keys/release.p12')}`,
    });
    assert.equal(signApk(options(), host), 1);
    const text = logs.join('\n');
    assert.match(text, /apksigner sign failed \(exit 1\)/);
    assert.ok(!text.includes(STORE_PW) && !text.includes(P('/keys')));
    assert.ok(text.includes('release.p12'));
    assert.ok(!files.has(P('/out/signed.apk')));
  });

  it('EVM-009 AC5: a failing or incomplete verification of the signature removes the output and fails', () => {
    for (const [config, pattern] of /** @type {const} */ ([
      [{ verifyStatus: 1 }, /apksigner verify failed/],
      [{ report: report({ v2: false }) }, /Scheme v2/],
      [{ report: report({ v3: false }) }, /Scheme v3/],
      [{ report: report({ signers: 2 }) }, /exactly one signer/],
      [{ report: report({ cert: '' }) }, /certificate digest is missing/],
      [{ report: report({ dn: 'C=US, O=Android, CN=Android Debug' }) }, /debug key/],
    ])) {
      const { host, logs, files } = world(config);
      assert.equal(signApk(options(), host), 1, String(pattern));
      assert.match(logs.join('\n'), pattern);
      assert.ok(!files.has(P('/out/signed.apk')), `output removed for ${String(pattern)}`);
      assert.ok(!files.has(`${P('/out/signed.apk')}.aligned.tmp`));
    }
  });

  it('EVM-009 AC5: a certificate that differs from the pinned digest fails and removes the signed package', () => {
    const { host, logs, files } = world({ report: report({ cert: 'cd'.repeat(32) }) });
    assert.equal(signApk(options({ expectedCertSha256: CERT }), host), 1);
    assert.match(logs.join('\n'), /certificate differs from the expected one/);
    assert.ok(!files.has(P('/out/signed.apk')));
  });

  it('EVM-009 AC5: without a pinned digest the result carries a warning to compare it with the runbook', () => {
    const { host, logs } = world();
    assert.equal(signApk(options(), host), 0);
    assert.match(logs.at(-1) ?? '', /^Warning: the certificate is not pinned/);
  });

  it('EVM-009 AC5, AC6: the signed package is verified again and a failure removes it', () => {
    const { host, logs, files } = world();
    const run = host.run;
    let signed = false;
    host.run = (command, args, opts) => {
      if (args[2] === 'sign') signed = true;
      if (signed && args.includes('manifest') && args.includes(P('/out/signed.apk'))) return { status: 1, stdout: '', stderr: '' };
      return run(command, args, opts);
    };
    assert.equal(signApk(options(), host), 1);
    assert.match(logs.join('\n'), /signed package does not pass the verification/);
    assert.ok(!files.has(P('/out/signed.apk')));
  });

  it('EVM-009 AC5: a failure to remove an intermediate file does not hide the result', () => {
    const { host, logs } = world();
    host.remove = () => {
      throw new Error('locked');
    };
    assert.equal(signApk(options(), host), 0, logs.join('\n'));
  });
});

describe('redaction of tool messages (EVM-009 AC5; security-engineer K-A)', () => {
  it('EVM-009 AC5: removes secrets and paths, keeps at most five short lines', () => {
    const text = redact(
      `bad ${STORE_PW} in C:\\Users\\owner\\keys\\release.p12 and /home/owner/keys/other.p12\n${'x\n'.repeat(10)}`,
      [STORE_PW, ''],
      [''],
    );
    assert.ok(!text.includes(STORE_PW) && !text.includes('owner'));
    assert.match(text, /release\.p12/);
    assert.ok(text.split(' | ').length <= 5);
    assert.ok(redact('y'.repeat(1000), [], []).length <= 300);
  });
});
