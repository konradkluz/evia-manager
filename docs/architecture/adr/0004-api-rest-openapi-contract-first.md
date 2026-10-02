# ADR-0004: Styl i kontrakt API — REST/JSON, OpenAPI 3.1 contract-first, generowane typy, klienci i testy

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-002 (`api-guidelines.md`), EVM-005; ADR-0001, ADR-0002, ADR-0005, ADR-0008, ADR-0009, ADR-0014

## Kontekst i problem
Jedno API obsługuje panel web i aplikację mobilną; w terenie działają **starsze wersje aplikacji**, więc kontrakt musi być stabilny i wstecznie zgodny, a serwer musi umieć odciąć wersję z podatnością. Baseline bezpieczeństwa wymaga testów macierzy ról dla 100% endpointów — najtaniej generować je z kontraktu. Potrzebny jest styl API, źródło prawdy kontraktu, generowanie typów/klientów, konwencje (błędy, paginacja, idempotencja, wersjonowanie) i mechanizm minimalnej wersji klienta.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Kompatybilność wsteczna i wersjonowanie (starsze aplikacje w terenie) | 5 | brak możliwości wymuszenia natychmiastowej aktualizacji |
| Generowanie typów, klientów, walidacji i testów (w tym macierzy ról) | 5 | contract-first, 100% endpointów w macierzy ról |
| Prostota i dojrzałość narzędzi | 4 | mały zespół, agenci AI |
| Dopasowanie do synchronizacji offline i uploadów | 4 | idempotentne mutacje, kursory, podpisane URL-e |
| Bezpieczeństwo (limity, cache, powierzchnia ataku) | 4 | ASVS V3, V4 |
| Otwartość na integracje zewnętrzne (KSeF, kalendarz, portal) | 3 | M5 |

## Rozważane opcje
1. **A. REST/JSON + OpenAPI 3.1 contract-first** — specyfikacja w repo jest źródłem prawdy; generujemy typy, schematy walidacji i klientów.
2. **B. GraphQL** (schema-first) — elastyczne zapytania, jeden endpoint.
3. **C. tRPC / ts-rest** (code-first, typy z kodu TS) — świetne DX, ale kontrakt związany z TypeScript.
4. **D. gRPC / Connect** — kontrakt w Protobuf, binarny transport.

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Kompatybilność i wersjonowanie (5) | 5 | 4 | 2 | 4 |
| Generowanie typów, klientów i testów (5) | 5 | 4 | 4 | 4 |
| Prostota i dojrzałość narzędzi (4) | 4 | 3 | 4 | 3 |
| Dopasowanie do offline i uploadów (4) | 5 | 3 | 3 | 3 |
| Bezpieczeństwo (4) | 5 | 3 | 4 | 4 |
| Otwartość na integracje (3) | 5 | 3 | 1 | 2 |
| **Suma ważona (maks. 125)** | **121** | **85** | **77** | **86** |

Uwagi: GraphQL utrudnia limity kosztu zapytań, cache HTTP i autoryzację per pole (większa powierzchnia ataku). tRPC/ts-rest wiąże kontrakt z kodem serwera — trudniej o niezależną kontrolę zmian łamiących i integracje nie-TS. OpenAPI 3.2 (3.2.1 z 2026-09-10) jest addytywne względem 3.1, ale wsparcie narzędzi jest jeszcze częściowe — startujemy na 3.1, migracja później bez zmian semantyki. Wersje narzędzi zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. REST/JSON + OpenAPI 3.1, contract-first.**

**Łańcuch narzędzi (pakiet `packages/contracts`):**
- Specyfikacja dzielona na pliki per moduł, łączona i lintowana przez **Redocly CLI** (reguły stylu, w tym własne: każda operacja ma `operationId`, `x-evia-authz`, opis błędów, limity).
- **@hey-api/openapi-ts** generuje: typy TS, **schematy Zod** (walidacja w NestJS przez Standard Schema — ADR-0002) i klienta `fetch` dla web i mobile. Fallback, jeśli generator (wersja < 1.0) zawiedzie: `openapi-typescript` + `openapi-fetch` i generator schematów Zod.
- **oasdiff** w CI wykrywa zmiany łamiące względem `main` — zmiana łamiąca blokuje merge, chyba że towarzyszy jej ADR i nowa wersja ścieżki.
- **Rozszerzenie `x-evia-authz`** przy każdej operacji: dozwolone role i nazwa polityki obiektowej. Z niego generujemy testy **macierzy ról** (każda operacja × Administrator / Edytor / Tylko odczyt / niezalogowany + przypadek IDOR — cudzy obiekt) i test kompletności (liczba operacji w kontrakcie = liczba operacji w macierzy = 100%); guard serwera (ADR-0001) odrzuca trasę bez polityki.

**Konwencje (szczegóły w `api-guidelines.md`, EVM-002):**
- Ścieżki `/api/v1/...`; zasoby w liczbie mnogiej; czasy RFC 3339 w UTC; kwoty w groszach (`amountMinor`) + `currency`; identyfikatory UUIDv7 (klient może nadać `id` przy tworzeniu — serwer waliduje format, unikalność i uprawnienia; **UUID nie zastępuje autoryzacji**).
- **Błędy:** jednolity `application/problem+json` (RFC 9457) z polami `type`, `title`, `status`, `code` (stały kod maszynowy), `traceId`, opcjonalnie `errors[]` (walidacja pól). **Bez** stack trace'ów, zapytań SQL, nazw klas i danych innych użytkowników (ASVS V16). 404 zamiast 403 tam, gdzie samo istnienie obiektu jest informacją.
- **Paginacja:** kursorowa (`cursor`, `limit`), `limit` domyślnie 25, **maks. 100**; stabilne sortowanie.
- **Limity (ASVS V4):** treść JSON ≤ **1 MB** (pliki nigdy nie przechodzą przez API — idą bezpośrednio do storage'u, ADR-0009); długości pól i rozmiary tablic z kontraktu; **rate limiting** per IP i per użytkownik (domyślnie 300 żądań/min/użytkownik; endpointy uwierzytelniania ostrzej — ADR-0005), odpowiedź 429 z `Retry-After`.
- **CORS (ASVS V3):** panel web serwowany z tej samej domeny co API → CORS **wyłączony** (brak `Access-Control-Allow-Origin`); aplikacja natywna CORS nie potrzebuje. Każde przyszłe dopuszczenie originu wymaga listy dozwolonych originów (bez `*` i bez odbijania `Origin`) i przeglądu security.
- **Idempotencja:** każda mutacja (`POST`/`PATCH`/`DELETE`) z aplikacji mobilnej wymaga nagłówka `Idempotency-Key` (UUIDv7); serwer zapisuje klucz **powiązany z użytkownikiem i urządzeniem** (`user_id`, `device_id`, `key`) wraz ze skrótem treści i wynikiem; powtórzenie zwraca zapisany wynik, ten sam klucz z inną treścią → 422. Retencja kluczy: 30 dni (dłużej niż maksymalny czas pracy offline, ADR-0005). Web: zalecane dla operacji nieidempotentnych.
- **Współbieżność:** `ETag`/`If-Match` (pole `version`) dla edycji obiektów współdzielonych; konflikt → 412 z kodem `version_conflict` (polityka konfliktów w ADR-0008).
- **Kompatybilność wsteczna:** w ramach `v1` tylko zmiany addytywne (nowe pola opcjonalne, nowe endpointy, nowe wartości enumów tylko gdy klienci obsługują wartość „nieznana”); klienci ignorują nieznane pola. Wycofanie: nagłówki `Deprecation` i `Sunset`, okres ≥ 90 dni. Zmiana łamiąca = ADR + `/api/v2` dla dotkniętych zasobów.
- **Minimalna wersja aplikacji:** aplikacja wysyła `X-Client-Platform` (`ios`/`android`/`web`) i `X-Client-Version` (semver) w każdym żądaniu. Serwer ma konfigurację `minSupportedVersion` per platforma (zmienialną bez wdrożenia kodu). Starsza wersja → **426 Upgrade Required** z kodem `client_version_unsupported` (aplikacja blokuje pracę online, **zachowuje kolejkę offline** i prosi o aktualizację). Endpoint `GET /api/v1/meta/client-config` zwraca minimalną i zalecaną wersję. Mechanizm służy też do odcięcia wersji z podatnością (security).

## Konsekwencje
- **Pozytywne:** kontrakt niezależny od języka (integracje, ewentualna zmiana backendu); typy i walidacja z jednego źródła dla serwera, web i mobile; automatyczna kontrola zmian łamiących; macierz ról generowana z kontraktu (100% endpointów).
- **Negatywne / koszty:** ręczne pisanie YAML (mitygacja: lint, szablony operacji, przykłady); generator `@hey-api/openapi-ts` jest przed 1.0 (zmiany konfiguracji między minorami).
- **Ryzyka i mitygacje:**
  - *Rozjazd implementacji z kontraktem* → walidacja odpowiedzi względem schematu w testach integracyjnych + test inwentarza tras (każda operacja z kontraktu ma handler i odwrotnie) + Schemathesis na staging (ADR-0014).
  - *Ciche złamanie starszego klienta* → oasdiff jako bramka, testy kontraktowe klienta mobilnego na poprzedniej wersji kontraktu.
  - *Zmiany generatora* → przypięta wersja, aktualizacja przez Renovate z testem regeneracji.

## Plan wyjścia
Kontrakt OpenAPI jest przenośny: generator można wymienić (np. na `openapi-typescript`) bez zmiany kontraktu i serwera — koszt: dzień–dwa regeneracji i poprawek importów. Dodanie warstwy GraphQL/BFF w przyszłości nie wymaga zmiany REST.

## Weryfikacja
- EVM-006: w CI działają lint kontraktu, oasdiff i generacja; EVM-008: pierwszy endpoint przechodzi macierz ról z kontraktu.
- Po M2: zero incydentów niekompatybilności ze starszą wersją aplikacji; 100% operacji w macierzy ról.

## Źródła (zweryfikowane 2026-10-02)
- OpenAPI Specification 3.1 / 3.2.1 (2026-09-10): https://spec.openapis.org/oas/v3.2.1.html
- @hey-api/openapi-ts 0.99.0 (MIT): https://www.npmjs.com/package/@hey-api/openapi-ts
- openapi-typescript 7.13.0 / openapi-fetch 0.17.0 (MIT): https://www.npmjs.com/package/openapi-typescript
- Redocly CLI 2.57.0 (MIT, 2026-09-30): https://www.npmjs.com/package/@redocly/cli
- oasdiff v1.33.0 (2026-10-01): https://github.com/oasdiff/oasdiff/releases ; licencja **Apache-2.0** (zweryfikowane 2026-10-02): https://github.com/oasdiff/oasdiff/blob/main/LICENSE
- RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457
- IETF `Idempotency-Key` (draft): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
