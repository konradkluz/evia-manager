# `@evia/web` — panel web biura

Pakiet z EVM-008 (AC2–AC6; ADR-0006, ADR-0015). React 19 + Vite 8 (SPA), TanStack Router i TanStack Query, `i18next` (tylko `pl`), komponenty i style wyłącznie z `@evia/ui-web`, klient API wygenerowany z kontraktu (`@evia/contracts`).

## Polecenia (z katalogu głównego repozytorium)
Przed pierwszym `dev` i po każdej zmianie w `design/tokens` zbuduj zależności: `pnpm install` i `pnpm run build` (m.in. `@evia/tokens` generuje `tailwind-theme.css`; bez tego Vite zgłasza błąd „Package path ./tailwind-theme.css is exported … but no valid target file was found”).

| Polecenie | Co robi |
|---|---|
| `pnpm --filter @evia/web run dev` | serwer deweloperski Vite na `http://127.0.0.1:5173` (proxy `/api` → `http://localhost:${API_PORT:-3000}`); nagłówki bezpieczeństwa bez CSP (wariant `dev`) |
| `pnpm --filter @evia/web run build` | build produkcyjny do `dist/` (bez map źródeł) |
| `pnpm --filter @evia/web run preview` | podgląd buildu na `http://127.0.0.1:4173` z pełnymi nagłówkami i ścisłą CSP (wariant `strict`) |
| `pnpm --filter @evia/web run test:coverage` | testy komponentów i jednostkowe (Vitest + jsdom + Testing Library + `axe-core`), próg 80% (warstwa web) |
| `pnpm run e2e` / `pnpm --filter @evia/web run e2e` | Playwright na `vite preview`: Chromium i Firefox, na Windows także Edge (`msedge`) — dowód E2E wg ADR-0015 |
| `pnpm --filter @evia/web run e2e:screenshots` | zrzuty do przeglądu UX: 360 / 768 / 1280 / 1440 px, szuflada, podpowiedź, offline → `docs/ux/reviews/EVM-008/`; ekrany EVM-016 (W-13, W-03, menu konta, stany błędów i offline) → `docs/ux/reviews/EVM-016/` (PNG poza gitem) |

Przeglądarki Playwright instaluje się raz: `pnpm --filter @evia/web exec playwright install chromium firefox` (Edge — systemowy).

## Struktura
| Ścieżka | Zawartość |
|---|---|
| `security-headers.ts` | **jedyne źródło** nagłówków panelu (P11, SR-WEB-01, SR-WEB-08): wariant `strict` (preview i produkcja; CSP bez `unsafe-inline`/`unsafe-eval`, bez hostów bucketu i Sentry do EVM-076), wariant `dev` (bez CSP — preambuła React Refresh); `https: true` dodaje `upgrade-insecure-requests` i HSTS (EVM-076); wtyczka Vite dla `preview` i `dev` |
| `src/router.tsx` | strony publiczne `/activate` i `/login`; reszta za bramką sesji; `/` → `/work-orders`; nieznana ścieżka → `/work-orders` (bez sesji → `/login`); błąd strony → stan błędu w powłoce (bez szczegółów technicznych) |
| `src/paths.ts` | ścieżki po angielsku (URL to identyfikator); teksty po polsku z i18n |
| `src/shell/` | powłoka (`AppShell` z `@evia/ui-web` + nawigacja, baner offline), granica błędu, stan błędu |
| `src/activation/` | `activation-token.ts` — token linku jednorazowego tylko w pamięci modułu (fragment `#…` usuwany z paska adresu i wpisu historii, `history.replaceState`; także przy zmianie samego fragmentu), `capture-fragment.ts` — moduł importowany **jako pierwszy** w `main.tsx`, czyli przed routerem i przed jakimkolwiek SDK telemetrii |
| `src/session/` | zapytanie o sesję (`getCurrentSession`), token CSRF tylko w pamięci karty, wylogowanie (czyści pamięć podręczną zapytań) |
| `src/passkey/create-passkey.ts` | klucz dostępu natywnymi `PublicKeyCredential.parseCreationOptionsFromJSON()` i `toJSON()` (Chrome 129+, Edge, Firefox 119+) — bez `@simplewebauthn/browser` |
| `src/pages/activation-page.tsx` | W-13 „Ustaw hasło” (`/activate`): sprawdzenie linku bez zużycia, jeden stan nieważnego linku, pole hasła wg flows/11, stany ładowania, offline, `429`, błąd serwera |
| `src/pages/mfa-setup-page.tsx` | W-03 w wariancie „przed EVM-023” (`/mfa-setup`): tylko klucz dostępu, „Wyloguj”, toast po rejestracji |
| `src/pages/login-page.tsx` | strona zastępcza W-01 (`/login`) do EVM-067: cel „Przejdź do logowania”, wylogowania i braku sesji |
| `src/shell/session-gate.tsx` | bramka sesji: brak sesji → `/login`; `mfa_enrollment` → W-03 pod każdym adresem; aktywna → powłoka z menu konta |
| `src/pages/work-orders-page.tsx` | W-10 w wariancie szkieletu: `h1` „Zlecenia” + pusty stan „Brak zleceń” bez akcji |
| `src/i18n/` | katalog `pl` (klucze typowane w `t()`), bez wykrywania języka i bez zapisu w magazynach przeglądarki |
| `src/api/client.ts` | klient z kontraktu (same-origin `/api`, `X-CSRF-Token` z pamięci karty dla mutacji sesji), `ApiError` (status, kod, błędy pól, `Retry-After`) i `unwrap`; zapytania i mutacje bez wstrzymywania offline (`networkMode: 'always'` — stan offline pokazuje panel sam) |
| `test/e2e/` | Playwright: dymny (AC5), nagłówki i CSP (AC4), klawiatura i responsywność, axe z kontrastem, zrzuty (AC6); EVM-016: `identity.spec.ts` (token tylko w treści `POST`, jeden stan nieważnego linku, hasło, klucz dostępu z wirtualnym uwierzytelniaczem w Chromium i Edge, wylogowanie), `identity-accessibility.spec.ts` (axe W-13, W-03, menu konta), `identity-screenshots.spec.ts` (zrzuty do `docs/ux/reviews/EVM-016/`); `mock-api.ts` — syntetyczne API przed panelem (pełny stos testują testy integracyjne API); testy identity chodzą na `http://localhost:4173`, bo RP ID WebAuthn nie może być adresem IP |

## Zasady
- Style wyłącznie z tokenów (`@evia/ui-web/styles.css`), teksty wyłącznie przez `t()`; lint `webUi()` z `@evia/config/eslint` blokuje wartości arbitralne Tailwind, `style`, literały kolorów i długości, teksty w JSX i `dangerouslySetInnerHTML`.
- Bez skryptów i stylów inline (`index.html`, CSP), bez zasobów z CDN (fonty i ikony lokalnie), bez persystencji cache zapytań, bez devtools w buildzie.
- Ikony tylko z `@evia/ui-web` (dependency-cruiser).
