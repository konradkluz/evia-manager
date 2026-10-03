// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { analyze } from '../lib/analyze.mjs';
import { ToolError } from '../lib/errors.mjs';
import { loadRepository, readRegularFile, runGit } from '../lib/repository.mjs';
import { baseFiles, codes, config, doc, TODAY } from './helpers/fixtures.mjs';
import { createTempRepo } from './helpers/temp-repo.mjs';

/**
 * @param {import('./helpers/temp-repo.mjs').TempRepo} repo
 * @param {string} [cwd]
 */
const load = (repo, cwd = repo.root) => loadRepository({ cwd, env: repo.env, config });

describe('lista plików z gita i odczyt (EVM-012, ustalenia E, F)', () => {
  it('EVM-012 AC3: zbiór = pliki śledzone i nieignorowane; bez ignorowanych i usuniętych z dysku', () => {
    const repo = createTempRepo({
      files: { 'docs/a.md': '# A\n', 'docs/usuniety.md': '# U\n', 'node_modules/x/README.md': '# X\n' },
      gitignore: '.scratch/\nnode_modules/\n',
      tracked: ['docs/a.md', 'docs/usuniety.md'],
    });
    try {
      rmSync(join(repo.root, 'docs', 'usuniety.md'));
      const loaded = load(repo);
      assert.deepEqual([...loaded.paths].sort(), ['.gitignore', 'docs/a.md']);
      assert.equal(loaded.scratchIgnored, true);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: plik w .scratch/ dodany przez git add -f jest widoczny dla gita', () => {
    const repo = createTempRepo({ files: { '.scratch/notatka.md': '# R\n', '.scratch/inny.md': '# I\n' }, tracked: ['.scratch/notatka.md'] });
    try {
      const loaded = load(repo);
      assert.ok(loaded.paths.includes('.scratch/notatka.md'));
      assert.ok(!loaded.paths.includes('.scratch/inny.md'));
      assert.equal(loaded.scratchIgnored, true);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: .scratch/ ignorowany niezależnie od tego, czy katalog istnieje; bez wpisu w .gitignore — nieignorowany', () => {
    const withRule = createTempRepo({});
    const withoutRule = createTempRepo({ gitignore: 'node_modules/\n', files: { '.scratch/notatka.md': '# R\n' } });
    try {
      assert.equal(load(withRule).scratchIgnored, true);
      mkdirSync(join(withRule.root, '.scratch'));
      assert.equal(load(withRule).scratchIgnored, true);
      const loaded = load(withoutRule);
      assert.equal(loaded.scratchIgnored, false);
      assert.ok(loaded.paths.includes('.scratch/notatka.md'));
    } finally {
      withRule.cleanup();
      withoutRule.cleanup();
    }
  });

  it('EVM-012 AC3: polskie znaki w nazwach, CRLF i BOM w plikach na dysku — wynik jak dla LF', () => {
    const crlf = doc({ lifecycle: 'milestone', milestone: 'M9' }).replace(/\n/g, '\r\n');
    const repo = createTempRepo({
      files: { ...baseFiles(), 'docs/notatka-łódź.md': '# Ż\n', 'docs/notes/źle.md': `﻿${crlf}` },
    });
    try {
      const analysis = analyze(load(repo), { config, today: TODAY });
      assert.deepEqual(codes(analysis, 'error'), [
        'location-forbidden docs/notatka-łódź.md',
        'milestone-unknown docs/notes/źle.md',
      ]);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: uruchomienie z podkatalogu sprawdza całe repozytorium', () => {
    const repo = createTempRepo({ files: { 'README.md': '# R\n', 'docs/process/a.md': '# A\n' } });
    try {
      const loaded = load(repo, join(repo.root, 'docs', 'process'));
      assert.deepEqual([...loaded.paths].sort(), ['.gitignore', 'README.md', 'docs/process/a.md']);
      assert.equal(loaded.read('README.md'), '# R\n');
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: środowisko (env) trafia do każdego wywołania gita — np. globalny core.excludesFile', () => {
    const repo = createTempRepo({ files: { 'docs/a.md': '# A\n', 'docs/b.md': '# B\n' } });
    try {
      const ignoreFile = join(repo.base, 'global-ignore');
      writeFileSync(ignoreFile, 'docs/b.md\n');
      writeFileSync(String(repo.env.GIT_CONFIG_GLOBAL), `[core]\n\texcludesFile = ${ignoreFile.replace(/\\/g, '/')}\n`);
      assert.deepEqual([...load(repo).paths].sort(), ['.gitignore', 'docs/a.md']);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: katalog bez repozytorium git — błąd środowiska po polsku', () => {
    const repo = createTempRepo({ init: false, gitignore: null });
    try {
      assert.throws(() => load(repo), (error) => error instanceof ToolError && /brak repozytorium git/.test(error.message));
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC5: tylko odczyt — git uruchamiany wyłącznie z listy dozwolonych poleceń', () => {
    for (const command of ['status', 'commit', 'rm', 'add', 'checkout', 'config']) {
      assert.throws(() => runGit([command], { cwd: '.', env: process.env }), (error) => error instanceof ToolError && /niedozwolone/.test(error.message));
    }
  });

  it('EVM-012 AC3: brak możliwości uruchomienia gita — błąd środowiska', () => {
    const repo = createTempRepo({});
    try {
      assert.throws(
        () => runGit(['rev-parse', '--show-toplevel'], { cwd: join(repo.base, 'nie-istnieje'), env: repo.env }),
        (error) => error instanceof ToolError && /nie można uruchomić git/.test(error.message),
      );
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: błąd ls-files albo check-ignore — błąd środowiska, nie wynik walidacji', () => {
    /**
     * @param {string} failing
     * @returns {import('../lib/repository.mjs').GitRunner}
     */
    const fakeGit = (failing) => (args) => {
      if (args[0] === failing) return { status: 128, stdout: '', stderr: 'fatal: awaria' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${process.cwd()}\n`, stderr: '' };
      if (args[0] === 'check-ignore') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: 'a.md\0', stderr: '' };
    };
    for (const failing of ['ls-files', 'check-ignore']) {
      assert.throws(
        () => loadRepository({ cwd: '.', env: process.env, config, git: fakeGit(failing) }),
        (error) => error instanceof ToolError && /fatal: awaria/.test(error.message),
        failing,
      );
    }
  });

  it('EVM-012 AC3: odczyt bez podążania za dowiązaniami; błąd odczytu = błąd środowiska', () => {
    /** @param {boolean} isFile */
    const fakeFs = (isFile) => ({
      lstatSync: () => ({ isFile: () => isFile }),
      readFileSync: () => 'treść',
    });
    assert.equal(readRegularFile('/x/a.md', 'a.md', /** @type {any} */ (fakeFs(false))), null);
    assert.equal(readRegularFile('/x/a.md', 'a.md', /** @type {any} */ (fakeFs(true))), 'treść');
    const failing = {
      lstatSync: () => {
        throw new Error('EACCES');
      },
      readFileSync: () => '',
    };
    assert.throws(
      () => readRegularFile('/x/a.md', 'docs/a.md', /** @type {any} */ (failing)),
      (error) => error instanceof ToolError && /docs\/a\.md/.test(error.message),
    );
  });
});
