# Konwencje

## Język
- **UI i dokumentacja:** polski. **Kod, identyfikatory, komentarze w kodzie, commity, nazwy gałęzi:** angielski.
- Nazwy domenowe w kodzie wg słownika (`docs/product/domain.md`), np. `WorkOrder`, `Customer`, `ProcedureStage`.

## Identyfikatory
| Co | Format | Przykład |
|---|---|---|
| Kamień milowy | `M#` | M1 |
| Epik | `E##` | E03 |
| Historyjka / enabler / spike / bug | `EVM-###` | EVM-012 |
| Decyzja architektoniczna | `ADR-####` | ADR-0001 |

## Git
- Model: trunk-based; `main` zawsze wdrażalny. Na GitHub Free `main` **nie jest chroniony przez GitHub** — zastępuje to procedura i kontrole K1–K7 ([ADR-0016](../architecture/adr/0016-github-free-ochrona-main-kontrole-kompensujace.md), runbook [`docs/ops/github-i-ci.md`](../ops/github-i-ci.md)).
- **Każda zmiana na `main` wyłącznie przez PR** — także backlog, ADR i `/milestone close`; nigdy bezpośredni push na `main`.
- Gałęzie: `feature/EVM-123-short-desc`, `fix/EVM-123-…`, `spike/EVM-123-…`, `chore/…`, `revert/…`.
- Commity: [Conventional Commits](https://www.conventionalcommits.org/) po angielsku z ID: `feat(work-orders): add template selection [EVM-123]`. Typy: feat, fix, test, refactor, docs, chore, ci, build, perf, security, style, revert.
- Małe commity po każdym zielonym kroku TDD; hooki git (lefthook: format, lint, gitleaks) uruchamiają się przy commicie i pushu — nie pomijamy ich.
- **Scalanie (D2):** po akceptacji demo i przy zielonym check `ci-gate` dla HEAD gałęzi **Konrad klika „Squash and merge” w PR** (domyślny komunikat = tytuł i opis PR). **Tytuł PR = pierwsza linia commita na `main`** — Conventional Commit zakończony jednym z ID: `[EVM-###]` (historyjka), `[renovate]` (aktualizacje zależności), `[M#]` (zamknięcie kamienia milowego); GitHub dopisuje ` (#N)`. Kontrola `main-integrity` (K6) sprawdza ten format po każdym pushu na `main`. Orkiestrator potem lokalnie wyłącznie `git fetch` + `git merge --ff-only origin/main`.
- `git push` gałęzi i operacje na zdalnym repozytorium — tylko za zgodą użytkownika; push na `main`, force-push i usuwanie gałęzi zablokowane w `.claude/settings.json`.

## Wersjonowanie i zmiany
- Wydania: SemVer (`1.0.0` = MVP „Biuro”). Aplikacja mobilna: SemVer + numer builda.
- `CHANGELOG.md` w formacie Keep a Changelog, po polsku, sekcja „Unreleased” uzupełniana w każdej historyjce.

## Dokumentacja
- Markdown w repo, diagramy w Mermaid; daty ISO `YYYY-MM-DD`.
- Decyzje architektoniczne → ADR; decyzje produktowe → historyjka / roadmapa; procesy → `docs/process/`.
- Każda historyjka ma „Dziennik” (kto, co, kiedy) — pamięć projektu między sesjami.
- Każdy plik `.md` ma klasę cyklu życia (trwały / żywy / kamień milowy / roboczy) i leży w dozwolonej lokalizacji — [`document-lifecycle.md`](document-lifecycle.md); pliki robocze tylko w `.scratch/` (ignorowany przez git) lub w scratchpadzie sesji; sprawdzenie: `npm run docs:check`.

## Kod
- Formatowanie i styl wymuszają lintery / formattery (konfiguracja w EVM-006) — bez dyskusji o gustach w przeglądach.
- Konfiguracja przez zmienne środowiskowe; każda nowa zmienna w `.env.example` z opisem; sekrety nigdy w repo.
- Czas: zapis w UTC, prezentacja w `Europe/Warsaw`. Kwoty: liczby całkowite w groszach (lub typ dziesiętny) — nigdy float.
