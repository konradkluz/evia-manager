# Skany bezpieczeństwa i samotest (`tools/scan/`)

EVM-006 (bramki 1–5, 5a i 12; SR-SUPPLY-07, SR-SUPPLY-10). Jedno wejście dla `pnpm run scan`, jobów CI i hooków git. Działa **bez instalacji zależności** (tylko `node:*`); Docker wyłącznie przez `docker compose -f compose.yaml run --rm <usługa>` (`lib/compose.mjs` — jedyne miejsce w `tools/`, które uruchamia Dockera).

| Polecenie | Gdzie | Co |
|---|---|---|
| `pnpm run scan` (= `node tools/scan/cli.mjs all`) | lokalnie | wszystkie skany + licencje + samotest; licencje wymagają wcześniejszego `backend-install` |
| `node tools/scan/cli.mjs security` | CI: job `security`, `nightly.yml` | gitleaks (pełna historia), Semgrep CE, testy reguł `.semgrep/`, OSV-Scanner, Trivy `config`, zizmor, actionlint, `renovate-config-validator --strict` + samotest |
| `node tools/scan/cli.mjs licenses` | CI: job `backend` | Trivy `--scanners license` na linuksowych `node_modules` z wolumenu `bt-work` |
| `node tools/scan/cli.mjs selftest` | lokalnie | tylko samotest |
| `node tools/scan/cli.mjs hook pre-commit` / `hook pre-push` | `lefthook.yml` | gitleaks na indeksie / na każdym wypychanym zakresie (nowa gałąź: `origin/main..<commit>`) |

## Zasady
- **O wyniku decyduje raport, nie kod wyjścia narzędzia** (`lib/reports.mjs`): błąd narzędzia, brak raportu albo pusty cel skanu (0 commitów, 0 plików, 0 pakietów, brak Dockerfile, brak workflowów) = czerwony etap.
- Progi: gitleaks — każde wykrycie; Semgrep — `ERROR` z rejestru i każda reguła własna `evm-…`; OSV — Critical/High z dostępną poprawką i każdy `MAL-…`, bez CVSS i ważności przy dostępnej poprawce = High (`lib/osv.mjs`); Trivy `config` — HIGH/CRITICAL; licencje — spoza listy dozwolonych (`ALLOWED_LICENSES`, z OFL-1.1) albo **nieznana**: pakiet pnpm bez licencji (Trivy nie zgłasza dla niego żadnej licencji, więc werdykt czyta listę pakietów; 0 pakietów = pusty cel skanu). Wyjątki licencji tylko w `.trivyignore.yaml` → `licenses` (po nazwie licencji, z `expired_at`); Trivy nie wiąże wyjątku z pakietem, więc licencja nieznana nie ma wyjątku — taka zależność wymaga historyjki; zizmor — każde ustalenie od `low`; actionlint — każdy błąd.
- **Samotest** (`lib/selftest.mjs`): fikstury generowane w `.scratch/scans/selftest/` (syntetyczny sekret sklejany z fragmentów, lockfile z `lodash@4.17.20`, Dockerfile bez `USER`, zależność GPL-3.0, zależność bez licencji, workflow z `pull_request_target` i wstrzyknięciem). Etap przechodzi tylko, gdy bramka jest czerwona **i** raport zawiera oczekiwany identyfikator (`github-pat`, `GHSA-35jh-r3h4-6jhm`, `DS-0002`, `GPL-3.0`, `selftest-unlicensed-fixture`, `dangerous-triggers` + `template-injection`) — wykrywa ciche wyłączenie bramki, np. po zmianie flag w nowej wersji narzędzia z PR Renovate.
- gitleaks zawsze z `--redact` i jawną konfiguracją repozytorium (`.gitleaks.toml`, `.gitleaksignore`). Wyniki wypisywane w jednej linii bez znaków sterujących.
- Raporty w `.scratch/scans/` (ignorowane przez git); `.scratch/` nigdy nie jest celem zwykłych skanów (W7).
