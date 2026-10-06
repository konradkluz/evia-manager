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
| `Button` — warianty | § 3.1 | primary / secondary / tertiary, rozmiary md i lg, ikona wiodąca; ładowanie (`loader-circle` zamiast ikony, etykieta zostaje, `aria-busy`, klik zablokowany); wyłączony przez `aria-disabled` (zostaje fokusowalny, klik i wysłanie formularza zablokowane) |
| `TextField` | § 3.2 | etykieta zawsze widoczna; domyślny, hover, fokus, wyłączony, tylko do odczytu (bez obrysu), błąd (`circle-alert` + tekst, `role="alert"`, zastępuje podpowiedź); wariant hasła z „Pokaż” / „Ukryj” (`reveal`) i wariant e-mail |
| `InlineAlert` | § 3.19 | ton `error` (`role="alert"`) i `info` (zwykła treść), ikona + tekst, wskaźnik lewy w kolorze tonu, opcjonalna akcja wyjścia; `alertRef` (EVM-067) robi z komunikatu cel programowego fokusu (`tabindex="-1"`, pierścień fokusu) — po nieudanym wysłaniu formularza fokus przechodzi na komunikat |
| `AlertDialog` | § 3.13, § 4.17 (EVM-067) | natywny modalny `<dialog>` z `role="alertdialog"`, `aria-labelledby` / `aria-describedby`, treść `aria-live="polite"`; `size.dialog.width.sm`, `radius.dialog`, `elevation.dialog`, scrim `color.bg.scrim`; fokus na przycisku z `data-initial-focus` (w razie braku — pierwszy), `Esc` wywołuje `onDismiss` i nie zamyka sam, zamknięcie zwraca fokus wywołującemu; bez animacji i wstrzykiwanych stylów (CSP) |
| `Card` | § 3.8 | karta informacyjna web (`space.inset.lg`, `radius.card`), region nazwany przez `labelledBy` |
| `Skeleton` | § 3.16 | linia i pole; dekoracyjny (`aria-hidden`), przejście koloru w cyklu `motion.duration.skeleton`, przy ograniczonym ruchu statyczny |
| `Toast` | § 3.14 | informacja / sukces na `color.bg.inverse`; strefa `role="status"` zawsze w DOM, zamknięcie `x`, 6 s z pauzą przy najechaniu i fokusie |
| `AccountMenu` | § 3.17, § 3.20 | menu konta w TopBar: wyzwalacz z `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; fokus na pierwszej pozycji, strzałki z zawijaniem, Home / End, litera, Enter / Spacja, Esc i Tab zamykają i zwracają fokus, kliknięcie poza menu zamyka |
| `BlockingState` | § 3.15.1 | pusty stan blokujący całego ekranu (W-03): nazwa produktu, ikona, tytuł `h1` z fokusem, opis, alerty, jedna akcja primary i akcja tertiary w prawym górnym rogu; bez Sidebar i TopBar |
| `EmptyState` — `titleRef` | § 3.15 | tytuł może przyjąć fokus programowo (po sprawdzeniu linku) |
| `AppShell` — `account` | § 3.17 | miejsce na menu konta na końcu TopBar (po zalogowaniu) |

Ikony: Lucide (ISC) re-eksportowane z `src/icons.ts` — aplikacja nie importuje `lucide-react` bezpośrednio.
