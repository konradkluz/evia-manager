# Styleguide EVia Manager

> **Wersja 1.0.0 · 2026-10-02 · EVM-003** · Właściciel: `ux-designer` · Status: obowiązujący (wiążący dla wszystkich implementujących UI).
> Źródło prawdy wartości: `design/tokens/` (W3C DTCG) — opis struktury w `design/tokens/README.md`. Materiały marki: `design/brand/README.md`.
> Konwencja: `nazwa.tokenu` w kodzie to token semantyczny (używany w UI); `palette.*`, `dimension.*`, `font.*`, `shadow.*`, `duration.*`, `easing.*` to tokeny bazowe (tylko w definicjach ról). Liczby w nawiasach podane są pomocniczo — w kodzie **zawsze token**.

## Spis treści
1. [Zasady](#1-zasady)
2. [Fundamenty](#2-fundamenty) — kolor, typografia, odstępy, siatka i breakpointy, rozmiary, promienie, obramowania, cienie i warstwy, ruch, ikony
3. [Komponenty](#3-komponenty) — inwentarz M1–M2
4. [Wzorce](#4-wzorce) — formularze, tabele/listy, filtry, statusy, oś czasu, galeria, kolejka uploadu, puste stany, błędy, offline, potwierdzenia, szkielety, brak uprawnień
5. [Teren (mobile)](#5-teren-mobile)
6. [Treści](#6-treści)
7. [Dostępność i egzekwowanie](#7-dostępność-i-egzekwowanie)
8. [Changelog](#8-changelog)

---

## 1. Zasady
1. **Status na pierwszy rzut oka.** Każdy widok zlecenia odpowiada: na jakim etapie, na kogo czekamy i od kiedy, co jest po terminie, co nieopłacone. Status = ikona + etykieta + kolor (nigdy sam kolor).
2. **Spójność ponad oryginalność.** Jeden zestaw tokenów i komponentów dla web i mobile; konwencje platform (Material na Androidzie, HIG na iOS) tam, gdzie styleguide to dopuszcza (np. systemowy przycisk wstecz, arkusze dolne, pickery daty).
3. **Wszystkie stany są zaprojektowane:** pusty, ładowanie (szkielet), błąd z wyjściem z sytuacji, offline, brak uprawnień.
4. **Nie gubimy pracy.** Autozapis szkiców, lokalna kolejka w terenie, „Cofnij” zamiast pytania; potwierdzenie tylko dla operacji nieodwracalnych.
5. **Progresywne ujawnianie.** Najpierw podsumowanie (status, „na kogo czekamy”, termin, płatność), szczegóły procesów i etapów po rozwinięciu.
6. **Dwa konteksty, jeden system.** Biuro: gęstość, klawiatura, tabele. Teren: aparat, duże cele dotyku, wysoki kontrast, jedna ręka, offline.
7. **Dostępność WCAG 2.2 AA** jako minimum; tekst podstawowy AAA (≥ 7:1) z myślą o pracy w słońcu.
8. **Prostota.** Mniej wariantów, mniej kolorów. Nowy wariant komponentu tylko z uzasadnieniem i wpisem w changelogu.

---

## 2. Fundamenty

### 2.1 Kolor

#### 2.1.1 Model warstw
`palette.*` (paleta bazowa, `design/tokens/base/color.tokens.json`) → `color.*` (role, `design/tokens/semantic/color.light.tokens.json`). W UI używamy wyłącznie ról `color.*`. Motyw ciemny — poza v1; dodanie = nowy plik ról o tych samych nazwach (patrz `design/tokens/README.md`).

#### 2.1.2 Paleta bazowa
| Rampa | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 | Rola |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `palette.neutral` (+ `0` = `#FFFFFF`) | `#FAFAFA` | `#F5F5F5` | `#E5E5E5` | `#D4D4D4` | `#A3A3A3` | `#838383` | `#5C5C5C` | `#404040` | `#2B2B2B` | `#1A1A1A` | `#0D0D0D` | tła, tekst, obrysy |
| `palette.teal` (marka) | `#E8FBFD` | `#D3F4F8` | `#B2E8ED` | `#89D4DC` | `#62B9C2` | `#409AA2` | **`#247B83`** | `#17656C` | `#115157` | `#0A3E43` | `#02292C` | marka, akcje, W realizacji / W toku |
| `palette.lime` (akcent marki) | `#E8FFE1` | `#D3FFC7` | `#B0FF99` | **`#6EFF33`** | `#64E62F` | `#54C923` | `#44A51B` | `#31800E` | `#296511` | `#21520F` | `#0E2F03` | tylko dekoracja na ciemnym tle |
| `palette.green` | `#F0FDF4` | `#DCFCE7` | `#BBF7D0` | `#86EFAC` | `#4ADE80` | `#22C55E` | `#16A34A` | `#15803D` | `#166534` | `#14532D` | `#052E16` | sukces, zakończone, opłacone |
| `palette.amber` | `#FFFBEB` | `#FEF3C7` | `#FDE68A` | `#FCD34D` | `#FBBF24` | `#F59E0B` | `#D97706` | `#B45309` | `#92400E` | `#78350F` | `#451A03` | ostrzeżenie, czekamy, wstrzymane |
| `palette.red` | `#FEF2F2` | `#FEE2E2` | `#FECACA` | `#FCA5A5` | `#F87171` | `#EF4444` | `#DC2626` | `#B91C1C` | `#991B1B` | `#7F1D1D` | `#450A0A` | błąd, zablokowane, po terminie, usuń |
| `palette.blue` | `#EFF6FF` | `#DBEAFE` | `#BFDBFE` | `#93C5FD` | `#60A5FA` | `#3B82F6` | `#2563EB` | `#1D4ED8` | `#1E40AF` | `#1E3A8A` | `#172554` | informacja, wysyłanie, fokus |
| `palette.violet` | `#F5F3FF` | `#EDE9FE` | `#DDD6FE` | `#C4B5FD` | `#A78BFA` | `#8B5CF6` | `#7C3AED` | `#6D28D9` | `#5B21B6` | `#4C1D95` | `#2E1065` | wycena |

Przezroczystości: `palette.alpha.black-8` / `black-12` / `black-16` (cienie), `palette.alpha.black-50` (scrim). Pogrubione = wartości marki ze strony eviacharge.pl. Rampy teal i lime wyliczone w OKLCH wokół koloru marki (ta sama tonacja), rampy statusowe — sprawdzone, szeroko stosowane wartości.

#### 2.1.3 Role kolorów (semantyka)
**Neutralne — tła, tekst, ikony, obrysy**

| Rola | Paleta | Użycie |
|---|---|---|
| `color.bg.canvas` | `palette.neutral.100` | tło strony / ekranu |
| `color.bg.surface` | `palette.neutral.0` | karty, tabele, dialogi, pola, arkusze |
| `color.bg.surface-subtle` | `palette.neutral.50` | nagłówek tabeli, pasek filtrów |
| `color.bg.surface-hover` / `-pressed` | `palette.neutral.100` / `palette.neutral.200` | wiersz/element listy: najechanie / wciśnięcie |
| `color.bg.selected` | `palette.teal.50` | zaznaczony wiersz, wybrana opcja listy (zawsze z drugim wskaźnikiem ≥ 3:1 — obrys/pasek `color.border.selected` lub ikona `check`; nie dla dolnej nawigacji) |
| `color.bg.inverse` | `palette.neutral.900` | toast |
| `color.bg.brand` / `color.bg.brand-strong` | `palette.teal.600` / `palette.teal.800` | ekran logowania i logo / pasek aplikacji mobile, boczna nawigacja web |
| `color.bg.disabled` | `palette.neutral.200` | wyłączona kontrolka |
| `color.bg.skeleton` / `-highlight` | `palette.neutral.200` / `palette.neutral.100` | szkielet ładowania |
| `color.bg.scrim` | `palette.alpha.black-50` | przyciemnienie pod dialogiem / arkuszem |
| `color.text.primary` | `palette.neutral.900` | tekst podstawowy (AAA) |
| `color.text.secondary` | `palette.neutral.700` | opisy, metadane (AAA) |
| `color.text.tertiary` | `palette.neutral.600` | podpowiedzi, placeholder (AA) |
| `color.text.disabled` | `palette.neutral.500` | tekst wyłączony |
| `color.text.inverse` / `color.text.on-brand` | `palette.neutral.0` | tekst na tłach ciemnych / marki |
| `color.text.link` / `-hover` | `palette.teal.700` / `palette.teal.800` | link (zawsze podkreślony) |
| `color.icon.primary` / `secondary` / `disabled` / `inverse` / `brand` | `palette.neutral.800` / `600` / `400` / `0` / `palette.teal.600` | ikony |
| `color.border.subtle` | `palette.neutral.200` | separatory (dekoracyjne) |
| `color.border.default` | `palette.neutral.300` | obrys karty (dekoracyjny) |
| `color.border.strong` / `-hover` | `palette.neutral.500` / `palette.neutral.700` | obrys pól, checkboxów, radio (≥ 3:1) |
| `color.border.selected` | `palette.teal.700` | zaznaczony element |
| `color.border.inverse` | `palette.neutral.0` | obrys na ciemnym tle |
| `color.focus.ring` / `-inverse` | `palette.blue.600` / `palette.neutral.0` | pierścień fokusu na jasnym / ciemnym tle |
| `color.nav.indicator` / `on-indicator` | `palette.teal.700` / `palette.neutral.0` | dolna nawigacja mobile: kapsuła aktywnej pozycji / ikona na kapsule (§ 3.18) |
| `color.nav.label-active` / `label` / `icon` | `palette.neutral.900` / `700` / `600` | dolna nawigacja mobile: etykieta aktywna / etykieta i ikona nieaktywne |
| `color.brand.primary` | `palette.teal.600` | kolor marki (logo, ilustracje) |
| `color.brand.accent` | `palette.lime.300` | akcent marki — **tylko** na `color.bg.brand-strong` (np. wskaźnik aktywnej pozycji nawigacji) |

**Akcje**

| Rola | bg / bg-hover / bg-pressed / bg-disabled | text / text-disabled | Inne |
|---|---|---|---|
| `color.action.primary.*` | `palette.teal.700` / `teal.800` / `teal.900` / `neutral.200` | `neutral.0` / `neutral.500` | — |
| `color.action.secondary.*` | `palette.neutral.0` / `teal.50` / `teal.100` / — | `teal.700` / `neutral.500` | `border` `teal.700`, `border-disabled` `neutral.300` |
| `color.action.tertiary.*` | — / `neutral.100` / `neutral.200` / — | `teal.700` / `neutral.500` | — |
| `color.action.danger.*` | `palette.red.700` / `red.800` / `red.900` / `neutral.200` | `neutral.0` / `neutral.500` | `text-subtle` `red.700` (przycisk tekstowy „Usuń”) |
| `color.control.*` | `bg` `neutral.0`, `bg-disabled` `neutral.100` | `placeholder` `neutral.600` | `checked` `teal.700`, `checked-hover` `teal.800`, `on-checked` `neutral.0`, `border-disabled` `neutral.300` |

**Komunikaty — sukces, ostrzeżenie, błąd, informacja** (`color.feedback.{success|warning|error|info}.{bg|border|icon|text}`)

| Ton | `bg` | `border` | `icon` | `text` | Skróty | Użycie |
|---|---|---|---|---|---|---|
| sukces | `palette.green.50` | `green.600` | `green.700` | `green.800` | `color.text.success`, `color.icon.success` | potwierdzenia, zakończone |
| ostrzeżenie | `palette.amber.50` | `amber.600` | `amber.700` | `amber.800` | `color.text.warning`, `color.icon.warning` | ryzyko, termin blisko, czekamy |
| błąd | `palette.red.50` | `red.600` | `red.700` | `red.800` | `color.text.error`, `color.icon.error`, `color.border.error` (`red.700`) | błąd walidacji, operacja nieudana, po terminie |
| informacja | `palette.blue.50` | `blue.600` | `blue.700` | `blue.800` | `color.icon.info` | wskazówki, stan neutralny-informacyjny |

**Statusy i synchronizacja** — `color.status.{order|stage|payment}.*` i `color.sync.*`: tabele mapowania w § 4.4 i § 5.4.

Zasady:
- Kolor nigdy nie jest jedynym nośnikiem informacji (ikona + etykieta; dla błędów pola także tekst komunikatu).
- `color.brand.accent` (neon) nie występuje na jasnych tłach i nie oznacza statusu.
- Jedna akcja główna (`color.action.primary.*`) na widok / sekcję / dialog.
- Wyłączony stan nie jest realizowany kryciem (`opacity`), tylko rolami `*-disabled`.

#### 2.1.4 Tabela kontrastów
Metoda: WCAG 2.x, luminancja względna sRGB, `(L1 + 0,05) / (L2 + 0,05)`; policzone 2026-10-02 dla wszystkich par używanych w komponentach. Progi: tekst ≥ 4,5:1 (AA), elementy UI i ikony niosące informację ≥ 3:1 (WCAG 1.4.11). „AAA” = tekst ≥ 7:1. Wynik: **wszystkie pary dopuszczone w komponentach spełniają progi** (wyjątek — tekst wyłączony — jest zwolniony z wymogu przez WCAG 1.4.3). Wiersze oznaczone **zakazane** / **niewystarczające** dokumentują pary, których nie wolno używać samodzielnie, wraz z obowiązującym rozwiązaniem.

| Pierwszy plan | Tło | Typ | Kontrast | Próg | Wynik |
|---|---|---|---|---|---|
| `text.primary` #1A1A1A | `bg.surface` #FFFFFF | tekst | **17,40:1** | 4,5:1 | AAA |
| `text.secondary` #404040 | `bg.surface` #FFFFFF | tekst | **10,37:1** | 4,5:1 | AAA |
| `text.tertiary` #5C5C5C | `bg.surface` #FFFFFF | tekst | **6,69:1** | 4,5:1 | AA |
| `text.primary` #1A1A1A | `bg.canvas` #F5F5F5 | tekst | **15,96:1** | 4,5:1 | AAA |
| `text.secondary` #404040 | `bg.canvas` #F5F5F5 | tekst | **9,51:1** | 4,5:1 | AAA |
| `text.tertiary` #5C5C5C | `bg.canvas` #F5F5F5 | tekst | **6,13:1** | 4,5:1 | AA |
| `text.primary` #1A1A1A | `bg.surface-subtle` #FAFAFA | tekst | **16,67:1** | 4,5:1 | AAA |
| `text.secondary` #404040 | `bg.surface-subtle` #FAFAFA | tekst | **9,93:1** | 4,5:1 | AAA |
| `text.tertiary` #5C5C5C | `bg.surface-subtle` #FAFAFA | tekst | **6,41:1** | 4,5:1 | AA |
| `text.primary` #1A1A1A | `bg.selected` #E8FBFD | tekst | **16,28:1** | 4,5:1 | AAA |
| `text.secondary` #404040 | `bg.selected` #E8FBFD | tekst | **9,70:1** | 4,5:1 | AAA |
| `text.tertiary` #5C5C5C | `bg.selected` #E8FBFD | tekst | **6,26:1** | 4,5:1 | AA |
| `text.link` #17656C | `bg.surface` #FFFFFF | tekst | **6,74:1** | 4,5:1 | AA |
| `text.link` #17656C | `bg.canvas` #F5F5F5 | tekst | **6,18:1** | 4,5:1 | AA |
| `text.link-hover` #115157 | `bg.surface` #FFFFFF | tekst | **8,98:1** | 4,5:1 | AAA |
| `text.error` #991B1B | `bg.surface` #FFFFFF | tekst | **8,31:1** | 4,5:1 | AAA |
| `text.error` #991B1B | `bg.canvas` #F5F5F5 | tekst | **7,62:1** | 4,5:1 | AAA |
| `text.success` #166534 | `bg.surface` #FFFFFF | tekst | **7,13:1** | 4,5:1 | AAA |
| `text.warning` #92400E | `bg.surface` #FFFFFF | tekst | **7,09:1** | 4,5:1 | AAA |
| `text.inverse` #FFFFFF | `bg.inverse` #1A1A1A | tekst | **17,40:1** | 4,5:1 | AAA |
| `text.on-brand` #FFFFFF | `bg.brand` #247B83 | tekst — logo, ekran logowania | **4,96:1** | 4,5:1 | AA |
| `text.on-brand` #FFFFFF | `bg.brand-strong` #115157 | tekst | **8,98:1** | 4,5:1 | AAA |
| `text.disabled` #838383 | `bg.disabled` #E5E5E5 | tekst wyłączony (informacyjnie) | **3,01:1** | — | zwolniony (WCAG 1.4.3) |
| `action.primary.text` #FFFFFF | `action.primary.bg` #17656C | tekst | **6,74:1** | 4,5:1 | AA |
| `action.primary.text` #FFFFFF | `action.primary.bg-hover` #115157 | tekst | **8,98:1** | 4,5:1 | AAA |
| `action.primary.text` #FFFFFF | `action.primary.bg-pressed` #0A3E43 | tekst | **11,78:1** | 4,5:1 | AAA |
| `action.secondary.text` #17656C | `action.secondary.bg` #FFFFFF | tekst | **6,74:1** | 4,5:1 | AA |
| `action.secondary.text` #17656C | `action.secondary.bg-hover` #E8FBFD | tekst | **6,31:1** | 4,5:1 | AA |
| `action.secondary.text` #17656C | `action.secondary.bg-pressed` #D3F4F8 | tekst | **5,80:1** | 4,5:1 | AA |
| `action.secondary.border` #17656C | `bg.surface` #FFFFFF | UI — obrys przycisku | **6,74:1** | 3:1 | AA |
| `action.secondary.border` #17656C | `bg.canvas` #F5F5F5 | UI — obrys przycisku | **6,18:1** | 3:1 | AA |
| `action.tertiary.text` #17656C | `bg.surface` #FFFFFF | tekst | **6,74:1** | 4,5:1 | AA |
| `action.tertiary.text` #17656C | `action.tertiary.bg-hover` #F5F5F5 | tekst | **6,18:1** | 4,5:1 | AA |
| `action.danger.text` #FFFFFF | `action.danger.bg` #B91C1C | tekst | **6,47:1** | 4,5:1 | AA |
| `action.danger.text` #FFFFFF | `action.danger.bg-hover` #991B1B | tekst | **8,31:1** | 4,5:1 | AAA |
| `action.danger.text-subtle` #B91C1C | `bg.surface` #FFFFFF | tekst | **6,47:1** | 4,5:1 | AA |
| `action.primary.bg` #17656C | `bg.surface` #FFFFFF | UI — granica przycisku | **6,74:1** | 3:1 | AA |
| `action.primary.bg` #17656C | `bg.canvas` #F5F5F5 | UI — granica przycisku | **6,18:1** | 3:1 | AA |
| `border.strong` #838383 | `bg.surface` #FFFFFF | UI — obrys pola / checkboxa | **3,79:1** | 3:1 | AA |
| `border.strong` #838383 | `bg.canvas` #F5F5F5 | UI — obrys pola | **3,48:1** | 3:1 | AA |
| `border.strong` #838383 | `bg.surface-subtle` #FAFAFA | UI — obrys pola w pasku filtrów | **3,63:1** | 3:1 | AA |
| `border.error` #B91C1C | `bg.surface` #FFFFFF | UI | **6,47:1** | 3:1 | AA |
| `border.selected` #17656C | `bg.surface` #FFFFFF | UI | **6,74:1** | 3:1 | AA |
| `border.selected` #17656C | `bg.selected` #E8FBFD | UI | **6,31:1** | 3:1 | AA |
| `control.checked` #17656C | `bg.surface` #FFFFFF | UI — checkbox zaznaczony | **6,74:1** | 3:1 | AA |
| `control.on-checked` #FFFFFF | `control.checked` #17656C | UI — znacznik ✓ | **6,74:1** | 3:1 | AA |
| `focus.ring` #2563EB | `bg.surface` #FFFFFF | UI | **5,17:1** | 3:1 | AA |
| `focus.ring` #2563EB | `bg.canvas` #F5F5F5 | UI | **4,74:1** | 3:1 | AA |
| `focus.ring` #2563EB | `bg.surface-subtle` #FAFAFA | UI | **4,95:1** | 3:1 | AA |
| `focus.ring-inverse` #FFFFFF | `bg.brand-strong` #115157 | UI | **8,98:1** | 3:1 | AA |
| `focus.ring-inverse` #FFFFFF | `bg.inverse` #1A1A1A | UI | **17,40:1** | 3:1 | AA |
| `focus.ring-inverse` #FFFFFF | `bg.brand` #247B83 | UI — fokus na wciśniętym przycisku górnego paska | **4,96:1** | 3:1 | AA |
| `focus.ring` #2563EB | `bg.brand-strong` #115157 | UI | 1,74:1 | 3:1 | **zakazane** — na `bg.brand-strong` tylko `focus.ring-inverse` |
| `brand.accent` #6EFF33 | `bg.brand-strong` #115157 | UI — wskaźnik aktywnej pozycji nawigacji | **6,85:1** | 3:1 | AA |
| `nav.indicator` #17656C | `bg.surface` #FFFFFF | UI — kapsuła aktywnej pozycji BottomNav | **6,74:1** | 3:1 | AA |
| `nav.indicator` #17656C | `bg.surface-pressed` #E5E5E5 | UI — kapsuła przy wciśnięciu | **5,35:1** | 3:1 | AA |
| `nav.on-indicator` #FFFFFF | `nav.indicator` #17656C | UI — ikona aktywnej pozycji | **6,74:1** | 3:1 | AA |
| `nav.label-active` #1A1A1A | `bg.surface` #FFFFFF | tekst | **17,40:1** | 4,5:1 | AAA |
| `nav.label-active` #1A1A1A | `bg.surface-pressed` #E5E5E5 | tekst | **13,81:1** | 4,5:1 | AAA |
| `nav.label` #404040 | `bg.surface` #FFFFFF | tekst | **10,37:1** | 4,5:1 | AAA |
| `nav.label` #404040 | `bg.surface-pressed` #E5E5E5 | tekst | **8,23:1** | 4,5:1 | AAA |
| `nav.icon` #5C5C5C | `bg.surface` #FFFFFF | UI | **6,69:1** | 3:1 | AA |
| `nav.icon` #5C5C5C | `bg.surface-pressed` #E5E5E5 | UI | **5,31:1** | 3:1 | AA |
| `bg.selected` #E8FBFD | `bg.surface` #FFFFFF | UI — sam odcień | 1,07:1 | 3:1 | **niewystarczające** — tylko z drugim wskaźnikiem (obrys `border.selected`, ikona `check`) |
| `icon.primary` #2B2B2B | `bg.surface` #FFFFFF | UI | **14,16:1** | 3:1 | AA |
| `icon.secondary` #5C5C5C | `bg.surface` #FFFFFF | UI | **6,69:1** | 3:1 | AA |
| `icon.secondary` #5C5C5C | `bg.canvas` #F5F5F5 | UI | **6,13:1** | 3:1 | AA |
| `icon.brand` #247B83 | `bg.surface` #FFFFFF | UI | **4,96:1** | 3:1 | AA |
| `feedback.success.text` #166534 | `feedback.success.bg` #F0FDF4 | tekst | **6,81:1** | 4,5:1 | AA |
| `feedback.success.icon` #15803D | `feedback.success.bg` #F0FDF4 | UI | **4,79:1** | 3:1 | AA |
| `feedback.success.border` #16A34A | `feedback.success.bg` #F0FDF4 | UI | **3,15:1** | 3:1 | AA |
| `text.primary` #1A1A1A | `feedback.success.bg` #F0FDF4 | tekst | **16,63:1** | 4,5:1 | AAA |
| `feedback.warning.text` #92400E | `feedback.warning.bg` #FFFBEB | tekst | **6,84:1** | 4,5:1 | AA |
| `feedback.warning.icon` #B45309 | `feedback.warning.bg` #FFFBEB | UI | **4,84:1** | 3:1 | AA |
| `feedback.warning.border` #D97706 | `feedback.warning.bg` #FFFBEB | UI | **3,07:1** | 3:1 | AA |
| `text.primary` #1A1A1A | `feedback.warning.bg` #FFFBEB | tekst | **16,78:1** | 4,5:1 | AAA |
| `feedback.error.text` #991B1B | `feedback.error.bg` #FEF2F2 | tekst | **7,60:1** | 4,5:1 | AAA |
| `feedback.error.icon` #B91C1C | `feedback.error.bg` #FEF2F2 | UI | **5,91:1** | 3:1 | AA |
| `feedback.error.border` #DC2626 | `feedback.error.bg` #FEF2F2 | UI | **4,41:1** | 3:1 | AA |
| `text.primary` #1A1A1A | `feedback.error.bg` #FEF2F2 | tekst | **15,91:1** | 4,5:1 | AAA |
| `feedback.info.text` #1E40AF | `feedback.info.bg` #EFF6FF | tekst | **8,01:1** | 4,5:1 | AAA |
| `feedback.info.icon` #1D4ED8 | `feedback.info.bg` #EFF6FF | UI | **6,16:1** | 3:1 | AA |
| `feedback.info.border` #2563EB | `feedback.info.bg` #EFF6FF | UI | **4,75:1** | 3:1 | AA |
| `text.primary` #1A1A1A | `feedback.info.bg` #EFF6FF | tekst | **15,99:1** | 4,5:1 | AAA |
| `status.order.new.text` #2B2B2B | `status.order.new.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.order.new.icon` #404040 | `status.order.new.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `status.order.quote.text` #4C1D95 | `status.order.quote.bg` #EDE9FE | tekst | **9,23:1** | 4,5:1 | AAA |
| `status.order.quote.icon` #6D28D9 | `status.order.quote.bg` #EDE9FE | UI | **5,98:1** | 3:1 | AA |
| `status.order.accepted.text` #1E3A8A | `status.order.accepted.bg` #DBEAFE | tekst | **8,49:1** | 4,5:1 | AAA |
| `status.order.accepted.icon` #1D4ED8 | `status.order.accepted.bg` #DBEAFE | UI | **5,49:1** | 3:1 | AA |
| `status.order.in-progress.text` #0A3E43 | `status.order.in-progress.bg` #D3F4F8 | tekst | **10,13:1** | 4,5:1 | AAA |
| `status.order.in-progress.icon` #17656C | `status.order.in-progress.bg` #D3F4F8 | UI | **5,80:1** | 3:1 | AA |
| `status.order.completed.text` #14532D | `status.order.completed.bg` #DCFCE7 | tekst | **8,30:1** | 4,5:1 | AAA |
| `status.order.completed.icon` #15803D | `status.order.completed.bg` #DCFCE7 | UI | **4,57:1** | 3:1 | AA |
| `status.order.settled.text` #FFFFFF | `status.order.settled.bg` #166534 | tekst | **7,13:1** | 4,5:1 | AAA |
| `status.order.settled.icon` #FFFFFF | `status.order.settled.bg` #166534 | UI | **7,13:1** | 3:1 | AA |
| `status.order.on-hold.text` #78350F | `status.order.on-hold.bg` #FEF3C7 | tekst | **8,15:1** | 4,5:1 | AAA |
| `status.order.on-hold.icon` #B45309 | `status.order.on-hold.bg` #FEF3C7 | UI | **4,51:1** | 3:1 | AA |
| `status.order.cancelled.text` #2B2B2B | `status.order.cancelled.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.order.cancelled.icon` #404040 | `status.order.cancelled.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `status.stage.todo.text` #2B2B2B | `status.stage.todo.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.stage.todo.icon` #404040 | `status.stage.todo.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `status.stage.in-progress.text` #0A3E43 | `status.stage.in-progress.bg` #D3F4F8 | tekst | **10,13:1** | 4,5:1 | AAA |
| `status.stage.in-progress.icon` #17656C | `status.stage.in-progress.bg` #D3F4F8 | UI | **5,80:1** | 3:1 | AA |
| `status.stage.waiting.text` #78350F | `status.stage.waiting.bg` #FEF3C7 | tekst | **8,15:1** | 4,5:1 | AAA |
| `status.stage.waiting.icon` #B45309 | `status.stage.waiting.bg` #FEF3C7 | UI | **4,51:1** | 3:1 | AA |
| `status.stage.done.text` #14532D | `status.stage.done.bg` #DCFCE7 | tekst | **8,30:1** | 4,5:1 | AAA |
| `status.stage.done.icon` #15803D | `status.stage.done.bg` #DCFCE7 | UI | **4,57:1** | 3:1 | AA |
| `status.stage.not-applicable.text` #2B2B2B | `status.stage.not-applicable.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.stage.not-applicable.icon` #404040 | `status.stage.not-applicable.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `status.stage.blocked.text` #7F1D1D | `status.stage.blocked.bg` #FEE2E2 | tekst | **8,20:1** | 4,5:1 | AAA |
| `status.stage.blocked.icon` #B91C1C | `status.stage.blocked.bg` #FEE2E2 | UI | **5,30:1** | 3:1 | AA |
| `status.payment.planned.text` #2B2B2B | `status.payment.planned.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.payment.planned.icon` #404040 | `status.payment.planned.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `status.payment.issued.text` #1E3A8A | `status.payment.issued.bg` #DBEAFE | tekst | **8,49:1** | 4,5:1 | AAA |
| `status.payment.issued.icon` #1D4ED8 | `status.payment.issued.bg` #DBEAFE | UI | **5,49:1** | 3:1 | AA |
| `status.payment.paid.text` #14532D | `status.payment.paid.bg` #DCFCE7 | tekst | **8,30:1** | 4,5:1 | AAA |
| `status.payment.paid.icon` #15803D | `status.payment.paid.bg` #DCFCE7 | UI | **4,57:1** | 3:1 | AA |
| `status.payment.overdue.text` #FFFFFF | `status.payment.overdue.bg` #991B1B | tekst | **8,31:1** | 4,5:1 | AAA |
| `status.payment.overdue.icon` #FFFFFF | `status.payment.overdue.bg` #991B1B | UI | **8,31:1** | 3:1 | AA |
| `sync.offline.text` #FFFFFF | `sync.offline.bg` #2B2B2B | tekst | **14,16:1** | 4,5:1 | AAA |
| `sync.offline.icon` #FFFFFF | `sync.offline.bg` #2B2B2B | UI | **14,16:1** | 3:1 | AA |
| `sync.queued.text` #2B2B2B | `sync.queued.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `sync.queued.icon` #404040 | `sync.queued.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
| `sync.in-progress.text` #1E3A8A | `sync.in-progress.bg` #DBEAFE | tekst | **8,49:1** | 4,5:1 | AAA |
| `sync.in-progress.icon` #1D4ED8 | `sync.in-progress.bg` #DBEAFE | UI | **5,49:1** | 3:1 | AA |
| `sync.done.text` #14532D | `sync.done.bg` #DCFCE7 | tekst | **8,30:1** | 4,5:1 | AAA |
| `sync.done.icon` #15803D | `sync.done.bg` #DCFCE7 | UI | **4,57:1** | 3:1 | AA |
| `sync.error.text` #7F1D1D | `sync.error.bg` #FEE2E2 | tekst | **8,20:1** | 4,5:1 | AAA |
| `sync.error.icon` #B91C1C | `sync.error.bg` #FEE2E2 | UI | **5,30:1** | 3:1 | AA |
| `sync.waiting-wifi.text` #78350F | `sync.waiting-wifi.bg` #FEF3C7 | tekst | **8,15:1** | 4,5:1 | AAA |
| `sync.waiting-wifi.icon` #B45309 | `sync.waiting-wifi.bg` #FEF3C7 | UI | **4,51:1** | 3:1 | AA |
| `sync.done.bg` #DCFCE7 | `bg.brand-strong` #115157 | UI — kapsuła SyncIndicator na górnym pasku | **8,18:1** | 3:1 | AA |
| `sync.in-progress.bg` #DBEAFE | `bg.brand-strong` #115157 | UI — kapsuła | **7,36:1** | 3:1 | AA |
| `sync.waiting-wifi.bg` #FEF3C7 | `bg.brand-strong` #115157 | UI — kapsuła | **8,06:1** | 3:1 | AA |
| `sync.queued.bg` #F5F5F5 | `bg.brand-strong` #115157 | UI — kapsuła | **8,24:1** | 3:1 | AA |
| `sync.error.bg` #FEE2E2 | `bg.brand-strong` #115157 | UI — kapsuła | **7,35:1** | 3:1 | AA |
| `sync.offline.bg` #2B2B2B | `bg.brand-strong` #115157 | UI — kapsuła bez obrysu | 1,58:1 | 3:1 | **niewystarczające** — dlatego obowiązkowy obrys `border.inverse` (wiersze niżej) |
| `border.inverse` #FFFFFF | `bg.brand-strong` #115157 | UI — obrys kapsuły offline | **8,98:1** | 3:1 | AA |
| `border.inverse` #FFFFFF | `sync.offline.bg` #2B2B2B | UI — obrys kapsuły offline od wnętrza | **14,16:1** | 3:1 | AA |
| `sync.*.icon` bezpośrednio na pasku, np. `sync.done.icon` #15803D / `sync.in-progress.icon` #1D4ED8 | `bg.brand-strong` #115157 | UI | 1,79:1 / 1,34:1 | 3:1 | **zakazane** — ikony tylko w kapsule |
| `sync.progress.fill` #2563EB | `sync.progress.track` #E5E5E5 | UI | **4,10:1** | 3:1 | AA |
| `sync.progress.fill` #2563EB | `bg.surface` #FFFFFF | UI | **5,17:1** | 3:1 | AA |
| `sync.progress.fill-done` #15803D | `sync.progress.track` #E5E5E5 | UI | **3,98:1** | 3:1 | AA |
| `sync.progress.fill-error` #B91C1C | `sync.progress.track` #E5E5E5 | UI | **5,14:1** | 3:1 | AA |

(Nazwy w tabeli bez prefiksu `color.`.) Kontrast nowych par liczy i dopisuje `ux-designer` przy każdej zmianie palety lub ról.

### 2.2 Typografia
**Fonty i licencje**

| Token | Font | Licencja | Użycie |
|---|---|---|---|
| `font.family.sans` | **Inter** → fallback `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, `Arial`, `sans-serif` | SIL OFL 1.1 | cały interfejs, tabele, liczby |
| `font.family.display` | **Exo 2** → fallback Inter | SIL OFL 1.1 | tylko `text.display` i `text.heading-1` (charakter marki) |
| `font.family.mono` | **JetBrains Mono** → `ui-monospace` … | SIL OFL 1.1 | tylko identyfikatory techniczne (np. nr PPE) |

Fonty pochodzą ze strony eviacharge.pl (szczegóły: `design/brand/README.md`). Osadzamy je lokalnie w aplikacji web i mobilnej (bez CDN — działanie offline, RODO). Wszystkie mają pełne polskie znaki; Inter ma cyfry tabelaryczne (`tnum`).

**Skala** (`design/tokens/semantic/typography.tokens.json`)

| Token | Font | Rozmiar / interlinia | Waga | Odstęp liter | Użycie |
|---|---|---|---|---|---|
| `text.display` | `font.family.display` | `font.size.36` (36) / `font.line-height.36` (44) | `font.weight.semibold` (600) | `font.letter-spacing.tight` (−0,2) | ekran logowania, duże puste stany |
| `text.heading-1` | `font.family.display` | `font.size.30` (30) / `font.line-height.30` (36) | `font.weight.semibold` | `font.letter-spacing.tight` | tytuł strony (web) |
| `text.heading-2` | `font.family.sans` | `font.size.24` (24) / `font.line-height.24` (32) | `font.weight.semibold` | `font.letter-spacing.none` (0) | sekcja (web), tytuł ekranu (mobile) |
| `text.heading-3` | `font.family.sans` | `font.size.20` (20) / `font.line-height.20` (28) | `font.weight.semibold` | `font.letter-spacing.none` | tytuł karty, dialogu |
| `text.heading-4` | `font.family.sans` | `font.size.18` (18) / `font.line-height.18` (28) | `font.weight.semibold` | `font.letter-spacing.none` | podsekcja, grupa pól |
| `text.body-lg` | `font.family.sans` | `font.size.18` / `font.line-height.18` | `font.weight.regular` (400) | `font.letter-spacing.none` | kluczowy tekst w terenie (adres, instrukcja) |
| `text.body` | `font.family.sans` | `font.size.16` (16) / `font.line-height.16` (24) | `font.weight.regular` | `font.letter-spacing.none` | tekst podstawowy; **minimum na mobile** |
| `text.body-sm` | `font.family.sans` | `font.size.14` (14) / `font.line-height.14` (20) | `font.weight.regular` | `font.letter-spacing.none` | tabele web, opisy pomocnicze |
| `text.label` | `font.family.sans` | `font.size.14` / `font.line-height.14` | `font.weight.medium` (500) | `font.letter-spacing.none` | etykiety pól (web), odznaki statusu |
| `text.label-lg` | `font.family.sans` | `font.size.16` / `font.line-height.16` | `font.weight.medium` | `font.letter-spacing.none` | etykiety pól (mobile) |
| `text.button` | `font.family.sans` | `font.size.16` / `font.line-height.16` | `font.weight.semibold` | `font.letter-spacing.none` | przyciski md/lg, mobile |
| `text.button-sm` | `font.family.sans` | `font.size.14` / `font.line-height.14` | `font.weight.semibold` | `font.letter-spacing.none` | przyciski sm (tylko web) |
| `text.caption` | `font.family.sans` | `font.size.12` (12) / `font.line-height.12` (16) | `font.weight.regular` | `font.letter-spacing.none` | metadane (tylko web) |
| `text.overline` | `font.family.sans` | `font.size.12` / `font.line-height.12` | `font.weight.semibold` | `font.letter-spacing.wide` (0,4) | nagłówki grup nawigacji (wersaliki) |
| `text.numeric` | `font.family.sans` + `tnum` | `font.size.14` / `font.line-height.14` | `font.weight.regular` | `font.letter-spacing.none` | kwoty, daty, liczby w tabelach |
| `text.numeric-lg` | `font.family.sans` + `tnum` | `font.size.20` / `font.line-height.20` | `font.weight.semibold` | `font.letter-spacing.none` | sumy, kwoty wyróżnione |
| `text.mono` | `font.family.mono` | `font.size.14` / `font.line-height.14` | `font.weight.regular` | `font.letter-spacing.none` | identyfikatory techniczne |

Interlinie (`font.line-height.*`) są mnożnikami dającymi wysokość linii w siatce 4 px. Waga `font.weight.bold` (700) — tylko wyróżnienia w tekście (np. kwota do zapłaty), nigdy całe akapity.

Zasady:
- **Liczby w tabelach i kwoty: `text.numeric` / `text.numeric-lg`** (`font-variant-numeric: tabular-nums`), wyrównanie do prawej.
- Mobile: tekst treści min. `text.body`; `text.caption` niedozwolony (min. `text.body-sm`). Obsługa Dynamic Type / skalowania czcionki systemu do 200 % bez obcinania tekstu (zawijanie, nie wielokropek w kluczowych danych).
- Web: rozmiary w `rem` (powiększenie przeglądarki 200 % bez utraty treści, WCAG 1.4.4); tekst ciągły w kolumnie nie szerszej niż `size.form.max-width`.
- Zdania i etykiety: wielka litera tylko na początku („Dodaj etap”, nie „Dodaj Etap”); wersaliki tylko `text.overline`.
- Nie używamy wag < 400 (czytelność w słońcu).

### 2.3 Odstępy
Siatka 4 px. Skala bazowa `dimension.*`: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96 (`dimension.1`, `.2`, `.3`, `.6` — tylko obramowania i drobne korekty). W UI używamy ról:

| Token | Wartość | Użycie |
|---|---|---|
| `space.inset.xs` / `sm` / `md` / `lg` / `xl` | `dimension.4` / `.8` / `.16` / `.24` / `.32` | padding wewnątrz: odznaka / chip, pole / komórka tabeli, karta / dialog (mobile), dialog (web) / strona, sekcje duże |
| `space.stack.xs` / `sm` / `md` / `lg` / `xl` / `2xl` | `dimension.4` / `.8` / `.16` / `.24` / `.32` / `.48` | pionowo: etykieta↔pole, pole↔podpowiedź, pola formularza, grupy pól, sekcje, pusty stan |
| `space.inline.xs` / `sm` / `md` / `lg` / `xl` | `dimension.4` / `.8` / `.12` / `.16` / `.24` | poziomo: ikona↔tekst, przyciski w grupie / chipy, elementy paska, kolumny formularza |

Minimalny odstęp między celami dotyku na mobile: `space.inline.sm` / `space.stack.sm` (8).

### 2.4 Siatka i breakpointy
| Breakpoint | Token (min-width) | Kolumny | Gutter | Margines | Typowe urządzenie | Układ |
|---|---|---|---|---|---|---|
| compact | `breakpoint.compact` (360) | `grid.compact.columns` (4) | `grid.compact.gutter` → `dimension.16` | `grid.compact.margin` → `dimension.16` | telefon | jedna kolumna, dolna nawigacja, listy kartowe |
| medium | `breakpoint.medium` (768) | `grid.medium.columns` (8) | `grid.medium.gutter` → `dimension.24` | `grid.medium.margin` → `dimension.24` | tablet, mały laptop | nawigacja zwinięta (`size.sidebar.width.collapsed`), tabela z mniejszą liczbą kolumn |
| expanded | `breakpoint.expanded` (1280) | `grid.expanded.columns` (12) | `grid.expanded.gutter` → `dimension.24` | `grid.expanded.margin` → `dimension.32` | desktop biurowy | boczna nawigacja rozwinięta (`size.sidebar.width.expanded`), tabela + panel szczegółów |
| wide | `breakpoint.wide` (1440) | `grid.wide.columns` (12) | `grid.wide.gutter` → `dimension.24` | `grid.wide.margin` → `dimension.40` | szeroki desktop | jak expanded, więcej kolumn tabeli |

Przeglądy UX wykonujemy w szerokościach 360 / 768 / 1280 / 1440 px. Poniżej 360 px układ compact bez gwarancji. Formularze: kolumna max `size.form.max-width` (640).

### 2.5 Rozmiary
| Token | Wartość | Użycie |
|---|---|---|
| `size.touch-target.min` | `dimension.48` | **minimalny cel dotyku mobile 48×48 dp** — każdy element interaktywny |
| `size.touch-target.field` | `dimension.56` | akcje główne w terenie (Zapisz, Wyślij, Zrób zdjęcie) |
| `size.touch-target.shutter` | `dimension.72` | spust aparatu |
| `size.touch-target.web-min` | `dimension.24` | absolutne minimum web (WCAG 2.5.8); zalecane ≥ `size.control.height.web.sm` |
| `size.control.height.web.sm` / `md` / `lg` | `dimension.32` / `.40` / `.48` | kontrolki web: gęste tabele i filtry / domyślne / dotykowe |
| `size.control.height.mobile.md` / `lg` | `dimension.48` / `.56` | kontrolki mobile: domyślne / akcja główna |
| `size.icon.sm` / `md` / `lg` / `xl` / `2xl` | `dimension.16` / `.20` / `.24` / `.32` / `.48` | ikony: w odznace / web / mobile / wyróżnione / pusty stan |
| `size.thumbnail.sm` / `md` / `lg` | `dimension.48` / `.96` / `.160` | miniatury: kolejka uploadu / kafel galerii (min.) / kafel duży (web) |
| `size.badge.height` | `dimension.24` | odznaka statusu |
| `size.timeline-marker` | `dimension.24` | znacznik osi czasu |
| `size.progress-bar.height` | `dimension.4` | pasek postępu |
| `size.app-bar.height.mobile` / `web` | `dimension.56` / `.64` | górny pasek |
| `size.bottom-nav.height` | `dimension.64` | dolna nawigacja mobile |
| `size.sidebar.width.expanded` / `collapsed` | `dimension.256` / `.72` | boczna nawigacja web |
| `size.dialog.width.sm` / `md` / `lg` | `dimension.400` / `.560` / `.720` | dialogi web |
| `size.toast.max-width` | `dimension.400` | toast |
| `size.form.max-width` | `dimension.640` | kolumna formularza |
| `size.focus-ring.width` / `offset` | `dimension.2` / `.2` | pierścień fokusu |

### 2.6 Promienie
| Token | Wartość | Użycie |
|---|---|---|
| `radius.none` | `dimension.0` | tabele, paski |
| `radius.checkbox` | `dimension.4` | checkbox |
| `radius.control` | `dimension.8` | przyciski, pola, select (jak przyciski na eviacharge.pl) |
| `radius.thumbnail` | `dimension.8` | miniatury |
| `radius.card` | `dimension.12` | karty |
| `radius.dialog` | `dimension.16` | dialogi |
| `radius.sheet` | `dimension.16` | arkusz dolny (tylko górne rogi) |
| `radius.pill` | `dimension.9999` | odznaki statusu, chipy filtrów |

### 2.7 Obramowania
| Token | Wartość | Użycie |
|---|---|---|
| `border-width.default` | `dimension.1` | pola, karty, separatory |
| `border-width.strong` | `dimension.2` | pole w stanie błąd/fokus, checkbox, przycisk drugorzędny |
| `border-width.indicator` | `dimension.3` | aktywna zakładka, aktywna pozycja nawigacji, zaznaczony wiersz (pasek z lewej) |

### 2.8 Cienie i warstwy
| Token | Bazowy | Definicja | Użycie |
|---|---|---|---|
| `elevation.card` | `shadow.1` | 0 1 3 0 `palette.alpha.black-12` + 0 1 2 −1 `palette.alpha.black-8` | karta interaktywna po najechaniu (w spoczynku karta ma tylko obrys `color.border.default`) |
| `elevation.sticky` | `shadow.1` | jw. | przyklejony nagłówek tabeli / pasek filtrów |
| `elevation.bottom-bar` | `shadow.up-1` | 0 −2 8 0 `palette.alpha.black-12` | dolny pasek akcji / nawigacji mobile |
| `elevation.dropdown` | `shadow.2` | 0 4 8 −2 `palette.alpha.black-12` + 0 2 4 −2 `palette.alpha.black-8` | menu, popover, lista selecta |
| `elevation.dialog` / `elevation.toast` | `shadow.3` | 0 12 24 −4 `palette.alpha.black-16` + 0 4 8 −4 `palette.alpha.black-8` | dialog, arkusz dolny, toast |

Warstwy (`layer.*` → `z-layer.*`): `layer.sticky` (100) < `layer.dropdown` (200) < `layer.overlay` (300, scrim) < `layer.dialog` (400) < `layer.toast` (500). Cień nie jest jedynym wyróżnikiem powierzchni — karty i dialogi mają też obrys lub scrim.

### 2.9 Ruch
| Token | Wartość | Użycie |
|---|---|---|
| `motion.duration.instant` | `duration.0` | brak animacji / tryb ograniczonego ruchu |
| `motion.duration.fast` | `duration.100` (100 ms) | hover, zmiana koloru, checkbox |
| `motion.duration.exit` | `duration.150` (150 ms) | wyjście elementu |
| `motion.duration.base` | `duration.200` (200 ms) | wejście elementu, rozwinięcie |
| `motion.duration.slow` | `duration.300` (300 ms) | arkusz dolny, panel boczny |
| `motion.duration.skeleton` | `duration.1500` (1,5 s) | cykl szkieletu ładowania |
| `motion.easing.standard` | `easing.standard` (0.2, 0, 0, 1) | zmiany w miejscu |
| `motion.easing.enter` | `easing.decelerate` (0, 0, 0, 1) | wejście |
| `motion.easing.exit` | `easing.accelerate` (0.3, 0, 1, 1) | wyjście |
| `motion.easing.linear` | `easing.linear` | postęp, szkielet |
| `motion.transition.hover` / `enter` / `exit` / `expand` / `sheet` | złożone z powyższych | gotowe przejścia |

Zasady: ruch tylko informuje (skąd przyszedł element, że coś się zmieniło) — bez dekoracji. Przy `prefers-reduced-motion` / „Ogranicz ruch” (iOS) / „Usuń animacje” (Android) wszystkie czasy → `motion.duration.instant`; szkielet statyczny (krycie `opacity.60`–`opacity.100` bez przesuwania). Żadnych migających elementów (> 3 błyski / s zakazane).

### 2.10 Ikony
- **Zestaw: Lucide** (https://lucide.dev, licencja **ISC**) — ten sam co na eviacharge.pl; dostępny dla web (SVG / pakiety) i mobile (pakiety natywne lub SVG). Sprawdzona wersja: 1.50.0. Biblioteki dodają developerzy w historyjkach implementacyjnych (EVM-008, EVM-009). Uzasadnienie: otwarta licencja bez atrybucji w UI, spójny styl liniowy, zgodność ze stroną marki. Alternatywa odrzucona: Material Symbols (Apache 2.0) — inny styl niż marka.
- Rozmiary: `size.icon.sm` (w odznakach i chipach), `size.icon.md` (web), `size.icon.lg` (mobile, przyciski ikonowe), `size.icon.xl`, `size.icon.2xl` (pusty stan). Grubość linii `size.icon.stroke` → `dimension.2` (domyślna Lucide), bez skalowania grubości.
- Kolor ikon: role `color.icon.*` (ikona informacyjna ≥ 3:1).
- Ikona **zawsze z etykietą tekstową** albo — dla przycisku ikonowego — z nazwą dostępną (`aria-label` / `accessibilityLabel`) i podpowiedzią (tooltip na web).
- Słownik ikon akcji (spójność): dodaj `plus`, edytuj `pencil`, usuń `trash-2`, cofnij `undo-2`, zapisz — bez ikony (tekst), aparat `camera`, galeria `images`, wyślij/upload `cloud-upload`, ponów `rotate-ccw`, szukaj `search`, filtry `sliders-horizontal`, menu `menu`, więcej `ellipsis-vertical`, wstecz `arrow-left`, zamknij `x`, kalendarz `calendar`, informacja `info`, ostrzeżenie `triangle-alert`, błąd `circle-alert`, sukces `circle-check`, offline `wifi-off`, ładowanie `loader-circle` (tylko w przyciskach). Ikony statusów: § 4.4; synchronizacji: § 5.4.

---

## 3. Komponenty
Inwentarz dla M1–M2. Biblioteka komponentów powstaje w historyjkach implementacyjnych (web i mobile osobno, wspólne tokeny). Każdy komponent ma stany z listy: **domyślny · hover (web) · fokus · aktywny/wciśnięty · wyłączony · błąd · ładowanie** — „nd.” = nie dotyczy. Fokus zawsze: pierścień `color.focus.ring`, grubość `size.focus-ring.width`, odstęp `size.focus-ring.offset` (na ciemnych tłach `color.focus.ring-inverse`).

### 3.1 Przycisk (Button, IconButton)
- **Warianty:** primary (`color.action.primary.*`), secondary (obrys `color.action.secondary.border`, `border-width.strong`), tertiary/tekstowy (`color.action.tertiary.*`), danger (`color.action.danger.*`), danger-tertiary (`color.action.danger.text-subtle`). Rozmiary web: sm `size.control.height.web.sm` + `text.button-sm`, md `size.control.height.web.md` + `text.button` (domyślny), lg `size.control.height.web.lg`; mobile: md `size.control.height.mobile.md`, lg `size.control.height.mobile.lg` (akcja główna w terenie). IconButton: kwadrat o boku wysokości kontrolki (mobile min. `size.touch-target.min`), ikona `size.icon.md` (web) / `size.icon.lg` (mobile).
- **Stany:** domyślny `bg`; hover `bg-hover`; fokus pierścień; wciśnięty `bg-pressed`; wyłączony `bg-disabled` + `text-disabled` (nadal fokusowalny przez `aria-disabled`, jeśli trzeba wyjaśnić powód w podpowiedzi); błąd nd.; ładowanie — ikona `loader-circle` zamiast ikony wiodącej, etykieta bez zmian, szerokość stała, klik zablokowany, `aria-busy`.
- **Tokeny:** `radius.control`, padding poziomy `space.inset.md`, odstęp ikona–tekst `space.inline.sm`, `motion.transition.hover`.
- **Zasady:** tak — jedna akcja primary na widok/dialog; etykieta = czasownik + rzeczownik („Dodaj etap”). Nie — dwa primary obok siebie; sama ikona dla akcji nieoczywistych; danger dla akcji odwracalnych (wtedy tertiary + „Cofnij”).
- **Web / mobile:** web — kolejność w stopce dialogu: drugorzędny po lewej, główny po prawej. Mobile — akcja główna w dolnym pasku na pełną szerokość (`size.touch-target.field`), drugorzędne obok lub w menu `ellipsis-vertical`.

### 3.2 Pole tekstowe (TextField, TextArea)
- **Warianty:** tekst, liczba/kwota (`text.numeric`, jednostka jako sufiks „zł”, „kW”), telefon, e-mail, hasło (pokaż/ukryj), wyszukiwanie (ikona `search`, przycisk wyczyść `x`), wieloliniowe (autowzrost do 6 linii).
- **Anatomia:** etykieta (`text.label` web / `text.label-lg` mobile) nad polem, pole, podpowiedź lub błąd pod polem (`text.body-sm`, `color.text.tertiary` / `color.text.error` + ikona `circle-alert`). Odstępy `space.stack.xs` i `space.stack.sm`.
- **Stany:** domyślny obrys `color.border.strong`, tło `color.control.bg`; hover `color.border.strong-hover`; fokus pierścień + obrys `color.border.selected`; wyłączony `color.control.bg-disabled`, `color.control.border-disabled`, tekst `color.text.disabled`; tylko do odczytu — bez obrysu, tekst `color.text.primary`; błąd obrys `color.border.error` `border-width.strong` + komunikat; ładowanie (np. sprawdzanie) — ikona `loader-circle` w sufiksie.
- **Tokeny:** wysokość `size.control.height.web.md` / `size.control.height.mobile.md`, `radius.control`, padding `space.inset.sm`/`space.inset.md`, placeholder `color.control.placeholder`.
- **Zasady:** etykieta zawsze widoczna (placeholder nie zastępuje etykiety); pola opcjonalne oznaczamy „(opcjonalnie)”, nie wymagane gwiazdką; walidacja po opuszczeniu pola i przy zapisie, nie przy każdym znaku.
- **Web / mobile:** mobile — właściwa klawiatura (`numeric`, `tel`, `email`), autouzupełnianie systemowe, pola jedno pod drugim.

### 3.3 Select (Select, Combobox)
- **Warianty:** select (≤ 7 opcji, lista natywna na mobile), combobox z wyszukiwaniem (klienci, lokalizacje, osoby), wielokrotny wybór (chipy w polu).
- **Stany:** jak pole tekstowe; otwarty — lista `color.bg.surface`, `elevation.dropdown`, `layer.dropdown`, opcja aktywna `color.bg.surface-hover`, wybrana `color.bg.selected` + ikona `check`; ładowanie opcji — szkielet 3 wierszy; brak wyników — „Brak wyników dla „…”. [Dodaj klienta]”.
- **Tokeny:** `radius.control`, ikona `chevron-down` `size.icon.md`, wiersz opcji min. `size.control.height.web.md` / `size.touch-target.min`.
- **Zasady:** ≤ 4 opcje i ważny wybór → rozważ radio; długie listy → combobox. Klawiatura: strzałki, Enter, Esc, wpisywanie zawęża.
- **Web / mobile:** mobile — arkusz dolny (`radius.sheet`) z wyszukiwaniem na górze i dużymi wierszami.

### 3.4 Checkbox, radio, przełącznik
- **Warianty:** checkbox (pojedynczy, grupa, stan nieokreślony „—” dla „zaznacz wszystko”), radio (grupa), przełącznik (natychmiastowa zmiana ustawienia, np. „Wysyłaj tylko przez Wi-Fi”).
- **Stany:** domyślny obrys `color.border.strong` `border-width.strong`; hover `color.border.strong-hover`; fokus pierścień; zaznaczony `color.control.checked` + znacznik `color.control.on-checked`; hover zaznaczonego `color.control.checked-hover`; wyłączony `color.control.border-disabled`; błąd — komunikat pod grupą + `color.border.error`; ładowanie nd. (przełącznik: blokada do czasu zapisu).
- **Tokeny:** pole 20×20 (`size.icon.md`), `radius.checkbox` (checkbox), `radius.pill` (radio, przełącznik); obszar klikalny = cały wiersz z etykietą, min. `size.touch-target.min` na mobile.
- **Zasady:** etykieta po prawej, klikalna; grupy w `fieldset` z legendą. Przełącznik nie wymaga przycisku „Zapisz”; checkbox w formularzu — tak.

### 3.5 Data (DatePicker, DateTimePicker)
- **Warianty:** data, data i godzina, zakres dat (filtry), szybkie wybory („Dziś”, „Jutro”, „Za tydzień”).
- **Format:** `DD.MM.RRRR` (np. `02.10.2026`), godzina 24 h `14:05`; tydzień od poniedziałku; strefa `Europe/Warsaw` (§ 6.3).
- **Stany:** jak pole tekstowe; kalendarz — dziś obrys `color.border.selected`, wybrany dzień `color.action.primary.bg` + `color.action.primary.text`, dni niedostępne `color.text.disabled`; błąd: „Termin nie może być wcześniejszy niż data rozpoczęcia.”
- **Tokeny:** `elevation.dropdown`, komórka dnia min. `size.control.height.web.md` (web) / `size.touch-target.min` (mobile), `text.numeric`.
- **Zasady:** pole przyjmuje wpisanie z klawiatury (`2.10.2026`, `02-10-2026` → normalizacja) oraz wybór z kalendarza.
- **Web / mobile:** mobile — picker natywny platformy.

### 3.6 Tabela / lista (DataTable, List, ListItem)
- **Warianty:** tabela web (sortowanie, zaznaczanie wierszy, kolumny przyklejone, paginacja lub „Pokaż więcej”), lista kartowa (mobile i compact), lista prosta (np. etapy).
- **Anatomia tabeli:** nagłówek `color.bg.surface-subtle` + `text.label`, przyklejony (`elevation.sticky`, `layer.sticky`); wiersz `color.bg.surface`, separator `color.border.subtle`; wysokość wiersza `size.control.height.web.lg` (domyślna) lub `size.control.height.web.md` (gęsta); tekst `text.body-sm`, liczby `text.numeric` do prawej; status = odznaka (§ 3.9).
- **Stany:** hover wiersza `color.bg.surface-hover`; fokus wiersza pierścień wewnętrzny; zaznaczony `color.bg.selected` + pasek `border-width.indicator` `color.border.selected`; wciśnięty `color.bg.surface-pressed`; wyłączony nd.; błąd — wiersz z ikoną `circle-alert` i opisem; ładowanie — szkielet wierszy (§ 4.12); pusty — § 4.8.
- **Zasady:** cały wiersz prowadzi do szczegółów (link), akcje wiersza w menu `ellipsis-vertical`; kolumny priorytetowe zawsze widoczne: Zlecenie, Klient, Status, „Czekamy na”, Termin, Płatność. Sortowanie z `aria-sort`.
- **Web / mobile:** < `breakpoint.medium` tabela → lista kart (§ 3.8) z tymi samymi danymi priorytetowymi; wiersz listy mobile min. `size.touch-target.min`.

### 3.7 Filtry (FilterBar, FilterChip, SearchField)
- **Warianty:** pasek filtrów (web, nad tabelą, `color.bg.surface-subtle`), chip filtra (`radius.pill`, wybrany: `color.bg.selected` + `color.border.selected` + ikona `check`), panel „Więcej filtrów”, arkusz filtrów (mobile), zapisane widoki („Czekamy na OSD > 14 dni”).
- **Stany:** chip — domyślny obrys `color.border.strong`; hover `color.bg.surface-hover`; fokus pierścień; aktywny (wybrany) jak wyżej; wyłączony `color.text.disabled`; ładowanie wyników — szkielet tabeli, filtry pozostają aktywne.
- **Tokeny:** wysokość chipa `size.control.height.web.sm` (web) / `size.touch-target.min` (mobile), `space.inline.sm`, `text.label`.
- **Zasady:** aktywne filtry zawsze widoczne jako chipy z `x` + „Wyczyść filtry”; licznik wyników („24 zlecenia”); filtry w adresie URL (web — możliwość udostępnienia linku); bez przycisku „Zastosuj” na web (natychmiast), z przyciskiem „Pokaż wyniki (24)” w arkuszu mobile.

### 3.8 Karta (Card)
- **Warianty:** karta informacyjna (sekcja szczegółów), karta zlecenia na liście (klikalna), karta podsumowania (status, „Czekamy na”, termin, płatność).
- **Stany:** domyślny `color.bg.surface`, obrys `color.border.default`, `radius.card`; hover (klikalna) `elevation.card`; fokus pierścień; wciśnięty `color.bg.surface-pressed`; wybrana `color.border.selected`; błąd — alert w karcie; ładowanie — szkielet o kształcie karty.
- **Tokeny:** padding `space.inset.md` (mobile) / `space.inset.lg` (web), odstęp między kartami `space.stack.sm` (mobile) / `space.stack.md` (web), tytuł `text.heading-3`.
- **Zasady:** karta zlecenia ma: nr i nazwę, klienta, adres (mobile — `text.body-lg`), odznakę statusu, „Czekamy na: [strona] od [n] dni”, najbliższy termin. Jedna główna akcja na karcie (cała karta), dodatkowe w menu.

### 3.9 Odznaka statusu (StatusBadge)
- **Warianty:** subtelna (ton `*.bg` 100 + `*.text` 900), mocna (Rozliczone, Po terminie — tło 800 + biały tekst), kompaktowa (tylko ikona — **wyłącznie** gdy etykieta jest obok w tej samej komórce lub w nazwie dostępnej, np. oś czasu).
- **Anatomia:** ikona `size.icon.sm` (`color.status.*.icon`) + etykieta `text.label` (`color.status.*.text`) na `color.status.*.bg`; `radius.pill`; wysokość `size.badge.height`; padding `space.inset.xs`/`space.inset.sm`; odstęp `space.inline.xs`.
- **Stany:** statyczna (nieinteraktywna) — bez hover/fokus; jako przycisk zmiany statusu — dodatkowo `chevron-down`, fokus pierścień, wyłączony bez `chevron-down` z podpowiedzią dlaczego.
- **Zasady:** mapowanie wartości → § 4.4 (jedyne dozwolone); etykieta nigdy nie jest skracana; nie tworzymy nowych kolorów statusów w kodzie.

### 3.10 Oś czasu (Timeline, TimelineEntry)
- **Warianty wpisu:** zmiana statusu (znacznik = ikona statusu), wpis/notatka (`pencil`), komentarz (`message-square-text`), dodane media (miniatury), dokument, płatność, wpis systemowy.
- **Anatomia:** znacznik `size.timeline-marker` na linii `color.border.default` (`border-width.strong`); nagłówek: autor (`text.label`) + czas (`text.caption` web / `text.body-sm` mobile, `color.text.secondary`, format § 6.3); treść `text.body`; odstęp między wpisami `space.stack.md`.
- **Stany:** domyślny; hover (web) akcje wpisu; fokus wpisu pierścień; wpis lokalny niezsynchronizowany — ikona `clock` + „Czeka na wysłanie” (`color.sync.queued.*`); błąd — `cloud-alert` + „Ponów”; ładowanie starszych — szkielet 3 wpisów; pusty — „Brak wpisów. Dodaj pierwszą notatkę.”
- **Zasady:** od najnowszych; grupowanie po dniach („Dziś”, „Wczoraj”, `02.10.2026`); filtr typów wpisów.

### 3.11 Miniatura / galeria (Thumbnail, Gallery, Lightbox)
- **Warianty:** miniatura w kolejce (`size.thumbnail.sm`), kafel galerii (`size.thumbnail.md` min., siatka: 3 kolumny compact, auto-fill web do `size.thumbnail.lg`), podgląd pełnoekranowy (lightbox), dokument (ikona typu pliku + nazwa).
- **Stany:** domyślny `radius.thumbnail`; hover (web) nakładka z akcjami; fokus pierścień; zaznaczony (wybór wielu) obrys `color.border.selected` `border-width.indicator` + `check`; ładowanie — `color.bg.skeleton`; błąd wczytania — ikona `image` + „Nie można wyświetlić”; lokalny/niewysłany — znacznik stanu uploadu w rogu (§ 5.4).
- **Tokeny:** `space.inline.xs` między kaflami, metadane `text.body-sm`.
- **Zasady:** każde zdjęcie ma tekst alternatywny z metadanych (kategoria, etap, data); lightbox: przyciski poprzednie/następne (nie tylko gest), zoom przyciskami, Esc zamyka.

### 3.12 Uploader i element kolejki uploadu (Uploader, UploadQueueItem)
- **Warianty:** web — strefa upuszczania + „Wybierz pliki”; mobile — przycisk aparatu (`size.touch-target.shutter` na ekranie aparatu, `size.touch-target.field` w widoku zlecenia) + „Z galerii”; element kolejki (miniatura `size.thumbnail.sm`, nazwa/kategoria, stan, akcja).
- **Stany elementu (tokeny `color.sync.*`, § 5.4):** W kolejce · Wysyłanie n % (pasek `size.progress-bar.height`, `color.sync.progress.fill` na `color.sync.progress.track`) · Wysłano · Błąd + „Ponów” · Czeka na Wi-Fi + „Wyślij teraz przez sieć komórkową” (obowiązkowy, gdy włączono „Wysyłaj tylko przez Wi-Fi”). Strefa upuszczania: hover/przeciąganie `color.bg.selected` + obrys `color.border.selected` przerywany; fokus pierścień; wyłączony (brak uprawnień) z wyjaśnieniem; błąd typu/rozmiaru — komunikat przy pliku.
- **Zasady:** plik nigdy nie znika z kolejki bez potwierdzenia serwera; „Ponów” i „Usuń z kolejki” jako widoczne przyciski (nie gest); postęp liczbowo i paskiem; zbiorczo: „Wysłano 12 z 15 · 3 w kolejce”.
- **Web / mobile:** web — przeciąganie jest dodatkiem, zawsze jest przycisk „Wybierz pliki” (WCAG 2.5.7).

### 3.13 Dialog (Dialog, AlertDialog, BottomSheet)
- **Warianty:** dialog formularza (`size.dialog.width.md`), dialog potwierdzenia (`size.dialog.width.sm`), duży (`size.dialog.width.lg`), arkusz dolny (mobile, `radius.sheet`), pełnoekranowy (mobile, długie formularze).
- **Anatomia:** tytuł `text.heading-3`, treść `text.body`, stopka z akcjami; `color.bg.surface`, `radius.dialog`, `elevation.dialog`, `layer.dialog`, scrim `color.bg.scrim` (`layer.overlay`); padding `space.inset.lg` (web) / `space.inset.md` (mobile).
- **Stany:** otwieranie `motion.transition.enter`, zamykanie `motion.transition.exit`, arkusz `motion.transition.sheet`; przycisk główny w stanie ładowania podczas zapisu; błąd zapisu — alert w dialogu, dane formularza zostają.
- **Zasady:** fokus przechodzi do dialogu i wraca do elementu wywołującego; Esc / przycisk `x` zamyka (jeśli są niezapisane zmiany — pytanie „Odrzucić zmiany?”); bez dialogu na dialogu. Potwierdzenia tylko dla operacji nieodwracalnych (§ 4.11).

### 3.14 Toast (Toast, Snackbar)
- **Warianty:** informacja / sukces (`color.bg.inverse`, `color.text.inverse`, ikona `color.icon.inverse`), z akcją („Cofnij”, „Ponów”), błąd — **nie** jako toast znikający: błędy blokujące → alert w miejscu (§ 4.9).
- **Tokeny:** `size.toast.max-width`, `radius.control`, `elevation.toast`, `layer.toast`, `motion.transition.enter`; pozycja: web — dół, środek/lewo; mobile — nad dolną nawigacją.
- **Stany:** czas wyświetlania min. 6 s, z akcją 10 s; zatrzymuje się po najechaniu/fokusie; zamknięcie `x`; ogłaszany przez `role="status"` / `aria-live="polite"`.
- **Zasady:** jeden naraz (kolejka); treść ≤ 2 linie („Usunięto zdjęcie. [Cofnij]”).

### 3.15 Pusty stan (EmptyState)
- **Warianty:** pierwszy raz (brak danych — zachęta do akcji), brak wyników filtrów, brak uprawnień (§ 4.13), offline bez danych w pamięci.
- **Anatomia:** ikona `size.icon.2xl` `color.icon.secondary`, tytuł `text.heading-3`, opis `text.body` `color.text.secondary`, akcja (primary lub tertiary); odstępy `space.stack.md`, wokół `space.stack.2xl`.
- **Zasady:** zawsze mówi, dlaczego jest pusto i co zrobić („Brak zleceń spełniających filtry. [Wyczyść filtry]”).

### 3.16 Szkielet ładowania (Skeleton)
- **Warianty:** tekst (linie), wiersz tabeli, karta, miniatura, oś czasu.
- **Tokeny:** `color.bg.skeleton`, refleks `color.bg.skeleton-highlight`, `motion.duration.skeleton`, `motion.easing.linear`, promienie jak docelowy element.
- **Zasady:** kształt odpowiada treści (bez skoku układu); spinner tylko w przycisku i przy odświeżaniu pociągnięciem (mobile); po 10 s bez danych — komunikat „Ładowanie trwa dłużej niż zwykle…” z opcją „Spróbuj ponownie”; `aria-busy="true"` na kontenerze.

### 3.17 Nawigacja web (Sidebar, TopBar, Breadcrumbs, Tabs)
- **Anatomia:** boczny pasek `color.bg.brand-strong`, szerokość `size.sidebar.width.expanded` (≥ `breakpoint.expanded`) / `size.sidebar.width.collapsed` (`breakpoint.medium`); pozycje: ikona `size.icon.md` + etykieta `text.label-lg` `color.text.on-brand`; aktywna — `color.brand.accent` pasek `border-width.indicator` + pogrubienie; logo na górze. Górny pasek `size.app-bar.height.web` `color.bg.surface` z wyszukiwaniem i kontem; okruszki `text.body-sm`; zakładki — aktywna `border-width.indicator` `color.border.selected`.
- **Stany:** hover pozycji — tło `color.bg.brand` (biały tekst 4,96:1); fokus `color.focus.ring-inverse`; aktywna jak wyżej; wyłączona nd. (pozycji bez uprawnień nie pokazujemy).
- **Zasady:** ≤ 7 pozycji głównych (np. Zlecenia, Klienci, Kalendarz, Płatności, Raporty, Ustawienia); link „Przejdź do treści” jako pierwszy element fokusowalny; zwinięty pasek pokazuje podpowiedzi z nazwą.

### 3.18 Nawigacja mobile (BottomNav, AppBar)
- **Anatomia — dolna nawigacja:** tło `color.bg.surface`, wysokość `size.bottom-nav.height`, `elevation.bottom-bar`; 3–5 pozycji (np. Moje zlecenia, Aparat/Dodaj, Kolejka, Więcej), ikona `size.icon.lg` + etykieta zawsze widoczna (`text.label`).
  - **Pozycja nieaktywna:** ikona `color.nav.icon` (6,69:1), etykieta `color.nav.label` (10,37:1), `font.weight.medium`.
  - **Pozycja aktywna:** kapsuła za ikoną `size.bottom-nav.indicator.width` × `size.bottom-nav.indicator.height`, `radius.pill`, wypełnienie `color.nav.indicator` (6,74:1 do `color.bg.surface` — WCAG 1.4.11); ikona `color.nav.on-indicator` (6,74:1 do kapsuły), wariant wypełniony ikony, jeśli Lucide go ma; etykieta `color.nav.label-active` + `font.weight.semibold`. Stan aktywny niesie więc kształt (kapsuła), kolor ≥ 3:1 i grubość pisma, a nie tylko odcień tła (§ 5.3). Czytnik ekranu: `aria-current="page"` / `selected` (platformowo). Wzorzec zgodny z Material 3 Navigation Bar; na iOS wygląd kapsuły jest ten sam (spójność między platformami ważniejsza niż natywny tint HIG).
  - `color.bg.selected` **nie** jest używany jako wskaźnik aktywnej pozycji dolnej nawigacji (1,07:1 do `bg.surface`).
- **Anatomia — górny pasek (AppBar):** `size.app-bar.height.mobile`, tło `color.bg.brand-strong`, tytuł `text.heading-3` `color.text.on-brand` (8,98:1), wstecz `arrow-left` `color.icon.inverse` (8,98:1), **wskaźnik synchronizacji** po prawej — zawsze jako kapsuła z własnym tłem (§ 5.4), nigdy sama ikona `color.sync.*.icon` bezpośrednio na pasku (1,3–1,8:1).
- **Stany:** fokus (klawiatura/czytnik) — w dolnej nawigacji `color.focus.ring` (5,17:1 do `bg.surface`), **w górnym pasku `color.focus.ring-inverse`** (8,98:1 do `bg.brand-strong`; `color.focus.ring` daje tam tylko 1,74:1 — zakazane); wciśnięty — dolna nawigacja `color.bg.surface-pressed` (kapsuła aktywna zachowuje 5,35:1), górny pasek `color.bg.brand` pod przyciskiem; licznik (np. 3 w kolejce) jako odznaka z liczbą, nie sama kropka.
- **Zasady:** cel dotyku każdej pozycji ≥ `size.touch-target.min`; akcje główne w strefie kciuka (§ 5.2); systemowy gest wstecz działa zawsze.

### 3.19 Komponenty pomocnicze
- **Alert (InlineAlert / Banner):** `color.feedback.{ton}.*`, ikona tonu, tytuł `text.label-lg`, treść `text.body` `color.text.primary`, akcja; obrys lewy `border-width.indicator` `color.feedback.{ton}.border`; `role="alert"` tylko dla błędów.
- **Pasek postępu (ProgressBar):** `size.progress-bar.height`, `color.sync.progress.*`, `radius.pill`, wartość tekstowa obok.
- **Wskaźnik synchronizacji (SyncIndicator):** § 5.4.

---

## 4. Wzorce

### 4.1 Formularze
- Jedna kolumna (`size.form.max-width`); grupy pól z nagłówkiem `text.heading-4`, odstęp grup `space.stack.lg`.
- **Autozapis szkicu** co kilka sekund i przy opuszczeniu ekranu: dyskretna informacja „Szkic zapisany 14:05” (`text.body-sm`, `color.text.secondary`). Powrót do formularza przywraca szkic.
- Przycisk główny „Zapisz …” na dole (mobile — przyklejony dolny pasek `elevation.bottom-bar`); nie blokujemy przycisku przy błędach — po kliknięciu pokazujemy podsumowanie błędów na górze (lista linków do pól) i ustawiamy fokus na podsumowaniu.
- Minimum pisania w terenie: wybór zamiast wpisywania (chipy, listy), wartości domyślne, dyktowanie systemowe w polach notatek.

### 4.2 Tabele i listy
- Kolumny priorytetowe i zachowanie responsywne: § 3.6. Sortowanie domyślne: najpilniejsze (po terminie, potem termin rosnąco).
- Wiersz „po terminie”: odznaka `color.status.payment.overdue` / tekst terminu `color.text.error` + ikona `alarm-clock` (nie samo zaczerwienienie).
- Liczby i kwoty `text.numeric` do prawej; daty `text.numeric`.
- Długie listy: paginacja (web) lub „Pokaż więcej” / doczytywanie (mobile) z zachowaniem pozycji przy powrocie.

### 4.3 Filtry
§ 3.7. Zapisane widoki odpowiadają na pytania biura: „Czekamy na OSD”, „Po terminie”, „Nieopłacone”, „Moje na dziś”. Filtry i sortowanie zapamiętane per użytkownik.

### 4.4 Statusy (AC5)
Każda wartość = **unikalna ikona (w obrębie grupy) + etykieta PL + rola koloru**. Tokeny: `color.status.{grupa}.{wartość}.{bg|text|icon|border}`; etykieta i ikona także w `$extensions.pl.eviacharge.status` tokenu. Komponent: § 3.9.

**Status zlecenia** (`color.status.order.*`)

| Wartość (kod) | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|
| `new` | Nowe | `inbox` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `quote` | Wycena | `calculator` | fioletowy | `palette.violet.100` / `violet.900` / `violet.700` |
| `accepted` | Zaakceptowane | `thumbs-up` | niebieski | `palette.blue.100` / `blue.900` / `blue.700` |
| `in-progress` | W realizacji | `wrench` | morski (marka) | `palette.teal.100` / `teal.900` / `teal.700` |
| `completed` | Zakończone | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `settled` | Rozliczone | `banknote` | zielony mocny | `palette.green.800` / `neutral.0` / `neutral.0` |
| `on-hold` | Wstrzymane | `circle-pause` | bursztynowy | `palette.amber.100` / `amber.900` / `amber.700` |
| `cancelled` | Anulowane | `ban` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |

**Status etapu** (`color.status.stage.*`)

| Wartość (kod) | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|
| `todo` | Do zrobienia | `circle` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `in-progress` | W toku | `circle-play` | morski | `palette.teal.100` / `teal.900` / `teal.700` |
| `waiting` | Czekamy na stronę trzecią | `hourglass` | bursztynowy | `palette.amber.100` / `amber.900` / `amber.700` |
| `done` | Zakończony | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `not-applicable` | Nie dotyczy | `circle-minus` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `blocked` | Zablokowany | `octagon-alert` | czerwony | `palette.red.100` / `red.900` / `red.700` |

Etap „Czekamy na stronę trzecią” w widokach szczegółów rozwija się do „Czekamy na: [strona, np. OSD] · od 15 dni” (licznik dni `text.numeric`; > 14 dni — ikona `triangle-alert` `color.icon.warning` i tekst `color.text.warning`).

**Status etapu płatności** (`color.status.payment.*`)

| Wartość (kod) | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|
| `planned` | Planowana | `calendar-clock` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `issued` | Wystawiona | `file-text` | niebieski | `palette.blue.100` / `blue.900` / `blue.700` |
| `paid` | Opłacona | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `overdue` | Po terminie | `alarm-clock` | czerwony mocny | `palette.red.800` / `neutral.0` / `neutral.0` |

Ikony są unikalne w obrębie każdej grupy; `circle-check` celowo oznacza „zakończone/opłacone” we wszystkich grupach (spójne znaczenie). Kontrasty wszystkich par: § 2.1.4 (tekst odznak ≥ 7,13:1, ikony ≥ 4,51:1).

**Weryfikacja rozróżnialności bez koloru (2026-10-02):** odznaki wszystkich 18 wartości wyrenderowano z ikonami Lucide 1.50.0 i sprawdzono w skali szarości oraz w symulacji deuteranopii i protanopii (macierze Machado i in. 2009, nasilenie 1,0). Wynik: każda wartość pozostaje rozróżnialna dzięki unikalnemu kształtowi ikony i etykiecie; tony zlewające się w symulacji (zielony ↔ bursztynowy, fioletowy ↔ niebieski, czerwony subtelny ↔ neutralny przy protanopii) nie niosą samodzielnie informacji. Etykiety pozostają czytelne w skali szarości (kontrast luminancji tekstu ≥ 7:1 nie zależy od barwy). Wariant mocny (Rozliczone, Po terminie) wyróżnia się jasnością tła także w skali szarości. Zrzut z weryfikacji: lokalnie (poza repozytorium); powtórzyć w przeglądzie UX pierwszej implementacji odznaki.

### 4.5 Oś czasu
§ 3.10. Zmiana statusu w dzienniku: „Anna Nowak zmieniła status etapu „Uzgodnienia z OSD” na [Czekamy na stronę trzecią]” (odznaka kompaktowa + etykieta).

### 4.6 Galeria
§ 3.11. Grupowanie po kategorii/etapie, filtr „Niewysłane”; przy zleceniu licznik „48 zdjęć · 3 niewysłane”.

### 4.7 Kolejka uploadu
§ 3.12 i § 5.4. Ekran „Kolejka” (mobile): sekcje „Błąd” (na górze, z „Ponów wszystkie”), „Wysyłanie”, „W kolejce”, „Wysłane dziś”. Web: panel postępu przy zleceniu.

### 4.8 Puste stany
§ 3.15. Przykłady: „Nie masz jeszcze zleceń. [Dodaj zlecenie]” · „Brak zleceń spełniających filtry. [Wyczyść filtry]” · „To zlecenie nie ma jeszcze zdjęć. [Zrób zdjęcie]”.

### 4.9 Błędy
- **Walidacja pola:** komunikat pod polem (§ 3.2) + podsumowanie przy zapisie.
- **Błąd operacji w miejscu:** alert `color.feedback.error.*` w sekcji, której dotyczy, z akcją wyjścia („Spróbuj ponownie”, „Przejdź do …”).
- **Błąd ekranu (nie wczytano danych):** pusty stan z ikoną `circle-alert`, opisem i „Spróbuj ponownie”; jeśli są dane z pamięci — pokazujemy je z banerem „Dane mogą być nieaktualne (z 14:05)”.
- **Konflikt edycji:** „Ktoś zmienił to zlecenie w międzyczasie. Twoje zmiany zachowaliśmy — porównaj i zapisz ponownie.”
- Treść komunikatów: § 6.4. Nigdy nie tracimy danych wpisanych przez użytkownika z powodu błędu.

### 4.10 Offline
§ 5.4. Web: baner „Brak połączenia — zmiany zapiszemy, gdy połączenie wróci” tylko jeśli operacja wymaga sieci; formularze nie są czyszczone.

### 4.11 Potwierdzenia i „Cofnij”
| Operacja | Wzorzec |
|---|---|
| Odwracalna (archiwizacja, zmiana statusu, każde usunięcie, które system potrafi przywrócić) | wykonaj od razu + toast „… [Cofnij]” (10 s) |
| Nieodwracalna (trwałe usunięcie zlecenia, usunięcie niewysłanego zdjęcia z urządzenia, anulowanie zlecenia z powiadomieniem klienta, wylogowanie z niewysłanymi danymi) | dialog potwierdzenia: tytuł-pytanie z nazwą obiektu („Usunąć 3 niewysłane zdjęcia?”), skutek („Zdjęcia nie zostały wysłane i znikną z telefonu.”), przyciski „Usuń zdjęcia” (danger) i „Anuluj” (tertiary); fokus domyślnie na „Anuluj” |

Usunięcie **niewysłanego** pliku z urządzenia jest zawsze nieodwracalne → zawsze dialog.

### 4.12 Szkielety ładowania
§ 3.16. Szkielet od pierwszej klatki dla list, kart i szczegółów; częściowe dane pokazujemy od razu (najpierw nagłówek zlecenia, potem sekcje).

### 4.13 Brak uprawnień
- Elementów, do których użytkownik nie ma dostępu, nie pokazujemy w nawigacji.
- Wejście z linku na zasób bez uprawnień: pusty stan z ikoną `lock`, „Nie masz dostępu do tego zlecenia. Poproś administratora o uprawnienia.” + „Wróć do listy”. Nie ujawniamy danych zasobu (np. nazwy klienta).
- Akcja niedozwolona w widocznym kontekście: przycisk wyłączony z podpowiedzią „Edycję płatności może wykonać tylko administrator.”

---

## 5. Teren (mobile)

### 5.1 Cele dotyku i rękawice
- **Każdy element interaktywny ≥ 48×48 dp** (`size.touch-target.min`), nawet jeśli ikona jest mniejsza (obszar dotyku rozszerzony). Akcje główne `size.touch-target.field` (56 dp), spust aparatu `size.touch-target.shutter` (72 dp).
- Odstęp między celami ≥ `space.inline.sm` (8 dp); akcje niszczące nie sąsiadują z częstymi (osobna sekcja lub menu).
- **Rękawice:** żadnych gestów precyzyjnych jako jedynej drogi — każde przesunięcie, długie przytrzymanie, przeciągnięcie i szczypanie ma alternatywę w postaci przycisku (np. „Usuń”, „Powiększ +/−”, „Następne”). Brak akcji wymagających podwójnego tapnięcia.
- Pola wyboru zamiast klawiatury; duże przełączniki i chipy; dyktowanie w notatkach.

### 5.2 Obsługa jedną ręką (strefa kciuka)
```
┌───────────────────────────┐
│  trudno: tytuł, wstecz,   │  ← tylko informacja i rzadkie akcje
│  wskaźnik synchronizacji  │
├───────────────────────────┤
│  OK: treść, karty, lista  │  ← przewijanie, wybór elementu
│                           │
├───────────────────────────┤
│  ŁATWO: akcje główne      │  ← [Zrób zdjęcie] [Zapisz]  dolny pasek
│  dolna nawigacja          │     `size.touch-target.field`
└───────────────────────────┘
```
- Akcja główna ekranu w dolnym pasku (pełna szerokość lub prawa strona dla praworęcznych — z ustawieniem „Leworęczny” odwracającym kolejność).
- Menu i wybory jako arkusze dolne (`radius.sheet`), nie menu u góry ekranu.
- Ekran aparatu: spust na dole na środku, przełącznik kategorii zdjęcia nad spustem (chipy), „Gotowe” w prawym dolnym rogu; licznik zdjęć w serii.

### 5.3 Kontrast w pełnym słońcu i słabym świetle
- Tekst podstawowy i drugorzędny **≥ 7:1 (AAA)** na wszystkich jasnych tłach (`color.text.primary`, `color.text.secondary` — § 2.1.4); tekst `color.text.tertiary` tylko dla podpowiedzi, nigdy dla danych.
- Tryb „słońce” realizowany przez role semantyczne (bez osobnego motywu): ciemny tekst na białym/jasnoszarym tle, akcje `color.action.primary.bg` (6,74:1 z białym tekstem), statusy ≥ 7:1 (tekst odznak).
- Nie przekazujemy informacji subtelnymi różnicami odcieni (np. jasnoszare tło sekcji) — zawsze także obrys, ikona lub etykieta.
- Waga pisma min. `font.weight.regular`; tekst danych w terenie min. `text.body`, adres i instrukcje `text.body-lg`.
- Słabe światło (garaż): brak bardzo jasnych pełnoekranowych błysków poza aparatem; aparat obsługuje latarkę (przycisk `flashlight` w zasięgu kciuka).

### 5.4 Wskaźniki offline, synchronizacji i uploadu
**Wskaźnik globalny** (górny pasek, zawsze widoczny; dotknięcie → ekran „Kolejka”):

- **Forma — kapsuła (SyncIndicator):** tło `color.sync.{stan}.bg`, ikona `color.sync.{stan}.icon` `size.icon.md`, tekst `text.label` `color.sync.{stan}.text`, `radius.pill`, padding `space.inset.xs` × `space.inset.sm`; cel dotyku ≥ `size.touch-target.min` (obszar dotyku większy niż kapsuła). Ikona i tekst **zawsze na tle kapsuły**, nigdy bezpośrednio na `color.bg.brand-strong`.
- **Offline:** kapsuła `color.sync.offline.bg` ma do `bg.brand-strong` tylko 1,58:1, dlatego dostaje obrys `color.border.inverse` `border-width.strong` (8,98:1 do paska). Pozostałe kapsuły odcinają się od paska bez obrysu (7,35–8,24:1).
- **Fokus:** `color.focus.ring-inverse` (§ 3.18).
- **Priorytet przy kilku stanach naraz:** Błąd > Offline > Czeka na Wi-Fi > Wysyłanie > Zsynchronizowano; liczniki pozostałych stanów pokazuje ekran „Kolejka”.
- Na wąskich ekranach (< 360 dp lub długi tytuł) kapsuła skraca tekst do liczby („5”, „2 Wi-Fi”), ale nigdy do samej ikony; pełny tekst w etykiecie dostępności.

| Stan | Ikona | Tekst (mikrocopy) | Tokeny |
|---|---|---|---|
| Online, wszystko wysłane | `cloud-check` | „Zsynchronizowano 14:05” | `color.sync.done.*` |
| Online, wysyłanie | `cloud-upload` | „Wysyłanie 3 z 12…” | `color.sync.in-progress.*` |
| Czeka na Wi-Fi (sieć komórkowa, włączone „Wysyłaj tylko przez Wi-Fi”) | `wifi` | „2 filmy czekają na Wi-Fi” (polska odmiana liczebnika: „1 film czeka”, „2 filmy czekają”, „5 filmów czeka”, „22 filmy czekają”; dotyczy tylko filmów — zdjęcia idą przez sieć komórkową) | `color.sync.waiting-wifi.*` |
| Offline | `wifi-off` | „Offline · 5 w kolejce” — dodatkowo baner pod paskiem: „Brak zasięgu. Pracuj dalej — wyślemy wszystko, gdy wróci połączenie.” | `color.sync.offline.*` + obrys `color.border.inverse` |
| Błąd wysyłania | `cloud-alert` | „Nie wysłano 2 · Ponów” | `color.sync.error.*` |

**Stan każdego pliku / wpisu** (miniatura w galerii, element kolejki, wpis osi czasu):

| Stan | Ikona | Etykieta | Tokeny | Akcja |
|---|---|---|---|---|
| W kolejce | `clock` | „W kolejce” | `color.sync.queued.*` | „Usuń z kolejki” (z potwierdzeniem) |
| Wysyłanie | `cloud-upload` | „Wysyłanie 45%” + pasek | `color.sync.in-progress.*`, `color.sync.progress.fill` | „Wstrzymaj” (opcjonalnie) |
| Wysłano | `cloud-check` | „Wysłano” | `color.sync.done.*`, `color.sync.progress.fill-done` | — |
| Błąd | `cloud-alert` | „Nie wysłano — [powód]” | `color.sync.error.*`, `color.sync.progress.fill-error` | „Ponów” (przycisk `size.touch-target.min`) |
| Czeka na Wi-Fi | `wifi` | „Czeka na Wi-Fi” | `color.sync.waiting-wifi.*` | „Wyślij teraz przez sieć komórkową” (jednorazowo dla tego pliku; ustawienie „Wysyłaj tylko przez Wi-Fi” się nie zmienia; obok akcji pokazujemy rozmiar pliku, np. „180 MB”, żeby technik ocenił koszt transferu) |
| Offline | `wifi-off` | „Czeka na połączenie” | `color.sync.offline.*` | — |

„Czeka na Wi-Fi” różni się od „Offline” ikoną (`wifi` vs przekreślone `wifi-off`), kolorem (amber vs ciemny neutralny) i tekstem — technik z zasięgiem komórkowym widzi, że wysyłka nie utknęła, tylko czeka na jego ustawienie, i może ją wymusić. Stan występuje tylko przy włączonym przełączniku „Wysyłaj tylko przez Wi-Fi” (§ 3.4).

Zasady „nic nie ginie”:
- Zapis lokalny jest natychmiastowy i potwierdzony („Zapisano w telefonie”); wysyłka w tle wznawia się automatycznie (szczegóły techniczne: EVM-011).
- Plik usuwamy z urządzenia dopiero po potwierdzeniu serwera; usunięcie ręczne niewysłanego pliku = dialog (§ 4.11).
- Wylogowanie / zmiana konta przy niewysłanych danych: blokujący dialog z liczbą elementów i opcją „Wyślij teraz”.
- Status tekstowy zawsze obok ikony; zmiany stanu ogłaszane czytnikowi ekranu (`aria-live="polite"` / ogłoszenia dostępności platformy) bez spamowania (zbiorczo co kilka sekund).

---

## 6. Treści

### 6.1 Ton
- Prosty, konkretny, uprzejmy, rzeczowy. Zwracamy się na „ty” („Dodaj zdjęcie”, „Twoje zmiany zapisaliśmy”); system mówi „my” („Wyślemy, gdy wróci zasięg”).
- Przyciski: czasownik w trybie rozkazującym + obiekt („Zapisz zlecenie”, „Dodaj etap”, „Ponów wysyłanie”); bez „OK”, „Tak/Nie” w dialogach.
- Bez żargonu technicznego (nie „sync”, „upload”, „request failed”, „null”) — „wysyłanie”, „synchronizacja”, „nie udało się”.
- Bez wykrzykników, bez obwiniania („Podaj numer telefonu”, nie „Błędny numer!”); bez humoru w komunikatach błędów.
- Wielka litera tylko na początku zdania i w nazwach własnych.

### 6.2 Terminologia (słownik: `docs/product/domain.md`)
| Termin w UI | Używamy | Nie używamy |
|---|---|---|
| Zlecenie | jednostka pracy dla klienta w lokalizacji („Nowe zlecenie”, „Zlecenia”) | zamówienie, job, projekt, sprawa |
| Klient | osoba lub firma zamawiająca | kontrahent (to „Strona”), customer |
| Lokalizacja | miejsce realizacji (adres, typ obiektu, miejsce postojowe) | adres (jako nazwa obiektu), site |
| Typ obiektu | dom jednorodzinny, garaż w budynku wielorodzinnym, obiekt komercyjny | kategoria |
| Szablon zlecenia | gotowy zestaw zakresu i procesów | typ zlecenia |
| Katalog usług / pozycja zakresu | klocek usługi / jego wystąpienie w zleceniu | produkt, item |
| Proces | ścieżka z etapami („Uzgodnienia z OSD”) | workflow, procedura |
| Etap | krok procesu | krok, faza, task |
| Status etapu | Do zrobienia, W toku, Czekamy na stronę trzecią, Zakończony, Nie dotyczy, Zablokowany | — |
| Etap płatności | transza do zapłaty (Planowana, Wystawiona, Opłacona, Po terminie) | rata, faktura (faktura to dokument w etapie) |
| Dziennik | chronologiczna historia zlecenia | historia, log, aktywność |
| Wpis / komentarz | notatka z rozmowy, ustalenie / komentarz użytkownika | post, wiadomość |
| Media / zdjęcie / film | pliki z aparatu z metadanymi | załącznik (dla zdjęć) |
| Dokument | projekt, ekspertyza, zgoda, warunki przyłączenia, protokół (z wersjami) | plik (ogólnie), załącznik |
| Strona | administracja, zarządca, wspólnota, projektant, rzeczoznawca ppoż., OSD, podwykonawca | kontrahent, party |
| OSD | Operator Systemu Dystrybucyjnego; w danych konkretna nazwa (np. Stoen Operator) | „Stoen” jako nazwa ogólna w UI |
| Moc przyłączeniowa | z jednostką „kW” | moc umowna (w etykietach) |
| PPE | punkt poboru energii (rozwinięcie w podpowiedzi) | — |
| WLZ | wewnętrzna linia zasilająca (rozwinięcie w podpowiedzi) | — |
| Obwód dedykowany | osobny obwód zasilający ładowarkę | — |
| Ładowarka | urządzenie ładujące; „wallbox” dopuszczalne w opisach | stacja (dla wallboxów AC) |
| Ekspertyza, opinia ppoż., warunki przyłączenia, pełnomocnictwo | rodzaje dokumentów | — |
| Wysyłanie / kolejka / offline | stany przesyłania plików i danych | upload, sync, queue |

Skróty (OSD, PPE, WLZ, ppoż.) przy pierwszym wystąpieniu na ekranie mają rozwinięcie w podpowiedzi lub `abbr`.

### 6.3 Formaty
| Co | Format | Przykład | Uwagi |
|---|---|---|---|
| Data | `DD.MM.RRRR` | `02.10.2026` | zawsze z zerami wiodącymi; `text.numeric` w tabelach |
| Data i godzina | `DD.MM.RRRR, GG:MM` | `02.10.2026, 14:05` | zegar 24 h; strefa `Europe/Warsaw`, zapis w UTC |
| Daty względne | „dziś, 14:05”, „wczoraj, 9:30”, „3 dni temu” | — | tylko w dzienniku i listach; pełna data w podpowiedzi / nazwie dostępnej |
| Czas trwania / oczekiwania | „od 15 dni”, „2 godz. 30 min” | — | — |
| Kwota | `12 345,67 zł` | `1 234,00 zł` | separator tysięcy = spacja niełamliwa (U+00A0), przecinek dziesiętny, spacja niełamliwa przed „zł”; grupujemy także liczby 4-cyfrowe (wyrównanie w tabelach); zawsze 2 miejsca po przecinku; ujemne `−1 234,00 zł` |
| Liczby | `1 234,5` | `22 kW`, `3,7 kW` | spacja niełamliwa przed jednostką |
| Procent | `45%` | — | bez spacji (konwencja UI) |
| Telefon | `+48 600 123 456` (międzynarodowy) / `600 123 456` (krajowy) | stacjonarny `22 123 45 67` | pole przyjmuje dowolne spacje/myślniki, zapis w formacie E.164 (`+48600123456`); link `tel:` na mobile |
| Kod pocztowy | `00-001` | — | — |
| Adres | „ul. Przykładowa 1/2, 00-001 Warszawa” | — | miejsce postojowe: „miejsce nr 15, poziom −1” |
| Liczebniki | 1 zdjęcie · 2–4 zdjęcia · 5+ zdjęć · 22 zdjęcia | 1 zlecenie · 3 zlecenia · 5 zleceń | reguły odmiany `Intl.PluralRules('pl')` (one / few / many) — nigdy „zdjęć(cia)” |

Wszystkie przykłady w dokumentacji, makietach i testach są **syntetyczne** (fikcyjne nazwiska, adresy, numery).

### 6.4 Komunikaty błędów — „co się stało + co zrobić”
Wzorzec: **[Co się stało — prostymi słowami]. [Dlaczego — jeśli pomaga]. [Co zrobić / co zrobimy] + [przycisk wyjścia].** Bez kodów technicznych w treści (kod pomocniczy na końcu tylko dla zgłoszeń: „Kod: 7F3A”); bez danych osobowych.

| Sytuacja | Komunikat |
|---|---|
| Pole wymagane | „Podaj adres lokalizacji.” |
| Zły format | „Podaj numer telefonu, np. 600 123 456.” |
| Niespójne dane | „Termin nie może być wcześniejszy niż data rozpoczęcia (02.10.2026).” |
| Brak zasięgu przy wysyłaniu | „Nie wysłano 3 zdjęć — brak połączenia. Zdjęcia są bezpieczne w telefonie i wyślemy je automatycznie. [Wyślij teraz]” |
| Plik za duży / zły typ | „Plik „projekt.dwg” ma nieobsługiwany format. Dodaj plik PDF, JPG lub PNG.” |
| Brak uprawnień | „Nie możesz edytować płatności. Poproś administratora o uprawnienia.” |
| Konflikt edycji | „Ktoś zmienił to zlecenie w międzyczasie. Twoje zmiany zachowaliśmy — porównaj i zapisz ponownie. [Porównaj]” |
| Sesja wygasła | „Sesja wygasła. Zaloguj się ponownie — niezapisane zmiany zachowaliśmy. [Zaloguj się]” |
| Błąd serwera | „Nie udało się zapisać zlecenia. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: 7F3A). [Spróbuj ponownie]” |
| Nie znaleziono | „Nie znaleziono zlecenia. Mogło zostać usunięte. [Wróć do listy]” |

Komunikaty sukcesu krótkie, w czasie przeszłym: „Zapisano zlecenie.”, „Wysłano 12 zdjęć.”

---

## 7. Dostępność i egzekwowanie

### 7.1 Dostępność — WCAG 2.2 AA (minimum)
| Obszar | Wymóg | Realizacja w styleguide |
|---|---|---|
| Kontrast (1.4.3, 1.4.11) | tekst ≥ 4,5:1, elementy UI i grafika informacyjna ≥ 3:1 | § 2.1.4 — wszystkie pary policzone; tekst podstawowy AAA |
| Użycie koloru (1.4.1) | kolor nie jest jedynym nośnikiem | statusy ikona + etykieta (§ 4.4), linki podkreślone, błędy z tekstem i ikoną |
| Powiększanie i reflow (1.4.4, 1.4.10, 1.4.12) | 200 % / 320 px bez utraty treści; odstępy tekstu modyfikowalne | `rem`, układ compact od 360 px, brak stałych wysokości dla tekstu |
| Klawiatura (2.1.1, 2.1.2, 2.4.3) | wszystko z klawiatury, bez pułapek, logiczna kolejność | dialogi z pułapką fokusu i powrotem, Esc zamyka, skróty tylko z modyfikatorem lub wyłączalne (2.1.4) |
| Fokus widoczny (2.4.7) i **niezasłonięty (2.4.11)** | pierścień zawsze widoczny; element z fokusem nie jest zakryty przez przyklejone nagłówki, dolne paski, toasty | `color.focus.ring` + `size.focus-ring.*`; `scroll-padding` równe wysokości przyklejonych pasków; toasty nie zasłaniają fokusu |
| Wygląd fokusu (2.4.13, AAA — stosujemy) | obszar ≥ obwód × 2 px, kontrast zmiany ≥ 3:1 | pierścień 2 px z odstępem 2 px, kontrast ≥ 4,74:1 |
| Cele dotyku (**2.5.8**) | ≥ 24×24 px (web) | web min. `size.touch-target.web-min`, domyślnie `size.control.height.web.md`; mobile `size.touch-target.min` (48 dp) |
| **Przeciąganie (2.5.7)** | każda akcja przeciągania ma alternatywę jednym wskazaniem | upload: „Wybierz pliki”; zmiana kolejności etapów: przyciski „W górę/W dół”; gesty mobile z przyciskami (§ 5.1) |
| Gesty (2.5.1, 2.5.2) | bez gestów wielopunktowych/ścieżkowych jako jedynej drogi; akcja na zwolnieniu | § 5.1 |
| Etykiety i instrukcje (1.3.1, 2.5.3, 3.3.2, 4.1.2) | widoczna etykieta = nazwa dostępna; role i stany | § 3.2, przyciski ikonowe z nazwą dostępną |
| Błędy (3.3.1, 3.3.3, 3.3.4) | identyfikacja, sugestia poprawy, zapobieganie przy operacjach ważnych | § 4.9, § 6.4, § 4.11 |
| Uwierzytelnianie (3.3.8) | bez testów poznawczych; wklejanie haseł, menedżery haseł | do uwzględnienia w ekranie logowania (EVM-004) |
| Zbędne ponowne wpisywanie (3.3.7) | dane już podane są podpowiadane | autouzupełnianie klienta/lokalizacji, kopiowanie z poprzedniego zlecenia |
| Spójna pomoc (3.2.6) | pomoc w tym samym miejscu | link „Pomoc” w menu konta (web) / „Więcej” (mobile) |
| Komunikaty stanu (4.1.3) | ogłaszane bez fokusu | toasty `role="status"`, postęp uploadu zbiorczo `aria-live="polite"`, błędy `role="alert"` |
| Ruch (2.3.3, 2.2.2) | `prefers-reduced-motion`, brak migania | § 2.9 |
| Język (3.1.1, 3.1.2) | `lang="pl"`; obce wtrącenia oznaczone | — |
| Mobile | etykiety dostępności (TalkBack, VoiceOver), skalowanie czcionki do 200 %, orientacja pionowa i pozioma (1.3.4) | § 2.2, § 5 |

Testy dostępności (narzędzia automatyczne + klawiatura + czytnik ekranu) — w strategii testów i przeglądzie UX każdej historyjki.

### 7.2 Egzekwowanie zgodności
1. **Tylko tokeny semantyczne i komponenty z biblioteki.** Żadnych literałów kolorów, rozmiarów, odstępów, promieni, cieni, czasów animacji i nazw fontów w kodzie UI; żadnych tokenów bazowych (`palette.*`, `dimension.*` …) poza definicjami tokenów.
2. **Reguły lint (wdraża `devops-engineer` w EVM-006, z `web-developer` / `mobile-developer`):**
   - zakaz literałów kolorów (`#hex`, `rgb()`, `hsl()`, nazwy kolorów, `Color(0x…)`, `UIColor(red:…)`) poza wygenerowanymi plikami tokenów;
   - zakaz literałów `px`/`rem`/`dp`/`pt` w stylach i propsach rozmiarów (wyjątki: `0`, `100%`, wartości z tokenów);
   - zakaz `font-family`, `font-size`, `z-index`, `box-shadow`, `transition-duration` z literałem;
   - zakaz importu tokenów bazowych i bezpośredniego użycia bibliotek UI z pominięciem własnej biblioteki komponentów (tam, gdzie lint to umożliwia);
   - wymóg nazwy dostępnej dla przycisków ikonowych, `alt` dla obrazów, etykiet pól (reguły a11y);
   - walidacja plików tokenów w CI (§ „Walidacja” w `design/tokens/README.md`).
3. **Przegląd UX jako bramka `/deliver`:** zrzuty 360 / 768 / 1280 / 1440 px (web) i kluczowe ekrany mobile, sprawdzenie zgodności ze specyfikacją i styleguide'em, klawiatury, fokusu, kontrastu, celów dotyku, polskich tekstów i wszystkich stanów; ustalenia blocker / major / minor / nit (blocker = widoczne złamanie styleguide'u, brak stanu z AC, blokujący problem a11y).
4. **Proces odstępstw:** potrzeba spoza styleguide'u → zgłoszenie do `ux-designer` (przez orkiestratora) z uzasadnieniem → decyzja: nowa rola/wariant (zmiana tokenów i styleguide'u) albo jednorazowe odstępstwo. Odstępstwo istnieje tylko wtedy, gdy jest wpisane w § 8 (data, historyjka, zakres, termin usunięcia).
5. **Wersjonowanie:** SemVer styleguide'u i tokenów — MAJOR: usunięcie/zmiana nazwy tokenu lub komponentu; MINOR: nowe tokeny, warianty, komponenty; PATCH: korekty wartości bez zmiany znaczenia, poprawki treści.

---

## 8. Changelog
### 1.0.0 — 2026-10-02 (EVM-003)
- Pierwsza wersja: zasady, fundamenty (kolor z tabelą kontrastów, typografia, odstępy, siatka i breakpointy, rozmiary, promienie, obramowania, cienie i warstwy, ruch, ikony), inwentarz 18 komponentów + pomocnicze, wzorce, wytyczne terenowe, treści, dostępność i egzekwowanie.
- Tokeny W3C DTCG 2025.10 w dwóch warstwach (`base/`, `semantic/`), motyw jasny.
- Marka z eviacharge.pl: `#247B83` (teal), `#6EFF33` (lime), `#1A1A1A`, `#838383`, `#F5F5F5`; fonty Inter, Exo 2, JetBrains Mono (OFL 1.1); ikony Lucide (ISC).
- Propozycje do akceptacji Konrada (demo EVM-003): akcje w `palette.teal.700` zamiast `palette.teal.600` (wariant A); neon `palette.lime.300` tylko jako akcent na ciemnym tle; fonty Inter + Exo 2 (wariant A). Szczegóły: `design/brand/README.md` § 6.
- Poprawki po przeglądzie developerskim (runda 1): dolna nawigacja mobile — wskaźnik aktywnej pozycji jako kapsuła `color.nav.indicator` (6,74:1) + pogrubiona etykieta, jawne tokeny pozycji nieaktywnej (`color.nav.*`, `size.bottom-nav.indicator.*`); `color.bg.selected` zawsze z drugim wskaźnikiem ≥ 3:1; górny pasek — fokus `color.focus.ring-inverse`, SyncIndicator jako kapsuła (offline z obrysem `color.border.inverse`); nowy obowiązkowy stan „Czeka na Wi-Fi” (`color.sync.waiting-wifi.*`, ikona `wifi`, akcja „Wyślij teraz przez sieć komórkową”); nowe pary w § 2.1.4.

**Odstępstwa:** brak.
