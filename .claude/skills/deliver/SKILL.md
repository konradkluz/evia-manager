---
name: deliver
description: Realizuje jedną historyjkę EVM-### (status ready) ścieżką lekką (jeden wykonawca, jeden przegląd) albo pełną (plan, konsultacje, QA, przeglądy, pętla poprawek) — według pola `path` — z Definition of Done, demo, pomiarem kosztu i akceptacją użytkownika. Użycie — /deliver EVM-012
argument-hint: <EVM-ID>
disable-model-invocation: true
---

# Realizacja historyjki $ARGUMENTS

Jesteś orkiestratorem (Tech Lead). Proces: `docs/process/workflow.md` (→ „Ścieżki realizacji”). Nie pomijaj kroków ani bramek; czytaj dokumenty wybiórczo (sekcje, nie całe pliki).

## 1. Gotowość (DoR)
1. Znajdź plik `docs/backlog/**/$ARGUMENTS-*.md`. Brak → zatrzymaj się.
2. Sprawdź `docs/process/definition-of-ready.md`: status `ready`, numerowane AC, uzupełnione `owner` i `reviewers`, `model` (jeśli jest) ∈ {`sonnet`, `opus`}, wszystkie `depends_on` w statusie `done`. Niespełnione → wypisz braki i zaproponuj `/refine $ARGUMENTS`.
   **Ścieżka:** `path` ∈ {`lekka`, `pelna`}. Brak pola → zaproponuj ścieżkę według kryteriów z `workflow.md` (AskUserQuestion, rekomendacja pierwsza, z konsekwencją kosztową) i po odpowiedzi zapisz `path` we frontmatter. `lekka` wymaga ≤ 6 AC i dokładnie jednego recenzenta w `reviewers`; obszar ryzyka (uwierzytelnianie, uprawnienia, dane osobowe, płatności, synchronizacja offline, migracje, infrastruktura produkcyjna) → `pelna`.
3. WIP: jeśli inna historyjka z kodem ma status `in-progress` lub `in-review` — zapytaj użytkownika, czy kontynuować.
4. Git: drzewo robocze czyste (`git status`); `git fetch` + `git merge --ff-only origin/main` na `main`. Utwórz gałąź `feature/$ARGUMENTS-<krótki-slug>` od aktualnego `main`.
5. Ustaw w historyjce `status: in-progress`, dopisz wpis w „Dziennik”. Poinformuj użytkownika jednym zdaniem o starcie.

## 2. Potok agentów (workflow `deliver-story`)
Uruchom narzędziem Workflow zapisany workflow `deliver-story` z `args`:
`{ storyId, storyPath, branch, today: "YYYY-MM-DD", owner, contributors, reviewers, appUrl?, userNotes?, model?, path? }`
— `owner` / `contributors` / `reviewers`, `model` (jeśli jest) i `path` z frontmatter historyjki; `userNotes` — decyzje użytkownika z tej rozmowy, jeśli są. `model` dostają tylko wykonawcy (plan, implementacja, poprawki); QA i przeglądy pracują na modelach z definicji agentów (`docs/process/workflow.md` → „Modele i effort agentów”).
Ścieżka `pelna`: plan techniczny → konsultacje (architekt / UX / security, gdy potrzebne) → implementacja w TDD → weryfikacja QA → przeglądy równolegle → poprawki blocker/major (maks. 3 rundy; od drugiej ponownie przeglądają tylko recenzenci z blocker/major).
Ścieżka `lekka`: jeden wykonawca w TDD → jeden przegląd → najwyżej jedna runda poprawek blocker/major, bez ponownego przeglądu i bez agenta QA (weryfikację robisz sam w kroku 4); wynik `fixed` oznacza, że poprawki czekają na Twoją weryfikację.
Gdy narzędzie Workflow jest niedostępne — wykonaj te same kroki ręcznie narzędziem Agent, w tej samej kolejności i z tymi samymi bramkami (ścieżka `lekka`: jedno wywołanie wykonawcy, jedno recenzenta, ewentualnie jedno poprawiającego); `model` historyjki przekaż wykonawcom (a przy `opus` także przeglądom) parametrem `model` narzędzia Agent.

## 3. Obsługa wyniku workflow
- `blocked` → przedstaw pytania (AskUserQuestion, rekomendowana odpowiedź jako pierwsza), zapisz decyzje w historyjce (sekcja „Decyzje”) i uruchom workflow ponownie **jako nowy przebieg** (bez resume) z decyzjami w `userNotes`.
- `needs-attention` → pokaż otwarte problemy i historię rund; zaproponuj: kolejna runda / podział historyjki / zmiana AC. Decyduje użytkownik.
- `passed` → krok 4.
- `fixed` (tylko `lekka`) → sam sprawdź poprawki z `fixes` (diff, bramka, test odtwarzający problem); niezałatwione blocker/major → `needs-attention`; załatwione → krok 4.

## 4. Weryfikacja orkiestratora i DoD
1. Sam uruchom bramkę jakości (komendy z `CLAUDE.md`) i porównaj wynik z raportem — nie ufaj w ciemno. Ścieżka `lekka`: sam zbuduj tabelę AC → test (`EVM-xxx AC#`) i sprawdź każde AC; bez `qa-engineer`.
2. Przejdź punkty DoD (`docs/process/definition-of-done.md`; w starszych historyjkach odhacz checklistę w pliku). Uwagi nieblokujące (minor / nit) → sekcja „Notatki” (maks. 5 linii) i ewentualnie propozycje pozycji backlogu — bez ponownego przeglądu.
3. Sprawdź `CHANGELOG.md` (sekcja Unreleased) i dokumentację.
4. Ustaw `status: in-review`, dopisz wpis w „Dziennik”.

## 5. Demo i akceptacja
Przedstaw zwięźle: co dostarczono · tabela AC → status → dowód · „jak to sprawdzić” (kroki, adres, zrzuty) · testy i pokrycie · wyniki przeglądów · kryteria `manual` do ręcznego sprawdzenia · znane ograniczenia.
Dopisz w „Dzienniku” wpis „Koszt” i porównaj go z baseline EVM-013 oraz celem ścieżki (`workflow.md` → „Pomiar kosztu”); wynik porównania podaj w demo jednym zdaniem.
Zapytaj (AskUserQuestion): **Akceptuję** / **Poprawki** / **Odrzucam**.
- Akceptuję → scalenie wg D2 (`docs/ops/github-i-ci.md` → „Scalanie”): orkiestrator wypycha gałąź (wyłącznie za zgodą użytkownika, bez force) i zakłada PR (`gh`) albo podaje użytkownikowi **tytuł PR w formacie Conventional Commit z ID** (np. `feat(work-orders): add template selection [EVM-123]`) — stanie się on commitem na `main`; **użytkownik klika „Squash and merge”** przy zielonym `ci-gate` i sprawdza widok Activity; orkiestrator potem tylko `git fetch` + `git merge --ff-only origin/main`, ustawia `status: done` i dopisuje wpis w „Dziennik”. Nigdy push na `main`.
- Poprawki → zapisz uwagi w historyjce i wróć do kroku 2 z `userNotes`.
- Odrzucam → `status: blocked` z uzasadnieniem; bez merge.

Na koniec jedno zdanie o następnym kroku (np. na podstawie `/progress`).
