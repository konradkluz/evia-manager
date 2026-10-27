---
id: EVM-084
title: Backupy, wersjonowanie mediów, rejestr usunięć i test odtworzenia na staging (007b)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P1
path: pelna
owner: devops-engineer
contributors: []
reviewers: [security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-007]
---

# EVM-084: Backupy, wersjonowanie mediów, rejestr usunięć i test odtworzenia na staging (007b)

> Część 007b podziału EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) („Etapy wdrożenia decyzji”, „Test odtworzenia”).

## Cel
Jako **właściciel produktu** chcę **automatycznych kopii bazy i mediów oraz sprawdzonej procedury odtworzenia na staging**, aby **mieć pewność, że dane są bezpieczne, a ten sam moduł mógł potem posłużyć produkcji**. Test odtworzenia nie działa w GitHub Actions.

## Kryteria akceptacji
**AC1 — Kopie bazy**
- Zakładając działający staging z EVM-007
- Gdy upływa harmonogram kopii
- Wtedy pgBackRest wykonuje automatyczne, szyfrowane kopie bazy z archiwizacją WAL (odtwarzanie do punktu w czasie), zapisywane poza VM; hasło i klucze są tylko na VM, w Bitwarden i w zestawie awaryjnym offline; nieudana kopia daje zdarzenie lokalne i metrykę (dostarczenie alertu — EVM-085).

**AC2 — Media i rejestr usunięć**
- Gdy sprawdzam buckety stagingu
- Wtedy bucket mediów jest wersjonowany i szyfrowany, a media mają kopię; osobny bucket rejestru usunięć (SR-PRIV-04) przyjmuje od aplikacji wyłącznie `PutObject` (próba odczytu, nadpisania i usunięcia kluczem aplikacji → `AccessDenied`); żaden bucket nie jest publiczny (anonimowy `GET` = `403`), a konfigurację wersjonowania i polityk zmienia wyłącznie sesja IaC.

**AC3 — Orkiestrator testu odtworzenia**
- Zakładając projekt `evia-restore-staging` z tokenem tylko na VM staging
- Gdy timer (co miesiąc i ręcznie) uruchamia test
- Wtedy powstaje tymczasowa VM bez portów przychodzących, z kluczami tylko do odczytu i jednorazowym podpisanym URL `PUT` na wynik; odtwarza bazę (PITR) i media, zapisuje wynik bez danych (czas, RPO, liczby kontrolne), wyłącza się, a agent zapisuje wynik lokalnie i usuwa VM także po błędzie; druga VM nie powstaje, gdy jedna istnieje.

**AC4 — Sprzątacz zasobów**
- Gdy w `evia-restore-staging` istnieją zasoby starsze niż 24 h (serwery, snapshoty, obrazy, wolumeny, adresy IP)
- Wtedy sprzątacz (co godzinę) je usuwa i zgłasza zdarzenie (test z sztucznie „starym” zasobem); dostarczenie alertu do Konrada — EVM-085.

**AC5 — Scenariusz „backup usunięty z przejętej VM”**
- Zakładając, że na staging kluczem z VM usuwane są obiekty kopii bazy
- Gdy uruchamiany jest test odtworzenia
- Wtedy odtworzenie nadal się udaje (kopia niezależna od usunięcia przez klucz z VM); scenariusz jest powtarzany co miesiąc, a jego wynik opisany w runbooku.

**AC6 — Runbook odtworzenia i wykonany test**
- Wtedy `docs/ops/runbooks/restore.md` opisuje odtworzenie bazy i mediów z PITR oraz ponowne zastosowanie rejestru usunięć (SR-PRIV-04), a procedura została wykonana na staging z zapisem wyniku (bez danych); dane produkcyjne i prawdziwe dane osobowe nie biorą udziału (dane syntetyczne).

## Poza zakresem
- Test odtworzenia z VM prod w projekcie `evia-restore`, wariant nieniszczący na prod (zablokowane wersje), warunek „udany ≤ 7 dni” przed wdrożeniem prod (V5), `skipRestoreTest` — E8 (EVM-061/062).
- Polecenie ponownego zastosowania rejestru usunięć w modułach aplikacji i zapis do rejestru — EVM-040 / EVM-062.
- Alerty i monitoring — EVM-085.

## Decyzje i ograniczenia
- Podział: decyzja Konrada 2026-10-13. Koszt tymczasowych VM < 2 zł/mies. (ADR-0018). Zasoby płatne po akceptacji kosztów.
- Buckety: ta historyjka tworzy buckety mediów i rejestru usunięć (zależą od niej EVM-040 i EVM-044); EVM-007 (007a) zapewnia VM, sekrety i kanał.
- Dane nigdy nie trafiają do GitHuba, na runner ani na staging z prod.
- **Stan realizacji (noc 2026-10-27, tor T3):** kod i dokumentacja gotowe i przetestowane na atrapach (API Hetzner, S3, rclone, pgBackRest), **nieaktywne do sesji IaC** (płatne zasoby, klucze, `apply`). Status zostaje `in-progress` do dowodów w `docs/qa/EVM-084/` (wykonane kopie, test odtworzenia, AC5, `bucket-verify`, alerty — EVM-085), jak w EVM-007 (PR #105).
- **Decyzje wykonawcze (zmieniają sposób spełnienia AC, nie ich treść; do akceptacji w sesji IaC, SR-SUPPLY-06):**
  - Buckety wyłącznie w `pl-waw` (ADR-0009, ADR-0011); `fr-par` zostaje dla TEM. Object lock włączany **przy utworzeniu**: media GOVERNANCE 30 d, `evia-staging-db-backup` COMPLIANCE 37 d (nieodwracalne; bucketu nie da się usunąć przez 37 dni); rejestr usunięć bez locka, z wersjonowaniem i wygasaniem 40 d. Rezygnacja z locka na mediach wymaga ADR.
  - AC2 „nadpisanie → AccessDenied”: klucz rejestru ma `PutObject` wyłącznie z `If-None-Match` (Deny dla zapisu bez tego nagłówka); klucze obiektów unikalne (UUIDv7). Klucze aplikacji nie mają Get/List/Delete/`DeleteObjectVersion`/`PutBucket*`/`BypassGovernanceRetention`; każda polityka ma jawne zezwolenie dla aplikacji IaC. Do potwierdzenia w sesji IaC: obsługa warunku `s3:if-none-match` i `Null` w politykach Scaleway (`bucket-verify`).
  - AC3 „jednorazowy podpisany URL”: unikalny klucz na przebieg, TTL ≤ 2 h, `If-None-Match: *` w podpisie (drugi zapis → 412) i ścisły schemat wyniku — zamiast liczenia wersji obiektu. URL podpisuje **osobny klucz `restore-orchestrator`** (Put/Get tylko na `restore-results/`, Deny na `pgbackrest/`), nie klucz kopii (zalecenie security-engineera ponad architektem). Wynik w buckecie db-backup (bez czwartego bucketu).
  - Sekrety: klucz mediów tylko do `api` (worker dostaje własny klucz w swojej historyjce — EVM-040/044), klucz rejestru tylko do `worker`, hasło szyfrowania i klucz kopii tylko do `postgres`; token testu, klucze `restore-reader`/`media-backup-reader`/`restore-orchestrator` i hasła rclone tylko jednostki root na VM. Klucze S3 i hasła dostarcza sesja IaC (`init-secrets` ich nie generuje; `--check` zgłasza brak). Klucze API nie powstają w stanie OpenTofu.
  - AC5: odtworzenie przez `pgbackrest restore --repo-target-time` (pgBackRest ≥ 2.54; przypięty 2.60.0-1.pgdg13+1), usuwanie kluczem `backup-writer` z VM staging i tylko po udanej świeżej kopii, potem obowiązkowe leczenie repozytorium (`rclone copy --s3-version-at`, `check`, `info`). Ryzyko: zgodność object lock z `put`/`expire` pgBackRest niepotwierdzona (plan B: `repo2` na Storage Box, ADR-0011).
  - **Nowe zależności:** pgBackRest (MIT, PGDG, obraz `infra/images/postgres-pgbackrest`), rclone (MIT, Debian). **Nowe koszty (do akceptacji):** trzeci bucket z lockiem 37 d, Storage Box z dwoma subkontami (zapis dla `rclone`, odczyt dla testu; snapshoty poza VM), tymczasowa VM cax11 testu odtworzenia (< 2 zł/mies.).
  - **Poprawki po przeglądzie (runda 1, 2026-10-27; zmieniają sposób spełnienia AC, nie ich treść):** (a) kopia mediów to `rclone sync --exclude quarantine/**` zgodnie z ADR-0009/0011 (nie `copy`): usunięcia z bucketu docierają do kopii, historię i ochronę przed usunięciem z przejętej VM dają snapshoty Storage Boxa 14 dni zarządzane poza VM (RODO art. 5 ust. 1 lit. e); (b) sprzątacz działa tylko w projekcie z wartownikiem (zapora z etykietą `evia-project=evia-restore-staging`, do utworzenia w sesji IaC) i bez obcych serwerów/wolumenów, serwery usuwa wyłącznie po etykiecie `evia-restore=staging`; (c) `bucket-verify.sh` wykonuje pełną macierz klucz × bucket × obszar × operacja dla sześciu kluczy z `bucket-matrix.tsv` generowanej z `BUCKET_POLICIES`; (d) moduł `firewall` ma regułę wychodzącą 23/tcp wyłącznie do `storagebox_cidrs` (domyślnie pusta); (e) test odtworzenia odtwarza do **nazwanego punktu** (`pg_create_restore_point` + `pgbackrest check`) z zestawu kopii zakończonego przed punktem, z sekretami w pliku `conf.d/secrets.conf`, rolą `evia_owner` i `--repo=1` przy `--repo-target-time`; RPO = opóźnienie archiwum (definicja w runbooku); (f) etap bazy jest wykonywany naprawdę w usłudze compose `restore-db-test` (prawdziwy pgBackRest, repozytorium posix, bez sieci), a schemat wyniku jest jeden (`result.schema.jq`).
  - **Nowe zależności/koszty z poprawek (do akceptacji w sesji IaC):** brak nowych zależności; obraz testowy `restore-db-test` to ten sam obraz `postgres-pgbackrest` (lokalnie i w CI, bez kosztu); wartownik to zapora bez reguł (0 zł); `evia-psql` to cienki skrypt hosta jak `evia-pgbackrest`.
  - **Do orkiestratora (poza torem T3):** (1) obraz `postgres-pgbackrest` musi przejść pipeline publikacji (skan, podpis) i dostać wpis w `infra-images.json` z prawdziwym digestem — do tego czasu `compose.infra.yaml` bez zmian; (2) podpięcie zmiennych `S3_ENDPOINT`, `S3_REGION`, `MEDIA_BUCKET`, `MEDIA_S3_*`, `DELETION_REGISTER_*`, `CLAMD_SOCKET` do `api`/`worker` w `compose.staging.yaml` — EVM-040/044; (3) Storage Box i jego subkonta tworzone ręcznie w sesji IaC (dostawca `hcloud` w zablokowanej wersji ich nie obsługuje).

## Dziennik
- 2026-10-13 — utworzono (product-owner, podział EVM-007 wg ADR-0018: dawne AC4 i część AC7)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
- 2026-10-27 — start realizacji (nocna kolejka, tor T3), gałąź feature/EVM-084-085-backupy-obserwowalnosc
- 2026-10-27 — plan gotowy (devops-engineer)
- 2026-10-27 — implementacja (devops-engineer, tor T3): moduł `object-storage` + reguły `bucketProblems`, mapowanie sekretów, orkiestrator/sprzątacz/scenariusz AC5/podpisany URL (testy na atrapach), pgBackRest (konfiguracja, obraz, kopie, kopia mediów), jednostki systemd, `bucket-verify`, runbook `restore.md`; nieaktywne do sesji IaC, status zostaje in-progress
- 2026-10-27 — poprawki po przeglądzie, runda 1 (devops-engineer, tor T3): sprzątacz z wartownikiem, `rclone sync`, macierz kluczy, SFTP w zaporze, punkt nazwany, sekrety recovery, rola, kontrakt wyniku, test etapu bazy w kontenerze
