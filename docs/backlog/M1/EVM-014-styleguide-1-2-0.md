---
id: EVM-014
title: Styleguide 1.2.0 — propozycje [P-1…P-13] i poprawki makiet z EVM-004
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: ux-designer
contributors: [security-engineer]
reviewers: [web-developer, mobile-developer, product-owner]
depends_on: [EVM-004]
---

# EVM-014: Styleguide 1.2.0 — propozycje [P-1…P-13] i poprawki makiet z EVM-004

## Historyjka
Jako **zespół wykonawców panelu i aplikacji** chcemy **styleguide'u 1.2.0 z zaakceptowanymi propozycjami [P-1…P-13] i poprawionymi makietami**, aby **każdy ekran M1 powstawał wyłącznie z komponentów i tokenów biblioteki, bez interpretowania „propozycji”**.

## Kontekst
- Decyzja Konrada z EVM-004 (pytanie 4): propozycje [P-1…P-13] są zaakceptowane, a wdrożenie w styleguide 1.2.0 następuje **przed pierwszą historyjką, która ich używa** (EVM-016: P-5; EVM-067: P-11; EVM-022: P-3; EVM-031: P-2, P-6; EVM-023: P-4; EVM-044: P-7; EVM-030: P-1; [P-12] — każda lista ze słownikami).
- Wejścia: `docs/ux/styleguide.md` § 8 („Propozycje (EVM-004)”), `docs/ux/flows/README.md` → „Propozycje do styleguide'u”, uwagi EVM-004: PO-2–PO-5 oraz „Uwagi nieblokujące z weryfikacji (runda 2)” pkt 1, 2, 8, 9, 10.
- Plan M1 i kolejność: [README.md](README.md).

## Kryteria akceptacji
**AC1 — Propozycje w bibliotece**
- Zakładając zaakceptowane propozycje [P-1…P-13] (styleguide § 8)
- Gdy wykonawca szuka komponentu lub wzorca dla ekranu M1
- Wtedy każda propozycja ma w styleguide 1.2.0 własny opis w rozdziale komponentów albo wzorców (anatomia, warianty, stany, tokeny, dostępność, mikrocopy), a § 8 wskazuje jej nowe miejsce z oznaczeniem „od 1.2.0”.

**AC2 — Makiety bez oznaczeń „spoza styleguide'u”**
- Zakładając makiety w `docs/ux/flows/`
- Gdy czytam listę „Komponenty i tokeny” dowolnego ekranu
- Wtedy odwołania `[P-n]` są zastąpione odwołaniami do § styleguide'u 1.2.0, a tabela propozycji w `flows/README.md` ma pełną kolumnę „Ekrany” (runda 2 pkt 1: m.in. P-2 → W-05, M-07; P-8 → M-06, M-07; P-9 → M-03, M-04, M-10).

**AC3 — Tokeny**
- Zakładając propozycję, która wymaga nowych tokenów
- Gdy wykonawca używa komponentu
- Wtedy tokeny są w `design/tokens/` (warstwa semantyczna, format DTCG, poprawny JSON, wersja 1.2.0), opisy komponentów nie zawierają literałów kolorów, rozmiarów ani fontów, a klucze `quote` / `issued` zostają z `$deprecated` do najbliższej wersji MAJOR (decyzja 1 z EVM-004).

**AC4 — Formy bezosobowe (PO-2, runda 2 pkt 2)**
- Zakładając, że `User` ma tylko `displayName` (bez płci)
- Gdy mikrocopy opisuje działanie osoby (dziennik, etap, osoba odpowiedzialna)
- Wtedy styleguide § 4.5, `flows/03-szczegoly-zlecenia.md` i `flows/05-wpis-i-komentarz.md` używają form bezosobowych, np. „Zmiana statusu etapu „…”: «Czekamy na…»”, „Dodano 12 zdjęć · W trakcie prac”, „Osoba odpowiedzialna: Anna Testowa”, a autor zostaje w nagłówku wpisu.

**AC5 — Poprawki drobne makiet**
- Zakładając uwagi PO-3–PO-5 i runda 2 pkt 8–10 z EVM-004
- Gdy czytam poprawione makiety
- Wtedy:
  - kafel „Na kogo czekamy” w W-06 nie ma wiersza „klient: —” (PO-3);
  - etykieta dużego filmu brzmi „Nieskanowany antywirusem — plik za duży” (PO-4) — po potwierdzeniu przez `security-engineer`, który aktualizuje brzmienie w SR-FILE-12 i P5;
  - PPE w makietach występuje wyłącznie w formie oznaczonej `TEST`, zgodnie z zasadą „Dane w makietach” (PO-5);
  - trzy odnośniki banera „Zlecenie założone w terenie” mają różne komponenty i opisy dostępne — nawigacja (W-14), dialog (W-20), przewinięcie do „Płatności” (pkt 8);
  - kolejność kontroli w diagramie logowania mobilnego jest taka jak w tabelach M-01 / M-02 — `403 channel_not_allowed` przed „Dodaj kod z aplikacji” (pkt 9);
  - nieaktualne zdanie o luce L8 w `scenariusze-a-d.md` jest usunięte.

**AC6 — Dostępność nowych elementów**
- Zakładając nowe komponenty i wzorce z AC1
- Gdy sprawdzam je wg WCAG 2.2 AA
- Wtedy kontrasty wynikają z tokenów i są w tabeli kontrastów (§ 2.1.4), fokus jest widoczny, cele dotyku mają co najmniej `size.touch-target.min`, a nazwy dostępne i ogłaszanie zmian są opisane.

**AC7 — Wersja i spójność dokumentacji**
- Gdy publikuję wersję 1.2.0
- Wtedy nagłówek styleguide'u i `docs/ux/README.md` wskazują 1.2.0 z historią zmian, `CHANGELOG.md` ma wpis w „Zmieniono”, a `npm run docs:check` kończy się wynikiem 0 błędów.

## Poza zakresem
- Makiety ekranów „bez makiety” — EVM-015 (E1) i EVM-071 (pozostałe ekrany M1).
- Uwagi mobilne z rundy 2 (pkt 3–7: wyszukiwanie offline a polskie znaki, usuwanie z Kolejki, dialog po `duplicate`, moment prośby o powiadomienia, medium usunięte w biurze) — refinement M2 (E10–E12).
- Prototyp HTML (decyzja 6 z EVM-004).

## UX / UI
Dokumentacja: styleguide, tokeny i makiety. Nowych ekranów nie ma. Przykłady wyłącznie z danymi syntetycznymi (styleguide § 6.3).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (dokument) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

Nie dotyczy danych osobowych. Zmiana etykiety z PO-4 wymaga potwierdzenia `security-engineer` (P5, SR-FILE-12).

## Notatki techniczne
- Tokeny w formacie z EVM-003; konsumenci: panel (EVM-008 — Tailwind z tokenów) i aplikacja (EVM-009). Jeśli pakiet tokenów jest już w monorepo (EVM-006/008), zmiana wymaga przebudowy pakietu — `ux-designer` zgłasza to `web-developer`.
- Bez nowych zależności.

## Plan techniczny
Styleguide i tokeny 1.1.0 → **1.2.0** — zmiana MINOR (§ 7.2 pkt 5): nowe komponenty, warianty, wzorce i 6 tokenów. Żadna nazwa nie znika. Numeracja istniejących § zostaje, więc odwołania w makietach i historyjkach M1 pozostają ważne. Kontrakt API, migracje, model danych i zależności — nie dotyczy. Baza porównania: `feature/EVM-006-repo-i-ci`.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/ux/styleguide.md` | nagłówek 1.2.0 · 2026-10-04 · EVM-014 i spis treści; 13 opisów propozycji (tabela „Miejsca” niżej); § 2.1.3 — role `color.progress.*` i `color.status.unknown.*`; § 2.1.4 — nowe pary; odwołania: § 3.1, § 3.6, § 3.8 (menu `ellipsis-vertical` → § 3.20), § 3.11, § 3.12, § 4.4, § 4.7, § 5.2, § 5.4 (priorytet i stan „Wymaga uwagi”), § 7.1 (2.2.1 → § 4.17, 3.3.8 → § 3.2.1); § 4.5 i § 6.1 — formy bezosobowe; § 8 — wpis 1.2.0 (zmiany, rozstrzygnięcia, tokeny 491 → 497, „Odstępstwa: brak”), w tabeli propozycji nowa kolumna „Od 1.2.0” (§ z linkiem) i pełna kolumna „Ekrany” | AC1, AC3, AC4, AC6, AC7 |
| `design/tokens/semantic/color.light.tokens.json` | nowe `color.progress.{track,fill}` → `{palette.neutral.200}`, `{palette.teal.700}`; `color.status.unknown.{bg,text,icon,border}` → `{palette.neutral.100}` / `.800` / `.700` / `.300` z `$extensions.pl.eviacharge.status` („Nieznany status”, `circle-help`, `neutral`); wyłącznie aliasy do `base/`, `$type` z grupy `color`; `quote` / `issued` bez zmian (`$deprecated`) | AC3 |
| `design/tokens/README.md` | wersja 1.2.0; struktura (`color.progress`); wyjątek reguły mapowania — `color.status.unknown` nie jest kodem modelu i jest wspólny dla grup; „Zmiany w wersji 1.2.0”; 497 tokenów (base 184, semantic 313, w tym 8 wycofywanych) | AC3, AC7 |
| `docs/ux/flows/README.md` | podstawa 1.2.0; notacja: `⋮`, `«… ▾»` → § 3.20, `▸` / `▾` → § 3.21, wiersz `[P-n]` usunięty; zasady wspólne (P-9, P-11 → §); „Pokrycie AC4” — odwołania do § 1.2.0; wiersz P5 — nowa etykieta; „Dane w makietach” — PPE tylko z oznaczeniem `TEST` (np. `PL-TEST-0001`); „Propozycje do styleguide'u” — kolumny: P-n, element, „Od 1.2.0” (§), pełne „Ekrany” | AC2, AC5 |
| `docs/ux/flows/01`…`10`, `scenariusze-a-d.md` | każde `[P-n]` (szkielety ASCII, tabele stanów, „Komponenty i tokeny”, tekst) → nazwa komponentu + § 1.2.0; poprawki AC4 / AC5 (tabela niżej) | AC2, AC4, AC5 |
| `docs/ux/README.md`, `docs/README.md` | „Styleguide v1.2.0 obowiązuje” z historią wersji (1.0.0 — EVM-003, 1.1.0 — EVM-004, 1.2.0 — EVM-014); artefakty | AC7 |
| `CHANGELOG.md` | „Unreleased → Zmieniono”: styleguide i tokeny 1.1.0 → 1.2.0 [EVM-014] | AC7, DoD |
| `docs/security/requirements.md` (SR-FILE-12), `docs/security/policies.md` (P5 pkt 3) | **`security-engineer`**: potwierdza albo koryguje brzmienie „Nieskanowany antywirusem — plik za duży” i aktualizuje oba miejsca — tylko to | AC5 |
| ten plik | plan, „Dziennik”, potem „Uwagi do rozważenia” i DoD | — |

Bez zmian:
- `packages/tokens` — testy nie sprawdzają liczby tokenów, a nowe tokeny są w istniejącej grupie `color`, więc eksporty (`color`, `space`, …) się nie zmieniają;
- ADR-y, `domain-model.md`, `offline-sync.md`, `domain.md`;
- historyjki M1 — ich `[P-n]` rozwiązuje § 8 (kolumna „Od 1.2.0”);
- `design/prototypes/` — poza zakresem.

**Miejsca propozycji w 1.2.0 (AC1)**
- Nowe komponenty i wzorce dostają sekcje na końcu rozdziałów (bez przenumerowania), a warianty istniejących komponentów — podsekcje.
- Każda sekcja ma nagłówek „(od 1.2.0)”, listę ekranów i bloki: **Anatomia · Warianty · Stany** (domyślny, hover, fokus, wciśnięty, wyłączony, błąd, ładowanie; „nd.” z powodem) **· Tokeny · Dostępność · Mikrocopy · Web / mobile**.

| P | Element | Miejsce | Nowe tokeny |
|---|---|---|---|
| P-1 | Menu akcji (ActionMenu) | § 3.20 | — |
| P-2 | Sekcja rozwijana (Disclosure) | § 3.21 | — |
| P-3 | Karta wyboru (SelectableCard) | § 3.22 | — |
| P-4 | Pole kodu jednorazowego i kodu odzyskiwania (TextField) | § 3.2.1 | — |
| P-5 | Stan blokujący (EmptyState) | § 3.15.1 | — |
| P-6 | Postęp procesu (ProcedureProgress) | § 3.23 | `color.progress.*` |
| P-7 | Stany pliku na serwerze | § 4.14 | — |
| P-8 | „Oczekuje na numer” | § 4.15 | — |
| P-9 | „Wymaga uwagi” — Kolejka i SyncIndicator | § 4.16 (+ § 4.7, § 5.4) | — |
| P-10 | Ekran aparatu (CameraScreen) | § 3.24 (+ § 5.2) | — |
| P-11 | „Sesja wygasa” | § 4.17 (+ § 7.1) | — |
| P-12 | Odznaka wartości nieznanej (StatusBadge) | § 3.9.1 (+ § 4.4) | `color.status.unknown.*` |
| P-13 | „Dane ukryte” na telefonie | § 4.18 | — |

**Rozstrzygnięcia projektowe w ramach zaakceptowanych propozycji** (kompetencja `ux-designer`; zapis w § 8 → 1.2.0, do wglądu na demo)
1. **„Wymaga uwagi” wygląda wszędzie tak samo:** `triangle-alert` + `color.sync.error.*`.
   - Dziś znacznik pliku w kwarantannie z P-7 (W-09, M-08) ma `color.feedback.warning.*`, a ta sama sytuacja w Kolejce i w SyncIndicator (P-9) — `color.sync.error.*`.
   - Bursztyn zlewałby się z „Czeka na Wi-Fi”, a stan ma najwyższy priorytet.
   - Bez nowych tokenów — od „Błąd wysyłania” odróżniają go ikona i etykieta.
2. **ActionMenu — fokus pozycji:** pierścień wewnętrzny `color.focus.ring`, jak wiersz tabeli (§ 3.6). Samo tło `color.bg.surface-hover` (1,09:1) nie jest wskaźnikiem fokusu.
3. **CameraScreen — stan nagrywania spustu nie opiera się na kolorze.**
   - `color.action.danger.bg` na `color.bg.brand-strong` daje tylko 1,39:1.
   - Stan niosą: obrys `color.border.inverse`, zmiana ikony (`circle` → `square`), licznik czasu i nazwa dostępna „Zatrzymaj nagrywanie”.
   - Para trafia do § 2.1.4 jako „niewystarczające” wraz z tym rozwiązaniem.
4. **ProcedureProgress:** informację niesie tekst „3 z 7 etapów”. Pasek jest dla czytników dekoracyjny (`aria-hidden`), a jego wypełnienie ma ≥ 3:1 do toru i do tła.
5. **Kolumna „Ekrany”** = ekrany, których makieta, tabela stanów lub lista „Komponenty i tokeny” używa elementu (także przez notację `⋮`, `▸` / `▾`, `«… ▾»`).
   - Poprawiam obie tabele: uzupełnienia z rundy 2 pkt 1 i pozostałe rozbieżności, np. W-10 przy P-1 — makieta nie ma menu.
   - Zmiany wypisuję w changelogu.

**Poprawki makiet (AC4, AC5)**
| Plik | Poprawka | AC |
|---|---|---|
| styleguide § 4.5; `05` — W-08 (makieta, tabela typów wpisów) | „Zmiana statusu etapu „Warunki przyłączenia i projekt umowy”: «Czekamy na…» · Czekamy na: Stoen Operator (OSD)”, „Dodano 12 zdjęć · W trakcie prac”; autor w nagłówku wpisu; § 6.1 — reguła: działania osób opisujemy formami bezosobowymi (`User` ma tylko `displayName`) | AC4 |
| `03` — W-06 | „Osoba odpowiedzialna: Anna Testowa”; kafel „Na kogo czekamy” bez wiersza „klient: —” (PO-3) | AC4, AC5 |
| `03` — W-06, baner „Zlecenie założone w terenie” | tabela odnośników z kolumnami „Komponent” i „Nazwa dostępna / fokus”: **klienta** — Link (nawigacja do W-14); **lokalizacji** — Button tertiary z `aria-haspopup="dialog"` (W-20; po zamknięciu fokus wraca do przycisku); **kwoty transz** — link do sekcji na tej stronie (przewinięcie z `scroll-padding`; po rundzie 1 przeglądów fokus na `⋮` pierwszej transzy „Planowana” bez kwoty, a bez niej — na nagłówku „Płatności”) | AC5 (pkt 8) |
| `06` — W-09 (diagram, tabela stanów, mikrocopy); `README` — wiersz P5; styleguide § 4.14 | „Nieskanowany antywirusem — plik za duży” (PO-4). Ostateczne brzmienie potwierdza `security-engineer`; jeśli je skoryguje, poprawiam te same miejsca w rundzie poprawek | AC5 |
| `01` — diagram | po poprawnym haśle najpierw `403 channel_not_allowed` (M-02 „Aplikacja niedostępna dla roli”), dopiero potem „konto bez kodu z aplikacji” → M-02 „Dodaj kod” — jak w tabelach M-01 / M-02 | AC5 (pkt 9) |
| `scenariusze-a-d.md` | usunięte zdanie „Wariant A1′ kończy się … opisuje luka L8.” — L8 jest zamknięta (krok A1″) | AC5 |
| `README` — „Dane w makietach”; wszystkie wartości PPE w makietach | PPE tylko z oznaczeniem `TEST` | AC5 (PO-5) |
| `04` — tabela ról („odpowiedzialny”); inne mikrocopy z formą zależną od płci znalezione wyszukiwaniem w `docs/ux/` | forma bezosobowa / „osoba odpowiedzialna” | AC4 (spójność) |

**AC6 — kontrasty:** nowe wiersze § 2.1.4, liczone tą samą metodą co w 1.0.0.

| Para | Kontrast | Użycie |
|---|---|---|
| `progress.fill` / `progress.track` | 5,35:1 | ProcedureProgress |
| `progress.fill` / `bg.surface` | 6,74:1 | ProcedureProgress |
| `status.unknown.text` / `status.unknown.bg` | 12,99:1 | odznaka wartości nieznanej |
| `status.unknown.icon` / `status.unknown.bg` | 9,51:1 | odznaka wartości nieznanej |
| `control.checked` / `bg.selected` | 6,31:1 | SelectableCard |
| `bg.surface` / `bg.brand-strong` | 8,98:1 | wybrany chip w aparacie |
| `action.danger.text-subtle` / `bg.surface-hover` | 5,93:1 | pozycja niszcząca ActionMenu |
| `action.danger.bg` / `bg.brand-strong` | 1,39:1 — niewystarczające | spust w trakcie nagrywania; rozwiązanie: rozstrzygnięcie 3 |

Pozostałe pary nowych elementów są już w tabeli — wskazują je sekcje „Dostępność”.

**Plan sprawdzenia AC** — inspekcja; testów kodu nie ma, tokeny sprawdza `@evia/tokens`.
| AC | Jak sprawdzić |
|---|---|
| AC1 | Istnieje 13 sekcji z tabeli „Miejsca”. Każda ma nagłówek „(od 1.2.0)” i bloki Anatomia, Warianty, Stany, Tokeny, Dostępność, Mikrocopy. W § 8 kolumna „Od 1.2.0” ma link dla P-1…P-13 |
| AC2 | Wyszukiwanie `\[P-\d+\]` w `docs/ux/flows/` → 0 trafień; każde dawne użycie wskazuje § 1.2.0. Kolumna „Ekrany” w `flows/README.md` jest taka sama jak w § 8 i zawiera m.in. P-2 → W-05, M-07; P-8 → M-06, M-07; P-9 → M-03, M-04, M-10 |
| AC3 | `pnpm run build` i `pnpm run gate` zielone (walidacja: `$type`, aliasy, cykle, brak literałów w `semantic/`, typ aliasu, `$deprecated`). `quote` / `issued` mają `$deprecated`. README tokenów wskazuje 1.2.0. W nowych sekcjach § 3 / § 4 brak literałów (`#hex`, `px` / `dp` / `rem`, nazwy fontów) — sprawdzenie wyszukiwaniem |
| AC4 | Wyszukiwanie `zmienił\|zmieniła\|dodał\|dodała\|Odpowiedzialn` w § 4.5, `03`, `05` → 0 trafień. Przykłady z AC są obecne, a autor stoi w nagłówku wpisu |
| AC5 | „klient: —” → 0 trafień. „Nie skanowany AV” → 0 trafień poza historią (EVM-004). Nowa etykieta jest w `06`, `README`, § 4.14, SR-FILE-12 i P5. Każda wartość PPE zawiera `TEST`. Tabela banera ma 3 różne komponenty i nazwy dostępne. W diagramie `01` `channel_not_allowed` stoi przed „Dodaj kod”. Zdanie o L8 jest usunięte |
| AC6 | Nowe pary są w § 2.1.4 (QA przelicza je niezależnie). Każda nowa sekcja opisuje fokus, cel dotyku ≥ `size.touch-target.min` (mobile), nazwę dostępną i ogłaszanie zmian |
| AC7 | Nagłówek styleguide'u, `docs/ux/README.md` i `docs/README.md` wskazują 1.2.0. `CHANGELOG.md` ma wpis w „Zmieniono”. `npm run docs:check` — 0 błędów. Diagramy Mermaid w `01` i `06` renderują się lokalnie (`.scratch/EVM-002/mmdc`) |

**Kolejność kroków**
1. Tokeny i README tokenów. Samokontrola skryptem w przeglądarce na `about:blank` (bez sieci): JSON, aliasy, typy, kontrasty nowych par.
2. Styleguide: nowe sekcje P-1…P-13, § 2.1.3 / § 2.1.4, odwołania, § 4.5 / § 6.1, § 7.1, nagłówek, spis treści, § 8.
3. Makiety: `flows/README.md`, `01`–`10`, `scenariusze-a-d.md` — zamiana `[P-n]`, poprawki AC4 / AC5, kolumna „Ekrany”.
4. `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`, „Dziennik”.
5. Przekazanie — `ux-designer` nie ma powłoki:
   - `security-engineer` uruchamia `npm run docs:check` i commituje zmiany jako `docs(ux): … [EVM-014]`; potem potwierdza albo koryguje etykietę w SR-FILE-12 i P5;
   - bramkę (`pnpm run build`, `pnpm run gate`, `npm run test:tools`) uruchamia agent z powłoką — QA w każdej rundzie;
   - o zmianie tokenów informuję `web-developer` i `mobile-developer` (recenzenci). Konsumenci (EVM-008, EVM-009) jeszcze nie istnieją — wystarczy przebudowa pakietu.

**Ustalenia z konsultacji**

`security-engineer` (2026-10-04) — **APPROVE planu pod warunkiem kontroli K1–K14**. Zakres: wyłącznie dokumentacja UX i tokeny (bez endpointów, migracji, zależności i nowych przepływów danych); ryzyko leży w tym, że wzorce 1.2.0 staną się kontraktem dla EVM-016/-022/-023/-030/-031/-044/-046/-067. N/D: testy macierzy ról (brak API), `threat-model.md` (bez nowych kontenerów, TM-38 bez zmian), `rodo.md` (bez nowych kategorii danych), SAST i skan zależności (brak kodu); wystarczą skan sekretów w pre-commit i `pnpm run gate`; brak nowych ryzyk rezydualnych. Zagrożenia: T1 regres reguł 1.1.0, T2 P-11 jako licznik klienta (CWE-613), T3 P-4 a słownik klawiatury i chmurowe sprawdzanie pisowni (CWE-524, CWE-200), T4 etykieta SR-FILE-12 niespójna lub nieobecna przy pobraniu (TM-38), T5 realistyczne dane w makietach (SR-PRIV-08), T6 kolejność kontroli w M-01 inna niż SR-AUTHZ-12, T7 P-5 / P-13 jako nakładka, T8 commit z plikami spoza zakresu albo obejście hooka, T9 treść dokumentów w zewnętrznych serwisach.

| Kontrola | Wymaganie | Gdzie spełnione |
|---|---|---|
| K1 | etykieta „Nieskanowany antywirusem — plik za duży” wstępnie potwierdzona; identyczna w SR-FILE-12, P5 pkt 3, § 4.14, `flows/06` (diagram, tabela, mikrocopy) i wierszu P5 w `flows/README.md`; 0 trafień starego brzmienia poza historią EVM-004 (i opisem kontroli w tej historyjce); tylko film > 2 GB z przeglądarki, po pozytywnej walidacji ffprobe (wcześniej „Sprawdzanie pliku”, niezgodność → `type_mismatch`); znacznik przy miniaturze, w podglądzie i przy pobraniu oryginału, w nazwie dostępnej; podgląd 720p, oryginał jako załącznik tylko A i E; bez „Skanuj ponownie” i słów „bezpieczny” / „sprawdzony”; ton `info` | § 4.14; `flows/06`; `flows/README.md`; SR-FILE-12 i P5 — `security-engineer` |
| K2 | brak podglądu i pobrania przed `clean`; przyczyna kwarantanny tylko dla A w panelu; „Skanuj ponownie” tylko A ze step-upem; bez zwolnienia bez skanu; rozstrzygnięcie 1 bez zastrzeżeń | § 4.14, § 4.16; `flows/06` |
| K3 | „Sesja wygasa”: czas z serwera, ponowne sprawdzenie po wybudzeniu i powrocie do karty; „Przedłuż sesję” = żądanie, tylko bezczynność, nigdy poza 12 h, wariant bez przycisku przed limitem; po wygaśnięciu albo `401` dane znikają z widoku i pamięci zapytań, zostaje szkic w pamięci karty, tytuł karty bez danych; „Wyloguj” jak SR-SESS-05; spójny stan w kilku kartach | § 4.17; `flows/README.md` zasada 5 |
| K4 | pole kodu: web — `one-time-code` / `off`, `spellcheck="false"`, `autocapitalize="off"`, wklejanie i menedżery haseł; mobile — maskowanie z „Pokaż”, `FLAG_SECURE`, bez autokorekty i podpowiedzi, bez SMS i nowych uprawnień (dopisane także w § 8 przy P-4); jeden komunikat dla kodu złego, użytego i wygasłego, `429` jak W-01; kod nigdy w URL, tytule, logach i ogłoszeniach | § 3.2.1, § 8 (P-4); `flows/01` |
| K5 | diagram M-01: hasło (jeden komunikat) → rola × kanał (`403 channel_not_allowed`) → stan drugiego kroku (M-02) → TOTP → kontrole urządzenia; bez utrwalania `totp_not_configured`; gałąź błędu jak W-01 | `flows/01` — diagram i lista „Kolejność kontroli” |
| K6 | PPE tylko w formie z `TEST` (np. `PL-TEST-0001`), w makietach mobilnych wcale; bez PESEL, NIP, tablic (także na podglądzie aparatu); e-maile tylko `example.com` / `*.test` | `flows/README.md` → „Dane w makietach”; jedyna wartość PPE — W-06 `PL-TEST-0001` |
| K7 | bez regresji 1.1.0: § 4.1 / § 4.10, § 3.7 / § 4.3, § 4.11, § 4.13 / § 6.4, § 3.12 (mobile bez „Z galerii”), § 4.5 — zdanie o braku danych osobowych i kwot zostaje, autor tylko jako `displayName` | zmiany w tych § ograniczone do odwołań i form bezosobowych |
| K8 | P-5, P-13 i P-2 — dane nie są renderowane (także w nazwach dostępnych, ogłoszeniach i przełączniku aplikacji); w aparacie i Kolejce tylko numer i liczby; bez danych w powiadomieniach; zwinięty Disclosure nie jest kontrolą dostępu | § 3.15.1, § 3.21, § 4.18 |
| K9 | ActionMenu i baner: widoczność wg § 4.13 (R bez wyzwalacza, E — wyłączone z podpowiedzią bez danych); operacje niszczące → § 4.11, step-up → W-04; odnośniki banera tylko A i E, licznik W-20 tą samą polityką co lista; UI nie jest granicą bezpieczeństwa | § 3.20; `flows/03` (baner) |
| K10 | CameraScreen: bez lokalizacji, bez galerii (wyboru i zapisu), tylko aparat i mikrofon, pasek tylko z numerem zlecenia | § 3.24 |
| K11 | P-12: stała etykieta „Nieznany status”, bez surowej wartości z API; akcje zależne od statusu ukryte albo wyłączone | § 3.9.1 |
| K12 | tokeny: tylko aliasy do `base/`; `quote` / `issued` z `$deprecated`; `package.json` i `pnpm-lock.yaml` bez zmian; `pnpm run build` i `pnpm run gate` zielone | `design/tokens/` (bramka — agent z powłoką) |
| K13 | Mermaid tylko lokalnie (`.scratch/EVM-002/mmdc`), kontrasty lokalnie (`about:blank`, bez sieci), bez mermaid.live i kalkulatorów online | kontrasty — skrypt na `about:blank`; render Mermaid — QA lokalnie |
| K14 | commit `security-engineer`: `npm run docs:check` 0 błędów, `git add` tylko jawnych ścieżek z „Zakresu zmian”, kontrola `git diff --cached --name-only`, przegląd staged pod kątem K6, hook pre-commit bez `--no-verify`, osobny commit `docs(security): … [EVM-014]` tylko z brzmieniem etykiety | `security-engineer` |

Uwagi nieblokujące `security-engineer` — w „Uwagach do rozważenia”.

## Decyzje
_—_

## Uwagi do rozważenia
**Od `security-engineer` (konsultacja przed implementacją, nieblokujące — kandydaci do backlogu):**
1. **P-9 „Dodaj do innego zlecenia”** — wybór tylko spośród zleceń w telefonie i potwierdzenie z numerem i tytułem zlecenia docelowego (chroni przed przypięciem zdjęć posesji jednego klienta do zlecenia innego). Szczegóły w M2 (SR-SYNC-01, refinement E11 / E12).
2. **E1 — definicja aktywności sesji:** w SR-SESS-03 i dokumentacji `identity` zapisać, że automatyczne żądania w tle (odświeżanie danych, postęp uploadu) nie liczą się jako aktywność — inaczej limit bezczynności nigdy nie zadziała. § 4.17 zakazuje już żądań „podtrzymujących” po stronie panelu.
3. **Przykładowe telefony** (`+48 600 123 456` w styleguide § 6.3) mogą należeć do prawdziwych abonentów — rozważyć jawnie fikcyjną pulę numerów (zmiana § 6.3 i makiet w osobnej historyjce).
4. **Podgląd w przełączniku aplikacji** dla ekranów z danymi — `FLAG_SECURE` obejmuje dziś tylko logowanie i drugi krok (SR-MOB-08); ocenić przy refinemencie E9.

**Od `ux-designer` (implementacja 1.2.0):**
5. **Rozstrzygnięcia projektowe 6–10 do wglądu na demo** (styleguide § 8 → 1.2.0): reguła liczenia postępu procesu („2 z 7 etapów” w W-06 i M-03 zamiast „3 z 7”), przyciski na ciemnym panelu aparatu, podpowiedź odznaki nieznanego statusu zależna od kanału, wariant „limit 12 h” 10 min przed końcem, ikony Disclosure. Kolumna „Postęp” w W-10 (`breakpoint.wide`) pokazuje sumę etapów wszystkich procesów zlecenia — do potwierdzenia przez `product-owner` przy refinemencie E3.
   - **Pytanie do Konrada (demo EVM-014):** czy postęp procesu pomija etapy „Nie dotyczy”? Reguła ze styleguide'u to: n — etapy „Zakończony”, m — etapy bez „Nie dotyczy”. `domain-model.md` → `Procedure` mówi „etapy zakończone / wszystkie” — bez decyzji EVM-031 dostanie dwa różne kontrakty.
   - **Rekomendacja: TAK — wyłączamy „Nie dotyczy”.** To zgodne z EVM-071 („Nie dotyczy” zamiast usuwania etapu); na tej regule opiera się też scenariusz B11 (zbędny etap → „Nie dotyczy”, wynik „procesy zakończone”). Przypadek m = 0 (wszystkie etapy „Nie dotyczy”) jest już opisany w § 3.23: „Nie dotyczy”, bez paska i bez „Wszystkie zakończone”.
   - **Właściciel uzgodnienia:** `solution-architect` — po akceptacji aktualizuje `domain-model.md` → `Procedure`, najpóźniej w EVM-031. Przy odpowiedzi „NIE” `ux-designer` zmienia § 3.23 (m = wszystkie etapy) i wynik kroku B11.
6. **Pary kontrastu banerów z 1.1.0:** dopisałem pary fokusu na `feedback.info.bg` i `feedback.warning.bg` (używane przez nowe wzorce); pełne pary Banner / InlineAlert dla tonów `success` i `error` z akcjami — przy pierwszej implementacji komponentu (EVM-008, przegląd UX).
7. **Przyciski na ciemnych tłach:** wariant opisany na istniejących rolach (`text.on-brand`, `border.inverse`, `bg.brand`) tylko dla CameraScreen. Jeśli ciemne powierzchnie z akcjami pojawią się gdzie indziej — rozważyć role `color.action.inverse.*` w kolejnej wersji MINOR.
8. **Historyjki M1 z `[P-n]`** (EVM-016, -017, -018, -020, -022, -023, -027, -030, -031, -032, -040, -042, -044, -046, -049, -057, -063, -067, -068 i `README.md` M1) — odwołania rozwiązuje tabela w styleguide § 8 (kolumna „Od 1.2.0”); zamiana na § przy refinemencie każdej historyjki, bez osobnej zmiany teraz.
9. **Diagramy Mermaid** (`flows/01`, `flows/06`) — `ux-designer` nie ma powłoki, więc render lokalny (`.scratch/EVM-002/mmdc`) wykonuje QA; zmienione diagramy używają tylko składni z istniejących diagramów.

**Z przeglądów — runda 1 (nieblokujące, kandydaci do backlogu):**
10. **Potwierdzenie pliku w kwarantannie przez technika (M2, `mobile-developer`):** akcja w rodzaju „Przyjmuję do wiadomości” przenosi element z „Wymaga uwagi” do sekcji informacyjnej. Kapsuła wraca wtedy do stanu przesyłania, a technik nie musi usuwać pliku, żeby pozbyć się alarmu. Do ustalenia przy refinemencie E11 / E12 z `security-engineer`: czy lokalny plik zostaje w telefonie (P5, kwarantanna do 30 dni) i kiedy znika.
11. **Tokeny odznaki licznika w BottomNav** (§ 3.18): styleguide od 1.0.0 opisuje licznik („odznaka z liczbą, nie sama kropka”), ale nie podaje jego tokenów kolorów. Do ustalenia przy pierwszej implementacji BottomNav (EVM-009) — `ux-designer` dopisze tokeny i parę kontrastu w § 2.1.4, bez nowych tokenów, jeśli wystarczą istniejące role.

## Definition of Done
- [ ] AC1–AC7 spełnione (weryfikacja QA przez inspekcję)
- [ ] `npm run docs:check` — 0 błędów; diagramy Mermaid renderują się lokalnie
- [ ] Przeglądy: web-developer, mobile-developer, product-owner — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — ready → in-progress: start /deliver w nocy 3/4.10 (decyzja Konrada — kolejka EVM-006 → EVM-014 → EVM-069, demo rano); gałąź `feature/EVM-014-styleguide-1-2-0` **ułożona na `feature/EVM-006-repo-i-ci`** (EVM-006 w PR #2, jeszcze nie na `main`): hooki lefthook, `.gitignore` i walidacja tokenów (`@evia/tokens`) pochodzą z EVM-006; po scaleniu PR #2 orkiestrator wciąga `origin/main` merge'em (bez force-pusha). `security-engineer` jako współwykonawca dla AC5 (PO-4: SR-FILE-12, P5)
- 2026-10-04 — plan techniczny (ux-designer)
- 2026-10-04 — konsultacja `security-engineer`: APPROVE planu z kontrolami K1–K14 (plan techniczny → „Ustalenia z konsultacji”)
- 2026-10-04 — implementacja (ux-designer): styleguide 1.2.0 (13 sekcji „od 1.2.0”: § 3.2.1, § 3.9.1, § 3.15.1, § 3.20–§ 3.24, § 4.14–§ 4.18; § 2.1.3, § 2.1.4 — 17 nowych par; formy bezosobowe § 4.5 i § 6.1; § 8 — wpis 1.2.0 z rozstrzygnięciami 1–10, kolumny „Od 1.2.0” i pełne „Ekrany”); tokeny 1.2.0 (`color.progress.*`, `color.status.unknown.*`, 491 → 497) i README tokenów; makiety `flows/` bez `[P-n]`, poprawki PO-2–PO-5 i runda 2 pkt 1, 2, 8–10; `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`. Kontrasty i tokeny sprawdzone skryptem na `about:blank`. Bez powłoki: zmiany w kopii roboczej — commit `docs(ux): …` i bramkę (`npm run docs:check`, `pnpm run build`, `pnpm run gate`, `npm run test:tools`, render Mermaid) wykonują `security-engineer` / QA
- 2026-10-04 — implementacja (security-engineer, współwykonawca AC5 / PO-4):
  - commit zmian `ux-designer` `docs(ux): …` wg K14 — `npm run docs:check` 0 błędów; `git add` 19 jawnych ścieżek z „Zakresu zmian”; w staged brak `.claude/`, `.scratch/`, `node_modules/`, `coverage/`, `.env*`; K6 — jedyna wartość PPE `PL-TEST-0001` (W-06), e-maile tylko `example.com`, bez nowych ciągów 10–11 cyfr; hook pre-commit (gitleaks) bez obejść — brak sekretów. Kopia robocza miała końce linii CRLF — znormalizowane do LF (ADR-0015, `.gitattributes`), treść bez zmian;
  - **PO-4 — brzmienie potwierdzone:** „Nieskanowany antywirusem — plik za duży” (bez żargonu, nie sugeruje, że plik jest bezpieczny, podaje przyczynę) — wpisane w SR-FILE-12 (`requirements.md`) i P5 pkt 3 (`policies.md`) osobnym commitem `docs(security): …`; identyczne w § 4.14, `flows/06` i `flows/README.md`; stare brzmienie tylko w historii EVM-004 i w opisie sprawdzenia AC5;
  - bramka: `pnpm run build` zielony (`color.progress.*` i `color.status.unknown.*` w `dist/web/tokens.css`), `pnpm run gate` zielony (27 + 6 zadań turbo, depcruise bez naruszeń, pokrycie zmian — zielone), `npm run test:tools` — 327 pass, 0 fail, 1 pominięty (istniejący, poza tą zmianą)
- 2026-10-04 — poprawki po przeglądach, runda 1 (ux-designer) — 3 ustalenia major:
  - `web-developer`: odnośnik „kwoty transz” w banerze „Zlecenie założone w terenie” ma osiągalny cel fokusu — wyzwalacz `⋮` pierwszej transzy „Planowana” bez kwoty, a bez niej nagłówek „Płatności” (`tabindex="-1"`); opisany mechanizm (`href` jako zapas, przewinięcie z `scroll-padding`, `focus()`). Zmiany w `flows/03`, `flows/08` (kolejność menu transzy „Planowana”), `flows/10` i `scenariusze-a-d.md` (A1″, L8);
  - `mobile-developer`: stan przesyłania nie znika pod „Wymaga uwagi” — baner offline zawsze bez połączenia, nazwa dostępna kapsuły ze stanem następnym, licznik „Kolejka” w BottomNav niezależny od kapsuły, podsumowanie Kolejki (§ 3.18, § 4.7, § 4.16, § 5.4, `flows/09`). Kolejność P-9 bez zmian; potwierdzanie kwarantanny — „Uwagi do rozważenia” pkt 10;
  - `product-owner`: reguła liczenia postępu (§ 3.23, § 8 rozstrzygnięcie 6) oznaczona jako doprecyzowanie `domain-model.md` do potwierdzenia na demo; przypadek m = 0; pytanie z rekomendacją i właściciel uzgodnienia — „Uwagi do rozważenia” pkt 5;
  - styleguide § 8 → 1.2.0 — wpis „Poprawki po przeglądach (runda 1)”. Tokeny bez zmian. Bez powłoki: commit `docs(ux): apply review fixes round 1 [EVM-014]` i bramkę wykonuje QA
