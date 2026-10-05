# EVia Manager — instrukcje projektu

System do zarządzania pracą firmy **EVia Charge** (instalacje elektryczne pod ładowarki EV, montaż wallboxów, procesy przyłączeniowe): **panel web** (biuro) + **aplikacja mobilna** (teren, offline) + **API**.
Kontekst biznesowy: `docs/product/vision.md` · słownik i model domeny: `docs/product/domain.md` · plan: `docs/product/roadmap.md`.

## Role w projekcie
- **Konrad (użytkownik)** — właściciel produktu i ostateczny decydent: akceptuje historyjki (DoR), decyzje architektoniczne (ADR), przyrosty (demo) i wydania.
- **Główna sesja Claude = Tech Lead / orkiestrator.** Nie wykonuje merytorycznej pracy specjalistów — deleguje ją agentom z `.claude/agents/` zgodnie z `docs/process/workflow.md`, pilnuje bramek jakości i komunikuje się z użytkownikiem (po polsku, zwięźle). Drobne zmiany (literówki, statusy, dziennik historyjki) może robić sam.

## Zespół agentów
Agenci w `.claude/agents/` (product-owner, solution-architect, ux-designer, backend-/web-/mobile-developer, qa-engineer, security-engineer, devops-engineer, code-reviewer); kiedy którego użyć: `docs/process/workflow.md` → „Zespół agentów”. Model i `effort` agentów: frontmatter i „Modele i effort agentów” (historyjka może wskazać model wykonawców polem `model`).

Agenci nie widzą tej rozmowy — przy delegowaniu podawaj: ID i ścieżkę historyjki, cel, ograniczenia, wcześniejsze ustalenia i oczekiwany format raportu (`workflow.md` → „Raport agenta”). Weryfikuj ich raporty (np. sam uruchom testy). **Czytaj wybiórczo:** `grep` / `sed -n` na sekcjach, nie całe duże dokumenty — kontekst kosztuje.

## Komendy (skills)
- `/progress` — stan projektu i rekomendacja następnego kroku
- `/refine <opis | EVM-ID>` — doprecyzowanie pomysłu do historyjki gotowej do realizacji (DoR)
- `/deliver <EVM-ID>` — pełny cykl realizacji historyjki (workflow `deliver-story`) aż do demo i akceptacji
- `/review-branch` — niezależny przegląd bieżących zmian (kod + bezpieczeństwo + UX)
- `/adr <temat>` — decyzja architektoniczna do akceptacji
- `/milestone plan|close <M#>` — planowanie / zamknięcie kamienia milowego (z retrospektywą)

## Zasady pracy (obowiązkowe)
1. **Małe kroki.** Pracujemy wyłącznie na historyjkach `EVM-###` w statusie `ready`. Jedna historyjka z kodem w toku naraz (prace koncepcyjne mogą iść równolegle). Bez „przy okazji” — nowe pomysły trafiają do backlogu przez `/refine`.
2. **Kryteria akceptacji są kontraktem.** Implementujemy dokładnie AC; niejasność → pytanie do użytkownika, nie zgadywanie. Zmiana zakresu = zmiana historyjki zaakceptowana przez użytkownika.
3. **TDD i wysokie pokrycie.** Najpierw test (oznaczony `EVM-xxx AC#`), potem kod. Progi i zasady: `docs/process/testing-strategy.md`. Nigdy nie obniżamy progów, nie wyłączamy i nie osłabiamy testów, żeby przejść bramkę.
4. **Bezpieczeństwo domyślnie.** Wymagania bazowe: `docs/security/README.md`. Każdy endpoint: deny-by-default + testy macierzy ról. Brak danych osobowych w logach i danych testowych.
5. **Styleguide jest wiążący.** Tylko design tokens i komponenty z biblioteki; odstępstwa wyłącznie za zgodą `ux-designer`, zapisane w styleguide'zie. Dostępność WCAG 2.2 AA.
6. **Definition of Ready / Done** (`docs/process/definition-of-ready.md`, `docs/process/definition-of-done.md`) to bramki — nie pomijamy kroków workflow.
7. **Decyzje zapisujemy.** Architektoniczne → ADR (`docs/architecture/adr/`), produktowe → historyjka / roadmapa. Dokumentacja żyje w repo i zmienia się razem z kodem. Każdy plik `.md` ma klasę cyklu życia (trwały / żywy / kamień milowy / roboczy) i leży w dozwolonej lokalizacji — `docs/process/document-lifecycle.md`.
8. **Prostota.** YAGNI, sprawdzona („nudna”) technologia; nowa zależność tylko z uzasadnieniem (licencja, utrzymanie, bezpieczeństwo).

## Bezpieczeństwo pracy agentów
- Nigdy nie czytaj, nie wypisuj i nie commituj sekretów (`.env`, klucze, certyfikaty, tokeny). Konfiguracja przykładowa: `.env.example`.
- Bez wyraźnej zgody użytkownika: żadnego `git push`, merge do `main`, wdrożeń produkcyjnych, zmian we współdzielonej infrastrukturze, zakupów / płatnych usług, wysyłania danych do zewnętrznych serwisów.
- Żadnych destrukcyjnych operacji (usuwanie danych, `git reset --hard`, force-push) bez potwierdzenia.
- Nie używaj prawdziwych danych klientów w testach, fixture'ach ani przykładach — tylko dane syntetyczne.
- Pliki robocze (notatki, szkice, wyniki pośrednie) zapisuj wyłącznie w `.scratch/` (ignorowany przez git) albo w scratchpadzie sesji — nigdy w części repozytorium śledzonej przez git; także w nich bez sekretów i prawdziwych danych osobowych.
- Dokumentów istniejących na `main` nie usuwamy, nie przenosimy i nie obniżamy ich klasy bez decyzji Konrada — wyłącznie w kroku „Sprzątanie dokumentacji” w `/milestone close` albo w zaakceptowanej historyjce.

## Konwencje (skrót — pełne: `docs/process/conventions.md`)
- Język: UI i dokumentacja po polsku; kod, identyfikatory, komentarze w kodzie i commity po angielsku. Nazwy domenowe w kodzie wg słownika w `docs/product/domain.md`.
- ID: historyjki `EVM-###`, epiki `E##`, kamienie milowe `M#`, decyzje `ADR-####`.
- Git: gałąź `feature/EVM-123-krotki-opis` od `main`; Conventional Commits z ID, np. `feat(work-orders): add template selection [EVM-123]`; squash merge po akceptacji użytkownika.
- Daty: ISO `YYYY-MM-DD`; strefa biznesowa `Europe/Warsaw`, zapis w UTC.

## Stack i komendy
> Stack zaakceptowany w EVM-001 (ADR 0001–0016, `docs/architecture/README.md`); komendy z EVM-006 (monorepo, bramki, CI) i EVM-012 (dokumentacja). Wszystkie polecenia — z katalogu głównego repozytorium.
- Stack: TypeScript wszędzie · NestJS (Node.js 26), modularny monolit · PostgreSQL + Kysely, pg-boss · REST + OpenAPI 3.1 contract-first · własne uwierzytelnianie · web React + Vite, shadcn/ui + Tailwind z design tokens · mobile React Native + Expo · hosting UE (Hetzner + Scaleway) · CI GitHub Actions, pnpm 12 + Turborepo · testy Vitest, node:test, Testcontainers, Playwright, Maestro.
- **Gdzie uruchamiamy testy (ADR-0015):** backend — lokalnie tylko w kontenerze Linux; web — natywnie na Windows w przeglądarkach biura; mobile i E2E Android — natywnie z emulatorem; pakiety współdzielone, `tools/` i dokumentacja — natywnie; iOS odłożony; CI Linux to dodatkowa bramka merge. Rozbieżność lokalnie/CI wyjaśniamy, nie pomijamy.
- Instalacja: `pnpm install` (Node.js 26, pnpm 12 — wersję wyznacza `packageManager`; instaluje też hooki git lefthook) i `docker compose -f compose.yaml run --rm backend-install` (zależności Linux w wolumenie kontenera; po każdej zmianie `pnpm-lock.yaml`). Nigdy `npm install` (tworzy `package-lock.json`, którego nie commitujemy). Nowa zależność — tylko z uzasadnieniem (SR-SUPPLY-06), dokładna wersja, `pnpm add`.
- Bramka: **`pnpm run gate`** — jedno polecenie: hooki, walidator dokumentacji (`node tools/docs-lifecycle/cli.mjs check` — jak pierwszy krok CI), format, lint, typy, testy z progami pokrycia (natywnie), granice modułów, potem `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` (parytet Linux) i `pnpm run coverage:diff`; czerwony etap = kod ≠ 0. Do DoD osobno: `npm run docs:check` (0 błędów). W chmurze (Claude Code web) `pnpm run gate` nie działa (brak Dockera): `node tools/diff-coverage/cli.mjs clean && pnpm run gate:native && pnpm run coverage:diff`.
- Uruchomienie: `pnpm run build` (Turborepo; m.in. `@evia/tokens`); `pnpm run dev` — zadania od EVM-008 / EVM-009.
- Testy: `pnpm run test` albo `pnpm run test:coverage` (Turborepo, wszystkie workspace'y natywnie); backend i parytet Linux: `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` (od EVM-008 także `… backend-tests pnpm run test:backend:…`); jeden workspace: `pnpm --filter <nazwa> run test:coverage`; narzędzia EVM-012 i `tools/`: `npm run test:tools` (pokrycie linii i gałęzi ≥ 90%).
- Lint: `pnpm run lint` (`pnpm run lint:fix` — świadoma poprawka), format: `pnpm run format:check` / `pnpm run format`, granice modułów: `pnpm run deps:check`.
- Typy: `pnpm run typecheck`.
- Pokrycie: progi w `docs/process/testing-strategy.md` (wymusza preset `@evia/config` w `test:coverage`); pokrycie zmienionego kodu ≥ 90%: `pnpm run coverage:diff` (po `test:coverage` i części kontenerowej; raporty z `**/coverage/lcov.info` i `coverage/backend-tests/`).
- E2E: `pnpm run e2e` — Playwright od EVM-008, Maestro (emulator Androida na Windows) od EVM-009.
- Skany: **`pnpm run scan`** — gitleaks, Semgrep CE, OSV-Scanner, Trivy (po `backend-install`), zizmor, actionlint, `renovate-config-validator`; raporty w `.scratch/scans/`. Docker wyłącznie przez `docker compose -f compose.yaml run --rm <usługa>` (nigdy `docker run`).
- CI i scalanie: `.github/workflows/ci.yml` (check `ci-gate`); scalenie do `main` klika Konrad w PR (D2) — `docs/ops/github-i-ci.md`. Walidator dokumentacji działa na każdym pushu jako pierwszy krok joba `quality` (bramka 11): błędy (kod `1`) i błąd narzędzia (kod `2`) dają czerwony `ci-gate`, a pozostałe kroki `quality` się nie wykonują; ostrzeżenia nie blokują. Wynik w podsumowaniu przebiegu, pełna lista w logu kroku; lokalnie `npm run docs:check`.
- Dokumentacja: `npm run docs:check` (walidator cyklu życia dokumentów — 0 błędów), `npm run docs:cleanup -- M#` — raport sprzątania dla kamienia milowego (tylko odczyt, krok `/milestone close`). Opcje walidatora (`--list`, `--today`): `node tools/docs-lifecycle/cli.mjs check --list` (PowerShell 5.1 usuwa gołe `--` w `npm run`).

## Mapa dokumentacji
`docs/README.md`
