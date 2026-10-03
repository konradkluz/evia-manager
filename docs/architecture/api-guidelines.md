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

- `code` — stały kod maszynowy (kontrakt), `title` — stały opis po angielsku dla danego `code`, `type` — URI dokumentacji kodu w domenie API (domena — EVM-007), `traceId` — korelacja z logami (ADR-0013), `errors[]` — tylko **ścieżka (JSON Pointer) i kod**.
- **Nigdy:** stack trace'ów, zapytań SQL, nazw klas, ścieżek plików, **wartości pól** ani danych innych użytkowników (ASVS 16.5.1). `detail` — opcjonalny, ogólny, bez danych. `500` zawsze jako `internal_error` z `traceId`.
- **404 czy 403:** obiekt spoza uprawnień użytkownika **albo** soft-deleted (dla ról innych niż Administrator) → `404 not_found` — samo istnienie obiektu jest informacją. `403 forbidden` tylko wtedy, gdy użytkownik może odczytać obiekt (albo kolekcję), ale nie ma uprawnienia do tej operacji (np. Tylko odczyt wysyła `PATCH`).

**Katalog kodów (v1)**
| HTTP | `code` | Kiedy |
|---|---|---|
| 400 | `validation_failed` | treść lub parametry niezgodne ze schematem (szczegóły w `errors[]`) |
| 400 | `malformed_json`, `duplicate_parameter`, `unknown_parameter` | niepoprawny JSON; powtórzony lub nieznany parametr zapytania |
| 400 | `idempotency_key_required`, `invalid_cursor` | brak klucza idempotencji w mutacji mobilnej; kursor niepoprawny, zmieniony, wygasły lub z innymi filtrami |
| 401 | `unauthenticated`, `session_expired`, `session_revoked` | brak lub koniec sesji; sesja albo urządzenie unieważnione (ADR-0005) |
| 403 | `forbidden` | znany obiekt, brak uprawnienia do operacji |
| 403 | `step_up_required`, `mfa_enrollment_required`, `csrf_failed` | wymagane ponowne uwierzytelnienie; Administrator bez MFA; nieudana kontrola CSRF (ADR-0005) |
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
| żądania na IP | limit per IP (wartość w EVM-005; propozycja 600/min) | ADR-0004, EVM-005 |
| logowanie i MFA | maks. 20 prób/min/IP, opóźnienia i blokada konta | ADR-0005 |
| wyszukiwanie | fraza 3–100 znaków; osobny kubełek 60 żądań/min/użytkownika (propozycja) | ten dokument |
| partia synchronizacji | ≤ **50** mutacji, mutacja ≤ 64 KB | ADR-0008, [`offline-sync.md`](offline-sync.md#limity-i-retencje) |
| podpisane URL-e | pobieranie TTL ≤ 5 min; części uploadu TTL 60 min; wystawianie ≤ **300 / 10 min / użytkownika** + alert | ADR-0009 |
| eksport ZIP | **1 / 10 min / użytkownika**, limit rozmiaru | ADR-0009 |
| pliki | zdjęcie ≤ 50 MB; wideo ≤ 4 GB i ≤ 30 min; dokument ≤ 100 MB | ADR-0009 |
| klucze idempotencji | retencja **30 dni** | ADR-0004 |

**Wykrywanie masowego odczytu:** liczba rekordów zwróconych użytkownikowi przez listy i wyszukiwanie w oknie czasowym jest metryką; próg i alert ustala EVM-005 zgodnie z ADR-0013 (jak dla podpisanych URL-i i eksportów).

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
- **CSP i HSTS** ustawia reverse proxy dla panelu i API — konfiguracja w EVM-008, wartości wg EVM-005.

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
