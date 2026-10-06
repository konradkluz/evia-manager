# `@evia/tokens` — design tokens dla web i mobile

Pakiet z EVM-006 (AC6, ADR-0006, ADR-0007). Źródłem prawdy są tokeny W3C DTCG w `design/tokens/` (właściciel: `ux-designer`, zasady: `design/tokens/README.md`, `docs/ux/styleguide.md`). Pakiet je **waliduje** i **buduje** Style Dictionary 5 do formatów platform — bez ręcznych kopii wartości w kodzie.

## Polecenia
- `pnpm run build` (cały monorepo, Turborepo) albo `pnpm --filter @evia/tokens run build` — walidacja i build do `dist/` (ignorowany przez git; konsumenci zależą od zadania `^build`).
- `pnpm --filter @evia/tokens run test:coverage` — testy Vitest `EVM-006 AC6` z progiem 90% linii i gałęzi; w kontenerze `backend-tests` w ramach `gate:backend` (parytet Linux).

## Kontrakt (W4 — konsumują go EVM-008 i EVM-009)
| Import | Plik | Zawartość |
|---|---|---|
| `@evia/tokens/web.css` | `dist/web/tokens.css` | `:root` ze zmiennymi `--evm-…` tokenów semantycznych; odstępy i typografia w `rem` (px/16), promienie, obramowania i rozmiary w `px`, `line-height` bez jednostki, typografia złożona → zmienna per właściwość, `tnum` → `…-font-variant-numeric: tabular-nums` |
| `@evia/tokens/tailwind-theme.css` | `dist/web/tailwind-theme.css` | blok `@theme` Tailwind CSS 4 z tokenami układu z `base/breakpoints.tokens.json` (EVM-008): `--breakpoint-{compact,medium,expanded,wide}` (warianty `medium:`, `max-expanded:` …) i `--spacing-grid-{breakpoint}-{margin,gutter}`; tokeny układu nie mają warstwy semantycznej (styleguide § 2.4), a media queries wymagają wartości dosłownych |
| `@evia/tokens/mobile` | `dist/mobile/tokens.js` + `tokens.d.ts` | zamrożone stałe ESM dla React Native, jeden eksport nazwany na grupę (`color`, `space`, `size`, `radius`, `borderWidth`, `elevation`, `motion`, `layer`, `text`); klucze camelCase; wymiary jako liczby dp/pt 1:1, kolory `#RRGGBB` / `rgba()`, style tekstu RN (`lineHeight` bezwzględny, `fontWeight` jako tekst), cienie jako przybliżenie `shadow*` + `elevation`; typy literalne `readonly` |

- Eksportowane są **wyłącznie tokeny semantyczne** (wyjątek: tokeny układu w `tailwind-theme.css`) bez `$deprecated` (także dziedziczonego z grupy); tokeny bazowe (`palette.*`, `dimension.*`, `font.*` …) nie trafiają do kodu UI.
- `dist` zawiera tylko JavaScript ESM i `.d.ts` — bez plików `.ts` (Node nie usuwa typów z plików w `node_modules`).
- Nazwy wyjść nie zależą od motywu: motyw ciemny będzie **dodaniem** (nowy eksport / plik), nie zmianą API.

## Walidacja (błąd przerywa build, nic nie jest zapisywane)
Poprawny JSON; każdy token ma `$type` (dziedziczony z grup); aliasy rozwiązywalne; brak cykli; brak literałów w `semantic/` (także w wartościach złożonych); tokeny semantyczne wskazują wyłącznie tokeny bazowe; zgodność typu aliasu (także części wartości złożonych: typografia, cień, przejście); `$deprecated` tylko `true` / `false` / tekst; ta sama ścieżka tokenu w dwóch plikach = błąd.

## Budowa
| Plik | Odpowiedzialność |
|---|---|
| `src/model.ts` | odczyt `base/**` i `semantic/**` `*.tokens.json`, model tokenów (typ, warstwa, wycofanie), walidacja |
| `src/transform.ts` | konwersje wartości dla web (CSS) i mobile (React Native) — nieobsługiwany typ lub jednostka = błąd |
| `src/build.ts` | Style Dictionary 5 (scalenie drzewa DTCG, rozwiązanie aliasów) + własne formaty wyjść |
| `src/cli.ts` | `node src/cli.ts` — skrypt `build` |
