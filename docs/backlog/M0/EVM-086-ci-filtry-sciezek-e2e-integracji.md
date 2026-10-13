---
id: EVM-086
title: CI — E2E i testy integracyjne tylko przy zmianach, których dotyczą
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P1
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-083]
---

# EVM-086: CI — E2E i testy integracyjne tylko przy zmianach, których dotyczą

## Cel
Jako **Konrad (właściciel produktu)** chcę, **aby kosztowne joby CI (`e2e-web`, `backend-integration`) uruchamiały się tylko wtedy, gdy zmiana może je dotyczyć**, aby **zużycie minut GitHub Actions zbliżyło się do progu 53 min/dzień** (EVM-083 AC5: szacunek po EVM-083 ok. 212 min/dzień). Propozycje 4 i 5 z `docs/ops/github-i-ci.md` → „Propozycje dalszych cięć”, wybrane przez Konrada 2026-10-13.

## Kryteria akceptacji
Szkic do `/refine` — do doprecyzowania z `security-engineer` (fail-closed, lista ścieżek jawna).

**AC1 — E2E tylko przy zmianach panelu**
- Zakładając PR do `main`
- Gdy zmienione pliki nie obejmują `apps/web/**`, `packages/**`, `pnpm-lock.yaml`, `.github/**` ani innych ścieżek z jawnej listy
- Wtedy `e2e-web` jest pominięty, a `ci-gate` to akceptuje; każda wątpliwość (błąd wykrywania, ścieżka spoza listy znanych) = pełny zestaw.

**AC2 — Integracja tylko przy zmianach API**
- Zakładając PR do `main`
- Gdy zmienione pliki nie obejmują `apps/api/**`, `packages/**`, `pnpm-lock.yaml`, `.github/**` ani innych ścieżek z jawnej listy
- Wtedy `backend-integration` (i zależny `coverage` — do ustalenia, czy diff-coverage pozostaje kompletne) jest pominięty z tą samą zasadą fail-closed.

**AC3 — Firefox tylko w nocy**
- Zakładając przebieg `pull_request` albo `push` na `main`
- Gdy uruchamia się `e2e-web`
- Wtedy działa tylko Chromium, a Firefox — w przebiegu nocnym (`nightly.yml`) z alertem przy błędzie.

**AC4 — Push na `main` i niezmienniki**
- Wtedy push na `main` nadal uruchamia pełny zestaw (ADR-0018 V2, decyzja EVM-083), a test w `tools/repo-policy` pilnuje list ścieżek i zasady fail-closed.

**AC5 — Szacunek**
- Wtedy `docs/ops/github-i-ci.md` zawiera szacunek po zmianie (metodą z EVM-083 AC5).

## Poza zakresem
- `main` bez E2E i integracji (propozycja 2 — sprzeczna z ADR-0018).
- Zmiany planu GitHub, runner na własnej VM.

## Decyzje i ograniczenia
- 2026-10-13 — Konrad: wdrażamy propozycje 4 i 5; propozycja 1 (statusy „done” w kolejnym PR zamiast osobnych PR-ów) — od razu jako zmiana sposobu pracy orkiestratora, bez kodu.

## Notatki
- Utworzone przez orkiestratora na demo EVM-083 jako draft; wymaga `/refine` (product-owner, konsultacja security).

## Dziennik
- 2026-10-13 — utworzono (orkiestrator, demo EVM-083, decyzja Konrada o cięciach 4 i 5)
