---
id: EVM-000
title: Krótki tytuł
type: story            # story | enabler | spike | bug
milestone: M1
epic: E00 Nazwa epiku
status: draft          # draft | ready | in-progress | in-review | done | blocked
priority: P1           # P0 | P1 | P2 | P3
owner: backend-developer
contributors: []       # np. [web-developer]
reviewers: [code-reviewer]
model: sonnet          # sonnet | opus — model wykonawców w /deliver; owner/contributor solution-architect lub security-engineer → opus albo usuń pole (workflow.md → „Modele i effort agentów”)
depends_on: []
---

# EVM-000: Krótki tytuł

## Historyjka
Jako **<rola>** chcę **<cel>**, aby **<korzyść>**.

## Kontekst
Dlaczego to robimy, powiązania z innymi historyjkami, istotne fakty z domeny.

## Kryteria akceptacji
**AC1 — <nazwa>**
- Zakładając, że …
- Gdy …
- Wtedy …

**AC2 — Uprawnienia**
- Zakładając, że jestem zalogowany jako *Tylko odczyt*
- Gdy …
- Wtedy …

## Poza zakresem
- …

## UX / UI
Ekrany, komponenty ze styleguide'u, stany (pusty / ładowanie / błąd / offline / brak uprawnień), mikrocopy — albo „nie dotyczy”.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | … |
| Edytor | … |
| Tylko odczyt | … |
| Niezalogowany | brak |

Dane, których dotyczy, i wymagane kontrole — albo „nie dotyczy”.

## Notatki techniczne
Ograniczenia, ryzyka, zależności techniczne (wypełnia architekt przy refinemencie, jeśli potrzeba).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją: zakres zmian, kontrakt API, migracje, plan testów AC → testy, ustalenia z konsultacji._

## Decyzje
_Decyzje użytkownika podjęte w trakcie (data, pytanie, decyzja)._

## Uwagi do rozważenia
_Ustalenia nieblokujące z przeglądów (minor / nit) i propozycje pozycji backlogu._

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-000 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- YYYY-MM-DD — utworzono (product-owner)
