---
id: EVM-031
title: Procesy i etapy w zleceniu — z szablonu, osoba odpowiedzialna i termin
type: story
milestone: M1
epic: E4 Procesy i etapy
status: done
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-030]
---

# EVM-031: Procesy i etapy w zleceniu — z szablonu, osoba odpowiedzialna i termin

## Historyjka
Jako **pracownik biura** chcę **żeby nowe zlecenie od razu miało procesy z etapami z szablonu, z osobą odpowiedzialną i terminem przy etapie**, aby **wiedzieć, co jest do zrobienia w OSD, z administracją i na budowie oraz kto się tym zajmuje**.

## Kontekst
- Kompozycja narasta: ta historyjka rejestruje kontrybutora `procedures` w porcie `WorkOrderCompositionContributor` z EVM-022 (konsultacja `solution-architect` B3). Bez backfillu — zlecenia utworzone wcześniej (dane syntetyczne) nie dostają procesów.
- Model: `Procedure`, `ProcedureStage`, „Kompozycja zlecenia z szablonu” krok 4; szablony procesów — EVM-019.
- PO-8 (EVM-004): zlecenie zamknięte jest tylko do odczytu dla zakresu, procesów i płatności — reguła już jest w modelu, ta historyjka dodaje egzekwowanie dla etapów.
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) → „Procesy i etapy” (Disclosure [P-2], postęp [P-6]). Scenariusze: C2, A9.

## Kryteria akceptacji
**AC1 — Procesy z szablonu**
- Zakładając szablon „Garaż — pełny proces”
- Gdy tworzę zlecenie
- Wtedy powstaje 9 procesów w kolejności z szablonu, każdy z etapami w stanie „Do zrobienia”, w tej samej transakcji co zlecenie (błąd kontrybutora — brak zlecenia); proces o kodzie już utworzonym w tym zleceniu nie powstaje drugi raz
- Oraz karta szablonu w W-05 pokazuje liczbę procesów („9 pozycji · 9 procesów”), a podgląd szablonu — sekcję „Procesy (9)” z liczbą etapów każdego procesu (część ukryta w EVM-022, AC1).

**AC2 — Widok procesów**
- Gdy otwieram W-06 → „Procesy i etapy (9)”
- Wtedy każdy proces jest sekcją rozwijaną z postępem („3 z 7 etapów”, „Wszystkie zakończone”), jest „Rozwiń wszystkie”, a etap pokazuje nazwę, odznakę statusu, termin i „Osoba odpowiedzialna: Anna Testowa”.

**AC3 — Osoba odpowiedzialna i termin**
- Gdy Edytor ustawia przy etapie osobę odpowiedzialną (lista użytkowników — `id`, `displayName`) i termin
- Wtedy zmiana zapisuje się z `If-Match` (`412` — dane zostają), a etap z terminem wcześniejszym niż dziś (zegar `Europe/Warsaw`: termin 2026-10-02, dziś 2026-10-03) ma `alarm-clock` i „po terminie”.

**AC4 — Ostrzeżenie przy zakończeniu zlecenia**
- Zakładając zlecenie „W realizacji” z 4 otwartymi etapami
- Gdy wybieram „Zakończ”
- Wtedy dialog ostrzega o 4 otwartych etapach, ale nie blokuje zakończenia.

**AC5 — Zlecenie zamknięte (PO-8)**
- Zakładając zlecenie „Rozliczone”
- Gdy zmieniam osobę odpowiedzialną albo termin etapu
- Wtedy API zwraca `409 work_order_closed` (nowy kod — dopisany addytywnie do katalogu `api-guidelines.md` w tej historyjce), a w panelu akcje są wyłączone z podpowiedzią.

**AC6 — Etap innego zlecenia (SR-AUTHZ-02, SR-INPUT-02)**
- Gdy wysyłam zmianę etapu zlecenia B ścieżką `/api/v1/work-orders/{A}/procedure-stages/{etap B}` albo wskazuję nieistniejącego użytkownika jako odpowiedzialnego
- Wtedy API zwraca odpowiednio `404 not_found` i `400 validation_failed`.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda odczytuje i zmienia etap
- Wtedy A i E zmieniają, R tylko widzi (`403 forbidden` przy zmianie), niezalogowany dostaje `401`; operacje są w macierzy ról z przypadkiem IDOR.

**AC8 — Stany**
- Wtedy: zlecenie bez procesów — „Zlecenie nie ma jeszcze procesów.”; ładowanie — Skeleton sekcji; offline — akcje wyłączone; błąd sekcji — alert z „Spróbuj ponownie”.

## Poza zakresem
- Zmiana statusu etapu i „Czekamy na…” — EVM-032. Dodanie i usunięcie procesu lub etapu — EVM-042 (P2); procesy z nowych pozycji zakresu — EVM-035.
- Domyślne terminy etapów — M3. Przypomnienia — M3.

## UX / UI
- W-06 sekcja „Procesy i etapy”: Disclosure [P-2], postęp [P-6], List (§ 3.6), StatusBadge statyczna (do EVM-032), Select osoby, DatePicker; formy bezosobowe.
- Stany: AC8; brak uprawnień — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | podgląd, osoba odpowiedzialna, termin |
| Edytor | podgląd, osoba odpowiedzialna, termin |
| Tylko odczyt | podgląd |
| Niezalogowany | brak (`401`) |

- Dane: `ProcedureStage.responsibleUserId` (DO-P), notatki etapu (pole swobodne).
- W AC: SR-AUTHZ-02, SR-INPUT-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-AUTHZ-04, SR-INPUT-01, SR-API-07 (`If-Match`), SR-DATA-01 (klasyfikacja `ProcedureStage` bez zmian).

## Notatki techniczne
- Moduły: `procedures` (zapis, kontrybutor kompozycji), `work-orders` (port), fasada `identity` + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
- Ostrzeżenie AC4 w „Zakończ” znika bez komunikatu, gdy odczyt procesów się nie powiódł (code-reviewer, minor) — pokazać neutralny komunikat „Nie udało się sprawdzić otwartych etapów”.
- Komentarz w `apps/api/coverage.config.ts` o plikach `procedures` jest odwrotny do działania `DATABASE_BOUND` (minor) — poprawić.
- Test wyścigu blokady w `procedure-stages.test.ts` używa `setTimeout(300)` — zastąpić czekaniem na warunek (pg_locks); zakres terminu zduplikowany w panelu, API i migracji (nit).
- GET procesów nie wlicza się do P10 (tylko displayName pracowników) — ocenić ponownie w EVM-032 (notes, waitingOn).
- `UserDirectory.displayNamesOf` ma limit 100 id — GET dzieli id na paczki; filtr „Osoba” i lista kont: EVM-024.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-031 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] `api-guidelines.md` (kod `work_order_closed`) i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): przywrócenie procesów w karcie i podglądzie szablonu W-05 (AC1)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-09 — ready → in-progress (/deliver; ścieżka pelna wybrana przez Konrada: 8 AC, uprawnienia, dane osobowe; gałąź feature/EVM-031-procedures-and-stages)
- 2026-10-09 — implementacja backendu AC1–AC8 (backend-developer): moduł `procedures`, migracja `0019`, kontrakt `listWorkOrderProcedures` / `updateProcedureStage`, kod `work_order_closed`; panel (sekcja W-06, dialog AC4, karta i podgląd szablonu) — web-developer
- 2026-10-09 — implementacja panelu AC1–AC8 (web-developer): sekcja „Procesy i etapy” w W-06, dialog zmiany etapu, ostrzeżenie w „Zakończ”, procesy w karcie i podglądzie szablonu, ProcedureProgress i odznaka etapu w ui-web
- 2026-10-09 — implementacja i przeglądy (backend-developer, web-developer): moduł procedures, migracja 0019, 2 endpointy, sekcja W-06, dialog AC4; QA pass; code-reviewer, security-engineer, ux-designer — approve (1 runda); orkiestrator: pnpm run gate EXIT 0, docs:check 0/0, coverage:diff linie 97,0% / gałęzie 91,5%; → in-review
- 2026-10-09 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,12 mln tokenów subagentów, 8 agentów, 438 wywołań narzędzi, 1 runda, ok. 93 min (z przerwaniem i wznowieniem po pytaniu użytkownika); ścieżka pelna; vs baseline: brak danych
- 2026-10-09 — zaakceptowane przez Konrada, scalone do main (PR #46) → done
