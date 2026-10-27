// @ts-check
/**
 * The steps of the staging-verify job (EVM-007 AC6): `wait` (GET /version = commit + manifest), `checks` (ports, TLS,
 * headers, DNS), then the ZAP baseline runs as a compose service, then `report` (ZAP evaluation, the summary, the
 * `staging-verified` artifact; exit code 1 when anything is red). Results of the steps are kept as JSON in OUT_DIR.
 */
import { promises as dns } from 'node:dns';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPorts, evaluateDns, evaluateHeaders, evaluateTls, probePort, readDns, readTls } from './checks.mjs';
import { bucketCheck, label, summarize } from './summary.mjs';
import { waitForVersion } from './version.mjs';
import { evaluateZap } from './zap.mjs';

export const HOST = 'staging.eviacharge.pl';

/**
 * @typedef {object} Io
 * @property {Record<string, string | undefined>} env
 * @property {string} outDir
 * @property {string} host
 * @property {typeof fetch} fetchImpl
 * @property {(port: number) => Promise<boolean>} probe
 * @property {(maxVersion?: import('node:tls').SecureVersion) => Promise<import('./checks.mjs').TlsFacts>} tls
 * @property {() => Promise<import('./checks.mjs').DnsFacts>} dns
 * @property {() => Date} now
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(text: string) => void} print
 */

/** @param {string} outDir @returns {Io} */
export function defaultIo(outDir) {
  const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
  return {
    env: process.env,
    outDir,
    host: HOST,
    fetchImpl: fetch,
    probe: (port) => probePort(HOST, port),
    tls: (maxVersion) => readTls(HOST, maxVersion ? { maxVersion } : {}),
    dns: () => readDns(resolver, HOST),
    now: () => new Date(),
    print: (text) => process.stdout.write(text),
  };
}

/** @param {Io} io @param {string} name @param {unknown} value */
const save = (io, name, value) => {
  mkdirSync(io.outDir, { recursive: true });
  writeFileSync(join(io.outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};
/** @param {Io} io @param {string} name @returns {import('./checks.mjs').Check[]} */
const load = (io, name) =>
  existsSync(join(io.outDir, name))
    ? /** @type {import('./checks.mjs').Check[]} */ (JSON.parse(readFileSync(join(io.outDir, name), 'utf8')))
    : [];

/** @param {Io} io */
async function headersCheck(io) {
  try {
    const page = await io.fetchImpl(`https://${io.host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const plain = await io.fetchImpl(`http://${io.host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    return evaluateHeaders(page.headers, plain.status, plain.headers.get('location'), io.host);
  } catch {
    return { id: 'headers', passed: false, details: ['brak połączenia HTTPS/HTTP'] };
  }
}

/** @param {Io} io */
async function tlsCheck(io) {
  try {
    const facts = await io.tls();
    const legacyRefused = await io.tls('TLSv1.1').then(
      () => false,
      () => true,
    );
    return evaluateTls(facts, io.host, io.now(), legacyRefused);
  } catch {
    return { id: 'tls', passed: false, details: ['brak połączenia TLS'] };
  }
}

/** @param {string} command @param {Io} io @returns {Promise<number>} exit code */
export async function main(command, io) {
  const commit = io.env['EXPECTED_COMMIT'] ?? '';
  const manifestSha256 = io.env['EXPECTED_MANIFEST_SHA256'] ?? '';
  if (command === 'wait') {
    const check = await waitForVersion({
      url: `https://${io.host}/version`,
      commit,
      manifestSha256,
      timeoutMs: 8 * 60_000,
      intervalMs: 15_000,
      fetchImpl: io.fetchImpl,
      ...(io.sleep ? { sleep: io.sleep } : {}),
      now: () => io.now().getTime(),
    });
    save(io, 'version.json', [check]);
    io.print(`${check.id}: ${check.passed ? 'OK' : 'BŁĄD'} — ${check.details.join('; ')}\n`);
    return check.passed ? 0 : 1;
  }
  if (command === 'checks') {
    // VERIFY_PROFILE: unset = strict (production-grade); only the staging job sets "staging"; an unknown value is red.
    const checks = [
      await checkPorts(io.probe),
      await tlsCheck(io),
      await headersCheck(io),
      evaluateDns(await io.dns(), io.env['VERIFY_PROFILE'] ?? 'strict'),
      bucketCheck(),
    ];
    save(io, 'checks.json', checks);
    for (const check of checks) io.print(`${check.id}: ${label(check)} — ${check.details.join('; ')}\n`);
    return 0;
  }
  if (command === 'report') {
    const reportPath = io.env['ZAP_REPORT'] ?? '';
    const rulesPath = io.env['ZAP_RULES'] ?? '';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(io.now());
    let zap;
    try {
      zap = evaluateZap(JSON.parse(readFileSync(reportPath, 'utf8')), readFileSync(rulesPath, 'utf8'), today);
    } catch {
      zap = { id: 'zap', passed: false, details: ['brak raportu ZAP albo pliku wyjątków'] };
    }
    const checks = [...load(io, 'version.json'), ...load(io, 'checks.json'), zap];
    const result = summarize({ commit, manifestSha256, checks, checkedAt: io.now().toISOString() });
    if (!checks.some((check) => check.id === 'version')) result.passed = false;
    save(io, 'staging-verified.json', { ...result.json, passed: result.passed });
    const summary = io.env['GITHUB_STEP_SUMMARY'];
    if (summary) writeFileSync(summary, result.markdown, { flag: 'a' });
    io.print(result.markdown);
    return result.passed ? 0 : 1;
  }
  io.print('użycie: node tools/staging-verify/cli.mjs wait | checks | report\n');
  return 2;
}
