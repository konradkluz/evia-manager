---
name: milestone
description: Planowanie lub zamknięcie kamienia milowego EVia Manager. "/milestone plan M1" — dekompozycja na epiki i historyjki spełniające DoR (product-owner + architekt + UX + security) do akceptacji użytkownika. "/milestone close M1" — przegląd celów, checklista wydania, security sign-off, retrospektywa i propozycje ulepszeń procesu oraz agentów.
argument-hint: plan|close <M#>
disable-model-invocation: true
---

# Kamień milowy: $ARGUMENTS

Pierwsze słowo argumentu to tryb (`plan` albo `close`), drugie — kamień milowy (np. `M1`). Opis kamieni: `docs/product/roadmap.md`.

## Tryb `plan`
1. **product-owner**: rozpisz epiki kamienia z roadmapy na historyjki w `docs/backlog/<M#>/` wg szablonu (status `draft`) — AC, zależności, priorytety, `owner` / `contributors` / `reviewers`. Zaproponuj kolejność (najpierw pionowy szkielet, potem rozszerzenia) i punkt „pilota” — najwcześniejszy moment, w którym użytkownik może zacząć korzystać.
2. Równolegle przegląd planu: **solution-architect** (wykonalność, zależności techniczne, ryzyka, spike'i), **ux-designer** (spójność przepływów, brakujące ekrany), **security-engineer** (wymagania bezpieczeństwa do wplecenia w AC). Uwagi przekaż product-owner do naniesienia.
3. Przedstaw użytkownikowi: lista historyjek (ID, tytuł, priorytet, zależności), kolejność, ryzyka, pytania. Po akceptacji historyjki z kompletem DoR → `ready`; pozostałe zostają `draft` do `/refine`.

## Tryb `close`
1. Sprawdź kryteria wyjścia z roadmapy; wypisz historyjki niezakończone (przenieść / odrzucić — decyzja użytkownika).
2. Checklista wydania: bramki CI zielone; **security-engineer** — sign-off (model zagrożeń, skany, DAST na staging); **devops-engineer** — backup i test odtworzenia, monitoring, runbooki; dokumentacja i `CHANGELOG.md` (numer wersji); notatki wydania dla użytkowników po polsku.
3. Wdrożenie produkcyjne — **wyłącznie po wyraźnej zgodzie użytkownika**.
4. **Retrospektywa:** co działało, co nie (liczba rund poprawek, powtarzające się ustalenia z przeglądów, blokady, czas oczekiwania na decyzje); konkretne propozycje zmian w `CLAUDE.md`, agentach (`.claude/agents/`), workflow i szablonach — wprowadzane po akceptacji użytkownika. Zapis: `docs/process/retros/<M#>.md`.
5. Zaktualizuj roadmapę (status kamienia, wnioski, korekta planu kolejnych).
