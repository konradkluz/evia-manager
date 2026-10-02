# Marka EVia Charge — materiały źródłowe

> EVM-003 · Właściciel: `ux-designer` · Pobrano: **2026-10-02** · Decyzja o źródle: Konrad, 2026-10-02 (strona https://eviacharge.pl).
> Ten plik dokumentuje **skąd** pochodzą wartości marki. Wartości używane w produkcie żyją wyłącznie w `design/tokens/` (paleta `palette.*`), a zasady ich użycia w `docs/ux/styleguide.md`.

## 1. Źródła
| Co | URL | Metoda |
|---|---|---|
| Strona główna | https://eviacharge.pl/ | Playwright — style obliczone (`getComputedStyle`) wszystkich elementów, liczba wystąpień kolorów |
| Arkusz CSS | https://eviacharge.pl/_next/static/immutable/chunks/1lmg_uyibtipf.css | zmienne CSS `--font-*` |
| Logo | https://eviacharge.pl/logo.svg | pobrane 2026-10-02 → `logo-color.svg` (bez zmian graficznych; późniejsza wersja na stronie różni się jedynie metadanymi edytora Inkscape) |
| Fonty | Google Fonts (ładowane przez stronę z `fonts.googleapis.com` / `fonts.gstatic.com`) | `document.fonts` |
| Ikony | inline SVG z klasą `lucide` | inspekcja DOM |

## 2. Wyekstrahowane kolory
Kontrast liczony wzorem WCAG 2.x (luminancja względna), skrypt pomocniczy poza repozytorium.

| Kolor | HEX | Gdzie na stronie | Kontrast na `#FFFFFF` | Na `#F5F5F5` | Na `#1A1A1A` | Token w palecie |
|---|---|---|---|---|---|---|
| Morski (teal) — kolor główny | `#247B83` | tło logo, sekcje, tekst wyróżniony (67× tekst, 5× tło) | 4,96:1 | 4,55:1 | 3,51:1 | `palette.teal.600` |
| Neonowa zieleń — akcent | `#6EFF33` | przyciski CTA („Kontakt”, „Umów bezpłatną wizję”), elementy logo (114× tekst/ikona) | **1,31:1** | 1,20:1 | 13,27:1 | `palette.lime.300` |
| Neon (obrys w logo) | `#81FD18` | tylko obrys ścieżek logo | 1,31:1 | — | 13,26:1 | — (nie przenoszony) |
| Grafit — tekst | `#1A1A1A` | tekst podstawowy, tekst na przyciskach CTA | 17,40:1 | 15,96:1 | — | `palette.neutral.900` |
| Szary | `#838383` | tekst drugorzędny, obrys logo | **3,79:1** | 3,48:1 | 4,59:1 | `palette.neutral.500` |
| Jasnoszare tło | `#F5F5F5` | tła sekcji | — | — | 15,96:1 | `palette.neutral.100` |
| Żółty | `#FACC15` | gwiazdki ocen | 1,53:1 | 1,40:1 | 11,36:1 | — (nie przenoszony; ostrzeżenia = rampa `palette.amber`) |

Pozostałe wartości ze strony: promień przycisków 8 px (miejscami 6 px) → `radius.control` = `dimension.8`.

## 3. Fonty i licencje
| Font | Użycie na stronie | Wagi na stronie | Licencja | Polskie znaki | Decyzja |
|---|---|---|---|---|---|
| **Inter** | cały tekst, przyciski | 400, 500, 600 | SIL Open Font License 1.1 (Google Fonts) | tak | `font.family.sans` — font interfejsu (web + mobile, osadzony w aplikacji) |
| **Exo 2** | nagłówki, logotyp „EVia” | 600, 700 | SIL Open Font License 1.1 (Google Fonts) | tak (Latin Extended) | `font.family.display` — tylko `text.display` i `text.heading-1` |
| JetBrains Mono | zadeklarowany, nieużywany na stronie głównej | 400, 500 | SIL Open Font License 1.1 | tak | `font.family.mono` — tylko identyfikatory techniczne |

Wszystkie fonty są otwarte (OFL 1.1): wolno je osadzać w aplikacji web i mobilnej oraz serwować samodzielnie (bez Google Fonts CDN — zalecane ze względu na RODO i działanie offline). Plik licencji `OFL.txt` dołączają developerzy razem z plikami fontów (EVM-006 / EVM-008 / EVM-009).

## 4. Ikony
Strona używa **Lucide** (licencja ISC). Ten sam zestaw przyjmujemy w produkcie (wersja sprawdzona: `lucide-static` 1.50.0, wszystkie ikony użyte w styleguide istnieją) — szczegóły w `docs/ux/styleguide.md` § 2.10.

## 5. Logo
| Plik | Opis | Uwagi |
|---|---|---|
| `logo-color.svg` | Logo kolorowe (sygnet + „EVia”), białe i neonowe elementy | Zaprojektowane na tło `#247B83` (`color.bg.brand`). **Na białym tle białe elementy znikają** — nie używać na `color.bg.surface`. |

Brakujące warianty (pytanie do Konrada): wersja na jasne tło (ciemny sygnet i napis), wersja monochromatyczna, sam sygnet (ikona aplikacji, favicon), pole ochronne i minimalny rozmiar. Do czasu ich otrzymania: logo tylko na `color.bg.brand` lub `color.bg.brand-strong`, wysokość min. 32 px (`dimension.32`), pole ochronne = 1/4 wysokości logo.

## 6. Dostosowania kolorów (propozycja do akceptacji Konrada)
| Problem | Propozycja | Uzasadnienie |
|---|---|---|
| `#247B83` z białym tekstem ma 4,96:1 — spełnia AA, ale nie AAA; na `#F5F5F5` jako tekst tylko 4,55:1 (na granicy) | **Wariant A (rekomendowany, wdrożony w tokenach):** akcje i linki w przyciemnionym odcieniu tej samej barwy `#17656C` (`palette.teal.700`, OKLCH: ta sama tonacja, L 0,465) → 6,74:1 z białym tekstem; hover `#115157` (8,98:1). `#247B83` zostaje kolorem marki (logo, ekran logowania, `color.brand.primary`). | Praca w pełnym słońcu wymaga zapasu kontrastu; odcień jest wizualnie tą samą „morską” marką. |
| | Wariant B: przyciski dokładnie w `#247B83` (4,96:1, AA) | Wierniej stronie, mniejszy zapas w terenie. Zmiana = 1 alias (`color.action.primary.bg` → `palette.teal.600`). |
| Neonowa zieleń `#6EFF33` ma 1,31:1 na białym — nie nadaje się na tekst ani elementy UI na jasnym tle | Akcent tylko na ciemnych tłach marki (`color.brand.accent` na `color.bg.brand-strong` = 6,85:1), np. wskaźnik aktywnej pozycji nawigacji, elementy logo. **Nie jest kolorem statusu** (sukces = `palette.green`), żeby nie mylić „marki” z „zakończone”. | Na stronie CTA są neonowe z ciemnym tekstem — w aplikacji roboczej akcja główna musi być spójna i przewidywalna, więc dostaje kolor morski. |
| Szary `#838383` ma 3,79:1 — za mało na tekst | Tylko obrysy pól (`color.border.strong`, ≥ 3:1) i tekst wyłączony. Tekst drugorzędny = `#404040` (`palette.neutral.700`, 10,37:1). | WCAG 1.4.3 / 1.4.11. |

Fonty nie wymagają zmian (otwarte). Wariant fontów do rozważenia: **A (rekomendowany)** Inter + Exo 2 (spójność ze stroną) · B tylko Inter (mniej plików fontów w aplikacji mobilnej).
