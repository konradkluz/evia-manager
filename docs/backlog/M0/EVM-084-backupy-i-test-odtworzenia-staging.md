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
- ~~Test odtworzenia z VM prod w projekcie `evia-restore`, wariant nieniszczący na prod (zablokowane wersje), warunek „udany ≤ 7 dni” przed wdrożeniem prod (V5), `skipRestoreTest` — E8 (EVM-061/062).~~ **Zmiana 2026-11-13 (decyzja Konrada: jedno środowisko):** osobnej produkcji nie ma, EVM-062 połączona z tą historyjką — zakres EVM-084 obejmuje też delty z EVM-062 (rejestr usunięć stosowany idempotentnie po odtworzeniu, nieniszczący test niezmienności, alert „ostatni udany test starszy niż próg”, uzgadnianie storage'u z EVM-051, runbook; szczegóły — EVM-062 „Połączona z EVM-084”); wykonawca dopisuje je do AC (do akceptacji Konrada) albo dzieli historyjkę. Bez V5, `skipRestoreTest` i drugiego projektu `evia-restore` prod. Kopie i test **nie są warunkiem startu realnych danych** (EVM-061 AC5), ale mają najwyższy priorytet zaraz po EVM-124.
- Polecenie ponownego zastosowania rejestru usunięć w modułach aplikacji i zapis do rejestru — EVM-040 / EVM-062.
- Alerty i monitoring — EVM-085.

## Decyzje i ograniczenia
- Podział: decyzja Konrada 2026-10-13. Koszt tymczasowych VM < 2 zł/mies. (ADR-0018). Zasoby płatne po akceptacji kosztów.
- Buckety: ta historyjka tworzy buckety mediów i rejestru usunięć (zależą od niej EVM-040 i EVM-044); EVM-007 (007a) zapewnia VM, sekrety i kanał.
- Dane nigdy nie trafiają do GitHuba, na runner ani na staging z prod.
- **Stan realizacji (noc 2026-10-27, tor T3):** kod i dokumentacja gotowe i przetestowane na atrapach (API Hetzner, S3, rclone, pgBackRest), **nieaktywne do sesji IaC** (płatne zasoby, klucze, `apply`). Status zostaje `in-progress` do dowodów w `docs/qa/EVM-084/` (wykonane kopie, test odtworzenia, AC5, `bucket-verify`, alerty — EVM-085), jak w EVM-007 (PR #105).
- **Decyzje wykonawcze (zmieniają sposób spełnienia AC, nie ich treść; do akceptacji w sesji IaC, SR-SUPPLY-06):**
  - Buckety wyłącznie w `pl-waw` (ADR-0009, ADR-0011); `fr-par` zostaje dla TEM. Object lock włączany **przy utworzeniu**: media GOVERNANCE 30 d, `evia-staging-db-backup` COMPLIANCE 37 d (nieodwracalne; bucketu nie da się usunąć przez 37 dni); rejestr usunięć bez locka, z wersjonowaniem i wygasaniem 40 d. Rezygnacja z locka na mediach wymaga ADR.
  - AC2 „nadpisanie → AccessDenied”: klucz rejestru ma `PutObject` wyłącznie z `If-None-Match` (Allow tylko z warunkiem `Null` na `s3:if-none-match`; zapis bez nagłówka jest odmówiony domyślnie, RR-90); klucze obiektów unikalne (UUIDv7). Klucze aplikacji nie mają Get/List/Delete/`DeleteObjectVersion`/`PutBucket*`/`BypassGovernanceRetention`; każda polityka ma jawne zezwolenie dla aplikacji IaC. Do potwierdzenia w sesji IaC: obsługa warunku `s3:if-none-match` i `Null` w politykach Scaleway (`bucket-verify`).
  - AC3 „jednorazowy podpisany URL”: unikalny klucz na przebieg, TTL ≤ 2 h, `If-None-Match: *` w podpisie (drugi zapis → 412) i ścisły schemat wyniku — zamiast liczenia wersji obiektu. URL podpisuje **osobny klucz `restore-orchestrator`** (Put/Get tylko na `restore-results/`, Deny na `pgbackrest/`), nie klucz kopii (zalecenie security-engineera ponad architektem). Wynik w buckecie db-backup (bez czwartego bucketu).
  - Sekrety: klucz mediów tylko do `api` (worker dostaje własny klucz w swojej historyjce — EVM-040/044), klucz rejestru tylko do `api` (poprawka RR-55 b z 2026-10-29: zapis wykonuje API, nie worker), hasło szyfrowania i klucz kopii tylko do `postgres`; token testu, klucze `restore-reader`/`media-backup-reader`/`restore-orchestrator` i hasła rclone tylko jednostki root na VM. Klucze S3 i hasła dostarcza sesja IaC (`init-secrets` ich nie generuje; `--check` zgłasza brak). Klucze API nie powstają w stanie OpenTofu.
  - AC5: odtworzenie przez `pgbackrest restore --repo-target-time` (pgBackRest ≥ 2.54; przypięty 2.60.0-1.pgdg13+1), usuwanie kluczem `backup-writer` z VM staging i tylko po udanej świeżej kopii, potem obowiązkowe leczenie repozytorium (`rclone copy --s3-version-at`, `check`, `info`). Ryzyko: zgodność object lock z `put`/`expire` pgBackRest niepotwierdzona (plan B: `repo2` na Storage Box, ADR-0011).
  - **Nowe zależności:** pgBackRest (MIT, PGDG, obraz `infra/images/postgres-pgbackrest`), rclone (MIT, Debian). **Nowe koszty (do akceptacji):** trzeci bucket z lockiem 37 d, Storage Box z dwoma subkontami (zapis dla `rclone`, odczyt dla testu; snapshoty poza VM), tymczasowa VM cax11 testu odtworzenia (< 2 zł/mies.).
  - **Poprawki po przeglądzie (runda 1, 2026-10-27; zmieniają sposób spełnienia AC, nie ich treść):** (a) kopia mediów to `rclone sync --exclude quarantine/**` zgodnie z ADR-0009/0011 (nie `copy`): usunięcia z bucketu docierają do kopii, historię i ochronę przed usunięciem z przejętej VM dają snapshoty Storage Boxa 14 dni zarządzane poza VM (RODO art. 5 ust. 1 lit. e); (b) sprzątacz działa tylko w projekcie z wartownikiem (zapora z etykietą `evia-project=evia-restore-staging`, do utworzenia w sesji IaC) i bez obcych serwerów/wolumenów, serwery usuwa wyłącznie po etykiecie `evia-restore=staging`; (c) `bucket-verify.sh` wykonuje pełną macierz klucz × bucket × obszar × operacja dla sześciu kluczy z `bucket-matrix.tsv` generowanej z `BUCKET_POLICIES`; (d) moduł `firewall` ma regułę wychodzącą 23/tcp wyłącznie do `storagebox_cidrs` (domyślnie pusta); (e) test odtworzenia odtwarza do **nazwanego punktu** (`pg_create_restore_point` + `pgbackrest check`) z zestawu kopii zakończonego przed punktem, z sekretami w pliku `conf.d/secrets.conf`, rolą `evia_owner` i `--repo=1` przy `--repo-target-time`; RPO = opóźnienie archiwum (definicja w runbooku); (f) etap bazy jest wykonywany naprawdę w usłudze compose `restore-db-test` (prawdziwy pgBackRest, repozytorium posix, bez sieci), a schemat wyniku jest jeden (`result.schema.jq`).
  - **Nowe zależności/koszty z poprawek (do akceptacji w sesji IaC):** brak nowych zależności; obraz testowy `restore-db-test` to ten sam obraz `postgres-pgbackrest` (lokalnie i w CI, bez kosztu); wartownik to zapora bez reguł (0 zł); `evia-psql` to cienki skrypt hosta jak `evia-pgbackrest`.
  - **RR-55 (a), wybór 2026-10-29:** dokumentacja Scaleway Object Storage wprost opisuje zapis warunkowy `PutObject` z `If-None-Match: *` (błąd, gdy klucz istnieje) oraz politykę bucketu z kluczami warunku `s3:if-none-match`/`s3:if-match` — <https://www.scaleway.com/en/docs/object-storage/api-cli/using-conditional-writes/> (strona zwraca 403 dla automatycznego pobrania; treść potwierdzona wyszukiwarką, kod odpowiedzi 412 i działanie `Null` pozostają do sprawdzenia przez `bucket-verify` w sesji IaC). Dlatego polityka zostaje bez zmian, a adapter `s3-deletion-register.ts` wysyła `If-None-Match: *`; odpowiedź 412 (klucz istnieje — UUIDv7 nigdy się nie powtarza) to zwykła porażka fail-closed (`DeletionRegisterUnavailable`), nie sukces idempotentny; ponowienie SDK po przerwanym, ale przyjętym zapisie też da 412 i operacja nie ruszy (wpis w rejestrze zostaje jako osierocony — RR-56). RR-55 (b): klucz rejestru w manifeście sekretów przeniesiony z `worker` do `api`, `compose.staging.yaml` daje `api` `DELETION_REGISTER_S3_SECRET_ACCESS_KEY_FILE` (pozostałe zmienne rejestru i mediów — endpoint, region, bucket, identyfikatory kluczy — nadal do podpięcia w sesji IaC, pkt 2 poniżej). Plan B, gdyby `bucket-verify` obalił warunek: usunąć warunek `Null` z Allow zapisu rejestru (ochrona: wersjonowanie, unikalny klucz, klucz bez Delete) i `IfNoneMatch` z adaptera.
  - **Do orkiestratora (poza torem T3):** (1) obraz `postgres-pgbackrest` musi przejść pipeline publikacji (skan, podpis) i dostać wpis w `infra-images.json` z prawdziwym digestem — do tego czasu `compose.infra.yaml` bez zmian; (2) podpięcie zmiennych `S3_ENDPOINT`, `S3_REGION`, `MEDIA_BUCKET`, `MEDIA_S3_*`, `DELETION_REGISTER_*`, `CLAMD_SOCKET` do `api`/`worker` w `compose.staging.yaml` — EVM-040/044; (3) Storage Box i jego subkonta tworzone ręcznie w sesji IaC (dostawca `hcloud` w zablokowanej wersji ich nie obsługuje).

## Dziennik
- 2026-10-13 — utworzono (product-owner, podział EVM-007 wg ADR-0018: dawne AC4 i część AC7)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
- 2026-10-27 — start realizacji (nocna kolejka, tor T3), gałąź feature/EVM-084-085-backupy-obserwowalnosc
- 2026-10-27 — plan gotowy (devops-engineer)
- 2026-10-27 — implementacja (devops-engineer, tor T3): moduł `object-storage` + reguły `bucketProblems`, mapowanie sekretów, orkiestrator/sprzątacz/scenariusz AC5/podpisany URL (testy na atrapach), pgBackRest (konfiguracja, obraz, kopie, kopia mediów), jednostki systemd, `bucket-verify`, runbook `restore.md`; nieaktywne do sesji IaC, status zostaje in-progress
- 2026-10-27 — poprawki po przeglądzie, runda 1 (devops-engineer, tor T3): sprzątacz z wartownikiem, `rclone sync`, macierz kluczy, SFTP w zaporze, punkt nazwany, sekrety recovery, rola, kontrakt wyniku, test etapu bazy w kontenerze
- 2026-10-28 — workflow passed (2 rundy), gate zielony (nocna kolejka, tor T3); kod nieaktywny do sesji IaC — status zostaje in-progress do dowodów (apply, test odtworzenia)
- 2026-10-29 — poprawka RR-55 (devops-engineer): adapter rejestru wysyła `If-None-Match: *` (zgodnie z polityką bucketu; dowód: dokumentacja Scaleway, wpis w „Decyzjach”), klucz rejestru przeniesiony z `worker` do `api` (manifest, compose staging, testy); weryfikacja na stagingu w sesji IaC (`bucket-verify`), status zostaje in-progress
- 2026-11-12 — decyzje Konrada przed sesją IaC (plan sesji: devops-engineer; podział na posiedzenia 0 → A → B → C): VM zostaje **CAX11** (bez podniesienia do CAX21 — posiedzenie 0 sprawdza budżet pamięci i dysku, ewentualne dostosowania do osobnej decyzji); object lock **COMPLIANCE 37 d** na `evia-staging-db-backup` i **GOVERNANCE 30 d** na mediach zaakceptowane; decyzje wykonawcze z „Decyzji i ograniczeń” zaakceptowane w całości (buckety tylko `pl-waw`, `If-None-Match: *` na rejestrze z planem B, osobny klucz `restore-orchestrator`, AC5 przez `--repo-target-time`, `rclone sync`, sprzątacz z wartownikiem); nowe zależności pgBackRest i rclone zaakceptowane (SR-SUPPLY-06); jednorazowa budowa obrazów `postgres-pgbackrest` i `evia-media-processor` w sesji (skan Trivy i SBOM w dowodach) + historyjka o ich publikacji w `publish`; odtworzenie sieci `evia-runtime` z krótką przerwą zaakceptowane; wariant Storage Boxa (BX11/BX21) przed posiedzeniem B po sprawdzeniu limitu snapshotów (orkiestrator)
- 2026-11-12 — posiedzenie 0 (bez chmury): gałąź feature/EVM-084-085-sesja-iac-przygotowanie — bucket eksportów EVM-052 w module `object-storage`, poprawki runbooków, budżet zasobów CAX11 (orkiestrator)
- 2026-11-12 — posiedzenie 0, K1 i K7 (devops-engineer): bucket `evia-staging-exports` (EVM-052; bez locka i wersjonowania, wygasanie po 1 d, bez CORS) w module `object-storage` z regułami `bucketProblems` i czwartym wierszem `bucket-matrix.tsv` (`MEDIA_EXPORT_BUCKET`); **bez nowych kluczy** — kod EVM-052 używa poświadczeń procesu dla obu bucketów, więc polityka rozdziela istniejące klucze `media-app` (odczyt) i `media-worker` (zapis, odczyt, usunięcie); aplikacji IAM i kluczy nadal siedem (w runbooku `restore.md` „sześciu” poprawione na „siedmiu” — `bucket-matrix.tsv` miał ich już siedem); runbook wdrożenia: adnotacje Arm64 ADR-0011/0018 są zaakceptowane 2026-10-21; AC bez zmian
- 2026-11-12 — decyzje Konrada po przeglądzie security kanału (posiedzenie 0): (1) poprawka `deploy.sh` w tej gałęzi — kształty wolumenów workera jak w weryfikatorze i kontrola prawdziwych montaży przed `up` (K8; kanał nie wdrażał wydań od #117, ~2026-10-31); (2) tylko worker dołącza do sieci `evia-scan`, `clamd` nie dołącza do `evia-runtime` (K9); (3) w posiedzeniu A dostarczamy wszystkie sekrety z manifestu (także hasło pgBackRest, klucz `backup_writer`, token zapisu Grafany; Bitwarden i zestaw offline przed pierwszą kopią); (4) RR-75/76 akceptowane wyłącznie z dm-crypt dla obszaru roboczego filmów i katalogu skanu `clamd` (orkiestrator)
- 2026-11-13 — decyzja Konrada „jedno środowisko, realne dane od startu”: EVM-062 połączona z tą historyjką (delty w „Poza zakresem”), bez osobnej produkcji; kopie i test odtworzenia po EVM-124 (posiedzenie B), najwyższy priorytet, ale **nie warunek startu użycia** (EVM-061 AC5); po pierwszym udanym teście odtworzenia znika zalecenie równoległych dotychczasowych narzędzi (product-owner)
- 2026-11-12 — decyzje Konrada o dopasowaniu do CAX11 (analiza: `.scratch/iac-session-2026-11-12/cax11-budget.md`): wariant A — `ConcurrentDatabaseReload no` w `clamd` (zgodnie z ADR-0009), `oom_score_adj` (postgres i caddy chronione, clamd i procesor pierwsze do zabicia), metryki i alerty pamięci/dysku hosta (zakres EVM-085 AC2); dm-crypt na **osobnym wolumenie Hetzner 20 GB** (nowy płatny zasób, ok. 4 zł/mies., cena do potwierdzenia w konsoli) z **kluczem efemerycznym** (losowany przy starcie, tylko w RAM; zawartość tymczasowa znika po reboocie) (orkiestrator)
- 2026-11-12 — przegląd security posiedzenia 0 (`main..ac869721`): akceptacja z poprawkami (L3–L5, dokumenty C-24/SR-INFRA-05 — w tej gałęzi). Decyzje Konrada: **M5** — akceptuje okno bez automatycznego cofnięcia do wydań sprzed aktualizacji weryfikatora (fail-closed), zamykane w posiedzeniu A drugim wdrożeniem i próbnym cofnięciem, plan B ręczny; **RR-78** — akceptacja warunkowa: obraz `evia-media-processor` z przypiętą wersją ffmpeg (`FFMPEG_VERSION`), Trivy 0 High/Critical bez uzasadnienia i SBOM przed pierwszym użyciem (dowody w `docs/qa/EVM-084/`) (orkiestrator)
- 2026-11-13 — posiedzenie A (Tech Lead, devops-engineer, security-engineer; Konrad): A0–A9, A11, A14 zrobione, A12 częściowo, A10 (procesor) odłożony do EVM-124 — [dowody](../../qa/EVM-084/posiedzenie-a-2026-11-13.md). Poprawki z prawdziwego API w #129 i #130. Decyzje Konrada: plan B RR-90 zaakceptowany z góry (niepotrzebny); ryzyko CVE-2026-78661 w Caddy tylko dla stagingu (#128). Status zostaje `in-progress` (posiedzenia B i C).
- 2026-11-13 — decyzja Konrada: **Storage Box odłożony** (kopia mediów poza Scaleway przez `rclone` — później, osobnym krokiem); posiedzenie B obejmuje kopie bazy pgBackRest do `evia-staging-db-backup` i test odtworzenia na tymczasowej VM, razem z posiedzeniem C, EVM-089 i przełączeniem na `panel.eviacharge.pl`, po scaleniu EVM-124. Media do tego czasu chroni wersjonowanie i GOVERNANCE 30 dni w buckecie (Tech Lead)
