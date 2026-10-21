# Kanał wdrożeń na VM — `infra/deploy-agent/` i `infra/runtime/`

EVM-007 AC3, AC4, AC7 (ADR-0018 V6, „Gdzie żyją sekrety”). Pliki instalowane na VM **wyłącznie w sesji IaC** Konrada — kanał wdrożeń nie zmienia ani tych plików, ani weryfikatora, ani infrastruktury (Caddy, TLS, baza). Pliki wrażliwe K3.

| Plik | Miejsce na VM | Rola |
|---|---|---|
| `systemd/evia-deploy-agent.{service,timer}` | `/etc/systemd/system/` | jeden przebieg co 90 s (`Type=oneshot`, `flock`), `OnFailure=` → alert lokalny (`evia-deploy-agent-alert.service`, e-mail w EVM-085) |
| `cycle.sh` | `/usr/local/sbin/evia-deploy-cycle` | kopia PAT do tmpfs, kontener weryfikatora (`compose.agent.yaml`), przy kodzie `0` — `deploy.sh` |
| `compose.agent.yaml` | `/etc/evia/deploy-agent/` | kontener weryfikatora: obraz po ID (przypinany w sesji IaC), bez gniazda Dockera i portów, tylko do odczytu, użytkownik `10010` |
| `deploy.sh` | `/usr/local/sbin/evia-deploy` | root: ponowna walidacja wyniku weryfikatora, pull po digeście → `migrate` (`evia_migrator`) → start koloru → `/api/health` i `/api/version` → przełączenie Caddy → kontrola przez krawędź → zatrzymanie starego koloru → rejestr (atomowo) → obrazy 3 ostatnich wdrożeń |
| `secrets.manifest.json` | `/etc/evia/deploy-agent/` | które pliki z `/etc/evia/secrets` (0700, pliki 0600 root) dostaje każda usługa (kopia tmpfs `/run/evia/secrets/<usługa>/`, 0400, UID usługi) |
| `../runtime/compose.staging.yaml` | — (czytany z commita X przez API) | plik Compose kanału: tylko `api`, `worker`, `web`, `migrate`; root uruchamia wyłącznie kanoniczny JSON z weryfikatora |
| `../runtime/compose.infra.yaml`, `../runtime/Caddyfile`, `../runtime/postgres-init/` | `/etc/evia/runtime/`, `/etc/evia/caddy/` | infrastruktura VM: Caddy krawędziowy (80/443, TLS Let's Encrypt, HSTS), PostgreSQL (role), `clamd` bez wyjścia do sieci i `freshclam` osobno |
| `../runtime/infra-images.json` | konfiguracja VM | stała lista obrazów infrastruktury po digeście (skanowana w `publish`, bramka 6) |

Katalogi na VM: `/var/lib/evia/registry/registry.json` (rejestr wdrożeń — pisze tylko `deploy.sh`, weryfikator czyta), `/var/lib/evia/deploy/` (0700 root: wydania, aktywny kolor), `/var/lib/evia/agent/{out,state}` (wynik i stan weryfikatora), `/etc/evia/deploy-agent/rollback` (polecenie administratora: pełny SHA commita z rejestru).

## Testy
- `docker compose -f compose.yaml run --rm deploy-sh-tests` (etap `pnpm run gate:deploy` lokalnej bramki; w CI krok joba `backend` przy zmianie tych ścieżek): `deploy.sh` z atrapami `docker` i `curl` — kolejność kroków, porażka migracji, zdrowia i krawędzi zostawia poprzednią wersję, odrzucenie zmienionego wyniku weryfikatora, rollback tylko z rejestru, sekrety, retencja obrazów — oraz ShellCheck dla skryptów `infra/`. Pokrycie skryptów powłoki nie jest liczone; logika decyzyjna jest w `services/deploy-agent` (próg 90%).
- Polityki plików VM: `tools/repo-policy/test/deploy-agent.test.ts`.
- Na żywej VM (sesja IaC): runbook `docs/ops/runbooks/wdrozenie-staging.md`.
