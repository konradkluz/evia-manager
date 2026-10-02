# ADR-0011: Hosting i środowiska w UE — Hetzner Cloud (obliczenia i baza) + Scaleway (storage, backupy bazy, e-mail) + Hetzner Storage Box (backup mediów)

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: devops-engineer, security-engineer)
- **Powiązane:** EVM-001, EVM-005 (`rodo.md` — podprocesorzy), EVM-006, EVM-007; ADR-0001, ADR-0003, ADR-0005, ADR-0009, ADR-0010, ADR-0012, ADR-0013

## Kontekst i problem
Decyzje Konrada (2026-10-02): **budżet infrastruktury MVP do ok. 300 zł/mies.** łącznie (hosting, baza, storage mediów ~500 GB, buildy mobilne), **brak preferencji dostawcy**, warunek: **region UE / zgodność z RODO**. Potrzebujemy: środowisk dev/staging/prod, PostgreSQL z PITR (RPO ≤ 15 min, RTO ≤ 8 h), object storage z SSE (ADR-0009), backupów poza głównym miejscem, skanu AV (8 GB RAM), e-maila transakcyjnego i minimalnego narzutu operacyjnego. Wymagania security-engineer: DPA i lista podprocesorów, jawne ryzyko CLOUD Act, szyfrowanie w spoczynku, separacja środowisk, MFA na konsolach, IAM najmniejszych uprawnień, brak publicznej ekspozycji bazy/kolejki/workerów, TLS 1.2+ i HSTS; **koszty muszą zawierać backup poza głównym miejscem, skan AV i MFA/IdP**.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Koszt MVP w budżecie ~300 zł/mies. (z backupem off-site, AV, MFA) | 5 | twardy warunek Konrada |
| Bezpieczeństwo i RODO (firma z UE, DPA, szyfrowanie w spoczynku) | 5 | baseline, CLOUD Act |
| Niezawodność i backup poza głównym miejscem | 4 | RPO/RTO, „0 utraconych plików” |
| Narzut operacyjny (usługi zarządzane vs samodzielne) | 4 | jedna osoba po stronie firmy |
| Brak lock-inu (standardy: Docker, PostgreSQL, S3, IaC) | 3 | odwracalność |
| Opóźnienie do użytkowników w Polsce | 2 | UX, upload |

## Rozważane opcje
1. **A. Hetzner + Scaleway (hybryda):** Hetzner Cloud (Niemcy) — VM z Docker Compose: reverse proxy, API, worker, media-processor, ClamAV, **PostgreSQL samodzielnie** (wolumen LUKS, pgBackRest); Scaleway (`pl-waw`) — object storage mediów, repozytorium backupów bazy, e-mail transakcyjny; Hetzner Storage Box (Finlandia) — szyfrowana kopia mediów.
2. **B. Wszystko w Scaleway** (`pl-waw`): instancje + **Managed PostgreSQL** (szyfrowanie w spoczynku, PITR do 7 dni) + object storage; kopia mediów w Hetzner Storage Box.
3. **C. OVHcloud:** instancje + Managed PostgreSQL + object storage (Warszawa/Francja).
4. **D. AWS `eu-central-1`:** EC2 + RDS + S3.

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Koszt MVP w budżecie (5) | 5 | 2 | 2 | 1 |
| Bezpieczeństwo i RODO (5) | 4 | 5 | 5 | 3 |
| Niezawodność i backup off-site (4) | 4 | 5 | 4 | 5 |
| Narzut operacyjny (4) | 3 | 4 | 4 | 4 |
| Brak lock-inu (3) | 5 | 4 | 4 | 2 |
| Opóźnienie do PL (2) | 4 | 5 | 4 | 4 |
| **Suma ważona (maks. 115)** | **96** | **93** | **87** | **70** |

Szacunek miesięczny MVP (netto, kurs NBP 2026-10-01: 1 EUR = 4,3770 zł, 1 USD = 3,8762 zł; szczegóły i założenia w `../README.md`): **A ≈ 192 zł**, **B ≈ 458 zł**, C wyżej niż B (Managed PostgreSQL Essential ok. 64 USD/mies. + od 2026-10-01 osobno płatne IPv4 i dysk lokalny), D wielokrotnie powyżej budżetu i podmiot z USA. **A i B są bliskie w ocenie** — A wygrywa wyłącznie budżetem, B daje mniej pracy operacyjnej (zarządzany PostgreSQL z szyfrowaniem i PITR) i jeden dostawca w Warszawie. Hetzner podniósł ceny dwukrotnie w 2026 r. (kwiecień i czerwiec), Scaleway od 2026-06-01, OVHcloud od 2026-10-01 — ceny zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. Hybryda Hetzner + Scaleway** — jedyna opcja mieszcząca się w budżecie MVP **z** backupem poza głównym miejscem, skanem AV i MFA. **Wariant B pozostaje rekomendowaną alternatywą**, jeśli Konrad woli mniej pracy operacyjnej kosztem ok. +280 zł/mies. (pytanie w `../README.md`). Przejście A → B jest proste (ten sam PostgreSQL, S3, Docker).

**Środowiska (pełna separacja):**
| Środowisko | Gdzie | Dane | Wdrożenie |
|---|---|---|---|
| dev | lokalnie na Windows 11: Docker Desktop (WSL2) lub Podman; Docker Compose z PostgreSQL 18, SeaweedFS (emulator S3), ClamAV, media-processor, Mailpit | syntetyczne (fabryki) | ręcznie |
| staging | Hetzner **CX23** (2 vCPU, 4 GB) w **osobnym projekcie** Hetzner; osobny projekt Scaleway, buckety i klucze; PostgreSQL w kontenerze | **wyłącznie syntetyczne** — zakaz kopiowania danych produkcyjnych | automatycznie z `main` (EVM-007) |
| prod | Hetzner **CX33** (4 vCPU, 8 GB, NVMe) w Niemczech (FSN1/NBG1) + wolumen LUKS na dane PostgreSQL; projekt Scaleway prod (`pl-waw`); Storage Box w Finlandii (HEL1) | produkcyjne | po akceptacji Konrada |

Osobne konta/projekty, klucze API, sekrety i domeny/subdomeny per środowisko; nic nie jest współdzielone między staging i prod.

**Sieć i ekspozycja:** Hetzner Cloud Firewall — ruch przychodzący tylko 80/443 do reverse proxy (Caddy) oraz SSH wyłącznie z listy dozwolonych adresów administracyjnych (kluczem, bez logowania roota). **PostgreSQL, kolejka (pg-boss), worker, ClamAV i media-processor nie mają publikowanych portów** — działają w wewnętrznej sieci Dockera; ClamAV i media-processor bez sieci w ogóle (ADR-0009).

**TLS:** Caddy z automatycznymi certyfikatami (Let's Encrypt), **TLS 1.2+ (preferowane 1.3)**, **HSTS** (`max-age=31536000; includeSubDomains`), przekierowanie HTTP → HTTPS. Połączenia do Scaleway, Sentry, Grafana — wyłącznie TLS.

**Szyfrowanie w spoczynku:** Hetzner nie szyfruje dysków VM domyślnie → dane PostgreSQL na wolumenie **LUKS** (ryzyko rezydualne w ADR-0003); object storage **SSE-ONE** (ADR-0009); backupy bazy szyfrowane przez pgBackRest + SSE; backup mediów szyfrowany po stronie klienta (`rclone crypt`). **Hetzner Backups i snapshoty VM obejmują wyłącznie dysk systemowy — nie dołączone wolumeny**, więc nie zawierają katalogu danych PostgreSQL; jedyną kopią bazy jest repozytorium pgBackRest (niżej).

**Backupy (automatyczne, szyfrowane, poza głównym miejscem) i test odtworzenia:**
| Co | Mechanizm | Gdzie (poza głównym miejscem) | Retencja | RPO |
|---|---|---|---|---|
| Baza | pgBackRest: pełny tydzień / różnicowy dzień / WAL ciągle | Scaleway Object Storage `pl-waw` (inny dostawca niż VM); bucket z **wersjonowaniem i object lock w trybie compliance** (domyślna retencja 37 dni) | PITR 30 dni; zablokowane wersje ≥ 37 dni | ≤ 15 min |
| VM (tylko dysk systemowy: system, konfiguracja) | Hetzner Backups (codzienne) — **bez wolumenu bazy** | Hetzner (to samo miejsce co VM; przyspiesza odtworzenie systemu, nie jest kopią danych) | 7 dni | 24 h |
| Media | wersjonowanie + object lock (30 dni) + `rclone sync` z szyfrowaniem | Hetzner Storage Box, Finlandia (inny dostawca i kraj niż storage) + snapshoty Storage Boxa | 30 dni wersji; snapshoty 14 dni | ≤ 24 h |
| Infrastruktura i konfiguracja | IaC w repozytorium | GitHub | historia git | — |

**Niezmienność backupu bazy (ochrona przed przejęciem VM / ransomware):** klucz pgBackRest leży na VM i musi móc zapisywać i usuwać (`expire`), więc sam IAM nie chroni repozytorium przed kimś z uprawnieniami root na VM. Dlatego:
- bucket backupów bazy tworzony z **wersjonowaniem i object lock** (Scaleway wymaga włączenia przy tworzeniu bucketu), domyślna retencja **w trybie compliance: 37 dni** (okno PITR 30 dni + 7 dni bufora) — nikt, także właściciel projektu, nie usunie ani nie nadpisze zablokowanej wersji przed upływem retencji;
- `expire` pgBackRest i nadpisanie plików `*.info` tworzą jedynie znaczniki usunięcia / nowe wersje; zablokowane wersje pozostają i można je przywrócić. Stare wersje usuwa **reguła lifecycle bucketu** (`NoncurrentVersionExpiration` po upływie retencji), zdefiniowana w IaC — nie klucz z VM;
- klucz na VM: aplikacja IAM ograniczona do tego jednego bucketu i operacji obiektowych; **bez** uprawnień do konfiguracji bucketu (wersjonowanie, lock, lifecycle, polityka), które ma wyłącznie klucz IaC używany z CI;
- koszt: zablokowane wersje zwiększają zajętość repozytorium o ok. 50% (uwzględnione w tabeli kosztów);
- wariant zapasowy, gdyby test w EVM-007 wykazał niezgodność object lock z pgBackRest: drugie repozytorium pgBackRest (`repo2`) na subkoncie Hetzner Storage Box ze snapshotami zarządzanymi poza VM (konsola/API Hetzner, nie klucz z VM).
Test odtworzenia bazy: automatycznie co miesiąc i przed każdym wydaniem na tymczasowej VM w projekcie prod (nie na staging); scenariusz **„backup usunięty z przejętej VM”** (przywrócenie zablokowanych wersji po usunięciu obiektów kluczem z VM, następnie odtworzenie PITR) w runbooku odtworzenia i w corocznym ćwiczeniu DR; test pojedynczego pliku mediów co miesiąc; pełne ćwiczenie odtworzenia (DR) raz w roku — **RTO ≤ 8 h**.

**Konta i IAM:** **MFA obowiązkowe** na wszystkich konsolach (Hetzner, Scaleway, GitHub, Expo, Apple, Google, Sentry, Grafana). Scaleway: osobne aplikacje IAM i klucze API per rola (API, worker, backup, IaC) z politykami ograniczonymi do projektu oraz polityką bucketu; Hetzner: tokeny API per projekt używane tylko przez IaC w CI (brak drobnoziarnistego IAM — ryzyko rezydualne). Sekrety wyłącznie w sekretach CI / zaszyfrowanych plikach (SOPS+age lub równoważne — EVM-006/007), nigdy w obrazach i repo.

**IaC i operacje:** OpenTofu (dostawcy `hcloud` i `scaleway`, szyfrowany stan w buckecie Scaleway), cloud-init, Docker Compose; aktualizacje bezpieczeństwa systemu automatycznie; obrazy aktualizowane przez Renovate (ADR-0012). Dostępność docelowa **99,5%/mies.**; prace planowe poza 7:00–19:00 (`Europe/Warsaw`).

**RODO — podprocesorzy (wejście do `rodo.md`, EVM-005):**
| Podmiot | Siedziba | Rola | Dane osobowe | Region przetwarzania | Umowa |
|---|---|---|---|---|---|
| Hetzner Online GmbH | Niemcy | VM, baza, backup VM, Storage Box | tak (wszystkie dane systemu) | DE, FI | DPA (AVV) w panelu klienta |
| Scaleway SAS (grupa Iliad) | Francja | storage mediów, backupy bazy, e-mail transakcyjny | tak (media, dokumenty, backupy, adresy e-mail) | PL (`pl-waw`) | DPA w warunkach usługi |
| Functional Software Inc. (Sentry) | USA | raporty błędów | ograniczone (pseudonimowe ID, po scrubbingu) | UE (Frankfurt) | DPA + SCC/DPF |
| Grafana Labs | USA | logi i metryki | ograniczone (logi z redakcją) | UE | DPA + SCC/DPF |
| GitHub Inc. (Microsoft) | USA | kod, CI | nie (kod, dane syntetyczne) | USA/UE | DPA (umowa klienta) |
| 650 Industries Inc. (Expo) | USA | buildy mobilne, podpisywanie | nie (kod, klucze podpisu) | USA | DPA na żądanie |
| Apple, Google | USA | dystrybucja aplikacji (TestFlight, Play) | nie (dane testerów: e-maile pracowników) | globalnie | warunki programów deweloperskich |
| Let's Encrypt (ISRG) | USA | certyfikaty TLS | nie (nazwy domen) | — | — |

**Ryzyko rezydualne CLOUD Act (jawnie):** główne dane (baza, media, backupy) są u **spółek z UE** (Hetzner — DE, Scaleway — FR), poza bezpośrednią jurysdykcją CLOUD Act; ryzyko pośrednie (obecność grup kapitałowych w USA) oceniamy jako niskie. Podmioty z USA (Sentry, Grafana Labs, GitHub, Expo, Apple, Google) nie przetwarzają danych klientów w treści — jedynie telemetrię po redakcji (Sentry, Grafana; regiony UE) lub kod i dane syntetyczne. Ryzyko: żądanie organów USA wobec tych podmiotów lub błąd redakcji ujawniający fragment danych. Mitygacje: redakcja i scrubbing (ADR-0013), regiony UE, DPA z SCC, minimalny zakres; plan wyjścia: samodzielnie hostowane GlitchTip/Grafana (ADR-0013). Do akceptacji Konrada w EVM-005.

## Konsekwencje
- **Pozytywne:** MVP ≈ 192 zł/mies. z rezerwą ok. 108 zł; dane w UE u europejskich firm; dwa niezależne miejsca (Hetzner, Scaleway) chronią przed awarią i przejęciem jednego konta; wszystko na standardach (Docker, PostgreSQL, S3) — łatwe przejście na wariant B.
- **Negatywne / koszty:** samodzielne utrzymanie PostgreSQL i VM (aktualizacje, backup, monitoring, LUKS) — zautomatyzowane w EVM-007, ale wymagające uwagi; dwóch dostawców = dwie konsole i dwa DPA; pojedyncza VM (dostępność 99,5%, nie 99,9%).
- **Ryzyka i mitygacje:**
  - *Kolejne podwyżki cen (2026: Hetzner ×2, Scaleway, OVH)* → rezerwa w budżecie, przenośność (IaC + standardy), przegląd kosztów co kwartał i alerty budżetowe.
  - *Przejęcie VM (ransomware, root) i próba usunięcia backupów* → object lock w trybie compliance na buckecie bazy i mediów, klucz z VM bez uprawnień do konfiguracji bucketu, snapshoty Storage Boxa zarządzane poza VM; scenariusz ćwiczony w teście odtworzenia.
  - *Awaria VM* → odtworzenie z IaC + PITR na nowej VM (RTO ≤ 8 h), ćwiczone.
  - *Błąd konfiguracji (publiczny port bazy, publiczny bucket)* → testy IaC/Trivy, test „anonimowy GET = 403”, skan portów z zewnątrz w CI po wdrożeniu (EVM-007).
  - *Presja budżetu na usunięcie backupu off-site lub AV* → pozycje wyodrębnione w tabeli kosztów; ich usunięcie wymaga nowego ADR i zgody Konrada.

## Plan wyjścia
- **A → B (Scaleway):** `pg_dump`/`pg_restore` lub odtworzenie z pgBackRest do Managed PostgreSQL, przeniesienie kontenerów na instancję Scaleway — 1–2 dni pracy, przestój planowy kilka godzin.
- **Zmiana dostawcy VM** (np. OVHcloud): te same obrazy i Compose, nowy moduł IaC — dni pracy.
- **Zmiana dostawcy storage'u:** ADR-0009 (rclone, standard S3).

## Weryfikacja
- EVM-007: staging postawiony z IaC od zera; skan portów (tylko 80/443 i ograniczony 22); test odtworzenia bazy (RPO/RTO w raporcie); **test niezmienności backupu bazy: kluczem z VM nie da się trwale usunąć backupu ani WAL** (usunięcie wersji i zmiana retencji/lifecycle/wersjonowania odrzucone; po `DELETE` kluczem z VM odtworzenie PITR nadal działa); zgodność `expire` pgBackRest z object lock (inaczej wariant `repo2`); test backupu mediów; MFA na wszystkich kontach (checklista).
- Kwartalnie: koszt rzeczywisty vs szacunek (`../README.md`); po 12 miesiącach: decyzja o lifecycle Glacier i rozmiarze VM.

## Źródła (zweryfikowane 2026-10-02)
- Hetzner — podwyżki 2026 (kwiecień, czerwiec): https://hostingjournalist.com/news/hetzner-to-significantly-raise-cloud-and-server-prices-in-2026 , https://northflank.com/blog/hetzner-cloud-server-price-increases
- Hetzner Cloud — ceny po 2026-06-15 (CX23 5,49 EUR, CX33 8,49 EUR, CX43 15,99 EUR; IPv4 0,50 EUR; backupy 20%; wolumeny 0,0572 EUR/GB): https://costgoat.com/pricing/hetzner , https://www.hetzner.com/cloud/cost-optimized/
- Hetzner — DPA, ISO 27001: https://www.hetzner.com/cloud-made-in-germany/ ; Storage Box: https://www.hetzner.com/storage/storage-box/
- Scaleway — ceny instancji (PLAY2-MICRO 40,20 EUR, PLAY2-NANO 20,10 EUR): https://www.scaleway.com/en/pricing/virtual-instances/ ; Managed PostgreSQL (DB-DEV-S 11,41 EUR; wolumen 0,0993 EUR/GB; backupy 0,03 EUR/GB): https://www.scaleway.com/en/pricing/managed-databases/ ; IPv4 (0,005 EUR/h): https://www.scaleway.com/en/pricing/network/ ; zmiany cen od 2026-06-01: https://www.scaleway.com/en/blog/a-transparent-update-on-scaleway-pricing/ ; region Warszawa: https://www.scaleway.com/en/news/scaleways-public-cloud-is-now-available-in-its-new-eastern-european-region-in-warsaw/
- OVHcloud — zmiany cen od 2026-10-01: https://blog.ovhcloud.com/en/posts/public-cloud-pricing-update-october-2026/ ; Managed PostgreSQL: https://us.ovhcloud.com/public-cloud/postgresql/
- Kurs NBP, tabela 191/A/NBP/2026 z 2026-10-01 (EUR 4,3770; USD 3,8762): https://api.nbp.pl/api/exchangerates/tables/A/2026-10-01/
- Caddy 2.11.6 (Apache-2.0, 2026-10-01): https://github.com/caddyserver/caddy/releases ; OpenTofu 1.13.1 (MPL-2.0, 2026-10-01): https://github.com/opentofu/opentofu/releases
- Mailpit (lokalny serwer pocztowy dev) — licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/axllent/mailpit/blob/develop/LICENSE ; Docker Desktop — licencja komercyjna, bezpłatna dla małych firm (< 250 pracowników **i** < 10 mln USD przychodu rocznie), EVia Charge się mieści; alternatywa Podman (Apache-2.0) (zweryfikowane 2026-10-02): https://docs.docker.com/subscription/desktop-license/ ; Docker Compose — **Apache-2.0**: https://github.com/docker/compose/blob/main/LICENSE
- SeaweedFS 4.48 (Apache-2.0) jako emulator S3 (MinIO w trybie utrzymania, repozytorium zarchiwizowane): https://github.com/seaweedfs/seaweedfs , https://rmoff.net/2026/01/14/alternatives-to-minio-for-single-node-local-s3/
- Scaleway — object lock (tryby governance/compliance, wymaga wersjonowania): https://www.scaleway.com/en/docs/object-storage/how-to/use-object-lock/ ; lifecycle (`NoncurrentVersionExpiration`): https://www.scaleway.com/en/docs/object-storage/api-cli/lifecycle-rules-api/
- Hetzner Cloud — backupy i snapshoty obejmują dysk serwera, nie wolumeny: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
- Sentry — region UE we wszystkich planach: https://docs.sentry.io/organization/data-storage-location/
