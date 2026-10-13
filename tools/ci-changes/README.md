# Wykrywanie zmian dla CI — `tools/ci-changes/`

EVM-083 (ADR-0018, ograniczenie minut GitHub Actions). Job `changes` w `.github/workflows/ci.yml` uruchamia `node tools/ci-changes/cli.mjs` (bez instalacji zależności, tylko `node:*` i `git`) i zapisuje `heavy=true|false` do `$GITHUB_OUTPUT`.

- `heavy=false` **wyłącznie**, gdy wszystkie pliki z `git diff --name-only <baza> HEAD` to dokumentacja: ścieżki w `docs/` albo pliki `*.md` w katalogu głównym. Wtedy `e2e-web`, `backend-integration` i `coverage` są pomijane; `quality` (z walidatorem dokumentacji), `backend` i `security` działają zawsze.
- **Fail-closed** (`heavy=true`): zdarzenie inne niż `pull_request`, każdy `push` (to push na `main`: zawsze pełny zestaw), brak poprawnego SHA bazy (np. `0000…` przy pierwszym pushu), błąd `git diff`, pusta lista zmian.
- Baza: `pull_request.base.sha` albo `event.before` (push na `main`).
- `ci-gate` akceptuje pominięcie trzech ciężkich jobów tylko przy `heavy=false` — `docs/ops/github-i-ci.md` → „Minuty Actions i koszty”.
- Testy: `pnpm --filter @evia/ci-changes run test:coverage` (znakowane `EVM-083 AC#`).
