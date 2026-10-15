---
id: EVM-042
title: Ręczne dodanie i usunięcie procesu lub etapu
type: story
milestone: M1
epic: E4 Procesy i etapy
status: in-review
priority: P2
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-035]
---

# EVM-042: Ręczne dodanie i usunięcie procesu lub etapu

## Historyjka
Jako **pracownik biura** chcę **dodać do zlecenia proces albo etap, którego nie było w szablonie, i usunąć zbędny**, aby **dopasować ścieżkę formalną do nietypowej sytuacji bez zmiany szablonów**.

## Kontekst
- Model: „Po utworzeniu wszystko jest edytowalne” (dodawanie i usuwanie procesów i etapów — A, E; „Nie dotyczy” zalecane dla etapów, bo zachowuje historię — weryfikacja biznesowa EVM-002). W zleceniu co najwyżej jeden aktywny proces o danym kodzie.
- Priorytet P2: scenariusze A–D przechodzą na szablonach i „Nie dotyczy” (EVM-032); usunięcie procesów pozostałych po usuniętej pozycji zakresu (EVM-035) — tutaj.
- Makiety: W-06 dodanie i usunięcie procesu i etapu (EVM-071).

## Kryteria akceptacji
**AC1 — Dodanie procesu z szablonu**
- Zakładając zlecenie bez procesu „Opinia ppoż”
- Gdy dodaję proces z listy szablonów procesów
- Wtedy proces pojawia się z etapami „Do zrobienia” na wybranej pozycji; proces o kodzie już aktywnym w zleceniu zwraca `409` z komunikatem.

**AC2 — Dodanie etapu**
- Gdy dodaję etap do procesu (nazwa, pozycja, opcjonalnie termin i osoba odpowiedzialna)
- Wtedy etap ma status „Do zrobienia” i jest uwzględniony w postępie procesu.

**AC3 — Usunięcie procesu lub etapu**
- Gdy usuwam proces albo etap (dialog z zaleceniem „Nie dotyczy” dla etapu)
- Wtedy znika on dla Edytora i Tylko odczyt, Administrator może go przywrócić, a operacja jest audytowana.

**AC4 — Limity i zlecenie zamknięte**
- Gdy proces miałby 31. etap albo zlecenie 31. proces, albo zlecenie jest „Rozliczone” / „Anulowane”
- Wtedy API zwraca odpowiednio `422 limit_exceeded` albo `409 work_order_closed`.

**AC5 — Dziennik**
- Gdy dodaję albo usuwam proces lub etap
- Wtedy w dzienniku powstaje zdarzenie bez wartości danych osobowych (mechanizm EVM-038).

**AC6 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Wtedy A i E dodają i usuwają, przywrócenie — tylko A; R dostaje `403 forbidden`; niezalogowany — `401`; etap innego zlecenia ścieżką zlecenia A — `404`.

**AC7 — Stany**
- Wtedy offline — akcje wyłączone; `412` — komunikat z zachowanymi danymi.

## Poza zakresem
- Edytor szablonów procesów — M4. Kolejność wymuszana między procesami — brak (bez BPMN).

## UX / UI
- W-06 „Procesy i etapy”: akcje „Dodaj proces”, „Dodaj etap”, „Usuń” w menu [P-1], dialogi z EVM-071. Stany: AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | dodanie, usunięcie, przywrócenie |
| Edytor | dodanie, usunięcie |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: bez nowych danych osobowych.
- W AC: SR-AUTHZ-02, SR-AUTHZ-05. W sekcji: SR-API-07, SR-INPUT-02.

## Notatki techniczne
- Moduły: `procedures`, `timeline`, `audit` + panel. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Plan roboczy: `.scratch/EVM-042/plan.md` (nie jest częścią repozytorium). Skrót: 7 operacji w module `procedures` (kanał web) — `createWorkOrderProcedure`, `createProcedureStage`, `deleteWorkOrderProcedure`, `deleteProcedureStage` (A, E), `restoreWorkOrderProcedure`, `restoreProcedureStage`, `listDeletedWorkOrderProcedures` (tylko A); jedna transakcja pod blokadą zlecenia (zapis, audyt, dziennik, projekcja, idempotencja); 6 akcji audytu (nowy typ obiektu `procedure`) i 6 kodów dziennika EVM-038; nowe kody `409 procedure_already_active` i `409 parent_deleted`; `Procedure.version` addytywnie jako ETag procesu. Bez migracji (soft delete i indeksy częściowe z 0019; numer 0033 pozostaje wolny). Panel: W-06 (d) — dialogi dodania i usunięcia, sekcja „Usunięte procesy i etapy” (A).

## Decyzje
- Przywrócenie procesu lub etapu — tylko Administrator, **bez step-upu** (step-up P5 dotyczy wyłącznie przywrócenia zlecenia rozliczonego/anulowanego).
- Usunięcie procesu to soft delete samego procesu: jego etapy znikają przez filtr aktywnego procesu i wracają razem z nim przy przywróceniu.
- `position` większe niż liczba elementów jest przycinane do końca; po usunięciu numeracja 1…n; wersja procesu rośnie przy zmianie jego składu.
- Lista usuniętych ograniczona do 100 procesów i 100 etapów (najnowsze) z flagą `truncated`, bez stronicowania — świadome uproszczenie (zlecenie ma najwyżej 30 aktywnych procesów); stronicowanie dopiero przy realnej potrzebie.
- Audyt i dziennik niosą wyłącznie identyfikatory i kod procesu — bez nazwy etapu (tekst swobodny, możliwe dane osobowe). Kod ręcznego etapu (`custom_` + 12 znaków) nadaje serwer.
- Dodanie procesu wskazuje szablon przez `procedureTemplateCode` (katalog nie ujawnia identyfikatorów szablonów; jak w EVM-035). `201` bez `Location` (brak odczytu pojedynczego procesu/etapu).
- Odstępstwa od makiety W-06 (d): „Usuń…” jako przycisk primary (AlertDialog bez wariantu `danger`, jak w EVM-035), ActionMenu bez separatora grupy niszczącej, „Miejsce”: „Na końcu” / „Po: …”.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-042 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Notatki
- **Do akceptacji Konrada na demo — RR-25 (Low, threat-model):** nazwy etapu nie da się edytować; sprostowanie to usunięcie i dodanie nowego etapu, a stara nazwa (możliwe dane osobowe) zostaje w bazie przez retencję zlecenia i jest widoczna w dzienniku dla A/E/R — usunięcie tylko przez purge zlecenia. Alternatywa: kolejna historyjka z edycją nazwy etapów `custom_` i/lub redakcją przez Administratora ze step-upem (wzorzec TimelineEntry).
- Token mobilny dostaje `403 forbidden` (kod `channel_not_allowed` nie istnieje w aplikacji; starsze opisy w kontrakcie nadal o nim wspominają) — do backlogu: ujednolicenie opisów kontraktu.
- Do backlogu (UX, nit): przy 1280 px nazwy zwiniętych procesów zawijają się w wąskiej kolumnie obok paska postępu (układ sprzed EVM-042, menu „⋮” go zwęża).

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-14 — ready → in-progress: start /deliver w kolejce (ścieżka pełna — dopisana przy starcie, 3 recenzentów wyklucza lekką; gałąź feature/EVM-042-reczne-procesy-etapy ułożona na EVM-043 → EVM-082 → EVM-079 → EVM-080 → EVM-078 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — backend gotowy (backend-developer): 7 operacji, audyt i dziennik, testy `EVM-042 AC1–AC7` w kontenerze; panel (W-06 (d)) czeka na web-developera
- 2026-10-15 — panel gotowy (web-developer): W-06 (d) — „Dodaj proces…”, „Dodaj etap…”, „Usuń proces/etap…” z zaleceniem „Nie dotyczy”, „Usunięte procesy i etapy” z „Przywróć” (A), stany offline/412/409/422; testy komponentów, E2E (Chromium, Firefox, Edge), axe, zrzuty w `docs/ux/reviews/EVM-042/`
- 2026-10-15 — potok `wf_da401e0d-924`: passed po 2 rundach (konsultacja security przed implementacją; runda 1: QA PASS AC1–AC7, code-reviewer i ux-designer APPROVE, security CHANGES — błędny opis sprostowania nazwy etapu w rodo.md; runda 2: poprawka dokumentacji `0a4f290` + RR-25, security APPROVE)
- 2026-10-15 — po przeglądzie: web-developer `f44091d` (CHANGELOG panelu, widoczny powód wyłączenia „Przywróć”, „Usuń” wyłączone bez wersji procesu), ux-designer `edab7de` (styleguide: Disclosure z akcjami, opcja Select niedostępna)
- 2026-10-15 — orkiestrator: `pnpm run gate` zielony (diff-coverage 1488/1505, 1094/1171), `docs:check` 0/0; in-progress → in-review
- 2026-10-15 — Koszt: brak rozbicia w $; potok 11 wywołań agentów, ok. 1,63 mln tokenów subagentów, ok. 176 min (+ poprawki po przeglądzie); rundy poprawek 1; ścieżka pełna; model domyślny
