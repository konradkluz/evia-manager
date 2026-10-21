// @ts-check
/**
 * Dispatch of `node tools/mobile-apk/cli.mjs verify|digest --apk <file> [--application-id <id>] [--signed]` and of `sign` (local
 * signing, src/sign.mjs) (EVM-009 AC5, AC6). Exit codes: 0 ok, 1 findings, a refusal or a failed read, 2 usage.
 */
import { basename, join } from 'node:path';
import { digestSummary, sha256 } from './digest.mjs';
import { parseSignArguments, signApk } from './sign.mjs';
import { verifyApk } from './verify.mjs';

export const USAGE =
  'Usage: node tools/mobile-apk/cli.mjs verify|digest --apk <file> [--application-id <id>] [--signed] | sign --apk <file> --expect-sha256 <digest> --keystore <file> --key-alias <alias> --out <file>';
const APPLICATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i;

/**
 * @typedef {import('./sign.mjs').SignHost & { appendFile: (path: string, text: string) => void }} Host
 */

/**
 * @param {string[]} argv
 * @returns {{ command: 'verify' | 'digest', apk: string, applicationId: string, signed: boolean } | null}
 */
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== 'verify' && command !== 'digest') return null;
  let apk = '';
  let applicationId = 'pl.eviacharge.manager';
  let signed = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--signed') {
      signed = true;
    } else if (argument === '--apk' || argument === '--application-id') {
      const value = rest[index + 1];
      index += 1;
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      if (argument === '--apk') apk = value;
      else applicationId = value;
    } else {
      return null;
    }
  }
  return apk === '' || !APPLICATION_ID.test(applicationId) ? null : { command, apk, applicationId, signed };
}

/**
 * @param {string[]} argv
 * @param {Host} host
 * @returns {number}
 */
export function main(argv, host) {
  if (argv[0] === 'sign') {
    const parsed = parseSignArguments(argv.slice(1), host.env);
    if ('error' in parsed) {
      host.log(parsed.error);
      return 2;
    }
    return signApk(parsed.options, host);
  }
  const options = parseArguments(argv);
  if (options === null) {
    host.log(USAGE);
    return 2;
  }
  if (options.command === 'verify') {
    const sdk = host.env['ANDROID_HOME'] ?? host.env['ANDROID_SDK_ROOT'] ?? '';
    const javaHome = host.env['JAVA_HOME'];
    const java = javaHome === undefined ? 'java' : join(javaHome, 'bin', host.platform === 'win32' ? 'java.exe' : 'java');
    if (sdk === '') {
      host.log('ANDROID_HOME is not set');
      return 1;
    }
    const result = verifyApk(
      { apk: options.apk, applicationId: options.applicationId, java, cmdlineTools: join(sdk, 'cmdline-tools', 'latest') },
      host,
    );
    for (const problem of result.problems) host.log(`APK: ${problem}`);
    if (result.problems.length > 0) return 1;
    host.log(`APK verified: ${result.notes.join('; ')}`);
  }
  const digest = sha256(host.readFile(options.apk));
  host.log(`SHA-256 ${digest}  ${basename(options.apk)}`);
  const summaryFile = host.env['GITHUB_STEP_SUMMARY'];
  if (options.command === 'digest' && summaryFile !== undefined && summaryFile !== '') {
    host.appendFile(
      summaryFile,
      digestSummary({ name: basename(options.apk), sha256: digest, signed: options.signed, notes: runNotes(host.env) }),
    );
  }
  return 0;
}

/**
 * The branch and the commit of the CI run (public data): the owner compares them with the run on main before signing.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function runNotes(env) {
  const clean = (/** @type {string | undefined} */ value) => (value ?? '').replace(/[^\w./@+-]/g, '').slice(0, 200);
  const branch = clean(env['GITHUB_REF_NAME']);
  const commit = clean(env['GITHUB_SHA']);
  return [...(branch === '' ? [] : [`Gałąź: \`${branch}\``]), ...(commit === '' ? [] : [`Commit: \`${commit}\``])];
}
