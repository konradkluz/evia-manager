# ADR-0021: Synchronizacja offline — zakres urządzenia (reguła klienta, kontrolny resync w cieniu, migawka zlecenia), dziennik zmian z generycznego triggera i kursor z rotacją kluczy

- **Status:** Zaakceptowana (2026-10-27, Konrad)
- **Data:** 2026-10-27
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (do recenzji: security-engineer, mobile-developer, backend-developer)
- **Powiązane:** EVM-090, EVM-092, EVM-094, EVM-096, EVM-097, EVM-107 (M2, E9–E10); ADR-0008 (doprecyzowuje: zakres, resync, dziennik zmian, kursor — decyzja „własny protokół” bez zmian), ADR-0001 (granice modułów), ADR-0003 (migracje), ADR-0004 (kontrakt, kompatybilność), ADR-0005 (sekcja „Ścieżka mobilnego logowania” — addendum), ADR-0010 (retencja w workerze), ADR-0013 (metryki), ADR-0017 (wzorzec modułu-liścia z portami systemowymi); [`offline-sync.md`](../offline-sync.md) — punkty otwarte 4, 5, 11, 12 i zasada „serwer dostarcza w tej samej stronie”

## Kontekst i problem
ADR-0008 przyjął własny protokół (kolejka mutacji + kanał zmian z kursorem), a [`offline-sync.md`](../offline-sync.md) zostawił otwarte mechanizmy, bez których historyjki M2 (EVM-090 kontrakt, EVM-092 `sync-core`, EVM-096/097 API, EVM-107 aplikacja) nie mają jednoznacznych kryteriów akceptacji:
- **pkt 4 — wyjście z zakresu:** reguła klienta czy zdarzenia „wyjście z zakresu” z serwera;
- **pkt 11 — kontrolny resync:** częstotliwość i przebieg; dziś „usuń dane domenowe i pobierz od nowa”, co w garażu bez zasięgu zostawia technika z pustą listą, gdy pobieranie się przerwie;
- **pkt 12 — wejście do zakresu:** zasada „serwer dostarcza w tej samej stronie bieżący stan wszystkich encji powiązanych” wymaga, by serwer wiedział, czego urządzenie nie ma — a kanał zmian zawiera tylko obiekty zmienione (nowe zlecenie dla istniejącego klienta, przywrócenie, ponowne otwarcie po N dniach, nowa strona w etapie);
- **pkt 5 — zapis dziennika zmian:** generyczny trigger czy port w `platform`; limit czasu transakcji i metryka horyzontu (długa transakcja wstrzymuje pobieranie);
- **kursor:** klucz serwera z rotacją — kursor żyje 90 dni (retencja dziennika), więc zmiana klucza nie może masowo unieważniać urządzeń; SR-SYNC-07 wymaga wiązania z użytkownikiem i urządzeniem.

Stan w kodzie (2026-10-27): PostgreSQL 18.6 (`transaction_timeout` od PG 17); wszystkie tabele podrzędne zlecenia mają `work_order_id`; `platform/crypto/opaque-cursor.ts` — kursory paginacji panelu (AES-256-GCM, AAD = operacja, wiązanie z `userId`, TTL 30 min, jeden klucz `CURSOR_KEY`); pula API ma `statement_timeout = 2 s`; wzorzec funkcji `SECURITY DEFINER` z przypiętym `search_path` — migracja `0032_idempotency_purge`; reguła dependency-cruiser `api-system-ports-only-from-overview` pozwala na porty systemowe tylko modułowi `overview`.

Ograniczenia: zasada „nic nie ginie” (kolejka i obiekty lokalne oczekujące nigdy nie są usuwane przez synchronizację), ASVS L2 / MASVS L2, jeden programista-agent na historyjkę, jedna VM, kompatybilność wsteczna API dla starszych aplikacji w terenie, próg pokrycia `sync-core` 95%.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Poprawność: brak cichej utraty zmian i dostępność repliki w terenie | 5 | „nic nie ginie”; technik w garażu musi widzieć zlecenia |
| Bezpieczeństwo: filtr polityk przy każdym odczycie, brak wycieku istnienia, odporność na fałszowanie | 5 | SR-SYNC-04, SR-SYNC-07, CWE-639 |
| Prostota: jeden mechanizm, mało kodu w dwóch miejscach (serwer + `sync-core`) | 4 | utrzymanie przez agentów, mniej przypadków brzegowych |
| Testowalność: deterministyczne testy TS i PostgreSQL w Testcontainers | 4 | próg 95% `sync-core`, scenariusze 1–6 z `offline-sync.md` |
| Koszt i wydajność: zapytania na stronę, zapisy w bazie, dane mobilne | 3 | jedna VM, LTE technika |
| Odwracalność i kompatybilność wsteczna kontraktu | 3 | aplikacje w terenie, ADR-0004 |

Maksimum sumy ważonej: 120. Skala 1–5 (5 = najlepiej).

## Rozważane opcje i ocena

### W1. Wyjście z zakresu (pkt 4)
1. **A. Reguła klienta + sprzątanie osieroconych obiektów** — serwer nie emituje nowego typu zdarzenia. Klient po każdym udanym pobraniu stosuje regułę N dni (`closedAt` + N, z konfiguracji serwera, czas wg `serverTime`) i usuwa encje bez kotwicy (klient, lokalizacja, strona, nazwa użytkownika), których nie wskazuje żadne lokalne zlecenie ani obiekt oczekujący. Usunięcie → znacznik `delete`; utrata dostępu → `resync_required`; dryf leczy kontrolny resync (W2).
2. **B. Zdarzenia serwera „wyjście z zakresu”** — wyjście czasowe (dzień N po `closedAt`) nie jest zmianą wiersza, więc wymaga zadania cyklicznego emitującego zdarzenia, a osierocenie klienta — śledzenia, co ma każde urządzenie (stan per urządzenie) albo rozgłaszania do wszystkich. Nowy typ w kontrakcie.
3. **C. Hybryda** — reguła klienta dla czasu, zdarzenia serwera dla osierocenia.

| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Poprawność (5) | 4 | 4 | 4 |
| Bezpieczeństwo (5) | 4 | 4 | 4 |
| Prostota (4) | 5 | 2 | 3 |
| Testowalność (4) | 5 | 3 | 4 |
| Koszt i wydajność (3) | 5 | 2 | 4 |
| Odwracalność (3) | 5 | 3 | 4 |
| **Suma ważona** | **110** | **75** | **92** |

Bezpieczeństwo A = B: w obu wariantach dane, które urządzenie legalnie miało, mogą zostać do najbliższego pobrania; utrata dostępu i tak idzie ścieżką `resync_required` z natychmiastowym usunięciem (W2).

### W2. Kontrolny resync (pkt 11)
1. **A. Co 7 dni, sterowany serwerem, „w cieniu”** — serwer zwraca `resync_required` z powodem `periodic`, gdy od `sync.device_sync_state.last_full_sync_at` minęło 7 dni. Klient pobiera nową replikę obok starej (nowa generacja), stara pozostaje widoczna do kompletu; podmiana atomowa jedną transakcją lokalną; przerwanie zostawia starą replikę i wznawia się od kursora migawki.
2. **B. Co 7 dni, klasycznie** — usunięcie danych domenowych, potem pobranie od nowa (obecny tekst `offline-sync.md`).
3. **C. Bez okresowego resyncu, sumy kontrolne zakresu** — serwer liczy skróty agregatów, klient porównuje i dociąga różnice.

| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Poprawność i dostępność repliki (5) | 5 | 2 | 4 |
| Bezpieczeństwo (5) | 5 | 5 | 4 |
| Prostota (4) | 4 | 5 | 2 |
| Testowalność (4) | 4 | 5 | 3 |
| Koszt i wydajność (3) | 3 | 3 | 4 |
| Odwracalność (3) | 5 | 5 | 3 |
| **Suma ważona** | **106** | **99** | **81** |

### W3. Wejście do zakresu (pkt 12)
1. **A. Emisja zmian zależnych** — trigger lub komenda domenowa zapisuje w dzienniku `upsert` encji powiązanych (klient, lokalizacja, etapy, wpisy) przy każdym zdarzeniu wejścia. Wymaga rozpoznania „wejścia” w bazie (ponowne otwarcie po N dniach zależy od konfiguracji, rozszerzenie dostępu od M4 to inna tabela) i dubluje cały agregat dla wszystkich urządzeń.
2. **B. Serwer rozwija agregat przy odczycie strony** — serwer nie wie, czego urządzenie nie ma, więc musiałby rozwijać każde zlecenie w pełny agregat (strony puchną) albo znakować „wejście” heurystykami.
3. **C. Jeden mechanizm sterowany klientem: migawka zlecenia** — nieznane lokalnie zlecenie albo brakująca referencja → `GET /api/v1/sync/work-orders/{id}` (bieżący agregat w projekcji dla telefonu, polityki przy odczycie). Ten sam czytnik agregatu obsługuje pierwsze pobranie i resync (faza migawki w `GET /api/v1/sync/changes`).

| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Poprawność (5) | 4 | 5 | 4 |
| Bezpieczeństwo (5) | 4 | 5 | 5 |
| Prostota (4) | 2 | 3 | 5 |
| Testowalność (4) | 3 | 4 | 5 |
| Koszt i wydajność (3) | 2 | 2 | 4 |
| Odwracalność (3) | 3 | 4 | 5 |
| **Suma ważona** | **75** | **96** | **112** |

Poprawność C = 4: między zastosowaniem strony a migawką jest krótkie okno, w którym nowe zlecenie jest niewidoczne (nigdy niepełne); przy zerwaniu połączenia w tym oknie zlecenie pojawi się przy następnym połączeniu.

### W4. Zapis dziennika zmian (pkt 5)
1. **A. Generyczny trigger `sync.record_change()`** na tabelach synchronizowanych (`SECURITY DEFINER`, aplikacja ma na dzienniku tylko `SELECT`) + test kompletności.
2. **B. Port w `platform`** wołany przez repozytoria każdej ścieżki zapisu (API, CLI, purge, przywrócenie, migracje danych) — pominięcie wywołania = cicha utrata zmiany (fail-open).
3. **C. Subskrypcja zdarzeń domenowych** (jak `overview`, ADR-0017) — pokrycie zależy od kompletności zdarzeń; nie każda zmiana wiersza ma zdarzenie (np. `version`, purge, migracja danych).
4. **D. Dekodowanie logiczne WAL** (slot replikacji, `pgoutput`) — osobny konsument, ryzyko zapełnienia dysku przez porzucony slot, brak zapisu „w tej samej transakcji”.

| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Poprawność (5) | 5 | 3 | 3 | 4 |
| Bezpieczeństwo (5) | 5 | 4 | 4 | 4 |
| Prostota (4) | 4 | 4 | 3 | 1 |
| Testowalność (4) | 5 | 4 | 4 | 2 |
| Koszt i wydajność (3) | 4 | 4 | 4 | 2 |
| Odwracalność (3) | 4 | 4 | 4 | 2 |
| **Suma ważona** | **110** | **91** | **87** | **64** |

### W5. Kursor kanału zmian
1. **A. AES-256-GCM z istniejącego `CursorCodec`, rozszerzonego o listę kluczy** — szyfrowanie uwierzytelnione (tag GCM = MAC), treść niewidoczna dla klienta, jeden przejrzany i przetestowany kod dla kursorów panelu i synchronizacji.
2. **B. HMAC-SHA-256 nad jawną treścią z listą kluczy** — integralność bez poufności (klient widzi `txid`, `seq`, identyfikatory); druga konstrukcja kryptograficzna do przeglądu i testów.
3. **C. Stan kursora po stronie serwera** (klient trzyma tylko losowy uchwyt) — pozycja serwera rozjeżdża się z lokalnie zastosowaną stroną (strona wysłana ≠ zastosowana), zapis w bazie przy każdym pobraniu.

| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Poprawność (5) | 5 | 5 | 3 |
| Bezpieczeństwo (5) | 5 | 4 | 5 |
| Prostota (4) | 4 | 4 | 3 |
| Testowalność (4) | 5 | 4 | 3 |
| Koszt i wydajność (3) | 5 | 5 | 3 |
| Odwracalność (3) | 4 | 4 | 3 |
| **Suma ważona** | **113** | **104** | **82** |

Różnica A–B jest niewielka i wynika z ponownego użycia kodu i braku jawnej treści, a nie z siły integralności — obie opcje spełniają wymaganie security („podpisany kluczem serwera, cudzy lub zmieniony odrzucony”).

Informacje o PostgreSQL 18 (`transaction_timeout`, `idle_in_transaction_session_timeout`, `pg_current_snapshot`, `pg_snapshot_xmin`, `pg_current_xact_id`) zweryfikowane dnia 2026-10-27 (źródła na końcu). Opcje nie wprowadzają nowych zależności ani usług płatnych.

## Decyzja
Wybieramy **W1-A, W2-A, W3-C, W4-A, W5-A**, ponieważ dają jeden mechanizm dociągania stanu (czytnik agregatu zlecenia) dla trzech przypadków, nie wymagają od serwera wiedzy o zawartości urządzenia, a zapis dziennika jest fail-closed niezależnie od ścieżki zapisu.

### D1. Wyjście z zakresu — bez nowego typu zdarzenia
- Serwer gwarantuje jedno: **nie wysyła obiektów spoza zakresu** (filtr zakresu i polityk przy każdym odczycie, SR-SYNC-04).
- (a) **czasowe** — zlecenie `settled`/`cancelled` z `closedAt` starszym niż N dni (N z `meta/client-config`, D7) usuwa klient razem z obiektami podrzędnymi; czas odniesienia = ostatni `serverTime`, nie zegar telefonu;
- (b) **usunięcie w biurze** — znacznik `delete` (typ, id, `version` — bez danych osobowych);
- (c) **osierocenie** — klient, lokalizacja (z ładowarkami), strona i nazwa użytkownika, których nie wskazuje żadne lokalne zlecenie ani obiekt oczekujący, są usuwane lokalnie;
- (d) **utrata dostępu** — `resync_required` z powodem `access_changed` (D2);
- (e) **dryf** — leczy kontrolny resync (D2).
- Sprzątanie (a) i (c) uruchamia `sync-core` **po każdym udanym cyklu pobierania, po dociągnięciu migawek** (D3), nigdy offline. Obiekty lokalne oczekujące i kolejka nie są usuwane (zasada 2 `offline-sync.md`).
- **Znacznik `delete` przechodzi przez filtr według stanu obiektu sprzed usunięcia** (zakres i polityka kotwicy) — ogranicza wyciek istnienia do obiektów, które urządzenie mogło mieć. Po trwałym usunięciu (purge, anonimizacja), gdy kotwicy już nie ma, znacznik jest dostarczany — zawiera tylko typ i losowy UUIDv7.

### D2. Kontrolny resync co 7 dni, sterowany serwerem, w cieniu
- `sync.device_sync_state` (moduł `sync`, nie `identity`): `device_id`, `last_full_sync_at`, `resync_requested_reason`, `updated_at`. Serwer zwraca `resync_required` z powodem `periodic`, gdy `now() − last_full_sync_at ≥ 7 dni` (wartość w konfiguracji serwera i w `meta/client-config`); `last_full_sync_at` ustawia serwer w chwili wydania kursora przejścia z fazy migawki do fazy zmian.
- **Powody `resync_required`** (słownik rozszerzalny — klient traktuje nieznany powód jak `periodic`, ADR-0004): `periodic`, `access_changed`, `scope_changed`, `cursor_expired`, `cursor_invalid`.
- **Resync w cieniu** (wszystkie powody poza `access_changed`): klient pobiera nową generację repliki obok starej (rekomendacja dla EVM-092/093: kolumna `generation` w tabelach repliki i aktywna generacja w metadanych bazy), UI czyta starą do kompletu; podmiana i usunięcie starej generacji — jedna transakcja lokalna. Przerwanie zostawia starą replikę i kursor fazy migawki nowej generacji; ponowienie kontynuuje od niego. W trakcie resyncu stara replika nie przyjmuje przyrostów (resync trwa minuty).
- **`access_changed` — natychmiast:** klient usuwa replikę (nie kolejkę i nie obiekty oczekujące) przed pobraniem — obiekty bez dostępu znikają od razu (ADR-0008).
- **Zmiana dostępu wykrywana leniwie:** kursor niesie rolę użytkownika z chwili wydania (D6); inna rola przy odczycie → `access_changed`. Moduł `sync` nie subskrybuje zdarzeń `identity`; od M4 (przypisania Montera) — rozszerzenie odcisku dostępu w kursorze, osobna decyzja.

### D3. Wejście do zakresu — migawka zlecenia jako jedyny mechanizm dociągania
- Nowa operacja **`GET /api/v1/sync/work-orders/{id}`** (kanał `mobile`, role Administrator i Edytor, `Cache-Control: no-store`): bieżący agregat zlecenia w projekcji dla telefonu — zlecenie, pozycje zakresu, procesy i etapy, przypisania, wpisy dziennika, klient, lokalizacja z ładowarkami, strony wskazane w lokalizacji i etapach, nazwy wskazanych użytkowników (od E6 — metadane mediów i dokumentów), każdy obiekt z `version`. Zlecenie nieistniejące, usunięte, poza zakresem albo bez dostępu → jednakowe `404 not_found` (api-guidelines: istnienie jest informacją); klient usuwa wtedy lokalną kopię (poza obiektami oczekującymi).
- **Wyzwalacz po stronie klienta:** `upsert` obiektu, którego kotwica (zlecenie) jest nieznana lokalnie, albo który wskazuje nieznaną lokalnie encję (`customerId`, `siteId`, `managerPartyId`, `distributionSystemOperatorPartyId`, `waitingOnPartyId`, identyfikatory użytkowników) → zlecenie trafia na trwałą listę dociągnięć (w tej samej transakcji co strona i kursor), a rekord z nierozwiązaną referencją nie jest stosowany do repliki. **Nowe zlecenie jest niewidoczne w UI do zastosowania migawki, znane zlecenie pokazuje poprzedni stan** — nigdy niepełny szkielet. Każde dociągnięcie to sygnał diagnostyczny (`sync_hydration_total{reason}`, EVM-092 AC5).
- **Pierwsze pobranie i resync** to ta sama migawka, stronicowana po agregatach w `GET /api/v1/sync/changes`: kursor ma fazę `snapshot` (pozycja = ostatni `work_order_id` w porządku UUIDv7) i zapamiętaną **przed** migawką pozycję dziennika `(pg_snapshot_xmin, 0)`; konfiguracja globalna (katalog, szablony) idzie na początku. Po ostatniej stronie migawki kursor przechodzi w fazę `changes` od tej pozycji. Poprawność: transakcje z `txid` poniżej zapamiętanego horyzontu są w migawce, późniejsze — w dzienniku; zlecenie utworzone w trakcie migawki „za” pozycją przyjdzie z dziennika i zostanie dociągnięte.
- **Strażnik wersji** w `sync-core`: nigdy nie zastępujemy nowszej `version` starszą (także dla `delete` — znacznik niesie `version`; trwałe usunięcie — `version` z `OLD`), więc kolejność migawek i stron nie ma znaczenia.
- **Jeden czytnik agregatu** w `modules/sync/application` dla trzech przypadków; odczyt partiami per typ encji (`id = any($ids)`), stała liczba zapytań na stronę (test liczby zapytań), odpowiedź parsowana schematem Zod kontraktu (pola spoza projekcji nie mogą wyciec — serializer z listą dozwolonych pól, test negatywny).
- **Zmienia zasadę** z `offline-sync.md` „serwer dostarcza w tej samej stronie bieżący stan wszystkich encji powiązanych” na: „strona zawiera tylko zmienione obiekty; kompletność agregatu zapewnia migawka zlecenia dociągana przez klienta przed pokazaniem zlecenia w UI”.
- **Ryzyko rozmiaru:** agregat > 1 MB (długi dziennik zlecenia). Pomiar w EVM-107 (nieblokujący); rezerwa — stronicowanie wpisów agregatu z flagą `timelineComplete: false` (zmiana addytywna).

### D4. Dziennik zmian — generyczny trigger `sync.record_change()`
- Funkcja PL/pgSQL `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, obiekty kwalifikowane schematem, właściciel `evia_migrator` (wzorzec migracji `0032`). Na każdej tabeli synchronizowanej dwa triggery `AFTER … FOR EACH ROW`: `INSERT OR DELETE` oraz `UPDATE … WHEN (OLD IS DISTINCT FROM NEW)`. Argumenty `TG_ARGV`: `entity_type` i nazwa kolumny kotwicy (`id` dla `work_orders`, `work_order_id` dla tabel podrzędnych, pusta dla `customers`, `sites` (z ładowarkami), `parties` i katalogu).
- Wiersz `sync.change_log`: `seq` (identity), `txid` = `pg_current_xact_id()`, `entity_type`, `entity_id`, `operation`, `work_order_id`, `entity_version`, `recorded_at` — **bez danych osobowych**. Mapowanie: INSERT/UPDATE → `upsert`; UPDATE `deleted_at` null → nie-null → `delete`; DELETE (purge) → `delete`; przywrócenie → `upsert`. `StoredFile` → `upsert` właściciela (`MediaAsset`/`DocumentVersion`) — osobna funkcja w E6 (EVM-048).
- **Uprawnienia:** `evia_app` ma na `sync.change_log` wyłącznie `SELECT` (nie sfabrykuje ani nie skasuje wiersza) i nie ma `TRUNCATE` na tabelach synchronizowanych (trigger wierszowy go nie widzi); `session_replication_role` jest dla niej niedostępne. Retencja 90 dni: `sync.purge_change_log(batch, as_of)` (`SECURITY DEFINER`, partie) z zadania pg-boss w workerze.
- **Test kompletności (fail-closed):** rejestr `SYNCED_ENTITIES` w `modules/sync` (typ, tabela, kolumna kotwicy) == tabele z triggerem `sync.record_change` w `pg_trigger`; każda tabela w schematach modułów z zakresu (`work_orders`, `customers`, `sites`, `parties`, `procedures`, `timeline`, `catalog`) jest w rejestrze albo na jawnej liście `SYNC_EXCLUDED_TABLES` z uzasadnieniem (np. `catalog.payment_milestone_templates` — poza urządzeniem, `work_orders.number_counters` — tabela techniczna). Nowa tabela bez decyzji czerwieni test. Do tego: test uprawnień (`has_table_privilege`) i test mapowania operacji per encja (insert, update, update bez zmiany, soft delete, przywrócenie, purge).
- **Migracje danych** generują wiersze dziennika — w partiach; masowe przeliczenia zamiast tego podbijają wersję reguły zakresu (→ `scope_changed`, resync w cieniu). Triggera nigdy nie wyłączamy.
- Granice: trigger nie tworzy zależności kodu modułów domenowych od `sync` (ADR-0001 reguła 4); zależność w bazie biegnie `sync` → tabele domenowe.

### D5. Limity czasu transakcji i metryki horyzontu
- **Pula API** (opcje połączenia, jak `CONNECTION_OPTIONS` pg-boss): `statement_timeout = 2 s` (bez zmian), `idle_in_transaction_session_timeout = 10 s`, `transaction_timeout = 30 s`. **Worker i pg-boss:** `idle_in_transaction_session_timeout = 30 s`, `transaction_timeout = 5 min`; długie zadania pracują partiami krótkich transakcji. **Migrator:** bez limitów (DDL), migracje danych w partiach. Bez ustawień w `postgresql.conf` (dokumentacja odradza — dotyczą wszystkich sesji). `transaction_timeout` **kończy sesję** — pula musi odrzucić połączenie (test w EVM-096). Transakcje przygotowane (2PC) wyłączone (`max_prepared_transactions = 0`), bo omijają `transaction_timeout`.
- Horyzont `pg_snapshot_xmin` jest **wspólny dla całej instancji** — długa transakcja z przydzielonym `xid`, także w innej bazie tej instancji, wstrzymuje pobieranie (nie gubi zmian). Transakcje tylko do odczytu (`pg_dump`, raporty) `xid` nie dostają i horyzontu nie trzymają.
- **Metryki** (EVM-096 AC7, ADR-0013): `sync_horizon_lag_seconds` = wiek najstarszego zatwierdzonego wiersza dziennika powyżej horyzontu (liczony przez `evia_app` z `sync.change_log`, bez dodatkowych uprawnień) — dodatkowo, jeśli eksporter ma rolę z `pg_monitor`, wiek najstarszej transakcji z `backend_xid` w `pg_stat_activity`; `sync_changes_page_duration_seconds`, `sync_resync_required_total{reason}`, `sync_cursor_rejected_total{reason}`, `sync_hydration_total{reason}`.

### D6. Kursor — AES-256-GCM z listą kluczy i rotacją
- `CursorCodec` dostaje **pierścień kluczy**: nowa zmienna `SYNC_CURSOR_KEYS` w formacie `id:klucz` (jak `FIELD_ENCRYPTION_KEYS`, ten sam parser i walidacja startu; wymagana w produkcji, osobna od `CURSOR_KEY`). **Pierwszy klucz szyfruje, wszystkie otwierają.** Token: wersja, identyfikator klucza, nonce, szyfrogram, tag; AAD = wersja + identyfikator klucza + identyfikator operacji. Kursory panelu (`CURSOR_KEY`, 30 min) bez zmian.
- **Treść:** faza (`snapshot` | `changes`), pozycja (`txid`, `seq`) albo (pozycja dziennika sprzed migawki, ostatni `work_order_id`), `userId`, `deviceId`, rola, wersja reguły zakresu, generacja, czas wygaśnięcia (wydanie + 90 dni). Bez danych osobowych.
- **Rotacja planowa:** nowy klucz na początek listy; stary zostaje co najmniej 90 dni, potem usunięty (kursory nim zamknięte → `cursor_invalid`, resync w cieniu). **Kompromitacja:** natychmiastowe usunięcie klucza → wszystkie urządzenia przechodzą resync w cieniu (bez utraty danych). Klucz trafia do inwentarza kluczy (SR-CRYPTO-04), Bitwarden i wdrożenia na VM (ADR-0018).
- **Wynik odczytu** (jedna ścieżka klienta: porzucić kursor i wykonać resync w cieniu):
  - nie otwiera się (format, nieznany klucz, zły tag) → `resync_required` `cursor_invalid`; wygasł → `cursor_expired`; inna wersja reguły zakresu → `scope_changed`; inna rola → `access_changed`;
  - otwiera się, ale `userId` lub `deviceId` ≠ sesja → **`400 invalid_cursor`** (SR-SYNC-07) + zdarzenie bezpieczeństwa w logu; legalnie nie występuje.
  - Zły tag nie daje `400`, bo nie odróżnia manipulacji od klucza usuniętego przy rotacji, a odpowiedź `resync_required` nie daje napastnikowi niczego ponad jego własny zakres.

### D7. Parametry dla klienta w `GET /api/v1/meta/client-config`
Rozszerzenie istniejącej operacji (zmiana addytywna, publiczna, bez danych osobowych — rozstrzyga EVM-090 AC6) — *doprecyzowane w EVM-090: operacja `meta/client-config` nie istniała, więc powstała jako NOWA operacja `getClientConfig` — uwierzytelniona (kanał `mobile`, Administrator i Edytor), bez `426`; przed zalogowaniem minimalną wersję podaje publiczne `GET /api/health`*: `offlineContactWindowDays` (7), `closedWorkOrdersInScopeDays` (N = 30), `periodicResyncDays` (7), `scopeRuleVersion`. Zmiana N → nowa `scopeRuleVersion` → `scope_changed`.

### D8. Moduł `sync` i reguły `deps:check`
- `apps/api/src/modules/sync/` (warstwy jak w innych modułach, `index.ts`), schemat `sync` (`change_log`, `device_sync_state`). Zależy od `identity`, `authorization`, `work-orders`, `customers`, `sites`, `parties`, `procedures`, `timeline`, `catalog` przez `index.ts` i porty systemowe; mutacje mobilne (EVM-098/099) wołają komendy domenowe przez fasady modułów. **Nic nie zależy od `sync`.**
- `.dependency-cruiser.cjs`: nowa reguła `api-nothing-depends-on-sync` (wzór `api-nothing-depends-on-overview`: wolno tylko korzeniowi kompozycji, workerowi i CLI); `api-system-ports-only-from-overview` rozszerzona o `modules/sync/(application|infrastructure)/` (np. jako `api-system-ports-only-from-read-models`). Porty systemowe zwracają dane bez polityki — `sync` stosuje polityki z `authorization` przy każdym odczycie.
- Kod SQL `sync` (infrastruktura, migracje triggera) na liście `DATABASE_BOUND` (pokrycie z przebiegu integracyjnego).

## Ścieżka mobilnego logowania — należy do addendum ADR-0005
Nie jest decyzją tego ADR-u (dotyczy uwierzytelniania, nie synchronizacji); zapisana tu, żeby EVM-090/094 miały jedno źródło do czasu addendum ADR-0005 i aktualizacji `api-guidelines.md`:
- **Osobna rodzina operacji** obok sesji cookie: `mobileLogin` (`POST /api/v1/auth/mobile/login`), `mobileLoginTotp` (`…/login/totp`), `refreshMobileSession` (`…/token`), `mobileLogout` (`…/logout`) — bez parametru kanału w istniejących operacjach (SR-AUTHZ-12: kanał nadaje ścieżka logowania).
- **`channels` dozwolone przy `public: true`** (domyślnie `[web]`); operacja publiczna z `mobile` musi być na listach publicznych i mobilnych; publiczne `web` zachowują kontrolę `Origin`/`Sec-Fetch-Site`, mobilne ignorują ciasteczka i niczego nie ustawiają w `Set-Cookie`.
- **`securitySchemes`** `mobileBearer` i `webSession` — `security` tylko na nowych operacjach mobilnych (istniejące operacje web bez zmian, brak zmiany łamiącej); źródłem prawdy autoryzacji pozostaje `x-evia-authz`. Resolver wybiera poświadczenie wg kanału operacji (web — tylko ciasteczko, mobile — tylko `Bearer`); „nie to” poświadczenie jest ignorowane.
- **`deviceId` nadaje serwer** przy pierwszym logowaniu; ponowne logowanie podaje parę `deviceId` + sekret instalacji (porównanie stałoczasowe skrótu).
- **Odstępstwo od ADR-0005 do addendum:** ADR-0005 przy ponownym użyciu refresh tokenu unieważnia rodzinę tokenów **i urządzenie**; konsultacja security rekomenduje „Wyloguj urządzenie” (rodzina unieważniona, urządzenie zostaje zarejestrowane, kolejka wstrzymana) + alert.

## Konsekwencje
- **Pozytywne:** jeden czytnik agregatu dla pierwszego pobrania, resyncu i wejścia do zakresu; serwer bez stanu „co ma urządzenie”; dziennik kompletny niezależnie od ścieżki zapisu (API, CLI, purge, migracja danych) i odporny na fałszowanie przez aplikację; technik nie traci listy zleceń przy przerwanym resyncu; rotacja klucza kursora bez masowych resynców; kontrakt rośnie wyłącznie addytywnie.
- **Negatywne / koszty:** logika zakresu po stronie klienta (reguła N, sprzątanie, lista dociągnięć, generacje) — więcej kodu w `sync-core` (próg 95%); dodatkowe żądania przy wejściu do zakresu; tymczasowo podwójna replika w trakcie resyncu (miejsce na telefonie) i cotygodniowy transfer pełnego zakresu; nowy sekret `SYNC_CURSOR_KEYS` (konfiguracja na VM, inwentarz kluczy); trigger na każdej tabeli synchronizowanej (pomijalny koszt przy tej skali); logika w PL/pgSQL testowana wyłącznie integracyjnie.
- **Ryzyka i mitygacje:**
  - *Agregat > 1 MB* → pomiar w EVM-107, rezerwa stronicowania wpisów (addytywnie).
  - *Dryf repliki przez błąd sprzątania* → kontrolny resync co 7 dni, testy scenariuszy 3 i 5 `offline-sync.md`, sygnał `sync_hydration_total`.
  - *Nowa tabela bez triggera* → test kompletności fail-closed.
  - *Długa transakcja wstrzymuje pobieranie* → `transaction_timeout`, metryka i alert `sync_horizon_lag_seconds`.
  - *Wyciek istnienia przez znaczniki* → filtr wg stanu sprzed usunięcia; znaczniki bez danych osobowych.
  - *Brak miejsca na drugą generację* → pomiar w EVM-107; przy braku miejsca resync klasyczny tylko na żądanie użytkownika, z ostrzeżeniem (decyzja w EVM-092, jeśli pomiar to wykaże).

## Plan wyjścia
- **W3 → serwerowe rozwijanie (W3-B):** migawka i czytnik agregatu zostają; serwer dokłada agregaty do strony (np. na podstawie znacznika wejścia w dzienniku) — klient nadal toleruje strażnik wersji; koszt ok. 1 historyjki.
- **W4 → port w `platform` lub zdarzenia:** usunięcie triggerów migracją contract, ten sam format `change_log`; test kompletności przepisany na wywołania portu; koszt ok. 1 historyjki.
- **W5 → HMAC:** nowa wersja tokenu (bajt wersji), stare kursory → `cursor_invalid` → resync w cieniu; bez zmiany kontraktu.
- **W2:** częstotliwość to parametr konfiguracji (7 dni → więcej/mniej) bez wydania aplikacji; rezygnacja z cienia = tryb klasyczny w `sync-core`.
- Całość ukryta za interfejsem `sync-core` (push/pull/resync) — plan wyjścia ADR-0008 bez zmian.

## Weryfikacja
- EVM-096/097: scenariusze 5 i 6 `offline-sync.md` zielone na PostgreSQL w Testcontainers; test kompletności triggera i test uprawnień; test liczby zapytań na stronę; `400 invalid_cursor` dla cudzego kursora, `resync_required` dla zmienionego, wygasłego i po rotacji.
- EVM-092: scenariusze 1–3 i 5 w `sync-core` (≥ 95%), przerwany resync w cieniu zostawia starą replikę.
- EVM-107: pomiar rozmiaru agregatu, czasu pierwszego pobrania i resyncu (300 syntetycznych zleceń, SQLCipher), liczba dociągnięć w telemetrii.
- Przegląd po teście terenowym M2 (EVM-112): `sync_horizon_lag_seconds` p99 < 5 s, zero przypadków zlecenia bez klienta i adresu w UI.

## Do zrobienia po akceptacji
- `offline-sync.md`: punkty 4, 5, 11, 12 jako rozstrzygnięte (link do tego ADR-u), nowa zasada wejścia do zakresu, resync w cieniu, parametry D7, ścieżka `GET /api/v1/sync/work-orders/{id}`, sekwencja pull z fazą migawki.
- `api-guidelines.md`: nowa ścieżka techniczna, rozszerzenie `meta/client-config`; `domain-model.md`: `SyncChange.entity_version`, `DeviceSyncState`; `docs/architecture/README.md`: zależności `sync` na mapie modułów.
- Addendum ADR-0005 (sekcja „Ścieżka mobilnego logowania”); notka w ADR-0008 „doprecyzowana przez ADR-0021”.
- `requirements.md`: SR-SYNC-07 — doprecyzowanie podziału `400 invalid_cursor` / `resync_required` (security-engineer).

## Aneks (EVM-094): słownik audytu a baseline kontraktu
- Słowniki `AuditAction`, `AuditObjectType` i `AuditReasonCode` to zamknięte enumy odpowiedzi; narzędzie baseline (EVM-090) uznaje dodanie wartości za zmianę łamiącą. Przyjmujemy ją świadomie: jedynym odbiorcą tych odpowiedzi jest panel (kompilowany razem z kontraktem, etykiety w `audit-labels.ts` z wyczerpującym typem `Record`), więc nowa wartość bez aktualizacji panelu nie przejdzie bramki typów; aplikacja mobilna nie czyta dziennika audytu.
- EVM-094 dodaje akcje `device.registered`, `device.recognized`, `device.wipe_confirmed`, `session.refreshed`, typ obiektu `device` i kody powodów (`refresh_reuse`, `device_inactive`, `secret_mismatch`, `previous_secret`, `channel_not_allowed`, `device_limit_reached`, `device_wipe_required`, `totp_not_configured`, `mfa_enrollment_required`, `session_revoked`); baseline przesunięty poleceniem `baseline:update -- --allow-breaking ADR-0021`. Kolejne historyjki rozszerzające słownik audytu powołują się na ten aneks. Alternatywa (`x-extensible-enum` + `string` w typach) odrzucona: traci wyczerpującą kontrolę etykiet w panelu. Do potwierdzenia przez Konrada razem z akceptacją EVM-094.
- EVM-096 dodaje akcję `sync.full_download` (pełne pobranie danych na urządzenie: rozpoczęte `success` albo odmówione limitem na dobę `denied`; obiekt `device`); baseline przesunięty z `--allow-breaking ADR-0021`. Liczby encji wg typu zapisuje też dziennik audytu (AC8): akcja `sync.full_download_completed` (koniec pobrania, `success`, obiekt `device`) niesie trzy nullowalne kolumny `work_order_count`, `customer_count`, `site_count` w `audit.events` (migracja 0053; wszystkie trzy albo żadna, tylko to zdarzenie; liczby całkowite, bez danych osobowych i wolnego tekstu); rejestr `sync.full_downloads` trzyma te same liczby na potrzeby limitu. Baseline przesunięty tym samym poleceniem.
- EVM-096, runda poprawek: kursor migawki jest związany z życiem pobrania (`completed_at`, `last_after`, `prev_after` w `sync.full_downloads`): przyjmowany tylko dla pobrania otwartego, młodszego niż doba i z pozycją ostatnio wydaną lub poprzednią (powtórka strony po zerwaniu sieci przechodzi, cofnięcie i odtworzenie po końcu dają `resync_required` `cursor_invalid`, `sync_cursor_rejected_total{reason="snapshot_replay"}` i zdarzenie bezpieczeństwa w logu). Skutek uboczny: zgubiona odpowiedź ostatniej strony migawki kosztuje kolejne pełne pobranie. Alert operatora „więcej niż 2 pełne pobrania w 24 h”: trzecie pobranie urządzenia w kroczącej dobie zapisuje alert bezpieczeństwa `sync_full_downloads_excess` w tej samej transakcji (jeden na okno; urządzenie wskazuje zdarzenie audytu `sync.full_download` o tym samym `traceId`). Baza alertu „pobiera od ponad 3 dni, nie wysyłając nic”: `sync.device_sync_state.last_pulled_at` (zapis najwyżej raz na godzinę); sam alert dopiero z EVM-098.
- Ustawienia puli zależą od procesu (D5): API 30 s / 10 s; worker i CLI przebudowy projekcji (`WORKER_POOL_SETTINGS`) 5 min / 30 s; migrator bez limitów (`MIGRATOR_POOL_SETTINGS`, opcje puli nie dziedziczą limitów API).
- EVM-097 dodaje akcję `sync.work_order_snapshot` (migawka zlecenia: pobrana `success` z liczbą encji w kolumnie `entity_count`, albo odmówiona limitem 120 na godzinę `denied` — jeden wpis na urządzenie i godzinę; obiekt `device`; bez treści encji i bez identyfikatora zlecenia); baseline przesunięty z `--allow-breaking ADR-0021`. Wersja reguły zakresu (`scopeRuleVersion`) jest pochodną N, licznika operatora i zbioru typów (`effectiveScopeRuleVersion`, int32), więc zmiana N w konfiguracji serwera zmienia ją sama; kursor niesie też rolę (`r`) i dla zlecenia dłuższego niż strona pod-kursor (`sub`).
- EVM-098 dodaje akcję `sync.mutation_applied` (zastosowana mutacja telefonu, `success`, obiekt `timeline_entry` = utworzony wpis) z trzema nullowalnymi kolumnami `audit.events`: `device_id`, `work_order_id`, `command_type` (migracja 0055; wszystkie trzy albo żadna, tylko to zdarzenie; `command_type` z zamkniętej listy `CreateNote`, `CreateComment` — EVM-099 rozszerza ją własną migracją; bez treści wpisu); `timeline` publikuje dalej `timeline_entry.created`, więc mutacja daje dwa wiersze audytu. Wpis z telefonu ma `created_via_device_id` (bez klucza obcego, niezmienny, poza projekcjami). Baseline przesunięty z `--allow-breaking ADR-0021`. Alert „pobiera od ponad 3 dni, nie wysyłając nic” — poza EVM-098, osobna historyjka.

## Źródła (zweryfikowane 2026-10-27)
- PostgreSQL 18 — `transaction_timeout`, `idle_in_transaction_session_timeout`, `statement_timeout`: https://www.postgresql.org/docs/18/runtime-config-client.html
- PostgreSQL 18 — `pg_current_snapshot`, `pg_snapshot_xmin`, `pg_current_xact_id`: https://www.postgresql.org/docs/18/functions-info.html
- PostgreSQL 18 — bezpieczne funkcje `SECURITY DEFINER`: https://www.postgresql.org/docs/18/sql-createfunction.html
- NIST SP 800-38D (GCM — szyfrowanie uwierzytelnione): https://csrc.nist.gov/pubs/sp/800/38/d/final
- EVM-097, poprawki po przeglądzie: korekta wpisu (INSERT z `supersedes_entry_id`) dopisuje do dziennika `upsert` oryginału (wyzwalacz `sync.record_superseded_change`, migracja 0054); pod-kursor `sub` niesie klucz `k` (`type:id`) ostatniej wysłanej encji zamiast numeru pozycji; znacznik `delete` użytkownika i kontrahenta wskazanego przez zlecenie jest tombstone'em rozwiązującym referencję (reguła klienta w `offline-sync.md`, punkt 12). Otwarte (do decyzji Konrada): opcjonalne `version` w `SyncDelete` (rekomendacja architekta, zmiana addytywna) albo zmiana AC2/AC5 na `type` + `id`; oraz czy usunięty (soft delete) użytkownik ma być serwowany jako `upsert` z nazwą, jak w panelu web (sprzeczne z literą AC2).
- EVM-097, poprawki po przeglądzie, runda 2 (wdrożone zgodnie z rekomendacją architekta i literą AC; do potwierdzenia przez Konrada): `SyncDelete` ma opcjonalne `version` (zmiana addytywna) - dla soft delete to najwyższa `entity_version` z dziennika dla obiektu, po purge pola nie ma; faza migawki `GET /sync/changes` dodaje do grupy zlecenia znacznik `delete` (bez `version`) dla wskazanego klienta, lokalizacji, kontrahenta lub użytkownika, który jest usunięty, tak jak faza zmian, więc żadna referencja nie zostaje nierozwiązana; `getSyncWorkOrder` zwraca tylko `entities` (kontrakt bez zmian) i polega na regule klienta z `offline-sync.md`, punkt 12.
