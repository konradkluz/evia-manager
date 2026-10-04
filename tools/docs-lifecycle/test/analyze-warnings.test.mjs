// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFiles, codes, doc, story } from './helpers/fixtures.mjs';

const README = '# Dokumentacja\n- process/workflow.md\n- product/roadmap.md\n';

describe('walidator — ostrzeżenia (EVM-012 AC4)', () => {
  it('EVM-012 AC4: przeterminowane expires (kamień milowy) i review_by (żywy) — ostrzeżenie z datą, bez błędów', () => {
    const analysis = analyzeFiles({
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-01' }),
      'docs/product/cennik.md': doc({ review_by: '2026-09-30' }),
      'docs/README.md': `${README}- notes/plan.md\n- product/cennik.md\n`,
    });
    assert.deepEqual(codes(analysis), ['expired docs/notes/plan.md', 'expired docs/product/cennik.md']);
    assert.equal(analysis.errorCount, 0);
    assert.equal(analysis.warningCount, 2);
    const [plan, cennik] = analysis.findings;
    assert.equal(plan.severity, 'warning');
    assert.match(plan.reason, /przeterminowany: expires 2026-10-01 \(dzisiaj 2026-10-02\)/);
    assert.match(cennik.reason, /przeterminowany: review_by 2026-09-30/);
    assert.equal(cennik.class, 'living');
  });

  it('EVM-012 AC4: termin równy dzisiejszej dacie albo późniejszy nie jest przeterminowany', () => {
    const analysis = analyzeFiles({
      'docs/notes/dzis.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-02' }),
      'docs/notes/jutro.md': doc({ lifecycle: 'living', review_by: '2026-10-03' }),
      'docs/README.md': `${README}- notes/dzis.md\n- notes/jutro.md\n`,
    });
    assert.deepEqual(codes(analysis), []);
  });

  it('EVM-012 AC4: „dzisiaj” jest parametrem — ten sam plik przeterminowany dzień później', () => {
    const files = {
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-02' }),
      'docs/README.md': `${README}- notes/plan.md\n`,
    };
    assert.deepEqual(codes(analyzeFiles(files, { today: '2026-10-02' })), []);
    assert.deepEqual(codes(analyzeFiles(files, { today: '2026-10-03' })), ['expired docs/notes/plan.md']);
  });

  it('EVM-012 AC4: osierocony — plik, do którego nie odwołuje się żaden inny dokument', () => {
    const analysis = analyzeFiles({
      'docs/product/zapomniany.md': '# Zapomniany\nSamoodwołanie: docs/product/zapomniany.md\n',
      'docs/notes/sierota.md': doc({ lifecycle: 'living' }),
    });
    assert.deepEqual(codes(analysis), ['orphan docs/notes/sierota.md', 'orphan docs/product/zapomniany.md']);
    assert.equal(analysis.errorCount, 0);
    assert.match(analysis.findings[0].reason, /osierocony/);
  });

  it('EVM-012 AC4: odwołanie linkiem, ścieżką w `kodzie`, ścieżką względną i od katalogu głównego usuwa ostrzeżenie', () => {
    const analysis = analyzeFiles({
      'docs/product/a.md': '# A\n',
      'docs/product/b.md': '# B\n',
      'docs/product/c.md': '# C\n',
      'docs/product/d-łódź.md': '# D\n',
      'docs/process/workflow.md': [
        '# Workflow',
        '[A](../product/a.md#sekcja)',
        'Plik `docs/product/b.md` oraz /docs/product/c.md.',
        '[D](../product/d-%C5%82%C3%B3d%C5%BA.md)',
      ].join('\n'),
    });
    assert.deepEqual(codes(analysis), []);
    assert.deepEqual(analysis.references.get('docs/product/a.md'), ['docs/process/workflow.md']);
  });

  it('EVM-012 AC4: README.md, indeksy i pliki z konwencji katalogów nigdy nie są osierocone', () => {
    const analysis = analyzeFiles(
      {
        'docs/product/README.md': '# Produkt\n',
        'docs/architecture/adr/0002-zastapiona.md': '# ADR-0002\n- **Status:** Zastąpiona przez ADR-0005\n',
        'docs/backlog/M0/EVM-007-przyklad.md': story('EVM-007', 'M0', 'done'),
        'docs/process/retros/M0.md': '# Retrospektywa M0\n',
        'docs/spikes/EVM-011-raport.md': '# Raport spike’a\n',
        'docs/qa/EVM-001/raport.md': '# QA\n',
        'spikes/upload/README.md': doc({ milestone: 'M0' }),
        '.claude/agents/agent.md': '# Agent\n',
        'tools/narzedzie/README.md': '# Narzędzie\n',
        'docs/notes/README.md': doc({ lifecycle: 'living' }, '# Notatki\n'),
      },
      { extraPaths: ['spikes/upload/kolejka.ts'] },
    );
    assert.deepEqual(codes(analysis), []);
  });

  it('EVM-012 AC4: pliki z błędem klasy nie dostają dodatkowo ostrzeżenia „osierocony”', () => {
    const analysis = analyzeFiles({ 'docs/notes/bez-klasy.md': '# N\n', 'docs/notes/robocza.md': doc({ lifecycle: 'ephemeral' }) });
    assert.deepEqual(codes(analysis), ['class-missing docs/notes/bez-klasy.md', 'ephemeral-tracked docs/notes/robocza.md']);
  });

  it('EVM-012 AC4: class-conflict i class-unknown w docs/product/ bez odwołań — tylko BŁĄD, bez „osierocony”', () => {
    const analysis = analyzeFiles({
      'docs/product/sprzeczny.md': doc({ lifecycle: 'permanent' }),
      'docs/product/nieznana.md': doc({ lifecycle: 'archiwum' }),
      'docs/notes/zla-klasa.md': doc({ lifecycle: 'archiwum' }),
    });
    assert.deepEqual(codes(analysis), [
      'class-unknown docs/notes/zla-klasa.md',
      'class-unknown docs/product/nieznana.md',
      'class-conflict docs/product/sprzeczny.md',
    ]);
    assert.equal(analysis.warningCount, 0);
    assert.equal(
      analysis.files.some((file) => file.orphan),
      false,
    );
  });

  it('EVM-012 AC4: inne błędy (np. niepoprawna data) nie wyłączają ostrzeżenia „osierocony”', () => {
    const analysis = analyzeFiles({ 'docs/product/data.md': doc({ review_by: '2026-13-01' }) });
    assert.deepEqual(codes(analysis), ['date-invalid docs/product/data.md', 'orphan docs/product/data.md']);
  });

  it('EVM-012 AC4: błędy przed ostrzeżeniami; ostrzeżenia nie zmieniają liczby błędów', () => {
    const analysis = analyzeFiles({
      'a-notatka.md': '# N\n',
      'docs/product/zapomniany.md': '# Z\n',
    });
    assert.deepEqual(codes(analysis), ['location-forbidden a-notatka.md', 'orphan docs/product/zapomniany.md']);
    assert.equal(analysis.errorCount, 1);
    assert.equal(analysis.warningCount, 1);
  });
});
