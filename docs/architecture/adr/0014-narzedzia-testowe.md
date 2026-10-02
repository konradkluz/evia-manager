# ADR-0014: Narzędzia testowe każdej warstwy — Vitest, Testcontainers, macierz ról z kontraktu, Playwright, Maestro

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (konsultacja: qa-engineer w przeglądzie; narzędzia wpisuje EVM-006 do `testing-strategy.md` → „Narzędzia”)
- **Powiązane:** EVM-001, EVM-005, EVM-006, EVM-011; ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0008, ADR-0012; `docs/process/testing-strategy.md`

## Kontekst i problem
`testing-strategy.md` wymaga TDD z oznaczeniem testów `EVM-xxx AC#`, progów pokrycia (zmieniony kod ≥ 90%, backend ≥ 85%, moduły domenowe ≥ 95% + mutacyjne ≥ 70%, web/mobile ≥ 80%, sync i kolejka uploadu ≥ 95%), **macierzy ról dla 100% endpointów**, testów kontraktowych, komponentowych z a11y, E2E web i mobile (scenariusze offline), DAST na staging oraz wyłącznie danych syntetycznych. Narzędzia muszą działać na Windows 11 (Konrad) i w CI Linux. Trzy kluczowe wybory: **runner testów**, **E2E web**, **E2E mobile**; pozostałe narzędzia wynikają z nich.

## Kryteria decyzji
**Runner testów (backend, web, pakiety)**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Wydajność, ESM i TypeScript bez konfiguracji | 4 | NestJS 12 i Vite 8 są ESM |
| Pokrycie z progami (globalne, per katalog) | 4 | bramki CI |
| Jeden runner dla backendu, web i pakietów | 4 | prostota dla agentów |
| Ekosystem (mutacyjne, kontenery, mocki HTTP) | 3 | Stryker, Testcontainers, MSW |

**E2E web**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Stabilność (auto-wait, izolacja, retry diagnostyczny) | 5 | brak niestabilnych testów |
| Przeglądarki z wizji (Chrome, Edge, Safari/WebKit, Firefox) | 4 | wymaganie platform |
| Integracja z axe (a11y) | 3 | WCAG 2.2 AA |
| Działanie na Windows i w CI | 3 | środowisko Konrada |

**E2E mobile**
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Scenariusze offline (tryb samolotowy, zabicie aplikacji, restart) | 5 | test terenowy z `testing-strategy.md` |
| Działanie na Windows (emulator Androida) i w CI Linux | 4 | brak Maca |
| Prostota pisania przez agentów | 4 | produktywność |
| Wsparcie Expo / React Native | 4 | ADR-0007 |
| iOS (symulator/urządzenie w chmurze lub macOS w CI) | 3 | flota mieszana |

## Rozważane opcje
- **Runner:** **A. Vitest 5** · **B. Jest 30** · **C. `node:test`**.
- **E2E web:** **A. Playwright 1.63** · **B. Cypress**.
- **E2E mobile:** **A. Maestro 2.11** · **B. Detox 20** · **C. Appium**.

## Ocena
**Runner**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Wydajność, ESM, TS (4) | 5 | 3 | 4 |
| Pokrycie z progami (4) | 5 | 4 | 3 |
| Jeden runner (4) | 5 | 4 | 3 |
| Ekosystem (3) | 5 | 5 | 2 |
| **Suma ważona (maks. 75)** | **75** | **59** | **46** |

**E2E web**
| Kryterium (waga) | A | B |
|---|---|---|
| Stabilność (5) | 5 | 4 |
| Przeglądarki (4) | 5 | 3 |
| Integracja z axe (3) | 5 | 4 |
| Windows i CI (3) | 5 | 4 |
| **Suma ważona (maks. 75)** | **75** | **56** |

**E2E mobile**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Scenariusze offline (5) | 4 | 4 | 4 |
| Windows i CI Linux (4) | 5 | 2 | 4 |
| Prostota dla agentów (4) | 5 | 3 | 2 |
| Expo / React Native (4) | 5 | 4 | 3 |
| iOS (3) | 4 | 4 | 4 |
| **Suma ważona (maks. 100)** | **92** | **68** | **68** |

Uwagi: Jest pozostaje w aplikacji mobilnej (preset `jest-expo` jest standardem Expo dla komponentów RN), ale logika `sync-core` testowana jest w Vitest. Playwright obejmuje Chromium, Firefox i WebKit (Safari) w jednym API. Maestro (YAML) działa z emulatorem Androida na Windows i w CI Linux, obsługuje przełączanie trybu samolotowego i zabijanie aplikacji; iOS — na runnerze macOS lub urządzeniu, a test terenowy na fizycznych telefonach pozostaje ręczny. Wersje i licencje zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
| Warstwa / rodzaj | Narzędzia |
|---|---|
| Jednostkowe (backend, web, pakiety, `sync-core`) | **Vitest 5** + pokrycie V8 z progami per katalog (zapadka: progi tylko rosną) |
| Integracyjne backendu | Vitest + **Testcontainers 12** (PostgreSQL 18 — ten sam obraz co prod; SeaweedFS jako S3; ClamAV) + testy HTTP przez moduł testowy NestJS; zegar i strefa kontrolowane (`Europe/Warsaw`) |
| Uprawnienia bazy | testy SQL na rolach `evia_app`/`evia_migrator` (np. brak `UPDATE`/`DELETE` na audycie) w Testcontainers |
| Kontraktowe | walidacja każdej odpowiedzi w testach integracyjnych względem schematów z OpenAPI; test inwentarza tras (kontrakt ↔ handlery); **oasdiff** (zmiany łamiące); **Schemathesis 4** (testy właściwości z kontraktu) na środowisku efemerycznym/staging |
| **Macierz ról (100% endpointów)** | generator w Vitest czyta `x-evia-authz` z kontraktu (ADR-0004) i tworzy test dla każdej operacji × {Administrator, Edytor, Tylko odczyt, niezalogowany} + przypadek **IDOR** (obiekt innego zakresu); test kompletności: liczba operacji w kontrakcie = liczba operacji w macierzy |
| Mutacyjne | **Stryker 10** (runner Vitest) dla modułów domenowych i `sync-core`, nocą |
| Komponentowe web | Vitest + Testing Library + **MSW 3** (mocki API z typów kontraktu) + axe (vitest-axe lub tryb przeglądarkowy Vitest — wybór w EVM-006) |
| E2E web | **Playwright 1.63** (Chromium, Firefox, WebKit) + **@axe-core/playwright**; dane przez API/fabryki, każda ścieżka AC oznaczona `EVM-xxx AC#` |
| Komponentowe mobile | **Jest 30 + jest-expo + React Native Testing Library 14** |
| E2E mobile | **Maestro 2.11** — Android (emulator w CI Linux, lokalnie na Windows), iOS (runner macOS lub urządzenie, przed wydaniem); scenariusze offline (tryb samolotowy → powrót sieci, zabicie aplikacji w trakcie uploadu); test terenowy ręczny wg checklisty |
| Bezpieczeństwo | SAST/SCA/sekrety/IaC wg ADR-0012; **DAST: ZAP baseline wyłącznie na staging** (nigdy na produkcji) |
| Wydajnościowe (smoke) | **k6 2.3** (narzędzie AGPL-3.0, uruchamiane, nie dystrybuowane) — listy, wyszukiwanie, upload dużych plików na staging |
| Dane testowe | **wyłącznie syntetyczne**: fabryki z **@faker-js/faker 10** (lokalizacja `pl`), w tym polskie znaki, kwoty w groszach, daty wokół zmiany czasu; zakaz kopii danych produkcyjnych (także na staging) |
| Pokrycie zmienionego kodu (≥ 90%) | raport V8 (lcov) porównany z diffem względem `main` — narzędzie (np. `diff-cover` lub skrypt) wybiera EVM-006 |

## Konsekwencje
- **Pozytywne:** jeden runner w większości repo; macierz ról generowana automatycznie (nowy endpoint bez polityki lub bez testu = czerwona bramka); testy integracyjne na prawdziwym PostgreSQL; E2E web na trzech silnikach przeglądarek; E2E mobile możliwe bez Maca.
- **Negatywne / koszty:** dwa runnery (Vitest + Jest w mobile); Testcontainers wymaga Dockera lokalnie (Docker Desktop/WSL2 na Windows); E2E iOS w CI kosztuje minuty macOS — uruchamiane tylko przed wydaniem.
- **Ryzyka i mitygacje:**
  - *Niestabilne E2E* → kwarantanna z ID historyjki naprawczej (zasada z `testing-strategy.md`), trace Playwright jako artefakt.
  - *Maestro nie odwzoruje wszystkich zachowań uploadu w tle* → spike EVM-011 i ręczny test terenowy jako bramka wydania M2.
  - *Generator macierzy ról przestanie odpowiadać polityce* → polityki obiektowe testowane również jednostkowo; przegląd security przy zmianie modelu ról.

## Plan wyjścia
Vitest jest zgodny API z Jest — przejście w obie strony jest mechaniczne. Playwright i Maestro mają scenariusze w kodzie/YAML; zamiana na Cypress/Detox wymaga przepisania testów E2E (dni–tygodnie), bez zmian w kodzie produkcyjnym.

## Weryfikacja
- EVM-006: bramka uruchamia wszystkie rodzaje testów jednostkowych/integracyjnych z progami; celowo niepokryty kod → czerwona bramka.
- EVM-008: pierwszy endpoint ma wygenerowaną macierz ról i przechodzi Schemathesis; EVM-009: pierwszy przepływ Maestro na emulatorze Androida w CI.
- Po M1: brak testów w kwarantannie dłużej niż termin naprawy; wynik mutacyjny modułów domenowych ≥ 70%.

## Źródła (zweryfikowane 2026-10-02)
- Vitest 5.0.3 (MIT, 2026-09-30): https://www.npmjs.com/package/vitest ; Jest 30.5.2 (MIT): https://www.npmjs.com/package/jest ; jest-expo 57.0.5 (MIT, monorepo Expo: https://github.com/expo/expo/blob/main/LICENSE): https://www.npmjs.com/package/jest-expo ; React Native Testing Library 14.0.1 (MIT: https://github.com/callstack/react-native-testing-library/blob/main/LICENSE): https://www.npmjs.com/package/@testing-library/react-native
- Testcontainers 12.2.0 (MIT, 2026-09-28): https://www.npmjs.com/package/testcontainers
- Playwright 1.63.0 (Apache-2.0, 2026-09-04): https://www.npmjs.com/package/@playwright/test ; axe-core / @axe-core/playwright 4.13.0 (MPL-2.0): https://www.npmjs.com/package/@axe-core/playwright
- Maestro CLI 2.11.0 (2026-09-29, **Apache-2.0**, licencja zweryfikowana 2026-10-02: https://github.com/mobile-dev-inc/Maestro/blob/main/LICENSE): https://github.com/mobile-dev-inc/Maestro/releases ; Detox 20.51.4: https://www.npmjs.com/package/detox
- Stryker 10.0.0 (Apache-2.0): https://www.npmjs.com/package/@stryker-mutator/core ; MSW 3.0.1 (MIT): https://www.npmjs.com/package/msw
- Schemathesis 4.29.0 (2026-10-01, **MIT**: https://github.com/schemathesis/schemathesis/blob/master/LICENSE): https://github.com/schemathesis/schemathesis/releases ; oasdiff 1.33.0 (**Apache-2.0**: https://github.com/oasdiff/oasdiff/blob/main/LICENSE): https://github.com/oasdiff/oasdiff/releases — licencje zweryfikowane 2026-10-02
- ZAP 2.17.0 (**Apache-2.0**, zweryfikowane 2026-10-02: https://github.com/zaproxy/zaproxy/blob/main/LICENSE): https://github.com/zaproxy/zaproxy/releases ; k6 2.3.0 (AGPL-3.0, zweryfikowane 2026-10-02: https://github.com/grafana/k6/blob/master/LICENSE.md — narzędzie uruchamiane w CI, niemodyfikowane i niedystrybuowane, więc AGPL nie obejmuje naszego kodu): https://github.com/grafana/k6/releases
- @faker-js/faker 10.6.0 (MIT): https://www.npmjs.com/package/@faker-js/faker
