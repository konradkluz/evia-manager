// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldOf, normalizeText, parseFrontmatter } from '../lib/frontmatter.mjs';

/** @param {string} text */
const fields = (text) => Object.fromEntries(parseFrontmatter(text));

/** The former field pattern (quadratic for blanks before U+2028 — L3) — reference oracle, used only on short inputs. */
const FIELD_ORACLE = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*))?$/;

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

const NOTE = ['---', 'lifecycle: milestone', 'milestone: M1', 'expires: 2027-01-31', '---', '# Notatka', ''];

describe('frontmatter (EVM-012, ustalenie D)', () => {
  it('EVM-012 AC3: płaskie pola klucz: wartość z frontmattera na początku pliku', () => {
    assert.deepEqual(fields(NOTE.join('\n')), { lifecycle: 'milestone', milestone: 'M1', expires: '2027-01-31' });
  });

  it('EVM-012 AC3: CRLF, samotne CR i BOM są parsowane jak LF', () => {
    const lf = fields(NOTE.join('\n'));
    assert.deepEqual(fields(NOTE.join('\r\n')), lf);
    assert.deepEqual(fields(`﻿${NOTE.join('\r\n')}`), lf);
    assert.deepEqual(fields(NOTE.join('\r')), lf);
    assert.equal(normalizeText('﻿a\r\nb\rc\n'), 'a\nb\nc\n');
  });

  it('EVM-012 AC3: brak frontmattera, frontmatter nie w pierwszej linii albo niezamknięty = brak metadanych', () => {
    assert.deepEqual(fields('# Tytuł\nlifecycle: milestone\n'), {});
    assert.deepEqual(fields('\n---\nlifecycle: milestone\n---\n'), {});
    assert.deepEqual(fields('---\nlifecycle: milestone\n# bez zamknięcia\n'), {});
    assert.deepEqual(fields(''), {});
  });

  it('EVM-012 AC3: linie z wcięciem, listy i wieloliniowe opisy są ignorowane', () => {
    const text = [
      '---',
      'name: devops-engineer',
      'description: |',
      '  lifecycle: milestone',
      '  wiele linii opisu',
      'tags:',
      '  - a',
      '- lifecycle: permanent',
      'contributors: [devops-engineer]',
      '---',
    ].join('\n');
    assert.deepEqual(fields(text), { name: 'devops-engineer', description: '|', contributors: '[devops-engineer]' });
  });

  it('EVM-012 AC3: cudzysłowy wokół wartości i komentarze YAML są pomijane', () => {
    const text = [
      '---',
      'lifecycle: "living"',
      "milestone: 'M2'",
      'expires: 2027-01-31 # termin z retrospektywy',
      'review_by: "2026-12-01" # po aktualizacji cen',
      'title: "Plan # nie komentarz"',
      'mixed: "M1\'',
      'hash: wartość#bez-spacji',
      '---',
    ].join('\n');
    assert.deepEqual(fields(text), {
      lifecycle: 'living',
      milestone: 'M2',
      expires: '2027-01-31',
      review_by: '2026-12-01',
      title: 'Plan # nie komentarz',
      mixed: '"M1\'',
      hash: 'wartość#bez-spacji',
    });
  });

  it('EVM-012 AC3: puste wartości i null oznaczają brak pola', () => {
    const text = ['---', 'lifecycle:', 'milestone: ~', 'expires: null', 'review_by: # tylko komentarz', 'id: EVM-001', '---'].join('\n');
    assert.deepEqual(fields(text), { id: 'EVM-001' });
  });

  it('EVM-012 AC3: klucz bez spacji po dwukropku nie jest polem; ostatnie wystąpienie klucza wygrywa', () => {
    const text = ['---', 'lifecycle:milestone', 'milestone: M0', 'milestone: M1', 'expires: 2026-01-01', 'expires:', '---'].join('\n');
    assert.deepEqual(fields(text), { milestone: 'M1' });
  });

  it('EVM-012 AC3: linia otwierająca i zamykająca mogą mieć końcowe spacje; liczy się tylko pierwszy blok', () => {
    const text = ['--- ', 'lifecycle: living', '---\t', '# Tytuł', '---', 'lifecycle: milestone', '---'].join('\n');
    assert.deepEqual(fields(text), { lifecycle: 'living' });
  });
});

describe('frontmatter w czasie liniowym (EVM-013 AC6, AC7; ustalenie L3)', () => {
  it('EVM-013 AC7: pole albo nie-pole — klucz, odstęp po dwukropku, wartość bez znaku końca linii', () => {
    assert.deepEqual(fieldOf('lifecycle: living'), ['lifecycle', 'living']);
    assert.deepEqual(fieldOf('review_by:\t 2026-12-01 # termin'), ['review_by', '2026-12-01 # termin']);
    assert.deepEqual(fieldOf('expires:'), ['expires', '']);
    assert.deepEqual(fieldOf('expires: \t '), ['expires', '']);
    assert.deepEqual(fieldOf('title : \u00a0x'), ['title', '\u00a0x']);
    assert.equal(fieldOf('lifecycle:milestone'), null);
    assert.equal(fieldOf('  lifecycle: living'), null);
    assert.equal(fieldOf('- lifecycle: living'), null);
    for (const separator of ['\u2028', '\u2029', '\r', '\n']) {
      assert.equal(fieldOf(`klucz: wartość${separator}`), null, JSON.stringify(separator));
      assert.equal(fieldOf(`klucz:${separator}`), null, JSON.stringify(separator));
    }
  });

  it('EVM-013 AC7: wynik identyczny z dotychczasowym wzorcem pola na 20 000 losowych krótkich linii', () => {
    const alphabet = [
      'a',
      'Z',
      '_',
      '-',
      '9',
      'ł',
      ':',
      ' ',
      '\t',
      '#',
      '"',
      "'",
      '~',
      '\r',
      '\n',
      '\u2028',
      '\u2029',
      '\u00a0',
      'key',
      'x: ',
      ': ',
    ];
    const next = random(13);
    for (let round = 0; round < 20000; round += 1) {
      const length = 1 + Math.floor(next() * 12);
      const line = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const match = FIELD_ORACLE.exec(line);
      assert.deepEqual(fieldOf(line), match ? [match[1], match[2] ?? ''] : null, JSON.stringify(line));
    }
  });
});
