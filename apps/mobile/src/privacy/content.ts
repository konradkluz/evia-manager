/**
 * W-19 "Prywatność i pomoc" (EVM-063): the ONE place of the data of the controller and of the texts of the information
 * clauses (SR-PRIV-05; docs/security/rodo.md → "Obowiązek informacyjny"). Static content built into the panel — no HTML,
 * no Markdown, no addresses of external resources, no personal data of users (SR-WEB-03, SR-WEB-07, CSP P11).
 *
 * Final version 1.0 (EVM-133, 2026-11-19): the data of the controller come from the owner (checked with the public extract of the
 * register), the points once marked for a lawyer are decided in the variant recommended by the legal review, "from the delegation of
 * the owner" (RR-95; docs/security/rodo.md → "Rozstrzygnięcia klauzul"). Every later change of the text is a NEW version and a new
 * date (the history is in git). The same file lives in `apps/mobile/src/privacy/content.ts` — a verbatim copy, a test compares them.
 *
 * The texts describe what the system does today (RODO art. 5 ust. 1 lit. a, art. 12–14), including the mobile application.
 */

/**
 * `true` while the clauses are a draft awaiting approval (the version then carries the word "projekt"). A release to production
 * and a signed package of the application need `false`, filled data of the controller and no marker left (rodo.md, release gate).
 */
export const DRAFT = false as boolean;

/** The functional mailbox of the company in data matters — never the address of a person (flow 15, rule 2). */
const DATA_MAILBOX = 'kontakt@electroplus.io';

/**
 * Functional address for help and reports of a lost device (the same mailbox as in data matters, decision of the owner 2026-11-19).
 * `null` would make the page tell people to ask their supervisor and show no empty link.
 */
export const CONTACT_EMAIL: string | null = DATA_MAILBOX;

/** Data of the controller: name, legal form, registry numbers, address, contact in data matters (as in the register). */
export interface AdministratorData {
  readonly name: string;
  readonly legalForm: string;
  readonly registry: string;
  readonly address: string;
  readonly dataContact: string;
}

export const ADMINISTRATOR: AdministratorData = {
  name: 'Electroplus Realty',
  legalForm: 'spółka z ograniczoną odpowiedzialnością (działa pod marką EVia Charge)',
  registry:
    'KRS 0001109597 (Sąd Rejonowy dla m.st. Warszawy w Warszawie, XII Wydział Gospodarczy Krajowego Rejestru Sądowego), NIP 5253005645, REGON 528831324, kapitał zakładowy 5 000 zł',
  address: 'Aleja „Solidarności” 68 / 121, 00-240 Warszawa',
  dataContact: `${DATA_MAILBOX} albo listownie na adres siedziby z dopiskiem „Dane osobowe”. Nie wyznaczyliśmy inspektora ochrony danych.`,
};

/** Version and date of validity shown under the title of every clause (format of the date: styleguide § 6.3). */
const VERSION = DRAFT ? '0.1 (projekt)' : '1.0';
const VALID_FROM = '19.11.2026';

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

/** A clause read outside the panel (an attachment, a footer) must stand on its own: the controller is named in full (art. 13 ust. 1 lit. a). */
const CONTROLLER = `Administratorem Twoich danych osobowych jest ${ADMINISTRATOR.name} ${ADMINISTRATOR.legalForm} z siedzibą pod adresem ${ADMINISTRATOR.address}; ${ADMINISTRATOR.registry}. W sprawach danych osobowych napisz na ${ADMINISTRATOR.dataContact}`;

const SUPERVISORY_AUTHORITY =
  'Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (Urząd Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa).';

/** The right to object has its own paragraph (art. 21 ust. 4: "wyraźnie i odrębnie"). */
const OBJECTION =
  'Prawo sprzeciwu: jeżeli przetwarzamy Twoje dane na podstawie prawnie uzasadnionego interesu, możesz w każdej chwili wnieść sprzeciw z przyczyn związanych z Twoją szczególną sytuacją. Przestaniemy wtedy przetwarzać te dane, chyba że wykażemy ważne, prawnie uzasadnione podstawy nadrzędne albo dane będą potrzebne do ustalenia, dochodzenia lub obrony roszczeń.';

/** How a request of a data subject reaches the controller (rodo.md → "Realizacja praw osób"; RODO art. 12 ust. 3 i 6). */
const REQUESTS = `Wniosek w sprawie swoich danych wyślij na ${DATA_MAILBOX} albo pisemnie na adres siedziby z dopiskiem „Dane osobowe”. Odpowiemy bez zbędnej zwłoki, najpóźniej w ciągu miesiąca; w skomplikowanych sprawach możemy przedłużyć ten termin o dwa miesiące — poinformujemy o tym w ciągu miesiąca. Żeby potwierdzić, że wniosek pochodzi od Ciebie, możemy poprosić o dodatkowe informacje, np. numer zlecenia; nie żądamy kopii dokumentu tożsamości.`;

/** Monitoring tools get technical identifiers only (rodo.md → "Dane poza bazą"; P9) — pseudonymous, not anonymous. */
const MONITORING_TRANSFER =
  'jeśli pracownicy tej spółki mieliby dostęp do tych danych z USA (np. przy wsparciu technicznym), podstawą jest decyzja Komisji Europejskiej o odpowiedniej ochronie danych (program Data Privacy Framework, w którym spółka uczestniczy), a dodatkowo standardowe klauzule umowne w naszej umowie z nią; kopię tych klauzul udostępnimy na Twoją prośbę';

const NO_OTHER_TRANSFER = 'Poza tym wyjątkiem nie przekazujemy Twoich danych poza Europejski Obszar Gospodarczy.';

const CLIENTS: Clause = {
  id: 'clients',
  title: 'Klauzula dla klientów (do przekazania klientom)',
  version: VERSION,
  validFrom: VALID_FROM,
  blocks: [
    paragraph(
      'Tę klauzulę przekazujemy klientom wtedy, gdy zbieramy ich dane — podczas wizji lokalnej, przy przygotowaniu oferty albo zawarciu umowy.',
    ),
    heading('Kto jest administratorem Twoich danych'),
    paragraph(CONTROLLER),
    heading('Jakie dane przetwarzamy'),
    paragraph(
      'Imię i nazwisko albo nazwę firmy, NIP, osobę kontaktową, numer telefonu, adres e-mail, adres korespondencyjny, adres miejsca instalacji i dane o instalacji (np. numer punktu poboru energii, moc przyłączeniowa, numer seryjny ładowarki, parametry instalacji), treść korespondencji i notatek ze zlecenia, zdjęcia i filmy z wykonywanych prac (wraz z danymi zapisanymi w pliku, np. datą wykonania), dokumenty zlecenia, a przy rozliczeniach kwoty, numery faktur i terminy płatności.',
    ),
    paragraph(
      'Dokumenty potrzebne w sprawie u operatora sieci lub w administracji budynku (np. pełnomocnictwo, wniosek o przyłączenie) mogą zawierać Twój numer PESEL albo numer dokumentu tożsamości — tylko wtedy, gdy wymaga tego formularz lub przepisy, i tylko po to, żeby załatwić tę sprawę w Twoim imieniu. Numerów tych nie zapisujemy w innych miejscach systemu, a plików tych dokumentów nie wysyłamy do aplikacji na telefonach techników. Nie robimy zdjęć ani kopii dokumentów tożsamości.',
    ),
    paragraph(
      'Zdjęcia i filmy z prac (filmy zawsze bez dźwięku) wykonują nasi pracownicy w firmowej aplikacji na telefonie służbowym albo prywatnym. Pliki są zapisywane tylko w pamięci tej aplikacji, nie trafiają do galerii telefonu ani do prywatnej chmury, a po przesłaniu na nasz serwer są usuwane z telefonu. W aplikacji przechowywana jest też zaszyfrowana kopia danych potrzebnych do zlecenia (nazwa, numer telefonu, adres instalacji); po zgłoszeniu utraty telefonu usuwamy ją zdalnie.',
    ),
    heading('W jakim celu i na jakiej podstawie'),
    list(
      'przygotowanie oferty, zawarcie i wykonanie umowy — montaż, instalacja i kontakt w sprawie prac (art. 6 ust. 1 lit. b RODO),',
      'prowadzenie w Twoim imieniu spraw u operatora sieci dystrybucyjnej i w administracji budynku, jako Twój pełnomocnik — to część umowy (art. 6 ust. 1 lit. b RODO),',
      'zdjęcia i filmy z prac — dokumentacja stanu przed montażem, w trakcie i po nim, potrzebna do odbioru prac, obsługi gwarancji i reklamacji oraz jako dowód należytego wykonania; to nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO),',
      'rozliczenie umowy — etapy i płatności (art. 6 ust. 1 lit. b RODO),',
      'wystawianie i przechowywanie faktur oraz dokumentów księgowych — obowiązek z przepisów podatkowych i o rachunkowości (art. 6 ust. 1 lit. c RODO),',
      'ustalenie, dochodzenie lub obrona roszczeń po zakończeniu prac — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO),',
      'odpowiedzi na wnioski w sprawie danych osobowych (art. 6 ust. 1 lit. c RODO),',
      'jeżeli klientem jest firma, a Ty jesteś jej osobą kontaktową — kontakt w sprawie zlecenia; to nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).',
    ),
    heading('Wizja lokalna (oględziny przed ofertą)'),
    paragraph(
      'Jeżeli prosisz nas o ofertę, nasz pracownik może najpierw obejrzeć miejsce instalacji (wizja lokalna). Robimy to wyłącznie na Twoje zgłoszenie — w celu przygotowania oferty, czyli działań podejmowanych na Twoje żądanie przed zawarciem umowy (art. 6 ust. 1 lit. b RODO).',
    ),
    paragraph(
      'Na tym etapie zapisujemy w naszym systemie: adres miejsca instalacji, zdjęcia i filmy posesji, garażu i instalacji elektrycznej (filmy bez dźwięku; wraz z danymi zapisanymi w pliku, np. datą wykonania), notatki z oględzin oraz — jeśli go podasz — Twój numer telefonu do kontaktu w sprawie oferty. Twojego imienia i nazwiska na tym etapie nie zapisujemy. Dane pochodzą od Ciebie i z oględzin wykonanych przez naszego pracownika.',
    ),
    paragraph(
      'Jeżeli na zdjęciach mimo naszej ostrożności znajdą się inne osoby, ich pojazdy albo tabliczki z nazwiskami, przetwarzamy je w naszym prawnie uzasadnionym interesie — przygotowania oferty i udokumentowania stanu miejsca przed pracami (art. 6 ust. 1 lit. f RODO); zasady opisuje sekcja „Osoby postronne na zdjęciach i filmach”.',
    ),
    paragraph(
      'Podanie adresu i umożliwienie oględzin jest dobrowolne, ale bez nich nie przygotujemy oferty. Numer telefonu jest nieobowiązkowy.',
    ),
    heading('Komu przekazujemy dane'),
    list(
      'operatorom sieci dystrybucyjnej, administracjom budynków, wspólnotom i spółdzielniom — w zakresie potrzebnym w prowadzonej sprawie; to odrębni administratorzy,',
      'projektantom, rzeczoznawcom i podwykonawcom — w zakresie potrzebnym do wykonania zlecenia,',
      'dostawcom usług IT z Unii Europejskiej, którzy przechowują dane w naszym imieniu (serwery i baza danych, przechowywanie zdjęć i dokumentów, kopie zapasowe — Hetzner, Scaleway),',
      `dostawcy narzędzi do monitorowania działania systemu (Grafana Labs) — to spółka z USA, która przetwarza dane w regionie UE; trafiają do niej wyłącznie identyfikatory techniczne, bez imion i nazwisk, adresów, numerów telefonów i treści zleceń; ${MONITORING_TRANSFER},`,
      'dostawcom poczty elektronicznej oraz operatorom pocztowym i kurierskim — w zakresie potrzebnym do wysłania korespondencji, a także organom publicznym, gdy wymagają tego przepisy.',
    ),
    paragraph(NO_OTHER_TRANSFER),
    heading('Jak długo przechowujemy dane'),
    list(
      'dane z wizji lokalnej, po której nie zawarliśmy umowy — najpóźniej po 90 dniach od zapisania wizji w naszym systemie (zwykle w dniu wizji); gdy decyzja wymaga więcej czasu (np. uchwały wspólnoty), możemy ten okres przedłużyć najwyżej dwa razy o 90 dni — łącznie nie dłużej niż 270 dni od zapisania wizji,',
      'dane z wizji lokalnej po Twojej rezygnacji albo odrzuceniu oferty — 14 dni od rezygnacji lub odrzucenia; jeżeli zawrzemy umowę, dokumentacja z wizji staje się częścią dokumentacji zlecenia i przechowujemy ją jak dane zlecenia,',
      'dane zlecenia, dokumenty i zdjęcia — 6 lat od końca roku kalendarzowego, w którym zlecenie zamknięto,',
      'zlecenie anulowane przed akceptacją — 12 miesięcy od anulowania,',
      'dane klienta bez zleceń — 12 miesięcy od utworzenia wpisu,',
      'faktury i dokumenty księgowe (poza tym systemem) — przez okres wymagany przepisami podatkowymi i o rachunkowości.',
    ),
    paragraph(
      'Po usunięciu lub anonimizacji dane mogą jeszcze najwyżej 37 dni pozostawać w zaszyfrowanych kopiach zapasowych. Z kopii korzystamy wyłącznie po to, żeby odtworzyć system po awarii; jeśli to robimy, ponownie usuwamy dane, które były już usunięte.',
    ),
    heading('Twoje prawa'),
    paragraph(
      'Masz prawo dostępu do danych i otrzymania ich kopii, sprostowania, usunięcia, ograniczenia przetwarzania oraz przenoszenia danych (w zakresie, w jakim przetwarzamy je na podstawie umowy).',
    ),
    paragraph(
      'Nie usuniemy danych, które musimy przechowywać z mocy przepisów albo które są potrzebne do obrony roszczeń — do końca okresów podanych wyżej.',
    ),
    paragraph(OBJECTION),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
    heading('Czy musisz podać dane'),
    paragraph(
      'Podanie danych jest dobrowolne, ale niezbędne do zawarcia i realizacji umowy oraz do prowadzenia w Twoim imieniu spraw z operatorem sieci. Dane do faktury zbieramy, bo wymagają tego przepisy podatkowe.',
    ),
    heading('Zautomatyzowane decyzje'),
    paragraph('Nie podejmujemy wobec Ciebie decyzji w sposób zautomatyzowany i nie profilujemy Twoich danych.'),
    heading('Osoby postronne na zdjęciach i filmach'),
    paragraph(
      'Zdjęcia i filmy dokumentują instalację, a nie ludzi. Staramy się nie utrwalać osób, które nie są stroną zlecenia, ani tablic rejestracyjnych; nie rozpoznajemy twarzy i nie ustalamy, kto jest na zdjęciu. Jeżeli mimo to znajdziesz się na zdjęciu lub filmie, przetwarzamy je na podstawie naszego prawnie uzasadnionego interesu — dokumentowania wykonanych prac (art. 6 ust. 1 lit. f RODO). Możesz zgłosić sprzeciw albo zażądać usunięcia: podaj adres i przybliżoną datę prac, żebyśmy mogli znaleźć plik. Usuniemy go, chyba że jest niezbędny do ustalenia, dochodzenia lub obrony roszczeń — wtedy ograniczymy do niego dostęp.',
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
      'Tę informację przekazujemy osobom, których dane kontaktowe otrzymaliśmy od klienta albo ze zlecenia — np. osobom kontaktowym klientów będących firmami, pracownikom administracji budynku, zarządcom, projektantom, rzeczoznawcom i pracownikom operatora sieci, a także osobom fizycznym, które występują w sprawie jako strona. Przekazujemy ją przy pierwszym kontakcie (np. w stopce wiadomości e-mail), najpóźniej w ciągu miesiąca od otrzymania danych.',
    ),
    heading('Kto jest administratorem danych'),
    paragraph(CONTROLLER),
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
    paragraph(
      'Dane, które są częścią dokumentów i korespondencji zlecenia, przechowujemy razem ze zleceniem — 6 lat od końca roku, w którym je zamknięto.',
    ),
    heading('Komu przekazujemy dane'),
    paragraph(
      `Dane są dostępne pracownikom firmy w zakresie ich zadań oraz dostawcom usług IT, którzy przechowują dane w naszym imieniu (Hetzner, Scaleway — Unia Europejska). Do narzędzia monitorowania działania systemu (Grafana Labs — spółka z USA, region UE) trafiają wyłącznie identyfikatory techniczne, bez Twojego imienia i nazwiska, telefonu i adresu e-mail; ${MONITORING_TRANSFER}. ${NO_OTHER_TRANSFER}`,
    ),
    heading('Twoje prawa'),
    paragraph('Masz prawo dostępu do danych, ich sprostowania, usunięcia i ograniczenia przetwarzania.'),
    paragraph(OBJECTION),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
    paragraph('Nie podejmujemy wobec Ciebie zautomatyzowanych decyzji i nie profilujemy Twoich danych.'),
  ],
};

const EMPLOYEES: Clause = {
  id: 'employees',
  title: 'Klauzula dla pracowników i współpracowników (panel, aplikacja mobilna, prywatny telefon)',
  version: VERSION,
  validFrom: VALID_FROM,
  blocks: [
    paragraph(
      'Dotyczy pracowników, współpracowników i członków zarządu, którzy mają konto w EVia Manager — w panelu w przeglądarce albo w aplikacji mobilnej, także na prywatnym telefonie lub komputerze.',
    ),
    heading('Kto jest administratorem danych'),
    paragraph(CONTROLLER),
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
    paragraph('Dane pochodzą od Ciebie i z Twojej aktywności w systemie; konto zakłada administrator systemu.'),
    heading('W jakim celu i na jakiej podstawie'),
    paragraph(
      'Cele: dostęp do systemu, bezpieczeństwo danych klientów, rozliczalność (kto i kiedy wykonał operację) oraz ochrona przed nadużyciami. Podstawy: nasz prawnie uzasadniony interes — bezpieczna organizacja pracy na zleceniach i możliwość wyjaśnienia incydentu (art. 6 ust. 1 lit. f RODO) — oraz obowiązek zabezpieczenia danych osobowych (art. 6 ust. 1 lit. c w związku z art. 32 RODO). Dziennik audytu nie służy do oceny wydajności ani kontroli czasu pracy. Sięgamy do niego przy alercie bezpieczeństwa, wyjaśnianiu incydentu i okresowej kontroli bezpieczeństwa; jego zapisy mogą być dowodem, jeśli dojdzie do naruszenia zasad ochrony danych.',
    ),
    paragraph('Podanie adresu e-mail i nazwy wyświetlanej jest niezbędne do założenia konta i pracy w systemie.'),
    heading('Jak długo przechowujemy dane'),
    list(
      'konto — 2 lata od dezaktywacji, potem anonimizacja,',
      'dziennik audytu — 2 lata,',
      'sesje — 30 dni od wygaśnięcia lub unieważnienia (usuwamy je automatycznie, raz na dobę),',
      'rejestr przeglądarek konta — 30 dni od ostatniego użycia przeglądarki (wcześniej, gdy konto zostanie dezaktywowane albo zresetujemy hasło lub drugi krok logowania),',
      'liczniki nieudanych prób logowania — 30 minut po zakończeniu okna prób albo blokady,',
      'logi na serwerze — 7 dni, logi i metryki w narzędziu do monitorowania — 14 dni,',
      'zaszyfrowane kopie zapasowe — do 37 dni po usunięciu danych.',
    ),
    heading('Panel w przeglądarce prywatnego telefonu lub komputera'),
    paragraph('Panel działa w przeglądarce. Korzystając z niego na prywatnym urządzeniu:'),
    list(
      'w przeglądarce zostają tylko dwa pliki cookie: sesji oraz „__Host-evia_device” — panel nie zapisuje w pamięci przeglądarki danych osobowych ani danych zleceń,',
      'plik cookie „__Host-evia_device” zawiera losowy identyfikator, bez danych o urządzeniu, adresie IP i lokalizacji; służy do rozpoznania przeglądarki, z której już logowano się do konta (powiadomienie o logowaniu z nowej przeglądarki) i do osobnego licznika prób logowania; wygasa po 30 dniach od ostatniego użycia, nie uwierzytelnia Cię i nie pomija drugiego kroku logowania,',
      'po wylogowaniu panel czyści dane ze swojej pamięci w tej karcie,',
      'gdy korzystasz wyłącznie z panelu w przeglądarce, firma nie instaluje niczego na Twoim urządzeniu i nie ma dostępu do jego plików, kontaktów, galerii ani innych aplikacji (aplikację mobilną opisuje sekcja niżej),',
      'prosimy o blokadę ekranu, aktualne oprogramowanie i wylogowanie po pracy; utratę urządzenia albo podejrzenie, że ktoś zna Twoje hasło, zgłoś od razu administratorowi (sekcja „Pomoc”).',
    ),
    paragraph(
      'Korzystanie z prywatnego telefonu lub komputera do pracy jest dobrowolne. Zasady (blokada ekranu, aktualizacje, zgłoszenie utraty, co dzieje się po zakończeniu współpracy) dostajesz na piśmie i potwierdzasz podpisem przed pierwszym logowaniem na prywatnym urządzeniu. Możesz się wycofać w każdej chwili, bez negatywnych skutków — wtedy pracujesz na sprzęcie firmowym albo bez aplikacji.',
    ),
    heading('Aplikacja mobilna EVia Manager'),
    paragraph(
      'Aplikacja służy do pracy w terenie, także bez zasięgu: pokazuje zlecenia i pozwala dodawać wpisy oraz zdjęcia i filmy z prac (filmy zawsze bez dźwięku). Instalujemy ją z pliku przekazanego przez administratora systemu, w jego obecności — nie ze sklepu z aplikacjami i nigdy z linku; na telefon trafia wyłącznie plik aplikacji.',
    ),
    paragraph('Jakie dane o Tobie i telefonie przetwarzamy na serwerze w związku z aplikacją:'),
    list(
      'dane telefonu: model, system i jego wersja, poziom poprawek bezpieczeństwa, wersja aplikacji, losowy identyfikator tej instalacji aplikacji (nie jest to numer IMEI, numer telefonu ani identyfikator reklamowy), czas ostatniego połączenia z serwerem, liczba elementów czekających na wysłanie i stan urządzenia; widzisz je Ty i administrator systemu,',
      'dane sesji aplikacji: adres IP przy połączeniach i czasy aktywności,',
      'Twoja praca w aplikacji: wpisy, zdjęcia i filmy z Twoją nazwą wyświetlaną jako autora i czasem wykonania oraz informacja, że pochodzą z aplikacji i z której instalacji,',
      'dziennik audytu obejmuje działania z aplikacji tak samo jak działania w panelu.',
    ),
    paragraph('Co aplikacja przechowuje w telefonie:'),
    list(
      'zaszyfrowaną bazę z kopią zleceń potrzebnych do pracy (m.in. nazwa i telefon klienta, adres instalacji, opisy dokumentów bez ich plików; bez płatności oraz adresów e-mail i numerów NIP klientów) — klucz szyfrujący jest w bezpiecznym magazynie systemu Android,',
      'kolejkę zmian czekających na wysłanie oraz zdjęcia i filmy do czasu, aż serwer potwierdzi ich odbiór — potem aplikacja usuwa je z telefonu,',
      'zdjęcia i filmy są zapisywane wyłącznie w prywatnej pamięci aplikacji: nie trafiają do galerii telefonu ani do chmury Google lub producenta i nie zawierają lokalizacji GPS,',
      'dane aplikacji są wyłączone z kopii zapasowej telefonu i z przenoszenia na nowy telefon,',
      'aplikacja wysyła pliki także w tle i pokazuje wtedy powiadomienie — bez treści zleceń.',
    ),
    paragraph('Czego aplikacja nie robi:'),
    list(
      'nie ma dostępu do Twoich prywatnych zdjęć i plików, kontaktów, SMS-ów, historii połączeń ani innych aplikacji,',
      'nie zbiera lokalizacji i nie śledzi, gdzie jesteś; nie używa mikrofonu, a filmy nagrywa bez dźwięku,',
      'korzysta tylko z aparatu (gdy robisz zdjęcie lub film w aplikacji), z internetu i z powiadomień,',
      'nie zawiera narzędzi analitycznych ani reklamowych i nie wysyła raportów o błędach do zewnętrznych firm — dane z aplikacji trafiają wyłącznie na serwery, z których korzysta firma,',
      'firma nie zarządza Twoim telefonem: nie może go zdalnie przeglądać, blokować ani wymazać w całości.',
    ),
    paragraph(
      'Cel i podstawa: organizacja pracy w terenie oraz bezpieczeństwo danych klientów na telefonie — nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO) i obowiązek zabezpieczenia danych (art. 6 ust. 1 lit. c w związku z art. 32 RODO). Danych o telefonie używamy tylko po to, żeby rozpoznać urządzenie, ostrzec o nieaktualnych zabezpieczeniach i móc je wylogować; nie służą do oceny Twojej pracy ani kontroli czasu pracy.',
    ),
    paragraph(
      'Utrata telefonu i zakończenie współpracy: zgubienie lub kradzież telefonu zgłoś od razu (kontakt w sekcji „Pomoc”). Administrator wybiera wtedy „Zablokuj i wyczyść”: Twoje konto na tym telefonie zostaje wylogowane, a przy najbliższym połączeniu z serwerem aplikacja usuwa z telefonu wszystkie dane firmowe — bazę, kolejkę, zdjęcia, filmy i klucze. Tak samo dzieje się po dezaktywacji konta przy zakończeniu współpracy. Usuwane są wyłącznie dane tej aplikacji, nic poza nią. Dane możesz też usunąć samodzielnie („Wyczyść dane firmowe”) albo odinstalowując aplikację — niewysłane elementy wtedy przepadają. Po zwykłym wylogowaniu aplikacja usuwa kopię zleceń, a elementy niewysłane czekają na Twoje ponowne zalogowanie. Jeżeli aplikacja nie połączy się z serwerem przez 7 dni, ukrywa dane zleceń do ponownego zalogowania. Aplikacja wymaga włączonej blokady ekranu i sprawdza tylko, czy jest włączona.',
    ),
    paragraph(
      'Jak długo: dane o telefonie na serwerze — 90 dni od ostatniego połączenia albo unieważnienia urządzenia; sesje aplikacji kończą się po 30 dniach bez połączenia i są usuwane po kolejnych 30 dniach; kopia zlecenia w telefonie — do 30 dni po zamknięciu zlecenia, do wylogowania albo wyczyszczenia; zdjęcia i filmy w telefonie — do potwierdzenia odbioru przez serwer.',
    ),
    paragraph(
      'Prywatny telefon: używasz go dobrowolnie, na zasadach z pisemnego oświadczenia (sekcja „Panel w przeglądarce prywatnego telefonu lub komputera”).',
    ),
    heading('Komu przekazujemy dane'),
    paragraph(
      `Dostawcom usług IT, którzy przetwarzają dane w naszym imieniu: hosting i kopie zapasowe (Hetzner, Scaleway — Unia Europejska), wiadomości e-mail z zaproszeniami i alertami (Scaleway), monitorowanie działania systemu (Grafana Labs — spółka z USA, region UE; tylko identyfikatory techniczne i skrócony adres IP; ${MONITORING_TRANSFER}). ${NO_OTHER_TRANSFER}`,
    ),
    heading('Twoje prawa'),
    paragraph(
      'Masz prawo dostępu do danych, sprostowania, usunięcia i ograniczenia przetwarzania. Nie stosujemy profilowania ani zautomatyzowanych decyzji.',
    ),
    paragraph(OBJECTION),
    paragraph(REQUESTS),
    paragraph(SUPERVISORY_AUTHORITY),
  ],
};

/** Order of the clauses on the page: clients, contact persons of parties, employees and BYOD. */
export const CLAUSES: readonly Clause[] = [CLIENTS, PARTIES, EMPLOYEES];
