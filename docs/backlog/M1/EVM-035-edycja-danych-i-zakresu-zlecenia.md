---
id: EVM-035
title: Edycja danych i zakresu zlecenia
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: done
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
depends_on: [EVM-038, EVM-071]
---

# EVM-035: Edycja danych i zakresu zlecenia

## Historyjka
Jako **pracownik biura** chcę **zmienić dane zlecenia i jego zakres — dodać pozycję z katalogu z jej procesami, usunąć pozycję, poprawić parametry —** aby **zlecenie odpowiadało temu, co faktycznie robimy, gdy na miejscu okaże się coś innego niż w szablonie**.

## Kontekst
- Zakres roadmapy E3: „zakres z katalogu (edytowalny)”, „podstawowe parametry techniczne”, „opiekun”. Luka L7 i kandydat P1 z EVM-004; wariant A z EVM-002 (brak gotowego zasilania → dodanie „Instalacji zasilającej”).
- Model: `ScopeItem` (dodanie proponuje procesy wnoszone przez pozycję, bez duplikatów po kodzie; usunięcie pozycji nie usuwa procesów), parametry wg `parameterSetCode` (D2).
- PO-8 i decyzja 17 (README M1): w zleceniu zamkniętym dane zlecenia i zakres są tylko do odczytu.
- Makiety: W-06 „Edytuj dane zlecenia”, „Edytuj zakres” (EVM-071).

## Kryteria akceptacji
**AC1 — Dane zlecenia**
- Zakładając zlecenie „W realizacji”
- Gdy w „Edytuj dane zlecenia” zmieniam tytuł, opis, opiekuna albo planowaną datę
- Wtedy zmiana zapisuje się z `If-Match`, a przy `412` widzę alert konfliktu z zachowanymi wpisanymi danymi (komunikat z makiety W-06 (a)).

**AC2 — Dodanie pozycji z procesami**
- Zakładając zlecenie z szablonu „Dom — sam montaż”
- Gdy dodaję pozycję „Instalacja zasilająca”
- Wtedy pozycja ma parametry domyślne, panel proponuje procesy wnoszone przez pozycję (bez procesów o kodach już obecnych w zleceniu), a po zatwierdzeniu dochodzą procesy z etapami „Do zrobienia” — wszystko w jednej transakcji.

**AC3 — Usunięcie pozycji**
- Gdy usuwam pozycję zakresu
- Wtedy pozycja znika z zakresu, a procesy, które wniosła, zostają z informacją, gdzie je usunąć (EVM-042).

**AC4 — Parametry techniczne (SR-INPUT-01, SR-INPUT-02, SR-DATA-02)**
- Gdy zmieniam parametry pozycji albo dodaję „Inną usługę” z opisem
- Wtedy parametry są walidowane schematem zestawu (pole nieznane, wartość spoza zakresu albo > 16 KB → `400 validation_failed`), a parametry nie przyjmują danych osobowych ani identyfikatorów (PPE, numery liczników, nazwiska).

**AC5 — Limity**
- Zakładając zlecenie z 50 pozycjami zakresu
- Gdy dodaję kolejną
- Wtedy API zwraca `422 limit_exceeded` z komunikatem w panelu.

**AC6 — Zlecenie zamknięte (PO-8, decyzja 17)**
- Zakładając zlecenie „Rozliczone” albo „Anulowane”
- Gdy zmieniam dane zlecenia albo zakres
- Wtedy API zwraca `409 work_order_closed`, a w panelu akcje są wyłączone z podpowiedzią.

**AC7 — Dziennik**
- Gdy zmieniam dane zlecenia albo zakres
- Wtedy w dzienniku zlecenia powstaje zdarzenie z nazwami zmienionych pól albo opisem zmiany zakresu — bez wartości danych osobowych (mechanizm EVM-038).

**AC8 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda edytuje
- Wtedy A i E edytują, R nie widzi akcji i dostaje `403 forbidden`, niezalogowany — `401`; pozycja zakresu zlecenia B zmieniana ścieżką zlecenia A zwraca `404`, a pola kontrolowane przez serwer (`number`, `status`) — `400` (`read_only_field`).

## Poza zakresem
- Ręczne dodanie i usunięcie procesu lub etapu — EVM-042 (P2). Zmiana klienta lub lokalizacji zlecenia — poza M1.

## UX / UI
- W-06: dialog „Edytuj dane zlecenia”, tryb „Edytuj zakres” (lista pozycji, dodanie z katalogu z propozycją procesów, parametry wg zestawu, „Inna usługa”) — makiety EVM-071.
- Stany: pusty („Zlecenie nie ma jeszcze pozycji zakresu. [Edytuj zakres]”), ładowanie, błąd (`412`, `422`), offline (akcje wyłączone), brak uprawnień (AC8).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | edycja danych i zakresu |
| Edytor | edycja danych i zakresu |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: tytuł, opis (pola swobodne), parametry techniczne (bez danych osobowych).
- W AC: SR-INPUT-01, SR-INPUT-02, SR-DATA-02, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05. W sekcji: SR-API-07, SR-LOG-03.

## Notatki techniczne
- Moduły: `work-orders`, `procedures` (przez port kompozycji), `timeline` (zdarzenia) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
- Lista pozycji zakresu (`listWorkOrderScopeItems`, EVM-018) nie ma limitu — dodać `maxItems`/`limit` w kontrakcie; przy odczycie pojedynczej pozycji dodać test IDOR `/work-orders/{A}/scope-items/{B-item}` = 404.
- (minor) brak asercji logów (SR-LOG-02/03) i testu `413` dla limitu 64 KB tras `POST/PATCH …/scope-items`; `getWorkOrderScopeItem`/`listWorkOrderScopeItems` zwracają `notes` poza licznikiem odczytu masowego P10.
- (minor, UX) propozycja procesów w `scope-add-dialog.tsx` na dole przewijanego dialogu (poza widokiem na 360/1280 px); powód wyłączenia „Dodaj pozycję…” tylko w `title`; brak zrzutów stanów AC2/AC5/offline.
- (nit) opis `CreateScopeItemRequest` w kontrakcie sprzeczny z opisem `notes` (może zawierać dane osobowe); niskie pokrycie gałęzi `scope-edit-dialog` 79%, `scope-remove-dialog` 74%, `journal-event` 75%.
- (defekt testu EVM-037, poza zakresem) `seedJournal` = „teraz − 30 min”: `EVM-037 AC3` pada w oknie 00:00–00:30 Europe/Warsaw („wczoraj” zamiast „dziś”) — do osobnej historyjki; pozostałe 574 testy e2e zielone.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-035 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC1 — komunikat `412` wg makiety W-06 (a) „Edytuj dane zlecenia” (forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
- 2026-10-11 — ready → in-progress: start realizacji (/deliver), ścieżka pelna (wymuszona kryteriami: 8 AC, 3 recenzentów), gałąź feature/EVM-035-edycja-danych-i-zakresu
- 2026-10-11 — plan gotowy (backend-developer)
- 2026-10-11 — backend gotowy (backend-developer): kontrakt, migracja 0022, API i testy AC1–AC8 (macierz ról, IDOR, limity, wyścigi), dokumentacja; panel — web-developer
- 2026-10-11 — panel gotowy (web-developer): dialog danych, tryb edycji zakresu, dziennik, testy komponentów i E2E (Chromium, Firefox), zrzuty w docs/ux/reviews/EVM-035
- 2026-10-12 — przegląd (runda 1): code-reviewer changes_required (1 major), security-engineer i ux-designer approve; runda 2: code-reviewer approve; blocker/major otwarte: 0
- 2026-10-12 — bramka orkiestratora: `pnpm run gate` zielony (exit 0), coverage:diff linie 98,4% / gałęzie 91,5%; pełne e2e Chromium + Firefox: 574 passed, 14 skipped, 2 pady wyłącznie `EVM-037 AC3` (zależność od pory doby, nie ta historyjka); QA: 871 passed w 3 przeglądarkach, 0 failed
- 2026-10-12 — Koszt: brak rozbicia w $ (sesja bez odczytu `/cost`); agenci workflow 11 wywołań, ok. 1,94 mln tokenów subagentów, 621 wywołań narzędzi, ok. 145 min; rundy poprawek 2 (druga tylko code-reviewer); ścieżka pelna; model z definicji agentów; vs baseline — nie do porównania w $ (więcej niż EVM-037: 1,55 mln i EVM-038: 1,02 mln)
- 2026-10-12 — in-progress → in-review: czeka na demo i akceptację Konrada
- 2026-10-12 — in-review → done: akceptacja Konrada, PR #55 scalony do main (621daac)
