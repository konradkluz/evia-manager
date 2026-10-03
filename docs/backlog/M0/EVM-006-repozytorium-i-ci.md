---
id: EVM-006
title: Repozytorium, monorepo i CI z bramkami jakości
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: devops-engineer
contributors: []
reviewers: [code-reviewer, security-engineer]
depends_on: [EVM-001]
---

# EVM-006: Repozytorium, monorepo i CI z bramkami jakości

## Historyjka
Jako **zespół** chcemy **repozytorium z automatycznymi bramkami jakości od pierwszego dnia**, aby **żadna zmiana nie obniżyła jakości, pokrycia testami ani bezpieczeństwa**.

## Kontekst
Stack i narzędzia: ADR-y z EVM-001. Progi: `docs/process/testing-strategy.md`. Lista skanów: EVM-005 (jeśli gotowa; inaczej standardowy zestaw, uzupełniany później).

## Kryteria akceptacji
**AC1 — Repozytorium**
- Gdy klonuję repozytorium i wykonuję instrukcję z README
- Wtedy uruchamiam środowisko od zera; struktura monorepo jest zgodna z ADR. Repozytorium zdalne (np. prywatne na GitHub) tworzone wyłącznie za zgodą Konrada.

**AC2 — Bramka lokalna**
- Gdy uruchamiam jedno polecenie bramki
- Wtedy wykonuje się lint, formatowanie, sprawdzanie typów i testy z pomiarem pokrycia dla wszystkich aplikacji i pakietów.

**AC3 — Progi pokrycia**
- Zakładając progi z `testing-strategy.md` (w tym ≥ 90% pokrycia zmienionego kodu)
- Gdy zmiana obniża pokrycie poniżej progu
- Wtedy bramka kończy się błędem (dowód w raporcie: celowo niepokryty kod → czerwona bramka).

**AC4 — CI**
- Gdy powstaje PR lub push
- Wtedy CI wykonuje: instalację z lockfile → lint → typy → testy i pokrycie → build → skany (SAST, zależności, sekrety); czerwony etap blokuje merge do `main` (konfiguracja lub instrukcja ochrony gałęzi).

**AC5 — Sekrety**
- Wtedy istnieje `.env.example`, skan sekretów działa w pre-commit i CI, `.gitignore` jest rozszerzony pod stack.

**AC6 — Design tokens**
- Wtedy tokeny z `design/tokens/` są automatycznie przetwarzane do formatów web i mobile (przy braku EVM-003 — na przykładowym tokenie).

**AC7 — Instrukcje dla agentów**
- Wtedy sekcja „Stack i komendy” w `CLAUDE.md` zawiera polecenia: instalacja, uruchomienie, testy, lint, typy, pokrycie, E2E; `testing-strategy.md` → „Narzędzia” jest uzupełnione.

**AC8 — Aktualizacje zależności**
- Wtedy skonfigurowany jest bot aktualizacji zależności z grupowaniem zmian.

## Poza zakresem
Środowiska chmurowe i wdrożenia (EVM-007), kod aplikacji (EVM-008, EVM-009).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Akcje CI przypięte do wersji/SHA, minimalne uprawnienia tokenów CI, brak sekretów w logach.

## Notatki techniczne
Środowisko Konrada: Windows 11. Testy per warstwa (ADR-0015): backend w kontenerach Linux (`backend-tests` + usługi z ADR-0011), web/mobile/narzędzia natywnie na Windows; CI Linux dla wszystkich warstw.

Środowisko lokalne (Konrad, 2026-10-03, demo EVM-012): Konrad będzie pracował lokalnie na **Dockerze** i tam uruchamiał środowisko — instrukcja uruchomienia (AC1) i bramka lokalna (AC2) muszą działać w kontenerach (Docker Desktop na Windows 11); natywne uruchomienie na Windows — opcjonalnie. Doprecyzowane w ADR-0015: w kontenerach — backend.

Z ADR-0015 (zaakceptowany 2026-10-03, bez zmiany AC):
- „Po EVM-006”: `compose.yaml` z `backend-tests` (utwardzenia, digest, `-f`), lista dozwolonych montaży, osobne `node_modules` host/kontener i kryterium edytora, pnpm 11 `allowBuilds`/`minimumReleaseAge`, sieć `internal`, porty `127.0.0.1`, `.gitattributes`, joby CI w obrazie `backend-tests`, E2E Android w CI warunkowo, pomiar czasu.
- Sekrety usług zewnętrznych (prawdziwe klucze, tokeny, certyfikaty) **nigdy w katalogu repozytorium** — także nie w plikach ignorowanych przez git; w repo wyłącznie `.env.example` z wartościami przykładowymi (dotyczy AC5 i instrukcji z AC1).

Przejęcie z EVM-012 (dopisane 2026-10-03 po przeglądzie `solution-architect`, bez zmiany AC):
- Główny `package.json` z EVM-012 (minimalny: `private: true`, bez zależności) ma trzy skrypty — `docs:check`, `docs:cleanup`, `test:tools` — do przejęcia bez zmian (wywołanie także przez `pnpm run …`). `tools/docs-lifecycle/` jest samowystarczalny (tylko moduły `node:*` i importy względne) i wchodzi do monorepo jako workspace `tools/*`.
- Testy EVM-012 (`tools/docs-lifecycle/test/project-docs.test.mjs`) sprawdzają w głównym `package.json` wyłącznie trwałe niezmienniki: `private: true`, te trzy skrypty, brak `package-lock.json` i `yarn.lock`. Zmiana `engines` na Node 26 (ADR-0002) oraz `packageManager`, `devDependencies`, `pnpm-lock.yaml` i `.npmrc` (ADR-0012) nie wymagają zmian w tych testach.
- Pozostały dług narzędzia (Vitest zamiast `node:test`, `checkJs` albo `.ts`, testy na Linuksie w CI, eksperymentalny pomiar pokrycia): EVM-013 → „Notatki techniczne”.

## Plan techniczny
_devops-engineer, 2026-10-03. Do przeglądu `solution-architect` (struktura monorepo, kontener, odstępstwo od ADR-0012 — plan GitHub Free) i `security-engineer` (bramki, kontrole kompensujące, ponowna ocena RR-02 / RR-11) przed implementacją. Wersje wg ADR-0006/0012/0014/0015 (zweryfikowane 2026-10-02/03); implementacja bierze najnowsze wydania starsze niż 3 dni i zapisuje je w lockfile / digestach. Decyzje potrzebne przed implementacją: p. 0._

### 0. Do decyzji Konrada przed implementacją
| # | Pytanie | Rekomendacja | Konsekwencja innego wyboru |
|---|---|---|---|
| D1 | Node na hoście Windows: 22.15 (stan obecny) czy 26 jak w kontenerze i CI? ADR-0015: „jedna wersja główna w `engines`, `.nvmrc`, obrazie i `setup-node`”; pnpm zawsze odmawia instalacji, gdy `engines` projektu nie pasuje; edytor (WebStorm) i hooki git wymagają instalacji zależności na hoście. | **Node 26 na hoście** (instalator z nodejs.org zastępuje 22.15; `docs:check` i `test:tools` działają dalej) + `npm install -g pnpm@12.8.1` (pnpm sam przełącza się na wersję z `packageManager`; Node 26 nie zawiera już corepacka). Przed startem implementacji. | (b) host zostaje na 22: `engines` `>=22.15 <27`, kontener i CI na 26 — odstępstwo od ADR-0015 (notka architekta), ryzyko różnic host/CI, Node 22 EOL 2027-04-30; (c) Node zarządzany przez pnpm (`devEngines.runtime`) bez instalacji systemowej — otwarte błędy na Windows (pnpm #14817), nie rekomenduję. |
| D2 | Sposób scalania do `main` na Free | **Konrad scala PR przyciskiem „Squash and merge” na GitHubie** po akceptacji demo (widzi wtedy status `ci-gate`); orkiestrator lokalnie tylko `git fetch` + `git merge --ff-only origin/main`. Commit na `main` jest wtedy powiązany z PR, co umożliwia automatyczną kontrolę wykrywającą K6 (p. 9). | Obecny tryb (squash lokalnie przez orkiestratora, push `main` przez Konrada) działa, ale PR zostaje otwarty (zamykany ręcznie), a K6 sprawdzi tylko format komunikatu commita. |
| D3 | zizmor (MIT; statyczna analiza workflowów — „Propozycje” w `requirements.md`) w EVM-006 | **Tak** — krok w jobie `security` i w `pnpm run scan`, obraz po digeście, 0 zł, ok. 1 h. Na Free sekrety repo są dostępne dla workflowu z każdej gałęzi, więc wstrzyknięcia i nadmiarowe uprawnienia w workflowach to główne ryzyko CI. | Tylko Semgrep `p/github-actions` + testy `tools/repo-policy` (p. 8) — słabsze wykrywanie (np. cache poisoning, artefakty, wyzwalacze). |
| D4 | Uprawnienia na czas implementacji | (a) zgoda na zapis `compose.yaml` przez wykonawcę (reguła `ask` — Konrad potwierdza monit; inaczej plik zapisuje orkiestrator w sesji interaktywnej); (b) zgoda na zmiany `.claude/settings.json` z p. 12 (wprowadza orkiestrator). | Bez (a) implementacja zatrzyma się na kroku 5 (p. 14); bez (b) agenci dostają monity przy poleceniach kontenera, a uzupełnione reguły `deny` nie działają. |
| D5 | Token Renovate (Konrad dopuścił PAT albo GitHub App) | **Fine-grained PAT** tylko do tego repo: Contents RW, Pull requests RW, Workflows RW, Issues RW, Dependabot alerts R, Metadata R; ważność 90 dni; sekret repo `RENOVATE_TOKEN`; zakłada Konrad po scaleniu wg `docs/ops/`. Nie blokuje implementacji (workflow Renovate bez sekretu kończy się komunikatem). | GitHub App: tokeny 1 h i osobna tożsamość bota, +15 min konfiguracji; na Free klucz aplikacji jest tak samo sekretem repo czytelnym dla workflowu z każdej gałęzi. |

### 1. Struktura monorepo (AC1)
Potwierdzam strukturę z ADR-0012 z dwiema zmianami: `compose.yaml` w katalogu głównym (ADR-0015, nie w `infra/`), Dockerfile środowiska dev w `infra/docker/`. Tworzę tylko katalogi, które mają treść teraz (YAGNI); globy workspace'ów obejmą kolejne automatycznie.

| Ścieżka | Co | Kiedy |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.nvmrc`, `.gitattributes`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `.dependency-cruiser.cjs`, `lefthook.yml`, `compose.yaml`, `.env.example`, `renovate.json`, `.gitleaks.toml`, `.gitleaksignore`, `osv-scanner.toml`, `trivy.yaml`, `.trivyignore.yaml` | konfiguracja monorepo, jakości i skanów | EVM-006 |
| `.github/workflows/{ci,nightly,renovate}.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md` | CI, harmonogramy, Renovate, szablon PR | EVM-006 |
| `.semgrep/` | reguły własne Semgrep z testami reguł | EVM-006 |
| `infra/docker/backend-tests/Dockerfile` | obraz `backend-tests` (kontekst budowania = ten katalog, bez plików repo) | EVM-006 |
| `packages/config` (`@evia/config`) | tsconfig bazowy (`strict`), ESLint flat config, preset Vitest z progami | EVM-006 |
| `packages/tokens` (`@evia/tokens`) | transformacja tokenów (AC6) | EVM-006 |
| `tools/docs-lifecycle` | workspace (tylko `package.json` i skrypty; logika bez zmian) | EVM-006 |
| `tools/diff-coverage`, `tools/repo-policy`, `tools/container` | pokrycie zmienionego kodu, testy niezmienników repo, synchronizacja źródeł w kontenerze — `.mjs` + `node:test`, tylko moduły `node:*` (jak `docs-lifecycle`; migracja do Vitest razem z nim w EVM-013) | EVM-006 |
| `docs/ops/` | runbooki: GitHub i CI, rotacja sekretów | EVM-006 |
| `apps/api`, `apps/web` · `apps/mobile` · `infra/` (OpenTofu) · `services/media-processor`, `packages/{contracts,sync-core,ui-web}` | — | EVM-008 · EVM-009 · EVM-007 · przy pierwszej potrzebie |

### 2. Wersje i łańcuch dostaw (SR-SUPPLY-01, -04, -06)
- **Node 26:** `.nvmrc` `26`; `engines.node` `>=26.0.0 <27`; obraz `node:26-trixie-slim` (tag + digest; trixie = bieżący Debian stable, slim = mniejsza powierzchnia; bookworm tylko przy niezgodności); CI `setup-node` z `.nvmrc`. Spójność sprawdza test w `tools/repo-policy`. Gdy kluczowa zależność nie wspiera 26 → Node 24 wg ADR-0002 (w EVM-006 wszystkie zależności wspierają ≥ 22).
- **pnpm 12.8.x:** `packageManager` z sumą `+sha512…`; obraz instaluje tę samą dokładną wersję (`npm install -g pnpm@<x> --ignore-scripts`); CI `pnpm/action-setup` czyta `packageManager`.
- **`pnpm-workspace.yaml`:** pakiety `apps/*`, `services/*`, `packages/*`, `tools/*`; `allowBuilds` — jawna, minimalna lista (każda pozycja z uzasadnieniem w „Dzienniku”); `strictDepBuilds: true`; `minimumReleaseAge` 1440 min (domyślne, nie obniżamy; Renovate — 3 dni); `blockExoticSubdeps: true`; `engineStrict: true`; `savePrefix: ''` (dokładne wersje); `catalog` dla wersji wspólnych (TypeScript, Vitest, ESLint). Nazwy ustawień potwierdzam w dokumentacji pnpm 12 (ADR-0015 opisuje pnpm 11).
- **Turborepo 2.11:** telemetria wyłączona (`TURBO_TELEMETRY_DISABLED=1` w CI i Compose; na hoście jednorazowo `pnpm exec turbo telemetry disable` — w README); bez zdalnego cache (wymagałby konta Vercel); cache lokalny i `actions/cache` w CI.
- **Nowe zależności — wyłącznie `devDependencies`, wszystkie wskazane w ADR:**

| Pakiet | Licencja | Po co | ADR |
|---|---|---|---|
| `turbo` | MIT | zadania i cache monorepo | 0012 |
| `typescript` 6.0 | Apache-2.0 | typy (`strict`) | 0012 |
| `eslint` 10, `@eslint/js`, `typescript-eslint` 8.71, `globals` | MIT | lint z regułami typów | 0012 |
| `prettier` 3.9 | MIT | formatowanie | 0012 |
| `vitest` 5, `@vitest/coverage-v8` | MIT | testy i pokrycie | 0014 |
| `dependency-cruiser` 18 | MIT | granice modułów | 0012 |
| `lefthook` 2.1 | MIT | hooki git | 0012 |
| `style-dictionary` 5.5 | Apache-2.0 | tokeny DTCG → web / mobile | 0006 |
| `@types/node` | MIT | typy Node w skryptach | — (standard TS) |

  Akcje GitHub (pełne SHA z komentarzem wersji): `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, `actions/download-artifact`, `pnpm/action-setup`, `renovatebot/github-action`. Obrazy (tag + digest): `node`, gitleaks, Semgrep CE, OSV-Scanner, Trivy, Renovate (+ zizmor przy D3 = tak). Licencje narzędzi CI: ADR-0012 → „Źródła”.

### 3. Bramka lokalna (AC2) i progi pokrycia (AC3)
| Polecenie (host, katalog główny) | Co robi |
|---|---|
| `pnpm install` | instalacja z lockfile (Windows) + hooki lefthook (skrypt `prepare`) |
| `docker compose -f compose.yaml run --rm backend-install` | instalacja zależności Linux w wolumenie kontenera (z siecią; po zmianie lockfile) |
| **`pnpm run gate`** | **jedno polecenie bramki:** `gate:native` → `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` → `coverage:diff`; pierwszy czerwony etap kończy bramkę kodem ≠ 0 |
| `pnpm run gate:native` | `format:check` → `turbo run lint typecheck test:coverage` (natywnie, wszystkie workspace'y poza backendem) → `deps:check` |
| `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` | lint, typy i testy z pokryciem w Linuksie: backend (`apps/api`, `services/*` od EVM-008) + pakiety współdzielone (parytet Linux; w EVM-006 — `packages/*`) |
| `pnpm run format` / `format:check`, `lint`, `typecheck`, `test`, `test:coverage`, `deps:check`, `coverage:diff`, `build`, `dev`, `e2e`, `scan` | etapy osobno; `dev` i `e2e` bez zadań do EVM-008 / EVM-009 (Turborepo kończy się sukcesem z informacją) |
| `npm run docs:check`, `npm run docs:cleanup -- M#`, `npm run test:tools` | bez zmian (niezmienniki EVM-012; działają też przez `pnpm run`) |

- **Zakres formatowania:** Prettier (konfiguracja w katalogu głównym) dla kodu i konfiguracji; poza zakresem `**/*.md` (dokumenty pilnuje `docs:check`; Prettier przeformatowałby tabele), `design/**`, `.claude/**`, `CHANGELOG.md`, lockfile. `tools/docs-lifecycle` — jednorazowe formatowanie mechaniczne (osobny commit `style:`); reguły ESLint niemożliwe do spełnienia bez zmiany logiki → wyłączenie dla tego workspace'u z komentarzem i wpis do długu EVM-013.
- **ESLint:** `strictTypeChecked` dla TS, `no-explicit-any` = błąd; reguły tokenów UI i zakaz konkatenacji SQL — w EVM-008 (pierwszy UI i Kysely). **dependency-cruiser:** bez cykli, `packages/*` nie importują `apps/*` ani `tools/*`, kod produkcyjny bez zależności dev, brak nierozwiązywalnych importów; granice modułów ADR-0001 — z `apps/api` (EVM-008).
- **Progi globalne** (preset `@evia/config/vitest`, linie i gałęzie; zapadka — tylko w górę): pakiety współdzielone i `tools/` ≥ 90% (**nowy wiersz w `testing-strategy.md`**, zgodny z dotychczasowym progiem `test:tools`); backend 85%, web 80%, mobile 80% (Jest, EVM-009); moduły domenowe i sync/upload 95% — progi per katalog dodają historyjki z tym kodem. Wykluczenia (kod generowany, konfiguracja, testy) jawnie w presecie.
- **Pokrycie zmienionego kodu ≥ 90% (`tools/diff-coverage`)** — własny skrypt zamiast `diff-cover` (Python = drugi runtime na hoście i w CI; ADR-0014 zostawia wybór EVM-006):
  - baza = `git merge-base HEAD origin/main` (lokalnie `main`; na `main` — `HEAD^`); diff `-U0` łącznie ze zmianami nieskomitowanymi (pętla TDD);
  - zbiera wszystkie `**/coverage/lcov.info` (host, kontener, CI), normalizuje ścieżki `SF:` do względnych (Windows, `/repo/…`, runner), scala trafienia (maksimum);
  - liczy linie (`DA`) i gałęzie (`BRDA`) na zmienionych liniach; zmieniony plik źródłowy (`{apps,packages,services,tools}/**` — `.ts`, `.tsx`, `.mjs`, `.js`, poza testami i wykluczeniami presetu) **bez żadnego raportu pokrycia liczy się jako niepokryty** (brak luki „nieinstrumentowane = zielone”);
  - próg 90% dla linii i dla gałęzi; wynik: tabela per plik + lista niepokrytych linii; kod 1 poniżej progu, 0 przy braku mierzalnych zmian (z komunikatem).
- `tools/*` raportują pokrycie `node:test` w formacie lcov (`--test-reporter=lcov`) do `coverage/` swojego workspace'u; root `test:tools` bez zmian.

### 4. Kontener `backend-tests` (ADR-0015 → „Po EVM-006” p. 1–6, 9–11)
| Usługa (`compose.yaml`) | Obraz | Sieć | Zapis | Rola |
|---|---|---|---|---|
| `backend-install` | build `infra/docker/backend-tests` (`node:26-trixie-slim@sha256:…` + pnpm) | domyślna (rejestr npm) | wolumeny `bt-workspace`, `bt-pnpm-store` | `pnpm install --frozen-lockfile` w Linuksie |
| `backend-tests` | jw. | `network_mode: none` (EVM-008: sieć `internal: true` z PostgreSQL) | wolumeny jw. + `./coverage/backend-tests` | `pnpm run gate:backend` |
| `scan-gitleaks`, `scan-semgrep`, `scan-osv`, `scan-trivy`, `renovate-validate` (+ `scan-zizmor`) | obrazy dostawców, tag + digest — **te same lokalnie i w CI** (jedno miejsce digestów, aktualizowane przez Renovate) | gitleaks, `renovate-validate`: `none`; Semgrep (reguły z rejestru, `--metrics=off`), OSV (API osv.dev — tylko nazwy i wersje pakietów), Trivy (pakiet reguł): domyślna | `./.scratch/scans` | skany (p. 6, p. 8) |

- **Utwardzenia każdej usługi** (zestaw bazowy ADR-0015): `init`, użytkownik nie-root, `read_only`, tmpfs `noexec` (`/tmp`, katalog domowy z `uid/gid/mode`), `cap_drop: [ALL]`, `no-new-privileges`, bez portów, bez gniazda Dockera, bez `env_file` i bez interpolacji `${…}`; konfiguracja wyłącznie przez `environment:` z wartościami syntetycznymi (np. `TURBO_TELEMETRY_DISABLED`, `GIT_CONFIG_*`).
- **Montaże — lista dozwolonych, `:ro`, pod `/src`:** manifesty i lockfile (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, konfiguracje z katalogu głównego potrzebne do lint/typów), `packages/`, `tools/container/`, `design/tokens/`; od EVM-008 — `apps/api`, `services/`. Bez katalogu głównego, `.git`, `.env*`, `.claude`, `.idea`. Gitleaks dostaje wyłącznie `.git:ro`.
- **Synchronizacja (`tools/container/sync.mjs`, punkt wejścia obrazu):** kopiuje `/src` → `/repo` (wolumen) z pominięciem `node_modules`, `.turbo`, `dist`, `coverage`, usuwa pliki nieaktualne, uruchamia `pnpm install --offline --frozen-lockfile` (bez zmian = sekundy; brak pakietów w magazynie → komunikat „uruchom backend-install”), potem polecenie; na końcu kopiuje `**/coverage/lcov.info` do `/out`. Uzasadnienie: zapisywalne wolumeny nie są zagnieżdżone w montażu `:ro` (ADR-0015 M3), `node_modules` Linux są oddzielone od Windows, działa z czystego klonu niezależnie od instalacji na hoście. Plan B (gdy czas > 2× CI): nazwane wolumeny `node_modules` per workspace.
- Gniazdo Dockera nigdy (RR-03); Testcontainers tylko w CI (EVM-008). **Pomiar:** czas `gate:backend` lokalnie vs CI w raporcie (próg uwagi > 2×).

### 5. Design tokens (AC6) — `packages/tokens`
- Wejście: `design/tokens/**/*.tokens.json` (źródło prawdy zostaje w `design/`); Style Dictionary 5.5 w trybie DTCG (kolory DTCG 2025.10 obsługiwane od 5.3; wymiary `{value, unit}` i typografia złożona — własne transformacje zarejestrowane w konfiguracji pakietu, bez nowych zależności).
- Wyjście w `dist/` (ignorowane przez git, budowane zadaniem `build`; konsumenci przez `dependsOn: ["^build"]`):
  - **web:** `dist/web/tokens.css` — `:root` ze zmiennymi `--evm-…` wyłącznie dla tokenów semantycznych; typografia i odstępy w `rem` (px/16), obramowania i promienie w `px`; `line-height` bez jednostki; typografia złożona → zmienne per właściwość; `fontFeatures: ["tnum"]` → `font-variant-numeric: tabular-nums`. Motyw Tailwind (`@theme`) — w EVM-008 (`web-developer`; mapowanie nazw zależy od panelu).
  - **mobile:** `dist/mobile/tokens.ts` (+ typy) — stałe TS: wymiary jako liczby dp/pt 1:1, kolory `hex` / `rgba` (z `alpha`), typografia jako obiekty dla React Native, `cubicBezier` jako tablica, cienie jako przybliżenie (`elevation` + `shadow*`).
  - Tokeny bazowe (`palette.*`, `dimension.*` …) oraz tokeny i grupy z `$deprecated` nie są eksportowane.
- **Walidacja** (README tokenów → „Walidacja w CI”): poprawny JSON, każdy token ma `$type` (z dziedziczeniem), aliasy rozwiązywalne, brak cykli, brak literałów w `semantic/`, zgodność typu aliasu, `$deprecated` tylko `true` / `false` / tekst — błąd przerywa build.
- Testy Vitest `EVM-006 AC6` na prawdziwych tokenach i na fiksturach budowanych w czasie testu (zepsuty alias, cykl, literał w `semantic/`, wycofany token); determinizm (dwa buildy = identyczne pliki).

### 6. Sekrety i hooki (AC5; SR-INFRA-05, bramka 1)
- `.env.example`: nagłówek z zasadami (wyłącznie wartości przykładowe; sekrety usług zewnętrznych nigdy w katalogu repo — `%USERPROFILE%\.evia\` albo menedżer sekretów, ADR-0015); dziś bez zmiennych aplikacji — kolejne historyjki dopisują je z opisem (`conventions.md` → „Kod”).
- `.gitignore` pod stack: `node_modules/`, `dist/`, `build/`, `.turbo/`, `*.tsbuildinfo`, `.eslintcache`, `.pnpm-store/`, `*.log`, `.expo/` (pozostałe wpisy zostają); usuwam komentarz „Uzupełnia devops-engineer…”.
- `lefthook.yml`: **pre-commit** — Prettier i ESLint dla plików w indeksie (natywnie) + gitleaks na indeksie (`docker compose -f compose.yaml run --rm scan-gitleaks …`); **pre-push** — gitleaks na zakresie wypychanych commitów. Docker niedostępny → hook kończy się błędem (fail-closed). Plan B: natywna binarka gitleaks w przypiętej wersji z sumą kontrolną (ADR-0015 dopuszcza oba).
- CI: gitleaks w każdym przebiegu (gałąź — zakres względem `origin/main`; `main` i nocą — pełna historia; pierwszy przebieg — pełna historia jako dowód), wyniki z `--redact`. Wyjątki wyłącznie jako fingerprint w `.gitleaksignore` z komentarzem (powód, właściciel, `review_by`).

### 7. CI — GitHub Actions (AC4; SR-SUPPLY-04)
- **Wyzwalacze `ci.yml`:** `push` na każdą gałąź + `workflow_dispatch`. Bez osobnego `pull_request` — checki przebiegu `push` są widoczne w PR dla tego samego SHA, a podwójny przebieg zużywałby limit minut Free. Wszystkie workflowy: `permissions: contents: read` na poziomie pliku (więcej tylko per job, jawnie), `concurrency` z anulowaniem poprzednich przebiegów gałęzi (poza `main`), `timeout-minutes` na każdym jobie, `actions/checkout` z `persist-credentials: false`, akcje przypięte pełnym SHA, joby skanów bez sekretów, brak `pull_request_target`.

| Job (`ci.yml`) | Kroki (kolejność = etapy z AC4) |
|---|---|
| `quality` | checkout → Node z `.nvmrc` + pnpm → `pnpm install --frozen-lockfile` → `format:check` → `turbo run lint` → `turbo run typecheck` → `deps:check` → `turbo run test:coverage` (zbiór „natywny”, w tym `tools/*`) → `turbo run build` → licencje (Trivy, p. 8) → artefakt lcov (retencja 7 dni) |
| `backend` | te same polecenia co lokalnie: `docker compose -f compose.yaml run --rm backend-install`, potem `… run --rm backend-tests pnpm run gate:backend` (parytet z obrazem lokalnym; ADR-0015 p. 10) → artefakt lcov |
| `security` | gitleaks → Semgrep CE (gałąź: `--baseline-commit` = merge-base; `main`: pełny) → OSV-Scanner (`pnpm-lock.yaml`) → Trivy `config` (Dockerfile) → (zizmor przy D3) → `renovate-config-validator` przy zmianie `renovate.json` → **samotest skanerów**: w `$RUNNER_TEMP` syntetyczny sekret, lockfile ze znaną podatnością High i Dockerfile z `FROM …:latest` — każdy skaner **musi** zgłosić błąd (wykrywa ciche wyłączenie bramki, np. po zmianie flag w nowej wersji narzędzia z PR Renovate) + `semgrep --test` reguł własnych |
| `coverage` | `needs: [quality, backend]`; pobiera oba artefakty lcov → `node tools/diff-coverage/cli.mjs` (bez instalacji zależności) |
| `ci-gate` | `needs` wszystkich powyższych, `if: always()` — zielony tylko, gdy wszystkie zielone; **jeden check, który Konrad sprawdza przed scaleniem** (i wymagany check, gdyby kiedyś był plan z rulesetami) |
| `main-integrity` (tylko `main`) | kontrola K6 z p. 9 (`pull-requests: read`, `checks: read`) |

- **`nightly.yml`** (codziennie ok. 02:30 UTC + `workflow_dispatch`; działa tylko z `main`): pełny Semgrep, gitleaks — pełna historia, OSV (próg jak w PR) + `pnpm audit --audit-level=high` jako raport. Błąd = e-mail do Konrada (powiadomienia GitHub o nieudanych workflowach).
- **`renovate.yml`:** p. 10.
- **Minuty (Free: 2000 min/mies. dla repo prywatnych):** przebieg ok. 12 min (quality ok. 5, backend ok. 3, security ok. 3, pozostałe < 1); ok. 100 pushy + nocne + Renovate → ok. 1300–1600 min/mies. Mitygacje: anulowanie przebiegów, cache pnpm i Turborepo, Renovate raz w tygodniu z grupowaniem. Limit wydatków Actions = 0 USD (po wyczerpaniu puli joby stają, bez opłat) — sprawdza Konrad.

### 8. Bramki bezpieczeństwa przypisane do EVM-006 (`requirements.md` → „Bramki bezpieczeństwa CI”)
| # | Realizacja w EVM-006 |
|---|---|
| 1 Sekrety | gitleaks: pre-commit, pre-push, CI, nocą pełna historia; `.gitleaks.toml` (reguły domyślne), `.gitleaksignore` |
| 2 SAST | Semgrep CE bez logowania, `--metrics=off`: `p/typescript`, `p/javascript`, `p/nodejs`, `p/react`, `p/github-actions`, `p/dockerfile` + reguły własne `.semgrep/` z testami (start: `child_process.exec*` z interpolacją, `eval` / `new Function`); blokuje ERROR i reguły własne |
| 3 SCA | OSV-Scanner blokuje Critical/High z poprawką i każdy `MAL-…`; `osv-scanner.toml` z `ignoreUntil`; `pnpm audit` nocą (raport). Kontrola terminów naprawy Medium/Low (SR-SUPPLY-02) — propozycja: EVM-007 (decyzja `security-engineer`) |
| 4 Licencje | Trivy `--scanners license` z listą dozwolonych w `trivy.yaml`. **Zmiana w `requirements.md`** (uwaga 1 z EVM-005): + OFL-1.1; „dystrybuowane” = paczka panelu i aplikacja mobilna (obrazy serwerowe nie są redystrybuowane); zakres `--pkg-types library`. Implementacja potwierdza, że Trivy czyta licencje z układu `node_modules` pnpm; plan B: `pnpm licenses list --prod --json` + porównanie z listą dozwolonych w `tools/repo-policy` (decyzja `security-engineer`) |
| 5 IaC / konfiguracja | Trivy `config` (Dockerfile); reguły własne dla `compose.yaml` i workflowów (digest każdego obrazu, porty tylko `127.0.0.1`, brak `privileged` i gniazda Dockera, utwardzenia z p. 4, `permissions`, SHA akcji, brak `pull_request_target`) jako testy w `tools/repo-policy` — bez nowego narzędzia; reguły Rego dla OpenTofu w EVM-007 (do potwierdzenia przez `security-engineer`) |
| 9 (część) | dependency-cruiser w bramce; Redocly i macierz ról — EVM-008 |
| 12 Aktualizacje | Renovate (p. 10) |
| Wyjątki | OSV `ignoreUntil` i Trivy `expired_at` wygasają natywnie; test w `tools/repo-policy` sprawdza horyzont (≤ 30 dni Critical/High, ≤ 90 dni pozostałe) i pole powodu, a dla `nosemgrep` i `.gitleaksignore` — format „powód, właściciel, `review_by: YYYY-MM-DD`” i datę ≥ dzisiaj (wygasły wyjątek = czerwona bramka). Rejestr wyjątków = adnotacje w plikach + lista z testu — zmiana opisu w `requirements.md` do akceptacji `security-engineer` |
| SR-SUPPLY-10 | `pnpm run scan` — gitleaks, Semgrep, OSV, Trivy (`config`, `license`) przez `docker compose -f compose.yaml run --rm scan-…`; wyniki w `.scratch/scans/` |
| Poza EVM-006 | 6 obrazy (EVM-007), 7–8 DAST (EVM-007, E8), 10 wdrożenia (EVM-007), 11 dokumentacja (EVM-013) |

### 9. GitHub Free — ochrona `main` bez rulesetów (AC4) i kontrole kompensujące
**Sprawdzone 2026-10-03 w dokumentacji GitHub:** w repo prywatnym na Free nie ma gałęzi chronionych ani rulesetów (Pro / Team / Enterprise).

**Wejście dla EVM-007 (GitHub Environments na Free):** w repo prywatnym na Free środowiska nie dają ochrony — sekrety i zmienne środowisk oraz deployment branches wymagają Pro / Team; wymagani recenzenci i wait timer w repo prywatnym — tylko Enterprise. Skutek: **każdy sekret jest sekretem repozytorium, dostępnym dla workflowu uruchomionego z dowolnej gałęzi** (także wypchniętej kluczem agentów). Założenia SR-INFRA-13, SR-INFRA-14 i RR-20 („poświadczenia tylko w środowiskach ograniczonych do `main`”) są na Free niewykonalne — EVM-007 musi przyjąć wzorzec bez sekretów wdrożeniowych w CI (np. pull z SR-INFRA-14 (a), klucze wyłącznie na VM) albo decyzję Konrada o planie. Źródła: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments , https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

„Czerwony etap blokuje merge” — realizacja procedurą i kontrolami (do oceny `security-engineer`: ponowna ocena RR-02 / RR-11 i nowe ryzyko rezydualne do akceptacji Konrada):

| # | Kontrola | Typ |
|---|---|---|
| K1 | CI na każdym pushu każdej gałęzi; jeden check `ci-gate`; e-mail o nieudanym przebiegu | wykrywająca |
| K2 | Procedura scalania (`docs/ops/github-i-ci.md`): scalenie tylko przy zielonym `ci-gate` dla SHA HEAD gałęzi i zielonej bramce lokalnej; wg D2 — „Squash and merge” wykonuje Konrad | proceduralna |
| K3 | Szablon PR z checklistą: ID historyjki, wynik bramki lokalnej, zmiany w plikach wrażliwych (`.github/**`, `.claude/**`, `compose*.yaml`, `lefthook.yml`, pliki wyjątków skanów) wymagają jawnej uwagi Konrada; `CODEOWNERS` jako dokumentacja (na Free nieegzekwowany) | proceduralna |
| K4 | Agenci: klucz wdrożeniowy tylko do tego repo (bez API — nie scali PR, nie wyzwoli workflowu ręcznie, nie zmieni ustawień); brak `gh` i tokenów GitHub na stacji (Konrad sprawdza, że Git Credential Manager nie przechowuje poświadczeń github.com); uzupełnione `deny` (p. 12) | zapobiegawcza, częściowa — klucz z zapisem może wypchnąć każdą gałąź, także `main` |
| K5 | Ustawienia repo (Konrad wg `docs/ops/`): Actions — tylko wybrane akcje i „Require actions to be pinned to a full-length commit SHA” (jeśli dostępne na Free); domyślne uprawnienia `GITHUB_TOKEN` tylko do odczytu; wyłączone „Allow GitHub Actions to create and approve pull requests”; wyłącznie squash merge; automatyczne usuwanie gałęzi; alerty Dependabot (bezpłatne, źródło dla Renovate); e-mail o nieudanych workflowach | zapobiegawcza |
| K6 | `main-integrity` po każdym pushu na `main`: commit musi należeć do scalonego PR, którego HEAD miał zielony `ci-gate` (API GitHub, `GITHUB_TOKEN` tylko do odczytu); inaczej czerwony check + e-mail → runbook „revert” | wykrywająca (pełna przy D2 = rekomendacja) |
| K7 | Minimum sekretów repo: w EVM-006 tylko `RENOVATE_TOKEN` (bez `actions` i `administration`, 90 dni) | ograniczająca |

### 10. Renovate (AC8; bramka 12)
- `renovate.json`: `config:recommended`, `:dependencyDashboard`, `helpers:pinGitHubActionDigests`, `docker:pinDigests`, `rangeStrategy: pin`, `minimumReleaseAge: "3 days"` z `internalChecksFilter: strict`, `timezone: Europe/Warsaw`, harmonogram raz w tygodniu (poniedziałek rano), limity `prConcurrentLimit` / `prHourlyLimit`, bez automerge, etykieta `dependencies`, `semanticCommits` (`chore(deps): … [renovate]` — wyjątek od ID historyjki dopisany w `conventions.md`); `vulnerabilityAlerts` bez karencji, z etykietą `security` (przegląd PR obowiązkowy).
- Grupy: akcje GitHub; obrazy (digesty); lint i formatowanie (ESLint, typescript-eslint, Prettier); TypeScript; narzędzia testowe (Vitest i pochodne); monorepo (turbo, pnpm — `packageManager` i wersja w Dockerfile przez regex manager); Style Dictionary; obrazy skanerów. Grupy NestJS i Expo SDK + React Native dodają EVM-008 / EVM-009.
- `renovate.yml`: harmonogram + `workflow_dispatch`, wyłącznie `main`, obraz Renovate po digeście, token `RENOVATE_TOKEN`; bez sekretu — przebieg kończy się komunikatem. PR-y Renovate wypychane tokenem PAT uruchamiają `ci.yml` (push).
- Przed scaleniem: `renovate-config-validator --strict` (usługa `renovate-validate`, lokalnie i w CI). Po scaleniu i dodaniu sekretu pierwszy przebieg tworzy Dependency Dashboard (sprawdza Konrad).

### 11. Dokumentacja
| Plik | Zmiana | AC |
|---|---|---|
| `README.md` | „Szybki start”: wymagania (Git, Docker Desktop, Node 26, pnpm), klon, `pnpm install`, `backend-install`, `pnpm run gate`, `pnpm run build`, `pnpm run scan`; odnośnik do `docs/ops/`; usunięcie zdania „Instrukcja uruchomienia pojawi się po EVM-006” | AC1 |
| `CLAUDE.md` → „Stack i komendy” | instalacja, uruchomienie, testy, lint, typy, pokrycie, E2E, skany, bramka; polecenia backendu w formie `docker compose -f compose.yaml run --rm backend-tests …`; wiersze `docs:check` / `test:tools` zostają (testy EVM-012 sprawdzają ich treść) | AC7 |
| `docs/process/testing-strategy.md` | „Narzędzia” (warstwa → narzędzie → polecenie → historyjka wprowadzająca); nowy wiersz progu „Pakiety współdzielone i `tools/` ≥ 90%”; zdanie wstępu po EVM-006 | AC3, AC7 |
| `docs/process/conventions.md` → „Git” | `main` na Free: procedura zamiast rulesetu (K2, link do runbooka); konwencja commitów Renovate | AC4, AC8 |
| `docs/ops/README.md`, `docs/ops/github-i-ci.md`, `docs/ops/rotacja-sekretow.md` (nowe, żywe) | ustawienia repo (K5), scalanie, czerwony `main` → revert, minuty Actions; token Renovate (utworzenie, rotacja co 90 dni, unieważnienie przy incydencie), klucz wdrożeniowy agentów, wykryty sekret → rotacja | AC4, AC5, AC8 |
| `docs/README.md` | wiersz „Operacje → `ops/`” (inaczej runbooki są osierocone) | — |
| `docs/security/requirements.md` | bramka 4 (OFL-1.1, „dystrybuowane”, `--pkg-types library`); SR-SUPPLY-05 i tabela bramek — skutki planu Free i kontrole K1–K7; opis wyjątków (p. 8) — wg ustaleń `security-engineer` | AC4 |
| `docs/security/threat-model.md` | ponowna ocena RR-02 / RR-11 i nowe ryzyko rezydualne „Free: brak egzekwowanej ochrony `main` i środowisk” — treść z konsultacji `security-engineer`, decyzja Konrada na demo | AC4 |
| ADR-0012 (notka pod „Status”), `docs/architecture/README.md` (koszt GitHub 0 zł) | plan Free zamiast Pro, potwierdzona struktura monorepo — forma i treść wg `solution-architect` | AC1, AC4 |
| `CHANGELOG.md` | „Unreleased → Dodano” [EVM-006] | — |

### 12. Zmiany w `.claude/settings.json` (osobna zgoda Konrada — D4 (b); wprowadza orkiestrator)
- `allow` (dokładne formy): `Bash(docker compose -f compose.yaml run --rm backend-install)`, `Bash(docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend)`, `Bash(docker compose -f compose.yaml run --rm backend-tests pnpm run test:backend:*)` (skrypty od EVM-008), `Bash(pnpm run gate)`, `Bash(pnpm run scan)`.
- `deny` (uzupełnienie): pomijanie hooków — `Bash(git commit --no-verify:*)`, `Bash(git commit -n:*)`, `Bash(git push --no-verify:*)`; inne formy pushu na `main` — `Bash(git push origin HEAD:refs/heads/main:*)`, `Bash(git push -u origin main:*)`, `Bash(git push origin +*)`; odczyt kluczy SSH — `Read(~/.ssh/**)`. Składnię wzorców potwierdza orkiestrator; to utrudnienie, nie granica (K4).

### 13. Plan testów: AC → testy i dowody
| AC | Testy automatyczne (`EVM-006 AC#`) | Dowód ręczny / QA |
|---|---|---|
| AC1 | `tools/repo-policy`: wymagane pliki i workspace'y istnieją; każde polecenie z „Szybkiego startu” README istnieje w `package.json` / `compose.yaml`; spójność Node (`.nvmrc`, `engines`, obraz) i pnpm (`packageManager`, Dockerfile) | QA: lokalny klon (`git clone <ścieżka repo> <katalog tymczasowy poza repo>`, gałąź EVM-006) i instrukcja z README 1:1 — instalacja, `backend-install`, `pnpm run gate`, `pnpm run build`; czasy. Konrad na demo: WebStorm rozwiązuje typy i uruchamia lint (kryterium ADR-0015 p. 5) |
| AC2 | `tools/repo-policy`: każdy workspace z `src/` ma `lint` i `test:coverage`, workspace'y TS — `typecheck`; `gate` zawiera wszystkie etapy w kolejności | `pnpm run gate` zielone; podsumowanie Turborepo z listą wszystkich workspace'ów; część backendowa w kontenerze |
| AC3 | `tools/diff-coverage`: < 90% → kod 1; ≥ 90% → 0; gałęzie; zmieniony plik bez raportu = niepokryty; normalizacja ścieżek Windows / Linux / kontener; scalanie lcov; brak zmian; zmiany nieskomitowane | QA lokalnie (gałąź robocza, bez pushu): celowo niepokryta funkcja w `packages/tokens` → czerwony próg globalny i czerwony diff; w CI: jeden czerwony commit na gałęzi EVM-006, potem poprawka (link do przebiegu od Konrada) |
| AC4 | `tools/repo-policy` na workflowach: wyzwalacze, kolejność etapów, `ci-gate` z `needs` wszystkich jobów, SHA akcji (40 znaków hex), `permissions: contents: read`, brak `pull_request_target`, `persist-credentials: false`, `timeout-minutes`, brak `secrets.` w `ci.yml` i `nightly.yml` | zielony `ci-gate` na gałęzi (Konrad) + czerwony przebieg z AC3; samotest skanerów zielony (skanery wykryły syntetyczne problemy); instrukcja K2 / K5 w `docs/ops/` |
| AC5 | `tools/repo-policy`: `.env.example` istnieje i nie zawiera wartości o wzorcu sekretu; `git check-ignore` dla `node_modules/`, `.turbo/`, `dist/`, `.env`, `.env.local`, `coverage/` i **nie** dla `.env.example`; lefthook ma gitleaks w pre-commit i pre-push | QA: syntetyczny sekret w indeksie (gałąź robocza, bez pushu) → commit odrzucony; pierwszy przebieg CI z pełną historią — 0 wykryć |
| AC6 | `packages/tokens` (Vitest): CSS i TS z wartościami, `rem` / `px`, brak tokenów bazowych i wycofanych, walidacja na fiksturach, determinizm | `pnpm run build` → pliki w `packages/tokens/dist/` |
| AC7 | `tools/repo-policy`: „Stack i komendy” w `CLAUDE.md` zawiera instalację, uruchomienie, testy, lint, typy, pokrycie, E2E; każde `pnpm run …` istnieje; polecenia backendu w formie `docker compose -f compose.yaml run --rm backend-tests …`; „Narzędzia” w `testing-strategy.md` uzupełnione | przegląd |
| AC8 | `tools/repo-policy`: `renovate.json` ma grupy, karencję 3 dni, przypinanie SHA i digestów, brak automerge | `renovate-config-validator --strict` zielony; po scaleniu — Dependency Dashboard |

Dodatkowo (ADR-0012 → „Weryfikacja”): podatna zależność → czerwony OSV (samotest w CI + QA lokalnie na syntetycznym lockfile w `.scratch/`); „push do `main` odrzucony” — **niewykonalne na Free**, zastępuje go K6 (do akceptacji Konrada).

### 14. Kolejność kroków (małe commity, TDD)
1. `chore`: `.gitignore`, `.gitattributes` (`* text=auto eol=lf`, wyjątki binarne), `.editorconfig`, `.nvmrc`, `package.json` (`packageManager`, `engines`, skrypty), `pnpm-workspace.yaml`, `turbo.json`, `tools/docs-lifecycle/package.json`, `pnpm-lock.yaml`; sprawdzenie: `npm run test:tools`, `npm run docs:check` bez zmian.
2. `build(config)`: `packages/config` (tsconfig, ESLint, preset Vitest z progami), Prettier w katalogu głównym, `.dependency-cruiser.cjs`; formatowanie mechaniczne `tools/` (osobny commit `style:`).
3. `test` → `feat(tools)`: `tools/diff-coverage` (TDD), skrypt `coverage:diff`.
4. `test` → `feat(tokens)`: `packages/tokens` (TDD).
5. `test` → `feat(tools)`: `tools/container/sync.mjs` (TDD); `build(docker)`: Dockerfile, `compose.yaml` (`backend-install`, `backend-tests`) — **wymaga D4 (a)**; skrypty `gate:native`, `gate:backend`, `gate`; pomiar czasu.
6. `test` → `chore(security)`: `tools/repo-policy` (najpierw testy), konfiguracje skanerów, usługi `scan-*` i `renovate-validate`, `.semgrep/` z testami reguł, `lefthook.yml`, `pnpm run scan`.
7. `ci`: `ci.yml`, `nightly.yml`, `renovate.yml`, `renovate.json`, `CODEOWNERS`, szablon PR.
8. `git push -u origin feature/EVM-006-repo-i-ci` (zgoda Konrada; bez force); Konrad: PR, ustawienia K5, status `ci-gate`; poprawki do zielonego CI.
9. `docs`: README, `CLAUDE.md`, `testing-strategy.md`, `conventions.md`, `docs/ops/`, `docs/README.md`, `requirements.md`, `threat-model.md` i notka ADR-0012 (wg konsultacji), `CHANGELOG.md`.
10. Na koniec: `pnpm run gate`, `npm run test:tools`, `npm run docs:check`, `pnpm run scan`; raport z czasami lokalnie vs CI.

### 15. Koszty
0 zł/mies.: GitHub Free (2000 min Actions; szacunek ok. 1300–1600 min/mies., p. 7), obrazy i narzędzia bez kont i licencji płatnych, brak nowych zasobów. Wobec ADR-0012 ok. 15,50 zł/mies. mniej (bez GitHub Pro). Przy limicie wydatków 0 USD przekroczenie puli zatrzymuje CI do końca miesiąca zamiast generować opłatę.

### 16. Działania Konrada
- Przed implementacją: odpowiedzi D1–D5; przy D1 = rekomendacja — instalacja Node 26 i `npm install -g pnpm@12.8.1`.
- Po pierwszym pushu gałęzi: ustawienia repo (K5, instrukcja w `docs/ops/github-i-ci.md`), otwarcie PR, przekazanie statusu `ci-gate` i linków do przebiegów (orkiestrator nie ma `gh`, repo prywatne).
- Po scaleniu: fine-grained PAT i sekret `RENOVATE_TOKEN` (D5), przypomnienie o rotacji za 90 dni; sprawdzenie limitu wydatków Actions (0 USD) i powiadomień e-mail o nieudanych workflowach.

### 17. Ryzyka
- **Brak egzekwowanej ochrony `main` i środowisk na Free** — ryzyko rezydualne do ponownej oceny (`security-engineer`) i akceptacji Konrada; wpływ na EVM-007 (p. 9).
- **Sekrety repo czytelne dla workflowu z dowolnej gałęzi** — w EVM-006 tylko `RENOVATE_TOKEN`; przyrost ryzyka wobec klucza agentów (już może wypchnąć każdą gałąź) — głównie API PR / issues w imieniu Konrada.
- **Limit 2000 min** — monitoring zużycia, cache, anulowanie przebiegów.
- **Node 26 przed LTS (2026-10-28)** i zgodność Expo SDK 57 (EVM-009) — plan B Node 24 (ADR-0002).
- **Zapis `compose.yaml` objęty regułą `ask`** — automatyczny wykonawca może zostać zatrzymany (D4).
- **Trivy a licencje w układzie pnpm**; reguły Semgrep pobierane z rejestru w chwili skanu (nieprzypięte) — weryfikacja w implementacji, plan B dla licencji (p. 8).
- **Commit wymaga działającego Dockera** (gitleaks w pre-commit) — plan B: natywna binarka z sumą kontrolną.
- **Mechaniczne formatowanie `tools/docs-lifecycle`** — duży, ale wyłącznie formatujący diff; testy EVM-012 muszą zostać zielone.
- Testy narzędzia EVM-012 w CI Linux (dług EVM-013: test czasu 200 KB) — `timeout-minutes` ogranicza zawieszenie joba.

## Decyzje
- 2026-10-03 — Konrad: repozytorium zdalne = prywatne `konradkluz/evia-manager` na GitHubie, plan **GitHub Free (bez Pro)**. Skutki do uwzględnienia w planie:
  - prywatne repo na Free nie ma ochrony gałęzi ani rulesetów — AC4 („czerwony etap blokuje merge do `main`”) realizujemy jako CI na każdym PR / pushu + instrukcja i kontrole kompensujące, bez twardej blokady po stronie GitHuba;
  - mitygacja RR-02 / RR-11 z EVM-005 („wymagana akceptacja PR przez Konrada”) nie jest wymuszalna — do ponownej oceny przez `security-engineer` w planie; kontrole już działające: deploy key tylko do tego repo (`~/.ssh/evia_manager`, alias `github-evia-manager`), reguła `deny` na `git push origin main` w `.claude/settings.json`, squash merge lokalnie przez orkiestratora po akceptacji, push na `main` wykonuje Konrad;
  - sprawdzić dostępność GitHub Environments (sekrety środowisk, ograniczenie gałęzi wdrożeń) w prywatnym repo na Free — polegają na nich SR-INFRA-13 / SR-INFRA-14 i RR-20 (EVM-007).
- 2026-10-03 — remote `origin` dodany, `main` wypchnięty przez Konrada (stan: `e4b4a2f`).
- 2026-10-03 — Konrad: zgoda na `git push` **wyłącznie gałęzi `feature/EVM-006-repo-i-ci`** do `origin` (agenci i orkiestrator) w celu weryfikacji CI; bez force-pusha, bez `main`. PR na GitHubie otwiera Konrad (brak `gh` na stacji); push na `main` — tylko Konrad.
- 2026-10-03 — Konrad (odpowiedzi na pytania planu D1–D5):
  - **D1:** Node **26** także na hoście Windows (jedna wersja główna wszędzie, ADR-0015); Konrad instaluje Node 26 z nodejs.org i `npm install -g pnpm@12.8.1` przed implementacją.
  - **D2:** scalanie do `main` — **Konrad klika „Squash and merge” w PR na GitHubie** po akceptacji demo (widzi status `ci-gate`); orkiestrator lokalnie tylko `git fetch` + `git merge --ff-only origin/main`; job `main-integrity` wykrywa commity na `main` bez zielonego PR. Zastępuje lokalny squash przez orkiestratora i ręczny push `main` — do zapisania w `docs/process/` (konwencje / workflow) w tej historyjce.
  - **D3:** **zizmor** (MIT, analiza workflowów GitHub Actions) dodany w EVM-006 — odstępstwo od listy narzędzi ADR-0012 zapisane w ADR / historyjce.
  - **D4:** zgoda (a) na zapis `compose.yaml` przez wykonawcę (Konrad potwierdza monit reguły `ask`); (b) zmiany `.claude/settings.json` z p. 12 — wprowadzone przez orkiestratora 2026-10-03 (allow: `backend-install`, `backend-tests … gate:backend` / `test:backend:*`, `pnpm run gate`, `pnpm run scan`; deny: `--no-verify` / `-n`, dalsze formy pushu na `main`, `Read(~/.ssh/**)`) — do przeglądu `security-engineer` w tej historyjce.
  - **D5:** brak odpowiedzi → rekomendacja: fine-grained PAT tylko do tego repo (Contents RW, Pull requests RW, Workflows RW, Issues RW, Dependabot alerts R, Metadata R; 90 dni) jako sekret repo `RENOVATE_TOKEN`, zakłada Konrad po scaleniu wg `docs/ops/`.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione i zweryfikowane przez QA
- [ ] Przeglądy: code-reviewer, security-engineer — APPROVE
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — dopisano notatkę o przejęciu głównego `package.json` i narzędzia z EVM-012 („Notatki techniczne”, bez zmiany AC) (product-owner)
- 2026-10-03 — „Notatki techniczne” zaktualizowane wg ADR-0015 (testy per warstwa, zadania „Po EVM-006”, sekrety usług zewnętrznych poza katalogiem repo), bez zmiany AC (product-owner)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-006-repo-i-ci`
- 2026-10-03 — plan techniczny (devops-engineer)
