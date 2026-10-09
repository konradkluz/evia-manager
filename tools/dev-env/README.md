# Lokalne środowisko dev (`tools/dev-env/`)

EVM-077. Jedno polecenie `pnpm run dev` uruchamia lokalnie bazę i API (kontenery z `compose.dev.yaml`), przygotowuje konto Administratora i dane demo, a potem panel (Vite). Tylko maszyna lokalna — nie staging, nie produkcja. Instrukcja dla użytkownika: `README.md` w korzeniu repozytorium → „Uruchomienie lokalne”.

Działa **bez instalacji zależności** (tylko `node:*`). Polecenia (`node tools/dev-env/cli.mjs <polecenie>`; skrypty w `package.json` wołają je bezpośrednio, nigdy przez turbo — turbo zapisuje wyjście zadań w `.turbo/*.log`):

| Skrypt | Polecenie | Co robi |
|---|---|---|
| `dev:init` | `init` | tworzy `.env` z `.env.example` z losowym `CURSOR_KEY` (flaga `wx` — nigdy nie nadpisuje; wartość nie jest wypisywana) |
| `dev` | `dev` | terminal → `.env` → strażnik → `up` → narzędzia dev → strażnik w bazie + stan Administratora → Administrator → dane demo → panel |
| `dev:admin` | `admin` | tylko procedura Administratora (EVM-016) |
| `dev:seed` | `seed` | tylko dane demo (wymagają aktywnego Administratora) |
| `dev:stop` | `stop` | `down` — dane bazy zostają |
| `dev:reset` | `reset` | `down -v` po wpisaniu frazy z terminala; usuwa wyłącznie kontenery i wolumen dev |

## Zasady bezpieczeństwa
- **Cztery dokładne formy Dockera** (`src/docker.mjs` — jedyne miejsce w `tools/` obok `tools/scan/lib/compose.mjs`, które uruchamia Dockera): `docker compose -f compose.dev.yaml up -d --wait --build`, `… down`, `… down -v`, `… exec api node dist/src/cli/bootstrap-admin.js`. Inne (`run`, inne `exec`, `-T`, `-u`, `--remove-orphans`, inny plik) są odrzucane testem w `tools/repo-policy/test/compose.dev.test.ts`.
- **Strażnik** (`src/guard.mjs`, czysta funkcja; powtórzony w `apps/api/dev/guard.ts` w procesie, który pisze): `NODE_ENV=development`, `WEBAUTHN_RP_ID=localhost`, `DATABASE_URL` z hostem z listy (`localhost`, `127.0.0.1`, `::1`, `postgres-dev`), bazą `evia_dev`, portem 5442, **bez** parametrów zapytania, bez zmiennych `PG*`; w bazie znacznik `evia.env=local-dev` ustawiony przez `ALTER DATABASE` (`infra/docker/postgres-dev/init.sql`, montowany `:ro`), sprawdzany po stronie serwera. Brak opcji `--force`.
- **Link aktywacyjny** wypisuje wyłącznie polecenie `exec` z odziedziczonym terminalem (bez `-T`, bez przekierowań). `dev` i `dev:admin` bez terminala interaktywnego kończą się kodem 2 i komunikatem; `dev:reset` wymaga terminala i wpisania frazy (bez `--yes`, bez potwierdzenia z potoku).
- Dane demo i narzędzia (`apps/api/dev/`) są kompilowane osobno (`tsconfig.dev.json` → `.dev-build/`, ignorowane przez git), nie trafiają do `dist/` ani do obrazu API.

## Testy
`pnpm --filter @evia/dev-env run test:coverage` (próg 90% linii i gałęzi, `evia-node-test`). Reguły repozytorium dla `compose.dev.yaml` i obrazu API: `tools/repo-policy/test/compose.dev.test.ts`.
