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

/** Values Konrad fills in before production (decision of 2026-10-13) — the company data and the functional address. */
const configuredValues = (): string[] => [...administratorValues(), ...(CONTACT_EMAIL === null ? [] : [CONTACT_EMAIL])];

/** Texts of the clauses (titles and blocks) — written in the repository, never configured. */
function clauseTexts(): string[] {
  return CLAUSES.flatMap((clause) => [
    clause.title,
    ...clause.blocks.flatMap((block) => (block.kind === 'list' ? block.items : [block.text])),
  ]);
}

function everyText(): string[] {
  const meta = CLAUSES.flatMap((clause) => [clause.version, clause.validFrom]);
  return [...clauseTexts(), ...meta, ...configuredValues()];
}

const walk = (node: unknown): string[] =>
  typeof node === 'string' ? [node] : Object.values(node as object).flatMap((value) => walk(value));

const privacyTexts = (): string[] => walk(pl.privacy);

/** A functional mailbox (flow 15, rule 2): never the address of a person (SR-PRIV-08, data minimisation). */
const FUNCTIONAL_MAILBOX = /^(pomoc|help|dane|rodo|iod|biuro|kontakt)@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.?=&+-]+/g;
const URL_LIKE = /https?:|\/\/|www\./i;
const HOST = /\b[\p{L}\d-]+\.(pl|com|eu|net|org|io|cloud|de|fr|fi|app|dev|tech)\b/iu;
const COMPONENT_VERSION = /\bv?\d+\.\d+\.\d+\b/;
const PHONE = /\+?\d[\d\s-]{7,}\d/;
const IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

describe('content of W-19 (EVM-063)', () => {
  it('EVM-063 AC4 the written texts hold no address of a resource, host, e-mail, telephone, IP or version of a component', () => {
    for (const text of [...clauseTexts(), ...privacyTexts()]) {
      expect(text).not.toMatch(URL_LIKE);
      expect(text).not.toMatch(HOST);
      expect(text).not.toMatch(EMAIL);
      expect(text).not.toMatch(PHONE);
      expect(text).not.toMatch(IP);
      expect(text).not.toMatch(COMPONENT_VERSION);
    }
  });

  it('EVM-063 AC4 the configured values hold no address of a resource and only functional mailboxes', () => {
    // Filling in the data must not need a change of this test: a functional address and the company telephone pass,
    // a link, an IP or the address of a person do not.
    for (const value of configuredValues()) {
      expect(value).not.toMatch(URL_LIKE);
      expect(value).not.toMatch(IP);
      for (const address of value.match(EMAIL) ?? []) expect(address).toMatch(FUNCTIONAL_MAILBOX);
    }
    expect(CONTACT_EMAIL === null || FUNCTIONAL_MAILBOX.test(CONTACT_EMAIL)).toBe(true);
  });

  it('EVM-063 AC4 the rules of the guard tell a function from a person and a legal text from a host', () => {
    expect('pomoc@firma-testowa.example.pl').toMatch(FUNCTIONAL_MAILBOX);
    expect('dane@firma-testowa.example.pl').toMatch(FUNCTIONAL_MAILBOX);
    expect('jan.przykladowy@firma-testowa.example.pl').not.toMatch(FUNCTIONAL_MAILBOX);
    expect('pomoc@firma-testowa.example.pl?cc=atak@evil.example').not.toMatch(FUNCTIONAL_MAILBOX);
    expect('pomoc@firma-testowa.example.pl?cc=atak@evil.example'.match(EMAIL)?.[0]).not.toMatch(FUNCTIONAL_MAILBOX);
    expect('m.in. kopie, art. 6 ust. 1 lit. b RODO, ul. Stawki 2, 00-193 Warszawa').not.toMatch(HOST);
    expect('m.in. kopie, art. 6 ust. 1 lit. b RODO, ul. Stawki 2, 00-193 Warszawa').not.toMatch(PHONE);
    expect('zobacz panel.firma-testowa.pl').toMatch(HOST);
    expect('bucket.s3.pl-waw.scw.cloud').toMatch(HOST);
    expect('wersja 0.1 (projekt), 1.0').not.toMatch(COMPONENT_VERSION);
    expect('serwer 1.27.3').toMatch(COMPONENT_VERSION);
  });

  it('EVM-063 AC2 the markers of the owner and of the lawyer live in content.ts only; the controller data are markers until filled in', () => {
    expect(administratorValues().every((value) => value === '[DO UZUPEŁNIENIA]')).toBe(DRAFT);
    // the markers never leak into the catalogue of UI texts (the whole of pl.ts, not only privacy.*)
    for (const text of walk(pl)) expect(text).not.toMatch(/\[(DO UZUPEŁNIENIA|PRAWNIK\/IOD)\]/);
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

  it('EVM-063 AC2 every clause names the supervisory authority by text and tells how to send a request (RODO art. 13, 14)', () => {
    for (const clause of CLAUSES) {
      const text = clause.blocks.flatMap((block) => (block.kind === 'list' ? block.items : [block.text])).join('\n');
      expect(text).toContain('Prezesa Urzędu Ochrony Danych Osobowych');
      expect(text).toContain('ul. Stawki 2, 00-193 Warszawa');
      expect(text).toContain('najpóźniej w ciągu miesiąca');
    }
  });

  it('EVM-063 AC2 the BYOD part describes only the panel of today; the mobile application is a later stage (K9)', () => {
    const employees = CLAUSES.find((clause) => clause.id === 'employees');
    const text = (employees?.blocks ?? []).flatMap((block) => (block.kind === 'list' ? block.items : [block.text])).join('\n');
    expect(text).toContain('tylko plik cookie sesji');
    expect(text).toContain('po wylogowaniu panel czyści dane');
    expect(text).toContain('planowana na późniejszy etap');
    // no promise of features of an application that does not exist yet
    expect(text).not.toMatch(/aplikacja (zapisuje|szyfruje|usuwa|czyści)|zdaln\w+ (wymazan|czyszczen)/i);
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
