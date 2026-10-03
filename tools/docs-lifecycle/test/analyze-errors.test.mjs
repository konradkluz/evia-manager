// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFiles, codes, doc, story } from './helpers/fixtures.mjs';

/**
 * @param {import('../lib/analyze.mjs').Analysis} analysis
 * @param {string} path
 */
const fileOf = (analysis, path) => {
  const record = analysis.files.find((file) => file.path === path);
  assert.ok(record, `brak rekordu dla ${path}`);
  return record;
};

/**
 * @param {import('../lib/analyze.mjs').Analysis} analysis
 * @param {string} code
 * @param {string} path
 */
const findingOf = (analysis, code, path) => {
  const finding = analysis.findings.find((item) => item.code === code && item.path === path);
  assert.ok(finding, `brak ustalenia ${code} dla ${path}; są: ${codes(analysis).join(', ')}`);
  return finding;
};

describe('walidator — stan czysty i klasyfikacja (EVM-012)', () => {
  it('EVM-012 AC2: czyste repozytorium — każdy plik .md ma klasę, 0 błędów i 0 ostrzeżeń', () => {
    const analysis = analyzeFiles({});
    assert.deepEqual(codes(analysis), []);
    assert.equal(analysis.errorCount, 0);
    assert.equal(analysis.warningCount, 0);
    assert.ok(analysis.files.every((file) => file.class !== null));
    assert.deepEqual(
      analysis.files.map((file) => `${file.path} ${file.class} ${file.ruleId}`),
      [
        'README.md living 1',
        'docs/README.md living 4',
        'docs/backlog/M0/EVM-001-przyklad.md permanent 6',
        'docs/backlog/M1/EVM-101-przyklad.md permanent 6',
        'docs/process/workflow.md living 16',
        'docs/product/roadmap.md living 16',
      ],
    );
    assert.deepEqual(analysis.milestones, ['M0', 'M1', 'M2']);
  });

  it('EVM-012 AC2: klasa nadana ręcznie = pliki w docs/notes/ z polem lifecycle', () => {
    const analysis = analyzeFiles({
      'docs/notes/plan-m1.md': doc({ lifecycle: 'milestone', milestone: 'M1' }),
      'docs/notes/zasady.md': doc({ lifecycle: 'living' }),
      'docs/README.md': '# D\n- notes/plan-m1.md\n- notes/zasady.md\n- process/workflow.md\n- product/roadmap.md\n',
    });
    assert.deepEqual(codes(analysis), []);
    const manual = analysis.files.filter((file) => file.manual).map((file) => `${file.path} ${file.class}`);
    assert.deepEqual(manual, ['docs/notes/plan-m1.md milestone', 'docs/notes/zasady.md living']);
    assert.equal(fileOf(analysis, 'docs/notes/plan-m1.md').milestone, 'M1');
  });

  it('EVM-012 AC2: pliki inne niż .md poza .scratch/ i spikes/ nie są klasyfikowane; rozszerzenie .MD jest plikiem Markdown', () => {
    const analysis = analyzeFiles({ 'design/tokens/color.tokens.json': '{}', 'docs/product/NOTATKA.MD': '# x\n' });
    assert.equal(analysis.files.some((file) => file.path.endsWith('.json')), false);
    assert.deepEqual(codes(analysis), ['location-forbidden docs/product/NOTATKA.MD']);
  });
});

describe('walidator — błędy blokujące (EVM-012 AC3)', () => {
  it('EVM-012 AC3: plik .md poza dozwolonymi lokalizacjami — luźna notatka w katalogu głównym i w docs/', () => {
    const analysis = analyzeFiles({ 'notatka.md': '# N\n', 'docs/notatka-łódź.md': '# N\n' });
    assert.deepEqual(codes(analysis, 'error'), ['location-forbidden docs/notatka-łódź.md', 'location-forbidden notatka.md']);
    const finding = findingOf(analysis, 'location-forbidden', 'notatka.md');
    assert.equal(finding.class, null);
    assert.match(finding.reason, /poza dozwolonymi lokalizacjami/);
    assert.match(finding.reason, /docs\/notes\//);
    assert.match(finding.reason, /\.scratch\//);
    assert.equal(fileOf(analysis, 'notatka.md').class, null);
  });

  it('EVM-012 AC3: rozszerzenie .MD w dozwolonej lokalizacji — wskazówka „zmień rozszerzenie na .md”, nie przenoszenie', () => {
    const analysis = analyzeFiles({
      'docs/product/Cennik.MD': '# C\n',
      'docs/notes/X.Md': doc({ lifecycle: 'living' }),
      'docs/backlog/M0/notatka.MD': '# N\n',
      'NOTATKA.MD': '# N\n',
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'location-forbidden NOTATKA.MD',
      'location-forbidden docs/backlog/M0/notatka.MD',
      'location-forbidden docs/notes/X.Md',
      'location-forbidden docs/product/Cennik.MD',
    ]);
    for (const path of ['docs/product/Cennik.MD', 'docs/notes/X.Md']) {
      const { reason } = findingOf(analysis, 'location-forbidden', path);
      assert.match(reason, /zmień rozszerzenie na \.md/);
      assert.match(reason, /\(docs\/(product\/Cennik|notes\/X)\.md\): po tej zmianie plik pasuje do reguły (14|16)/);
      assert.doesNotMatch(reason, /przenieś/);
    }
    // After renaming these would still be forbidden — the hint stays „przenieś”.
    for (const path of ['docs/backlog/M0/notatka.MD', 'NOTATKA.MD']) {
      const { reason } = findingOf(analysis, 'location-forbidden', path);
      assert.doesNotMatch(reason, /zmień rozszerzenie/);
      assert.match(reason, /przenieś go do docs\/notes\//);
    }
  });

  it('EVM-012 AC3: plik w katalogu o ściśle określonej strukturze (reguła 15) jest w niedozwolonej lokalizacji', () => {
    const analysis = analyzeFiles({
      'docs/backlog/M0/notatka.md': '# N\n',
      'spikes/notatka.md': '# N\n',
      'docs/architecture/adr/notatki.md': '# N\n',
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'location-forbidden docs/architecture/adr/notatki.md',
      'location-forbidden docs/backlog/M0/notatka.md',
      'location-forbidden spikes/notatka.md',
    ]);
    assert.match(findingOf(analysis, 'location-forbidden', 'spikes/notatka.md').reason, /reguła 15/);
  });

  it('EVM-012 AC3: plik .md bez klasy (docs/notes/ bez pola lifecycle)', () => {
    const analysis = analyzeFiles({ 'docs/notes/bez-klasy.md': '# Notatka\n' });
    assert.deepEqual(codes(analysis, 'error'), ['class-missing docs/notes/bez-klasy.md']);
    assert.match(findingOf(analysis, 'class-missing', 'docs/notes/bez-klasy.md').reason, /lifecycle/);
    assert.equal(fileOf(analysis, 'docs/notes/bez-klasy.md').class, null);
  });

  it('EVM-012 AC3: nieznana wartość klasy — komunikat podaje dozwolone wartości', () => {
    const analysis = analyzeFiles({
      'docs/notes/archiwum.md': doc({ lifecycle: 'archive' }),
      'docs/product/wizja-2.md': doc({ lifecycle: 'trwały' }),
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'class-unknown docs/notes/archiwum.md',
      'class-unknown docs/product/wizja-2.md',
    ]);
    const finding = findingOf(analysis, 'class-unknown', 'docs/notes/archiwum.md');
    assert.match(finding.reason, /„archive”/);
    assert.match(finding.reason, /permanent, living, milestone, ephemeral/);
    assert.equal(findingOf(analysis, 'class-unknown', 'docs/product/wizja-2.md').class, 'living');
  });

  it('EVM-012 AC3: klasa „kamień milowy” bez M# albo z nieistniejącym lub źle zapisanym M#', () => {
    const analysis = analyzeFiles({
      'docs/notes/bez-m.md': doc({ lifecycle: 'milestone' }),
      'docs/notes/m9.md': doc({ lifecycle: 'milestone', milestone: 'M9' }),
      'docs/notes/male-m.md': doc({ lifecycle: 'milestone', milestone: 'm1' }),
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'milestone-missing docs/notes/bez-m.md',
      'milestone-unknown docs/notes/m9.md',
      'milestone-unknown docs/notes/male-m.md',
    ]);
    assert.match(findingOf(analysis, 'milestone-unknown', 'docs/notes/m9.md').reason, /„M9”.*M0, M1, M2/);
    assert.match(findingOf(analysis, 'milestone-unknown', 'docs/notes/male-m.md').reason, /złym formacie/);
    assert.equal(fileOf(analysis, 'docs/notes/bez-m.md').milestone, null);
  });

  it('EVM-012 AC3: niepoprawna data (inna niż prawdziwa data YYYY-MM-DD)', () => {
    const analysis = analyzeFiles({
      'docs/notes/a.md': doc({ lifecycle: 'milestone', milestone: 'M1', expires: '2026-13-01' }),
      'docs/notes/b.md': doc({ lifecycle: 'milestone', milestone: 'M1', expires: '02.10.2026' }),
      'docs/notes/c.md': doc({ lifecycle: 'living', review_by: '2026-02-30' }),
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'date-invalid docs/notes/a.md',
      'date-invalid docs/notes/b.md',
      'date-invalid docs/notes/c.md',
    ]);
    const finding = findingOf(analysis, 'date-invalid', 'docs/notes/b.md');
    assert.match(finding.reason, /expires/);
    assert.match(finding.reason, /„02\.10\.2026”/);
    assert.match(finding.reason, /YYYY-MM-DD/);
  });

  it('EVM-012 AC3: kilka błędów w jednym pliku — każdy zgłoszony osobno', () => {
    const analysis = analyzeFiles({
      'docs/notes/dwa.md': doc({ lifecycle: 'milestone', milestone: 'M1', expires: '2026-13-01', review_by: '2027-01-01' }),
    });
    assert.deepEqual(codes(analysis, 'error'), ['date-invalid docs/notes/dwa.md', 'date-not-allowed docs/notes/dwa.md']);
  });

  it('EVM-012 AC3: bez roadmapy lista kamieni pochodzi tylko z katalogów docs/backlog/<M#>/', () => {
    const analysis = analyzeFiles(
      {
        'docs/backlog/M0/EVM-001-przyklad.md': story('EVM-001', 'M0'),
        'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M1' }),
      },
      { base: false },
    );
    assert.deepEqual(analysis.milestones, ['M0']);
    assert.deepEqual(codes(analysis, 'error'), ['milestone-unknown docs/notes/plan.md']);
  });

  it('EVM-012 AC3: plik trwały lub żywy z datą ważności (sprzeczność); review_by tylko w plikach żywych', () => {
    const analysis = analyzeFiles({
      'docs/architecture/adr/0001-przyklad.md': doc({ expires: '2027-01-01' }),
      'docs/product/cennik.md': doc({ expires: '2027-01-01' }),
      'docs/product/wersje.md': doc({ review_by: '2027-01-01' }),
      'docs/backlog/M0/EVM-002-przyklad.md': doc({ id: 'EVM-002', milestone: 'M0', review_by: '2027-01-01' }),
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M1', review_by: '2027-01-01' }),
      'docs/README.md': '# D\n- process/workflow.md\n- product/roadmap.md\n- product/cennik.md\n- product/wersje.md\n- notes/plan.md\n',
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'date-not-allowed docs/architecture/adr/0001-przyklad.md',
      'date-not-allowed docs/backlog/M0/EVM-002-przyklad.md',
      'date-not-allowed docs/notes/plan.md',
      'date-not-allowed docs/product/cennik.md',
    ]);
    assert.match(findingOf(analysis, 'date-not-allowed', 'docs/product/cennik.md').reason, /expires/);
    assert.match(findingOf(analysis, 'date-not-allowed', 'docs/notes/plan.md').reason, /review_by/);
  });

  it('EVM-012 AC3: klasa sprzeczna z lokalizacją — próba obniżenia klasy ADR-a', () => {
    const analysis = analyzeFiles({
      'docs/architecture/adr/0003-przyklad.md': doc({ lifecycle: 'milestone', milestone: 'M0' }),
      'docs/architecture/adr/0004-przyklad.md': doc({ lifecycle: 'permanent' }),
    });
    assert.deepEqual(codes(analysis, 'error'), ['class-conflict docs/architecture/adr/0003-przyklad.md']);
    const finding = findingOf(analysis, 'class-conflict', 'docs/architecture/adr/0003-przyklad.md');
    assert.equal(finding.class, 'permanent');
    assert.match(finding.reason, /reguła 8/);
    assert.equal(fileOf(analysis, 'docs/architecture/adr/0003-przyklad.md').class, 'permanent');
  });

  it('EVM-012 AC3: plik roboczy (lifecycle: ephemeral) w części śledzonej przez git', () => {
    const analysis = analyzeFiles({
      'docs/notes/szkic.md': doc({ lifecycle: 'ephemeral' }),
      'docs/product/szkic.md': doc({ lifecycle: 'ephemeral' }),
      'szkic.md': doc({ lifecycle: 'ephemeral' }),
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'ephemeral-tracked docs/notes/szkic.md',
      'ephemeral-tracked docs/product/szkic.md',
      'ephemeral-tracked szkic.md',
    ]);
    assert.equal(fileOf(analysis, 'szkic.md').class, 'ephemeral');
    assert.equal(fileOf(analysis, 'docs/product/szkic.md').class, 'living');
    assert.match(findingOf(analysis, 'ephemeral-tracked', 'szkic.md').reason, /\.scratch\//);
  });

  it('EVM-012 AC3: każdy plik w .scratch/ widoczny dla gita jest błędem, niezależnie od typu', () => {
    const analysis = analyzeFiles({ '.scratch/notatka.md': '# R\n', '.scratch/EVM-012/wynik.txt': 'x' });
    assert.deepEqual(codes(analysis, 'error'), [
      'ephemeral-tracked .scratch/EVM-012/wynik.txt',
      'ephemeral-tracked .scratch/notatka.md',
    ]);
    assert.equal(fileOf(analysis, '.scratch/notatka.md').class, 'ephemeral');
    assert.match(findingOf(analysis, 'ephemeral-tracked', '.scratch/notatka.md').reason, /git rm --cached/);
  });

  it('EVM-012 AC3: katalog .scratch/ nieignorowany przez git', () => {
    const analysis = analyzeFiles({}, { scratchIgnored: false });
    assert.deepEqual(codes(analysis, 'error'), ['scratch-not-ignored .scratch/']);
    assert.match(analysis.findings[0].reason, /\.gitignore/);
  });

  it('EVM-012 AC3: dowód QA/UX bez historyjki, z historyjką bez M# albo z kilkoma historyjkami o tym ID', () => {
    const analysis = analyzeFiles({
      'docs/qa/EVM-999/raport.md': '# QA\n',
      'docs/backlog/M0/EVM-003-bez-m.md': story('EVM-003', undefined),
      'docs/ux/reviews/EVM-003/raport.md': '# UX\n',
      'docs/backlog/M0/EVM-004-a.md': story('EVM-004', 'M0'),
      'docs/backlog/M1/EVM-004-b.md': story('EVM-004', 'M1'),
      'docs/qa/EVM-004/raport.md': '# QA\n',
      'docs/backlog/M0/EVM-005-m9.md': story('EVM-005', 'M9'),
      'docs/qa/EVM-005/raport.md': '# QA\n',
    });
    assert.deepEqual(codes(analysis, 'error'), [
      'milestone-missing docs/qa/EVM-004/raport.md',
      'milestone-unknown docs/qa/EVM-005/raport.md',
      'milestone-missing docs/qa/EVM-999/raport.md',
      'milestone-missing docs/ux/reviews/EVM-003/raport.md',
    ]);
    assert.match(findingOf(analysis, 'milestone-missing', 'docs/qa/EVM-999/raport.md').reason, /EVM-999/);
    assert.match(findingOf(analysis, 'milestone-missing', 'docs/qa/EVM-004/raport.md').reason, /EVM-004-a\.md.*EVM-004-b\.md/);
  });

  it('EVM-012 AC3: dowód QA/UX dziedziczy M# z historyjki; inne pole milestone = sprzeczność z lokalizacją', () => {
    const analysis = analyzeFiles({
      'docs/qa/EVM-001/raport.md': '# QA\n',
      'docs/ux/reviews/EVM-001/runda-1/raport.md': doc({ milestone: 'M0', lifecycle: 'milestone' }),
      'docs/qa/EVM-101/raport.md': doc({ milestone: 'M0' }),
    });
    assert.deepEqual(codes(analysis, 'error'), ['class-conflict docs/qa/EVM-101/raport.md']);
    assert.equal(fileOf(analysis, 'docs/qa/EVM-001/raport.md').milestone, 'M0');
    assert.equal(fileOf(analysis, 'docs/ux/reviews/EVM-001/runda-1/raport.md').milestone, 'M0');
    assert.match(findingOf(analysis, 'class-conflict', 'docs/qa/EVM-101/raport.md').reason, /„M0”.*M1/);
  });

  it('EVM-012 AC3: spike — katalog bez README, README bez M# albo z nieistniejącym M#', () => {
    const analysis = analyzeFiles(
      {
        'spikes/bez-m/README.md': '# Spike\n',
        'spikes/zly-m/README.md': doc({ milestone: 'M7' }),
        'spikes/zly-m/notatki.md': '# N\n',
      },
      { extraPaths: ['spikes/bez-readme/kolejka.ts', 'spikes/bez-readme/test/kolejka.test.ts', 'spikes/luzny.ts'] },
    );
    assert.deepEqual(codes(analysis, 'error'), [
      'milestone-missing spikes/bez-m/README.md',
      'spike-readme-missing spikes/bez-readme/',
      'milestone-unknown spikes/zly-m/README.md',
    ]);
    assert.equal(fileOf(analysis, 'spikes/zly-m/notatki.md').milestone, null);
    assert.match(findingOf(analysis, 'spike-readme-missing', 'spikes/bez-readme/').reason, /README\.md/);
  });

  it('EVM-012 AC3: pliki spike’a dziedziczą M# z README; inne pole milestone = sprzeczność z lokalizacją', () => {
    const analysis = analyzeFiles(
      {
        'spikes/upload/README.md': doc({ milestone: 'M0' }),
        'spikes/upload/wyniki.md': '# Wyniki\n',
        'spikes/upload/notatki.md': doc({ milestone: 'M1' }),
      },
      { extraPaths: ['spikes/upload/kolejka.ts'] },
    );
    assert.deepEqual(codes(analysis, 'error'), ['class-conflict spikes/upload/notatki.md']);
    const readme = fileOf(analysis, 'spikes/upload/README.md');
    assert.equal(readme.milestone, 'M0');
    assert.equal(readme.spikeDir, 'spikes/upload/');
    assert.equal(fileOf(analysis, 'spikes/upload/wyniki.md').milestone, 'M0');
    assert.deepEqual(analysis.spikes.get('spikes/upload/'), {
      dir: 'spikes/upload/',
      files: ['spikes/upload/README.md', 'spikes/upload/kolejka.ts', 'spikes/upload/notatki.md', 'spikes/upload/wyniki.md'],
      milestone: 'M0',
    });
  });

  it('EVM-012 AC3: pole milestone w plikach trwałych i żywych jest ignorowane (historyjki dla /progress)', () => {
    const analysis = analyzeFiles({
      'docs/backlog/M0/EVM-006-przyklad.md': story('EVM-006', 'M42'),
      'docs/notes/zasady.md': doc({ lifecycle: 'living', milestone: 'M42' }),
      'docs/README.md': '# D\n- notes/zasady.md\n- process/workflow.md\n- product/roadmap.md\n',
    });
    assert.deepEqual(codes(analysis), []);
    assert.equal(fileOf(analysis, 'docs/notes/zasady.md').milestone, null);
  });

  it('EVM-012 AC3: ustalenia są posortowane deterministycznie: błędy, potem ścieżka (jednostki kodu)', () => {
    const analysis = analyzeFiles({ 'b.md': '# B\n', 'B.md': '# B\n', 'a.md': '# A\n', 'Ą.md': '# A\n' });
    assert.deepEqual(codes(analysis, 'error'), [
      'location-forbidden B.md',
      'location-forbidden a.md',
      'location-forbidden b.md',
      'location-forbidden Ą.md',
    ]);
  });

  it('EVM-012 AC3: plik niebędący zwykłym plikiem (np. dowiązanie) nie jest czytany — traktowany jak plik bez metadanych', () => {
    // read() returns null for such paths (see repository.mjs → readRegularFile)
    const analysis = analyzeFiles({}, { extraPaths: ['docs/notes/dowiazanie.md'] });
    assert.deepEqual(codes(analysis, 'error'), ['class-missing docs/notes/dowiazanie.md']);
  });
});
