---
id: EVM-124
title: Publikacja obrazów infrastruktury (pgbackrest, media-processor) w CI — budowa, skan, SBOM, digest
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
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
Jako **właściciel produktu** chcę, **aby obrazy infrastruktury budowane dziś ręcznie w sesji IaC (`postgres-pgbackrest`, `evia-media-processor`) przechodziły tę samą ścieżkę co obrazy wydania** (budowa z repozytorium bez cache, skan Trivy, SBOM, przypięcie digestu), aby **sesja IaC tylko pobierała i weryfikowała gotowy obraz, a wyjątek jednorazowy z 2026-11-12 (RR-78, warunkowo) wygasł**. Dziś te obrazy powstają natywnie na VM, poza skanem w CI (`media-processor.md`, „Dług i otwarte kroki”); `compose.media.yaml` ma digest zerowy, a `postgres-pgbackrest` nie ma wpisu w `infra-images.json`.

## Kryteria akceptacji

**AC1 — Publikacja z repozytorium**
- Zakładając push na `main` ze zmianą wejść budowy obrazu infrastruktury (Dockerfile, jego kontekst, przypięte wersje, w tym `FFMPEG_VERSION`) po zielonym `ci-gate`
- Gdy przebiega publikacja obrazów infrastruktury
- Wtedy obraz jest zbudowany bez cache, z bazami po digeście, dla `linux/arm64`, opublikowany w GHCR i opisany rekordem (obraz, digest, commit, skrót wejść budowy); rekord jest osobny od `release-manifest` wydania.

**AC2 — Skan i SBOM przed publikacją (warunek RR-78)**
- Zakładając zbudowany obraz
- Gdy Trivy znajdzie podatność High/Critical z dostępną poprawką, której nie pokrywa wyjątek z rejestru (`.trivyignore.yaml`, EVM-118), albo brakuje przypiętej wersji `FFMPEG_VERSION`
- Wtedy przebieg jest czerwony i nic nie trafia do GHCR; dla obrazu bez takich podatności SBOM CycloneDX i wynik skanu są zapisane jako artefakt (retencja jak `sbom` wydania).

**AC3 — Odrzucenie złej platformy**
- Zakładając obraz zbudowany lub pobrany dla innej platformy niż `linux/arm64`
- Gdy sprawdzana jest platforma (przed skanem)
- Wtedy publikacja jest odrzucona z komunikatem o platformie.

**AC4 — Brak budowy przy zmianie niezwiązanej (minuty Actions)**
- Zakładając push na `main` zmieniający wyłącznie pliki spoza wejść budowy obrazów infrastruktury (np. dokumentacja, kod `web`) albo ze skrótem wejść już opublikowanym
- Gdy ocenia się potrzebę publikacji
- Wtedy żaden obraz infrastruktury nie jest budowany ani publikowany, nie powstaje nowy digest, a podsumowanie przebiegu wskazuje powód pominięcia; przy niepewności co do zmienionych plików (brak bazy porównania) publikacja działa (fail-closed).

**AC5 — Polityka kompletności i aktualności w repozytorium**
- Zakładając katalog obrazu w `infra/images/`
- Gdy działa `tools/repo-policy` (bramka)
- Wtedy każdy obraz jest jawnie sklasyfikowany (wydania / infrastruktury / świadomie poza publikacją z uzasadnieniem), a obraz bez klasyfikacji (dziś `postgres-pgbackrest`) albo obraz infrastruktury bez ścieżki budowy, skanu i SBOM w `ci.yml` daje czerwony wynik; test negatywny dla każdego przypadku.

**AC6 — Sesja IaC pobiera, nie buduje**
- Zakładając obraz opublikowany z rekordem (AC1)
- Gdy sesja IaC podstawia digest w zainstalowanym compose (zamiast zerowego digestu) wg zaktualizowanych runbooków (`media-processor.md`, `restore.md`)
- Wtedy procedura wymaga zgodności digestu z rekordem i commitu z `main`, a digest bez rekordu, z niezgodnym skrótem wejść albo ręcznie zbudowany nie jest przyjmowany; runbooki nie zawierają już kroku „zbuduj na VM”, a dowody (skan, SBOM) wskazują przebieg CI.

## Poza zakresem
- Obraz weryfikatora `evia-verifier` (`infra/images/deploy-agent`): zostaje budowany lokalnie w sesji IaC z czystego `main` (ADR-0018, m5); weryfikatora nie aktualizuje i nie dostarcza kanał, który on weryfikuje. Ewentualny skan Trivy tego obrazu w CI (bez publikacji i bez zmiany procedury instalacji) — osobna decyzja Konrada, nie ta historyjka.
- Rozszerzenie `release-manifest` i zmiana weryfikatora V0–V4 (EVM-122); wdrażanie obrazów infrastruktury kanałem pull — nadal wyłącznie sesja IaC.
- Odświeżanie obrazów bazowych (EVM-117), higiena wyjątków skanerów (EVM-118), obraz `web`/Caddy (EVM-120), obrazy z `infra-images.json` (skanowane już dziś w `publish`).
- Zastąpienie runtime `media-processor` distroless (backlog M4, RR-78); podpisy obrazów i atestacje — do ustalenia po konsultacji (pytanie S1), nie zakładamy ich w AC.

## Decyzje i ograniczenia
- 2026-11-12 (Konrad): ręczna budowa w sesji IaC to wyjątek jednorazowy (RR-78: przypięty `FFMPEG_VERSION`, Trivy 0 High/Critical, SBOM przed użyciem); publikacja w `publish` jako osobna historyjka (ta).
- Propozycja do akceptacji: rekord obrazów infrastruktury jest osobny od `release-manifest`, bo manifest czyta weryfikator V3 (zmiana schematu = aktualizacja weryfikatora w sesji IaC, EVM-122), a obrazy infrastruktury instaluje wyłącznie sesja IaC.
- Zmiana `.github/**` = plik wrażliwy K3 (przegląd `security-engineer`). Zachowane zasady hermetycznego `publish` (SR-SUPPLY-04, SR-INFRA-14): bez cache, bazy po digeście, `packages: write` tylko w tym jobie, zero sekretów w repozytorium.
- Ryzyko techniczne: runtime `media-processor` i `postgres-pgbackrest` wykonują `RUN` (apt) na arm64, a polityka `publish` zakazuje QEMU (runner x86; runnery arm bezpłatne tylko w repo publicznych) — wariant budowy do rozstrzygnięcia przez architekta (pytanie A1).
- Minuty Actions (GitHub Free, 2000 min/mies., cel ≤ 1600): publikacja tylko przy zmianie wejść (AC4). Szacunek: 10–25 min na przebieg (budowa arm64 + 2 skany + SBOM), 2–4 przebiegi miesięcznie (zmiany Dockerfile, bump baz) ≈ 40–100 min/mies. (2–5% puli); do zmierzenia w pierwszych 3 przebiegach i zapisania w `github-i-ci.md`; powyżej 25 min/przebieg lub 100 min/mies. wraca do Konrada.

## Notatki
- Obraz z ręcznej budowy (staging) zostaje zastąpiony obrazem z CI przy najbliższej sesji IaC; pierwszy digest `media-processor` z CI zamyka warunek RR-78 (zaktualizować wpis).

## Dziennik
- 2026-11-12 — utworzono (product-owner) po decyzji Konrada o wyjątku jednorazowym RR-78
