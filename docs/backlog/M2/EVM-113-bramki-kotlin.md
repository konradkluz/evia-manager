---
id: EVM-113
title: "Bramki Kotlin: ktlint, JUnit, pokrycie dla modułu uploadu"
type: enabler
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
priority: P1
path: pelna             # zmiana bramek jakości i polityki pokrycia
owner: devops-engineer
contributors: [mobile-developer]
reviewers: [qa-engineer, solution-architect]
model: sonnet
depends_on: [EVM-009]
---

# EVM-113: Bramki Kotlin — ktlint, JUnit, pokrycie dla modułu uploadu

## Cel
Jako **zespół** chcemy, aby **kod Kotlin (moduł uploadu w tle, ADR-0020) miał te same bramki jakości co TypeScript**, aby **EVM-109 powstawał w TDD z wymuszonym progiem pokrycia 95%**. Dziś ADR-0014 i `testing-strategy.md` nie mówią, jak testować i mierzyć Kotlin, a `coverage-thresholds.json` nie ma warstwy 95% (wymieniona w `testing-strategy.md`: „Mobile — synchronizacja i kolejka uploadu ≥ 95%”). Wymagane przed **każdą** historyjką z kodem Kotlin (EVM-011 → „Przed M2”).

## Kryteria akceptacji

**AC1 — Format i lint Kotlin**
- Zakładając kod Kotlin w module natywnym
- Gdy uruchamiam `pnpm run gate` lub CI
- Wtedy ktlint (format i lint) sprawdza Kotlin, a naruszenie daje kod wyjścia ≠ 0.

**AC2 — Testy jednostkowe na JVM**
- Zakładając czystą logikę `UploadEngine` za abstrakcjami HTTP i plików
- Gdy uruchamiam testy
- Wtedy JUnit 5 na JVM (bez emulatora) wykonuje testy oznaczone `EVM-xxx AC#`, lokalnie natywnie i w CI.

**AC3 — Pokrycie i próg 95%**
- Zakładając raport Kover
- Gdy bramka pokrycia go czyta
- Wtedy raport w formacie lcov trafia do `coverage:diff`, a próg linii i gałęzi 95% dotyczy czystej logiki (`UploadEngine`); klej Androida (`JobService`, moduł Expo) jest wykluczony z uzasadnieniem w `coverage-exclusions.json` i pokryty Maestro; obniżenie progu lub wyłączenie testu nie przechodzi bramki.

**AC4 — Wektory zgodności**
- Zakładając wektory JSON protokołu uploadu w `packages/sync-core/conformance/upload/`
- Gdy testy Kotlin je czytają
- Wtedy ten sam zestaw wektorów jest źródłem prawdy dla Kotlin i TypeScript, a zmiana wektora unieważnia cache zadań (`inputs` Turborepo).

**AC5 — Polityka i dokumentacja**
- Zakładając zmiany bramek
- Gdy je scalam
- Wtedy ADR-0014 ma notę „częściowo zmieniona przez ADR-0020” z opisem narzędzi Kotlin, `testing-strategy.md` ma wiersz progu dla modułu Kotlin, `coverage-thresholds.json` ma warstwę 95% dla `sync-core` i logiki uploadu (jeśli nie dodała jej wcześniej EVM-091), a testy `tools/repo-policy` oraz `npm run docs:check` przechodzą.

## Poza zakresem
Implementacja modułu uploadu (EVM-109); mutacyjne testowanie Kotlin; iOS.

## Decyzje i ograniczenia
- Owner: `devops-engineer` (bramki, CI, polityka pokrycia — `workflow.md`), `mobile-developer` jako współwykonawca (struktura modułu Kotlin pod testy).
- **Kolejność:** EVM-113 przed EVM-109; nie blokuje faz 1–3. Jeśli security utrzyma wymaganie czasu monotonicznego (EVM-092) lub podpisu urządzenia (backlog po EVM-109) w Kotlin, enabler wchodzi do fazy 1 — dziś tor C jest bez Kotlin.
- Nowe narzędzia (ktlint, Kover) — z uzasadnieniem licencji i utrzymania, dokładne wersje (SR-SUPPLY-06).
- Konflikt plików z torem B: `coverage-thresholds.json` i `tools/repo-policy` — zmiany w osobnych sekcjach, kolejność scalania wg README planu.

## Dziennik
- 2026-10-27 — utworzono (product-owner) po konsultacji architekta
