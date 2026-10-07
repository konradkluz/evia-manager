# `@evia/api` — API EVia Manager (NestJS)

Szkielet z EVM-008 (AC1, AC2, AC4; ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0013). Modularny monolit NestJS 12 (Express 5), PostgreSQL przez Kysely, kontrakt z `@evia/contracts`.

## Polecenia
| Polecenie | Co robi |
|---|---|
| `pnpm --filter @evia/api run build` | `tsc` → `dist/` (NestJS wymaga dekoratorów, których Node nie usuwa) |
| `pnpm --filter @evia/api run start` | `node dist/src/main.js` — wymaga zmiennych z `.env.example` |
| `pnpm --filter @evia/api run db:migrate` | migracje „w przód” (Kysely `Migrator`); nigdy przy starcie API |
| `pnpm --filter @evia/api run test:coverage` | testy jednostkowe i HTTP bez bazy, próg 85% linii i gałęzi (warstwa backend) dla kodu niezależnego od bazy; w kontenerze `backend-tests` w ramach `gate:backend` |
| `pnpm --filter @evia/api run test:integration` | testy z PostgreSQL: Testcontainers (CI, job `backend-integration`) albo baza z `EVIA_TEST_DATABASE_URL`; mierzy kod związany z bazą (`coverage.config.ts`) z progiem 85% — API łączy się tu rolą `evia_app` (członek roli, nie właściciel), więc brak `GRANT` wychodzi w testach |
| `pnpm --filter @evia/api run admin:activate` | polecenie na serwerze: pierwszy Administrator i tryb awaryjny (EVM-016) — tylko `docker exec -it`, runbook `docs/ops/runbooks/aktywacja-i-tryb-awaryjny.md` |

Testy integracyjne lokalnie (ADR-0015 — bez gniazda Dockera w kontenerze):
`docker compose -f compose.yaml run --rm backend-tests pnpm --filter @evia/api run test:integration` (usługa `postgres` z `compose.yaml`).

## Struktura
| Ścieżka | Odpowiedzialność |
|---|---|
| `src/main.ts`, `src/app.ts`, `src/app.module.ts` | punkt wejścia, potok HTTP (kontekst żądania → nagłówki → log → parser JSON), korzeń kompozycji |
| `src/platform/config` | zmienne środowiska walidowane Zod przy starcie; błąd podaje tylko nazwy kluczy |
| `src/platform/logging` | pino z redakcją po znormalizowanych nazwach kluczy (lista ADR-0013), serializer błędów bez szczegółów sterownika |
| `src/platform/http` | nagłówki SR-API-03, `problem+json` (RFC 9457, z `errors[]`) i filtr błędów, `traceId`, sesja rozstrzygana raz na żądanie (`SESSION_RESOLVER` → `principalOf`), treść żądań (415, 413, 8 KB dla anonimowych operacji publicznych, 1 MB dla sesji; metody inne niż standardowe → 405), limity per IP, walidacja Zod (`validation_failed`), kontrola parametrów zapytania, `@OperationId` |
| `src/platform/clock`, `events`, `net`, `alerts` | wstrzykiwany zegar (jedyne źródło czasu), dispatcher zdarzeń w procesie (`publish(tx, event, context)`), prefiksy adresów IP (/24, /48, /64), outbox alertów bezpieczeństwa |
| `src/platform/database` | pula `pg` z krótkimi limitami czasu, Kysely, port `DatabaseProbe`, migrator |
| `src/platform/health` | `GET /api/health` (`getHealth`, publiczne) |
| `src/modules/authorization` | globalny guard deny-by-default (stała kolejność: manifest → operacja publiczna → sesja → CSRF → stan `mfa_enrollment` → kanał i rola), test startowy „każda trasa ma politykę z kontraktu”, resolver sesji przez fasadę `identity` |
| `src/modules/identity` | konta, hasła (Argon2id, polityka P2), klucze dostępu (WebAuthn), linki jednorazowe, sesje; aktywacja, wylogowanie; publikuje zdarzenia (`events.ts`), nie importuje `audit` |
| `src/modules/catalog` | katalog usług, szablony procesów i zleceń, rodzaje dokumentów — konfiguracja tylko do odczytu (EVM-019): zestawy parametrów technicznych (Zod strict), test spójności konfiguracji, odczyt przez 5 operacji `GET`; zależy tylko od `platform` |
| `src/modules/audit` | dziennik audytu tylko do dopisywania (subskrybuje zdarzenia `identity`, zapis w transakcji zmiany; IP skracany do /24 i /48) |
| `src/cli` | polecenie na serwerze (`bootstrap-admin`): kontrola terminala przed czymkolwiek innym, argumenty, przepływ |
| `src/migrations` | migracje SQL (`sql```), tylko w przód; `data/` — zamrożone kopie danych startowych migracji danych (bez importu z modułów) |

Granice (dependency-cruiser): `platform` nie importuje `modules`; moduły i korzeń kompozycji sięgają do modułu tylko przez `modules/<nazwa>/index.ts`; warstwa `domain` bez NestJS, Express, Kysely i `pg`. Sterownik `pg` wyłącznie w `src/platform/database` (reguła ESLint).

## Autoryzacja (deny-by-default)
Każdy handler ma `@OperationId('<operationId z kontraktu>')`; polityka pochodzi wyłącznie z manifestu `@evia/contracts/authz`:
Kolejność kontroli jest stała (szczegóły: `docs/architecture/api-guidelines.md` → Autoryzacja): manifest → operacja publiczna (Origin + Sec-Fetch-Site + limit) → sesja → CSRF → limit logowania i MFA → stan `mfa_enrollment` → kanał → rola → step-up (`403 step_up_required`, tylko operacje z `stepUp: true`) → polityka obiektowa w przypadku użycia (`404`).
1. brak `operationId` lub polityki w manifeście → `403 forbidden` (a przy starcie — błąd: aplikacja nie wstaje, gdy trasa nie ma polityki albo „pożycza” operację o innej metodzie lub ścieżce);
2. `x-evia-authz: { public: true }` → przepuszczone tylko dla operacji z `PUBLIC_OPERATIONS` (dziś `getHealth`, `checkActivationLink`, `setActivationPassword`, `login`, `getLoginPasskeyOptions`, `verifyLoginPasskey`);
3. brak sesji → `401 unauthenticated` (sesja unieważniona → `401 session_revoked`, sesja, której minął czas → `401 session_expired`); nieistniejąca trasa bez sesji też `401` (bez ujawniania mapy tras);
4. mutacja sesji bez poprawnego `Origin`, `Sec-Fetch-Site` i `X-CSRF-Token` → `403 csrf_failed`; sesja `mfa_enrollment` poza operacjami z `MFA_ENROLLMENT_OPERATIONS` → `403 mfa_enrollment_required`; rola lub kanał spoza polityki → `403 forbidden`.
Testy macierzy ról są generowane z kontraktu (`test/authorization/role-matrix.ts`): każda operacja × Administrator / Edytor / Tylko odczyt × `web` / `mobile` × stan sesji + niezalogowany + unieważniona i wygasła sesja, przypadek IDOR dla operacji z parametrem ścieżki, test kompletności i test testu z „dziurawą” polityką.

## Logowanie i sesje (moduł `identity`, EVM-067)
Dwa kroki, wszystkie operacje publiczne, kanał `web` nadaje ścieżka (nie klient). Wartości i mechanizmy (ASVS V6.1.1, V7.1.1):

| Co | Wartość | Gdzie |
|---|---|---|
| bezczynność sesji | **60 min** od ostatniej aktywności | `SESSION_IDLE_MS` (`domain/constants.ts`) |
| limit bezwzględny sesji | **12 h** od zalogowania, nie przesuwa się | `SESSION_ABSOLUTE_MS` |
| zapis aktywności | co najwyżej co 30 s; odczyt sesji (`getCurrentSession`) i `extendSession` nie są aktywnością | `SESSION_TOUCH_INTERVAL_MS`, `PASSIVE_OPERATIONS` |
| `loginToken` (pierwszy krok) | 256 bitów, w bazie tylko SHA-256, **5 min**, jednorazowy, maks. 5 nieudanych kluczy | `LOGIN_ATTEMPT_TTL_MS`, `LOGIN_MAX_FAILED_PASSKEYS` |
| wyzwanie WebAuthn | ≥ 128 bitów (256), w bazie SHA-256, **5 min**, jednorazowe; zużywane przy każdej weryfikacji, nowe opcje unieważniają poprzednie | `CHALLENGE_TTL_MS` |
| wiersze prób logowania | usuwane przy następnym pierwszym kroku, najpóźniej 24 h po wygaśnięciu; brak adresu IP i user agenta w tabeli (RODO — dane klienta tylko w sesji i prefiks w audycie) | `LOGIN_ATTEMPT_RETENTION_MS`, migracja `0006` |
| limit prób | 20 na minutę z jednego IP dla `login`, `getLoginPasskeyOptions`, `verifyLoginPasskey` (wspólny), liczony w guardzie przed dostępem do bazy; IP tylko z `request.ip` (`TRUSTED_PROXIES`), nigdy z surowego `X-Forwarded-For`; `429 rate_limited` z `Retry-After` | `AUTHENTICATION_OPERATIONS`, `platform/http/rate-limiter.ts` |

- **Jednakowe odpowiedzi (SR-AUTH-05):** zły e-mail, złe hasło, konto zaproszone i dezaktywowane → ten sam `401 invalid_credentials` (kod, treść, nagłówki) i dokładnie jedna weryfikacja Argon2id — dla konta aktywnego względem jego hasha, w pozostałych przypadkach względem hasha-wabika wygenerowanego przy starcie bieżącymi `ARGON2_PARAMETERS` i weryfikowanego tą samą ścieżką `verify`. Hasło jest normalizowane do NFC (jak przy aktywacji), bez przycinania i zmiany wielkości liter; polityka długości nie obowiązuje przy logowaniu, schemat sprawdza kształt (e-mail ≤ 254, hasło ≤ 1024). Powód porażki trafia tylko do audytu (`login.failed`: `bad_password`, `unknown_user`, `not_active`, `passkey_failed`, `login_expired`; bez hasła, e-maila i jego skrótu) i do metryki `evia_login_failures_total{reason}` (`platform/metrics`; wystawienie do Prometheusa — EVM-007).
- **Drugi krok (SR-AUTH-09):** klucz szukany po `credential_id` **i** koncie z `loginToken` (klucz innego konta = `401 passkey_failed`), `userHandle` musi być kontem, `allowCredentials` tylko z jego kluczami, `userVerification: required`, origin i RP ID z konfiguracji. Sukces w jednej transakcji: atomowe zużycie wyzwania i `loginToken`, ponowna kontrola `users.status` pod blokadą `FOR SHARE`, licznik i `last_used_at` klucza, `lastLoginAt`, nowa sesja (token z CSPRNG), unieważnienie sesji z ciasteczka żądania (`rotated`; przy podwójnym ciasteczku nic) i audyt `login.succeeded`. Dwa równoległe żądania z tą samą asercją dają jedną sesję.
- **Step-up i dziennik audytu (EVM-029; SR-SESS-08, SR-SESS-02):** operacja z `stepUp: true` wymaga uwierzytelnienia kluczem w sesji w ciągu 15 minut (`passkey_authenticated_at`, zegar wstrzykiwany; po roli i kanale, więc E i R dostają `forbidden`); `getStepUpPasskeyOptions` i `stepUp` (limit 20/min/IP): wyzwanie o celu `passkey_step_up` powiązane z sesją, asercja tym samym kodem co logowanie (`passkey-assertion.ts`), sukces w jednej transakcji — warunkowy `UPDATE` kończy sesję (`rotated`), nowa sesja z nowym tokenem i CSRF, limit 12 h bez zmian; porażka → `401 passkey_failed` i `step_up.failed`, sesja bez zmian. `listAuditEvents`: kursor `(occurred_at, id)`, jawna lista kolumn, `audit.read` w tej samej transakcji (fail closed), nazwy osób przez fasadę `UserDirectory.displayNamesOf`.
- **Wygasanie (SR-SESS-03):** wszystkie stany sesji (`active`, `mfa_enrollment` z linkiem i bez); kolejność: unieważniona → wygasła → dopiero potem przesunięcie bezczynności warunkowym `UPDATE` (wygasła sesja nie wraca). Wygasła sesja: `401 session_expired`, `session.expired` w audycie dokładnie raz (`revoke_reason = 'expired'`). Czas rzeczywisty z wstrzykiwanego zegara.
- **Sesja `mfa_enrollment` po samym haśle** (konto aktywne bez klucza): bez linku, nie może zarejestrować czynnika (`registerPasskey` odrzucone); rejestracja czynnika po samym haśle — EVM-023 / SR-AUTH-13.

## Katalog i szablony (moduł `catalog`, EVM-019)
- **Dane startowe** to migracja danych `0008_catalog_seed` (schemat `0007_catalog`) z zamrożonej kopii `src/migrations/data/catalog-seed-2026-10.ts` wg `docs/product/service-catalog.md`: 12 pozycji katalogu, 10 szablonów procesów (32 etapy), 16 rodzajów dokumentów, 5 szablonów zleceń (26 pozycji, 11 transz). Zmiana danych = **nowa migracja danych z własną zamrożoną kopią** (nigdy edycja starej); migracje nie czytają zegara bazy (stały znacznik czasu w danych) i wstawiają wartości tylko jako parametry.
- **Tylko do odczytu:** rola `evia_app` ma `USAGE` na schemacie i jawne `SELECT` na każdej tabeli, nic więcej (bez `ALTER DEFAULT PRIVILEGES`); kontrakt nie ma operacji `POST`/`PUT`/`PATCH`/`DELETE` w `/api/v1/catalog` (edytor — M4). Testowe wycofanie szablonu (`is_active = false`) robi rola migracyjna.
- **Operacje** (wszystkie `GET`, role Administrator / Edytor / Tylko odczyt, kanał `web`, bez audytu — odczyt konfiguracji nie jest zdarzeniem wrażliwym): `listWorkOrderTemplates` (`?siteTypeHint=`, tylko aktywne), `getWorkOrderTemplate` (po `templateId`, także wycofany; nieznany → `404 not_found`, zły format → `400 validation_failed`), `listServiceItems`, `listProcedureTemplates`, `listDocumentKinds`. Zbiory są małe i zwracane w całości w kopercie `{ items, nextCursor: null }` (≤ 100 elementów — pilnuje test spójności); `limit` i `cursor` nie są deklarowane (→ `400 unknown_parameter`) do czasu edytora w M4. Odpowiedź jest walidowana schematem kontraktu, a nagłówek to wyłącznie globalne `Cache-Control: no-store`. Procesy podglądu szablonu to procesy wnoszone przez jego pozycje (współdzielony proces — raz).
- **Zestawy parametrów** (`domain/parameter-sets.ts`): `charger_spec`, `charger_installation`, `supply_circuit`, `connection_power`, `dso_request` — ścisłe (bez pól dodatkowych, także `__proto__`), zakresy liczb, tekst NFC bez znaków sterujących, ≤ 16 KB JSON-a w bajtach UTF-8 (to samo `octet_length` w CHECK kolumny `default_parameters`). Widok `defaults` (pola opcjonalne) dla pozycji szablonu, `full` dla pozycji zlecenia (EVM-022).
- **Spójność konfiguracji** (`domain/config-consistency.ts`, `validateCatalogConfig`): suma udziałów = 100, wzorzec kodu `^[a-z][a-z0-9_]{1,63}$`, nieznany `parameterSetCode`, etap z nieistniejącym rodzajem dokumentu, wartości domyślne względem schematu itd.; błąd wskazuje kod elementu. Uruchamiany w bramce (test na danych startowych i na danych odczytanych z bazy).

## Konfiguracja
Zmienne i przykłady: `.env.example` (`DATABASE_URL`, `API_PORT`, `LOG_LEVEL`, `NODE_ENV`, `MIN_SUPPORTED_APP_VERSION_ANDROID`, `MIN_SUPPORTED_APP_VERSION_IOS`, `PANEL_ORIGIN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `TRUSTED_PROXIES`). `LOG_LEVEL` `debug`/`trace` tylko przy `NODE_ENV=development`.
