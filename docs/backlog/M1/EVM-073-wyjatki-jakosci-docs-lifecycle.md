---
id: EVM-073
title: Zniesienie wyjątków jakości w tools/docs-lifecycle
type: enabler
milestone: M1
epic: E00 Fundamenty
status: draft
priority: P3
owner: devops-engineer
contributors: []
reviewers: [code-reviewer]
depends_on: [EVM-013]
---

# EVM-073: Zniesienie wyjątków jakości w `tools/docs-lifecycle`

## Historyjka
Jako **Konrad (właściciel produktu)** chcę, **aby walidator dokumentacji (`tools/docs-lifecycle`) spełniał te same wspólne reguły ESLint i TypeScript co reszta monorepo, bez listy wyjątków**, aby **bramki jakości były jednolite, a wyjątki nie ukrywały błędów w narzędziu, które blokuje scalanie (bramka 11)**.

**Rezultat (enabler):** po zmianie:
- `tools/docs-lifecycle` nie łagodzi wspólnych reguł: `noUncheckedIndexedAccess` jest włączone, a 9 wyłączonych reguł ESLint działa;
- lista workspace'ów z wyjątkami w `tools/repo-policy` jest pusta;
- zachowanie walidatora się nie zmienia.

## Kontekst
- **Pochodzenie.** Dług z EVM-012 przejął EVM-006 (wyjątek W2) i przekazał do EVM-013. Konrad wydzielił zniesienie wyjątków do tej historyjki 2026-10-05 ([EVM-013](../M0/EVM-013-walidator-dokumentacji-w-ci.md) → „Decyzje” 1). Vitest zamiast `node:test` i `.ts` zamiast `.mjs` są zamknięte jako „nie robimy” (EVM-013 → „Notatki techniczne” → „Stan długu z EVM-012 po EVM-006”).
- **Po EVM-013** komentarze w konfiguracji, nazwa testu listy wyjątków oraz `packages/config/README.md` i `tools/repo-policy/README.md` wskazują tę historyjkę (EVM-013 AC8).
- **Warunek startu: Node 26 lokalnie albo w środowisku chmury** (EVM-013 → „Decyzje” 4). Lint i sprawdzanie typów wymagają `pnpm install`, a `engineStrict` wymaga Node 26. Bez tego każda iteracja to push i przebieg CI (ok. 6 rozliczanych minut).
- **Dlaczego P3.** Wyjątki nie wpływają na kryteria wyjścia M1. Narzędzie ma 100% pokrycia testami, więc ryzyko jest niskie: błąd indeksowania albo nieuzasadnione założenie o typach, które wychwyciłyby wspólne reguły. Realizacja w fazie 7 planu M1 albo wcześniej decyzją Konrada ([`README.md`](README.md) → „Kolejność i fazy”).

## Kryteria akceptacji
_Szkic — do uzupełnienia w `/refine EVM-073` (po EVM-013 i po pomiarowym przebiegu CI — „Notatki techniczne”)._

**AC1 — Wspólne reguły TypeScript**
- Zakładając, że `tools/docs-lifecycle/tsconfig.json` nie nadpisuje `noUncheckedIndexedAccess` (obowiązuje wartość z `@evia/config/tsconfig.base.json`),
- Gdy CI sprawdza typy,
- Wtedy kod i testy `tools/docs-lifecycle` przechodzą bez błędów i bez komentarzy wyłączających sprawdzanie (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`).

**AC2 — Wspólne reguły ESLint**
- Zakładając, że `tools/docs-lifecycle/eslint.config.js` nie wyłącza żadnej reguły ze wspólnej konfiguracji,
- Gdy CI uruchamia lint,
- Wtedy workspace przechodzi bez błędów i bez komentarzy `eslint-disable`.

**AC3 — Brak wyjątków w polityce repozytorium**
- Zakładając, że lista workspace'ów, które mogą łagodzić wspólne reguły (`tools/repo-policy`), jest pusta,
- Gdy dowolny workspace wyłącza regułę ESLint albo opcję TypeScript ze wspólnej konfiguracji,
- Wtedy test niezmienników kończy się błędem wskazującym workspace; `packages/config/README.md` i `tools/repo-policy/README.md` nie wymieniają wyjątków.

**AC4 — Zachowanie walidatora bez zmian**
- Zakładając dotychczasowe testy walidatora i wynik `npm run docs:check` na HEAD gałęzi przed poprawkami,
- Gdy poprawki typów i lintu są wprowadzone,
- Wtedy:
  - wszystkie testy przechodzą bez zmiany oczekiwań, a `npm run docs:check` daje ten sam wynik;
  - pokrycie linii i gałęzi `tools/docs-lifecycle` nie spada (dziś 100%), a poprawki nie dodają gałęzi nieosiągalnych;
  - `npm run test:tools` przechodzi na Node 22 (narzędzie nadal działa na Node ≥ 22.15 bez instalacji zależności).

## Poza zakresem
- Vitest zamiast `node:test` i `.ts` zamiast `.mjs` — „nie robimy” (EVM-013 → „Decyzje” 1).
- Zmiany zachowania walidatora i reguł polityki cyklu życia dokumentów.
- Złagodzenie wspólnej konfiguracji `@evia/config` dla całego monorepo. Jeśli któraś reguła okaże się niewykonalna w narzędziu `.mjs`, wykonawca się zatrzymuje i pyta Konrada.
- Node 26 w środowisku Claude Code web — osobny krok (EVM-013 → „Decyzje” 4).
- Poprawki L5 i obserwacje z EVM-012 (`spikes/`, test sąsiedztwa kroków) — kandydaci do backlogu w EVM-013 → „Uwagi do rozważenia”.

## UX / UI
Nie dotyczy — zmiana narzędzia deweloperskiego bez interfejsu.

## Bezpieczeństwo i prywatność
Nie dotyczy ról aplikacji (Administrator / Edytor / Tylko odczyt / niezalogowany) ani danych klientów — zmiana typów i lintu narzędzia deweloperskiego bez zmiany zachowania. Bramka 11 (SR-SUPPLY-11) działa bez przerwy (AC4). W testach wyłącznie dane syntetyczne (SR-PRIV-08). `tools/docs-lifecycle/` nie jest na listach K3 ani K6. Do potwierdzenia przy `/refine`, czy potrzebny jest przegląd `security-engineer`. Rekomendacja: nie, bo zachowanie się nie zmienia.

## Notatki techniczne
Zakres z EVM-013 („Decyzje” 1, „Notatki techniczne” — pomiar `solution-architect` z 2026-10-05; numery linii według stanu z tego dnia):
- **TypeScript:** `noUncheckedIndexedAccess: false` w `tools/docs-lifecycle/tsconfig.json:4-8`. Po włączeniu jest 47 błędów: 16 w `lib/` i 31 w testach.
- **ESLint:** 9 reguł wyłączonych w `tools/docs-lifecycle/eslint.config.js:10-19`:
  - `@typescript-eslint/no-unsafe-member-access`, `no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-call`;
  - `no-unnecessary-type-conversion`, `no-unnecessary-condition`, `no-confusing-void-expression`, `no-dynamic-delete`;
  - `no-irregular-whitespace` (polskie spacje niełamiące w fiksturach).
- **Lista wyjątków:** `RELAXED` w `tools/repo-policy/test/structure.test.ts:25-26`, sprawdzana przez test w tym samym pliku.
- **Wzmianki do aktualizacji:** `packages/config/README.md:16`, `tools/repo-policy/README.md:15`.
- **Warunek:** Node 26 lokalnie albo w środowisku chmury. W chmurze na Node 22 działają tylko `npm run test:tools` i `npm run docs:check`, a lint, typy i Vitest (`tools/repo-policy`) — dopiero w CI.
- **Naprawy bez martwych gałęzi.** Bez sztucznych sprawdzeń, które tylko uspokajają typy i obniżają pokrycie gałęzi (próg ≥ 90%, dziś 100%). Typy w JSDoc — narzędzie musi działać na Node ≥ 22.15 bez instalacji zależności (`docs/process/document-lifecycle.md` → „Walidator i raport sprzątania”).
- **Pierwszy krok — pomiarowy przebieg CI:** gałąź z samym usunięciem wyjątków, bez poprawek, daje dokładną listę błędów na Node 26 i bieżących wersjach TypeScript i ESLint. Liczby mogą się różnić od pomiaru z 2026-10-05, bo EVM-013 zmienia kod narzędzia. Wynik pomiaru trafia do „Plan techniczny” i jest wejściem do `/refine EVM-073`.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-10-05 (Konrad, refinement EVM-013 → „Decyzje” 1): zniesienie wyjątków ESLint i TypeScript w `tools/docs-lifecycle` wydzielone z EVM-013 do tej historyjki; Vitest zamiast `node:test` i `.ts` zamiast `.mjs` — „nie robimy”.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-073 AC#`).
- [ ] `npm run test:tools` i `npm run docs:check` (0 błędów) natywnie; lint, typy, testy `tools/repo-policy` i `pnpm run gate` — lokalnie z Node 26 albo przez zielony `ci-gate` na HEAD gałęzi (raport QA zaznacza, które bramki sprawdzono tylko w CI).
- [ ] Przegląd `code-reviewer` — APPROVE.
- [ ] Dokumentacja (`packages/config/README.md`, `tools/repo-policy/README.md`, `tools/docs-lifecycle/README.md`) i `CHANGELOG.md` zaktualizowane.
- [ ] Demo i akceptacja Konrada.

## Dziennik
- 2026-10-05 — utworzono jako szkic z refinementu EVM-013 („Decyzje” 1) (product-owner)
- 2026-10-05 — **wstrzymano decyzją Konrada** (EVM-075: priorytet to kod produktu); status zostaje `draft`, wznowienie tylko jego decyzją
