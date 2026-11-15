# EVM-121 — dowód: `staging-verify` w jedynym rygorze (`strict`) na `main`

Data: 2026-11-15. Historyjka: [EVM-121](../../backlog/M1/EVM-121-warunki-wejscia-produkcji-caa-dmarc-i-profil-weryfikacji.md). Dowód AC2 i odwołanie z RR-40 oraz RR-41 (AC4). Źródła: przebieg CI i publiczny DNS — bez logowania do środowiska, bez sekretów i adresów e-mail.

## Przebieg CI po scaleniu

- Scalenie: PR #143, commit `6f88399a` na `main` (2026-11-15).
- Przebieg: [ci 43705110832](https://github.com/konradkluz/evia-manager/actions/runs/43705110832) — `ci-gate`, `publish` i `publish-infra` zielone.
- Job [`staging-verify`](https://github.com/konradkluz/evia-manager/actions/runs/43705110832/job/132788917535): zielony; job nie ustawia `VERIFY_PROFILE` (zmienna usunięta z `.github/workflows/ci.yml`).

Krok „Ports, TLS, headers and DNS” (`node tools/staging-verify/cli.mjs checks`) — wynik z logu kroku, bez ostrzeżeń:

| Kontrola | Wynik | Szczegóły |
|---|---|---|
| `ports` | OK | tylko 80 i 443 otwarte |
| `tls` | OK | TLSv1.3, Let's Encrypt, ważny |
| `headers` | OK | nagłówki bezpieczeństwa i przekierowanie na HTTPS |
| `dns` | OK | A, AAAA, CAA, SPF, DMARC |

Kroki „Wait for /version”, „Anonymous ZAP baseline (bramka 10)” i „Result (summary and staging-verified)” tego samego joba — zielone.

## Publiczny DNS (2026-11-15, zapytania do publicznego resolvera)

| Nazwa | Rekord | Stan |
|---|---|---|
| `panel.eviacharge.pl` | CAA | dokładnie jedno `0 issue "letsencrypt.org"`; `issuewild` brak (dozwolone — RFC 8659) |
| `panel.eviacharge.pl` | A, AAAA | obecne |
| `panel.eviacharge.pl` | TXT (SPF) | `v=spf1` z `-all` |
| `_dmarc.panel.eviacharge.pl` | TXT (DMARC) | `p=reject`, `sp=reject`, `rua` obecne (adres pominięty) |

## Przypadki negatywne (offline)

Testy `EVM-121 AC1`, `EVM-121 AC2` i `EVM-121 AC2, AC3` w `tools/staging-verify/test/staging-verify.test.mjs`: brak `issue`, drugi `issue`, `issue` innego CA, `issuewild` inne niż `;`, więcej niż jeden `issuewild`, DMARC bez `rua` oraz każda ustawiona `VERIFY_PROFILE` kończą kontrolę `dns` czerwono.
