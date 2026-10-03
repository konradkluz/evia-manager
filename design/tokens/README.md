# Design tokens — EVia Manager

> EVM-003, EVM-004 · Właściciel: `ux-designer` · Wersja tokenów: **1.1.0** (2026-10-03; pierwsza wersja 1.0.0 — 2026-10-02) · Zasady użycia: `docs/ux/styleguide.md` (zmiany: § 8 Changelog).
> Jedno źródło prawdy dla panelu web i aplikacji mobilnej (iOS, Android). Tokeny są niezależne od frameworka — transformację do platform wdraża EVM-006.

## Format
- **W3C Design Tokens Format Module 2025.10** (DTCG, https://www.designtokens.org/tr/2025.10/format/).
- Pliki `*.tokens.json` (media type `application/design-tokens+json`), UTF-8.
- Token = obiekt z `$value`; `$type` dziedziczony z grupy; opis w `$description`.
- Kolor: obiekt `{"colorSpace": "srgb", "components": [r, g, b], "alpha"?, "hex"}` — `hex` jest zawsze podany (ułatwia transformację i przegląd).
- Wymiar: `{"value": 16, "unit": "px"}`; czas: `{"value": 200, "unit": "ms"}`.
- Aliasy: składnia `{grupa.podgrupa.token}` (także wewnątrz wartości złożonych: `shadow`, `transition`, `typography`).
- Metadane spoza specyfikacji wyłącznie w `$extensions` z prefiksem `pl.eviacharge.*`:
  - `pl.eviacharge.status` — etykieta PL, nazwa ikony Lucide i ton statusu (grupy `color.status.*`, `color.sync.*`),
  - `pl.eviacharge.font.fontFeatures` — cechy OpenType (np. `tnum` dla liczb tabelarycznych).

## Struktura i warstwy
```
design/tokens/
├── base/                         warstwa 1 — wartości surowe (NIE używać w UI)
│   ├── color.tokens.json         palette.{neutral|teal|lime|green|amber|red|blue|violet}.{50…950}, palette.alpha.*
│   ├── dimension.tokens.json     dimension.{0…720, 9999} — skala px (siatka 4 px)
│   ├── typography.tokens.json    font.family|weight|size|line-height|letter-spacing.*
│   ├── effects.tokens.json       shadow.*, duration.*, easing.*, z-layer.*, opacity.*
│   └── breakpoints.tokens.json   breakpoint.*, grid.{compact|medium|expanded|wide}.*
└── semantic/                     warstwa 2 — role (TYLKO te tokeny trafiają do kodu UI)
    ├── color.light.tokens.json   color.{bg|text|icon|border|focus|nav|brand|action|control|feedback|status|sync}.*  (motyw jasny)
    ├── size.tokens.json          space.*, size.*, radius.*, border-width.*
    ├── effects.tokens.json       elevation.*, motion.{duration|easing|transition}.*, layer.*
    └── typography.tokens.json    text.*  (style złożone `typography`)
```
Zasady warstw:
1. `semantic/` zawiera **wyłącznie aliasy** do `base/` — żadnych literałów (kolorów, liczb, px).
2. `semantic/` nie odwołuje się do innych tokenów semantycznych (płaska, przewidywalna rozdzielczość).
3. Kod aplikacji (web i mobile) używa **tylko tokenów semantycznych**. Brak potrzebnej roli → prośba do `ux-designer` o nową rolę (nie sięgamy do `palette.*`).
4. Ścieżki tokenów nie kolidują między plikami — wszystkie pliki można scalić w jedno drzewo.

## Konwencja nazw
- kebab-case, kropka = poziom grupy: `color.action.primary.bg-hover`, `size.touch-target.min`, `text.heading-2`.
- Kolejność w nazwie roli: **kategoria → element/rola → wariant → stan** (`color.action.danger.bg-pressed`).
- Stany: `-hover`, `-pressed`, `-disabled`, `-selected`; tło `bg`, tekst `text`, ikona `icon`, obrys `border`.
- Skale bazowe nazwane wartością (`dimension.16`, `font.size.14`, `duration.200`) albo stopniem rampy (`palette.teal.700`).
- Nazwy domenowe statusów po angielsku zgodnie ze słownikiem (`color.status.order.in-progress`, `color.status.payment.overdue`); etykiety PL w `$extensions`.
- **Kod modelu → klucz tokenu (od 1.1.0):** klucz statusu = kod z `docs/architecture/domain-model.md` (`snake_case`) zapisany w `kebab-case` — podkreślnik zamieniamy na łącznik (`in_progress` → `color.status.order.in-progress`, `not_applicable` → `color.status.stage.not-applicable`, `invoiced` → `color.status.payment.invoiced`). Jedna reguła dla web i mobile, bez listy wyjątków. Wyjątek znaczeniowy: `color.status.payment.overdue` to oznaczenie wyliczane (`isOverdue`), nie kod statusu (styleguide § 4.4).

## Wycofywanie tokenów (`$deprecated`, od 1.1.0)
- Token lub grupę, której nazwa ma zniknąć, oznaczamy `$deprecated` z wyjaśnieniem i następcą (DTCG 2025.10: § 5.2.4 — token, § 6.3.1 — grupa; oznaczenie grupy obejmuje wszystkie jej tokeny). Przykład: `color.status.order.quote` → `color.status.order.quoting`, `color.status.payment.issued` → `color.status.payment.invoiced`.
- Wycofywany token **nadal jest poprawnym tokenem** (aliasy, typy, walidacja), ale transformacja (EVM-006) **nie eksportuje go do kodu UI**, a lint zgłasza jego użycie.
- Usunięcie następuje w najbliższej wersji MAJOR styleguide'u i tokenów (§ 7.2 pkt 5 styleguide'u); do tego czasu wersja jest MINOR.

## Motyw ciemny (poza zakresem v1) — jak dodać bez refaktoru
1. Skopiować `semantic/color.light.tokens.json` → `semantic/color.dark.tokens.json`.
2. Zmienić **tylko** aliasy (np. `color.bg.surface` → `{palette.neutral.900}`), zachowując identyczne ścieżki ról. W razie potrzeby dodać stopnie palety w `base/color.tokens.json`.
3. Policzyć kontrasty dla nowego motywu (te same pary co w styleguide § 2.1.4) i dopisać tabelę.
4. Transformacja buduje dwa zestawy (`light`, `dark`) z tych samych nazw ról; kod UI się nie zmienia.
Pliki `size`, `effects`, `typography` są niezależne od motywu.

## Wskazówki dla transformacji (EVM-006) — bez wyboru narzędzia
- Wejście: wszystkie pliki `base/**` + jeden plik koloru semantycznego na motyw; rozwiązać aliasy (także zagnieżdżone) i wykrywać cykle.
- **Web:** zmienne CSS z prefiksem `--evm-` dla tokenów semantycznych (np. `--evm-color-action-primary-bg`); `dimension` w `rem` (px/16) dla typografii i odstępów, `px` dla obramowań i promieni; `typography` → klasy/utility; `font.line-height` jako liczba bez jednostki; `pl.eviacharge.font.fontFeatures: ["tnum"]` → `font-variant-numeric: tabular-nums`.
- **Mobile (iOS, Android):** `px` w tokenach = **dp** (Android) / **pt** (iOS) 1:1; rozmiary pisma jako `sp` / skalowane przez Dynamic Type; kolory z `hex` (+ `alpha`); `cubicBezier` → krzywe platformy; `shadow` → elevation (Android) / shadow (iOS) — dopuszczalne przybliżenie.
- Tokeny bazowe (`palette.*`, `dimension.*` …) nie są eksportowane do kodu aplikacji albo są eksportowane jako prywatne — tak, by lint (§ 7.2 styleguide'u) mógł wymusić użycie ról.
- Tokeny i grupy z `$deprecated` nie są eksportowane (patrz „Wycofywanie tokenów”).
- Walidacja w CI (EVM-006): poprawny JSON, każdy token ma `$type`, aliasy rozwiązywalne, brak cykli, brak literałów w `semantic/`, zgodność typu aliasu z typem tokenu, `$deprecated` tylko jako `true`, `false` albo tekst.

## Weryfikacja wersji 1.0.0
Sprawdzono 2026-10-02 skryptem pomocniczym (poza repozytorium): 9 plików, **479 tokenów** (base 184, semantic 295), 0 błędów: JSON poprawny, aliasy rozwiązywalne, brak cykli, typy aliasów zgodne, brak literałów w `semantic/`, brak odwołań semantic → semantic. Kontrasty par kolorów: styleguide § 2.1.4.

## Zmiany w wersji 1.1.0 (EVM-004)
- `semantic/color.light.tokens.json`: nowe grupy `color.status.order.quoting`, `color.status.payment.invoiced`, `color.status.payment.cancelled` (po 4 tokeny: `bg`, `text`, `icon`, `border` — wyłącznie aliasy do `palette.*`); `color.status.order.quote` i `color.status.payment.issued` z `$deprecated`; etykieta `color.status.stage.waiting` → „Czekamy na…”; opis oznaczenia wyliczanego przy `color.status.payment.overdue`.
- Liczba tokenów: **491** (base 184, semantic 307, w tym 8 wycofywanych).
- Sprawdzenie 2026-10-03 (skrypt w przeglądarce na `about:blank`, bez sieci): aliasy nowych grup rozwiązywalne do istniejących stopni palety, klucze w `kebab-case`, każdy kod statusu z `domain-model.md` ma niewycofywany klucz, ikony i etykiety unikalne w grupach (z pominięciem wycofywanych), kontrasty nowych par jak w styleguide § 2.1.4. Pełną walidację wszystkich plików (JSON, `$type`, cykle, literały) powtarza orkiestrator przed scaleniem.
