---
milestone: M0
---

# Spike EVM-011 — kolejka offline i upload w tle (Android)

Kod jednorazowy ([EVM-011](../../docs/backlog/M0/EVM-011-spike-kolejka-offline-i-upload-w-tle.md)). **Nie trafia na produkcję ani do techników.** Wnioski: [`docs/spikes/EVM-011-kolejka-offline-i-upload-w-tle.md`](../../docs/spikes/EVM-011-kolejka-offline-i-upload-w-tle.md), [`media-pipeline.md`](../../docs/architecture/media-pipeline.md), [`offline-sync.md`](../../docs/architecture/offline-sync.md).

Dotyczy wyłącznie Androida (iOS odłożony, ADR-0015). Dane wyłącznie syntetyczne.

## Ostrzeżenie

Wariant spike używa HTTP po `10.0.2.2` / `127.0.0.1` (wyjątek `network_security_config` tylko dla tych hostów), własnego `applicationId` (`pl.eviacharge.spike.offlineupload`) i podpisu debug. **Nie budować go w CI, nie publikować i nie dawać technikom.**

## Układ

Samodzielny projekt pnpm **poza** workspace'em repozytorium (własny `pnpm-workspace.yaml` i `pnpm-lock.yaml`, te same ustawienia łańcucha dostaw co w korzeniu).

| Katalog | Zawartość |
|---|---|
| `core/` | czysty TypeScript: planer części, backoff z jitterem, silnik wznawialnego uploadu (model referencyjny protokołu), UUIDv7, SHA-256, magazyny zadań; testy Vitest `EVM-011 AC#` |
| `host/` | `url-issuer` (zastępnik API: sesje, podpisane URL-e części, complete), skrypty (`make-synthetic-video`, `verify-integrity`, `count-duplicates`, scenariusze adb), testy integracyjne względem SeaweedFS; tu (i tylko tu) `@aws-sdk/*` |
| `infra/` | `compose.seaweedfs.yaml` (SeaweedFS przypięty do digestu, port S3 tylko na loopback), generator syntetycznych kluczy lokalnych |
| `app/` | aplikacja Expo (techniczny ekran: aparat, kolejka, pliki syntetyczne) + natywny moduł Kotlin (UIDT) |

## Uruchomienie hosta (bez telefonu)

```
pnpm install --frozen-lockfile
node infra/gen-local-secrets.mjs                       # klucze i token do .scratch/EVM-011/secrets (poza gitem)
EVM011_SECRETS_DIR=<ścieżka z poprzedniego kroku> docker compose -f infra/compose.seaweedfs.yaml up -d
pnpm test                                              # core: jednostkowe; host: integracyjne względem SeaweedFS
EVM011_SECRETS_DIR=... docker compose -f infra/compose.seaweedfs.yaml down -v   # zawsze z -f
```
