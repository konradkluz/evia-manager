---
name: milestone
description: Planowanie lub zamknięcie kamienia milowego EVia Manager. "/milestone plan M1" — dekompozycja na epiki i historyjki spełniające DoR (product-owner + architekt + UX + security) do akceptacji użytkownika. "/milestone close M1" — przegląd celów, checklista wydania, security sign-off, retrospektywa, sprzątanie dokumentacji (za zgodą użytkownika) i propozycje ulepszeń procesu oraz agentów.
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
4. **Retrospektywa:** co działało, co nie (liczba rund poprawek, powtarzające się ustalenia z przeglądów, blokady, czas oczekiwania na decyzje); konkretne propozycje zmian w `CLAUDE.md`, agentach (`.claude/agents/`), workflow i szablonach — wprowadzane po akceptacji użytkownika. Przenieś wnioski z dowodów QA/UX, notatek i spike'ów kamienia (`docs/qa/`, `docs/ux/reviews/`, `docs/notes/`, `spikes/`) do historyjek („Uwagi do rozważenia”) i retrospektywy; przejrzyj aktualność dokumentów żywych (rozbieżność → poprawka albo pozycja backlogu). Zapis: `docs/process/retros/<M#>.md`.
5. **Sprzątanie dokumentacji** (zasady: `docs/process/document-lifecycle.md`) — bez decyzji użytkownika żaden plik nie jest usuwany ani przenoszony:
   1. `npm run docs:check` — 0 błędów (błędy napraw przed raportem).
   2. `npm run docs:cleanup -- <M#>` — raport sprzątania (tylko odczyt).
   3. Przedstaw raport użytkownikowi i zapytaj (AskUserQuestion) o pozycje „usuń”: **wszystkie** / **wybrane** (lista) / **żadne**. Pozycje „przejrzyj” — decyzja użytkownika per pozycja: aktualizacja treści, dodanie odwołania, nowy termin (`review_by` / `expires`), pozostawienie bez zmian albo usunięcie.
   4. Wykonaj wyłącznie zaakceptowane pozycje: `git rm -- <ścieżka>`, katalog spike'a `git rm -r -- spikes/<nazwa>/` — nic poza nimi.
   5. Plik klasy „kamień milowy”, którego użytkownik nie usuwa, dostaje `expires: YYYY-MM-DD` (we frontmatterze; dla spike'a — w `spikes/<nazwa>/README.md`; termin proponujesz, zatwierdza użytkownik) — wróci w raporcie jako „przejrzyj”.
   6. W `docs/process/retros/<M#>.md` dopisz sekcję **„Sprzątanie dokumentacji”**: data, decyzja użytkownika, lista usuniętych ścieżek, pozycje pozostawione (powód i `expires`), decyzje dla pozycji „przejrzyj” oraz informacja, że usunięte pliki można odtworzyć z historii git (polecenia w polityce).
   7. Ponownie `npm run docs:check` — 0 błędów; commit na gałęzi zamknięcia kamienia (merge do `main` wyłącznie za zgodą użytkownika).
6. Zaktualizuj roadmapę (status kamienia, wnioski, korekta planu kolejnych).
