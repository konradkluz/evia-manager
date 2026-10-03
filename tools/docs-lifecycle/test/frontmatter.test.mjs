// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeText, parseFrontmatter } from '../lib/frontmatter.mjs';

/** @param {string} text */
const fields = (text) => Object.fromEntries(parseFrontmatter(text));

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
