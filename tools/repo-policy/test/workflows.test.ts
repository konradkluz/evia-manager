/**
 * GitHub Actions, Renovate and the Docker usage of scripts on the real repository (EVM-006 AC4, AC8; ADR-0012,
 * ADR-0016; SR-SUPPLY-04; security-engineer A2, A6, A7; architect W3c, W5, W6).
 */
import { describe, expect, it } from 'vitest';
import { exists, json, list, read, record, text, workspaces, yaml } from '../src/files.ts';
import {
  ciGateProblems,
  ciRoutingProblems,
  ciTriggerProblems,
  DOCS_CHECK_SCRIPT,
  docsCheckStepProblems,
  dockerCommandProblems,
  renovateWorkflowProblems,
  workflowProblems,
} from '../src/workflows.ts';

const WORKFLOWS = ['ci.yml', 'main-integrity.yml', 'nightly.yml', 'renovate.yml'];
const ci = record(yaml('.github/workflows/ci.yml'));
const jobs = record(ci['jobs']);
const job = (name: string): Record<string, unknown> => record(jobs[name]);
const runs = (name: string): string[] =>
  list(job(name)['steps'])
    .map((step) => text(record(step)['run']))
    .filter(Boolean);
const services = Object.keys(record(record(yaml('compose.yaml'))['services']));

describe('every workflow (EVM-006 AC4, A6, SR-SUPPLY-04)', () => {
  it('EVM-006 AC4: pinned actions with version comments, read-only defaults, explicit job permissions, timeouts, no persisted credentials', () => {
    for (const file of WORKFLOWS) {
      const path = `.github/workflows/${file}`;
      expect(workflowProblems(path, read(path), yaml(path))).toEqual([]);
    }
  });

  it('EVM-006 AC4 (A6): scripts start Docker only as docker compose -f compose.yaml run --rm <service>', () => {
    const commands: Array<[string, string]> = [];
    for (const path of ['package.json', ...workspaces().map((workspace) => `${workspace}/package.json`)]) {
      for (const [name, command] of Object.entries(record(record(json(path))['scripts'])))
        commands.push([`${path} ${name}`, text(command)]);
    }
    const lefthook = record(yaml('lefthook.yml'));
    for (const [hook, value] of Object.entries(lefthook)) {
      for (const [name, command] of Object.entries(record(record(value)['commands'])))
        commands.push([`lefthook.yml ${hook}.${name}`, text(record(command)['run'])]);
    }
    for (const file of WORKFLOWS) {
      for (const [name, value] of Object.entries(record(record(yaml(`.github/workflows/${file}`))['jobs']))) {
        // EVM-007 AC2: the only exception — publish builds, scans and pushes images; its Docker commands are an exact
        // allow-list checked by publishProblems (test/publish.test.ts)
        if (file === 'ci.yml' && name === 'publish') continue;
        for (const step of list(record(value)['steps'])) commands.push([`${file} ${name}`, text(record(step)['run'])]);
      }
    }
    expect(commands.flatMap(([where, command]) => dockerCommandProblems(where, command, services))).toEqual([]);
    expect(commands.some(([, command]) => command.includes('docker compose'))).toBe(true);
  });
});

describe('ci.yml (EVM-006 AC4; A2, W3c, W6)', () => {
  it('EVM-083 AC1, AC4: runs on every push (fast checks only outside main), on pull requests to main and on demand — no paths filter, no pull_request_target', () => {
    expect(ci['on']).toEqual({ push: { branches: ['**'] }, pull_request: { branches: ['main'] }, workflow_dispatch: null });
    expect(ciTriggerProblems(ci)).toEqual([]);
  });

  it('EVM-083 AC1, AC2, AC4: routing — quick for a branch push, changes and the full set for pull requests and main, heavy jobs only for heavy=true', () => {
    expect(ciRoutingProblems(ci)).toEqual([]);
    // The documentation validator runs in every kind of run: in quick (branch push) and in quality (full run).
    expect(runs('quick')[0]).toBe(DOCS_CHECK_SCRIPT);
    expect(runs('quality')[0]).toBe(DOCS_CHECK_SCRIPT);
  });

  it('EVM-006 AC4, EVM-013 AC3: the quality job runs the stages in order: documentation validator → install → format → lint → types → boundaries → tests and coverage → build', () => {
    expect(runs('quality')).toEqual([
      DOCS_CHECK_SCRIPT,
      'pnpm install --frozen-lockfile',
      'pnpm run format:check',
      'pnpm exec turbo run lint',
      'pnpm exec turbo run typecheck',
      'pnpm run deps:check',
      'pnpm exec turbo run test:coverage',
      'pnpm exec turbo run build',
    ]);
  });

  it('EVM-006 AC4: the backend job uses the same container commands as locally and checks licenses (bramka 4)', () => {
    const commands = runs('backend');
    expect(commands).toContain('docker compose -f compose.yaml run --rm backend-install');
    expect(commands).toContain('docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend');
    expect(commands).toContain('node tools/scan/cli.mjs licenses');
  });

  it('EVM-006 AC4: the security job scans the full history and self-tests every scanner', () => {
    expect(runs('security')).toContain('node tools/scan/cli.mjs security');
    const checkout = list(job('security')['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/checkout@'));
    expect(record(checkout?.['with'])['fetch-depth']).toBe(0);
  });

  it('EVM-008 AC1: backend-integration runs the PostgreSQL tests with Testcontainers and publishes their lcov report', () => {
    const integration = job('backend-integration');
    expect(integration['permissions']).toEqual({ contents: 'read' });
    expect(runs('backend-integration')).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm exec turbo run build --filter=@evia/api^...',
      'pnpm --filter @evia/api run test:integration',
    ]);
    // Ephemeral runner: containers end with the job, so the (unpinned) Ryuk reaper image is not pulled.
    expect(record(integration['env'])['TESTCONTAINERS_RYUK_DISABLED']).toBe('true');
    const upload = list(integration['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/upload-artifact@'));
    expect(record(upload?.['with'])).toMatchObject({
      name: 'lcov-integration',
      path: 'apps/api/coverage/integration/lcov.info',
      'if-no-files-found': 'error',
    });
  });

  it('EVM-006 AC3 (W3c), EVM-008: changed-code coverage merges every report (quality, container, integration) with the full history', () => {
    expect(job('coverage')['needs']).toEqual(['changes', 'quality', 'backend', 'backend-integration']);
    const downloads = list(job('coverage')['steps'])
      .map(record)
      .filter((step) => text(step['uses']).startsWith('actions/download-artifact@'))
      .map((step) => record(step['with']));
    expect(downloads).toEqual([
      { name: 'lcov-quality', path: '.' },
      { name: 'lcov-backend', path: 'coverage/backend-tests' },
      { name: 'lcov-integration', path: 'coverage/backend-tests/integration' },
    ]);
    expect(runs('coverage')).toEqual(['node tools/diff-coverage/cli.mjs']);
    const checkout = list(job('coverage')['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/checkout@'));
    expect(record(checkout?.['with'])['fetch-depth']).toBe(0);
  });

  it('EVM-013 AC1, AC3: the documentation validator is the first step with a command of quality, fail-closed, with a fixed script', () => {
    expect(docsCheckStepProblems(ci)).toEqual([]);
    expect(DOCS_CHECK_SCRIPT).toBe(
      'status=0\nnode tools/docs-lifecycle/cli.mjs check --summary >> "$GITHUB_STEP_SUMMARY" || status=$?\nexit "$status"\n',
    );
  });

  it('EVM-008 AC5, EVM-086 AC5: e2e-web runs the Playwright E2E of the panel in Chromium only (Firefox runs in nightly.yml) with read-only permissions', () => {
    const e2e = job('e2e-web');
    expect(e2e['permissions']).toEqual({ contents: 'read' });
    expect(runs('e2e-web')).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm exec turbo run build --filter=@evia/web^...',
      'pnpm --filter @evia/web exec playwright install --with-deps chromium',
      'pnpm --filter @evia/web run e2e --project=chromium --shard="$SHARD/2"',
    ]);
    expect(read('.github/workflows/ci.yml')).not.toContain('firefox --');
    expect(runs('e2e-web').join(' ')).not.toContain('firefox');
    // Two Playwright shards (the suite outgrew a single 20-minute job); ci-gate sees the aggregated matrix result.
    expect(record(record(e2e['strategy'])['matrix'])['shard']).toEqual([1, 2]);
    expect(record(e2e['strategy'])['fail-fast']).toBe(false);
    expect(record(record(json('apps/web/package.json'))['scripts'])['e2e']).toBe('playwright test --grep-invert @screenshots');
    const upload = list(e2e['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/upload-artifact@'));
    expect(upload?.['if']).toBe('failure()');
    expect(Number(record(upload?.['with'])['retention-days'])).toBeLessThanOrEqual(7);
  });

  it('EVM-013 AC3 (K6), EVM-008: ci.yml keeps its jobs (backend-integration and e2e-web added by EVM-008) — the validator is a step of quality, not a new job — and quality stays in ci-gate', () => {
    expect(Object.keys(jobs)).toEqual([
      'quick',
      'changes',
      'quality',
      'backend',
      'backend-integration',
      'e2e-web',
      'mobile-apk',
      'security',
      'coverage',
      'ci-gate',
      'publish',
      'staging-verify',
    ]);
    expect(list(job('ci-gate')['needs'])).toContain('quality');
  });

  it('EVM-083 AC1, AC3: ci-gate never runs for a push to a branch and its job list excludes the fast job', () => {
    expect(job('ci-gate')['if']).toBe("always() && (github.event_name != 'push' || github.ref == 'refs/heads/main')");
    expect(list(job('ci-gate')['needs'])).not.toContain('quick');
  });

  it('EVM-006 AC4 (A2, W6), EVM-083 AC3: ci-gate is green only when every required job succeeded (skips only for a documentation-only change); K6 is not a job of ci.yml', () => {
    expect(ciGateProblems(ci)).toEqual([]);
    expect(job('ci-gate')['permissions']).toEqual({});
  });
});

describe('main-integrity.yml (EVM-006 AC4; A1, K6, code and security review)', () => {
  const workflow = record(yaml('.github/workflows/main-integrity.yml'));
  const integrity = record(record(workflow['jobs'])['main-integrity']);

  it('EVM-006 AC4 (A1): K6 runs on every push to main, nightly and on demand — in its own workflow without a concurrency group', () => {
    expect(Object.keys(record(workflow['jobs']))).toEqual(['main-integrity']);
    expect(record(workflow['on'])['push']).toEqual({ branches: ['main'] });
    expect(list(record(workflow['on'])['schedule']).length).toBe(1);
    expect('workflow_dispatch' in record(workflow['on'])).toBe(true);
    // GitHub cancels a pending run of a concurrency group when a newer run queues — no K6 run may be dropped.
    expect(workflow['concurrency']).toBeUndefined();
    expect(integrity['concurrency']).toBeUndefined();
    expect(integrity['if']).toBe("github.ref == 'refs/heads/main'");
  });

  it('EVM-006 AC4 (A1): read-only API access, the owner login, the baseline commit and the event of the run', () => {
    expect(integrity['permissions']).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    const step = list(integrity['steps']).map(record).at(-1) ?? {};
    expect(step['run']).toBe('node tools/main-integrity/cli.mjs');
    const env = record(step['env']);
    expect(env['MAIN_MERGER']).toBe('konradkluz');
    expect(text(env['BASELINE'])).toMatch(/^[0-9a-f]{40}$/);
    // Closed incidents only (code review, round 2): a literal list of full SHAs, never an expression or a variable.
    expect(typeof env['ACKNOWLEDGED']).toBe('string');
    expect(text(env['ACKNOWLEDGED'])).toMatch(/^(?:[0-9a-f]{40}(?: [0-9a-f]{40})*)?$/);
    expect(env).toMatchObject({
      GITHUB_TOKEN: '${{ github.token }}',
      EVENT: '${{ github.event_name }}',
      BEFORE: '${{ github.event.before }}',
      AFTER: '${{ github.sha }}',
      FORCED: '${{ github.event.forced }}',
    });
  });
});

describe('EVM-086 AC1, AC3, AC4: filters of the heavy jobs', () => {
  it('EVM-086 AC1, AC4: the lists of paths are explicit and never contain the paths that must always run the tests', async () => {
    const classify = (await import(new URL('../../ci-changes/lib/classify.mjs', import.meta.url).href)) as {
      E2E_NOT_RELEVANT_PREFIXES: string[];
      INTEGRATION_NOT_RELEVANT_PREFIXES: string[];
      isNotRelevantToE2e: (path: string) => boolean;
      isNotRelevantToIntegration: (path: string) => boolean;
    };
    expect(classify.E2E_NOT_RELEVANT_PREFIXES).toEqual(['apps/api/', 'apps/mobile/']);
    expect(classify.INTEGRATION_NOT_RELEVANT_PREFIXES).toEqual(['apps/web/', 'apps/mobile/']);
    const always = [
      'packages/contracts/a.ts',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.github/workflows/ci.yml',
      'tools/ci-changes/cli.mjs',
      'compose.yaml',
      'compose.dev.yaml',
      'package.json',
      'turbo.json',
      '.claude/agents/a.md',
      'unknown/file.txt',
    ];
    for (const path of always) {
      expect(classify.isNotRelevantToE2e(path), path).toBe(false);
      expect(classify.isNotRelevantToIntegration(path), path).toBe(false);
    }
    for (const prefix of [...classify.E2E_NOT_RELEVANT_PREFIXES, ...classify.INTEGRATION_NOT_RELEVANT_PREFIXES])
      expect(prefix.startsWith('apps/') && prefix.endsWith('/') && !prefix.includes('*'), prefix).toBe(true);
  });

  it('EVM-086 AC4: the filter exists only in the changes job (never a trigger filter), pull_request is the only event that can skip, ci-gate is the only job with always()', () => {
    expect(ciTriggerProblems(ci)).toEqual([]);
    const cli = read('tools/ci-changes/cli.mjs');
    expect(cli).toContain("process.env['EVENT_NAME']");
    for (const [name, value] of Object.entries(jobs)) {
      const condition = text(record(value)['if']);
      expect(condition.includes('always()'), name).toBe(name === 'ci-gate');
    }
    // No other workflow can skip the E2E or the integration tests by path.
    for (const file of ['main-integrity.yml', 'nightly.yml', 'renovate.yml']) {
      const raw = read(`.github/workflows/${file}`);
      expect(raw, file).not.toContain('needs.changes');
      expect(raw, file).not.toMatch(/paths(-ignore)?:/);
    }
  });

  it('EVM-086 AC4: workflows use only the already pinned actions (no new action, every one pinned to a full SHA with a version comment)', () => {
    const allowed = new Set([
      'actions/checkout',
      'actions/setup-node',
      // EVM-009: Java 17 and the Gradle caches of the build job of the Android package (mobile-apk); both official actions.
      'actions/setup-java',
      'actions/cache',
      'actions/upload-artifact',
      'actions/download-artifact',
      'pnpm/action-setup',
      'renovatebot/github-action',
    ]);
    for (const file of WORKFLOWS) {
      for (const line of read(`.github/workflows/${file}`).split('\n')) {
        const match = /^\s*-?\s*uses:\s*(\S+)\s+#\s*v\d+/.exec(line);
        if (!/uses:/.test(line)) continue;
        expect(match, `${file}: ${line}`).not.toBeNull();
        expect(allowed.has((match?.[1] ?? '').split('@')[0] ?? ''), `${file}: ${line}`).toBe(true);
      }
    }
  });

  it('EVM-086 AC3: coverage runs for every change beyond documentation and downloads the integration report only when the integration ran', () => {
    expect(job('coverage')['if']).toBe("needs.changes.outputs.heavy == 'true' && !failure() && !cancelled()");
    const download = list(job('coverage')['steps'])
      .map(record)
      .find((step) => record(step['with'])['name'] === 'lcov-integration');
    expect(download?.['if']).toBe("needs.changes.outputs.integration == 'true'");
    expect(job('e2e-web')['if']).toBe("needs.changes.outputs.e2e == 'true'");
    expect(job('backend-integration')['if']).toBe("needs.changes.outputs.integration == 'true'");
  });
});

describe('nightly.yml and renovate.yml (EVM-006 AC4, AC8; A7, SR-SUPPLY-02)', () => {
  it('EVM-086 AC5: nightly.yml runs the full E2E (Chromium and Firefox) on main with the same shards and timeout as ci.yml and uploads the report on failure', () => {
    const nightly = record(yaml('.github/workflows/nightly.yml'));
    const e2e = record(record(nightly['jobs'])['e2e-web']);
    const reference = job('e2e-web');
    expect(e2e['if']).toBe("github.ref == 'refs/heads/main'");
    expect(e2e['timeout-minutes']).toBe(reference['timeout-minutes']);
    expect(record(e2e['strategy'])).toEqual(record(reference['strategy']));
    expect(e2e['permissions']).toEqual({ contents: 'read' });
    const commands = list(e2e['steps']).map((step) => text(record(step)['run']));
    expect(commands).toContain('pnpm --filter @evia/web exec playwright install --with-deps chromium firefox');
    expect(commands).toContain('pnpm --filter @evia/web run e2e --project=chromium --project=firefox --shard="$SHARD/2"');
    const upload = list(e2e['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/upload-artifact@'));
    expect(upload?.['if']).toBe('failure()');
    // Local and nightly runs keep both browsers: playwright.config.ts defines the two projects.
    const config = read('apps/web/playwright.config.ts');
    expect(config).toContain("name: 'chromium'");
    expect(config).toContain("name: 'firefox'");
  });

  it('EVM-006 AC4 (SR-SUPPLY-02): nightly scans run on main with the OSV gate and pnpm audit as a report', () => {
    const nightly = record(yaml('.github/workflows/nightly.yml'));
    expect(Object.keys(record(nightly['on']))).toEqual(['schedule', 'workflow_dispatch']);
    const scans = record(record(nightly['jobs'])['scans']);
    expect(scans['if']).toBe("github.ref == 'refs/heads/main'");
    const commands = list(scans['steps']).map((step) => text(record(step)['run']));
    expect(commands).toContain('node tools/scan/cli.mjs security');
    expect(commands.some((command) => command.startsWith('pnpm audit --audit-level=high'))).toBe(true);
  });

  it('EVM-006 AC8 (A7): Renovate runs on main only when enabled, with the token visible to its step only', () => {
    const path = '.github/workflows/renovate.yml';
    expect(renovateWorkflowProblems(read(path), yaml(path))).toEqual([]);
    expect(read(path)).toContain("vars.RENOVATE_ENABLED == 'true'");
  });

  it('EVM-006 AC8: renovate.json groups updates, pins SHAs and digests, waits 3 days, never automerges or runs scripts', () => {
    const config = record(json('renovate.json'));
    expect(list(config['extends'])).toEqual(
      expect.arrayContaining(['config:recommended', 'helpers:pinGitHubActionDigests', 'docker:pinDigests', ':dependencyDashboard']),
    );
    expect(config['minimumReleaseAge']).toBe('3 days');
    expect(config['rangeStrategy']).toBe('pin');
    expect(config['automerge']).toBe(false);
    expect(config['ignoreScripts']).toBe(true);
    expect(config['commitMessageSuffix']).toBe('[renovate]');
    expect(config['timezone']).toBe('Europe/Warsaw');
    for (const key of ['postUpgradeTasks', 'allowedCommands', 'allowScripts', 'minimumReleaseAgeExclude'])
      expect(config[key], key).toBeUndefined();
    const rules = list(config['packageRules']).map(record);
    expect(rules.every((rule) => rule['automerge'] === undefined)).toBe(true);
    expect(rules.map((rule) => rule['groupName']).filter(Boolean).length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(config['customManagers'])).toContain('Dockerfile');
  });

  it('EVM-006 AC4: CODEOWNERS and the PR template name the sensitive paths (K3)', () => {
    const owners = read('.github/CODEOWNERS');
    for (const path of [
      '/.github/',
      '/.claude/',
      '/compose*.yaml',
      '/lefthook.yml',
      '/.gitleaksignore',
      '/osv-scanner.toml',
      '/.trivyignore.yaml',
      '/zizmor.yml',
    ]) {
      expect(owners).toContain(path);
    }
    expect(exists('.github/pull_request_template.md')).toBe(true);
    expect(read('.github/pull_request_template.md')).toContain('Conventional Commit');
  });
});
