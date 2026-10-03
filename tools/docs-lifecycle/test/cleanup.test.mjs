// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIONS, buildCleanupReport, proposeAction } from '../lib/cleanup.mjs';
import { analyzeFiles, doc, story } from './helpers/fixtures.mjs';

/** Synthetic set with every kind of document, milestone files of M0 and M1, expired and orphaned files. */
function fixture() {
  return {
    'docs/README.md': [
      '# Dokumentacja',
      '- process/workflow.md, product/roadmap.md, product/cennik.md',
      '- notes/plan-m0.md, notes/plan-m1.md, notes/stary-m1.md',
      '- ../spikes/upload/README.md',
    ].join('\n'),
    // trwałe
    'docs/architecture/adr/0001-przyklad.md': '# ADR-0001\n- **Status:** Zaakceptowana\n',
    'docs/architecture/adr/0002-stara.md': '# ADR-0002\n- **Status:** Zastąpiona przez ADR-0001\n',
    'docs/architecture/adr/0005-obnizona.md': doc({ lifecycle: 'milestone', milestone: 'M0' }, '# ADR-0005\n'),
    'docs/process/retros/M0.md': '# Retrospektywa M0\n',
    'docs/spikes/EVM-011-raport.md': '# Raport spike’a EVM-011\n',
    'docs/backlog/M0/EVM-011-spike.md': story('EVM-011', 'M0', 'done'),
    // żywe
    'docs/product/cennik.md': doc({ review_by: '2026-09-01' }, '# Cennik\n'),
    'docs/product/zapomniany.md': '# Zapomniany\n',
    // kamień milowy M0
    'docs/qa/EVM-001/raport.md': '# QA EVM-001\n',
    'docs/notes/plan-m0.md': doc({ lifecycle: 'milestone', milestone: 'M0' }),
    'spikes/upload/README.md': doc({ milestone: 'M0' }, '# Spike EVM-011\n'),
    'spikes/upload/wyniki.md': '# Wyniki\n',
    'docs/ux/reviews/EVM-001/raport.md': doc({ review_by: '2027-01-01' }, '# UX z błędem\n'),
    // kamień milowy M1
    'docs/qa/EVM-101/raport.md': '# QA EVM-101\n',
    'docs/notes/plan-m1.md': doc({ lifecycle: 'milestone', milestone: 'M1' }),
    'docs/notes/stary-m1.md': doc({ lifecycle: 'milestone', milestone: 'M1', expires: '2026-09-15' }),
  };
}

const analysis = analyzeFiles(fixture(), { extraPaths: ['spikes/upload/kolejka.ts'] });

/** @param {string} target */
const report = (target) => buildCleanupReport(analysis, target);

/** @param {import('../lib/cleanup.mjs').CleanupReport} result */
const actions = (result) => result.items.map((item) => `${item.action} ${item.path}`);

const PERMANENT_OR_LIVING = [
  'docs/architecture/adr/0001-przyklad.md',
  'docs/architecture/adr/0002-stara.md',
  'docs/architecture/adr/0005-obnizona.md',
  'docs/backlog/M0/EVM-001-przyklad.md',
  'docs/backlog/M0/EVM-011-spike.md',
  'docs/process/retros/M0.md',
  'docs/spikes/EVM-011-raport.md',
  'docs/product/cennik.md',
  'docs/product/zapomniany.md',
];

describe('raport sprzątania (EVM-012 AC5)', () => {
  it('EVM-012 AC5: raport dla M0 — pliki M0 do usunięcia oraz przeterminowane i osierocone do przejrzenia', () => {
    assert.deepEqual(actions(report('M0')), [
      'usuń docs/notes/plan-m0.md',
      'usuń docs/qa/EVM-001/raport.md',
      'usuń spikes/upload/',
      'przejrzyj docs/notes/stary-m1.md',
      'przejrzyj docs/product/cennik.md',
      'przejrzyj docs/product/zapomniany.md',
      'przejrzyj docs/ux/reviews/EVM-001/raport.md',
    ]);
  });

  it('EVM-012 AC5: pliki przypisane do M1 nie są proponowane do usunięcia w raporcie dla M0 (a w raporcie dla M1 — tak)', () => {
    const m0 = report('M0').items;
    for (const path of ['docs/qa/EVM-101/raport.md', 'docs/notes/plan-m1.md', 'docs/notes/stary-m1.md']) {
      assert.ok(!m0.some((item) => item.path === path && item.action === ACTIONS.remove), path);
    }
    assert.deepEqual(actions(report('M1')), [
      'usuń docs/notes/plan-m1.md',
      'usuń docs/notes/stary-m1.md',
      'usuń docs/qa/EVM-101/raport.md',
      'przejrzyj docs/product/cennik.md',
      'przejrzyj docs/product/zapomniany.md',
    ]);
  });

  it('EVM-012 AC5: każda pozycja ma ścieżkę, klasę, akcję ze słownika i uzasadnienie', () => {
    const dictionary = [ACTIONS.remove, ACTIONS.archive, ACTIONS.review, ACTIONS.keep];
    assert.deepEqual(dictionary, ['usuń', 'archiwizuj', 'przejrzyj', 'zostaw']);
    for (const target of ['M0', 'M1', 'M2']) {
      for (const item of report(target).items) {
        assert.ok(item.path.length > 0);
        assert.ok(['permanent', 'living', 'milestone'].includes(item.class), `${item.path}: ${item.class}`);
        assert.ok(dictionary.includes(item.action));
        assert.ok(item.reason.length > 20, item.reason);
      }
    }
  });

  it('EVM-012 AC5: uzasadnienie — źródło M#, odwołania, przeterminowanie, osierocenie, błędy', () => {
    const items = new Map(report('M0').items.map((item) => [item.path, item.reason]));
    assert.match(String(items.get('docs/qa/EVM-001/raport.md')), /kamień milowy M0 \(pole milestone historyjki EVM-001\); odwołania: brak/);
    assert.match(String(items.get('docs/notes/plan-m0.md')), /odwołania: docs\/README\.md/);
    assert.match(String(items.get('spikes/upload/')), /katalog spike'a \(plików: 3\).*spikes\/upload\/README\.md/);
    assert.match(String(items.get('docs/notes/stary-m1.md')), /kamień milowy M1.*przeterminowany: expires 2026-09-15/);
    assert.match(String(items.get('docs/product/cennik.md')), /przeterminowany: review_by 2026-09-01/);
    assert.match(String(items.get('docs/product/zapomniany.md')), /osierocony/);
    assert.match(String(items.get('docs/ux/reviews/EVM-001/raport.md')), /kamień milowy M0.*błęd/);
  });

  it('EVM-012 AC5: katalog spike’a to jedna pozycja; plik z błędem w katalogu blokuje „usuń”', () => {
    const withError = analyzeFiles(
      { ...fixture(), 'spikes/upload/notatki.md': doc({ milestone: 'M1' }) },
      { extraPaths: ['spikes/upload/kolejka.ts'] },
    );
    const items = buildCleanupReport(withError, 'M0').items.filter((item) => item.path.startsWith('spikes/'));
    assert.deepEqual(
      items.map((item) => `${item.action} ${item.path}`),
      ['przejrzyj spikes/upload/'],
    );
  });

  it('EVM-012 AC5: przeterminowany spike innego kamienia — „przejrzyj” z datą z README', () => {
    const expired = analyzeFiles(
      { 'spikes/stary/README.md': doc({ milestone: 'M1', expires: '2026-09-01' }) },
      { extraPaths: ['spikes/stary/kod.ts'] },
    );
    const [item] = buildCleanupReport(expired, 'M0').items;
    assert.equal(item.path, 'spikes/stary/');
    assert.equal(item.action, ACTIONS.review);
    assert.match(item.reason, /kamień milowy M1.*README\.md: expires 2026-09-01/);
  });

  it('EVM-012 AC5: brak pozycji — pusta lista; liczba błędów walidacji przekazana do raportu', () => {
    const clean = buildCleanupReport(analyzeFiles({}), 'M2');
    assert.deepEqual(clean.items, []);
    assert.equal(clean.errorCount, 0);
    assert.equal(clean.target, 'M2');
    assert.ok(report('M0').errorCount > 0);
  });

  it('EVM-012 AC5: długa lista odwołań jest skracana', () => {
    /** @type {Record<string, string>} */
    const files = { 'docs/notes/plan.md': doc({ lifecycle: 'milestone', milestone: 'M0' }) };
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) files[`docs/product/${name}.md`] = 'docs/notes/plan.md\n';
    files['docs/README.md'] = '- product/a.md product/b.md product/c.md product/d.md product/e.md product/f.md product/g.md\n';
    const [item] = buildCleanupReport(analyzeFiles(files), 'M0').items;
    assert.match(item.reason, /odwołania: docs\/product\/a\.md, .*docs\/product\/e\.md i 2 inne/);
  });
});

describe('ochrona plików trwałych i żywych (EVM-012 AC6)', () => {
  it('EVM-012 AC6: dla każdego kamienia żaden plik trwały ani żywy nie ma „usuń” ani „archiwizuj”', () => {
    for (const target of analysis.milestones) {
      for (const item of report(target).items) {
        if (PERMANENT_OR_LIVING.includes(item.path) || ['permanent', 'living'].includes(item.class)) {
          assert.equal(item.action, ACTIONS.review, `${target}: ${item.path}`);
        }
        assert.notEqual(item.action, ACTIONS.archive);
      }
    }
  });

  it('EVM-012 AC6: ADR (także „Zastąpiona”), historyjka done, retrospektywa i raport spike’a nie trafiają do raportu', () => {
    for (const target of analysis.milestones) {
      const paths = report(target).items.map((item) => item.path);
      for (const path of PERMANENT_OR_LIVING.slice(0, 7)) assert.ok(!paths.includes(path), `${target}: ${path}`);
    }
  });

  it('EVM-012 AC6: plik żywy z przeterminowanym review_by — co najwyżej „przejrzyj”', () => {
    for (const target of analysis.milestones) {
      const item = report(target).items.find((entry) => entry.path === 'docs/product/cennik.md');
      assert.equal(item?.action, ACTIONS.review, target);
      assert.match(String(item?.reason), /przegląd aktualności/);
    }
  });

  it('EVM-012 AC6: próba obniżenia klasy ADR-a (lifecycle: milestone) nie daje „usuń” — plik liczony wg reguły lokalizacji', () => {
    const adr = analysis.files.find((file) => file.path === 'docs/architecture/adr/0005-obnizona.md');
    assert.equal(adr?.class, 'permanent');
    assert.ok(analysis.findings.some((finding) => finding.code === 'class-conflict' && finding.path === adr?.path));
  });

  it('EVM-012 AC6: funkcja decyzji — „usuń” wyłącznie dla poprawnego pliku „kamień milowy” wskazanego M#', () => {
    const classes = ['permanent', 'living', 'milestone', 'ephemeral', null];
    for (const cls of classes) {
      for (const milestone of [null, 'M0', 'M1']) {
        for (const hasErrors of [false, true]) {
          for (const expired of [false, true]) {
            for (const orphan of [false, true]) {
              const action = proposeAction({ class: cls, milestone, hasErrors, expired, orphan }, 'M0');
              const removable = cls === 'milestone' && milestone === 'M0' && !hasErrors;
              const reviewable = (cls === 'milestone' && milestone === 'M0') || expired || orphan;
              const expected = removable ? ACTIONS.remove : reviewable ? ACTIONS.review : null;
              assert.equal(action, expected, JSON.stringify({ cls, milestone, hasErrors, expired, orphan }));
            }
          }
        }
      }
    }
  });
});
