# `@evia/contracts` — kontrakt API (OpenAPI 3.1)

Pakiet z EVM-008 (AC2; ADR-0004, `docs/architecture/api-guidelines.md`). Specyfikacja w `openapi/` jest **źródłem prawdy** API: z niej powstają typy TypeScript, klient `fetch` dla panelu web (i aplikacji mobilnej od EVM-009), schematy Zod dla walidacji w API oraz manifest autoryzacji dla guardu deny-by-default.

## Polecenia
- `pnpm --filter @evia/contracts run build` — `redocly bundle` → `dist/openapi.json` (jedyne wejście generatora) → `@hey-api/openapi-ts` → `generated/` → `tsc` → `dist/` (JavaScript + `.d.ts`). `dist/` i `generated/` nie trafiają do gita; konsumenci zależą od zadania `^build`.
- `pnpm --filter @evia/contracts run lint` — ESLint i lint kontraktu (Redocly z lokalnym pluginem `evia`, telemetria wyłączona).
- `pnpm --filter @evia/contracts run test:coverage` — testy Vitest `EVM-008 AC2` z progiem 90% linii i gałęzi.

## Układ specyfikacji
| Plik | Zawartość |
|---|---|
| `openapi/openapi.yaml` | korzeń: `info`, `servers`, tagi, mapa ścieżek i komponentów |
| `openapi/paths/<moduł>.yaml` | operacje modułu (dziś `platform`: `GET /api/health`) |
| `openapi/components/*.yaml` | schematy współdzielone: `Problem` (RFC 9457), `Semver`, schematy modułów |

## Reguły lint (`redocly.yaml`)
- `recommended-strict` Redocly + `operationId`, `summary`, `description`, tag zdefiniowany.
- `evia/authz-required` — każda operacja ma obiekt `x-evia-authz` (SR-AUTHZ-01).
- `evia/public-allow-list` — `x-evia-authz: { public: true }` tylko dla operacji z `src/public-operations.ts` (dziś `getHealth`); tę samą listę sprawdza guard API w czasie działania.
- `evia/no-personal-data-parameters` — parametry `query` i `path` o nazwach wskazujących dane osobowe lub sekrety są zakazane (porównanie bez wielkości liter, `_`, `-`, także podciągi: `customerEmail`, `phone_number`; SR-API-04).
- `rule/error-responses-are-problem-json` — odpowiedzi błędów wyłącznie `application/problem+json`.
- Wyjątki: `.redocly.lint-ignore.yaml`, każdy z uzasadnieniem.

Fixtures negatywne w `test/fixtures/` dowodzą, że każda reguła zatrzymuje błędny kontrakt.

## Eksporty
| Import | Zawartość |
|---|---|
| `@evia/contracts` | typy, funkcje SDK (`getHealth`), `client`, `createClient`, `createConfig` |
| `@evia/contracts/zod` | schematy Zod (`zHealth`, `zProblem`, `zSemver`, …) |
| `@evia/contracts/authz` | `AUTHZ_MANIFEST` (`operationId` → metoda, ścieżka, `x-evia-authz`), `PUBLIC_OPERATIONS` |
| `@evia/contracts/openapi.json` | zbundlowana specyfikacja |

## Kompatybilność
- Schematy **odpowiedzi** nie mają `additionalProperties: false`: w `v1` zmiany są tylko addytywne, a klienci ignorują nieznane pola (ADR-0004). Dokładny zestaw pól wysyłanych przez serwer sprawdzają testy API. Ścisłość (`additionalProperties: false`) dotyczy schematów **wejścia**.
- `Problem.type` to odwołanie względne `/problems/{code}`; klienci rozpoznają błąd po `code`.
