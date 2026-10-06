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
| `src/modules/audit` | dziennik audytu tylko do dopisywania (subskrybuje zdarzenia `identity`, zapis w transakcji zmiany; IP skracany do /24 i /48) |
| `src/cli` | polecenie na serwerze (`bootstrap-admin`): kontrola terminala przed czymkolwiek innym, argumenty, przepływ |
| `src/migrations` | migracje SQL (`sql```), tylko w przód |

Granice (dependency-cruiser): `platform` nie importuje `modules`; moduły i korzeń kompozycji sięgają do modułu tylko przez `modules/<nazwa>/index.ts`; warstwa `domain` bez NestJS, Express, Kysely i `pg`. Sterownik `pg` wyłącznie w `src/platform/database` (reguła ESLint).

## Autoryzacja (deny-by-default)
Każdy handler ma `@OperationId('<operationId z kontraktu>')`; polityka pochodzi wyłącznie z manifestu `@evia/contracts/authz`:
Kolejność kontroli jest stała (szczegóły: `docs/architecture/api-guidelines.md` → Autoryzacja): manifest → operacja publiczna (Origin + Sec-Fetch-Site + limit) → sesja → CSRF → limit logowania i MFA → stan `mfa_enrollment` → kanał → rola → polityka obiektowa w przypadku użycia (`404`).
1. brak `operationId` lub polityki w manifeście → `403 forbidden` (a przy starcie — błąd: aplikacja nie wstaje, gdy trasa nie ma polityki albo „pożycza” operację o innej metodzie lub ścieżce);
2. `x-evia-authz: { public: true }` → przepuszczone tylko dla operacji z `PUBLIC_OPERATIONS` (dziś `getHealth`, `checkActivationLink`, `setActivationPassword`);
3. brak sesji → `401 unauthenticated` (sesja unieważniona → `401 session_revoked`); nieistniejąca trasa bez sesji też `401` (bez ujawniania mapy tras);
4. mutacja sesji bez poprawnego `Origin`, `Sec-Fetch-Site` i `X-CSRF-Token` → `403 csrf_failed`; sesja `mfa_enrollment` poza operacjami z `MFA_ENROLLMENT_OPERATIONS` → `403 mfa_enrollment_required`; rola lub kanał spoza polityki → `403 forbidden`.
Testy macierzy ról są generowane z kontraktu (`test/authorization/role-matrix.ts`): każda operacja × Administrator / Edytor / Tylko odczyt × `web` / `mobile` × stan sesji + niezalogowany + unieważniona sesja, przypadek IDOR dla operacji z parametrem ścieżki, test kompletności i test testu z „dziurawą” polityką.

## Konfiguracja
Zmienne i przykłady: `.env.example` (`DATABASE_URL`, `API_PORT`, `LOG_LEVEL`, `NODE_ENV`, `MIN_SUPPORTED_APP_VERSION_ANDROID`, `MIN_SUPPORTED_APP_VERSION_IOS`, `PANEL_ORIGIN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `TRUSTED_PROXIES`). `LOG_LEVEL` `debug`/`trace` tylko przy `NODE_ENV=development`.
