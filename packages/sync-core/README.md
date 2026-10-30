# `@evia/sync-core` — trwała kolejka mutacji i silnik wysyłki

Pakiet z EVM-091 (ADR-0007, `docs/architecture/offline-sync.md`: zasady 1, 2, 5 i „Wysyłanie”). Czysty TypeScript za portami: bez zależności uruchomieniowych, bez React Native, bez `node:*`, bez `Buffer`, `process`, `setImmediate`, timerów i `Math.random` (egzekwuje to ESLint `portableCore()` w `@evia/config` oraz reguła `sync-core-portable` w `deps:check`). Nie importuje `@evia/contracts`; zgodność z kontraktem sprawdza test w `test/` (devDependency tylko dla testów).

## Zasada

Wszystko, co technik zapisze, trafia do kolejki **przed** potwierdzeniem; mutacja znika dopiero po jawnym wyniku `applied` lub `duplicate` z pasującym `mutationId` (semantyka at-least-once, idempotencja po stronie serwera). Brak wyniku, nieznany wynik albo błąd nigdy niczego nie usuwa.

## Porty (`src/ports.ts`)

| Port           | Rola                                   | Uwagi dla implementacji                                                                                                                                                                                                                         |
| -------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QueueStore`   | trwały magazyn kolejki                 | Produkcja wyłącznie SQLCipher (EVM-093); zakaz AsyncStorage i plików niezaszyfrowanych (SR-MOB-01). `settle` usuwa mutację i przekazuje wynik konsumentowi w jednej transakcji. `readAll` zwraca wpisy w kolejności wstawienia, niezwalidowane. |
| `Transport`    | jedno wywołanie `POST /sync/mutations` | Mapuje wynik na `ok`/`http`/`network`; nie przekazuje komunikatów, treści odpowiedzi ani `cause`. `code` z ciała błędu tylko jako `^[a-z_]{1,64}$`.                                                                                             |
| `Clock`        | czas w ms                              | —                                                                                                                                                                                                                                               |
| `Random`       | losowość                               | W produkcji CSPRNG (`crypto.getRandomValues` / expo-crypto); używana przez UUIDv7 i jitter.                                                                                                                                                     |
| `SessionOwner` | bieżący `userId` i `refresh()`         | `refresh()` zapisuje nowy refresh token trwale przed użyciem nowego access tokenu i trzyma blokadę międzyprocesową (zadanie w tle). Wynik: `refreshed` / `session_revoked` (np. reuse) / `device_wipe_required` (polecenie wyczyszczenia, ma pierwszeństwo, EVM-100) / `unavailable`.                                         |
| `EventSink`    | diagnostyka i sygnały                  | Zdarzenia to zamknięta unia (`EngineEvent`): identyfikatory, enumy, liczby.                                                                                                                                                                     |

Testowy `InMemoryQueueStore` jest tylko w `test/` i nie jest eksportowany.

## Użycie

`createSyncCore(deps)` zwraca `{ queue, engine }`. `queue.enqueue(...)` nadaje UUIDv7 mutacji, wyprowadza `objectId` i `orderingKey` z ładunku (`payload.id` albo `workOrderId`; jawne wartości muszą być równe, inaczej `invalid_input`), bierze właściciela z `SessionOwner` (nie od wywołującego) i odrzuca mutację > 64 KB. `engine.flush()` jest single-flight (równoległe wyzwalacze łączą się w jedno wywołanie); `flush({ networkRestored: true })` ponawia od razu tylko to, co czeka na błąd sieci. `engine.status()` daje liczniki, wiek najstarszego wpisu, `nextAttemptAt` i powód pauzy dla wskaźnika; harmonogram wybudzenia należy do hosta (silnik nie ma timerów).

## Zachowanie

- **Kolejność:** FIFO po `orderingKey` (zlecenie); mutacja zależna (`parentMutationId`) czeka na wynik rodzica. Odrzucenie niezależnej mutacji nie blokuje innych; wstrzymane (`blocked`) są tylko jawnie zależne.
- **Partie:** ≤ 50 mutacji i ≤ ~900 KB treści; na drut idzie tylko `{mutationId, type, commandVersion, payload}` plus `pendingItems`. Koperta jest niezmienna (ponowienie = identyczne bajty, także starsza `commandVersion`).
- **Błędy przejściowe** (sieć, 5xx, 429, 408, zła odpowiedź, brak wyniku, `idempotency_in_progress`): backoff wykładniczy z limitem i pełnym jitterem; `Retry-After` (sekundy lub data) jako dolna granica, przycięta do 1 s – 1 h.
- **Odrzucenia** (`rejected`, `conflict`, nieznany wynik lub kod → `unknown`): „Wymaga uwagi”, dane zostają. `400`/`413` dla partii > 1: wysyłka pojedynczo, by wyizolować winną mutację.
- **Sesja:** `401 session_revoked` i `device_wipe_required` — pauza i sygnał (kolejka nietknięta; `device_wipe_required` jest stanem terminalnym); `401` bez kodu — jedno `refresh()` i jedno ponowienie, potem `auth_required`; `426` — pauza; `403` i nieoczekiwane statusy — pauza bez pętli. `resume()` po `session_revoked` tylko dla tego samego `userId` (SR-MOB-13). Wysyłane są wyłącznie wpisy bieżącego użytkownika, sprawdzane przed każdą partią.
- **Walidacja po odczycie (SR-MOB-10):** koperta i granice (typy, UUIDv7, `commandVersion` 1–1000, rozmiar). Uszkodzony wpis to `corrupt_record` (nieznany typ — `unknown_type`): nie jest wysyłany ani usuwany i nie blokuje reszty. Ładunek waliduje serwer.

## Polecenia

`pnpm --filter @evia/sync-core run test:coverage` (próg 95%, warstwa `sync`).

## Pobieranie zmian i resync (EVM-092)

Strona „pull” (`PullEngine`, `createSyncCore({ ..., pull })`; ADR-0021, `offline-sync.md`: „Pobieranie”, „Resync…”, „Zakres…”). Nadal bez zależności i bez importu `@evia/contracts` w runtime; zgodność typów z kontraktem sprawdza EVM-107. `core.sync()` to jeden cykl (single-flight): najpierw wysyłka kolejki, potem pobieranie. Pauza z dowolnej strony (401, `session_revoked`, 426, 403, `device_wipe_required`) zatrzymuje obie, a `resume()` jest wspólne (`SessionGate`).

### Nowe porty

| Port                   | Rola                                                    | Kontrakt dla adaptera (EVM-093 / EVM-107)                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PullTransport`        | `getChanges`, `getWorkOrderSnapshot`, `getClientConfig` | Wynik jak w `Transport`. **Segment ścieżki `{id}` koduje adapter (`encodeURIComponent`)**; rdzeń przekazuje wyłącznie UUID (waliduje je przed wywołaniem, CWE-22/CWE-918). Tylko TLS.                                                                                     |
| `ReplicaStore`         | jedyna trwała powierzchnia repliki                      | Docelowo SQLCipher (SR-MOB-01), nigdy AsyncStorage. **Każda metoda zapisu to jedna transakcja** (awaria w środku = brak zmian). Numery generacji nigdy nie wracają, więc odpowiedź pobrana przed `wipeReplica` nie da się zastosować po nim (`applyPage` zwraca `stale`). |
| `MonotonicClock`       | `monotonicNow()`, `bootId()`                            | `monotonicNow` musi być **ciągły w obrębie `bootId`** (Android: `SystemClock.elapsedRealtime`), nie per proces. Jeśli adapter ma tylko czas per proces, `bootId` = identyfikator procesu.                                                                                 |
| `PendingObjectsSource` | obiekty oczekujące                                      | Domyślnie wyprowadzone z `QueueStore` (`queuePendingSource`). **Zalecenie/wymaganie dla EVM-093:** odczyt kolejki w tej samej transakcji SQLCipher co `applyPage`.                                                                                                        |

### Kontrakt wydajności adaptera (bez N+1)

- `readVersions(generation, keys[])` i `findWorkOrdersBySite(generation, ids[])` dostają **całą stronę naraz**: jedno wywołanie na stronę. `readVersions` zwraca też wersje znaczników usunięcia (`deleted: true`).
- `sweep(rule)` i kaskada `delete` to **operacje zbiorowe**. Kaskadę opisuje statyczna mapa rodzic → dzieci po `type` (`CASCADE_CHILDREN` w `replica-rules.ts`: zlecenie → pozycje zakresu, etapy, wpisy, media po `workOrderId`); reguły sprzątania w `planSweep` (czas N dni wg `serverTime`, osierocone klient/lokalizacja/strona/użytkownik).
- `PendingObjectsSource` jest czytany raz na stronę i raz przed sprzątaniem.
- Adapter ponownie sprawdza `version` w transakcji (obrona w głąb): nigdy nie zastępuje nowszej wersji starszą ani znacznika usunięcia starszym upsertem.

### Model repliki

- **Generacje:** aktywna (czytana przez UI) i cieniowa (resync). Kursor, flaga „komplet”, lista dociągnięć i **znaczniki usunięcia `(type, id, version)`** należą do generacji; `promoteShadow` w jednej transakcji podmienia generację, usuwa starą (dane, znaczniki, listę) i przenosi kursor. Aktywna generacja nie przyjmuje przyrostów w trakcie resyncu. `beginShadow` kasuje poprzedni cień i czyści `pendingResync` w jednej transakcji.
- **Właściciel:** `ownerUserId` ustawia `applyPage`/`applySnapshot`. Replika innego użytkownika albo dane bez właściciela są usuwane (`wipeReplica`) **przed** jakimkolwiek odczytem lub pobraniem; kolejka nie jest ruszana.
- **Trwała intencja resyncu:** zmiana `invalid` zapisuje `pendingResync` w tej samej transakcji co strona i kursor, więc awaria przed startem cienia nie gubi resyncu.
- **Kursor** jest nieprzezroczysty: rdzeń sprawdza tylko wzorzec (`^[A-Za-z0-9_-]{16,1024}$`); zapis niezgodny albo nieczytelny = resync w cieniu z powodem `cursor_invalid`. Kursora nie logujemy.
- **Parser** (`pull-parse.ts`) jest domyślnie **tolerancyjny**, jak `parseSyncChange` z kontraktu (ADR-0004: dodanie pola to zmiana niełamiąca): brak pola, zła wartość, klucze `__proto__`/`constructor`/`prototype` lub przekroczony limit to `invalid` (`projection_mismatch`); pole spoza projekcji (w encji, w kopercie `upsert` i w `delete`) jest pomijane i nigdy nie kopiowane — zmiana jest stosowana, resync się nie planuje. Pola kopiowane są jedno po drugim z listy dozwolonych (bez spreadu). Nieznana wartość słownika rozszerzalnego jest zapisywana jako `unknown`, nieznany `type` jest pomijany. Opcja `strictProjection: true` (tylko testy kontraktowe) robi z nadmiarowego pola `invalid`.
- **Pierwsze pobranie**: `PullEngine.initialLoadDone()` (trwały, nigdy nie cofany znacznik generacji `initialLoadDone`) mówi, że pierwsze pobranie się skończyło. Do tego czasu aktywna replika może zawierać listę CZĘŚCIOWĄ, więc host pokazuje stan ładowania zamiast danych. Flaga `complete` to tylko stan cyklu (spada na stronach pośrednich przyrostu) i nie służy UI.
- **Replika innego użytkownika**: `visibility()` zwraca `{visible:false, reason:'owner_mismatch'}` od razu (bez sieci, przed pierwszym cyklem, który ją usunie).
- **Konfiguracja klienta** jest walidowana jak dane serwera: okno kontaktu 1–7 dni (konfiguracja może je skrócić, nie wydłużyć ponad 7), N 1–365 (domyślnie 30), resync kontrolny 1–90 (domyślnie 7); wartość spoza zakresu = domyślna.

### Ostatni kontakt i ukrywanie danych (AC7)

`ContactClock` zapisuje po **uwierzytelnionym 2xx** (push, pull, migawka; nie `health`/`meta`, nie 3xx/4xx/5xx/sieć) rekord `{serverTime, offset, bootId, mono, wall, carried, maxObservedWall}` przez `ReplicaStore.saveContact`. `pull.visibility()` ocenia: ten sam rozruch — upływ z czasu monotonicznego; po restarcie — z zegara ściennego z przenoszeniem sumy; fail-closed (dane ukryte, nie usunięte) przy cofnięciu zegara poniżej maksimum zaobserwowanego lub poniżej odczytu z chwili kontaktu (w ramie przesuniętej o `offset`, więc rozjazd ±2 min nie daje fałszywych alarmów), monotonicznym czasie mniejszym niż zapisany, NaN/ujemnym upływie, braku lub uszkodzeniu rekordu przy niepustej replice. `maxObservedWall` jest utrwalany przy każdej ocenie.

### Telemetria

`EngineEvent` to zamknięta unia: powody ze słownika, `type` ze słownika albo `unknown`, `count` jako liczba. Bez identyfikatorów, kursorów, `serverTime`, komunikatów wyjątków adaptera i treści zmian (test przechodzący po wszystkich zdarzeniach).

### Zachowanie przy błędach

Sieć, 429, 408, 5xx, zła odpowiedź i awaria magazynu: `retry` z wykładniczym opóźnieniem z jitterem (jak push; stan w pamięci). `404` na strumieniu zmian, `400` (w tym `invalid_cursor`) i inne statusy: **wstrzymanie samego pobierania** (`PullEngine.hold = 'unexpected_response'`, `PullResult.paused`); wysyłka kolejki (`flush`) działa dalej, a `SyncCore.resume()` zdejmuje wstrzymanie. We wspólnej pauzie sesji (`SessionGate`) zostają tylko 401/`session_revoked`/426/403/`device_wipe_required`. Niepoprawna zmiana podczas już trwającego resyncu nie startuje kolejnego (backoff, nic nie jest stosowane); po `MAX_INVALID_RESYNCS` (3) kolejnych porażkach pobieranie jest wstrzymane (`hold = 'replica_stale'`, sygnał `replica_stale`) — host pokazuje „dane mogą być nieaktualne”.

- **Zgodność magazynu**: wykonywalny kontrakt `ReplicaStore` to `replicaStoreConformance` (`@evia/sync-core/conformance/replica`); uruchamiany na atrapie w tym pakiecie przez `replicaStoreConformance({ create, test: { describe, it, expect } })` (zestaw nie importuje runnera, więc działa też pod Jestem w `apps/mobile`); obejmuje m.in. `sweep`, `discardShadow` i `wipeReplica`. Analogiczny kontrakt `QueueStore` to `queueStoreConformance` (`@evia/sync-core/conformance/queue`: kolejność wstawiania, odczyt bez walidacji, `update` jako no-op dla brakującego wpisu i usuwanie `lastCode`/`nextAttemptAt` przy `undefined`, atomowość `settle` z awarią wstrzykniętą przez wywołującego). Oba zestawy przechodzi adapter SQLCipher z `apps/mobile` (EVM-093). Limity cyklu (`maxPagesPerCycle`, `maxHydrationsPerCycle`) kończą cykl jako `partial`; sprzątanie działa tylko po cyklu kompletnym.
