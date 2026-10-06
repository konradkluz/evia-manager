# `@evia/web` — panel web biura

Pakiet z EVM-008 (AC2–AC6; ADR-0006, ADR-0015). React 19 + Vite 8 (SPA), TanStack Router i TanStack Query, `i18next` (tylko `pl`), komponenty i style wyłącznie z `@evia/ui-web`, klient API wygenerowany z kontraktu (`@evia/contracts`).

## Polecenia (z katalogu głównego repozytorium)
| Polecenie | Co robi |
|---|---|
| `pnpm --filter @evia/web run dev` | serwer deweloperski Vite na `http://127.0.0.1:5173` (proxy `/api` → `http://localhost:${API_PORT:-3000}`); nagłówki bezpieczeństwa bez CSP (wariant `dev`) |
| `pnpm --filter @evia/web run build` | build produkcyjny do `dist/` (bez map źródeł) |
| `pnpm --filter @evia/web run preview` | podgląd buildu na `http://127.0.0.1:4173` z pełnymi nagłówkami i ścisłą CSP (wariant `strict`) |
| `pnpm --filter @evia/web run test:coverage` | testy komponentów i jednostkowe (Vitest + jsdom + Testing Library + `axe-core`), próg 80% (warstwa web) |
| `pnpm run e2e` / `pnpm --filter @evia/web run e2e` | Playwright na `vite preview`: Chromium i Firefox, na Windows także Edge (`msedge`) — dowód E2E wg ADR-0015 |
| `pnpm --filter @evia/web run e2e:screenshots` | zrzuty do przeglądu UX: 360 / 768 / 1280 / 1440 px, szuflada, podpowiedź, offline → `docs/ux/reviews/EVM-008/` (PNG poza gitem) |

Przeglądarki Playwright instaluje się raz: `pnpm --filter @evia/web exec playwright install chromium firefox` (Edge — systemowy).

## Struktura
| Ścieżka | Zawartość |
|---|---|
| `security-headers.ts` | **jedyne źródło** nagłówków panelu (P11, SR-WEB-01, SR-WEB-08): wariant `strict` (preview i produkcja; CSP bez `unsafe-inline`/`unsafe-eval`, bez hostów bucketu i Sentry do EVM-076), wariant `dev` (bez CSP — preambuła React Refresh); `https: true` dodaje `upgrade-insecure-requests` i HSTS (EVM-076); wtyczka Vite dla `preview` i `dev` |
| `src/router.tsx` | `/` → `/work-orders`; nieznana ścieżka → `/work-orders`; błąd strony → stan błędu w powłoce (bez szczegółów technicznych) |
| `src/paths.ts` | ścieżki po angielsku (URL to identyfikator); teksty po polsku z i18n |
| `src/shell/` | powłoka (`AppShell` z `@evia/ui-web` + nawigacja, baner offline), granica błędu, stan błędu |
| `src/pages/work-orders-page.tsx` | W-10 w wariancie szkieletu: `h1` „Zlecenia” + pusty stan „Brak zleceń” bez akcji |
| `src/i18n/` | katalog `pl` (klucze typowane w `t()`), bez wykrywania języka i bez zapisu w magazynach przeglądarki |
| `src/api/client.ts` | klient z kontraktu (same-origin `/api`) i opcje TanStack Query; powłoka nie wywołuje API w czasie działania |
| `test/e2e/` | Playwright: dymny (AC5), nagłówki i CSP (AC4), klawiatura i responsywność, axe z kontrastem, zrzuty (AC6) |

## Zasady
- Style wyłącznie z tokenów (`@evia/ui-web/styles.css`), teksty wyłącznie przez `t()`; lint `webUi()` z `@evia/config/eslint` blokuje wartości arbitralne Tailwind, `style`, literały kolorów i długości, teksty w JSX i `dangerouslySetInnerHTML`.
- Bez skryptów i stylów inline (`index.html`, CSP), bez zasobów z CDN (fonty i ikony lokalnie), bez persystencji cache zapytań, bez devtools w buildzie.
- Ikony tylko z `@evia/ui-web` (dependency-cruiser).
