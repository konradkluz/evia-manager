# Procesor obrazów — `services/media-processor/`

EVM-068 (ADR-0009 „Przetwarzanie w izolacji”; SR-FILE-04, SR-FILE-06, SR-FILE-08, SR-INPUT-04; TM-35, TM-36). Z jednego zdjęcia robi miniaturę (dłuższy bok 320 px) i podgląd (1600 px) w WebP **bez metadanych** (EXIF, GPS, XMP, IPTC, ICC), z zastosowaną orientacją. Działa w osobnym kontenerze bez sieci, nasłuchuje wyłącznie na gnieździe Unix we wspólnym tmpfs z workerem (`docs/ops/runbooks/media-processor.md`).

## Jak działa
- `src/main.ts` — nasłuch na `MEDIA_PROCESSOR_SOCKET`, katalog roboczy `MEDIA_PROCESSOR_WORKDIR` (obie ścieżki bezwzględne). Jedno zadanie naraz (`src/server.ts`).
- Protokół (`src/protocol.ts`): jedna linia JSON w obie strony, żądanie to tylko `{ jobId, contentType }` — **bez ścieżek**: katalog zadania to `<workdir>/<jobId>` (UUID nadany przez worker), wejście `input`, wyjścia `thumbnail.webp` i `preview.webp`. Odpowiedź: wymiary albo stały kod błędu (`pixel_limit`, `unsupported`, `timeout`, `internal`) — nigdy tekst biblioteki. Worker ma własną kopię protokołu (`apps/api/src/platform/media-processing/`): strony nie dzielą kodu, a zgodność liczb i nazw pilnuje test w `tools/repo-policy`.
- Każde zadanie w procesie potomnym (`src/run-job.ts`, `fork` stałego pliku, tablica argumentów, bez powłoki, pusty `env`), który po 60 s dostaje `SIGKILL` — zawieszenie w libvips, którego nie przerwie żaden timer, kończy się razem z potomkiem; kolejny plik przechodzi.
- Konwersja (`src/convert.ts`): wszystkie loadery libvips zablokowane, odblokowane tylko JPEG, PNG, WebP i HEIF; format musi zgadzać się z typem z rekordu pliku (SVG, PDF, TIFF pod sygnaturą obrazu → `unsupported`); `limitInputPixels` 100 MP; `failOn: 'error'`; bez `withMetadata`; orientacja stosowana przez `rotate()`. HEIC: prebuilt libvips nie dekoduje HEVC → `unsupported` (znane ograniczenie, runbook).

## Polecenia
`pnpm --filter @evia/media-processor run test:coverage` (testy z prawdziwym `sharp`; lokalnie w kontenerze Linux: `docker compose -f compose.yaml run --rm backend-tests pnpm --filter @evia/media-processor run test:coverage` — libvips ma być taki jak w produkcji, ADR-0015), `lint`, `typecheck`. Uruchamiany bez budowania (Node.js 26, usuwanie typów).

## Granice
Nie importuje niczego z `apps/`, `packages/` ani `tools/`, a nikt go nie importuje (reguły `media-processor-self-contained` i `nothing-imports-media-processor` w `.dependency-cruiser.cjs`). Jedyna zależność: `sharp` 0.35.5 (Apache-2.0; prebuilt libvips LGPL-3.0, dynamicznie). Zmiany w tym katalogu wymagają przeglądu właściciela (`CODEOWNERS`).
