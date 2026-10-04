---
id: EVM-069
title: ADR — model odczytu listy i podsumowania zlecenia
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: solution-architect
contributors: []
reviewers: [security-engineer, backend-developer]
depends_on: [EVM-002]
---

# EVM-069: ADR — model odczytu listy i podsumowania zlecenia

## Historyjka
Jako **zespół backendu** chcemy **decyzji architektonicznej, jak lista zleceń i karta podsumowania pokazują i sortują dane z modułów `procedures` i `payments`**, aby **EVM-034 i EVM-056 dało się zrealizować bez łamania granic modułów, z autoryzacją w zapytaniu i w wymaganym czasie odpowiedzi**.

## Kontekst
- Luka L3 z EVM-004 (`scenariusze-a-d.md`) i uwaga 5 EVM-004: kolumny „Czekamy na”, „Termin”, „Płatność”, sortowanie „Najpilniejsze” i kafle W-06 wymagają danych z `procedures` i `payments`, a `work-orders` od nich nie zależy.
- Reguła 2 z ADR-0001: moduły nie robią joinów do cudzych tabel — więc nie mogą też sortować ani filtrować między sobą.
- Konsultacja `solution-architect` (EVM-010, W1): warianty do oceny i wstępna rekomendacja (a).

## Kryteria akceptacji
**AC1 — Ocena wariantów**
- Zakładając warianty: (a) projekcja `work_order_summaries` w nowym module odczytu, aktualizowana w tej samej transakcji przez handlery zdarzeń w procesie, wyłącznie z ID, kodami, datami i kwotami (bez danych osobowych), z poleceniem przebudowy; (b) widok SQL w schemacie odczytu (wyjątek od ADR-0001); (c) składanie z fasad przez listy ID (tylko filtry, bez sortowania między modułami)
- Gdy czytam ADR w `docs/architecture/adr/`
- Wtedy każdy wariant jest oceniony wg kryteriów: zgodność z ADR-0001, autoryzacja warunkiem w zapytaniu (SR-AUTHZ-03), p95 < 300 ms przy 10 tys. syntetycznych zleceń, spójność z zapisem, brak danych osobowych, możliwość przebudowy, wpływ na synchronizację w M2 — z rekomendacją i konsekwencjami.

**AC2 — Definicje wyliczeń**
- Wtedy ADR definiuje źródło i regułę dla: „Najpilniejsze”, „Najdłużej czekamy”, „Termin”, „Czekamy na [klient / rodzaj strony] dłużej niż X dni”, „Po terminie” (liczone w zapytaniu z daty `Europe/Warsaw`, niezapisywane), „Nieopłacone”, kolumny „Płatność” i kafli „Na jakim etapie”, „Na kogo czekamy”, „Terminy”, „Płatności” w W-06.

**AC3 — Kontrakt**
- Wtedy ADR opisuje rozszerzenie listy z EVM-017 wyłącznie addytywnie: nowe wartości rozszerzalnych enumów `sort` i filtrów oraz nowe pola listy i podsumowania (oasdiff bez zmian łamiących).

**AC4 — Plan testów**
- Wtedy ADR wskazuje testy: wydajność przy 10 tys. zleceń, licznik zapytań (brak N+1), polityka w zapytaniu (wiersz spoza uprawnień nie wpływa na wynik ani sortowanie), spójność po błędzie transakcji, przebudowa projekcji (jeśli wariant (a)).

**AC5 — Wpływ na backlog i model**
- Wtedy ADR wskazuje zmiany w `domain-model.md` (np. nowy moduł odczytu i własność tabel) oraz w „Notatkach technicznych” EVM-034 i EVM-056, a ADR-0001 dostaje adnotację tylko wtedy, gdy rekomendacją jest wariant (b).

**AC6 — Akceptacja**
- Wtedy ADR ma przeglądy `security-engineer` i `backend-developer` (APPROVE) i decyzję Konrada (`/adr`), zapisaną w „Decyzje”.

## Poza zakresem
Implementacja (EVM-034, EVM-056). Raporty i pulpit (M3/M4).

## UX / UI
Nie dotyczy (wejście: W-06 i W-10 z EVM-004).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (dokument) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

Wymagania do oceny: SR-AUTHZ-03 (polityka w zapytaniu), SR-DATA-01 (projekcja bez danych osobowych), SR-API-04 (filtry bez danych osobowych w URL).

## Notatki techniczne
- Wstępna rekomendacja architekta: wariant (a).
- Termin: przed EVM-034 (faza 3). Może powstać równolegle z fazami 0–2 (praca koncepcyjna).

## Plan techniczny
_solution-architect, 2026-10-04._ Historyjka dokumentacyjna (enabler): bez kodu, bez kontraktu OpenAPI, bez migracji, bez nowych usług w `compose.yaml` i bez pomiaru na żywej bazie (PostgreSQL w kontenerze wchodzi w EVM-008). Baza porównania: `feature/EVM-006-repo-i-ci` (gałąź ułożona na PR #2) — `git diff feature/EVM-006-repo-i-ci...HEAD`. Numer ADR: **0017**. AC1–AC5 weryfikujemy inspekcją (QA) i przeglądami `security-engineer` i `backend-developer` (AC6). Decyzję Konrada (`/adr`, AC6) QA oznacza jako `manual` — zapadnie rano.

### 1. Zakres zmian (pliki)
| Plik | Zmiana | AC |
|---|---|---|
| `docs/architecture/adr/0017-model-odczytu-listy-i-podsumowania-zlecenia.md` | **nowy** (trwały) wg `0000-template.md`, status **Proponowana**. Treść: kontekst (luka L3, reguła 2 ADR-0001); kryteria z wagami (7 kryteriów z AC1 + prostota utrzymania, testowalność, ewolucja M3/M4); warianty (a), (b) w dwóch postaciach — (b1) widok SQL w schemacie odczytu, (b2) zapytanie składane z fragmentów publikowanych przez moduły-właścicieli — oraz (c); tabela ocen, decyzja, definicje wyliczeń, kontrakt, plan testów, wpływ na backlog i model, konsekwencje, plan wyjścia, weryfikacja, źródła | AC1–AC5 |
| `docs/architecture/adr/README.md` | wiersz 0017 (Proponowana, 2026-10-04) | DoD |
| `docs/architecture/domain-model.md` | 1) „Moduły i własność tabel”: wiersz modułu odczytu `overview` (schemat `overview`, projekcje `WorkOrderSummary` i `WorkOrderWait`; zależy od `work-orders`, `procedures`, `payments` i `parties` przez fasady i zdarzenia), oznaczony „proponowany — ADR-0017”; 2) „Zasady”: punkt o projekcji (ta sama transakcja, przeliczenie z fasad, bez danych osobowych, przebudowa, poza synchronizacją) z odnośnikiem do definicji wyliczeń w ADR; 3) wiersz projekcji w „Klasyfikacji danych” (SR-DATA-01) i w „Gotowości offline” (poza urządzeniem). ERD bez zmian — projekcja nie jest encją domenową, a ERD opisuje model zapisu | AC5 |
| `docs/backlog/M1/EVM-034-…md`, `docs/backlog/M1/EVM-056-…md` | wyłącznie „Notatki techniczne”: zakres wg ADR-0017 (kto tworzy moduł i które sygnały, przeniesienie listy i wyszukiwania, testy z AC4 ADR). AC tych historyjek bez zmian | AC5 |
| `CHANGELOG.md` | „Unreleased → Dodano”: ADR-0017 (Proponowana) [EVM-069] | DoD projektu |
| ten plik | plan; „Decyzje” — pytania na rano z rekomendacjami; „Dziennik”; DoD | — |

Bez zmian: ADR-0001 (adnotacja tylko przy rekomendacji (b), a wstępna rekomendacja to (a)), `docs/architecture/README.md` (mapę modułów zaktualizuje historyjka, która tworzy moduł — wskazane w ADR), `api-guidelines.md`, `offline-sync.md`, styleguide, `compose.yaml`, kod i `tools/`.

### 2. Rdzeń decyzji (do rozwinięcia w ADR; wstępna rekomendacja (a) potwierdzona analizą)
- **Rozdzielenie odczytów.** Lista i wyszukiwanie (W-10) sortują i filtrują dane z kilku modułów — dlatego korzystają z projekcji. Podsumowanie W-06 dotyczy jednego zlecenia i nie potrzebuje projekcji: SPA składa kafle z zasobów zakotwiczonych w zleceniu (procesy z etapami — EVM-031/032, transze — EVM-053; zasada wspólna M1). Wartości zależne od daty (`isOverdue`, dni oczekiwania, dni po terminie) i bieżący etap procesu serwer liczy ze wstrzykiwanego zegara `Europe/Warsaw` i zwraca jako pola tylko do odczytu tych zasobów. Każdy kafel ma własne źródło danych, więc błąd jednego źródła daje „alert w kaflu”, a pozostałe kafle działają (EVM-034 AC8, EVM-056 AC8).
- **Moduł odczytu `overview`** (nazwa robocza, schemat `overview`). Zależy od `work-orders`, `procedures`, `payments` i `parties` (fasady i zdarzenia); żaden moduł nie zależy od niego. To wzorzec konsumenta z reguły 4 ADR-0001, bez SQL do cudzych tabel.
- **Projekcja przechowuje tylko klucze filtrów i sortowań** oraz dane kolumn, które inaczej wymagałyby dodatkowego zapytania: identyfikatory, kody, daty, liczniki i kwoty. **Bez nazw, tytułów, pól swobodnych i danych kontaktowych** (SR-DATA-01). Tabele:
  - `work_order_summaries` (wiersz na zlecenie): kopie kluczy listy z `work-orders` (`number`, `status`, `created_at`, `deleted_at`, opiekun, `customer_id`, `site_id`, `source_template_id`); najdłuższe oczekiwanie (od kiedy, na kogo — rodzaj i ID strony — oraz liczba oczekiwań); najbliższy termin niezakończonego etapu; sygnały płatności (liczba i suma wystawionych, najwcześniejszy termin wystawionej, liczba opłaconych i płatnych);
  - `work_order_waits` (wiersz na etap w `waiting`): filtr „czekamy na [klient / rodzaj strony] > X dni”.
  Wartości wyświetlane spoza projekcji (tytuł, nazwy opiekuna i stron, kwota po terminie) pobieramy przez fasady raz na stronę, stałą liczbą zapytań.
- **Aktualizacja w tej samej transakcji.** Handlery zdarzeń w procesie (mechanizm z EVM-038) oznaczają zlecenie jako „do przeliczenia”. Przed zatwierdzeniem transakcji `overview` przelicza cały wiersz z fasad — bez przyrostów, więc idempotentnie i niezależnie od kolejności zdarzeń. Przeliczenie działa pod blokadą wiersza projekcji (`SELECT … FOR UPDATE`, kolejność wg `work_order_id`), dzięki czemu współbieżne zmiany dwóch etapów jednego zlecenia się nie gubią (READ COMMITTED). Wycofanie transakcji wycofuje też projekcję.
- **Przebudowa.** Polecenie CLI w procesie `worker`, działające partiami i bez wyłączania systemu: `rebuild` oraz `verify` (raport rozbieżności — liczby i UUID, bez danych). `verify` działa też nocą jako zadanie pg-boss z metryką i alertem (ADR-0013). Handlery i przebudowa używają tej samej funkcji przeliczenia.
- **Polityka w zapytaniu (SR-AUTHZ-03).** Predykat polityki `workOrder.read` działa na kolumnach projekcji (w v1 `deleted_at`, w M4 rozszerzenie o przypisania Montera) w tym samym zapytaniu co filtr, sortowanie i kursor. „+n” i sumy liczymy per zlecenie (kotwica), więc wiersz spoza uprawnień nie zmienia wyniku, kolejności ani granic stron.
- **Synchronizacja M2.** Projekcja istnieje tylko na serwerze — jest poza zakresem urządzenia i bez triggerów `SyncChange`. Komendy z telefonu (`CreateQuickWorkOrder`, po MVP `UpdateStageStatus`) przechodzą tą samą ścieżką komend domenowych, więc projekcja zostaje aktualna. Telefon liczy „Czekamy na…” lokalnie według tych samych definicji (szczegóły — E10).
- **Wydajność — ocena analityczna, bez benchmarku.**
  - Odczyt listy: jedna wąska tabela (~10 tys. wierszy ≈ 1–2 MB, mieści się w pamięci) + filtr + top-N z `LIMIT`. Szacunek: rząd 10 ms w bazie, ≤ 6 zapytań na stronę.
  - Zapis: na transakcję dochodzi 1 blokada i 3–4 krótkie zapytania.
  - „Najpilniejsze” liczymy z parametrem `:today`, bez indeksu na wyrażeniu — wystarcza do ~100 tys. zleceń.
  - Pomiar p95 robimy w EVM-034 AC6 i EVM-056 AC6 według planu testów w ADR. Pomiar przed decyzją nie jest konieczny (pytanie 5).
- **Wstępna ocena wariantów:**
  - (c) odpada — nie pozwala sortować między modułami, a wymagają tego EVM-034 AC4 i EVM-056 AC3;
  - (b1) łamie regułę 2: jeden autor pisze SQL do tabel czterech modułów, a migracje się sprzęgają; wymagałby adnotacji w ADR-0001;
  - (b2) zachowuje własność SQL, ale wprowadza zapytania przez kilka schematów i mniej przewidywalny czas (agregacje przy każdym żądaniu) — to plan wyjścia dla (a);
  - (a) ma najlepszą ocenę ważoną, mimo większego kosztu wdrożenia (ryzyko R8).

### 3. Definicje wyliczeń (AC2) — szkic do ADR
„Dziś” to data w `Europe/Warsaw` ze wstrzykiwanego zegara. Przekazujemy ją do zapytania parametrem `:today` (nie `now()` w SQL); niczego zależnego od daty nie zapisujemy. Etap **niezakończony** = `todo`, `in_progress`, `waiting`, `blocked` (rekomendacja — pytanie 2).

| Wyliczenie | Źródło | Reguła |
|---|---|---|
| Czekamy na [klient / rodzaj strony] dłużej niż X dni | `work_order_waits` | etap `waiting` z `waitingOn = customer` albo ze stroną rodzaju K; `waitingSince < :today − X`; X ∈ 1–365 |
| kolumna „Czekamy na” | projekcja + nazwy stron z `parties` (wsadowo) | najdłuższe oczekiwanie (remis: kolejność procesu i etapu); „od N dni”, gdzie N = `:today − waitingSince`; `triangle-alert` dla N > 14; „+n” = pozostałe oczekiwania |
| Najdłużej czekamy | projekcja | `longest_waiting_since` rosnąco, zlecenia bez oczekiwań na końcu, remis `id` |
| Termin | projekcja | min `dueDate` niezakończonych etapów, rosnąco, puste na końcu; `alarm-clock`, gdy termin < `:today` |
| Po terminie (etap / transza) | projekcja / zasoby W-06 | etap niezakończony z `dueDate < :today`; transza `invoiced` z `dueDate < :today` (`isOverdue`, D5) |
| Nieopłacone | projekcja | ≥ 1 transza `invoiced` (także po terminie) |
| kolumna „Płatność” | projekcja + suma po terminie z `payments` (wsadowo) | pierwszy pasujący stan: 1) „Po terminie” z sumą transz po terminie; 2) „Nieopłacone (n)” z sumą wystawionych; 3) „Opłacone” — brak wystawionych, ≥ 1 opłacona; 4) „—” |
| Najpilniejsze | projekcja + `:today` | grupy: 1) transza lub etap po terminie — od najstarszego terminu; 2) najdłuższe oczekiwanie > 14 dni — od najdłuższego; 3) najbliższy termin etapu rosnąco; 4) pozostałe. Sygnały liczymy tylko dla zleceń niezamkniętych; remis `id` |
| kafle W-06 | zasoby zlecenia (procesy z etapami, transze) | „Na jakim etapie”: procesy z niezakończonym etapem wg `position`; bieżący etap = pierwszy niezakończony; maks. 3 procesy + „+ n procesów”. „Na kogo czekamy”: wszystkie etapy `waiting` od najdłuższego oczekiwania; gdy brak — „Piłka po naszej stronie…”. „Terminy”: najbliższy termin ≥ dziś + etapy po terminie. „Płatności”: nieopłacone (suma, liczba), po terminie (dni od najstarszego terminu), planowane, „Opłacone: x z y” (bez anulowanych) |

Postęp procesu (styleguide 1.2.0 § 3.23, P-6) nie należy do AC2. ADR odnotowuje tylko zależność od decyzji Konrada z EVM-014 („Nie dotyczy” poza mianownikiem), bez jej rozstrzygania.

### 4. Kontrakt API (AC3) — opis w ADR; kontrakt powstaje w EVM-034 i EVM-056
- **`GET /api/v1/work-orders` i `POST /api/v1/work-orders/search`** (EVM-017, EVM-072):
  - nowe wartości enumów żądania: `sort` (`urgency`, `longestWaitingSince`, `nextDueDate` — nazwy do potwierdzenia w ADR) i `view` (Czekamy na OSD > 14 dni, Po terminie, Nieopłacone);
  - nowe parametry filtra: rodzaj oczekiwania (klient albo rodzaj strony) i `waitingLongerThanDays` (1–365);
  - oasdiff klasyfikuje dodanie wartości enumu żądania (`request-parameter-enum-value-added`) jako INFO, czyli zmianę niełamiącą;
  - w URL są tylko kody i liczby (SR-API-04);
  - kursor wiąże `asOf` (datę „dziś” pierwszej strony), więc zmiana dnia nie miesza stron.
- **Nowe pola.** Element listy dostaje opcjonalne pola `waiting`, `nextDueDate` i `payment`. Zasoby W-06 dostają pola tylko do odczytu: `ProcedureStage.isOverdue`, dni oczekiwania, bieżący etap procesu, `PaymentMilestone.isOverdue` i dni po terminie.
- **Nowe wartości enumów w odpowiedziach.** oasdiff traktuje nową wartość enumu w odpowiedzi jako zmianę łamiącą (`response-property-enum-value-added`, poziom error), chyba że enum zadeklarowano jako `x-extensible-enum`. ADR wymaga tej deklaracji dla nowych enumów odpowiedzi i przekazuje konwencję do EVM-008 (`api-guidelines.md` jej nie opisuje).
- **Bez nowych operacji** — W-06 nie dostaje osobnego endpointu podsumowania. `x-evia-authz` istniejących operacji zmienia się tylko o nowe parametry.

### 5. Migracje
W tej historyjce brak migracji. ADR opisuje migracje EVM-034 i EVM-056, wyłącznie typu *expand*:
- nowy schemat `overview` z tabelami i indeksami (np. `(waiting_on, party_kind, waiting_since)` na oczekiwaniach);
- uprawnienia: `evia_app` — DML; `evia_readonly` — brak;
- bez triggera `SyncChange`;
- klucz obcy do `work_orders` z `ON DELETE CASCADE` (purge);
- wypełnienie tabel poleceniem przebudowy (przed produkcją nie ma danych realnych — zasada wspólna M1).

Plan wyjścia (*contract*): usunięcie schematu po przejściu na (b2).

### 6. Plan weryfikacji AC (inspekcja)
| AC | Jak sprawdzić |
|---|---|
| AC1 | ADR ma warianty (a), (b) (b1, b2) i (c). Tabela ocen obejmuje 7 kryteriów z AC1 (plus dodatkowe z wagami) dla każdego wariantu. Jest rekomendacja, konsekwencje (pozytywne, negatywne, ryzyka z mitygacją) i plan wyjścia. Wartości wydajności są oznaczone jako szacunek analityczny z założeniami |
| AC2 | Każda z 12 pozycji z AC2 (Najpilniejsze, Najdłużej czekamy, Termin, Czekamy na > X dni, Po terminie, Nieopłacone, kolumna „Płatność”, 4 kafle) ma źródło i regułę. „Po terminie” liczy się w zapytaniu z `:today` (`Europe/Warsaw`) i nie jest zapisywane. Reguły są zgodne z W-06, W-10, styleguide'em (§ 4.2, § 4.4) i przykładami z AC EVM-034 i EVM-056 — sprawdzone daty: 2026-09-18 przy X = 14 i X = 15; 2026-10-07 i 2026-10-08 |
| AC3 | Zmiany kontraktu są wyłącznie addytywne: nowe wartości enumów żądania, nowe pola opcjonalne lub tylko do odczytu. Enumy odpowiedzi mają `x-extensible-enum`. Żadne pole ani kod błędu nie jest usunięty ani zmieniony. Parametry URL nie zawierają danych osobowych |
| AC4 | ADR wymienia testy: (1) wydajność — generator 10 tys. zleceń z etapami i transzami, p95 < 300 ms dla każdego sortowania i widoku; (2) licznik zapytań — ta sama liczba przy 1 i 100 wierszach; (3) polityka w zapytaniu — usunięte zlecenie z najsilniejszym sygnałem nie zmienia wyników, kolejności, „+n”, sum ani granic stron; (4) spójność po błędzie transakcji — wycofanie; (5) współbieżność — dwa etapy jednego zlecenia; (6) przebudowa i `verify`, także przy równoległym zapisie; (7) granice dat — X dni, po terminie, zmiana czasu 2026-10-25 |
| AC5 | ADR wskazuje zmiany w `domain-model.md` i w notatkach EVM-034 i EVM-056, a zmiany są wprowadzone — `git diff feature/EVM-006-repo-i-ci...HEAD` pokazuje tylko wskazane sekcje. ADR-0001 bez zmian (rekomendacja (a)) |
| AC6 | Przeglądy `security-engineer` i `backend-developer` w tym workflow kończą się APPROVE. Decyzja Konrada (`/adr`) — **manual** (rano), z wpisem w „Decyzje” |
| Bramki | `npm run docs:check` — 0 błędów; `npm run test:tools` i `pnpm run gate` — zielone (zmieniamy tylko dokumenty). Diagramy Mermaid wyłącznie w składni używanej już w repozytorium (`flowchart LR`, `sequenceDiagram` z `autonumber` i `alt`) |

### 7. Kolejność kroków
1. Weryfikacja w sieci (z datą i źródłami w ADR): semantyka READ COMMITTED i `SELECT … FOR UPDATE` w PostgreSQL 18; porównanie wierszy w paginacji keyset; indeksy częściowe; widoki `security_invoker` / `security_barrier` (dla (b1)); reguły oasdiff dla enumów (żądanie, odpowiedź, `x-extensible-enum`).
2. ADR-0017 w kolejności: kontekst → kryteria i wagi → warianty → ocena (z szacunkiem wydajności) → decyzja → definicje (AC2) → kontrakt (AC3) → plan testów (AC4) → wpływ na backlog i model (AC5) → konsekwencje, plan wyjścia, weryfikacja. Diagramy: zależności i przepływ zapisu (`flowchart LR`) oraz przeliczenie w transakcji (`sequenceDiagram`).
3. Indeks ADR, `domain-model.md`, notatki EVM-034 i EVM-056, `CHANGELOG.md`.
4. „Decyzje” w tej historyjce — pytania na rano z rekomendacjami (p. 8); wpis w „Dzienniku”.
5. Samosprawdzenie według tabeli z p. 6; `npm run docs:check`, `npm run test:tools`, `pnpm run gate`.
6. Przeglądy:
   - `security-engineer`: SR-AUTHZ-03, SR-DATA-01, SR-API-04, polecenie przebudowy;
   - `backend-developer`: wykonalność w NestJS i Kysely, blokady, handlery w procesie, przeniesienie listy.

### 8. Pytania do Konrada (rano — trafią do „Decyzji” z rekomendacją; nie blokują ADR)
1. **Wariant:** (a) — projekcja w module `overview`. *Rekomendacja: tak* (decyzja na `/adr`).
2. **Etap „Zablokowany” w wyliczeniach** (bieżący etap, „Termin”, „Po terminie”) traktujemy jak niezakończony. *Rekomendacja: tak* — termin nadal obowiązuje. Konsekwencja: „otwarty etap” w EVM-034 AC4 czytamy jako „niezakończony” (dopisek w notatkach EVM-034).
3. **„Najpilniejsze” — grupy jak w p. 3:** transza **lub** etap po terminie; próg oczekiwania 14 dni (jak `triangle-alert`, stała w konfiguracji); trzecia grupa — tylko terminy etapów; sygnały tylko dla zleceń niezamkniętych. *Rekomendacja: tak.*
4. **Kolumna „Płatność”, gdy część transz jest opłacona, a reszta planowana** (bez wystawionych): pokazujemy „Opłacone”. *Rekomendacja: tak* — W-10 rezerwuje „—” dla braku wystawionych.
5. **Pomiar p95 przed decyzją.** *Rekomendacja: nie* — szacunek ma duży zapas, a pomiar jest kryterium AC6 w EVM-034 i EVM-056.
6. **Miejsce listy.** W EVM-017 i EVM-072 lista zostaje w `work-orders`; EVM-034 przenosi listę i wyszukiwanie do `overview` bez zmiany kontraktu. *Rekomendacja: tak.* Ze względu na ryzyko R8 warto przy `/refine` rozważyć wydzielenie z EVM-034 enablera „moduł overview i przeniesienie listy” (decyzja produktowa).

### 9. Ryzyka i uwagi
- **R8 (rozmiar EVM-034) rośnie:** dochodzą moduł, przeliczenie, przebudowa i przeniesienie listy. Mitygacja — pytanie 6.
- **Rozjazd projekcji**, gdy nowe zdarzenie nie ma handlera. Mitygacja: test „projekcja = przeliczenie” po każdym teście integracyjnym zmieniającym zlecenie oraz nocny `verify`.
- **`x-extensible-enum`** — konwencję trzeba wprowadzić w EVM-008. Bez niej oasdiff zablokuje każdą nową wartość enumu w odpowiedzi, także w statusach. Trafi do „Uwag do rozważenia”.
- **Licznik wyników W-10** (README M1 → „Uwagi do potwierdzenia”, pkt 2) — poza zakresem; projekcja go nie przesądza.

### Ustalenia z konsultacji
**security-engineer — APPROVE (2026-10-04)** z warunkiem: ADR-0017 zawiera wymagania W1–W12 i testy T1–T9; bez nich przegląd ADR (AC6) kończy się wynikiem CHANGES REQUIRED. Wszystkie punkty trafiają do treści ADR, zakres planu się nie zmienia. Wariant (a) jest z punktu widzenia bezpieczeństwa najlepszy:
- (b1) skupia uprawnienia czterech schematów u właściciela widoku, więc wymaga `security_invoker` i `security_barrier`;
- (c) zachęca do odsiewania po pobraniu strony, czego zakazuje SR-AUTHZ-03.

**Zagrożenia** (różnica względem `threat-model.md`; bez nowego kontenera i przepływu zewnętrznego). Po mitygacjach wszystkie schodzą do Low (P1 × W2):
- **I/E** — rozjazd kolumn projekcji, od których zależy polityka (v1 `deleted_at`, w M4 przypisania): zlecenie usunięte lub nieprzypisane widać na liście; bez mitygacji Medium;
- **I** — projekcja niezależna od roli: przy polityce drobniejszej niż kotwica agregaty wyciekają; kolejność lub filtr po polach płatności może zdradzić stan płatności (wyrocznia, CWE-203);
- **T** — zgubione aktualizacje przy równoległej przebudowie i zapisie; zmanipulowany kursor lub `asOf`;
- **D** — przeliczenie blokuje komendy zapisu; szeroka fraza daje ogromną listę ID; „Najpilniejsze” bez indeksu;
- **I (RODO)** — projekcja nie jest „bez danych osobowych”, tylko pseudonimowa (motyw 26): `customer_id`, `site_id`, opiekun, `party_id`, terminy transz.

**Obowiązkowe kontrole w ADR-0017** (pełna treść: ADR-0017 → „Wymagania bezpieczeństwa W1–W12”):
- **W1** — klasyfikacja: zamknięta lista kolumn, zakaz kopiowania pól swobodnych, nazw, kontaktów i `search_text`; wiersz w „Klasyfikacji danych”; `rodo.md` w notatkach EVM-034 i EVM-056;
- **W2** — predykat `workOrder.read` z `authorization` w zapytaniu; kolumny autoryzacyjne aktualizowane każdą komendą; rozbieżność w `verify` to alert bezpieczeństwa; fail-closed przy wartościach wyświetlanych;
- **W3** — sygnały tylko z dzieci nieusuniętych i nieanulowanych; polityka drobniejsza niż kotwica to wyzwalacz rewizji;
- **W4** — sortowanie i filtry po płatnościach tylko dla roli z odczytem płatności (v1: A, E, R — P6), reguła w `x-evia-authz`;
- **W5** — porty systemowe z minimalnym DTO, niedostępne z kontrolerów; fasady z polityką użytkownika dla wartości wyświetlanych;
- **W6** — wyszukiwanie przez zbiory ID z fasad (`= ANY($1::uuid[])` z limitem), bez kopii `search_text`;
- **W7** — wejście z listy dozwolonych, X 1–365, wyrażenie sortowania ze stałych, „dziś” nigdy z żądania, pola wyliczane `readOnly`;
- **W8** — `asOf` i grupa pilności tylko w szyfrowanym kursorze;
- **W9** — `channels: [web]`;
- **W10** — `evia_app` tylko DML, `evia_readonly` bez dostępu, `ON DELETE CASCADE`;
- **W11** — `rebuild` i `verify` tylko jako CLI w `worker`, logi bez danych, nocny `verify` z alertem;
- **W12** — regresja limitów i P10, `statement_timeout` i `lock_timeout`, `500 internal_error` przy błędzie przeliczenia.

**Testy do planu w ADR (uzupełnienie punktów 1–7 planu):**
- T1 — parzystość listy i odczytu pojedynczego zlecenia;
- T2 — macierz ról z kanałem i IDOR;
- T3 — walidacja brzegowa;
- T4 — kursor;
- T5 — schemat, triggery i uprawnienia bazy;
- T6 — purge kaskadowy;
- T7 — logi `rebuild` i `verify`;
- T8 — przeliczenie niezależne od roli;
- T9 — regresja limitów i P10.

**Dokumenty:** EVM-034 → „Notatki techniczne” wskazują nowe pozycje TM w `threat-model.md` (albo `/milestone close M1`). Skany SAST, SCA i sekretów nie dotyczą tej historyjki (tylko dokumenty). `npm run docs:check` przed implementacją: 0 błędów, 0 ostrzeżeń.

### Zmiany względem planu (implementacja, solution-architect)
- **Projekcja bez kwot.** Zamiast „sumy wystawionych” są tylko liczniki (`invoiced_count`, `paid_count`) i najwcześniejszy termin wystawionej transzy. Sumy (wystawione i po terminie) zwraca fasada `payments` jednym zapytaniem wsadowym na stronę. To zapytanie i tak jest potrzebne dla sumy po terminie, która zależy od daty. Zmiana służy minimalizacji danych (W1) i nie dodaje zapytania.
- **`site_type` w projekcji** (filtr „Typ obiektu” z EVM-072 AC4 po przeniesieniu listy), więc `overview` zależy też od `sites` (zdarzenia zmiany `siteType`). Zależności od `customers` i `identity` dotyczą wyłącznie wartości wyświetlanych i zbiorów ID wyszukiwania.
- **Pole listy `hasOverdueStage`** zamiast osobnej flagi przy `nextDueDate`.
- **Definicje D1–D13.** Kolumna „Czekamy na” (D3) i widok „Czekamy na OSD > 14 dni” (D2) mają osobne wiersze. Doszło pytanie 7: widoki tylko dla zleceń niezamkniętych.

## Decyzje
**Do decyzji Konrada na `/adr` (rano, AC6)** — rekomendacje architekta; pełne uzasadnienie w ADR-0017 → „Pytania do Konrada”:
1. **Wariant (a)** — projekcja w module `overview`, aktualizowana w transakcji zapisu; ADR-0001 bez adnotacji. *Rekomendacja: tak.*
2. **Etap „Zablokowany” jest niezakończony** w wyliczeniach (bieżący etap, „Termin”, „Po terminie”). *Rekomendacja: tak.* Konsekwencje: „otwarty etap” w EVM-034 AC4 = „niezakończony”; reguła `Procedure` w `domain-model.md` → „pierwszy niezakończony” (EVM-034).
3. **„Najpilniejsze”:**
   - 1) transza **lub** etap po terminie;
   - 2) oczekiwanie > 14 dni;
   - 3) najbliższy termin etapu;
   - 4) pozostałe;
   - sygnały tylko dla zleceń niezamkniętych.

   *Rekomendacja: tak.*
4. **Kolumna „Płatność”:** część transz opłacona, reszta planowana (bez wystawionych) → „Opłacone”. *Rekomendacja: tak.*
5. **Pomiar p95 przed decyzją** — *rekomendacja: nie* (szacunek z zapasem ≥ 5×; pomiar w EVM-034 AC6 i EVM-056 AC6).
6. **Lista i wyszukiwanie przenoszą się do `overview` w EVM-034** bez zmiany kontraktu. *Rekomendacja: tak.* Ze względu na R8 przy `/refine` warto rozważyć wydzielenie enablera „moduł `overview` i przeniesienie listy”.
7. **Widoki „Czekamy na OSD > 14 dni”, „Po terminie”, „Nieopłacone”** obejmują tylko zlecenia niezamknięte. *Rekomendacja: tak.*

Zależność bez rozstrzygania: reguła postępu procesu ([P-6], styleguide 1.2.0 § 3.23 — „Nie dotyczy” poza mianownikiem) to decyzja z demo EVM-014. Definicje ADR-0017 od niej nie zależą.

## Uwagi do rozważenia
- **EVM-008 (kontrakt):** wprowadzić konwencję `x-extensible-enum` dla enumów w odpowiedziach. Bez niej oasdiff (`response-property-enum-value-added`, poziom error) zablokuje każdą nową wartość enumu w odpowiedzi, także statusów. Enumy w żądaniach zostają zwykłym `enum` (dodanie wartości — info).
- **EVM-072 (wyszukiwanie):** od początku ograniczyć rozmiar zbiorów ID zwracanych przez fasady `customers` i `sites` (start 10 000, konfiguracja). Przekroczenie → `400 validation_failed` z `errors[{ pointer: "/query", code: "too_broad" }]` (ADR-0017 W6). Wprowadzenie limitu dopiero w EVM-034 zaostrzyłoby walidację istniejącej operacji.
- **Kolumna „Postęp” na W-10 (`breakpoint.wide`, [P-6])** nie ma historyjki w M1. Gdy powstanie, projekcja dostanie liczniki etapów (*expand*) wg reguły z decyzji EVM-014 — do `/refine` (product-owner).
- **Nowe pozycje TM** w `threat-model.md` (rozjazd kolumn autoryzacyjnych, wyrocznia przez sortowanie, agregaty przy polityce drobniejszej niż kotwica, przebudowa) — w EVM-034 albo przy `/milestone close M1`.
- **Słownik (`domain.md`):** po decyzji o pytaniu 2 rozważyć pojęcie „etap niezakończony” (product-owner).

## Definition of Done
- [ ] AC1–AC6 spełnione
- [x] ADR w indeksie `docs/architecture/adr/README.md`; `npm run docs:check` — 0 błędów
- [ ] Przeglądy: security-engineer, backend-developer — APPROVE
- [ ] Decyzja Konrada (ADR zaakceptowany)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; konsultacja solution-architect W1)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — ready → in-progress: start /deliver w nocy 3/4.10 (decyzja Konrada — kolejka EVM-006 → EVM-014 → EVM-069, demo rano); gałąź `feature/EVM-069-adr-model-odczytu-listy` **ułożona na `feature/EVM-006-repo-i-ci`** (EVM-006 w PR #2, jeszcze nie na `main`: hooki, `.gitignore`, numeracja ADR po ADR-0016); po scaleniu PR #2 orkiestrator wciąga `origin/main` merge'em (bez force-pusha). Decyzja Konrada o ADR (AC6) — rano (`/adr`)
- 2026-10-04 — plan techniczny (solution-architect)
- 2026-10-04 — implementacja (solution-architect):
  - ADR-0017 „Model odczytu listy i podsumowania zlecenia” (status Proponowana) w indeksie ADR. Zawartość: warianty (a), (b1), (b2), (c) z kryteriami i ocenami (AC1); definicje D1–D13 (AC2); kontrakt addytywny z regułami oasdiff (AC3); plan testów 1–8 i T1–T9 (AC4); wpływ na backlog i model (AC5); W1–W12 z konsultacji `security-engineer`; pytania 1–7 do Konrada;
  - `domain-model.md`: moduł `overview` (proponowany), zasada projekcji, wiersze w „Gotowości offline” i „Klasyfikacji danych”;
  - „Notatki techniczne” EVM-034 i EVM-056;
  - `CHANGELOG.md`;
  - ADR-0001 bez adnotacji (rekomendacja (a)).

  Zmiany względem planu — „Plan techniczny” → „Zmiany względem planu”. Weryfikacja w sieci 2026-10-04: PostgreSQL 18.6, oasdiff 1.33.0. Bramki: `npm run docs:check` — 0 błędów, 0 ostrzeżeń; `npm run test:tools` — zielone (327 pass, 1 skipped, 0 fail); `pnpm run gate` — zielone. Testów kodu brak (tylko dokumenty), AC weryfikuje QA inspekcją. AC6: przeglądy `security-engineer` i `backend-developer` — kolejny krok workflow; decyzja Konrada (`/adr`) — rano (manual)
