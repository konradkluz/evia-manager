# Wytyczne API

> Dokument żywy (EVM-002). Właściciel: `solution-architect` (recenzja: `security-engineer`, `backend-developer`). Doprecyzowuje „Konwencje” z [ADR-0004](adr/0004-api-rest-openapi-contract-first.md) — **nie zmienia decyzji**. Ścieżki są przykładami; pierwszy kontrakt powstaje w EVM-008. Model danych: [`domain-model.md`](domain-model.md); synchronizacja: [`offline-sync.md`](offline-sync.md). Statusy specyfikacji zweryfikowane 2026-10-03 ([Źródła](#źródła)).

## Spis treści
1. [Zasady ogólne](#zasady-ogólne)
2. [Zasoby i nazwy](#zasoby-i-nazwy)
3. [Typy danych](#typy-danych)
4. [Format błędów](#format-błędów)
5. [Paginacja](#paginacja)
6. [Filtrowanie i sortowanie z polskimi znakami](#filtrowanie-i-sortowanie-z-polskimi-znakami)
7. [Idempotencja](#idempotencja)
8. [Współbieżność (ETag / If-Match)](#współbieżność-etag--if-match)
9. [Komendy zmiany stanu](#komendy-zmiany-stanu)
10. [Wersjonowanie i kompatybilność wsteczna](#wersjonowanie-i-kompatybilność-wsteczna)
11. [Minimalna wersja aplikacji](#minimalna-wersja-aplikacji)
12. [Autoryzacja (deny-by-default)](#autoryzacja-deny-by-default)
13. [Walidacja wejścia](#walidacja-wejścia)
14. [Limity](#limity)
15. [Nagłówki](#nagłówki)
16. [Pliki i podpisane URL-e](#pliki-i-podpisane-url-e)
17. [Dokumentowanie operacji w OpenAPI](#dokumentowanie-operacji-w-openapi)

## Zasady ogólne
- **REST/JSON, OpenAPI 3.1, contract-first** (ADR-0004): specyfikacja w `packages/contracts` jest źródłem prawdy; z niej typy TS, schematy Zod, klienci web i mobile oraz testy macierzy ról. Lint (Redocly) i kontrola zmian łamiących (oasdiff) w CI.
- Jedno API dla panelu i aplikacji mobilnej — te same reguły; różnice kanałów wyłącznie w `x-evia-authz` (`channels`).
- Panel i API w tej samej domenie — **CORS wyłączony** (ADR-0004).
- Identyfikatory, pola i kody po angielsku; `summary` i `description` operacji po polsku. Komunikat dla użytkownika buduje UI z `code` błędu (i18n), nie z `title`.

## Zasoby i nazwy
- Prefiks **`/api/v1`**; zasoby w liczbie mnogiej, `kebab-case`: `/work-orders`, `/scope-items`, `/procedure-stages`, `/payment-milestones`, `/media-assets`.
- **W ścieżkach wyłącznie UUID** (parametry `camelCase`: `{workOrderId}`) — nigdy dane osobowe (ASVS 14.2.1).
- **Kotwice na najwyższym poziomie:** `/customers`, `/sites`, `/parties`, `/work-orders`. **Zasoby podrzędne zawsze pod kotwicą, jeden poziom zagnieżdżenia:** `/work-orders/{workOrderId}/procedure-stages/{stageId}` (także dla etapów — bez `/procedures/{id}/stages/{id}`), `/customers/{customerId}/documents/{documentId}`. Serwer sprawdza, czy obiekt podrzędny należy do kotwicy z URL — inaczej `404` (CWE-639).
- **Metody:**
  | Metoda | Użycie | Sukces |
  |---|---|---|
  | `GET` | odczyt zasobu lub listy | `200` |
  | `POST` (kolekcja) | utworzenie; klient może podać `id` (UUIDv7) — tylko `INSERT`, istniejące `id` → `409 id_conflict` | `201` + `Location` + reprezentacja |
  | `PATCH` | częściowa zmiana (pole nieobecne = bez zmian, `null` = wyczyść), `Content-Type: application/json` | `200` + nowy `ETag` |
  | `DELETE` | soft delete | `204` |
  | `POST …/{id}/transitions` | [zmiana stanu](#komendy-zmiany-stanu) | `200` |
  | `POST …/{id}/{akcja}` | akcje spoza CRUD: `restore`, `purge`, `redact`, `download-url`, `complete` (upload) | `200` / `204` |
  | `POST …/search` | wyszukiwanie z frazą (dane osobowe w treści, nie w URL) — odczyt bez zmiany stanu | `200` |
- `PUT` nie jest używany.
- **`operationId`:** `camelCase`, czasownik + rzeczownik: `listWorkOrders`, `getWorkOrder`, `createWorkOrder`, `updateWorkOrder`, `deleteWorkOrder`, `transitionWorkOrder`, `searchCustomers`.
- **Pola JSON** `camelCase`; wartości słowników `snake_case`; wartości logiczne `is…` / `has…`.
- **Odpowiedzi:** zasób — obiekt bez koperty; lista — `{ "items": [...], "nextCursor": "…" | null }`.
- Ścieżki techniczne: `GET /api/v1/meta/client-config`, `POST /api/v1/sync/mutations`, `GET /api/v1/sync/changes`, `GET /api/health` (poza wersjonowaniem).

## Typy danych
| Typ | Format JSON | Przykład / reguła |
|---|---|---|
| identyfikator | `string`, `format: uuid`, wzorzec UUIDv7 małymi literami `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | `0199a7c2-5e1b-7c3d-9a4f-2b6e8d1f0a37` |
| moment | `string`, RFC 3339 w UTC z `Z` i milisekundami | `2026-10-03T08:15:30.123Z` |
| data biznesowa | `string`, `format: date`; znaczenie w `Europe/Warsaw` | `2026-10-31` (termin płatności) |
| kwota | obiekt `{ "amountMinor": integer (int64), "currency": "PLN" }` | `{ "amountMinor": 123450, "currency": "PLN" }` = 1234,50 zł; nigdy liczby zmiennoprzecinkowe |
| wielkość techniczna | `number` z `multipleOf: 0.01`, zakres min / maks | `"powerKw": 11` |
| słownik | `string`, `enum`, wartości `snake_case` | klient obsługuje wartość nieznaną (ADR-0004) |
| kod konfiguracji | `string`, `^[a-z][a-z0-9_]{1,63}$` | `dso_connection` |
| telefon | `string`, E.164 `^\+[1-9][0-9]{6,14}$` | normalizowany przez serwer |
| e-mail | `string`, `format: email`, `maxLength: 254` | zapisywany małymi literami |
| tekst | `string` z `maxLength`, normalizacja NFC, przycięcie; zwykły tekst | bez HTML i Markdown w MVP |
| wartość pusta | OpenAPI 3.1: `type: [string, "null"]` | `null` jawnie, gdy pole może być puste |

## Format błędów
Jednolity **`application/problem+json`** (RFC 9457) dla każdego błędu:

```json
{
  "type": "https://{domena-api}/problems/validation_failed",
  "title": "Request validation failed",
  "status": 400,
  "code": "validation_failed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    { "pointer": "/newCustomer/phone", "code": "invalid_format" },
    { "pointer": "/title", "code": "too_long" }
  ]
}
```

- `code` — stały kod maszynowy (kontrakt), `title` — stały opis po angielsku dla danego `code`, `type` — URI dokumentacji kodu w domenie API (domena — EVM-007; do tego czasu odwołanie względne `/problems/{code}`, `format: uri-reference` — EVM-008), klienci rozpoznają błąd po `code`, `traceId` — korelacja z logami (ADR-0013), `errors[]` — tylko **ścieżka (JSON Pointer) i kod**.
- **Nigdy:** stack trace'ów, zapytań SQL, nazw klas, ścieżek plików, **wartości pól** ani danych innych użytkowników (ASVS 16.5.1). `detail` — opcjonalny, ogólny, bez danych. `500` zawsze jako `internal_error` z `traceId`.
- **404 czy 403:** obiekt spoza uprawnień użytkownika **albo** soft-deleted (dla ról innych niż Administrator) → `404 not_found` — samo istnienie obiektu jest informacją. `403 forbidden` tylko wtedy, gdy użytkownik może odczytać obiekt (albo kolekcję), ale nie ma uprawnienia do tej operacji (np. Tylko odczyt wysyła `PATCH`).

**Katalog kodów (v1)**
| HTTP | `code` | Kiedy |
|---|---|---|
| 400 | `validation_failed` | treść lub parametry niezgodne ze schematem (szczegóły w `errors[]`); odrzucone hasło: `errors[{ "pointer": "/password", "code": "too_short" \| "too_long" \| "too_weak" }]` — bez wartości (EVM-016) |
| 400 | `activation_link_invalid`, `passkey_verification_failed` | link aktywacyjny użyty, zmieniony, zastąpiony, wygasły albo nieznany — jedna odpowiedź dla wszystkich przypadków; odpowiedź WebAuthn nie przeszła weryfikacji (origin, RP ID, `userVerification`, wyzwanie) (EVM-016) |
| 400 | `malformed_json`, `duplicate_parameter`, `unknown_parameter` | niepoprawny JSON; powtórzony lub nieznany parametr zapytania |
| 400 | `idempotency_key_required`, `invalid_cursor` | brak klucza idempotencji w mutacji mobilnej; kursor niepoprawny, zmieniony, wygasły lub z innymi filtrami |
| 401 | `unauthenticated`, `session_expired`, `session_revoked` | brak sesji; sesja wygasła po 60 min bezczynności albo po 12 h od zalogowania (EVM-067); sesja albo urządzenie unieważnione (ADR-0005) |
| 401 | `invalid_credentials`, `passkey_failed`, `login_expired` | logowanie (EVM-067): zły e-mail, hasło, konto zaproszone albo dezaktywowane — jedna odpowiedź dla wszystkich; klucz dostępu odrzucony (można ponowić z tym samym `loginToken`, maks. 5 nieudanych prób); minęło 5 min na drugi krok |
| 403 | `forbidden` | znany obiekt, brak uprawnienia do operacji |
| 403 | `step_up_required`, `mfa_enrollment_required`, `csrf_failed` | wymagane ponowne uwierzytelnienie; Administrator bez MFA; nieudana kontrola CSRF (ADR-0005) |
| 405 | `method_not_allowed` | metoda spoza `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` (np. `TRACE`) — odrzucana przed routingiem (EVM-016) |
| 404 | `not_found` | obiekt nie istnieje, jest poza uprawnieniami albo soft-deleted (poza Administratorem) |
| 409 | `id_conflict` | `id` z żądania już istnieje (także cudzy lub usunięty obiekt) |
| 409 | `invalid_state_transition` | przejścia nie ma w tabeli przejść |
| 409 | `idempotency_in_progress` | równoległe żądanie z tym samym kluczem idempotencji (z `Retry-After`) |
| 409 | `has_active_dependents` | usunięcie obiektu, od którego zależą aktywne obiekty |
| 412 | `version_conflict` | `If-Match` nie zgadza się z bieżącą wersją (ADR-0004) |
| 413 | `payload_too_large` | treść > 1 MB |
| 415 | `unsupported_media_type` | `Content-Type` inny niż `application/json` |
| 422 | `idempotency_mismatch` | ten sam klucz idempotencji z inną treścią (ADR-0004, ADR-0008) |
| 422 | `transition_condition_not_met` | przejście dozwolone, ale warunek niespełniony (powód w `errors[]`, np. `unpaid_milestones`) |
| 422 | `limit_exceeded`, `template_unavailable` | przekroczony limit obiektów podrzędnych; szablon wycofany |
| 426 | `client_version_unsupported` | wersja aplikacji poniżej minimalnej |
| 428 | `precondition_required` | brak `If-Match` przy zmianie obiektu współdzielonego |
| 429 | `rate_limited` | przekroczony limit żądań (z `Retry-After`) |
| 500 | `internal_error` | błąd serwera (tylko `traceId`) |
| 503 | `service_unavailable` | prace serwisowe (z `Retry-After`) |

Wyniki mutacji synchronizacji (`applied`, `duplicate`, `conflict`, `rejected` z kodem) — [`offline-sync.md`](offline-sync.md#komendy-mobilne-mvp).

## Paginacja
- **Kursorowa** (ADR-0004): parametry `cursor` i `limit`; `limit` **domyślnie 25, maks. 100**. Odpowiedź: `items` i `nextCursor` (`null` = koniec).
- **Stabilne sortowanie:** klucz sortowania + `id` jako rozstrzygnięcie remisu (keyset, bez `OFFSET`).
- **Kursor nieprzezroczysty:** szyfrowany i uwierzytelniony kluczem serwera (`platform/crypto`); zawiera klucz sortowania, `id`, skrót filtrów, identyfikator użytkownika i czas wygaśnięcia — **nie zawiera jawnie wartości klucza sortowania** (np. nazwiska). Zmieniony, wygasły albo użyty z innymi filtrami lub przez innego użytkownika → `400 invalid_cursor`.
- **Bez liczników całkowitych** na listach (koszt i ryzyko masowego odczytu). Liczniki i sumy dla pulpitów — osobne operacje liczone **wyłącznie na zbiorze, do którego użytkownik ma dostęp**.
- Wyszukiwanie (`POST …/search`) przyjmuje `cursor` i `limit` w treści żądania.

## Filtrowanie i sortowanie z polskimi znakami
**Filtry**
- Wyłącznie **filtry z listy dozwolonych** dla danej operacji — nazwane parametry w kontrakcie, mapowane w kodzie na kolumny (słownik → kolumna); bez ogólnego języka filtrów i bez fragmentów SQL (ASVS 1.2.4, 1.1.1).
- **Operatory z listy dozwolonych:** równość (`status=in_progress`), lista (`status=in_progress,on_hold`, maks. 20 wartości), zakres dat z przyrostkami `From` / `To` (włącznie, np. `dueDateFrom=2026-10-01&dueDateTo=2026-10-31`), wartość logiczna (`isOverdue=true`).
- Filtrowanie i sortowanie **tylko po polach, które rola może czytać** (ASVS 8.2.3).
- **Dane osobowe nigdy w query stringu** (nazwisko, telefon, e-mail, adres, PPE): wyszukiwanie po nich wyłącznie przez `POST /api/v1/customers/search`, `…/sites/search`, `…/parties/search`, `…/work-orders/search` z frazą w treści. Parametry bez danych osobowych (statusy, daty, kody, numer zlecenia) zostają w `GET`. Wyjątek od tej zasady wymagałby ADR i bezwzględnego usuwania query stringów z logów Caddy, pino i Sentry — w v1 nie występuje.

**Wyszukiwanie bez znaków diakrytycznych** (ADR-0003)
- Fraza `query`: po normalizacji NFC i przycięciu **3–100 znaków** (krótsza → `400 validation_failed`, kod `too_short` — fraza poniżej 3 znaków nie korzysta z indeksu trigramowego i grozi pełnym skanem).
- Serwer porównuje `f_unaccent(lower(query))` z kolumną `search_text` (`f_unaccent(lower(…))`, indeks GIN `pg_trgm`) operatorem `ILIKE` z parametrem; znaki `%`, `_` i `\` we frazie są **escapowane**.
- Wielkość liter i polskie znaki nie mają znaczenia — przykłady (obowiązkowe testy brzegowe w M1):
  | Fraza | Znajduje |
  |---|---|
  | `Lodz` | „Łódź”, „ŁÓDŹ”, „łódź” |
  | `zolkiewskiego` | „ul. Żółkiewskiego” |
  | `slask` | „Śląsk” |
- Wyszukiwanie zleceń po kliencie lub adresie łączy wyniki `customers` i `sites` z własnym `search_text` zlecenia ([`domain-model.md`](domain-model.md#konwencje-danych)).

**Sortowanie**
- Parametr `sort` z **listy dozwolonych** dla operacji: `sort=name` (rosnąco), `sort=-createdAt` (malejąco); jeden klucz + niejawne `id`.
- Tekst sortuje baza z kolacją ICU `pl-PL` — **Ł po L, Ś po S, Ż po Z**:
  | Kolejność polska (poprawna) | Kolejność bajtowa (błędna) |
  |---|---|
  | Lublin, Łańcut, Łódź, Malbork, Sopot, Śrem, Tarnów, Zabrze, Żory | Lublin, Malbork, Sopot, Tarnów, Zabrze, Łańcut, Łódź, Śrem, Żory |
- Sortowanie po stronie klienta (np. tabela w panelu) używa `Intl.Collator('pl')`.

## Idempotencja
- Nagłówek **`Idempotency-Key`** (UUIDv7). **Wymagany** dla każdej mutacji (`POST`, `PATCH`, `DELETE`) z aplikacji mobilnej — brak → `400 idempotency_key_required`; **zalecany** w panelu web dla tworzenia i komend (klient generuje klucz raz na akcję użytkownika). Mutacje synchronizacji używają `mutation_id` ([`offline-sync.md`](offline-sync.md#5-idempotencja-mutacji)).
- Klucz jest powiązany z **użytkownikiem i urządzeniem z sesji** (web: bez urządzenia) **oraz z metodą i szablonem ścieżki**. Serwer zapisuje skrót SHA-256 kanonicznej treści i **wynik minimalny** (status, kod, identyfikator zasobu) — nie pełną odpowiedź.
- **Powtórka** (ten sam klucz, ta sama treść) → ten sam status i identyfikator; treść odpowiedzi to bieżąca reprezentacja zasobu odczytana z bieżącymi uprawnieniami; nagłówek `Idempotent-Replayed: true`.
- **Ten sam klucz z inną treścią** → `422 idempotency_mismatch`. **Równoległe żądanie z tym samym kluczem** → `409 idempotency_in_progress` z `Retry-After`.
- **Implementacja (EVM-020):** rekord idempotencji powstaje **w tej samej transakcji** co zmiana (nie ma stanu „w toku”, który mógłby zostać po awarii): równoległe żądanie z tym samym kluczem nie dostaje blokady doradczej transakcji i odpowiada `409 idempotency_in_progress` z `Retry-After: 1` (nie czeka); zapisywane są tylko wyniki `2xx` (błąd nie zajmuje klucza); blokada i unikalność dotyczą (użytkownik, urządzenie, klucz), więc ten sam klucz na innej operacji daje `422 idempotency_mismatch`, a klucz innego użytkownika nigdy nie odtwarza cudzego wyniku. `Idempotency-Key` jest w panelu opcjonalny, ale panel wysyła go zawsze i przy ponowieniu używa tego samego `id` i klucza. Skrót to SHA-256 kanonicznego JSON-a (posortowane klucze) sparsowanej treści.
- **Retencja kluczy: 30 dni** (ADR-0004). Po wygaśnięciu klucz jest traktowany jak nowy; tworzenie pozostaje bezpieczne dzięki zasadzie „tylko `INSERT`” (`id_conflict`).
- Semantyka (`400` / `409` / `422`) za szkicem IETF `draft-ietf-httpapi-idempotency-key-header-07` (wygasły, **nie jest RFC** — stan na 2026-10-03); traktujemy go jako naszą konwencję i przeglądamy przy ewentualnej publikacji RFC.

## Współbieżność (ETag / If-Match)
- Odczyt pojedynczego zasobu zwraca **`ETag: "<version>"`** (silny, z kolumny `version`).
- `PATCH`, `DELETE` i komendy przejść na obiektach współdzielonych **wymagają `If-Match`**: brak → `428 precondition_required`, niezgodność → **`412 version_conflict`** (ADR-0004). Klient pobiera aktualny stan i ponawia decyzję — bez cichego nadpisywania.
- Tworzenie obiektów tylko do dopisywania (wpisy, media) nie wymaga `If-Match`.

## Komendy zmiany stanu
- Status zmienia wyłącznie komenda: `POST /api/v1/work-orders/{workOrderId}/transitions`, `…/procedure-stages/{stageId}/transitions`, `…/payment-milestones/{milestoneId}/transitions` z treścią `{ "to": "on_hold", "reason": "…" }` (pola wymagane przez przejście wg tabel w [`domain-model.md`](domain-model.md#stany-i-przejścia)), nagłówkami `If-Match` i `Idempotency-Key`. `PATCH` pola `status` jest odrzucany (pole `readOnly`).
- Odpowiedź `200` z nową reprezentacją i `ETag`. Przejścia nie ma w tabeli → `409 invalid_state_transition`; warunek niespełniony → `422 transition_condition_not_met`; rola bez prawa do tego przejścia → `403 forbidden`; przejście wymaga step-up → `403 step_up_required`.
- Reprezentacja zasobu zawiera `allowedTransitions` — listę przejść dostępnych dla bieżącego użytkownika (podpowiedź dla UI; serwer i tak egzekwuje politykę).

## Wersjonowanie i kompatybilność wsteczna
- Wersja w ścieżce: **`/api/v1`**. W ramach `v1` **tylko zmiany addytywne** (ADR-0004): nowe pola opcjonalne, nowe operacje, nowe opcjonalne parametry, nowe wartości słowników (klienci obsługują wartość nieznaną).
- **Zmiany łamiące** (zakazane w `v1`): usunięcie lub zmiana nazwy pola, zmiana typu lub formatu, pole opcjonalne → wymagane w żądaniu, zaostrzenie walidacji istniejącego pola, zmiana znaczenia, zmiana kodu błędu dla istniejącej sytuacji. Zmiana łamiąca = ADR + `/api/v2` dla dotkniętych zasobów; `v1` działa do końca okresu wycofania.
- **Tolerancyjny klient:** klienci ignorują nieznane pola; generowani klienci i aplikacja mobilna mają wartość awaryjną dla nieznanych wartości słowników.
- **oasdiff** w CI blokuje zmianę łamiącą względem `main` (ADR-0004).
- **Wycofanie:** operacja oznaczona `deprecated: true` w kontrakcie; odpowiedzi z nagłówkami **`Deprecation`** (RFC 9745, data jako `@<unix>`, np. `Deprecation: @1798761600` = 2027-01-01), **`Sunset`** (RFC 8594, HTTP-date, np. `Sunset: Thu, 01 Apr 2027 00:00:00 GMT`) i `Link: <…>; rel="deprecation"`; **okres ≥ 90 dni**.
- Komendy synchronizacji mają własne wersje (`commandVersion`) — [`offline-sync.md`](offline-sync.md#wersje-komend-i-kompatybilność).

## Minimalna wersja aplikacji
- Aplikacja wysyła w każdym żądaniu **`X-Client-Platform`** (`ios` / `android` / `web`) i **`X-Client-Version`** (semver); panel web — wersję buildu.
- Serwer ma konfigurację **`minSupportedVersion`** i `recommendedVersion` per platforma, zmienialną bez wdrożenia kodu (ADR-0004).
- Wersja niższa niż minimalna (albo brak lub niepoprawny nagłówek w kanale mobilnym) → **`426 Upgrade Required`** z kodem **`client_version_unsupported`** dla wszystkich operacji poza `GET /api/v1/meta/client-config` i `/api/health`. Aplikacja blokuje pracę online, **zachowuje kolejkę offline** i prosi o aktualizację.
- `GET /api/health` (operacja `getHealth`, publiczna, poza `/v1`, EVM-008) zwraca wyłącznie `{ "status": "ok", "minSupportedAppVersion": { "android": "1.0.0", "ios": "1.0.0" } }` (wartości z konfiguracji serwera); niedostępna baza → `503 service_unavailable` bez szczegółów. Kształt jest kontraktem czytanym przez aplikację mobilną — zmiany tylko addytywne.
- `GET /api/v1/meta/client-config` (bez danych osobowych, dostępny przed zalogowaniem) zwraca m.in. `minSupportedVersion`, `recommendedVersion` i parametry pracy offline (np. N dni zakresu zamkniętych zleceń, limit dni offline).
- **Nagłówki `X-Client-*` służą wyłącznie kompatybilności** — klient może je podrobić, więc nigdy nie wpływają na autoryzację. Odpowiedź `426` jest też **narzędziem odcięcia wersji z podatnością**: wymusza aktualizację uczciwych klientów, a ochrona przed klientem złośliwym opiera się na kontrolach serwera.

## Autoryzacja (deny-by-default)
- **Deny-by-default:** globalny guard sprawdza każde żądanie; operacja bez zadeklarowanej polityki jest odrzucana (`403`), a test startowy kończy build błędem (ADR-0001). Źródło uprawnień: [macierz w `domain-model.md`](domain-model.md#uprawnienia).
- **`x-evia-authz` jest obowiązkowe w każdej operacji** (lint kontraktu, ASVS 8.2.3, 15.3.1):

  ```yaml
  x-evia-authz:
    roles: [administrator, editor]        # role dopuszczone do operacji
    policy: workOrder.update               # polityka obiektowa (przez kotwicę)
    anchor: path.workOrderId               # skąd serwer bierze kotwicę
    channels: [web, mobile]
    stepUp: false                          # true: ponowne uwierzytelnienie z MFA
    transitions: workOrderStatus           # tylko dla operacji przejść: tabela przejść
    hiddenFields:                          # pola ukryte per rola (np. decyzje EVM-005)
      read_only: []
    audit: true
  ```
- **Operacje publiczne (wyjątek):** `x-evia-authz: { public: true }` — operacja dostępna bez sesji. Dozwolone wyłącznie dla operacji z allow-listy `PUBLIC_OPERATIONS` w `packages/contracts/src/public-operations.ts` (dziś `getHealth`, `checkActivationLink`, `setActivationPassword`, `login`, `getLoginPasskeyOptions`, `verifyLoginPasskey`); sprawdzają to lint kontraktu (`evia/public-allow-list`) i guard API w czasie działania. Rozszerzenie listy wymaga przeglądu `security-engineer` (EVM-008, EVM-016). Operacja publiczna z mutacją: tylko `POST`, kontrola `Origin` + `Sec-Fetch-Site`, limit per IP, mała treść (8 KB), jedna wspólna odpowiedź dla nieważnego linku; token tylko w treści `POST` (nigdy w ścieżce ani w zapytaniu).
- **Manifest `x-evia-authz` jest ścisły** (EVM-016): generator manifestu waliduje politykę schematem Zod — nieznany klucz, pusta lista `roles` lub `channels` w operacji niepublicznej, wartość spoza słownika (`administrator` | `editor` | `read_only`; `web` | `mobile`) kończą budowę błędem. Literówka nie może stać się polityką fail-open. Polityka bez `roles` albo `channels` jest w guardzie zawsze `403` (fail closed). Generowany manifest zawiera też nazwy zadeklarowanych parametrów `query` operacji — guard odpowiada `400 unknown_parameter` / `400 duplicate_parameter` na pozostałe.
- **Kanały:** operacja niepubliczna ma niepustą listę `channels` (`web`, `mobile`). `mobile` tylko dla operacji z listy `MOBILE_OPERATIONS` (w M1 pusta — kanał mobilny startuje z E9) i nigdy razem z `stepUp: true` (lint `evia/mobile-channel-allow-list`, SR-AUTHZ-12); operacja z `stepUp: true` ma dokładnie `channels: [web]` (lint `evia/step-up-web-only`, EVM-029). Reguła rola × kanał należy do `identity`: Tylko odczyt nie ma kanału `mobile`. Kanał spoza listy operacji to `403 forbidden` (osobnego kodu nie ma).
- **Stan `mfa_enrollment`:** sesja po ustawieniu hasła, bez klucza dostępu, może wywołać wyłącznie operacje z listy `MFA_ENROLLMENT_OPERATIONS` (dziś `getCurrentSession`, `getPasskeyRegistrationOptions`, `registerPasskey`, `extendSession`, `logout`), które jednocześnie mają w kontrakcie `allowDuringMfaEnrollment: true` (lint `evia/mfa-enrollment-allow-list` i guard sprawdzają obie strony). Każda inna operacja → `403 mfa_enrollment_required`. Sesja `mfa_enrollment` z aktywacji jest powiązana z linkiem i ważna tylko, dopóki link jest ważny (nieużyty, niezastąpiony, niewygasły) — inaczej `401 session_revoked`. Sesja `mfa_enrollment` z logowania samym hasłem (konto aktywne bez klucza dostępu, EVM-067) nie ma linku: nie może zarejestrować czynnika (`registerPasskey` → `401 session_revoked`), żyje do wygaśnięcia i do dezaktywacji konta; rejestrację czynnika po samym haśle rozstrzyga EVM-023 (SR-AUTH-13).
- **Stała kolejność kontroli w guardzie** (tak samo w generatorze macierzy ról; kontroli nigdy nie ma w handlerach): 1. operacja w manifeście (inaczej `403`) → 2. operacja publiczna: przy mutacji `Origin` + `Sec-Fetch-Site: same-origin` (`403 csrf_failed`), potem limit per IP (`429`) → 3. brak sesji `401 unauthenticated`, `401 session_revoked` albo `401 session_expired` → 4. mutacja: CSRF — `Origin`, `Sec-Fetch-Site` i `X-CSRF-Token` (`403 csrf_failed`) → 5. limit operacji logowania i MFA (`429`) → 6. stan `mfa_enrollment` (`403 mfa_enrollment_required`) → 7. kanał, potem rola (`403 forbidden`) → 8. step-up: operacja z `stepUp: true` wymaga uwierzytelnienia kluczem dostępu w tej sesji w ciągu ostatnich 15 minut (`403 step_up_required`; dokładnie 15:00 to już za późno) — po roli, więc Edytor i Tylko odczyt dostają `forbidden` i nie dowiadują się, że operacja jest chroniona → 9. polityka obiektowa w przypadku użycia (`404 not_found`) — nigdy w guardzie.
- **CSRF dla sesji web** (SR-SESS-10): każda mutacja wymaga `Origin` równego `PANEL_ORIGIN` i `Sec-Fetch-Site: same-origin`; mutacja z sesją dodatkowo `X-CSRF-Token`. Token nie jest przechowywany: to HMAC-SHA-256 tokenu sesji ze stałą etykietą, więc zmienia się razem z sesją (nowy identyfikator po haśle i po rejestracji klucza), porównanie w czasie stałym. Panel dostaje token w odpowiedzi `setActivationPassword` i `getCurrentSession` (dostępne także w `mfa_enrollment`, żeby odświeżenie W-03 go odzyskało). Brak nagłówków CORS — preflight z obcego originu nic nie dostaje.
- **Ścieżki uwierzytelniania** (jeden prefiks na reguły proxy i limity): `POST /api/v1/auth/activation/check` (`checkActivationLink`), `POST /api/v1/auth/activation/password` (`setActivationPassword`), `GET /api/v1/auth/session` (`getCurrentSession`), `POST /api/v1/auth/logout` (`logout`: `204`, `Clear-Site-Data: "cache", "storage"`, wygaszone ciasteczko). Klucze dostępu to zasób konta: `POST /api/v1/account/passkeys/registration-options` i `POST /api/v1/account/passkeys` (`201` z reprezentacją klucza, bez danych sesji; nowe ciasteczko sesji w `Set-Cookie`; panel woła potem `getCurrentSession`) — ten sam zasób wykorzysta drugi klucz (EVM-028). Nie ma endpointu „setup”: pierwszego Administratora aktywuje polecenie na serwerze (`docs/ops/runbooks/aktywacja-i-tryb-awaryjny.md`).
- **Logowanie dwukrokowe i wygasanie sesji** (EVM-067; SR-AUTH-05, SR-AUTH-09, SR-SESS-02, SR-SESS-03): `POST /api/v1/auth/login` (`login`, e-mail + hasło) → `200 { state: "second_step", loginToken, methods: ["passkey"] }` albo `200 { state: "mfa_enrollment", csrfToken }` z ciasteczkiem; `loginToken` (256 bitów, w bazie tylko SHA-256, ważny 5 min, jednorazowy) trafia do `POST /api/v1/auth/login/passkey/options` (`getLoginPasskeyOptions`) i `POST /api/v1/auth/login/passkey` (`verifyLoginPasskey` → `200 { state: "active", csrfToken }` + nowe ciasteczko). Wszystkie trzy operacje są publiczne (kanał `web` nadaje ścieżka), mają jeden limit 20 prób/min/IP liczony przed dostępem do bazy i kontrolę `Origin` + `Sec-Fetch-Site` (ochrona przed login CSRF). Jedna odpowiedź `401 invalid_credentials` dla każdej porażki pierwszego kroku i jedna równoważna weryfikacja Argon2id; klucz musi należeć do konta z `loginToken`. Sesja żyje 60 min od ostatniej aktywności i najwyżej 12 h od zalogowania (`401 session_expired`); aktywnością jest każde żądanie uwierzytelnione poza odczytem sesji (`getCurrentSession`) i `extendSession`, zapis co najwyżej co 30 s. `POST /api/v1/auth/session/extend` (`extendSession`) odnawia czas bezczynności (nigdy ponad 12 h), bez treści i bez identyfikatora sesji. `getCurrentSession` zwraca `idleExpiresAt` i `absoluteExpiresAt`. Szczegóły i wartości: `apps/api/README.md` → „Logowanie i sesje”.
- **Ponowne uwierzytelnienie (step-up)** (EVM-029; SR-SESS-08, SR-SESS-02; ADR-0005): operacja z `stepUp: true` w `x-evia-authz` (dziś `listAuditEvents`) dostaje `403 step_up_required`, gdy sesja nie ma uwierzytelnienia kluczem dostępu z ostatnich 15 minut — także sesja z hasła, aktywacji lub (od EVM-023) kodu odzyskiwania; znacznik `sessions.passkey_authenticated_at` ustawia wyłącznie drugi krok logowania i sam step-up (rejestracja klucza go nie ustawia). Jedyną metodą jest klucz dostępu: `POST /api/v1/auth/step-up/options` (`getStepUpPasskeyOptions`, bez treści) zwraca opcje WebAuthn (`userVerification: required`, `allowCredentials` tylko z kluczami użytkownika sesji) i zapisuje jednorazowe wyzwanie o celu `passkey_step_up` powiązane z sesją (TTL 5 min; nowe opcje unieważniają poprzednie; wyzwanie rejestracji i logowania nie są wymienne), a `POST /api/v1/auth/step-up` (`stepUp`, treść ścisła: tylko `credential`, pole `recoveryCode` daje `400`) weryfikuje asercję tym samym kodem co logowanie. Obie operacje: tylko Administrator, kanał `web`, sesja `active`, CSRF jak pozostałe mutacje, limit 20/min/IP (wspólny z logowaniem), audyt. Sukces w jednej transakcji: warunkowy `UPDATE` kończy bieżącą sesję (`rotated`; sesja już nieważna → `401 session_revoked` i brak nowej), powstaje nowa sesja tego samego użytkownika, kanału i stanu z nowym tokenem i nowym `csrfToken` (`200 { csrfToken }` + `Set-Cookie`), bezwzględny limit 12 h zostaje, a `passkey_authenticated_at = last_authenticated_at = teraz`; zdarzenia `session.revoked`, `session.created`, `step_up.succeeded`. Nieudany klucz: `401 passkey_failed`, sesja bez zmian i bez rotacji, wyzwanie zużyte (potrzebne nowe opcje), zdarzenie `step_up.failed` bez szczegółów asercji. Klient (panel) ponawia automatycznie tylko raz i tylko żądanie, które dostało `403 step_up_required`, po podmianie `csrfToken`; `401 session_revoked` dla żądania wysłanego jeszcze ze starym ciasteczkiem nie wylogowuje użytkownika.
- **Dziennik audytu** (EVM-029; SR-LOG-03, SR-LOG-04, SR-DATA-03, P9): `GET /api/v1/audit/events` (`listAuditEvents`) — Administrator, kanał `web`, `stepUp: true`; zdarzenia od najnowszych (`occurredAt`, `id` malejąco), domyślnie ostatnie 30 dni (`from`–`to` do 2 lat, `from` ≤ `to`, ISO 8601), filtry `action`, `actorUserId`, `outcome` (zamknięte listy / UUID), paginacja kursorem nieprzezroczystym (`limit` 1–100, domyślnie 50; `items` + `nextCursor`; zły kursor, nieznany parametr i wartość spoza schematu → `400`). Pozycja: `id`, `occurredAt`, `actor` (`{ userId, displayName }` albo `null`), `action`, `outcome`, `reasonCode`, `objectType`, `objectId`, `ipPrefix` (wyłącznie /24 lub /48) — bez e-maila, user agenta, identyfikatora sesji i śladu; kolumny wybierane jawnie w zapytaniu i odpowiedź parsowana schematem kontraktu. Każdy udany odczyt (także z filtrem) zapisuje `audit.read` (bez wartości filtrów, `objectType: audit`) w tej samej transakcji co odczyt — odczyt, którego nie da się zaudytować, nie jest zwracany (`500`). Kontrakt nie ma operacji zmiany ani usunięcia zdarzeń (rola aplikacji ma tylko `INSERT` i `SELECT`, triggery blokują resztę); usuwanie po 2 latach to zadanie retencji (M4), nie operacja API.
- **Klienci** (EVM-020): `POST /api/v1/customers/search` (`searchCustomers`) — Administrator / Edytor / Tylko odczyt, kanał `web`, bez audytu; fraza w treści (`{ "query" }`, 3–100 znaków po NFC i przycięciu, `too_short` / `too_long`; fraza z samych cyfr, `+`, spacji, nawiasów i myślników to telefon — porównanie po cyfrach), odpowiedź `{ items, nextCursor: null }` z pozycjami `{ id, displayName, phone }` (najwyżej 20, bez e-maila, NIP, adresu i notatek), limit 60/min/użytkownika i próg masowego odczytu (P10). `POST /api/v1/customers` (`createCustomer`) — Administrator / Edytor, `web`, audyt `customer.created`: płaska treść z `kind`, `id` UUIDv7 od klienta, reguły zależne od rodzaju sprawdza domena (`required`, `not_allowed_for_kind`), telefon → E.164, e-mail małymi literami, NIP → 10 cyfr; `201` + `ETag`, bez `Location` (nie ma jeszcze odczytu pojedynczego klienta); pola serwera (`displayName`, `sortName`, `searchText`, `version`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt`, `deletedBy`) → `400` z kodem `read_only_field` (lista pochodzi z `readOnly` w kontrakcie).
- **Lokalizacje i strony** (EVM-021): `POST /api/v1/sites/search` (`searchSites`) i `POST /api/v1/parties/search` (`searchParties`) — Administrator / Edytor / Tylko odczyt, kanał `web`, bez audytu odczytu; fraza w treści (`{ "query" }`, 3–100 znaków po NFC i przycięciu, `too_short` / `too_long`); wyszukiwanie lokalizacji obejmuje ulicę, numery budynku i lokalu, kod pocztowy, miasto i numer miejsca (nie PPE ani notatki), wynik `{ items, nextCursor: null }` z `id`, `siteType`, adresem i numerem miejsca (do 20, bez notatek, PPE, mocy i stron); wyszukiwanie stron obejmuje nazwę i osobę kontaktową, opcjonalny filtr `kinds` (maks. 10 rodzajów `PartyKind`, bez powtórzeń — `not_unique`; combobox OSD wysyła `distribution_system_operator`, combobox zarządcy `building_administration`, `property_manager`, `housing_community`), wynik z `id`, `kind`, `legalForm`, `displayName` (bez telefonu, e-maila i osoby kontaktowej). `POST /api/v1/sites` (`createSite`) i `POST /api/v1/parties` (`createParty`) — Administrator / Edytor, `web`, audyt `site.created` / `party.created` (identyfikatory, bez wartości danych osobowych): `id` UUIDv7 od klienta, opcjonalny `Idempotency-Key` (panel wysyła zawsze), `201` + `ETag`, bez `Location`; lokalizacja nie ma `customerId` (`unknown_field`); pola serwera (`searchText`, `version`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt`, `deletedBy`) → `read_only_field`. **Kody pól w `errors[]`:** `not_allowed_for_site_type` (numer miejsca lub poziom poza `multi_family_garage`), `wrong_party_kind` (strona innego rodzaju w polu `distributionSystemOperatorPartyId` / `managerPartyId` — bez nazwy znalezionego rodzaju), `unknown_party` (strona nie istnieje albo jest usunięta — ten sam kod, bez rozróżnienia, dla każdej roli), `out_of_range` (liczba poza zakresem, np. moc przyłączeniowa spoza 0 < kW ≤ 1000). Rodzaj strony sprawdza serwer w tej samej transakcji co zapis (fasada `PartyDirectory`).
- **Zlecenia** (EVM-017; lista, tylko odczyt): `GET /api/v1/work-orders` (`listWorkOrders`) — Administrator / Edytor / Tylko odczyt, kanał `web`, bez audytu odczytu. Filtry łączą się przez **AND**: `status` (lista po przecinku, ścisły enum `WorkOrderStatus`, maks. 20 elementów, zbiór normalizowany; pusty element → `400`), `view` (`all_open` = status poza `settled` i `cancelled`; `mine` = aktywny opiekun równy użytkownikowi z sesji — nigdy z żądania), `coordinatorId` (UUID; nieistniejący identyfikator → pusta lista). **`view` jest opcjonalny i bez wartości domyślnej w API** (brak = brak predykatu widoku); domyślny widok „Wszystkie niezamknięte” to decyzja panelu, który wysyła `view=all_open` jawnie. `sort`: `-number` (domyślne), `number`, `-createdAt`, `createdAt` (format jak w „Sortowanie”; kolejne epiki dodają wartości addytywnie), wartość spoza listy, zły `limit` (1–100, domyślnie 25) albo zły format `status` → `400 validation_failed`. Opiekun w odpowiedzi to `coordinator: { id, displayName } | null` (nazwa z `identity` jednym wsadowym zapytaniem na stronę), `status` — zwykły `enum` (klient obsługuje wartość nieznaną). **Kursor** (`platform/crypto`): AES-256-GCM, ważny 30 minut, związany z operacją, użytkownikiem i znormalizowanymi filtrami (z `sort`, bez `limit`); każdy błąd → jedno `400 invalid_cursor`; bez licznika wyników. **Masowy odczyt (P10)**: w oknie 10 minut licznik rekordów zwróconych użytkownikowi — od 2000 alert bezpieczeństwa (raz na okno), od 10 000 `429 rate_limited` z `Retry-After` w sekundach; sprawdzenie przed zapytaniem, doliczenie zwróconych rekordów po; odrzucone żądania nie są liczone; pierwszy alert i pierwsze odrzucenie w oknie zapisują zdarzenia audytu `bulk_read.alerted` / `bulk_read.rejected` z aktorem (bez wartości filtrów), by Administrator mógł wskazać konto; wspólny dla wyszukiwań (EVM-072). Zlecenia usunięte (soft delete) nie występują na liście — warunek jest w zapytaniu (`visibleWorkOrders`), także dla Administratora do czasu widoku usuniętych (EVM-060). `Cache-Control: no-store`; w adresie panelu tylko `status` i `view`.
- **Katalog i szablony** (EVM-019; tylko odczyt w M1): `GET /api/v1/catalog/work-order-templates` (`listWorkOrderTemplates`, filtr `siteTypeHint`, tylko aktywne, z podglądem pozycji, procesów z liczbą etapów i transz z udziałami), `GET /api/v1/catalog/work-order-templates/{templateId}` (`getWorkOrderTemplate`, także wycofany z `isActive: false`; nieznany → `404 not_found`), `GET /api/v1/catalog/service-items` (`listServiceItems`), `GET /api/v1/catalog/procedure-templates` (`listProcedureTemplates`), `GET /api/v1/catalog/document-kinds` (`listDocumentKinds`). Role Administrator / Edytor / Tylko odczyt, kanał `web` (mobile — M2), bez audytu; brak operacji zmieniających konfigurację (edytor i step-up — M4). Zbiory konfiguracji są małe i zwracane w całości w kopercie listy z `nextCursor: null` (bez `limit` i `cursor` do czasu edytora); nagłówki jak wszędzie (`Cache-Control: no-store`).
- **Zdarzenia i audyt:** moduł nie importuje `audit` — publikuje zdarzenia przez dispatcher w `platform/events` (synchronicznie, w transakcji zmiany; błąd zapisu audytu cofa zmianę); `audit` subskrybuje typy zdarzeń eksportowane z `index.ts` modułu (`docs/architecture/domain-model.md` → „Moduły i własność tabel”). Skracanie adresu IP do /24 i /48 robi wyłącznie `audit`.
- **Jedno źródło polityki:** handler NestJS wskazuje operację dekoratorem `@OperationId('<operationId>')`, a polityka pochodzi wyłącznie z manifestu generowanego z kontraktu (bez lokalnych dekoratorów typu „public”). Test startowy odrzuca trasę bez operacji w kontrakcie oraz trasę, której metoda lub ścieżka nie zgadza się z kontraktem. Nieistniejąca trasa bez sesji → `401 unauthenticated` (mapa tras nie jest ujawniana), z sesją → `404 not_found` (EVM-008).
- **Żadnych decyzji na podstawie danych od klienta:** rola, właściciel, `userId`, `deviceId`, nagłówki `X-Client-*` ani identyfikatory w treści nie dają dostępu — użytkownik i urządzenie pochodzą wyłącznie z sesji.
- **Listy i wyszukiwanie** filtruje ta sama polityka co odczyt pojedynczego obiektu (warunek w zapytaniu, nie odsiewanie po pobraniu strony); liczniki i sumy — tylko na zbiorze dostępnym dla użytkownika.
- **Ścieżki zagnieżdżone:** obiekt podrzędny spoza kotwicy z URL → `404` (CWE-639). Obiekt soft-deleted dla ról innych niż Administrator → `404`.
- **Pola kontrolowane przez serwer** są `readOnly` i odrzucane na wejściu (mass assignment, CWE-915) — lista w [`domain-model.md`](domain-model.md#pola-kontrolowane-przez-serwer).
- **Web:** ochrona CSRF dla metod zmieniających stan (`Origin`, `Sec-Fetch-Site`, `X-CSRF-Token` — ADR-0005).
- **Wymaganie dla EVM-008 i kolejnych:** każda operacja ma generowane z kontraktu testy macierzy ról (**Administrator / Edytor / Tylko odczyt / niezalogowany**) oraz **przypadek IDOR** (cudzy obiekt, obiekt innej kotwicy); test „każda trasa ma politykę” i test kompletności macierzy (100% operacji) — ADR-0004, ADR-0014.

## Walidacja wejścia
- Każdy schemat obiektu: **`additionalProperties: false`**; każdy `string` ma **`maxLength`**, każda tablica **`maxItems`**; identyfikatory z wzorcem UUIDv7; daty, kody, telefony, e-maile — `format` lub `pattern`; liczby — `minimum` / `maximum` (ASVS 15.3.3, 2.2.1).
- Pola serwerowe oznaczone **`readOnly: true`** i odrzucane na wejściu (`400 validation_failed`, kod `read_only_field`).
- Treść żądania: wymagany **`Content-Type: application/json`** (inny → `415`). **Zduplikowany parametr zapytania → `400 duplicate_parameter`** (listy przez przecinek); nieznany parametr → `400 unknown_parameter` (ASVS 15.3.7).
- Tekst: normalizacja NFC, przycięcie, odrzucenie znaków sterujących (poza nową linią w polach wielowierszowych). Pola swobodne to zwykły tekst — bez HTML i Markdown w MVP; kodowanie wyjścia w UI.
- Przyszłe eksporty CSV / XLSX (M4) muszą chronić przed **formula injection** (wartości zaczynające się od `=`, `+`, `-`, `@`, tabulatora lub CR poprzedzone apostrofem — ASVS 1.2.10).

## Limity
Wartości z ADR (ASVS 2.1.3, 2.4.1, 15.1.3); przekroczenie limitu żądań → `429 rate_limited` z `Retry-After`.

| Limit | Wartość | Źródło |
|---|---|---|
| treść JSON | ≤ **1 MB** (`413`); pliki nigdy nie przechodzą przez API | ADR-0004 |
| strona listy | domyślnie **25**, maks. **100** | ADR-0004 |
| żądania na użytkownika | **300 żądań/min** | ADR-0004 |
| żądania na IP | **1200/min/IP** — wszystkie żądania (EVM-016; IPv6 po prefiksie /64, pamięć limitera ograniczona, `trust proxy` tylko dla jawnej listy `TRUSTED_PROXIES`) | ADR-0004, EVM-005, P10 |
| operacje anonimowe | **60/min/IP** (sprawdzenie linku i pozostałe operacje publiczne) | P10 |
| logowanie i MFA | maks. **20/min/IP**: ustawienie hasła, opcje i rejestracja klucza dostępu (docelowo także logowanie), opóźnienia i blokada konta | ADR-0005, P10 |
| treść anonimowa | ≤ **8 KB**, tylko dla operacji publicznych z treścią; pozostałe żądania anonimowe — `401` bez parsowania treści | EVM-016 |
| wyszukiwanie | fraza 3–100 znaków; osobny kubełek **60 żądań/min/użytkownika** — osobno dla klientów, lokalizacji i stron (`search`, `search-sites`, `search-parties`; EVM-020, EVM-021: kontrolki OSD i zarządcy pytają równolegle; wyniki wszystkich trzech wyszukiwań wliczają się do jednego licznika masowego odczytu P10, co kompensuje osobne kubełki; klucz to identyfikator użytkownika, nie adres IP — jeden użytkownik nie blokuje innych; liczy się każde uwierzytelnione i uprawnione żądanie, także odrzucone walidacją; licznik w pamięci procesu) | ten dokument |
| partia synchronizacji | ≤ **50** mutacji, mutacja ≤ 64 KB | ADR-0008, [`offline-sync.md`](offline-sync.md#limity-i-retencje) |
| podpisane URL-e | pobieranie TTL ≤ 5 min; części uploadu TTL 60 min; wystawianie ≤ **300 / 10 min / użytkownika** + alert | ADR-0009 |
| eksport ZIP | **1 / 10 min / użytkownika**, limit rozmiaru | ADR-0009 |
| pliki | zdjęcie ≤ 50 MB; wideo ≤ 4 GB i ≤ 30 min; dokument ≤ 100 MB | ADR-0009 |
| klucze idempotencji | retencja **30 dni** | ADR-0004 |

**Wykrywanie masowego odczytu:** liczba rekordów zwróconych użytkownikowi przez listy i wyszukiwanie w oknie czasowym jest metryką; próg i alert ustala EVM-005 zgodnie z ADR-0013 (jak dla podpisanych URL-i i eksportów); alert w logu nie zawiera użytkownika, a osobę wskazuje zdarzenie audytu `bulk_read.alerted` (odrzucenie: `bulk_read.rejected`).

**Limity obiektów podrzędnych** (przekroczenie → `422 limit_exceeded`; wartości startowe, zmiana w konfiguracji):
| Obiekt | Maks. |
|---|---|
| pozycje zakresu na zlecenie | 50 |
| procesy na zlecenie / etapy na proces | 30 / 30 |
| etapy płatności na zlecenie | 20 |
| przypisania na zlecenie | 20 |
| wpisy dziennika na zlecenie | 10 000 |
| media na zlecenie | 5 000 |
| dokumenty na kotwicę / wersje na dokument | 500 / 50 |

**Długości pól** (`maxLength`, wartości startowe):
| Pole | Maks. |
|---|---|
| nazwy, tytuły, `displayName` | 200 |
| treść wpisu i komentarza (`body`) | 10 000 |
| opisy i uwagi (`description`, `notes`) | 2 000 |
| powód (`statusReason`, `blockedReason`, powód przejścia) | 500 |
| e-mail / telefon (E.164) | 254 / 16 |
| kod konfiguracji / numer faktury / PPE / nazwa pliku | 64 / 60 / 40 / 255 |
| fraza wyszukiwania / lista wartości filtra | 100 / 20 elementów |

## Nagłówki
**Odpowiedzi API (wszystkie, także błędy):**
- `Cache-Control: no-store` (ASVS 14.3.2, 14.2.2);
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `Content-Type: application/json; charset=utf-8` albo `application/problem+json; charset=utf-8` (ASVS 4.1.1 — parametr `charset` jest wymagany naszą regułą, parsery JSON go ignorują);
- **brak nagłówków CORS** (CORS wyłączony, ADR-0004);
- `ETag` (zasób), `Retry-After` (`429`, `503`, `409 idempotency_in_progress`), `Deprecation` / `Sunset` / `Link` (wycofanie), `Idempotent-Replayed` (powtórka).
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` na każdej odpowiedzi API ustawia samo API (EVM-008, SR-API-03), razem z nagłówkami wyżej — także na błędach 400/401/403/404/413/500; brak `X-Powered-By`. **HSTS** i nagłówki panelu na produkcji ustawia reverse proxy (EVM-076), wartości wg EVM-005 (P11).

**Żądania:** `Idempotency-Key`, `If-Match`, `X-Client-Platform`, `X-Client-Version`, `X-CSRF-Token` (web); sesja — ciasteczko `__Host-evia_session` (web) albo `Authorization: Bearer` z nieprzezroczystym tokenem dostępu (mobile, ADR-0005).

## Pliki i podpisane URL-e
- Pliki **nigdy nie przechodzą przez API** — upload i pobieranie bezpośrednio do / z object storage przez podpisane URL-e (ADR-0009).
- Upload: `POST /api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}/upload-sessions` (deklaracja rozmiaru, typu, SHA-256; `id` sesji z klienta) → URL-e części; `POST …/upload-sessions/{uploadSessionId}/complete` → stan `uploaded` i skan. Dla dokumentów analogicznie pod `…/documents/{documentId}/versions`.
- Pobieranie: `POST …/media-assets/{mediaAssetId}/download-url` (wariant: miniatura, podgląd, oryginał) → podpisany `GET` z TTL ≤ 5 min. `POST`, a nie `GET`: brak cache'owania, limit i audyt (oryginały i dokumenty). Plik w stanie innym niż `clean` / `ready` → `404`.
- Dokumenty i oryginały z `Content-Disposition: attachment` (nazwa w `filename*` UTF-8, oczyszczona); inline tylko pochodne o stałym typie.

## Dokumentowanie operacji w OpenAPI
Każda operacja w kontrakcie ma (reguły lint Redocly — ADR-0004):
- `operationId` wg konwencji, `tags` = moduł, `summary` i `description` po polsku;
- `x-evia-authz` (wyżej) — bez niego lint i test startowy kończą się błędem;
- schematy wejścia i wyjścia z limitami (`maxLength`, `maxItems`, `additionalProperties: false`, `readOnly`);
- wszystkie odpowiedzi błędów jako `application/problem+json` z listą możliwych `code` (enum w schemacie dla danej operacji);
- nagłówki: `ETag` i `If-Match` (zasoby współdzielone), `Idempotency-Key` (mutacje), `Retry-After` (`429`);
- przykłady **wyłącznie z danymi syntetycznymi** (np. „Klient Przykładowy”, „ul. Przykładowa 1, 00-000 Przykładowo”) — nigdy dane prawdziwych klientów;
- wspólne komponenty: `Problem`, `Uuidv7`, `Money`, `BusinessDate`, `Timestamp`, `CursorPage`;
- reguła lint: parametry zapytania o nazwach wskazujących dane osobowe (`name`, `phone`, `email`, `address`, `street`, `meteringPointId`) są zakazane.

## Źródła
Statusy zweryfikowane 2026-10-03:
- RFC 9457 *Problem Details for HTTP APIs* (2023, Standards Track; zastępuje RFC 7807): https://www.rfc-editor.org/info/rfc9457
- RFC 9562 *Universally Unique IDentifiers (UUIDs)* (2024, Standards Track; zastępuje RFC 4122; UUIDv7): https://www.rfc-editor.org/info/rfc9562
- RFC 9745 *The Deprecation HTTP Response Header Field* (2025, Proposed Standard; wartość — Structured Field Date, np. `@1688169599`): https://www.rfc-editor.org/info/rfc9745
- RFC 8594 *The Sunset HTTP Header Field* (2019, Informational; HTTP-date): https://www.rfc-editor.org/info/rfc8594
- `draft-ietf-httpapi-idempotency-key-header-07` (2025-10-15, wygasły Internet-Draft, nie RFC; brak klucza → 400, równoległe → 409, inna treść → 422): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- RFC 9110 *HTTP Semantics* (`ETag`, `If-Match`, `412`, `426`): https://www.rfc-editor.org/rfc/rfc9110 ; RFC 6585 (`428`, `429`): https://www.rfc-editor.org/rfc/rfc6585
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
