// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, isDocumentation, isNotRelevantToE2e, isNotRelevantToIntegration } from '../lib/classify.mjs';

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
      return readFileSync(out, 'utf8').trim();
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
