---
id: EVM-004
title: Przepływy UX i makiety MVP
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P1
owner: ux-designer
contributors: [product-owner]
reviewers: [web-developer, mobile-developer]
depends_on: [EVM-002, EVM-003]
---

# EVM-004: Przepływy UX i makiety MVP

## Historyjka
Jako **właściciel produktu** chcę **zobaczyć kluczowe przepływy i ekrany MVP przed implementacją**, aby **wcześnie wyłapać braki i dać zespołowi jednoznaczną specyfikację UI**.

## Kontekst
Zakres M1 i M2: `docs/product/roadmap.md`. Komponenty i tokeny: styleguide v1 (EVM-003). Model danych: EVM-002.

## Kryteria akceptacji
**AC1 — Mapa ekranów**
- Gdy otwieram `docs/ux/flows/README.md`
- Wtedy widzę mapę nawigacji panelu web (M1) i aplikacji mobilnej (M2).

**AC2 — Kluczowe przepływy**
- Wtedy dla każdego przepływu jest diagram (Mermaid) i makieta low-fi: logowanie z MFA; utworzenie zlecenia z szablonu; szczegóły zlecenia „status na pierwszy rzut oka” (etapy, na kogo czekamy, płatności); aktualizacja etapu; wpis i komentarz; galeria i upload; lista zleceń z filtrami (w tym „czekamy na OSD dłużej niż X dni”); zestawienie nieopłaconych; mobile: zdjęcie / film offline → kolejka → upload; mobile: szybkie nowe zlecenie.

**AC3 — Stany i role**
- Wtedy każdy ekran ma opisane stany (pusty, ładowanie, błąd, offline — mobile, brak uprawnień) i różnice dla ról.

**AC4 — Zgodność ze styleguide'em**
- Wtedy makiety używają wyłącznie komponentów i tokenów ze styleguide'u v1; braki są zgłoszone jako propozycje w changelogu styleguide'u.

**AC5 — Walidacja scenariuszami**
- Zakładając scenariusze A–D z `domain.md`
- Gdy przechodzę je przez makiety
- Wtedy żaden krok nie wymaga obejścia (zapis przejścia w dokumencie).

## Poza zakresem
Projekty high-fidelity wszystkich ekranów; ekrany M3+. Klikalny prototyp HTML — opcjonalnie, jeśli ux-designer uzna za pomocny.

## UX / UI
To jest specyfikacja UX.

## Bezpieczeństwo i prywatność
Uwzględnij widoczność danych wg ról (np. Tylko odczyt nie widzi akcji edycji).

## Notatki techniczne
_—_

## Plan techniczny
Historyjka dokumentacyjna (enabler, wykonawca `ux-designer`): bez kodu aplikacji, kontraktu API, migracji i nowych zależności. Makiety low-fi w Markdown: diagramy przepływów w Mermaid oraz szkielety ekranów w ASCII (jak § 5.2 styleguide'u) z adnotacjami komponentów (§ 3) i tokenów semantycznych — bez literałów kolorów, rozmiarów i fontów. **Bez prototypu HTML** (opcjonalny wg „Poza zakresem”): tokeny nie mają jeszcze transformacji do CSS (EVM-006), więc HTML wymagałby zaszytych wartości, a Mermaid + ASCII da się przeglądać w diffie. Weryfikacja AC przez inspekcję. Dane w makietach wyłącznie syntetyczne (fikcyjne nazwiska, adresy, numery, nazwy stron). Zakres ekranów = przepływy z AC2 + mapa nawigacji z AC1; pozostałe ekrany M1/M2 (klienci, użytkownicy, urządzenia, reset hasła, zaproszenia, audyt) występują tylko jako węzły mapy z oznaczeniem „bez makiety — przy refinemencie epiku”. Wejścia: decyzje Konrada z EVM-002 (P1 „Czekamy na…”, telefon tylko dodaje, numer nadaje serwer, płatności poza telefonem, korekty płatności — Administrator ze step-upem) i EVM-005 (P1–P7, P5, P6), styleguide v1.0.0.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/ux/flows/README.md` | **nowy** (żywy, reguła 16 polityki dokumentów): legenda notacji makiet (szkielet ASCII, odwołania `§ 3.x`, role A / E / R, propozycje `[P-n]`); szkielet aplikacji web (Sidebar + TopBar) i mobile (AppBar z SyncIndicator + BottomNav); **mapa nawigacji** — Mermaid `flowchart` panelu web M1 (logowanie, Zlecenia — lista / szczegóły / nowe, Klienci, Płatności — nieopłacone, Administracja — tylko Administrator, Konto) i aplikacji mobilnej M2 (logowanie, Zlecenia, Dodaj — zdjęcie / wpis / nowe zlecenie, Kolejka, Więcej) z linkami do przepływów; tabela ekranów (ID `W-xx` / `M-xx`, przepływ, makieta tak / bez makiety); macierz ekran × rola; wspólne zasady stanów (pusty, ładowanie, błąd, offline, brak uprawnień — `404` vs `403`); tabela pokrycia AC2–AC4 | AC1, AC3, AC4 |
| `docs/ux/flows/01-…` … `10-…` (lista niżej) | **nowe** (żywe), jeden plik na przepływ z AC2: diagram przepływu (Mermaid) + dla każdego ekranu i dialogu: cel, główna akcja, hierarchia treści, makieta (web: układ expanded, compact gdy układ się zmienia; mobile: compact), tabela stanów, różnice ról, zachowanie responsywne, komponenty i tokeny (§), mikrocopy, uwagi a11y | AC2, AC3, AC4 |
| `docs/ux/flows/scenariusze-a-d.md` | **nowy** (żywy): przejście scenariuszy A–D krok po kroku (Krok · Kto i kanał · Ekran · Akcja · Wynik · Obejście) + znalezione luki i sposób ich zamknięcia | AC5 |
| `docs/ux/styleguide.md` | **1.0.0 → 1.1.0** (MINOR wg § 7.2 pkt 5): zmiany zgodności z modelem i politykami (decyzja projektowa 1) + § 8 Changelog: wpis 1.1.0 i podsekcja „Propozycje (EVM-004) — do akceptacji” | AC4; P1 z EVM-002 |
| `design/tokens/semantic/color.light.tokens.json` | etykieta `color.status.stage.waiting` → „Czekamy na…”; nowe `color.status.payment.cancelled.*`; nowe `color.status.order.quoting.*` i `color.status.payment.invoiced.*`; `quote` i `issued` z `$deprecated` (DTCG 2025.10 § 5.2.4) — żadna nazwa nie znika | AC4 |
| `design/tokens/README.md` | wersja 1.1.0, liczba tokenów, zasada `$deprecated` (nie eksportowane przez transformację EVM-006, usunięcie w najbliższej wersji MAJOR), reguła „kod modelu `snake_case` → klucz tokenu `kebab-case`” | AC4 |
| `docs/ux/README.md` | artefakty: `flows/` istnieje (EVM-004), styleguide 1.1.0, prototypy HTML nie powstały w EVM-004 | AC1 (punkt wejścia) |
| `docs/README.md` | wiersz `ux/flows/README.md`; aktualny opis `ux/README.md` | — |
| `docs/product/domain.md` | jedna linia w „Zmianach nazw w kodzie” (etykieta w styleguide = „Czekamy na…”, 1.1.0) — potwierdza `product-owner` | spójność |
| `CHANGELOG.md` | „Unreleased”: Dodano — przepływy i makiety MVP; Zmieniono — styleguide 1.1.0; z `[EVM-004]` | DoD |
| ten plik | plan, „Dziennik”, potem „Decyzje”, „Uwagi do rozważenia”, DoD | — |

Bez zmian: ADR-y, `domain-model.md`, `api-guidelines.md`, `offline-sync.md`, `docs/security/*`, `design/brand/`, `tools/`; `design/prototypes/` nie powstaje.

**Przepływy i ekrany (AC2)**
| Plik | Przepływ | Ekrany | Kanał |
|---|---|---|---|
| `01-logowanie-mfa.md` | logowanie z MFA | W-01 logowanie (e-mail, hasło; wklejanie i menedżery haseł — WCAG 3.3.8; komunikat bez ujawniania, czy konto istnieje); W-02 drugi krok (passkey / TOTP / kod odzyskiwania; Administrator — tylko passkey); W-03 konfiguracja MFA przy pierwszym logowaniu (`mfa_enrollment_required`, 10 kodów odzyskiwania pokazanych raz); W-04 dialog ponownego uwierzytelnienia (step-up, używany w 04 i 08); M-01 logowanie w aplikacji (hasło + TOTP); M-02 blokujące stany urządzenia: brak blokady ekranu (P7), rola Tylko odczyt (`403 channel_not_allowed`), limit urządzeń, aktualizacja wymagana (`426`, kolejka zachowana), wylogowano urządzenie (`401 session_revoked`, kolejka zachowana), urządzenie wyczyszczone (`401 device_wipe_required`), 7 dni bez połączenia (dane ukryte, aparat i kolejka działają) | web, mobile |
| `02-nowe-zlecenie-z-szablonu.md` | utworzenie zlecenia z szablonu | W-05 formularz jednostronicowy: klient (combobox + „Dodaj klienta”), lokalizacja (istniejąca albo nowa; OSD i zarządca — combobox stron z „Dodaj stronę”), szablon (karty wyboru z podglądem: pozycje zakresu, procesy, plan transz), tytuł, opiekun; autozapis szkicu; numer nadaje serwer; po zapisie → W-06 | web |
| `03-szczegoly-zlecenia.md` | szczegóły „status na pierwszy rzut oka” | W-06: nagłówek (numer, tytuł, StatusBadge, klient, lokalizacja), karta podsumowania (bieżące etapy, „Czekamy na: … · od n dni”, najbliższy termin, nieopłacone / po terminie), procesy z etapami (rozwijane), płatności, dziennik, media i dokumenty, „Inne zlecenia w tej lokalizacji”; M-03 szczegóły na telefonie (offline, bez płatności, etapy i metadane dokumentów tylko do odczytu) | web, mobile |
| `04-aktualizacja-etapu.md` | aktualizacja etapu | W-07: StatusBadge jako przycisk → menu przejść dozwolonych wg tabeli przejść `domain-model.md`; dialog pól przejścia: „Czekamy na…” (klient / strona — combobox z podpowiedzią OSD i zarządcy z lokalizacji, „od kiedy”), „Zablokowany” (powód), „Zakończony” (data); zmiana strony w stanie `waiting`; toast „Cofnij”; konflikt edycji (`412`); zlecenie „Rozliczone” / „Anulowane” — przejścia wyłączone z wyjaśnieniem; telefon — tylko podgląd z informacją „Status etapu zmienisz w panelu” | web (+ informacja na mobile) |
| `05-wpis-i-komentarz.md` | wpis i komentarz | W-08 dziennik: wpis z kategorią, komentarz, filtr typów, korekta = nowy wpis; M-04 nowy wpis / komentarz offline (chipy kategorii, dyktowanie, opcjonalnie etap) i stany wpisu w kolejce | web, mobile |
| `06-galeria-i-upload.md` | galeria i upload | W-09 zakładka „Media i dokumenty”: galeria (grupowanie po kategorii / etapie, filtr), Uploader (strefa + „Wybierz pliki”), panel postępu, stany pliku (wysyłanie, przetwarzanie, gotowe, „Wymaga uwagi” po kwarantannie — przyczyna tylko dla Administratora, P5), lightbox, „Pobierz oryginał” (Administrator, Edytor; ostrzeżenie o metadanych, P3), dokumenty z klasą poufności (Tylko odczyt: `identity_data` i `building_security` — tylko metadane, P6) | web |
| `07-lista-zlecen-i-filtry.md` | lista zleceń z filtrami | W-10: tabela (kolumny priorytetowe § 3.6), FilterBar, zapisane widoki („Czekamy na OSD > 14 dni”, „Po terminie”, „Nieopłacone”, „Moje”), filtr „Czekamy na: [klient / rodzaj strony] dłużej niż [X] dni”, compact → karty; M-05 lista na telefonie (zakres urządzenia, wyszukiwanie offline, szybkie zlecenia „Oczekuje na numer”) | web, mobile |
| `08-nieoplacone.md` | zestawienie nieopłaconych | W-11 Płatności: etapy płatności „Wystawiona” (w tym „Po terminie”), sumy, filtry i sortowanie (najpierw po terminie); „Odnotuj wpłatę” (Administrator, Edytor); korekta płatności — Administrator przez W-04, Edytor — przycisk wyłączony z podpowiedzią; Tylko odczyt — bez akcji | web |
| `09-mobile-zdjecia-filmy-offline.md` | zdjęcie / film offline → kolejka → upload | M-06 aparat (spust, kategoria — chipy, zdjęcie / film, seria, latarka, „Gotowe”, „Zapisano w telefonie”); M-07 Kolejka (Wymaga uwagi, Błąd, Czeka na Wi-Fi, Wysyłanie, W kolejce, Wysłane dziś; „Ponów”, „Wyślij teraz przez sieć komórkową”, usunięcie niewysłanego — dialog); M-08 media zlecenia na telefonie (znaczniki stanu § 5.4); M-09 „Więcej” („Wysyłaj filmy tylko przez Wi-Fi”, wylogowanie z niewysłanymi danymi — dialog, „Wyczyść dane firmowe”); SyncIndicator we wszystkich stanach § 5.4 | mobile |
| `10-mobile-szybkie-zlecenie.md` | szybkie nowe zlecenie | M-10 formularz: klient z telefonu albo nowy (nazwa, telefon), lokalizacja istniejąca albo nowa (typ obiektu, adres, nr miejsca), szablon, tytuł, notatka → „Zapisano w telefonie · oczekuje na numer” → M-03 z odznaką „Oczekuje na numer” i możliwością dodawania zdjęć → po synchronizacji numer (np. `ZL-2026-0042`); odrzucenie → „Wymaga uwagi” | mobile |

**Decyzje projektowe (wdrażane w historyjce; akceptacja na demo)**
1. **Styleguide 1.1.0 — zgodność z zaakceptowanym modelem (EVM-002) i politykami (EVM-005)** — nowe tokeny i korekty treści, żadna nazwa nie znika (MINOR):
   - `waiting` → „Czekamy na…” (decyzja Konrada P1); w widokach „Czekamy na: klient · od 3 dni” / „Czekamy na: [nazwa strony] ([rodzaj strony]) · od 15 dni”, próg 14 dni bez zmian — § 4.4, § 4.5 (przykład dziennika), § 6.2;
   - etap płatności „Anulowana” — `color.status.payment.cancelled` (ton neutralny, ikona `ban` — to samo znaczenie co „Anulowane” w grupie zlecenia, unikalna w grupie płatności); 2 nowe wiersze w § 2.1.4 (pary jak dla tonu neutralnego: 12,99:1 i 9,51:1);
   - „Po terminie” = **oznaczenie wyliczane**, nie status: etap „Wystawiona” z terminem przed dziś (`Europe/Warsaw`) pokazuje mocną odznakę „Po terminie” zamiast „Wystawiona” (nazwa dostępna „Wystawiona, po terminie od n dni”) — § 4.4, § 6.2;
   - klucze tokenów zgodne z kodami modelu: nowe `quoting` i `invoiced`, `quote` i `issued` z `$deprecated`; jedna reguła mapowania kod → klucz (§ 4.4, `design/tokens/README.md`);
   - § 6.2 „Strona” uzupełniona o wspólnotę / spółdzielnię, rzeczoznawcę (ekspertyza) i dostawcę (etykiety rodzajów wg `service-catalog.md` § 7); „Etap płatności”: Planowana, Wystawiona, Opłacona, Anulowana + oznaczenie „Po terminie”;
   - § 3.12: mobilny Uploader **bez „Z galerii”** — aplikacja nie ma dostępu do galerii (ADR-0007, P3, P7);
   - § 4.13: wejście z linku na zasób niedostępny albo usunięty = „Nie znaleziono …” (API zwraca `404` w obu przypadkach — nie ujawniamy istnienia zasobu, `api-guidelines.md`); „Nie masz dostępu” z ikoną `lock` tylko dla akcji i plików, do których rola nie ma prawa (`403`), np. plik `identity_data` dla Tylko odczyt.
2. **Braki wykryte w makietach → propozycje `[P-n]`** w § 8 (podsekcja „Propozycje — do akceptacji”, bez podbijania wersji); makiety oznaczają ich użycie znacznikiem `[P-n]`. Kandydaci widoczni już na etapie planu: sekcja „Wymaga uwagi” na ekranie Kolejka (odrzucone mutacje i pliki w kwarantannie), odznaka „Oczekuje na numer”, stany miniatury „Przetwarzanie” i „Wymaga uwagi” (web), wariant TextField „kod jednorazowy” (`autocomplete="one-time-code"`), wskaźnik postępu procesu („3 z 7 etapów”) bez użycia tokenów `sync.*`, pełnoekranowy stan blokujący urządzenia (wariant EmptyState), ekran aparatu jako wzorzec (§ 5.2 opisuje układ, brak komponentu). Każda propozycja: brak · propozycja (najpierw z istniejących ról i komponentów) · uzasadnienie · ekrany. Po akceptacji — wdrożenie przez `ux-designer` (1.2.0) przed pierwszą historyjką, która ich używa.
3. **Role w UI:** Tylko odczyt — akcje edycji **ukryte**; widzi płatności, metadane dokumentów, miniatury i podglądy; bez „Pobierz oryginał”, eksportu i plików `identity_data` / `building_security` (wiersz z `lock` i „Plik dostępny dla administratora i edytora”). Edytor przy akcjach tylko dla Administratora (korekty płatności, przywrócenie zlecenia z „Rozliczone” / „Anulowane”) — przycisk wyłączony z podpowiedzią (§ 4.13). Administrator — przez dialog ponownego uwierzytelnienia W-04 (passkey, tylko panel). Telefon: Administrator = Edytor (kanał `mobile` bez funkcji administracyjnych i step-upu); Tylko odczyt — ekran braku dostępu.
4. **Telefon w MVP tylko dodaje** (wpisy, komentarze, media, szybkie zlecenie): bez zmiany statusów etapów, bez płatności i bez historii lokalizacji; etapy i metadane dokumentów tylko do odczytu.
5. **Scenariusz D bez nowego widoku:** karta Lokalizacja w W-06 ma „Inne zlecenia w tej lokalizacji (n)” — linki do zleceń (autoryzacja kotwicą zlecenia źródłowego, tylko panel, SR-AUTHZ-08); pełna „historia lokalizacji” zostaje kandydatem do backlogu (EVM-010).
6. **Strony bez osobnej sekcji w M1:** wybór i szybkie dodanie strony w comboboxie (lokalizacja — OSD i zarządca; etap — „Czekamy na…”) z podpowiedzią z lokalizacji (kandydat z EVM-002 dla M1 E4); książka kontaktów w M3.

**Kontrakt API / migracje:** nie dotyczy. Makiety korzystają wyłącznie z pól i przejść z `domain-model.md` oraz komend z `offline-sync.md`; brak potrzebny na ekranie (pole, filtr, agregat) → „Uwagi do rozważenia” dla `solution-architect`, bez zmiany modelu w tej historyjce.

**Konsultacje**
- `security-engineer` (przed przeglądami): przepływ 01 (MFA, kody odzyskiwania, step-up, komunikaty bez enumeracji kont), stany urządzenia (P2, P7, `426`), widoczność ról (P6), pliki (P3, P5), „Inne zlecenia w tej lokalizacji” (SR-AUTHZ-08), komunikaty `404` / `403`.
- `product-owner` (contributor): weryfikacja biznesowa przejścia scenariuszy A–D, mikrocopy i terminologii, linia w `domain.md`.

**Plan weryfikacji AC (inspekcja; pomocnicze skrypty tylko w `.scratch/EVM-004/`)**
| AC | Jak sprawdzić |
|---|---|
| AC1 | `docs/ux/flows/README.md` ma dwa diagramy Mermaid (panel web M1, aplikacja M2); każdy ekran z tabeli ekranów jest na mapie i odwrotnie; ekrany z makietą linkują do sekcji w plikach przepływów (linki i kotwice działają). |
| AC2 | Tabela pokrycia: 10 przepływów z AC2 → plik → diagram Mermaid → makiety ekranów; „czekamy na OSD dłużej niż X dni” w W-10 (filtr i zapisany widok); przepływy 09 i 10 kończą się stanem po synchronizacji; diagramy renderują się lokalnie (mermaid-cli w `.scratch/EVM-004/`, bez serwisów online — jak w EVM-002). |
| AC3 | Każdy ekran ma tabelę stanów z 5 wierszami (pusty, ładowanie — szkielet, błąd — z wyjściem, offline — mobile: SyncIndicator / baner, web: baner § 4.10, brak uprawnień — `404` / `403`; „nd.” tylko z uzasadnieniem) i tabelę ról (web: A / E / R; mobile: A / E, R — brak dostępu); checklista zgodności z P1, P2, P3, P5, P6, P7. |
| AC4 | Każdy ekran ma listę „Komponenty i tokeny” z odwołaniami do §; skrypt porównuje wymienione komponenty i tokeny ze styleguide'em i plikami tokenów — każdy istnieje albo jest propozycją `[P-n]` z wpisem w § 8; brak literałów (`#hex`, `px`, `rem`, nazwy fontów) w `docs/ux/flows/`; styleguide 1.1.0: nagłówek wersji, wpis w changelogu, nowe pary w § 2.1.4; tokeny: poprawny JSON, aliasy rozwiązywalne, brak cykli i literałów w `semantic/`, `$deprecated` przy `quote` i `issued`. |
| AC5 | `scenariusze-a-d.md`: A–D od utworzenia zlecenia do rozliczenia (D — także drugie zlecenie w tej samej lokalizacji), każdy krok wskazuje istniejący ekran (link), kolumna „Obejście” = „brak”; luki znalezione w trakcie zamknięte w makietach albo opisane w „Uwagach do rozważenia”. |
| Bezpieczeństwo | Macierz ról zgodna z P6 i macierzą w `domain-model.md`; brak akcji edycji dla Tylko odczyt; step-up i funkcje administracyjne tylko w panelu; przegląd danych (wyłącznie syntetyczne). |
| Bramki | `npm run docs:check` — 0 błędów i 0 ostrzeżeń (nowe pliki nie są osierocone); `npm run test:tools` — bez regresji; walidacja tokenów. `ux-designer` nie ma powłoki — `docs:check`, `test:tools`, render Mermaid i walidację tokenów uruchamia orkiestrator (walidację tokenów można też wykonać skryptem w przeglądarce Playwright na `about:blank`, bez sieci). |

**Kolejność kroków**
1. Styleguide 1.1.0, tokeny i `design/tokens/README.md` (fundament makiet).
2. `flows/README.md`: legenda, szkielety aplikacji, mapa nawigacji (AC1), tabela ekranów, macierz ról, wspólne stany.
3. Przepływy web: 01 → 07 → 02 → 03 → 04 → 05 → 06 → 08; mobile: 09 → 10 oraz części mobilne 01, 03, 05, 07.
4. `scenariusze-a-d.md` (AC5) → poprawki makiet dla znalezionych luk.
5. Przegląd zgodności (AC4) → propozycje `[P-n]` w § 8.
6. `docs/ux/README.md`, `docs/README.md`, linia w `domain.md` (potwierdza `product-owner`), `CHANGELOG.md`, „Dziennik”.
7. Samosprawdzenie wg tabeli; orkiestrator: `npm run docs:check`, `npm run test:tools`, render Mermaid, walidacja tokenów.
8. Konsultacja `security-engineer`; weryfikacja biznesowa `product-owner`.
9. Przeglądy: `web-developer` (wykonalność w React + shadcn/ui, klawiatura), `mobile-developer` (Expo, offline, aparat, upload w tle, stany urządzenia).

**Pytania do Konrada na demo (nieblokujące; rekomendacje wdrażane w historyjce)**
1. Klucze tokenów `quoting` / `invoiced` zamiast `quote` / `issued` (stare oznaczone jako wycofywane) — *rekomendacja: tak*; konsekwencja „nie”: stała lista wyjątków w mapowaniu kod → token w web i mobile.
2. Transza „Anulowana” — ton neutralny i ikona `ban` — *rekomendacja: tak*.
3. „Po terminie” zastępuje odznakę „Wystawiona” (jedna mocna odznaka) — *rekomendacja: tak*; alternatywa: dwie odznaki obok siebie (więcej szumu w tabelach).
4. Propozycje `[P-n]` z changelogu styleguide'u — akceptacja; wdrożenie jako 1.2.0 przed pierwszą historyjką, która ich używa — *rekomendacja: tak*.
5. Wejścia do backlogu M1 (EVM-010): szybkie dodanie strony z comboboxu (E4) i „Inne zlecenia w tej lokalizacji” (E3) — *rekomendacja: tak*.
6. Prototyp HTML — nie w tej historyjce; ewentualnie po EVM-006 do testów z użytkownikami — *rekomendacja: tak*.
7. Kto odnotowuje wpłaty — biuro (Edytor) czy księgowość? — *rekomendacja: biuro (Edytor); księgowość ma rolę Tylko odczyt (widzi płatności, bez akcji — scenariusz A12)*; konsekwencja innego wyboru: księgowa potrzebuje roli Edytor (pełna edycja zleceń) albo osobnej roli „Księgowość” (kandydat M4, razem z rolą Monter).
8. Uzupełnienie pytania 5 — priorytety kandydatów z weryfikacji biznesowej („Uwagi do rozważenia” → „Weryfikacja biznesowa”): **P1 w M1** — szybkie dodanie strony, edycja lokalizacji i danych strony (PO-1), „Inne zlecenia w tej lokalizacji”; **P2** — podpowiedź lokalizacji klienta w nowym zleceniu, filtr „Do wystawienia” w Płatnościach — *rekomendacja: tak, jako wejście do EVM-010*; konsekwencja „nie”: UAT M1 (scenariusze A–D bez obejść) zagrożony przy szybkich zleceniach z telefonu i przy zmianach danych lokalizacji.

### Ustalenia z konsultacji
_security-engineer, 2026-10-03 — werdykt **CHANGES REQUIRED** (4 × major, ryzyko Medium; żadna zmiana nie wymaga decyzji Konrada). Ustalenia są obowiązujące; wdrożone w implementacji (kolumna „Gdzie”). Model zagrożeń i `rodo.md` bez zmian (brak nowego kontenera, przepływu, roli i kanału); testy macierzy ról nie dotyczą historyjki, ale tabele ról w makietach są wejściem do SR-AUTHZ-05 w E1–E7._

| # | Ustalenie (skrót) | Gdzie |
|---|---|---|
| M1 | Szkic i niezapisane zmiany w panelu **tylko w pamięci karty** (nigdy `localStorage`, `sessionStorage`, IndexedDB, ciasteczka); szkic przypisany do osoby — odrzucany przy wylogowaniu, zamknięciu karty i zalogowaniu innej osoby, przywracany tylko po ponownym uwierzytelnieniu tej samej osoby; mikrocopy bez obietnicy trwałego zapisu (SR-WEB-05, SR-SESS-05, TM-10) | styleguide § 4.1, § 4.10, § 6.4; `flows/README.md` (zasady wspólne pkt 6); W-05 |
| M2 | „Cofnij” tylko przez przejście odwrotne z tabel `domain-model.md`, dostępne tej samej roli bez step-upu; brak „Cofnij” dla `todo → in_progress`, `todo → waiting` i operacji, których odwrócenie wymaga Administratora ze step-upem (wystawienie faktury, wpłata, anulowanie, rozliczenie) — dialog z podsumowaniem (SR-AUTHZ-10, SR-API-07) | styleguide § 4.11; `flows/04-aktualizacja-etapu.md` („Cofnij — lista przejść”); W-06, W-11 |
| M3 | Akcje płatności ściśle wg tabeli „Etap płatności”: Edytor — wystaw fakturę, odnotuj wpłatę, **anuluj tylko transzę „Planowaną”**; Administrator ze step-upem — wycofanie i anulowanie faktury, cofnięcie wpłaty, przywrócenie, zmiana kwoty w `invoiced` / `paid`, usunięcie transzy; Edytor — wyłączone z podpowiedzią; Tylko odczyt — bez akcji; zlecenie Rozliczone / Anulowane — wszystko wyłączone | `flows/08-nieoplacone.md` („Akcje płatności — status × rola”); W-06 |
| M4 | Klasa poufności przy uploadzie dokumentu: wybór rodzaju; przy `other` pytanie o PESEL / numer dokumentu tożsamości (tak → `identity_data`); Administrator i Edytor mogą klasę tylko podnieść (SR-AUTHZ-07, P6, AB-20) | `flows/06-galeria-i-upload.md` (W-09) |
| minor | Kontrole w makietach: logowanie bez enumeracji kont i bez „Zapamiętaj mnie”, metody MFA wg roli, kody odzyskiwania, W-04 tylko w panelu (01); stany urządzenia z P2 / P7, `FLAG_SECURE`, limit urządzeń bez unieważniania z telefonu (01); projekcja M-03 bez płatności, PPE, e-maili, NIP, notatek klienta i stron, plików dokumentów (03); pola notatek z podpowiedzią, zwykły tekst, linki `https` / `tel` / `mailto` (02, 05, 10); typy i limity przy Uploaderze, brak podglądu przed `clean`, kwarantanna, film > 2 GB, lightbox bez EXIF / GPS, brak „Kopiuj link” i masowego pobierania, ZIP ze step-upem (06); URL i tytuł karty bez danych osobowych, paginacja ≤ 100, bez eksportu CSV / XLSX, stan `429` (07, 08); „Inne zlecenia w tej lokalizacji” tylko numer, tytuł, status, data zamknięcia (03); zasady wspólne (Wyloguj, klauzula, sesja, `404` bez danych); dane syntetyczne (`example.com`, `*.test`); Mermaid i tokeny walidowane lokalnie, bez serwisów online | pliki `docs/ux/flows/01…10`, `flows/README.md` → „Zasady wspólne” |

## Decyzje
- 2026-10-03 — Konrad (demo): **akceptacja przyrostu** (mapy nawigacji, 10 przepływów z makietami low-fi, styleguide 1.1.0, przejście scenariuszy A–D) wraz z rekomendacjami pytań 1–8:
  1. klucze tokenów `quoting` / `invoiced` (stare `quote` / `issued` — `$deprecated`, usunięcie w najbliższej wersji MAJOR);
  2. transza „Anulowana” — ton neutralny, ikona `ban`;
  3. „Po terminie” zastępuje odznakę „Wystawiona” (jedna odznaka, wyliczana);
  4. propozycje `[P-1]…[P-13]` zaakceptowane — wdrożenie w styleguide 1.2.0 przed pierwszą historyjką, która ich używa;
  5. i 8. wejście do EVM-010 — P1 w M1: szybkie dodanie strony z comboboxu, edycja lokalizacji i danych strony (PO-1 / W-20), „Inne zlecenia w tej lokalizacji”; P2: podpowiedź lokalizacji klienta w nowym zleceniu, filtr „Do wystawienia” w Płatnościach;
  6. bez prototypu HTML w tej historyjce (ewentualnie po EVM-006 do testów z użytkownikami);
  7. wpłaty odnotowuje biuro (Edytor); księgowość ma rolę Tylko odczyt (widzi płatności, bez akcji).

## Uwagi do rozważenia
### Implementacja (ux-designer, 2026-10-03)
**Dla `solution-architect` (nieblokujące, przed epikami M1 / M2):**
1. **Szkice i preferencje filtrów po stronie serwera** — panel trzyma je dziś tylko w pamięci karty (M1); trwałe szkice formularzy i zapamiętane filtry per użytkownik wymagają encji / preferencji w modelu (styleguide § 4.1, § 4.3).
2. **Kod odzyskiwania przy step-upie** — rekomendacja security i UX: niedostępny (W-04); potwierdzić w E1 / ADR-0005.
3. **Rozbieżność `offline-sync.md` („pliki dokumentów tylko online, na żądanie”) z SR-AUTHZ-12** (pobieranie dokumentów tylko w kanale `web`) — makiety stosują SR-AUTHZ-12: M-03 pokazuje tylko metadane dokumentów; poprawić zapis w `offline-sync.md`.
4. **Wybór zlecenia dla nowego zdjęcia w trybie ukrytych danych** (7 dni offline, brak blokady ekranu) — makiety pokazują wyłącznie numery zleceń (M-06); potwierdzić w E9 / E11, czy numer zlecenia wystarcza i czy wolno go pokazać.
5. **Agregaty dla listy i podsumowania zlecenia** (W-10, W-06: najdłuższe oczekiwanie, najbliższy termin, nieopłacone / po terminie) pochodzą z `procedures` i `payments`, a `work-orders` od nich nie zależy — potrzebny widok odczytu albo zapytanie kompozytowe, z filtrem tą samą polityką (SR-AUTHZ-03); decyzja przed E3 / E4 / E7.
6. **`Document.confidentialityOverride`** (P6, zmiana *expand*) — dopisać do `domain-model.md` przed E6; W-09 z niego korzysta.
7. **Odrzucone szybkie zlecenie z zależnymi elementami** — „Utwórz ponownie” z przeniesieniem niewysłanych zdjęć i wpisów do nowego zlecenia przed wysłaniem (M-10, M-07) — potwierdzić w EVM-011 / E13 (także z `mobile-developer`).
8. **Filtry listy** — „czekamy na [klient / rodzaj strony] dłużej niż X dni”, „po terminie”, „nieopłacone” jako parametry `GET` bez danych osobowych (W-10, W-11) — do kontraktu w E3 / E4 / E7.

**Dla `product-owner` / backlogu (przez `/refine`):**
9. Doprecyzowanie decyzji z EVM-002 („Edytor anuluje transzę”) = **tylko transzę „Planowaną”** (`planned → cancelled`); anulowanie wystawionej faktury to korekta płatności (A ↑) — zgodne z tabelą przejść; uwaga 7 z EVM-002 zamknięta w makietach W-06 / W-11.
10. Kandydaci (wejście do EVM-010): szybkie dodanie strony z comboboxu z podpowiedzią z lokalizacji (E4), „Inne zlecenia w tej lokalizacji” w W-06 (E3), pełna historia lokalizacji (E3 / E6, z przeglądem security), „Poproś administratora o korektę płatności” z poziomu transzy (E7), edycja zakresu zlecenia w W-06 (makieta przy refinemencie E3).
11. Potwierdzenie `product-owner`: linia w `domain.md` („Zmiany nazw w kodzie” — etykieta „Czekamy na…”), mikrocopy i terminologia makiet, biznesowe przejście scenariuszy A–D (`docs/ux/flows/scenariusze-a-d.md`).

**Propozycje do styleguide'u:** 13 propozycji `[P-n]` w styleguide § 8 („Propozycje (EVM-004) — do akceptacji”) — pytanie 4 na demo.

### Weryfikacja biznesowa (product-owner, 2026-10-03)
**Wynik:** scenariusze A–D przechodzą przez makiety bez obejść ([`scenariusze-a-d.md`](../../ux/flows/scenariusze-a-d.md#weryfikacja-biznesowa-product-owner-2026-10-03)). Linia w `domain.md` („Zmiany nazw w kodzie”, etykieta „Czekamy na…”) jest potwierdzona, a terminologia makiet zgodna ze słownikiem — z wyjątkiem uwag PO-2–PO-5.

Status uwag z implementacji:
- **Pkt 9 — potwierdzony biznesowo.** Edytor anuluje tylko transzę „Planowaną”. Anulowanie wystawionej faktury to korekta księgowa (faktura korygująca), więc wykonuje je Administrator ze step-upem. Zapisane w `domain.md` → „Korekta płatności”.
- **Pkt 10** — priorytety niżej (tabela kandydatów).
- **Pkt 11** — wykonany.

**Zmiany `product-owner`:**
- `domain.md`:
  - nowa sekcja „Pojęcia z makiet MVP (dodane w EVM-004)”: klasa poufności dokumentu, korekta płatności, dokumenty lokalizacji / klienta, inne zlecenia w tej lokalizacji, „Oczekuje na numer”, „Wymaga uwagi”;
  - odnośnik do tej sekcji w nagłówku dokumentu.
- `scenariusze-a-d.md`:
  - B2 przechodzi przez wycenę (dotąd żaden scenariusz jej nie obejmował);
  - A9 — dopisany drugi etap weryfikacji ładowarki;
  - D4 = ten sam klient, D4′ = nowy klient; drugie zlecenie ma numer `ZL-2026-0058`;
  - nowa luka L8;
  - nowa sekcja „Weryfikacja biznesowa”.

**Uwagi dla `ux-designer`** (makiety; rekomendacja: poprawić w tej historyjce przed przeglądami — bez wpływu na AC1–AC4):

**PO-1 (major biznesowo; luka L8) — brak edycji lokalizacji i danych strony w M1**
- Problem: baner po szybkim zleceniu prosi „Uzupełnij dane klienta i lokalizacji”, a w praktyce PPE, zarządca czy moc przyłączeniowa bywają znane później. Dziś żaden ekran nie pozwala ich uzupełnić; klienta edytuje się w W-14.
- Rekomendacja:
  - w karcie „Lokalizacja” W-06 akcja „Edytuj lokalizację” (A, E; R — ukryte) z polami sekcji „Lokalizacja” z W-05;
  - informacja „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).” — lokalizacja jest wspólna dla zleceń, także różnych klientów (D4′);
  - „Edytuj stronę” (OSD, zarządca) z tej samej karty.
- Zakres: wystarczy wiersz w tabeli ról W-06 i węzeł mapy „bez makiety — przy refinemencie E3 / E4” (jak W-14).
- Potem: krok uzupełnienia lokalizacji w wariancie A1′.

**PO-2 (minor, mikrocopy) — formy zależne od płci**
- Problem: `User` ma tylko `displayName`, więc system nie odmieni „zmieniła / zmienił”, „dodał” ani „Odpowiedzialna”.
- Gdzie:
  - styleguide § 4.5 — przykład zmiany statusu w dzienniku;
  - `05-wpis-i-komentarz.md` — W-08: makieta i tabela typów wpisów;
  - `03-szczegoly-zlecenia.md` — W-06: „Odpowiedzialna: Anna Testowa”.
- Rekomendacja: formy bezosobowe.
  - Autor zostaje w nagłówku wpisu.
  - Treść: „Zmiana statusu etapu „…”: «Czekamy na…» · Czekamy na: …” oraz „Dodano 12 zdjęć · W trakcie prac”.
  - Etykieta: „Osoba odpowiedzialna: Anna Testowa”.
- Alternatywa odrzucona: pole płci w profilu — to nowe dane osobowe pracowników wyłącznie dla gramatyki.

**PO-3 (nit)** — W-06, kafel „Na kogo czekamy”: usunąć wiersz „klient: —”. Kafel pokazuje tylko faktyczne oczekiwania, a gdy ich nie ma — „Piłka po naszej stronie…”.

**PO-4 (nit)** — W-09: etykieta „Nie skanowany AV — za duży” ma żargon („AV”) i błąd pisowni (imiesłów przymiotnikowy piszemy z „nie” łącznie). Propozycja: „Nieskanowany antywirusem — plik za duży”. Wymaga potwierdzenia `security-engineer`, bo etykieta pochodzi z P5 i SR-FILE-12.

**PO-5 (nit)** — rozbieżność danych w makietach: `flows/README.md` → „Dane w makietach” mówi „bez numerów … PPE”, a W-06 pokazuje „PPE: PL-TEST-0001”. Ujednolicić, np. „PPE tylko w formie oznaczonej `TEST`”.

**PO-6 (minor, do refinementu E3) — brak lokalizacji na liście zleceń**
- Problem: W-10 w układzie expanded nie pokazuje lokalizacji. Domyślny tytuł zlecenia to nazwa szablonu („Garaż — pełny proces”), więc wiersze różnią się tylko klientem.
- Rekomendacja: miasto i ulica pod nazwą klienta w kolumnie „Klient”.
- Bez dopisywania adresu do tytułu — to powielałoby dane osobowe w polu tekstowym.

**PO-7 (minor, do refinementu E3 / E10) — „Moje” na telefonie**
- Problem: M-05 nie definiuje „Moje”, a makiety panelu nie mają przypisania technika do zlecenia (tylko opiekun).
- Rekomendacja: na telefonie „Moje” = opiekun albo technik (`WorkOrderAssignment`); w panelu bez zmian (opiekun).
- Przypisanie techników w W-06 — kandydat niżej.

**Dla `solution-architect`** (nieblokujące, przed E3 / E4):

**PO-8 — zlecenie zamknięte tylko do odczytu po stronie serwera**
- Problem: baner W-06 dla zlecenia rozliczonego lub anulowanego mówi „zakres, procesy i płatności są tylko do odczytu”. Model blokuje jednak w tych stanach tylko przejścia etapów i zmiany płatności.
- Reguła biznesowa: w zleceniu zamkniętym także zakres i skład procesów są tylko do odczytu — egzekwowane przez serwer, nie tylko w UI. Wpisy, media i dokumenty nadal można dodawać.

**Kandydaci do backlogu (wejście do EVM-010; priorytet — rekomendacja PO, decyzja Konrada — pytanie 8):**
| Kandydat | Epik | Rekomendacja |
|---|---|---|
| Szybkie dodanie strony z comboboxu z podpowiedzią z lokalizacji | E3, E4 | **M1, P1** — w M1 nie ma osobnego ekranu stron; korzystają z niego B1, B5, C1, C3, C4 |
| Edycja lokalizacji i danych strony (PO-1) | E3, E4 | **M1, P1** — bez niej biuro nie uzupełni danych po szybkim zleceniu ani nie poprawi pomyłki |
| „Inne zlecenia w tej lokalizacji” w W-06 | E3 | **M1, P1** — scenariusz D w UAT M1 bez obejść |
| Edycja zakresu zlecenia w W-06 (makieta przy refinemencie) | E3 | **M1, P1** — już w zakresie E3 („zakres z katalogu, edytowalny”) |
| Podpowiedź lokalizacji klienta w nowym zleceniu (ten sam klient — D4) | E3 | M1, P2 — dziś działa wyszukiwanie po adresie |
| Filtr „Do wystawienia” (transze „Planowane”) w Płatnościach | E7 | M1, P2 — chroni przed pominięciem faktury; ta sama lista z innym statusem |
| Przypisanie techników do zlecenia w W-06 i „Moje” na telefonie (PO-7) | E3, E10 | M2, P2 — w v1 każdy Edytor widzi wszystkie zlecenia |
| „Poproś administratora o korektę płatności” z poziomu transzy | E7 | później (M3, z powiadomieniami) — w MVP wystarczy komentarz |
| Pełna historia lokalizacji (dokumenty i zdjęcia poprzednich zleceń) | E3, E6 | później (M3), z przeglądem `security-engineer` |
| Wartość zlecenia i podpowiedź kwot transz wg udziałów z szablonu | E7 | później (M3 / M4) — w MVP kwoty wpisuje biuro |

### Poprawki po przeglądach — runda 1 (ux-designer, 2026-10-03)
**Dla `security-engineer` i `solution-architect`** (nieblokujące dla makiet, przed E1 / E9):
1. **Logowanie mobilne konta bez TOTP** (konto z samym kluczem dostępu; P1, SR-AUTH-14 — aplikacja: hasło + TOTP). Makiety: W-03 informuje Administratora i Edytora, że telefon wymaga kodu z aplikacji, i pozwala dodać go obok klucza dostępu; M-02 ma stany „Dodaj kod z aplikacji uwierzytelniającej” i „Skonfiguruj drugi krok logowania” (`403 mfa_enrollment_required`) z drogą do panelu (Konto → Drugi krok logowania, W-15). Do ustalenia:
   - kod odpowiedzi — propozycja robocza `403 totp_not_configured` (rozszerza katalog kodów v1, jak `channel_not_allowed`);
   - odpowiedź tylko po poprawnym haśle — przed nim zawsze ten sam komunikat o złych danych;
   - kolejność kontroli względem `403 channel_not_allowed` — wymaganie UX: Tylko odczyt nie dostaje wezwania do dodania kodu (por. uwaga 2 z EVM-005 o kolejności kontroli w SR-MOB-04);
   - telefon nie konfiguruje drugiego kroku — samo hasło nie może dodać metody logowania.
2. **Edycja lokalizacji i strony (W-20, PO-1)** korzysta z istniejących operacji (`Site`, `Party` — edycja A, E w macierzy `domain-model.md`) i `If-Match`; licznik „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n)” — ta sama polityka co „Inne zlecenia w tej lokalizacji” (SR-AUTHZ-03); baner „Zlecenie założone w terenie” wyliczany z `origin = mobile_quick` i statusu „Nowe”. Bez zmiany modelu. Pełna makieta W-20 — przy refinemencie E3 / E4 (kandydat PO-1 w EVM-010).

### Poprawki po przeglądach — runda 1 (mobile-developer, 2026-10-03)
Makiety poprawione w historyjce (4 × major z przeglądu `mobile-developer`): `09-mobile-zdjecia-filmy-offline.md` (M-06 — uprawnienia z ekranem wyjaśniającym, „Zapis i nagrywanie”, mało miejsca; M-07 — „Usuń z kolejki” po `applied`, powiadomienia; M-08 — „Czeka na plik z telefonu”), `06-galeria-i-upload.md` (W-09 — „Czeka na plik z telefonu”, liczniki), styleguide § 5.4 i propozycje [P-7], [P-10]. Kontrakt, model i polityki — bez zmian.

**Dla `solution-architect` (EVM-011, E6 / E11; bez zmiany kontraktu w tej historyjce):**
1. **Luka między kanałami metadanych i pliku.** `CreateMediaAsset` idzie przez outbox i bywa `applied` długo przed plikiem (film czeka na Wi-Fi, telefon znów traci zasięg, seria 60 zdjęć w C9) — biuro ma wtedy `MediaAsset` bez pliku albo z `pending_upload`. Makiety pokazują to uczciwie („Czeka na plik z telefonu · autor · od …”, bez procentów), a „Usuń z kolejki” po `applied` ma dialog „W biurze zostanie wpis bez pliku”. Do rozstrzygnięcia jedno z dwóch:
   - wysyłać `CreateMediaAsset` dopiero przy starcie sesji uploadu (luka skraca się do czasu wysyłania; usunięcie z kolejki przed startem nie zostawia śladu w biurze);
   - albo sprzątanie osieroconych mediów bez pliku po stronie serwera (np. po N dniach bez sesji uploadu albo po `abort` sesji przez urządzenie) z widocznym stanem w panelu.
   Rekomendacja `mobile-developer`: pierwszy wariant (prostszy, bez nowego stanu w modelu); kolejność „`CreateMediaAsset` przed sesją uploadu” z `offline-sync.md` zostaje.
2. **Trwałość nagrania.** Format odporny na zabicie procesu (np. fragmentowany MP4) i wpis „nagrywanie w toku” w zaszyfrowanej bazie przy starcie nagrania (zlecenie, kategoria, czas) — odzyskanie filmu po zabiciu procesu (M-06). Kolejność zapisu do potwierdzenia: `fsync` pliku, potem jedna transakcja SQLCipher (`MediaAsset` + wpis outbox), dopiero potem „Zapisano w telefonie”; SHA-256 po zapisie, przed sesją uploadu (ADR-0007: „suma liczona przy zapisie pliku”).
3. **Wartości do mikrocopy M-06** (EVM-011, ryzyka 4 i 10 ADR-0007): próg blokady filmu (roboczo 1 GB + rezerwa na pliki części), minimalna rezerwa dla zdjęć i bazy, rzeczywisty bitrate (P5: ≤ 8 Mb/s, ok. 60 MB na minutę) i krytyczny poziom baterii, przy którym zatrzymujemy nagranie.

**Dla `security-engineer` (bez zmiany polityki w tej historyjce):**
4. **P7 pkt 3 wymienia uprawnienia „aparat i mikrofon”.** Upload w tle (UIDT, ADR-0007) i komunikat „wysyłanie wstrzymane — otwórz aplikację” wymagają też powiadomień — na Androidzie 13+ to uprawnienie `POST_NOTIFICATIONS`. Bez niego postęp zadania widać tylko w systemowym menedżerze zadań, a komunikat o wstrzymaniu się nie pokaże. Makiety: prośba z ekranem wyjaśniającym po pierwszym elemencie w kolejce i Banner w Kolejce bez zgody (M-07); treść powiadomień bez danych osobowych (SR-MOB-08). Prośba: potwierdzić i dopisać powiadomienia do P7 pkt 3 (oraz do przeglądu manifestu w SR-MOB-02).

**Dla `product-owner`:**
5. Pojęcie „Czeka na plik z telefonu” (W-09, M-08) — kandydat do sekcji „Pojęcia z makiet MVP” w `domain.md` (obok „Wymaga uwagi”).

### Uwagi nieblokujące z weryfikacji (runda 2, orkiestrator 2026-10-03)
Ustalenia minor / nit z QA i przeglądów rundy 2, niezałatwione w historyjce (do poprawki przy refinemencie odpowiednich historyjek M1–M2 albo w styleguide 1.2.0):
1. **Kolumna „Ekrany” propozycji `[P-n]` niepełna** (QA, minor; styleguide § 8 i `flows/README.md`) — m.in. P-2 → W-05, M-07; P-8 → M-06, M-07; P-9 → M-03, M-04, M-10. Uzupełnić przy wydaniu 1.2.0.
2. **Formy zależne od płci w mikrocopy** (QA + PO-2, minor; styleguide § 4.5, `flows/05`, `flows/03`). `User` ma tylko `displayName` — przejść na formy bezosobowe („Zmieniono status etapu”, „Odpowiedzialna osoba: …”).
3. **Wyszukiwanie lokalne na telefonie a polskie znaki** (QA, minor; `flows/07` M-05, `flows/09` M-06). Określić, że wyszukiwanie offline ignoruje wielkość liter i znaki diakrytyczne jak serwer („Lodz” → „Łódź”). → `offline-sync.md` / E10.
4. **Usuwanie z Kolejki offline** (mobile, minor; `flows/09` M-07, styleguide § 5.4). Reguła „✕ i wstecz zawsze zapisują” odsyła do usuwania w Kolejce, a „Usuń z kolejki” jest tylko w stanie „W kolejce” — dodać akcję także dla „Czeka na połączenie”.
5. **Dialog usuwania po `duplicate` / zgubionej odpowiedzi partii** (mobile, minor; `flows/09`). `duplicate` traktować jak `applied` (zasada 2 `offline-sync.md`); przy niepewnym wyniku — wariant ostrożny dialogu.
6. **Moment prośby o powiadomienia** (mobile, minor; `flows/09`). Ujednolicić: prośba po pierwszym „Gotowe” (M-03 / M-08), nie w Kolejce.
7. **Medium usunięte w biurze przed dotarciem pliku** (mobile, minor; `flows/06` W-09, `flows/09` M-07). Doprecyzować komunikat i akcje na telefonie dla tego przypadku.
8. **Trzy różne odnośniki banera „Zlecenie założone w terenie”** (web, minor; `flows/03` W-06). Rozróżnić nawigację (W-14), dialog (W-20) i przewinięcie do sekcji „Płatności” — inne komponenty / opisy a11y.
9. **Kolejność sprawdzeń w diagramie logowania mobilnego** (QA, nit; `flows/01`). `403 channel_not_allowed` (rola) przed „Dodaj kod z aplikacji” — jak w tabelach M-01 / M-02.
10. **Drobne** (QA / web, nit): „klient: —” w kaflu „Na kogo czekamy” (PO-3, `flows/03`); PPE w W-06 a zasada „bez numerów PPE” w `flows/README.md` (PO-5); etykieta „Nie skanowany AV” → „Nieskanowany antywirusem — plik za duży” (PO-4); nieaktualne zdanie o luce L8 w `scenariusze-a-d.md` (sekcja „Weryfikacja biznesowa”).

## Definition of Done
- [x] AC1–AC5 spełnione (weryfikacja QA przez inspekcję) — QA runda 2: PASS dla AC1–AC5; u orkiestratora: `npm run docs:check` 0 błędów / 0 ostrzeżeń, `npm run test:tools` 189/189 (pokrycie 100%), 12/12 diagramów Mermaid renderuje się lokalnie, 9 plików tokenów — poprawny JSON
- [x] Przeglądy: web-developer, mobile-developer — APPROVE (runda 2; R1: QA FAIL + 2× CHANGES, 7× major — poprawione); konsultacja security-engineer przed implementacją — 4× major wdrożone
- [x] Demo i akceptacja Konrada — 2026-10-03: „Akceptuję” z rekomendacjami pytań 1–8 (sekcja „Decyzje”)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-004-przeplywy-ux`
- 2026-10-03 — plan techniczny (ux-designer)
- 2026-10-03 — konsultacja security-engineer: CHANGES REQUIRED (M1–M4 + kontrole minor) → „Ustalenia z konsultacji”
- 2026-10-03 — implementacja (ux-designer): styleguide i tokeny 1.1.0 (`color.status.order.quoting`, `color.status.payment.invoiced`, `color.status.payment.cancelled`; `quote` / `issued` z `$deprecated`; „Czekamy na…”; § 3.7, § 3.12, § 4.1, § 4.3, § 4.4, § 4.10, § 4.11, § 4.13, § 5.4, § 6.2, § 6.4, § 7.1; changelog z 13 propozycjami `[P-n]`), `design/tokens/README.md`; `docs/ux/flows/` — README (mapa nawigacji web i mobile, tabela ekranów, macierz ról, zasady wspólne, pokrycie AC, zgodność z P1–P7), 10 przepływów (21 ekranów z makietą, 9 węzłów „bez makiety”: W-12–W-19, M-11), `scenariusze-a-d.md` (A–D bez obejść, 7 luk zamkniętych lub przekazanych); `docs/ux/README.md`, `docs/README.md`, linia w `domain.md`, `CHANGELOG.md`. Ustalenia security M1–M4 i kontrole minor wdrożone. Walidacja nowych tokenów skryptem w przeglądarce na `about:blank` (bez sieci): aliasy, klucze, unikalność ikon i etykiet, kontrasty nowych par (12,99 / 9,51; 9,23 / 5,98; 8,49 / 5,49). `ux-designer` nie ma powłoki — `npm run docs:check`, `npm run test:tools`, render Mermaid (`.scratch/EVM-002/mmdc`) i pełną walidację tokenów oraz commity wykonuje orkiestrator.
- 2026-10-03 — weryfikacja biznesowa (product-owner): scenariusze A–D przechodzą bez obejść.
  - `scenariusze-a-d.md`: B2 przez wycenę, A9, D4 / D4′ (`ZL-2026-0058`), luka L8, sekcja „Weryfikacja biznesowa”.
  - `domain.md`: linia „Czekamy na…” potwierdzona; nowa sekcja „Pojęcia z makiet MVP”; „Edytor anuluje tylko transzę Planowaną” zapisane jako część pojęcia „Korekta płatności”.
  - „Uwagi do rozważenia”: PO-1 (major biznesowo — edycja lokalizacji i strony), PO-2–PO-7 dla `ux-designer`, PO-8 dla `solution-architect`, kandydaci do EVM-010.
  - Pytania 7–8 na demo.
  - `product-owner` nie ma powłoki — `npm run docs:check`, `npm run test:tools` i commit wykonuje orkiestrator.
- 2026-10-03 — poprawki runda 1 (ux-designer; ustalenia `qa-engineer` i `web-developer`, major):
  - `01-logowanie-mfa.md`: W-03 — informacja o kodzie z aplikacji do telefonu i „Dodaj kod z aplikacji” po kluczu dostępu, podsumowanie metod w kroku 3; M-01 / M-02 — stany „Dodaj kod z aplikacji uwierzytelniającej” i „Skonfiguruj drugi krok logowania” (diagram, tabele stanów i ról).
  - `03-szczegoly-zlecenia.md`: baner `mobile_quick` z odnośnikami, „Edytuj lokalizację” i „Edytuj stronę” (W-20) w makiecie i tabeli ról W-06; `10-mobile-szybkie-zlecenie.md` — odnośniki do akcji.
  - `README.md`: węzeł W-20 (bez makiety) na mapie i w tabelach, krawędź W-06 → W-14, wiersze W-15 i P1; `scenariusze-a-d.md` — krok A1″, L8 zamknięta.
  - „Uwagi do rozważenia” → „Poprawki po przeglądach — runda 1”. `ux-designer` nie ma powłoki — `npm run docs:check`, `npm run test:tools`, render Mermaid i commit wykonuje orkiestrator.
- 2026-10-03 — poprawki runda 1 (mobile-developer; ustalenia `mobile-developer`, 4 × major):
  - `09-mobile-zdjecia-filmy-offline.md`: diagram (zgody, trwały zapis, przerwanie nagrania, „Czeka na plik z telefonu”, powiadomienia); M-06 — tabele „Zapis i nagrywanie” i „Uprawnienia systemowe”, ekrany wyjaśniające dla aparatu i mikrofonu, „Zapisywanie filmu…”, mało miejsca liczone od progu blokady; M-07 — „Usuń z kolejki” przed i po `applied`, prośba o powiadomienia i Banner bez zgody; M-08 — liczniki i stan „Czeka na plik z telefonu”.
  - `06-galeria-i-upload.md`: W-09 — stan „Czeka na plik z telefonu” osobny od wysyłania z karty, liczniki, diagram, rola „Usuń medium”.
  - styleguide § 5.4 (potwierdzenie po trwałym zapisie), changelog 1.1.0, propozycje [P-7] i [P-10]; `flows/README.md` — wiersz P7 i zasada 12.
  - „Uwagi do rozważenia” → „Poprawki po przeglądach — runda 1 (mobile-developer)”.
- 2026-10-03 — workflow `deliver-story`: `passed` po 2 rundach; zmiany ux-designer i product-owner zacommitowane przez orkiestratora (agenci bez powłoki)
- 2026-10-03 — in-progress → in-review: DoD (AC + przeglądy) spełnione, uwagi minor / nit w „Uwagach do rozważenia”; czeka na demo i decyzje Konrada (pytania 1–8)
- 2026-10-03 — in-review → done: akceptacja Konrada na demo (pytania 1–8 z rekomendacjami); makiety i propozycje `[P-n]` oznaczone jako zaakceptowane; squash merge do `main`
