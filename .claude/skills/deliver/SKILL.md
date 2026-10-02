---
name: deliver
description: Realizuje jedną historyjkę EVM-### (status ready) przez pełny cykl zespołu agentów — plan, implementacja TDD, weryfikacja QA, przeglądy (kod, bezpieczeństwo, UX), pętla poprawek, Definition of Done, demo i akceptacja użytkownika. Użycie — /deliver EVM-012
argument-hint: <EVM-ID>
disable-model-invocation: true
---

# Realizacja historyjki $ARGUMENTS

Jesteś orkiestratorem (Tech Lead). Proces: `docs/process/workflow.md`. Nie pomijaj kroków ani bramek.

## 1. Gotowość (DoR)
1. Znajdź plik `docs/backlog/**/$ARGUMENTS-*.md`. Brak → zatrzymaj się.
2. Sprawdź `docs/process/definition-of-ready.md`: status `ready`, numerowane AC, uzupełnione `owner` i `reviewers`, wszystkie `depends_on` w statusie `done`. Niespełnione → wypisz braki i zaproponuj `/refine $ARGUMENTS`.
3. WIP: jeśli inna historyjka z kodem ma status `in-progress` lub `in-review` — zapytaj użytkownika, czy kontynuować.
4. Git: drzewo robocze czyste (`git status`). Gdy repozytorium jeszcze nie istnieje (przed EVM-006) — zapytaj o `git init` i pierwszy commit. Utwórz gałąź `feature/$ARGUMENTS-<krótki-slug>` od aktualnego `main`.
5. Ustaw w historyjce `status: in-progress`, dopisz wpis w „Dziennik”. Poinformuj użytkownika jednym zdaniem o starcie.

## 2. Potok agentów (workflow `deliver-story`)
Uruchom narzędziem Workflow zapisany workflow `deliver-story` z `args`:
`{ storyId, storyPath, branch, today: "YYYY-MM-DD", owner, contributors, reviewers, appUrl?, userNotes? }`
— `owner` / `contributors` / `reviewers` z frontmatter historyjki; `userNotes` — decyzje użytkownika z tej rozmowy, jeśli są.
Workflow wykonuje: plan techniczny → konsultacje (architekt / UX / security, gdy potrzebne) → implementację w TDD → weryfikację QA → przeglądy równolegle → poprawki blocker/major (maks. 3 rundy weryfikacji).
Gdy narzędzie Workflow jest niedostępne — wykonaj te same kroki ręcznie narzędziem Agent, w tej samej kolejności i z tymi samymi bramkami.

## 3. Obsługa wyniku workflow
- `blocked` → przedstaw pytania (AskUserQuestion, rekomendowana odpowiedź jako pierwsza), zapisz decyzje w historyjce (sekcja „Decyzje”) i uruchom workflow ponownie **jako nowy przebieg** (bez resume) z decyzjami w `userNotes`.
- `needs-attention` → pokaż otwarte problemy i historię rund; zaproponuj: kolejna runda / podział historyjki / zmiana AC. Decyduje użytkownik.
- `passed` → krok 4.

## 4. Weryfikacja orkiestratora i DoD
1. Sam uruchom bramkę jakości (komendy z `CLAUDE.md`) i porównaj wynik z raportem — nie ufaj w ciemno.
2. Przejdź checklistę DoD w historyjce (`docs/process/definition-of-done.md`) i odhacz punkty z dowodami. Uwagi nieblokujące (minor / nit) → sekcja „Uwagi do rozważenia” + propozycje pozycji backlogu.
3. Sprawdź `CHANGELOG.md` (sekcja Unreleased) i dokumentację.
4. Ustaw `status: in-review`, dopisz wpis w „Dziennik”.

## 5. Demo i akceptacja
Przedstaw zwięźle: co dostarczono · tabela AC → status → dowód · „jak to sprawdzić” (kroki, adres, zrzuty) · testy i pokrycie · wyniki przeglądów · kryteria `manual` do ręcznego sprawdzenia · znane ograniczenia.
Zapytaj (AskUserQuestion): **Akceptuję** / **Poprawki** / **Odrzucam**.
- Akceptuję → squash merge do `main` (Conventional Commits z ID), `status: done`, wpis w „Dziennik”. `git push` tylko po potwierdzeniu użytkownika.
- Poprawki → zapisz uwagi w historyjce i wróć do kroku 2 z `userNotes`.
- Odrzucam → `status: blocked` z uzasadnieniem; bez merge.

Na koniec jedno zdanie o następnym kroku (np. na podstawie `/progress`).
