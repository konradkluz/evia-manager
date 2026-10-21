// @ts-check
/* eslint-disable @typescript-eslint/require-await -- stand-ins of async interfaces (probe, tls, dns, fetch, sleep) */
/**
 * staging-verify offline (EVM-007 AC6; ADR-0018 "Staging"; security-engineer B "staging-verify"): every rule of the
 * checks on synthetic inputs, the waiting for /version on a local server, the ZAP exceptions and the summary. The run
 * against the live staging is part of the IaC session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSED_PORTS, checkPorts, evaluateDns, evaluateHeaders, evaluateTls, probePort, readDns, readTls } from '../lib/checks.mjs';
import { HOST, defaultIo, main } from '../lib/main.mjs';
import { bucketCheck, summarize } from '../lib/summary.mjs';
import { waitForVersion } from '../lib/version.mjs';
import { evaluateZap, parseRules } from '../lib/zap.mjs';

/** @param {string} path @returns {unknown} */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const COMMIT = 'a'.repeat(40);
const MANIFEST = 'b'.repeat(64);
const NOW = new Date('2026-10-21T10:00:00Z');
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";
const GOOD_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': CSP,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
/** @type {import('../lib/checks.mjs').TlsFacts} */
const GOOD_TLS = {
  protocol: 'TLSv1.3',
  authorized: true,
  authorizationError: null,
  issuerOrganization: "Let's Encrypt",
  validTo: 'Jan 10 00:00:00 2027 GMT',
  subjectAltNames: [`DNS:${HOST}`],
};
/** @type {import('../lib/checks.mjs').DnsFacts} */
const GOOD_DNS = {
  a: ['203.0.113.10'],
  aaaa: ['2001:db8::10'],
  caa: [
    { critical: 0, issue: 'letsencrypt.org; accounturi=https://acme-v02.api.letsencrypt.org/acme/acct/1' },
    { critical: 0, issuewild: ';' },
  ],
  spf: ['v=spf1 include:_spf.tem.scaleway.com -all'],
  dmarc: ['v=DMARC1; p=none; rua=mailto:dmarc@staging.eviacharge.pl'],
};

describe('EVM-007 AC6: ports — only 80 and 443 (port 22 closed)', () => {
  it('EVM-007 AC6: a host with only 80 and 443 open passes; 22, 5432 or 2019 open or 443 closed is red', async () => {
    assert.equal((await checkPorts(async (port) => [80, 443].includes(port))).passed, true);
    for (const extra of [22, 5432, 2019]) {
      const result = await checkPorts(async (port) => [80, 443, extra].includes(port));
      assert.equal(result.passed, false);
      assert.match(result.details.join(), new RegExp(`port ${String(extra)} otwarty`));
    }
    assert.equal((await checkPorts(async (port) => port === 80)).passed, false);
    assert.ok(CLOSED_PORTS.includes(22));
  });

  it('EVM-007 AC6: the TCP probe tells an open port from a closed one', async () => {
    const server = createServer();
    await new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      }),
    );
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    assert.equal(await probePort('127.0.0.1', port), true);
    server.close();
    assert.equal(await probePort('127.0.0.1', 1, 500), false);
    assert.equal(await probePort('192.0.2.1', 443, 50), false);
  });
});

describe('EVM-007 AC6: TLS', () => {
  it('EVM-007 AC6: TLS 1.3 from Let’s Encrypt, valid, covering the host and refusing TLS 1.1 passes', () => {
    assert.equal(evaluateTls(GOOD_TLS, HOST, NOW, true).passed, true);
  });

  const bad = /** @type {Array<[string, Partial<import('../lib/checks.mjs').TlsFacts>, boolean]>} */ ([
    ['TLS 1.0', { protocol: 'TLSv1' }, true],
    ['an untrusted chain', { authorized: false, authorizationError: 'SELF_SIGNED' }, true],
    ['another issuer', { issuerOrganization: 'Other CA' }, true],
    ['a certificate expiring in 3 days', { validTo: 'Oct 24 00:00:00 2026 GMT' }, true],
    ['a certificate of another host', { subjectAltNames: ['DNS:other.example'] }, true],
    ['a server accepting TLS 1.1', {}, false],
  ]);
  for (const [name, change, legacyRefused] of bad)
    it(`EVM-007 AC6: ${name} is red`, () => {
      assert.equal(evaluateTls({ ...GOOD_TLS, ...change }, HOST, NOW, legacyRefused).passed, false);
    });

  it('EVM-007 AC6: a TLS connection that fails is reported as an error', async () => {
    await assert.rejects(readTls('127.0.0.1', { port: 1, timeoutMs: 500 }));
  });
});

describe('EVM-007 AC6: headers and the redirect to HTTPS', () => {
  const location = `https://${HOST}/`;
  it('EVM-007 AC6: the headers of the panel with HSTS and a permanent redirect pass', () => {
    assert.equal(evaluateHeaders(new Headers(GOOD_HEADERS), 308, location, HOST).passed, true);
    assert.equal(evaluateHeaders(new Headers({ ...GOOD_HEADERS, server: 'Caddy' }), 301, location, HOST).passed, true);
  });

  const cases = /** @type {Array<[string, Record<string, string>, number]>} */ ([
    ['no HSTS', { 'strict-transport-security': '' }, 308],
    ['a short HSTS', { 'strict-transport-security': 'max-age=60' }, 308],
    ['a CSP with unsafe-inline', { 'content-security-policy': `${CSP}; script-src 'unsafe-inline'` }, 308],
    ['a CSP without frame-ancestors', { 'content-security-policy': "default-src 'none'" }, 308],
    ['no Permissions-Policy', { 'permissions-policy': '' }, 308],
    ['a Server header with a version', { server: 'Caddy/2.11.7' }, 308],
    ['no X-Frame-Options', { 'x-frame-options': '' }, 308],
    ['plain HTTP served without a redirect', {}, 200],
  ]);
  for (const [name, change, status] of cases)
    it(`EVM-007 AC6: ${name} is red`, () => {
      assert.equal(evaluateHeaders(new Headers({ ...GOOD_HEADERS, ...change }), status, location, HOST).passed, false);
    });

  it('EVM-007 AC6: a redirect to another location is red', () => {
    assert.equal(evaluateHeaders(new Headers(GOOD_HEADERS), 301, 'https://evil.example/', HOST).passed, false);
  });
});

describe('EVM-007 AC5, AC6: DNS of the staging node', () => {
  it('EVM-007 AC6: A, AAAA, CAA for Let’s Encrypt only, SPF and DMARC with reports pass', () => {
    assert.equal(evaluateDns(GOOD_DNS).passed, true);
  });

  const cases = /** @type {Array<[string, Partial<import('../lib/checks.mjs').DnsFacts>]>} */ ([
    ['no A record', { a: [] }],
    ['no AAAA record', { aaaa: [] }],
    [
      'a CAA allowing another issuer',
      {
        caa: [
          { critical: 0, issue: 'letsencrypt.org' },
          { critical: 0, issue: 'other-ca.example' },
          { critical: 0, issuewild: ';' },
        ],
      },
    ],
    ['no CAA', { caa: [] }],
    ['wildcard certificates allowed', { caa: [{ critical: 0, issue: 'letsencrypt.org' }] }],
    ['no SPF', { spf: [] }],
    ['an SPF without all', { spf: ['v=spf1 include:x'] }],
    ['no DMARC', { dmarc: [] }],
    ['a DMARC without reports', { dmarc: ['v=DMARC1; p=none'] }],
  ]);
  for (const [name, change] of cases)
    it(`EVM-007 AC6: ${name} is red`, () => {
      assert.equal(evaluateDns({ ...GOOD_DNS, ...change }).passed, false);
    });

  it('EVM-007 AC6: the resolver answers are read, failing queries count as missing records', async () => {
    const resolver = /** @type {import('node:dns').promises.Resolver} */ (
      /** @type {unknown} */ ({
        resolve4: async () => ['203.0.113.10'],
        resolve6: async () => {
          throw new Error('ENODATA');
        },
        resolveCaa: async () => GOOD_DNS.caa,
        resolveTxt: async (/** @type {string} */ name) =>
          name.startsWith('_dmarc.') ? [['v=DMARC1; p=none; ', 'rua=mailto:x@y']] : [['v=spf1 -all'], ['other']],
      })
    );
    const facts = await readDns(resolver, HOST);
    assert.deepEqual(facts.aaaa, []);
    assert.deepEqual(facts.spf, ['v=spf1 -all']);
    assert.deepEqual(facts.dmarc, ['v=DMARC1; p=none; rua=mailto:x@y']);
  });
});

describe('EVM-007 AC6: waiting for /version', () => {
  /** @param {(count: number) => { status: number, body: string }} answer */
  async function server(answer) {
    let count = 0;
    const http = createServer((_request, response) => {
      count += 1;
      const { status, body } = answer(count);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
    await new Promise((resolve) =>
      http.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      }),
    );
    const address = http.address();
    return {
      url: `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/version`,
      close: () => http.close(),
    };
  }
  const fast = { timeoutMs: 1000, intervalMs: 10, sleep: async () => undefined };

  it('EVM-007 AC6: the expected commit and manifest after a 502 and an older version pass', async () => {
    const stub = await server((count) =>
      count === 1
        ? { status: 502, body: '' }
        : count === 2
          ? { status: 200, body: JSON.stringify({ commit: 'c'.repeat(40), manifestSha256: MANIFEST }) }
          : { status: 200, body: JSON.stringify({ commit: COMMIT, manifestSha256: MANIFEST }) },
    );
    const result = await waitForVersion({ url: stub.url, commit: COMMIT, manifestSha256: MANIFEST, ...fast });
    stub.close();
    assert.equal(result.passed, true);
  });

  it('EVM-007 AC6: another version after the waiting time, a body that is not JSON or a bad expectation is red', async () => {
    let clock = 0;
    const stub = await server(() => ({ status: 200, body: JSON.stringify({ commit: COMMIT, manifestSha256: 'd'.repeat(64) }) }));
    const late = await waitForVersion({
      url: stub.url,
      commit: COMMIT,
      manifestSha256: MANIFEST,
      timeoutMs: 100,
      intervalMs: 60,
      sleep: async () => undefined,
      now: () => (clock += 50),
    });
    assert.equal(late.passed, false);
    assert.match(late.details.join(), /po czasie oczekiwania/);
    stub.close();
    const html = await server(() => ({ status: 200, body: '<html>' }));
    assert.equal(
      (await waitForVersion({ url: html.url, commit: COMMIT, manifestSha256: MANIFEST, timeoutMs: 0, intervalMs: 10 })).passed,
      false,
    );
    html.close();
    assert.equal((await waitForVersion({ url: 'http://127.0.0.1:1/', commit: 'main', manifestSha256: MANIFEST, ...fast })).passed, false);
    const real = await waitForVersion({
      url: 'http://127.0.0.1:1/',
      commit: COMMIT,
      manifestSha256: MANIFEST,
      timeoutMs: 20,
      intervalMs: 10,
    });
    assert.equal(real.passed, false);
  });
});

describe('EVM-007 AC6: the anonymous ZAP baseline and its exceptions', () => {
  const report = (/** @type {Array<{ pluginid: string, riskcode: string }>} */ alerts) => ({
    site: [{ alerts: alerts.map((alert) => ({ ...alert, name: 'synthetic', count: '1' })) }],
  });
  const RULES = '# pluginId\texpires\treason\n10038\t2026-12-31\tCSP reported on 404 pages of Caddy (synthetic reason)\n';

  it('EVM-007 AC6: Low and informational alerts and excepted alerts pass', () => {
    assert.equal(
      evaluateZap(
        report([
          { pluginid: '10096', riskcode: '1' },
          { pluginid: '10038', riskcode: '2' },
        ]),
        RULES,
        '2026-10-21',
      ).passed,
      true,
    );
  });

  it('EVM-007 AC6: a High or Medium alert outside the exceptions is red', () => {
    assert.equal(evaluateZap(report([{ pluginid: '40012', riskcode: '3' }]), RULES, '2026-10-21').passed, false);
    assert.equal(evaluateZap(report([{ pluginid: '10020', riskcode: '2' }]), RULES, '2026-10-21').passed, false);
  });

  it('EVM-007 AC6: an expired exception is red and no longer covers its alert', () => {
    const result = evaluateZap(report([{ pluginid: '10038', riskcode: '2' }]), RULES, '2027-01-01');
    assert.equal(result.passed, false);
    assert.match(result.details.join(), /wygasł/);
  });

  it('EVM-007 AC6: an exception without a reason or date, and a report without a site, are red', () => {
    assert.deepEqual(parseRules('10038\t2026-12-31\n').problems.length, 1);
    assert.deepEqual(parseRules('abc\t2026-12-31\ta long enough reason\n').problems.length, 1);
    assert.equal(evaluateZap({}, '', '2026-10-21').passed, false);
    assert.equal(evaluateZap(report([]), '10038\tsoon\tx\n', '2026-10-21').passed, false);
  });

  it('EVM-007 AC6: the exceptions of the repository are valid and not expired', () => {
    const rules = readFileSync(new URL('../../../infra/zap/rules.tsv', import.meta.url), 'utf8');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const parsed = parseRules(rules);
    assert.deepEqual(parsed.problems, []);
    for (const exception of parsed.exceptions) assert.ok(exception.expires >= today, exception.pluginId);
  });
});

describe('EVM-007 AC6: the summary and the steps of the job', () => {
  it('EVM-007 AC6: a skipped check is shown as skipped and never makes the result green on its own', () => {
    assert.equal(
      summarize({ commit: COMMIT, manifestSha256: MANIFEST, checks: [bucketCheck()], checkedAt: NOW.toISOString() }).passed,
      true,
    );
    assert.equal(summarize({ commit: COMMIT, manifestSha256: MANIFEST, checks: [], checkedAt: NOW.toISOString() }).passed, false);
    const red = summarize({
      commit: COMMIT,
      manifestSha256: MANIFEST,
      checks: [bucketCheck(), { id: 'tls', passed: false, details: ['a|b'] }],
      checkedAt: NOW.toISOString(),
    });
    assert.equal(red.passed, false);
    assert.match(red.markdown, /\| bucket-403 \| pominięta \|/);
    assert.match(red.markdown, /a\\\|b/);
  });

  /** @param {Partial<import('../lib/main.mjs').Io>} overrides @returns {import('../lib/main.mjs').Io & { output: string[] }} */
  function io(overrides = {}) {
    const output = /** @type {string[]} */ ([]);
    const outDir = mkdtempSync(join(tmpdir(), 'staging-verify-'));
    return {
      env: { EXPECTED_COMMIT: COMMIT, EXPECTED_MANIFEST_SHA256: MANIFEST },
      outDir,
      host: HOST,
      fetchImpl: async (url) => {
        const target = url instanceof Request ? url.url : url.toString();
        if (target.endsWith('/version')) return new Response(JSON.stringify({ commit: COMMIT, manifestSha256: MANIFEST }));
        if (target.startsWith('http://')) return new Response('', { status: 308, headers: { location: `https://${HOST}/` } });
        return new Response('', { headers: GOOD_HEADERS });
      },
      probe: async (port) => [80, 443].includes(port),
      tls: async (maxVersion) => {
        if (maxVersion === 'TLSv1.1') throw new Error('protocol version');
        return GOOD_TLS;
      },
      dns: async () => GOOD_DNS,
      now: () => new Date(),
      sleep: async () => undefined,
      print: (text) => output.push(text),
      output,
      ...overrides,
    };
  }

  it('EVM-007 AC6: wait, checks and report give a green summary and the staging-verified artifact', async () => {
    const steps = io();
    const summary = join(steps.outDir, 'summary.md');
    const rules = join(steps.outDir, 'rules.tsv');
    const zap = join(steps.outDir, 'zap.json');
    writeFileSync(rules, '');
    writeFileSync(zap, JSON.stringify({ site: [{ alerts: [] }] }));
    steps.env = { ...steps.env, ZAP_REPORT: zap, ZAP_RULES: rules, GITHUB_STEP_SUMMARY: summary };
    assert.equal(await main('wait', steps), 0);
    assert.equal(await main('checks', steps), 0);
    assert.equal(await main('report', steps), 0);
    const artifact = /** @type {{ passed: boolean, checks: Array<{ id: string }> }} */ (
      readJson(join(steps.outDir, 'staging-verified.json'))
    );
    assert.equal(artifact.passed, true);
    assert.deepEqual(
      artifact.checks.map((/** @type {{ id: string }} */ check) => check.id),
      ['version', 'ports', 'tls', 'headers', 'dns', 'bucket-403', 'zap'],
    );
    assert.match(readFileSync(summary, 'utf8'), /zielony/);
  });

  it('EVM-007 AC6: no version step, a missing ZAP report, failed connections or a wrong version give red', async () => {
    const steps = io({
      fetchImpl: async () => {
        throw new Error('offline');
      },
      tls: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(await main('checks', steps), 0);
    assert.equal(await main('report', steps), 1);
    const checks = /** @type {Array<{ id: string, passed: boolean }>} */ (readJson(join(steps.outDir, 'checks.json')));
    assert.equal(checks.find((/** @type {{ id: string }} */ check) => check.id === 'tls')?.passed, false);
    assert.equal(checks.find((/** @type {{ id: string }} */ check) => check.id === 'headers')?.passed, false);
    const wrong = io({ env: { EXPECTED_COMMIT: 'main', EXPECTED_MANIFEST_SHA256: MANIFEST } });
    assert.equal(await main('wait', wrong), 1);
    assert.equal(await main('unknown', wrong), 2);
  });

  it('EVM-007 AC6: the CLI prints the usage without a step, and the default I/O targets the staging host', () => {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli], { encoding: 'utf8', cwd: mkdtempSync(join(tmpdir(), 'staging-verify-cli-')) });
    assert.equal(run.status, 2);
    assert.match(run.stdout, /wait \| checks \| report/);
    const real = defaultIo('x');
    assert.equal(real.host, 'staging.eviacharge.pl');
    assert.equal(typeof execFileSync, 'function');
  });
});
