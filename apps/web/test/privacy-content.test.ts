// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pl } from '../src/i18n/pl.ts';
import { ADMINISTRATOR, CLAUSES, CONTACT_EMAIL, DRAFT } from '../src/privacy/content.ts';

// Static content of W-19 (EVM-063 AC2, AC4; SR-WEB-03, SR-WEB-07, SR-PRIV-08): no personal data, no external resources.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const administratorValues = (): string[] => [
  ADMINISTRATOR.name,
  ADMINISTRATOR.legalForm,
  ADMINISTRATOR.registry,
  ADMINISTRATOR.address,
  ADMINISTRATOR.dataContact,
];

function everyText(): string[] {
  const blocks = CLAUSES.flatMap((clause) => [
    clause.title,
    clause.version,
    clause.validFrom,
    ...clause.blocks.flatMap((block) => (block.kind === 'list' ? block.items : [block.text])),
  ]);
  return [...blocks, ...administratorValues(), ...(CONTACT_EMAIL === null ? [] : [CONTACT_EMAIL])];
}

const privacyTexts = (): string[] => {
  const walk = (node: unknown): string[] =>
    typeof node === 'string' ? [node] : Object.values(node as object).flatMap((value) => walk(value));
  return walk(pl.privacy);
};

describe('content of W-19 (EVM-063)', () => {
  it('EVM-063 AC4 the texts hold no address of a resource, no e-mail, no telephone number, no IP and no personal data', () => {
    for (const text of [...everyText(), ...privacyTexts()]) {
      expect(text).not.toMatch(/https?:|\/\/|www\./i);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      expect(text).not.toMatch(/\+?\d[\d\s-]{7,}\d/);
      expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    }
  });

  it('EVM-063 AC4 the only address of the page is the functional one from the configuration, and it is not a personal one', () => {
    expect(CONTACT_EMAIL === null || /^(pomoc|help|dane|biuro)@/.test(CONTACT_EMAIL)).toBe(true);
  });

  it('EVM-063 AC2 the markers of the owner and of the lawyer live in content.ts only; the controller data are markers until filled in', () => {
    expect(administratorValues().every((value) => value === '[DO UZUPEŁNIENIA]')).toBe(DRAFT);
    for (const text of privacyTexts()) expect(text).not.toMatch(/\[(DO UZUPEŁNIENIA|PRAWNIK\/IOD)\]/);
    const joined = everyText().join('\n');
    expect(joined).toContain('[PRAWNIK/IOD]');
    // a release to production needs the draft flag off, the data filled in and no marker left (rodo.md, release gate)
    expect(DRAFT ? 'draft' : joined).not.toMatch(/\[DO UZUPEŁNIENIA\]/);
  });

  it('EVM-063 AC2 three clauses for the three groups, each with a version and a date', () => {
    expect(CLAUSES.map((clause) => clause.id)).toEqual(['clients', 'parties', 'employees']);
    expect(CLAUSES.map((clause) => clause.title)).toEqual([
      'Klauzula dla klientów (do przekazania klientom)',
      'Klauzula dla osób kontaktowych stron',
      'Klauzula dla pracowników i pracy na prywatnym telefonie (BYOD)',
    ]);
    for (const clause of CLAUSES) {
      expect(clause.version).not.toBe('');
      expect(clause.validFrom).not.toBe('');
      expect(clause.blocks.length).toBeGreaterThan(0);
    }
    expect(CLAUSES.at(-1)?.version).toMatch(DRAFT ? /projekt/ : /^\d+\.\d+$/);
  });

  it('EVM-063 AC4 sources render elements from data: no raw HTML, no Markdown parser, no external link in the files of the page', () => {
    for (const file of [
      '../src/privacy/privacy-sections.tsx',
      '../src/pages/privacy-page.tsx',
      '../src/shell/public-page-layout.tsx',
      '../src/shell/privacy-gate.tsx',
    ]) {
      const source = read(file);
      expect(source).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML|<Trans\b|from '(marked|markdown|remark|react-markdown)|querySelector\(/,
      );
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });
});
