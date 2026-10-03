# RODO — szkic operacyjny EVia Manager

> Dokument żywy (EVM-005). Właściciel: `security-engineer`; decyzje i dane rejestrowe: Konrad. Wersja **v1, 2026-10-03**.
>
> **To szkic operacyjny, nie porada prawna.** Opisuje, jakie dane osobowe przetwarza system, gdzie, jak długo i jak realizujemy obowiązki z RODO — tak, żeby zespół mógł to wbudować w system. Punkty wymagające oceny prawnika lub inspektora ochrony danych są oznaczone **`[PRAWNIK/IOD]`** i zebrane w [ostatnim rozdziale](#punkty-do-konsultacji-z-prawnikiem-lub-iod). Dane rejestrowe firmy to pola do uzupełnienia przez Konrada — dokument nie zawiera prawdziwych danych osobowych.

Powiązane: klasyfikacja danych z EVM-002 ([`../architecture/domain-model.md` → „Klasyfikacja danych”](../architecture/domain-model.md#klasyfikacja-danych)), usuwanie danych ([„Usuwanie danych”](../architecture/domain-model.md#usuwanie-danych)), polityki P1–P12 ([`policies.md`](policies.md)), model zagrożeń ([`threat-model.md`](threat-model.md)), wymagania ([`requirements.md`](requirements.md)), podmioty zewnętrzne ([ADR-0011](../architecture/adr/0011-hosting-i-srodowiska-ue.md)).

## Spis treści
1. [Administrator danych i role podmiotów](#administrator-danych-i-role-podmiotów)
2. [Inwentaryzacja danych osobowych](#inwentaryzacja-danych-osobowych)
3. [Cele i podstawy przetwarzania](#cele-i-podstawy-przetwarzania)
4. [Retencja](#retencja)
5. [Podmioty przetwarzające i umowy powierzenia](#podmioty-przetwarzające-i-umowy-powierzenia)
6. [Realizacja praw osób (art. 15–22)](#realizacja-praw-osób-art-1522)
7. [Obowiązek informacyjny](#obowiązek-informacyjny)
8. [Privacy by design i wstępna ocena DPIA](#privacy-by-design-i-wstępna-ocena-dpia)
9. [Procedura naruszeń (72 h)](#procedura-naruszeń-72-h)
10. [Szkic rejestru czynności przetwarzania (art. 30)](#szkic-rejestru-czynności-przetwarzania-art-30)
11. [Punkty do konsultacji z prawnikiem lub IOD](#punkty-do-konsultacji-z-prawnikiem-lub-iod)

## Administrator danych i role podmiotów
**Dane rejestrowe administratora** (uzupełnia Konrad przed produkcją — E8)
| Pole | Wartość |
|---|---|
| Nazwa | _do uzupełnienia_ |
| Forma prawna | _do uzupełnienia_ |
| NIP, REGON, KRS albo CEIDG | _do uzupełnienia_ |
| Adres siedziby | _do uzupełnienia_ |
| Kontakt w sprawach danych osobowych (e-mail, telefon) | _do uzupełnienia_ (propozycja: osobna skrzynka, np. `dane@<domena firmy>`) |
| Osoba odpowiedzialna za ochronę danych w firmie | _do uzupełnienia_ (rekomendacja: Konrad) |
| Prawnik lub IOD do konsultacji | _pytanie do Konrada: czy firma ma?_ |

**Role podmiotów**
| Podmiot | Rola wobec danych w systemie | Uwagi |
|---|---|---|
| EVia Charge | **administrator** danych klientów, osób trzecich i pracowników | decyduje o celach i środkach |
| Hetzner, Scaleway, Sentry, Grafana Labs | **podmioty przetwarzające** (art. 28) | [rozdział 5](#podmioty-przetwarzające-i-umowy-powierzenia) |
| OSD (operator systemu dystrybucyjnego), administracje i zarządcy budynków, wspólnoty i spółdzielnie | **odrębni administratorzy** — otrzymują dane (np. pełnomocnictwo, wniosek) od firmy działającej jako pełnomocnik klienta i przetwarzają je we własnych celach | przekazanie poza systemem (e-mail, portal OSD, papier) `[PRAWNIK/IOD]` |
| Projektanci, rzeczoznawcy, podwykonawcy | zależnie od umowy: odrębni administratorzy albo podmioty przetwarzające | ocena per umowa; przy powierzeniu — umowa powierzenia `[PRAWNIK/IOD]` |
| GitHub, Expo, Google (Play), Apple (odłożony), Let's Encrypt | bez danych klientów; dane pracowników w minimalnym zakresie (konta, e-maile testerów) | [rozdział 5](#podmioty-przetwarzające-i-umowy-powierzenia) |
| Pwned Passwords | nie otrzymuje danych osobowych (5 znaków skrótu hasła) | ADR-0005 |

**Inspektor ochrony danych (art. 37):** wstępnie **nie jest obowiązkowy** — firma nie jest organem publicznym, jej główna działalność nie polega na regularnym i systematycznym monitorowaniu osób na dużą skalę ani na przetwarzaniu na dużą skalę danych szczególnych kategorii. Rekomendacja: wskazać osobę odpowiedzialną (Konrad) i kontakt w sprawach danych. `[PRAWNIK/IOD]`

## Inwentaryzacja danych osobowych
**Kategorie osób:** klienci (osoby fizyczne, w tym przedsiębiorcy jednoosobowi; osoby kontaktowe klientów-firm); osoby trzecie (osoby kontaktowe stron — administracje, zarządcy, projektanci, rzeczoznawcy, OSD; osoby fizyczne będące stronami; osoby, twarze i tablice rejestracyjne przypadkowo widoczne na zdjęciach i filmach); pracownicy i współpracownicy (użytkownicy systemu, technicy z telefonami BYOD); testerzy aplikacji (pracownicy).

Klasy (z EVM-002): **DO-K** — dane klientów, **DO-3** — osób trzecich, **DO-P** — pracowników, **SEK** — sekrety uwierzytelniające, **WF** — wrażliwe dla firmy, **WEW** — wewnętrzne, **KONF** — konfiguracja. Każde pole swobodne i każde medium traktujemy jako mogące zawierać dane osobowe.

**Dane w systemie — per encja** (każda encja z tabeli klasyfikacji EVM-002)
| Encja | Kategorie osób | Kategorie danych | Gdzie | Źródło | Odbiorcy w systemie |
|---|---|---|---|---|---|
| `Customer` | klienci | imię i nazwisko lub nazwa firmy, NIP, osoba kontaktowa, telefon, e-mail, adres korespondencyjny, notatki | baza, kopie bazy; telefon — nazwa i telefon | klient | A, E, R |
| `Site` | klienci | adres, nr miejsca postojowego, poziom garażu, PPE, moc przyłączeniowa, notatki | baza, kopie; telefon — bez PPE | klient, administracja, OSD | A, E, R |
| `Charger` | klienci (pośrednio) | numer seryjny urządzenia w domu klienta | baza, kopie, telefon | klient, technik | A, E, R |
| `Party` | osoby trzecie | imię i nazwisko (osoba fizyczna, osoba kontaktowa), telefon, e-mail, notatki | baza, kopie; telefon — bez e-maila i notatek | strona, klient | A, E, R |
| `WorkOrder` | klienci (pośrednio) | tytuł, opis, powód statusu (pola swobodne) | baza, kopie, telefon | pracownicy | A, E, R |
| `WorkOrderAssignment` | pracownicy | przypisanie pracownika do zlecenia | baza, kopie, telefon | pracownicy | A, E, R |
| `ScopeItem` | klienci (pośrednio) | parametry instalacji (bez identyfikatorów osób), notatki | baza, kopie, telefon | pracownicy | A, E, R |
| `Procedure`, `ProcedureStage` | pracownicy, osoby trzecie (pośrednio) | odpowiedzialny pracownik, „na kogo czekamy”, powody i notatki | baza, kopie, telefon | pracownicy | A, E, R |
| `PaymentMilestone` | klienci (osoby fizyczne) | kwota, numer faktury, terminy, status | baza, kopie, audyt (kwoty); **nie na telefonie** | pracownicy, system fakturowy (poza systemem) | A, E, R (P6) |
| `TimelineEntry` | klienci, osoby trzecie, pracownicy | treść wpisów i komentarzy (dowolne dane), autor | baza, kopie, telefon | pracownicy | A, E, R |
| `MediaAsset` | klienci, osoby trzecie, pracownicy | zdjęcia i filmy (wnętrza posesji, garaże, twarze, tablice rejestracyjne), opis, autor, metadane plików z przeglądarki (EXIF, w tym GPS — P3) | storage Scaleway, kopia w Storage Box, kopie bazy (metadane), telefon (oczekujące, miniatury) | technicy, biuro, osoby trzecie | A, E; R — podglądy (P6) |
| `StoredFile`, `UploadSession` | jak właściciel | oryginalna nazwa pliku (może zawierać dane), treść pliku | baza, storage | jak właściciel | przez właściciela |
| `Document`, `DocumentVersion` | klienci, osoby trzecie | treść dokumentów: `identity_data` (PESEL, nr dowodu, podpis — pełnomocnictwa, wnioski i umowy z OSD, umowa z klientem), `building_security` (projekty, ekspertyzy, opinie ppoż), `standard`; tytuł, opis | storage, kopia mediów, kopie bazy (metadane); na telefonie tylko metadane | klient, OSD, administracja, projektanci, rzeczoznawcy | A, E; R — tylko `standard` (P6) |
| konfiguracja (`ServiceCatalogItem`, `WorkOrderTemplate`, `ProcedureTemplate`, pozostałe szablony, `DocumentKind`) | — | brak danych osobowych (KONF) | baza, telefon | Administrator | wszyscy |
| `User` | pracownicy | e-mail, nazwa wyświetlana, rola, status, ostatnie logowanie | baza, kopie; innym i na telefonie — tylko nazwa | Administrator, pracownik | A (pełne), pozostali — nazwa |
| `Session`, `Device`, `DeviceSyncState` | pracownicy | IP (P9), przeglądarka, model telefonu, wersja systemu i aplikacji, poziom poprawek, czasy aktywności, liczba niewysłanych elementów | baza, kopie | system | użytkownik (własne), A |
| dane uwierzytelniające | pracownicy | skróty haseł i kodów, sekrety TOTP (szyfrowane — P12), klucze publiczne passkeys, skróty tokenów; refresh token na telefonie | baza, kopie, Keystore telefonu | system, pracownik | nikt (tylko weryfikacja) |
| `AuditEvent` | pracownicy | kto, co, kiedy, skąd (prefiks IP — P9), wynik; bez wartości danych (wyjątek: kwoty płatności) | baza, kopie | system | A (step-up) |
| `IdempotencyRecord` | pracownicy (pośrednio) | identyfikatory użytkownika i urządzenia, skrót treści | baza, kopie | system | system |
| `SyncChange` | — | identyfikatory i kody (bez danych osobowych) | baza, kopie | system | system |

**Dane poza bazą**
| Miejsce | Dane osobowe | Okres | Uwagi |
|---|---|---|---|
| Scaleway Object Storage `pl-waw` | media, dokumenty, pliki eksportu ZIP, kopie bazy (szyfrowane) | P4 | SSE, prywatny bucket |
| Hetzner Storage Box (Finlandia) | kopia mediów | P4 | szyfrogram (`rclone crypt`) |
| VM Hetzner (Niemcy) | baza (LUKS), logi lokalne z pełnym IP | logi — 7 dni | kopie dysku systemowego bez danych bazy (7 dni) |
| Grafana Cloud (region UE) | identyfikatory techniczne (UUID), prefiks IP | 14 dni | po redakcji (ADR-0013, P9) |
| Sentry (region UE) | identyfikatory techniczne (UUID) | 30 dni | bez IP i danych osobowych (P9, SR-PRIV-09) |
| Scaleway TEM (e-mail) | adresy e-mail pracowników, treść zaproszeń, resetu i alertów (bez danych klientów) | wg dostawcy — do sprawdzenia przed produkcją | ADR-0005 |
| Telefony techników | projekcja danych zleceń, media oczekujące, miniatury, refresh token | do wyjścia z zakresu / 7 dni offline | SQLCipher, sandbox, wykluczone z kopii (ADR-0007, P2, P7) |
| Komputery biura | pobrane pliki i eksporty | poza systemem | środki organizacyjne niżej |
| GitHub, CI, EAS | brak danych klientów (tylko dane syntetyczne); konta pracowników | — | ADR-0012, ADR-0014 |
| Google Play | adresy e-mail testerów (pracowników) | czas pilotażu | warunki programu deweloperskiego |
| Poza systemem: skrzynka e-mail firmy, system fakturowy, komunikatory, papier | dane klientów i dokumenty | — | ujęte w rejestrze czynności firmy `[PRAWNIK/IOD]` |

**Środki organizacyjne dla komputerów biura** (TM-11, RR-17): aktualny system i przeglądarka, wbudowany antywirus, konto użytkownika bez uprawnień administratora, tylko znane rozszerzenia przeglądarki, blokada ekranu, szyfrowanie dysku, jeśli sprzęt i system je oferują; pobrane oryginały i dokumenty usuwane po użyciu, eksporty nie trafiają na prywatne dyski.

## Cele i podstawy przetwarzania
| Cel | Dane | Podstawa (art. 6 ust. 1) | Uwagi |
|---|---|---|---|
| Przygotowanie oferty i realizacja umowy (zlecenie, montaż, instalacja) | DO-K, media, dokumenty | lit. b — umowa lub działania przed jej zawarciem | |
| Procesy formalne z OSD i administracją w imieniu klienta (pełnomocnictwa, wnioski) | DO-K, dokumenty `identity_data` z PESEL | lit. b (umowa obejmuje reprezentację klienta) | PESEL tylko w dokumentach, bez pola w bazie; dostęp wg P6 `[PRAWNIK/IOD]` |
| Dokumentacja fotograficzna i filmowa prac | DO-K, DO-3 (przypadkowo), DO-P (autor) | lit. b (realizacja), lit. f (dowód należytego wykonania, obrona przed roszczeniami) | unikamy fotografowania osób i tablic rejestracyjnych (SR-PRIV-10) |
| Rozliczenia etapowe | DO-K (kwoty, numery faktur) | lit. b, lit. c (przepisy podatkowe — dokumenty księgowe w systemie fakturowym) | `[PRAWNIK/IOD]` |
| Kontakt ze stronami procesu | DO-3 (osoby kontaktowe) | lit. f (kontakt w sprawie zlecenia) | informacja z art. 14 |
| Ustalenie, dochodzenie i obrona roszczeń po realizacji | dane zlecenia, media, dokumenty | lit. f | uzasadnia okres retencji z P4 `[PRAWNIK/IOD]` |
| Konta pracowników i dostęp do systemu | DO-P | lit. b (umowa z pracownikiem lub współpracownikiem), lit. f | `[PRAWNIK/IOD]` |
| Bezpieczeństwo systemu: audyt, logi, telemetria, ochrona przed nadużyciami | DO-P (pseudonimowe), IP | lit. f (bezpieczeństwo i rozliczalność), lit. c (art. 32 RODO) | |
| Aplikacja mobilna na prywatnych telefonach (BYOD) | DO-P (model, system, poziom poprawek, czasy kontaktu) | lit. f | regulamin BYOD i informacja (P7) `[PRAWNIK/IOD]` |
| Obsługa żądań osób i naruszeń | dane wnioskodawcy, opis naruszenia | lit. c | rejestry poza repozytorium |

- **Art. 9 (dane szczególnych kategorii):** nie przetwarzamy celowo. Zdjęcia wnętrz mogą przypadkowo ujawnić np. pomoce dla osób z niepełnosprawnością lub symbole religijne — minimalizujemy (instrukcja, kadrowanie) i nie wykorzystujemy. Twarze na zdjęciach nie są danymi biometrycznymi, bo nie przetwarzamy ich technicznie w celu identyfikacji. `[PRAWNIK/IOD]`
- **Art. 10 (wyroki, czyny zabronione):** nie przetwarzamy.
- **PESEL i numery dokumentów:** wyłącznie w treści dokumentów `identity_data` wymaganych w procesie z OSD (pełnomocnictwo, wniosek, umowa); bez pól w bazie (minimalizacja z EVM-002), bez kopii na telefonach, dostęp tylko Administrator i Edytor z audytem pobrań (P6). Zdjęć dokumentów tożsamości nie wykonujemy. `[PRAWNIK/IOD]`
- **Profilowanie i zautomatyzowane decyzje (art. 22):** nie stosujemy.

## Retencja
Wartości wspólne z [`policies.md` → P4](policies.md#p4--retencja-mediów-dokumentów-dzienników-audytu-logów-i-kopii) (P4 jest źródłem rekomendacji; po decyzji Konrada oba dokumenty zmieniają się razem). Okresy to konfiguracja systemu (SR-PRIV-01).

| Kategoria | Okres | Liczony od | Uzasadnienie |
|---|---|---|---|
| Zlecenie z danymi powiązanymi (zakres, procesy, etapy, płatności, dziennik, media, dokumenty, przypisania) | 6 lat | końca roku kalendarzowego, w którym zlecenie zamknięto | przedawnienie roszczeń z umowy, rękojmia dla prac w budynku, przepisy podatkowe `[PRAWNIK/IOD]` |
| Zlecenie anulowane przed akceptacją (nigdy w stanie `accepted`) | 12 miesięcy | anulowania | brak umowy; obsługa ponownego zapytania; minimalizacja `[PRAWNIK/IOD]` |
| Klient | do końca retencji jego ostatniego zlecenia; klient bez zleceń — 12 miesięcy | utworzenia (bez zleceń) | wynika z okresów zleceń |
| Lokalizacja i ładowarki | do końca retencji ostatniego zlecenia w lokalizacji | — | wynika z okresów zleceń |
| Strona — organizacja | bez limitu (dane firmy); przegląd co 2 lata | — | nie są danymi osobowymi |
| Strona — osoba fizyczna i osoba kontaktowa | 2 lata | ostatniego zlecenia, w którym występuje | prawnie uzasadniony interes (kontakt) |
| Dokumenty z kotwicą klienta lub lokalizacji | jak klient albo lokalizacja | — | |
| Konto pracownika | 2 lata | dezaktywacji | rozliczalność działań (równo z audytem) `[PRAWNIK/IOD]` |
| Sesje | 30 dni | wygaśnięcia lub unieważnienia | bezpieczeństwo (dochodzenia) |
| Urządzenia i stan synchronizacji | 90 dni | unieważnienia albo ostatniego kontaktu | bezpieczeństwo |
| Dane uwierzytelniające (hasła, sekrety TOTP, kody, passkeys, tokeny) | do zmiany, usunięcia lub wygaśnięcia | — | |
| Dziennik audytu | 2 lata | zdarzenia | ADR-0013; rozliczalność |
| Klucze idempotencji | 30 dni | zapisu | ADR-0004 |
| Dziennik zmian synchronizacji i znaczniki usunięcia | 90 dni | zapisu | ADR-0008 |
| Rejestr usunięć (identyfikatory purge, anonimizacji i redakcji; poza bazą) | 40 dni | zapisu | ponowne zastosowanie usunięć po odtworzeniu kopii bazy i mediów (SR-PRIV-04) |
| Logi operacyjne (Grafana Cloud) | 14 dni | zapisu | ADR-0013 |
| Metryki | 14 dni | zapisu | ADR-0013 |
| Błędy (Sentry) | 30 dni | zdarzenia | ADR-0013 |
| Logi lokalne na VM (w tym dostępowe z pełnym IP) | 7 dni | zapisu | ADR-0013 |
| Media w kwarantannie | 30 dni | kwarantanny | ADR-0009 |
| Niedokończone uploady | 7 dni | rozpoczęcia | ADR-0009 |
| Stare wersje obiektów w buckecie mediów | 30 dni | zastąpienia lub usunięcia | ADR-0009 |
| Kopie bazy (PITR) i ich niezmienne wersje | 30 dni / 37 dni | wykonania | ADR-0003, ADR-0011 |
| Kopia mediów — snapshoty Storage Box | 14 dni | snapshotu | ADR-0011 |
| Kopie dysku systemowego VM | 7 dni | wykonania | ADR-0011 |
| Pliki eksportu ZIP | 24 h | utworzenia | P10 |
| Dane na telefonie (projekcja) | do wyjścia z zakresu (zlecenie zamknięte ponad 30 dni temu) | — | ADR-0008, `offline-sync.md` |
| Oryginały oczekujące na telefonie | do potwierdzenia `clean` przez serwer | — | „nic nie ginie” |

**Kopie zapasowe a usunięcie (art. 17):** dane usunięte lub zanonimizowane pozostają w niezmiennych kopiach bazy do 37 dni, w starszych wersjach obiektów do 30 dni i w snapshotach kopii mediów do 14 dni — kopie są szyfrowane i poza bieżącym użyciem, a po każdym odtworzeniu bazy lub mediów ponownie stosujemy rejestr usunięć, który leży poza bazą (osobny bucket, aplikacja może do niego tylko dopisywać), więc odtworzenie go nie cofa (SR-PRIV-04). Informujemy o tym w klauzuli (RR-14). `[PRAWNIK/IOD]`

**Rejestry poza systemem** (żądania osób, naruszenia): 5 lat od zamknięcia sprawy — rekomendacja `[PRAWNIK/IOD]`.

## Podmioty przetwarzające i umowy powierzenia
Na podstawie [ADR-0011](../architecture/adr/0011-hosting-i-srodowiska-ue.md) („RODO — podprocesorzy”). Status umów — do zamknięcia przed produkcją (E8).

| Podmiot | Siedziba | Rola | Dane osobowe | Region | Umowa | Transfer poza EOG | Status |
|---|---|---|---|---|---|---|---|
| Hetzner Online GmbH | Niemcy | VM, baza, kopie VM, Storage Box | wszystkie dane systemu | DE, FI | DPA (AVV) w panelu klienta | nie | do zawarcia (E8) |
| Scaleway SAS (grupa Iliad) | Francja | storage mediów, kopie bazy, e-mail transakcyjny | media, dokumenty, kopie, adresy e-mail pracowników | PL (`pl-waw`) | DPA w warunkach usługi | nie | do akceptacji (E8) |
| Functional Software Inc. (Sentry) | USA | raporty błędów | ograniczone (identyfikatory po scrubbingu) | UE (Frankfurt) | DPA + SCC albo DPF | możliwy dostęp z USA (wsparcie) | do zawarcia; weryfikacja DPF (E8) `[PRAWNIK/IOD]` |
| Grafana Labs | USA | logi i metryki | ograniczone (identyfikatory, prefiks IP) | UE | DPA + SCC albo DPF | możliwy dostęp z USA | do zawarcia; weryfikacja DPF (E8) `[PRAWNIK/IOD]` |
| GitHub Inc. (Microsoft) | USA | kod, CI | brak danych klientów; konta pracowników | USA/UE | DPA w umowie klienta | tak (konta) | do akceptacji (EVM-006) |
| 650 Industries Inc. (Expo) | USA | buildy mobilne, podpisywanie | brak danych klientów; konta pracowników | USA | DPA na żądanie | tak (konta) | do decyzji przy EVM-009 |
| Google (Play Console) | USA | dystrybucja aplikacji | e-maile testerów (pracowników) | globalnie | warunki programu deweloperskiego | tak | przy EVM-009 `[PRAWNIK/IOD]` |
| Apple (TestFlight) | USA | dystrybucja iOS | — | — | — | — | odłożone (ADR-0015) |
| Let's Encrypt (ISRG) | USA | certyfikaty TLS | brak (nazwy domen) | — | — | — | nie dotyczy |

**Checklista przed produkcją (E8, SR-PRIV-06)**
1. Zaakceptowane umowy powierzenia: Hetzner (AVV), Scaleway, Sentry, Grafana Labs; przy danych pracowników — GitHub i Expo.
2. Sprawdzone listy dalszych podprocesorów i lokalizacji; ustawione regiony UE (Sentry `de`, Grafana Cloud — stos w UE).
3. Sprawdzona certyfikacja Data Privacy Framework (Sentry, Grafana Labs) albo SCC w umowie; ocena skutków transferu `[PRAWNIK/IOD]`.
4. Ustawienia prywatności u dostawców: Sentry — scrubbing, bez zapisu IP, retencja; Grafana Cloud — retencja 14 dni; Scaleway TEM — sprawdzona retencja logów e-mail; Hetzner — kopie VM 7 dni.
5. MFA na wszystkich kontach administracyjnych i minimum osób z dostępem (SR-INFRA-09).
6. Umowy z projektantami, rzeczoznawcami i podwykonawcami, którym przekazujemy dane klientów (poza systemem) `[PRAWNIK/IOD]`.
7. Rejestr czynności przetwarzania uzupełniony o dane rejestrowe i czynności spoza systemu.
8. Rejestry żądań osób i naruszeń założone poza repozytorium (dysk firmy z ograniczonym dostępem).
9. Klauzule informacyjne opublikowane (SR-PRIV-05); procedura naruszeń przećwiczona (SR-PRIV-07).

## Realizacja praw osób (art. 15–22)
- **Kanał:** e-mail na adres kontaktowy w sprawach danych (do uzupełnienia) albo pisemnie na adres siedziby; zgłoszenie przekazane do osoby odpowiedzialnej.
- **Weryfikacja tożsamości:** porównanie z danymi, które już mamy (adres e-mail lub telefon z zlecenia, numer zlecenia, adres lokalizacji); nie żądamy kopii dokumentów tożsamości (minimalizacja); przy wątpliwościach — kontakt zwrotny na znany numer.
- **Termin:** bez zbędnej zwłoki, najpóźniej **1 miesiąc**; przedłużenie o 2 miesiące z uzasadnieniem przekazanym w pierwszym miesiącu (art. 12 ust. 3); bezpłatnie.
- **Rejestr żądań** (poza repozytorium): data, rodzaj, termin, decyzja, wykonane operacje (identyfikatory, bez danych).

| Prawo | Operacja w systemie | Kto | Uwagi i wyjątki |
|---|---|---|---|
| Art. 15 — dostęp i kopia | zestawienie danych osoby: dane klienta, lokalizacje, zlecenia (statusy, daty, płatności), wpisy o tej osobie, lista dokumentów i mediów; kopia — w MVP ręcznie z panelu + eksport ZIP mediów, w M4 funkcja eksportu (SR-DATA-09) | Administrator (step-up) | bez danych innych osób (redakcja fragmentów wpisów); czy kopia obejmuje wpisy audytu — `[PRAWNIK/IOD]` |
| Art. 16 — sprostowanie | edycja danych klienta, lokalizacji, strony | Administrator, Edytor | audyt zmiany (nazwy pól) |
| Art. 17 — usunięcie | ocena wyjątków (art. 17 ust. 3 lit. b — obowiązek prawny, lit. e — roszczenia); bez wyjątku: **anonimizacja** klienta i stron, **purge** mediów i dokumentów, **redakcja** treści wpisów; z wyjątkiem: ograniczenie (art. 18) do końca retencji | Administrator (step-up) | **wyjątek od append-only:** redakcja `TimelineEntry` i opisu medium oraz purge pliku przy zachowaniu rekordu (SR-PRIV-03); audyt, dziennik zmian i klucze idempotencji nie zawierają wartości danych; kopie zapasowe — do 37 dni, rejestr usunięć (RR-14) |
| Art. 18 — ograniczenie | soft delete (dane widoczne tylko dla Administratora, nieprzetwarzane w pracy biura i na telefonach) + wpis w rejestrze żądań | Administrator | zniesienie ograniczenia = przywrócenie |
| Art. 19 — powiadomienie odbiorców | lista odbiorców z dokumentów zlecenia (OSD, administracja); powiadomienie poza systemem | Administrator | |
| Art. 20 — przenoszenie | eksport danych dostarczonych przez osobę (klient, lokalizacja, zlecenia) w formacie JSON lub CSV | Administrator (step-up) | dotyczy danych przetwarzanych na podstawie umowy w sposób zautomatyzowany |
| Art. 21 — sprzeciw | przy przetwarzaniu na podstawie art. 6 ust. 1 lit. f (osoby kontaktowe, osoby trzecie na zdjęciach, dokumentacja po realizacji): ocena; bez nadrzędnych podstaw — anonimizacja albo redakcja | Administrator (step-up) | |
| Art. 22 — decyzje zautomatyzowane | nie stosujemy | — | |

- **Usuwanie danych w systemie** (z modelu EVM-002): **soft delete** — odwracalny, obiekt widoczny tylko dla Administratora; **purge** — nieodwracalne usunięcie wierszy i plików (z kotwicą); **anonimizacja** — zastąpienie danych wartościami neutralnymi przy zachowaniu struktury i statystyk; **redakcja** — zastąpienie treści wpisu lub pliku medium znacznikiem przy zachowaniu metadanych i kolejności.
- **Osoby trzecie na zdjęciach** (np. sąsiad, tablica rejestracyjna): purge konkretnego pliku z zachowaniem rekordu (w MVP bez narzędzia do rozmywania).
- **Pracownicy:** te same prawa; po odejściu — anonimizacja konta po 2 latach (P4).

## Obowiązek informacyjny
Punkty klauzul (treść końcową przygotowuje prawnik — `[PRAWNIK/IOD]`):
- **Klienci** (art. 13 — przy ofercie lub umowie): administrator i kontakt; cele i podstawy (umowa, procesy z OSD i administracją jako pełnomocnik, dokumentacja fotograficzna, rozliczenia, roszczenia); odbiorcy (OSD, administracje i wspólnoty, projektanci, rzeczoznawcy, podwykonawcy, dostawcy IT z UE — Hetzner, Scaleway; telemetria po redakcji — Sentry, Grafana Labs, spółki z USA z regionem UE); transfery i ich podstawy; okresy (P4, w tym kopie zapasowe); prawa i skarga do Prezesa UODO; podanie danych wymagane do zawarcia umowy; brak profilowania.
- **Osoby kontaktowe stron** (art. 14 — przy pierwszym kontakcie, np. w stopce e-maila): źródło danych, kategorie (imię i nazwisko, telefon, e-mail), cel (kontakt w sprawie zlecenia), podstawa (art. 6 ust. 1 lit. f), okres (2 lata od ostatniego zlecenia), prawa, w tym sprzeciw.
- **Osoby trzecie na zdjęciach:** unikamy utrwalania (instrukcja dla techników — SR-PRIV-10); informacja ogólna na stronie firmy; ocena wyjątku z art. 14 ust. 5 lit. b `[PRAWNIK/IOD]`.
- **Pracownicy i BYOD:** zakres danych (konto, logowania, IP, urządzenie, audyt działań), cele (dostęp, bezpieczeństwo, rozliczalność), podstawy, okresy, co aplikacja robi na prywatnym telefonie i czego nie robi (bez lokalizacji, kontaktów, galerii; telemetria bez danych osobowych), czyszczenie danych firmowych, obowiązki pracownika (blokada ekranu, aktualizacje, zgłoszenie utraty — P7). Regulamin BYOD do zaakceptowania przez pracownika `[PRAWNIK/IOD]`.
- **W systemie:** link do klauzuli w panelu i w aplikacji, opis w deklaracji „Bezpieczeństwo danych” w Google Play (SR-PRIV-05, SR-MOB-12).

## Privacy by design i wstępna ocena DPIA
**Wbudowane środki (art. 25)**
- Minimalizacja: brak pól PESEL, numerów dokumentów, dat urodzenia, kodów do bram; dane osobowe tylko w typowanych kolumnach; projekcja pól na telefon bez płatności, PPE, e-maili, NIP i plików dokumentów; brak GPS (P3).
- Pseudonimizacja: logi i telemetria z identyfikatorami UUID i prefiksem IP (P9); audyt bez wartości danych; dane syntetyczne w testach i na staging.
- Ochrona: TLS, LUKS, SSE, szyfrowane kopie, SQLCipher na telefonach; MFA dla wszystkich (P1); autoryzacja obiektowa deny-by-default; audyt operacji wrażliwych; limity i alerty masowych pobrań (P10).
- Retencja automatyczna (P4) i procedury usuwania (anonimizacja, redakcja, purge) zaprojektowane w modelu od początku.
- Region UE dla danych klientów; podmioty z USA tylko dla telemetrii po redakcji i kodu.

**Wstępna ocena potrzeby DPIA (art. 35)** — kryteria z wytycznych WP248 (EROD):
| Kryterium | Ocena |
|---|---|
| Ocena lub scoring | nie |
| Zautomatyzowane decyzje o skutkach prawnych | nie |
| Systematyczne monitorowanie | nie — brak lokalizacji; audyt bezpieczeństwa nie służy ocenie pracy `[PRAWNIK/IOD]` |
| Dane wrażliwe lub o charakterze wysoce osobistym | **częściowo** — PESEL i dokumenty tożsamości w dokumentach; zdjęcia wnętrz domów i garaży |
| Duża skala | nie — jedna firma, setki–tysiące klientów |
| Łączenie zbiorów danych | nie |
| Osoby szczególnie wymagające ochrony (w tym pracownicy — nierównowaga stron) | **częściowo** — aplikacja na prywatnych telefonach pracowników |
| Innowacyjne technologie | nie |
| Uniemożliwienie korzystania z prawa lub usługi | nie |

**Wniosek:** dwa kryteria są spełnione częściowo — wg WP248 przy dwóch kryteriach DPIA jest zwykle wymagana. **Rekomendacja:** uproszczona DPIA przed startem produkcyjnym (E8), oparta na tym dokumencie i [modelu zagrożeń](threat-model.md); sprawdzić także wykaz rodzajów operacji wymagających DPIA ogłoszony przez Prezesa UODO. `[PRAWNIK/IOD]`

## Procedura naruszeń (72 h)
Dotyczy każdego naruszenia bezpieczeństwa prowadzącego do przypadkowego lub niezgodnego z prawem zniszczenia, utraty, modyfikacji, ujawnienia lub dostępu do danych osobowych — także utraty dostępności (np. ransomware). Prowadzi: Konrad (albo wskazana osoba odpowiedzialna); wsparcie techniczne: `security-engineer` i `devops-engineer` (runbooki EVM-007).

| Krok | Termin | Co robimy |
|---|---|---|
| 1. Wykrycie i zgłoszenie wewnętrzne | od razu | źródła: alerty (ADR-0013), zgłoszenie pracownika (np. zgubiony telefon — P7), powiadomienie od podmiotu przetwarzającego, sygnał od klienta; zgłoszenie telefonicznie do prowadzącego; **T0** = chwila, gdy z rozsądną pewnością wiemy o naruszeniu |
| 2. Ograniczenie skutków | w ciągu godzin od T0 | unieważnienie sesji i urządzeń („Zablokuj i wyczyść” — P2), zmiana haseł, rotacja kluczy (runbook), zablokowanie klucza lub bucketu, odcięcie wersji aplikacji (`426`), wyłączenie funkcji; **zabezpieczenie dowodów** — eksport logów lokalnych przed rotacją (7 dni), audyt, metryki |
| 3. Ocena ryzyka dla osób | do T0 + 48 h | jakie dane i kategorie (np. `identity_data`), ile osób, czy dane były zaszyfrowane i klucz bezpieczny, możliwe skutki (kradzież tożsamości, szkoda majątkowa, naruszenie prywatności domu); wynik: brak ryzyka / ryzyko / wysokie ryzyko; podstawa: wytyczne EROD 9/2022 i przykłady z wytycznych 01/2021 `[PRAWNIK/IOD]` |
| 4. Zgłoszenie do Prezesa UODO | **≤ 72 h od T0**, gdy naruszenie może powodować ryzyko | formularz elektroniczny UODO; zgłoszenie można uzupełniać etapami (art. 33 ust. 4); zgłoszenie po 72 h — z wyjaśnieniem opóźnienia |
| 5. Zawiadomienie osób | bez zbędnej zwłoki, gdy ryzyko jest wysokie | prostym językiem: co się stało, możliwe skutki, podjęte środki, co osoba może zrobić, kontakt; wyjątki z art. 34 ust. 3 (np. dane zaszyfrowane, a klucz bezpieczny) `[PRAWNIK/IOD]` |
| 6. Rejestr naruszeń | każde naruszenie, także niezgłoszone | fakty, skutki, działania, uzasadnienie decyzji o zgłoszeniu lub braku zgłoszenia (art. 33 ust. 5); **prowadzony poza repozytorium** (dysk firmy z ograniczonym dostępem) |
| 7. Wnioski | do 2 tygodni | analiza przyczyn, poprawki (historyjki), aktualizacja [modelu zagrożeń](threat-model.md#9-aktualizacja-modelu) |

- **Podmioty przetwarzające** powiadamiają nas bez zbędnej zwłoki (obowiązek z umów powierzenia). Kontakty bezpieczeństwa dostawców (Hetzner, Scaleway, Sentry, Grafana Labs, GitHub, Expo, Google) i dane do formularza UODO trzymamy w dokumencie operacyjnym **poza systemem**, dostępnym także przy awarii systemu (E8).
- **Przykłady oceny:** zgubiony telefon z blokadą ekranu i aktualnym systemem — zwykle wpis w rejestrze bez zgłoszenia (dane zaszyfrowane, urządzenie wyczyszczone po połączeniu), przy telefonie bez blokady albo ze znanym PIN-em — ocena ryzyka; wyciek podpisanego URL-a do pojedynczego pliku — ocena treści pliku; masowe pobranie przez byłego pracownika — zwykle zgłoszenie i zawiadomienie osób; ransomware z odtworzeniem z kopii bez wycieku — ocena dostępności i ewentualne zgłoszenie. `[PRAWNIK/IOD]`
- **Ćwiczenie** (tabletop) przed produkcją — SR-PRIV-07.

## Szkic rejestru czynności przetwarzania (art. 30)
Rejestr jest wymagany mimo zatrudnienia poniżej 250 osób, bo przetwarzanie ma charakter stały (art. 30 ust. 5). Szkic obejmuje czynności związane z systemem; czynności spoza systemu (kadry, księgowość, poczta firmowa) uzupełnia firma `[PRAWNIK/IOD]`. Administrator i kontakt — [dane rejestrowe](#administrator-danych-i-role-podmiotów). Środki techniczne i organizacyjne (art. 32) dla wszystkich czynności: [`requirements.md`](requirements.md) i [`policies.md`](policies.md).

| # | Czynność | Cel | Podstawa | Kategorie osób | Kategorie danych | Odbiorcy | Transfer poza EOG | Okres |
|---|---|---|---|---|---|---|---|---|
| 1 | Obsługa zleceń klientów (oferta, realizacja, odbiór) | realizacja umowy | art. 6 ust. 1 lit. b | klienci, osoby kontaktowe klientów | dane identyfikacyjne i kontaktowe, adres i dane lokalizacji, PPE, parametry instalacji, wpisy | pracownicy wg ról; Hetzner, Scaleway (powierzenie) | nie | 6 lat od końca roku zamknięcia; anulowane przed akceptacją — 12 mies. |
| 2 | Dokumentacja fotograficzna i filmowa prac | realizacja umowy, dowód wykonania | lit. b, lit. f | klienci, osoby trzecie (przypadkowo), pracownicy (autorzy) | zdjęcia i filmy, opisy, metadane | pracownicy wg ról; Hetzner, Scaleway | nie | jak 1 |
| 3 | Procesy formalne z OSD i administracją | reprezentacja klienta w uzyskaniu warunków przyłączenia i zgód | lit. b `[PRAWNIK/IOD]` | klienci | dokumenty z PESEL, numerem dowodu i podpisem; dane lokalizacji | OSD, administracje i wspólnoty (odrębni administratorzy); Hetzner, Scaleway | nie | jak 1 |
| 4 | Rozliczenia etapowe | rozliczenie umowy, kontrola należności | lit. b, lit. c | klienci | kwoty, numery faktur, terminy, statusy | pracownicy wg ról (w tym Tylko odczyt — P6); system fakturowy (poza systemem) | nie | jak 1 |
| 5 | Kontakty ze stronami procesu | kontakt w sprawie zlecenia | lit. f | osoby kontaktowe i osoby fizyczne będące stronami | imię i nazwisko, telefon, e-mail, notatki | pracownicy | nie | 2 lata od ostatniego zlecenia |
| 6 | Konta pracowników i bezpieczeństwo systemu | dostęp, rozliczalność, ochrona przed nadużyciami | lit. b, lit. c (art. 32), lit. f `[PRAWNIK/IOD]` | pracownicy i współpracownicy | e-mail, nazwa, rola, sesje, IP (P9), urządzenia, audyt działań | Administrator; Hetzner, Scaleway; Sentry, Grafana Labs (dane pseudonimowe) | Sentry, Grafana Labs — możliwy dostęp z USA (SCC/DPF) | konto 2 lata po dezaktywacji; audyt 2 lata; sesje 30 dni; logi 7–30 dni |
| 7 | Aplikacja mobilna na urządzeniach pracowników (BYOD) | praca w terenie offline | lit. f `[PRAWNIK/IOD]` | pracownicy | model telefonu, wersje, poziom poprawek, czasy kontaktu; projekcja danych klientów na urządzeniu | Administrator | nie | urządzenia 90 dni po unieważnieniu albo ostatnim kontakcie; dane na telefonie wg P4 |
| 8 | Obsługa żądań osób i naruszeń | realizacja obowiązków z RODO | lit. c | wnioskodawcy, osoby dotknięte naruszeniem | dane wnioskodawcy, opis sprawy | osoba odpowiedzialna; Prezes UODO (zgłoszenia) | nie | 5 lat od zamknięcia sprawy `[PRAWNIK/IOD]` |

## Punkty do konsultacji z prawnikiem lub IOD
1. Role OSD, administracji, wspólnot, projektantów, rzeczoznawców i podwykonawców (odrębni administratorzy czy podmioty przetwarzające) oraz potrzebne umowy.
2. Brak obowiązku wyznaczenia IOD (art. 37).
3. Podstawa przetwarzania PESEL i danych dokumentów w pełnomocnictwach i wnioskach do OSD.
4. Podstawy dla rozliczeń (obowiązki podatkowe) i dla dokumentacji po realizacji (roszczenia).
5. Podstawa przetwarzania danych pracowników w systemie i w aplikacji BYOD; regulamin BYOD.
6. Okresy retencji: 6 lat dla zleceń, 12 miesięcy dla zleceń anulowanych przed akceptacją, 2 lata dla kont pracowników po dezaktywacji, 5 lat dla rejestrów żądań i naruszeń.
7. Kopie zapasowe a prawo do usunięcia (do 37 dni) i informacja o tym w klauzuli.
8. Zakres kopii danych z art. 15 (np. wpisy audytu).
9. Ocena art. 9 (przypadkowe dane na zdjęciach) i wyjątku z art. 14 ust. 5 lit. b dla osób trzecich na zdjęciach.
10. Transfery do USA (Sentry, Grafana Labs, GitHub, Expo, Google): DPF albo SCC, ocena skutków transferu.
11. Potrzeba DPIA (dwa kryteria WP248 częściowo) i wykaz UODO.
12. Metodyka oceny ryzyka naruszeń, przykłady progów zgłoszenia i zawiadomienia osób.
13. Czynności spoza systemu w rejestrze (poczta firmowa, księgowość, kadry).
14. Treść klauzul informacyjnych (klienci, osoby kontaktowe, pracownicy, BYOD).
