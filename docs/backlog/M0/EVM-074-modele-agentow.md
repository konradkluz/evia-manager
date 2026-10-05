---
id: EVM-074
title: Model i effort agentów oraz model realizacji historyjki
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
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
- Wtedy plan, implementacja i poprawki działają na tym modelu; `opus` podnosi też przeglądy, a `sonnet` ich nie obniża; QA i konsultacje zostają przy modelach z definicji agentów, a effort zawsze pochodzi z definicji; bez pola każdy agent zostaje przy swojej definicji; wartość spoza `sonnet` / `opus` zatrzymuje workflow przed startem pierwszego agenta z czytelnym komunikatem.

**AC3 — Pole w procesie**
- Zakładając nową historyjkę albo refinement,
- Gdy `product-owner` przygotowuje historyjkę,
- Wtedy szablon ma pole `model: sonnet`, DoR, `/refine` i indeks backlogu opisują, kiedy proponować `opus` (kryteria w `workflow.md`), `/deliver` sprawdza pole w DoR i przekazuje je do workflow (także w trybie ręcznym), a test w `tools/repo-policy` nie dopuszcza historyjki, której `model: sonnet` obniżyłby wykonawcę z `opus` w definicji (`solution-architect`, `security-engineer`).

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

Po przeglądzie `code-reviewer` (orkiestrator; do akceptacji Konrada w PR):

2. **`opus` w historyjce podnosi też przeglądy, `sonnet` ich nie obniża** — w trudnej historyjce niezależny recenzent nie jest słabszy od wykonawcy (ustalenie m12).
3. **`sonnet` nie obniża agentów na `opus`** — gdy wśród wykonawców jest `solution-architect` albo `security-engineer`, pole ma wartość `opus` albo go nie ma; pilnuje tego test (ustalenie M1: np. EVM-064, EVM-065 i EVM-070 mają ownera `security-engineer`).

## Uwagi do rozważenia
- Po pierwszej realizacji na nowych ustawieniach sprawdzić w `/tasks` model i effort agentów workflow oraz porównać koszt z EVM-013.
- Test `agents.test.ts` (moduł tymczasowy importowany przez `file://`) sprawdzony na Linuksie (lokalnie i w CI); na Windows — przy najbliższej pracy lokalnej (ADR-0015).
- Funkcja `section()` jest zdublowana w `agents.test.ts` i `docs.test.ts` — do przeniesienia do `src/files.ts` przy kolejnej zmianie `tools/repo-policy`.
- Atrapa workflow nie obejmuje konsultacji `ux-designer`, poprawek przez agenta spoza wykonawców ani contributora (ten sam kod co objęte ścieżki).

## Definition of Done
- [x] AC1–AC3 pokryte testami (`EVM-074 AC#`, `tools/repo-policy/test/agents.test.ts`)
- [x] Bramki CI zielone, progi pokrycia spełnione (PR #9: przebiegi 41 i 46; `main`: przebieg 47)
- [x] Przegląd `code-reviewer` — runda 1: CHANGES REQUIRED (1 major, minor) → poprawki w `d1a4f4a` z testami (10/10); bez rundy 2 — Konrad zaakceptował przyrost, scalając PR #9
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja Konrada (PR; `.claude/` — plik wrażliwy K3)

## Dziennik
- 2026-10-05 — utworzono na prośbę Konrada; realizacja w TDD i status `in-review` (orkiestrator)
- 2026-10-05 — przegląd `code-reviewer` (model `sonnet`): CHANGES REQUIRED — 1 major (M1: `sonnet` obniżałby agentów na `opus`), minor; poprawione: reguła i test M1, przeglądy na `opus` w historyjkach `opus`, kontrola `model` w DoR `/deliver` i tryb ręczny, effort bez zmian, opis w indeksie backlogu, README `tools/repo-policy`, roadmapa, mocniejsze asercje testu (koniec `meta`, `effort`, kryteria `opus`) — test 10/10 (orkiestrator)
- 2026-10-05 — PR #9 (`feat(agents): pin model and effort per agent and add the story model [EVM-074]`) z konfliktem indeksu backlogu po EVM-013 rozwiązanym merge'em `main` (`71cf5a6`); scalony przez Konrada (`2e0229e`); Konrad zaakceptował AC i przyrost razem z PR. in-review → done (orkiestrator)
- 2026-10-05 — **incydent K6** (`docs/ops/github-i-ci.md` → „Czerwony `main`”): `main-integrity` (przebieg 10) czerwony dla `2e0229e` — „brak zielonego `ci-gate` dla HEAD PR `71cf5a6`”. Przyczyna: scalenie o 18:44:17 UTC, gdy przebieg `ci` na `71cf5a6` (po merge'u `main`) jeszcze trwał; zakończył się zielonym `ci-gate` o 18:45:24, a `ci` na `main` po scaleniu (przebieg 47) jest zielony — kod sprawdzony, revert niepotrzebny. K6 sprawdza stan `ci-gate` w chwili przebiegu, więc kolejny przebieg K6 (push na `main` albo nocny) jest zielony bez wpisu w `ACKNOWLEDGED`. Wniosek do retrospektywy M0: scalać dopiero przy zielonym `ci-gate` na **ostatnim** commicie (checklista PR), także po merge'u `main` do gałęzi (orkiestrator)
