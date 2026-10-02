---
id: EVM-003
title: Styleguide v1 i design tokens
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P0
owner: ux-designer
contributors: []
reviewers: [web-developer, mobile-developer]
depends_on: []
---

# EVM-003: Styleguide v1 i design tokens

## Historyjka
Jako **użytkownik panelu i aplikacji** chcę **spójnego, czytelnego i dostępnego interfejsu zgodnego z marką EVia Charge**, aby **szybko i bez pomyłek pracować w biurze i w terenie**.

## Kontekst
Zasady: `docs/ux/README.md`. Styleguide jest wiążący dla wszystkich agentów implementujących UI. Wymaga materiałów marki od Konrada.

## Kryteria akceptacji
**AC1 — Marka**
- Zakładając, że brak materiałów marki w repozytorium
- Gdy ux-designer rozpoczyna pracę
- Wtedy pozyskuje materiały (logo, kolory, fonty lub adres strony) albo proponuje 2 warianty palety do wyboru; wybór Konrada jest zapisany w „Decyzje”.

**AC2 — Fundamenty**
- Gdy otwieram `docs/ux/styleguide.md`
- Wtedy znajduję: kolory z semantyką (akcje, statusy, błąd, ostrzeżenie, sukces, neutralne) z kontrastem ≥ 4,5:1 dla tekstu i ≥ 3:1 dla elementów UI, typografię (skala, fonty z licencją), odstępy, siatkę i breakpointy, promienie, cienie, ruch i ikony.

**AC3 — Design tokens**
- Gdy otwieram `design/tokens/`
- Wtedy tokeny w formacie W3C DTCG (JSON) pokrywają wszystkie fundamenty — żadna wartość ze styleguide'u nie istnieje bez tokenu.

**AC4 — Komponenty**
- Wtedy styleguide zawiera inwentarz komponentów dla M1–M2 (co najmniej: przyciski, pola formularzy, select, checkbox / radio, data, tabela / lista, filtry, karta, odznaka statusu, oś czasu, miniatura / galeria, uploader i element kolejki uploadu, dialog, toast, pusty stan, szkielet ładowania, nawigacja web i mobile) z wariantami, stanami i zasadami użycia.

**AC5 — Statusy**
- Wtedy statusy zlecenia, etapu i płatności mają system wizualny rozróżnialny bez koloru (ikona + etykieta).

**AC6 — Teren**
- Wtedy są wytyczne mobilne: cele dotyku ≥ 48×48 dp, kontrast w pełnym słońcu, obsługa jedną ręką, wskaźniki offline i synchronizacji.

**AC7 — Treści**
- Wtedy są zasady mikrocopy po polsku: ton, terminologia ze słownika, formaty dat, kwot i telefonów, komunikaty błędów wskazujące wyjście z sytuacji.

**AC8 — Dostępność i egzekwowanie**
- Wtedy jest sekcja dostępności (WCAG 2.2 AA), opis egzekwowania zgodności (tokeny, reguły lint, przegląd UX) i changelog styleguide'u.

## Poza zakresem
Makiety ekranów (EVM-004), implementacja biblioteki komponentów (powstaje w historyjkach implementacyjnych), tryb ciemny (decyzja w trakcie — domyślnie później).

## UX / UI
To jest specyfikacja UX.

## Bezpieczeństwo i prywatność
Nie dotyczy.

## Notatki techniczne
Format tokenów musi dać się przetworzyć do web i mobile (transformację wdraża EVM-006).

## Plan techniczny
Historyjka dokumentacyjna: brak kodu produkcyjnego, API, migracji i nowych zależności runtime. Wykonawca: `ux-designer`.

### Zakres zmian (pliki)
| Plik / katalog | Zawartość |
|---|---|
| `design/brand/README.md` | Źródła materiałów marki (URL-e z https://eviacharge.pl, data pobrania), wyekstrahowane wartości (kolory HEX z CSS/logo, fonty i ich licencje), logo (SVG/PNG, jeśli dostępne publicznie) jako `design/brand/logo-*.{svg,png}`, uwagi o niedostosowanych kolorach i proponowanych odcieniach. |
| `design/tokens/README.md` | Struktura tokenów, konwencja nazw, zasada warstw (bazowe → semantyczne), jak dodać motyw ciemny (nowy plik semantyczny z tymi samymi nazwami ról), wersja specyfikacji DTCG, wskazówki dla transformacji w EVM-006 (bez wyboru narzędzia). |
| `design/tokens/base/color.tokens.json` | Paleta bazowa: rampy marki (primary/accent) i neutralne 50–950 + rampy statusowe (green, amber, red, blue, violet?) — `$type: color`. |
| `design/tokens/base/dimension.tokens.json` | Skala odstępów (siatka 4 px), rozmiary (cele dotyku, ikony, wysokości kontrolek), promienie, grubości obramowań — `$type: dimension`. |
| `design/tokens/base/typography.tokens.json` | `fontFamily`, `fontWeight`, rozmiary, interlinie, letter-spacing; tokeny złożone `typography`. |
| `design/tokens/base/effects.tokens.json` | Cienie (`shadow`), ruch (`duration`, `cubicBezier`, złożone `transition`), z-index/warstwy (`number`), krycia. |
| `design/tokens/base/breakpoints.tokens.json` | Breakpointy i siatka (kolumny, gutter, marginesy) dla 360 / 768 / 1280 / 1440. |
| `design/tokens/semantic/color.light.tokens.json` | Role kolorów jako aliasy `{...}` do palety: `bg/surface/border/text/icon`, `action.primary|secondary|danger` (default/hover/pressed/disabled), `focus`, `feedback.success|warning|error|info`, `status.order.*`, `status.stage.*`, `status.payment.*`, `sync.*` (offline/synchronizacja/upload). Jedyny motyw w v1. |
| `design/tokens/semantic/size.tokens.json` (+ typografia semantyczna) | Role niezależne od motywu: `space.inset/stack/inline`, `control.height.web|mobile`, `touch-target.min = 48`, `text.body|label|heading-*|numeric`, `radius.control|card|dialog`, `elevation.*`, `motion.*`. |
| `docs/ux/styleguide.md` | Pełny styleguide wg struktury roli: 1 Zasady · 2 Fundamenty (kolor z tabelą kontrastów, typografia + licencje, odstępy, siatka i breakpointy, promienie, cienie, ruch, ikony + licencja zestawu) · 3 Komponenty (inwentarz AC4: warianty, stany, zasady użycia, tokeny, różnice web/mobile) · 4 Wzorce (formularze, tabele/listy, filtry, statusy, oś czasu, galeria, kolejka uploadu, puste stany, błędy, offline, potwierdzenia/cofnij, szkielety) · 5 Teren (AC6) · 6 Treści (AC7) · 7 Dostępność i egzekwowanie (AC8) · 8 Changelog (v1.0.0, 2026-10-02). Każda wartość podana z nazwą tokenu. |
| `docs/ux/README.md` | Aktualizacja nagłówka (artefakty istnieją), odnośniki do styleguide'u i tokenów. |

Narzędzia pomocnicze (skrypt liczący kontrast i walidujący JSON/aliasy) tylko w katalogu tymczasowym — nie trafiają do repo; wynik kontrastów wpisany do styleguide'u.

### Kluczowe decyzje projektowe (do zapisania w styleguide'zie)
- **Kolor marki:** pobrać wartości z CSS/logo eviacharge.pl; policzyć kontrast (WCAG 2.x, wzór luminancji względnej) na `#FFFFFF` i tle neutralnym. Jeśli < 4,5:1 (tekst) lub < 3:1 (UI) → zostaje jako kolor marki/dekoracyjny, a do ról `action.*` i tekstu dobieramy przyciemniony odcień tej samej barwy (HSL/OKLCH, ta sama tonacja), z uzasadnieniem w tabeli.
- **Fonty:** jeśli strona używa fontu otwartego (OFL, Google Fonts) — przyjmujemy go; jeśli komercyjnego/niewiadomej licencji — proponujemy otwarty odpowiednik (np. Inter / Roboto Flex / Source Sans 3, wszystkie OFL) z obsługą polskich znaków i cyfr tabelarycznych; fallback: fonty systemowe (SF Pro / Roboto). Wymóg: `font-variant-numeric: tabular-nums` dla kwot i dat w tabelach.
- **Ikony:** jeden otwarty zestaw dostępny dla web i mobile (rekomendacja: Lucide — ISC lub Material Symbols — Apache 2.0); wybór z uzasadnieniem licencyjnym; bibliotekę dodają developerzy w historyjkach implementacyjnych.
- **Statusy (AC5):** każda wartość statusu = unikalna ikona (kształt) + etykieta PL + kolor roli; tabela mapowania dla statusów zlecenia (Nowe, Wycena, Zaakceptowane, W realizacji, Zakończone, Rozliczone, Wstrzymane, Anulowane), etapu (do zrobienia, w toku, czekamy na stronę trzecią, zakończony, nie dotyczy, zablokowany) i płatności (planowana, wystawiona, opłacona, po terminie) wg `docs/product/domain.md`; sprawdzenie rozróżnialności w symulacji daltonizmu (deuter-/protanopia) i w skali szarości.
- **Teren (AC6):** `touch-target.min` 48 dp (rekomendacja 56 dp dla akcji głównych w terenie), strefa kciuka (akcje główne na dole), tryb „wysoki kontrast w słońcu” realizowany przez role semantyczne o kontraście ≥ 7:1 dla tekstu podstawowego (AAA) bez osobnego motywu; wskaźniki: offline, kolejka synchronizacji, stan uploadu każdego pliku (w kolejce / wysyłanie % / wysłane / błąd + ponów).
- **Ciemny motyw:** poza zakresem v1 — tylko struktura warstw na niego gotowa.

### Kontrakt API / migracje
Nie dotyczy.

### Plan weryfikacji (AC → sposób sprawdzenia przez inspekcję QA)
| AC | Jak sprawdzić |
|---|---|
| AC1 | `design/brand/README.md` zawiera URL-e źródłowe, datę, wartości kolorów i fonty z licencją; logo w repo lub odnośnik; sekcja „Decyzje” historyjki zawiera decyzję Konrada o źródle marki (jest) i — jeśli zaproponowano zmienione odcienie/fonty — ich akceptację. |
| AC2 | Styleguide ma podsekcje: kolor (role: akcje, statusy, błąd, ostrzeżenie, sukces, neutralne), typografia (skala + licencje), odstępy, siatka i breakpointy, promienie, cienie, ruch, ikony. Tabela kontrastów: każda para tekst/tło ≥ 4,5:1, każdy element UI (obramowanie pola, fokus, ikony statusu) ≥ 3:1 względem sąsiedniego tła — wartości policzone i wpisane; QA losowo weryfikuje ≥ 5 par w kalkulatorze kontrastu. |
| AC3 | Wszystkie pliki `*.tokens.json` to poprawny JSON zgodny z DTCG (`$value`, `$type`, aliasy `{grupa.token}` rozwiązywalne, brak cykli). Sprawdzenie „żadna wartość bez tokenu”: każda liczba/kolor w sekcji Fundamenty styleguide'u ma obok nazwę tokenu, która istnieje w plikach (grep nazw). Warstwa semantyczna odwołuje się wyłącznie do bazowej (brak literałów kolorów w `semantic/`). |
| AC4 | Inwentarz zawiera wszystkie 18 pozycji z AC4; dla każdej: warianty, stany (domyślny, hover, fokus, aktywny, wyłączony, błąd, ładowanie — gdzie dotyczy), zasady użycia (kiedy tak / kiedy nie), tokeny, różnice web/mobile. |
| AC5 | Tabele statusów zlecenia, etapu i płatności: każda wartość ma ikonę, etykietę PL i rolę koloru; ikony unikalne w obrębie grupy; adnotacja o weryfikacji w skali szarości / symulacji daltonizmu. |
| AC6 | Sekcja „Teren”: cele dotyku ≥ 48×48 dp (token), kontrast w słońcu, obsługa jedną ręką (strefa kciuka, rozmieszczenie akcji), wskaźniki offline/synchronizacji/uploadu ze stanami i mikrocopy; uwagi o rękawicach (brak gestów precyzyjnych, alternatywa dla gestów). |
| AC7 | Sekcja „Treści”: ton, terminologia ze słownika (tabela termin → użycie w UI), formaty: data `02.10.2026`, data+czas `02.10.2026, 14:05`, kwota `12 345,67 zł` (spacja niełamliwa), telefon `+48 600 123 456`/`600 123 456`; wzorzec komunikatu błędu „co się stało + co zrobić” z przykładami. Przykłady wyłącznie syntetyczne. |
| AC8 | Sekcja dostępności WCAG 2.2 AA (kontrast, fokus 2.4.11/2.4.13 — widoczny, niezasłonięty, cele 2.5.8, klawiatura, etykiety, ruch / `prefers-reduced-motion`, przeciąganie 2.5.7); sekcja egzekwowania (tylko tokeny i komponenty, reguły lint do wdrożenia w EVM-006 — np. zakaz literałów kolorów/px poza tokenami, przegląd UX jako bramka `/deliver`, proces odstępstw); changelog z wpisem v1.0.0. |

### Kolejność kroków
1. Pobranie materiałów marki z https://eviacharge.pl (WebFetch/Playwright: CSS, logo, fonty) → `design/brand/README.md`. Jeśli fonty są nieotwarte lub kolory wymagają dostosowania → przygotować 2 warianty z rekomendacją; decyzję Konrad zatwierdza przy demo (lub wcześniej przez orkiestratora, jeśli rozbieżność jest duża).
2. Tokeny bazowe (`design/tokens/base/*`) → liczenie kontrastów skryptem w katalogu tymczasowym → korekta rampy.
3. Tokeny semantyczne (`design/tokens/semantic/*`) + walidacja JSON i aliasów.
4. Styleguide: fundamenty z tabelą kontrastów (AC2) → statusy (AC5) → komponenty (AC4) → wzorce → teren (AC6) → treści (AC7) → dostępność, egzekwowanie, changelog (AC8).
5. `design/tokens/README.md`, aktualizacja `docs/ux/README.md`.
6. Samokontrola wg tabeli weryfikacji; przekazanie do przeglądu web-developer i mobile-developer (wykonalność tokenów i komponentów na obu platformach).

## Decyzje
- 2026-10-02 — Źródło materiałów marki: strona **https://eviacharge.pl** (logo, kolory, fonty) (Konrad).
- 2026-10-02 — Tokeny w dwóch warstwach (bazowe + semantyczne), aby tryb ciemny dało się dodać później bez refaktoru; w v1 tylko motyw jasny (Konrad).
- 2026-10-02 — Kolor akcji i linków: **wariant A — `#17656C`** (`palette.teal.700`, 6,74:1); `#247B83` pozostaje kolorem marki (logo, ekran logowania); neon `#6EFF33` wyłącznie jako akcent na ciemnym tle marki (Konrad, demo).
- 2026-10-02 — Fonty: **wariant A — Inter (treść) + Exo 2 (nagłówki)**, OFL 1.1 (Konrad, demo).

## Uwagi do rozważenia
- ~~Do akceptacji Konrada przy demo~~ — rozstrzygnięte 2026-10-02, patrz „Decyzje” (propozycje ux-designer, szczegóły `design/brand/README.md` § 6): (1) akcje i linki w przyciemnionym odcieniu marki `#17656C` zamiast `#247B83` (wariant A, wdrożony; B = dokładny `#247B83`, 4,96:1); (2) neon `#6EFF33` tylko jako akcent na ciemnym tle marki, nie jako kolor przycisków; (3) fonty Inter + Exo 2 (wariant A) vs tylko Inter (B).
- Nit (QA, poprawione przez orkiestratora): licznik tokenów w `design/tokens/README.md`, odsyłacz § 2.10 i adnotacja o metadanych logo w `design/brand/README.md`.
- Brak wariantów logo na jasne tło / monochromatycznego / samego sygnetu (ikona aplikacji) — prośba o pliki do Konrada.

## Definition of Done
- [x] AC1–AC8 spełnione (weryfikacja QA przez inspekcję) — qa-engineer: PASS dla AC1–AC8 (walidacja DTCG 479 tokenów, 144 pary kontrastu przeliczone, 33 ikony Lucide, wartości marki porównane z eviacharge.pl); orkiestrator: JSON i aliasy sprawdzone ponownie — 0 błędów
- [x] Przeglądy: web-developer, mobile-developer (wykonalność) — APPROVE (runda 2; runda 1: 4× major — BottomNav, stan „Czeka na Wi-Fi”, fokus i SyncIndicator w AppBar — poprawione)
- [x] Demo i akceptacja Konrada (2026-10-02)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-02 — ready → in-progress: start /deliver, gałąź feature/EVM-003-styleguide-i-design-tokens (worktree ../evia-manager-EVM-003, równolegle z EVM-001)
- 2026-10-02 — plan techniczny (ux-designer)
- 2026-10-02 — implementacja (ux-designer): materiały marki z eviacharge.pl → `design/brand/` (logo SVG, kolory, fonty OFL, ikony Lucide ISC); tokeny DTCG 2025.10 `design/tokens/base|semantic` (470 tokenów; walidacja: JSON, aliasy, cykle, typy, brak literałów w semantic — 0 błędów); `docs/ux/styleguide.md` v1.0.0 (AC2–AC8, tabela 122 par kontrastu — wszystkie ≥ progów; statusy sprawdzone w skali szarości i symulacji deuter-/protanopii); aktualizacja `docs/ux/README.md`, `CHANGELOG.md`. Odstępstwo od planu: role ruchu/cieni w osobnym `semantic/effects.tokens.json` (zamiast w `size.tokens.json`). Propozycje odcieni i fontów do akceptacji przy demo (patrz „Uwagi do rozważenia”). Commity — do wykonania przez orkiestratora (brak narzędzia powłoki w sesji ux-designer).
- 2026-10-02 — weryfikacja: QA PASS (AC1–AC8), przeglądy web-developer i mobile-developer APPROVE w rundzie 2 (runda 1: 4× major, poprawione); orkiestrator: walidacja tokenów, poprawki nitów, zrzut weryfikacji statusów → `docs/ux/reviews/EVM-003/`
- 2026-10-02 — in-progress → in-review: demo dla Konrada
- 2026-10-02 — demo: Konrad zaakceptował; warianty A (kolor akcji `#17656C`, fonty Inter + Exo 2) — in-review → done, squash merge do `main`
