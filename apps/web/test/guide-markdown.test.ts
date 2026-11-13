import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inline, parseGuide } from '../src/guide/markdown.ts';

// "Instrukcja dla biura" (EVM-066 AC6): the reader of the Markdown source and the rules about what the source may contain.

const source = readFileSync(resolve(import.meta.dirname, '../../../docs/user/instrukcja-dla-biura.md'), 'utf8');

describe('reader of the guide source (EVM-066 AC6)', () => {
  it('EVM-066 AC6 reads headings, paragraphs, lists (also nested), tables and bold', () => {
    const guide = parseGuide(
      [
        '# Tytuł',
        '',
        'Akapit **ważny**',
        'w dwóch liniach.',
        '',
        '## Rozdział',
        '',
        '1. Pierwszy',
        '2. Drugi',
        '   - zagnieżdżony',
        '',
        '- punkt',
        '',
        '### Podrozdział',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '',
      ].join('\r\n'),
    );
    expect(guide.title).toBe('Tytuł');
    expect(guide.blocks.map((block) => block.kind)).toEqual(['paragraph', 'heading', 'list', 'list', 'heading', 'table']);
    expect(guide.blocks[0]).toEqual({
      kind: 'paragraph',
      parts: [
        { text: 'Akapit ', bold: false },
        { text: 'ważny', bold: true },
        { text: ' w dwóch liniach.', bold: false },
      ],
    });
    const ordered = guide.blocks[2];
    expect(ordered?.kind === 'list' && ordered.ordered && ordered.items[1]?.children?.items[0]?.parts[0]?.text).toBe('zagnieżdżony');
    expect(guide.blocks[5]).toEqual({ kind: 'table', header: ['A', 'B'], rows: [['1', '2']] });
    const ids = guide.blocks.flatMap((block) => (block.kind === 'heading' ? [block.id] : []));
    expect(ids).toEqual(['guide-0', 'guide-1']);
  });

  it('EVM-066 AC6 an unmatched bold marker stays plain text and markup is never interpreted', () => {
    expect(inline('a **b')).toEqual([{ text: 'a **b', bold: false }]);
    expect(inline('<script>x</script>')).toEqual([{ text: '<script>x</script>', bold: false }]);
  });

  it('EVM-066 AC6 a list of another kind ends the current one', () => {
    const guide = parseGuide(['1. a', '- b'].join('\n'));
    expect(guide.blocks.map((block) => block.kind)).toEqual(['list', 'list']);
  });

  it('EVM-066 AC6 the source has no raw HTML, no images, no links to external resources and no personal or security data', () => {
    expect(source).not.toMatch(/<[a-z!/]/i);
    expect(source).not.toMatch(/!\[|\]\(/);
    const urls = source.match(/https?:\/\/[^\s)”"*]+/g) ?? [];
    expect(new Set(urls)).toEqual(new Set(['https://panel.eviacharge.pl']));
    expect(source).not.toMatch(/\b\d{11}\b/);
    expect(source).not.toMatch(/localhost|staging\.|runbook|\b\d{1,3}(\.\d{1,3}){3}\b/i);
    expect(source).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it('EVM-066 AC6 the source has the structure the page needs: one h1 and h2 sections in a hierarchy', () => {
    const guide = parseGuide(source);
    expect(guide.title).toBe('Instrukcja dla biura');
    const levels = guide.blocks.flatMap((block) => (block.kind === 'heading' ? [block.level] : []));
    expect(levels[0]).toBe(2);
    expect(levels.filter((level) => level === 2)).toHaveLength(8);
  });
});
