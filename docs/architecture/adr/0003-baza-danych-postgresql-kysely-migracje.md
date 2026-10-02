# ADR-0003: Baza danych i migracje — PostgreSQL 18, Kysely, migracje expand → migrate → contract

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-002, EVM-005, EVM-007; ADR-0001, ADR-0002, ADR-0008, ADR-0010, ADR-0011

## Kontekst i problem
Potrzebujemy bazy dla modelu relacyjnego z elementami elastycznymi (parametry techniczne, konfigurowalne katalogi), kolejki zadań (ADR-0010), kanału zmian dla synchronizacji offline (ADR-0008) i dziennika audytu. Wymagania: polskie sortowanie i wyszukiwanie bez znaków diakrytycznych („Lodz” → „Łódź”), RPO ≤ 1 h (cel ≤ 15 min), RTO ≤ 8 h, szyfrowanie w spoczynku, baza niedostępna publicznie, osobne role (security-engineer), bezpieczne migracje przy działających starszych wersjach aplikacji mobilnej. Dwie decyzje: **silnik bazy** i **warstwa dostępu + migracje**. Miejsce hostowania (samodzielnie na VM vs usługa zarządzana) rozstrzyga ADR-0011.

## Kryteria decyzji — silnik
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Dojrzałość, wsparcie wersji, ekosystem | 5 | dane firmy na lata |
| Backup i PITR (narzędzia, odtwarzanie) | 5 | RPO/RTO z NFR |
| Polskie sortowanie i wyszukiwanie | 4 | wymaganie z wizji |
| Model relacyjny + JSON dla elastycznych pól | 4 | kompozycja zleceń |
| Koszt i swoboda hostingu (samodzielnie lub zarządzana) | 4 | budżet, plan wyjścia |
| Kolejka zadań w tej samej bazie | 3 | mniej komponentów (ADR-0010) |

## Kryteria decyzji — warstwa dostępu i migracje
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Bezpieczeństwo typów end-to-end | 5 | agenci AI, refaktoryzacje |
| Kontrola nad SQL (role, triggery, kolacje ICU, `CONCURRENTLY`, expand/contract) | 5 | wymagania bezpieczeństwa i migracji |
| Stabilność API (brak dużej migracji w horyzoncie) | 4 | koszt utrzymania |
| Widoczność zapytań (N+1, wydajność) | 3 | p95 < 1 s |
| Znajomość przez agentów AI | 3 | produktywność |
| Licencja i aktywność utrzymania | 3 | ASVS V15 |

## Rozważane opcje
**Silnik:** **A. PostgreSQL 18** · **B. MySQL 8.4 LTS**.
**Dostęp i migracje:** **A. Kysely 0.29** (typowany query builder) + wbudowany `Migrator` z migracjami w SQL · **B. Prisma ORM 7** (8.0 w fazie RC) · **C. Drizzle ORM 0.45** (1.0 w fazie RC) · **D. TypeORM**.

## Ocena
**Silnik**
| Kryterium (waga) | A | B |
|---|---|---|
| Dojrzałość i wsparcie (5) | 5 | 5 |
| Backup i PITR (5) | 5 | 4 |
| Polskie sortowanie i wyszukiwanie (4) | 4 | 4 |
| Relacyjny + JSON (4) | 5 | 4 |
| Koszt i swoboda hostingu (4) | 5 | 5 |
| Kolejka zadań w bazie (3) | 5 | 2 |
| **Suma ważona (maks. 125)** | **121** | **103** |

**Dostęp i migracje**
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Bezpieczeństwo typów (5) | 5 | 5 | 5 | 3 |
| Kontrola nad SQL (5) | 5 | 3 | 4 | 3 |
| Stabilność API (4) | 4 | 3 | 3 | 3 |
| Widoczność zapytań (3) | 5 | 3 | 4 | 2 |
| Znajomość przez agentów (3) | 4 | 5 | 4 | 4 |
| Licencja i utrzymanie (3) | 5 | 4 | 4 | 3 |
| **Suma ważona (maks. 115)** | **108** | **88** | **93** | **69** |

Uwagi: PostgreSQL 18 ma natywne `uuidv7()`, kolacje ICU, rozszerzenia `unaccent` i `pg_trgm`, dojrzały PITR (pgBackRest) i pozwala trzymać kolejkę pg-boss w tej samej bazie. Prisma: na 2026-10-02 linia 8.0 jest w RC (GA zapowiadane na październik 2026) — start na 7 oznacza rychłą migrację; schemat DSL utrudnia role, triggery i kolacje. Drizzle: stabilna 0.45, 1.0 wciąż RC ze zmianami łamiącymi. TypeORM: wolniejszy rozwój, słabsze typy. Wersje, licencje i daty wydań zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**PostgreSQL 18** (wsparcie do 2030-11-14) + **Kysely 0.29** (MIT) z generowaniem typów z bazy (`kysely-codegen`) i migracjami `Migrator` z Kysely (pliki TS zawierające jawny SQL przez tagowany szablon `sql`).

**Konwencje danych** (szczegóły w EVM-002): klucze `uuid` w wersji 7 (generowane przez klienta lub `uuidv7()` w bazie); `timestamptz` w UTC (prezentacja w `Europe/Warsaw`); kwoty jako `bigint` w groszach + waluta; `created_at`, `updated_at`, `version` (optymistyczna współbieżność), `deleted_at` (soft delete); JSONB tylko dla parametrów technicznych z walidacją schematem w aplikacji; tabele z właścicielem-modułem (ADR-0001).

**Polskie znaki:** baza utworzona z `--locale-provider=icu --icu-locale=pl-PL` (sortowanie wg polskiej kolacji); wyszukiwanie przez niezmienną funkcję `f_unaccent()` (rozszerzenie `unaccent`, mapuje m.in. ł→l) i kolumny generowane `search_text` z indeksem GIN `pg_trgm`. Test brzegowy „Lodz” → „Łódź” obowiązkowy (EVM-002/M1). Po aktualizacji obrazu z nową wersją ICU: `ALTER COLLATION … REFRESH VERSION` i `REINDEX` dotkniętych indeksów (procedura w runbooku EVM-007).

**Migracje — expand → migrate → contract:**
1. Migracje tylko do przodu, w repo, recenzowane; uruchamiane jako osobny krok wdrożenia **przed** startem nowej wersji, rolą migracyjną.
2. Każda migracja zgodna z poprzednią wersją aplikacji (N-1) i ze starszymi klientami mobilnymi: najpierw *expand* (nowe kolumny/tabele opcjonalne), potem *migrate* (backfill partiami jako zadanie w tle), na końcu *contract* (usunięcie starego) w **osobnym, późniejszym** wydaniu.
3. `lock_timeout`/`statement_timeout` w migracjach; indeksy `CREATE INDEX CONCURRENTLY`; zakaz `ALTER TYPE`/przepisywania dużych tabel bez planu.
4. CI: migracje na pustej bazie + test „migracja w górę na danych syntetycznych” w Testcontainers.

**Bezpieczeństwo bazy (wymagania security-engineer; ASVS V11, V13, V14):**
- **Baza niedostępna publicznie:** nasłuch tylko w wewnętrznej sieci kontenerów; brak publikowanego portu; firewall dostawcy przepuszcza wyłącznie 80/443 do reverse proxy (ADR-0011). Dostęp administracyjny tylko przez tunel SSH.
- **Osobne role:** `evia_migrator` (właściciel schematów, DDL; używana wyłącznie przez krok migracji), `evia_app` (DML na tabelach domenowych; na tabeli audytu wyłącznie `INSERT` i `SELECT` — **bez `UPDATE`/`DELETE`/`TRUNCATE`**; bez DDL i bez `SUPERUSER`), `evia_readonly` (wsparcie/raporty, tylko wybrane widoki), `evia_backup` (uprawnienia do backupu). Dodatkowo trigger odrzucający `UPDATE`/`DELETE` na audycie (obrona w głąb). Hasła ról tylko w sekretach.
- **Szyfrowanie w spoczynku:** katalog danych na wolumenie szyfrowanym LUKS (AES-XTS) — dostawca VM nie szyfruje dysków domyślnie (ADR-0011); backupy szyfrowane po stronie pgBackRest (`repo-cipher-type=aes-256-cbc`) i dodatkowo SSE w buckecie. Ryzyko rezydualne: klucz LUKS musi być dostępny przy starcie VM (plik klucza na dysku systemowym) — chroni przed wyciekiem wolumenu/snapshotu u dostawcy, nie przed przejęciem VM z uprawnieniami root (wejście do EVM-005).
- **Szyfrowanie pól (gotowość):** moduł `platform/crypto` z szyfrowaniem kopertowym AES-256-GCM (klucz główny z sekretów, identyfikator wersji klucza do rotacji, opcjonalny indeks HMAC do wyszukiwania). Włączamy, jeśli EVM-005 wskaże pola wrażliwe (np. PESEL wymagany przez proces formalny).
- **PITR i RPO/RTO:** pgBackRest — pełny backup co tydzień, różnicowy codziennie, ciągła archiwizacja WAL (`archive_timeout` = 60 s) do object storage innego dostawcy niż VM (ADR-0011) → **RPO ≤ 15 min** (typowo ~1 min), okno PITR **30 dni**; **RTO ≤ 8 h** (cel 4 h) według runbooka. **Niezmienność repozytorium:** bucket pgBackRest z wersjonowaniem i object lock w trybie compliance (retencja 37 dni = PITR + 7 dni), stare wersje usuwa lifecycle bucketu, a klucz z VM nie ma uprawnień do konfiguracji bucketu — przejęcie VM z root nie pozwala trwale usunąć backupów ani WAL (szczegóły i wariant zapasowy `repo2` na Storage Box: ADR-0011). Hetzner Backups VM **nie** obejmują wolumenu z danymi bazy. Test odtworzenia: automatycznie co miesiąc i przed każdym wydaniem — na tymczasowej VM w projekcie produkcyjnym (nie na staging), z weryfikacją i usunięciem VM.

## Konsekwencje
- **Pozytywne:** jeden silnik dla danych, kolejki i kanału zmian; pełna kontrola SQL (role, triggery, kolacje); typy generowane z rzeczywistego schematu; niezależność od dostawcy (standardowy PostgreSQL).
- **Negatywne / koszty:** migracje pisane ręcznie w SQL (więcej pracy niż generator Prisma); samodzielne utrzymanie PostgreSQL na VM (aktualizacje, backup, monitoring) — zautomatyzowane w EVM-007; Kysely nie ma relacji „include” — zapytania z joinami trzeba pisać jawnie (to też zaleta: brak ukrytego N+1).
- **Ryzyka i mitygacje:**
  - *Usunięcie backupów z przejętej VM (ransomware)* → object lock compliance na buckecie pgBackRest, klucz VM bez uprawnień do konfiguracji bucketu; scenariusz w runbooku odtworzenia (ADR-0011).
  - *Utrata danych przez błąd backupu* → monitorowanie wieku ostatniego WAL i backupu (alert), cykliczny test odtworzenia.
  - *Kysely przed 1.0 (0.29, 0.30 w becie)* → API stabilne od lat, aktualizacje minorów przez Renovate; zapytania to SQL — migracja na inny builder jest mechaniczna.
  - *Zmiana kolacji ICU po aktualizacji obrazu* → pinowanie digestu obrazu, procedura `REFRESH VERSION` + `REINDEX`.

## Plan wyjścia
PostgreSQL jest dostępny jako usługa zarządzana u wielu dostawców w UE (np. Scaleway Managed PostgreSQL z szyfrowaniem w spoczynku i PITR 7 dni) — migracja przez `pg_dump`/`pg_restore` lub replikację logiczną, kilka godzin przestoju planowego. Wymiana Kysely na inny builder/ORM dotyczy warstwy `infrastructure` modułów.

## Weryfikacja
- EVM-007: test odtworzenia PITR z raportem (czas odtworzenia, utrata danych) — RPO ≤ 15 min, RTO ≤ 8 h; test „kluczem z VM nie da się trwale usunąć backupu ani WAL” oraz odtworzenie po usunięciu obiektów kluczem z VM.
- M1: wyszukiwanie „Lodz” → „Łódź” i sortowanie Ł po L w testach; p95 list < 1 s na 10 tys. zleceń syntetycznych.
- CI: testy uprawnień ról DB (rola `evia_app` nie może `UPDATE`/`DELETE` na audycie).

## Źródła (zweryfikowane 2026-10-02)
- PostgreSQL 18 — wydanie i `uuidv7()`: https://www.postgresql.org/about/news/postgresql-18-released-3142/ ; polityka wersji (18 wspierany do 2030-11-14): https://www.postgresql.org/support/versioning/
- MySQL 8.4 LTS: https://dev.mysql.com/doc/relnotes/mysql/8.4/en/
- Kysely 0.29.6 (MIT, 2026-09-16), kysely-codegen 0.20.0 (MIT): https://www.npmjs.com/package/kysely , https://www.npmjs.com/package/kysely-codegen
- Prisma — status wydań (7.10.0 stabilna 2026-08-25; 8.0.0-rc.19 2026-09-29): https://www.prisma.io/docs/orm/release-status , https://www.npmjs.com/package/prisma
- Drizzle ORM 0.45.3 (Apache-2.0), 1.0 w RC: https://www.npmjs.com/package/drizzle-orm
- PostgreSQL — licencja **PostgreSQL License** (permisywna, typu BSD/MIT; zweryfikowane 2026-10-02): https://www.postgresql.org/about/licence/ , https://github.com/postgres/postgres/blob/master/COPYRIGHT
- pgBackRest 2.59.2 (2026-09-27): https://github.com/pgbackrest/pgbackrest/releases ; licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/pgbackrest/pgbackrest/blob/main/LICENSE
- Hetzner — brak domyślnego szyfrowania dysków, LUKS: https://community.hetzner.com/tutorials/encrypted-private-nextcloud-VPS-and-storagebox/
- Scaleway Managed PostgreSQL — szyfrowanie w spoczynku (plan wyjścia): https://www.scaleway.com/en/docs/managed-databases-for-postgresql-and-mysql/api-cli/setting-up-encryption-at-rest/
