# Strategia testów

> Narzędzia wybrane w EVM-001 (ADR-0014, ADR-0015) i wdrożone w EVM-006 — sekcja „Narzędzia”; kolejne warstwy (web, mobile, backend) dopisują swoje polecenia w historyjkach, które je wprowadzają.

## Zasady
1. **TDD:** test przed kodem; każde AC ma co najmniej jeden test automatyczny z oznaczeniem `EVM-xxx AC#` w nazwie lub opisie (śledzenie AC → test).
2. **Testujemy zachowanie, nie implementację:** asercje na wynikach widocznych dla użytkownika lub klienta API.
3. **Deterministycznie:** bez sztucznych opóźnień, z kontrolowanym czasem, strefą i danymi.
4. **Tylko dane syntetyczne** (np. generatory z lokalizacją `pl`) — nigdy kopie danych klientów (RODO).
5. **Niestabilny test** → kwarantanna z ID historyjki naprawczej i termin naprawy; nigdy ciche wyłączenie.

## Piramida i rodzaje testów
| Rodzaj | Co obejmuje | Kiedy |
|---|---|---|
| Jednostkowe | logika domenowa, walidacje, silnik synchronizacji i kolejka uploadu (mobile), logika komponentów | każda historyjka |
| Integracyjne | API + prawdziwa baza w kontenerze, storage, zadania w tle | każda zmiana backendu |
| Kontraktowe | zgodność API ze specyfikacją; wygenerowani klienci web / mobile | każda zmiana API |
| Uprawnień (macierz ról) | każdy endpoint × Administrator / Edytor / Tylko odczyt / niezalogowany + IDOR | każdy nowy lub zmieniony endpoint |
| Komponentowe UI | stany, warianty, dostępność (axe) | każda zmiana UI |
| E2E web | ścieżki AC przechodzące przez cały stos | historyjki z UI web |
| E2E mobile | kluczowe przepływy, scenariusze offline (tryb samolotowy → powrót sieci) | historyjki mobile |
| Mutacyjne | jakość testów modułów domenowych i synchronizacji | od M1, cyklicznie (np. nocą) |
| Bezpieczeństwa | SAST, zależności, sekrety w CI; DAST baseline na staging | CI / przed wydaniem |
| Wydajnościowe (smoke) | listy, wyszukiwanie, upload dużych plików | przed wydaniem (od M1) |

## Gdzie uruchamiamy testy (ADR-0015)
Środowisko testów jest dobrane do platformy docelowej warstwy. Dowód lokalny trafia do raportu agenta i liczy się w DoD; bramką merge jest zawsze dodatkowo CI Linux (od EVM-006). Pełna tabela: [ADR-0015](../architecture/adr/0015-srodowisko-testow-per-warstwa.md) → „Co jest dowodem — per warstwa”.

| Warstwa | Dowód lokalny | CI Linux |
|---|---|---|
| Backend (API, worker, media-processor, migracje): jednostkowe, integracyjne, kontraktowe, macierz ról | wyłącznie kontener Linux `backend-tests` (od EVM-006); wynik natywny na Windows nie jest dowodem | tak |
| Pakiety współdzielone, lint, typy, kontrakt | natywnie na Windows | tak |
| Web: Vitest, Playwright E2E | natywnie na Windows w Chromium/Chrome, Edge (`msedge`), Firefox; bez testów zrzutów ekranu | tak (Chromium, Firefox, WebKit; zrzuty ekranu tylko tu lub w obrazie Playwright) |
| Mobile: Jest, Vitest, lint, typy | natywnie na Windows | tak (bez emulatora) |
| E2E Android (Maestro) | emulator Androida na Windows — jedyny dowód (wynik z wersją API w raporcie) | odłożone (warunek powrotu w ADR-0015) |
| iOS | odłożony w całości do decyzji przed planowaniem wydania iOS | — |
| `tools/`, dokumentacja | natywnie na Windows | tak |

Zasady: rozbieżność lokalnie/CI to błąd do wyjaśnienia (dla backendu rozstrzyga Linux); testy nie zależą od strefy czasowej ani ustawień regionalnych hosta — strefę `Europe/Warsaw` ustawia sam test.

## Progi (bramki CI — spadek blokuje merge)
| Obszar | Linie i gałęzie |
|---|---|
| **Zmieniony kod w każdej zmianie (diff coverage)** | **≥ 90%** |
| Pakiety współdzielone i `tools/` | ≥ 90% |
| Backend — całość | ≥ 85% |
| Backend — moduły domenowe | ≥ 95%, wynik testów mutacyjnych ≥ 70% (cel 80%) |
| Web — całość | ≥ 80% |
| Mobile — całość | ≥ 80% |
| Mobile — synchronizacja i kolejka uploadu | ≥ 95% |
| Macierz ról | 100% endpointów |

Progi globalne działają jak zapadka: mogą tylko rosnąć. Obniżenie wymaga ADR i zgody użytkownika. Wykluczenia z pokrycia (kod generowany, konfiguracja) są jawnie wypisane w konfiguracji; każde inne wymaga komentarza z uzasadnieniem.

## Przypadki brzegowe specyficzne dla domeny
- Polskie znaki (ąćęłńóśźż) w nazwach, wyszukiwaniu („Lodz” → „Łódź”), sortowaniu i nazwach plików.
- Daty i terminy wokół zmiany czasu w strefie `Europe/Warsaw`; zapis w UTC.
- Duże pliki (filmy kilkaset MB+), przerwany i wznowiony upload, duplikaty.
- Równoczesna edycja zlecenia przez dwie osoby.
- Kwoty (grosze, zaokrąglenia, waluta PLN).

## Test terenowy (checklista przed wydaniem mobile)
1. Telefon w trybie samolotowym (lub garaż podziemny bez zasięgu): 30 zdjęć, 3 filmy (w tym jeden > 2 min), 2 wpisy w jednym zleceniu.
2. Wymuszone zamknięcie aplikacji w trakcie i restart telefonu.
3. Powrót zasięgu: wszystko trafia do właściwego zlecenia automatycznie, bez duplikatów; statusy plików poprawne.
4. Opcja „filmy tylko przez Wi-Fi”: filmy czekają na Wi-Fi, zdjęcia idą przez sieć komórkową.
5. Wynik i obserwacje zapisane w historyjce wydania.

## Narzędzia
Stan po EVM-006. Jedno polecenie bramki lokalnej: **`pnpm run gate`** (kolejno: sprawdzenie hooków git, walidator dokumentacji `node tools/docs-lifecycle/cli.mjs check` — w CI pierwszy krok joba `quality`, bramka 11 — usunięcie starych raportów `lcov.info`, `gate:native` — format, lint, typy, testy z progami w każdym workspace, granice modułów — potem `gate:backend` w kontenerze `backend-tests` i `coverage:diff`). W CI te same polecenia (`.github/workflows/ci.yml`); skany bezpieczeństwa: `pnpm run scan` (`tools/scan/README.md`).

| Warstwa / rodzaj | Narzędzie | Polecenie | Od |
|---|---|---|---|
| Pakiety współdzielone (`packages/*`) — jednostkowe i pokrycie | **Vitest 5** + pokrycie V8, preset `@evia/config/vitest` (progi per warstwa, raport `lcov`) | natywnie: `pnpm run test:coverage` (Turborepo); parytet Linux: `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` | EVM-006 |
| Narzędzia `tools/*.mjs` (bez zależności w runtime) | **node:test** z pokryciem przez `evia-node-test` (`@evia/config`; progi 90% linii i gałęzi, wszystkie pliki źródłowe, raport `lcov`) | `pnpm run test:coverage`; całość jak w EVM-012: `npm run test:tools` | EVM-006 (EVM-012) |
| Niezmienniki repozytorium (`tools/repo-policy`) | Vitest (TypeScript) + `yaml` | w ramach `pnpm run test:coverage` | EVM-006 |
| Design tokens (`packages/tokens`) | Vitest — walidacja tokenów i build web / mobile | `pnpm run build`, `pnpm run test:coverage` | EVM-006 |
| **Pokrycie zmienionego kodu ≥ 90%** | **`tools/diff-coverage`** — własny skrypt (baza: `merge-base` z `origin/main`; zmiany nieskomitowane i nowe pliki też się liczą; zmieniony plik bez raportu = niepokryty; scala raporty hosta, kontenera i CI) | `pnpm run coverage:diff` | EVM-006 |
| Wykluczenia z pokrycia | jedno źródło: `packages/config/coverage-exclusions.json` (każde z uzasadnieniem) — czytają je Vitest, `evia-node-test` i `diff-coverage` | — | EVM-006 |
| Backend (API, worker, media-processor, migracje), integracyjne z PostgreSQL | Vitest + Testcontainers (CI) / usługi Compose (lokalnie) w kontenerze **`backend-tests`** | `docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend` (po `docker compose -f compose.yaml run --rm backend-install`) | EVM-008 |
| Lint, format, typy, granice modułów | ESLint 10 + typescript-eslint (`strictTypeChecked`), Prettier 3, TypeScript 6 (`strict`), dependency-cruiser | `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm run deps:check` | EVM-006 |
| Web — komponentowe i E2E | Vitest + jsdom + Testing Library + `axe-core`; **Playwright** na `vite preview` (Chromium, Firefox, na Windows także Edge `msedge`; CI Linux — job `e2e-web`: Chromium, Firefox); zrzuty do przeglądu UX osobnym projektem, bez asercji wizualnych | `pnpm --filter @evia/web run test:coverage`, `pnpm run e2e`, `pnpm --filter @evia/web run e2e:screenshots` | EVM-008 |
| Mobile — komponentowe i E2E Android | Jest + jest-expo; **Maestro** na emulatorze Androida na Windows | od EVM-009 | EVM-009 |
| Bezpieczeństwo (SAST, zależności, licencje, sekrety, Dockerfile, workflowy) | Semgrep CE, OSV-Scanner, Trivy, gitleaks, zizmor, actionlint + samotest skanerów | `pnpm run scan`; gitleaks także w hookach `pre-commit` / `pre-push` | EVM-006 |

Zasady: wynik natywny na Windows nie jest dowodem dla backendu (ADR-0015); próg pokrycia, którego nie da się spełnić, zgłaszamy — nie obniżamy go i nie dodajemy wykluczeń bez uzasadnienia w `coverage-exclusions.json`; komentarze `v8 ignore` / `node:coverage` tylko dla okablowania procesu (punkty wejścia), zawsze z uzasadnieniem w treści komentarza. Cache Turborepo liczy skrót tylko z plików workspace'u — test, który czyta repozytorium poza swoim workspace'em albo zależy od bieżącej daty, ma w `turbo.json` workspace'u `cache: false` (`tools/repo-policy`, `tools/docs-lifecycle`) albo `inputs` z `$TURBO_ROOT$/…` (`packages/tokens`, `tools/scan`); pilnuje tego `tools/repo-policy`.
