// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createTempRepo, isolatedEnv, snapshotRepo } from './helpers/temp-repo.mjs';

describe('pomocnik: tymczasowe repozytorium git (EVM-012, ustalenie G)', () => {
  it('EVM-012 AC3: plik dodany przez git add -f jest widoczny dla gita, plik w ignorowanym .scratch/ nie', () => {
    const repo = createTempRepo({
      files: { 'docs/a.md': '# A\n', '.scratch/roboczy.md': '# R\n', '.scratch/sledzony.md': '# S\n' },
      tracked: ['.scratch/sledzony.md'],
    });
    try {
      const cached = repo.git('ls-files', '--cached').trim().split('\n');
      const others = repo.git('ls-files', '--others', '--exclude-standard').trim().split('\n');
      assert.deepEqual(cached, ['.scratch/sledzony.md']);
      assert.deepEqual(others.sort(), ['.gitignore', 'docs/a.md']);
    } finally {
      repo.cleanup();
    }
    assert.equal(existsSync(repo.base), false);
  });

  it('EVM-012 AC3: środowisko gita nie dziedziczy GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE ani konfiguracji globalnej', () => {
    const base = mkdtempSync(join(tmpdir(), 'evm-012-env-'));
    const saved = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = join(base, 'obcy-index');
    try {
      const env = isolatedEnv(base);
      assert.equal(env.GIT_INDEX_FILE, undefined);
      assert.equal(env.GIT_DIR, undefined);
      assert.equal(env.GIT_WORK_TREE, undefined);
      assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
      assert.equal(env.GIT_CONFIG_GLOBAL, join(base, 'gitconfig-global'));
    } finally {
      if (saved === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = saved;
      rmSync(base, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  it('EVM-012 AC5: migawka obejmuje pliki, katalogi i git status, bez katalogu .git', () => {
    const repo = createTempRepo({ files: { 'docs/a.md': '# A\n' } });
    try {
      const snapshot = snapshotRepo(repo);
      assert.ok(snapshot.files.some((line) => line.startsWith('docs/a.md ')));
      assert.ok(snapshot.files.includes('docs/'));
      assert.ok(!snapshot.files.some((line) => line.startsWith('.git/')));
      assert.match(snapshot.status, /\?\? docs\/a\.md/);
    } finally {
      repo.cleanup();
    }
  });
});
