// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCleanupReport } from '../lib/cleanup.mjs';
import { formatCheck, formatCleanupReport, USAGE } from '../lib/format.mjs';
import { analyzeFiles, doc } from './helpers/fixtures.mjs';

const POLICY = 'docs/process/document-lifecycle.md';

describe('format wyjścia walidatora (EVM-012)', () => {
  it('EVM-012 AC4: stan czysty — liczby wg klas, klasa nadana ręcznie: brak, jednoznaczny komunikat', () => {
    const text = formatCheck(analyzeFiles({}), { list: false, policy: POLICY });
    assert.equal(
      text,
      [
        'Podsumowanie (2026-10-02, Europe/Warsaw) — plików .md: 6',
        '- trwały (permanent): 2',
        '- żywy (living): 4',
        '- kamień milowy (milestone): 0',
        '- roboczy (ephemeral): 0',
        '- bez klasy: 0',
        'Klasa nadana ręcznie (pole lifecycle w docs/notes/): brak',
        'błędy: 0 · ostrzeżenia: 0',
        'Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką',
        '',
      ].join('\n'),
    );
  });

  it('EVM-012 AC3: wiersz ustalenia — BŁĄD · ścieżka · klasa lub — · powód; podsumowanie z liczbą błędów', () => {
    const analysis = analyzeFiles({
      'notatka.md': '# N\n',
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0', expires: '2026-10-01' }),
    });
    const lines = formatCheck(analysis, { list: false, policy: POLICY }).split('\n');
    assert.match(lines[0], /^BŁĄD · notatka\.md · — · plik poza dozwolonymi lokalizacjami/);
    assert.match(lines[1], /^OSTRZEŻENIE · docs\/notes\/plan\.md · kamień milowy · przeterminowany: expires 2026-10-01/);
    assert.match(lines[2], /^OSTRZEŻENIE · docs\/notes\/plan\.md · kamień milowy · osierocony/);
    assert.equal(lines[3], '');
    assert.ok(lines.includes('Klasa nadana ręcznie (pole lifecycle w docs/notes/): 1'));
    assert.ok(lines.includes('- docs/notes/plan.md · kamień milowy'));
    assert.ok(lines.includes('- bez klasy: 1'));
    assert.ok(lines.includes('błędy: 1 · ostrzeżenia: 2'));
    assert.match(lines.at(-2) ?? '', /^Wynik: błędy \(1\) — popraw je przed oddaniem przyrostu \(docs\/process\/document-lifecycle\.md\)/);
  });

  it('EVM-012 AC4: same ostrzeżenia — wynik bez błędów z informacją, że ostrzeżenia nie blokują', () => {
    const analysis = analyzeFiles({ 'docs/product/zapomniany.md': '# Z\n' });
    const text = formatCheck(analysis, { list: false, policy: POLICY });
    assert.match(text, /Wynik: brak błędów; ostrzeżenia \(1\) do przejrzenia — nie blokują\n$/);
  });

  it('EVM-012 AC2: --list — każdy plik z klasą i źródłem klasy', () => {
    const analysis = analyzeFiles({
      'docs/notes/zasady.md': doc({ lifecycle: 'living' }),
      'notatka.md': '# N\n',
      'docs/README.md': '# D\n- notes/zasady.md process/workflow.md product/roadmap.md\n',
    });
    const text = formatCheck(analysis, { list: true, policy: POLICY });
    assert.ok(text.startsWith('Pliki .md (8) — ścieżka · klasa · źródło klasy:\n'));
    assert.match(text, /\nREADME\.md · żywy · reguła 1\n/);
    assert.match(text, /\ndocs\/backlog\/M0\/EVM-001-przyklad\.md · trwały · reguła 6\n/);
    assert.match(text, /\ndocs\/notes\/zasady\.md · żywy · pole lifecycle \(reguła 14\)\n/);
    assert.match(text, /\nnotatka\.md · — · brak pasującej reguły — lokalizacja niedozwolona\n/);
  });

  it('EVM-012 AC3: znaki sterujące i niewidoczne w ścieżkach są escapowane w wyjściu', () => {
    const analysis = analyzeFiles({ 'docs/zły‮plik.md': '# X\n', 'docs/tab\tplik.md': '# X\n' });
    const text = formatCheck(analysis, { list: true, policy: POLICY });
    assert.ok(text.includes('docs/zły\\u{202E}plik.md'));
    assert.ok(text.includes('docs/tab\\u{9}plik.md'));
    assert.ok(!text.includes('‮'));
    assert.ok(!text.includes('\t'));
  });

  it('EVM-012 AC5: raport sprzątania — tabela Markdown, liczba pozycji i stopka „tylko odczyt”', () => {
    const analysis = analyzeFiles({
      'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0' }),
      'docs/README.md': '# D\n- notes/plan.md process/workflow.md product/roadmap.md\n',
    });
    const text = formatCleanupReport(buildCleanupReport(analysis, 'M0'));
    const lines = text.split('\n');
    assert.equal(lines[0], '# Raport sprzątania dokumentacji — M0');
    assert.equal(lines[2], 'Data: 2026-10-02 (Europe/Warsaw) · plików .md: 7');
    assert.ok(lines.includes('| Ścieżka | Klasa | Proponowana akcja | Uzasadnienie |'));
    assert.ok(lines.includes('|---|---|---|---|'));
    assert.ok(lines.some((line) => /^\| `docs\/notes\/plan\.md` \| kamień milowy \| usuń \| kamień milowy M0 \(pole milestone\); odwołania: docs\/README\.md/.test(line)));
    assert.ok(lines.includes('Pozycje: 1 (usuń: 1, przejrzyj: 0).'));
    assert.ok(lines.includes('_Tylko odczyt — żaden plik nie został zmieniony; decyzję podejmuje Konrad w `/milestone close`._'));
    assert.ok(!text.includes('Uwaga'));
  });

  it('EVM-012 AC5: raport bez pozycji — jednoznaczny komunikat; przy błędach walidacji — ostrzeżenie na początku', () => {
    const empty = formatCleanupReport(buildCleanupReport(analyzeFiles({}), 'M1'));
    assert.match(empty, /Brak pozycji do sprzątania dla M1 — żaden plik nie jest przypisany do M1 ani przeterminowany lub osierocony\./);
    assert.ok(!empty.includes('| Ścieżka |'));
    assert.match(empty, /_Tylko odczyt — żaden plik nie został zmieniony/);
    const withErrors = formatCleanupReport(buildCleanupReport(analyzeFiles({ 'notatka.md': '# N\n' }), 'M1'));
    assert.match(withErrors, /\n> \*\*Uwaga:\*\* walidator zgłasza błędy \(1\) — uruchom `npm run docs:check` i popraw je przed decyzją/);
  });

  it('EVM-012 AC5: komórki tabeli są bezpieczne — | escapowane, ścieżka z ` w podwójnych znakach kodu', () => {
    const analysis = analyzeFiles({
      'docs/product/a|b.md': '# A\n',
      'docs/product/c`d.md': '# C\n',
    });
    const text = formatCleanupReport(buildCleanupReport(analysis, 'M0'));
    assert.ok(text.includes('| `docs/product/a\\|b.md` | żywy | przejrzyj |'));
    assert.ok(text.includes('| `` docs/product/c`d.md `` | żywy | przejrzyj |'));
  });

  it('EVM-012 AC3: pomoc opisuje polecenia, kody wyjścia i formy bezpieczne dla PowerShell', () => {
    assert.match(USAGE, /check \[--list\] \[--today YYYY-MM-DD\]/);
    assert.match(USAGE, /cleanup-report <M#> \[--today YYYY-MM-DD\]/);
    assert.match(USAGE, /npm run docs:check '--' --list/);
    assert.match(USAGE, /0 .*1 .*2 /s);
  });
});
