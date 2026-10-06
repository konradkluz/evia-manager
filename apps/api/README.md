# `@evia/api` — API EVia Manager (NestJS)

Szkielet z EVM-008 (AC1, AC2, AC4; ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0013). Modularny monolit NestJS 12 (Express 5), PostgreSQL przez Kysely, kontrakt z `@evia/contracts`.

## Polecenia
| Polecenie | Co robi |
|---|---|
| `pnpm --filter @evia/api run build` | `tsc` → `dist/` (NestJS wymaga dekoratorów, których Node nie usuwa) |
| `pnpm --filter @evia/api run start` | `node dist/src/main.js` — wymaga zmiennych z `.env.example` |
| `pnpm --filter @evia/api run db:migrate` | migracje „w przód” (Kysely `Migrator`); nigdy przy starcie API |
| `pnpm --filter @evia/api run test:coverage` | testy jednostkowe i HTTP bez bazy, próg 85% linii i gałęzi (warstwa backend); w kontenerze `backend-tests` w ramach `gate:backend` |
| `pnpm --filter @evia/api run test:integration` | testy z PostgreSQL: Testcontainers (CI, job `backend-integration`) albo baza z `EVIA_TEST_DATABASE_URL` |

Testy integracyjne lokalnie (ADR-0015 — bez gniazda Dockera w kontenerze):
`docker compose -f compose.yaml run --rm backend-tests pnpm --filter @evia/api run test:integration` (usługa `postgres` z `compose.yaml`).

## Struktura
| Ścieżka | Odpowiedzialność |
|---|---|
| `src/main.ts`, `src/app.ts`, `src/app.module.ts` | punkt wejścia, potok HTTP (kontekst żądania → nagłówki → log → parser JSON), korzeń kompozycji |
| `src/platform/config` | zmienne środowiska walidowane Zod przy starcie; błąd podaje tylko nazwy kluczy |
| `src/platform/logging` | pino z redakcją po znormalizowanych nazwach kluczy (lista ADR-0013), serializer błędów bez szczegółów sterownika |
| `src/platform/http` | nagłówki SR-API-03, `problem+json` (RFC 9457) i filtr błędów, `traceId`, port `PRINCIPAL_RESOLVER`, `@OperationId` |
| `src/platform/database` | pula `pg` z krótkimi limitami czasu, Kysely, port `DatabaseProbe`, migrator |
| `src/platform/health` | `GET /api/health` (`getHealth`, publiczne) |
| `src/modules/authorization` | globalny guard deny-by-default, test startowy „każda trasa ma politykę z kontraktu”, punkt wpięcia sesji (E1) |
| `src/migrations` | migracje SQL (`sql```), tylko w przód |

Granice (dependency-cruiser): `platform` nie importuje `modules`; moduły i korzeń kompozycji sięgają do modułu tylko przez `modules/<nazwa>/index.ts`; warstwa `domain` bez NestJS, Express, Kysely i `pg`. Sterownik `pg` wyłącznie w `src/platform/database` (reguła ESLint).

## Autoryzacja (deny-by-default)
Każdy handler ma `@OperationId('<operationId z kontraktu>')`; polityka pochodzi wyłącznie z manifestu `@evia/contracts/authz`:
1. brak `operationId` lub polityki w manifeście → `403 forbidden` (a przy starcie — błąd: aplikacja nie wstaje, gdy trasa nie ma polityki albo „pożycza” operację o innej metodzie lub ścieżce);
2. `x-evia-authz: { public: true }` → przepuszczone tylko dla operacji z `PUBLIC_OPERATIONS` (dziś `getHealth`);
3. brak sesji → `401 unauthenticated`; nieistniejąca trasa bez sesji też `401` (bez ujawniania mapy tras);
4. sesja bez modelu ról (do E1) → `403`.

## Konfiguracja
Zmienne i przykłady: `.env.example` (`DATABASE_URL`, `API_PORT`, `LOG_LEVEL`, `NODE_ENV`, `MIN_SUPPORTED_APP_VERSION_ANDROID`, `MIN_SUPPORTED_APP_VERSION_IOS`). `LOG_LEVEL` `debug`/`trace` tylko przy `NODE_ENV=development`.
