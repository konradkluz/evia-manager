/**
 * GitHub Actions, Renovate and the Docker usage of scripts on the real repository (EVM-006 AC4, AC8; ADR-0012,
 * ADR-0016; SR-SUPPLY-04; security-engineer A2, A6, A7; architect W3c, W5, W6).
 */
import { describe, expect, it } from 'vitest';
import { exists, json, list, read, record, text, workspaces, yaml } from '../src/files.ts';
import { ciGateProblems, dockerCommandProblems, renovateWorkflowProblems, workflowProblems } from '../src/workflows.ts';

const WORKFLOWS = ['ci.yml', 'nightly.yml', 'renovate.yml'];
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
        for (const step of list(record(value)['steps'])) commands.push([`${file} ${name}`, text(record(step)['run'])]);
      }
    }
    expect(commands.flatMap(([where, command]) => dockerCommandProblems(where, command, services))).toEqual([]);
    expect(commands.some(([, command]) => command.includes('docker compose'))).toBe(true);
  });
});

describe('ci.yml (EVM-006 AC4; A2, W3c, W6)', () => {
  it('EVM-006 AC4: runs on every push and on demand — no pull_request_target, no duplicate pull_request runs', () => {
    expect(ci['on']).toEqual({ push: { branches: ['**'] }, workflow_dispatch: null });
  });

  it('EVM-006 AC4: the quality job runs the stages in order: install → format → lint → types → boundaries → tests and coverage → build', () => {
    expect(runs('quality')).toEqual([
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

  it('EVM-006 AC3 (W3c): changed-code coverage merges both reports with the full history', () => {
    expect(job('coverage')['needs']).toEqual(['quality', 'backend']);
    expect(runs('coverage')).toEqual(['node tools/diff-coverage/cli.mjs']);
    const checkout = list(job('coverage')['steps'])
      .map(record)
      .find((step) => text(step['uses']).startsWith('actions/checkout@'));
    expect(record(checkout?.['with'])['fetch-depth']).toBe(0);
  });

  it('EVM-006 AC4 (A2, W6): ci-gate is green only when every required job succeeded; main-integrity is outside it', () => {
    expect(ciGateProblems(ci)).toEqual([]);
    expect(job('ci-gate')['permissions']).toEqual({});
  });

  it('EVM-006 AC4 (A1): main-integrity runs on pushes to main with read-only API access and the owner login', () => {
    const integrity = job('main-integrity');
    expect(integrity['if']).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(integrity['permissions']).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    const step = list(integrity['steps']).map(record).at(-1) ?? {};
    expect(step['run']).toBe('node tools/main-integrity/cli.mjs');
    expect(record(step['env'])['MAIN_MERGER']).toBe('konradkluz');
  });
});

describe('nightly.yml and renovate.yml (EVM-006 AC4, AC8; A7, SR-SUPPLY-02)', () => {
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
