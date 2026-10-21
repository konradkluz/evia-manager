# Retencja GHCR — `tools/ghcr-retention/`

EVM-007 AC2 (ADR-0018 „Publikacja hermetyczna”, n2). Krok joba `publish` w `.github/workflows/ci.yml` (jedyny job z `packages: write`; do odczytu przebiegów i artefaktów `actions: read`). Działa bez instalacji zależności (tylko `node:*`).

- Dotyczy **wyłącznie** pakietów `evia-api` i `evia-web` (nigdy obrazu weryfikatora ani innych pakietów).
- **Chronione:** digesty z `release-manifest` ostatnich 30 przebiegów `push` workflowu `ci.yml` na `main` — gałąź mogłaby wypchnąć 20 „śmieciowych” wersji i wyprzeć digest zweryfikowany na stagingu (rollback, zatwierdzenie prod). Poza tym zostaje 20 najnowszych wersji każdego pakietu.
- **Fail-closed:** gdy nie da się odczytać manifestu któregokolwiek z tych przebiegów (brak, wygasły albo nieczytelny artefakt, błąd API), nic nie jest usuwane, a krok tylko to raportuje (nie czerwieni wydania).
- **Tryb próbny (`GHCR_RETENTION_MODE=dry-run`)** — domyślny i jedyny w `ci.yml` (test `tools/repo-policy`): wypisuje tylko liczby. Usuwanie (`delete`) włączamy dopiero, gdy w sesji IaC potwierdzimy, że `GITHUB_TOKEN` z `packages: write` może usuwać wersje bez PAT (żadnych nowych sekretów, AC7). Koszt: według dokumentacji GitHuba przechowywanie i transfer w Container registry są obecnie bezpłatne (z co najmniej miesięcznym uprzedzeniem o zmianie) — ryzyko w tabeli kosztów EVM-007.
- Testy (atrapa API, dane syntetyczne): `pnpm --filter @evia/ghcr-retention run test:coverage` (próg 90%, znakowane `EVM-007 AC2`).
