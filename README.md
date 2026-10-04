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
4. Bramka jakości (format, lint, typy, testy z progami pokrycia natywnie i w kontenerze, granice modułów, pokrycie zmienionego kodu ≥ 90%): `pnpm run gate`.
5. Build (m.in. design tokens → `packages/tokens/dist/`): `pnpm run build`.
6. Skany bezpieczeństwa i samotest skanerów (gitleaks, Semgrep, OSV-Scanner, Trivy, zizmor, actionlint, walidacja Renovate): `pnpm run scan`.
7. Jednorazowo na hoście: `pnpm exec turbo telemetry disable` (w kontenerze i CI telemetria jest wyłączona zmienną środowiskową).

Pozostałe polecenia: `CLAUDE.md` → „Stack i komendy”. Uruchomienie aplikacji (`pnpm run dev`) i E2E (`pnpm run e2e`) — od EVM-008 / EVM-009. GitHub, CI i scalanie PR: `docs/ops/github-i-ci.md`. Sekrety usług zewnętrznych nigdy w katalogu repozytorium (`.env.example`, `docs/ops/rotacja-sekretow.md`).
