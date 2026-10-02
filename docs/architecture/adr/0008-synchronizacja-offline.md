# ADR-0008: Synchronizacja offline — własny protokół: kolejka mutacji (outbox) + kanał zmian z kursorem

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: mobile-developer, security-engineer)
- **Powiązane:** EVM-001, EVM-002 (`offline-sync.md`), EVM-011 (spike), E10–E13 (M2); ADR-0003, ADR-0004, ADR-0005, ADR-0007, ADR-0009

## Kontekst i problem
Technik przegląda zlecenia, dodaje wpisy, zdjęcia, filmy i szybkie zlecenia **bez zasięgu**; po powrocie sieci wszystko ma trafić na serwer **bez strat i bez duplikatów**, a w tym czasie biuro zmienia te same zlecenia. Wymagania: identyfikatory nadawane na urządzeniu, idempotentne mutacje, kursory zmian, soft delete, jawna polityka konfliktów (dane z terenu najlepiej append-only), autoryzacja przy synchronizacji (były pracownik, skradziony telefon, replay — security-engineer). Media binarne mają osobny kanał (ADR-0009); ten ADR dotyczy danych i metadanych.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Zero utraty danych i przewidywalne zachowanie | 5 | zasada produktu „nic nie ginie” |
| Bezpieczeństwo (autoryzacja przy synchronizacji, filtrowanie uprawnieniami, replay) | 5 | ASVS V8, V2; CWE-639 |
| Prostota i kontrola nad protokołem | 4 | debugowanie problemów z terenu |
| Koszt i brak dodatkowych usług | 4 | budżet, jedna VM |
| Testowalność (deterministyczne testy w TS) | 4 | próg 95% dla sync |
| Dopasowanie do modelu (append-only z terenu, szyfrowana baza SQLCipher) | 3 | ADR-0007 |

## Rozważane opcje
1. **A. Własny protokół:** lokalna kolejka mutacji-komend (outbox) wysyłana partiami do API + pobieranie zmian kanałem z kursorem z PostgreSQL.
2. **B. PowerSync** (Open Edition, licencja FSL; osobna usługa replikująca Postgres → SQLite, reguły synchronizacji).
3. **C. WatermelonDB** + własny backend w jego protokole pull/push.
4. **D. Silniki „sync engine”** (Rocicorp Zero, ElectricSQL) — replikacja zapytań/kształtów danych.

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Zero utraty danych (5) | 5 | 4 | 4 | 3 |
| Bezpieczeństwo (5) | 5 | 4 | 4 | 3 |
| Prostota i kontrola (4) | 4 | 3 | 3 | 2 |
| Koszt / brak usług (4) | 5 | 3 | 5 | 3 |
| Testowalność (4) | 5 | 4 | 4 | 3 |
| Dopasowanie do modelu (3) | 5 | 4 | 2 | 3 |
| **Suma ważona (maks. 125)** | **121** | **92** | **94** | **71** |

Uwagi: B to dojrzały produkt, ale dodaje usługę do utrzymania i zabezpieczenia, licencję source-available (FSL) i przenosi autoryzację odczytu do reguł synchronizacji poza naszym modułem `authorization`. C: ostatnie wydanie WatermelonDB 0.28.0 z 2025-04-07 (wolne utrzymanie), własny adapter bazy utrudnia SQLCipher. D projektowane głównie dla aplikacji online z lokalnym cache, mniej dla długiej pracy offline z zapisem. Nasz zakres zapisu z terenu jest wąski i w większości **append-only** — własny protokół jest mały i w pełni testowalny. Wersje i licencje zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. Własny protokół synchronizacji** (pakiet `packages/sync-core` współdzielony przez mobile i testy; moduł `sync` w backendzie). Szczegóły i diagramy sekwencji: `offline-sync.md` (EVM-002 / EVM-011).

**Identyfikatory:** każdy obiekt tworzony na urządzeniu (wpis, komentarz, media, sesja uploadu, szybkie zlecenie) dostaje **UUIDv7** na urządzeniu. Serwer waliduje format, unikalność i **uprawnienia** — identyfikator nie jest sekretem ani dowodem dostępu (**UUIDv7 nie zastępuje kontroli dostępu**, CWE-639).

**Wysyłanie (push):**
- Lokalna tabela `outbox` w szyfrowanej bazie: `mutation_id` (UUIDv7 = **klucz idempotencji**), typ komendy (np. `CreateNote`, `CreateMediaAsset`, `CreateQuickWorkOrder`, `UpdateStageStatus`), ładunek, `base_version` (dla edycji), stan, liczba prób. Kolejność FIFO w obrębie obiektu; przetrwa restart telefonu.
- `POST /api/v1/sync/mutations` (partie do 50 mutacji). Dla każdej mutacji, w osobnej transakcji: (1) sesja i **urządzenie nadal ważne**, (2) **autoryzacja sprawdzana w momencie synchronizacji** względem bieżących ról i polityk obiektowych — a nie w momencie utworzenia na telefonie; odwołany użytkownik lub urządzenie → odrzucenie całej partii (`401 session_revoked`), utrata dostępu do obiektu → `rejected: forbidden`, (3) **idempotencja po stronie serwera** — klucz powiązany z `user_id` + `device_id`; powtórka zwraca zapisany wynik (`duplicate`), ten sam klucz z inną treścią → `rejected: idempotency_mismatch`; retencja kluczy 30 dni, (4) wykonanie komendy domenowej i zapis audytu.
- Wynik per mutacja: `applied` / `duplicate` / `conflict` (z aktualnym stanem) / `rejected` (kod). **Odrzucone mutacje nie są cicho usuwane** — trafiają na listę „Wymaga uwagi” w aplikacji (np. ponowne przypisanie wpisu do innego zlecenia), co realizuje zasadę „nic nie ginie”.

**Pobieranie (pull):**
- `GET /api/v1/sync/changes?cursor=…&limit=…` zwraca zmiany obiektów w **zakresie synchronizacji** użytkownika (np. aktywne zlecenia i powiązane dane — definicja zakresu w EVM-002) wraz ze znacznikami usunięcia (soft delete → operacja `delete`).
- Kursor = nieprzezroczysty token z numerem w **dzienniku zmian** (`sync_change_log`: monotoniczny `seq`, `xid8` transakcji, typ i id obiektu) zapisywanym w tej samej transakcji co zmiana. Odczyt tylko do „bezpiecznego horyzontu” (`xid8` < `pg_snapshot_xmin` bieżącego snapshotu), aby nie pominąć transakcji zatwierdzonych później niż przydzielony numer.
- **Kursory filtrowane uprawnieniami** przy każdym odczycie (ten sam silnik polityk co API, ADR-0001). **Utrata dostępu** (zmiana roli, odpięcie od zlecenia, dezaktywacja) → serwer oznacza urządzenie flagą `resync_required`; klient usuwa lokalne dane domenowe (nie kolejkę) i pobiera zakres od nowa — obiekty bez dostępu znikają z urządzenia.
- Retencja dziennika zmian i znaczników usunięcia: 90 dni; kursor starszy → `resync_required`.

**Polityka konfliktów (jawna):**
1. **Dane z terenu są append-only** (wpisy, komentarze, media, zdarzenia typu „wykonano pomiar”) — konflikty nie występują; kolejność w dzienniku wg czasu serwera.
2. **Edycje pól współdzielonych** (np. status etapu) z telefonu niosą `base_version`; gdy obiekt zmienił się w międzyczasie → `conflict` z aktualnym stanem — **bez cichego nadpisywania** (brak last-write-wins); użytkownik decyduje ponownie. W MVP mobile ograniczamy mutacje edycyjne do minimum (zakres w EVM-002).
3. Obiekt docelowy usunięty/zarchiwizowany w biurze → `rejected: target_unavailable`, dane zostają na urządzeniu na liście „Wymaga uwagi”.
4. **Znaczniki czasu klienta** (`captured_at`) są tylko metadanymi (zegar telefonu bywa błędny); **źródłem prawdy dla audytu i kolejności jest czas serwera** (`received_at`).

**Wyzwalanie synchronizacji:** przy otwarciu aplikacji, powrocie sieci, po zapisie nowej mutacji (gdy online) i okresowo w tle (best-effort: BGTaskScheduler / WorkManager). Urządzenie raportuje przy synchronizacji liczbę niewysłanych elementów (widoczna dla Administratora przed unieważnieniem urządzenia, ADR-0007).

## Ryzyka do sprawdzenia w spike'u EVM-011
1. **Brak duplikatów** przy wielokrotnych powtórzeniach tej samej partii (zerwane połączenie po zapisie na serwerze, przed odpowiedzią).
2. **Kolejność i zależności** w kolejce: `CreateMediaAsset` przed zakończeniem uploadu, wpis do szybkiego zlecenia utworzonego offline — po restarcie telefonu i zabiciu aplikacji.
3. **Rozmiar i czas pełnej synchronizacji** zakresu (np. 2 tys. zleceń) na szyfrowanej bazie; czas przyrostowej synchronizacji po dniu offline.
4. **Poprawność kursora** przy równoległych transakcjach (test serwerowy z opóźnionym commitem).
5. **Odrzucenie replay** po unieważnieniu urządzenia i zachowanie aplikacji (we współpracy z ryzykiem (c) w ADR-0007).
6. **Przesunięcie zegara telefonu** (godziny/dni) nie psuje kolejności ani audytu.

## Konsekwencje
- **Pozytywne:** pełna kontrola i jeden silnik autoryzacji dla API i synchronizacji; brak dodatkowej usługi i licencji; logika w TS testowalna jednostkowo (symulacje utraty sieci, powtórek, konfliktów).
- **Negatywne / koszty:** własny kod protokołu (kolejka, kursory, resync) — szacunkowo kilka historyjek w M2; dziennik zmian zwiększa liczbę zapisów w bazie (pomijalne przy tej skali).
- **Ryzyka i mitygacje:**
  - *Subtelne błędy kursora (pominięte zmiany)* → bezpieczny horyzont `xid8`, testy współbieżności, okresowy pełny resync kontrolny (np. co 7 dni).
  - *Rosnąca lista „Wymaga uwagi”* → widoczność w panelu biura, alert przy elementach starszych niż 3 dni.
  - *Zakres synchronizacji zbyt duży dla telefonu* → zakres zawężany regułą (aktywne + przypisane + ostatnie N dni), pomiar w spike'u.

## Plan wyjścia
Protokół jest ukryty za interfejsem `sync-core` (push/pull/resync). Przejście na PowerSync (lub inny silnik) wymaga wymiany warstwy transportu i schematu lokalnej bazy, przy zachowaniu komend domenowych po stronie serwera — szacunkowo 2–4 tygodnie; decyzję podejmujemy najpóźniej po wnioskach z EVM-011.

## Weryfikacja
- EVM-011: zero duplikatów i strat w scenariuszach spike'u; testy kursora zielone.
- M2: test terenowy (30 zdjęć, 3 filmy, 2 wpisy offline) bez duplikatów; pokrycie `sync-core` ≥ 95%, wynik testów mutacyjnych ≥ 70%.

## Źródła (zweryfikowane 2026-10-02)
- PostgreSQL — funkcje snapshotów (`pg_current_snapshot`, `pg_snapshot_xmin`, `xid8`): https://www.postgresql.org/docs/18/functions-info.html
- PowerSync Open Edition (FSL), `@powersync/react-native` 2.3.1: https://powersync.com/blog/powersync-open-edition-release , https://www.npmjs.com/package/@powersync/react-native
- WatermelonDB 0.28.0 (MIT, 2025-04-07): https://www.npmjs.com/package/@nozbe/watermelondb
- Rocicorp Zero 1.9.0 (Apache-2.0), ElectricSQL client 1.5.28 (Apache-2.0): https://www.npmjs.com/package/@rocicorp/zero , https://www.npmjs.com/package/@electric-sql/client
- RFC 9562 (UUIDv7): https://www.rfc-editor.org/rfc/rfc9562
- CWE-639 Authorization Bypass Through User-Controlled Key: https://cwe.mitre.org/data/definitions/639.html
