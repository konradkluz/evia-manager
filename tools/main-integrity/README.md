# Integralność `main` — kontrola K6 (`tools/main-integrity/`)

EVM-006 (AC4, ADR-0016). Na planie GitHub Free nie ma rulesetu, więc bezpośredni push na `main` nie jest blokowany — K6 go **wykrywa**. Workflow `.github/workflows/main-integrity.yml` uruchamia narzędzie po każdym pushu na `main`, codziennie o 02:45 UTC i na żądanie, z tokenem `GITHUB_TOKEN` tylko do odczytu (`contents`, `actions`, `pull-requests`). To osobny workflow **bez grupy `concurrency`** — GitHub anuluje oczekujący przebieg grupy, gdy w kolejce pojawi się nowszy, a anulowany przebieg nie wysyła e-maila. Działa **bez instalacji zależności** (tylko `node:*` i wbudowany `fetch`).

Każdy przebieg sprawdza **okno kroczące** — 30 najnowszych commitów `main` (od `AFTER`) aż do `BASELINE`, ostatniego commita `main` sprzed K6 — a nie tylko commity pushu. Commit wypchnięty tokenem `GITHUB_TOKEN` nie uruchamia żadnego workflowu, więc znajdzie go następny push albo przebieg nocny. Każdy commit z okna musi:
1. mieć dokładnie jednego rodzica (squash merge); przy pushu `main` musi być przewinięciem poprzedniego stanu (brak force pushu i przepisanej historii), a push nie może mieć więcej commitów niż okno;
2. być commitem scalenia PR do `main` (`merged_at` ustawione, `merge_commit_sha` = ten commit) — sam fakt, że commit należy do otwartego PR, nie wystarcza;
3. być scalony przez właściciela (`MAIN_MERGER`, dziś `konradkluz`) — nie przez bota ani `GITHUB_TOKEN`;
4. mieć zielony job `ci-gate` w najnowszym przebiegu `.github/workflows/ci.yml` (`push`) dla commita HEAD tego PR — z API przebiegów Actions, nigdy ze statusu commita ani dowolnego check runu (te da się podrobić tokenem z `statuses`/`checks: write`);
5. mieć pierwszą linię w formacie Conventional Commits z `[EVM-###]`, `[renovate]` albo `[M#]` i opcjonalnym sufiksem ` (#N)` (np. `ci: add monorepo, quality gates and CI pipeline [EVM-006] (#2)`).

Commity z okna, które zmieniają `.github/`, `tools/main-integrity/` albo `tools/scan/`, log wypisuje osobno (lista plików obcięta przez API — też): taki commit może wyłączyć K6 albo skany, więc Konrad potwierdza w widoku Activity, że wszedł przez „Pull request merge”.

Zmienne: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `MAIN_MERGER`, `EVENT` (`push`, `schedule`, `workflow_dispatch`), `BASELINE` i `AFTER` (pełne SHA), przy `push` także `BEFORE` i `FORCED`. Koszt: do 5 zapytań API na commit, ok. 150 na przebieg (limit `GITHUB_TOKEN`: 1000/h na repozytorium).

Każdy błąd (API, sieć, nieoczekiwana odpowiedź, `BASELINE` poza historią `main`) daje **czerwony** wynik (fail-closed). Teksty z repozytorium (tytuły commitów, nazwy plików) są wypisywane w jednej linii bez znaków sterujących — nie da się nimi wstrzyknąć komend workflow `::`. Czerwony `main-integrity` = incydent: procedura w `docs/ops/github-i-ci.md` → „Czerwony `main`”.

Ograniczenie: K6 wykrywa obejście **proceduralne**. Push tokenem `GITHUB_TOKEN` z workflowu gałęzi, który zmienia też to narzędzie albo workflowy, może kolejne przebiegi wyłączyć — wykrywa go tylko przegląd widoku Activity przy każdym scaleniu i co tydzień (K2; `docs/ops/github-i-ci.md` → „Ograniczenia K6”).
