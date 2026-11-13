/**
 * Reader of the small subset of Markdown the office guide uses (EVM-066 AC6): headings `##` / `###`, paragraphs, bold,
 * ordered and bulleted lists (one nested level) and tables. The result is plain data rendered as elements — never HTML
 * (SR-WEB-03), so the text of the source cannot inject markup. The source is `docs/user/instrukcja-dla-biura.md`, the only
 * place of the content; it is read at build time (`?raw`), so a change of the source reaches the panel with the next build.
 */

export interface InlinePart {
  readonly text: string;
  readonly bold: boolean;
}

export interface ListItem {
  readonly parts: readonly InlinePart[];
  readonly children: ListBlock | null;
}

export interface ListBlock {
  readonly kind: 'list';
  readonly ordered: boolean;
  readonly items: readonly ListItem[];
}

export type GuideBlock =
  | { readonly kind: 'heading'; readonly level: 2 | 3; readonly id: string; readonly text: string }
  | { readonly kind: 'paragraph'; readonly parts: readonly InlinePart[] }
  | ListBlock
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

export interface Guide {
  /** The text of the `#` heading of the source (the page title). */
  readonly title: string;
  readonly blocks: readonly GuideBlock[];
}

/** Branchless access to a capture group or a line ('' when absent), as the indexes are checked by the compiler only loosely. */
const group = (match: readonly (string | undefined)[], index: number): string => match.slice(index, index + 1).join('');
const lineAt = (lines: readonly string[], index: number): string => lines.slice(index, index + 1).join('');

/** Splits text on `**bold**`; unmatched markers stay as plain text. */
export function inline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: group(match, 1), bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const LIST_ITEM = /^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/;
const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');

/** Heading identifiers are positional (`guide-3`), so no text of the source or of an address ever becomes a selector. */
export const headingId = (index: number): string => `guide-${index}`;

interface MutableItem {
  parts: InlinePart[];
  children: ListBlock | null;
}

/** Reads the list starting at `start`; returns the block and the index of the first line after it. */
function readList(lines: readonly string[], start: number): { block: ListBlock; next: number } {
  const ordered = /^\s*\d+\./.test(lineAt(lines, start));
  const items: MutableItem[] = [];
  let i = start;
  for (; i < lines.length; i += 1) {
    const current = LIST_ITEM.exec(lineAt(lines, i));
    if (current === null) break;
    const parent = items[items.length - 1];
    if (group(current, 1).length >= 2 && parent !== undefined) {
      const children = parent.children === null ? [] : [...parent.children.items];
      children.push({ parts: inline(group(current, 4)), children: null });
      parent.children = { kind: 'list', ordered: false, items: children };
    } else if ((current[3] !== undefined) === ordered) {
      items.push({ parts: inline(group(current, 4)), children: null });
    } else break;
  }
  return { block: { kind: 'list', ordered, items }, next: i };
}

export function parseGuide(source: string): Guide {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: GuideBlock[] = [];
  let title = '';
  let headings = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', parts: inline(paragraph.join(' ')) });
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lineAt(lines, i);
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (line.trim() === '') {
      flush();
      i += 1;
    } else if (heading !== null) {
      flush();
      const level = group(heading, 1).length;
      const text = group(heading, 2).trim();
      if (level === 1) title = text;
      else {
        blocks.push({ kind: 'heading', level: level === 2 ? 2 : 3, id: headingId(headings), text });
        headings += 1;
      }
      i += 1;
    } else if (isTableLine(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lineAt(lines, i))) {
        rows.push(cells(lineAt(lines, i)));
        i += 1;
      }
      blocks.push({ kind: 'table', header: rows.slice(0, 1).flat(), rows: rows.slice(2) });
    } else if (LIST_ITEM.test(line)) {
      flush();
      const { block, next } = readList(lines, i);
      blocks.push(block);
      i = next;
    } else {
      paragraph.push(line.trim());
      i += 1;
    }
  }
  flush();
  return { title, blocks };
}
