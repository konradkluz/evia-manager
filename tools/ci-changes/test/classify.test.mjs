// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, isDocumentation } from '../lib/classify.mjs';

const BASE = 'a'.repeat(40);
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
    assert.equal(run(base), 'heavy=true');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'a.md'), 'x');
    git('add', 'docs');
    git('commit', '-qm', 'docs');
    assert.equal(run(base), 'heavy=false');
    writeFileSync(join(repo, 'b.ts'), 'x');
    git('add', 'b.ts');
    git('commit', '-qm', 'code');
    assert.equal(run(base), 'heavy=true');
    assert.equal(run('f'.repeat(40)), 'heavy=true');
    // moving a code file into docs/ must not look like a documentation-only change (rename detection off)
    const moved = git('rev-parse', 'HEAD');
    git('mv', 'b.ts', 'docs/b.ts');
    git('commit', '-qm', 'move code into docs');
    assert.equal(run(moved), 'heavy=true');
  });
});
