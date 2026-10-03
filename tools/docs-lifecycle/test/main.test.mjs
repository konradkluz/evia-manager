// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EXIT, parseCli } from '../lib/main.mjs';
import { runCli, runMain } from './helpers/cli.mjs';
import { baseFiles, doc } from './helpers/fixtures.mjs';
import { createTempRepo, snapshotRepo } from './helpers/temp-repo.mjs';

/** @type {import('./helpers/temp-repo.mjs').TempRepo} */
let clean;
/** @type {import('./helpers/temp-repo.mjs').TempRepo} */
let mixed;

/** Repository with errors, warnings and milestone files of M0 and M1 (synthetic). */
function mixedFiles() {
  return {
    ...baseFiles(),
    'docs/README.md': '# D\n- process/workflow.md product/roadmap.md notes/plan-m0.md notes/plan-m1.md\n',
    'docs/notes/plan-m0.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-01' }),
    'docs/notes/plan-m1.md': doc({ lifecycle: 'milestone', milestone: 'M1' }),
    'docs/qa/EVM-001/raport.md': '# QA\n',
    'spikes/upload/README.md': doc({ milestone: 'M0' }, '# Spike\n'),
    'spikes/upload/kolejka.ts': 'export {};\n',
    'docs/product/zapomniany.md': '# Z\n',
    'docs/notatka-łódź.md': '# Luźna notatka\n',
    '.scratch/notatka.md': '# Robocza (ignorowana)\n',
  };
}

before(() => {
  clean = createTempRepo({ files: baseFiles() });
  mixed = createTempRepo({ files: mixedFiles() });
});

after(() => {
  clean.cleanup();
  mixed.cleanup();
});

describe('CLI check — wynik i kody wyjścia (EVM-012)', () => {
  it('EVM-012 AC4: czyste repozytorium — kod 0 i jednoznaczny komunikat o braku błędów i ostrzeżeń', () => {
    const result = runMain(['check'], { cwd: clean.root, env: clean.env });
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką\n$/);
    assert.match(result.stdout, /- trwały \(permanent\): 2\n- żywy \(living\): 4\n/);
    assert.match(result.stdout, /Klasa nadana ręcznie \(pole lifecycle w docs\/notes\/\): brak/);
    assert.equal(result.stderr, '');
  });

  it('EVM-012 AC3: błędy — kod 1, każdy wiersz ze ścieżką i powodem po polsku', () => {
    const result = runMain(['check'], { cwd: mixed.root, env: mixed.env });
    assert.equal(result.code, EXIT.findings);
    assert.match(result.stdout, /^BŁĄD · docs\/notatka-łódź\.md · — · plik poza dozwolonymi lokalizacjami/m);
    assert.match(result.stdout, /^OSTRZEŻENIE · docs\/notes\/plan-m0\.md · kamień milowy · przeterminowany: expires 2026-10-01/m);
    assert.match(result.stdout, /^OSTRZEŻENIE · docs\/product\/zapomniany\.md · żywy · osierocony/m);
    assert.match(result.stdout, /błędy: 1 · ostrzeżenia: 2/);
    assert.ok(!result.stdout.includes('.scratch/notatka.md'), 'plik roboczy ignorowany przez git nie jest sprawdzany');
  });

  it('EVM-012 AC4: same ostrzeżenia nie zmieniają kodu wyjścia (0)', () => {
    const repo = createTempRepo({ files: { ...baseFiles(), 'docs/product/zapomniany.md': '# Z\n' } });
    try {
      const result = runMain(['check'], { cwd: repo.root, env: repo.env });
      assert.equal(result.code, EXIT.ok);
      assert.match(result.stdout, /OSTRZEŻENIE · docs\/product\/zapomniany\.md/);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC4: „dzisiaj” wg zegara w strefie Europe/Warsaw — granica doby dla expires: 2026-10-01', () => {
    const repo = createTempRepo({
      files: {
        ...baseFiles(),
        'docs/README.md': '# D\n- process/workflow.md product/roadmap.md notes/plan.md\n',
        'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-01' }),
      },
    });
    try {
      const before = runMain(['check'], { cwd: repo.root, env: repo.env, now: () => new Date('2026-10-01T21:59:59Z') });
      const afterMidnight = runMain(['check'], { cwd: repo.root, env: repo.env, now: () => new Date('2026-10-01T22:00:00Z') });
      assert.match(before.stdout, /Podsumowanie \(2026-10-01, Europe\/Warsaw\)/);
      assert.ok(!before.stdout.includes('przeterminowany'));
      assert.match(afterMidnight.stdout, /przeterminowany: expires 2026-10-01 \(dzisiaj 2026-10-02\)/);
      assert.equal(afterMidnight.code, EXIT.ok);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC4: --today zastępuje dzisiejszą datę', () => {
    const result = runMain(['check', '--today', '2026-12-31'], { cwd: mixed.root, env: mixed.env });
    assert.match(result.stdout, /Podsumowanie \(2026-12-31, Europe\/Warsaw\)/);
    assert.match(result.stdout, /dzisiaj 2026-12-31/);
  });

  it('EVM-012 AC2: --list — każdy plik z klasą i źródłem klasy', () => {
    const result = runMain(['check', '--list'], { cwd: clean.root, env: clean.env });
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /^Pliki \.md \(6\) — ścieżka · klasa · źródło klasy:\nREADME\.md · żywy · reguła 1\n/);
  });

  it('EVM-012 AC3: uruchomienie z podkatalogu sprawdza całe repozytorium', () => {
    const subdirectory = join(mixed.root, 'docs', 'process');
    const result = runMain(['check'], { cwd: subdirectory, env: mixed.env });
    assert.equal(result.code, EXIT.findings);
    assert.match(result.stdout, /docs\/notatka-łódź\.md/);
  });
});

describe('CLI cleanup-report (EVM-012 AC5)', () => {
  it('EVM-012 AC5: raport dla M0 — tabela, pozycje M0 i przeterminowane/osierocone, kod 0 mimo błędów walidacji', () => {
    const result = runMain(['cleanup-report', 'M0'], { cwd: mixed.root, env: mixed.env });
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /^# Raport sprzątania dokumentacji — M0\n/);
    assert.match(result.stdout, /> \*\*Uwaga:\*\* walidator zgłasza błędy \(1\)/);
    assert.match(result.stdout, /\| `docs\/notes\/plan-m0\.md` \| kamień milowy \| usuń \|/);
    assert.match(result.stdout, /\| `docs\/qa\/EVM-001\/raport\.md` \| kamień milowy \| usuń \|/);
    assert.match(result.stdout, /\| `spikes\/upload\/` \| kamień milowy \| usuń \|/);
    assert.match(result.stdout, /\| `docs\/product\/zapomniany\.md` \| żywy \| przejrzyj \|/);
    assert.ok(!result.stdout.includes('plan-m1.md'), 'plik M1 nie jest pozycją raportu M0');
    assert.match(result.stdout, /Pozycje: 4 \(usuń: 3, przejrzyj: 1\)\./);
  });

  it('EVM-012 AC5: raport dla M1 — plik M1 do usunięcia, pliki M0 nieobecne', () => {
    const result = runMain(['cleanup-report', 'M1'], { cwd: mixed.root, env: mixed.env });
    assert.match(result.stdout, /\| `docs\/notes\/plan-m1\.md` \| kamień milowy \| usuń \|/);
    assert.match(
      result.stdout,
      /\| `docs\/notes\/plan-m0\.md` \| kamień milowy \| przejrzyj \| kamień milowy M0 \(pole milestone\) — nie dotyczy M1; przeterminowany: expires 2026-10-01/,
    );
    assert.ok(!result.stdout.includes('docs/qa/EVM-001/raport.md'));
  });

  it('EVM-012 AC5: kamień milowy spoza listy albo w złym formacie — kod 2', () => {
    for (const target of ['M9', 'm0', 'M']) {
      const result = runMain(['cleanup-report', target], { cwd: clean.root, env: clean.env });
      assert.equal(result.code, EXIT.usage, target);
      assert.match(result.stderr, /nieznany kamień milowy/);
      assert.match(result.stderr, /M0, M1, M2/);
      assert.equal(result.stdout, '');
    }
  });

  it('EVM-012 AC5: check i cleanup-report nie zmieniają, nie przenoszą ani nie usuwają plików (migawka przed i po)', () => {
    const before = snapshotRepo(mixed);
    runMain(['check', '--list'], { cwd: mixed.root, env: mixed.env });
    runMain(['cleanup-report', 'M0'], { cwd: mixed.root, env: mixed.env });
    runMain(['cleanup-report', 'M1'], { cwd: mixed.root, env: mixed.env });
    const afterRun = snapshotRepo(mixed);
    assert.deepEqual(afterRun, before);
    assert.ok(
      before.files.some((line) => line.startsWith('.scratch/notatka.md ')),
      'migawka obejmuje pliki ignorowane',
    );
  });
});

describe('CLI — błędy użycia i środowiska, kod 2 (EVM-012)', () => {
  it('EVM-012 AC3: argumenty pozycyjne nadmiarowe lub brakujące — kod 2 ze wskazówką dla PowerShell', () => {
    // Windows PowerShell 5.1 + npm: `npm run docs:check -- --today 2026-10-02` arrives as `check 2026-10-02`.
    for (const argv of [['check', '2026-10-02'], ['cleanup-report'], ['cleanup-report', 'M0', 'M1']]) {
      const result = runMain(argv, { cwd: clean.root, env: clean.env });
      assert.equal(result.code, EXIT.usage, argv.join(' '));
      assert.match(result.stderr, /PowerShell/);
      assert.match(result.stderr, /'--'/);
      assert.match(result.stderr, /node tools\/docs-lifecycle\/cli\.mjs/);
    }
  });

  it('EVM-012 AC3: brak polecenia, nieznane polecenie, nieznana opcja, opcja bez wartości — kod 2', () => {
    const cases = [[], ['sprawdz'], ['check', '--foo'], ['check', '--today'], ['cleanup-report', 'M0', '--list'], ['check', '--list=tak']];
    for (const argv of cases) {
      const result = runMain(argv, { cwd: clean.root, env: clean.env });
      assert.equal(result.code, EXIT.usage, JSON.stringify(argv));
      assert.match(result.stderr, /^Nie można wykonać polecenia: /);
      assert.match(result.stderr, /--help/);
      assert.equal(result.stdout, '');
    }
  });

  it('EVM-012 AC3: niepoprawna data w --today — kod 2', () => {
    for (const today of ['2026-02-30', '02.10.2026']) {
      const result = runMain(['check', '--today', today], { cwd: clean.root, env: clean.env });
      assert.equal(result.code, EXIT.usage);
      assert.match(result.stderr, /--today/);
    }
  });

  it('EVM-012 AC3: --help — kod 0 i opis użycia', () => {
    const result = runMain(['--help'], { cwd: clean.root, env: clean.env });
    assert.equal(result.code, EXIT.ok);
    assert.match(result.stdout, /^Walidator cyklu życia dokumentów/);
    assert.deepEqual(parseCli(['-h']), { help: true, command: null, target: null, today: null, list: false });
  });

  it('EVM-012 AC3: katalog bez repozytorium git — kod 2', () => {
    const repo = createTempRepo({ init: false, gitignore: null });
    try {
      mkdirSync(join(repo.root, 'docs'));
      const result = runMain(['check'], { cwd: join(repo.root, 'docs'), env: repo.env });
      assert.equal(result.code, EXIT.usage);
      assert.match(result.stderr, /brak repozytorium git/);
    } finally {
      repo.cleanup();
    }
  });

  it('EVM-012 AC3: nieoczekiwany błąd narzędzia — kod 2 (nigdy 0 ani 1)', () => {
    const result = runMain(['check'], {
      cwd: clean.root,
      env: clean.env,
      now: () => {
        throw new TypeError('zegar niedostępny');
      },
    });
    assert.equal(result.code, EXIT.usage);
    assert.match(result.stderr, /Nieoczekiwany błąd narzędzia: TypeError: zegar niedostępny/);
  });
});

describe('CLI jako proces (EVM-012 AC3)', () => {
  it('EVM-012 AC3: prawdziwe kody wyjścia 0 / 1 / 2 i wyjście UTF-8 z polskimi znakami', () => {
    const ok = runCli(['check'], { cwd: clean.root, env: clean.env });
    assert.equal(ok.code, 0);
    assert.match(ok.stdout, /Wynik: brak błędów i ostrzeżeń/);
    const failed = runCli(['check'], { cwd: join(mixed.root, 'docs'), env: mixed.env });
    assert.equal(failed.code, 1);
    assert.match(failed.stdout, /BŁĄD · docs\/notatka-łódź\.md · — · plik poza dozwolonymi lokalizacjami/);
    const usage = runCli(['check', '2026-10-02'], { cwd: clean.root, env: clean.env });
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /PowerShell/);
    const report = runCli(['cleanup-report', 'M0'], { cwd: mixed.root, env: mixed.env });
    assert.equal(report.code, 0);
    assert.match(report.stdout, /_Tylko odczyt — żaden plik nie został zmieniony/);
  });
});
