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
- Model: trunk-based; `main` zawsze wdrażalny i chroniony (po EVM-006 — wymagane zielone CI).
- Gałęzie: `feature/EVM-123-short-desc`, `fix/EVM-123-…`, `spike/EVM-123-…`, `chore/…`.
- Commity: [Conventional Commits](https://www.conventionalcommits.org/) po angielsku z ID: `feat(work-orders): add template selection [EVM-123]`. Typy: feat, fix, test, refactor, docs, chore, ci, build, perf, security.
- Małe commity po każdym zielonym kroku TDD; squash merge po akceptacji użytkownika.
- `git push`, merge do `main` i operacje na zdalnym repozytorium — tylko za zgodą użytkownika; force-push zablokowany w `.claude/settings.json`.

## Wersjonowanie i zmiany
- Wydania: SemVer (`1.0.0` = MVP „Biuro”). Aplikacja mobilna: SemVer + numer builda.
- `CHANGELOG.md` w formacie Keep a Changelog, po polsku, sekcja „Unreleased” uzupełniana w każdej historyjce.

## Dokumentacja
- Markdown w repo, diagramy w Mermaid; daty ISO `YYYY-MM-DD`.
- Decyzje architektoniczne → ADR; decyzje produktowe → historyjka / roadmapa; procesy → `docs/process/`.
- Każda historyjka ma „Dziennik” (kto, co, kiedy) — pamięć projektu między sesjami.

## Kod
- Formatowanie i styl wymuszają lintery / formattery (konfiguracja w EVM-006) — bez dyskusji o gustach w przeglądach.
- Konfiguracja przez zmienne środowiskowe; każda nowa zmienna w `.env.example` z opisem; sekrety nigdy w repo.
- Czas: zapis w UTC, prezentacja w `Europe/Warsaw`. Kwoty: liczby całkowite w groszach (lub typ dziesiętny) — nigdy float.
