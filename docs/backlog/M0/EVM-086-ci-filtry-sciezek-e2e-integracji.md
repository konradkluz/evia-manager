---
id: EVM-086
title: CI — E2E i testy integracyjne tylko przy zmianach, których dotyczą
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
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
Stan wyjściowy (2026-10-15): `changes` (`tools/ci-changes`) wystawia jedno `heavy`; `false` tylko gdy cała zmiana PR to dokumentacja (`docs/**`, `*.md` w katalogu głównym); `e2e-web`, `backend-integration` i `coverage` wykonują się przy `heavy=true`, a `ci-gate` (jq, `GATE_JQ` w `tools/repo-policy`) akceptuje ich pominięcie tylko przy `heavy=false`. `e2e-web` uruchamia Chromium i Firefox w 2 shardach. `nightly.yml` ma dziś tylko skany.

**AC1 — Jawne listy ścieżek, pominięcie tylko dla „znanych jako niedotyczące”**
- Zakładając listy ścieżek zapisane jawnie w repozytorium (`tools/ci-changes`): dla `e2e-web` i dla `backend-integration` osobno lista „nie dotyczy” (np. dokumentacja; `apps/api/**` i `apps/mobile/**` dla E2E panelu; `apps/web/**` i `apps/mobile/**` dla integracji API)
- Gdy `changes` ocenia zmianę PR do `main`
- Wtedy wystawia osobne wyjścia dla `e2e-web` i `backend-integration`, a job jest pomijany wyłącznie, gdy KAŻDY zmieniony plik leży na liście „nie dotyczy” tego joba; plik spoza obu list, `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`, `tools/**`, `compose*.yaml`, konfiguracja główna i `.claude/**` nigdy nie są „nie dotyczy”.

**AC2 — Fail-closed (przypadki negatywne)**
- Zakładając błąd `git diff`, brak lub niepoprawny commit bazowy, pustą listę zmian, nieznane zdarzenie, ścieżkę z `..`, `\` lub sterującymi znakami, albo nieczytelne wyjście `changes`
- Gdy `changes` albo `ci-gate` to ocenia
- Wtedy oba joby się uruchamiają (wartość „dotyczy”), a `ci-gate` jest czerwony, gdy wyjście jest brakujące lub inne niż `true`/`false`; testy jednostkowe `tools/ci-changes` pokrywają każdy z tych przypadków oraz zmianę mieszaną (np. `apps/api` + `docs`, `apps/web` + plik spoza list).

**AC3 — `ci-gate` i `coverage`**
- Zakładając pominięcie `e2e-web` lub `backend-integration`
- Gdy `ci-gate` sprawdza wyniki
- Wtedy pominięty job jest zaliczony tylko przy jawnym „nie dotyczy” z `changes` (każdy inny `skipped`, `cancelled`, `failure` lub brakujący job = czerwony), a `coverage` nadal działa dla każdej zmiany spoza samej dokumentacji i przyjmuje brak artefaktu `lcov-integration` tylko przy jawnym „nie dotyczy” integracji (diff-coverage ≥ 90% liczone dla zmienionego kodu z dostępnych raportów, bez obniżania progu); `GATE_JQ` w `ci.yml` i w `tools/repo-policy` zmienione razem, a testy `tools/repo-policy` obejmują macierz: wszystkie jobs zielone, pominięty „nie dotyczy”, pominięty bez „nie dotyczy”, brak wyjścia.

**AC4 — Zawsze pełny zestaw i niezmienniki polityki**
- Zakładając `push` na `main`, `workflow_dispatch`, przebieg nocny albo zdarzenie inne niż `pull_request`
- Gdy uruchamia się CI
- Wtedy `e2e-web`, `backend-integration` i `coverage` działają w pełnym zakresie (ADR-0018 V2: weryfikator ufa przebiegowi `main`), a `tools/repo-policy` ma test pilnujący: listy ścieżek są jawne i nie zawierają ścieżek z AC1 jako „nie dotyczy”, filtr obowiązuje tylko dla `pull_request`, `ci-gate` jest jedynym jobem z `always()`, a zmiany nie dodają akcji spoza listy przypiętych po pełnym SHA z komentarzem wersji (zizmor i `pnpm run scan` zielone).

**AC5 — Firefox tylko w nocy**
- Zakładając `pull_request` i `push` na `main`
- Gdy uruchamia się `e2e-web`
- Wtedy działa tylko Chromium (instalowany tylko on), a pełny zestaw z Firefoksem działa w `nightly.yml` (`schedule` na `main`, te same shardy i `timeout-minutes`, artefakt raportu przy porażce), przy błędzie GitHub wysyła e-mail do Konrada tak jak dla skanów; `apps/web/playwright.config.ts` zachowuje oba projekty dla uruchomień lokalnych i nocnych, a `docs/ops/github-i-ci.md` opisuje tę różnicę względem ADR-0015.

**AC6 — Szacunek i dokumentacja**
- Zakładając wdrożone AC1–AC5
- Gdy czytam `docs/ops/github-i-ci.md`
- Wtedy tabela „Szacunek przed / po” ma wiersz „po EVM-086” policzony metodą z EVM-083 AC5 (przebiegi/dzień × minuty per job, z założonym udziałem PR-ów web / api / mieszanych), propozycje 4 i 5 są oznaczone jako wdrożone, a listy ścieżek i zasada fail-closed są opisane (także w `tools/ci-changes/README.md`); zmiany `docs/ops/github-i-ci.md` scalone z zapisem EVM-087 (kolejność 087 → 086).

## Poza zakresem
- `main` bez E2E i integracji (propozycja 2 — sprzeczna z ADR-0018).
- Pominięcie `backend` i testów w `quality` dla samej dokumentacji (propozycja 3).
- Zmiany planu GitHub, runner na własnej VM, nowe akcje i usługi zewnętrzne.
- Zmiana liczby shardów, workerów, `retries`, progów pokrycia; lokalna usługa Playwright Linux (EVM-087).
- Filtry dla `quality`, `backend` i `security` (zawsze uruchamiane).

## Decyzje i ograniczenia
- 2026-10-13 — Konrad: wdrażamy propozycje 4 i 5; propozycja 1 (statusy „done” w kolejnym PR zamiast osobnych PR-ów) — od razu jako zmiana sposobu pracy orkiestratora, bez kodu.
- 2026-10-15 — wymagania security wprost w AC (bez osobnej konsultacji): fail-closed, jawna lista w repo, pominięcie tylko przy jawnym „nie dotyczy”, `main` i przebiegi nocne zawsze pełne, test `repo-policy`, bez nowych akcji (przypięcie po SHA). Recenzent `security-engineer` (zmiana `.github/**`, K3: PR do uwagi Konrada).
- Lista „nie dotyczy” zamiast listy „dotyczy”: nowa, nieznana ścieżka domyślnie uruchamia testy.
- Szacunek oszczędności (≈ −20 i ≈ −17 min/dzień) zależy od udziału PR-ów dotykających tylko web lub tylko api; kolejki zależnych historyjek na jednej gałęzi (EVM-087) zmniejszają liczbę PR-ów, więc realna oszczędność może być mniejsza — mierzymy po ≥ 7 dniach (tabela „Potwierdzenie z Billing”).
- 2026-10-15 — Konrad: Firefox w E2E wyłącznie w przebiegu nocnym (PR i `main` tylko Chromium); `coverage` nie jest pomijany, gdy pominięto integrację (AC3).

## Zależności
- `depends_on: [EVM-083]` (done: `changes`, `ci-gate`, `tools/ci-changes`, `tools/repo-policy`).
- Nakłada się z EVM-087 (ready): obie zmieniają `docs/ops/github-i-ci.md` i CI. **Realizacja na jednej gałęzi z EVM-087, kolejność 087 → 086** (osobne commity `[EVM-087]`, `[EVM-086]`, jeden PR, jeden przebieg CI); EVM-086 uwzględnia w dokumentacji zmiany EVM-087 (lokalna usługa Playwright Linux dotyczy Chromium i Firefoksa jak w CI przed zmianą — opis w `github-i-ci.md` po EVM-086 ma wskazywać, że lokalnie Firefox jest opcjonalny, a w CI tylko nocą).
- Uwaga: pierwszy PR z tą zmianą dotyka `.github/**`, więc dla niego obowiązuje pełny zestaw (tak ma działać AC1).

## Notatki
- Utworzone przez orkiestratora na demo EVM-083 jako draft; doprecyzowane w /refine 2026-10-15.
- Ryzyko: szacunek po EVM-086 (~−37 min/dzień z propozycji 4 i 5) nie osiąga celu 53 min/dzień; pozostałe dźwignie: propozycje 2, 3, 6.
- Ryzyko rezydualne R1 (Low, security, do akceptacji na demo): błąd tylko-Firefox (także CSP/nagłówki) wyjdzie w nocnym przebiegu, po scaleniu; V2 ufa przebiegowi `main` (tylko Chromium). Rekomendacja security: czerwony nocny `e2e-web` wstrzymuje wydanie na prod do wyjaśnienia.
- Ryzyko rezydualne R2 (minor, security): `tools/ci-changes/` i `tools/repo-policy/` nie są plikami wrażliwymi K3 — PR może zmienić klasyfikator i jego test razem. Rekomendacja: osobna historyjka (`/refine`) — dopisać je do K3 (CODEOWNERS, szablon PR, podsumowanie `security`, log K6); wariant mocniejszy: klasyfikator z commita bazowego.
- Testy macierzy `GATE_JQ` (AC3) lokalnie pomijane bez `jq` — dowód w logu joba `quality` przebiegu PR (sprawdzić, że nie były pominięte).
- Szacunek oszczędności: ok. −15 min/dzień (229 → 214), nocny Firefox oddaje część oszczędności; cel 53 min/dzień nadal poza zasięgiem.
- Wykonawca pobrał `jq` 1.7.1 z wydania GitHub (sha256 sprawdzony) do `.scratch/jqdl/` — tylko lokalnie, poza repo.

## Dziennik
- 2026-10-13 — utworzono (orkiestrator, demo EVM-083, decyzja Konrada o cięciach 4 i 5)
- 2026-10-15 — refinement (product-owner): 6 AC, ścieżka lekka, wspólna gałąź z EVM-087 (087 → 086); status `draft`
- 2026-10-15 — Konrad zaakceptował AC i rozstrzygnął 2 pytania; draft → ready
- 2026-10-15 — ready → in-progress (kolejka nocna, gałąź `feature/EVM-087-086-proces-ci`, po EVM-087)
- 2026-10-15 — implementacja (devops-engineer): wyjścia `heavy`/`e2e`/`integration` w `tools/ci-changes`, `GATE_JQ` i trasowanie w `ci.yml` oraz `tools/repo-policy`, Chromium-only w `ci.yml` i pełne E2E z Firefoksem w `nightly.yml`, dokumentacja i szacunek (≈ −15 min/dzień) w `docs/ops/github-i-ci.md`
- 2026-10-15 — przegląd security-engineer: approve (1 minor, 2 nit → „Notatki”; komentarze `ci.yml` poprawione przez orkiestratora `df9e0b1`); orkiestrator: AC1–AC5 → testy `EVM-086 AC#`, AC6 → `docs/ops/github-i-ci.md`; `pnpm run gate` zielony (diff-coverage 61/61, 36/36), `pnpm run scan` zielony, `docs:check` 0/0; in-progress → in-review
- 2026-10-15 — Koszt: potok 2 wywołania agentów, ok. 0,22 mln tokenów subagentów, ok. 28 min; rundy poprawek 0; ścieżka lekka; sonnet
