# Hooki git (`tools/git-hooks/`)

EVM-006 (AC5, W1). Hooki definiuje `lefthook.yml` w katalogu głównym; to narzędzie je instaluje i sprawdza. Działa **bez instalacji zależności** (tylko `node:*`).

| Polecenie                              | Kiedy                                | Co robi                                                                                                                                                 |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tools/git-hooks/cli.mjs install` | skrypt `prepare` przy `pnpm install` | `lefthook install`; **pomija** instalację w CI (`CI` ustawione) i poza repozytorium git (np. kontener `backend-tests`, gdzie nie ma `.git`) — bez błędu |
| `node tools/git-hooks/cli.mjs check`   | pierwszy krok `pnpm run gate`        | sprawdza, że hooki `pre-commit` i `pre-push` to hooki lefthook, a `core.hooksPath` ich nie omija; inaczej kod `1` ze wskazówką                          |

- Skrypt instalacyjny pakietu `lefthook` jest wyłączony (`allowBuilds: lefthook: false` w `pnpm-workspace.yaml`) — hooki instaluje wyłącznie ten skrypt.
- Hooki lokalne da się pominąć (`LEFTHOOK=0`, `--no-verify`, `core.hooksPath`) — **wiążące bramki są w CI** (`.github/workflows/ci.yml`); reguły `deny` w `.claude/settings.json` to utrudnienie dla agentów, nie granica.
