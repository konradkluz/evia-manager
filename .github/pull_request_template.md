<!-- Tytuł PR = pierwsza linia commita squash na main (K2): Conventional Commit z ID, np.
     „ci: add monorepo, quality gates and CI pipeline [EVM-006]”; Renovate: „chore(deps): … [renovate]”;
     zamknięcie kamienia milowego: „docs(milestone): close M0 [M0]”. -->

## Historyjka
- ID i plik: EVM-___ — `docs/backlog/M_/EVM-___-….md`
- Co i po co (2–3 zdania):

## Checklista przed „Squash and merge” (Konrad — `docs/ops/github-i-ci.md`)
- [ ] Tytuł PR to Conventional Commit z `[EVM-###]`, `[renovate]` albo `[M#]` (stanie się komunikatem commita na `main`).
- [ ] Ruleset na `main` aktywny (`docs/ops/github-i-ci.md` „Ruleset na main”); scalenie dopiero po zielonym `ci-gate` dla **ostatniego** commita gałęzi (HEAD).
- [ ] Bramka lokalna zielona (`pnpm run gate`) — wynik w raporcie historyjki.
- [ ] Demo zaakceptowane; status historyjki `in-review` → po scaleniu `done`.
- [ ] Pliki wrażliwe (lista w podsumowaniu joba `security` i w `.github/CODEOWNERS`): `.github/**`, `.claude/**`, `compose*.yaml`, `lefthook.yml`, `infra/**`, `tools/staging-verify/**`, pliki wyjątków skanerów, `renovate.json`, `pnpm-workspace.yaml` — przejrzane świadomie (nie zmieniono / zmiany rozumiem i akceptuję).

## Dowody
- Bramka lokalna / skany (`pnpm run gate`, `pnpm run scan`):
- Raport QA (`docs/qa/EVM-___/`), jeśli jest:
