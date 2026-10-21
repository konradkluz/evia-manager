// @ts-check
/**
 * The checks of bramka 10 on staging (EVM-007 AC6; ADR-0018 "Staging"; security-engineer B "staging-verify"). Each check
 * returns { id, passed, details }; evaluation is separated from the network access, so every rule is tested offline.
 * No secret is used anywhere: everything runs anonymously from the runner.
 */
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/** @typedef {{ id: string, passed: boolean, skipped?: boolean, details: string[] }} Check */

/** Ports that must be closed from the internet (port 22 included: SSH only from the administrator, AC6). */
export const CLOSED_PORTS = Object.freeze([
  21, 22, 23, 25, 53, 110, 143, 445, 2019, 2375, 2376, 3000, 3306, 5432, 6379, 8080, 8443, 9000, 9090, 9100, 11211, 27017,
]);
export const OPEN_PORTS = Object.freeze([80, 443]);

/** @param {string} host @param {number} port @param {number} timeoutMs @returns {Promise<boolean>} true = open */
export function probePort(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host, port, timeout: timeoutMs });
    const done = (/** @type {boolean} */ open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => {
      done(true);
    });
    socket.once('timeout', () => {
      done(false);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}

/**
 * Only 80 and 443 answer; any other port of the list open = red (no new tool: plain TCP connects, bramka 10).
 * @param {(port: number) => Promise<boolean>} probe
 * @returns {Promise<Check>}
 */
export async function checkPorts(probe, closed = CLOSED_PORTS, open = OPEN_PORTS) {
  const details = [];
  for (const port of open) if (!(await probe(port))) details.push(`port ${String(port)} zamknięty (oczekiwany otwarty)`);
  for (const port of closed) if (await probe(port)) details.push(`port ${String(port)} otwarty (oczekiwany zamknięty)`);
  return { id: 'ports', passed: details.length === 0, details: details.length === 0 ? ['tylko 80 i 443 otwarte'] : details };
}

/**
 * @typedef {{ protocol: string | null, authorized: boolean, authorizationError: string | null, issuerOrganization: string,
 *   validTo: string, subjectAltNames: string[] }} TlsFacts
 */

/** @param {TlsFacts} facts @param {string} host @param {Date} now @param {boolean} legacyRefused @returns {Check} */
export function evaluateTls(facts, host, now, legacyRefused) {
  const details = [];
  if (!['TLSv1.2', 'TLSv1.3'].includes(facts.protocol ?? '')) details.push(`protokół ${String(facts.protocol)} (wymagany TLS 1.2+)`);
  if (!facts.authorized) details.push(`certyfikat niezaufany (${String(facts.authorizationError)})`);
  if (facts.issuerOrganization !== "Let's Encrypt") details.push(`wystawca spoza listy: ${facts.issuerOrganization || '?'}`);
  const expires = Date.parse(facts.validTo);
  if (Number.isNaN(expires) || expires - now.getTime() < 7 * 86_400_000) details.push('certyfikat wygasa za mniej niż 7 dni');
  if (!facts.subjectAltNames.includes(`DNS:${host}`)) details.push('certyfikat nie obejmuje hosta');
  if (!legacyRefused) details.push('serwer przyjmuje TLS 1.1');
  return {
    id: 'tls',
    passed: details.length === 0,
    details: details.length === 0 ? [`${String(facts.protocol)}, Let's Encrypt, ważny`] : details,
  };
}

/** @param {string} host @param {{ maxVersion?: import('node:tls').SecureVersion, port?: number, timeoutMs?: number, ca?: string }} options @returns {Promise<TlsFacts>} */
export function readTls(host, { maxVersion, port = 443, timeoutMs = 5000, ca } = {}) {
  return new Promise((resolve, reject) => {
    // reason: inspection only — no data is sent; evaluateTls fails on socket.authorized === false, so an untrusted certificate is a red check, never accepted · owner: devops-engineer · review_by: 2027-01-15
    // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification — verification happens in evaluateTls (EVM-007 AC6)
    const socket = tlsConnect({
      host,
      port,
      servername: host,
      timeout: timeoutMs,
      rejectUnauthorized: false,
      ...(maxVersion ? { maxVersion } : {}),
      ...(ca ? { ca } : {}),
    });
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      resolve({
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorizationError: socket.authorized ? null : String(socket.authorizationError),
        issuerOrganization: [certificate.issuer.O].flat().join(' '),
        validTo: certificate.valid_to,
        subjectAltNames: (certificate.subjectaltname ?? '').split(', ').filter(Boolean),
      });
      socket.end();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.once('error', reject);
  });
}

/** The headers of the panel (apps/web/security-headers.ts, strict + https) and of the edge (HSTS, no Server version). */
export const REQUIRED_HEADERS = Object.freeze({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
});

/** @param {Headers} headers @param {number} redirectStatus status of http:// @param {string | null} location @param {string} host @returns {Check} */
export function evaluateHeaders(headers, redirectStatus, location, host) {
  const details = [];
  for (const [name, value] of Object.entries(REQUIRED_HEADERS))
    if (headers.get(name) !== value) details.push(`${name}: ${String(headers.get(name))} (oczekiwane ${value})`);
  const csp = headers.get('content-security-policy') ?? '';
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ])
    if (
      !csp
        .split(';')
        .map((part) => part.trim())
        .includes(directive)
    )
      details.push(`CSP bez ${directive}`);
  if (/unsafe-(inline|eval)/.test(csp)) details.push('CSP z unsafe-inline/unsafe-eval');
  if (!(headers.get('permissions-policy') ?? '').includes('camera=()')) details.push('Permissions-Policy');
  const server = headers.get('server');
  if (server !== null && /\d/.test(server)) details.push(`nagłówek Server z wersją: ${server}`);
  if (![301, 308].includes(redirectStatus) || location !== `https://${host}/`)
    details.push(`http:// nie przekierowuje na https (status ${String(redirectStatus)})`);
  return {
    id: 'headers',
    passed: details.length === 0,
    details: details.length === 0 ? ['nagłówki bezpieczeństwa i przekierowanie na HTTPS'] : details,
  };
}

/**
 * @typedef {{ a: string[], aaaa: string[], caa: Array<{ critical: number, issue?: string, issuewild?: string, iodef?: string }>,
 *   spf: string[], dmarc: string[] }} DnsFacts
 */

/** CAA of the node: exactly `0 issue "letsencrypt.org"` (optionally with accounturi) and `0 issuewild ";"`; SPF and DMARC present. @param {DnsFacts} facts @returns {Check} */
export function evaluateDns(facts) {
  const details = [];
  if (facts.a.length === 0) details.push('brak rekordu A');
  if (facts.aaaa.length === 0) details.push('brak rekordu AAAA');
  const issue = facts.caa.filter((record) => record.issue !== undefined).map((record) => String(record.issue).split(';')[0]?.trim());
  const wild = facts.caa.filter((record) => record.issuewild !== undefined).map((record) => String(record.issuewild).trim());
  if (JSON.stringify(issue) !== JSON.stringify(['letsencrypt.org']))
    details.push(`CAA issue: ${issue.join(', ') || 'brak'} (oczekiwane letsencrypt.org)`);
  if (JSON.stringify(wild) !== JSON.stringify([';'])) details.push('CAA issuewild ";" (zakaz certyfikatów wildcard)');
  if (!facts.spf.some((record) => record.startsWith('v=spf1 ') && / -all$| ~all$/.test(record))) details.push('brak SPF dla staging');
  if (!facts.dmarc.some((record) => /^v=DMARC1;\s*p=(none|quarantine|reject)\b/.test(record) && record.includes('rua=')))
    details.push('brak _dmarc z raportami (rua)');
  return { id: 'dns', passed: details.length === 0, details: details.length === 0 ? ['A, AAAA, CAA, SPF, DMARC'] : details };
}

/** @param {import('node:dns').promises.Resolver} resolver @param {string} host @returns {Promise<DnsFacts>} */
export async function readDns(resolver, host) {
  const safe = async (/** @type {() => Promise<unknown>} */ query) => {
    try {
      return await query();
    } catch {
      return [];
    }
  };
  const flat = (/** @type {unknown} */ txt) => /** @type {string[][]} */ (txt).map((parts) => parts.join(''));
  return {
    a: /** @type {string[]} */ (await safe(() => resolver.resolve4(host))),
    aaaa: /** @type {string[]} */ (await safe(() => resolver.resolve6(host))),
    caa: /** @type {DnsFacts['caa']} */ (await safe(() => resolver.resolveCaa(host))),
    spf: flat(await safe(() => resolver.resolveTxt(host))).filter((record) => record.startsWith('v=spf1')),
    dmarc: flat(await safe(() => resolver.resolveTxt(`_dmarc.${host}`))),
  };
}
