# Wykrywanie zmian dla CI — `tools/ci-changes/`

EVM-083, EVM-086 (ADR-0018, ograniczenie minut GitHub Actions). Job `changes` w `.github/workflows/ci.yml` uruchamia `node tools/ci-changes/cli.mjs` (bez instalacji zależności, tylko `node:*` i `git`) i zapisuje do `$GITHUB_OUTPUT` cztery wyjścia, każde `true` albo `false`:

| Wyjście       | Job                   | `false` (job pominięty) wyłącznie, gdy…                              |
| ------------- | --------------------- | -------------------------------------------------------------------- |
| `heavy`       | `coverage`            | wszystkie zmienione pliki to dokumentacja                            |
| `e2e`         | `e2e-web`             | wszystkie zmienione pliki są „nie dotyczy” E2E panelu                |
| `integration` | `backend-integration` | wszystkie zmienione pliki są „nie dotyczy” testów integracyjnych API |
| `mobile` | `mobile-apk` | żaden zmieniony plik nie jest na liście „dotyczy” (poniżej) — **lista pozytywna**, bo budowa Androida jest wolna (EVM-009) |

Dane: `git diff --name-only <baza> HEAD` (bez wykrywania zmian nazw: przeniesienie kodu do `docs/` nie jest dokumentacją).

## Jawne listy „nie dotyczy” (`lib/classify.mjs`)

- Dokumentacja (dla obu jobów i `coverage`): ścieżki w `docs/` oraz pliki `*.md` w katalogu głównym.
- `e2e-web`: dokumentacja, `apps/api/`, `apps/mobile/` (`E2E_NOT_RELEVANT_PREFIXES`).
- `backend-integration`: dokumentacja, `apps/web/`, `apps/mobile/` (`INTEGRATION_NOT_RELEVANT_PREFIXES`).
- Lista „nie dotyczy”, nie „dotyczy”: nowa lub nieznana ścieżka uruchamia testy. **Nigdy „nie dotyczy”** (nie ma ich na żadnej liście): `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`, `tools/**`, `compose*.yaml`, konfiguracja główna, `.claude/**`. Zmiana list wymaga przeglądu `security-engineer`; test `tools/repo-policy` pilnuje, by te ścieżki nie trafiły na listy.
- Zmiana mieszana: job jest pominięty tylko, gdy KAŻDY plik jest „nie dotyczy” tego joba (np. `apps/api` + `docs` pomija E2E, ale nie integrację; `apps/web` + plik spoza list uruchamia oba).

## Lista „dotyczy” dla `mobile` (EVM-009; `MOBILE_RELEVANT_*` w `lib/classify.mjs`)
`apps/mobile/`, `packages/tokens/`, `packages/contracts/`, `design/tokens/`, `tools/mobile-apk/`, `patches/` oraz pliki `.nvmrc` (wersja Node w jobie), `.npmrc`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.github/workflows/ci.yml`. Inaczej niż w listach „nie dotyczy”, nieznana ścieżka **nie** uruchamia budowy; podejrzana ścieżka (z `..`, backslashem, znakiem sterującym, bezwzględna, pusta), błąd `git diff` i każde zdarzenie inne niż `pull_request` — tak. Zmiana wyłącznie dokumentacji nigdy nie buduje paczki (`heavy=false` ⇒ `mobile=false`).

## Fail-closed (wszystkie cztery wyjścia `true`)

Zdarzenie inne niż `pull_request` (w tym każdy `push` — to push na `main` — `workflow_dispatch`, przebieg nocny), brak lub niepoprawny SHA bazy (np. `0000…` przy pierwszym pushu), błąd `git diff`, pusta lista zmian. Ścieżka z `..`, `\`, znakiem sterującym, bezwzględna lub pusta nigdy nie jest „nie dotyczy”. `ci-gate` jest czerwony, gdy wyjście jest brakujące lub inne niż `true`/`false`, gdy `heavy=false` przy `e2e` lub `integration` równym `true`, albo gdy job jest pominięty bez swojego jawnego „nie dotyczy” — `docs/ops/github-i-ci.md` → „Minuty Actions i koszty”.

- Baza: `pull_request.base.sha` albo `event.before` (push na `main`).
- Testy: `pnpm --filter @evia/ci-changes run test:coverage` (znakowane `EVM-083 AC#`, `EVM-086 AC#`); program `jq` bramki: `tools/repo-policy`.
