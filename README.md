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
Wybierany w M0 (EVM-001) przez `solution-architect` i akceptowany przez właściciela produktu. Instrukcja uruchomienia pojawi się po EVM-006.
