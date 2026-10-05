# `@evia/ui-web` — biblioteka komponentów panelu web

Pakiet z EVM-008 (AC3; ADR-0006, styleguide `docs/ux/styleguide.md`). Jedyne miejsce, z którego panel (`apps/web`) bierze komponenty, ikony i style. Komponenty przyjmują wszystkie teksty jako propsy (tłumaczenia są w aplikacji, `i18next`).

## Polecenia
- `pnpm --filter @evia/ui-web run test:coverage` — testy komponentów (Vitest + jsdom + Testing Library + `axe-core`) i motywu, próg 90% linii i gałęzi (pakiet współdzielony).
- `pnpm --filter @evia/ui-web run lint` / `typecheck`.

Pakiet nie ma kroku `build`: aplikacja importuje źródła TypeScript i `styles.css`, a kompiluje je Vite z `@tailwindcss/vite`.

## Style — wyłącznie tokeny
- `src/styles.css`: Tailwind CSS 4 **bez domyślnego motywu** (tylko `preflight` i `utilities`). Istnieją wyłącznie nazwy z `@theme inline`, a każda wartość to `var(--evm-…)` z `@evia/tokens/web.css`; breakpointy i marginesy siatki pochodzą z `@evia/tokens/tailwind-theme.css`. Klasy spoza tokenów (`p-4`, `text-red-500`, `md:`) nic nie generują.
- Nazwy: `--<przestrzeń Tailwind>-<ścieżka tokenu bez kategorii>`, np. `color.bg.canvas` → `bg-bg-canvas`, `space.stack.md` → `gap-stack-md`, `size.sidebar.width.expanded` → `w-sidebar-width-expanded`, `text.heading-3` → `text-heading-3`. Breakpointy: `medium:`, `expanded:`, `wide:`, `max-expanded:` …
- `@utility focus-ring` / `focus-ring-inverse` (pierścień fokusu § 3), `border-s-indicator` (Banner § 3.19).
- Lint (`webUi()` z `@evia/config/eslint`): zakaz wartości arbitralnych (`p-[13px]`, `bg-(--x)`), atrybutu `style`, literałów kolorów i długości, `dangerouslySetInnerHTML` oraz tekstów w JSX (i18n). Test `test/styles.test.ts` sprawdza arkusz (brak literałów, każdy token istnieje) i wynik kompilacji Tailwind.
- Nowy token w motywie: dopisz wiersz w `@theme inline` (tylko `var(--evm-…)`); nowy token w ogóle — `ux-designer` w `design/tokens/`.

## Komponenty
| Komponent | Styleguide | Warianty i stany |
|---|---|---|
| `AppShell` | § 3.17, propozycja 1.3.0 | link „Przejdź do treści” (pierwszy fokusowalny, przenosi fokus na `main`); Sidebar rozwinięty od `breakpoint.expanded`, zwinięty z podpowiedzią na `breakpoint.medium`, ukryty poniżej; TopBar `size.app-bar.height.web` bez wyszukiwania i konta (przed E1), z przyciskiem „Menu” poniżej `breakpoint.medium`; miejsce na baner; `main` z marginesami `grid.*.margin` |
| `NavigationDrawer` (wewnętrzny) | § 3.17, propozycja 1.3.0 | natywny modalny `<dialog>`: reszta strony nieaktywna, fokus na „Zamknij menu”, `Esc` / przycisk / tło / wybór pozycji zamykają i zwracają fokus na „Menu”; bez animacji i bez wstrzykiwanych stylów (CSP) |
| pozycja nawigacji | § 3.17 | aktywna (`aria-current="page"`, pasek `color.brand.accent` `border-width.indicator`, pogrubienie), nieaktywna, hover `color.bg.brand`, fokus `color.focus.ring-inverse`; w zwiniętym pasku etykieta jako podpowiedź przy najechaniu i fokusie (pozostaje nazwą dostępną linku) |
| `EmptyState` | § 3.15, § 4.8 | z akcją albo bez (propozycja 1.3.0); tytuł `h2` (`h1` dla stanu całego ekranu) |
| `Banner` | § 3.19, § 4.10 | ton ostrzeżenia, ikona + tekst, `role="status"` |
| `Button` | § 3.1 | primary md: domyślny, hover, wciśnięty, fokus |
| `IconButton` | § 3.1 | `surface` / `brand` (ciemne tło), nazwa dostępna wymagana, cel ≥ `size.touch-target.min` |

Ikony: Lucide (ISC) re-eksportowane z `src/icons.ts` — aplikacja nie importuje `lucide-react` bezpośrednio.
