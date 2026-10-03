# Pokrycie zmienionego kodu (`tools/diff-coverage/`)

Bramka z EVM-006 (AC3): **≥ 90% linii i gałęzi zmienionego kodu** (`docs/process/testing-strategy.md` → „Progi”). Własny skrypt zamiast `diff-cover` (Python byłby drugim runtime'em na hoście i w CI; ADR-0014 zostawia wybór EVM-006). Działa **bez instalacji zależności** — tylko moduły `node:*` (job `coverage` w CI).

## Polecenia
- `pnpm run coverage:diff` (= `node tools/diff-coverage/cli.mjs`) — tabela per plik, lista niepokrytych linii i gałęzi; kod `0` — próg spełniony albo brak mierzalnych zmian, `1` — poniżej progu, `2` — błąd użycia lub środowiska.
- `node tools/diff-coverage/cli.mjs clean` — usuwa stare raporty `lcov.info` (pierwszy krok `pnpm run gate`, brak fałszywej zieleni z nieaktualnych raportów).

## Jak liczy
| Krok | Zasada |
|---|---|
| Baza | `git merge-base HEAD origin/main` (lokalnie bez `origin/main` — `main`); na samym `main` — poprzedni commit (pierwszy commit — puste drzewo) |
| Zmiany | `git diff -U0 <baza>` łącznie ze zmianami nieskomitowanymi i plikami nieśledzonymi (pętla TDD) |
| Kod źródłowy | pliki `apps/`, `packages/`, `services/`, `tools/` z rozszerzeniem `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` — poza wykluczeniami z `packages/config/coverage-exclusions.json` (jedno źródło wykluczeń) |
| Raporty | `<apps\|packages\|services\|tools>/<workspace>/coverage/lcov.info` (host, CI) i każdy `lcov.info` pod `coverage/backend-tests/` (kontener `backend-tests`); ścieżki `SF:` względne, Windows, `/work/repo/…` i runnera CI są normalizowane do ścieżek repozytorium, trafienia scalane (maksimum) |
| Wynik | linie (`DA`) i gałęzie (`BRDA`) na zmienionych liniach; **zmieniony plik źródłowy bez raportu = niepokryty** (niepuste zmienione linie) |

Bezpieczeństwo: czyta wyłącznie zwykłe pliki (bez podążania za dowiązaniami), git bez powłoki, nazwy plików wypisywane w jednej linii bez znaków sterujących (brak wstrzyknięcia komend workflow `::`).
