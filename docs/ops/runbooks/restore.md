# Runbook: kopie zapasowe i odtworzenie (staging)

> Dokument żywy. EVM-084 AC1–AC6 (ADR-0009, ADR-0011, ADR-0018 „Test odtworzenia”; SR-DATA-04, SR-INFRA-07, SR-PRIV-04). Właściciel: `devops-engineer`. Powiązane: [rotacja sekretów kanału](rotacja-sekretow-kanalu.md), [wdrożenie stagingu](wdrozenie-staging.md), [rollback](rollback-staging.md). **Stan: kod gotowy i przetestowany na atrapach, nieaktywny do sesji IaC** (płatne zasoby, klucze, pierwszy `apply`); sekcja „Wynik testu” zostanie uzupełniona po pierwszym wykonaniu na stagingu.

## Co i gdzie leży
| Element | Gdzie | Jak chronione |
|---|---|---|
| Baza (pgBackRest, WAL + pełne/różnicowe) | bucket `evia-staging-db-backup` (Scaleway, `pl-waw`), ścieżka `/pgbackrest` | szyfrowanie `aes-256-cbc` (hasło `pgbackrest-cipher-pass`), SSE-ONE, object lock COMPLIANCE 37 dni, wersjonowanie |
| Media | bucket `evia-staging-media` (`pl-waw`) | wersjonowanie, SSE-ONE, object lock GOVERNANCE 30 dni; kopia: rclone crypt na Storage Box (Hetzner) |
| Rejestr usunięć (SR-PRIV-04) | bucket `evia-staging-deletion-register` (`pl-waw`) | klucz aplikacji: wyłącznie `PutObject` z `If-None-Match` (bez nadpisania, odczytu, listy i usuwania); wygasanie 40 dni |
| Wynik testu odtworzenia | `restore-results/<runId>.json` w buckecie `evia-staging-db-backup` | osobny klucz `restore-orchestrator` (tylko ten prefiks), podpisany `PUT` ≤ 2 h, jednorazowy |

Hasło szyfrowania repozytorium, hasła `rclone crypt` i klucze są **tylko** na VM (`/etc/evia/secrets`, 0600 root), w Bitwarden Konrada i w zestawie awaryjnym offline. **Utrata hasła `pgbackrest-cipher-pass` = utrata kopii** — zestaw offline wydrukuj/zapisz przed pierwszą kopią.

## Harmonogram (jednostki `infra/deploy-agent/systemd/`)
| Jednostka | Kiedy | Co |
|---|---|---|
| `evia-backup-full.timer` | niedziela 01:30 (Europe/Warsaw) | pełna kopia + `pgbackrest check` |
| `evia-backup-diff.timer` | pon–sob 01:30 | kopia różnicowa + `check` |
| (archiwum WAL) | ciągle, `archive_timeout = 300 s` | RPO ≤ 15 min także na bezczynnym stagingu |
| `evia-media-copy.timer` | codziennie 03:30 | `rclone copy` (nigdy `sync`: usunięcie w buckecie nie propaguje się) |
| `evia-restore-sweep.timer` | co godzinę | usuwa zasoby projektu `evia-restore-staging` starsze niż 24 h |
| `evia-restore-test.timer` | 3. dnia miesiąca 04:00 + ręcznie (`systemctl start evia-restore-test`) | test odtworzenia ze scenariuszem „backup usunięty z przejętej VM” |

Retencja: pełne kopie młodsze niż 35 dni (pokrywa PITR 30 dni), różnicowe 14. Snapshoty Storage Boxa (14 dni, `policies.md`) zarządzane **poza VM** — VM nie ma uprawnień do ich usuwania.

## Zdarzenia i metryki (uzgodnione z EVM-085)
Zdarzenia lokalne: `/var/lib/evia/restore/events.jsonl` (`backup-failed`, `media-copy-failed`, `restore-sweep-failed`, `restore-sweep-deleted`, `restore-test-failed`, `restore-test-timeout`, `restore-test-cleanup-failed`, `restore-repo-heal-failed`, …) i `alerts.log` (jednostka `evia-restore-alert`). Metryki w pliku tekstowym `/var/lib/evia/metrics/evia_restore.prom` (node exporter textfile; Grafana Cloud — EVM-085). **Dostarczenie alertu do Konrada to EVM-085**; poniższe nazwy są kontraktem dla reguł alertów:

| Metryka | Znaczenie / sugerowany alert |
|---|---|
| `evia_backup_last_success_timestamp_seconds`, `evia_backup_last_failed` | brak sukcesu > 26 h albo `last_failed 1` |
| `evia_media_copy_last_success_timestamp_seconds`, `evia_media_copy_last_failed` | brak sukcesu > 36 h |
| `evia_restore_test_last_success_timestamp_seconds`, `evia_restore_test_last_run_failed`, `evia_restore_test_last_rpo_seconds` | brak sukcesu > 35 dni; RPO > 900 s |
| `evia_restore_repo_heal_failed` | `1` = repozytorium po scenariuszu AC5 niespójne — **alarm natychmiast** |
| `evia_restore_sweeper_last_run_timestamp_seconds`, `evia_restore_sweeper_last_run_failed`, `evia_restore_sweeper_last_deleted` | brak przebiegu > 3 h; `last_deleted > 0` = coś zostało po teście (zdarzenie, nie awaria) |

Treść zdarzeń i logów nie zawiera danych osobowych, tokenów, odpowiedzi API (w tym `root_password`), `user-data` ani podpisanych adresów URL.

## Test odtworzenia — jak działa (AC3)
`/usr/local/sbin/evia-restore-test` (`infra/deploy-agent/restore/run.sh`) na VM staging, tokenem projektu `evia-restore-staging` (jedyny token tego projektu, tylko na VM staging):
1. `flock` + odmowa, gdy w projekcie istnieje **jakikolwiek** serwer (druga VM nie powstaje).
2. Zapora **bez reguł przychodzących** (wychodzące: 443, 53 tcp/udp, 123 udp, 23/tcp dla SFTP Storage Boxa) tworzona na ten przebieg, z etykietą `evia-restore=staging`; dołączona już w żądaniu utworzenia serwera.
3. Podpisany `PUT` (TTL 2 h, klucz `restore-results/<runId>.json`, nagłówek `If-None-Match: *` w podpisie — drugi zapis jest odrzucany) i podpisany `GET` dla orkiestratora.
4. VM (cax11, obraz po ID, lokalizacja z listy UE) bez SSH (cloud-init wyłącza `sshd` i hasło root; hasło z e-maila Hetznera jest bezużyteczne), z kluczami **tylko do odczytu** (`restore-reader`), hasłami odszyfrowania i podpisanym `PUT`; zabezpieczenie: `shutdown -h +300`.
5. VM odtwarza bazę (`pgbackrest restore --type=time`), liczy tabele i wiersze, sprawdza dekodowanie próbki mediów (rclone crypt, konto Storage Box tylko do odczytu), liczy wpisy rejestru usunięć (wszystkie wersje) i zapisuje **jeden wynik bez danych**: czasy, RPO, liczby kontrolne, status. Wyłącza się.
6. Orkiestrator (twardy limit czekania 4 h) czyta wynik, waliduje (limit 16 KiB, biała lista pól, typy liczbowe, zgodny `runId`) i zapisuje `/var/lib/evia/restore/last.json` atomowo. Wynik niezgodny ze schematem = odrzucony, przebieg czerwony.
7. **Zawsze** (także po błędzie lub sygnale): serwer i zapora tego przebiegu są usuwane (także znalezione po etykiecie `evia-run`, gdy odpowiedź utworzenia zginęła); zapora czeka na zniknięcie serwera.

Ręczne uruchomienie bez scenariusza AC5: `systemctl edit evia-restore-test` → `[Service] Environment=EVIA_RESTORE_SCENARIO=` albo `sudo EVIA_RESTORE_SCENARIO= /usr/local/sbin/evia-restore-test` (z `/etc/evia/restore/restore.conf` w środowisku).

## Scenariusz „backup usunięty z przejętej VM” (AC5)
Co miesiąc, w tym samym przebiegu (`scenario.sh`):
1. Świeża kopia przyrostowa; **gdy się nie uda, nic nie jest usuwane** (zdarzenie `restore-scenario-aborted`).
2. Czas `T`; kluczem `backup-writer` (z VM staging) usuwane są obiekty `pgbackrest/` — w buckecie z wersjonowaniem powstają znaczniki usunięcia (klucz nie ma `DeleteObjectVersion`, więc usunięcie jest odwracalne).
3. VM testu odtwarza `pgbackrest restore --repo-target-time=T --type=time` — stan repozytorium sprzed usunięcia.
4. **Leczenie (zawsze, także po nieudanym teście):** `rclone copy --s3-version-at T` kopiuje poprzednie wersje na miejsce znaczników, potem `pgbackrest check` i `info`. Niespójne repozytorium = zdarzenie `restore-repo-heal-failed` i metryka `evia_restore_repo_heal_failed 1`.
Wynik miesięczny: `last.json` (`"scenario": "delete"`) — po pierwszym przebiegu zapisz w tabeli poniżej.

## Ręczne odtworzenie (AC6)
**Baza do punktu w czasie** (nowa VM albo katalog tymczasowy — nigdy na działającą bazę bez decyzji Konrada):
1. Przygotuj klucze `restore-reader` (Bitwarden) i hasło `pgbackrest-cipher-pass`; zainstaluj `pgbackrest` ≥ 2.54 (PGDG) i PostgreSQL w tej samej wersji głównej co staging.
2. `pgbackrest.conf` jak `infra/runtime/pgbackrest/pgbackrest.conf` (klucz i hasło przez zmienne `PGBACKREST_REPO1_S3_KEY[_SECRET]`, `PGBACKREST_REPO1_CIPHER_PASS`, nie w pliku).
3. `pgbackrest --stanza=evia --type=time --target="<czas UTC>" --target-action=promote restore` (po usunięciu obiektów dodatkowo `--repo-target-time=<czas sprzed usunięcia>`).
4. Start PostgreSQL, sprawdź tabele; po odtworzeniu produkcyjnym uruchom `rebuild` projekcji ([projekcja listy zleceń](projekcja-listy-zlecen.md)).

**Media:** `rclone copy` z remote crypt (konto Storage Box tylko do odczytu, hasła z Bitwarden) do świeżego bucketu albo katalogu; wersje w buckecie mediów: `rclone copy --s3-version-at <czas>`.

**Rejestr usunięć (SR-PRIV-04):** po odtworzeniu bazy odczytaj **wszystkie wersje** obiektów bucketu `evia-staging-deletion-register` (`restore-reader`: `GetObjectVersion`, `ListBucketVersions`); za wiążącą uznaj **najstarszą** wersję wpisu. Ponowne zastosowanie wpisów do odtworzonej bazy to polecenie aplikacji (EVM-040 / EVM-062); test odtworzenia sprawdza tylko, że rejestr jest czytelny, i liczy wpisy.

## Weryfikacja bucketów (po każdej zmianie IaC)
`bucket-verify.sh` z prawdziwymi kluczami (sesja IaC): anonimowy `GET`/lista każdego bucketu = 403; klucz rejestru: zapis z `If-None-Match` = 200, drugi = 412, nadpisanie/odczyt/lista/usunięcie = 403; klucze aplikacji: `PutBucketPolicy`, `PutBucketVersioning`, `PutLifecycleConfiguration`, `PutObjectRetention`, `DeleteObjectVersion` = 403; obiekt mediów ma nagłówek SSE. Wynik (same linie `ok`/`FAIL`) do `docs/qa/EVM-084/`.

## Sesja IaC — co wykonać (kolejność)
1. Konrad: konto/projekt `evia-restore-staging` (Hetzner, tylko ten projekt, token pełny do tego projektu), Storage Box z dwoma subkontami (zapis dla `rclone` na VM, odczyt dla VM testu; snapshoty poza VM), zatwierdzenie kosztów (trzeci bucket z lockiem, Storage Box, cax11 testu).
2. `apply` modułu `object-storage` (bucket mediów i db-backup **z object lock od utworzenia**; SSE-ONE zanim powstanie jakikolwiek obiekt); klucze API tworzone ręcznie (Scaleway) dla aplikacji z outputu `object_storage_application_ids`, zapisane do `/etc/evia/secrets` (nazwy w `init-secrets --check`) i Bitwarden; `bucket-verify.sh`.
3. Potwierdzić zgodność pgBackRest z object lock (np. wymóg `Content-MD5`/sumy kontrolnej przy `put` i `expire`); przy niezgodności — `repo2` na Storage Box (ADR-0011).
4. Zbudować i opublikować obraz `postgres-pgbackrest` (skan, podpis), wpisać tag + digest do `infra-images.json` i **jednocześnie** zmienić `compose.infra.yaml` (obraz, `archive_command`, `postgresql-backup.conf`).
5. Zainstalować skrypty i jednostki; `restore.conf`; pierwsza pełna kopia; pierwszy test odtworzenia i scenariusz AC5; zapis wyniku poniżej i dowody w `docs/qa/EVM-084/`.

## Wynik testu odtworzenia
| Data | Scenariusz | Status | RPO (s) | Tabele / wiersze / media / wpisy rejestru | Uwagi |
|---|---|---|---|---|---|
| _po sesji IaC_ | — | — | — | — | dane syntetyczne; bez danych produkcyjnych i osobowych |

## Rotacja i ryzyka
- Rotacja kluczy S3 i hasła `pgbackrest-cipher-pass`/`rclone`: [rotacja sekretów kanału](rotacja-sekretow-kanalu.md); zmiana `pgbackrest-cipher-pass` wymaga nowej kopii pełnej i zachowania starego hasła do końca retencji.
- Token Hetznera projektu testu leży na VM staging (root na stagingu może tworzyć zasoby i nabijać koszty) — projekt bez innych zasobów, sprzątacz, alert budżetowy (EVM-085).
- Bucket `evia-staging-db-backup` z COMPLIANCE 37 dni nie da się usunąć przez 37 dni od pierwszego obiektu.
