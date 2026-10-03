// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReferenceIndex, extractPathTokens, referenceCandidates } from '../lib/references.mjs';
import { analyzeFiles, codes } from './helpers/fixtures.mjs';

/** The original backtracking token pattern — reference oracle, used only on short inputs. */
const ORACLE = /\/?(?:[\p{L}\p{N}\p{M}._~%+@-]+\/)*[\p{L}\p{N}\p{M}._~%+@-]*\.md(?![\p{L}\p{N}\p{M}_-])/gu;

/**
 * Deterministic pseudo-random generator (mulberry32) — reproducible synthetic inputs.
 * @param {number} seed
 * @returns {() => number} numbers in [0, 1)
 */
function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Time limit for analysing one ≥ 200 KB line without spaces (finding QA: quadratic backtracking). */
const LIMIT_MS = 2000;
const LONG = 200 * 1024;

/**
 * @param {Record<string, string>} files
 * @returns {Record<string, string[]>}
 */
const index = (files) => Object.fromEntries(buildReferenceIndex(Object.keys(files), (path) => files[path]));

describe('odwołania między dokumentami (EVM-012, ustalenie E)', () => {
  it('EVM-012 AC4: ścieżki .md w linkach, w `kodzie` i w zwykłym tekście, także z polskimi znakami', () => {
    const text = [
      'Zobacz [workflow](../process/workflow.md#raport-agenta) i `docs/product/roadmap.md`.',
      'Notatka: docs/notes/plan-łódź.md, szablon: _template.md?raw=1.',
      'Nie ścieżki: plik.mdx, *.md → końcówka, https://example.com/x.md',
    ].join('\n');
    assert.deepEqual(extractPathTokens(text), [
      '../process/workflow.md',
      'docs/product/roadmap.md',
      'docs/notes/plan-łódź.md',
      '_template.md',
      '.md',
      '/example.com/x.md',
    ]);
  });

  it('EVM-012 AC4: kandydaci — względem katalogu dokumentu i katalogu głównego; / na początku = katalog główny', () => {
    assert.deepEqual(referenceCandidates('docs/process/a.md', '../product/roadmap.md'), ['docs/product/roadmap.md']);
    assert.deepEqual(referenceCandidates('docs/README.md', 'process/workflow.md'), ['docs/process/workflow.md', 'process/workflow.md']);
    assert.deepEqual(referenceCandidates('README.md', 'docs/README.md'), ['docs/README.md']);
    assert.deepEqual(referenceCandidates('docs/a.md', '/docs/b.md'), ['docs/b.md']);
    assert.deepEqual(referenceCandidates('docs/a.md', './b.md'), ['docs/b.md', 'b.md']);
  });

  it('EVM-012 AC4: ścieżki poza repozytorium są pomijane; kodowanie URL i NFC są normalizowane', () => {
    assert.deepEqual(referenceCandidates('docs/a.md', '../../poza.md'), []);
    assert.deepEqual(referenceCandidates('a.md', '../poza.md'), []);
    assert.deepEqual(referenceCandidates('docs/a.md', 'notatka-%C5%82%C3%B3d%C5%BA.md'), ['docs/notatka-łódź.md', 'notatka-łódź.md']);
    assert.deepEqual(referenceCandidates('docs/a.md', 'zly-%E0%A4%A.md'), ['docs/zly-%E0%A4%A.md', 'zly-%E0%A4%A.md']);
    assert.deepEqual(referenceCandidates('docs/a.md', 'lódz.md'), ['docs/lódz.md', 'lódz.md']);
  });

  it('EVM-012 AC4: indeks odwołań — tylko istniejące pliki ze zbioru, bez samoodwołań, posortowany', () => {
    const files = {
      'README.md': 'Start: docs/README.md, docs/product/vision.md',
      'docs/README.md': '[wizja](product/vision.md), [domena](product/domain.md), ja: docs/README.md, brak: docs/nie-ma.md',
      'docs/product/vision.md': 'Powiązane: `domain.md`',
      'docs/product/domain.md': 'Samo do siebie: domain.md i docs/product/domain.md',
    };
    assert.deepEqual(index(files), {
      'docs/README.md': ['README.md'],
      'docs/product/vision.md': ['README.md', 'docs/README.md'],
      'docs/product/domain.md': ['docs/README.md', 'docs/product/vision.md'],
    });
  });

  it('EVM-012 AC4: dopasowanie ścieżek w NFC — nazwa pliku w NFD i odwołanie w NFC wskazują ten sam plik', () => {
    const nfd = 'docs/notes/lódz.md';
    const files = { [nfd]: '# N', 'docs/README.md': 'notes/lódz.md' };
    assert.deepEqual(index(files), { [nfd]: ['docs/README.md'] });
  });

  it('EVM-012 AC4: podwójny ukośnik, kilka .md w jednym ciągu, .md przed literą — jak dotychczasowy wzorzec', () => {
    const text = [
      'a//b.md ///c.md x/.md /.md a.md/b.md a.md.md a.md-b.md a.md.bak a.mdb/c.md',
      'a.md/b.mdx a.md-x a/b//c/d.md e.md//f.md 𝐀.md 𝐀.md𝐀 g.md́ h.md_',
    ].join('\n');
    assert.deepEqual(extractPathTokens(text), [
      '/b.md',
      '/c.md',
      'x/.md',
      '/.md',
      'a.md/b.md',
      'a.md.md',
      'a.md-b.md',
      'a.md',
      'a.mdb/c.md',
      'a.md',
      '/c/d.md',
      'e.md',
      '/f.md',
      '𝐀.md',
    ]);
    assert.deepEqual(
      extractPathTokens(text),
      Array.from(text.matchAll(ORACLE), (match) => match[0]),
    );
  });

  it('EVM-012 AC4: wynik identyczny z dotychczasowym wzorcem na 3000 losowych krótkich tekstach', () => {
    const alphabet = [
      'a',
      'ł',
      'ó',
      '9',
      '.',
      'm',
      'd',
      '.md',
      '/',
      '//',
      '-',
      '_',
      '~',
      '%',
      '@',
      '+',
      ' ',
      '#',
      ':',
      '\n',
      '́',
      '𝐀',
      '(',
      ')',
    ];
    const next = random(12);
    for (let round = 0; round < 3000; round += 1) {
      const length = 1 + Math.floor(next() * 40);
      const text = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const expected = Array.from(text.matchAll(ORACLE), (match) => match[0]);
      assert.deepEqual(extractPathTokens(text), expected, JSON.stringify(text));
    }
  });

  it('EVM-012 AC4: ciągi ≥ 200 KB bez spacji (także z .md przed literą i z ukośnikami) — czas liniowy', { timeout: LIMIT_MS }, () => {
    const letters = 'zażółćgęśląjaźń'.repeat(Math.ceil(LONG / 15)).slice(0, LONG);
    /** @type {Array<[string, string[]]>} */
    const cases = [
      [letters, []],
      [`docs/a.md${letters}.mdx`, []],
      [`${letters}.md`, [`${letters}.md`]],
      [`${'ą/'.repeat(LONG / 2)}x.mdy`, []],
      [`${'.md'.repeat(Math.floor(LONG / 3))}ą`, ['.md'.repeat(Math.floor(LONG / 3) - 1)]],
    ];
    for (const [text, expected] of cases) {
      const started = performance.now();
      const tokens = extractPathTokens(text);
      const elapsed = performance.now() - started;
      assert.deepEqual(tokens, expected);
      assert.ok(elapsed < LIMIT_MS, `analiza trwała ${Math.round(elapsed)} ms (limit ${LIMIT_MS} ms)`);
    }
  });

  it(
    'EVM-012 AC4: polski dokument z ciągiem ≥ 200 KB bez spacji jest analizowany w < 2 s, odwołania dalej działają',
    { timeout: LIMIT_MS },
    () => {
      const long = 'ZażółćgęśląjaźńŁÓDŹ'.repeat(Math.ceil(LONG / 19)).slice(0, LONG);
      const started = performance.now();
      const analysis = analyzeFiles({
        'docs/product/dlugi.md': `# Długi dokument\n\nOpis: ${long}\n\nZobacz docs/product/cennik.md oraz ${long}/docs/product/inny.md\n`,
        'docs/product/cennik.md': '# Cennik\n',
        'docs/product/inny.md': '# Inny\n',
        'docs/README.md': '# Dokumentacja\n- process/workflow.md\n- product/roadmap.md\n- product/dlugi.md\n- product/inny.md\n',
      });
      const elapsed = performance.now() - started;
      assert.ok(elapsed < LIMIT_MS, `analiza trwała ${Math.round(elapsed)} ms (limit ${LIMIT_MS} ms)`);
      assert.deepEqual(codes(analysis), []);
      assert.deepEqual(analysis.references.get('docs/product/cennik.md'), ['docs/product/dlugi.md']);
      // The long run glued to the path is one token (a nonexistent path) — as before the fix.
      assert.deepEqual(analysis.references.get('docs/product/inny.md'), ['docs/README.md']);
    },
  );
});
