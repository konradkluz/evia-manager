---
milestone: M0
---

# Spike EVM-011 — kolejka offline i upload w tle (Android)

Kod jednorazowy ([EVM-011](../../docs/backlog/M0/EVM-011-spike-kolejka-offline-i-upload-w-tle.md)). **Nie trafia na produkcję ani do techników.** Wnioski: [`docs/spikes/EVM-011-kolejka-offline-i-upload-w-tle.md`](../../docs/spikes/EVM-011-kolejka-offline-i-upload-w-tle.md), [`media-pipeline.md`](../../docs/architecture/media-pipeline.md), [`offline-sync.md`](../../docs/architecture/offline-sync.md).

Dotyczy wyłącznie Androida (iOS odłożony, ADR-0015). Dane wyłącznie syntetyczne (pliki pseudolosowe z ziarna, nie nagrania z kamery; na telefonie — neutralne obiekty, bez ludzi i danych klientów).

## Ostrzeżenie

Wariant spike używa HTTP po `10.0.2.2` / `127.0.0.1` (wyjątek `network_security_config` tylko dla tych hostów), własnego `applicationId` (`pl.eviacharge.spike.offlineupload`), etykiety „EVM-011 SPIKE”, jest **debuggable** (potrzebne `adb run-as` do pomiarów) i podpisany kluczem debug. **Nie budować go w CI, nie publikować i nie dawać technikom.** Token testowy i klucze S3 nie są w APK ani w repozytorium.

## Układ

Samodzielny projekt pnpm **poza** workspace'em repozytorium (własny `pnpm-workspace.yaml` i `pnpm-lock.yaml`, te same ustawienia łańcucha dostaw co w korzeniu: dokładne wersje, `minimumReleaseAge` 1440, `strictDepBuilds`, `blockExoticSubdeps`). Korzeniowe `pnpm run lint` i `pnpm run typecheck` (Turborepo po workspace'ach) go nie widzą; `prettier --check .` w korzeniu go obejmuje (kod jest sformatowany).

| Katalog | Zawartość |
|---|---|
| `core/` | czysty TypeScript: planer części (limit dostawcy jako parametr), backoff z jitterem, silnik wznawialnego uploadu (**model referencyjny** protokołu), UUIDv7, SHA-256, magazyny zadań; testy Vitest `EVM-011 AC#` |
| `host/` | `src/issuer.ts` (zastępnik API: sesje, podpisane URL-e części, complete; nasłuch tylko 127.0.0.1), skrypty (`scripts/`), testy integracyjne względem SeaweedFS (`test/integration.test.ts`); tu (i tylko tu) `@aws-sdk/*` |
| `infra/` | `compose.seaweedfs.yaml` (SeaweedFS 4.48 przypięty do digestu, tylko port S3 na `127.0.0.1`), generator syntetycznych kluczy lokalnych |
| `app/` | aplikacja Expo (techniczny ekran: aparat, kolejka) + lokalny moduł natywny Kotlin `modules/spike-uploader` (zadania UIDT, pętla części, SHA-256, token w Keystore) |

## Co działa gdzie

- **Urządzenie (Kotlin):** pętla uploadu części (`UploadEngine.kt`), zadanie UIDT (`UploadJobService.kt`), pliki zadań w `noBackupFilesDir` (`Storage.kt`), SHA-256 strumieniowo, przeniesienie pliku z cache do sandboxu. Działa bez JS (po zabiciu procesu).
- **Urządzenie (JS):** aparat, szyfrowana baza kolejki (SQLCipher, klucz w Keystore przez `expo-secure-store`), UI, uzgadnianie stanu z plikami zadań. JS jest jedynym pisarzem bazy.
- **Host (Node):** `core/` (referencja protokołu + testy), `host/` (issuer, skrypty, scenariusze adb).

## Uruchomienie hosta (bez telefonu)

```
pnpm install --frozen-lockfile                                  # nigdy z --filter (hoisted + filtr czyści węzły innych pakietów)
node infra/gen-local-secrets.mjs                                # klucze i token do .scratch/EVM-011/secrets (poza gitem)
export EVM011_SECRETS_DIR=<ścieżka wypisana przez skrypt>
docker compose -f infra/compose.seaweedfs.yaml up -d            # SeaweedFS na 127.0.0.1:8333
cd core && npx vitest run                                       # jednostkowe (bez sieci)
cd ../host && npx vitest run                                    # integracyjne względem SeaweedFS
docker compose -f infra/compose.seaweedfs.yaml down -v          # zawsze z -f (projekt evm011-spike-s3)
```

## Budowanie wariantu na Windows (droga A z `docs/ops/dystrybucja-apk-android.md`)

Z krótkiego klonu (`C:\e`, `nodeLinker: hoisted` już jest w pnpm-workspace.yaml spike'a), katalog `spikes/offline-upload`:

```
pnpm install --frozen-lockfile
cd app && node ../node_modules/expo/bin/cli prebuild --platform android --clean --no-install
echo sdk.dir=<ANDROID_HOME> > android/local.properties
cd android && java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain assembleRelease \
  -PreactNativeArchitectures=x86_64 --console=plain -I ../build-support/spike.init.gradle    # arm64-v8a dla telefonu
```

Zmienne: `EXPO_NO_TELEMETRY=1`, `MAESTRO_CLI_NO_ANALYTICS=1`, `GRADLE_OPTS=-Dorg.gradle.workers.max=6`. APK: `app/android/app/build/outputs/apk/release/app-release.apk` (nie commitować — `.gitignore`).

## Scenariusze na emulatorze

`host/scripts/scenarios.ts <airplane|airplane-mid|forcestop|kill9|killcomplete|reboot|reboot-pin|background|background-idle|big|wifi-lte|checks>`; wyniki (JSON bez tokenów i podpisanych URL-i) w `.scratch/EVM-011/results/`; `host/scripts/summarize.ts <scenariusz>` drukuje skrót. Inne skrypty: `emulator.ts` (start/kill/install), `count-duplicates.ts`, `verify-integrity.ts`, `make-synthetic.ts`, `scan-apk-secrets.ts`, `issuer-cli.ts` (ręczne scenariusze na telefonie).
