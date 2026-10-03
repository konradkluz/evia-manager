---
id: EVM-042
title: Ręczne dodanie i usunięcie procesu lub etapu
type: story
milestone: M1
epic: E4 Procesy i etapy
status: draft
priority: P2
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
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-042 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
