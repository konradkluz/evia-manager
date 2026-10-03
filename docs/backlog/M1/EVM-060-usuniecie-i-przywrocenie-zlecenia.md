---
id: EVM-060
title: Usunięcie i przywrócenie zlecenia (Administrator)
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: ready
priority: P2
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-058]
---

# EVM-060: Usunięcie i przywrócenie zlecenia (Administrator)

## Historyjka
Jako **Administrator** chcę **usunąć zlecenie założone przez pomyłkę i w razie potrzeby je przywrócić**, aby **lista zawierała tylko prawdziwe zlecenia — bez możliwości ukrycia wystawionej faktury**.

## Kontekst
- Uwaga 1 EVM-002 (soft delete zlecenia z transzami `paid` bez step-upu łamie zasadę ścieżek) — rozstrzygnięcie w tej historyjce razem z aktualizacją `domain-model.md` (konsultacja `solution-architect`, W7). Rekomendacja `security-engineer` (SR-AUTHZ-10): z transzą `paid` — tylko Administrator ze step-upem; z transzą `invoiced` — `409 has_active_dependents`.
- Priorytet P2: anulowanie zlecenia (EVM-030) wystarcza do pracy; usunięcie porządkuje pomyłki (decyzja 11).
- Nowa operacja wrażliwa (ścieżka obok korekt płatności — AB-17): na prod najwcześniej z sign-off EVM-070 albo po osobnym przeglądzie `security-engineer` (README M1 → „Punkt pilota” → „Wdrożenia prod w trakcie pilota B”).
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) — menu `⋮` „Usuń zlecenie”.

## Kryteria akceptacji
**AC1 — Usunięcie zlecenia bez faktur**
- Zakładając zlecenie z transzami wyłącznie „Planowana” albo „Anulowana”
- Gdy Administrator wybiera „Usuń zlecenie” i potwierdza dialog
- Wtedy zlecenie znika dla Edytora i Tylko odczyt (lista, wyszukiwanie, `404` po `id`, encje podrzędne niedostępne), a zdarzenie trafia do audytu.

**AC2 — Zlecenie z transzą wystawioną (SR-AUTHZ-10)**
- Zakładając transzę „Wystawiona”
- Gdy Administrator próbuje usunąć zlecenie
- Wtedy API zwraca `409 has_active_dependents`, a panel pokazuje „Nie można usunąć zlecenia z wystawioną fakturą.”

**AC3 — Zlecenie z transzą opłaconą (SR-SESS-08)**
- Zakładając transzę „Opłacona”
- Gdy Administrator usuwa zlecenie
- Wtedy wymagane jest potwierdzenie tożsamości w W-04 (`403 step_up_required` bez niego), a po nim usunięcie się wykonuje i jest audytowane.

**AC4 — Przywrócenie**
- Zakładając usunięte zlecenie
- Gdy Administrator włącza na W-10 filtr „Usunięte” (widoczny tylko dla niego) i wybiera „Przywróć”
- Wtedy zlecenie z encjami podrzędnymi wraca dla wszystkich ról, a operacja jest audytowana.

**AC5 — Brak obejść (SR-AUTHZ-10, SR-AUTHZ-05)**
- Zakładając Edytora
- Gdy próbuje usunąć zlecenie
- Wtedy pozycja jest wyłączona z podpowiedzią „Usunąć zlecenie może tylko administrator.”, API zwraca `403 forbidden`, a testy ścieżek potwierdzają, że usunięcie zlecenia nie jest drogą do skutku korekty płatności.

**AC6 — Uprawnienia i stany**
- Wtedy R nie widzi akcji (`403`), niezalogowany — `401`; offline — akcja wyłączona; `412` — komunikat z odświeżeniem.

## Poza zakresem
- Trwałe usunięcie zlecenia (purge) — M4 (retencja, P4).

## UX / UI
- W-06: menu `⋮` „Usuń zlecenie”, AlertDialog (danger), W-04; W-10: filtr „Usunięte” (A). Stany: AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie (ze step-upem przy transzy opłaconej), przywrócenie |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: zlecenie z encjami podrzędnymi (soft delete — odwracalny).
- W AC: SR-AUTHZ-10, SR-SESS-08, SR-AUTHZ-05. W sekcji: SR-DATA-08, SR-LOG-03.

## Notatki techniczne
- Moduły: `work-orders`, `payments` (warunek przez port uczestnika), `audit` + panel.
- Aktualizacja reguły soft delete `WorkOrder` w `domain-model.md` (uwaga 1 EVM-002) — przegląd `solution-architect`.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-060 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] `domain-model.md` i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): warunek wdrożenia na prod (najwcześniej z sign-off EVM-070)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
