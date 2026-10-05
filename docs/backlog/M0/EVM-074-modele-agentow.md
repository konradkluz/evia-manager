---
id: EVM-074
title: Model i effort agentów oraz model realizacji historyjki
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
priority: P1
owner: devops-engineer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: []
---

# EVM-074: Model i effort agentów oraz model realizacji historyjki

## Historyjka
Jako **Konrad (właściciel produktu)** chcę, **aby każdy agent miał ustalony model i effort, a historyjka mogła wskazać model swojej realizacji**, aby **koszt i czas realizacji odpowiadały trudności pracy, a nie ustawieniom sesji**.

## Kontekst
- Pomiar z realizacji EVM-013 (2026-10-05): wszyscy agenci działali na modelu `opus` (trzech przez `model: opus`, reszta przez `inherit` z sesji) i z effortem sesji `max`; ok. 95% kosztu to wczytywany kontekst. Konrad zdecydował (rozmowa w sesji `/deliver EVM-013`): przygotować pakiet zmian procesu, a model i effort agentów — od razu.
- Mechanizmy Claude Code (dokumentacja `code.claude.com/docs/en/sub-agents`): frontmatter agenta `model` (`sonnet` | `opus` | `haiku` | `fable` | ID modelu | `inherit`) i `effort` (`low` … `max`; wartość agenta wygrywa z effortem sesji); parametr `model` wywołania agenta wygrywa z frontmatter; workflow: `agent(…, { model, effort })`.

## Kryteria akceptacji
**AC1 — Jawny model i effort każdego agenta**
- Zakładając definicje agentów w `.claude/agents/`,
- Gdy orkiestrator albo workflow uruchamia agenta,
- Wtedy agent działa na modelu i effortcie ze swojego frontmatter (`sonnet` lub `opus`; `low` … `xhigh` — nigdy `inherit` ani `max`), zgodnych z tabelą w `docs/process/workflow.md` → „Modele i effort agentów”; niezgodność albo brak pola kończy test `tools/repo-policy` błędem.

**AC2 — Model realizacji z historyjki**
- Zakładając historyjkę z polem `model` we frontmatter,
- Gdy `/deliver` uruchamia workflow `deliver-story`,
- Wtedy plan, implementacja i poprawki działają na tym modelu, a QA, przeglądy i konsultacje — na modelach z definicji agentów; bez pola każdy agent zostaje przy swojej definicji; wartość spoza `sonnet` / `opus` zatrzymuje workflow przed startem pierwszego agenta z czytelnym komunikatem.

**AC3 — Pole w procesie**
- Zakładając nową historyjkę albo refinement,
- Gdy `product-owner` przygotowuje historyjkę,
- Wtedy szablon ma pole `model: sonnet`, DoR i `/refine` opisują, kiedy proponować `opus` (kryteria w `workflow.md`), a `/deliver` przekazuje pole do workflow.

## Poza zakresem
- Pozostałe elementy pakietu zmian procesu (ścieżka lekka i pełna według ryzyka, krótszy szablon historyjki, podział największych dokumentów, odchudzenie `CLAUDE.md`) — osobna propozycja po EVM-013.
- Uzupełnianie pola `model` w istniejących historyjkach (brak pola = modele z definicji agentów).
- Zmienna `CLAUDE_CODE_SUBAGENT_MODEL` w `.claude/settings.json` — niepotrzebna, bo każdy agent projektu ma jawny model.

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Nie dotyczy danych ani aplikacji. `.claude/` jest na liście plików wrażliwych (K3) — Konrad potwierdza zmianę w checkliście PR.

## Notatki techniczne
Test AC2 uruchamia prawdziwy skrypt `.claude/workflows/deliver-story.js` z atrapami `agent`, `parallel`, `phase` i `log` (moduł tymczasowy: literał `meta` + ciało skryptu w funkcji), więc sprawdza faktyczne opcje wywołań agentów.

## Plan techniczny
Zrealizował orkiestrator (drobna zmiana konfiguracji na prośbę Konrada), w TDD:
1. Test `tools/repo-policy/test/agents.test.ts` (`EVM-074 AC1–AC3`) — czerwony 7/7.
2. Frontmatter `.claude/agents/*.md`: `model` i `effort` według tabeli.
3. `deliver-story.js`: argument `model` (dozwolone `sonnet`, `opus`) dla planu, implementacji i poprawek; `model` w wyniku workflow.
4. `/deliver`, `/refine`, szablon historyjki, DoR, `workflow.md` („Modele i effort agentów”), `CLAUDE.md`, indeksy backlogu, `CHANGELOG.md`.

## Decyzje
2026-10-05 (Konrad, sesja `/deliver EVM-013`):
1. Zmiana procesu — pakiet do akceptacji; model i effort agentów — zrobić od razu, „jak najlepiej i najbardziej efektywnie”. AC spisał orkiestrator; Konrad akceptuje je razem z przyrostem (PR).

## Uwagi do rozważenia
- Po pierwszej realizacji na nowych ustawieniach sprawdzić w `/tasks` model i effort agentów workflow oraz porównać koszt z EVM-013.

## Definition of Done
- [x] AC1–AC3 pokryte testami (`EVM-074 AC#`, `tools/repo-policy/test/agents.test.ts`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przegląd `code-reviewer` — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja Konrada (PR; `.claude/` — plik wrażliwy K3)

## Dziennik
- 2026-10-05 — utworzono na prośbę Konrada; realizacja w TDD i status `in-review` (orkiestrator)
