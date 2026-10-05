/**
 * compose.yaml, the backend-tests image and the scan services on the real repository (EVM-006 AC1, AC2, AC4;
 * ADR-0015, ADR-0016; security-engineer A6; architect W1, W7–W9; bramka 5).
 */
import { describe, expect, it } from 'vitest';
import { composeProblems, dockerfileProblems, OUTPUT_MOUNTS } from '../src/compose.ts';
import { exists, filesBelow, json, list, read, record, staged, text, yaml } from '../src/files.ts';
import { agentPermissionProblems } from '../src/workflows.ts';

const compose = record(yaml('compose.yaml'));
const services = record(compose['services']);
const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)/.exec(String(record(json('package.json'))['packageManager']))?.[1] ?? '';
const service = (name: string): Record<string, unknown> => record(services[name]);
const volumes = (name: string): string[] => list(service(name)['volumes']).map(String);

describe('compose.yaml hardening (EVM-006 AC1, A6, W9)', () => {
  it('EVM-006 AC1 (A6): every service is pinned and hardened — no ports, privileges, socket, env_file or interpolation', () => {
    const dockerfile = (context: string): string | null => (exists(`${context}/Dockerfile`) ? read(`${context}/Dockerfile`) : null);
    expect(composeProblems(compose, read('compose.yaml'), dockerfile)).toEqual([]);
  });

  it('EVM-006 AC1 (W9): the backend-tests Dockerfile is reproducible (digest, exact pnpm, no downloads, non-root)', () => {
    expect(dockerfileProblems(read('infra/docker/backend-tests/Dockerfile'), pnpmVersion)).toEqual([]);
    expect(
      read('infra/docker/backend-tests/.dockerignore')
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#')),
    ).toEqual(['*', '!Dockerfile']);
  });

  it('EVM-006 AC2 (W8): backend-install and backend-tests share one locally built image, rebuilt by every run', () => {
    for (const name of ['backend-install', 'backend-tests']) {
      expect(service(name)['image'], name).toBe('evia-backend-tests:local');
      expect(service(name)['pull_policy'], name).toBe('build');
      expect(record(service(name)['build'])['context'], name).toBe('infra/docker/backend-tests');
    }
    expect(service('backend-install')['command']).toEqual(['install']);
  });

  it('EVM-008 AC1 (A1): backend-tests reaches only PostgreSQL on an internal network; postgres is ephemeral and hardened', () => {
    expect(service('backend-tests')['networks']).toEqual(['backend-db']);
    expect(service('backend-tests')['network_mode']).toBeUndefined();
    expect(record(record(compose['networks'])['backend-db'])['internal']).toBe(true);
    const members = Object.entries(services).filter(([, value]) => list(record(value)['networks']).includes('backend-db'));
    expect(members.map(([name]) => name).sort()).toEqual(['backend-tests', 'postgres']);
    expect(record(record(service('backend-tests')['depends_on'])['postgres'])['condition']).toBe('service_healthy');
    const postgres = service('postgres');
    expect(postgres['user']).toBe('999:999');
    expect(postgres['volumes']).toBeUndefined();
    expect(postgres['ports']).toBeUndefined();
    expect(
      list(postgres['tmpfs'])
        .map(String)
        .map((mount) => mount.split(':')[0]),
    ).toEqual(['/var/lib/postgresql', '/var/run/postgresql', '/tmp']);
    expect(list(record(postgres['healthcheck'])['test'])).toContain('pg_isready');
    const environment = record(postgres['environment']);
    expect(environment['POSTGRES_HOST_AUTH_METHOD']).toBeUndefined();
    expect(environment['POSTGRES_PASSWORD']).toBe('evia-local');
  });

  it('EVM-008 AC1: compose postgres uses the image and initdb arguments of the integration tests (one source)', () => {
    const source = read('apps/api/test/support/postgres.ts');
    const constant = (name: string): string => new RegExp(`export const ${name} = '([^']+)'`).exec(source)?.[1] ?? '';
    expect(constant('POSTGRES_IMAGE')).toMatch(/^postgres:\d+\.\d+-\w+@sha256:[0-9a-f]{64}$/);
    expect(service('postgres')['image']).toBe(constant('POSTGRES_IMAGE'));
    expect(record(service('postgres')['environment'])['POSTGRES_INITDB_ARGS']).toBe(constant('POSTGRES_INITDB_ARGS'));
    expect(constant('POSTGRES_INITDB_ARGS')).toBe('--locale-provider=icu --icu-locale=pl-PL');
  });

  it('EVM-006 AC2: the backend container mounts every workspace directory and the lockfile read-only, writes only to bt-work and /out', () => {
    const mounts = volumes('backend-tests');
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'turbo.json',
      'apps',
      'packages',
      'tools',
      'design/tokens',
    ]) {
      expect(mounts, path).toContain(`./${path}:/src/${path}:ro`);
    }
    expect(mounts).toContain('bt-work:/work');
    expect(mounts).toContain('./coverage/backend-tests:/out');
    for (const forbidden of ['.:', './.git:', './.env', './.claude', './docs'])
      expect(
        mounts.some((mount) => mount.startsWith(forbidden)),
        forbidden,
      ).toBe(false);
  });

  it('EVM-006 AC4 (W7): .scratch is only an output (/out), the rule fixtures of .semgrep only reach Semgrep; workflows only the workflow scanners', () => {
    for (const [name, value] of Object.entries(services)) {
      for (const mount of list(record(value)['volumes']).map(String)) {
        if (mount.startsWith('./.scratch')) expect(mount, name).toBe('./.scratch/scans:/out');
        if (mount.startsWith('./.semgrep:')) expect(name).toBe('scan-semgrep');
        const writable = !mount.endsWith(':ro') && mount.startsWith('./');
        if (writable)
          expect(
            OUTPUT_MOUNTS.some((output) => mount.startsWith(`${output}:`)),
            `${name} ${mount}`,
          ).toBe(true);
      }
    }
    expect(volumes('scan-actionlint')).toEqual(['./.github:/src/.github:ro']);
    expect(volumes('scan-zizmor')).toEqual(['./.github:/src/.github:ro', './zizmor.yml:/src/zizmor.yml:ro', './.scratch/scans:/out']);
    expect(volumes('scan-gitleaks')).toEqual([
      './.git:/repo/.git:ro',
      './.gitleaks.toml:/config/gitleaks.toml:ro',
      './.gitleaksignore:/config/gitleaksignore:ro',
      './.scratch/scans:/out',
    ]);
    expect(volumes('scan-trivy')).toContain('bt-work:/work:ro');
  });

  it('EVM-006 AC4: scanners run without network, except Semgrep (registry rules) and OSV (package coordinates only)', () => {
    for (const name of Object.keys(services).filter((key) => key.startsWith('scan-') || key === 'renovate-validate')) {
      const online = name === 'scan-semgrep' || name === 'scan-osv';
      expect(service(name)['network_mode'], name).toBe(online ? undefined : 'none');
    }
  });

  it('EVM-006 AC4 (A6): tools start Docker only through tools/scan/lib/compose.mjs, whose service list equals compose.yaml', () => {
    const helper = read('tools/scan/lib/compose.mjs');
    const listed =
      /SERVICES = Object\.freeze\(\[([^\]]*)\]\)/
        .exec(helper)?.[1]
        ?.match(/'([^']+)'/g)
        ?.map((name) => name.slice(1, -1)) ?? [];
    expect(listed.sort()).toEqual(Object.keys(services).sort());
    const spawning = filesBelow('tools', (path) => /\.(mjs|ts)$/.test(path) && !path.includes('/test/')).filter((path) =>
      /spawn(Sync)?\(\s*['"]docker['"]|exec(File)?(Sync)?\(\s*['"]docker['"]/.test(read(path)),
    );
    expect(spawning).toEqual(['tools/scan/lib/compose.mjs']);
  });

  it('EVM-006 AC1 (D4, RR-03; K4, RR-02): the committed agent settings ask before compose and settings edits, deny other Docker verbs and printing the gh token', () => {
    // The index, not the working tree: an unstaged local edit is not checked here (see RR-03); a weakened commit is.
    const settings = JSON.parse(staged('.claude/settings.json')) as unknown;
    expect(agentPermissionProblems(settings, Object.keys(services))).toEqual([]);
  });

  it('EVM-006 AC1 (W1): skipped builds — lefthook may not run its own install script; hooks come from the prepare script', () => {
    expect(record(record(yaml('pnpm-workspace.yaml'))['allowBuilds'])['lefthook']).toBe(false);
    expect(text(record(record(json('package.json'))['scripts'])['prepare'])).toBe('node tools/git-hooks/cli.mjs install');
  });
});
