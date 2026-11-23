# EVM-151 — dowód na emulatorze Androida: belka tytułu i dolna nawigacja przy dużej czcionce

Historyjka: [EVM-151](../../backlog/M2/EVM-151-mobile-appbar-i-nawigacja-przy-duzej-czcionce.md) (AC1–AC5). Data: 2026-11-23. Wykonawca: mobile-developer. Środowisko (ADR-0015): emulator AVD `Medium_Phone_API_35` (1080 × 2400, 411 dp), Maestro 2.11.0, build wariantu e2e z krótkiego klonu. Zrzuty (PNG, poza gitem): `docs/ux/reviews/EVM-151/` (po zmianie) i `docs/ux/reviews/EVM-151/przed/` (kod sprzed zmiany).

## Werdykt: ZIELONO (z uwagami w § 4)

## 1. Jak
Scenariusze `font-scale-bars` i `font-scale-sign-in` (`node tools/mobile-e2e/cli.mjs --only font-scale`, poza domyślnym przebiegiem): telefon loguje się przy skali domyślnej, potem krok `display:font=<skala>[,dp=<szerokość>]` ustawia `settings put system font_scale` i gęstość (`wm density`) i ten sam przegląd ekranów (`common/font-scale-tour.yaml`, 11 zrzutów) robi się przy 130% / 411 dp (`f130`), 200% / 411 dp (`f200`), 200% / 360 dp (`f200n`) i — dla AC4 — 100% / 360 dp (`f100n`). `display-reset` przywraca ustawienia po ostatnim kroku i przy porażce (`onFail`).

## 2. Czerwone na kodzie sprzed zmiany, zielone po zmianie
- Kod sprzed zmiany (`d3f1b0e2` + nowe przepływy): `150` (130%) przeszedł, **`151` (200%) i `154` (logowanie 200% / 360 dp) czerwone** (`151`: asercja kafla „Więcej” pod zgięciem — błąd mojego przepływu, poprawiony; `154`: patrz § 3). Zrzuty `przed/f200-3-order-photos.png`: „Zdjęcia zlecenia” łamie się w środku słów (jedna litera na linię), „Wstecz” i kapsuła zajmują belkę, nawigacja „Moje zlece..”.
- Testy Jest `font-scale-bars.test.tsx` (moduł `fontScale` i `BackButton` nie istniały; test źródła wykrywa `numberOfLines` w starych `BottomNav` i `SyncIndicator`) — czerwone przed zmianą.
- Po zmianie: `font-scale-bars` 5/5 kroków, `font-scale-sign-in` 1/1 (ponowione po poprawce przepływu).

## 3. Logowanie przy 360 dp / 200% (notatka historyjki)
Logowanie **działa**: M-01 mieści się, pola i przycisk mają cele ≥ 48 dp (`przed/f200n-0-login.png`). Czerwone było **założenie przepływu**: po zalogowaniu powiadomienie „System telefonu nie był aktualizowany od ponad 12 miesięcy…” przy 200% zajmuje cały ekran i spycha listę pod zgięcie, więc `assertVisible: ZL-E2E-1` nie widział zlecenia. Przepływ `154` najpierw czeka na kapsułę synchronizacji i zamyka powiadomienie („Rozumiem”). To samo tłumaczy, dlaczego `140` z EVM-142 nie przewijał do kafla kwarantanny przy 130% i 200% — treść ekranu, nie belka (poza zakresem; do osobnej historyjki EVM-142 AC6 / EVM-110 AC6).

## 4. AC → dowód
| AC | Dowód | Status |
|---|---|---|
| AC1 tytuł w całości | zrzuty `f130-*`, `f200-*`, `f200n-*` (Read): tytuły („Zdjęcia zlecenia”, „Moje zlecenia”, „ZL-E2E-1”, „Prywatność i pomoc”, „Kolejka”, „Więcej”) w całości, zawinięcie wyłącznie na spacji (130%/411 dp: „Zdjęcia / zlecenia” w 2 liniach), bez wielokropka; Jest: brak `numberOfLines`, `adjustsFontSizeToFit`, `maxFontSizeMultiplier` | zielone |
| AC2 Wstecz i kapsuła | układ dwuwierszowy (zrzuty 200%): ikona wstecz po lewej i kapsuła „Zsynchr. hh:mm” z pełnym tekstem w wierszu 1, tytuł w wierszu 2; `BackButton` 48 × 48 dp z nazwą dostępną (Jest); stany „Offline” i „Wymaga uwagi” — kapsuła z tekstem w Jest (`SyncIndicator` bez zmiany tekstów), na emulatorze sprawdzono tylko „Zsynchr.” | zielone, część Offline/Wymaga uwagi tylko w Jest |
| AC3 dolna nawigacja | 200% / 411 dp: „Moje / zlecenia” w 2 liniach; 200% / 360 dp: „Zlecenia” (skrót), nazwa dostępna „Moje zlecenia”; kapsuła aktywnej pozycji i pogrubienie, równa wysokość | zielone |
| AC4 bez zmiany przy 100% | `f100n-*` (przebieg 360 dp / 100%) i Jest (`tier = normal` → ten sam układ); „Wstecz” jest teraz ikoną (decyzja UX) | zielone |
| AC5 wszystkie ekrany | tabela poniżej, test źródła, scenariusze | zielone |

Ekrany z `AppBar`/`BottomNav`: Shell (BottomNav) i lista zleceń (`*-1-orders`), szczegóły (`-2`), zdjęcia zlecenia (`-3`), pliki zlecenia (`-4`), formularz wpisu (`-5`), aparat (`-6`, ekran zgody/podgląd; przycisk „Zamknij” zostaje tekstowy), szybkie zlecenie (`-7`), wizja lokalna (`-8`), Kolejka (`-9`), Więcej (`-10`), Prywatność i pomoc (`-11`). `UpdateRequiredScreen` nie ma `AppBar` ani `BottomNav` (grep) — poza przeglądem. Warianty trybu ukrytych danych (`AppBar` z „Zamknij” w `QuickOrderScreen`/`SiteSurveyScreen`) używają tego samego komponentu; sprawdzone w Jest, bez zrzutu.

## 5. Uwagi i ryzyka
1. **Kolejność fokusu w układzie dużym**: czytnik prowadzi wg układu wizualnego (Wstecz, kapsuła, tytuł) — konsultacja zakładała „Wstecz, tytuł, kapsuła”; zapisane jako odstępstwo w styleguide § 3.18 i M-08, do potwierdzenia przez `ux-designera`. Na TalkBack nie sprawdzono.
2. Kapsuła ma `flexShrink: 1` (konsultacja: 0), by przy bardzo wąskim wierszu tekst zawinął się zamiast wyjść poza ekran; na ekranie aparatu przy 200% / 360 dp zawija się na spacji („Zsynchr. / 14:30”) obok „Zamknij”.
3. Poza zakresem, zauważone na zrzutach: ekran aparatu przy 200% — „Gotowe” łamie się w środku słowa („Gotow / e”), a chipy kategorii są ucięte z prawej (`f200n-6-camera.png`); kafel kwarantanny pod zgięciem. Do osobnej historyjki (EVM-110 AC6).
4. Przejrzano oczami zrzuty: `f200n` 1, 2, 3, 6, 9, 10, 11; `f200-1`, `-3`; `f130-3`; pozostałe zrzuty zebrane, ale nieoglądane pojedynczo.
5. Tryb poziomy (WCAG 1.3.4) nie sprawdzany (poza zakresem historyjki).
