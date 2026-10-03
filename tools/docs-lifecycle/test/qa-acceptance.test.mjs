// @ts-check
/**
 * Acceptance tests added by qa-engineer (EVM-012, QA round 1). They complement the developer's unit tests
 * with end-to-end checks of what Konrad sees:
 * - AC3: every violation from the AC, one per repository, through the real CLI process (exit code 1, path, Polish reason);
 * - AC4: warnings only → exit code 0 (real process); the Europe/Warsaw day boundary around both DST changes;
 * - AC5, AC6: the printed cleanup report for every milestone (parsed Markdown table), files unchanged;
 * - Windows 11: repository path with Polish characters and a space;
 * - AC8: the project's real .gitignore keeps `.scratch/` out of commits.
 * QA round 2 adds:
 * - AC2: an independent enumeration of `.md` files on disk (walk + `git check-ignore`) — none is missed by the validator;
 * - AC5: nothing changes under `.git` either (index with stale stat data), and the validator opens only `.md` files
 *   from the git set — never `.env*`, keys, spike code or screenshots („Bezpieczeństwo i prywatność”);
 * - AC1, AC7, AC8: anchors of the policy, the cleanup step and the agent instructions not covered before.
 * Synthetic data only; temporary repositories in the OS temp directory, removed after each test.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze } from '../lib/analyze.mjs';
import { todayInZone } from '../lib/dates.mjs';
import { loadRepository } from '../lib/repository.mjs';
import { runCli, runMain } from './helpers/cli.mjs';
import { baseFiles, config, doc, story, TODAY } from './helpers/fixtures.mjs';
import { parsePolicyRules, section } from './helpers/markdown.mjs';
import { createTempRepo, isolatedEnv, snapshotRepo } from './helpers/temp-repo.mjs';

/**
 * @typedef {object} ViolationCase
 * @property {string} name
 * @property {Record<string, string>} files added to the clean base repository
 * @property {string} path path reported in the error line
 * @property {RegExp} reason Polish reason expected in the error line
 * @property {string[]} [tracked] paths added with `git add -f`
 * @property {string} [gitignore] replaces the default `.gitignore` (`.scratch/`)
 */

/** Every violation listed in AC3 (plus the README of a spike and QA evidence without a story). */
/** @type {ViolationCase[]} */
const AC3_CASES = [
  {
    name: 'plik .md bez klasy',
    files: { 'docs/notes/bez-klasy.md': '# Notatka\n' },
    path: 'docs/notes/bez-klasy.md',
    reason: /brak klasy/,
  },
  {
    name: 'nieznana wartość klasy',
    files: { 'docs/notes/archiwum.md': doc({ lifecycle: 'archiwum' }) },
    path: 'docs/notes/archiwum.md',
    reason: /nieznana klasa „archiwum” w polu lifecycle — dozwolone wartości: permanent, living, milestone, ephemeral/,
  },
  {
    name: 'klasa „kamień milowy” bez M#',
    files: { 'docs/notes/plan.md': doc({ lifecycle: 'milestone' }) },
    path: 'docs/notes/plan.md',
    reason: /kamień milowy bez M#/,
  },
  {
    name: 'klasa „kamień milowy” z nieistniejącym M#',
    files: { 'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M9' }) },
    path: 'docs/notes/plan.md',
    reason: /nieistniejący kamień milowy „M9”/,
  },
  {
    name: 'klasa „kamień milowy” z M# w złym formacie',
    files: { 'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M-1' }) },
    path: 'docs/notes/plan.md',
    reason: /kamień milowy „M-1” w złym formacie/,
  },
  {
    name: 'README spike’a bez M#',
    files: { 'spikes/kolejka/README.md': '# Spike\n' },
    path: 'spikes/kolejka/README.md',
    reason: /kamień milowy bez M#/,
  },
  {
    name: 'dowód QA bez historyjki',
    files: { 'docs/qa/EVM-998/raport.md': '# QA\n' },
    path: 'docs/qa/EVM-998/raport.md',
    reason: /kamień milowy bez M# — brak historyjki EVM-998/,
  },
  ...['2026-13-01', '02.10.2026', '2026-02-30'].map((value) => ({
    name: `niepoprawna data ${value}`,
    files: { 'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M1', expires: value }) },
    path: 'docs/notes/plan.md',
    reason: new RegExp(`niepoprawna data w polu expires: „${value.replace(/\./g, '\\.')}” — wymagany format YYYY-MM-DD`),
  })),
  {
    name: 'plik trwały (ADR) z datą ważności',
    files: { 'docs/architecture/adr/0001-przyklad.md': doc({ expires: '2027-01-01' }, '# ADR-0001\n') },
    path: 'docs/architecture/adr/0001-przyklad.md',
    reason: /pole expires niedozwolone dla klasy trwały — sprzeczność/,
  },
  {
    name: 'plik żywy z datą ważności',
    files: { 'docs/product/cennik.md': doc({ expires: '2027-01-01' }) },
    path: 'docs/product/cennik.md',
    reason: /pole expires niedozwolone dla klasy żywy — sprzeczność/,
  },
  {
    name: 'luźna notatka w katalogu głównym',
    files: { 'notatka.md': '# Notatka\n' },
    path: 'notatka.md',
    reason: /plik poza dozwolonymi lokalizacjami/,
  },
  {
    name: 'luźna notatka w docs/ z polskimi znakami w nazwie',
    files: { 'docs/notatka-ąćęłńóśźż.md': '# Notatka\n' },
    path: 'docs/notatka-ąćęłńóśźż.md',
    reason: /plik poza dozwolonymi lokalizacjami/,
  },
  {
    name: 'plik roboczy w .scratch/ dodany do indeksu (git add -f)',
    files: { '.scratch/notatka.md': '# Robocza\n' },
    tracked: ['.scratch/notatka.md'],
    path: '.scratch/notatka.md',
    reason: /plik roboczy widoczny dla gita/,
  },
  {
    name: 'katalog .scratch/ nieignorowany przez git',
    files: {},
    gitignore: 'node_modules/\n',
    path: '.scratch/',
    reason: /nie jest ignorowany przez git/,
  },
  {
    name: 'plik z lifecycle: ephemeral w części śledzonej przez git',
    files: { 'docs/notes/szkic.md': doc({ lifecycle: 'ephemeral' }) },
    path: 'docs/notes/szkic.md',
    reason: /plik roboczy \(lifecycle: ephemeral\) w części repozytorium śledzonej przez git/,
  },
];

describe('QA: każde naruszenie z AC3 przez prawdziwy proces CLI (EVM-012 AC3)', () => {
  it('EVM-012 AC3: punkt odniesienia — repozytorium bazowe bez naruszeń kończy się kodem 0', () => {
    const repo = createTempRepo({ files: baseFiles() });
    try {
      const result = runCli(['check'], { cwd: repo.root, env: repo.env });
      assert.equal(result.code, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /BŁĄD/);
    } finally {
      repo.cleanup();
    }
  });

  for (const violation of AC3_CASES) {
    it(`EVM-012 AC3: ${violation.name} — wiersz BŁĄD ze ścieżką i powodem po polsku, kod wyjścia 1`, () => {
      const repo = createTempRepo({
        files: { ...baseFiles(), ...violation.files },
        tracked: violation.tracked,
        gitignore: violation.gitignore,
      });
      try {
        const result = runCli(['check'], { cwd: repo.root, env: repo.env });
        assert.equal(result.code, 1, `${result.stdout}${result.stderr}`);
        assert.equal(result.stderr, '');
        const errors = result.stdout.split('\n').filter((line) => line.startsWith('BŁĄD · '));
        assert.ok(
          errors.some((line) => line.startsWith(`BŁĄD · ${violation.path} · `) && violation.reason.test(line)),
          `brak wiersza BŁĄD dla ${violation.path}; są:\n${errors.join('\n')}`,
        );
        assert.match(result.stdout, /\nWynik: błędy \(\d+\) — popraw je przed oddaniem przyrostu/);
      } finally {
        repo.cleanup();
      }
    });
  }
});

describe('QA: ostrzeżenia i granica doby (EVM-012 AC4)', () => {
  it('EVM-012 AC4: same ostrzeżenia (przeterminowany z datą, osierocony) — kod wyjścia 0 (prawdziwy proces)', () => {
    const repo = createTempRepo({
      files: {
        ...baseFiles(),
        'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2020-01-01' }),
        'docs/product/cennik.md': doc({ review_by: '2020-01-01' }),
      },
    });
    try {
      const result = runCli(['check'], { cwd: repo.root, env: repo.env });
      assert.equal(result.code, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /BŁĄD/);
      assert.match(result.stdout, /^OSTRZEŻENIE · docs\/notes\/plan\.md · kamień milowy · przeterminowany: expires 2020-01-01 \(dzisiaj \d{4}-\d{2}-\d{2}\)/m);
      assert.match(result.stdout, /^OSTRZEŻENIE · docs\/product\/cennik\.md · żywy · przeterminowany: review_by 2020-01-01/m);
      assert.match(result.stdout, /^OSTRZEŻENIE · docs\/notes\/plan\.md · kamień milowy · osierocony/m);
      assert.match(result.stdout, /^OSTRZEŻENIE · docs\/product\/cennik\.md · żywy · osierocony/m);
      assert.match(result.stdout, /\nbłędy: 0 · ostrzeżenia: 4\n/);
      assert.match(result.stdout, /\nWynik: brak błędów; ostrzeżenia \(4\) do przejrzenia — nie blokują\n$/);
    } finally {
      repo.cleanup();
    }
  });

  /** [expires, last valid instant (UTC), first expired instant (UTC), the next day in Warsaw] */
  const DST_BOUNDARIES = [
    ['2027-03-27', '2027-03-27T22:59:59Z', '2027-03-27T23:00:00Z', '2027-03-28'], // CET (UTC+1), night before the spring change
    ['2027-03-28', '2027-03-28T21:59:59Z', '2027-03-28T22:00:00Z', '2027-03-29'], // 23-hour day, CEST (UTC+2) from 03:00
    ['2026-10-25', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', '2026-10-26'], // 25-hour day, CET (UTC+1) from 02:00
  ];

  for (const [expires, lastValid, firstExpired, nextDay] of DST_BOUNDARIES) {
    it(`EVM-012 AC4: expires ${expires} — granica doby Europe/Warsaw przy zmianie czasu (${lastValid} ważny, ${firstExpired} przeterminowany)`, () => {
      const repo = createTempRepo({
        files: {
          ...baseFiles(),
          'docs/README.md': '# D\n- process/workflow.md product/roadmap.md notes/plan.md\n',
          'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires }),
        },
      });
      try {
        const valid = runMain(['check'], { cwd: repo.root, env: repo.env, now: () => new Date(lastValid) });
        assert.equal(valid.code, 0);
        assert.match(valid.stdout, new RegExp(`Podsumowanie \\(${expires}, Europe/Warsaw\\)`));
        assert.doesNotMatch(valid.stdout, /przeterminowany/);
        const expired = runMain(['check'], { cwd: repo.root, env: repo.env, now: () => new Date(firstExpired) });
        assert.equal(expired.code, 0);
        assert.match(expired.stdout, new RegExp(`^OSTRZEŻENIE · docs/notes/plan\\.md · kamień milowy · przeterminowany: expires ${expires} \\(dzisiaj ${nextDay}\\)`, 'm'));
      } finally {
        repo.cleanup();
      }
    });
  }
});

/** Every kind of document from AC5 and AC6: all classes, milestone files of M0 and M1, expired and orphaned files. */
function lifecycleFiles() {
  return {
    ...baseFiles(), // includes story EVM-001 (M0, done) and EVM-101 (M1)
    'docs/README.md': '# Dokumentacja\n- process/workflow.md product/roadmap.md product/cennik.md\n- notes/plan-m0.md notes/plan-m1.md\n',
    // trwałe
    'docs/architecture/adr/0001-przyklad.md': '# ADR-0001\n- **Status:** Zaakceptowana\n',
    'docs/architecture/adr/0002-zastapiona.md': '# ADR-0002\n- **Status:** Zastąpiona przez ADR-0001\n',
    'docs/architecture/adr/0003-obnizona.md': doc({ lifecycle: 'milestone', milestone: 'M0' }, '# ADR-0003\n'),
    'docs/backlog/M0/EVM-011-spike.md': story('EVM-011', 'M0', 'done'),
    'docs/process/retros/M0.md': '# Retrospektywa M0\n',
    'docs/spikes/EVM-011-raport.md': '# Raport spike’a EVM-011\n',
    // żywe: przeterminowany termin przeglądu i sierota
    'docs/product/cennik.md': doc({ review_by: '2026-09-01' }, '# Cennik\n'),
    'docs/product/sierota-źdźbło.md': '# Sierota\n',
    // kamień milowy M0
    'docs/qa/EVM-001/raport.md': '# QA EVM-001\n',
    'docs/notes/plan-m0.md': doc({ lifecycle: 'milestone', milestone: 'M0' }),
    'spikes/kolejka/README.md': doc({ milestone: 'M0' }, '# Spike EVM-011\n'),
    'spikes/kolejka/kolejka.ts': 'export {};\n',
    // kamień milowy M1
    'docs/ux/reviews/EVM-101/raport.md': '# UX EVM-101\n',
    'docs/notes/plan-m1.md': doc({ lifecycle: 'milestone', milestone: 'M1' }),
  };
}

const PERMANENT = [
  'docs/architecture/adr/0001-przyklad.md',
  'docs/architecture/adr/0002-zastapiona.md',
  'docs/architecture/adr/0003-obnizona.md',
  'docs/backlog/M0/EVM-001-przyklad.md',
  'docs/backlog/M0/EVM-011-spike.md',
  'docs/process/retros/M0.md',
  'docs/spikes/EVM-011-raport.md',
];

/** Expected „usuń” items per milestone; everything else may only be „przejrzyj”. */
const REMOVALS = /** @type {Record<string, string[]>} */ ({
  M0: ['docs/notes/plan-m0.md', 'docs/qa/EVM-001/raport.md', 'spikes/kolejka/'],
  M1: ['docs/notes/plan-m1.md', 'docs/ux/reviews/EVM-101/raport.md'],
  M2: [],
});

/**
 * Rows of the printed cleanup report table.
 * @param {string} stdout
 * @returns {Array<{ path: string, cls: string, action: string, reason: string }>}
 */
function reportRows(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const match = /^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| (.+) \|$/.exec(line);
      assert.ok(match, `wiersz raportu w nieoczekiwanym formacie: ${line}`);
      return { path: match[1], cls: match[2].trim(), action: match[3].trim(), reason: match[4].trim() };
    });
}

describe('QA: wydruk raportu sprzątania dla każdego kamienia (EVM-012 AC5, AC6)', () => {
  it('EVM-012 AC5: raport M0 / M1 / M2 — „usuń” wyłącznie dla plików wskazanego M#, reszta to przeterminowane i osierocone; pliki bez zmian', () => {
    const repo = createTempRepo({ files: lifecycleFiles() });
    try {
      const before = snapshotRepo(repo);
      for (const [target, removals] of Object.entries(REMOVALS)) {
        const result = runMain(['cleanup-report', target], { cwd: repo.root, env: repo.env });
        assert.equal(result.code, 0, `${target}: ${result.stderr}`);
        const rows = reportRows(result.stdout);
        assert.deepEqual(
          rows.filter((row) => row.action === 'usuń').map((row) => row.path).sort(),
          [...removals].sort(),
          target,
        );
        assert.deepEqual(
          rows.filter((row) => row.action !== 'usuń').map((row) => `${row.action} ${row.path}`).sort(),
          ['przejrzyj docs/product/cennik.md', 'przejrzyj docs/product/sierota-źdźbło.md'],
          target,
        );
        for (const row of rows) {
          assert.ok(['usuń', 'archiwizuj', 'przejrzyj', 'zostaw'].includes(row.action), `${target}: ${row.action}`);
          assert.ok(['trwały', 'żywy', 'kamień milowy'].includes(row.cls), `${target}: ${row.cls}`);
          assert.ok(row.reason.length > 0, `${target}: ${row.path} bez uzasadnienia`);
        }
        assert.match(result.stdout, new RegExp(`Pozycje: ${rows.length} \\(usuń: ${removals.length}, przejrzyj: ${rows.length - removals.length}\\)\\.`));
        assert.match(result.stdout, /_Tylko odczyt — żaden plik nie został zmieniony/);
      }
      assert.deepEqual(snapshotRepo(repo), before);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC6: w raporcie dla każdego kamienia pliki trwałe i żywe nigdy nie mają „usuń” ani „archiwizuj”', () => {
    const repo = createTempRepo({ files: lifecycleFiles() });
    try {
      for (const target of ['M0', 'M1', 'M2']) {
        const result = runMain(['cleanup-report', target], { cwd: repo.root, env: repo.env });
        const rows = reportRows(result.stdout);
        assert.ok(!rows.some((row) => row.action === 'archiwizuj'), target);
        for (const row of rows.filter((item) => item.cls === 'trwały' || item.cls === 'żywy')) {
          assert.equal(row.action, 'przejrzyj', `${target}: ${row.path}`);
          assert.match(row.reason, /przegląd aktualności, nie usunięcie/);
        }
        for (const path of PERMANENT) {
          assert.ok(!rows.some((row) => row.path === path), `${target}: plik trwały ${path} w raporcie`);
        }
        const cennik = rows.find((row) => row.path === 'docs/product/cennik.md');
        assert.equal(cennik?.action, 'przejrzyj', target);
        assert.match(String(cennik?.reason), /przeterminowany: review_by 2026-09-01/);
        // ADR with `lifecycle: milestone` (attempt to lower its class) stays permanent and blocks nothing silently.
        assert.match(result.stdout, /> \*\*Uwaga:\*\* walidator zgłasza błędy \(1\)/);
      }
    } finally {
      repo.cleanup();
    }
  });
});

describe('QA: Windows 11 — ścieżka repozytorium z polskimi znakami i spacją (EVM-012 AC3)', () => {
  it('EVM-012 AC3: walidator w katalogu „Łódź projekt ąćęłńóśźż” wypisuje polskie nazwy i kończy się kodem 1, a po poprawce 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'evm-012-qa-'));
    try {
      const root = join(base, 'Łódź projekt ąćęłńóśźż');
      mkdirSync(root);
      const env = isolatedEnv(base);
      execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', 'init', '-q'], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: 'ignore',
      });
      const files = { '.gitignore': '.scratch/\n', ...baseFiles(), 'docs/notatka-ąćęłńóśźż.md': '# Notatka\n' };
      for (const [path, content] of Object.entries(files)) {
        const absolute = join(root, ...path.split('/'));
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
      }
      const failed = runCli(['check'], { cwd: join(root, 'docs', 'process'), env });
      assert.equal(failed.code, 1, failed.stderr);
      assert.match(failed.stdout, /^BŁĄD · docs\/notatka-ąćęłńóśźż\.md · — · plik poza dozwolonymi lokalizacjami/m);
      rmSync(join(root, 'docs', 'notatka-ąćęłńóśźż.md'));
      const fixed = runCli(['check'], { cwd: root, env });
      assert.equal(fixed.code, 0, fixed.stdout);
      assert.match(fixed.stdout, /Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką/);
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('QA: pliki robocze w .scratch/ — prawdziwy .gitignore projektu (EVM-012 AC8)', () => {
  it('EVM-012 AC8: plik w .scratch/ (także w podkatalogu historyjki) nie pojawia się jako zmiana do commitu; plik obok — tak', () => {
    const gitignore = readFileSync(fileURLToPath(new URL('../../../.gitignore', import.meta.url)), 'utf8');
    const repo = createTempRepo({
      gitignore,
      files: { '.scratch/notatka.md': '# Robocza\n', '.scratch/EVM-012/wynik.txt': 'wynik\n', 'docs/notes/kontrola.md': '# Kontrola\n' },
    });
    try {
      const status = repo.git('status', '--porcelain', '--untracked-files=all');
      assert.doesNotMatch(status, /\.scratch/);
      assert.match(status, /\?\? docs\/notes\/kontrola\.md/);
      repo.git('add', '-A');
      const staged = repo.git('diff', '--cached', '--name-only');
      assert.doesNotMatch(staged, /\.scratch/);
      assert.match(staged, /docs\/notes\/kontrola\.md/);
    } finally {
      repo.cleanup();
    }
  });
});

/**
 * Independent enumeration of the `.md` files that git does not ignore (EVM-012 AC2): a breadth-first walk of the
 * working tree — `.git` skipped, ignored directories pruned and ignored files dropped with one
 * `git check-ignore -z --stdin` call per level — so it does not share the validator's `git ls-files` logic.
 * Tracked files are never reported by `check-ignore`, so they stay in the set like in the validator.
 * Directories are passed without a trailing slash: they exist, so git matches directory-only patterns (`.scratch/`)
 * from the file type, while `dir/` makes git 2.45 report untracked directories as ignored by a blank line.
 * @param {string} root repository root
 * @returns {string[]} repository-relative paths with `/`, sorted
 */
function markdownOnDisk(root) {
  /** @param {string[]} paths @returns {Set<string>} */
  const ignoredOf = (paths) => {
    if (paths.length === 0) return new Set();
    const result = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root,
      input: `${paths.join('\0')}\0`,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.ok(result.status === 0 || result.status === 1, `git check-ignore: ${result.stderr}`);
    return new Set(result.stdout.split('\0').filter((path) => path !== ''));
  };
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} directories to read, repository-relative without a trailing slash ('' = root) */
  let level = [''];
  while (level.length > 0) {
    /** @type {string[]} */
    const dirs = [];
    /** @type {string[]} */
    const files = [];
    for (const dir of level) {
      for (const entry of readdirSync(join(root, ...dir.split('/').filter(Boolean)), { withFileTypes: true })) {
        const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory() && path !== '.git') dirs.push(path);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(path);
      }
    }
    const ignored = ignoredOf([...dirs, ...files]);
    found.push(...files.filter((path) => !ignored.has(path)));
    level = dirs.filter((path) => !ignored.has(path));
  }
  return found.sort();
}

describe('QA: niezależne wyliczenie plików .md prawdziwego repozytorium (EVM-012 AC2)', () => {
  it('EVM-012 AC2: każdy plik .md na dysku, którego git nie ignoruje, jest sprawdzony przez walidator i ma klasę', () => {
    const repository = loadRepository({ cwd: fileURLToPath(new URL('.', import.meta.url)), env: process.env, config });
    const analysis = analyze(repository, { config, today: todayInZone(new Date()) });
    const checked = new Map(analysis.files.map((file) => [file.path, file]));
    const onDisk = markdownOnDisk(repository.root);
    assert.ok(onDisk.length > 0);
    assert.deepEqual(onDisk.filter((path) => !checked.has(path)), [], 'pliki .md pominięte przez walidator');
    assert.deepEqual(onDisk.filter((path) => checked.get(path)?.class === null), [], 'pliki .md bez klasy');
    assert.deepEqual(
      analysis.files.map((file) => file.path).filter((path) => !existsSync(join(repository.root, ...path.split('/')))),
      [],
      'walidator sprawdza plik, którego nie ma na dysku',
    );
  });
});

/**
 * Every directory and file under the root, `.git` included: path, size, mtime and SHA-256 (directories: path and mtime).
 * Runs no git command — `git status` would itself refresh the index.
 * @param {string} root
 * @returns {string[]}
 */
function fullSnapshot(root) {
  /** @type {string[]} */
  const entries = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      const stat = statSync(absolute);
      if (entry.isDirectory()) {
        entries.push(`${path}/ ${stat.mtimeMs}`);
        walk(absolute);
      } else {
        entries.push(`${path} ${stat.size} ${stat.mtimeMs} ${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`);
      }
    }
  };
  walk(root);
  return entries.sort();
}

describe('QA: tylko odczyt — także katalog .git (EVM-012 AC5)', () => {
  it('EVM-012 AC5: check, check --list, check --today i cleanup-report nie zmieniają żadnego pliku ani katalogu, także indeksu w .git', () => {
    const repo = createTempRepo({
      files: {
        ...baseFiles(),
        'notatka.md': '# Luźna notatka\n',
        'docs/notes/plan-łódź.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2020-01-01' }),
      },
      tracked: ['README.md', 'docs/README.md', 'docs/notes/plan-łódź.md'],
    });
    try {
      // Stale stat data in the index: any index refresh (e.g. `git status`) would rewrite .git/index.
      const past = new Date('2020-01-01T00:00:00Z');
      utimesSync(join(repo.root, 'README.md'), past, past);
      const before = fullSnapshot(repo.root);
      const codes = [
        ['check'],
        ['check', '--list'],
        ['check', '--today', '2027-01-01'],
        ['cleanup-report', 'M0'],
        ['cleanup-report', 'M1'],
      ].map((argv) => runCli(argv, { cwd: repo.root, env: repo.env }).code);
      assert.deepEqual(codes, [1, 1, 1, 0, 0]);
      assert.deepEqual(fullSnapshot(repo.root), before);
      // The comparison is not vacuous: a command that refreshes the index does change the snapshot.
      repo.git('status', '--porcelain');
      assert.notDeepEqual(fullSnapshot(repo.root), before);
    } finally {
      repo.cleanup();
    }
  });
});

describe('QA: walidator czyta wyłącznie pliki .md ze zbioru gita (EVM-012 AC5, „Bezpieczeństwo i prywatność”)', () => {
  it('EVM-012 AC5: otwierane są tylko pliki .md, każdy raz — nigdy .env, klucze, konfiguracja, kod spike’a ani zrzuty', () => {
    /** @type {Record<string, string>} */
    const markdown = {
      ...baseFiles(),
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0' }),
      'spikes/kolejka/README.md': doc({ milestone: 'M0' }, '# Spike EVM-011\n'),
    };
    const other = ['.env', '.env.local', 'secrets/klucz.pem', 'config/service-account.json', 'spikes/kolejka/kolejka.ts', 'docs/qa/EVM-001/zrzut.png', 'package.json'];
    /** @type {Record<string, string>} */
    const contents = { ...markdown, ...Object.fromEntries(other.map((path) => [path, 'SYNTETYCZNY_SEKRET=nie-czytaj\n'])) };
    /** @type {string[]} */
    const reads = [];
    const analysis = analyze(
      {
        paths: Object.keys(contents),
        read: (path) => {
          reads.push(path);
          return Object.hasOwn(contents, path) ? contents[path] : null;
        },
        scratchIgnored: true,
      },
      { config, today: TODAY },
    );
    assert.deepEqual([...reads].sort(), Object.keys(markdown).sort());
    assert.equal(analysis.errorCount, 0);
  });

  it('EVM-012 AC5: pliki ignorowane przez git (.env.md, .scratch/) nie trafiają do zbioru ani do wyniku — ich metadane nic nie zmieniają', () => {
    const repo = createTempRepo({
      gitignore: '.scratch/\n.env\n.env.*\n',
      files: {
        ...baseFiles(),
        '.env.md': '---\nlifecycle: nieznana\nexpires: 2020-13-01\n---\nSYNTETYCZNY_SEKRET=nie-czytaj\n',
        '.scratch/notatka.md': '---\nlifecycle: ephemeral\n---\n# Robocza\n',
      },
    });
    try {
      const result = runCli(['check', '--list'], { cwd: repo.root, env: repo.env });
      assert.equal(result.code, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /\.env|\.scratch|SYNTETYCZNY_SEKRET/);
      assert.match(result.stdout, /Wynik: brak błędów i ostrzeżeń/);
    } finally {
      repo.cleanup();
    }
  });
});

describe('QA: kotwice polityki, kroku sprzątania i instrukcji agentów (EVM-012 AC1, AC7, AC8)', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  /** @param {string} path */
  const read = (path) => readFileSync(join(root, ...path.split('/')), 'utf8');
  const policy = read('docs/process/document-lifecycle.md');

  it('EVM-012 AC1: pola obowiązkowe dla każdej klasy; archiwum = historia git (bez docs/archive/); pliki robocze w .scratch/', () => {
    const fields = String(section(policy, '### Pola metadanych')).split('\n');
    assert.ok(fields.some((line) => /^\| Klasa \| Obowiązkowe \| Opcjonalne \| Niedozwolone/.test(line)));
    for (const label of ['trwały', 'żywy', 'kamień milowy', 'roboczy']) {
      assert.ok(fields.some((line) => line.startsWith(`| ${label} |`)), label);
    }
    const milestoneRow = String(fields.find((line) => line.startsWith('| kamień milowy |')));
    assert.ok(milestoneRow.includes('M#') && milestoneRow.includes('`expires: YYYY-MM-DD`'), milestoneRow);
    const archive = String(section(policy, '## Archiwizacja a usunięcie'));
    assert.ok(archive.includes('historia git') && archive.includes('git restore'));
    for (const rule of parsePolicyRules(policy)) {
      assert.ok(!rule.patterns.some((pattern) => pattern.startsWith('docs/archive')), `reguła ${rule.id}`);
    }
    assert.ok(String(section(policy, '## Pliki robocze')).includes('`.scratch/`'));
  });

  it('EVM-012 AC7: /milestone close — sprzątanie po retrospektywie, przed roadmapą; decyzja wszystkie / wybrane / żadne; git rm tylko dla zaakceptowanych', () => {
    const close = String(section(read('.claude/skills/milestone/SKILL.md'), '## Tryb `close`'));
    const steps = close.split('\n').filter((line) => /^\d+\. /.test(line));
    const retro = steps.findIndex((line) => line.includes('**Retrospektywa:**'));
    const cleanup = steps.findIndex((line) => line.includes('**Sprzątanie dokumentacji**'));
    const roadmap = steps.findIndex((line) => line.includes('Zaktualizuj roadmapę'));
    assert.ok(retro >= 0 && cleanup === retro + 1 && roadmap === cleanup + 1, steps.join('\n'));
    const cleanupStep = close.slice(close.indexOf(steps[cleanup]), close.indexOf(steps[roadmap]));
    for (const anchor of ['**wszystkie**', '**wybrane**', '**żadne**', 'git rm', 'npm run docs:cleanup -- <M#>', 'docs/process/retros/<M#>.md', '„Sprzątanie dokumentacji”']) {
      assert.ok(cleanupStep.includes(anchor), anchor);
    }
  });

  it('EVM-012 AC8: każda definicja agenta — dowody QA/UX to „kamień milowy”, dokument bez pasującej reguły → docs/notes/ z polem lifecycle', () => {
    const agents = readdirSync(join(root, '.claude', 'agents')).filter((name) => name.endsWith('.md'));
    assert.ok(agents.length >= 10);
    for (const name of agents) {
      const documents = String(section(read(`.claude/agents/${name}`), '# Dokumenty i pliki robocze'));
      for (const anchor of ['`docs/qa/<EVM-ID>/`', '`docs/ux/reviews/<EVM-ID>/`', '„kamień milowy”', '`docs/notes/`', '`lifecycle`']) {
        assert.ok(documents.includes(anchor), `${name}: ${anchor}`);
      }
    }
  });

  it('EVM-012 AC8: polityka → „Gdzie zapisać dokument”: raport QA i przegląd UX = kamień milowy, notatka robocza = .scratch/ (roboczy)', () => {
    const rows = String(section(policy, '## Gdzie zapisać dokument')).split('\n').filter((line) => line.startsWith('|'));
    /** @param {string} location */
    const classOf = (location) => String(rows.find((line) => line.includes(location))?.split('|').at(-2)?.trim());
    assert.match(classOf('`docs/qa/<EVM-ID>/`'), /^kamień milowy/);
    assert.match(classOf('`docs/ux/reviews/<EVM-ID>/`'), /^kamień milowy/);
    assert.equal(classOf('`.scratch/`'), 'roboczy');
  });
});
