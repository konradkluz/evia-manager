// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeArgs, composeRunner, SERVICES } from '../lib/compose.mjs';
import { pushRanges, runHook } from '../lib/hooks.mjs';
import { defaultIo, main, oneLine, runStep, SCANS_DIR } from '../lib/main.mjs';
import { fixtures, SELFTEST_DIR, syntheticGithubToken } from '../lib/selftest.mjs';
import { LICENSE_STEPS, SECURITY_STEPS, SELFTEST_STEPS, workflows } from '../lib/steps.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const ALL = [...SECURITY_STEPS, ...LICENSE_STEPS, ...SELFTEST_STEPS];

/** @type {string} */
let root;

/** Synthetic scanner reports that make every gate green (or every self-test red, as expected). */
const GREEN = {
  'gitleaks.json': [],
  'semgrep.json': { results: [], errors: [], paths: { scanned: ['packages/a.ts'] } },
  'osv.json': { results: [{ packages: [{ package: { name: 'a', version: '1.0.0' }, groups: [], vulnerabilities: [] }] }] },
  'trivy-config.json': { Results: [{ Target: 'docker/backend-tests/Dockerfile', Misconfigurations: [] }] },
  'trivy-license.json': {
    Results: [
      { Target: 'pnpm-lock.yaml', Type: 'pnpm' },
      { Class: 'license', Licenses: [{ Name: 'MIT', PkgName: 'a' }] },
    ],
  },
  'selftest/gitleaks.json': [{ RuleID: 'github-pat', File: '/out/selftest/gitleaks/selftest-config.txt', StartLine: 2 }],
  'selftest/osv.json': {
    results: [
      {
        packages: [
          {
            package: { name: 'lodash', version: '4.17.20' },
            groups: [{ ids: ['GHSA-35jh-r3h4-6jhm'], max_severity: '8.1' }],
            vulnerabilities: [
              { id: 'GHSA-35jh-r3h4-6jhm', affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }] },
            ],
          },
        ],
      },
    ],
  },
  'selftest/trivy-config.json': {
    Results: [{ Target: 'Dockerfile', Misconfigurations: [{ ID: 'DS-0002', Severity: 'HIGH', Status: 'FAIL' }] }],
  },
  'selftest/trivy-license.json': {
    Results: [
      { Target: 'pnpm-lock.yaml', Type: 'pnpm' },
      { Class: 'license', Licenses: [{ Name: 'GPL-3.0-only', PkgName: 'selftest-gpl-fixture' }] },
    ],
  },
};
const ZIZMOR_SELFTEST = [
  { ident: 'dangerous-triggers', determinations: { severity: 'High' } },
  { ident: 'template-injection', determinations: { severity: 'High' } },
];

/**
 * Fake compose: writes the synthetic report of the step (from its --output/--report-path argument) and answers.
 * @param {{ overrides?: Record<string, unknown>, status?: (service: string, args: string[]) => number | null, error?: Error }} [options]
 */
function fakeCompose({ overrides = {}, status = () => 0, error } = {}) {
  /** @type {string[][]} */
  const calls = [];
  /** @type {import('../lib/compose.mjs').Compose} */
  const compose = (service, args) => {
    calls.push([service, ...args]);
    const flag = args.findIndex((arg) => arg === '--output' || arg === '--report-path' || arg === '--output-file');
    const target = flag >= 0 ? args[flag + 1]?.replace('/out/', '') : undefined;
    const reports = { ...GREEN, ...overrides };
    if (target !== undefined && target in reports) {
      mkdirSync(join(root, SCANS_DIR, 'selftest'), { recursive: true });
      writeFileSync(join(root, SCANS_DIR, target), JSON.stringify(reports[/** @type {keyof typeof reports} */ (target)]));
    }
    let stdout = '';
    if (service === 'scan-zizmor') stdout = JSON.stringify(args.includes('--no-config') ? ZIZMOR_SELFTEST : (overrides['zizmor'] ?? []));
    if (service === 'scan-actionlint') stdout = JSON.stringify(overrides['actionlint'] ?? []);
    return { status: status(service, args), stdout, stderr: service === 'scan-gitleaks' ? '42 commits scanned.' : '', error };
  };
  return { compose, calls };
}

/**
 * @param {string[]} argv
 * @param {ReturnType<typeof fakeCompose>} fake
 * @param {{ stdin?: string, hasOriginMain?: boolean }} [extra]
 */
function run(argv, fake, { stdin = '', hasOriginMain = true } = {}) {
  /** @type {string[]} */
  const out = [];
  const status = main(argv, {
    cwd: root,
    stdout: (line) => out.push(line),
    stderr: (line) => out.push(`ERR ${line}`),
    compose: fake.compose,
    stdin: () => stdin,
    hasOriginMain: () => hasOriginMain,
  });
  return { status, out: out.join('\n') };
}

describe('scan runner (EVM-006 AC4, AC5; SR-SUPPLY-07, SR-SUPPLY-10)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'evm006-scan-'));
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('EVM-006 AC4: all — every scan and self-test green → exit 0 with a summary table; fixtures are generated', () => {
    const fake = fakeCompose();
    const { status, out } = run(['all'], fake);
    assert.equal(status, 0, out);
    assert.match(out, /Wynik: ZIELONY/);
    assert.equal(fake.calls.length, ALL.length);
    assert.ok(existsSync(join(root, SELFTEST_DIR, 'gitleaks', 'selftest-config.txt')));
  });

  it('EVM-006 AC4: security runs everything but licenses; licenses and selftest run only their steps', () => {
    assert.equal(run(['security'], fakeCompose()).status, 0);
    const licenses = fakeCompose();
    assert.equal(run(['licenses'], licenses).status, 0);
    assert.deepEqual(
      licenses.calls.map((call) => call[0]),
      ['scan-trivy'],
    );
    const selftest = fakeCompose();
    assert.equal(run(['selftest'], selftest).status, 0);
    assert.equal(selftest.calls.length, SELFTEST_STEPS.length);
  });

  it('EVM-006 AC4: a red gate turns the whole run red and lists the problems', () => {
    const fake = fakeCompose({ overrides: { 'gitleaks.json': [{ RuleID: 'aws-access-token', File: 'x', StartLine: 1 }] } });
    const { status, out } = run(['security'], fake);
    assert.equal(status, 1);
    assert.match(out, /aws-access-token · x:1/);
    assert.match(out, /Wynik: CZERWONY/);
  });

  it('EVM-006 AC4 (A4): a scanner that stops detecting its fixture is red — "BRAMKA WYŁĄCZONA"', () => {
    const fake = fakeCompose({ overrides: { 'selftest/gitleaks.json': [] } });
    const { status, out } = run(['selftest'], fake);
    assert.equal(status, 1);
    assert.match(out, /BRAMKA WYŁĄCZONA/);
    const wrongId = run(['selftest'], fakeCompose({ overrides: { 'selftest/trivy-config.json': GREEN['trivy-config.json'] } }));
    assert.equal(wrongId.status, 1);
    const missingId = runStep(
      /** @type {import('../lib/steps.mjs').Step} */ (SELFTEST_STEPS.find((step) => step.id === 'selftest-trivy-config')),
      {
        ...defaultIo(root),
        compose: fakeCompose({
          overrides: {
            'selftest/trivy-config.json': {
              Results: [{ Target: 'Dockerfile', Misconfigurations: [{ ID: 'DS-9999', Severity: 'HIGH', Status: 'FAIL' }] }],
            },
          },
        }).compose,
      },
    );
    assert.deepEqual(missingId.problems, ['brak oczekiwanego identyfikatora DS-0002']);
  });

  it('EVM-006 AC4 (A4): tool errors, missing Docker and malformed reports are red, never green', () => {
    const crash = run(['licenses'], fakeCompose({ status: () => 2 }));
    assert.equal(crash.status, 1);
    assert.match(crash.out, /błąd narzędzia \(kod 2\)/);
    const killed = run(['licenses'], fakeCompose({ status: () => null }));
    assert.equal(killed.status, 1);
    const noDocker = run(['licenses'], fakeCompose({ error: new Error('spawn docker ENOENT') }));
    assert.match(noDocker.out, /nie uruchomiono Dockera/);
    const broken = run(['security'], fakeCompose({ overrides: { actionlint: undefined } }));
    assert.equal(broken.status, 0);
    const noReport = runStep(/** @type {import('../lib/steps.mjs').Step} */ (LICENSE_STEPS[0]), {
      ...defaultIo(root),
      compose: () => ({ status: 0, stdout: '', stderr: '' }),
    });
    assert.equal(noReport.summary, 'brak raportu albo niepoprawny JSON');
  });

  it('EVM-006 AC4 (A4): no workflow files is an empty target (zizmor, actionlint) — red without running the tool', () => {
    rmSync(join(root, '.github'), { recursive: true });
    assert.deepEqual(workflows(root), []);
    const { status, out } = run(['security'], fakeCompose());
    assert.equal(status, 1);
    assert.match(out, /pusty cel skanu \(brak plików do sprawdzenia\)/);
  });

  it('EVM-006 AC4: zizmor and actionlint get the workflow files explicitly', () => {
    const fake = fakeCompose();
    run(['security'], fake);
    assert.ok(fake.calls.some((call) => call[0] === 'scan-actionlint' && call.includes('.github/workflows/ci.yml')));
    assert.ok(fake.calls.some((call) => call[0] === 'scan-zizmor' && call.includes('/src/.github/workflows/ci.yml')));
  });

  it('EVM-006 AC4: every gitleaks call redacts secrets (A3), scanners use only compose services', () => {
    for (const step of ALL) {
      assert.ok(SERVICES.includes(step.service), step.service);
      if (step.service === 'scan-gitleaks') {
        assert.ok(step.args.includes('--redact'), step.id);
        assert.ok(step.args.includes('/config/gitleaks.toml'), step.id);
      }
    }
  });

  it('EVM-006 AC4: usage errors and a wrong directory → exit 2', () => {
    assert.equal(run([], fakeCompose()).status, 2);
    assert.equal(run(['everything'], fakeCompose()).status, 2);
    assert.equal(run(['hook', 'post-merge'], fakeCompose()).status, 2);
    rmSync(join(root, 'compose.yaml'));
    assert.match(run(['all'], fakeCompose()).out, /katalogu głównego/);
  });

  it('EVM-006 AC4: report output is one line per problem without control characters', () => {
    assert.equal(oneLine('a\nb\r\u0007'), 'a?b??');
  });
});

describe('gitleaks hooks (EVM-006 AC5, A3)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'evm006-hook-'));
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const Z = '0'.repeat(40);
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('EVM-006 AC5: pre-push ranges — update, new branch against origin/main (never empty), deletion skipped', () => {
    const stdin = [
      `refs/heads/x ${A} refs/heads/x ${B}`,
      `refs/heads/new ${A} refs/heads/new ${Z}`,
      `(delete) ${Z} refs/heads/old ${B}`,
      '',
    ].join('\n');
    assert.deepEqual(pushRanges(stdin, { hasOriginMain: true }), [`${B}..${A}`, `origin/main..${A}`]);
    assert.deepEqual(pushRanges(`refs/heads/new ${A} refs/heads/new ${Z}`, { hasOriginMain: false }), [A]);
  });

  it('EVM-006 AC5: pre-commit scans the index with --redact; a finding or missing Docker rejects the commit', () => {
    const ok = fakeCompose();
    assert.equal(run(['hook', 'pre-commit'], ok).status, 0);
    const [call = []] = ok.calls;
    assert.deepEqual(call.slice(0, 4), ['scan-gitleaks', 'git', '--pre-commit', '--staged']);
    assert.ok(call.includes('--redact'));
    const leak = run(['hook', 'pre-commit'], fakeCompose({ status: () => 1 }));
    assert.equal(leak.status, 1);
    assert.match(leak.out, /odrzucono/);
  });

  it('EVM-006 AC5: pre-push scans every pushed range with --log-opts', () => {
    const fake = fakeCompose();
    const { status } = run(['hook', 'pre-push'], fake, { stdin: `refs/heads/x ${A} refs/heads/x ${B}\n` });
    assert.equal(status, 0);
    const call = fake.calls[0] ?? [];
    assert.equal(call[call.indexOf('--log-opts') + 1], `${B}..${A}`);
    assert.ok(call.includes('--redact'));
    assert.equal(runHook('pre-push', { compose: fake.compose, stdin: '', hasOriginMain: true, log: () => undefined }), 0);
  });
});

describe('self-test fixtures and compose helper (EVM-006 AC4, AC5; SR-PRIV-08)', () => {
  it('EVM-006 AC5: the synthetic token has the GitHub token shape and is random (never a literal in the repository)', () => {
    const token = syntheticGithubToken();
    assert.match(token, new RegExp(['^gh', 'p_[0-9A-Za-z]{36}$'].join('')));
    assert.notEqual(token, syntheticGithubToken());
  });

  it('EVM-006 AC4: fixtures cover every scanner of the self-test', () => {
    const files = Object.keys(fixtures());
    for (const prefix of ['gitleaks/', 'osv/', 'trivy-config/', 'license/', 'zizmor/.github/workflows/']) {
      assert.ok(
        files.some((file) => file.startsWith(prefix)),
        prefix,
      );
    }
    assert.match(fixtures()['osv/pnpm-lock.yaml'] ?? '', /lodash@4\.17\.20/);
  });

  it('EVM-006 AC4 (A6): docker is only ever called as docker compose -f compose.yaml run --rm <known service>', () => {
    assert.deepEqual(composeArgs('scan-osv', ['scan']), ['compose', '-f', 'compose.yaml', 'run', '--rm', 'scan-osv', 'scan']);
    assert.throws(() => composeArgs('evil', []), /unknown compose service/);
  });

  it('EVM-006 AC4: the compose runner reports a missing Docker CLI as an error, not as a result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evm006-nodocker-'));
    const path = process.env['PATH'];
    try {
      process.env['PATH'] = dir;
      const result = composeRunner(dir)('scan-osv', ['--version']);
      assert.ok(result.error !== undefined || result.status !== 0);
    } finally {
      process.env['PATH'] = path;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EVM-006 AC4: default io reads origin/main from git and prints to the console', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evm006-io-'));
    try {
      spawnSync('git', ['init', '--quiet', dir]);
      const io = defaultIo(dir);
      assert.equal(io.hasOriginMain(), false);
      assert.equal(typeof io.stdin, 'function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EVM-006 AC4: the CLI entry point passes arguments and the exit code', () => {
    const result = spawnSync(process.execPath, [CLI, 'nothing'], {
      encoding: 'utf8',
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Użycie/);
    assert.equal(readFileSync(CLI, 'utf8').includes('defaultIo'), true);
  });
});
