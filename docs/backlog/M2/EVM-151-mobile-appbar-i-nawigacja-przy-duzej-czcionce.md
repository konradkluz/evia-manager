---
id: EVM-151
title: "Aplikacja: belka tytułu i dolna nawigacja czytelne przy dużej czcionce systemowej (130–200%)"
type: bug
milestone: M2
epic: E9 Dostęp mobilny
status: in-progress
priority: P2
path: lekka            # zmiana wyglądu wspólnych komponentów mobile, bez danych, API i uprawnień; weryfikacja zrzutami i testem źródła
owner: mobile-developer
contributors: []
reviewers: [ux-designer]
model: sonnet
depends_on: [EVM-009]
---

# EVM-151: Aplikacja — belka tytułu i dolna nawigacja czytelne przy dużej czcionce systemowej (130–200%)

> Szkic do akceptacji przez Konrada (zgłoszenie 2026-11-23). Wykryte przy dowodzie EVM-142 AC6 (200% czcionki) — zrzuty `.scratch/EVM-142/v2-*.png` i `docs/qa/EVM-142/dowod-ac5-na-emulatorze.md` w gałęzi `feature/EVM-142-podglad-zdjec-zlecenia`.

## Cel
Jako **technik w terenie** (często z powiększoną czcionką systemową) chcę **czytać tytuł każdego ekranu i etykiety dolnej nawigacji w całości**, aby **wiedzieć, gdzie jestem, bez zgadywania z ucinanych fragmentów**.

Dziś przy 200% i 411 dp „Wstecz” oraz kapsuła synchronizacji („Zsynchr. 11:15”) zajmują prawie całą szerokość wspólnej belki (`AppBar`), więc tytuł („Zdjęcia zlecenia”) ma szerokość ok. jednego znaku i łamie się w środku słów; dolna nawigacja (`BottomNav`) ucina etykiety („Moje zlece..”). To naruszenie WCAG 2.2 AA 1.4.4 (zmiana rozmiaru tekstu) i 1.4.10 (reflow). Zasada „200% bez ucinania” jest już w EVM-142 AC6 i EVM-110 AC6 — ta historyjka naprawia przyczynę we wspólnych komponentach, nie na pojedynczych ekranach. Kontekst: EVM-146 (wspólna powłoka ekranów — nie psuć blokady i ukrytych danych), styleguide § 3.18.

## Kryteria akceptacji

**AC1 — Tytuł ekranu jest czytelny w całości**
- Zakładając system z czcionką 130%, 200% i szerokością 411 dp oraz 360 dp, dowolny ekran z belką, także z „Wstecz” i kapsułą synchronizacji
- Gdy otwieram ekran (np. „Zdjęcia zlecenia”, „Moje zlecenia”, szczegóły zlecenia)
- Wtedy tytuł jest widoczny w całości, zawija się wyłącznie na granicy słów (żadne słowo nie jest łamane w środku), nie jest skracany wielokropkiem, a belka rośnie na wysokość.

**AC2 — „Wstecz” i kapsuła synchronizacji nie zabierają miejsca tytułowi**
- Zakładając skalę, przy której zawartość belki nie mieści się w jednym wierszu (zachowanie dobrane z ux-designerem)
- Gdy belka ma „Wstecz”, tytuł i kapsułę
- Wtedy żaden element nie traci informacji ani nazwy dostępnej (czas i stan synchronizacji, w tym „Wymaga uwagi”/błąd, pozostają odczytywalne, a „Wstecz” ma etykietę dla czytnika ekranu), każde działanie ma cel dotyku ≥ 48 dp, a kolejność fokusu pozostaje: „Wstecz”, tytuł, kapsuła.

**AC3 — Dolna nawigacja nie ucina etykiet**
- Zakładając skalę 130–200%, szerokość 411 dp i 360 dp oraz wszystkie pozycje nawigacji
- Gdy widzę dolną nawigację
- Wtedy każda pozycja pokazuje pełną etykietę (zawinięcie na granicy słów albo skrócenie ustalone z ux-designerem tak, by nie tracić znaczenia), nazwa dostępna pozostaje pełna, stan wybrany jest nadal widoczny nie tylko barwą, cel dotyku ≥ 48 dp, a belka i nawigacja razem nie zasłaniają zawartości ekranu bez możliwości przewinięcia.

**AC4 — Bez zmiany przy 100%**
- Zakładając czcionkę systemową 100% (i 360 dp oraz 411 dp)
- Gdy otwieram te same ekrany
- Wtedy belka i dolna nawigacja wyglądają i działają jak dotąd (tytuł w jednym wierszu, kapsuła po prawej, „Wstecz” po lewej), a istniejące testy i scenariusze mobile pozostają zielone bez poluzowania.

**AC5 — Wszystkie ekrany sprawdzone i dowód**
- Zakładając listę ekranów z `AppBar` i `BottomNav` ustaloną grepem w implementacji (dziś m.in. `Shell`, `OrdersScreen`, `OrderDetailScreen`, `OrderFilesScreen`, `EntryFormScreen`, `QuickOrderScreen`, `QueueScreen`, `MoreScreen`, `PrivacyHelpScreen`, `SiteSurveyScreen`, `CameraScreen`, `UpdateRequiredScreen`)
- Gdy uruchamiam osobny, tani scenariusz Maestro (nie powielamy istniejących) z długimi tytułami przy 130%, 200% i 360 dp/200%, oraz test źródła komponentów (bez limitu linii tytułu, bez wyłączonego skalowania czcionki, bez stałej wysokości kontenera z tekstem — jak w EVM-110 AC6)
- Wtedy dla każdego ekranu z listy jest zrzut lub asercja, że tytuł i etykiety są w całości, a wynik trafia do dowodu QA; ekran, którego nie da się sprawdzić (np. wymaga uprawnienia aparatu), jest wymieniony z powodem; scenariusz i test są najpierw czerwone na kodzie sprzed zmiany.

## Poza zakresem
- Panel web (inne układy, osobna kontrola).
- Zmiana typografii, skali tokenów i samej wielkości czcionki w aplikacji; nie wyłączamy skalowania czcionki (to złamałoby 1.4.4).
- Tryb poziomy (landscape) i tablety.
- Treść ekranów poza belką i dolną nawigacją (osobno: EVM-142 AC6, EVM-110 AC6).
- Skala powyżej 200% (system oferuje do ok. 200%; zachowanie „best effort”, bez AC).

## Decyzje i ograniczenia
- Wspólne komponenty `apps/mobile/src/ui/AppBar.tsx`, `SyncIndicator`/`SyncCapsule`, `BottomNav.tsx`; tylko tokeny i komponenty z biblioteki (styleguide wiążący); odstępstwa wyłącznie za zgodą ux-designera i z wpisem do styleguide’u § 3.18 oraz do specyfikacji ekranów (flows, M-08 w `09-mobile-zdjecia-filmy-offline.md`).
- Zmiana wspólnej powłoki nie może naruszyć blokady i trybu ukrytych danych (EVM-146, EVM-101).
- **UX / UI (konsultacja ux-designera, 2026-11-23; tylko mobile):**
  - Progi skali (jedna stała w kodzie, wspólny hook `useFontScaleTier()` dla AppBar i BottomNav, bez nowych tokenów): normalny ≤ 1,0; średni 1,0–1,3; duży > 1,3 (przy 360 dp układ „duży” już od skali > 1,0).
  - AppBar: „Wstecz” zawsze jako ikona `arrow-left` w celu 48×48 dp z `accessibilityLabel="Wstecz"` (styleguide § 3.18; dziś w kodzie jest tekst — odstępstwo); tytuł zawijany na granicy słów (2 linie normalny/średni, 4 duży), bez ellipsis i bez `adjustsFontSizeToFit`; belka ma `minHeight` i rośnie z treścią.
  - Układ „duży”: dwa wiersze — wiersz 1: „Wstecz” i kapsuła synchronizacji z pełnym tekstem; wiersz 2: tytuł na pełnej szerokości. Kapsuła nie jest „tylko ikoną” (stany „Offline” i „Wymaga uwagi” muszą mieć tekst), bez `numberOfLines={1}`, `flexShrink: 0`, `minHeight` 48 dp. Układ „średni”: jeden wiersz, tytuł `flex: 1` z `minWidth` ≈ 96 dp (gdy się nie mieści w 360 dp → układ duży). Kolejność fokusu: wstecz, tytuł (nagłówek), synchronizacja.
  - BottomNav: bez `numberOfLines={1}` (do 2 linii, zawijanie po spacji), `minHeight` zamiast stałej wysokości, pozycje równej wysokości, ikona i wskaźnik w dp (nie rosną z czcionką), cała pozycja jest celem ≥ 48 dp; przy skali > 1,3 i szerokości ≤ 400 dp, gdy słowo się nie mieści, świadome skrócenie przez pole `shortLabel` ("Zlecenia" zamiast "Moje zlecenia"), `accessibilityLabel` zostaje pełny; odznaka „Kolejka, n do wysłania” sprawdzona w układzie 2-liniowym.
  - WCAG 2.2 AA: 1.4.4 (200% bez utraty treści), 1.4.10 (reflow 360 dp bez przewijania poziomego), 2.5.8 (cele ≥ 48 dp), 1.3.4 (orientacja pozioma sprawdzona); zakaz `maxFontSizeMultiplier` dla tytułu i etykiet; pierścień fokusu `color.focus.ring-inverse` bez zmian.
  - Dokumenty do aktualizacji: styleguide § 3.18 (ikona zamiast tekstu „Wstecz”, progi, układ dwuwierszowy, `minHeight`; BottomNav: 2 linie i `shortLabel`) z wpisem w changelogu; M-08 (`docs/ux/flows/09-mobile-zdjecia-filmy-offline.md`) — układ AppBar przy dużej czcionce.
  - Do sprawdzenia (Maestro/zrzuty, skale 1,0 / 1,3 / 2,0, 411 i 360 dp): M-08 „Zdjęcia zlecenia” z kapsułą „Zsynchr. hh:mm”, „Offline” i „Wymaga uwagi”; M-08a/b (podgląd); lista zleceń (bez „Wstecz”); szczegóły zlecenia (M-03) i Kolejka (licznik); „Więcej” i ustawienia; BottomNav na każdym z nich; brak przewijania poziomego, belka nie zasłania pierwszego elementu listy.

## Notatki
- Przy 360 dp i 200% logowanie w e2e (Maestro) padało — zbadać osobno, czy to ten sam problem układu (belka/pola) czy rozjazd selektorów; nie blokuje AC, ale scenariusz AC5 musi mieć sposób logowania odporny na tę skalę.
- Podział, gdyby za duża: (a) belka (AC1, AC2), (b) dolna nawigacja (AC3), przy wspólnym AC4/AC5.
- Sposób ustawienia skali i rozmiaru ekranu w emulatorze — decyzja wykonawcy; scenariusz ma przywracać domyślne ustawienia.

## Dziennik
- 2026-11-23 — utworzono jako szkic (product-owner)
- 2026-11-23 — konsultacja ux-designera wklejona do „UX / UI” (Tech Lead); Konrad: akceptuje, jedna historyjka, skrót „Zlecenia” dla dolnej nawigacji; status `ready`
- 2026-11-23 — start realizacji (/deliver): gałąź `feature/EVM-151-appbar-duza-czcionka`, klon `evia-manager-n1`, ścieżka `lekka`, wykonawca mobile-developer (`sonnet`), recenzent ux-designer; Konrad potwierdził kontynuację mimo 9 historyjek in-review
