# Kontener `backend-tests` — punkt wejścia (`tools/container/`)

EVM-006 (ADR-0015 → „Po EVM-006”, ADR-0016). Obraz `infra/docker/backend-tests/Dockerfile` uruchamia `node /src/tools/container/sync.mjs`. Narzędzie działa **bez instalacji zależności** (tylko `node:*`) — startuje, zanim w kontenerze są `node_modules`.

| Polecenie (host, katalog główny)                                              | Co się dzieje w kontenerze                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose -f compose.yaml run --rm backend-install`                     | synchronizacja `/src` → `/work/repo`, potem `pnpm install --frozen-lockfile` (sieć; magazyn `/work/pnpm-store`)                                                    |
| `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` | synchronizacja, `pnpm install --offline --frozen-lockfile` (bez sieci), polecenie, eksport `**/coverage/lcov.info` do `/out` = `coverage/backend-tests/` na hoście |

- `/src` — wyłącznie ścieżki z listy dozwolonych, tylko do odczytu (`compose.yaml`); `/work` — nazwany wolumen `bt-work` (kopia robocza z linuksowymi `node_modules` i magazyn pnpm na jednym systemie plików — twarde dowiązania).
- Synchronizacja porównuje treść plików; pomija `node_modules`, `.turbo`, `dist`, `coverage`, `.git` i dowiązania symboliczne; usuwa wyłącznie wewnątrz `/work/repo` i nigdy nie podąża za dowiązaniami (W10).
- `/out` jest czyszczony przed eksportem raportów — nieaktualny raport nie da fałszywej zieleni (W3b).
- Brak pakietów w wolumenie (np. po zmianie lockfile) → komunikat „najpierw uruchom … backend-install”.
