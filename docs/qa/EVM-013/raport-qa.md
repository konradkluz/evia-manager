# EVM-013 — raport QA

Weryfikację wykonał orkiestrator (decyzja 11: workflow `deliver-story` zatrzymany po implementacji, bez agenta QA, jedna runda przeglądów). Data: 2026-10-05. Gałąź `feature/EVM-013-walidator-dokumentacji-w-ci`. Historyjka: [EVM-013](../../backlog/M0/EVM-013-walidator-dokumentacji-w-ci.md).

**Wynik: PASS** — AC1–AC8 spełnione. AC1 i AC2 potwierdzają prawdziwe przebiegi GitHub Actions (dowody 1–3), AC3–AC8 — testy automatyczne `EVM-013 AC#` i symulacja kroku CI.

## Macierz AC → dowody
| AC | Wynik | Dowód |
|---|---|---|
| AC1 — błąd czerwieni `ci-gate` | PASS | Dowód 1 (przebieg 42): krok „Documentation lifecycle validator (docs:check, bramka 11)” — `failure` (< 1 s), w logu `BŁĄD · docs/notatka-evm-013.md · — · plik poza dozwolonymi lokalizacjami …` i `błędy: 1 · ostrzeżenia: 0`; kolejne kroki `quality` (instalacja, format, lint, typy, granice, testy, build) — `skipped`; `coverage` — `skipped`; `backend` i `security` — `success`; `ci-gate` — `failure`. Treść podsumowania: symulacja kroku (niżej) — sekcja walidatora z błędem i podpowiedzią `npm run docs:check` |
| AC2 — ostrzeżenia nie blokują; wynik jak lokalnie | PASS | Dowód 2 (przebieg 43): krok walidatora — `success` (~1 s), w logu 2 ostrzeżenia (przeterminowany, osierocony) i `błędy: 0 · ostrzeżenia: 2` — te same liczby co lokalne `npm run docs:check` na tym commicie; pełny `quality`, `coverage` i `ci-gate` — `success`. Dowód 3 (HEAD): 0 / 0 zgodne z lokalnym. Testy: `test/summary.test.mjs` (`EVM-013 AC2` — struktura, „brak”, zależność od daty bez wpływu na kod wyjścia) |
| AC3 — brak fałszywej zieleni, stała konfiguracja | PASS | `tools/repo-policy`: `docsCheckStepProblems` (testy `EVM-013 AC3`, 37 syntetycznych osłabień wykrytych; przegląd security — 31 mutacji prawdziwego `ci.yml` wykrytych), skrypt `gate` (`structure.test.ts`); symulacja kodów 0 / 1 / 2 i braku `GITHUB_STEP_SUMMARY` (niżej); czas kroku w dowodach: < 1 s (1), ~1 s (2); 0 nowych jobów, akcji, zależności i sekretów; zizmor i actionlint — zielone w jobie `security` (przebiegi 42, 43) |
| AC4 — nazwy plików nie sterują logiem | PASS | `test/output-safety.test.mjs` (`EVM-013 AC4`: `safeLine`, `::` i `##[`, LF, niepoprawny UTF-8, `ToolError`, błąd nieoczekiwany, `shellQuote` z wykonaniem w `sh`); przegląd security: fuzz 2 mln ciągów przez `safeLine`, emulacja parsera poleceń runnera. Ograniczenie: dopasowywacze problemów z `actions/setup-node` — „Uwagi do rozważenia” 5 (Low) |
| AC5 — bezpieczne podsumowanie | PASS | `test/summary.test.mjs` (`EVM-013 AC5`: wartości dosłownie w bloku kodu, limity 100 pozycji i 400 KiB na blok, całość < 1 MiB, brak treści dokumentów i pola `title`), `test/readonly.test.mjs` (narzędzie nie zna `GITHUB_STEP_SUMMARY`); przegląd security: render markdown-it i commonmark.js dla 20 złośliwych ścieżek |
| AC6 — złośliwy plik nie zawiesza bramki | PASS | `test/redos.test.mjs` (z pomiarem w wątku, `test/helpers/timed-task.mjs`) i `test/references.test.mjs` (`EVM-013 AC6`): pliki ~200 KB z U+2028 / U+2029 — ok. 40 ms na przypadek w CI (limit 2 s), twardy termin 10 s z `worker_threads` i `terminate()`, test kontrolny przerwania; pokrycie `tools/docs-lifecycle` 100% linii, gałęzi i funkcji (CI, przebieg 43) |
| AC7 — porządki z EVM-012 bez zmiany reguł | PASS | dotychczasowe testy bez zmian oczekiwań (wyjątki: „Plan techniczny” p. 9); flaga `classError` i lista „Błędy klasy” w polityce z testem spójności; test `.MD` z numerem reguły; `npm run test:tools` 381/381 na Node 22.22 i 26.10 |
| AC8 — parytet z `pnpm run gate` i dokumentacja | PASS | `pnpm run gate` uruchamia walidator zaraz po `git-hooks check` (test `structure.test.ts`); opisy w `CLAUDE.md`, `docs/ops/github-i-ci.md`, `docs/process/document-lifecycle.md` i README narzędzia przypięte testami `EVM-013 AC8`; odwołania do długu → EVM-073; `npm run docs:check` — 0 błędów |

## Bramki
- **Lokalnie** (Claude Code web, Node 26.10, bez Dockera): `node tools/diff-coverage/cli.mjs clean && pnpm run gate:native && pnpm run coverage:diff` — zielone (27/27 zadań Turborepo, granice modułów bez naruszeń, pokrycie zmienionego kodu 321/321 linii i 151/151 gałęzi); `npm run test:tools` — 381/381 na Node 26.10 i 22.22; `npm run docs:check` — 0 błędów, 0 ostrzeżeń.
- **Tylko w CI** (lokalnie brak Dockera i hooków git; `pnpm run gate` kończy się na `git-hooks check`): `gate:backend` w kontenerze `backend-tests`, licencje, `pnpm run scan` (gitleaks, Semgrep, OSV-Scanner, Trivy, zizmor, actionlint, Renovate), pokrycie zmienionego kodu w jobie `coverage` — zielone w przebiegach 40 (`7707cb4`) i 43 (`8fc94f9`) oraz na HEAD (dowód 3). Przegląd security uruchomił dodatkowo natywnie gitleaks, zizmor, actionlint ze shellcheckiem i Semgrep CE w wersjach z `compose.yaml` — bez ustaleń.
- Rozbieżności lokalnie / CI: brak.

## Symulacja kroku CI (lokalnie)
Skrypt `run:` kroku wycięty z `.github/workflows/ci.yml` i uruchomiony jak na runnerze (`bash --noprofile --norc -eo pipefail`) w kopii repozytorium z plikami syntetycznymi:

| Przypadek | Kod | Podsumowanie (`GITHUB_STEP_SUMMARY`) |
|---|---|---|
| czysta dokumentacja | 0 | „Wynik: brak błędów i ostrzeżeń”, obie listy „brak” |
| `docs/notatka-evm-013.md` poza dozwolonymi lokalizacjami | 1 | „Wynik: błędy (1)”, błąd w bloku kodu, podpowiedź `npm run docs:check` |
| notatka osierocona z przeterminowanym `review_by` | 0 | „ostrzeżenia (2) do przejrzenia — nie blokują”, oba ostrzeżenia w bloku kodu |
| brak `GITHUB_STEP_SUMMARY` | 1 | — (fail-closed) |
| katalog bez repozytorium git | 2 | puste |

## Dowody z GitHub Actions
Każdy przebieg zakończony (nie anulowany); kolejny push dopiero po zakończeniu poprzedniego.

| # | Commit | Przebieg | Wynik |
|---|---|---|---|
| — | `7707cb4` — implementacja | [run 40](https://github.com/konradkluz/evia-manager/actions/runs/37352600834) | `ci-gate` zielony — implementacja w CI (Node 26, Vitest `tools/repo-policy`, skany) |
| 1 | `3c2c930` — syntetyczny błąd (`docs/notatka-evm-013.md`) | [run 42](https://github.com/konradkluz/evia-manager/actions/runs/37356357288) | `ci-gate` czerwony; przyczyna: krok walidatora; reszta `quality` i `coverage` pominięte; `backend`, `security` zielone. Revert: `62dc50c` |
| 2 | `8fc94f9` — same ostrzeżenia (`docs/notes/evm-013-dowod-ostrzezen.md`) | [run 43](https://github.com/konradkluz/evia-manager/actions/runs/37356637879) | `ci-gate` zielony, 2 ostrzeżenia w logu i podsumowaniu, liczby jak lokalnie. Revert: `b685b1c` |
| 3 | HEAD gałęzi (commit z tym raportem) | przebieg `ci.yml` na HEAD — link w demo i w opisie PR | `ci-gate` zielony, podsumowanie 0 / 0 zgodne z lokalnym `npm run docs:check` z tego dnia, krok < 1 min |

Pliki syntetyczne nie zawierają danych osobowych; usunęły je commity `revert` bez przepisywania historii, a squash merge nie przenosi ich na `main`. Treść podsumowania przebiegu (Step Summary) nie jest dostępna przez API GitHuba — jej render w przeglądarce sprawdza Konrad w demo (DoD).

## Przeglądy
- `code-reviewer` (model `sonnet`) — APPROVE: 0 blocker / major; mutacje kodu — 19 z 20 wykryte przez testy.
- `security-engineer` (model `sonnet`) — APPROVE: 0 blocker / major; dokumenty bezpieczeństwa zaktualizowane (SR-SUPPLY-11, TM-103–TM-105, RR-22).
- Ustalenia minor i nity — „Uwagi do rozważenia” 5–9 w historyjce (propozycje do historyjki P3 z „Decyzji” 8).
