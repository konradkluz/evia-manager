# EVia Manager

Ekosystem do zarządzania pracą firmy **EVia Charge**: panel web (klienci, zlecenia, procesy przyłączeniowe, płatności etapowe, dokumentacja), aplikacja mobilna do pracy w terenie (zdjęcia i filmy offline z automatycznym uploadem) oraz wspólne API.

Projekt jest realizowany przez **zespół agentów Claude Code** pod nadzorem właściciela produktu, małymi krokami z kryteriami akceptacji, w TDD i z bramkami jakości.

## Jak pracować z zespołem
| Komenda | Co robi |
|---|---|
| `/progress` | stan projektu, co czeka na Twoją decyzję, co dalej |
| `/refine <pomysł>` | zamienia pomysł w historyjkę z kryteriami akceptacji (do Twojej akceptacji) |
| `/deliver EVM-012` | realizuje historyjkę: plan → TDD → QA → przeglądy → poprawki → demo → Twoja akceptacja |
| `/review-branch` | niezależny przegląd bieżących zmian |
| `/adr <temat>` | decyzja architektoniczna do akceptacji |
| `/milestone plan M1` / `/milestone close M1` | planowanie / zamknięcie kamienia milowego z retrospektywą |

Typowy cykl: `/progress` → `/refine` → akceptujesz AC → `/deliver` → oglądasz demo → akceptujesz → kolejna historyjka.

## Gdzie co jest
- `CLAUDE.md` — zasady projektu dla wszystkich agentów
- `.claude/agents/` — zespół: product-owner, solution-architect, ux-designer, backend-developer, web-developer, mobile-developer, qa-engineer, security-engineer, devops-engineer, code-reviewer
- `.claude/workflows/deliver-story.js` — deterministyczny potok realizacji historyjki
- `docs/` — wizja, domena, roadmapa, proces, architektura, bezpieczeństwo, UX, backlog (`docs/README.md`)

## Stack
TypeScript wszędzie: API NestJS (Node.js 26), panel React + Vite, aplikacja React Native + Expo; PostgreSQL; monorepo pnpm + Turborepo; CI GitHub Actions. Decyzje: `docs/architecture/README.md` (ADR 0001–0016).

## Szybki start
Wymagania (Windows 11): **Git**, **Docker Desktop** (testy backendu i skany w kontenerach Linux — ADR-0015), **Node.js 26** i **pnpm 12** (`npm install -g pnpm@12.8.1`; dokładną wersję i sumę kontrolną wyznacza `packageManager` w `package.json`).

1. Klon: `git clone git@github.com:konradkluz/evia-manager.git` (albo przez alias klucza SSH) i `cd evia-manager`.
2. Zależności na Windows + hooki git (lefthook: format, lint, gitleaks): `pnpm install`. **Nie** używaj `npm install` (tworzy `package-lock.json`).
3. Zależności Linux w wolumenie kontenera `backend-tests` (po każdej zmianie `pnpm-lock.yaml`): `docker compose -f compose.yaml run --rm backend-install`.
4. Bramka jakości (walidator dokumentacji, format, lint, typy, testy z progami pokrycia natywnie i w kontenerze, granice modułów, pokrycie zmienionego kodu ≥ 90%): `pnpm run gate`.
5. Build (m.in. design tokens → `packages/tokens/dist/`): `pnpm run build`.
6. Skany bezpieczeństwa i samotest skanerów (gitleaks, Semgrep, OSV-Scanner, Trivy, zizmor, actionlint, walidacja Renovate): `pnpm run scan`.
7. Jednorazowo na hoście: `pnpm exec turbo telemetry disable` (w kontenerze i CI telemetria jest wyłączona zmienną środowiskową).

Pozostałe polecenia: `CLAUDE.md` → „Stack i komendy”. Uruchomienie aplikacji lokalnie (`pnpm run dev`): sekcja „Uruchomienie lokalne” niżej; E2E (`pnpm run e2e`) — od EVM-009. GitHub, CI i scalanie PR: `docs/ops/github-i-ci.md`. Sekrety usług zewnętrznych nigdy w katalogu repozytorium (`.env.example`, `docs/ops/rotacja-sekretow.md`).

## Uruchomienie lokalne
Jedno polecenie uruchamia na Twoim komputerze bazę i API (kontenery z `compose.dev.yaml`) oraz panel (Vite, natywnie), tworzy konto Administratora i dane demo. Dotyczy wyłącznie maszyny lokalnej — nie stagingu, nie produkcji. Szczegóły narzędzia: `tools/dev-env/README.md`.

**Wymagania:** kroki 1–2 „Szybkiego startu” (klon, `pnpm install`), uruchomiony **Docker Desktop** i **terminal interaktywny** (link aktywacyjny pojawia się tylko tam). Wolne porty `3000` (API), `5173` (panel) i `5442` (baza dev).

1. **Konfiguracja (raz):** `pnpm run dev:init` — tworzy `.env` z `.env.example` i losowym `CURSOR_KEY` (wartość nie jest wypisywana; plik jest ignorowany przez git). Istniejącego `.env` nie nadpisuje.
2. **Start:** `pnpm run dev`. Pierwsze uruchomienie buduje obraz API (kilka minut). Polecenie: uruchamia bazę i API, stosuje migracje, prosi o **fikcyjny adres e-mail** Administratora i wypisuje **jednorazowy link aktywacyjny** (tylko na terminalu — nie wklejaj go do czatu ani zgłoszeń), potem uruchamia panel na pierwszym planie. Powtórne uruchomienie jest bezpieczne i nie traci danych.
3. **Aktywacja:** otwórz link w przeglądarce (Chrome lub Edge) pod adresem **`http://localhost:5173`** — to jedyny wspierany adres (`127.0.0.1` jest odrzucany przez kontrolę origin i WebAuthn). Ustaw hasło i zarejestruj klucz dostępu (Windows Hello lub klucz sprzętowy) zgodnie z runbookiem `docs/ops/runbooks/aktywacja-i-tryb-awaryjny.md`, wyloguj się i zaloguj ponownie.
4. **Dane demo (drugi krok):** dane demo tworzy aktywny Administrator jako autor, więc przy pierwszym `dev` (konto „Oczekuje na aktywację”) pojawia się komunikat „dane demo pojawią się po aktywacji — uruchom ponownie `pnpm run dev` (lub `pnpm run dev:seed`)”. Po aktywacji uruchom to polecenie jeszcze raz: powstaną klienci (osoby i firmy), lokalizacje ze stronami i zlecenia w różnych statusach (nowe, w ofercie, zaakceptowane, w toku, zakończone). Dane są fikcyjne (e-maile `@example.test`, telefony `+48000…`, bez PESEL); powtórka nie tworzy duplikatów i nie rusza danych wprowadzonych ręcznie.
5. **Adresy:** panel `http://localhost:5173`, API `http://127.0.0.1:3000` (w panelu pod `/api`), baza `127.0.0.1:5442` (`evia_dev`) — wszystko tylko na pętli zwrotnej, nie w sieci lokalnej. Dziennik audytu (ze step-upem) otwiera się po ponownym potwierdzeniu kluczem.
6. **Zatrzymanie:** `Ctrl+C` zatrzymuje panel; `pnpm run dev:stop` zatrzymuje kontenery (**dane bazy zostają**).
7. **Czyszczenie:** `pnpm run dev:reset` usuwa kontenery i wolumen bazy dev (`compose.dev.yaml`). **Operacja jest nieodwracalna** — tracisz dane demo i konto Administratora (po resecie wydasz nowy link). Wymaga terminala i wpisania frazy `usuń dane dev`; kontenery i wolumeny bramek (`compose.yaml`) nie są ruszane.

Inne polecenia: `pnpm run dev:admin` (tylko procedura Administratora — nowy link; poprzedni przestaje działać), `pnpm run dev:seed` (tylko dane demo). Docker dla `compose.dev.yaml` wyłącznie w czterech formach, które wywołuje narzędzie (nie uruchamiaj ich ręcznie poza sytuacją awaryjną): `docker compose -f compose.dev.yaml up -d --wait --build`, `docker compose -f compose.dev.yaml down`, `docker compose -f compose.dev.yaml down -v`, `docker compose -f compose.dev.yaml exec api node dist/src/cli/bootstrap-admin.js`.

**Strażnik:** polecenia `dev*` odmawiają (kod ≠ 0, bez opcji `--force`), gdy `NODE_ENV` ≠ `development`, `WEBAUTHN_RP_ID` ≠ `localhost`, `DATABASE_URL` wskazuje inny host/bazę/port niż lokalna baza `evia_dev` na `127.0.0.1:5442` (albo ma parametry zapytania), ustawione są zmienne `PG*`, albo baza nie ma znacznika środowiska lokalnego.

**Typowe problemy**
| Objaw | Przyczyna i poprawka |
|---|---|
| „Docker nie działa” | uruchom Docker Desktop i powtórz `pnpm run dev` |
| „port 3000 lub 5442 jest zajęty” | zamknij program na tym porcie (lub wcześniejszą instancję: `pnpm run dev:stop`) |
| „brak pliku .env” | `pnpm run dev:init` |
| „strażnik odmawia” | popraw wskazane ustawienia w `.env` według `.env.example` |
| „wymaga terminala interaktywnego” | uruchom polecenie w zwykłym terminalu (nie przez potok, harmonogram ani agenta) |
| logowanie odrzucone na `127.0.0.1` | użyj `http://localhost:5173` |
| panel nie widzi API | sprawdź `http://127.0.0.1:3000/api/health`; `pnpm run dev` uruchom ponownie |
| chcę zacząć od zera | `pnpm run dev:reset`, potem `pnpm run dev` |

Uwaga: sieć dev ma wyjście do internetu (kontener API i baza), bo sieć `internal` nie publikuje portów; dla lokalnej bazy z danymi syntetycznymi jest to akceptowalne. Każde `dev` z kontem „Oczekuje na aktywację” może wydać nowy link, który unieważnia poprzedni (zgodnie z EVM-016).
