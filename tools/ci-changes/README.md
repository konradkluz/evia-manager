# Wykrywanie zmian dla CI — `tools/ci-changes/`

EVM-083, EVM-086 (ADR-0018, ograniczenie minut GitHub Actions). Job `changes` w `.github/workflows/ci.yml` uruchamia `node tools/ci-changes/cli.mjs` (bez instalacji zależności, tylko `node:*` i `git`) i zapisuje do `$GITHUB_OUTPUT` trzy wyjścia, każde `true` albo `false`:

| Wyjście | Job | `false` (job pominięty) wyłącznie, gdy… |
|---|---|---|
| `heavy` | `coverage` | wszystkie zmienione pliki to dokumentacja |
| `e2e` | `e2e-web` | wszystkie zmienione pliki są „nie dotyczy” E2E panelu |
| `integration` | `backend-integration` | wszystkie zmienione pliki są „nie dotyczy” testów integracyjnych API |

EVM-007 dodaje dwa wyjścia (funkcja `detectDeployment`):

| Wyjście | Krok / job | `true`, gdy… |
|---|---|---|
| `iac` | krok `iac-check` joba `security` | `pull_request` zmienia `infra/tofu/`, `infra/docker/iac/`, `.github/`, `compose.yaml` albo `compose.iac.yaml`; zawsze dla `push` na `main` i innych zdarzeń; fail-closed jak niżej |
| `publish` | job `publish` (obrazy wydania, AC2) | `push` na `main` zmienia `apps/`, `packages/`, `infra/`, `pnpm-lock.yaml` albo inne wejście budowy obrazów (`pnpm-workspace.yaml`, `package.json`, `.nvmrc`, `turbo.json`, `patches/`, `design/tokens/`); sama dokumentacja — `false`; inne zdarzenia — zawsze `false`; dla `push` błąd, brak bazy lub pusta lista zmian — `true` |

Dane: `git diff --name-only <baza> HEAD` (bez wykrywania zmian nazw: przeniesienie kodu do `docs/` nie jest dokumentacją).

## Jawne listy „nie dotyczy” (`lib/classify.mjs`)
- Dokumentacja (dla obu jobów i `coverage`): ścieżki w `docs/` oraz pliki `*.md` w katalogu głównym.
- `e2e-web`: dokumentacja, `apps/api/`, `apps/mobile/` (`E2E_NOT_RELEVANT_PREFIXES`).
- `backend-integration`: dokumentacja, `apps/web/`, `apps/mobile/` (`INTEGRATION_NOT_RELEVANT_PREFIXES`).
- Lista „nie dotyczy”, nie „dotyczy”: nowa lub nieznana ścieżka uruchamia testy. **Nigdy „nie dotyczy”** (nie ma ich na żadnej liście): `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`, `tools/**`, `compose*.yaml`, konfiguracja główna, `.claude/**`. Zmiana list wymaga przeglądu `security-engineer`; test `tools/repo-policy` pilnuje, by te ścieżki nie trafiły na listy.
- Zmiana mieszana: job jest pominięty tylko, gdy KAŻDY plik jest „nie dotyczy” tego joba (np. `apps/api` + `docs` pomija E2E, ale nie integrację; `apps/web` + plik spoza list uruchamia oba).

## Fail-closed (wszystkie trzy wyjścia `true`)
Zdarzenie inne niż `pull_request` (w tym każdy `push` — to push na `main` — `workflow_dispatch`, przebieg nocny), brak lub niepoprawny SHA bazy (np. `0000…` przy pierwszym pushu), błąd `git diff`, pusta lista zmian. Ścieżka z `..`, `\`, znakiem sterującym, bezwzględna lub pusta nigdy nie jest „nie dotyczy”. `ci-gate` jest czerwony, gdy wyjście jest brakujące lub inne niż `true`/`false`, gdy `heavy=false` przy `e2e` lub `integration` równym `true`, albo gdy job jest pominięty bez swojego jawnego „nie dotyczy” — `docs/ops/github-i-ci.md` → „Minuty Actions i koszty”.

- Baza: `pull_request.base.sha` albo `event.before` (push na `main`).
- Testy: `pnpm --filter @evia/ci-changes run test:coverage` (znakowane `EVM-083 AC#`, `EVM-086 AC#`); program `jq` bramki: `tools/repo-policy`.
