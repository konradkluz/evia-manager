# `staging-verify` — bramka 10 na stagingu (`tools/staging-verify/`)

EVM-007 AC6 (ADR-0018 „Staging”; decyzja Konrada 2026-10-13 o bramkach 7–8: w CI wyłącznie anonimowy ZAP baseline). Job `staging-verify` w `.github/workflows/ci.yml` uruchamia się po udanym `publish`, gdy zmienna repozytorium `STAGING_VERIFY_ENABLED` = `true` (ustawiana w sesji IaC, gdy staging istnieje; pominięcie nie jest „zielone” — `publish` wypisuje ostrzeżenie, a akceptacja wydania wymaga `true`). Bez sekretów, `contents: read` (checkout prywatnego repozytorium), ≤ 15 min. Działa bez instalacji zależności (tylko `node:*`).

| Krok | Polecenie | Kontrola |
|---|---|---|
| 1 | `node tools/staging-verify/cli.mjs wait` | `GET https://staging.eviacharge.pl/version` zwraca commit przebiegu i `manifestSha256` z wyjścia `publish` (definicja: `services/deploy-agent/README.md`); niezgodność po 8 min = czerwony |
| 2 | `node tools/staging-verify/cli.mjs checks` | porty: tylko 80 i 443 (połączenia TCP na stałą listę, m.in. 22, 2019, 5432 — bez nowego narzędzia); TLS 1.2+ (TLS 1.1 odrzucony), wystawca Let's Encrypt, ważność ≥ 7 dni, SAN; nagłówki panelu i HSTS, `Server` bez wersji, `http://` → 301/308 na `https://`; DNS: A, AAAA, CAA (`issue "letsencrypt.org"`, `issuewild ";"`), SPF, `_dmarc` z `rua`; anonimowy `GET` obiektu bucketu = `403` — **pominięta do EVM-084** (pokazana jako pominięta, nigdy jako OK) |
| 3 | `docker compose -f compose.yaml run --rm zap-baseline` | anonimowy ZAP baseline (obraz po digeście), raport `.scratch/scans/zap-staging.json` |
| 4 | `node tools/staging-verify/cli.mjs report` | ustalenia ZAP High/Medium spoza wyjątków `infra/zap/rules.tsv` (`<pluginId>\t<YYYY-MM-DD>\t<powód>`; wygasły wyjątek = czerwony); podsumowanie przebiegu i artefakt `staging-verified` |

Skany z logowaniem (ZAP po zalogowaniu, ZAP API, Schemathesis na kontach ról) — poza GitHubem, z VM albo z sesji Konrada (zero sekretów w GitHubie).

- Testy offline (atrapy serwerów i resolvera, dane syntetyczne): `pnpm --filter @evia/staging-verify run test:coverage` (próg 90%, znakowane `EVM-007 AC6`).
- Przebieg na żywym stagingu — w sesji IaC (runbook `docs/ops/runbooks/wdrozenie-staging.md`).
