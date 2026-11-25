// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pl } from '../src/i18n/pl.ts';
import { ADMINISTRATOR, CLAUSES, CONTACT_EMAIL, DRAFT, clauseVersion } from '../src/privacy/content.ts';

// Static content of W-19 (EVM-063 AC2, AC4; SR-WEB-03, SR-WEB-07, SR-PRIV-08): no personal data, no external resources.
// Final version 1.0 (EVM-133): the data of the controller, the decided points, the mobile application.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const administratorValues = (): string[] => [
  ADMINISTRATOR.name,
  ADMINISTRATOR.legalForm,
  ADMINISTRATOR.registry,
  ADMINISTRATOR.address,
  ADMINISTRATOR.dataContact,
];

/** Values of the owner (EVM-133) — the company data and the functional address; they live in content.ts as configuration. */
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

/**
 * A clause read outside the panel must name the controller in full (EVM-133 C2), so the configured values (the address, the numbers of
 * the register, the mailbox) appear inside the texts. The guard of resources and personal data is applied to what is written in the
 * repository AROUND them; the configured values themselves are guarded separately.
 */
const withoutConfigured = (text: string): string =>
  [...configuredValues()].sort((a, b) => b.length - a.length).reduce((rest, value) => rest.replaceAll(value, ''), text);

const textOf = (id: 'clients' | 'parties' | 'employees'): string =>
  (CLAUSES.find((clause) => clause.id === id)?.blocks ?? [])
    .flatMap((block) => (block.kind === 'list' ? block.items : [block.text]))
    .join('\n');

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
/** The date of validity as the page shows it (styleguide § 6.3): DD.MM.RRRR. */
const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** `DD.MM.RRRR` → `RRRRMMDD`, so two dates compare as strings. */
const sortable = (date: string): string => date.replace(DATE, '$3$2$1');

/** The documents that must say the same as the clause 1.1 (EVM-149 AC2, AC3): the A6 card and the record of the decisions. */
const CARD = '../../../docs/user/karta-wizji-lokalnej.md';
const RODO = '../../../docs/security/rodo.md';
/** The release notes name the version and the date users see (DoD; the fifth place of the date correction at the merge). */
const CHANGELOG = '../../../CHANGELOG.md';

/** The sentence of the clause 1.1 decided by the owner (EVM-149, decision of 2026-11-24, item 1). */
const OFFER_SENTENCE = 'Na etapie wizji możemy zapisać ofertę z Twoim imieniem i nazwiskiem';

describe('content of W-19 (EVM-063)', () => {
  it('EVM-063 AC4 the written texts hold no address of a resource, host, e-mail, telephone, IP or version of a component', () => {
    for (const text of [...clauseTexts().map(withoutConfigured), ...privacyTexts()]) {
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
    expect('wersja 1.0').not.toMatch(COMPONENT_VERSION);
    expect('serwer 1.27.3').toMatch(COMPONENT_VERSION);
    // the configured values are taken out of a text before it is guarded, longest first
    expect(withoutConfigured(`napisz na ${ADMINISTRATOR.dataContact}`)).toBe('napisz na ');
  });

  it('EVM-133 AC1 the data of the controller are those of the register, one mailbox, and every clause names the controller in full', () => {
    expect(ADMINISTRATOR.name).toBe('Electroplus Realty');
    expect(ADMINISTRATOR.legalForm).toContain('spółka z ograniczoną odpowiedzialnością');
    expect(ADMINISTRATOR.legalForm).toContain('EVia Charge');
    for (const part of [
      'KRS 0001109597',
      'Sąd Rejonowy dla m.st. Warszawy w Warszawie',
      'XII Wydział Gospodarczy Krajowego Rejestru Sądowego',
      'NIP 5253005645',
      'REGON 528831324',
      'kapitał zakładowy 5 000 zł',
    ]) {
      expect(ADMINISTRATOR.registry).toContain(part);
    }
    expect(ADMINISTRATOR.address).toBe('Aleja „Solidarności” 68 / 121, 00-240 Warszawa');
    expect(ADMINISTRATOR.dataContact).toBe(
      'kontakt@electroplus.io albo listownie na adres siedziby z dopiskiem „Dane osobowe”. Nie wyznaczyliśmy inspektora ochrony danych.',
    );
    expect(CONTACT_EMAIL).toBe('kontakt@electroplus.io');
    // a clause read outside the panel stands on its own (C2): no reference to a section of the page
    for (const clause of CLAUSES) {
      const text = textOf(clause.id);
      expect(text).toContain(ADMINISTRATOR.name);
      expect(text).toContain(ADMINISTRATOR.address);
      expect(text).toContain(ADMINISTRATOR.registry);
      expect(text).toContain(ADMINISTRATOR.dataContact);
      expect(text).toContain('kontakt@electroplus.io albo pisemnie na adres siedziby z dopiskiem „Dane osobowe”');
      expect(text).not.toMatch(/sekcj\w+ „Administrator danych”/);
    }
    // nobody is named a data protection officer (art. 37-39) and no person is named
    expect(everyText().join('\n')).not.toMatch(/\bIOD\b|inspektorem/);
    expect(ADMINISTRATOR.dataContact).not.toMatch(PHONE);
  });

  it('EVM-133 AC2 final version: the draft flag is off, a date of validity, no marker of the owner or of a lawyer anywhere', () => {
    expect(DRAFT).toBe(false);
    // the version and the date moved on with 1.1 (EVM-149 AC1, below); a final version is never a draft
    for (const clause of CLAUSES) {
      expect(clause.version).toMatch(/^\d+\.\d+$/);
      expect(clause.validFrom).toMatch(DATE);
    }
    const joined = everyText().join('\n');
    expect(joined).not.toMatch(/\[(DO UZUPEŁNIENIA|PRAWNIK\/IOD)\]/);
    expect(joined).not.toMatch(/\bprojekt\b/i);
    // the markers never leak into the catalogue of UI texts (the whole of pl.ts, not only privacy.*)
    for (const text of walk(pl)) expect(text).not.toMatch(/\[(DO UZUPEŁNIENIA|PRAWNIK\/IOD)\]/);
  });

  it('EVM-133 AC3 the points once marked for a lawyer are decided in the text (the variant recommended by the legal review)', () => {
    const clients = textOf('clients');
    // A1 PESEL: purpose and limits; A2: one purpose, one basis, the internal note is gone
    expect(clients).toContain('tylko wtedy, gdy wymaga tego formularz lub przepisy');
    expect(clients).toContain('Nie robimy zdjęć ani kopii dokumentów tożsamości');
    expect(clients).not.toContain('Ocena podstaw prawnych');
    expect(clients).not.toMatch(/lit\. b i lit\. [cf] RODO/);
    // A3: no transfer outside the EEA but the one described; the basis of the transfer is named and the copy is available
    expect(clients).toContain('Poza tym wyjątkiem nie przekazujemy Twoich danych poza Europejski Obszar Gospodarczy.');
    for (const clause of CLAUSES) {
      const text = textOf(clause.id);
      expect(text).toContain('decyzja Komisji Europejskiej o odpowiedniej ochronie danych');
      expect(text).toContain('kopię tych klauzul udostępnimy na Twoją prośbę');
      expect(text).not.toContain('standardowych klauzulach umownych albo na Data Privacy Framework');
      expect(text).not.toContain('GitHub');
      // C4: the right to object in its own paragraph; C12: extension of the term and confirmation of the identity
      expect(text).toContain('Prawo sprzeciwu: jeżeli przetwarzamy Twoje dane na podstawie prawnie uzasadnionego interesu');
      expect(text).toContain('możemy przedłużyć ten termin o dwa miesiące');
    }
    // A4: backups
    expect(clients).toContain('najwyżej 37 dni pozostawać w zaszyfrowanych kopiach zapasowych');
    expect(clients).toContain('ponownie usuwamy dane, które były już usunięte');
    // A5: bystanders; the legal basis and the way to object
    expect(clients).toContain('Osoby postronne na zdjęciach i filmach');
    expect(clients).toContain('nie rozpoznajemy twarzy');
    expect(clients).toContain(
      'Usuniemy go, chyba że jest niezbędny do ustalenia, dochodzenia lub obrony roszczeń — wtedy ograniczymy do niego dostęp.',
    );
    // A6: the clause of the contact persons is complete, with no note about a legal assessment; C5, C6, C15
    const parties = textOf('parties');
    expect(parties).not.toContain('wymaga oceny prawnej');
    expect(parties).toContain('osobom kontaktowym klientów będących firmami');
    expect(parties).toContain('6 lat od końca roku, w którym je zamknięto');
    expect(parties).toContain('Nie podejmujemy wobec Ciebie zautomatyzowanych decyzji');
    // A7: the account and the audit stand on the legitimate interest and on art. 32, not on the contract; no portability (art. 20)
    const employees = textOf('employees');
    expect(employees).toContain('Dziennik audytu nie służy do oceny wydajności ani kontroli czasu pracy.');
    expect(employees).not.toContain('umowa z pracownikiem lub współpracownikiem (art. 6 ust. 1 lit. b RODO)');
    expect(employees).not.toContain('przenoszenia danych');
    expect(employees).toContain('Dane pochodzą od Ciebie i z Twojej aktywności w systemie');
    // C11: the error reports are gone (Sentry was withdrawn)
    expect(employees).toContain('logi na serwerze — 7 dni, logi i metryki w narzędziu do monitorowania — 14 dni,');
    expect(employees).not.toContain('raporty błędów');
    // A8: private devices — voluntary, in writing, with a real alternative and without negative effects
    expect(employees).toContain('Korzystanie z prywatnego telefonu lub komputera do pracy jest dobrowolne.');
    expect(employees).toContain('bez negatywnych skutków — wtedy pracujesz na sprzęcie firmowym albo bez aplikacji');
  });

  it('EVM-133 AC3 the clause for clients covers the site visit (ADR-0024) with the periods counted from the save in the system', () => {
    const clients = textOf('clients');
    expect(clients).toContain('podczas wizji lokalnej, przy przygotowaniu oferty albo zawarciu umowy');
    expect(clients).toContain('Wizja lokalna (oględziny przed ofertą)');
    expect(clients).toContain('najpóźniej po 90 dniach od zapisania wizji w naszym systemie');
    expect(clients).toContain('łącznie nie dłużej niż 270 dni od zapisania wizji');
    expect(clients).toContain('14 dni od rezygnacji lub odrzucenia');
    expect(clients).not.toMatch(/90 dni od wizji|usuwamy automatycznie/);
  });

  it('EVM-149 AC1 version 1.1: one new version and one new date for every clause, later than the date of 1.0', () => {
    expect(DRAFT).toBe(false);
    expect(new Set(CLAUSES.map((clause) => clause.version))).toEqual(new Set(['1.1']));
    const dates = new Set(CLAUSES.map((clause) => clause.validFrom));
    expect(dates.size).toBe(1);
    const [date = ''] = [...dates];
    expect(date).toMatch(DATE);
    // the date of 1.1 is the day of the merge of EVM-149 (decision of the owner); it is never the date of 1.0
    expect(sortable(date) > sortable('19.11.2026')).toBe(true);
    // a draft would never show the number of the approved text (the release gate refuses "projekt")
    expect(clauseVersion(false)).toBe('1.1');
    expect(clauseVersion(true)).toBe('0.1 (projekt)');
  });

  it('EVM-149 AC1 the clause for clients says that an offer with the name may be saved at the site visit, on the basis and with the periods of the visit', () => {
    const clients = textOf('clients');
    // the sentence decided by the owner, the basis (art. 6 ust. 1 lit. b) and the periods of the visit (90 / 14 days)
    expect(clients).toContain(`${OFFER_SENTENCE} (może zawierać także Twój adres)`);
    expect(clients).toContain(
      'przygotowaną na Twoje żądanie przed zawarciem umowy (art. 6 ust. 1 lit. b RODO). Ofertę przechowujemy i usuwamy razem z danymi z wizji',
    );
    expect(clients).toContain(
      'dane z wizji lokalnej (także oferta zapisana na etapie wizji), po której nie zawarliśmy umowy — najpóźniej po 90 dniach od zapisania wizji w naszym systemie',
    );
    expect(clients).toContain('14 dni od rezygnacji lub odrzucenia');
    // only the offer: no other documents and no copies of identity documents at this stage
    expect(clients).toContain('Innych dokumentów na tym etapie nie zapisujemy');
    // the sentence of 1.0 that would be untrue after EVM-147 (security H2) is gone from every clause
    for (const clause of CLAUSES) {
      expect(textOf(clause.id)).not.toMatch(/imienia i nazwiska na tym etapie nie zapisujemy/i);
    }
    // the offer sentence is said once and only in the clause for clients
    expect(clients.split(OFFER_SENTENCE)).toHaveLength(2);
    expect(textOf('parties')).not.toContain(OFFER_SENTENCE);
    expect(textOf('employees')).not.toContain(OFFER_SENTENCE);
  });

  it('EVM-149 AC2 the A6 card and rodo.md carry the version and the date of the clause 1.1 and no longer deny the name at the visit', () => {
    const [clause] = CLAUSES;
    const stamp = `${clause?.version ?? ''} z dnia ${clause?.validFrom ?? ''}`;
    const card = read(CARD);
    expect(card).toContain(`Karta A6, wersja ${stamp}`);
    expect(card).toContain(`klauzula „Klienci” w wersji ${stamp}`);
    expect(card).not.toMatch(/Imienia i nazwiska na tym etapie nie zapisujemy/);
    expect(card).toContain('ofertę z Twoim imieniem i nazwiskiem');
    const rodo = read(RODO);
    expect(rodo).toContain(`klauzule w wersji **${clause?.version ?? ''}**, obowiązują od ${clause?.validFrom ?? ''}`);
    expect(rodo).toContain(OFFER_SENTENCE);
  });

  it('EVM-149 AC1 the changelog entry of the clause 1.1 carries the same version and date as the panel and the application', () => {
    const [clause] = CLAUSES;
    const changelog = read(CHANGELOG);
    // the entry belongs to the changes not released yet (everything from the [Unreleased] heading on)
    const start = changelog.indexOf('## [Unreleased]');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(start)).toContain(
      `Klauzule prywatności w wersji ${clause?.version ?? ''} (panel W-19 i aplikacja M-11, obowiązują od ${clause?.validFrom ?? ''}) [EVM-149`,
    );
  });

  it('EVM-063 AC2 three clauses for the three groups, each with a version and a date', () => {
    expect(CLAUSES.map((clause) => clause.id)).toEqual(['clients', 'parties', 'employees']);
    expect(CLAUSES.map((clause) => clause.title)).toEqual([
      'Klauzula dla klientów (do przekazania klientom)',
      'Klauzula dla osób kontaktowych stron',
      'Klauzula dla pracowników i współpracowników (panel, aplikacja mobilna, prywatny telefon)',
    ]);
    for (const clause of CLAUSES) {
      expect(clause.version).not.toBe('');
      expect(clause.validFrom).not.toBe('');
      expect(clause.blocks.length).toBeGreaterThan(0);
    }
    expect(CLAUSES.at(-1)?.version).toMatch(/^\d+\.\d+$/);
  });

  it('EVM-063 AC2 every clause names the supervisory authority by text and tells how to send a request (RODO art. 13, 14)', () => {
    for (const clause of CLAUSES) {
      const text = textOf(clause.id);
      expect(text).toContain('Prezesa Urzędu Ochrony Danych Osobowych');
      expect(text).toContain('ul. Stawki 2, 00-193 Warszawa');
      expect(text).toContain('najpóźniej w ciągu miesiąca');
    }
  });

  it('EVM-133 AC4 the clause for employees describes the mobile application instead of announcing it (S8)', () => {
    const text = textOf('employees');
    expect(text).not.toContain('tylko plik cookie sesji'); // the second cookie exists since EVM-026
    expect(text).toContain('po wylogowaniu panel czyści dane');
    expect(text).not.toMatch(/planowana na późniejszy etap|po udostępnieniu tej funkcji/);
    expect(text).toContain('Aplikacja mobilna EVia Manager');
    // the device and the local encrypted database, the offline queue
    expect(text).toContain(
      'model, system i jego wersja, poziom poprawek bezpieczeństwa, wersja aplikacji, losowy identyfikator tej instalacji aplikacji',
    );
    expect(text).toContain('nie jest to numer IMEI, numer telefonu ani identyfikator reklamowy');
    expect(text).toContain('zaszyfrowaną bazę z kopią zleceń');
    expect(text).toContain('kolejkę zmian czekających na wysłanie');
    // media: photos and films without sound, no microphone, the private memory of the application only
    expect(text).toContain('zdjęcia i filmy z prac (filmy nagrane w aplikacji są zawsze bez dźwięku)');
    expect(text).toContain('nie używa mikrofonu, a filmy nagrywa bez dźwięku');
    expect(text).toContain('nie trafiają do galerii telefonu ani do chmury Google lub producenta');
    // the purposes, the basis, the periods, the loss of the phone and where to report it
    expect(text).toContain(
      'nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO) i obowiązek zabezpieczenia danych (art. 6 ust. 1 lit. c w związku z art. 32 RODO)',
    );
    expect(text).toContain('90 dni od ostatniego połączenia albo unieważnienia urządzenia');
    expect(text).toContain('zgubienie lub kradzież telefonu zgłoś od razu (kontakt w sekcji „Pomoc”)');
    expect(text).toContain('„Zablokuj i wyczyść”');
    expect(text).toContain('„Wyczyść dane firmowe”');
    // installation from a file handed over by the administrator: no store, no link (docs/ops/dystrybucja-apk-android.md)
    expect(text).toContain('nigdy z linku');
    // what the application does not do: the claims the package is checked for (tools/mobile-apk verify)
    expect(text).toContain('nie zawiera narzędzi analitycznych ani reklamowych i nie wysyła raportów o błędach do zewnętrznych firm');
  });

  it('EVM-133 AC3 the files from the application are told apart from the files added in the panel (no promise of "no sound, no location" for all)', () => {
    const clients = textOf('clients');
    expect(clients).toContain('Filmy nagrane w aplikacji są zawsze bez dźwięku, a jej zdjęcia nie zawierają lokalizacji');
    expect(clients).toContain(
      'pliki dodane w panelu przechowujemy w postaci oryginalnej — mogą zawierać dźwięk i dane zapisane przez urządzenie, także miejsce wykonania',
    );
    expect(clients).toContain('filmy nagrane w aplikacji — bez dźwięku;');
    expect(clients).toContain('po zgłoszeniu utraty telefonu zlecamy jej zdalne usunięcie');
    expect(clients).not.toContain('filmy zawsze bez dźwięku');
    expect(clients).not.toContain('filmy bez dźwięku;');
    for (const clause of CLAUSES) expect(textOf(clause.id)).not.toMatch(/filmy zawsze bez dźwięku/);
  });

  it('EVM-133 AC3 the facts of the code: the session of the application (14 / 30 days), the copy of a closed order, the source of data of contact persons, the site visit basis, the IP address', () => {
    const employees = textOf('employees');
    expect(employees).toContain(
      'sesja aplikacji kończy się po 14 dniach bez połączenia z serwerem, najpóźniej 30 dni po zalogowaniu; jej zapis usuwamy 30 dni po zakończeniu',
    );
    expect(employees).not.toContain('po 30 dniach bez połączenia');
    expect(employees).toContain(
      'usuwana przy pierwszej synchronizacji po upływie 30 dni od zamknięcia (wcześniej przy wylogowaniu albo wyczyszczeniu)',
    );
    expect(employees).toContain('bez dokumentów, płatności, adresów e-mail i NIP');
    expect(employees).toContain('z systemowego okna odblokowania (odcisk palca lub PIN; aplikacja nie otrzymuje danych biometrycznych)');
    expect(employees).toContain('pełny adres jest tylko w zapisie sesji');
    expect(employees).toContain('w dzienniku audytu i w logach serwera adres IP jest skrócony');
    expect(employees).not.toContain('alercie');
    const clients = textOf('clients');
    expect(clients).toContain('Dane osób kontaktowych klientów będących firmami otrzymujemy od tych firm.');
    expect(clients).toContain(
      'Jeżeli wizję zamawia ktoś inny niż właściciel lub mieszkaniec, ich dane przetwarzamy w naszym prawnie uzasadnionym interesie — przygotowania oferty (art. 6 ust. 1 lit. f RODO); przysługuje im sprzeciw.',
    );
    expect(clients).toContain('Poza samym plikiem dokumentu nie zapisujemy tych numerów w systemie');
    for (const clause of CLAUSES) {
      const text = textOf(clause.id);
      expect(text).toContain('z siedzibą w Warszawie, pod adresem');
      expect(text).toContain('albo adres miejsca wizji');
    }
  });

  it('EVM-026 AC5 the clause for employees names the second cookie, __Host-evia_device: purpose, content, 30 days, no authentication, and the register and the counters with their retention', () => {
    const text = textOf('employees');
    expect(text).toContain('dwa pliki cookie: sesji oraz „__Host-evia_device”');
    expect(text).toContain('losowy identyfikator, bez danych o urządzeniu, adresie IP i lokalizacji');
    expect(text).toContain('powiadomienie o logowaniu z nowej przeglądarki');
    expect(text).toContain('osobnego licznika prób logowania');
    expect(text).toContain('wygasa po 30 dniach od ostatniego użycia, nie uwierzytelnia Cię i nie pomija drugiego kroku logowania');
    expect(text).toContain('rejestr przeglądarek konta: zabezpieczony losowy identyfikator');
    expect(text).toContain('liczniki nieudanych prób logowania — w postaci pseudonimowej, bez adresu e-mail');
    expect(text).toContain('rejestr przeglądarek konta — 30 dni od ostatniego użycia');
    expect(text).toContain('liczniki nieudanych prób logowania — 30 minut');
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
