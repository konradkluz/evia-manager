---
id: EVM-124
title: Publikacja obrazów infrastruktury (pgbackrest, media-processor) w CI — budowa natywna arm64, skan, SBOM, atestacja
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P1
path: pelna
owner: devops-engineer
contributors: []
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-084]
---

# EVM-124: Publikacja obrazów infrastruktury w CI

## Cel
Jako **właściciel produktu** chcę, **aby obrazy infrastruktury budowane dziś ręcznie w sesji IaC (`postgres-pgbackrest`, `evia-media-processor`) powstawały w CI na natywnym runnerze arm64 i przechodziły skan, SBOM oraz atestację pochodzenia**, aby **sesja IaC tylko pobierała i weryfikowała gotowy obraz, a wyjątek jednorazowy z 2026-11-12 (RR-78, warunkowo) wygasł**. Dziś te obrazy powstają natywnie na VM, poza skanem w CI (`media-processor.md`, „Dług i otwarte kroki”); `compose.media.yaml` ma digest zerowy, a `postgres-pgbackrest` nie ma wpisu w `infra/runtime/infra-images.json`.

## Kryteria akceptacji

**AC1 — Budowa w CI na natywnym arm64**
- Zakładając push na `main` po zielonym `ci-gate`
- Gdy przebiega publikacja obrazów infrastruktury
- Wtedy obraz jest zbudowany bez cache i bez QEMU na natywnym runnerze `ubuntu-24.04-arm`, z bazami po digeście, dla `linux/arm64`, opublikowany w GHCR jako pakiet publiczny (decyzja Konrada 2026-11-13: kod z publicznego repo; warunek: skan sekretów, AC2) i opisany rekordem (obraz, digest, commit) zapisanym jako artefakt przebiegu; rekord jest osobny od `release-manifest` wydania.

**AC2 — Skan przed publikacją (warunek RR-78)**
- Zakładając zbudowany obraz
- Gdy Trivy znajdzie podatność High/Critical z dostępną poprawką, której nie pokrywa ważny, niewygasły wpis rejestru wyjątków (`.trivyignore.yaml`, EVM-118), albo brakuje dokładnej wersji pakietu instalowanego przez `apt` (`FFMPEG_VERSION`, `pgbackrest=`), albo skaner lub jego baza zgłosi błąd, albo skan sekretów (Trivy `--scanners secret`, każdy poziom ważności, bez wyjątków) znajdzie sekret w obrazie (decyzja Konrada 2026-11-13)
- Wtedy przebieg jest czerwony i nic nie trafia do GHCR; skanowany jest dokładnie ten digest, który jest publikowany.

**AC3 — SBOM i atestacja pochodzenia**
- Zakładając obraz bez blokujących podatności
- Gdy obraz jest publikowany
- Wtedy SBOM CycloneDX i wynik skanu są zapisane jako artefakt (retencja jak `sbom` wydania), a pod digestem istnieje atestacja pochodzenia (`actions/attest-build-provenance`; repozytorium publiczne — ADR-0022) wskazująca workflow `ci.yml` i gałąź `main`.

**AC4 — Odrzucenie złej platformy**
- Zakładając obraz zbudowany lub pobrany dla innej platformy niż `linux/arm64`
- Gdy sprawdzana jest platforma (przed skanem)
- Wtedy publikacja jest odrzucona z komunikatem o platformie.

**AC5 — Sesja IaC weryfikuje, nie buduje**
- Zakładając obraz opublikowany z rekordem (AC1) i atestacją (AC3)
- Gdy sesja IaC podstawia digest w zainstalowanym compose (zamiast zerowego digestu)
- Wtedy najpierw weryfikuje: przebieg `ci.yml` w zdarzeniu `push` na `main` (API GitHuba), `gh attestation verify … --signer-workflow …/ci.yml --source-ref refs/heads/main`, `docker pull` po digeście i platformę `linux/arm64`; digest bez rekordu, bez ważnej atestacji albo ręcznie zbudowany nie jest przyjmowany.

**AC6 — Runbooki bez budowy na VM**
- Zakładając zaktualizowane runbooki (`media-processor.md`, `restore.md`)
- Gdy czytam procedurę instalacji obrazów infrastruktury
- Wtedy nie zawiera kroku „zbuduj na VM”, wskazuje weryfikację z AC5, a dowody (skan, SBOM, atestacja) odsyłają do przebiegu CI; `postgres-pgbackrest` ma wpis w `infra/runtime/infra-images.json`.

## Poza zakresem
- Pomijanie budowy przy niezmienionych wejściach (skrót wejść, wykrywanie zmienionych plików) — odłożone 2026-11-12 (oszczędność minut Actions); ewentualna kolejna historyjka po pomiarze minut.
- Polityka kompletności i aktualności w `tools/repo-policy` (klasyfikacja każdego obrazu w `infra/images/`, czerwony wynik dla obrazu bez ścieżki budowy/skanu/SBOM) — odłożona 2026-11-12; ewentualna kolejna historyjka.
- Obraz weryfikatora `evia-verifier` (`infra/images/deploy-agent`): zostaje budowany lokalnie w sesji IaC z czystego `main` (ADR-0018, m5); weryfikatora nie aktualizuje i nie dostarcza kanał, który on weryfikuje. Ewentualny skan Trivy tego obrazu w CI — osobna decyzja Konrada.
- Rozszerzenie `release-manifest` i zmiana weryfikatora V0–V4 (EVM-122); wdrażanie obrazów infrastruktury kanałem pull — nadal wyłącznie sesja IaC.
- Odświeżanie obrazów bazowych (EVM-117), higiena wyjątków skanerów (EVM-118), obraz `web`/Caddy (EVM-120), obrazy z `infra/runtime/infra-images.json` skanowane już dziś w `publish`.
- Zastąpienie runtime `media-processor` distroless (backlog M4, RR-78); osobny podpis obrazów (cosign) — atestacja pochodzenia z AC3 wystarcza.

## Decyzje i ograniczenia
- 2026-11-12 (Konrad): ręczna budowa w sesji IaC to wyjątek jednorazowy (RR-78: przypięty `FFMPEG_VERSION`, Trivy 0 High/Critical, SBOM przed użyciem); publikacja w CI jako osobna historyjka (ta).
- 2026-11-12 (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”): zakres zawężony; budowa na natywnym `ubuntu-24.04-arm` (repo publiczne — ADR-0022, bez QEMU), atestacja pochodzenia zamiast podpisu; rekord obrazu jako artefakt przebiegu, osobny od `release-manifest`.
- Zmiana `.github/**` = plik wrażliwy K3 (przegląd `security-engineer`). Zachowane zasady hermetycznego `publish` (SR-SUPPLY-04, SR-INFRA-14): bez cache, bazy po digeście, `packages: write` i uprawnienia atestacji tylko w tym jobie, zero sekretów w repozytorium.
- Minuty Actions: runnery arm są bezpłatne w repozytorium publicznym; szacunek 10–25 min na przebieg, do zmierzenia w pierwszych 3 przebiegach i zapisania w `github-i-ci.md`.

## Notatki
- Obraz z ręcznej budowy (staging) zostaje zastąpiony obrazem z CI przy najbliższej sesji IaC; pierwszy digest `media-processor` z CI zamyka warunek RR-78 (zaktualizować wpis).

## Dziennik
- 2026-11-12 — utworzono (product-owner) po decyzji Konrada o wyjątku jednorazowym RR-78
- 2026-11-12 — zakres zawężony (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”): natywny arm64 bez QEMU, skan z rejestrem EVM-118, SBOM, atestacja pochodzenia, rekord jako artefakt, pakiety prywatne; AC4 (pomijanie budowy) i AC5 (repo-policy) odłożone do „Poza zakresem”; 6 AC
- 2026-11-12 — draft → ready: akceptacja Konrada z delegacji 2026-11-12 (path pelna, owner devops-engineer, reviewers security-engineer + code-reviewer, model sonnet)
- 2026-11-13 — start realizacji (`/deliver`, ścieżka `pelna`, równolegle z EVM-103 za zgodą Konrada). `depends_on: EVM-084`: potrzebny kod posiedzenia 0 jest na `main` (#126, #129, #130); EVM-084 zostaje `in-progress` tylko z powodu posiedzeń B/C, które z kolei czekają na tę historyjkę. Kontekst z posiedzenia A: build procesora na VM dał Trivy 11 × High z bazy `node:26.10.0-trixie-slim` (npm: brace-expansion, undici; Debian: pcre2, apt, openssl), a VM nie ma wyjścia na port 80 (Tech Lead)
- 2026-11-13 — plan gotowy (devops-engineer)
- 2026-11-13 — implementacja (devops-engineer): job `publish-infra` (natywny arm64, skan obu przed pushem, ImageID = config.digest z GHCR, atestacja, rekord), `builtImages` w `infra-images.json`, Dockerfile procesora (baza node 26.13.1 po digeście także w `api`, bez npm/corepack, `zlib1g` przypięty), testy polityki i runbooki; lokalnie amd64 Trivy 0 High/Critical bez wyciszeń; dowód AC1–AC3 z przebiegu na `main` po scaleniu

- 2026-11-13 (poprawki, runda 1): (1) przegląd bezpieczeństwa, widoczność pakietów — krok `publish-infra` „Anonymous access check” (manifest po digeście bez logowania, tylko 401/403/404 przechodzi) przed atestacją, test polityki, korekta ADR-0022 pkt 3, checklista Konrada (pakiety prywatne z zaślepką + Manage Actions access Write) w `docs/ops/github-i-ci.md`; widoczność `evia-api`/`evia-web` do potwierdzenia przez Konrada (brak zakresu `read:packages` w `gh`). (2) przegląd kodu, magazyn — `tools/ghcr-retention` obejmuje oba pakiety infrastruktury i chroni digesty z `infra-images-record` (dry-run); pomiar zajętości w `github-i-ci.md`; pomijanie budowy przy niezmienionych wejściach — kandydat na kolejną historyjkę.
- 2026-11-13 (poprawki, runda 2): (1) strażnik prywatności w kroku push `publish-infra` — przed pierwszym `docker push` anonimowe `tags/list` musi dać 401/403/404, a z tokenem joba 200 (pakiet istnieje, repozytorium ma dostęp), inaczej czerwony bez pushu; test polityki (kolejność, usunięcie lub osłabienie warunku = naruszenie); ADR-0022 pkt 3(d) i checklista Konrada. (2) `evia-api` i `evia-web` są publiczne (anonimowy token i `tags/list` = 200, 2026-11-13): decyzja Konrada A (usunąć i utworzyć prywatne) albo B (wyjątek w ADR-0022) — **warunek scalenia, orkiestrator sprawdza przed prośbą o scalenie**; wpisano w ADR-0022 pkt 3(c) i `docs/ops/github-i-ci.md`.
- 2026-11-13 (decyzja Konrada, poprawki, runda 3): pakiety GHCR `evia-api` i `evia-web` zostają publiczne, nowe pakiety infrastruktury także mogą być publiczne (obrazy zawierają tylko kod z publicznego repozytorium); zamiast prywatności — **skan sekretów obrazów przed publikacją**. Zmiany: `ci.yml` — w `publish` (api, web, obrazy infrastruktury) i `publish-infra` osobny przebieg Trivy `--scanners secret --exit-code 1` (bez `--severity`: każdy poziom ważności = czerwony; bez wpisów rejestru wyjątków; raport nie jest przesyłany, w logu tylko reguła, poziom, plik i linia), przed logowaniem do GHCR i pushem; usunięte: strażnik prywatności przed pierwszym pushem i krok „Anonymous access check” (pakiety powstają przy pierwszym pushu z CI, bez ręcznych kroków Konrada); `tools/repo-policy` — `secretScanProblems` dla obu jobów, testy zamiast testów prywatności; ADR-0022 pkt 3 i `docs/ops/github-i-ci.md`, runbooki — spójne. Dowód jednorazowy (Trivy 0.74.0 przypięty, `--scanners secret`, wszystkie poziomy, linux/arm64, przebieg `publish` 43430373672, commit 315275623088576c86b09d69cafcd0ce0d22f664): `evia-api@sha256:d2734bc6…` 0 sekretów, `evia-web@sha256:e55dac11…` 0 sekretów (zapis w `.scratch/EVM-124/`).
