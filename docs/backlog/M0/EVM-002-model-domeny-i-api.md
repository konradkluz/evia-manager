---
id: EVM-002
title: Model domeny v1 i wytyczne API
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P0
owner: solution-architect
contributors: [product-owner]
reviewers: [backend-developer, mobile-developer, security-engineer]
depends_on: [EVM-001]
---

# EVM-002: Model domeny v1 i wytyczne API

## Historyjka
Jako **zespół** chcemy **modelu domeny, który obsłuży różnorodne zlecenia bez specjalnych przypadków w kodzie, oraz spójnych zasad API**, aby **kolejne historyjki budować bez przeprojektowywania danych**.

## Kontekst
Rekomendacja „kompozycji” i scenariusze A–F: `docs/product/domain.md`. Model musi być od początku gotowy na pracę offline (M2).

## Kryteria akceptacji
**AC1 — Model**
- Gdy otwieram `docs/architecture/domain-model.md`
- Wtedy znajduję diagram ERD (Mermaid) i opis encji: klient, lokalizacja, zlecenie, szablon zlecenia, katalog usług i pozycje zakresu, proces i etapy, etap płatności, dziennik (wpisy, komentarze, zmiany), media, dokument, strona/kontrahent, użytkownik i rola, zdarzenie audytu — z nazwami zgodnymi ze słownikiem.

**AC2 — Scenariusze**
- Zakładając scenariusze A–F z `domain.md`
- Gdy czytam dokument
- Wtedy dla A–D widzę, jak każdy jest reprezentowany w modelu bez specjalnych przypadków, a dla E–F — że model da się rozszerzyć bez niszczących migracji.

**AC3 — Statusy**
- Wtedy dokument zawiera diagramy stanów zlecenia, etapu i etapu płatności z regułami przejść oraz rolami, które mogą je wykonać.

**AC4 — Gotowość offline**
- Wtedy model spełnia zasady opisane w szkicu `docs/architecture/offline-sync.md`: identyfikatory generowane po stronie klienta, soft delete, wersjonowanie / znaczniki zmian, append-only dla danych z terenu, idempotencja mutacji.

**AC5 — Wytyczne API**
- Gdy otwieram `docs/architecture/api-guidelines.md`
- Wtedy znajduję: konwencje zasobów i nazw, format błędów, paginację, filtrowanie i sortowanie (z polskimi znakami), idempotencję, wersjonowanie i politykę kompatybilności wstecznej (minimalna wersja aplikacji), zasady autoryzacji (deny-by-default) i limity.

**AC6 — Dane startowe**
- Wtedy istnieje propozycja startowego katalogu usług, co najmniej 4 szablonów zleceń (dom — pełny pakiet, dom — sam montaż, garaż — pełny proces, garaż — sama instalacja) i procesów z etapami — do akceptacji przez Konrada.

**AC7 — Słownik**
- Wtedy `docs/product/domain.md` ma potwierdzoną kolumnę „Nazwa w kodzie” (zmiany uzasadnione).

## Poza zakresem
Implementacja, edytor szablonów (M4), inwestycje i DC (tylko rozszerzalność).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Klasyfikacja danych w encjach (dane osobowe, dane wrażliwe dla firmy) — recenzja `security-engineer`.

## Notatki techniczne
_—_

## Plan techniczny
Historyjka dokumentacyjna (enabler): bez kodu aplikacji, bez specyfikacji OpenAPI i bez migracji. Weryfikacja AC przez inspekcję (QA + recenzenci). Model jest **logiczny** (encje, relacje, konwencje danych) — pierwsze migracje i kontrakt powstają w EVM-008 / M1 według zasad z tych dokumentów. **Bez zmiany decyzji ADR-0001…0015**: dokumenty doprecyzowują wyłącznie to, co ADR-y jawnie przekazały do EVM-002 (ADR-0001 reguła 5 i mapa modułów, ADR-0003 „Konwencje danych”, ADR-0004 „Konwencje”, ADR-0008 „zakres synchronizacji” i „mutacje edycyjne w MVP”). Gdyby w trakcie okazało się, że model wymaga zmiany ADR — zatrzymanie (BLOCKED) z pytaniem do Konrada.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/architecture/domain-model.md` | **nowy** (żywy): konwencje danych i decyzje delegowane z ADR; ERD w Mermaid — przegląd (encje i relacje) + diagramy obszarów z kluczowymi atrybutami: (1) klient, lokalizacja, zlecenie, zakres, katalog i szablony; (2) procesy, etapy, płatności; (3) dziennik, media, dokumenty; (4) użytkownicy, role, urządzenia, audyt; opis każdej encji z AC1 (właściciel-moduł, atrybuty, reguły, nazwa wg słownika); walidacja scenariuszy A–F; diagramy stanów zlecenia, etapu i etapu płatności z tabelami przejść (z → do, warunek, role, czy dozwolone z telefonu); tabela gotowości offline per encja; klasyfikacja danych per encja; punkty rozszerzeń (E–F, M3–M7) | AC1, AC2, AC3, AC4, „Bezpieczeństwo” |
| `docs/architecture/offline-sync.md` | **nowy** (żywy) — **szkic** zgodny z ADR-0008: zasady (ID po stronie klienta, soft delete i znaczniki usunięcia, `version` + dziennik zmian z kursorem, append-only danych z terenu, idempotencja mutacji), polityka synchronizacji per encja, zakres synchronizacji urządzenia, lista komend mobilnych MVP, diagramy sekwencji push / pull (poziom zasad), sekcja **„Otwarte — EVM-011”** | AC4 |
| `docs/architecture/api-guidelines.md` | **nowy** (żywy): zasoby i nazwy, typy danych (ID, czasy, daty biznesowe, kwoty, enumy), format błędów i katalog kodów, paginacja, filtrowanie i sortowanie z polskimi znakami, idempotencja, współbieżność (`ETag`/`If-Match`), komendy zmiany stanu, wersjonowanie i kompatybilność wsteczna, minimalna wersja aplikacji, autoryzacja (deny-by-default, `x-evia-authz`, 404 vs 403, filtrowanie list), limity, nagłówki, zasady dokumentowania operacji w OpenAPI | AC5 |
| `docs/product/service-catalog.md` | **nowy** (żywy, reguła 16 polityki dokumentów): **propozycja danych startowych** do akceptacji Konrada — katalog usług (kod, nazwa, kategoria, zestaw parametrów, wnoszone procesy), szablony procesów z uporządkowanymi etapami (domyślnie „na kogo czekamy”, dokumenty wynikowe), szablony zleceń (min. 4: „Dom — pełny pakiet”, „Dom — sam montaż”, „Garaż — pełny proces”, „Garaż — sama instalacja”) z planem płatności (nazwy transz i udział %, **bez cen**); dane wyłącznie syntetyczne | AC6 |
| `docs/product/domain.md` | kolumna „Nazwa w kodzie (propozycja)” → **„Nazwa w kodzie”**; nota w nagłówku „potwierdzone w EVM-002”; nowa sekcja **„Zmiany nazw w kodzie (EVM-002)”** (Pojęcie · Było · Jest · Uzasadnienie); nowe pojęcia potrzebne modelowi (m.in. szablon procesu, status zlecenia, użytkownik, rola, urządzenie, zdarzenie audytu, „na kogo czekamy”); odwołania do `domain-model.md` i `service-catalog.md` | AC7, AC6 |
| `docs/architecture/README.md` | mapa modułów: „wstępna” → doprecyzowana (nowy moduł `parties`, poprawione zależności — patrz decyzje 4 i 9); tabela „Planowane dokumenty”: stan EVM-002 (`offline-sync.md` jako szkic, `media-pipeline.md` powstaje w EVM-011, model encji mediów w `domain-model.md`) | AC1 (spójność) |
| `docs/README.md` | wiersze indeksu dla 4 nowych dokumentów | — |
| `CHANGELOG.md` | wpis w „Unreleased / Dodano” z `[EVM-002]` | DoD |
| ten plik | plan, „Dziennik”, później DoD | — |

Bez zmian: ADR-y i ich indeks, `CLAUDE.md` (stack bez zmian), `tools/`, `testing-strategy.md`. `media-pipeline.md` **nie** powstaje w EVM-002 (nie wymaga go żadne AC; encje i stany mediów opisuje `domain-model.md`, przepływ — ADR-0009 do czasu EVM-011).

**Kluczowe decyzje modelu (do zapisania w `domain-model.md`, akceptacja na demo)**
1. **Kompozycja przez kopię (snapshot):** `ServiceCatalogItem`, `WorkOrderTemplate` (+ pozycje szablonu), `ProcedureTemplate` + `ProcedureStageTemplate` i plan płatności szablonu to konfiguracja w module `catalog`. Utworzenie zlecenia kopiuje je do `ScopeItem`, `Procedure`, `ProcedureStage`, `PaymentMilestone` z odwołaniem do źródła (`source…Id`) i stabilnym `code`. Późniejsza zmiana szablonu nie zmienia istniejących zleceń; raporty („czekające na OSD”) filtrują po `code` i statusie, nie po typie zlecenia. To samo działa z edytorem w M4 bez zmiany modelu.
2. **Parametry techniczne:** `ScopeItem.parameters` (JSONB) walidowane schematem Zod z kodu, wskazanym przez `ServiceCatalogItem.parameterSetCode` (zgodnie z ADR-0003: JSONB tylko dla parametrów technicznych). Nowe pozycje katalogu i szablony nie wymagają kodu; nowy zestaw parametrów — tak. Pola definiowane danymi (M4) wymagałyby walidatora JSON Schema (nowa zależność) — decyzja dopiero w M4.
3. **Dziennik:** jedna tabela `TimelineEntry` (append-only) z `kind` = `note` / `comment` / `event`; kolumny typowane (bez JSONB — ADR-0003); korekta = nowy wpis z `supersedesEntryId`, nie edycja; kolejność wg czasu serwera `receivedAt`, `capturedAt` z telefonu tylko jako metadane (ADR-0008). `Timeline` to widok, nie encja. Dziennik biznesowy ≠ dziennik audytu ≠ dziennik zmian synchronizacji (trzy różne cele, opisane jawnie).
4. **Kontrahenci:** jedna encja `Party` z `kind` (administracja, zarządca, wspólnota, projektant, rzeczoznawca ppoż, OSD, podwykonawca, inny) — OSD to `kind`, nie osobna encja („Stoen” to dane). „Na kogo czekamy” na `ProcedureStage`: `waitingOn` (klient / kontrahent / my) + `waitingOnPartyId` + `waitingSince`. Nowy moduł `parties` (dziś: Party; w M3 książka kontaktów).
5. **Płatności:** status zapisany `planned` → `invoiced` → `paid` (+ `cancelled`); **„po terminie” jest wyliczane** (`invoiced` i `dueDate` < dziś w `Europe/Warsaw`) — bez zadania cyklicznego zmieniającego status. Kwoty `amountMinor` (grosze, `bigint`) + `currency`.
6. **Pliki:** `StoredFile` (obiekt w storage'u, stany i kwarantanna z ADR-0009, `UploadSession`) współdzielony przez `MediaAsset` i `DocumentVersion`; `Document` + `DocumentVersion` od v1 (wersjonowanie w M3 bez przebudowy). Klucz obiektu wg ADR-0009 z identyfikatorem rekordu pliku — doprecyzowanie, nie zmiana decyzji.
7. **Lokalizacja niezależna od klienta:** `WorkOrder` wskazuje `customerId` i `siteId`; `Site` może obsłużyć wiele zleceń i klientów w czasie (scenariusz D). `Charger` przy `Site` z `currentType` (`ac`/`dc`) i `powerKw` (zamiast `acPowerKw`) — stacja DC (F) bez specjalnego przypadku.
8. **Numer zlecenia** nadaje serwer (także dla szybkiego zlecenia utworzonego offline — do synchronizacji „oczekuje na numer”); identyfikatorem jest UUIDv7.
9. **Własność tabel (delegowane z ADR-0001, reguła 5):** **schemat PostgreSQL per moduł** (rekomendacja: widoczna własność, uprawnienia per schemat — np. audyt tylko `INSERT`/`SELECT`, zgodność z osobnym schematem pg-boss) zamiast prefiksów; klucze obce między modułami tylko zgodnie z kierunkiem zależności. Utworzenie zlecenia z szablonu: przypadek użycia w `work-orders` wywołuje w jednej transakcji kontrybutorów rejestrowanych przez `procedures` i `payments` przez port zdefiniowany w `work-orders` (bez cykli zależności). `sites` przestaje zależeć od `customers`.
10. **Kolumny wspólne:** `id` (UUIDv7), `created_at`/`created_by`, `updated_at`/`updated_by`, `version`, `deleted_at`/`deleted_by` (soft delete); `timestamptz` w UTC, daty biznesowe (termin płatności, planowana data) jako `date` w `Europe/Warsaw`; `search_text` z `f_unaccent()` + `pg_trgm` dla `Customer`, `Site`, `WorkOrder`, `Party` (ADR-0003).
11. **Synchronizacja (delegowane z ADR-0008):** zakres urządzenia = zlecenia aktywne + zamknięte w ostatnich N dniach (propozycja 30, pomiar w EVM-011) z powiązanymi klientem, lokalizacją, procesami i etapami, wpisami i metadanymi mediów, a także katalog i szablony (szybkie zlecenie). **Poza urządzeniem** (minimalizacja): etapy płatności, audyt, dane innych użytkowników poza nazwą wyświetlaną. Komendy mobilne MVP (zgodnie z M2: E11–E13): `CreateNote`, `CreateComment`, `CreateMediaAsset`, `CreateQuickWorkOrder` — **wyłącznie tworzenie, zero edycji pól współdzielonych** (brak konfliktów w MVP); `UpdateStageStatus` z `base_version` po MVP.
12. **Uprawnienia:** macierz encja × operacja × rola (Administrator / Edytor / Tylko odczyt) i role przejść stanów; zakres danych dla Tylko odczyt — odwołanie do EVM-005 (AC3 tamtej historyjki).

**Kontrakt API:** nie dotyczy — `api-guidelines.md` to wytyczne; ścieżki w nim są przykładami. Pierwszy kontrakt: EVM-008. Statusy specyfikacji (RFC 9457, RFC 9562, RFC 9745 `Deprecation`, RFC 8594 `Sunset`, draft `Idempotency-Key`) weryfikuję w sieci przy pisaniu, z datą i źródłami.
**Migracje:** nie dotyczy — `domain-model.md` opisuje konwencje (expand → migrate → contract) i dla E–F wskazuje rozszerzenia wyłącznie addytywne.

**Plan weryfikacji AC (inspekcja; pomocnicze skrypty tylko w `.scratch/EVM-002/`)**
| AC | Jak sprawdzić |
|---|---|
| AC1 | `domain-model.md`: diagramy ERD renderują się (mermaid-cli uruchomiony z `.scratch/`; bez wysyłania treści do serwisów online); każda z 14 encji z AC1 ma opis z właścicielem-modułem i atrybutami; skrypt porównuje nazwy w kodzie z `domain.md` z nazwami w ERD i opisach (0 rozbieżności). |
| AC2 | Tabela scenariuszy: A–D — szablon + pozycje zakresu + procesy/etapy + płatności + media, każdy wiersz „bez specjalnych przypadków” (żadnej gałęzi zależnej od typu zlecenia); E–F — lista rozszerzeń, każde sklasyfikowane jako *expand* (nowa tabela, nowa kolumna opcjonalna, nowa wartość enumu z obsługą „nieznana”), żadne *contract*. |
| AC3 | Trzy diagramy `stateDiagram-v2` (zlecenie, etap, etap płatności) renderują się; każda strzałka ma wiersz w tabeli przejść z warunkiem i rolami (Administrator / Edytor / Tylko odczyt / system) oraz informacją, czy przejście jest dozwolone z telefonu. |
| AC4 | `offline-sync.md` istnieje, ma sekcje dla 5 zasad z AC4 i oznaczoną sekcję „Otwarte — EVM-011”; brak sprzeczności z ADR-0008 (checklista: UUIDv7 z urządzenia, `mutation_id` = klucz idempotencji, `base_version`, kursor z `xid8`, `resync_required`, retencje 30/90 dni); tabela gotowości offline w `domain-model.md` ma dla każdej encji: ID z klienta, soft delete, `version`, append-only, kierunek synchronizacji. |
| AC5 | `api-guidelines.md` — checklista 9 tematów z AC5, każdy z sekcją; wartości zgodne z ADR-0004/0005/0008/0009 (1 MB, 25/100, 300 żądań/min, 426 i `client_version_unsupported`, 412 `version_conflict`, 30 dni kluczy idempotencji); przykład „Lodz” → „Łódź” i sortowanie Ł po L. |
| AC6 | `service-catalog.md`: katalog usług, ≥ 4 szablony o nazwach z AC6, procesy z uporządkowanymi etapami, plany płatności; oznaczenie „Propozycja — do akceptacji Konrada”; przegląd danych (brak prawdziwych klientów, adresów, kwot i cen; tylko dane syntetyczne). |
| AC7 | `domain.md`: nagłówek kolumny bez „(propozycja)”; każda zmieniona nazwa ma wiersz w tabeli zmian z uzasadnieniem (porównanie z wersją na `main` przez `git diff`). |
| Bezpieczeństwo | Tabela klasyfikacji: każda encja ma klasę (dane osobowe klientów / pracowników, dane wrażliwe dla firmy, wewnętrzne, konfiguracja), pola z danymi osobowymi, czy trafia na urządzenie, uwagi (pola tekstowe swobodne i media traktowane jako mogące zawierać dane osobowe; PPE i adres domu = dane osobowe). Recenzja `security-engineer`. |
| Bramki | `npm run docs:check` — 0 błędów i 0 ostrzeżeń (nowe pliki nie są osierocone); `npm run test:tools` — zielone, bez regresji; linki względne działają. |

**Kolejność kroków**
1. Uzgodnienie nazw (słownik ↔ model) w `.scratch/` — podstawa dla wszystkich dokumentów.
2. `domain-model.md`: konwencje i decyzje delegowane → ERD (przegląd i obszary) → opisy encji → scenariusze A–F → diagramy stanów i tabele przejść → gotowość offline → klasyfikacja danych → punkty rozszerzeń.
3. `offline-sync.md` (szkic) — spójny z tabelą gotowości offline.
4. `api-guidelines.md` (weryfikacja statusów RFC w sieci).
5. `service-catalog.md` — struktura i pierwsza propozycja treści.
6. `domain.md` (AC7), mapa modułów i tabela dokumentów w `docs/architecture/README.md`, `docs/README.md`, `CHANGELOG.md`.
7. Samosprawdzenie wg tabeli wyżej; `npm run docs:check`, `npm run test:tools`; wpis w „Dzienniku”.
8. Contributor `product-owner`: biznesowa weryfikacja znaczeń w słowniku, polskich etykiet statusów i reguł przejść, treści `service-catalog.md` (usługi, etapy, transze) oraz przejście scenariuszy A–D; założenia o procesach OSD i administracji oznaczone „do weryfikacji przez Konrada”.
9. Przeglądy: `backend-developer` (wykonalność w Kysely i migracjach, schematy per moduł), `mobile-developer` (zakres synchronizacji, komendy MVP, `offline-sync.md`), `security-engineer` (klasyfikacja danych, autoryzacja, dane na urządzeniu).

**Pytania do Konrada na demo (nieblokujące; rekomendacje już wpisane do dokumentów)**
1. Cykl statusów zlecenia i reguły ról (np. przywrócenie ze stanu „Rozliczone” lub „Anulowane” tylko przez Administratora) — *rekomendacja: tak*.
2. Kwoty etapów płatności: brutto do zapłaty — *rekomendacja: tak*; netto i VAT przy integracji z systemem fakturowym (M5).
3. Etapy płatności na telefonach — *rekomendacja: nie* (minimalizacja danych na urządzeniu).
4. Telefon w MVP tylko dodaje (wpisy, komentarze, media, szybkie zlecenie), bez zmiany statusów etapów — *rekomendacja: tak* (zgodne z M2).
5. Zakres danych offline: zlecenia niezamknięte (aktywne, wstrzymane, zakończone) + zamknięte w ostatnich 30 dniach — *rekomendacja: tak*, wartość ostateczna po pomiarach EVM-011.
6. Dane startowe z `service-catalog.md` — akceptacja lub poprawki.

**Ustalenia z konsultacji**
- **`security-engineer` — APPROVE (2026-10-03)**, z punktami obowiązkowymi [M] (sprawdzane w przeglądzie po implementacji) i zaleceniami [Z]. Polityk z EVM-005 AC3 (zakres roli Tylko odczyt, EXIF/GPS, retencja, podstawy prawne) nie rozstrzygamy — oznaczone „otwarte — EVM-005”. Zagrożenia uwzględnione w modelu: T1 IDOR przez UUID z klienta (CWE-639), T2 nadpisanie przez ID z klienta / mass assignment (CWE-915), T3 nadmiar danych na telefonach BYOD, T4 append-only a art. 17 RODO, T5 dane osobowe w URL, T6 masowe pobranie przez insidera, T7 oszustwo na statusach i kwotach płatności, T8 wstrzyknięcia przez sortowanie i `LIKE`, DoS przez trigramy, T9 podszycie pod urządzenie i replay. Realizacja punktów:
  | Punkty | Treść (skrót) | Gdzie |
  |---|---|---|
  | A1–A2 [M] | tabela klasyfikacji per encja (+ `StoredFile`, `UploadSession`, `Device`, `Session`, `IdempotencyRecord`, `SyncChange`), kolumny: klasa, pola z danymi osobowymi, pola swobodne, `search_text`, projekcja na telefon, sposób usunięcia, retencja → EVM-005; klasyfikacja minimalna | `domain-model.md` → „Klasyfikacja danych” |
  | A3–A4 [M], A5 [Z] | brak pól PESEL, nr dokumentu, daty urodzenia, kodów do bram; dane osobowe tylko w kolumnach typowanych, ścisłe schematy parametrów; poufność rodzaju dokumentu | „Konwencje danych” (minimalizacja, JSONB); `DocumentKind.confidentiality` |
  | B6–B8 [M], B9 [Z] | soft delete vs purge / anonimizacja / redakcja; audyt, zdarzenia dziennika, dziennik zmian i znaczniki bez wartości danych osobowych (wyjątek: kwota i status płatności); rekord idempotencji = skrót + wynik minimalny, 30 dni; dezaktywacja kont | „Usuwanie danych”, `AuditEvent`, `TimelineEntry`, `IdempotencyRecord`, `User` |
  | C10–C12, C14 [M], C13 [Z] | macierz encja × operacja × rola (z aktorem „system” i kanałem „telefon”), deny-by-default, operacje tylko dla Administratora (step-up), komórki Tylko odczyt → EVM-005 AC3, kotwica autoryzacji, pola kontrolowane przez serwer; `WorkOrderAssignment` od v1 | „Uprawnienia” |
  | D15–D17 [M] | przejście spoza tabeli zabronione, przejścia audytowane, niezmienniki `StoredFile`, brak GPS w `MediaAsset` | „Stany i przejścia”, `StoredFile`, `MediaAsset` |
  | E18–E23 [M] | `user_id` / `device_id` tylko z sesji; `Create*` = tylko `INSERT` (`id_conflict`); autoryzacja w momencie synchronizacji; zakres urządzenia z projekcją pól; wyjście z zakresu; „Otwarte — EVM-011” | `offline-sync.md` |
  | F24–F32 [M], F33 [Z] | błędy RFC 9457 bez wartości, 404 vs 403; brak danych osobowych w ścieżce i query (`POST …/search`), kursory nieprzezroczyste; sortowanie i filtry z list dozwolonych, escapowanie; walidacja (`additionalProperties: false`, limity, `readOnly`); idempotencja (409, 422, wynik minimalny); `x-evia-authz` obowiązkowe, testy ról i IDOR; limity z ADR; nagłówki; `X-Client-*` tylko kompatybilność, `426` jako odcięcie wersji z podatnością; zwykły tekst, formula injection (M4) | `api-guidelines.md` |
  | G34 [M] | wyłącznie dane syntetyczne, OSD jako rodzaj kontrahenta bez danych kontaktowych | `service-catalog.md` |
  | H35 [M], H36 [Z] | trzy osobne dzienniki (biznesowy, audytu, zmian synchronizacji); uprawnienia ról bazy per schemat | „Trzy dzienniki”, „Moduły i własność tabel” |

## Decyzje
- 2026-10-03 — Konrad: po 3 rundach weryfikacji (`needs-attention`, 1 ustalenie major security) domykamy **mini-rundą** — poprawka wg rekomendacji security i niezależne potwierdzenie przez `security-engineer`, bez pełnej rundy workflow.
- 2026-10-03 — Konrad (demo): **akceptacja przyrostu** wraz z rekomendacjami:
  - pytania 1–7 w `domain-model.md`: cykl statusów i role przejść, korekty płatności po wystawieniu tylko przez Administratora ze step-upem, kwoty brutto, płatności poza telefonem, telefon w MVP tylko dodaje, zakres offline = niezamknięte + zamknięte z 30 dni (wartość ostateczna po EVM-011), numer `ZL-2026-0042` z licznikiem rocznym;
  - pytania produktowe P1–P5: etykieta „Czekamy na…” (zmiana w styleguide — `ux-designer`, EVM-004), Tylko odczyt widzi etapy płatności bez zmian (wejście do EVM-005), technicy nie przyjmują płatności, zaliczka na proformę bez zmiany modelu, częściowe wpłaty poza MVP;
  - dane startowe AC6 (`service-catalog.md` § 8, założenia 1–8); założenie 6 → „Dom — sam montaż” z pozycją i procesem „Pomiary i odbiór” (§ 5 i scenariusz A w `domain-model.md`); udziały transz przykładowe do czasu podania typowych przez Konrada.

## Uwagi do rozważenia
### Weryfikacja biznesowa (product-owner, 2026-10-03)
**Wynik:** model, słownik i propozycja danych startowych realizują cel historyjki. Scenariusze A–D przechodzą przez model bez specjalnych przypadków. Poprawki z tego kroku:
1. `service-catalog.md`:
   - proces `dso_connection` ma 7 etapów wg publicznych informacji OSD (do weryfikacji):
     - „Zgłoszenie gotowości” (po naszej stronie) jest oddzielone od „Wymiany licznika i załączenia” (czekamy na OSD);
     - opłata przyłączeniowa jest częścią etapu umowy z OSD;
     - nowy rodzaj dokumentu `dso_readiness_declaration`;
   - opisany tryb ustawowy zgody na punkt ładowania w garażu (art. 12b ustawy o elektromobilności, do weryfikacji);
   - usunięty dokument `quote` z etapu „Potwierdzenie modelu” (oferta dotyczy całego zlecenia);
   - w etykietach „kontrahent” zmieniony na „strona” (styleguide § 6.2);
   - § 8 przepisany na tabelę z rekomendacjami i konsekwencjami;
   - dodany § 9 ze źródłami do weryfikacji.
2. `domain.md`:
   - poprawiona definicja mocy przyłączeniowej (to nie moc umowna);
   - status etapu „Czekamy na…” obejmuje też klienta (wiersz w tabeli zmian);
   - nowe pojęcia: zlecenie aktywne / zamknięte / niezamknięte, nieopłacone / po terminie, kategoria usługi, kategoria wpisu, zgłoszenie gotowości instalacji;
   - „wspólnota / spółdzielnia”;
   - linki do przejścia scenariuszy i do szablonów.
3. `domain-model.md` i `offline-sync.md` (terminologia):
   - „niezamknięte” zamiast „aktywne” i „niezakończone” w zakresie synchronizacji, w regule usuwania klienta i w pytaniu 5;
   - kolejność procesów w scenariuszu B zgodna z kompozycją;
   - opis dokumentów w scenariuszu D.
4. Potwierdzenie założeń architekta (ryzyka 2–3):
   - Edytor usuwa elementy składu zlecenia — zgodne z zasadą „po utworzeniu wszystko można zmienić” (`domain.md`). Dla etapów zalecamy „Nie dotyczy”, bo zachowuje historię.
   - `waitingOn` nie ma wartości „my” — gdy etap nie czeka, „piłka jest po naszej stronie”.

**Przejście scenariuszy A–D (biznesowo)**
- **A:** Nowe → Zaakceptowane (bez wyceny) → W realizacji → Zakończone → Rozliczone po opłaceniu jedynej transzy. Gdy na miejscu okaże się, że zasilanie nie jest gotowe, biuro dodaje pozycję „Instalacja zasilająca” — proces dochodzi bez zmian w kodzie.
- **B:** „Czekamy na OSD > 14 dni” obejmuje etapy 3, 5 i 7 procesu OSD. Oczekiwanie na klienta (pełnomocnictwo, umowa i opłata) widać w tym samym polu „na kogo czekamy”. Zaliczka jest wystawiana po akceptacji, płatność końcowa po odbiorze.
- **C:** 9 procesów. „Na jakim etapie jesteśmy z administracją / w OSD” widać osobno dla każdego procesu. 4 transze; zdjęcia z garażu bez zasięgu idą przez `CreateMediaAsset`.
- **D:** drugie zlecenie w tej samej lokalizacji (także dla innego klienta) powstaje z szablonu „Garaż — montaż ładowarki”. Dokumenty pierwszego zlecenia są dostępne przez historię lokalizacji.

**Pytania produktowe na demo** (uzupełniają pytania 1–6 i założenia z `service-catalog.md` § 8)
- **P1. Etykieta statusu etapu `waiting`.** Styleguide v1 ma „Czekamy na stronę trzecią”, a model i słownik — „Czekamy na…”, bo czekamy też na klienta.
  - *Rekomendacja:* „Czekamy na…”; w widokach rozwinięte do „Czekamy na: klient · od 3 dni” albo „Czekamy na: [nazwa strony] (OSD) · od 15 dni”. Zmianę w styleguide wprowadza `ux-designer`.
  - *Konsekwencja „stronę trzecią”:* oczekiwanie na klienta wymagałoby osobnego statusu (nowa wartość `StageStatus`) albo nie byłoby widoczne w raportach „na kogo czekamy”.
- **P2. Rola Tylko odczyt a płatności** (wejście do EVM-005 AC3). Persona „księgowość / wspólnik” potrzebuje wglądu w płatności.
  - *Rekomendacja:* Tylko odczyt widzi etapy płatności (bez możliwości zmian). Dokumenty `identity_data` i oryginały mediów — wg EVM-005.
  - *Konsekwencja „nie”:* księgowość nie korzysta z systemu, a zestawienie nieopłaconych widzą tylko Administrator i Edytor.
- **P3. Czy technicy przyjmują płatności u klienta** (gotówka, terminal)?
  - *Rekomendacja:* nie (przelew po fakturze), więc płatności zostają poza telefonem, jak w modelu.
  - *Konsekwencja „tak”:* telefon potrzebuje kwoty do zapłaty dla transzy — decyzja w EVM-005 i M2.
- **P4. Zaliczka na proformę.**
  - *Rekomendacja:* pole w UI „Nr faktury / proformy”; po wpłacie numer zmieniamy na numer faktury zaliczkowej. Bez zmiany modelu.
  - *Konsekwencja innego wyboru:* przejście „Planowana → Opłacona” bez faktury zmienia tabelę przejść płatności.
- **P5. Częściowe wpłaty transzy.**
  - *Rekomendacja:* poza MVP. Obejście: Administrator koryguje kwotę, a biuro dodaje nową transzę na resztę.
  - *Konsekwencja:* zestawienia nie pokazują stanu „wpłacono częściowo”.

**Do przekazania dalej (nieblokujące)**
- `ux-designer` (styleguide § 4.4 i § 6.2, przy EVM-004):
  - etykieta `waiting` (P1);
  - brak statusu „Anulowana” w grupie płatności;
  - „Po terminie” jako odznaka wyliczana, nie zapisany status;
  - klucze tokenów `quote` / `issued` a kody modelu `quoting` / `invoiced` — mapowanie albo ujednolicenie;
  - lista „Strona” w terminologii uzupełniona o dostawcę, rzeczoznawcę (ekspertyza) i spółdzielnię.
- `security-engineer` (EVM-005 AC3): wejście biznesowe P2 i P3.
- Kandydaci do backlogu (przez `/refine`):
  - historia lokalizacji w zleceniu — dokumenty i zdjęcia z poprzednich zleceń, bez `identity_data` (M1, E3/E6);
  - szybkie dodanie strony z poziomu etapu, z podpowiedzią OSD i zarządcy z lokalizacji (M1, E4);
  - domyślne terminy etapów, np. 30 dni na decyzję zarządu, 21 dni na warunki przyłączenia (M3);
  - ładowarka w lokalizacji uzupełniana z parametrów pozycji zakresu po uruchomieniu (M4/M7).

### Uwagi nieblokujące z weryfikacji (rundy 1–3, orkiestrator 2026-10-03)
Ustalenia minor / nit z QA i przeglądów, niezałatwione w historyjce. Zamknięte w mini-rundzie: `dso_readiness_declaration` → `identity_data` (backend minor = security major).
1. **Soft delete zlecenia a korekta płatności** (QA + security, minor; `domain-model.md` :594, :635, :714, :857). Administrator bez step-upu może ukryć transze `paid` / `planned` przez soft delete zlecenia nadrzędnego, co przeczy zasadzie ścieżek. Skutek łagodzi to, że operacja jest odwracalna i audytowana. Warianty: (a) soft delete zlecenia z transzami `paid` wymaga A ↑ — *rekomendacja*; (b) zawęzić „soft delete transzy” w zasadzie ścieżek. → decyzja na demo (pytanie 1) albo poprawka przed EVM-008.
2. **Kursor (txid, seq) po odtworzeniu / migracji bazy** (QA, minor; `offline-sync.md` :28–31, :173). Po PITR lub `pg_restore` licznik xid może się cofnąć, a urządzenia przestaną dostawać zmiany aż do resyncu kontrolnego. Zalecane: „epoka dziennika zmian” w kursorze jako wyzwalacz `resync_required`, zachowanie kolejki po PITR i krok w teście odtworzenia. → punkt „Otwarte — EVM-011” oraz EVM-007 (runbook i test odtworzenia).
3. **„Dom — sam montaż” a rekomendacja 6** (QA + backend, minor; `service-catalog.md` § 5 vs § 8 założenie 6; `domain-model.md` :960). Rekomendacja dodaje „Pomiary i odbiór”, a szablon i scenariusz A pokazują wariant bez pomiarów. → rozstrzygnąć przy akceptacji AC6 na demo; jeśli zostaje rekomendacja, poprawić § 5 i scenariusz A przed migracją danych startowych (M1). **Rozstrzygnięte 2026-10-03:** rekomendacja przyjęta, § 5 i scenariusz A uzupełnione.
4. **Mutacja z telefonu wskazująca usunięty etap** (mobile, minor; `offline-sync.md` :61–63). Wpis lub zdjęcie z `procedureStageId` usuniętego offline etapu dostaje `rejected` i trafia do „Wymaga uwagi”. Zalecane: `applied` bez powiązania z etapem i ostrzeżenie `stage_unavailable`. → „Otwarte — EVM-011” i scenariusze „nic nie ginie”.
5. **Historia lokalizacji nie jest kotwicą autoryzacji** (security, minor; `domain-model.md` :963). Dostęp przez `siteId` mógłby ujawnić dokumenty i zdjęcia poprzedniego klienta (IDOR, CWE-639). → przy `/refine` kandydata „historia lokalizacji”: każdy element autoryzowany zleceniem źródłowym, bez `identity_data`, poza telefonem, z przeglądem `security-engineer`.
6. **Historia lokalizacji tylko online** (mobile, nit; `domain-model.md` :963). Dopisać, że to widok w panelu, a na telefonie offline jest poza zakresem MVP.
7. **Usuwanie transz w zdaniu ogólnym** (QA, nit; `domain-model.md` :698). Doprecyzować: Edytor anuluje transzę (`planned → cancelled`), a usunięcie to korekta płatności (A ↑).
8. **Poufność per rodzaj, a nie per plik** (security, minor, mini-runda; `service-catalog.md` :199, :215). Skan dowodu dodany jako `other` albo np. `acceptance_report` dostaje klasę `standard` (CWE-359). → EVM-005 AC3: dopuścić podniesienie klasy dla pojedynczego dokumentu (nigdy obniżenie) albo dodać w UI ostrzeżenie przy `other`.
9. **Przykłady `identity_data`** (security, nit; `domain-model.md` :933). Dodać odnośnik do kryterium w `service-catalog.md` § 6.

## Definition of Done
- [x] AC1–AC7 spełnione (weryfikacja QA przez inspekcję) — QA runda 3: PASS dla AC1–AC7 i klasyfikacji danych; bramki u orkiestratora: `npm run docs:check` 0 błędów / 0 ostrzeżeń, `npm run test:tools` 189/189, pokrycie 100%
- [x] Przeglądy: backend-developer, mobile-developer, security-engineer — APPROVE (backend i mobile: runda 3; security: mini-runda po `f90b719`)
- [x] Demo i akceptacja Konrada (w tym danych startowych z AC6) — 2026-10-03: „Akceptuję” z rekomendacjami (sekcja „Decyzje”)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-002-model-domeny-i-api`
- 2026-10-03 — plan techniczny (solution-architect)
- 2026-10-03 — konsultacja security-engineer: APPROVE z punktami [M] i [Z] (zapisane w „Ustaleniach z konsultacji”)
- 2026-10-03 — implementacja (solution-architect): `domain-model.md`, `offline-sync.md` (szkic), `api-guidelines.md`, `service-catalog.md` (propozycja), słownik w `domain.md` (kolumna „Nazwa w kodzie”, 11 zmian z uzasadnieniem, 25 nowych pojęć), mapa modułów i tabela dokumentów w `docs/architecture/README.md`, indeks `docs/README.md`, `CHANGELOG.md`. Samosprawdzenie (skrypty w `.scratch/EVM-002/`): kontrole AC1–AC7 i bezpieczeństwa 93/93, 13 diagramów Mermaid w zmienionych plikach renderuje się lokalnie (mermaid-cli + lokalny Chrome, bez serwisów online), 124 linki względne i kotwice poprawne; `npm run docs:check` — 0 błędów, 0 ostrzeżeń; `npm run test:tools` — 189/189, pokrycie 100%. Statusy RFC 9457, 9562, 9745, 8594 i szkicu `Idempotency-Key` (-07, wygasły) zweryfikowane w sieci. Bez zmian ADR-0001…0015.
- 2026-10-03 — weryfikacja biznesowa (product-owner): słownik, etykiety statusów i reguły przejść, `service-catalog.md` (proces OSD — 7 etapów, tryb ustawowy zgód w garażu, § 8 z rekomendacjami, § 9 źródła do weryfikacji), przejście scenariuszy A–D, korekty terminologii („niezamknięte”, „strona”) w `domain-model.md` i `offline-sync.md`; pytania P1–P5 i przekazania w „Uwagach do rozważenia”. Bez zmian modelu encji, tabel przejść i ADR. `npm run docs:check` i `npm run test:tools` uruchamia orkiestrator (product-owner nie ma dostępu do powłoki).
- 2026-10-03 — runda 1: QA PASS; przeglądy backend APPROVE, mobile CHANGES (3× major: obiekty lokalne niewysłane, stan pliku i SHA-256, wejście do zakresu), security APPROVE → poprawki (solution-architect, `f508c86`)
- 2026-10-03 — runda 2: QA FAIL (2× major: kursor synchronizacji gubiący zmiany, obejście ról w korektach płatności); przeglądy 3× APPROVE → poprawki (solution-architect, `3dd353f`)
- 2026-10-03 — runda 3: QA PASS; backend i mobile APPROVE, security CHANGES (1× major: poufność `dso_readiness_declaration`) → limit rund, `needs-attention`
- 2026-10-03 — mini-runda (decyzja Konrada): `dso_readiness_declaration` → `identity_data` i kryterium klasyfikacji w `service-catalog.md` § 6 (orkiestrator, wg rekomendacji security)
- 2026-10-03 — mini-runda: security-engineer APPROVE (ustalenie major zamknięte; nowe: 1× minor, 1× nit → „Uwagi do rozważenia” 8–9)
- 2026-10-03 — in-progress → in-review: DoD (AC + przeglądy) spełnione, uwagi minor / nit w „Uwagach do rozważenia”; czeka na demo i akceptację Konrada
- 2026-10-03 — in-review → done: akceptacja Konrada na demo; „Dom — sam montaż” uzupełniony o pomiary (rekomendacja 6); squash merge do `main`
