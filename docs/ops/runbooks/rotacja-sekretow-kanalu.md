# Runbook: rotacja sekretów i tokenów kanału wdrożeń (staging)

> Dokument żywy. EVM-007 AC7, AC8 (ADR-0018 „Poświadczenia kanału”, „Gdzie żyją sekrety”; SR-CRYPTO-04). Właściciel: `devops-engineer`; tokeny tworzy i unieważnia wyłącznie Konrad. Ogólne zasady rotacji: [`rotacja-sekretow.md`](../rotacja-sekretow.md).

| Sekret | Gdzie | Ważność / rotacja | Kopia |
|---|---|---|---|
| Fine-grained PAT (Actions, Contents, Pull requests, Metadata — tylko odczyt, tylko to repozytorium) | VM: `/etc/evia/secrets/github-pat` (`0600` root) → kopia tmpfs `/run/evia/agent/github-pat` dla weryfikatora | ≤ 12 mies.; przypomnienie w kalendarzu Konrada 30 dni przed | Bitwarden |
| PAT classic `read:packages` | VM: konfiguracja `docker login ghcr.io` roota | ≤ 12 mies.; jak wyżej | Bitwarden |
| Hasła ról bazy (`evia_migrator`, `evia_api`, `postgres`), `cursor-key`, `field-encryption-keys` | VM: `/etc/evia/secrets/` (`0600` root) → kopie tmpfs `/run/evia/secrets/<usługa>/` (`0400`) | przy podejrzeniu wycieku; `field-encryption-keys` — dodanie klucza (pierwszy szyfruje, wszystkie odszyfrowują) | Bitwarden; `field-encryption-keys` też zestaw awaryjny offline |
| Klucz LUKS wolumenu danych | VM: `/etc/evia/secrets/luks-pgdata.key` (generowany na VM) | bez rotacji okresowej | zestaw awaryjny offline |
| Tokeny IaC (Hetzner R/W, Scaleway ≤ 24 h), hasło stanu OpenTofu | tylko na czas sesji IaC: `../.evia-iac/staging.env` | po każdej sesji unieważnione / usunięte; hasło stanu bez zmian | hasło stanu — Bitwarden |

## Rotacja PAT (fine-grained lub `read:packages`)
1. Konrad tworzy nowy token z tymi samymi, minimalnymi uprawnieniami (bez poszerzania — jeśli API wymaga więcej, to blokada i rewizja ADR-0018).
2. Sesja administratora (SSH w sesji IaC albo konsola Hetzner): fine-grained — `sudo install -m 0600 -o root -g root /dev/stdin /etc/evia/secrets/github-pat` (wklejenie z Bitwarden, bez zapisu w historii powłoki); `read:packages` — `sudo docker login ghcr.io -u <login> --password-stdin`.
3. Sprawdzenie: najbliższy cykl kończy się `none` albo `deploy` (nie `reject` z `api-status 401`); `sudo docker pull` ostatniego obrazu z rejestru działa.
4. Konrad unieważnia stary token w ustawieniach GitHub; aktualizuje Bitwarden i przypomnienie.

## Rotacja sekretu aplikacji
1. Nowa wartość w `/etc/evia/secrets/<plik>` (`0600` root), dla haseł ról także `ALTER ROLE … PASSWORD` i `database-url-*`.
2. Ponowne wdrożenie bieżącego commita: polecenie rollbacku nie pomoże (to ten sam commit) — restart kolorów przez `deploy.sh` następuje przy kolejnym wdrożeniu; do tego czasu w sesji administratora `sudo /usr/local/sbin/evia-secrets` (ten sam skrypt co `deploy.sh` i jednostka rozruchowa `evia-secrets.service`; kopie tmpfs w `/run/evia/secrets/<usługa>/` z `secrets.manifest.json`, hash manifestu API z rejestru), potem `docker compose --project-name evia-<aktywny kolor> … restart` (dla `postgres-password` — `evia-infra`). Nigdy kopia ręczna ani sekret w zmiennej środowiskowej.
3. Kopia do Bitwarden; zestaw awaryjny offline dla `field-encryption-keys`.

## Wyciek
Unieważnij od razu (Konrad), potem rotacja jak wyżej; dla PAT — przegląd Activity repozytorium i rejestru wdrożeń (czy nie było wdrożenia spoza `pr_merge` Konrada) i [incydent „blokada V0”](incydent-blokada-v0.md), gdy jest choć jedno zdarzenie spoza PR.
