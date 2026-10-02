---
id: EVM-013
title: Walidator cyklu życia dokumentacji jako bramka CI
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
owner: devops-engineer
contributors: []
reviewers: [code-reviewer]
depends_on: [EVM-006, EVM-012]
---

# EVM-013: Walidator cyklu życia dokumentacji jako bramka CI

## Historyjka
Jako **właściciel produktu** chcę, **aby walidator dokumentacji z EVM-012 automatycznie blokował merge zmian łamiących politykę cyklu życia dokumentów**, aby **porządek w dokumentacji nie zależał od pamięci agentów**.

## Kontekst
Decyzja Konrada (2026-10-02, refinement EVM-012): do czasu CI walidator tylko raportuje; blokada w CI powstaje po EVM-006. Do doprecyzowania przez `/refine EVM-013`.

## Kryteria akceptacji
_Do uzupełnienia w `/refine` (szkic: walidator jako krok bramki CI blokujący merge przy błędach; ostrzeżenia widoczne w podsumowaniu CI; testy skryptu w runnerze monorepo; ewentualnie hook pre-commit)._

## Poza zakresem
_—_

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
_Do uzupełnienia._

## Notatki techniczne
_—_

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
_Do uzupełnienia w `/refine`._

## Dziennik
- 2026-10-02 — utworzono jako szkic (orkiestrator, refinement EVM-012)
