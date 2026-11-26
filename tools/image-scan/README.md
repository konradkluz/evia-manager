# Skan obrazów (bramka 6) poza `publish` — `tools/image-scan/`

EVM-153 AC4, AC4b. Buduje (bez publikacji) obrazy, które `publish` (`evia-api`, `evia-web`) i `publish-infra` (`evia-postgres-pgbackrest`, `evia-media-processor`) zbudowałyby po scaleniu, pobiera obrazy infrastruktury z `infra/runtime/infra-images.json` (po digeście) i skanuje każdy **tą samą** komendą Trivy co publikacja: usługa `scan-trivy-image`, `trivy.yaml`, `--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`, ta sama semantyka pliku wyjątków (procesor mediów — pusty rejestr i kontrola `ExperimentalModifiedFindings`), skan sekretów (dowolna waga) dla obrazów `evia-*`. Każdy obraz musi być `linux/arm64` (sprawdzane przed skanem).

- Używany w `ci.yml` (job `images-scan`, `pull_request` i `push` — wymagany przez `ci-gate`) i w `nightly.yml` (job `image-digests`). Nic nie jest wypychane: bez logowania do rejestru, bez sekretów, bez cache, bez artefaktów; wyniki w logu (dla sekretów tylko reguła i miejsce — nigdy fragment dopasowania).
- Uruchomienie lokalne (Docker, z katalogu głównego): `node tools/image-scan/cli.mjs [--save-platform] [--only evia-api,infra-caddy]`; `--save-platform` — Docker Desktop z magazynem containerd (`docker save --platform linux/arm64`). Raporty w `.scratch/scans/` (ignorowany przez git).
- Parytet z `publish` i `publish-infra` egzekwuje `tools/repo-policy` (`test/images.test.ts`): rozbieżność flag, listy obrazów lub nazwy to czerwony test.
- Docker wywołuje tylko ten moduł (obok `tools/scan` i `tools/dev-env`): `buildx build`, `pull`, `image inspect`, `save` i `compose run scan-trivy-image` — nigdy `docker run`.
- Testy (atrapa Dockera, dane syntetyczne): `pnpm --filter @evia/image-scan run test:coverage` (próg 90%, znakowane `EVM-153 AC4`).
