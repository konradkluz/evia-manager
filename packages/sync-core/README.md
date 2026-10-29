# `@evia/sync-core` — trwała kolejka mutacji i silnik wysyłki

Pakiet z EVM-091 (ADR-0007, `docs/architecture/offline-sync.md`: zasady 1, 2, 5 i „Wysyłanie”). Czysty TypeScript za portami: bez zależności uruchomieniowych, bez React Native, bez `node:*`, bez `Buffer`, `process`, `setImmediate`, timerów i `Math.random` (egzekwuje to ESLint `portableCore()` w `@evia/config` oraz reguła `sync-core-portable` w `deps:check`). Nie importuje `@evia/contracts`; zgodność z kontraktem sprawdza test w `test/` (devDependency tylko dla testów).

## Zasada
Wszystko, co technik zapisze, trafia do kolejki **przed** potwierdzeniem; mutacja znika dopiero po jawnym wyniku `applied` lub `duplicate` z pasującym `mutationId` (semantyka at-least-once, idempotencja po stronie serwera). Brak wyniku, nieznany wynik albo błąd nigdy niczego nie usuwa.

## Porty (`src/ports.ts`)
| Port | Rola | Uwagi dla implementacji |
|---|---|---|
| `QueueStore` | trwały magazyn kolejki | Produkcja wyłącznie SQLCipher (EVM-093); zakaz AsyncStorage i plików niezaszyfrowanych (SR-MOB-01). `settle` usuwa mutację i przekazuje wynik konsumentowi w jednej transakcji. `readAll` zwraca wpisy w kolejności wstawienia, niezwalidowane. |
| `Transport` | jedno wywołanie `POST /sync/mutations` | Mapuje wynik na `ok`/`http`/`network`; nie przekazuje komunikatów, treści odpowiedzi ani `cause`. `code` z ciała błędu tylko jako `^[a-z_]{1,64}$`. |
| `Clock` | czas w ms | — |
| `Random` | losowość | W produkcji CSPRNG (`crypto.getRandomValues` / expo-crypto); używana przez UUIDv7 i jitter. |
| `SessionOwner` | bieżący `userId` i `refresh()` | `refresh()` zapisuje nowy refresh token trwale przed użyciem nowego access tokenu i trzyma blokadę międzyprocesową (zadanie w tle). Wynik: `refreshed` / `session_revoked` (np. reuse) / `unavailable`. |
| `EventSink` | diagnostyka i sygnały | Zdarzenia to zamknięta unia (`EngineEvent`): identyfikatory, enumy, liczby. |

Testowy `InMemoryQueueStore` jest tylko w `test/` i nie jest eksportowany.

## Użycie
`createSyncCore(deps)` zwraca `{ queue, engine }`. `queue.enqueue(...)` nadaje UUIDv7 mutacji i obiektu, bierze właściciela z `SessionOwner` (nie od wywołującego) i odrzuca mutację > 64 KB. `engine.flush()` jest single-flight (równoległe wyzwalacze łączą się w jedno wywołanie); `flush({ networkRestored: true })` ponawia od razu tylko to, co czeka na błąd sieci. `engine.status()` daje liczniki, wiek najstarszego wpisu, `nextAttemptAt` i powód pauzy dla wskaźnika; harmonogram wybudzenia należy do hosta (silnik nie ma timerów).

## Zachowanie
- **Kolejność:** FIFO po `orderingKey` (zlecenie); mutacja zależna (`parentMutationId`) czeka na wynik rodzica. Odrzucenie niezależnej mutacji nie blokuje innych; wstrzymane (`blocked`) są tylko jawnie zależne.
- **Partie:** ≤ 50 mutacji i ≤ ~900 KB treści; na drut idzie tylko `{mutationId, type, commandVersion, payload}` plus `pendingItems`. Koperta jest niezmienna (ponowienie = identyczne bajty, także starsza `commandVersion`).
- **Błędy przejściowe** (sieć, 5xx, 429, 408, zła odpowiedź, brak wyniku, `idempotency_in_progress`): backoff wykładniczy z limitem i pełnym jitterem; `Retry-After` (sekundy lub data) jako dolna granica, przycięta do 1 s – 1 h.
- **Odrzucenia** (`rejected`, `conflict`, nieznany wynik lub kod → `unknown`): „Wymaga uwagi”, dane zostają. `400`/`413` dla partii > 1: wysyłka pojedynczo, by wyizolować winną mutację.
- **Sesja:** `401 session_revoked` i `device_wipe_required` — pauza i sygnał (kolejka nietknięta; `device_wipe_required` jest stanem terminalnym); `401` bez kodu — jedno `refresh()` i jedno ponowienie, potem `auth_required`; `426` — pauza; `403` i nieoczekiwane statusy — pauza bez pętli. `resume()` po `session_revoked` tylko dla tego samego `userId` (SR-MOB-13). Wysyłane są wyłącznie wpisy bieżącego użytkownika, sprawdzane przed każdą partią.
- **Walidacja po odczycie (SR-MOB-10):** koperta i granice (typy, UUIDv7, `commandVersion` 1–1000, rozmiar). Uszkodzony wpis to `corrupt_record` (nieznany typ — `unknown_type`): nie jest wysyłany ani usuwany i nie blokuje reszty. Ładunek waliduje serwer.

## Polecenia
`pnpm --filter @evia/sync-core run test:coverage` (próg 95%, warstwa `sync`).
