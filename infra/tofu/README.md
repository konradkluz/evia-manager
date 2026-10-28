# Infrastruktura jako kod — `infra/tofu/`

EVM-007 AC1 (ADR-0018 „IaC”, ADR-0011). OpenTofu 1.13 dla środowiska staging w UE: sieć prywatna, zapora, VM z zaszyfrowanym wolumenem danych PostgreSQL i domena Scaleway TEM. Produkcja (E8) użyje tych samych modułów.

| Katalog | Zawartość |
|---|---|
| `modules/network` | sieć prywatna i podsieć (strefa `eu-central`) |
| `modules/firewall` | zapora Hetzner: wejście 80/443, 22 tylko z `admin_ssh_cidrs` (domyślnie pusta), wyjście tylko 443/tcp, 53/udp+tcp, 123/udp (SR-INFRA-01) |
| `modules/vm` | VM, wolumen danych (LUKS2, klucz generowany na VM), `user-data` bez sekretów (`templates/user-data.yaml.tftpl`: Docker po dokładnej wersji, blokada `169.254.169.254` dla kontenerów we własnej tabeli nftables, SSH tylko kluczem) |
| `modules/tem` | domena TEM `staging.eviacharge.pl` (rekordy SPF/DKIM/DMARC ustawia Konrad ręcznie w OVH) |
| `modules/object-storage` | EVM-084: trzy prywatne buckety w `pl-waw` (media z object lock GOVERNANCE 30 d, rejestr usunięć — klucz aplikacji tylko `PutObject` bez nadpisania, `evia-staging-db-backup` z COMPLIANCE 37 d), SSE-ONE, wersjonowanie, CORS `PUT` z jednego originu, aplikacje IAM i polityki bucketów (jawny Deny uprawnień administracyjnych); klucze API tworzone ręcznie, nie w stanie. Nieaktywny do sesji IaC (nowe płatne zasoby); reguły: `bucketProblems` w `tools/repo-policy` |
| `bootstrap` | bucket stanu OpenTofu (Scaleway, wersjonowany, prywatny); stan lokalny poza repozytorium |
| `staging` | środowisko staging (stan w buckecie z `bootstrap`) |

## Zasady (testy: `tools/repo-policy/test/iac.test.ts`)
- Dostawcy tylko `hetznercloud/hcloud` i `scaleway/scaleway`, wersje dokładne, `.terraform.lock.hcl` z hashami dla `linux_amd64` i `linux_arm64`; regiony tylko w UE.
- Stan i plan szyfrowane (`encryption`, `enforced = true`); hasło tylko ze zmiennej środowiska kontenera `iac`.
- Zakazane: provisionery, źródła danych `external`/`http`, `random_password`, `tls_private_key`, poświadczenia w kodzie, wyjścia z sekretami. Typ VM (Q1) i adresy SSH (Q2) — bez wartości domyślnych, podawane w sesji IaC.
- VM wyłącznie Arm64 (Hetzner CAX): `server_type` z walidacją `cax11|cax21|cax31|cax41` (zalecany `cax11`, `cax21` przy braku pamięci) — obrazy kanału są `linux/arm64`; `user-data` bez literałów architektury x86 (repozytorium Dockera z `dpkg --print-architecture`). Lock file dotyczy platformy, na której działa `tofu` (kontener `iac`), nie VM.
- `*.tfstate*`, `*.tfplan`, `*.tfvars`, `.terraform/` są ignorowane przez git.

## Polecenia
- Kontrole bez poświadczeń (lokalnie i w CI, job `security` przy zmianie kodu IaC): `docker compose -f compose.yaml run --rm iac-check` — `tofu fmt -check`, `tofu init -backend=false` z pliku blokady, `tofu validate`; Trivy config obejmuje `infra/` w `pnpm run scan`.
- Aktualizacja plików blokady po zmianie wersji dostawcy: `docker compose -f compose.yaml run --rm iac-check lock` (wypisuje oba pliki).
- Sesja IaC (wyłącznie z Konradem, po utworzeniu przez niego plików w `../.evia-iac/` i reguł `deny`): `docker compose -f compose.iac.yaml run --rm iac <init|plan|apply|output> <bootstrap|staging>`. CI nigdy nie wykonuje `plan` ani `apply`. Kroki sesji: `docs/ops/runbooks/wdrozenie-staging.md`.
