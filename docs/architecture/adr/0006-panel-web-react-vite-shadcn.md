# ADR-0006: Panel web — React + Vite (SPA), TanStack Router/Query, shadcn/ui (Base UI) + Tailwind CSS z design tokens

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (konsultacja: ux-designer w EVM-003)
- **Powiązane:** EVM-001, EVM-003 (styleguide, tokeny DTCG), EVM-008; ADR-0004, ADR-0005, ADR-0007, ADR-0012, ADR-0014

## Kontekst i problem
Panel biura: gęste listy z filtrami, formularze zleceń, etapy, płatności, galeria mediów, administracja. Za logowaniem — bez SEO. Wymagania: WCAG 2.2 AA, wiążący styleguide z design tokens w formacie W3C DTCG (EVM-003) wspólnymi dla web i mobile, polski UI (i18n-ready), strefa `Europe/Warsaw`, sesja w ciasteczku `HttpOnly` z tej samej domeny co API (ADR-0005), restrykcyjny CSP. Dwie decyzje: **framework aplikacji** i **biblioteka komponentów**.

## Kryteria decyzji — framework
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Prostota wdrożenia (statyczne pliki z tej samej domeny co API) | 5 | brak dodatkowego serwera, ciasteczka same-origin |
| Ekosystem testowy (komponenty, E2E, a11y) | 5 | TDD, progi pokrycia |
| Bezpieczeństwo (CSP, brak warstwy SSR do zabezpieczenia) | 4 | ASVS V3 |
| Produktywność i znajomość przez agentów AI | 4 | szybkie przyrosty |
| Wspólny język i wzorce z aplikacją mobilną (React Native) | 4 | współdzielone pakiety i wiedza |
| Wydajność UI dla gęstych list | 3 | p95 < 1 s |

## Kryteria decyzji — biblioteka komponentów
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Zgodność z design tokens (DTCG → zmienne CSS) i pełna kontrola stylu | 5 | styleguide jest wiążący |
| Dostępność WCAG 2.2 AA (prymitywy z obsługą klawiatury, ARIA, fokusu) | 5 | wymaganie |
| Egzekwowanie styleguide'u (lint zaszytych wartości) | 4 | reguła z `docs/ux/README.md` |
| Komponenty potrzebne panelowi (tabele, formularze, daty, dialogi) | 4 | zakres M1 |
| Utrzymanie i licencja | 4 | ASVS V15 |
| Znajomość przez agentów AI | 3 | produktywność |

## Rozważane opcje
**Framework:** **A. React 19 + Vite 8 (SPA)** z TanStack Router i TanStack Query · **B. Next.js 16** (SSR/App Router) · **C. Angular 22**.
**Komponenty:** **A. shadcn/ui na prymitywach Base UI + Tailwind CSS 4** (kod komponentów w repo, tokeny jako zmienne `@theme`) · **B. Mantine 9** · **C. React Aria Components + własne style** · **D. MUI**.

## Ocena
**Framework**
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Prostota wdrożenia (5) | 5 | 3 | 4 |
| Ekosystem testowy (5) | 5 | 4 | 5 |
| Bezpieczeństwo (4) | 5 | 3 | 4 |
| Produktywność agentów (4) | 5 | 5 | 4 |
| Wspólny język z mobile (4) | 5 | 5 | 2 |
| Wydajność list (3) | 4 | 4 | 4 |
| **Suma ważona (maks. 125)** | **122** | **99** | **97** |

**Biblioteka komponentów**
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Zgodność z tokens i kontrola stylu (5) | 5 | 4 | 5 | 3 |
| Dostępność (5) | 4 | 4 | 5 | 4 |
| Egzekwowanie styleguide'u (4) | 5 | 3 | 4 | 2 |
| Komponenty panelu (4) | 4 | 5 | 3 | 5 |
| Utrzymanie i licencja (4) | 4 | 5 | 5 | 4 |
| Znajomość przez agentów (3) | 5 | 4 | 3 | 4 |
| **Suma ważona (maks. 125)** | **112** | **104** | **107** | **91** |

Uwagi: SSR (Next.js) nie daje korzyści za logowaniem, a dodaje serwer Node do zabezpieczenia i utrzymania. Angular jest dojrzały, ale nie dzieli wzorców z React Native. shadcn/ui: od 2026-07-03 domyślnie na Base UI (Radix nadal wspierany); komponenty kopiowane do repo — stają się **naszą** biblioteką zgodną ze styleguide'em. React Aria ma najlepszą dostępność, ale wymaga zbudowania warstwy wizualnej od zera — pozostaje źródłem prymitywów dla trudnych przypadków (np. siatki z klawiaturą). Wersje i licencje zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
- **Framework:** React 19 + Vite 8 jako **SPA**; routing **TanStack Router** (typowane ścieżki i parametry wyszukiwania — filtry list w URL), dane **TanStack Query** + klient generowany z OpenAPI (ADR-0004); formularze **React Hook Form** + schematy Zod z kontraktu; tabele **TanStack Table**.
- **Komponenty:** **shadcn/ui (Base UI)** + **Tailwind CSS 4** w pakiecie `packages/ui-web`; tokeny DTCG z `design/tokens/` → **Style Dictionary** → zmienne CSS + motyw Tailwind (`@theme`) oraz stałe TS dla mobile (ADR-0007, wspólne źródło). Reguły lint: zakaz wartości arbitralnych Tailwind i surowych kolorów/odstępów poza tokenami; komponenty wyłącznie z `packages/ui-web`.
- **i18n i lokalizacja:** `i18next` (react-i18next) z polskimi formami liczby mnogiej; daty i kwoty przez `Intl` (`pl-PL`, `Europe/Warsaw`, PLN) i `date-fns` + `@date-fns/tz`; sortowanie po stronie klienta przez `Intl.Collator('pl')`.
- **Wdrożenie:** statyczne pliki serwowane przez reverse proxy z tej samej domeny co `/api` (ADR-0011). **CSP** bez `unsafe-inline`/`unsafe-eval` (skrypty z własnego originu, `connect-src 'self'` + domena object storage dla podpisanych URL-i i domena error trackingu UE), `frame-ancestors 'none'`, nagłówki bezpieczeństwa (HSTS, `X-Content-Type-Options`, `Referrer-Policy`).
- **Media w panelu:** zdjęcia i filmy wyświetlane z podpisanych URL-i (TTL ≤ 5 min), dokumenty pobierane jako załącznik (ADR-0009).

## Konsekwencje
- **Pozytywne:** prosty hosting (pliki statyczne), sesja same-origin bez CORS, ten sam React co w mobile, pełna kontrola nad wyglądem zgodnie ze styleguide'em, dojrzałe testy (ADR-0014).
- **Negatywne / koszty:** komponenty shadcn są „nasze” — aktualizacje z upstreamu ręcznie (CLI `shadcn diff`); brak gotowego date pickera/tabeli „enterprise” — składamy z TanStack Table i komponentów shadcn.
- **Ryzyka i mitygacje:**
  - *Rozjazd ze styleguide'em* → lint tokenów, przegląd UX jako bramka, Storybook/zrzuty w przeglądzie (EVM-003/EVM-008 decydują o narzędziu podglądu).
  - *Zmiany w Base UI / shadcn* → wersje przypięte, Radix jako alternatywny zestaw prymitywów wspierany przez shadcn.
  - *Wydajność dużych list* → paginacja kursorowa po stronie serwera (ADR-0004), wirtualizacja dopiero gdy pomiar wykaże potrzebę.

## Plan wyjścia
Tokeny są niezależne od biblioteki (DTCG → Style Dictionary), więc wymiana warstwy komponentów (np. na Mantine lub React Aria) dotyczy `packages/ui-web` i miejsc użycia — tygodnie pracy, bez zmiany API ani logiki. Przejście na SSR (Next.js) możliwe później dzięki temu, że logika danych jest w TanStack Query i generowanym kliencie.

## Weryfikacja
- EVM-008: szkielet panelu z tokenami z EVM-003, test a11y (axe) bez naruszeń, CSP bez wyjątków.
- M1: p95 renderu listy zleceń < 1 s przy 25 pozycjach na stronę; przegląd UX bez ustaleń blocker dotyczących komponentów.

## Źródła (zweryfikowane 2026-10-02)
- React 19.3.0 (MIT, 2026-09-09), Vite 8.3.2 (MIT, 2026-10-01): https://www.npmjs.com/package/react , https://www.npmjs.com/package/vite
- TanStack Router 1.170.41, TanStack Query 5.104.1, TanStack Table 9.2.4 (MIT): https://tanstack.com/
- shadcn/ui — Base UI domyślnie od 2026-07-03 (CLI 4.21.1; licencja **MIT**, zweryfikowane 2026-10-02: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md): https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default ; Base UI 1.8.0 (MIT): https://www.npmjs.com/package/@base-ui/react
- Tailwind CSS 4.3.3 (MIT): https://www.npmjs.com/package/tailwindcss ; Style Dictionary 5.5.5 (Apache-2.0): https://www.npmjs.com/package/style-dictionary
- Mantine 9.6.3 (MIT): https://www.npmjs.com/package/@mantine/core ; React Aria Components 1.21.1 (Apache-2.0): https://www.npmjs.com/package/react-aria-components
- Next.js 16.3.8 (MIT), Angular 22.2.1 (MIT): https://www.npmjs.com/package/next , https://www.npmjs.com/package/@angular/core
- i18next 26.4.2 / react-i18next 17.0.15, date-fns 4.4.0, @date-fns/tz 1.5.0 (MIT): https://www.npmjs.com/package/i18next
