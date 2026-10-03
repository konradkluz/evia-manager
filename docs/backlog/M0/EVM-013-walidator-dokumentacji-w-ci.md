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
- Dług przekazany z EVM-012 (przegląd `solution-architect` 2026-10-02, szczegóły: EVM-012 → „Plan techniczny” → „Ustalenia z konsultacji”): Vitest zamiast `node:test`; `checkJs` albo `.ts` (w Node 26 type stripping jest stabilny); uruchomienie testów walidatora na Linuksie w CI (w EVM-012 część Linux/macOS AC3 może zostać „do potwierdzenia w CI”); `--experimental-test-coverage` jest nadal eksperymentalne także w Node 26; `engines` → Node 26 i `tools/*` jako workspace (wspólnie z EVM-006).

Do uwzględnienia (przegląd poprawek EVM-012, 2026-10-03): testy czasu 200 KB w `tools/docs-lifecycle/test/references.test.mjs` — `timeout` nie przerywa kodu synchronicznego (w CI regresja = zawieszenie joba); przenieść do `worker_threads` z przerwaniem albo test proporcji czasu. Nity: flaga `classError` zamiast listy `CLASS_ERRORS` w `analyze.mjs`; lista „błędów klasy” w polityce; dokładniejsza asercja testu `.MD`.

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
- 2026-10-03 — dopisano dług techniczny przekazany z EVM-012 („Notatki techniczne”) (product-owner)
