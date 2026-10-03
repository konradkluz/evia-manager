# Niezmienniki repozytorium (`tools/repo-policy/`)

EVM-006 (AC1–AC8; ADR-0012, ADR-0015, ADR-0016). Reguły, których nie sprawdza żadne narzędzie zewnętrzne, zapisane jako testy Vitest (TypeScript) — uruchamiane w `pnpm run gate` i w CI jak każdy workspace (`test:coverage`, próg 90%). Jedyna zależność poza wspólną konfiguracją: `yaml` (ISC, bez zależności własnych) do czytania workflowów, `compose.yaml`, `lefthook.yml`, `pnpm-workspace.yaml` i plików wyjątków.

| Plik testów | Co pilnuje |
|---|---|
| `test/structure.test.ts` | struktura monorepo i workspace'y (`private`, `@evia/*`, README), skrypty `lint` / `typecheck` / `test:coverage`, jedno źródło wykluczeń pokrycia, kolejność `pnpm run gate`, granice modułów, narzędzia bez zależności, Node 26 i pnpm wszędzie w tej samej wersji, ustawienia łańcucha dostaw pnpm, tylko dokładne wersje z rejestru, kontrakt `@evia/tokens` |
| `test/compose.test.ts` | utwardzenia `compose.yaml` (digesty, bez portów, uprawnień, gniazda Dockera, `env_file`, interpolacji), Dockerfile `backend-tests`, montaże tylko z listy dozwolonych, `.scratch` wyłącznie jako wyjście, sieć skanerów, jedyne miejsce uruchamiania Dockera |
| `test/workflows.test.ts` | workflowy: SHA akcji z komentarzem wersji, `permissions`, `timeout-minutes`, `persist-credentials: false`, brak niebezpiecznych wyzwalaczy i sekretów; kolejność etapów; `ci-gate` i `main-integrity`; Renovate (token tylko w kroku Renovate, obraz po digeście); Docker w skryptach wyłącznie przez `docker compose -f compose.yaml run --rm` |
| `test/secrets.test.ts` | `.env.example`, `.gitignore`, konfiguracja gitleaks bez allowlist, `--redact`, hooki lefthook |
| `test/exceptions.test.ts` | wyjątki skanerów: powód, właściciel, historyjka, termin (≤ 30 dni Critical/High, ≤ 90 dni pozostałe), brak wyjątków dla `MAL-…`, wąski `.semgrepignore` |
| `test/docs.test.ts` | „Szybki start” w README, „Stack i komendy” w `CLAUDE.md`, „Narzędzia” w `testing-strategy.md`, tryb scalania przez PR (D2) |
| `test/checkers.test.ts` | każdy checker z `src/` wykrywa naruszenia na danych syntetycznych — zielony test prawdziwego repozytorium coś znaczy |

Jedynym workspace'em, który może łagodzić wspólne reguły ESLint i TypeScript, jest `tools/docs-lifecycle` (dług EVM-013).
