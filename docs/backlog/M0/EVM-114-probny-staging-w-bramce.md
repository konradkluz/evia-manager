---
id: EVM-114
title: Próbny staging — lokalna próba stosu z flagami produkcyjnymi w bramce
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P1
path: pelna            # bramka jakości i pliki infrastruktury, przegląd security
owner: devops-engineer
contributors: []
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-007, EVM-086]
---

# EVM-114: Próbny staging — lokalna próba stosu z flagami produkcyjnymi w bramce

> Szablon ma mieścić się w 1–2 stronach. Plany i raporty agentów — `.scratch/`.

## Cel
Jako **właściciel produktu** chcę, **aby przed pushem lokalna próba uruchamiała stos z `infra/runtime/compose.staging.yaml` na świeżo zbudowanych obrazach i z flagami produkcyjnymi**, aby **błędy widoczne dotąd dopiero na VM wychodziły w bramce**. Podczas EVM-007 trzy defekty ujawnił dopiero żywy staging: #94 (Caddy montował pojedyncze pliki, `deploy.sh` podmienia je przez `mv`), #97 (migracja jako `evia_migrator` bez CREATEROLE), #100 (file capability binarki Caddy przy `cap_drop: ALL` i `no-new-privileges`).

## Kryteria akceptacji

**AC1 — Stos pod flagami produkcyjnymi**
- Zakładając obrazy `api`, `worker`, `web` i brzegowy Caddy zbudowane lokalnie z bieżącego kodu
- Gdy uruchamiam próbę (jedno polecenie, Docker wyłącznie przez `docker compose -f … run --rm`)
- Wtedy usługi startują z flagami z `compose.staging.yaml`: użytkownik nie-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `tmpfs`, sieci wewnętrzne; próba nie nadpisuje tych flag (test porównuje zestaw flag próby z plikiem źródłowym), a różnice dozwolone (obrazy lokalne, syntetyczne sekrety, porty) są wymienione w jednym miejscu.

**AC2 — Kolejność i zdrowie**
- Zakładając pusty wolumen PostgreSQL
- Gdy próba przechodzi kolejność: PostgreSQL → migracja jako rola `evia_migrator` → `api`/`worker`/`web` → Caddy
- Wtedy `GET /healthz` oraz `GET /version` (przez Caddy) zwracają 200 w limicie czasu, a migracja jest wykonana wyłącznie rolą `evia_migrator` (nie superużytkownikiem); przekroczenie limitu albo kod ≠ 0 dowolnego kroku kończy próbę kodem ≠ 0 z nazwą usługi i końcówką jej logu.

**AC3 — Regresje z EVM-007 wychodzą przed pushem**
- Zakładając trzy znane defekty (#94, #97, #100)
- Gdy w teście próby celowo je przywracam (montaż pojedynczego pliku Caddy, migrator bez uprawnień powyżej `evia_migrator`, obraz web z file capability)
- Wtedy każdy z trzech wariantów kończy próbę kodem ≠ 0 z czytelnym powodem, a wariant poprawny — kodem 0.

**AC4 — Bezpieczeństwo próby**
- Zakładając uruchomienie na stacji dewelopera i w CI
- Gdy próba działa
- Wtedy używa wyłącznie danych syntetycznych (bez prawdziwych sekretów i `.env`), nie publikuje obrazów, nie łączy się z rejestrami wydań ani z VM, sprząta kontenery, sieci i wolumeny także po błędzie, a wyjście nie zawiera wartości sekretów.

**AC5 — Wpięcie w bramkę**
- Zakładając zmianę w `infra/**`, `apps/**/Dockerfile`, `infra/runtime/**` albo w `tools/repo-policy`
- Gdy uruchamiam `pnpm run gate` (lokalnie) i CI
- Wtedy próba jest etapem bramki (osobny skrypt `gate:*`, uruchamiany filtrem ścieżek jak w EVM-086), czerwony etap daje kod ≠ 0; zmiana bez dotknięcia tych ścieżek jej nie uruchamia; czas próby jest zmierzony i zapisany w dzienniku.

## Poza zakresem
- Próba TLS/ACME z prawdziwą domeną, DNS, TEM, GHCR, deploy-agent na VM (wymagają sesji IaC).
- Test rollbacku i reboot VM (EVM-094 / sesje IaC).
- Parytet arm64 z CAX11 (próba lokalna na architekturze hosta; różnicę odnotować, nie emulować QEMU).

## Decyzje i ograniczenia
- Do rozstrzygnięcia przez `solution-architect` w planie: TLS brzegu w próbie (tryb bez ACME), czy próba jest w `pnpm run gate` zawsze, czy tylko przy zmianie ścieżek (rekomendacja: filtr ścieżek, lokalnie i w CI).
- Docker wyłącznie przez `docker compose -f compose.yaml run --rm <usługa>` (nigdy `docker run`); nowe zależności tylko z uzasadnieniem.

## Notatki
- Backend lokalnie tylko w kontenerze Linux (ADR-0015) — próba spełnia tę zasadę z założenia.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z pozycji po zamknięciu EVM-007
