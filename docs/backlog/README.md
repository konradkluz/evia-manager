# Backlog

Każda pozycja to plik `docs/backlog/<M#>/EVM-###-krotki-opis.md` utworzony z `_template.md`. **Frontmatter pliku jest jedynym źródłem prawdy o statusie** — `/progress` liczy z niego postęp.

## Typy
- **story** — wartość dla użytkownika (pionowy przyrost).
- **enabler** — fundament techniczny lub dokument decyzyjny (ADR, styleguide, CI).
- **spike** — ograniczone czasowo rozpoznanie; rezultatem jest wiedza / rekomendacja, kod jest wyrzucany lub świadomie promowany.
- **bug** — odstępstwo od zaakceptowanego zachowania.

## Statusy
`draft` → `ready` → `in-progress` → `in-review` → `done`, oraz `blocked`. Przejścia opisuje `docs/process/workflow.md`; `ready` ustawia się wyłącznie po akceptacji użytkownika.

## Priorytety
**P0** — blokuje inne prace · **P1** — wymagane do kamienia milowego · **P2** — ważne, może poczekać · **P3** — miłe do posiadania.

## Przypisanie (frontmatter)
- `owner` — główny wykonawca (agent), `contributors` — kolejni wykonawcy w podanej kolejności.
- `reviewers` — wymagane przeglądy; domyślnie `code-reviewer` dla kodu, `security-engineer` dla zmian wrażliwych, `ux-designer` dla UI; dla dokumentów — agenci, którzy będą z nich korzystać.
- `model` — model wykonawców w `/deliver`: `sonnet` (domyślnie) albo `opus`; kryteria `opus` i zasady: `docs/process/workflow.md` → „Modele i effort agentów”.

## Numeracja
Kolejny numer = najwyższy istniejący `EVM-###` + 1 (bez ponownego użycia numerów, także po odrzuceniu).

## Kamienie milowe
- `M0/` — fundamenty (EVM-001 … EVM-013, EVM-074)
- `M1/` — MVP „Biuro” (EVM-014 … EVM-073); plan, kolejność, pilot i decyzje: `M1/README.md` (EVM-010, `/milestone plan M1`)
