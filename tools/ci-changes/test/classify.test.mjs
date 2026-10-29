// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detect,
  detectDeployment,
  isDocumentation,
  isIacInput,
  isNotRelevantToE2e,
  isNotRelevantToIntegration,
  isPublishInput,
} from '../lib/classify.mjs';

const BASE = 'a'.repeat(40);
const FULL = 'heavy=true\ne2e=true\nintegration=true\nmobile=true';
const NONE = 'heavy=false\ne2e=false\nintegration=false\nmobile=false';
/** Code outside the Android package: every job but mobile-apk runs. */
const CODE_NOT_MOBILE = 'heavy=true\ne2e=true\nintegration=true\nmobile=false';
/** @param {...string} files */
const list =
  (...files) =>
  () =>
    files.join('\0') + '\0';

describe('EVM-083 AC2: documentation-only detection', () => {
  it('EVM-083 AC2: docs/ and root Markdown are documentation, everything else is not', () => {
    for (const path of ['docs/backlog/M0/EVM-083.md', 'docs/ux/mock.png', 'README.md', 'CLAUDE.md'])
      assert.equal(isDocumentation(path), true, path);
    for (const path of [
      '.github/workflows/ci.yml',
      'apps/web/README.md',
      'tools/x.mjs',
      'docs/../apps/a.ts',
      'docs\\a.md',
      '.claude/agents/a.md',
      'package.json',
    ])
      assert.equal(isDocumentation(path), false, path);
  });

  it('EVM-083 AC2: only documentation changed -> heavy jobs skipped', () => {
    const result = detect({ eventName: 'pull_request', baseSha: BASE, diff: list('docs/a.md', 'README.md') });
    assert.equal(result.heavy, false);
  });

  it('EVM-083 AC2: a mixed change (documentation + code) -> full set', () => {
    assert.equal(detect({ eventName: 'pull_request', baseSha: BASE, diff: list('docs/a.md', 'apps/api/src/a.ts') }).heavy, true);
    assert.equal(detect({ eventName: 'push', baseSha: BASE, diff: list('.github/workflows/ci.yml') }).heavy, true);
  });

  it('EVM-083 AC3: a push (to main) with documentation only still runs the full set', () => {
    assert.equal(detect({ eventName: 'push', baseSha: BASE, diff: list('docs/a.md') }).heavy, true);
  });
});

describe('EVM-083 AC3: fail-closed detection', () => {
  it('EVM-083 AC3: a diff error, an empty diff, a missing or zero base and other events -> full set', () => {
    const boom = () => {
      throw new Error('git failed');
    };
    assert.equal(detect({ eventName: 'pull_request', baseSha: BASE, diff: boom }).heavy, true);
    assert.equal(detect({ eventName: 'pull_request', baseSha: BASE, diff: () => '' }).heavy, true);
    assert.equal(detect({ eventName: 'pull_request', baseSha: '', diff: list('docs/a.md') }).heavy, true);
    assert.equal(detect({ eventName: 'pull_request', baseSha: '0'.repeat(40), diff: list('docs/a.md') }).heavy, true);
    assert.equal(detect({ eventName: 'pull_request', baseSha: 'not-a-sha', diff: list('docs/a.md') }).heavy, true);
    assert.equal(detect({ eventName: 'workflow_dispatch', baseSha: BASE, diff: list('docs/a.md') }).heavy, true);
    assert.equal(detect({ eventName: '', baseSha: BASE, diff: list('docs/a.md') }).heavy, true);
  });

  it('EVM-083 AC3: the CLI writes heavy=false only for a real documentation-only git diff, otherwise heavy=true', () => {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const repo = mkdtempSync(join(tmpdir(), 'ci-changes-'));
    /** @param {...string} args */
    const git = (...args) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), '1');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    /** @param {string} baseSha */
    const run = (baseSha) => {
      const out = join(repo, 'out.txt');
      writeFileSync(out, '');
      const env = { ...process.env, EVENT_NAME: 'pull_request', BASE_SHA: baseSha, GITHUB_OUTPUT: out };
      execFileSync(process.execPath, [cli], { cwd: repo, env, stdio: 'pipe' });
      // the outputs of EVM-083/086; iac and publish (EVM-007) are checked by their own CLI test below
      return readFileSync(out, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => !/^(iac|publish)=/.test(line))
        .join('\n');
    };
    git('commit', '-q', '--allow-empty', '-m', 'empty');
    assert.equal(run(base), FULL);
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'a.md'), 'x');
    git('add', 'docs');
    git('commit', '-qm', 'docs');
    assert.equal(run(base), NONE);
    writeFileSync(join(repo, 'b.ts'), 'x');
    git('add', 'b.ts');
    git('commit', '-qm', 'code');
    assert.equal(run(base), CODE_NOT_MOBILE);
    assert.equal(run('f'.repeat(40)), FULL);
    // moving a code file into docs/ must not look like a documentation-only change (rename detection off)
    const moved = git('rev-parse', 'HEAD');
    git('mv', 'b.ts', 'docs/b.ts');
    git('commit', '-qm', 'move code into docs');
    assert.equal(run(moved), CODE_NOT_MOBILE);
  });
});

/** @param {...string} files */
const pr = (...files) => detect({ eventName: 'pull_request', baseSha: BASE, diff: list(...files) });

describe('EVM-086 AC1: explicit lists of paths not relevant to a job', () => {
  it('EVM-086 AC1: api-only and mobile-only changes skip e2e-web; web-only and mobile-only changes skip backend-integration', () => {
    assert.deepEqual(
      [pr('apps/api/src/a.ts').heavy, pr('apps/api/src/a.ts').e2e, pr('apps/api/src/a.ts').integration],
      [true, false, true],
    );
    assert.deepEqual(
      [pr('apps/web/src/a.ts').heavy, pr('apps/web/src/a.ts').e2e, pr('apps/web/src/a.ts').integration],
      [true, true, false],
    );
    const mobile = pr('apps/mobile/app/a.tsx', 'docs/a.md');
    assert.deepEqual([mobile.heavy, mobile.e2e, mobile.integration], [true, false, false]);
    const docs = pr('docs/a.md', 'README.md');
    assert.deepEqual([docs.heavy, docs.e2e, docs.integration], [false, false, false]);
  });

  it('EVM-091: packages/sync-core is not relevant to e2e-web and backend-integration, but still runs the quality gate (heavy)', () => {
    const syncCore = pr('packages/sync-core/src/engine.ts');
    assert.deepEqual([syncCore.heavy, syncCore.e2e, syncCore.integration], [true, false, false]);
    const withLock = pr('packages/sync-core/src/engine.ts', 'pnpm-lock.yaml');
    assert.deepEqual([withLock.heavy, withLock.e2e, withLock.integration], [true, true, true]);
    assert.equal(isNotRelevantToE2e('packages/sync-core-evil/a.ts'), false);
  });

  it('EVM-086 AC1: paths that are never "not relevant" run both jobs', () => {
    for (const path of [
      'packages/contracts/src/a.ts',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.github/workflows/ci.yml',
      'tools/ci-changes/cli.mjs',
      'compose.yaml',
      'compose.dev.yaml',
      'package.json',
      'turbo.json',
      '.claude/agents/a.md',
      'services/x/a.ts',
      'unknown/new/file.txt',
    ]) {
      assert.equal(isNotRelevantToE2e(path), false, path);
      assert.equal(isNotRelevantToIntegration(path), false, path);
      const result = pr(path);
      assert.deepEqual([result.heavy, result.e2e, result.integration], [true, true, true], path);
    }
  });

  it('EVM-086 AC1, AC2: a mixed change skips a job only when EVERY file is not relevant to it', () => {
    const apiDocs = pr('apps/api/src/a.ts', 'docs/a.md');
    assert.deepEqual([apiDocs.e2e, apiDocs.integration], [false, true]);
    const webOther = pr('apps/web/src/a.ts', 'packages/ui/a.ts');
    assert.deepEqual([webOther.e2e, webOther.integration], [true, true]);
    const webApi = pr('apps/web/src/a.ts', 'apps/api/src/a.ts');
    assert.deepEqual([webApi.e2e, webApi.integration], [true, true]);
    const webMobile = pr('apps/web/src/a.ts', 'apps/mobile/a.ts');
    assert.deepEqual([webMobile.e2e, webMobile.integration], [true, false]);
  });
});

describe('EVM-086 AC2: fail-closed', () => {
  it('EVM-086 AC2: suspicious paths (.., backslash, control characters, absolute, empty) are never "not relevant"', () => {
    for (const path of [
      'apps/api/../web/a.ts',
      'apps\\api\\a.ts',
      'apps/api/a\nb.ts',
      'apps/api/a\u0001.ts',
      '/apps/api/a.ts',
      'apps/mobile/\u007f',
    ]) {
      assert.equal(isNotRelevantToE2e(path), false, JSON.stringify(path));
      assert.equal(isNotRelevantToIntegration(path), false, JSON.stringify(path));
    }
    assert.equal(isNotRelevantToE2e(''), false);
    const result = pr('apps/api/../web/a.ts');
    assert.deepEqual([result.heavy, result.e2e, result.integration], [true, true, true]);
  });

  it('EVM-086 AC2: a diff error, an empty or missing base, an empty diff and other events give true for every output', () => {
    const boom = () => {
      throw new Error('git failed');
    };
    const inputs = [
      { eventName: 'pull_request', baseSha: BASE, diff: boom },
      { eventName: 'pull_request', baseSha: BASE, diff: () => '' },
      { eventName: 'pull_request', baseSha: '', diff: list('apps/api/a.ts') },
      { eventName: 'pull_request', baseSha: '0'.repeat(40), diff: list('apps/api/a.ts') },
      { eventName: 'pull_request', baseSha: 'zzz', diff: list('apps/api/a.ts') },
      { eventName: 'workflow_dispatch', baseSha: BASE, diff: list('apps/api/a.ts') },
      { eventName: 'schedule', baseSha: BASE, diff: list('docs/a.md') },
      { eventName: '', baseSha: BASE, diff: list('docs/a.md') },
    ];
    for (const input of inputs) {
      const result = detect(input);
      assert.deepEqual([result.heavy, result.e2e, result.integration], [true, true, true], input.eventName);
    }
  });

  it('EVM-086 AC4: a push to main runs everything even for a change limited to apps/api or docs', () => {
    for (const file of ['apps/api/a.ts', 'apps/web/a.ts', 'docs/a.md']) {
      const result = detect({ eventName: 'push', baseSha: BASE, diff: list(file) });
      assert.deepEqual([result.heavy, result.e2e, result.integration], [true, true, true], file);
    }
  });
});

/** @param {string} eventName @param {...string} files */
const deployment = (eventName, ...files) => detectDeployment({ eventName, baseSha: BASE, diff: list(...files) });

describe('EVM-007 AC1: iac-check only for changes of the IaC code, its container, compose files or workflows', () => {
  it('EVM-007 AC1: a pull request changing infra/tofu, the iac container, compose files or .github runs iac-check', () => {
    for (const path of [
      'infra/tofu/staging/main.tf',
      'infra/docker/iac/check.sh',
      'infra/deploy-agent/deploy.sh',
      'infra/docker/deploy-tests/Dockerfile',
      'compose.yaml',
      'compose.iac.yaml',
      '.github/workflows/ci.yml',
    ])
      assert.equal(deployment('pull_request', 'docs/a.md', path).iac, true, path);
    for (const path of ['apps/api/a.ts', 'docs/a.md', 'infra/runtime/compose.staging.yaml', 'tools/x.mjs'])
      assert.equal(deployment('pull_request', path).iac, false, path);
  });

  it('EVM-007 AC1: fail closed — a push to main, other events, a bad base, a diff error, an empty diff or a suspicious path run iac-check', () => {
    const boom = () => {
      throw new Error('git failed');
    };
    assert.equal(deployment('push', 'docs/a.md').iac, true);
    assert.equal(deployment('workflow_dispatch', 'docs/a.md').iac, true);
    assert.equal(deployment('', 'docs/a.md').iac, true);
    assert.equal(detectDeployment({ eventName: 'pull_request', baseSha: '', diff: list('docs/a.md') }).iac, true);
    assert.equal(detectDeployment({ eventName: 'pull_request', baseSha: '0'.repeat(40), diff: list('docs/a.md') }).iac, true);
    assert.equal(detectDeployment({ eventName: 'pull_request', baseSha: BASE, diff: boom }).iac, true);
    assert.equal(detectDeployment({ eventName: 'pull_request', baseSha: BASE, diff: () => '' }).iac, true);
    assert.equal(deployment('pull_request', 'docs/../infra/tofu/a.tf').iac, true);
    assert.equal(isIacInput('infra\\tofu\\a.tf'), true);
  });
});

describe('EVM-007 AC2: publish only for a push to main changing a build input of the images', () => {
  it('EVM-007 AC2: apps/, packages/, infra/, the lockfile and the other build inputs publish on a push', () => {
    for (const path of [
      'apps/api/src/a.ts',
      'apps/web/src/a.tsx',
      'packages/contracts/openapi.yaml',
      'infra/images/api/Dockerfile',
      'infra/runtime/compose.staging.yaml',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'package.json',
      'design/tokens/tokens.json',
      'patches/busboy@1.6.0.patch',
    ])
      assert.equal(deployment('push', 'docs/a.md', path).publish, true, path);
  });

  it('EVM-007 AC2: documentation, tools and workflows alone do not publish; pull requests and other events never publish', () => {
    for (const path of ['docs/a.md', 'README.md', 'tools/x.mjs', '.github/workflows/ci.yml', '.claude/agents/a.md'])
      assert.equal(deployment('push', path).publish, false, path);
    for (const event of ['pull_request', 'workflow_dispatch', 'schedule', ''])
      assert.equal(deployment(event, 'apps/api/src/a.ts').publish, false, event);
  });

  it('EVM-007 AC2: fail closed for a push — a bad or zero base, a diff error, an empty diff or a suspicious path publish', () => {
    const boom = () => {
      throw new Error('git failed');
    };
    assert.equal(detectDeployment({ eventName: 'push', baseSha: '', diff: list('docs/a.md') }).publish, true);
    assert.equal(detectDeployment({ eventName: 'push', baseSha: '0'.repeat(40), diff: list('docs/a.md') }).publish, true);
    assert.equal(detectDeployment({ eventName: 'push', baseSha: BASE, diff: boom }).publish, true);
    assert.equal(detectDeployment({ eventName: 'push', baseSha: BASE, diff: () => '' }).publish, true);
    assert.equal(deployment('push', 'docs/../apps/api/a.ts').publish, true);
    assert.equal(isPublishInput('docs/a\u0001.md'), true);
  });

  it('EVM-007 AC1, AC2: the CLI writes iac and publish next to the other outputs', () => {
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const repo = mkdtempSync(join(tmpdir(), 'ci-changes-deploy-'));
    /** @param {...string} args */
    const git = (...args) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), '1');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, 'apps'));
    writeFileSync(join(repo, 'apps', 'a.ts'), 'x');
    git('add', 'apps');
    git('commit', '-qm', 'code');
    /** @param {string} event */
    const run = (event) => {
      const out = join(repo, 'out.txt');
      writeFileSync(out, '');
      const env = { ...process.env, EVENT_NAME: event, BASE_SHA: base, GITHUB_OUTPUT: out };
      execFileSync(process.execPath, [cli], { cwd: repo, env, stdio: 'pipe' });
      return readFileSync(out, 'utf8').trim().split('\n');
    };
    // The outputs of detect() (heavy, e2e, integration, mobile) come first; iac and publish are the last two.
    assert.deepEqual(run('push').slice(-2), ['iac=true', 'publish=true']);
    assert.deepEqual(run('pull_request').slice(-2), ['iac=false', 'publish=false']);
    assert.deepEqual(
      run('push').map((line) => line.split('=')[0]),
      ['heavy', 'e2e', 'integration', 'mobile', 'iac', 'publish'],
    );
  });
});
