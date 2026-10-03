# Integralność `main` — kontrola K6 (`tools/main-integrity/`)

EVM-006 (AC4, ADR-0016). Na planie GitHub Free nie ma rulesetu, więc bezpośredni push na `main` nie jest blokowany — K6 go **wykrywa**. Job `main-integrity` w `.github/workflows/ci.yml` uruchamia narzędzie po każdym pushu na `main` z tokenem `GITHUB_TOKEN` tylko do odczytu (`contents`, `actions`, `pull-requests`). Działa **bez instalacji zależności** (tylko `node:*` i wbudowany `fetch`).

Każdy commit z zakresu `before..after` pushu musi:
1. być przewinięciem poprzedniego `main` (brak force pushu i przepisanej historii) i mieć dokładnie jednego rodzica (squash merge);
2. być commitem scalenia PR do `main` (`merged_at` ustawione, `merge_commit_sha` = ten commit) — sam fakt, że commit należy do otwartego PR, nie wystarcza;
3. być scalony przez właściciela (`MAIN_MERGER`, dziś `konradkluz`) — nie przez bota ani `GITHUB_TOKEN`;
4. mieć zielony job `ci-gate` w najnowszym przebiegu `.github/workflows/ci.yml` (`push`) dla commita HEAD tego PR — z API przebiegów Actions, nigdy ze statusu commita ani dowolnego check runu (te da się podrobić tokenem z `statuses`/`checks: write`);
5. mieć pierwszą linię w formacie Conventional Commits z `[EVM-###]`, `[renovate]` albo `[M#]` i opcjonalnym sufiksem ` (#N)` (np. `ci: add monorepo, quality gates and CI pipeline [EVM-006] (#2)`).

Każdy błąd (API, sieć, nieoczekiwana odpowiedź) daje **czerwony** wynik (fail-closed). Teksty z repozytorium (tytuły commitów) są wypisywane w jednej linii bez znaków sterujących — nie da się nimi wstrzyknąć komend workflow `::`. Czerwony `main-integrity` = incydent: procedura w `docs/ops/github-i-ci.md` → „Czerwony `main`”.

Ograniczenie: K6 działa z workflowu, który ten sam push może zmienić — dlatego Konrad przy każdym scaleniu przegląda też widok Activity repozytorium (K2).
