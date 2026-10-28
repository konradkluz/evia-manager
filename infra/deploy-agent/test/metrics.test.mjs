// @ts-check
/**
 * metrics.sh in a Linux container with a stand-in for curl on PATH (EVM-085 AC2; security-engineer A10, RR-24). Run:
 * docker compose -f compose.yaml run --rm deploy-sh-tests. Not run natively on Windows (bash, GNU coreutils and jq).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../metrics.sh', import.meta.url).pathname;
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const PAT = 'ghp_SyntheticSyntheticSynthetic1234';
const NOW = Math.floor(Date.parse('2026-10-28T12:00:00Z') / 1000);

const FAKE_CURL = `#!/bin/bash
printf 'curl %s\\n' "$*" >> "$FAKE_LOG"
cat > "$FAKE_LOG.stdin"
[ "\${FAKE_CURL_EXIT:-0}" = 0 ] || exit "$FAKE_CURL_EXIT"
printf 'HTTP/2 200\\r\\nx-ratelimit-limit: 5000\\r\\nx-ratelimit-remaining: %s\\r\\ngithub-authentication-token-expiration: 2026-11-10 04:00:00 UTC\\r\\n\\r\\n' "\${FAKE_REMAINING:-4321}"
`;
// date -d: the script runs with the real clock; the fake date makes it deterministic.
const FAKE_DATE = `#!/bin/bash
if [ "$1" = "-u" ] && [ "$2" = "+%s" ]; then echo ${String(NOW)}; exit 0; fi
if [ "$1" = "-u" ] && [[ "$2" == +%Y* ]]; then echo 2026-10-28T12:00:00Z; exit 0; fi
exec /usr/bin/date "$@"
`;

/** @type {string} */ let root;
/** @type {string} */ let bin;
/** @type {string} */ let log;

const write = (/** @type {string} */ path, /** @type {string} */ text) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

function fixture(
  /** @type {{ lastSuccess?: string | null, decision?: string, head?: string | null, reasons?: string[], deployed?: string, tokens?: unknown }} */ o = {},
) {
  write(
    join(root, 'var/lib/evia/agent/state/state.json'),
    JSON.stringify({
      lastRun: '2026-10-28T11:59:00Z',
      lastSuccess: o.lastSuccess ?? '2026-10-28T11:59:00Z',
      notBefore: null,
      lastDecision: 'none',
    }),
  );
  write(
    join(root, 'var/lib/evia/agent/out/result.json'),
    JSON.stringify({
      schemaVersion: 1,
      decision: o.decision ?? 'none',
      head: o.head === undefined ? COMMIT_A : o.head,
      reasons: o.reasons ?? ['up to date'],
    }),
  );
  write(
    join(root, 'var/lib/evia/registry/registry.json'),
    JSON.stringify({ schemaVersion: 1, entries: o.deployed === undefined ? [{ commit: COMMIT_A }] : [{ commit: o.deployed }] }),
  );
  if (o.tokens !== undefined) write(join(root, 'etc/evia/deploy-agent/expiries.json'), JSON.stringify({ tokens: o.tokens }));
}

function run(/** @type {Record<string, string>} */ env = {}) {
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, EVIA_ROOT: root, FAKE_LOG: log, ...env },
  });
}

const metricsFile = () => join(root, 'var/lib/evia/metrics/evia_agent.prom');
const content = () => readFileSync(metricsFile(), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'metrics-'));
  bin = join(root, 'bin');
  log = join(root, 'fake.log');
  write(join(bin, 'curl'), FAKE_CURL);
  write(join(bin, 'date'), FAKE_DATE);
  chmodSync(join(bin, 'curl'), 0o755);
  chmodSync(join(bin, 'date'), 0o755);
});

describe('EVM-085 AC2 metrics.sh', () => {
  it('EVM-085 AC2 writes the heartbeat, the deployed commit, V0 and the mismatch metrics atomically', () => {
    fixture();
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const text = content();
    assert.match(text, /^evia_deploy_agent_last_success_timestamp_seconds 1793188740$/mu);
    assert.match(text, new RegExp(`^evia_deploy_agent_deployed_info\\{commit="${COMMIT_A}"\\} 1$`, 'mu'));
    assert.match(text, /^evia_deploy_agent_v0_blocked 0$/mu);
    assert.match(text, /^evia_deploy_agent_main_head_mismatch_since_seconds 0$/mu);
    assert.equal(statSync(metricsFile()).mode & 0o777, 0o644);
    assert.equal(statSync(join(root, 'var/lib/evia/metrics')).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(join(root, 'var/lib/evia/metrics')), ['evia_agent.prom']);
  });

  it('EVM-085 AC2 reports the rate limit and the PAT expiry from the headers; the PAT is never on a command line or in the output', () => {
    fixture();
    write(join(root, 'etc/evia/secrets/github-pat'), `${PAT}\n`);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(content(), /^evia_github_rate_limit_remaining 4321$/mu);
    assert.match(content(), /^evia_token_expiry_timestamp_seconds\{token="github-pat"\} 1794283200$/mu);
    const argv = readFileSync(log, 'utf8');
    assert.ok(!argv.includes(PAT), 'PAT in argv');
    assert.ok(readFileSync(`${log}.stdin`, 'utf8').includes(PAT), 'the PAT travels on stdin (config)');
    assert.ok(!result.stderr.includes(PAT) && !result.stdout.includes(PAT));
    assert.ok(!content().includes(PAT));
  });

  it('EVM-085 AC2 a failed GitHub call omits only the two GitHub metrics', () => {
    fixture();
    write(join(root, 'etc/evia/secrets/github-pat'), PAT);
    const result = run({ FAKE_CURL_EXIT: '22' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(content(), /rate_limit|github-pat/u);
    assert.match(content(), /evia_deploy_agent_v0_blocked/u);
  });

  it('EVM-085 AC2 a PAT of an unexpected form is refused before any network call', () => {
    fixture();
    write(join(root, 'etc/evia/secrets/github-pat'), 'x"\nheader = "Evil: 1');
    const result = run();
    assert.equal(result.status, 1);
    assert.ok(!existsSync(log));
    assert.ok(!existsSync(metricsFile()));
  });

  it('EVM-085 AC2 gate V0: a rejection with a v0-blocked reason sets the flag, another rejection does not', () => {
    fixture({ decision: 'reject', head: null, reasons: ['v0-blocked: push to main'] });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_v0_blocked 1$/mu);
    fixture({ decision: 'reject', head: null, reasons: ['api-rate-limit'] });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_v0_blocked 0$/mu);
  });

  it('EVM-085 AC2 mismatch of HEAD and the deployed commit: the clock starts, grows and resets on equality', () => {
    fixture({ head: COMMIT_B });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_main_head_mismatch_since_seconds 0$/mu);
    write(join(root, 'var/lib/evia/metrics-state/head-mismatch'), `${COMMIT_B} ${String(NOW - 2000)}\n`);
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_main_head_mismatch_since_seconds 2000$/mu);
    // a new HEAD restarts the clock; an unknown HEAD (rejection) keeps it running
    write(join(root, 'var/lib/evia/metrics-state/head-mismatch'), `${COMMIT_A} ${String(NOW - 5000)}\n`);
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_main_head_mismatch_since_seconds 0$/mu);
    write(join(root, 'var/lib/evia/metrics-state/head-mismatch'), `${COMMIT_B} ${String(NOW - 900)}\n`);
    fixture({ decision: 'reject', head: null, reasons: ['api-parse'] });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_main_head_mismatch_since_seconds 900$/mu);
    fixture({ head: COMMIT_A });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_deploy_agent_main_head_mismatch_since_seconds 0$/mu);
    assert.ok(!existsSync(join(root, 'var/lib/evia/metrics-state/head-mismatch')));
  });

  it('EVM-085 AC2 expiries.json: names and dates become labelled series', () => {
    fixture({
      tokens: [
        { name: 'grafana-write-token', expires: '2027-10-20' },
        { name: 'sentry-dsn-api', expires: '2027-01-05' },
      ],
    });
    assert.equal(run().status, 0);
    assert.match(content(), /^evia_token_expiry_timestamp_seconds\{token="grafana-write-token"\} 1823990400$/mu);
    assert.match(content(), /^evia_token_expiry_timestamp_seconds\{token="sentry-dsn-api"\} 1799107200$/mu);
  });
});

describe('EVM-085 AC2 metrics.sh injection (CWE-74, CWE-117): invalid data writes no file', () => {
  const hostile = [
    ['a newline in the deployed commit', { deployed: `${COMMIT_A}\nevia_deploy_agent_v0_blocked 1` }],
    ['a brace in the deployed commit', { deployed: `${COMMIT_A}"} 1\n#{` }],
    ['an uppercase deployed commit', { deployed: 'A'.repeat(40) }],
    ['a short HEAD', { head: 'abc' }],
    ['a token name with a quote', { tokens: [{ name: 'a"b', expires: '2027-01-01' }] }],
    ['an uppercase token name', { tokens: [{ name: 'GitHub', expires: '2027-01-01' }] }],
    ['a token name with a newline', { tokens: [{ name: 'a\nb', expires: '2027-01-01' }] }],
    ['a token date that is not a day', { tokens: [{ name: 'ok-name', expires: '2027-01-01; rm' }] }],
    ['a missing token date', { tokens: [{ name: 'ok-name' }] }],
    ['a timestamp that is not ISO', { lastSuccess: 'tomorrow' }],
    ['an unknown decision', { decision: 'maybe' }],
  ];
  for (const [name, options] of hostile) {
    it(`EVM-085 AC2 refuses ${String(name)} and keeps the previous file`, () => {
      fixture();
      assert.equal(run().status, 0);
      const before = content();
      fixture(/** @type {any} */ (options));
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /REFUSED/u);
      assert.equal(content(), before);
    });
  }

  it('EVM-085 AC2 refuses files that are not JSON or too large', () => {
    fixture();
    write(join(root, 'var/lib/evia/agent/state/state.json'), 'not json');
    assert.equal(run().status, 1);
    write(join(root, 'var/lib/evia/agent/state/state.json'), ' '.repeat(2 * 1024 * 1024));
    assert.equal(run().status, 1);
    assert.ok(!existsSync(metricsFile()));
  });

  it('EVM-085 AC2 positive control: valid data of the same shape is accepted', () => {
    fixture({ tokens: [{ name: 'ok-name', expires: '2027-01-01' }] });
    assert.equal(run().status, 0);
  });
});

describe('EVM-085 AC2 metrics.sh does not talk to Grafana (RR-24)', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  it('EVM-085 AC2 the script and the deploy scripts never connect to or read from Grafana or Loki', () => {
    for (const file of ['metrics.sh', 'cycle.sh', 'deploy.sh', 'secrets.sh']) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url).pathname, 'utf8');
      assert.doesNotMatch(text.replace(/^\s*#.*$/gmu, ''), /grafana|loki|mimir|prometheus|otlp|sentry/iu, file);
    }
  });

  it('EVM-085 AC2 the only network call is GET /rate_limit of the GitHub API and there is no eval', () => {
    const urls = [...source.replace(/^\s*#.*$/gmu, '').matchAll(/https?:\/\/[^\s'")]+/gu)].map((m) => m[0]);
    assert.deepEqual(urls, ['https://api.github.com/rate_limit']);
    assert.doesNotMatch(source.replace(/^\s*#.*$/gmu, ''), /\beval\b/u);
  });
});
