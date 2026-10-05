// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectMilestones, compareMilestones, headingText, isMilestoneId, parseRoadmapMilestones } from '../lib/milestones.mjs';
import { config, ROADMAP } from './helpers/fixtures.mjs';

/** The former heading pattern (cubic for blanks before U+2028 — L3) — reference oracle, used only on short inputs. */
const HEADING_ORACLE = /^#{1,6}[ \t]+(.+?)[ \t]*$/;

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

describe('lista kamieni milowych (EVM-012, ustalenie E)', () => {
  it('EVM-012 AC3: kamienie z tabeli „Przegląd” w roadmapie — odporne na pogrubienie **M0**', () => {
    assert.deepEqual(parseRoadmapMilestones(ROADMAP, 'Przegląd'), ['M0', 'M1', 'M2']);
  });

  it('EVM-012 AC3: wiersze spoza sekcji „Przegląd” i roadmapa bez sekcji nie dodają kamieni', () => {
    assert.deepEqual(parseRoadmapMilestones('# R\n| M5 | x |\n', 'Przegląd'), []);
    assert.deepEqual(parseRoadmapMilestones('## Przegląd\n### Szczegóły\n| M5 | x |\n', 'Przegląd'), []);
    assert.deepEqual(parseRoadmapMilestones('', 'Przegląd'), []);
  });

  it('EVM-012 AC3: lista = roadmapa ∪ katalogi docs/backlog/<M#>/ z listy gita, posortowana numerycznie', () => {
    const paths = ['docs/backlog/M10/README.md', 'docs/backlog/M3/x.txt', 'docs/backlog/README.md', 'docs/product/roadmap.md'];
    assert.deepEqual(collectMilestones(paths, ROADMAP, config), ['M0', 'M1', 'M2', 'M3', 'M10']);
  });

  it('EVM-012 AC3: format M# = M + cyfry; porównanie numeryczne', () => {
    assert.equal(isMilestoneId('M0'), true);
    assert.equal(isMilestoneId('M12'), true);
    assert.equal(isMilestoneId('m1'), false);
    assert.equal(isMilestoneId('M'), false);
    assert.equal(isMilestoneId('M1a'), false);
    assert.deepEqual(['M10', 'M2', 'M01', 'M1'].sort(compareMilestones), ['M01', 'M1', 'M2', 'M10']);
    assert.equal(compareMilestones('M1', 'M1'), 0);
    assert.ok(compareMilestones('M1', 'M01') > 0);
  });
});

describe('nagłówki roadmapy w czasie liniowym (EVM-013 AC6, AC7; ustalenie L3)', () => {
  it('EVM-013 AC7: tekst nagłówka bez odstępów na brzegach; przypadki brzegowe jak dotychczas', () => {
    assert.equal(headingText('## Przegląd'), 'Przegląd');
    assert.equal(headingText('##\t Przegląd \t'), 'Przegląd');
    assert.equal(headingText('###### a b'), 'a b');
    assert.equal(headingText('####### Za głęboko'), null);
    assert.equal(headingText('#Przegląd'), null);
    assert.equal(headingText('# '), null);
    assert.equal(headingText('#'), null);
    // Only blanks after `#`: the former pattern took the last blank as the text.
    assert.equal(headingText('#  '), ' ');
    assert.equal(headingText('# \t'), '\t');
    assert.equal(headingText('# Przegląd\u2028'), null);
  });

  it('EVM-013 AC7: wynik identyczny z dotychczasowym wzorcem nagłówka na 20 000 losowych krótkich linii', () => {
    const alphabet = ['#', '##', ' ', '\t', 'a', 'Przegląd', '|', '*', '\u00a0', '\r', '\n', '\u2028', '\u2029'];
    const next = random(14);
    for (let round = 0; round < 20000; round += 1) {
      const length = 1 + Math.floor(next() * 10);
      const line = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const match = HEADING_ORACLE.exec(line);
      assert.equal(headingText(line), match ? match[1] : null, JSON.stringify(line));
    }
  });
});
