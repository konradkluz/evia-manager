/**
 * W-19 "Prywatność i pomoc" (EVM-063): the ONE place of the data of the controller and of the texts of the information
 * clauses (SR-PRIV-05; docs/security/rodo.md → "Obowiązek informacyjny"). Static content built into the panel — no HTML,
 * no Markdown, no addresses of external resources, no personal data of users (SR-WEB-03, SR-WEB-07, CSP P11).
 *
 * Before production (decision of the product owner, 2026-10-13):
 * - fill in `ADMINISTRATOR` and `CONTACT_EMAIL` below — no change of logic is needed (the marker `[DO UZUPEŁNIENIA]` is the
 *   only thing to replace);
 * - resolve or consciously keep the points marked `[PRAWNIK/IOD]` (rodo.md → "Punkty do konsultacji");
 * - change `DRAFT` to `false`, set the version and the date of validity of each clause (release gate, rodo.md,
 *   "Checklista przed produkcją" pkt 9).
 *
 * The texts describe only what the system does today (RODO art. 5 ust. 1 lit. a, art. 12–14). The mobile application is
 * mentioned only as a later stage — it is described in the clause when it exists (M2).
 */

/** Marker of data the owner of the product fills in before production (decision 9). */
const TO_COMPLETE = '[DO UZUPEŁNIENIA]';
/** Marker of a point that a lawyer or the data protection officer decides (rodo.md). */
const LEGAL = '[PRAWNIK/IOD]';

/**
 * `true` while the clauses are a draft awaiting approval (the version carries the word "projekt"). A release to production
 * needs `false` and filled data of the controller — a condition of sign-off in rodo.md.
 */
export const DRAFT = true as boolean;

/**
 * Functional address for help and reports of a lost device (never an address of a person; flow 15, rule 2). `null` until
 * the owner decides: the page then tells people to ask their supervisor and shows no empty link.
 */
export const CONTACT_EMAIL: string | null = null;

/** Data of the controller (decision 9): name, legal form, registry numbers, address, contact in data matters. */
export interface AdministratorData {
  readonly name: string;
  readonly legalForm: string;
  readonly registry: string;
  readonly address: string;
  readonly dataContact: string;
}

export const ADMINISTRATOR: AdministratorData = {
  name: TO_COMPLETE,
  legalForm: TO_COMPLETE,
  registry: TO_COMPLETE,
  address: TO_COMPLETE,
  dataContact: TO_COMPLETE,
};

/** Version and date of validity shown under the title of every clause (format of the date: styleguide § 6.3). */
const VERSION = DRAFT ? '0.1 (projekt)' : '1.0';
const VALID_FROM = TO_COMPLETE;

export type ClauseBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

export interface Clause {
  readonly id: 'clients' | 'parties' | 'employees';
  readonly title: string;
  readonly version: string;
  readonly validFrom: string;
  readonly blocks: readonly ClauseBlock[];
}

const heading = (text: string): ClauseBlock => ({ kind: 'heading', text });
const paragraph = (text: string): ClauseBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): ClauseBlock => ({ kind: 'list', items });

const SUPERVISORY_AUTHORITY =
  'Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (Urząd Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa).';

/** How a request of a data subject reaches the controller (rodo.md → "Realizacja praw osób"). */
const REQUESTS =
  'Wniosek w sprawie swoich danych wyślij na adres kontaktowy w sprawach danych osobowych (sekcja „Administrator danych”) albo pisemnie na adres siedziby. Odpowiemy bez zbędnej zwłoki, najpóźniej w ciągu miesiąca; nie żądamy kopii dokumentu tożsamości.';

/** Monitoring tools get technical identifiers only (rodo.md → "Dane poza bazą"; P9) — pseudonymous, not anonymous. */
const MONITORING_TRANSFER =
  'ewentualny dostęp z USA (np. w ramach wsparcia technicznego) opiera się na standardowych klauzulach umownych albo na Data Privacy Framework';

const CLIENTS: Clause = {
  id: 'clients',
  title: 'Klauzula dla klientów (do przekazania klientom)',
  version: VERSION,
  validFrom: VALID_FROM,
  blocks: [
    paragraph('Tę klauzulę przekazujemy klientom wtedy, gdy zbieramy ich dane — przy przygotowaniu oferty albo zawarciu umowy.'),
    heading('Kto jest administratorem Twoich danych'),
    paragraph(
      'Administratorem danych osobowych jest firma wskazana w sekcji „Administrator danych” na tej stronie. W sprawach danych osobowych napisz na adres kontaktowy podany w tej sekcji.',
    ),
    heading('Jakie dane przetwarzamy'),
    paragraph(
      'Imię i nazwisko albo nazwę firmy, NIP, osobę kontaktową, numer telefonu, adres e-mail, adres korespondencyjny, adres miejsca instalacji i dane o instalacji (np. numer punktu poboru energii, moc przyłączeniowa, numer seryjny ładowarki, parametry instalacji), treść korespondencji i notatek ze zlecenia, zdjęcia i filmy z wykonywanych prac, dokumenty zlecenia, a przy rozliczeniach kwoty, numery faktur i terminy płatności.',
    ),
    paragraph(
      `Dokumenty potrzebne w procesie z operatorem sieci (np. pełnomocnictwo, wniosek) mogą zawierać numer PESEL lub numer dokumentu tożsamości — wyłącznie wtedy, gdy wymaga tego dany dokument. Nie wykonujemy zdjęć ani kopii dokumentów tożsamości. ${LEGAL}`,
    ),
    heading('W jakim celu i na jakiej podstawie'),
    list(
      'przygotowanie oferty oraz realizacja umowy — montaż i instalacja (art. 6 ust. 1 lit. b RODO),',
      'prowadzenie w Twoim imieniu spraw z operatorem sieci dystrybucyjnej i z administracją budynku, jako Twój pełnomocnik (art. 6 ust. 1 lit. b RODO),',
      'dokumentacja fotograficzna i filmowa wykonanych prac jako dowód należytego wykonania (art. 6 ust. 1 lit. b i lit. f RODO),',
      'rozliczenia i obowiązki podatkowe (art. 6 ust. 1 lit. b i lit. c RODO),',
      'ustalenie, dochodzenie lub obrona roszczeń po zakończeniu prac (art. 6 ust. 1 lit. f RODO).',
    ),
    paragraph(`Ocena podstaw prawnych: ${LEGAL}.`),
    heading('Komu przekazujemy dane'),
    list(
      'operatorom sieci dystrybucyjnej, administracjom budynków, wspólnotom i spółdzielniom — w zakresie potrzebnym w prowadzonej sprawie; to odrębni administratorzy,',
      'projektantom, rzeczoznawcom i podwykonawcom — w zakresie potrzebnym do wykonania zlecenia,',
      'dostawcom usług IT z Unii Europejskiej, którzy przechowują dane w naszym imieniu (serwery i baza danych, przechowywanie zdjęć i dokumentów, kopie zapasowe — Hetzner, Scaleway),',
      `dostawcom narzędzi do monitorowania działania systemu (Sentry, Grafana Labs) — to spółki z USA, które przetwarzają dane w regionie UE; trafiają do nich wyłącznie identyfikatory techniczne, bez imion i nazwisk, adresów, numerów telefonów i treści zleceń; ${MONITORING_TRANSFER}.`,
    ),
    paragraph(`Role odbiorców i podstawy przekazania poza Europejski Obszar Gospodarczy: ${LEGAL}.`),
    heading('Jak długo przechowujemy dane'),
    list(
      'dane zlecenia, dokumenty i zdjęcia — 6 lat od końca roku kalendarzowego, w którym zlecenie zamknięto,',
      'zlecenie anulowane przed akceptacją — 12 miesięcy od anulowania,',
      'dane klienta bez zleceń — 12 miesięcy.',
    ),
    paragraph(
      `Po usunięciu lub anonimizacji dane mogą jeszcze do 37 dni znajdować się w zaszyfrowanych kopiach zapasowych; po odtworzeniu kopii usunięcie jest stosowane ponownie. ${LEGAL}`,
    ),
    heading('Twoje prawa'),
    paragraph(
      'Masz prawo dostępu do danych i otrzymania ich kopii, sprostowania, usunięcia, ograniczenia przetwarzania i przenoszenia danych. Jeżeli przetwarzamy dane na podstawie prawnie uzasadnionego interesu, możesz wnieść sprzeciw.',
    ),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
    heading('Czy musisz podać dane'),
    paragraph(
      'Podanie danych jest dobrowolne, ale niezbędne do zawarcia i realizacji umowy oraz do prowadzenia w Twoim imieniu spraw z operatorem sieci.',
    ),
    heading('Zautomatyzowane decyzje'),
    paragraph('Nie podejmujemy wobec Ciebie decyzji w sposób zautomatyzowany i nie profilujemy Twoich danych.'),
    heading('Osoby postronne na zdjęciach'),
    paragraph(
      `Podczas prac unikamy utrwalania osób, które nie są stroną zlecenia, i tablic rejestracyjnych. Jeżeli taka osoba znajdzie się na zdjęciu, może zgłosić sprzeciw — usuniemy wtedy plik, chyba że jego zachowanie jest niezbędne do ustalenia, dochodzenia lub obrony roszczeń. ${LEGAL}`,
    ),
  ],
};

const PARTIES: Clause = {
  id: 'parties',
  title: 'Klauzula dla osób kontaktowych stron',
  version: VERSION,
  validFrom: VALID_FROM,
  blocks: [
    paragraph(
      'Tę informację przekazujemy osobom, których dane kontaktowe otrzymaliśmy od klienta albo ze zlecenia — np. pracownikom administracji budynku, zarządcom, projektantom, rzeczoznawcom i pracownikom operatora sieci, a także osobom fizycznym, które występują w sprawie jako strona. Przekazujemy ją przy pierwszym kontakcie (np. w stopce wiadomości e-mail), najpóźniej w ciągu miesiąca od otrzymania danych.',
    ),
    heading('Kto jest administratorem danych'),
    paragraph(
      'Administratorem jest firma wskazana w sekcji „Administrator danych” na tej stronie; tam też znajdziesz kontakt w sprawach danych.',
    ),
    heading('Skąd mamy Twoje dane i jakie to dane'),
    paragraph(
      'Otrzymaliśmy je od klienta, z dokumentów zlecenia albo od Twojej organizacji. Przetwarzamy imię i nazwisko, numer telefonu i adres e-mail oraz notatki o kontakcie w sprawie zlecenia.',
    ),
    heading('Cel, podstawa i okres'),
    list(
      'cel: kontakt w sprawie zlecenia, w którym uczestniczysz,',
      'podstawa: prawnie uzasadniony interes administratora, czyli sprawny kontakt w sprawie zlecenia (art. 6 ust. 1 lit. f RODO),',
      'okres: 2 lata od zakończenia ostatniego zlecenia, w którym występujesz.',
    ),
    heading('Komu przekazujemy dane'),
    paragraph(
      'Dane są dostępne pracownikom firmy w zakresie ich zadań oraz dostawcom usług IT, którzy przechowują dane w naszym imieniu (Hetzner, Scaleway — Unia Europejska). Do narzędzi monitorowania działania systemu (Sentry, Grafana Labs — spółki z USA, region UE) trafiają wyłącznie identyfikatory techniczne, bez Twojego imienia i nazwiska, telefonu i adresu e-mail.',
    ),
    heading('Twoje prawa'),
    paragraph(
      'Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania oraz prawo sprzeciwu wobec przetwarzania na podstawie prawnie uzasadnionego interesu.',
    ),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
    paragraph(`Treść klauzuli wymaga oceny prawnej: ${LEGAL}.`),
  ],
};

const EMPLOYEES: Clause = {
  id: 'employees',
  title: 'Klauzula dla pracowników i pracy na prywatnym telefonie (BYOD)',
  version: VERSION,
  validFrom: VALID_FROM,
  blocks: [
    paragraph(
      'Dotyczy pracowników i współpracowników, którzy mają konto w panelu EVia Manager, także gdy korzystają z panelu w przeglądarce prywatnego telefonu lub komputera.',
    ),
    heading('Kto jest administratorem danych'),
    paragraph('Administratorem jest firma wskazana w sekcji „Administrator danych” na tej stronie.'),
    heading('Jakie dane o Tobie przetwarzamy'),
    list(
      'dane konta: adres e-mail, nazwa wyświetlana, rola, status konta i data ostatniego logowania,',
      'dane logowania: hasło i drugi składnik logowania — wyłącznie w postaci zabezpieczonej, której nikt w firmie nie odczytuje — oraz nazwy, które sam nadajesz swoim kluczom dostępu (np. „Telefon Jana”): widzisz je tylko Ty, a usuwamy je razem z kluczem,',
      'dane o sesjach: adres IP (w skróconej postaci w narzędziach do monitorowania; pełny adres widzisz tylko Ty, w sekcji „Moje sesje” na stronie „Konto”), rodzaj przeglądarki, czasy aktywności,',
      'rejestr przeglądarek konta: zabezpieczony losowy identyfikator przeglądarki, z której zalogowano się do konta, oraz data jego pierwszego i ostatniego użycia — bez adresu IP, lokalizacji i danych o urządzeniu,',
      'liczniki nieudanych prób logowania — w postaci pseudonimowej, bez adresu e-mail; służą wyłącznie ochronie przed zgadywaniem haseł i kodów,',
      'dziennik audytu: kto, co, kiedy, skąd (skrócony adres IP) i z jakim wynikiem — bez treści danych wprowadzanych do zleceń (wyjątek: kwoty płatności),',
      'autorstwo wpisów i zmian w zleceniach (nazwa wyświetlana).',
    ),
    paragraph('Pełne dane konta widzi administrator systemu w firmie; pozostali pracownicy widzą tylko Twoją nazwę wyświetlaną.'),
    heading('W jakim celu i na jakiej podstawie'),
    paragraph(
      `Cele: dostęp do systemu, bezpieczeństwo, rozliczalność działań i ochrona przed nadużyciami. Podstawy: umowa z pracownikiem lub współpracownikiem (art. 6 ust. 1 lit. b RODO), obowiązek zapewnienia bezpieczeństwa przetwarzania (art. 6 ust. 1 lit. c w związku z art. 32 RODO) oraz prawnie uzasadniony interes administratora (art. 6 ust. 1 lit. f RODO). Dziennik audytu służy bezpieczeństwu i rozliczalności, a nie ocenie Twojej pracy. ${LEGAL}`,
    ),
    paragraph('Podanie adresu e-mail i nazwy wyświetlanej jest niezbędne do założenia konta i pracy w systemie.'),
    heading('Jak długo przechowujemy dane'),
    list(
      'konto — 2 lata od dezaktywacji, potem anonimizacja,',
      'dziennik audytu — 2 lata,',
      'sesje — 30 dni od wygaśnięcia lub unieważnienia (usuwamy je automatycznie, raz na dobę),',
      'rejestr przeglądarek konta — 30 dni od ostatniego użycia przeglądarki (wcześniej, gdy konto zostanie dezaktywowane albo zresetujemy hasło lub drugi krok logowania),',
      'liczniki nieudanych prób logowania — 30 minut po zakończeniu okna prób albo blokady,',
      'logi na serwerze — 7 dni, logi i metryki w narzędziu do monitorowania — 14 dni, raporty błędów — 30 dni,',
      'zaszyfrowane kopie zapasowe — do 37 dni po usunięciu danych.',
    ),
    heading('Praca na prywatnym telefonie lub komputerze'),
    paragraph('Panel działa w przeglądarce. Korzystając z niego na prywatnym urządzeniu:'),
    list(
      'w przeglądarce zostają tylko dwa pliki cookie: sesji oraz „__Host-evia_device” — panel nie zapisuje w pamięci przeglądarki danych osobowych ani danych zleceń,',
      'plik cookie „__Host-evia_device” zawiera losowy identyfikator, bez danych o urządzeniu, adresie IP i lokalizacji; służy do rozpoznania przeglądarki, z której już logowano się do konta (powiadomienie o logowaniu z nowej przeglądarki) i do osobnego licznika prób logowania; wygasa po 30 dniach od ostatniego użycia, nie uwierzytelnia Cię i nie pomija drugiego kroku logowania,',
      'po wylogowaniu panel czyści dane ze swojej pamięci w tej karcie,',
      'firma nie instaluje niczego na Twoim urządzeniu i nie ma dostępu do jego plików, kontaktów, galerii ani innych aplikacji,',
      'prosimy o blokadę ekranu, aktualne oprogramowanie i wylogowanie po pracy; utratę urządzenia albo podejrzenie, że ktoś zna Twoje hasło, zgłoś od razu administratorowi (sekcja „Pomoc”).',
    ),
    paragraph(`Regulamin pracy na prywatnych urządzeniach (BYOD), który pracownik akceptuje: ${LEGAL}.`),
    heading('Aplikacja mobilna'),
    paragraph(
      'Aplikacja mobilna dla techników jest planowana na późniejszy etap. Przed jej uruchomieniem uzupełnimy tę klauzulę o opis danych i zasad jej działania.',
    ),
    heading('Komu przekazujemy dane'),
    paragraph(
      `Dostawcom usług IT, którzy przetwarzają dane w naszym imieniu: hosting i kopie zapasowe (Hetzner, Scaleway — Unia Europejska), wiadomości e-mail z zaproszeniami i alertami (Scaleway), monitorowanie działania systemu (Sentry, Grafana Labs — spółki z USA, region UE; tylko identyfikatory techniczne i skrócony adres IP; ${MONITORING_TRANSFER}).`,
    ),
    heading('Twoje prawa'),
    paragraph(
      'Masz prawo dostępu do danych, sprostowania, usunięcia, ograniczenia przetwarzania i przenoszenia danych oraz prawo sprzeciwu wobec przetwarzania na podstawie prawnie uzasadnionego interesu. Nie stosujemy profilowania ani zautomatyzowanych decyzji.',
    ),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
  ],
};

/** Order of the clauses on the page: clients, contact persons of parties, employees and BYOD. */
export const CLAUSES: readonly Clause[] = [CLIENTS, PARTIES, EMPLOYEES];
