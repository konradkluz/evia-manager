// @ts-check
/**
 * Local signing of the Android package (EVM-009 AC5; decision of Konrad 2026-10-20, RR-21, ADR-0019): the owner signs the
 * UNSIGNED artifact of the CI job `mobile-apk` on his own machine. CI holds no key and no secret.
 *
 * Rules (security-engineer K-A, solution-architect 1-3):
 * - no shell: `java -jar <build-tools>/lib/apksigner.jar` and `zipalign` with an array of arguments (CWE-78, "BatBadBut");
 * - passwords never pass through this script: only `--ks-pass env:NAME` / `--key-pass env:NAME` reach apksigner, or — when the
 *   variable is absent — apksigner prompts on the inherited terminal; `pass:` / `file:` and a password in argv are refused;
 * - the keystore (resolved through realpath: subst, junction, symlink) is never inside a git work tree, is never copied and its
 *   path is never printed; the output of the tools is never forwarded, only an exit code and a redacted message;
 * - the input is bound to CI by `--expect-sha256` (digest from the summary of the run on main), is verified (manifest, backup
 *   and network rules, contents) before signing and must not be signed already;
 * - after signing: schemes v2 and v3, one signer, not the debug key, optional pinned certificate digest, `verify` again.
 */
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { sha256 } from './digest.mjs';
import { verifyApk } from './verify.mjs';

export const SIGN_USAGE =
  'Usage: node tools/mobile-apk/cli.mjs sign --apk <unsigned.apk> --expect-sha256 <digest from the CI summary> --keystore <file outside the repository> --key-alias <alias> --out <signed.apk> [--expected-cert-sha256 <digest>] [--ks-pass-env <NAME>] [--key-pass-env <NAME>] [--build-tools <version>]';

const HEX_64 = /^[0-9a-f]{64}$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FORBIDDEN_PASSWORD_FORMS = /^(?:pass|file|stdin|env):/i;
const FORBIDDEN_OPTIONS = ['--ks-pass', '--key-pass', '--pass', '--password', '--ks-password', '--key-password'];
export const DEFAULT_KS_PASS_ENV = 'EVIA_APK_KS_PASS';
export const DEFAULT_KEY_PASS_ENV = 'EVIA_APK_KEY_PASS';

/**
 * @typedef {{
 *   env: NodeJS.ProcessEnv,
 *   platform: string,
 *   cwd: () => string,
 *   readFile: (path: string) => Uint8Array,
 *   exists: (path: string) => boolean,
 *   realpath: (path: string) => string,
 *   listDir: (path: string) => string[],
 *   remove: (path: string) => void,
 *   run: (command: string, args: string[], options?: { binary?: boolean, quiet?: boolean, interactive?: boolean }) => import('./verify.mjs').Outcome & { stderr?: string },
 *   log: (line: string) => void,
 * }} SignHost
 */

/**
 * @typedef {{
 *   apk: string, expectSha256: string, keystore: string, keyAlias: string, out: string, expectedCertSha256: string,
 *   ksPassEnv: string, keyPassEnv: string, buildTools: string,
 * }} SignOptions
 */

/**
 * @param {string[]} argv arguments after `sign`
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ options: SignOptions } | { error: string }}
 */
export function parseSignArguments(argv, env) {
  /** @type {Record<string, string>} */
  const values = {};
  const known = [
    '--apk',
    '--expect-sha256',
    '--keystore',
    '--key-alias',
    '--out',
    '--expected-cert-sha256',
    '--ks-pass-env',
    '--key-pass-env',
    '--build-tools',
  ];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    if (FORBIDDEN_OPTIONS.includes(name))
      return { error: 'passwords are never passed as arguments: use the environment variables (docs/ops/dystrybucja-apk-android.md)' };
    const value = argv[index + 1];
    if (!known.includes(name) || value === undefined || value === '' || value.startsWith('--')) return { error: SIGN_USAGE };
    values[name] = value;
  }
  const ksPassEnv = values['--ks-pass-env'] ?? DEFAULT_KS_PASS_ENV;
  const keyPassEnv = values['--key-pass-env'] ?? DEFAULT_KEY_PASS_ENV;
  for (const name of [ksPassEnv, keyPassEnv]) {
    if (FORBIDDEN_PASSWORD_FORMS.test(name))
      return { error: 'pass:, file:, stdin: and env: forms are refused: give only the NAME of the environment variable' };
    if (!ENV_NAME.test(name)) return { error: 'the name of a password variable must be an identifier (letters, digits, underscore)' };
  }
  // a value of a password variable that appears among the arguments means a password typed on the command line
  for (const name of [ksPassEnv, keyPassEnv]) {
    const secret = env[name];
    if (secret !== undefined && secret !== '' && argv.includes(secret)) return { error: 'a password must not appear among the arguments' };
  }
  const apk = values['--apk'] ?? '';
  const expectSha256 = (values['--expect-sha256'] ?? '').toLowerCase();
  const keystore = values['--keystore'] ?? env['EVIA_APK_KEYSTORE'] ?? '';
  const keyAlias = values['--key-alias'] ?? env['EVIA_APK_KEY_ALIAS'] ?? '';
  const out = values['--out'] ?? '';
  const expectedCertSha256 = (values['--expected-cert-sha256'] ?? env['EVIA_APK_CERT_SHA256'] ?? '').toLowerCase().replaceAll(':', '');
  const buildTools = values['--build-tools'] ?? '';
  if (apk === '' || keystore === '' || keyAlias === '' || out === '') return { error: SIGN_USAGE };
  if (!HEX_64.test(expectSha256))
    return { error: '--expect-sha256 must be the 64 hex characters of the SHA-256 from the summary of the CI run' };
  if (expectedCertSha256 !== '' && !HEX_64.test(expectedCertSha256)) return { error: '--expected-cert-sha256 must be 64 hex characters' };
  if (buildTools !== '' && !VERSION.test(buildTools)) return { error: '--build-tools must be a version such as 36.0.0' };
  return { options: { apk, expectSha256, keystore, keyAlias, out, expectedCertSha256, ksPassEnv, keyPassEnv, buildTools } };
}

/** @param {string} a @param {string} b */
function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The highest build-tools version of the SDK (as in CI) or the explicit one.
 * @param {SignHost} host @param {string} sdk @param {string} wanted
 * @returns {string | null}
 */
function buildToolsDirectory(host, sdk, wanted) {
  const root = join(sdk, 'build-tools');
  if (wanted !== '') return host.exists(join(root, wanted)) ? join(root, wanted) : null;
  const versions = host.listDir(root).filter((name) => VERSION.test(name));
  versions.sort(compareVersions);
  const highest = versions.at(-1);
  return highest === undefined ? null : join(root, highest);
}

/** @param {string} path @param {string} platform */
const normalized = (path, platform) => (platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));

/** @param {string} child @param {string} parent @param {string} platform */
function isInside(child, parent, platform) {
  const path = relative(normalized(parent, platform), normalized(child, platform));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * Removes secrets and absolute paths from a message of an external tool before it is shown.
 * @param {string} text @param {string[]} secrets @param {string[]} paths
 */
export function redact(text, secrets, paths) {
  let result = text;
  for (const secret of secrets) if (secret !== '') result = result.split(secret).join('***');
  for (const path of paths) if (path !== '') result = result.split(path).join(basename(path));
  result = result.replace(/[A-Za-z]:[\\/][^\s"']+|\/(?:[\w.-]+\/)+[\w.-]+/g, (match) => basename(match.replaceAll('\\', '/')));
  return result.trim().split(/\r?\n/).slice(0, 5).join(' | ').slice(0, 300);
}

/**
 * @param {SignOptions} options
 * @param {SignHost} host
 * @returns {number} 0 ok, 1 refused or failed
 */
export function signApk(options, host) {
  const { platform } = host;
  /** @type {string[]} */
  const secrets = [options.ksPassEnv, options.keyPassEnv].map((name) => host.env[name] ?? '').filter((value) => value !== '');
  /** @type {string[]} */
  const cleanup = [];
  const fail = (/** @type {string} */ message) => {
    host.log(`sign: ${message}`);
    return 1;
  };

  const sdk = host.env['ANDROID_HOME'] ?? host.env['ANDROID_SDK_ROOT'] ?? '';
  if (sdk === '') return fail('ANDROID_HOME is not set');
  const tools = buildToolsDirectory(host, sdk, options.buildTools);
  const javaHome = host.env['JAVA_HOME'];
  const java = javaHome === undefined ? 'java' : join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java');
  const zipalign = tools === null ? '' : join(tools, platform === 'win32' ? 'zipalign.exe' : 'zipalign');
  const apksignerJar = tools === null ? '' : join(tools, 'lib', 'apksigner.jar');
  if (tools === null || !host.exists(zipalign) || !host.exists(apksignerJar)) {
    return fail('zipalign or apksigner.jar not found in the build-tools of ANDROID_HOME (install build-tools with sdkmanager)');
  }

  // the keystore: outside every git work tree, judged by the real path (subst, junction, symlink)
  if (!host.exists(options.keystore)) return fail('the keystore file does not exist');
  const keystore = host.realpath(options.keystore);
  if (!host.exists(options.apk)) return fail('the package does not exist');
  const apk = host.realpath(options.apk);
  const keystoreRepo = host.run('git', ['-C', dirname(keystore), 'rev-parse', '--show-toplevel'], { quiet: true });
  if (keystoreRepo.status === null || (keystoreRepo.status !== 0 && keystoreRepo.status !== 128)) {
    return fail('git is needed to prove that the keystore is outside the repository');
  }
  const cwdRepo = host.run('git', ['-C', host.cwd(), 'rev-parse', '--show-toplevel'], { quiet: true });
  const repoRoot = cwdRepo.status === 0 ? host.realpath(cwdRepo.stdout.trim()) : '';
  if (keystoreRepo.status === 0 || (repoRoot !== '' && isInside(keystore, repoRoot, platform))) {
    return fail(`refused: ${basename(keystore)} is inside a git work tree; keep the key outside the repository, also outside .scratch`);
  }

  // the output: never the input, and inside a work tree only on an ignored path
  const outDirectory = resolve(dirname(options.out));
  if (!host.exists(outDirectory)) return fail('the folder of --out does not exist');
  const out = join(host.realpath(outDirectory), basename(options.out));
  if (normalized(out, platform) === normalized(apk, platform)) return fail('refused: the output would overwrite the input package');
  const outRepo = host.run('git', ['-C', dirname(out), 'rev-parse', '--show-toplevel'], { quiet: true });
  if (outRepo.status === 0) {
    const ignored = host.run('git', ['-C', dirname(out), 'check-ignore', '-q', '--', out], { quiet: true });
    if (ignored.status !== 0)
      return fail(
        'refused: the output is a tracked part of a git work tree; write the signed package outside it or into an ignored folder',
      );
  } else if (outRepo.status !== 128) {
    return fail('git is needed to check the place of the output');
  }
  if (host.exists(out)) return fail(`refused: ${basename(out)} already exists`);

  // the input: bound to CI by its digest, never signed before, verified like in CI
  const digest = sha256(host.readFile(apk));
  if (digest !== options.expectSha256)
    return fail('the SHA-256 of the package differs from --expect-sha256 (the artifact of another run or a changed file)');
  const cmdlineTools = join(sdk, 'cmdline-tools', 'latest');
  const alreadySigned = host.run(java, ['-jar', apksignerJar, 'verify', apk], { quiet: true });
  if (alreadySigned.status === 0) return fail('refused: the package is signed already (a debug or foreign signature)');
  const inputCheck = verifyApk({ apk, applicationId: 'pl.eviacharge.manager', java, cmdlineTools }, host);
  if (inputCheck.problems.length > 0) {
    for (const problem of inputCheck.problems) host.log(`sign: APK: ${problem}`);
    return fail('refused: the package does not pass the verification');
  }

  const aligned = `${out}.aligned.tmp`;
  cleanup.push(aligned);
  try {
    const align = host.run(zipalign, ['-P', '16', '-f', '4', apk, aligned], { quiet: true });
    if (align.status !== 0)
      return fail(
        `zipalign failed (exit ${String(align.status)}): ${redact(`${align.stdout}\n${align.stderr ?? ''}`, secrets, [keystore, apk, out])}`,
      );

    const ksPass = (host.env[options.ksPassEnv] ?? '') !== '';
    const keyPass = (host.env[options.keyPassEnv] ?? '') !== '';
    const args = [
      '-jar',
      apksignerJar,
      'sign',
      '--ks',
      keystore,
      '--ks-key-alias',
      options.keyAlias,
      ...(ksPass ? ['--ks-pass', `env:${options.ksPassEnv}`] : []),
      ...(keyPass ? ['--key-pass', `env:${options.keyPassEnv}`] : []),
      '--v2-signing-enabled',
      'true',
      '--v3-signing-enabled',
      'true',
      '--out',
      out,
      aligned,
    ];
    // a missing password variable means the prompt of apksigner itself: the terminal is inherited and nothing is captured
    const signed = host.run(java, args, ksPass ? { quiet: true } : { interactive: true });
    if (signed.status !== 0) {
      cleanup.push(out);
      return fail(
        `apksigner sign failed (exit ${String(signed.status)}): ${redact(`${signed.stdout}\n${signed.stderr ?? ''}`, secrets, [keystore, apk, out])}`,
      );
    }
    cleanup.push(out);

    const report = host.run(java, ['-jar', apksignerJar, 'verify', '--verbose', '--print-certs', out], { quiet: true });
    if (report.status !== 0)
      return fail(
        `apksigner verify failed (exit ${String(report.status)}): ${redact(`${report.stdout}\n${report.stderr ?? ''}`, secrets, [keystore, apk, out])}`,
      );
    const certificate = /Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/i.exec(report.stdout)?.[1]?.toLowerCase() ?? '';
    if (!/Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(report.stdout))
      return fail('the signature is not verified with APK Signature Scheme v2');
    if (!/Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(report.stdout))
      return fail('the signature is not verified with APK Signature Scheme v3');
    if (!/Number of signers: 1\b/.test(report.stdout)) return fail('the package must have exactly one signer');
    if (certificate === '') return fail('the certificate digest is missing in the output of apksigner');
    if (/certificate DN:.*Android Debug/i.test(report.stdout)) return fail('the package is signed with the debug key');
    if (options.expectedCertSha256 !== '' && certificate !== options.expectedCertSha256) {
      return fail(
        'the SHA-256 of the certificate differs from the expected one: wrong key or alias (an update would not install on phones)',
      );
    }

    const finalCheck = verifyApk({ apk: out, applicationId: 'pl.eviacharge.manager', java, cmdlineTools }, host);
    if (finalCheck.problems.length > 0) {
      for (const problem of finalCheck.problems) host.log(`sign: APK: ${problem}`);
      return fail('the signed package does not pass the verification');
    }
    cleanup.pop();
    host.log(`Signed: ${out}`);
    host.log(`SHA-256 file: ${sha256(host.readFile(out))}`);
    host.log(`SHA-256 certificate: ${certificate}`);
    if (options.expectedCertSha256 === '')
      host.log(
        'Warning: the certificate is not pinned (--expected-cert-sha256 or EVIA_APK_CERT_SHA256); compare the digest above with the runbook.',
      );
    return 0;
  } finally {
    for (const path of cleanup) {
      try {
        if (host.exists(path)) host.remove(path);
      } catch {
        // best effort: the file name is reported by the failure message above
      }
    }
  }
}
