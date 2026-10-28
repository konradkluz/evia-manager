# `@evia/contracts` — kontrakt API (OpenAPI 3.1)

Pakiet z EVM-008 (AC2; ADR-0004, `docs/architecture/api-guidelines.md`). Specyfikacja w `openapi/` jest **źródłem prawdy** API: z niej powstają typy TypeScript, klient `fetch` dla panelu web (i aplikacji mobilnej od EVM-009), schematy Zod dla walidacji w API oraz manifest autoryzacji dla guardu deny-by-default.

## Polecenia
- `pnpm --filter @evia/contracts run build` — `redocly bundle` → `dist/openapi.json` (jedyne wejście generatora) → `@hey-api/openapi-ts` → `generated/` → `tsc` → `dist/` (JavaScript + `.d.ts`). `dist/` i `generated/` nie trafiają do gita; konsumenci zależą od zadania `^build`.
- `pnpm --filter @evia/contracts run lint` — ESLint i lint kontraktu (Redocly z lokalnym pluginem `evia`, telemetria wyłączona).
- `pnpm --filter @evia/contracts run test:coverage` — testy Vitest `EVM-008 AC2` z progiem 90% linii i gałęzi.
- `pnpm --filter @evia/contracts run baseline:check` — porównanie zbudowanego kontraktu z `baseline/openapi.json` (kod ≠ 0 przy zmianie łamiącej; baseline nie musi być aktualny — to kontrakt ostatniego wydania; EVM-090 AC7).
- `pnpm --filter @evia/contracts run baseline:update` — **ręczny** zapis nowego baseline przy wydaniu albo po zaakceptowanej zmianie łamiącej; odmawia przy zmianie łamiącej, chyba że `-- --allow-breaking ADR-####`. Nigdy w CI.

## Układ specyfikacji
| Plik | Zawartość |
|---|---|
| `openapi/openapi.yaml` | korzeń: `info`, `servers`, tagi, mapa ścieżek i komponentów |
| `openapi/paths/<moduł>.yaml` | operacje modułu (`platform`, `identity` — w tym rodzina logowania mobilnego, `devices`, `sync`, …) |
| `openapi/components/*.yaml` | schematy współdzielone: `Problem` (RFC 9457), `Semver`, schematy modułów |

## Reguły lint (`redocly.yaml`)
- `recommended-strict` Redocly + `operationId`, `summary`, `description`, tag zdefiniowany.
- `evia/authz-required` — każda operacja ma obiekt `x-evia-authz` (SR-AUTHZ-01).
- `evia/public-allow-list` — `x-evia-authz: { public: true }` tylko dla operacji z `src/public-operations.ts` (dziś `getHealth`); tę samą listę sprawdza guard API w czasie działania.
- `evia/no-personal-data-parameters` — parametry `query` i `path` o nazwach wskazujących dane osobowe lub sekrety są zakazane (porównanie bez wielkości liter, `_`, `-`, także podciągi: `customerEmail`, `phone_number`; SR-API-04).
- `evia/public-channels` — operacja publiczna ma najwyżej jeden kanał; z `mobile` jest na `PUBLIC_OPERATIONS` i `MOBILE_OPERATIONS` (EVM-090).
- `evia/security-scheme-channel` — `mobileBearer` tylko na `[mobile]`, `webSession` tylko na `[web]`, operacja publiczna bez schematu, operacja mobilna z `mobileBearer`.
- `evia/mobile-no-set-cookie` — odpowiedź operacji mobilnej nie ustawia ciasteczek.
- `evia/planned-marker` — `x-evia-planned` ma wartość `true`. Operacja z tym znacznikiem jest w kontrakcie, ale bez trasy (bez zaślepek `501`); testy API iterujące po manifeście pomijają ją przez `implementedManifest()`.
- `evia/no-personal-data-parameters` obejmuje też parametry `header` i `cookie` o nazwach sekretów (tokeny tylko w treści albo w `Authorization`; wyjątki: `Idempotency-Key`, `X-CSRF-Token`).
- `rule/error-responses-are-problem-json` — odpowiedzi błędów wyłącznie `application/problem+json`.
- Wyjątki: `.redocly.lint-ignore.yaml`, każdy z uzasadnieniem.

Fixtures negatywne w `test/fixtures/` dowodzą, że każda reguła zatrzymuje błędny kontrakt.

## Eksporty
| Import | Zawartość |
|---|---|
| `@evia/contracts` | typy, funkcje SDK (`getHealth`), `client`, `createClient`, `createConfig` |
| `@evia/contracts/zod` | schematy Zod (`zHealth`, `zProblem`, `zSemver`, …) |
| `@evia/contracts/sync` | czytnik zmian synchronizacji (`parseSyncChange`, `SYNC_PROJECTIONS`, sprawdzenie ścisłe po stronie serwera; EVM-090) — osobny punkt wejścia, bo zależy od Zod w czasie działania i nie może trafiać do pakietu panelu (CSP `script-src 'self'`) |
| `@evia/contracts/authz` | `AUTHZ_MANIFEST` (`operationId` → metoda, ścieżka, `x-evia-authz`), `PUBLIC_OPERATIONS` |
| `@evia/contracts/mock-server` | atrapa serwera na przykładach kontraktu (`startMockServer`; tylko `127.0.0.1`, port efemeryczny; `Prefer: code=<status>`) — narzędzie developerskie i testowe, poza głównym eksportem |
| `@evia/contracts/openapi.json` | zbundlowana specyfikacja |

## Wykrywanie zmian łamiących (tymczasowy zamiennik oasdiff)
ADR-0004 i ADR-0012 przewidują **oasdiff** w CI; **nie ma go jeszcze w CI** (dług techniczny EVM-090). Do tego czasu `src/breaking-changes.ts` porównuje `dist/openapi.json` z `baseline/openapi.json` (kanoniczny JSON: posortowane klucze, LF) na schematach po rozwiązaniu `$ref`. Wykrywa m.in.: usunięcie operacji, metody, ścieżki lub statusu 2xx; zmianę `operationId`, `security`, `x-evia-authz`; dodanie wartości do zwykłego `enum` w odpowiedzi (`x-extensible-enum` jest wolne); usunięcie lub zawężenie `enum` w żądaniu; zaostrzenie limitów żądania (`maxLength`, `maxItems`, `maximum` w dół, `minimum` w górę), nowy `pattern`; nowe pole wymagane w żądaniu; usunięcie właściwości żądania i `additionalProperties: false`; pole odpowiedzi wymagane → opcjonalne. Konstrukcje nieobsługiwane (`oneOf`/`anyOf`/`allOf`/`discriminator` poza parą nullable), zmienione w jakikolwiek sposób, są zgłaszane jako łamiące (fail-closed). Operacje z `x-evia-planned: true` w baseline są pomijane. Baseline to kontrakt ostatniego wydania: aktualizuje się go ręcznie przy wydaniu albo przy zaakceptowanej zmianie łamiącej (`baseline:update`), a zmiany addytywne go nie unieważniają; test pilnuje tylko braku zmian łamiących. Dodanie typu do `SyncEntity` nie jest już zmianą łamiącą (otwarta koperta).

## Kompatybilność
- Schematy **odpowiedzi** nie mają `additionalProperties: false`: w `v1` zmiany są tylko addytywne, a klienci ignorują nieznane pola (ADR-0004). Dokładny zestaw pól wysyłanych przez serwer sprawdzają testy API. Ścisłość (`additionalProperties: false`) dotyczy schematów **wejścia**.
- `Problem.type` to odwołanie względne `/problems/{code}`; klienci rozpoznają błąd po `code`.
