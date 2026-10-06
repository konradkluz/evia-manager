# Styleguide EVia Manager

> **Wersja 1.2.0 · 2026-10-04 · EVM-014** (poprzednie: 1.1.0 · 2026-10-03 · EVM-004; 1.0.0 · 2026-10-02 · EVM-003) · Właściciel: `ux-designer` · Status: obowiązujący (wiążący dla wszystkich implementujących UI). Zmiany: [§ 8 Changelog](#8-changelog); przepływy i makiety MVP: [`flows/README.md`](flows/README.md).
> Od 1.2.0 propozycje P-1…P-13 z EVM-004 są częścią styleguide'u — sekcje oznaczone „(od 1.2.0)”; mapa propozycja → §: § 8 → „Propozycje (EVM-004)”.
> Źródło prawdy wartości: `design/tokens/` (W3C DTCG) — opis struktury w `design/tokens/README.md`. Materiały marki: `design/brand/README.md`.
> Konwencja: `nazwa.tokenu` w kodzie to token semantyczny (używany w UI); `palette.*`, `dimension.*`, `font.*`, `shadow.*`, `duration.*`, `easing.*` to tokeny bazowe (tylko w definicjach ról). Liczby w nawiasach podane są pomocniczo — w kodzie **zawsze token**.

## Spis treści
1. [Zasady](#1-zasady)
2. [Fundamenty](#2-fundamenty) — kolor, typografia, odstępy, siatka i breakpointy, rozmiary, promienie, obramowania, cienie i warstwy, ruch, ikony
3. [Komponenty](#3-komponenty) — inwentarz M1–M2; od 1.2.0 także pole kodu (§ 3.2.1), odznaka wartości nieznanej (§ 3.9.1), pusty stan blokujący (§ 3.15.1), ActionMenu (§ 3.20), Disclosure (§ 3.21), SelectableCard (§ 3.22), ProcedureProgress (§ 3.23), CameraScreen (§ 3.24)
4. [Wzorce](#4-wzorce) — formularze, tabele/listy, filtry, statusy, oś czasu, galeria, kolejka uploadu, puste stany, błędy, offline, potwierdzenia, szkielety, brak uprawnień; od 1.2.0 także stany pliku na serwerze (§ 4.14), „Oczekuje na numer” (§ 4.15), „Wymaga uwagi” (§ 4.16), „Sesja wygasa” (§ 4.17), „Dane ukryte” na telefonie (§ 4.18)
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
| `color.progress.track` / `fill` (od 1.2.0) | `palette.neutral.200` / `palette.teal.700` | postęp procesu „3 z 7 etapów” — ProcedureProgress (§ 3.23); **nie** dla wysyłania plików (to `color.sync.progress.*`) |

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

**Statusy i synchronizacja** — `color.status.{order|stage|payment}.*` i `color.sync.*`: tabele mapowania w § 4.4 i § 5.4. Od 1.2.0 `color.status.unknown.{bg|text|icon|border}` (`palette.neutral.100` / `neutral.800` / `neutral.700` / `neutral.300`) — odznaka wartości nieznanej (§ 3.9.1), wspólna dla wszystkich grup statusów; nie jest kodem modelu.

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
| `status.order.quoting.text` #4C1D95 | `status.order.quoting.bg` #EDE9FE | tekst | **9,23:1** | 4,5:1 | AAA |
| `status.order.quoting.icon` #6D28D9 | `status.order.quoting.bg` #EDE9FE | UI | **5,98:1** | 3:1 | AA |
| `status.order.quote.text` #4C1D95 (wycofywany od 1.1.0 → `quoting`) | `status.order.quote.bg` #EDE9FE | tekst | **9,23:1** | 4,5:1 | AAA |
| `status.order.quote.icon` #6D28D9 (wycofywany od 1.1.0 → `quoting`) | `status.order.quote.bg` #EDE9FE | UI | **5,98:1** | 3:1 | AA |
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
| `status.payment.invoiced.text` #1E3A8A | `status.payment.invoiced.bg` #DBEAFE | tekst | **8,49:1** | 4,5:1 | AAA |
| `status.payment.invoiced.icon` #1D4ED8 | `status.payment.invoiced.bg` #DBEAFE | UI | **5,49:1** | 3:1 | AA |
| `status.payment.issued.text` #1E3A8A (wycofywany od 1.1.0 → `invoiced`) | `status.payment.issued.bg` #DBEAFE | tekst | **8,49:1** | 4,5:1 | AAA |
| `status.payment.issued.icon` #1D4ED8 (wycofywany od 1.1.0 → `invoiced`) | `status.payment.issued.bg` #DBEAFE | UI | **5,49:1** | 3:1 | AA |
| `status.payment.paid.text` #14532D | `status.payment.paid.bg` #DCFCE7 | tekst | **8,30:1** | 4,5:1 | AAA |
| `status.payment.paid.icon` #15803D | `status.payment.paid.bg` #DCFCE7 | UI | **4,57:1** | 3:1 | AA |
| `status.payment.cancelled.text` #2B2B2B | `status.payment.cancelled.bg` #F5F5F5 | tekst | **12,99:1** | 4,5:1 | AAA |
| `status.payment.cancelled.icon` #404040 | `status.payment.cancelled.bg` #F5F5F5 | UI | **9,51:1** | 3:1 | AA |
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
| `progress.fill` #17656C (od 1.2.0) | `progress.track` #E5E5E5 | UI — ProcedureProgress (§ 3.23) | **5,35:1** | 3:1 | AA |
| `progress.fill` #17656C (od 1.2.0) | `bg.surface` #FFFFFF | UI — ProcedureProgress | **6,74:1** | 3:1 | AA |
| `status.unknown.text` #2B2B2B (od 1.2.0) | `status.unknown.bg` #F5F5F5 | tekst — odznaka wartości nieznanej (§ 3.9.1) | **12,99:1** | 4,5:1 | AAA |
| `status.unknown.icon` #404040 (od 1.2.0) | `status.unknown.bg` #F5F5F5 | UI — odznaka wartości nieznanej | **9,51:1** | 3:1 | AA |
| `control.checked` #17656C | `bg.selected` #E8FBFD | UI — radio wybranej karty SelectableCard (§ 3.22) | **6,31:1** | 3:1 | AA |
| `bg.surface` #FFFFFF | `bg.brand-strong` #115157 | UI — wybrany chip i włączona latarka w CameraScreen (§ 3.24) | **8,98:1** | 3:1 | AA |
| `action.danger.text-subtle` #B91C1C | `bg.surface-hover` #F5F5F5 | tekst — pozycja niszcząca ActionMenu przy najechaniu i fokusie (§ 3.20) | **5,93:1** | 4,5:1 | AA |
| `focus.ring` #2563EB | `bg.surface-hover` #F5F5F5 | UI — pierścień wewnętrzny pozycji ActionMenu i wiersza tabeli | **4,74:1** | 3:1 | AA |
| `text.link` / `action.tertiary.text` #17656C | `feedback.info.bg` #EFF6FF | tekst — odnośniki banera „Zlecenie założone w terenie” (W-06) | **6,20:1** | 4,5:1 | AA |
| `focus.ring` #2563EB | `feedback.info.bg` #EFF6FF | UI — fokus odnośników banera informacyjnego | **4,75:1** | 3:1 | AA |
| `action.tertiary.text` #17656C | `feedback.warning.bg` #FFFBEB | tekst — akcja banera „Dane ukryte” (§ 4.18) | **6,50:1** | 4,5:1 | AA |
| `focus.ring` #2563EB | `feedback.warning.bg` #FFFBEB | UI — fokus akcji banera ostrzegawczego | **4,98:1** | 3:1 | AA |
| `feedback.error.border` #DC2626 | `bg.surface` #FFFFFF | UI — obrys lewy elementu „Wymaga uwagi” w Kolejce (§ 4.16) | **4,83:1** | 3:1 | AA |
| `bg.surface-hover` #F5F5F5 | `bg.surface` #FFFFFF | UI — samo tło pozycji menu | 1,09:1 | 3:1 | **niewystarczające** — fokus pozycji ActionMenu zawsze z pierścieniem `focus.ring` (§ 3.20) |
| `action.danger.bg` #B91C1C | `bg.brand-strong` #115157 | UI — wnętrze spustu podczas nagrywania | 1,39:1 | 3:1 | **niewystarczające** — stan nagrywania niosą obrys `border.inverse` (8,98:1), ikona `square`, licznik czasu i nazwa dostępna (§ 3.24) |
| `action.primary.bg` #17656C | `bg.brand-strong` #115157 | UI — granica przycisku „Gotowe” na panelu aparatu | 1,33:1 | 3:1 | **niewystarczające** — na panelu aparatu przycisk ma obrys `border.inverse` (8,98:1, § 3.24) |
| `focus.ring` #2563EB | `bg.brand` #247B83 | UI — pola na ekranie logowania mobile (M-01) | 1,04:1 | 3:1 | **zakazane** — na `bg.brand` tylko `focus.ring-inverse` (4,96:1) |

(Nazwy w tabeli bez prefiksu `color.`.) Kontrast nowych par liczy i dopisuje `ux-designer` przy każdej zmianie palety lub ról. Pary dodane w 1.1.0 (`status.order.quoting.*`, `status.payment.invoiced.*`, `status.payment.cancelled.*`) policzono 2026-10-03 tą samą metodą; mają te same wartości co pary o tych samych aliasach z 1.0.0. Pary dodane w 1.2.0 (17 ostatnich wierszy) policzono 2026-10-04 tą samą metodą, skryptem w przeglądarce na `about:blank` (bez sieci); `bg.surface-hover` ma ten sam alias co `bg.canvas`, więc pary tekstu i ikon na tle najechanej pozycji mają wartości z wierszy `bg.canvas`.

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
- **Web / mobile:** web — kolejność w stopce dialogu: drugorzędny po lewej, główny po prawej. Mobile — akcja główna w dolnym pasku na pełną szerokość (`size.touch-target.field`), drugorzędne obok lub w menu akcji (ActionMenu, § 3.20). Przyciski na ciemnym panelu aparatu — § 3.24 (od 1.2.0).

### 3.2 Pole tekstowe (TextField, TextArea)
- **Warianty:** tekst, liczba/kwota (`text.numeric`, jednostka jako sufiks „zł”, „kW”), telefon, e-mail, hasło (pokaż/ukryj), wyszukiwanie (ikona `search`, przycisk wyczyść `x`), wieloliniowe (autowzrost do 6 linii).
- **Anatomia:** etykieta (`text.label` web / `text.label-lg` mobile) nad polem, pole, podpowiedź lub błąd pod polem (`text.body-sm`, `color.text.tertiary` / `color.text.error` + ikona `circle-alert`). Odstępy `space.stack.xs` i `space.stack.sm`.
- **Stany:** domyślny obrys `color.border.strong`, tło `color.control.bg`; hover `color.border.strong-hover`; fokus pierścień + obrys `color.border.selected`; wyłączony `color.control.bg-disabled`, `color.control.border-disabled`, tekst `color.text.disabled`; tylko do odczytu — bez obrysu, tekst `color.text.primary`; błąd obrys `color.border.error` `border-width.strong` + komunikat; ładowanie (np. sprawdzanie) — ikona `loader-circle` w sufiksie.
- **Tokeny:** wysokość `size.control.height.web.md` / `size.control.height.mobile.md`, `radius.control`, padding `space.inset.sm`/`space.inset.md`, placeholder `color.control.placeholder`.
- **Zasady:** etykieta zawsze widoczna (placeholder nie zastępuje etykiety); pola opcjonalne oznaczamy „(opcjonalnie)”, nie wymagane gwiazdką; walidacja po opuszczeniu pola i przy zapisie, nie przy każdym znaku.
- **Web / mobile:** mobile — właściwa klawiatura (`numeric`, `tel`, `email`), autouzupełnianie systemowe, pola jedno pod drugim. Pole kodu jednorazowego i kodu odzyskiwania — § 3.2.1.

#### 3.2.1 Pole kodu jednorazowego i kodu odzyskiwania (od 1.2.0)
Propozycja P-4 z EVM-004. Ekrany: W-02, W-03, W-04, M-01. Wymagania: WCAG 3.3.8, 3.2.2; SR-AUTH-05, -06, -07, -08, SR-MOB-08.
- **Anatomia:** TextField (§ 3.2) — etykieta nad polem, **jedno pole** (nie osobne pola na każdą cyfrę), podpowiedź albo komunikat błędu pod polem, pod polem przycisk główny formularza („Potwierdź”). Mobile — w sufiksie pola przycisk „Pokaż” / „Ukryj” (pole maskowane, jak hasło).
- **Warianty:**
  - **kod jednorazowy (TOTP):** cyfry, `inputmode="numeric"`, `autocomplete="one-time-code"`, styl `text.numeric-lg`; spacje wpisane albo wklejone („123 456”) są ignorowane.
  - **kod odzyskiwania:** litery i cyfry, styl `text.mono`, `autocomplete="off"`; spacje, łączniki i wielkość liter nie mają znaczenia.
- **Stany:** domyślny, hover (web), fokus, wyłączony, błąd — jak § 3.2; wciśnięty — nd. dla pola (tekst), przycisk „Pokaż” jak IconButton (§ 3.1); ładowanie — „Potwierdź” w stanie ładowania (§ 3.1), pole tylko do odczytu do odpowiedzi serwera; offline — wpisany kod zostaje, „Potwierdź” wyłączony z podpowiedzią. Po odpowiedzi „kod nieprawidłowy” pole jest czyszczone i dostaje fokus; po błędzie sieci kod zostaje.
- **Zasady bezpieczeństwa:**
  - **Web:** `spellcheck="false"` i `autocapitalize="off"` (rozszerzone sprawdzanie pisowni w przeglądarkach wysyła treść pól do chmury); wklejanie i menedżery haseł dozwolone (WCAG 3.3.8); **bez automatycznego wysłania** po wpisaniu ostatniej cyfry (WCAG 3.2.2).
  - **Mobile** (SR-MOB-08, MASVS-PLATFORM-3): pole maskowane z „Pokaż”; ekran z `FLAG_SECURE` (brak zrzutów i podglądu w przełączniku aplikacji); autokorekta i podpowiedzi klawiatury wyłączone (kod nie trafia do słownika klawiatury); systemowe autouzupełnianie kodu dozwolone; bez odczytu SMS i bez nowych uprawnień (SMS nie jest czynnikiem — SR-AUTH-06; uprawnienia — P7 pkt 3).
  - **Jeden komunikat** dla kodu złego, już użytego i wygasłego (bez ujawniania, który to przypadek); `429` i blokada — ten sam komunikat co przy logowaniu (W-01), czas z `Retry-After` (SR-AUTH-05).
  - Wartość kodu **nigdy** nie trafia do adresu URL, tytułu karty, logów, analityki ani ogłoszeń czytnika ekranu (ogłaszamy tylko wynik).
- **Tokeny:** `text.numeric-lg` (kod jednorazowy), `text.mono` (kod odzyskiwania); pozostałe jak § 3.2 — `size.control.height.web.md` / `size.control.height.mobile.md`, `radius.control`, `color.control.bg`, `color.border.strong`, fokus `color.focus.ring` + `color.border.selected`, błąd `color.border.error` `border-width.strong` + `color.text.error`; szerokość pola — jak inne pola w kolumnie formularza (`size.form.max-width`). Na tle `color.bg.brand` (M-01) pierścień `color.focus.ring-inverse` (4,96:1; `color.focus.ring` — 1,04:1, zakazane).
- **Dostępność:** widoczna etykieta = nazwa dostępna; podpowiedź powiązana z polem (`aria-describedby`); błąd w `role="alert"` i fokus na polu; „Pokaż” (mobile) z nazwą „Pokaż kod” i stanem przełącznika; cel dotyku pola i „Pokaż” ≥ `size.touch-target.min`; wklejanie i autouzupełnianie bez testów poznawczych (WCAG 3.3.8).
- **Mikrocopy:** etykiety „Kod z aplikacji uwierzytelniającej” / „Kod odzyskiwania”; podpowiedzi „6 cyfr z aplikacji uwierzytelniającej.” / „Kod z listy kodów odzyskiwania. Spacje i łączniki nie mają znaczenia.”; błąd „Kod jest nieprawidłowy lub wygasł. Wpisz nowy kod z aplikacji.” (kod odzyskiwania: „Kod jest nieprawidłowy lub wygasł. Sprawdź kod albo użyj innego kodu odzyskiwania.”); `429`: „Zbyt wiele prób logowania. Spróbuj ponownie za 15 min.”; „Pokaż” / „Ukryj”; „Potwierdź”.
- **Web / mobile:** web — pole bez maskowania (kod żyje 30 s), „Potwierdź” pod polem; mobile — maskowanie z „Pokaż”, klawiatura numeryczna dla kodu jednorazowego, przycisk „Potwierdź” w dolnym pasku (`size.touch-target.field`).

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
- **Zasady:** cały wiersz prowadzi do szczegółów (link), akcje wiersza w menu `ellipsis-vertical` (ActionMenu, § 3.20); kolumny priorytetowe zawsze widoczne: Zlecenie, Klient, Status, „Czekamy na”, Termin, Płatność. Sortowanie z `aria-sort`.
- **Web / mobile:** < `breakpoint.medium` tabela → lista kart (§ 3.8) z tymi samymi danymi priorytetowymi; wiersz listy mobile min. `size.touch-target.min`.

### 3.7 Filtry (FilterBar, FilterChip, SearchField)
- **Warianty:** pasek filtrów (web, nad tabelą, `color.bg.surface-subtle`), chip filtra (`radius.pill`, wybrany: `color.bg.selected` + `color.border.selected` + ikona `check`), panel „Więcej filtrów”, arkusz filtrów (mobile), zapisane widoki („Czekamy na OSD > 14 dni”).
- **Stany:** chip — domyślny obrys `color.border.strong`; hover `color.bg.surface-hover`; fokus pierścień; aktywny (wybrany) jak wyżej; wyłączony `color.text.disabled`; ładowanie wyników — szkielet tabeli, filtry pozostają aktywne.
- **Tokeny:** wysokość chipa `size.control.height.web.sm` (web) / `size.touch-target.min` (mobile), `space.inline.sm`, `text.label`.
- **Zasady:** aktywne filtry zawsze widoczne jako chipy z `x` + „Wyczyść filtry”; licznik wyników („24 zlecenia”); bez przycisku „Zastosuj” na web (natychmiast), z przyciskiem „Pokaż wyniki (24)” w arkuszu mobile.
- **Adres URL i tytuł karty (web, od 1.1.0):** w adresie URL wyłącznie wartości bez danych osobowych — status, rodzaj strony, liczba dni X i identyfikator zapisanego widoku (link można udostępnić). Fraza wyszukiwania i filtry z danymi osobowymi (klient, adres, osoba) **nie trafiają do URL ani do tytułu karty** — zostają w pamięci karty, a zapytanie idzie przez `POST …/search` (SR-API-04, SR-WEB-05, AB-16).

### 3.8 Karta (Card)
- **Warianty:** karta informacyjna (sekcja szczegółów), karta zlecenia na liście (klikalna), karta podsumowania (status, „Czekamy na”, termin, płatność).
- **Stany:** domyślny `color.bg.surface`, obrys `color.border.default`, `radius.card`; hover (klikalna) `elevation.card`; fokus pierścień; wciśnięty `color.bg.surface-pressed`; wybrana `color.border.selected`; błąd — alert w karcie; ładowanie — szkielet o kształcie karty.
- **Tokeny:** padding `space.inset.md` (mobile) / `space.inset.lg` (web), odstęp między kartami `space.stack.sm` (mobile) / `space.stack.md` (web), tytuł `text.heading-3`.
- **Zasady:** karta zlecenia ma: nr i nazwę, klienta, adres (mobile — `text.body-lg`), odznakę statusu, „Czekamy na: [strona] od [n] dni”, najbliższy termin. Jedna główna akcja na karcie (cała karta), dodatkowe w menu `ellipsis-vertical` (ActionMenu, § 3.20). Karta w roli opcji wyboru — SelectableCard (§ 3.22).

### 3.9 Odznaka statusu (StatusBadge)
- **Warianty:** subtelna (ton `*.bg` 100 + `*.text` 900), mocna (Rozliczone, Po terminie — tło 800 + biały tekst), kompaktowa (tylko ikona — **wyłącznie** gdy etykieta jest obok w tej samej komórce lub w nazwie dostępnej, np. oś czasu).
- **Anatomia:** ikona `size.icon.sm` (`color.status.*.icon`) + etykieta `text.label` (`color.status.*.text`) na `color.status.*.bg`; `radius.pill`; wysokość `size.badge.height`; padding `space.inset.xs`/`space.inset.sm`; odstęp `space.inline.xs`.
- **Stany:** statyczna (nieinteraktywna) — bez hover/fokus; jako przycisk zmiany statusu — dodatkowo `chevron-down`, fokus pierścień, wyłączony bez `chevron-down` z podpowiedzią dlaczego.
- **Zasady:** mapowanie wartości → § 4.4 (jedyne dozwolone); etykieta nigdy nie jest skracana; nie tworzymy nowych kolorów statusów w kodzie. Wartość spoza mapowania — § 3.9.1.

#### 3.9.1 Odznaka wartości nieznanej (od 1.2.0)
Propozycja P-12 z EVM-004. Ekrany: W-06, W-10, W-11, M-03, M-05 — oraz każda lista i każdy szczegół z wartościami słownikowymi statusów (zlecenie, etap, płatność). Wymagania: ADR-0004, SR-MOB-10, SR-ERR-01.
- **Kiedy:** API zwraca wartość statusu, której ta wersja panelu albo aplikacji nie zna (nowsza wersja API — ADR-0004).
- **Anatomia:** jak § 3.9 — ikona `circle-help` `size.icon.sm` (`color.status.unknown.icon`) + **stała etykieta „Nieznany status”** (`text.label`, `color.status.unknown.text`) na `color.status.unknown.bg`; `radius.pill`, `size.badge.height`, padding `space.inset.xs` / `space.inset.sm`, odstęp `space.inline.xs`.
- **Warianty:** wyłącznie subtelna. Kompaktowa (sama ikona) — niedozwolona. **Nigdy jako przycisk zmiany statusu** — wartość nieznana jest zawsze statyczna (bez `chevron-down` i bez menu).
- **Stany:** domyślny (statyczna); hover, fokus, wciśnięty — nd. (nieinteraktywna; fokus ma wiersz, karta albo nagłówek, w którym leży); wyłączony — nd. (status nie jest kontrolką); błąd — nd. (to nie jest błąd użytkownika — bez tonu błędu); ładowanie — szkielet odznaki (§ 3.16).
- **Zasady:**
  - UI **nigdy nie renderuje surowej wartości z API** — ani w etykiecie, ani w podpowiedzi, nazwie dostępnej czy tytule karty (SR-MOB-10).
  - Akcje zależne od statusu (menu przejść, akcje płatności, przyciski zależne od stanu) są dla wartości nieznanej **wyłączone z podpowiedzią** (web) albo **ukryte** (mobile — telefon i tak nie zmienia statusów). Wartość nieznana nigdy nie jest traktowana jak którakolwiek znana (fail-closed, SR-ERR-01).
  - Filtry statusu nie oferują wartości nieznanej; zlecenie z taką wartością pokazujemy w widokach bez filtra statusu.
- **Tokeny:** `color.status.unknown.{bg|text|icon|border}` (nowe w 1.2.0), `size.icon.sm`, `text.label`, `radius.pill`, `size.badge.height`, `space.inset.xs`, `space.inset.sm`, `space.inline.xs`. Kontrast: tekst 12,99:1, ikona 9,51:1 (§ 2.1.4).
- **Dostępność:** odznaka nieinteraktywna — fokus i cel dotyku ma element, w którym leży (wiersz, karta — ≥ `size.touch-target.min` na mobile, § 3.6, § 3.8); nazwa dostępna „Status: nieznany” + podpowiedź jako opis; w wierszu tabeli i na karcie opis jest częścią nazwy dostępnej wiersza / karty; od „Nowe”, „Anulowane” i „Do zrobienia” (ten sam ton neutralny) odróżnia ją kształt ikony `circle-help` (unikalny we wszystkich grupach § 4.4) i etykieta; zmiany nie są ogłaszane.
- **Mikrocopy:** „Nieznany status” · podpowiedź web: „Odśwież stronę, aby zobaczyć szczegóły.” · mobile: „Zaktualizuj aplikację, aby zobaczyć szczegóły.” · akcja wyłączona (web): „Odśwież stronę, aby zobaczyć dostępne akcje.”
- **Web / mobile:** web — podpowiedź (tooltip) przy odznace i ten sam tekst w opisie dostępnym; w szczegółach (W-06) tekst podpowiedzi widoczny obok odznaki; mobile — w szczegółach (M-03) tekst pod odznaką, na karcie listy (M-05) tylko odznaka.

### 3.10 Oś czasu (Timeline, TimelineEntry)
- **Warianty wpisu:** zmiana statusu (znacznik = ikona statusu), wpis/notatka (`pencil`), komentarz (`message-square-text`), dodane media (miniatury), dokument, płatność, wpis systemowy.
- **Anatomia:** znacznik `size.timeline-marker` na linii `color.border.default` (`border-width.strong`); nagłówek: autor (`text.label`) + czas (`text.caption` web / `text.body-sm` mobile, `color.text.secondary`, format § 6.3); treść `text.body`; odstęp między wpisami `space.stack.md`.
- **Stany:** domyślny; hover (web) akcje wpisu; fokus wpisu pierścień; wpis lokalny niezsynchronizowany — ikona `clock` + „Czeka na wysłanie” (`color.sync.queued.*`); błąd — `cloud-alert` + „Ponów”; ładowanie starszych — szkielet 3 wpisów; pusty — „Brak wpisów. Dodaj pierwszą notatkę.”
- **Zasady:** od najnowszych; grupowanie po dniach („Dziś”, „Wczoraj”, `02.10.2026`); filtr typów wpisów.

### 3.11 Miniatura / galeria (Thumbnail, Gallery, Lightbox)
- **Warianty:** miniatura w kolejce (`size.thumbnail.sm`), kafel galerii (`size.thumbnail.md` min., siatka: 3 kolumny compact, auto-fill web do `size.thumbnail.lg`), podgląd pełnoekranowy (lightbox), dokument (ikona typu pliku + nazwa).
- **Stany:** domyślny `radius.thumbnail`; hover (web) nakładka z akcjami; fokus pierścień; zaznaczony (wybór wielu) obrys `color.border.selected` `border-width.indicator` + `check`; ładowanie — `color.bg.skeleton`; błąd wczytania — ikona `image` + „Nie można wyświetlić”; lokalny/niewysłany — znacznik stanu uploadu w rogu (§ 5.4); stan pliku po stronie serwera (sprawdzanie, kwarantanna, czeka na plik, plik za duży na skan) — znacznik z § 4.14 (od 1.2.0).
- **Tokeny:** `space.inline.xs` między kaflami, metadane `text.body-sm`.
- **Zasady:** każde zdjęcie ma tekst alternatywny z metadanych (kategoria, etap, data); lightbox: przyciski poprzednie/następne (nie tylko gest), zoom przyciskami, Esc zamyka.

### 3.12 Uploader i element kolejki uploadu (Uploader, UploadQueueItem)
- **Warianty:** web — strefa upuszczania + „Wybierz pliki”, z widoczną listą dozwolonych typów i limitów (SR-FILE-01); mobile — wyłącznie przycisk aparatu (`size.touch-target.shutter` na ekranie aparatu, `size.touch-target.field` w widoku zlecenia) — **bez „Z galerii”** (od 1.1.0: aplikacja nie ma dostępu do galerii ani plików poza swoim katalogiem — ADR-0007, P3, P7); element kolejki (miniatura `size.thumbnail.sm`, nazwa/kategoria, stan, akcja).
- **Stany elementu (tokeny `color.sync.*`, § 5.4):** W kolejce · Wysyłanie n % (pasek `size.progress-bar.height`, `color.sync.progress.fill` na `color.sync.progress.track`) · Wysłano · Błąd + „Ponów” · Czeka na Wi-Fi + „Wyślij teraz przez sieć komórkową” (obowiązkowy, gdy włączono „Wysyłaj tylko przez Wi-Fi”). Strefa upuszczania: hover/przeciąganie `color.bg.selected` + obrys `color.border.selected` przerywany; fokus pierścień; wyłączony (brak uprawnień) z wyjaśnieniem; błąd typu/rozmiaru — komunikat przy pliku.
- **Zasady:** plik nigdy nie znika z kolejki bez potwierdzenia serwera; „Ponów” i „Usuń z kolejki” jako widoczne przyciski (nie gest); postęp liczbowo i paskiem; zbiorczo: „Wysłano 12 z 15 · 3 w kolejce”. Od 1.2.0: stany pliku po wysłaniu (sprawdzanie, kwarantanna, plik za duży na skan) — § 4.14; elementy odrzucone i pliki w kwarantannie w Kolejce — „Wymaga uwagi” (§ 4.16).
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
- **Zasady:** zawsze mówi, dlaczego jest pusto i co zrobić („Brak zleceń spełniających filtry. [Wyczyść filtry]”). Stan blokujący cały ekran — § 3.15.1.

#### 3.15.1 Pusty stan blokujący (od 1.2.0)
Propozycja P-5 z EVM-004. Ekrany: W-03, M-02. Wymagania: P1, P2, P6, P7; SR-AUTH-06, SR-SESS-05, SR-MOB-05, -06, -09, -13.
- **Kiedy:** użytkownik nie może korzystać z aplikacji, dopóki nie wykona jednej czynności — `403 mfa_enrollment_required` (W-03) i stany urządzenia z P2 / P7 (M-02: wylogowano telefon, dane firmowe usunięte, aktualizacja wymagana, rola bez dostępu do aplikacji, brak blokady ekranu przy logowaniu, limit urządzeń, blokada aplikacji).
- **Anatomia:** pełny ekran **bez Sidebar i TopBar (web) oraz bez BottomNav (mobile)**; u góry nazwa „EVia Manager”; ikona `size.icon.2xl` `color.icon.secondary`; tytuł `text.heading-2` — co zrobić albo co się stało; opis `text.body` `color.text.secondary` — dlaczego, co z niewysłanymi elementami (liczba), co dalej; **jedna akcja primary** (mobile — w dolnym pasku `size.touch-target.field`); opcjonalnie jedna akcja tertiary („Wyloguj”, „Wróć do logowania”, „Zobacz kolejkę”); tło `color.bg.canvas`. W-03 — kroki konfiguracji pod nagłówkiem w kolumnie `size.form.max-width`, „Wyloguj” w prawym górnym rogu.
- **Warianty:** web z treścią kroków (W-03); mobile — komunikat z akcją (M-02; ikony i teksty wariantów — tabela „Stany urządzenia” w M-02).
- **Stany:** domyślny; hover, fokus, wciśnięty, wyłączony — przycisków wg § 3.1 (fokus `color.focus.ring`, 4,74:1 na `color.bg.canvas`); błąd — InlineAlert (§ 3.19) pod opisem (np. „Nie udało się otworzyć ustawień. Otwórz je ręcznie.”); ładowanie — akcja w stanie ładowania z tekstem „Sprawdzamy telefon…” (M-02); offline — akcja wymagająca serwera wyłączona z podpowiedzią.
- **Zasady:**
  - **Dane nie są renderowane** — ekran nie zawiera i nie pobiera danych zleceń ani klientów; to nie nakładka ani rozmycie nad treścią (dotyczy też nazw dostępnych i podglądu w przełączniku aplikacji).
  - Nawigacja i skróty klawiaturowe aplikacji są nieaktywne; każde wejście na inny adres wraca do stanu (web); systemowe „wstecz” na telefonie nie omija stanu.
  - Niewysłane elementy — wyłącznie liczba, bez nazw i miniatur.
  - „Wyloguj” dostępny w każdym wariancie po zalogowaniu (SR-SESS-05).
- **Tokeny:** `color.bg.canvas`, `size.icon.2xl`, `color.icon.secondary`, `text.heading-2`, `text.body`, `color.text.secondary`, `space.stack.md` (między elementami), `space.stack.2xl` (wokół treści), `size.form.max-width` (web), `size.touch-target.field` i `elevation.bottom-bar` (dolny pasek mobile).
- **Dostępność:** po wejściu fokus na tytule (nagłówek pierwszego poziomu), tytuł ogłaszany jako pierwszy; tytuł karty (web) bez danych osobowych („Konfiguracja logowania · EVia Manager”); ikona dekoracyjna (`aria-hidden`); liczba niewysłanych elementów jako tekst; cele dotyku ≥ `size.touch-target.min`; bez ograniczenia orientacji.
- **Mikrocopy:** tytuł = co zrobić albo co się stało („Skonfiguruj drugi krok logowania”, „Wylogowano ten telefon”); opis = dlaczego + co z niewysłanymi elementami + co dalej; przyciski czasownikiem („Zaloguj się”, „Otwórz ustawienia”, „Wróć do logowania”). Teksty wariantów: W-03 i M-02 w [`flows/01-logowanie-mfa.md`](flows/01-logowanie-mfa.md).
- **Web / mobile:** web — bez Sidebar i TopBar, „Wyloguj” jako Button tertiary w prawym górnym rogu; mobile — bez BottomNav, akcja główna w dolnym pasku; SyncIndicator tylko w wariantach, w których działa Kolejka (np. „Aktualizacja wymagana”); `FLAG_SECURE` na ekranach logowania i drugiego kroku (SR-MOB-08).

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
- **Licznik na pozycji „Kolejka”** (od 1.2.0):
  - liczy elementy jeszcze niewysłane: „W kolejce”, „Wysyłanie”, „Czeka na Wi-Fi”, „Czeka na połączenie”, „Błąd” (§ 5.4);
  - nie liczy elementów „Wymaga uwagi” — ten stan sygnalizuje kapsuła SyncIndicator (§ 4.16);
  - działa niezależnie od stanu kapsuły, więc technik widzi, że zostało coś do wysłania, także gdy kapsuła pokazuje „Wymaga uwagi”;
  - przy 0 odznaki nie ma — wszystko wysłane;
  - nazwa dostępna: „Kolejka, 5 do wysłania”.

### 3.19 Komponenty pomocnicze
- **Alert (InlineAlert / Banner):** `color.feedback.{ton}.*`, ikona tonu, tytuł `text.label-lg`, treść `text.body` `color.text.primary`, akcja; obrys lewy `border-width.indicator` `color.feedback.{ton}.border`; `role="alert"` tylko dla błędów.
- **Pasek postępu (ProgressBar):** `size.progress-bar.height`, `color.sync.progress.*`, `radius.pill`, wartość tekstowa obok — postęp wysyłania. Postęp procesu („3 z 7 etapów”) — ProcedureProgress (§ 3.23, `color.progress.*`).
- **Wskaźnik synchronizacji (SyncIndicator):** § 5.4.

### 3.20 Menu akcji (ActionMenu) (od 1.2.0)
Propozycja P-1 z EVM-004. Ekrany: W-06, W-07, W-08, W-09, W-11; mobile — arkusz „Dodaj” w BottomNav. Notacja w makietach: `⋮` (menu akcji obiektu) i `«… ▾»` (odznaka jako przycisk zmiany statusu).
- **Anatomia:** wyzwalacz → lista pozycji. Wyzwalacz: IconButton `ellipsis-vertical` (§ 3.1) z nazwą dostępną z obiektem albo StatusBadge jako przycisk (§ 3.9, `chevron-down`). Lista: web — rozwijana pod wyzwalaczem; mobile — BottomSheet (§ 3.13) z tytułem (obiekt). Pozycja: etykieta (czasownik + obiekt; „…” na końcu, gdy otwiera dialog), opcjonalnie ikona wiodąca ze słownika § 2.10. Grupy oddziela separator; **akcje niszczące na końcu, w osobnej grupie**.
- **Warianty:** menu akcji obiektu (`⋮` — nagłówek zlecenia, wiersz etapu, wpis, transza, dokument, strona); menu przejść statusu (`«… ▾»` — wyłącznie przejścia dozwolone z bieżącego stanu wg `domain-model.md`, w kolejności częstości — W-06, W-07); arkusz akcji (mobile — „Dodaj”: Zdjęcie lub film, Wpis, Nowe zlecenie).
- **Stany pozycji:** domyślny — `color.bg.surface`, tekst `color.text.primary`, ikona `color.icon.primary`; hover (web) — `color.bg.surface-hover`; **fokus — pierścień wewnętrzny `color.focus.ring`** (`size.focus-ring.width`, bez odstępu, jak wiersz tabeli § 3.6) na tle `color.bg.surface-hover` (4,74:1) — samo tło (1,09:1) nie jest wskaźnikiem fokusu; wciśnięty — `color.bg.surface-pressed`; wyłączony — tekst `color.text.disabled`, ikona `color.icon.disabled`, pozycja nadal osiągalna (`aria-disabled="true"`) z podpowiedzią powodu (§ 4.13); niszcząca — tekst i ikona `color.action.danger.text-subtle` (6,47:1 na `bg.surface`, 5,93:1 na `bg.surface-hover`); błąd — nd. w menu (błąd wykonania akcji — alert w miejscu operacji, § 4.9; menu się zamyka); ładowanie — nd. (pozycje wynikają z danych obiektu już na ekranie; wykonanie — stan ładowania wyzwalacza albo przycisku w dialogu). Wyzwalacz: stany IconButton (§ 3.1); przy otwartym menu — stan wciśnięty i `aria-expanded="true"`.
- **Widoczność i uprawnienia:**
  - wg § 4.13 — rola Tylko odczyt **nie widzi wyzwalacza** ani akcji edycji; Edytor widzi akcje Administratora jako wyłączone z podpowiedzią, która nie ujawnia danych („Usunąć zlecenie może tylko administrator.”); menu bez żadnej dozwolonej pozycji nie jest pokazywane;
  - operacje niszczące i nieodwracalne → dialog z § 4.11; operacje ze step-upem → po potwierdzeniu dialog ponownego uwierzytelnienia (W-04);
  - UI nie jest granicą bezpieczeństwa — każdą operację autoryzuje serwer (SR-AUTHZ-01, -05; macierz ról w historyjkach implementujących).
- **Tokeny:** web — lista `color.bg.surface`, obrys `color.border.default` `border-width.default`, `elevation.dropdown`, `layer.dropdown`, `radius.control`, pozycja min. `size.control.height.web.md`, padding `space.inset.sm`, tekst `text.body-sm`, ikona `size.icon.md`, odstęp ikona–tekst `space.inline.sm`, separator `color.border.subtle`, wejście `motion.transition.enter`, wyjście `motion.transition.exit`. Mobile — BottomSheet: `radius.sheet`, `elevation.dialog`, `layer.dialog`, scrim `color.bg.scrim`, pozycja min. `size.touch-target.min`, tekst `text.body`, ikona `size.icon.lg`, `motion.transition.sheet`.
- **Dostępność:** web — wyzwalacz z `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; lista `role="menu"`, pozycje `role="menuitem"`; po otwarciu fokus na pierwszej dostępnej pozycji; strzałki w górę i w dół (z zawijaniem), Home / End, wpisanie litery przenosi do pozycji, Enter / Spacja wykonuje; Esc i Tab zamykają, fokus wraca do wyzwalacza; pozycje wyłączone ogłaszane jako niedostępne z powodem. Nazwa wyzwalacza zawsze z obiektem („Akcje transzy: Zaliczka”, „Status etapu Warunki przyłączenia i projekt umowy: W toku. Zmień status”). Lista nie zasłania elementu z fokusem (WCAG 2.4.11) — przy braku miejsca otwiera się nad wyzwalaczem. Mobile — każda pozycja to przycisk ≥ `size.touch-target.min` (odstęp ≥ `space.stack.sm` od akcji niszczących); zamknięcie: „Anuluj”, systemowe „wstecz” albo dotknięcie scrimu; fokus czytnika na tytule arkusza, po zamknięciu wraca do wyzwalacza.
- **Mikrocopy:** pozycje = czasownik + obiekt („Edytuj dane zlecenia”, „Popraw wpis”, „Wystaw fakturę…”, „Usuń wpis”); „…” przy pozycjach otwierających dialog; podpowiedzi pozycji wyłączonych z § 4.13 („Korektę płatności może wykonać tylko administrator.”); bez etykiet „Więcej” / „Opcje” bez obiektu.
- **Web / mobile:** web — lista wyrównana do prawej krawędzi wyzwalacza `⋮`, na `breakpoint.compact` — BottomSheet jak mobile; mobile — BottomSheet z pozycjami na pełną szerokość, akcje niszczące oddzielone od częstych (§ 5.1).

### 3.21 Sekcja rozwijana (Disclosure) (od 1.2.0)
Propozycja P-2 z EVM-004. Ekrany: W-05, W-06, M-03, M-07. Notacja w makietach: `▸` — sekcja zwinięta, `▾` — rozwinięta (stan, nie kształt ikony).
- **Anatomia:** nagłówek = przycisk na całą szerokość sekcji: tytuł (`text.heading-4`), ikona `chevron-down` (zwinięta) / `chevron-up` (rozwinięta), **podsumowanie** obok tytułu (np. postęp „3 z 7 etapów” — § 3.23, bieżący etap z odznaką, „Czekamy na…” z rozwinięciem — § 4.4); pod nagłówkiem treść sekcji. Podsumowanie zostaje widoczne także po rozwinięciu. Grupa sekcji może mieć nad sobą przycisk „Rozwiń wszystkie” / „Zwiń wszystkie” (Button tertiary).
- **Warianty:** sekcja procesu (W-06, M-03 — podsumowanie z postępem i „Czekamy na…”); sekcja pomocnicza (W-05 — „Pokaż szczegóły szablonu”, „Adres korespondencyjny (opcjonalnie)”; M-07 — „Wysłane dziś (9)”); grupa z „Rozwiń wszystkie” (W-06).
- **Stany:** domyślny — zwinięta albo rozwinięta (stan początkowy określa ekran); hover (web) — tło nagłówka `color.bg.surface-hover`; fokus — pierścień `color.focus.ring` wokół nagłówka; wciśnięty — `color.bg.surface-pressed`; wyłączony — nd. (sekcji bez treści nie rozwijamy — zamiast niej zwykły wiersz z tekstem, np. „Proces nie ma etapów.”); błąd — nd. dla nagłówka (nieudane wczytanie treści — alert w treści sekcji, § 4.9); ładowanie — treść doczytywana po rozwinięciu pokazuje szkielet (§ 3.16), nagłówek bez zmian.
- **Zasady:**
  - „Status na pierwszy rzut oka”: najważniejsza informacja nie może być tylko w zwiniętej treści — np. „Czekamy na… od 15 dni” zawsze w nagłówku procesu.
  - Stan zwinięcia pamiętamy tylko w pamięci karty (web) albo lokalnie w aplikacji (mobile) — nie w adresie URL.
  - **Zwinięcie nie jest kontrolą dostępu:** danych, których rola nie może widzieć, nie pobieramy i nie renderujemy w ukrytej treści.
- **Tokeny:** nagłówek `text.heading-4`, wysokość min. `size.control.height.web.md` (web) / `size.touch-target.min` (mobile), ikona `size.icon.md` (web) / `size.icon.lg` (mobile) `color.icon.secondary`, podsumowanie `text.body-sm` (web) / `text.body` (mobile) `color.text.secondary`, odstęp treści `space.stack.sm`, separator między sekcjami `color.border.subtle`, animacja `motion.transition.expand` (przy ograniczonym ruchu `motion.duration.instant`).
- **Dostępność:** nagłówek to `button` wewnątrz elementu nagłówka (w W-06 poziom 3) z `aria-expanded` i `aria-controls`; nazwa dostępna = tytuł + podsumowanie („Uzgodnienia z OSD, 2 z 7 etapów, czekamy na Stoen Operator (OSD) od 15 dni”); Enter / Spacja przełącza; po rozwinięciu fokus zostaje na nagłówku, treść nie jest ogłaszana automatycznie; „Rozwiń wszystkie” zmienia etykietę na „Zwiń wszystkie”; mobile — cały nagłówek celem dotyku ≥ `size.touch-target.min`, rozwijanie przyciskiem, nie gestem (§ 5.1).
- **Mikrocopy:** „Rozwiń wszystkie” / „Zwiń wszystkie” · „Pokaż szczegóły szablonu” · podsumowania: „2 z 7 etapów”, „Wszystkie zakończone”, „Wysłane dziś (9)”.
- **Web / mobile:** web — sekcje procesów jedna pod drugą z separatorem; mobile — podsumowanie zawijane pod tytułem przy powiększeniu czcionki do 200 %.

### 3.22 Karta wyboru (SelectableCard) (od 1.2.0)
Propozycja P-3 z EVM-004. Ekrany: W-05, M-10.
- **Anatomia:** grupa kart w `fieldset` z legendą (np. „3. Szablon”); karta (§ 3.8) = radio (§ 3.4) + tytuł opcji + opis (liczby pozycji, procesów, transz); **cała karta jest etykietą radia** (dotknięcie w dowolnym miejscu wybiera).
- **Warianty:** z opisem (W-05, M-10); z podglądem wybranej opcji obok (web, `breakpoint.expanded` — Card z podglądem przyklejona po prawej) albo pod kartą (`breakpoint.medium` — Disclosure, § 3.21); opcja bez szczegółów („Puste zlecenie (bez szablonu)”) — zwykłe radio w tej samej grupie.
- **Stany:** domyślny — `color.bg.surface`, obrys `color.border.default`, radio `color.border.strong`; hover (web) — `elevation.card`; fokus — pierścień `color.focus.ring` wokół całej karty (z odstępem `size.focus-ring.offset`, na tle strony), bez osobnego pierścienia radia; **wybrana** — obrys `color.border.selected` `border-width.indicator` + zaznaczone radio `color.control.checked` + tło `color.bg.selected` (tło tylko razem z obrysem — samo ma 1,07:1; obrys i radio 6,31:1 do `bg.selected`); wciśnięty — `color.bg.surface-pressed`; wyłączony — tło `color.control.bg-disabled`, obrys `color.control.border-disabled`, tekst `color.text.disabled` z podpowiedzią powodu; błąd — komunikat pod grupą (`color.text.error` + `circle-alert`), np. „Wybierz szablon albo „Puste zlecenie”.”; ładowanie — szkielet kart (§ 3.16).
- **Tokeny:** `radius.card`, padding `space.inset.md`, odstęp kart `space.stack.sm`, tytuł `text.label-lg`, opis `text.body-sm` (web) / `text.body` (mobile) `color.text.secondary`, `color.border.default`, wybrana `color.border.selected` + `border-width.indicator` + `color.bg.selected`, radio `color.control.checked` / `color.border.strong`, `elevation.card`, `motion.transition.hover`.
- **Dostępność:** `fieldset` + `legend`; karta to `input type="radio"` z etykietą obejmującą tytuł i opis (nazwa „Garaż — pełny proces, 9 pozycji, 9 procesów, 4 transze”); klawiatura jak grupa radio — Tab wchodzi na wybraną kartę, strzałki zmieniają wybór; zmiana podglądu ogłaszana `aria-live="polite"`; stan wybrany niesie radio i obrys, nie samo tło; mobile — cała karta celem dotyku ≥ `size.touch-target.min`.
- **Mikrocopy:** tytuł = nazwa opcji; opis z odmianą liczebników (§ 6.3): „9 pozycji · 9 procesów · 4 transze”, „2 pozycje · 2 procesy · 1 transza”; „Pokaż wszystkie” (zdejmuje filtr typu obiektu); błąd „Wybierz szablon albo „Puste zlecenie”.”
- **Web / mobile:** web — karty w kolumnie formularza, podgląd po prawej albo w Disclosure; mobile — karty na pełną szerokość, bez podglądu (liczby w opisie), „Pokaż wszystkie szablony” pod grupą.

### 3.23 Postęp procesu (ProcedureProgress) (od 1.2.0)
Propozycja P-6 z EVM-004. Ekrany: W-06, W-10 (`breakpoint.wide`, kolumna „Postęp”), M-03.
- **Anatomia:** tekst „n z m etapów” + opcjonalny pasek: tor `color.progress.track`, wypełnienie `color.progress.fill` proporcjonalne do n / m. **Reguła liczenia:** n — etapy „Zakończony”, m — etapy procesu bez „Nie dotyczy” (etap „Nie dotyczy” nie liczy się do postępu). Gdy n = m > 0 — „n z n etapów” + ikona `circle-check` `color.icon.success` + „Wszystkie zakończone”.
  - **Status reguły — potwierdzona** (Konrad, 2026-10-04, demo EVM-014): etapy „Nie dotyczy” nie wchodzą do mianownika. Reguła doprecyzowuje `domain-model.md` → `Procedure` („etapy zakończone / wszystkie”), który nie wyłącza „Nie dotyczy” — `solution-architect` aktualizuje `domain-model.md` najpóźniej w EVM-031. Uzasadnienie: EVM-071 zaleca „Nie dotyczy” zamiast usuwania etapu, więc taki etap nie może blokować „Wszystkie zakończone”. Na tej regule opiera się scenariusz B11 (`flows/scenariusze-a-d.md`): zbędny etap „Prace sieciowe…” → „Nie dotyczy”, wynik „procesy zakończone”. Makiety W-06 i M-03 nie zależą od decyzji — żaden pokazany proces nie ma etapu „Nie dotyczy”.
  - **m = 0** (proces ma etapy, ale wszystkie są „Nie dotyczy”): tekst „Nie dotyczy” + ikona `circle-minus` `color.icon.secondary` (jak status etapu, § 4.4). Bez paska, bez „n z m” i bez „Wszystkie zakończone” — nic nie zostało zakończone.
- **Warianty:**
  - pełny — tekst + pasek (nagłówek procesu w W-06 i M-03);
  - kompaktowy — sam tekst: kolumna „Postęp” w W-10, suma etapów wszystkich procesów zlecenia, np. „14 z 30 etapów”. Gdy suma m = 0 — „—” z nazwą dostępną „Postęp: brak etapów do realizacji”;
  - proces bez etapów — „Proces nie ma etapów.” bez paska;
  - wszystkie etapy „Nie dotyczy” — „Nie dotyczy” bez paska (reguła m = 0 wyżej).
- **Stany:** statyczny — hover, fokus, wciśnięty, wyłączony: nd. (nie jest kontrolką; fokus ma nagłówek sekcji, § 3.21); błąd — nd. (brak danych → komponent nie jest pokazywany, sekcja ma własny alert, § 4.9); ładowanie — szkielet tekstu (§ 3.16).
- **Tokeny:** `color.progress.track`, `color.progress.fill` (nowe w 1.2.0), `size.progress-bar.height`, `radius.pill`, tekst `text.body-sm` (web) / `text.body` (mobile) `color.text.secondary`, odstęp tekst–pasek `space.inline.sm` (w wierszu) albo `space.stack.xs` (pod tekstem); szerokość paska wynika z kolumny (bez stałej wartości). **Nie używamy `color.sync.progress.*`** — to postęp wysyłania.
- **Dostępność:** komponent nieinteraktywny — fokus i cel dotyku (≥ `size.touch-target.min` na mobile) ma nagłówek sekcji (§ 3.21); informację niesie tekst; pasek jest dekoracyjny (`aria-hidden="true"`, nie `role="progressbar"` — to nie postęp operacji); wypełnienie ma 5,35:1 do toru i 6,74:1 do `bg.surface` (§ 2.1.4), więc pasek jest czytelny także w słońcu; tekst postępu jest częścią nazwy dostępnej nagłówka sekcji; zmiany nie są ogłaszane (zmianę statusu etapu ogłasza toast — § 4.11).
- **Mikrocopy:** „2 z 7 etapów” (gdy m = 1: „1 z 1 etapu”) · „Wszystkie zakończone” · „Proces nie ma etapów.” · „Nie dotyczy” (m = 0; nazwa dostępna nagłówka: „Opinia ppoż, nie dotyczy”)
- **Web / mobile:** web — tekst i pasek w jednym wierszu nagłówka procesu; mobile — tekst obok nazwy procesu, pasek pod nazwą na pełną szerokość nagłówka.

### 3.24 Ekran aparatu (CameraScreen) (od 1.2.0)
Propozycja P-10 z EVM-004. Ekran: M-06. Wymagania: P3, P7 pkt 3; SR-FILE-08, SR-MOB-02, -08; MASVS-PRIVACY-1. Układ w strefie kciuka — § 5.2; zapis „nic nie ginie” — § 5.4.
- **Anatomia (od góry):**
  1. **Górny pasek** `color.bg.brand-strong`, `size.app-bar.height.mobile`: „Zamknij” (IconButton `x`), **tylko numer zlecenia** (`text.heading-3`, `color.text.on-brand`; zlecenie bez numeru — „Oczekuje na numer”, § 4.15) — bez klienta, adresu i tytułu; SyncIndicator (§ 5.4).
  2. **Podgląd z aparatu** na pełną szerokość; toast „Zapisano w telefonie” nad dolnym panelem.
  3. **Dolny panel** `color.bg.brand-strong`: etap (opcjonalnie — przycisk otwierający arkusz), chipy kategorii (przewijane poziomo, zawijane przy powiększeniu czcionki), przełącznik Zdjęcie / Film (te same chipy, wybór pojedynczy), rząd sterowania: latarka · spust · licznik serii i „Gotowe” (tryb „Leworęczny” odwraca strony).
- **Warianty elementów panelu:**
  - **chip na ciemnym tle:** niewybrany — obrys `color.border.inverse`, tekst `color.text.on-brand`; wybrany — tło `color.bg.surface`, tekst `color.text.primary`, ikona `check` `color.icon.primary`; wyłączony — obrys przerywany `color.border.inverse`, ikona powodu (`mic-off` — brak mikrofonu, `hard-drive` — za mało miejsca), bez zaznaczenia, a pod przełącznikiem widoczny powód (`text.body`, `color.text.on-brand`) z przyciskiem akcji;
  - **przycisk na ciemnym tle** (akcja powodu: „Zezwól na mikrofon”, „Otwórz ustawienia”): tekst `color.text.on-brand`, obrys `color.border.inverse` `border-width.strong`, bez wypełnienia — `color.action.tertiary.text` na panelu nie spełnia 4,5:1;
  - **„Gotowe”:** Button primary `size.touch-target.field` z obrysem `color.border.inverse` `border-width.strong` (sama granica `action.primary.bg` ma do panelu 1,33:1);
  - **spust** `size.touch-target.shutter`, `radius.pill`: obrys `color.border.inverse` `border-width.indicator`, ikona `size.icon.xl` `color.icon.inverse` — `circle` (gotowy: zdjęcie albo start filmu) / `square` (nagrywanie — zatrzymaj); w trakcie nagrywania wnętrze `color.action.danger.bg` (sygnał dodatkowy, sam w sobie niewystarczający — 1,39:1 do panelu) i nad spustem czas „0:42 / 30:00” (`text.numeric`, `color.text.on-brand`);
  - **latarka:** IconButton `size.touch-target.min`, ikona `flashlight` / `flashlight-off`; włączona — tło `color.bg.surface` + ikona `color.icon.primary` (jak wybrany chip);
  - **licznik serii:** „3 zdjęcia” (`text.body`, `color.text.on-brand`).
- **Stany:** domyślny (gotowy do zdjęcia); hover — nd. (dotyk); fokus — `color.focus.ring-inverse` dla wszystkich kontrolek paska i panelu (`color.focus.ring` na `bg.brand-strong` zakazany); wciśnięty — tło `color.bg.brand` pod elementem (z `color.text.on-brand` 4,96:1); wyłączony — obrys przerywany `color.border.inverse` + powód tekstem (chip „Film”), spust nieaktywny podczas uruchamiania aparatu i „Zapisywanie filmu…”; błąd — Banner (§ 3.19) nad panelem („Nie udało się zapisać…”, mało miejsca) albo EmptyState „Nie udało się uruchomić aparatu.” z „Spróbuj ponownie”; ładowanie — „Uruchamianie aparatu…” na czarnym podglądzie (bez spinnera), „Gotowe” w stanie ładowania podczas „Zapisywanie filmu…” (§ 3.1). Uprawnienia: aparat — EmptyState (§ 3.15) przed monitem systemu, mikrofon — BottomSheet (§ 3.13); trwała odmowa — „Otwórz ustawienia”. Tryb ukrytych danych (§ 4.18) — aparat działa, pasek i arkusz wyboru zlecenia pokazują tylko numer.
- **Prywatność:** bez lokalizacji — ani prośby, ani wskaźnika (P3, SR-FILE-08); bez galerii — ani wyboru, ani zapisu do galerii systemowej (SR-MOB-02); uprawnienia wyłącznie aparat i mikrofon, każde w momencie użycia z ekranem wyjaśniającym (P7 pkt 3); górny pasek pokazuje tylko numer zlecenia.
- **Tokeny:** `color.bg.brand-strong` (pasek, panel), `color.text.on-brand`, `color.icon.inverse`, `color.border.inverse`, `color.bg.surface` + `color.text.primary` + `color.icon.primary` (wybrany chip, włączona latarka), `color.action.danger.bg` (wnętrze spustu podczas nagrywania), `color.focus.ring-inverse`, `color.bg.brand` (wciśnięty), `size.touch-target.shutter`, `size.touch-target.field`, `size.touch-target.min` (chipy, latarka, „Zamknij”, przyciski powodu), `size.icon.lg` / `size.icon.xl`, `radius.pill`, `border-width.strong` / `border-width.indicator`, `space.inline.sm` / `space.stack.sm` (odstępy między celami), `text.label-lg` (chipy), `text.body`, `text.numeric`.
- **Dostępność:** spust z nazwą „Zrób zdjęcie” / „Rozpocznij nagrywanie” / „Zatrzymaj nagrywanie”; **stan nagrywania niosą ikona (`circle` → `square`), licznik czasu i nazwa dostępna — nie kolor**; zapis ogłaszany dopiero po trwałym zapisie („Zapisano zdjęcie 3”, § 5.4); chipy jako grupy radio z etykietą („Kategoria”, „Rodzaj”); chip wyłączony z nazwą zawierającą powód („Film, niedostępny — wymaga mikrofonu”), powód także jako widoczny tekst; latarka ze stanem („Latarka, włączona”); cele ≥ `size.touch-target.min`, odstępy ≥ `space.inline.sm`; orientacja pozioma — panel po prawej (§ 5.2); zoom przyciskami (bez gestu jako jedynej drogi); bez błysków poza lampą aparatu. Kontrasty panelu: `border.inverse`, `text.on-brand`, `bg.surface` — 8,98:1 do `bg.brand-strong` (§ 2.1.4).
- **Mikrocopy:** z M-06: „Zapisano w telefonie” · „Zapisywanie filmu…” · „Uruchamianie aparatu…” · „Film wymaga dostępu do mikrofonu.” · „Za mało miejsca na film. Zwolnij miejsce w telefonie.” · „Zezwól na mikrofon” · „Otwórz ustawienia” · „Gotowe” · „3 zdjęcia” (odmiana § 6.3).
- **Web / mobile:** tylko aplikacja mobilna. Panel web nie ma ekranu aparatu (Uploader, § 3.12).

---

## 4. Wzorce

### 4.1 Formularze
- Jedna kolumna (`size.form.max-width`); grupy pól z nagłówkiem `text.heading-4`, odstęp grup `space.stack.lg`.
- **Autozapis szkicu** co kilka sekund i przy opuszczeniu ekranu — miejsce przechowywania zależy od kanału (od 1.1.0, SR-WEB-05, SR-SESS-05, TM-10):
  - **web:** szkic wyłącznie **w pamięci karty** — nigdy w `localStorage`, `sessionStorage`, IndexedDB ani ciasteczkach (komputery biura są współdzielone, a formularze zawierają dane klientów). Szkic jest przypisany do zalogowanej osoby: znika przy wylogowaniu, zamknięciu karty i zalogowaniu innej osoby; po wygaśnięciu sesji wraca tylko wtedy, gdy w tej samej karcie ponownie uwierzytelni się ta sama osoba. Informacja: „Szkic w tej karcie · 14:05” (`text.body-sm`, `color.text.secondary`) z podpowiedzią „Szkic znika po zamknięciu karty lub wylogowaniu.” — mikrocopy nie obiecuje trwałego zapisu;
  - **mobile:** szkic w zaszyfrowanej bazie aplikacji (jak kolejka, SR-MOB-01): „Szkic zapisany w telefonie · 14:05”; powrót do formularza przywraca szkic.
- Przycisk główny „Zapisz …” na dole (mobile — przyklejony dolny pasek `elevation.bottom-bar`); nie blokujemy przycisku przy błędach — po kliknięciu pokazujemy podsumowanie błędów na górze (lista linków do pól) i ustawiamy fokus na podsumowaniu.
- Minimum pisania w terenie: wybór zamiast wpisywania (chipy, listy), wartości domyślne, dyktowanie systemowe w polach notatek.

### 4.2 Tabele i listy
- Kolumny priorytetowe i zachowanie responsywne: § 3.6. Sortowanie domyślne: najpilniejsze (po terminie, potem termin rosnąco).
- Wiersz „po terminie”: odznaka `color.status.payment.overdue` / tekst terminu `color.text.error` + ikona `alarm-clock` (nie samo zaczerwienienie).
- Liczby i kwoty `text.numeric` do prawej; daty `text.numeric`.
- Długie listy: paginacja (web) lub „Pokaż więcej” / doczytywanie (mobile) z zachowaniem pozycji przy powrocie.

### 4.3 Filtry
§ 3.7. Zapisane widoki odpowiadają na pytania biura: „Czekamy na OSD”, „Po terminie”, „Nieopłacone”, „Moje na dziś”. Filtry i sortowanie zapamiętane per użytkownik **poza magazynami przeglądarki** (od 1.1.0): docelowo preferencje po stronie serwera (do decyzji `solution-architect`, EVM-004 → „Uwagi do rozważenia”); do tego czasu tylko w pamięci karty i w adresie URL w zakresie z § 3.7.

### 4.4 Statusy (AC5)
Każda wartość = **unikalna ikona (w obrębie grupy) + etykieta PL + rola koloru**. Tokeny: `color.status.{grupa}.{klucz}.{bg|text|icon|border}`; etykieta i ikona także w `$extensions.pl.eviacharge.status` tokenu. Komponent: § 3.9.

**Mapowanie kod modelu → klucz tokenu (od 1.1.0):** kody statusów pochodzą z `docs/architecture/domain-model.md` (`snake_case`, identyczne w bazie i API); **klucz tokenu = kod modelu zapisany w `kebab-case`** (podkreślnik → łącznik: `in_progress` → `in-progress`, `not_applicable` → `not-applicable`, `on_hold` → `on-hold`). Jedna reguła dla web i mobile, bez listy wyjątków. Klucze `quote` i `issued` z 1.0.0 mają `$deprecated` (DTCG 2025.10 § 6.3.1) — transformacja (EVM-006) ich nie eksportuje, a usuwamy je w najbliższej wersji MAJOR. Wartość nieznana (nowsza wersja API, ADR-0004) — odznaka „Nieznany status” (§ 3.9.1, od 1.2.0); jej tokeny `color.status.unknown.*` są jedynym wyjątkiem od reguły mapowania: nie odpowiadają kodowi modelu i są wspólne dla wszystkich grup.

**Status zlecenia** (`color.status.order.*`)

| Kod modelu | Klucz tokenu | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|---|
| `new` | `new` | Nowe | `inbox` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `quoting` | `quoting` (do 1.1.0: `quote` — wycofywany) | Wycena | `calculator` | fioletowy | `palette.violet.100` / `violet.900` / `violet.700` |
| `accepted` | `accepted` | Zaakceptowane | `thumbs-up` | niebieski | `palette.blue.100` / `blue.900` / `blue.700` |
| `in_progress` | `in-progress` | W realizacji | `wrench` | morski (marka) | `palette.teal.100` / `teal.900` / `teal.700` |
| `completed` | `completed` | Zakończone | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `settled` | `settled` | Rozliczone | `banknote` | zielony mocny | `palette.green.800` / `neutral.0` / `neutral.0` |
| `on_hold` | `on-hold` | Wstrzymane | `circle-pause` | bursztynowy | `palette.amber.100` / `amber.900` / `amber.700` |
| `cancelled` | `cancelled` | Anulowane | `ban` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |

**Status etapu** (`color.status.stage.*`)

| Kod modelu | Klucz tokenu | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|---|
| `todo` | `todo` | Do zrobienia | `circle` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `in_progress` | `in-progress` | W toku | `circle-play` | morski | `palette.teal.100` / `teal.900` / `teal.700` |
| `waiting` | `waiting` | Czekamy na… | `hourglass` | bursztynowy | `palette.amber.100` / `amber.900` / `amber.700` |
| `done` | `done` | Zakończony | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `not_applicable` | `not-applicable` | Nie dotyczy | `circle-minus` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `blocked` | `blocked` | Zablokowany | `octagon-alert` | czerwony | `palette.red.100` / `red.900` / `red.700` |

**„Czekamy na…” — rozwinięcie (od 1.1.0, decyzja Konrada P1 z EVM-002).** Czekamy na klienta albo na stronę (`waitingOn` = `customer` / `party`). Odznaka ma zawsze etykietę „Czekamy na…”; w szczegółach, na kartach i w kolumnie „Czekamy na” obok odznaki stoi rozwinięcie:
- „Czekamy na: klient · od 3 dni”;
- „Czekamy na: [nazwa strony] ([rodzaj strony]) · od 15 dni”, np. „Czekamy na: Stoen Operator (OSD) · od 15 dni” (rodzaj strony — etykiety z § 6.2).

Licznik dni liczony od `waitingSince` w `Europe/Warsaw`, `text.numeric` („od dziś”, „od 1 dnia”, „od 3 dni” — odmiana § 6.3); **powyżej 14 dni** — ikona `triangle-alert` `color.icon.warning` i tekst `color.text.warning` (próg bez zmian). Nazwa dostępna odznaki z rozwinięciem: „Status: Czekamy na Stoen Operator (OSD) od 15 dni”.

**Status etapu płatności** (`color.status.payment.*`)

| Kod modelu | Klucz tokenu | Etykieta | Ikona Lucide | Ton | bg / text / icon |
|---|---|---|---|---|---|
| `planned` | `planned` | Planowana | `calendar-clock` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |
| `invoiced` | `invoiced` (do 1.1.0: `issued` — wycofywany) | Wystawiona | `file-text` | niebieski | `palette.blue.100` / `blue.900` / `blue.700` |
| `paid` | `paid` | Opłacona | `circle-check` | zielony | `palette.green.100` / `green.900` / `green.700` |
| `cancelled` | `cancelled` (nowy w 1.1.0) | Anulowana | `ban` | neutralny | `palette.neutral.100` / `neutral.800` / `neutral.700` |

**Oznaczenie wyliczane „Po terminie”** (`color.status.payment.overdue.*`, od 1.1.0 — nie jest statusem zapisanym w modelu): etap płatności w stanie `invoiced` z terminem (`dueDate`) wcześniejszym niż dziś w `Europe/Warsaw` (`isOverdue`) pokazuje **jedną mocną odznakę „Po terminie”** (`alarm-clock`, `palette.red.800` / `neutral.0` / `neutral.0`) **zamiast** „Wystawiona”; nazwa dostępna: „Wystawiona, po terminie od 5 dni”. Liczba dni po terminie obok odznaki (`text.numeric`, `color.text.error`). Filtr „Po terminie” = `isOverdue`; „Nieopłacone” = wszystkie `invoiced` (także po terminie).

Ikony są unikalne w obrębie każdej grupy (z pominięciem kluczy wycofywanych); `circle-check` celowo oznacza „zakończone/opłacone”, a `ban` — „anulowane” we wszystkich grupach (spójne znaczenie). Kontrasty wszystkich par: § 2.1.4 (tekst odznak ≥ 7,13:1, ikony ≥ 4,51:1).

**Weryfikacja rozróżnialności bez koloru (2026-10-02):** odznaki wszystkich 18 wartości wyrenderowano z ikonami Lucide 1.50.0 i sprawdzono w skali szarości oraz w symulacji deuteranopii i protanopii (macierze Machado i in. 2009, nasilenie 1,0). Wynik: każda wartość pozostaje rozróżnialna dzięki unikalnemu kształtowi ikony i etykiecie; tony zlewające się w symulacji (zielony ↔ bursztynowy, fioletowy ↔ niebieski, czerwony subtelny ↔ neutralny przy protanopii) nie niosą samodzielnie informacji. Etykiety pozostają czytelne w skali szarości (kontrast luminancji tekstu ≥ 7:1 nie zależy od barwy). Wariant mocny (Rozliczone, Po terminie) wyróżnia się jasnością tła także w skali szarości. Zrzut z weryfikacji: lokalnie (poza repozytorium); powtórzyć w przeglądzie UX pierwszej implementacji odznaki.

**Uzupełnienie 1.1.0 (2026-10-03):** wartości i oznaczenia jest teraz 19 (zlecenie 8, etap 6, płatność 4 + „Po terminie”). Nowa odznaka „Anulowana” (płatność) używa pary ikona + ton już zweryfikowanej dla „Anulowane” (zlecenie); od „Planowana” (ten sam ton neutralny) odróżnia ją kształt ikony (`ban` vs `calendar-clock`) i etykieta — tak samo jak „Nowe” i „Anulowane” w grupie zlecenia. „Wycena” i „Wystawiona” zmieniają tylko klucz tokenu (wygląd bez zmian). Powtórzyć symulację w przeglądzie UX pierwszej implementacji odznaki.

### 4.5 Oś czasu
§ 3.10. **Autor w nagłówku wpisu, treść bezosobowa** (od 1.2.0): `User` ma tylko `displayName` (bez płci), więc autor wpisu występuje wyłącznie jako `displayName` w nagłówku („Anna Testowa · dziś, 11:02”), a treść zdarzenia nie odmienia czasownika przez osobę (§ 6.1). Zmiana statusu w dzienniku: „Zmiana statusu etapu „Warunki przyłączenia i projekt umowy” (Uzgodnienia z OSD): «Czekamy na…» · Czekamy na: Stoen Operator (OSD)” (odznaka kompaktowa + etykieta + rozwinięcie z § 4.4). Dodane media: „Dodano 12 zdjęć · W trakcie prac”. Wpis zdarzenia nie zawiera wartości danych osobowych ani kwot (`domain-model.md` → `TimelineEntry`).

### 4.6 Galeria
§ 3.11. Grupowanie po kategorii/etapie, filtr „Niewysłane”; przy zleceniu licznik „48 zdjęć · 3 niewysłane”.

### 4.7 Kolejka uploadu
§ 3.12 i § 5.4. Ekran „Kolejka” (mobile): sekcje „Wymaga uwagi” (na górze — § 4.16, od 1.2.0), „Błąd” (z „Ponów wszystkie”), „Czeka na Wi-Fi”, „Wysyłanie”, „W kolejce”, „Wysłane dziś” (zwinięta — Disclosure, § 3.21). Nad sekcjami podsumowanie z liczbami i stanem przesyłania z § 5.4 („Offline · 5 w kolejce”, „Wysyłanie 3 z 12…”, „2 filmy czekają na Wi-Fi”, „Wszystko wysłane · Zsynchronizowano 14:05”) — widoczne także wtedy, gdy kapsuła pokazuje „Wymaga uwagi” (od 1.2.0). Web: panel postępu przy zleceniu.

### 4.8 Puste stany
§ 3.15. Przykłady: „Nie masz jeszcze zleceń. [Dodaj zlecenie]” · „Brak zleceń spełniających filtry. [Wyczyść filtry]” · „To zlecenie nie ma jeszcze zdjęć. [Zrób zdjęcie]”.

### 4.9 Błędy
- **Walidacja pola:** komunikat pod polem (§ 3.2) + podsumowanie przy zapisie.
- **Błąd operacji w miejscu:** alert `color.feedback.error.*` w sekcji, której dotyczy, z akcją wyjścia („Spróbuj ponownie”, „Przejdź do …”).
- **Błąd ekranu (nie wczytano danych):** pusty stan z ikoną `circle-alert`, opisem i „Spróbuj ponownie”; jeśli są dane z pamięci — pokazujemy je z banerem „Dane mogą być nieaktualne (z 14:05)”.
- **Konflikt edycji:** „Ktoś zmienił to zlecenie w międzyczasie. Twoje zmiany zachowaliśmy — porównaj i zapisz ponownie.”
- Treść komunikatów: § 6.4. Nigdy nie tracimy danych wpisanych przez użytkownika z powodu błędu.

### 4.10 Offline
§ 5.4. Web: baner tylko jeśli operacja wymaga sieci; formularze nie są czyszczone, a wpisane dane zostają **wyłącznie w pamięci karty** (zasada szkicu z § 4.1 — nigdy w magazynach przeglądarki). Panel nie ma kolejki offline, więc mikrocopy nie obiecuje zapisu w tle (od 1.1.0): „Brak połączenia. Wpisane dane zostają w tej karcie — zapisz je, gdy połączenie wróci.” Przycisk zapisu w tym czasie wyłączony z podpowiedzią „Zapiszesz po powrocie połączenia.”

### 4.11 Potwierdzenia i „Cofnij”
| Operacja | Wzorzec |
|---|---|
| **Odwracalna tą samą rolą** — zmiana statusu, dla której tabela przejść w `docs/architecture/domain-model.md` ma przejście odwrotne prowadzące **dokładnie do poprzedniego stanu**, dostępne tej samej roli **bez step-upu** (np. etap `in_progress → done` i z powrotem `done → in_progress`); soft delete, które ta sama rola potrafi przywrócić | wykonaj od razu + toast „… [Cofnij]” (10 s). „Cofnij” wywołuje **komendę przejścia odwrotnego** (z tymi samymi parametrami, które użytkownik mógłby podać ręcznie, np. poprzednia strona i data „od kiedy”) albo przywrócenie — **nigdy** przywracania pól ani `PATCH` statusu (SR-API-07, SR-AUTHZ-10). Lista przejść z „Cofnij”: [`flows/04-aktualizacja-etapu.md`](flows/04-aktualizacja-etapu.md) |
| **Bez przejścia odwrotnego**, ale z dalszą drogą w tabeli przejść (np. etap `todo → in_progress`, `todo → waiting`; zlecenie `new → quoting`) | wykonaj od razu + toast bez „Cofnij” („Zmieniono status etapu na W toku.”); kolejną zmianę użytkownik wybiera z menu statusu |
| **Odwrócenie wymaga Administratora ze step-upem albo operacja jest nieodwracalna** — wystawienie faktury (`planned → invoiced`), odnotowanie wpłaty (`invoiced → paid`), anulowanie transzy, anulowanie zlecenia, rozliczenie zlecenia (`completed → settled`), trwałe usunięcie, usunięcie niewysłanego pliku z urządzenia, wylogowanie z niewysłanymi danymi | dialog potwierdzenia **z podsumowaniem skutku** (np. kwota, numer faktury, data, które transze zostaną anulowane): tytuł-pytanie z nazwą obiektu („Wystawić fakturę dla transzy „Zaliczka”?”), skutek („Cofnąć to może tylko administrator.”), przyciski z czasownikiem („Wystaw fakturę”; danger dla operacji niszczących) i „Anuluj” (tertiary); fokus domyślnie na „Anuluj”. Operacje Administratora ze step-upem dodatkowo przechodzą przez dialog ponownego uwierzytelnienia ([`flows/01-logowanie-mfa.md`](flows/01-logowanie-mfa.md), W-04) |

Usunięcie **niewysłanego** pliku z urządzenia jest zawsze nieodwracalne → zawsze dialog. Zmiana 1.1.0: w 1.0.0 każda „zmiana statusu” była opisana jako odwracalna — to nieprawda dla przejść bez drogi powrotnej i dla przejść, których odwrócenie zarezerwowano dla Administratora ze step-upem (konsultacja `security-engineer`, EVM-004, M2).

### 4.12 Szkielety ładowania
§ 3.16. Szkielet od pierwszej klatki dla list, kart i szczegółów; częściowe dane pokazujemy od razu (najpierw nagłówek zlecenia, potem sekcje).

### 4.13 Brak uprawnień
- Elementów, do których użytkownik nie ma dostępu, nie pokazujemy w nawigacji.
- **Wejście z linku na zasób niedostępny albo usunięty** (od 1.1.0): API zwraca `404 not_found` w obu przypadkach (`docs/architecture/api-guidelines.md`, SR-AUTHZ-02), więc UI pokazuje **jeden** pusty stan „Nie znaleziono …” z ikoną `search-x` — „Nie znaleziono zlecenia. Mogło zostać usunięte albo nie masz do niego dostępu. [Wróć do listy]” — i nie ujawnia, czy zasób istnieje. Ekran nie pokazuje żadnych danych zasobu, także z pamięci listy (np. nazwy klienta z poprzedniego ekranu), a tytuł karty to „Nie znaleziono · EVia Manager”.
- **„Nie masz dostępu” z ikoną `lock`** — tylko dla akcji i plików w widocznym kontekście, do których rola nie ma prawa (`403`), np. plik `identity_data` lub `building_security` dla roli Tylko odczyt: wiersz z ikoną `lock` i tekstem „Plik dostępny dla administratora i edytora”.
- Akcja niedozwolona w widocznym kontekście: przycisk wyłączony z podpowiedzią „Korektę płatności może wykonać tylko administrator.” Rola Tylko odczyt nie widzi akcji edycji wcale (akcje ukryte, nie wyłączone).

### 4.14 Stany pliku na serwerze (od 1.2.0)
Propozycja P-7 z EVM-004. Ekrany: W-09, M-08. Wymagania: P5, P6; SR-FILE-03, -05, -07, -12; ASVS V5.4.3. Stany wysyłania z urządzenia — § 5.4; „Wymaga uwagi” w Kolejce — § 4.16.
- **Anatomia znacznika:** ikona `size.icon.sm` + etykieta (`text.label` web, `text.body-sm` mobile) na tle tonu, `radius.pill`, padding `space.inset.xs` / `space.inset.sm`, odstęp `space.inline.xs`. W kaflu galerii znacznik stoi **pod miniaturą** (pełna etykieta, zawijana); w wierszu dokumentu i w panelu postępu — obok nazwy pliku. **Nigdy sama ikona.**
- **Warianty miejsca:** kafel galerii (pod miniaturą), wiersz dokumentu i panel postępu (obok nazwy pliku), lightbox (pod metadanymi), dialog „Pobierz oryginał” (nad treścią); web (W-09) i mobile (M-08, bez akcji).
- **Stany pliku → znacznik:**

| Stan pliku | Ikona | Etykieta | Tokeny | Podgląd i pobranie | Akcje |
|---|---|---|---|---|---|
| plik z innego urządzenia jeszcze nie dotarł (`origin = mobile`, medium bez pliku albo `pending_upload`) | `clock` | web: „Czeka na plik z telefonu · [autor] · od [czas]”; mobile (kafel): „Czeka na plik”, pełny tekst w podglądzie i nazwie dostępnej | `color.sync.queued.*` | brak; kafel bez miniatury — ikona typu (`image` / `video`) | **bez procentów, paska i akcji wysyłki** (wysyłką steruje telefon autora); metadane wg roli (web) |
| medium z panelu bez pliku poza kartą, która je wysyła (`origin = web`, `pending_upload`) | `clock` | „Czeka na plik · [autor] · od [czas]” | `color.sync.queued.*` | brak | jw. |
| `uploaded`, `scanning`, `clean`, `processing` | `scan-search` | „Sprawdzanie pliku” | `color.sync.queued.*` | **brak podglądu i pobrania** (do `ready`) | — |
| `ready` | — | — (miniatura) | — | miniatura, lightbox; pobranie wg roli | wg roli (W-09) |
| `quarantined` (wynik skanu albo `type_mismatch`) | `triangle-alert` | „Wymaga uwagi” | `color.sync.error.*` (jak § 4.16) | **brak podglądu i pobrania** | Administrator w panelu: przyczyna i „Skanuj ponownie” (step-up, W-04); Edytor, Tylko odczyt i telefon: „Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.” (telefon: „…Biuro sprawdzi plik.”) — **bez przyczyny i bez akcji** (P5 pkt 4); **żadnego zwolnienia bez skanu** (P5 pkt 5) |
| `failed` (`processing_error`, po `clean`) | `image` | „Nie udało się przygotować podglądu. Spróbujemy ponownie.” | `color.icon.secondary`, tekst `color.text.secondary` | Administrator i Edytor — oryginał; Tylko odczyt — brak | — |
| **film > 2 GB z przeglądarki** po pozytywnej walidacji strukturalnej (ffprobe) — SR-FILE-12 | `info` | **„Nieskanowany antywirusem — plik za duży”** | `color.feedback.info.*` | **tylko podgląd 720p** (z piaskownicy); oryginał wyłącznie jako załącznik — Administrator i Edytor (Tylko odczyt nie pobiera — P6) | bez „Skanuj ponownie” |

- **Film większy niż limit skanu — zasady:** znacznik dotyczy **wyłącznie** filmu > 2 GB wysłanego z przeglądarki (filmy z telefonu mieszczą się w limicie skanu — P5 pkt 3) i pojawia się **dopiero po pozytywnej walidacji ffprobe**; wcześniej plik ma stan „Sprawdzanie pliku”, a niezgodność daje kwarantannę `type_mismatch` („Wymaga uwagi”). Znacznik widać **przy miniaturze, w podglądzie (lightbox) i przy akcji „Pobierz oryginał”** (pozycja menu i dialog pobrania) i jest częścią nazwy dostępnej. Treść nie używa słów „bezpieczny” ani „sprawdzony”. Ton `info` — zgodnie z P5 to metryka bez alertu (ryzyko rezydualne TM-38).
- **Stany komponentu:** znacznik jest nieinteraktywny — hover, fokus, wciśnięty, wyłączony: nd. (akcje to osobne przyciski, § 3.1; fokus ma kafel lub wiersz — § 3.11, § 3.6); błąd — wiersze tabeli; ładowanie — szkielet kafla (§ 3.16). Filtr „Wymaga uwagi (n)” — FilterChip (§ 3.7).
- **Tokeny:** `color.sync.queued.*`, `color.sync.error.*`, `color.feedback.info.*`, `color.icon.secondary`, `size.icon.sm`, `text.label` / `text.body-sm`, `radius.pill`, `space.inset.xs`, `space.inset.sm`, `space.inline.xs`.
- **Dostępność:** znacznik nieinteraktywny — fokus (pierścień `color.focus.ring`) i cel dotyku (kafel ≥ `size.thumbnail.md`, wiersz ≥ `size.touch-target.min` na mobile) ma miniatura albo wiersz, a akcje („Skanuj ponownie”, „Pobierz oryginał”) to osobne przyciski (§ 3.1); stan jest częścią nazwy dostępnej miniatury lub wiersza („Film, W trakcie prac, nieskanowany antywirusem — plik za duży”, „Zdjęcie, W trakcie prac, wymaga uwagi”); zmiany stanu (np. „Sprawdzanie pliku” → gotowe) ogłaszane zbiorczo `aria-live="polite"`, bez ogłaszania każdego pliku; kolor nie jest jedynym nośnikiem (ikona + etykieta).
- **Mikrocopy:** etykiety z tabeli · „Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.” · „Plik zatrzymany przez skan bezpieczeństwa. Biuro sprawdzi plik.” · „Skanuj ponownie” · „Wymaga uwagi (n)” (filtr).
- **Web / mobile:** web (W-09) — wszystkie stany, przyczyna kwarantanny tylko dla Administratora; mobile (M-08) — znaczniki bez przyczyny i bez pobierania oryginałów; własne niewysłane pliki zawsze pokazują stan z Kolejki tego telefonu (§ 5.4), nie z serwera.

### 4.15 Oczekuje na numer (od 1.2.0)
Propozycja P-8 z EVM-004. Ekrany: M-03, M-05, M-06, M-07, M-10. Źródła: `offline-sync.md` (`CreateQuickWorkOrder`), `domain-model.md` — D8 (numer nadaje serwer).
- **Kiedy:** szybkie zlecenie zapisane w telefonie, zanim serwer zwróci wynik — numer zlecenia nadaje wyłącznie serwer.
- **Anatomia:** odznaka w miejscu numeru zlecenia: ikona `clock` `size.icon.sm` (`color.sync.queued.icon`) + etykieta „Oczekuje na numer” (`text.label`, `color.sync.queued.text`) na `color.sync.queued.bg`; `radius.pill`, `size.badge.height`, padding `space.inset.xs` / `space.inset.sm`, odstęp `space.inline.xs`.
- **Warianty:** w treści — karta listy (M-05), arkusz „Do którego zlecenia?” (M-06), element Kolejki (M-07), formularz po zapisie (M-10); w górnym pasku (M-03, aparat) — kapsuła z własnym tłem jak SyncIndicator (`sync.queued.bg` do `bg.brand-strong` 8,24:1 — § 2.1.4).
- **Przejścia:** wynik `applied` albo `duplicate` → numer (np. „ZL-2026-0042”) zastępuje odznakę i jest ogłaszany: „Zlecenie dostało numer ZL-2026-0042.”; zależne zdjęcia i wpisy ruszają w Kolejce; wynik `rejected` → element w Kolejce w „Wymaga uwagi” (§ 4.16) z „Utwórz ponownie”.
- **Stany:** statyczna — hover, fokus, wciśnięty, wyłączony: nd. (nieinteraktywna; fokus ma karta albo tytuł); błąd — nd. (odrzucenie prowadzi do § 4.16); ładowanie — nd. (sam stan oznacza oczekiwanie, bez spinnera).
- **Tokeny:** `color.sync.queued.{bg|text|icon}`, `size.icon.sm`, `text.label`, `radius.pill`, `size.badge.height`, `space.inset.xs`, `space.inset.sm`, `space.inline.xs`.
- **Dostępność:** odznaka nieinteraktywna — fokus i cel dotyku (≥ `size.touch-target.min`) ma karta, element Kolejki albo pozycja arkusza; nazwa dostępna „Zlecenie oczekuje na numer” (karta: „Zlecenie oczekuje na numer, Dom — sam montaż, ul. Fikcyjna 12, Piaseczno, zapisano w telefonie 13:40”); nadanie numeru ogłaszane raz (ogłoszenie platformy o niskim priorytecie), bez przerywania pracy; nigdy sama ikona.
- **Mikrocopy:** „Oczekuje na numer” · „Numer nadamy po synchronizacji.” · „Zlecenie dostało numer ZL-2026-0042.” · „Wyślemy po utworzeniu zlecenia”.
- **Web / mobile:** tylko aplikacja mobilna; w panelu zlecenie istnieje dopiero z numerem (W-06 — baner „Zlecenie założone w terenie”).

### 4.16 Wymaga uwagi w Kolejce i SyncIndicator (od 1.2.0)
Propozycja P-9 z EVM-004. Ekrany: M-03, M-04, M-07, M-10 i AppBar (SyncIndicator — każdy ekran mobile); ten sam wygląd ma znacznik pliku w kwarantannie w W-09 i M-08 (§ 4.14). Źródła: `offline-sync.md` (zasada 2), `domain.md` („Wymaga uwagi”), P5.
- **Kiedy:** element nie trafił do archiwum zlecenia automatycznie i czeka na decyzję człowieka — odrzucona mutacja (`rejected`: `target_unavailable`, `forbidden`, `validation_failed`, `template_unavailable`, `id_conflict`) albo plik w kwarantannie. Nic nie znika bez decyzji użytkownika.
- **Wygląd — wszędzie taki sam:** ikona `triangle-alert` + etykieta „Wymaga uwagi” + `color.sync.error.*`. Od „Błąd wysyłania” (`cloud-alert`, te same tokeny) odróżniają go ikona i etykieta.
- **Warianty:** stan kapsuły SyncIndicator; sekcja i element Kolejki; znacznik elementu na ekranie zlecenia, wpisu i szybkiego zlecenia; powód — odrzucona mutacja (wpis, zdjęcie), odrzucone szybkie zlecenie, plik w kwarantannie.
- **Anatomia:**
  - **SyncIndicator** (§ 5.4): stan „Wymaga uwagi · 2” — kapsuła `color.sync.error.bg` (7,35:1 do paska), ikona `triangle-alert` `color.sync.error.icon`, tekst `color.sync.error.text`; **najwyższy priorytet: Wymaga uwagi > Błąd > Offline > Czeka na Wi-Fi > Wysyłanie > Zsynchronizowano**; dotknięcie → Kolejka, sekcja „Wymaga uwagi”.
  - **Stan przesyłania nie znika pod „Wymaga uwagi”.** Plik w kwarantannie może zostać w telefonie długo (kwarantanna do 30 dni — P5; jedyna akcja to „Usuń z telefonu”), a kapsuła przez cały ten czas pokazuje „Wymaga uwagi”. Dlatego:
    - baner offline pod AppBar jest widoczny zawsze, gdy nie ma połączenia — niezależnie od stanu kapsuły (§ 5.4, wiersz „Offline”);
    - nazwa dostępna kapsuły zawiera stan przesyłania — czyli stan, który kapsuła pokazałaby bez „Wymaga uwagi” (Dostępność niżej);
    - licznik niewysłanych na pozycji „Kolejka” w BottomNav (§ 3.18) działa niezależnie od kapsuły;
    - podsumowanie Kolejki (M-07) zawsze pokazuje stan przesyłania (§ 4.7).
  - **Kolejka** (M-07): sekcja „Wymaga uwagi (n)” na górze, nad „Błąd”. Element: miniatura albo ikona typu (w trybie ukrytych danych — zawsze ikona typu, § 4.18), typ i numer zlecenia, powód prostymi słowami, obrys lewy `border-width.indicator` `color.feedback.error.border`, akcje jako widoczne przyciski.
  - **Inne ekrany** (M-03, M-04, M-10): element, którego dotyczy (wpis, szybkie zlecenie), ma znacznik „Wymaga uwagi” i przycisk „Przejdź do kolejki”.
- **Akcje (telefon tylko dodaje):**
  - odrzucony wpis albo zdjęcie — „Dodaj do innego zlecenia” (nowa komenda `CreateNote` / `CreateMediaAsset` z nowym identyfikatorem, bez edycji) · „Usuń z telefonu”;
  - odrzucone szybkie zlecenie — „Utwórz ponownie” (formularz wypełniony danymi, nowe identyfikatory) · „Usuń z telefonu” (dialog z liczbą zależnych elementów);
  - plik w kwarantannie — **bez przyczyny** (P5 pkt 4): „Plik zatrzymany przez skan bezpieczeństwa. Biuro sprawdzi plik.” · tylko „Usuń z telefonu”;
  - „Usuń z telefonu” — zawsze dialog z § 4.11 (usunięcie niewysłanego elementu jest nieodwracalne).
- **Stany:** znacznik — statyczny (hover, fokus, wciśnięty, wyłączony: nd.); kapsuła SyncIndicator — stany z § 5.4 (fokus `color.focus.ring-inverse`, wciśnięty `color.bg.brand`); przyciski — § 3.1; błąd — nd. (stan sam jest sygnałem); ładowanie — nd. (Kolejka jest lokalna; „Dodaj do innego zlecenia” otwiera arkusz wyboru zlecenia z lokalnej bazy).
- **Tokeny:** `color.sync.error.{bg|text|icon}`, `color.feedback.error.border`, `border-width.indicator`, `size.icon.sm` (znacznik) / `size.icon.md` (kapsuła), `text.label`, `radius.pill`, `size.badge.height`, przyciski `size.touch-target.min`, odstępy `space.stack.sm`, separator `color.border.subtle`.
- **Dostępność:** kapsuła z nazwą „Wymaga uwagi: 2 elementy. [stan przesyłania]. Otwórz kolejkę”. Stan przesyłania to tekst stanu następnego wg priorytetu (§ 5.4), np. „Wymaga uwagi: 1 element. Offline, 5 w kolejce. Otwórz kolejkę”, „Wymaga uwagi: 1 element. 2 filmy czekają na Wi-Fi. Otwórz kolejkę”, „Wymaga uwagi: 1 element. Zsynchronizowano 14:05. Otwórz kolejkę”. Element z nazwą dostępną (typ, zlecenie, powód); pojawienie się elementu „Wymaga uwagi” ogłaszane raz, zbiorczo (§ 5.4); akcje jako przyciski, nie gesty (§ 5.1), cele ≥ `size.touch-target.min`; akcje niszczące oddzielone od częstych; kolor nie jest jedynym nośnikiem.
- **Mikrocopy:** „Wymaga uwagi” · „Wymaga uwagi · 2” · nazwa dostępna kapsuły „Wymaga uwagi: 1 element. Offline, 5 w kolejce. Otwórz kolejkę” · „Zlecenie zostało usunięte albo nie masz do niego dostępu.” · „Zlecenie nie zostało utworzone — [powód prostymi słowami].” · „Plik zatrzymany przez skan bezpieczeństwa. Biuro sprawdzi plik.” · „Dodaj do innego zlecenia” · „Utwórz ponownie” · „Usuń z telefonu” · „Przejdź do kolejki”.
- **Web / mobile:** mobile — Kolejka, SyncIndicator i znaczniki elementów; web — wyłącznie znacznik pliku w kwarantannie i filtr „Wymaga uwagi (n)” w W-09 (§ 4.14).

### 4.17 Sesja wygasa (od 1.2.0)
Propozycja P-11 z EVM-004. Ekrany: wszystkie ekrany panelu web po zalogowaniu. Wymagania: WCAG 2.2.1; SR-SESS-03, SR-SESS-05, SR-WEB-05; ASVS V7.3.1, V7.3.2, V7.4.1, V14.3.1.
- **Kiedy:** 2 min przed końcem bezczynności (60 min — SR-SESS-03) albo 10 min przed limitem 12 h od zalogowania — co nastąpi wcześniej.
- **Źródło czasu — serwer:** czas końca bezczynności i limit 12 h podaje serwer; licznik w karcie jest tylko informacyjny. Karta pyta serwer o stan sesji przed pokazaniem dialogu, po wybudzeniu komputera i po powrocie do karty — dialog nigdy nie pojawia się (ani nie znika) na podstawie samego zegara karty. Każda karta pyta serwer, więc kilka kart pokazuje spójny stan: przedłużenie w jednej karcie zamyka dialog w pozostałych przy ich najbliższym sprawdzeniu.
- **Anatomia:** AlertDialog (§ 3.13, `size.dialog.width.sm`): tytuł, treść z czasem, przyciski.
- **Warianty:**
  - **„bezczynność”:** tytuł „Sesja wkrótce wygaśnie”; treść „Sesja wygaśnie za 2 min z powodu braku aktywności.”; „Przedłuż sesję” (primary) i „Wyloguj” (tertiary).
  - **„limit 12 h”** (także gdy przedłużenie bezczynności sięgnęłoby poza limit): tytuł „Sesja wkrótce wygaśnie”; treść „Sesja wygaśnie o 18:05 (limit 12 godzin od zalogowania). Zapisz zmiany — potem zaloguj się ponownie.”; **bez „Przedłuż sesję”** — „Rozumiem” (primary, zamyka dialog) i „Wyloguj” (tertiary).
- **Zachowanie:**
  - **„Przedłuż sesję”** to żądanie do serwera; przedłuża **wyłącznie bezczynność**, nigdy poza 12 h od zalogowania. Karta nie podtrzymuje sesji sama — bez żądań „podtrzymujących” w tle.
  - **Po wygaśnięciu albo odpowiedzi `401`:** karta natychmiast usuwa dane z widoku i z pamięci podręcznej zapytań, przechodzi do W-01 z komunikatem „Sesja wygasła…” (§ 6.4), a tytuł karty to „Logowanie · EVia Manager”. Zostaje tylko szkic formularza w pamięci karty, przypisany do osoby (§ 4.1) — wraca wyłącznie po ponownym zalogowaniu tej samej osoby w tej karcie.
  - **„Wyloguj”** — jak SR-SESS-05: unieważnia sesję na serwerze, czyści pamięć podręczną zapytań, `Clear-Site-Data`, odrzuca szkice (§ 4.1).
  - Gdy otwarty jest inny dialog (np. formularz), ostrzeżenie zastępuje go na czas wyboru (bez dialogu na dialogu, § 3.13), a formularz wraca z danymi.
- **Stany:** domyślny (dialog z odliczaniem); hover, fokus, wciśnięty — przyciski wg § 3.1; wyłączony — „Przedłuż sesję” offline, z podpowiedzią „Przedłużysz po powrocie połączenia.”; błąd — alert w dialogu „Nie udało się przedłużyć sesji. Spróbuj ponownie.”, a `401` jak wygaśnięcie; ładowanie — „Przedłuż sesję” w stanie ładowania.
- **Tokeny:** jak AlertDialog (§ 3.13) — `size.dialog.width.sm`, `radius.dialog`, `elevation.dialog`, `layer.dialog`, scrim `color.bg.scrim`, tytuł `text.heading-3`, treść `text.body`, czas `text.numeric`, padding `space.inset.lg`.
- **Dostępność:** `role="alertdialog"` z `aria-labelledby` i `aria-describedby`, pułapka fokusu (§ 3.13), pierścień `color.focus.ring`; przyciski `size.control.height.web.md` (cel ≥ `size.touch-target.web-min`); fokus na „Przedłuż sesję” (wariant 12 h — na „Rozumiem”), po zamknięciu wraca do poprzedniego elementu; pozostały czas ogłaszany `aria-live="polite"` co minutę (nie co sekundę); Esc zamyka dialog bez przedłużenia; czas jest też tekstem w treści, nie tylko licznikiem.
- **Mikrocopy:** „Sesja wkrótce wygaśnie” · „Sesja wygaśnie za 2 min z powodu braku aktywności.” · „Przedłuż sesję” · „Wyloguj” · „Sesja wygaśnie o 18:05 (limit 12 godzin od zalogowania). Zapisz zmiany — potem zaloguj się ponownie.” · „Rozumiem” · „Nie udało się przedłużyć sesji. Spróbuj ponownie.” · po wygaśnięciu — „Sesja wygasła…” (§ 6.4).
- **Web / mobile:** tylko panel web. Aplikacja mobilna ma własne zasady sesji (P2; blokada aplikacji po 5 min w tle — M-02).

### 4.18 Dane ukryte na telefonie (od 1.2.0)
Propozycja P-13 z EVM-004. Ekrany: M-02, M-03, M-04, M-05, M-06, M-07, M-08, M-10. Wymagania: P2, P7; SR-MOB-05, -06, -08; MASVS-AUTH-1.
- **Kiedy:** 7 dni bez udanego kontaktu z serwerem (SR-MOB-05) albo wyłączona blokada ekranu w trakcie sesji (SR-MOB-06). Aparat i Kolejka działają.
- **Zasada:** dane zleceń **nie są renderowane** — to nie nakładka, rozmycie ani przezroczystość. Dotyczy to także nazw dostępnych, ogłoszeń czytnika ekranu i podglądu w przełączniku aplikacji (pokazuje tylko to, co jest wyrenderowane). Powiadomienia — bez danych (SR-MOB-08).
- **Anatomia:**
  - stały Banner (§ 3.19) pod AppBar — `color.feedback.warning.*`, ikona `eye-off`: „Dane zleceń są ukryte — [powód]. Aparat i kolejka działają.” + akcja wyjścia; nie da się go zamknąć;
  - aparat (M-06) i Kolejka (M-07) — zamiast nazw, adresów, telefonów, tytułów i miniatur **tylko numer zlecenia i liczby** („Zdjęcie · ZL-2026-0042”, „Oczekuje na numer”); miniatura → ikona typu pliku (`image`, `video`, `file-text`); arkusz „Do którego zlecenia?” — tylko numery;
  - lista (M-05), szczegóły (M-03), media (M-08), nowy wpis (M-04), szybkie zlecenie (M-10) — EmptyState (§ 3.15) z ikoną `eye-off`, wyjaśnieniem i akcją wyjścia; BottomNav działa (Kolejka, „Dodaj” → Zdjęcie lub film).
- **Warianty powodu:** 7 dni bez połączenia — „…telefon nie łączył się z serwerem od 7 dni.” + „Zaloguj się ponownie” (aktywne tylko online); brak blokady ekranu — „…telefon nie ma blokady ekranu.” + „Otwórz ustawienia”.
- **Stany:** Banner — statyczny (hover nd.); przycisk akcji: fokus `color.focus.ring`, wciśnięty `color.action.tertiary.bg-pressed`, wyłączony offline z podpowiedzią „Zalogujesz się, gdy wróci połączenie.”, ładowanie — w stanie ładowania podczas logowania; błąd — nd. (stan sam jest komunikatem; błąd logowania — M-01).
- **Tokeny:** `color.feedback.warning.{bg|border|icon|text}`, treść `color.text.primary` `text.body`, ikona `eye-off` `size.icon.lg`, obrys lewy `border-width.indicator`, padding `space.inset.md`, Button tertiary `size.touch-target.min`; EmptyState — § 3.15.
- **Dostępność:** Banner ogłaszany raz przy wejściu w tryb (ogłoszenie platformy), stała pozycja pod paskiem; nazwy dostępne elementów Kolejki bez danych zleceń („Zdjęcie, zlecenie ZL-2026-0042, w kolejce”); cele ≥ `size.touch-target.min`.
- **Mikrocopy:** „Dane zleceń są ukryte — telefon nie łączył się z serwerem od 7 dni. Aparat i kolejka działają.” · „Dane zleceń są ukryte — telefon nie ma blokady ekranu. Aparat i kolejka działają.” · „Zaloguj się ponownie” · „Otwórz ustawienia” · M-10: „Nowe zlecenie założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej.”
- **Web / mobile:** tylko aplikacja mobilna.

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
- Ekran aparatu: spust na dole na środku, przełącznik kategorii zdjęcia nad spustem (chipy), „Gotowe” w prawym dolnym rogu; licznik zdjęć w serii. Komponent: CameraScreen (§ 3.24, od 1.2.0).

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
- **Priorytet przy kilku stanach naraz** (od 1.2.0 z „Wymaga uwagi” — § 4.16): Wymaga uwagi > Błąd > Offline > Czeka na Wi-Fi > Wysyłanie > Zsynchronizowano; liczniki pozostałych stanów pokazuje ekran „Kolejka”.
- **Kapsuła pokazuje jeden stan, ale stan przesyłania nie znika** (od 1.2.0) — ważne, gdy kapsuła długo pokazuje „Wymaga uwagi” (§ 4.16):
  - baner offline jest widoczny zawsze, gdy nie ma połączenia — niezależnie od stanu kapsuły (wiersz „Offline” niżej);
  - nazwa dostępna kapsuły w stanie „Wymaga uwagi” albo „Błąd” zawiera także tekst stanu następnego wg priorytetu („Wymaga uwagi: 1 element. Offline, 5 w kolejce. Otwórz kolejkę”);
  - licznik niewysłanych na pozycji „Kolejka” w BottomNav nie zależy od kapsuły (§ 3.18);
  - podsumowanie ekranu „Kolejka” zawsze pokazuje stan przesyłania (§ 4.7).
- Na wąskich ekranach (< 360 dp lub długi tytuł) kapsuła skraca tekst do liczby („5”, „2 Wi-Fi”), ale nigdy do samej ikony; pełny tekst w etykiecie dostępności.

| Stan | Ikona | Tekst (mikrocopy) | Tokeny |
|---|---|---|---|
| Online, wszystko wysłane | `cloud-check` | „Zsynchronizowano 14:05” | `color.sync.done.*` |
| Online, wysyłanie | `cloud-upload` | „Wysyłanie 3 z 12…” | `color.sync.in-progress.*` |
| Czeka na Wi-Fi (sieć komórkowa, włączone „Wysyłaj tylko przez Wi-Fi”) | `wifi` | „2 filmy czekają na Wi-Fi” (polska odmiana liczebnika: „1 film czeka”, „2 filmy czekają”, „5 filmów czeka”, „22 filmy czekają”; dotyczy tylko filmów — zdjęcia idą przez sieć komórkową) | `color.sync.waiting-wifi.*` |
| Offline | `wifi-off` | „Offline · 5 w kolejce” — dodatkowo baner pod paskiem: „Brak zasięgu. Pracuj dalej — wyślemy wszystko, gdy wróci połączenie.” Baner jest widoczny zawsze, gdy nie ma połączenia, także gdy kapsuła pokazuje „Wymaga uwagi” albo „Błąd” (od 1.2.0). Stoi pod banerem „Dane ukryte” (§ 4.18), jeśli oba są widoczne. Wyjątek: CameraScreen (§ 3.24) — bez banera, żeby nie zasłaniać podglądu; tam stan offline niesie nazwa dostępna kapsuły. Pojawienie się banera ogłaszane raz | `color.sync.offline.*` + obrys `color.border.inverse` |
| Błąd wysyłania | `cloud-alert` | „Nie wysłano 2 · Ponów” | `color.sync.error.*` |
| Wymaga uwagi (od 1.2.0 — § 4.16) | `triangle-alert` | „Wymaga uwagi · 2” | `color.sync.error.*` |

**Stan każdego pliku / wpisu** (miniatura w galerii, element kolejki, wpis osi czasu):

| Stan | Ikona | Etykieta | Tokeny | Akcja |
|---|---|---|---|---|
| W kolejce | `clock` | „W kolejce” | `color.sync.queued.*` | „Usuń z kolejki” (z potwierdzeniem) |
| Wysyłanie | `cloud-upload` | „Wysyłanie 45%” + pasek | `color.sync.in-progress.*`, `color.sync.progress.fill` | „Wstrzymaj” (opcjonalnie) |
| Wysłano | `cloud-check` | „Wysłano” | `color.sync.done.*`, `color.sync.progress.fill-done` | — |
| Błąd | `cloud-alert` | „Nie wysłano — [powód]” | `color.sync.error.*`, `color.sync.progress.fill-error` | „Ponów” (przycisk `size.touch-target.min`) |
| Czeka na Wi-Fi | `wifi` | „Czeka na Wi-Fi” | `color.sync.waiting-wifi.*` | „Wyślij teraz przez sieć komórkową” (jednorazowo dla tego pliku; ustawienie „Wysyłaj tylko przez Wi-Fi” się nie zmienia; obok akcji pokazujemy rozmiar pliku, np. „180 MB”, żeby technik ocenił koszt transferu) |
| Offline | `wifi-off` | „Czeka na połączenie” | `color.sync.offline.*` | — |
| Wymaga uwagi (od 1.2.0) | `triangle-alert` | „Wymaga uwagi” | `color.sync.error.*` | wg § 4.16 („Dodaj do innego zlecenia”, „Utwórz ponownie”, „Usuń z telefonu”) |

Stany pliku po wysłaniu (sprawdzanie, kwarantanna, plik za duży na skan, plik z innego urządzenia) — § 4.14.

„Czeka na Wi-Fi” różni się od „Offline” ikoną (`wifi` vs przekreślone `wifi-off`), kolorem (amber vs ciemny neutralny) i tekstem — technik z zasięgiem komórkowym widzi, że wysyłka nie utknęła, tylko czeka na jego ustawienie, i może ją wymusić. Stan występuje tylko przy włączonym przełączniku „Wysyłaj tylko przez Wi-Fi” (§ 3.4).

Zasady „nic nie ginie”:
- Zapis lokalny jest natychmiastowy i potwierdzony („Zapisano w telefonie”); wysyłka w tle wznawia się automatycznie (szczegóły techniczne: EVM-011).
- **Potwierdzenie dopiero po trwałym zapisie** (od 1.1.0): toast „Zapisano w telefonie” i ogłoszenie czytnika pojawiają się, gdy plik jest zapisany na dysk w katalogu aplikacji (z wymuszeniem zapisu — `fsync`), a medium i wpis kolejki są zatwierdzone w jednej transakcji zaszyfrowanej bazy; suma kontrolna SHA-256 nie opóźnia potwierdzenia (liczona po zapisie, przed wysyłką). Film: do końca zapisu stan „Zapisywanie filmu…” (spust nieaktywny, „Gotowe” w stanie ładowania); zatrzymanie nagrania z dowolnego powodu (zamknięcie, „wstecz”, przerwanie przez system, koniec miejsca) **zapisuje** nagranie, nigdy go nie odrzuca; nieudany zapis — jawny komunikat, nigdy ciche niepowodzenie. Makieta: [`flows/09-mobile-zdjecia-filmy-offline.md`](flows/09-mobile-zdjecia-filmy-offline.md) (M-06).
- Plik usuwamy z urządzenia dopiero po potwierdzeniu serwera; usunięcie ręczne niewysłanego pliku = dialog (§ 4.11).
- Wylogowanie / zmiana konta przy niewysłanych danych: blokujący dialog z liczbą elementów i opcją „Wyślij teraz”. Skutki zgodne z polityką P2 (od 1.1.0): **wylogowanie** usuwa z telefonu dane zleceń, a niewysłane elementy zostają zaszyfrowane i wyślemy je po zalogowaniu **na to samo konto**; **logowanie innej osoby** i „Wyczyść dane firmowe” usuwają wszystko, także niewysłane elementy (SR-MOB-13). Makiety: [`flows/09-mobile-zdjecia-filmy-offline.md`](flows/09-mobile-zdjecia-filmy-offline.md) (M-09) i [`flows/01-logowanie-mfa.md`](flows/01-logowanie-mfa.md) (M-02).
- Status tekstowy zawsze obok ikony; zmiany stanu ogłaszane czytnikowi ekranu (`aria-live="polite"` / ogłoszenia dostępności platformy) bez spamowania (zbiorczo co kilka sekund).

---

## 6. Treści

### 6.1 Ton
- Prosty, konkretny, uprzejmy, rzeczowy. Zwracamy się na „ty” („Dodaj zdjęcie”, „Twoje zmiany zapisaliśmy”); system mówi „my” („Wyślemy, gdy wróci zasięg”).
- Przyciski: czasownik w trybie rozkazującym + obiekt („Zapisz zlecenie”, „Dodaj etap”, „Ponów wysyłanie”); bez „OK”, „Tak/Nie” w dialogach.
- Bez żargonu technicznego (nie „sync”, „upload”, „request failed”, „null”) — „wysyłanie”, „synchronizacja”, „nie udało się”.
- Bez wykrzykników, bez obwiniania („Podaj numer telefonu”, nie „Błędny numer!”); bez humoru w komunikatach błędów.
- Wielka litera tylko na początku zdania i w nazwach własnych.
- **Działania osób opisujemy formami bezosobowymi** (od 1.2.0): `User` ma tylko `displayName` (bez płci), więc nie odmieniamy czasownika ani przymiotnika przez osobę. Tak: „Zmiana statusu etapu „…”: «Czekamy na…»”, „Dodano 12 zdjęć · W trakcie prac”, „Osoba odpowiedzialna: Anna Testowa”; autor stoi w nagłówku wpisu albo w metadanych („Anna Testowa · dziś, 11:02”). Nie: „Anna Testowa zmieniła…”, „dodał 12 zdjęć”, „Odpowiedzialna: …”.

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
| Status etapu | Do zrobienia, W toku, Czekamy na…, Zakończony, Nie dotyczy, Zablokowany; „Czekamy na…” rozwijamy do „Czekamy na: klient · od 3 dni” / „Czekamy na: [nazwa strony] ([rodzaj strony]) · od 15 dni” (§ 4.4) | Czekamy na stronę trzecią (do 1.0.0 — klient nie jest stroną) |
| Etap płatności | transza do zapłaty: Planowana, Wystawiona, Opłacona, Anulowana + oznaczenie wyliczane „Po terminie” (§ 4.4); **nieopłacone** = wystawione (także po terminie), „Planowana” nie jest nieopłacona | rata, faktura (faktura to dokument w etapie) |
| Dziennik | chronologiczna historia zlecenia | historia, log, aktywność |
| Wpis / komentarz | notatka z rozmowy, ustalenie / komentarz użytkownika | post, wiadomość |
| Media / zdjęcie / film | pliki z aparatu z metadanymi | załącznik (dla zdjęć) |
| Dokument | projekt, ekspertyza, zgoda, warunki przyłączenia, protokół (z wersjami) | plik (ogólnie), załącznik |
| Strona | rodzaje (etykiety wg `docs/product/service-catalog.md` § 7): Administracja, Zarządca, Wspólnota / spółdzielnia, Projektant, Rzeczoznawca ppoż, Rzeczoznawca (ekspertyza), OSD, Podwykonawca, Dostawca, Inny; klient nie jest stroną | kontrahent, party |
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
| Brak uprawnień (`403`, akcja lub plik) | „Nie możesz skorygować płatności. Poproś administratora.” · plik: „Plik dostępny dla administratora i edytora.” |
| Konflikt edycji | „Ktoś zmienił to zlecenie w międzyczasie. Twoje zmiany zachowaliśmy — porównaj i zapisz ponownie. [Porównaj]” |
| Sesja wygasła (web, od 1.1.0) | „Sesja wygasła. Zaloguj się ponownie w tej karcie — niezapisane zmiany przywrócimy, jeśli zalogujesz się na to samo konto. [Zaloguj się]” (szkic tylko w pamięci karty — § 4.1) |
| Zbyt wiele prób / żądań (`429`) | „Zbyt wiele prób. Spróbuj ponownie za 2 min.” (czas z nagłówka `Retry-After`; ten sam komunikat niezależnie od tego, czy konto istnieje) |
| Błąd serwera | „Nie udało się zapisać zlecenia. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: 7F3A). [Spróbuj ponownie]” |
| Nie znaleziono (`404` — także zasób bez dostępu) | „Nie znaleziono zlecenia. Mogło zostać usunięte albo nie masz do niego dostępu. [Wróć do listy]” |

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
| Uwierzytelnianie (3.3.8) | bez testów poznawczych; wklejanie haseł, menedżery haseł | ekrany W-01–W-04 i M-01 w [`flows/01-logowanie-mfa.md`](flows/01-logowanie-mfa.md): `autocomplete` `username` / `current-password` / `one-time-code`, wklejanie dozwolone, passkey jako metoda bez przepisywania kodu; pole kodu — § 3.2.1 (od 1.2.0) |
| Limity czasu (2.2.1) | ostrzeżenie przed wygaśnięciem sesji i możliwość przedłużenia | web: ostrzeżenie przed końcem bezczynności, „Przedłuż sesję” przedłuża tylko bezczynność, w granicach maks. 12 h (SR-SESS-03) — wzorzec „Sesja wygasa” (§ 4.17, od 1.2.0) |
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
### Propozycja do 1.3.0 — 2026-10-05 (EVM-008, do akceptacji Konrada)
PATCH/MINOR bez nowych tokenów i komponentów: doprecyzowanie użycia istniejących wzorców dla powłoki panelu przed E1.
- **§ 3.15 EmptyState — wariant „bez akcji”:** pusty stan pierwszego uruchomienia bez przycisku, gdy nie ma jeszcze funkcji, która mogłaby go wypełnić (EVM-008, W-10: „Brak zleceń”). Tytuł jako nagłówek drugiego poziomu pod `h1` strony; reszta anatomii bez zmian.
- **§ 3.17 Sidebar / TopBar — powłoka przed logowaniem (E1):** TopBar bez wyszukiwania i konta (nie ma ich jeszcze co zasilić — pozycji bez funkcji nie pokazujemy); jedna pozycja główna „Zlecenia”. Na `< breakpoint.medium` (web, 360 px) Sidebar zastąpiony przyciskiem „Menu” w TopBar otwierającym szufladę z tymi samymi pozycjami (BottomNav jest tylko w aplikacji mobilnej). To doprecyzowanie, nie nowy komponent — do zatwierdzenia przy 1.3.0.

### 1.2.0 — 2026-10-04 (EVM-014)
MINOR (§ 7.2 pkt 5): nowe komponenty, warianty, wzorce i 6 tokenów; żadna nazwa tokenu ani komponentu nie znika; numeracja istniejących § bez zmian (nowe sekcje na końcu rozdziałów, warianty jako podsekcje), więc odwołania w makietach i historyjkach M1 pozostają ważne. Źródła: propozycje P-1…P-13 z EVM-004 (zaakceptowane przez Konrada 2026-10-03), uwagi PO-2–PO-5 i „runda 2” pkt 1, 2, 8–10 z EVM-004, konsultacja `security-engineer` w EVM-014.
- **Nowe komponenty i warianty (§ 3):** § 3.2.1 pole kodu jednorazowego i kodu odzyskiwania (P-4), § 3.9.1 odznaka wartości nieznanej (P-12), § 3.15.1 pusty stan blokujący (P-5), § 3.20 ActionMenu (P-1), § 3.21 Disclosure (P-2), § 3.22 SelectableCard (P-3), § 3.23 ProcedureProgress (P-6), § 3.24 CameraScreen (P-10). Każda sekcja: anatomia, warianty, stany, tokeny, dostępność, mikrocopy, web / mobile.
- **Nowe wzorce (§ 4):** § 4.14 stany pliku na serwerze (P-7), § 4.15 „Oczekuje na numer” (P-8), § 4.16 „Wymaga uwagi” w Kolejce i SyncIndicator (P-9), § 4.17 „Sesja wygasa” (P-11), § 4.18 „Dane ukryte” na telefonie (P-13).
- **Odwołania:** § 3.1, § 3.6, § 3.8 (menu `ellipsis-vertical` → § 3.20), § 3.2, § 3.9, § 3.11, § 3.12, § 3.15, § 3.19, § 4.4, § 4.7, § 5.2, § 5.4 (stan „Wymaga uwagi” i nowy priorytet SyncIndicator), § 7.1 (2.2.1 → § 4.17, 3.3.8 → § 3.2.1); § 2.1.3 — role `color.progress.*` i `color.status.unknown.*`; § 2.1.4 — 17 nowych wierszy (w tym 3 „niewystarczające” i 1 „zakazane” z obowiązującym rozwiązaniem).
- **§ 4.5, § 6.1 — formy bezosobowe** (PO-2, runda 2 pkt 2): `User` ma tylko `displayName`, więc działania osób opisujemy bezosobowo („Zmiana statusu etapu „…”: «Czekamy na…»”, „Dodano 12 zdjęć · W trakcie prac”, „Osoba odpowiedzialna: Anna Testowa”), a autor stoi w nagłówku wpisu.
- **§ 4.14 — etykieta dużego filmu** (PO-4): „Nieskanowany antywirusem — plik za duży” — bez skrótu i z pisownią łączną; brzmienie potwierdzone przez `security-engineer`, to samo w SR-FILE-12 i P5 pkt 3.
- **Bezpieczeństwo w opisach wzorców** (konsultacja `security-engineer`, EVM-014): pole kodu bez sprawdzania pisowni i z maskowaniem na telefonie (§ 3.2.1); „Sesja wygasa” — czas z serwera, przedłużenie tylko bezczynności, czyszczenie danych po `401` (§ 4.17); stan blokujący i „Dane ukryte” bez renderowania danych (§ 3.15.1, § 4.18); zwinięta sekcja nie jest kontrolą dostępu (§ 3.21); surowa wartość statusu z API nigdy w UI (§ 3.9.1); aparat bez lokalizacji i galerii (§ 3.24).
- **Rozstrzygnięcia projektowe** w ramach zaakceptowanych propozycji (kompetencja `ux-designer`):
  1. **„Wymaga uwagi” wygląda wszędzie tak samo:** `triangle-alert` + `color.sync.error.*` — także znacznik pliku w kwarantannie (w P-7: `color.feedback.warning.*`). Bursztyn zlewałby się z „Czeka na Wi-Fi”, a stan ma najwyższy priorytet; od „Błąd wysyłania” odróżniają go ikona i etykieta. Bez nowych tokenów.
  2. **ActionMenu — fokus pozycji:** pierścień wewnętrzny `color.focus.ring` (4,74:1), jak wiersz tabeli; samo tło `color.bg.surface-hover` (1,09:1) nie jest wskaźnikiem fokusu.
  3. **CameraScreen — stan nagrywania nie opiera się na kolorze:** `color.action.danger.bg` na `color.bg.brand-strong` daje 1,39:1; stan niosą obrys `color.border.inverse`, zmiana ikony `circle` → `square`, licznik czasu i nazwa „Zatrzymaj nagrywanie”.
  4. **ProcedureProgress:** informację niesie tekst „n z m etapów”; pasek jest dekoracyjny (`aria-hidden`), a wypełnienie ma ≥ 3:1 do toru i do tła.
  5. **Kolumna „Ekrany”** = ekrany, których makieta, tabela stanów lub lista „Komponenty i tokeny” używa elementu (także przez notację `⋮`, `▸` / `▾`, `«… ▾»`). Zmiany: P-1 − W-10 i − M-03 (makiety bez menu), + arkusz „Dodaj” w BottomNav; P-2 + W-05, M-07; P-8 + M-06, M-07; P-9 + M-03, M-04, M-10, − M-09 (ekran nie używa stanu); P-13 + M-04, M-08, M-10; P-12 — bez zmian listy, a M-03 i M-05 mają § 3.9.1 w „Komponenty i tokeny” (SR-MOB-10).
  6. **ProcedureProgress — reguła liczenia:** n — etapy „Zakończony”, m — etapy procesu bez „Nie dotyczy”; W-06 i M-03 — „Uzgodnienia z OSD” poprawione z „3 z 7” na „2 z 7 etapów” (zakończone są 2 etapy).
     - **Do potwierdzenia.** Reguła doprecyzowuje `domain-model.md` → `Procedure` („etapy zakończone / wszystkie”). Wymaga potwierdzenia Konrada na demo EVM-014 (rekomendacja: TAK — wyłączamy „Nie dotyczy”, zgodnie z EVM-071). Po akceptacji `solution-architect` aktualizuje `domain-model.md`, najpóźniej w EVM-031.
     - **m = 0** (wszystkie etapy „Nie dotyczy”): „Nie dotyczy” z `circle-minus`, bez paska i bez „Wszystkie zakończone”. W kolumnie „Postęp” W-10 suma m = 0 daje „—”.
  7. **CameraScreen — przyciski na ciemnym panelu:** „Gotowe” (primary) z obrysem `color.border.inverse` (granica `action.primary.bg` do panelu — 1,33:1); przyciski powodu („Zezwól na mikrofon”, „Otwórz ustawienia”) — tekst `color.text.on-brand` z obrysem `color.border.inverse` (`action.tertiary.text` na panelu nie spełnia 4,5:1). Bez nowych tokenów.
  8. **Odznaka wartości nieznanej:** podpowiedź zależna od kanału — web „Odśwież stronę, aby zobaczyć szczegóły.”, mobile „Zaktualizuj aplikację, aby zobaczyć szczegóły.”; wartość nieznana nigdy nie jest przyciskiem zmiany statusu.
  9. **„Sesja wygasa”:** wariant limitu 12 h pokazujemy 10 min przed limitem (czas na zapis zmian), bez „Przedłuż sesję”, z przyciskiem „Rozumiem”.
  10. **Disclosure:** ikony `chevron-down` / `chevron-up` jak w propozycji; notacja `▸` / `▾` w makietach oznacza stan, nie kształt ikony.
- **Makiety (`flows/`):** odwołania `[P-n]` zastąpione nazwą komponentu i § 1.2.0; pełna kolumna „Ekrany”; PO-3 (kafel „Na kogo czekamy” bez pustego wiersza klienta — tylko faktyczne oczekiwania), PO-5 (PPE tylko w formie oznaczonej `TEST`, wyłącznie w makietach panelu), runda 2 pkt 8 (trzy odnośniki banera „Zlecenie założone w terenie” — trzy różne komponenty i nazwy dostępne), pkt 9 (kolejność kontroli w diagramie logowania mobilnego), pkt 10 (nieaktualne zdanie o luce L8).
- **Poprawki po przeglądach (runda 1, EVM-014):**
  - baner „Zlecenie założone w terenie” — odnośnik „kwoty transz” ustawia fokus na wyzwalaczu `⋮` pierwszej transzy „Planowana” bez kwoty, a bez takiej transzy — na nagłówku „Płatności” (`tabindex="-1"`). Pozycji menu „Zmień kwotę” przy zamkniętym menu nie ma w drzewie dokumentu. Mechanizm: `href="#platnosci"` jako zapas, przewinięcie z `scroll-padding` i `focus()` w obsłudze zdarzenia. Zmiany w `flows/03`, `08` (kolejność pozycji menu transzy „Planowana”), `10` i `scenariusze-a-d.md`;
  - stan przesyłania nie znika pod „Wymaga uwagi” (§ 3.18, § 4.7, § 4.16, § 5.4, `flows/09`): baner offline widoczny zawsze bez połączenia (poza CameraScreen), nazwa dostępna kapsuły ze stanem następnym wg priorytetu, licznik niewysłanych na „Kolejka” w BottomNav niezależny od kapsuły, podsumowanie Kolejki ze stanem przesyłania. Kolejność priorytetu P-9 bez zmian;
  - ProcedureProgress (§ 3.23, rozstrzygnięcie 6): reguła liczenia oznaczona jako doprecyzowanie `domain-model.md` do potwierdzenia; przypadek m = 0 — „Nie dotyczy”.
- Tokeny: 491 → **497** (base 184, semantic 307 → 313, w tym 8 wycofywanych): `color.progress.{track,fill}`, `color.status.unknown.{bg,text,icon,border}` — wyłącznie aliasy do `palette.*`; `quote` / `issued` bez zmian (`$deprecated` do najbliższej wersji MAJOR). `@evia/tokens` — przebudowa pakietu, eksporty najwyższego poziomu bez zmian.

**Odstępstwa:** brak.

### 1.1.0 — 2026-10-03 (EVM-004)
MINOR (§ 7.2 pkt 5): nowe tokeny i korekty treści; żadna nazwa tokenu ani komponentu nie znika. Źródła: zaakceptowany model domeny (EVM-002, decyzja Konrada P1 „Czekamy na…”), polityki bezpieczeństwa P1–P7 (EVM-005) i konsultacja `security-engineer` w EVM-004 (M1–M4).
- **§ 4.4, § 6.2 — „Czekamy na…”:** etykieta statusu etapu `waiting` = „Czekamy na…” (było: „Czekamy na stronę trzecią” — czekamy też na klienta); rozwinięcie „Czekamy na: klient · od 3 dni” / „Czekamy na: [nazwa strony] ([rodzaj strony]) · od 15 dni”, próg 14 dni bez zmian; § 4.5 — przykład wpisu dziennika.
- **§ 4.4 — etapy płatności zgodne z modelem:** nowy status „Anulowana” (`color.status.payment.cancelled.*`, ton neutralny, ikona `ban`); „Po terminie” = oznaczenie wyliczane (`isOverdue`), które zastępuje odznakę „Wystawiona”, nie status.
- **§ 4.4 — klucze tokenów = kody modelu:** reguła `snake_case` → `kebab-case`; nowe `color.status.order.quoting.*` i `color.status.payment.invoiced.*`; `quote` i `issued` oznaczone `$deprecated` (DTCG 2025.10 § 6.3.1), bez eksportu do kodu UI, usunięcie w najbliższej wersji MAJOR. § 2.1.4 — 6 nowych wierszy kontrastu (te same pary aliasów co w 1.0.0).
- **§ 6.2 — „Strona”:** pełna lista rodzajów z `service-catalog.md` § 7 (dodane: wspólnota / spółdzielnia, rzeczoznawca (ekspertyza), dostawca, inny); „nieopłacone” = wystawione.
- **§ 3.12 — mobilny Uploader bez „Z galerii”** (ADR-0007, P3, P7); web — widoczna lista typów i limitów (SR-FILE-01).
- **§ 4.13, § 6.4 — `404` vs `403`:** wejście z linku na zasób niedostępny albo usunięty = jeden stan „Nie znaleziono …” bez danych zasobu; „Nie masz dostępu” (`lock`) tylko dla akcji i plików w widocznym kontekście; rola Tylko odczyt — akcje edycji ukryte.
- **§ 4.1, § 4.10, § 6.4 — szkice w panelu tylko w pamięci karty** (M1 z konsultacji security; SR-WEB-05, SR-SESS-05, TM-10): nigdy w magazynach przeglądarki; szkic przypisany do osoby; mikrocopy bez obietnicy trwałego zapisu; mobile — zaszyfrowana baza aplikacji.
- **§ 4.11 — „Cofnij” tylko przez przejście odwrotne tej samej roli bez step-upu** (M2 z konsultacji security; SR-AUTHZ-10, SR-API-07): przejścia bez drogi powrotnej — toast bez „Cofnij”; operacje, których odwrócenie wymaga Administratora ze step-upem (wystawienie faktury, odnotowanie wpłaty, anulowanie transzy i zlecenia, rozliczenie) — dialog z podsumowaniem.
- **§ 3.7, § 4.3 — URL i tytuł karty bez danych osobowych;** zapamiętywanie filtrów poza magazynami przeglądarki (SR-API-04, SR-WEB-05).
- **§ 5.4 — „Zapisano w telefonie” dopiero po trwałym zapisie** pliku i wpisu w kolejce; film — stan „Zapisywanie filmu…”, przerwane nagranie zawsze zapisywane (poprawki po przeglądzie `mobile-developer`, EVM-004).
- **§ 5.4 — skutki wylogowania i zmiany konta** zgodne z P2 i SR-MOB-13; **§ 7.1** — wiersze 3.3.8 (ekrany logowania EVM-004) i 2.2.1 (ostrzeżenie o wygaśnięciu sesji).
- Tokeny: 479 → **491** (semantic 295 → 307, w tym 8 wycofywanych); `design/tokens/README.md` — wersja 1.1.0, zasada `$deprecated`, reguła mapowania kodów.

#### Propozycje (EVM-004) — zaakceptowane (Konrad, 2026-10-03), wdrożone w 1.2.0
Braki wykryte przy makietach EVM-004 ([`flows/README.md`](flows/README.md)). **Od 1.2.0 obowiązuje opis w § wskazanym w kolumnie „Od 1.2.0”** — kolumna „Propozycja” to zapis akceptacji z EVM-004 (różnice rozstrzyga sekcja 1.2.0, w tym rozstrzygnięcia projektowe 1–10). Makiety odwołują się do § (znaczniki propozycji usunięte w 1.2.0); historyjki M1, które nadal piszą `[P-n]`, odczytują je przez tę tabelę. Kolumna „Ekrany” — pełna, wg rozstrzygnięcia 5.

| ID | Od 1.2.0 | Brak | Propozycja (EVM-004) | Uzasadnienie | Ekrany |
|---|---|---|---|---|---|
| P-1 | [§ 3.20](#320-menu-akcji-actionmenu-od-120) | Menu akcji — styleguide odwołuje się do „menu `ellipsis-vertical`” (§ 3.1, § 3.6, § 3.8), ale nie definiuje komponentu | **ActionMenu:** web — lista pod wyzwalaczem (`color.bg.surface`, `elevation.dropdown`, `layer.dropdown`, `radius.control`), wiersz min. `size.control.height.web.md`, hover `color.bg.surface-hover`, separator `color.border.subtle`, akcje niszczące na końcu (`color.action.danger.text-subtle`), pozycja wyłączona `color.text.disabled` + podpowiedź; klawiatura: strzałki, Home / End, Enter, Esc, fokus wraca do wyzwalacza; role `menu` / `menuitem`. Mobile — BottomSheet (§ 3.13) z wierszami `size.touch-target.min` | menu zmiany statusu, akcje wiersza i transzy; jedno zachowanie klawiatury w całym panelu | W-06, W-07, W-08, W-09, W-11; arkusz „Dodaj” w BottomNav |
| P-2 | [§ 3.21](#321-sekcja-rozwijana-disclosure-od-120) | Sekcja rozwijana — progresywne ujawnianie (§ 1 pkt 5) bez komponentu | **Disclosure:** nagłówek jako przycisk (`text.heading-4`, ikona `chevron-down` / `chevron-up` `size.icon.md`, `aria-expanded`), w stanie zwiniętym podsumowanie (bieżący etap, „Czekamy na…”, postęp — P-6); rozwinięcie `motion.transition.expand`; mobile — nagłówek min. `size.touch-target.min` | 9 procesów w scenariuszu C nie mieści się w jednym widoku | W-05, W-06, M-03, M-07 |
| P-3 | [§ 3.22](#322-karta-wyboru-selectablecard-od-120) | Wybór jednej z kilku bogatych opcji (szablon z podglądem) | **SelectableCard:** karta (§ 3.8) w roli radio w `fieldset` z legendą; wybrana — obrys `color.border.selected` `border-width.indicator` + zaznaczone radio (`color.control.checked`) + tło `color.bg.selected` (tylko z obrysem — § 2.1.3); klawiatura jak grupa radio; mobile — cała karta celem dotyku | wybór szablonu z podglądem pozycji, procesów i transz | W-05, M-10 |
| P-4 | [§ 3.2.1](#321-pole-kodu-jednorazowego-i-kodu-odzyskiwania-od-120) | Pole kodu jednorazowego | **TextField „kod jednorazowy”:** jedno pole (nie sześć), `inputmode="numeric"`, `autocomplete="one-time-code"` (Android — autouzupełnianie kodu), `text.numeric-lg`, wklejanie dozwolone, bez automatycznego wysłania (WCAG 3.2.2); wariant „kod odzyskiwania” — tekst `text.mono`, `autocomplete="off"`, ignoruje spacje i łączniki. Od 1.2.0 (§ 3.2.1, konsultacja `security-engineer`): web — `spellcheck="false"`, `autocapitalize="off"`; mobile — pole maskowane z „Pokaż”, `FLAG_SECURE`, bez autokorekty i podpowiedzi klawiatury (SR-MOB-08); jeden komunikat dla kodu złego, użytego i wygasłego | WCAG 3.3.8, menedżery haseł i schowek | W-02, W-03, W-04, M-01 |
| P-5 | [§ 3.15.1](#3151-pusty-stan-blokujący-od-120) | Stan blokujący cały ekran (bez nawigacji i danych) | **EmptyState — wariant „blokujący”:** bez Sidebar / BottomNav i bez danych, ikona `size.icon.2xl`, tytuł `text.heading-2`, opis `text.body`, jedna akcja primary (mobile w dolnym pasku `size.touch-target.field`) + opcjonalnie tertiary („Wyloguj”); tło `color.bg.canvas` | `mfa_enrollment_required`, stany urządzenia z P2 / P7 | W-03, M-02 |
| P-6 | [§ 3.23](#323-postęp-procesu-procedureprogress-od-120) | Postęp procesu („3 z 7 etapów”) — `color.sync.progress.*` oznacza wysyłanie | **ProcedureProgress:** tekst „3 z 7 etapów” (`text.body-sm`, `color.text.secondary`) + opcjonalny pasek `size.progress-bar.height`; **nowe role** `color.progress.track` → `palette.neutral.200`, `color.progress.fill` → `palette.teal.700` (5,35:1 do toru, 6,74:1 do `bg.surface`) | postęp niosą etapy (`domain-model.md` → `Procedure`), nie status zlecenia | W-06, W-10 (kompaktowo), M-03 |
| P-7 | [§ 4.14](#414-stany-pliku-na-serwerze-od-120) | Stany pliku po stronie serwera (przed `ready`, kwarantanna, plik za duży na skan) | **Znaczniki pliku** (miniatura, wiersz dokumentu; web i mobile), wzór jak § 5.4: „Sprawdzanie pliku” — `scan-search`, `color.sync.queued.*` (bez podglądu i pobrania przed `clean`); „Wymaga uwagi” — `triangle-alert`, `color.feedback.warning.*` (przyczyna tylko dla Administratora — P5; od 1.2.0 `color.sync.error.*` — rozstrzygnięcie 1); etykieta filmu za dużego na skan — `info`, `color.feedback.info.*` (SR-FILE-12; brzmienie od 1.2.0 — § 4.14, PO-4); „Czeka na plik z telefonu · [autor] · od [czas]” — `clock`, `color.sync.queued.*`, kafel bez miniatury, **bez procentów i akcji** (metadane z telefonu dotarły przed plikiem — postęp zna tylko urządzenie, które wysyła) | P5, SR-FILE-12; § 5.4 opisuje tylko wysyłanie; metadane i plik idą osobnymi kanałami (`offline-sync.md`, ADR-0009) | W-09, M-08 |
| P-8 | [§ 4.15](#415-oczekuje-na-numer-od-120) | Szybkie zlecenie przed numerem z serwera | **Odznaka „Oczekuje na numer”** w miejscu numeru: `clock`, `color.sync.queued.*`; po `applied` — numer (np. „ZL-2026-0042”) i ogłoszenie „Zlecenie dostało numer ZL-2026-0042”; po `rejected` — „Wymaga uwagi” (P-9) | numer nadaje serwer (D8) | M-03, M-05, M-06, M-07, M-10 |
| P-9 | [§ 4.16](#416-wymaga-uwagi-w-kolejce-i-syncindicator-od-120) | „Wymaga uwagi” w kolejce (odrzucone mutacje, pliki w kwarantannie) — § 4.7 ma tylko „Błąd” | **Sekcja „Wymaga uwagi”** na górze ekranu Kolejka i stan SyncIndicator „Wymaga uwagi · 2” (`triangle-alert`, `color.sync.error.*`, najwyższy priorytet: Wymaga uwagi > Błąd > Offline > Czeka na Wi-Fi > Wysyłanie > Zsynchronizowano); akcje: odrzucony wpis lub zdjęcie — „Dodaj do innego zlecenia” (nowa komenda `Create*`, bez edycji), każdy element — „Usuń z telefonu” (dialog § 4.11); plik w kwarantannie — bez przyczyny, „Biuro sprawdzi plik.” | `offline-sync.md` (zasada 2, „Wymaga uwagi”), P5 | M-03, M-04, M-07, M-10, AppBar (SyncIndicator) |
| P-10 | [§ 3.24](#324-ekran-aparatu-camerascreen-od-120) | Ekran aparatu — § 5.2 opisuje układ, brak komponentu | **CameraScreen:** podgląd na cały ekran; górny pasek `color.bg.brand-strong` (zamknij `x`, numer zlecenia, SyncIndicator); dolny panel `color.bg.brand-strong`: chipy kategorii (wariant na ciemnym tle — obrys `color.border.inverse`, wybrany: `color.bg.surface` + `color.text.primary` + `check`), przełącznik Zdjęcie / Film (te same chipy; chip wyłączony — obrys przerywany `color.border.inverse`, ikona powodu, np. `mic-off` / `hard-drive`, bez zaznaczenia, a pod przełącznikiem widoczny powód `color.text.on-brand` z przyciskiem akcji — bez mikrofonu albo przy za małej ilości miejsca na film), spust `size.touch-target.shutter` (obrys `color.border.inverse`; nagrywanie — wypełnienie `color.action.danger.bg` + czas `text.numeric` `color.text.on-brand`), latarka (`flashlight` / `flashlight-off`, `size.touch-target.min`), licznik serii, „Gotowe” `size.touch-target.field`; fokus `color.focus.ring-inverse`; **bez wskaźnika lokalizacji** (P3); stan „Zapisywanie filmu…” (spust nieaktywny, „Gotowe” w stanie ładowania — § 5.4); prośba o uprawnienie przed monitem systemu — EmptyState (§ 3.15, aparat) i BottomSheet (§ 3.13, mikrofon) | najczęstszy ekran w terenie | M-06 |
| P-11 | [§ 4.17](#417-sesja-wygasa-od-120) | Ostrzeżenie o wygaśnięciu sesji (WCAG 2.2.1) | **Wzorzec „Sesja wygasa”:** AlertDialog (§ 3.13) 2 min przed końcem bezczynności: „Sesja wygaśnie za 2 min z powodu braku aktywności.” [Przedłuż sesję] [Wyloguj]; czas ogłaszany `aria-live="polite"` co minutę; przedłużenie tylko bezczynności, w granicach maks. 12 h od zalogowania (SR-SESS-03); przed limitem 12 h — „Sesja wygaśnie o 18:05 (limit 12 godzin). Zapisz zmiany.” bez przedłużenia | WCAG 2.2.1, SR-SESS-03, szkice tylko w pamięci karty | wszystkie ekrany web po zalogowaniu |
| P-12 | [§ 3.9.1](#391-odznaka-wartości-nieznanej-od-120) | Wartość statusu nieznana aplikacji (nowsza wersja API, ADR-0004) | **Odznaka zastępcza:** nowe role `color.status.unknown.{bg,text,icon,border}` → `palette.neutral.100` / `neutral.800` / `neutral.700` / `neutral.300` (12,99:1 / 9,51:1), ikona `circle-help`, etykieta „Nieznany status”, podpowiedź „Zaktualizuj aplikację, aby zobaczyć szczegóły.” | klienci obsługują wartość nieznaną (ADR-0004, SR-MOB-10) | W-06, W-10, W-11, M-03, M-05 |
| P-13 | [§ 4.18](#418-dane-ukryte-na-telefonie-od-120) | Tryb ukrytych danych na telefonie (7 dni offline, brak blokady ekranu — P2, P7) | **Wzorzec „Dane ukryte”:** stały Banner pod paskiem (`color.feedback.warning.*`, ikona `eye-off`): „Dane zleceń są ukryte — [powód]. Aparat i kolejka działają.” + akcja wyjścia; w aparacie i Kolejce zamiast nazw, adresów, telefonów i miniatur — numer zlecenia i liczby, miniatura → ikona typu pliku; lista i szczegóły zleceń — EmptyState z wyjaśnieniem | SR-MOB-05, SR-MOB-06 | M-02, M-03, M-04, M-05, M-06, M-07, M-08, M-10 |

### 1.0.0 — 2026-10-02 (EVM-003)
- Pierwsza wersja: zasady, fundamenty (kolor z tabelą kontrastów, typografia, odstępy, siatka i breakpointy, rozmiary, promienie, obramowania, cienie i warstwy, ruch, ikony), inwentarz 18 komponentów + pomocnicze, wzorce, wytyczne terenowe, treści, dostępność i egzekwowanie.
- Tokeny W3C DTCG 2025.10 w dwóch warstwach (`base/`, `semantic/`), motyw jasny.
- Marka z eviacharge.pl: `#247B83` (teal), `#6EFF33` (lime), `#1A1A1A`, `#838383`, `#F5F5F5`; fonty Inter, Exo 2, JetBrains Mono (OFL 1.1); ikony Lucide (ISC).
- Propozycje do akceptacji Konrada (demo EVM-003): akcje w `palette.teal.700` zamiast `palette.teal.600` (wariant A); neon `palette.lime.300` tylko jako akcent na ciemnym tle; fonty Inter + Exo 2 (wariant A). Szczegóły: `design/brand/README.md` § 6.
- Poprawki po przeglądzie developerskim (runda 1): dolna nawigacja mobile — wskaźnik aktywnej pozycji jako kapsuła `color.nav.indicator` (6,74:1) + pogrubiona etykieta, jawne tokeny pozycji nieaktywnej (`color.nav.*`, `size.bottom-nav.indicator.*`); `color.bg.selected` zawsze z drugim wskaźnikiem ≥ 3:1; górny pasek — fokus `color.focus.ring-inverse`, SyncIndicator jako kapsuła (offline z obrysem `color.border.inverse`); nowy obowiązkowy stan „Czeka na Wi-Fi” (`color.sync.waiting-wifi.*`, ikona `wifi`, akcja „Wyślij teraz przez sieć komórkową”); nowe pary w § 2.1.4.

**Odstępstwa:** brak.
