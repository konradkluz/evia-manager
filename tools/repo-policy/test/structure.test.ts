/**
 * Monorepo structure, workspaces, versions and supply chain on the real repository (EVM-006 AC1, AC2, AC3, AC6;
 * ADR-0012, ADR-0015; W1–W4; SR-SUPPLY-01, SR-SUPPLY-03).
 */
import { describe, expect, it } from 'vitest';
import { exists, filesBelow, jsonc, json, list, read, record, workspaces, yaml } from '../src/files.ts';

interface Manifest {
  name?: string;
  private?: boolean;
  type?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = (path: string): Manifest => json(path) as Manifest;
const root = manifest('package.json');
const WORKSPACES = workspaces();
const PNPM = /^pnpm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]{128}$/.exec(root.packageManager ?? '');

/** Only this workspace may relax shared checks — debt for EVM-013 (W2). */
const RELAXED = new Set(['tools/docs-lifecycle']);
/** Tools that run without installed dependencies (CI jobs and the container entry point run them before `pnpm install`). */
const DEPENDENCY_FREE = [
  'tools/container',
  'tools/diff-coverage',
  'tools/docs-lifecycle',
  'tools/git-hooks',
  'tools/main-integrity',
  'tools/scan',
];
/** Tests that read the whole repository and today's date (exception expiry, document classes) — never cached. */
const UNCACHED_TESTS = ['tools/docs-lifecycle', 'tools/repo-policy'];
/** A module that resolves the repository root from its own location (`new URL('../../..', import.meta.url)`). */
const ROOT_REFERENCE = /new URL\(\s*['"]\.\.\/\.\.\/\.\.(?:\/|['"])/;

describe('monorepo structure (EVM-006 AC1, ADR-0012)', () => {
  it('EVM-006 AC1: configuration of the monorepo, quality and scans is in place', () => {
    for (const path of [
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'turbo.json',
      '.nvmrc',
      '.gitattributes',
      '.editorconfig',
      '.prettierrc.json',
      '.prettierignore',
      '.dependency-cruiser.cjs',
      'lefthook.yml',
      'compose.yaml',
      '.env.example',
      'renovate.json',
      '.gitleaks.toml',
      '.gitleaksignore',
      'osv-scanner.toml',
      'trivy.yaml',
      '.trivyignore.yaml',
      'zizmor.yml',
      '.semgrepignore',
      '.github/workflows/ci.yml',
      '.github/workflows/main-integrity.yml',
      '.github/workflows/nightly.yml',
      '.github/workflows/renovate.yml',
      '.github/CODEOWNERS',
      '.github/pull_request_template.md',
      'infra/docker/backend-tests/Dockerfile',
      'infra/docker/backend-tests/.dockerignore',
    ]) {
      expect(exists(path), path).toBe(true);
    }
    for (const path of ['package-lock.json', 'yarn.lock', '.npmrc']) expect(exists(path), path).toBe(false);
  });

  it('EVM-006 AC1: workspaces exist only where there is content (YAGNI) and follow apps/services/packages/tools', () => {
    expect(WORKSPACES).toEqual([
      'packages/config',
      'packages/tokens',
      'tools/container',
      'tools/diff-coverage',
      'tools/docs-lifecycle',
      'tools/git-hooks',
      'tools/main-integrity',
      'tools/repo-policy',
      'tools/scan',
    ]);
    expect(list(record(yaml('pnpm-workspace.yaml'))['packages'])).toEqual(['apps/*', 'services/*', 'packages/*', 'tools/*']);
  });

  it('EVM-006 AC1 (W4): every workspace is private, named @evia/<directory> and has a README', () => {
    expect(root.private).toBe(true);
    for (const workspace of WORKSPACES) {
      const pkg = manifest(`${workspace}/package.json`);
      expect(pkg.private, workspace).toBe(true);
      expect(pkg.name, workspace).toBe(`@evia/${workspace.split('/')[1] ?? ''}`);
      expect(pkg.type, workspace).toBe('module');
      expect(exists(`${workspace}/README.md`), workspace).toBe(true);
    }
  });
});

describe('quality gate of every workspace (EVM-006 AC2, AC3; W2, W3)', () => {
  it('EVM-006 AC2: each workspace with code has lint, typecheck and test:coverage', () => {
    for (const workspace of WORKSPACES) {
      const scripts = manifest(`${workspace}/package.json`).scripts ?? {};
      for (const script of ['lint', 'typecheck', 'test:coverage']) expect(scripts[script], `${workspace} ${script}`).toBeTruthy();
    }
  });

  it('EVM-006 AC3: coverage thresholds are enforced — Vitest with --coverage and the shared preset, node:test through evia-node-test', () => {
    for (const workspace of WORKSPACES) {
      const command = manifest(`${workspace}/package.json`).scripts?.['test:coverage'] ?? '';
      if (command.startsWith('vitest')) {
        expect(command, workspace).toBe('vitest run --coverage');
        const config = exists(`${workspace}/vitest.config.ts`) ? read(`${workspace}/vitest.config.ts`) : '';
        expect(config, workspace).toMatch(/coverage: coverage\(\{ layer: 'shared', include: \['src\/\*\*\/\*\.ts'\] \}\)/);
      } else {
        expect(command, workspace).toBe('evia-node-test');
      }
    }
  });

  it('EVM-006 AC2 (W2): shared checks are relaxed only in the listed workspace (EVM-013 debt)', () => {
    for (const workspace of WORKSPACES) {
      const eslint = read(`${workspace}/eslint.config.js`);
      const tsconfig = record(jsonc(`${workspace}/tsconfig.json`));
      const options = record(tsconfig['compilerOptions']);
      const relaxed = eslint.includes("'off'") || Object.values(options).includes(false) || options['strict'] === false;
      if (relaxed) expect(RELAXED.has(workspace), `${workspace} relaxes shared checks`).toBe(true);
      expect(eslint, workspace).toMatch(/config\(\{ tsconfigRootDir: import\.meta\.dirname \}\)/);
    }
  });

  it('EVM-006 AC3 (W3a): one source of coverage exclusions for Vitest, node:test and diff-coverage', () => {
    expect(read('packages/config/src/vitest.ts')).toContain('exclude: coverageExclusions()');
    expect(read('packages/config/src/node-test.ts')).toContain('coverageExclusions().map');
    expect(read('tools/diff-coverage/lib/main.mjs')).toContain(
      "export const EXCLUSIONS_FILE = 'packages/config/coverage-exclusions.json';",
    );
  });

  it('EVM-006 AC3 (W3b, B7): the gate checks hooks, removes stale reports first, then runs native, container and changed-code stages', () => {
    expect(root.scripts?.['gate']).toBe(
      'node tools/git-hooks/cli.mjs check && node tools/diff-coverage/cli.mjs clean && pnpm run gate:native && docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend && pnpm run coverage:diff',
    );
    expect(root.scripts?.['gate:native']).toBe('pnpm run format:check && turbo run lint typecheck test:coverage && pnpm run deps:check');
    expect(root.scripts?.['gate:backend']).toBe('turbo run lint typecheck test:coverage --filter=./packages/*');
    const tasks = record(record(json('turbo.json'))['tasks']);
    expect(record(tasks['test:coverage'])['outputs']).toEqual(['coverage/**']);
  });

  it('EVM-006 AC2: tests reading the repository outside their workspace are never replayed from the Turborepo cache', () => {
    // Turborepo hashes only the files of the workspace — a test reading compose.yaml, workflows, docs or today's
    // date would otherwise stay green from the cache after those change (QA / code review of EVM-006).
    const tasksOf = (workspace: string): Record<string, unknown> =>
      exists(`${workspace}/turbo.json`) ? record(record(json(`${workspace}/turbo.json`))['tasks']) : {};
    for (const workspace of UNCACHED_TESTS) {
      expect(list(record(json(`${workspace}/turbo.json`))['extends']), workspace).toEqual(['//']);
      for (const task of ['test', 'test:coverage']) expect(record(tasksOf(workspace)[task])['cache'], `${workspace} ${task}`).toBe(false);
    }
    const readsRoot = (workspace: string): boolean =>
      ['src', 'lib', 'test']
        .flatMap((dir) => filesBelow(`${workspace}/${dir}`, (path) => /\.(ts|mts|mjs|js)$/.test(path)))
        .some((path) => ROOT_REFERENCE.test(read(path)));
    const detected = WORKSPACES.filter(readsRoot);
    expect(detected).toEqual(expect.arrayContaining(UNCACHED_TESTS));
    for (const workspace of detected) {
      for (const task of ['test', 'test:coverage']) {
        const config = record(tasksOf(workspace)[task]);
        const declared = list(config['inputs']).some((input) => String(input).startsWith('$TURBO_ROOT$/'));
        expect(config['cache'] === false || declared, `${workspace} ${task}: cache: false albo inputs z $TURBO_ROOT$/…`).toBe(true);
      }
    }
  });

  it('EVM-006 AC2 (W13): module boundaries cover every workspace root directory that exists', () => {
    const roots = ['apps', 'services', 'packages', 'tools'].filter((dir) => exists(dir));
    expect(root.scripts?.['deps:check']).toBe(`depcruise --config .dependency-cruiser.cjs ${roots.join(' ')}`);
    const config = read('.dependency-cruiser.cjs');
    for (const rule of ['no-circular', 'product-code-not-to-tools', 'packages-not-to-apps-or-services', 'tools-not-to-apps-or-services']) {
      expect(config).toContain(`name: '${rule}'`);
    }
  });

  it('EVM-006 AC2: dependency-free tools import only node:* and relative modules (they run before pnpm install)', () => {
    for (const workspace of DEPENDENCY_FREE) {
      const sources = [
        `${workspace}/cli.mjs`,
        `${workspace}/sync.mjs`,
        ...filesBelow(`${workspace}/lib`, (path) => path.endsWith('.mjs')),
      ].filter((path) => exists(path));
      expect(sources.length, workspace).toBeGreaterThan(0);
      for (const path of sources) {
        for (const match of read(path).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
          expect(match[1]?.startsWith('node:') === true || match[1]?.startsWith('.') === true, `${path}: ${String(match[1])}`).toBe(true);
        }
      }
    }
  });
});

describe('versions and supply chain (EVM-006 AC1; D1, SR-SUPPLY-01, -03, -04)', () => {
  it('EVM-006 AC1 (D1): one Node major in .nvmrc, engines, the backend-tests image and setup-node', () => {
    const major = read('.nvmrc').trim();
    expect(major).toBe('26');
    expect(root.engines?.['node']).toBe(`>=${major}.0.0 <${String(Number(major) + 1)}`);
    expect(read('infra/docker/backend-tests/Dockerfile')).toMatch(
      new RegExp(`^FROM node:${major}\\.\\d+\\.\\d+-trixie-slim@sha256:[0-9a-f]{64}$`, 'm'),
    );
    for (const workflow of ['ci.yml', 'main-integrity.yml', 'nightly.yml']) {
      const raw = read(`.github/workflows/${workflow}`);
      expect(raw.match(/uses: actions\/setup-node@/g)?.length, workflow).toBe(raw.match(/node-version-file: \.nvmrc/g)?.length);
    }
  });

  it('EVM-006 AC1: pnpm pinned by version and sha512 in packageManager; the same version in the image', () => {
    expect(PNPM).not.toBeNull();
    expect(read('infra/docker/backend-tests/Dockerfile')).toContain(`ARG PNPM_VERSION=${PNPM?.[1] ?? ''}`);
  });

  it('EVM-006 AC1 (SR-SUPPLY-01): pnpm supply-chain settings — never lowered', () => {
    const settings = record(yaml('pnpm-workspace.yaml'));
    expect(Number(settings['minimumReleaseAge'])).toBeGreaterThanOrEqual(1440);
    expect(settings['blockExoticSubdeps']).toBe(true);
    expect(settings['strictDepBuilds']).toBe(true);
    expect(settings['engineStrict']).toBe(true);
    expect(settings['savePrefix']).toBe('');
    expect(settings['minimumReleaseAgeExclude'] ?? []).toEqual([]);
    for (const key of ['dangerouslyAllowAllBuilds', 'ignoreScripts', 'trustPolicyExclude']) expect(settings[key], key).toBeUndefined();
    expect(record(settings['allowBuilds'])).toEqual({ lefthook: false });
  });

  it('EVM-006 AC1 (SR-SUPPLY-03, W4): dependencies are exact registry versions, catalog: or workspace:; @evia/* only via workspace:', () => {
    const catalog = record(record(yaml('pnpm-workspace.yaml'))['catalog']);
    for (const version of Object.values(catalog)) expect(String(version)).toMatch(/^\d+\.\d+\.\d+$/);
    for (const path of ['package.json', ...WORKSPACES.map((workspace) => `${workspace}/package.json`)]) {
      const pkg = manifest(path);
      for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (name.startsWith('@evia/')) expect(spec, `${path} ${name}`).toBe('workspace:*');
        else expect(spec, `${path} ${name}`).toMatch(/^(\d+\.\d+\.\d+|catalog:)$/);
      }
    }
  });

  it('EVM-006 AC1 (SR-SUPPLY-06): yaml is a devDependency of tools/repo-policy only', () => {
    for (const path of ['package.json', ...WORKSPACES.map((workspace) => `${workspace}/package.json`)]) {
      const pkg = manifest(path);
      const has = 'yaml' in { ...pkg.dependencies, ...pkg.devDependencies };
      expect(has, path).toBe(path === 'tools/repo-policy/package.json');
    }
  });
});

describe('design tokens contract (EVM-006 AC6, W4)', () => {
  it('EVM-006 AC6: @evia/tokens exports web CSS and mobile ESM with types, built from design/tokens by Turborepo', () => {
    const pkg = manifest('packages/tokens/package.json');
    expect(pkg.exports).toEqual({
      './web.css': './dist/web/tokens.css',
      './mobile': { types: './dist/mobile/tokens.d.ts', default: './dist/mobile/tokens.js' },
    });
    expect(pkg.scripts?.['build']).toBe('node src/cli.ts');
    const turbo = record(record(json('packages/tokens/turbo.json'))['tasks']);
    expect(list(record(turbo['build'])['inputs'])).toContain('$TURBO_ROOT$/design/tokens/**');
    expect(list(record(turbo['build'])['outputs'])).toEqual(['dist/**']);
  });
});
