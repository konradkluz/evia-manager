# EVM-084 — posiedzenie A sesji IaC (staging, 2026-11-13)

Środowisko: staging (VM Hetzner CAX11 `evia-staging`, Scaleway `pl-waw` projekt `evia-staging`). Historyjka: [EVM-084](../../backlog/M0/EVM-084-backupy-i-test-odtworzenia-staging.md) (oraz EVM-085 — obserwowalność). Wykonawcy: Konrad (konsole, sekrety, scalenia), Tech Lead i `devops-engineer` (OpenTofu, VM przez SSH), `security-engineer` (przeglądy). Dowody bez sekretów i bez identyfikatorów kluczy.

**Wynik: posiedzenie A zamknięte, z jednym krokiem odłożonym (A10 → EVM-124).** Kanał wdrożeń wdraża znów wydania z `main` (pierwsze od 2026-10-27).

| Krok | Wynik | Dowód / uwagi |
|---|---|---|
| A0 ruleset na `main` | PASS | `gh api …/rules/branches/main`: `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request` (tylko squash, 0 zatwierdzeń), `required_status_checks` (`ci-gate`, bez „up to date”); pusta lista obejść; zatwierdzanie workflowów z forków |
| A1–A4 plan i `apply` | PASS (3 podejścia) | buckety media (GOVERNANCE 30 d), db-backup (COMPLIANCE 37 d), rejestr, eksporty; 7 aplikacji IAM + polityki; wolumen roboczy 20 GB; SSH dla jednego adresu. Poprawki z prawdziwego API: `scaleway_organization_id` w providerze, polityki bucketów tylko-Allow bez `NotAction` i ≤ 10 instrukcji (#129). Utworzona aplikacja IAM `evia-iac` (nie istniała). Kontrolny `plan`: bez zmian |
| A2 stan VM | PASS | kanał odrzucał każdy cykl: `v2-ci-gate: #106` (PR scalony przed końcem CI); na VM wydanie `aad42ae8`; `publish` na `main` czerwony od 2026-10-28 (naprawa #128); clamd nigdy nie działał |
| A5 7 kluczy S3 | PASS | pliki w `/etc/evia/secrets` `root:root 0600`, sekrety w Bitwarden |
| A6 `bucket-verify` | PASS | [bucket-verify-a6.md](bucket-verify-a6.md); po zmianie z A12 ponownie: 544 × ok, 6 × nieistotne `400` (bypass w bucketach bez locka) |
| A7 przegląd weryfikatora | PASS | przegląd `security-engineer` z 2026-11-12 (akceptacja) |
| A8 weryfikator, jednostki, wolumeny | PASS | nowy obraz weryfikatora z `main` (`ceceadbf`), baseline `ceceadbf` (blokada #106 zniesiona); dm-crypt z kluczem w RAM: `/var/lib/evia/media-video` 15 G, `/var/lib/evia/clamav-scan` 5 G; tmpfs `/run/evia/media-work`; journald; nowy `secrets.manifest.json` (wszystkie pliki usług obecne; 5 braków to sekrety posiedzenia B); kopie zastąpionych plików w `/root/evia-backup-2026-11-13/` |
| A9 infrastruktura | PASS | nowe digesty (Caddy 2.11.9, PostgreSQL 18.6, ClamAV 1.5.4); sieć `evia-runtime` odtworzona (Caddy `172.30.10.2`); postgres zdrowy na tym samym `pgdata`; clamd i freshclam jako uid `10006:10006` bez rootowego `/init` obrazu (`cap_drop ALL`, `read_only`), clamd tylko w `evia-scan` (internal); EICAR przez INSTREAM → `FOUND` |
| A10 procesor mediów | **odłożony** | build na VM: Trivy 11 × High (obraz bazowy Node: npm, pcre2, apt, openssl) i brak wyjścia VM na port 80; obraz z CI — EVM-124 (raport Trivy i SBOM jako materiał EVM-124, poza repozytorium) |
| A11 scalenie #129 | PASS | `publish` zielony; kanał wdrożył `60c5961c` (`/version`, `/healthz` 200, `staging-verify` zielony) |
| A12 testy | częściowo | zdjęcia z panelu (PUT z przeglądarki do bucketu: CORS, CSP) → skan → `clean` (po poprawce `s3:GetObjectVersion`, #130); eksport ZIP, miniatury i film — po EVM-124 (eksport wymaga zdjęć gotowych do pobrania); EICAR w panelu niewykonalny na stacji z Windows Defender — wykrywanie sprawdzone bezpośrednio na clamd |
| A13 zasoby | PASS | `free -m`: ok. 1,9 GB dostępne przy clamd (ok. 960 MiB) i aplikacji; brak OOM |
| A14 zamknięcie | PASS | `admin_ssh_cidrs = []` + `apply`; port 22 z zewnątrz zamknięty; kontrolny `plan`: bez zmian; tokeny sesyjne do usunięcia przez Konrada (Hetzner, klucz `evia-iac`), `staging.env` usunięty |

## Odstępstwa i dalsze kroki
- EVM-124 przed posiedzeniem B: obrazy procesora mediów i pgBackRest z CI (świeża baza Node, Trivy, SBOM, atestacja); potem start `evia-media` i powtórka A12 (miniatury, eksport ZIP, film).
- `mem_limit` dla clamd — EVM-085 (`security-engineer`, minor).
- Runbook `aktywacja-i-tryb-awaryjny.md`: w obrazie distroless polecenie to `/nodejs/bin/node dist/src/cli/bootstrap-admin.js`, nie `node …`.
- Komunikat workera `deletion register settings are incomplete` — szum (rejestr używa tylko API); do wyciszenia osobno.
