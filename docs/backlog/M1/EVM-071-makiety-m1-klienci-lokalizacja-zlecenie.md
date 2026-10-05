---
id: EVM-071
title: Makiety ekranów M1 — klienci, lokalizacja, edycja zlecenia i prywatność
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-review
priority: P0
owner: ux-designer
contributors: [product-owner]
reviewers: [web-developer, security-engineer]
depends_on: [EVM-014]
---

# EVM-071: Makiety ekranów M1 — klienci, lokalizacja, edycja zlecenia i prywatność

## Historyjka
Jako **zespół wykonawców epików E2, E3, E4, E7 i E8** chcemy **makiet ekranów i dialogów, które w EVM-004 zostały „bez makiety”**, aby **historyjki edycji zlecenia, klientów i prywatności miały jednoznaczną specyfikację UI**.

## Kontekst
- `docs/ux/flows/README.md` → „Ekrany”: W-14 (Klienci), W-19 (Prywatność i pomoc), W-20 (Edycja lokalizacji i strony) — bez makiety; W-06 — „Edytuj dane zlecenia”, „Edytuj zakres”, dodanie i usunięcie procesu lub etapu oraz dialog „Dodaj transzę” bez makiety (luka L7, PO-1).
- Kandydaci z EVM-004 (decyzja 5 i 8): edycja lokalizacji i strony (P1), edycja zakresu (P1), filtr „Do wystawienia” (P2); uwaga PO-6 (lokalizacja w kolumnie „Klient” na W-10).
- W-09 ma makietę tylko dla panelu na komputerze; wysyłanie z przeglądarki w telefonie zastępuje w UAT M1 kroki terenowe A6, B10 i C9, więc potrzebuje makiety w szerokości `breakpoint.compact` (przegląd `ux-designer` EVM-010; decyzja 18).
- Historyjki korzystające: EVM-035, EVM-036, EVM-039, EVM-041, EVM-042, EVM-044, EVM-046, EVM-050, EVM-053, EVM-059, EVM-063, EVM-066, EVM-072.

## Kryteria akceptacji
**AC1 — W-14 „Klienci”**
- Zakładając rolę Administrator, Edytor albo Tylko odczyt
- Gdy czytam makietę W-14
- Wtedy obejmuje listę (wyszukiwanie przez `POST …/search`, sortowanie wg polskiego alfabetu, paginacja), szczegóły klienta (dane, „Historia zleceń”, „Dokumenty klienta”), edycję w dialogu (pola jak „Dodaj klienta” z W-05), usunięcie i przywrócenie (Administrator) oraz anonimizację (Administrator ze step-upem, dialog nieodwracalny); dla Tylko odczyt — podgląd bez akcji.

**AC2 — W-20 „Edycja lokalizacji i strony”**
- Zakładając kartę „Lokalizacja” w W-06 i baner zlecenia z telefonu
- Gdy czytam makietę dialogu W-20
- Wtedy ma pola sekcji „2. Lokalizacja” z W-05 wypełnione bieżącymi danymi, informację „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).”, „Edytuj stronę” z informacją o stronie wspólnej i „Dodaj stronę” bez dialogu na dialogu, z obsługą `412`.

**AC3 — W-06 „Edytuj dane zlecenia” i zlecenie zamknięte**
- Gdy czytam makietę dialogu edycji danych zlecenia (tytuł, opis, opiekun, planowana data)
- Wtedy makieta pokazuje też stan zlecenia „Rozliczone” / „Anulowane”, w którym edycja danych zlecenia, zakresu, procesów i płatności jest niedostępna z podpowiedzią (decyzja 17 w README M1), a wpisy, media i dokumenty — dostępne.

**AC4 — W-06 „Edytuj zakres”, procesy, etapy i transze**
- Gdy czytam makietę edycji zakresu
- Wtedy obejmuje dodanie pozycji z katalogu z propozycją procesów wnoszonych przez pozycję (bez duplikatów), usunięcie pozycji (procesy zostają — z informacją, gdzie je usunąć), edycję parametrów technicznych wg zestawu parametrów oraz pozycję „Inna usługa” z opisem (wariant A z EVM-002: brak gotowego zasilania)
- Oraz makiety dodania i usunięcia procesu lub etapu oraz dialogi „Dodaj transzę” i „Zmień kwotę” (transza „Planowana”) mają tabelę stanów i ról, a usunięcie etapu zaleca „Nie dotyczy” jako zachowujące historię.

**AC5 — W-09 w przeglądarce telefonu (`breakpoint.compact`)**
- Zakładając Edytora wysyłającego zdjęcia i filmy z przeglądarki prywatnego telefonu z Androidem (M1 — przejściowo do aplikacji M2; EVM-044, EVM-046)
- Gdy czytam makietę W-09 w szerokości `breakpoint.compact`
- Wtedy obejmuje: wybór źródła („Wybierz z galerii” / „Zrób zdjęcie” wg decyzji 18), cele dotyku ≥ `size.touch-target.min`, status przy każdym pliku, potwierdzenie „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”, stan po powrocie do karty po blokadzie ekranu albo wyładowaniu karty („Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.”), ostrzeżenie przed wysłaniem dużego filmu przez sieć komórkową z progiem rozmiaru, stany offline i `429` oraz formy bezosobowe w mikrocopy.

**AC6 — W-19 „Prywatność i pomoc”**
- Gdy czytam makietę W-19
- Wtedy obejmuje klauzule informacyjne (miejsce na treść od `security-engineer`, wersja i data), pomoc (odnośnik do instrukcji dla biura opublikowanej w panelu — strona treści w układzie W-19, EVM-066 — i kontakt do Administratora) w stałym miejscu (WCAG 3.2.6), wejście z menu konta i ze stopki W-01 przed zalogowaniem.

**AC7 — Uzupełnienia list**
- Wtedy W-10 ma lokalizację (miasto, ulica) pod nazwą klienta (PO-6) i filtry „Więcej filtrów” (typ obiektu, szablon), a W-11 — chip „Do wystawienia” (transze „Planowane”) z akcją „Wystaw fakturę”.

**AC8 — Spójność i jakość**
- Wtedy wszystkie makiety używają wyłącznie komponentów i tokenów styleguide'u 1.2.0, mapa nawigacji i macierz ekran × rola są zaktualizowane, dane są syntetyczne, a `npm run docs:check` kończy się wynikiem 0 błędów.

## Poza zakresem
- Ekrany E1 — EVM-015. Pełna historia lokalizacji (M3). Przypisanie techników (M2). Edytor katalogu i szablonów (M4).

## UX / UI
Ekrany W-14, W-19, W-20 i rozszerzenia W-06, W-09 (`breakpoint.compact` — przeglądarka w telefonie), W-10, W-11; każdy z tabelą 5 stanów i tabelą ról.

## Bezpieczeństwo i prywatność
| Rola | Dostęp (w makietach) |
|---|---|
| Administrator | wszystkie akcje; usunięcie i anonimizacja klienta (anonimizacja — step-up) |
| Edytor | edycja klientów, lokalizacji, stron, zlecenia, zakresu i transz „Planowanych”; wysyłanie zdjęć i filmów z przeglądarki w telefonie (W-09 compact) |
| Tylko odczyt | podgląd bez akcji |
| Niezalogowany | tylko W-19 (z W-01) |

Odwołania: SR-AUTHZ-03 (licznik „n zleceń” tą samą polityką), SR-AUTHZ-08 (bez danych innych klientów), SR-DATA-02 (ostrzeżenia przy notatkach), SR-PRIV-05 (klauzule), SR-WEB-05 (stan niewysłanych plików z serwera, nie z pamięci przeglądarki), P3 i P7 (telefon prywatny — decyzje 18 i 19). Przegląd `security-engineer` obowiązkowy.

## Notatki techniczne
Bez kodu.

## Plan techniczny
Historyjka dokumentacyjna (enabler, bez kodu), w formie EVM-004 i EVM-015:
- makiety low-fi w Markdown — diagram Mermaid i szkielety ASCII z odwołaniami do § i tokenów semantycznych styleguide'u **1.2.0**; bez literałów kolorów, rozmiarów i fontów, bez prototypu HTML;
- każdy ekran i dialog ma bloki formy EVM-004: cel, główna akcja, hierarchia, szkielet, tabela 5 stanów (pusty, ładowanie, błąd z `429`, offline, brak uprawnień), tabela ról (A / E / R; W-19 — także niezalogowany), responsywność, komponenty i tokeny, mikrocopy, dostępność;
- dane wyłącznie syntetyczne (`flows/README.md` → „Dane w makietach”): Jan Przykładowy, Anna Testowa, Łukasz Testowy, Lucyna Przykładowa, Firma Testowa sp. z o.o., `example.com`, `*.test`, `ZL-2026-…`, `FV/TEST/…`, `PL-TEST-0001`; bez wartości NIP i PESEL.

Kontrakt API, migracje, model danych i zależności — nie dotyczy. Makiety są wejściem do planów EVM-035, EVM-036, EVM-039, EVM-041, EVM-042, EVM-044, EVM-046, EVM-050, EVM-053, EVM-059, EVM-063, EVM-066 i EVM-072 — operacje, kody błędów i mechanizmy ustalają tamte plany. Makiety tylko odzwierciedlają reguły; egzekwuje je zawsze serwer. Styleguide 1.2.0 i tokeny zostają bez zmian (rozstrzygnięcie 14). Baza porównania: `main`; gałąź robocza: `feature/EVM-071-makiety-m1`.

**Decyzje Konrada potrzebne do AC** (README M1 → „Decyzje dla Konrada”) — są wszystkie, bez pytań blokujących:
- 17 — zlecenie „Rozliczone” / „Anulowane”: dane zlecenia tylko do odczytu, jak zakres, procesy i płatności (`409 work_order_closed`);
- 18 — zdjęcia z galerii telefonu, pod warunkiem zasady o kopii w chmurze (EVM-066 AC2);
- 19 — pełny panel w przeglądarce prywatnego telefonu, z kontrolami kompensującymi (EVM-065 AC4, EVM-066 AC2).

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/ux/flows/13-klienci.md` — **nowy** (żywy, reguła 16; link z `flows/README.md`) | **Przepływ 13** — diagramy: lista → wyszukiwanie → szczegóły → W-06; edycja (`If-Match`, `412`); usunięcie i przywrócenie (A); anonimizacja (A: dialog nieodwracalny → W-04 → wynik, `409 has_active_dependents` albo `412`). **Makieta W-14:** (1) **lista** — DataTable, wyszukiwanie ≥ 3 znaki przez `POST /api/v1/customers/search` (fraza w pamięci karty), sortowanie wg `sortName` w kolacji `pl-PL` (nazwisko przed imieniem, „Ł” po „L”), kursor po 25 („Następna strona” / „Poprzednia strona”, bez licznika całkowitego), filtr „Usunięci” tylko dla A; (2) **szczegóły** — dane klienta (osoba albo firma), „Historia zleceń” (numer, tytuł, status, data; tą samą polityką co lista zleceń), „Dokumenty klienta (n)” (EVM-050 — lista z klasą poufności, `lock` dla R); (3) **dialog „Edytuj dane klienta”** — pola „Dodaj klienta” z W-05; (4) **usunięcie i przywrócenie** — A; (5) **anonimizacja** — A ze step-upem, dialog nieodwracalny; (6) stan „Klient zanonimizowany”. Do tego tabele 5 stanów i ról | AC1 |
| `docs/ux/flows/14-edycja-lokalizacji-i-strony.md` — **nowy** | **Przepływ 14:** W-06 karta „Lokalizacja” → „Edytuj” → W-20 → zapis albo `412`; „Dodaj stronę” jako widok w tym samym dialogu; „Edytuj stronę” z `⋮` przy OSD i zarządcy; wejście z banera zlecenia z telefonu — od E13 (M2). **Makieta W-20 „Edytuj lokalizację”:** pola sekcji „2. Lokalizacja” z W-05 wypełnione bieżącymi danymi; InlineAlert „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).” (licznik wg SR-AUTHZ-03). **Dialog „Edytuj stronę”:** pola „Dodaj stronę”, informacja o stronie wspólnej. Do tego tabele stanów i ról. Opis W-20 z `03` przenoszę tutaj — w `03` zostaje skrót z linkiem | AC2 |
| `docs/ux/flows/15-prywatnosc-i-pomoc.md` — **nowy** | **Przepływ 15** — wejścia: z menu konta (po zalogowaniu) i ze stopki W-01 „Prywatność · Pomoc” (przed zalogowaniem; kotwice `#pomoc`, `#prywatnosc`). **Makieta W-19** — strona treści w dwóch układach: w panelu oraz przed zalogowaniem (bez Sidebar i TopBar, z „Wróć do logowania”, bez danych użytkownika). Sekcje: **„Pomoc”** w stałym miejscu — kontakt do administratora z konfiguracji (adres funkcyjny, bez danych osoby), odnośnik „Instrukcja dla biura” od EVM-066; **„Prywatność”** — dane administratora danych (decyzja 9) i klauzule jako Disclosure (klienci — do przekazania, osoby kontaktowe stron, pracownicy), każda z wersją i datą oraz miejscem na treść od `security-engineer` (EVM-063). Strona „Instrukcja dla biura” (EVM-066) ma ten sam układ, ze spisem treści. Do tego tabele stanów i ról | AC6 |
| `docs/ux/flows/03-szczegoly-zlecenia.md` | **W-06** — makiety (a)–(d), każda z tabelą stanów i ról; do tego diagram przepływu, tabela ról ekranu i skrót karty „Lokalizacja” z linkiem do `14`.<br>(a) **dialog „Edytuj dane zlecenia”**: tytuł, opis, opiekun, planowana data; `If-Match`; fokus po otwarciu, po „Anuluj” i po sukcesie.<br>(b) **zlecenie „Rozliczone” / „Anulowane”** (decyzja 17): Banner w dwóch wariantach — dane zlecenia, zakres, procesy i płatności są tylko do odczytu; wpisy, media i dokumenty dalej dostępne; akcje wyłączone z podpowiedzią.<br>(c) **„Edytuj zakres”** — tryb edycji sekcji „Zakres”: „Dodaj pozycję…” (katalog wg kategorii, parametry wg zestawu, propozycja procesów wnoszonych przez pozycję bez duplikatów po kodzie, „Inna usługa” z opisem); „Edytuj parametry…”; „Usuń pozycję…” (procesy zostają, informacja, gdzie je usunąć — warianty „przed EVM-042” i „od EVM-042”); limit 50 pozycji (`422 limit_exceeded`). Przykład — wariant A z EVM-002: „Dom — sam montaż” + „Instalacja zasilająca” wnosi proces „Instalacja zasilająca”; przykład duplikatu: „Dom — pełny pakiet” + „Uzgodnienia z OSD” — proces „Uzgodnienia z OSD” już jest, więc panel go nie proponuje.<br>(d) **procesy i etapy** (EVM-042, wariant „od EVM-042”): „Dodaj proces…”, „Dodaj etap…”, „Usuń proces…”, „Usuń etap…” z zaleceniem „Nie dotyczy”; przywrócenie (A) w „Usunięte procesy i etapy (n)”; limity 30 (`422`); `409` — proces o kodzie już aktywnym | AC3, AC4 |
| `docs/ux/flows/08-nieoplacone.md` | (a) **dialogi „Dodaj transzę”** (nazwa, kwota opcjonalnie; nowa transza na końcu listy; 21. — `422 limit_exceeded`) **i „Zmień kwotę”** (transza „Planowana”; udział z planu tylko informacyjnie; kwota > 0, najwyżej 2 miejsca po przecinku) — obok wspólnej tabeli akcji płatności W-06 i W-11 (link z `03`); tabela stanów i ról, `412`, zlecenie zamknięte.<br>(b) **W-11 — chip „Do wystawienia”** (EVM-059, wariant „od EVM-059”): transze „Planowana” w zleceniach niezamkniętych; kolumny: zlecenie, klient, transza z udziałem, kwota albo „—”; sortowanie wg zlecenia; „Wystaw fakturę…” (A, E) — dialog z EVM-054, nazwa dostępna z obiektem; pusty stan „Wszystkie transze mają wystawione faktury.”; w URL tylko identyfikator filtra; nagłówek strony zależny od widoku | AC4, AC7 |
| `docs/ux/flows/07-lista-zlecen-i-filtry.md` | **W-10:** w kolumnie „Klient” druga linia z lokalizacją („ul. Testowa 7, Warszawa” — PO-6), a na `breakpoint.wide` osobna kolumna „Lokalizacja” (EVM-072 AC1); „Więcej filtrów” — panel z „Typ obiektu” i „Szablon” (pamięć karty), chipy aktywnych filtrów, liczba aktywnych filtrów na przycisku; nazwa dostępna wiersza z klientem i lokalizacją; karta na compact; offline — wyszukiwanie wyłączone z podpowiedzią „Wyszukasz po powrocie połączenia.” | AC7 |
| `docs/ux/flows/06-galeria-i-upload.md` | **Nowa sekcja „W-09 w przeglądarce telefonu (`breakpoint.compact`)”** z tabelami 5 stanów i ról; mikrocopy w formach bezosobowych.<br>**Diagram:** galeria → wybór plików → dialog pełnoekranowy → ostrzeżenie o dużym filmie → wysyłanie → sprawdzanie → „Wysłano”; blokada ekranu → wznowienie; karta wyładowana → „Nie wysłano …” ze stanu serwera.<br>**Szkielet i zachowanie:**<br>– źródło wg decyzji 18: „Wybierz z galerii” (bez `capture`) i wskazówka „rób zdjęcia aparatem telefonu”;<br>– status przy każdym pliku: W kolejce, Wysyłanie n%, Sprawdzanie pliku, Wysłano, Nie wysłano — z powodem i „Ponów”, Wymaga uwagi;<br>– cele dotyku ≥ `size.touch-target.min`, akcja główna `size.touch-target.field`;<br>– „Wysłano 12 zdjęć — możesz je usunąć z telefonu.” — dopiero po potwierdzeniu serwera;<br>– ostrzeżenie o filmie powyżej 100 MB z „Wyślij teraz” / „Anuluj”;<br>– „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” z nazwami plików i przyciskiem „Wybierz ponownie z galerii”;<br>– stany offline, `429` i `401` | AC5 |
| `docs/ux/flows/01-logowanie-mfa.md` | **W-01** — stopka „Prywatność · Pomoc” prowadzi do W-19 (kotwice), przed zalogowaniem bez danych użytkownika. **W-04** — tabela „Tytuły operacji M1 (EVM-071)”: „…, aby zanonimizować klienta” (W-14) | AC1, AC6 |
| `docs/ux/flows/README.md` | **Mapa nawigacji:** W-14, W-19 i W-20 bez „bez makiety”; krawędzie W-01 → W-19 (stopka), W-14 ↔ W-06, W-14 → W-04 (anonimizacja); W-09 — także w przeglądarce telefonu. **„Ekrany”:** linki do makiet, przepływy 13–15, W-09 compact, W-19 — także strona „Instrukcja dla biura” (układ W-19). **Macierz ekran × rola:** W-14 (A — usunięcie, przywrócenie, anonimizacja ↑; E — usunięcie i anonimizacja wyłączone z podpowiedzią; R — podgląd), W-19 (wszystkie role i niezalogowany), W-06 (zlecenie zamknięte), W-09 (wysyłanie z telefonu — A, E), W-11 („Do wystawienia”). **„Jak czytać” i spis treści:** przepływy 13–15. **Zasady wspólne:** konflikt `412` w dialogach edycji (forma bezosobowa, pola z „Aktualnie: …”); panel w przeglądarce prywatnego telefonu (decyzje 18 i 19, SR-WEB-05). **„Zgodność z politykami”:** P3, P6, P7, P10. **Nowa sekcja „Pokrycie EVM-071”** (AC → plik → ekran). **Nota przy „Propozycje do styleguide'u”** — rozstrzygnięcie 14 | AC8 |
| `docs/ux/flows/scenariusze-a-d.md`, `docs/ux/flows/10-mobile-szybkie-zlecenie.md` | linki do W-14 i W-20; luki L7 i L8 — „makieta EVM-071” z linkami | AC8 |
| `docs/product/domain.md` — **`product-owner`** (contributor) | „Pojęcia z makiet M1 (EVM-071)” w brzmieniu z makiet, m.in.: klient zanonimizowany, usunięty klient (filtr „Usunięci”, przywrócenie), klauzula informacyjna, instrukcja dla biura, „Nie wysłano” (pliki z przeglądarki w telefonie) — bez nowych encji | AC8 (słownictwo UI) |
| `docs/ux/README.md`, `docs/README.md` | artefakty: makiety M1 (EVM-071) | — |
| `CHANGELOG.md` | „Unreleased → Dodano”: makiety ekranów M1 — klienci (W-14), edycja lokalizacji i strony (W-20), prywatność i pomoc (W-19) oraz rozszerzenia W-06, W-09 (przeglądarka w telefonie), W-10, W-11 [EVM-071] | DoD |
| ten plik | plan, „Dziennik”, potem „Uwagi do rozważenia” i DoD | — |

**Bez zmian:** `docs/ux/styleguide.md` i `design/tokens/` (rozstrzygnięcie 14); ADR-y, `domain-model.md`, `api-guidelines.md`, `media-pipeline.md`, `docs/security/*`, `design/prototypes/`; historyjki korzystające — rozbieżności brzmienia AC i wejścia do ich planów trafią do „Uwag do rozważenia” (lista niżej).

**Rozstrzygnięcia projektowe** (kompetencja `ux-designer`; do wglądu w przeglądach i na demo)
1. **Pliki.** Nowe ekrany dostają nowe pliki od 13: 13 — W-14, 14 — W-20, 15 — W-19. Rozszerzenia W-06, W-09, W-10 i W-11 trafiają do ich plików (`03`, `06`, `07`, `08`). Dialogi „Dodaj transzę” i „Zmień kwotę” umieszczam w `08`, obok wspólnej tabeli akcji płatności W-06 / W-11 — w `03` jest link.
2. **Wyzwalacz `⋮` — trzy stany:**
   - **ukryty** — rola nie ma żadnej dozwolonej pozycji (§ 3.20, § 4.13);
   - **wyłączony z podpowiedzią** — pozycje dozwolone dla roli blokuje stan (zlecenie zamknięte, offline — § 3.1, § 4.10);
   - **aktywny** — w pozostałych przypadkach; w menu pozycje Administratora są u Edytora wyłączone z podpowiedzią.
   
   Przykład: nagłówek W-06 zlecenia rozliczonego. Do EVM-060 menu ma tylko „Edytuj dane zlecenia”, więc wyzwalacz jest wyłączony z podpowiedzią „Zlecenie jest rozliczone — dane zmienisz po przywróceniu zlecenia przez administratora.” Przyczynę wyjaśnia też Banner.
3. **Konflikt `412` w dialogach edycji** (W-06, W-14, W-20, transze):
   - alert w formie bezosobowej (§ 6.1), jak W-16: „[Dane klienta / Lokalizację / To zlecenie / Tę transzę] zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.”;
   - wpisane dane zostają w dialogu;
   - pola zmienione w międzyczasie mają pod sobą tekst „Aktualnie: …” — to realizacja „Porównaj” z § 6.4;
   - zapis ponownie, z nowym `ETag`.
   
   Brzmienie AC cytujących „Ktoś zmienił…” — do „Uwag do rozważenia”.
4. **W-14.**
   - **Akcje.** Wszystkie akcje są w `⋮` nagłówka szczegółów („Akcje klienta: Jan Przykładowy”): „Edytuj dane klienta…”, a w grupie niszczącej „Usuń klienta” i „Anonimizuj klienta…”. Dzięki temu Edytor widzi akcje Administratora wyłączone z podpowiedzią (EVM-041 AC7), a menu nie łamie § 3.20, bo ma dozwoloną pozycję „Edytuj”. Wiersze listy nie mają `⋮` — cały wiersz to link do szczegółów, a w widoku nie ma powtórzonych przycisków o tej samej nazwie.
   - **„Usuń klienta”** działa od razu i pokazuje toast „Usunięto klienta. Widzi go tylko administrator. [Cofnij]”. Tę samą operację odwraca ta sama rola, więc obowiązuje § 4.11 (zamiast AlertDialog z sekcji „UX / UI” EVM-041). Klient usunięty ma Banner „Klient jest usunięty — widzi go tylko administrator.” z „Przywróć klienta”.
   - **„Anonimizuj klienta…”** otwiera AlertDialog danger z podsumowaniem:
     - co zostanie zastąpione — pola z EVM-041 AC4;
     - co się nie zmieni — zlecenia, lokalizacje, wpisy, media i dokumenty; dane osobowe w nich usuwa się procedurą ręczną (EVM-041 → „Poza zakresem”);
     - pole wyboru „Rozumiem, że tej operacji nie można cofnąć.” — bez przepisywania nazwy (WCAG 3.3.8).
     
     Po potwierdzeniu: W-04 „Potwierdź tożsamość, aby zanonimizować klienta”.
   - **Niezamknięte zlecenia.** Gdy „Historia zleceń” ma zlecenia niezamknięte, „Usuń klienta” i „Anonimizuj klienta…” są wyłączone z podpowiedzią „Klient ma niezamknięte zlecenia (1). Usuniesz go, gdy wszystkie będą rozliczone albo anulowane.” Serwer i tak egzekwuje regułę: wyścig kończy się alertem `409` w dialogu.
   - **Prywatność.** Tytuł karty: „Klienci · EVia Manager” i „Klient · EVia Manager”, bez nazwiska. URL zawiera tylko ID. Fraza wyszukiwania i filtr „Usunięci” są w pamięci karty.
5. **W-20.**
   - InlineAlert z licznikiem jest zawsze widoczny, także przy n = 1 — tak jak w kroku A1″ i AC2.
   - „Dodaj stronę” to widok zastępczy w tym samym dialogu („Edytuj lokalizację › Dodaj stronę”): fokus na pierwszym polu, „Wróć” przywraca formularz lokalizacji z danymi, jedna akcja primary na widok. Nowa strona zapisuje się osobnym żądaniem (UUIDv7 + `Idempotency-Key` — README M1) i zostaje wybrana w comboboxie.
   - W „Edytuj stronę” rodzaj strony jest tylko do odczytu, bo pola `…PartyId` walidują rodzaj (EVM-036 AC2).
6. **„Edytuj zakres” to tryb edycji sekcji, a nie duży dialog.** „Dodaj pozycję…” i „Edytuj parametry…” są dialogami, a dialog na dialogu jest niedozwolony (§ 3.13). Każda operacja zapisuje się od razu (`If-Match`, toast). „Zakończ edycję” wraca do widoku; fokus wraca na „Edytuj zakres”. Pole opisu „Innej usługi” i notatki pozycji mają ostrzeżenie „Nie wpisuj PESEL…”. Parametry mają podpowiedź „Parametry to dane techniczne — nie wpisuj PPE, numerów liczników ani nazwisk.” (EVM-035 AC4).
7. **Usunięcie procesu albo etapu.**
   - Dialog dla obu ról z zaleceniem „Nie dotyczy”. Przyciski: „Oznacz jako „Nie dotyczy”” (secondary — przejście etapu z „Cofnij”), „Usuń etap” (danger) i „Anuluj”; fokus na „Anuluj”.
   - Po usunięciu: Administrator dostaje toast z „Cofnij”; u Edytora toast jest bez „Cofnij”, a dialog mówi „Przywrócić może tylko administrator.”
   - Przywracanie (tylko A) jest w Disclosure „Usunięte procesy i etapy (n)”.
   - `⋮` procesu stoi obok nagłówka Disclosure, nie w nim — bez zagnieżdżonych kontrolek.
8. **UI pokazuje tylko to, co system robi** (README M1). Funkcje późniejszych historyjek mają w makietach warianty „przed / od EVM-0xx”: EVM-042 (procesy i etapy), EVM-053 (transze — historyjka jeszcze w `draft`), EVM-059 („Do wystawienia”), EVM-060 („Usuń zlecenie”), EVM-066 (instrukcja), E13 (baner zlecenia z telefonu).
9. **W-09 w przeglądarce telefonu.**
   - **Źródło: galeria** — decyzja 18 i EVM-044 AC4 („Dodaj zdjęcia” → „Wybierz z galerii”). Zapis „„Wybierz z galerii” / „Zrób zdjęcie” wg decyzji 18” w AC5 czytam jako etykietę zależną od wariantu decyzji. Wariant „aparat z przeglądarki” odrzucono, więc panel nie oferuje „Zrób zdjęcie” i nie używa `capture`. Systemowy wybór plików może sam zaproponować aparat — o tym mówi instrukcja EVM-066 („rób zdjęcia aparatem telefonu”).
   - **„Wysłano” to potwierdzenie serwera**, a nie koniec przesyłania — dokładne stany wg ustalenia A3 (niżej): `clean`, `processing`, `ready`, `failed: processing_error` (po `clean`) i film ponad 2 GB po poprawnej walidacji ffprobe; `uploaded` i `scanning` — „Sprawdzanie pliku — nie usuwaj go jeszcze z telefonu.”; `checksum_mismatch` — „Nie wysłano” z „Ponów”; `quarantined` — „Wymaga uwagi — nie usuwaj tego pliku z telefonu.” Dopiero wtedy panel pokazuje „…możesz je usunąć z telefonu.” — inaczej technik usunąłby oryginał przed wykryciem `checksum_mismatch`. Gdy skan trwa długo: „Sprawdzanie plików trwa dłużej niż zwykle — nie usuwaj ich jeszcze z telefonu.”
   - **Ostrzeżenie o filmie** powyżej 100 MB (propozycja z EVM-046 AC8) zależy od rozmiaru, nie od wykrytej sieci. Jest w tym samym dialogu pełnoekranowym (§ 3.13 — wariant pełnoekranowy na compact), bez dialogu na dialogu.
   - **„Nie wysłano n zdjęć…”** to Banner na poziomie zlecenia (nad zakładkami W-06), bo AC4 EVM-044 mówi o otwarciu zlecenia. Stan pochodzi z serwera (niedokończone sesje uploadu użytkownika — SR-WEB-05). Przycisk „Wybierz ponownie z galerii” ma inną nazwę niż przycisk główny.
   - **Po sukcesie** InlineAlert z „Potem opróżnij kosz galerii.” i przyciskiem tertiary „Wyloguj teraz” (EVM-066 AC2 — do potwierdzenia, S5).
   - Formy liczebników według § 6.3.
10. **W-10.** Druga linia w kolumnie „Klient” w kolejności z § 6.3 („ul. Testowa 7, Warszawa”, bez kodu pocztowego). „Opiekun” zostaje w pasku filtrów, a „Więcej filtrów” obejmuje typ obiektu i szablon. Tabela filtrów w `07` dostaje to doprecyzowanie.
11. **W-11.** Nagłówek strony zależy od widoku: „Płatności — nieopłacone” albo „Płatności — do wystawienia”, bo „Planowana” nie jest nieopłacona (§ 6.2). Kafle sum zostają bez zmian. W widoku „Do wystawienia” filtr „Termin” jest ukryty, a filtr klienta — po identyfikatorze, w pamięci karty.
12. **W-19.**
    - „Pomoc” stoi pierwsza i w tym samym miejscu na stronie i w stronie „Instrukcja dla biura”. Wejścia w stałych miejscach: menu konta i stopka W-01 (WCAG 3.2.6).
    - Kontakt do administratora jest adresem funkcyjnym z konfiguracji (w makiecie `pomoc@firma.test`), nie danymi osoby (EVM-063 AC4).
    - Tytuły kart: „Prywatność i pomoc · EVia Manager”, „Instrukcja dla biura · EVia Manager”.
13. **Lista nazw dostępnych i fokusu** — dla każdego dialogu: fokus po otwarciu, po „Anuluj” i po sukcesie. Przyciski powtarzane w wierszach mają nazwę zaczynającą się od widocznej etykiety, z obiektem („Wystaw fakturę: Zaliczka (20%), ZL-2026-0042”, „Ponów: IMG_0414.jpg”) — WCAG 2.4.6, 2.5.3.
14. **Bez zmian w styleguide'zie.**
    - W-09 compact to Uploader web (§ 3.12) na `breakpoint.compact`. Zakaz „Z galerii” z § 3.12 i P3 pkt 1 dotyczy aplikacji mobilnej (ADR-0007) — notę dopisuję w „Zgodności z politykami” (P3).
    - Kolumna „Ekrany” w § 8 zostaje bez zmian, jak w EVM-015. Użycie komponentów pokazują listy „Komponenty i tokeny” ekranów.
    - Ikony tylko ze słownika § 2.10 (m.in. `images`, `cloud-upload`, `rotate-ccw`, `trash-2`, `pencil`, `plus`).
15. **Lokalizacja i strona w zleceniu zamkniętym.** Edycja lokalizacji i strony działa także w zleceniu „Rozliczone” / „Anulowane”: decyzja 17 obejmuje dane zlecenia, zakres, procesy i płatności, a `Site` i `Party` to osobne encje używane też przez inne zlecenia.
16. **Lista W-14 pokazuje `sortName`** („Przykładowy Jan”), więc widoczna kolejność odpowiada sortowaniu wg nazwiska; szczegóły i pozostałe ekrany — `displayName`. Przykład kolacji: nazwiska „Licznikowy” i „Ładowarkowa” (syntetyczne).
17. **Usunięcie pozycji zakresu** — AlertDialog dla A i E, toast bez „Cofnij”, bez listy przywracania pozycji w M1 (żadne AC M1 nie przewiduje przywracania pozycji; pozycję można dodać ponownie). Przywracanie procesów i etapów — tylko A (EVM-042).
18. **W-09 compact:** akcja główna „Dodaj zdjęcia lub filmy” (obejmuje film z EVM-046 AC8); próg ostrzeżenia o filmie — 100 MB (propozycja z EVM-046 AC8 przyjęta); ostrzeżenie to krok w tym samym dialogu pełnoekranowym.
19. **„Zmień kwotę…”** (transza „Planowana”) ma wielokropek jak każda pozycja otwierająca dialog (§ 3.20). Korekta kwoty transzy „Wystawiona” / „Opłacona” zostaje pod tą samą etykietą, ale prowadzi do dialogu z podsumowaniem i W-04 — rozróżnia je status transzy (ustalenie B4).
20. **Zasady wspólne 16–20** w `flows/README.md` zbierają reguły używane w kilku plikach: konflikt `412`, zamknięcie dialogu z niezapisanymi zmianami, klient usunięty w widokach zleceń (A1), panel w przeglądarce prywatnego telefonu, trzy stany wyzwalacza `⋮`.

**Do potwierdzenia przez `security-engineer`** (konsultacja planu — makiety opisują wariant rekomendowany)
- **S1 — W-19:**
  - kontakt do administratora jako adres funkcyjny z konfiguracji, widoczny także przed zalogowaniem;
  - treść z własnego originu, bez danych użytkownika (SR-WEB-07, SR-PRIV-05).
- **S2 — W-14:**
  - tytuły kart i URL bez danych osobowych;
  - fraza i filtr „Usunięci” w pamięci karty;
  - „Historia zleceń” i licznik tą samą polityką co lista zleceń (SR-AUTHZ-03);
  - klient usunięty: `404` dla E i R, bez danych z pamięci listy.
- **S3 — anonimizacja:**
  - dialog nieodwracalny z podsumowaniem i W-04;
  - informacja o danych poza zakresem (procedura ręczna);
  - wyłączenie akcji przy niezamkniętych zleceniach to tylko odzwierciedlenie `409`;
  - rekomendacja dla planu EVM-041: serwer odrzuca edycję klienta zanonimizowanego.
- **S4 — W-20:**
  - licznik (n) wg SR-AUTHZ-03;
  - „Aktualnie: …” po `412` pokazuje wartości, które użytkownik i tak widzi;
  - rodzaj strony tylko do odczytu;
  - ostrzeżenia przy notatkach (SR-DATA-02).
- **S5 — W-09 compact:**
  - „Wysłano” dopiero po `clean`;
  - „Nie wysłano” ze stanu serwera (SR-WEB-05);
  - `originalFilename` widzi tylko twórca sesji;
  - galeria bez `capture`;
  - przypomnienia z EVM-066 AC2 (lokalizacja w aparacie, kosz galerii, „Wyloguj teraz”);
  - dodatkowe zdanie w dialogu „Pobierz oryginał” na compact: „Na telefonie nie pobieraj oryginałów — plik trafi do „Pobrane” i może trafić do kopii w chmurze.” (decyzja 19).
- **S6 — W-06:**
  - zlecenie zamknięte tylko odzwierciedla `409 work_order_closed`;
  - parametry zakresu bez danych osobowych (EVM-035 AC4);
  - usunięcie procesu i etapu: A przywraca, E nie.
- **S7 — W-11 „Do wystawienia”:**
  - w URL tylko identyfikator filtra;
  - klient — filtr po identyfikatorze, w pamięci karty;
  - lista i sumy tą samą polityką (SR-AUTHZ-03).

**Ustalenia z konsultacji**

*security-engineer — konsultacja planu (S1–S7), 2026-10-05.* Werdykt: CHANGES — plan przyjęty, uzupełnienia A1–A6 wpisane do makiet; żadne nie wymaga decyzji Konrada. Decyzje 17, 18 i 19 w README M1 są jednoznaczne. `docs/security/*` bez zmian w tej historyjce.

*A. Wymagane uzupełnienia (major) — wdrożone w makietach*
| # | Ustalenie | Gdzie w makietach |
|---|---|---|
| A1 | Klient usunięty widoczny przez zlecenia (Medium, P2×W2; SR-AUTHZ-02, -03, ADR-0017 W5 / W6, ASVS V8.2.2, CWE-200): dla E i R stan „Klient usunięty” bez danych, linku i trafień w wyszukiwaniu zleceń; A — dane ze znacznikiem „Usunięty” i link | `flows/README.md` → zasada wspólna 18; `13` (zasady przepływu 3); `07` (W-10 — kolumna „Klient”, wyszukiwanie); `08` (W-11) |
| A2 | Anonimizacja klienta usuniętego bez przywracania; po anonimizacji „Edytuj dane klienta…” wyłączone z podpowiedzią dla A i E, serwer — `409` (kod z planu EVM-041; SR-DATA-08, SR-SESS-08, SR-PRIV-04, ASVS V14.2.7) | `13` — menu akcji klienta (tabela stanów), anonimizacja |
| A3 | „Wysłano … — możesz je usunąć z telefonu.” dopiero po zgodnym SHA-256 i skanie: `clean`, `processing`, `ready`, `failed: processing_error` (po `clean`), film ponad 2 GB po ffprobe; `uploaded` / `scanning` — „Sprawdzanie pliku — nie usuwaj go jeszcze z telefonu.”; `checksum_mismatch` — „Nie wysłano” z „Ponów”; `quarantined` — „Wymaga uwagi — nie usuwaj tego pliku z telefonu. Administrator został powiadomiony.” (SR-FILE-05, SR-CRYPTO-05, ASVS V5.4.3) | `06` — tabela „Status pliku w panelu wysyłania”; rozstrzygnięcie 9 |
| A4 | Ostrzeżenie „Na telefonie nie pobieraj…” przy każdym pobraniu oryginału i dokumentu na `breakpoint.compact` — dokumenty zlecenia, lokalizacji i klienta w W-09 oraz „Dokumenty klienta” w W-14 (decyzja 19, EVM-066 AC2) | `06` — zasada 10; `13` — „Dokumenty klienta”; `flows/README.md` → zasada 19 |
| A5 | W-19: klauzula „Pracownicy i praca na prywatnym telefonie (BYOD)” (rodo.md → „Obowiązek informacyjny”, SR-PRIV-05) | `15` — sekcja „Prywatność” |
| A6 | W-19 „Pomoc”: „Zgubiony telefon lub laptop albo podejrzenie, że ktoś zna hasło — zgłoś to od razu administratorowi” z kontaktem, także przed zalogowaniem (P7 pkt 5, SR-PRIV-10, AB-03, AB-04) | `15` — sekcja „Pomoc” |

*B. Drobne uwagi (minor) — wdrożone*
- **B1** — „Edytuj dane zlecenia”: podpowiedź z zasady 8 przy opisie; przy tytule „Bez nazwisk i adresów — klienta i lokalizację wskazujesz osobno.” (`03` (a)).
- **B2** — „Inna usługa”: opis w typowanej kolumnie `ScopeItem.notes`, nie w JSONB; parametry jako kontrolki typowane (`03` (c)). Wyjątek `charger_spec` („Producent”, „Model” — pola tekstowe w katalogu) — do planu EVM-035 („Uwagi do rozważenia”).
- **B3** — dialog anonimizacji pokazuje nazwy pól, nie wartości; „co się nie zmieni” wymienia „Dokumenty klienta (n)” i lokalizacje (`13`).
- **B4** — „Zmień kwotę” (dialog edycji) tylko dla transzy „Planowana”; przy „Wystawiona” i „Opłacona” — korekta A ↑ (SR-AUTHZ-10, ASVS V2.3.1) (`08`, rozstrzygnięcie 19).
- **B5** — W-14: `429` dla wyszukiwania (60 / min) i masowego odczytu; `404` jako jeden stan bez danych z pamięci listy (CWE-204); parametr filtra „Usunięci” od E albo R serwer odrzuca (`13`).
- **B6** — W-20 i „Edytuj stronę”: tylko licznik, bez listy innych klientów i lokalizacji (SR-AUTHZ-08); „Aktualnie: …” jako zwykły tekst (SR-WEB-03) (`14`).
- **B7** — W-09 compact: bez plików, uchwytów i postępu w IndexedDB, OPFS, Cache Storage, Service Worker i Background Fetch; „Nie wysłano” tylko ze stanu serwera (SR-WEB-05, ASVS V14.3.3); podglądy `blob:` tylko w pamięci karty z `revokeObjectURL`; `accept` zawężone do typów z SR-FILE-01, typ weryfikuje serwer (SR-FILE-03) (`06` — zasady 1 i 7).
- **B8** — `401` w trakcie wysyłania: wznowienie tylko po zalogowaniu tej samej osoby w tej samej karcie; inna osoba — pliki z pamięci karty odrzucone; Banner „Nie wysłano” widzi tylko twórca sesji uploadu (EVM-044 AC6) (`06` — zasada 8).
- **B9** — W-19: treść statyczna z repozytorium, renderowana komponentami, bez HTML i Markdown z bazy (SR-WEB-03, SR-INPUT-05); kontakt przed zalogowaniem z minimalnej publicznej konfiguracji (tylko adres funkcyjny jako `mailto:`); bez API wymagającego sesji (`15`).
- **B10** — nazwy dostępne z klientem, lokalizacją albo nazwą pliku trafiają do breadcrumbs Sentry — scrubbing w EVM-008 (SR-PRIV-09), bez zmiany makiet.

*C. S1–S7* — warianty rekomendowane przyjęte (S3 z A2; S5 z A3, A4, B7, B8; galeria bez `capture` zgodna z decyzją 18; `originalFilename` widzi tylko twórca sesji; S6 zgodne z macierzą w `domain-model.md`). „Usuń klienta” bez dialogu, z „Cofnij” (§ 4.11) — dopuszczalne: soft delete cofa ta sama rola, oba zdarzenia w audycie (SR-LOG-03).

*D. Obowiązkowe kontrole w historyjkach, które zrealizują makiety* — wspólne: testy macierzy ról (A / E / R / niezalogowany × kanał web / mobile) i przypadek IDOR (SR-AUTHZ-05, ASVS V8.1.1, V8.2.1, V8.2.2).
- **EVM-039:** lista, `POST /api/v1/customers/search`, szczegóły, „Historia zleceń” z licznikiem tą samą polityką (test SR-AUTHZ-03), `PATCH` z `If-Match`; klient usunięty → `404` dla E i R; wyłącznie kanał `web`.
- **EVM-041:** usunięcie i przywrócenie (A), anonimizacja (A ↑, `stepUp: true`, tylko `web`), filtr „Usunięci” (A), `409 has_active_dependents`; wpis do rejestru usunięć przed zmianą (SR-PRIV-04), audyt bez wartości; maskowanie danych usuniętego klienta w odpowiedziach zleceń dla E i R (A1).
- **EVM-036:** `PATCH` lokalizacji i strony; `POST` strony z UUIDv7 i `Idempotency-Key`, tylko wstawianie (SR-API-05); rodzaj strony walidowany na serwerze (SR-INPUT-02); test IDOR przez `siteId` (SR-AUTHZ-08).
- **EVM-035, EVM-042, EVM-053:** `409 work_order_closed` dla danych zlecenia, zakresu, procesów i transz (decyzja 17); limity 50 / 30 / 20 → `422`; `read_only_field` (SR-AUTHZ-04); przywrócenie procesu i etapu tylko przez A; żadna ścieżka nie omija korekty płatności A ↑ (SR-AUTHZ-10).
- **EVM-044, EVM-046:** nowy odczyt niedokończonych sesji uploadu — filtr `created_by` = użytkownik sesji w samym zapytaniu (SR-AUTHZ-03), tylko kanał `web`; odpowiedź tylko z `mediaAssetId`, `originalFilename` i rozmiarem; IDOR: cudza sesja albo inne zlecenie → `404`.
- **EVM-059:** lista „Do wystawienia” i sumy liczone jedną polityką; filtry z listy dozwolonych (SR-INPUT-03).
- **EVM-063, EVM-066:** trasy publiczne bez sesji, CSP zgodny z P11, bez zasobów z zewnątrz (SR-WEB-07); instrukcja bez procedur Administratora (EVM-066 AC6).

*E. Ryzyka rezydualne* — panel w przeglądarce prywatnego telefonu (kradzież odblokowanego telefonu z sesją Edytora, kopie zdjęć w galerii i chmurze, pliki w „Pobrane”) to nowe RR w EVM-065 AC4 do decyzji Konrada. Makiety dostarczają kontrole kompensujące: A3–A6, „Wyloguj teraz” i przypomnienia z EVM-066 AC2.

**Wejścia do innych planów i rozbieżności AC** (po implementacji trafią do „Uwag do rozważenia”)
- **Brzmienie `412`:** EVM-030 AC, EVM-035 AC1, EVM-053 AC8, EVM-054 AC, EVM-058 AC6 cytują „Ktoś zmienił …” — rekomendacja: „(komunikat z makiety)”, jak EVM-027 AC8. Styleguide § 4.9 i § 6.4 — forma bezosobowa przy najbliższej wersji (EVM-015 → „Uwagi do rozważenia” 4).
- **EVM-044:**
  - punkt odczytu niedokończonych sesji uploadu użytkownika w zleceniu;
  - stan „Wysłano” po `clean`;
  - ponowny wybór z galerii bez duplikatów — kontynuacja tego samego medium, dopasowanie po nazwie i rozmiarze z potwierdzeniem zadeklarowanym SHA-256;
  - skutek „Nie wysyłaj” dla medium bez pliku (Edytor nie usuwa mediów);
  - wznowienie po `401` i ponownym zalogowaniu.
- **EVM-041:** blokada edycji klienta zanonimizowanego; anonimizacja klienta usuniętego.
- **EVM-035:** czy opiekun może zostać pusty; pole na opis „Innej usługi” (`notes` czy parametr).
- **EVM-063:** źródło kontaktu do administratora (konfiguracja).

**Plan sprawdzenia AC** — inspekcja (QA); testów kodu nie ma.
| AC | Jak sprawdzić |
|---|---|
| AC1 | `13` — W-14 ma bloki formy EVM-004. Lista: `POST /api/v1/customers/search`, ≥ 3 znaki, fraza poza URL i tytułem karty; sortowanie wg nazwiska przed imieniem w kolacji `pl-PL` — przykład w makiecie ma nazwiska na „L” i „Ł” („Ł” po „L”); kursor bez licznika całkowitego. Szczegóły: dane, „Historia zleceń” (numer, tytuł, status, data), „Dokumenty klienta”. Dialog edycji ma pola „Dodaj klienta” z W-05. Usunięcie i przywrócenie — tylko A; anonimizacja — A, AlertDialog nieodwracalny i W-04 (tytuł w `01`). Tabela ról: R — podgląd bez akcji, E — akcje Administratora wyłączone z podpowiedzią |
| AC2 | `14` — W-20 ma wszystkie pola sekcji „2. Lokalizacja” z W-05 z bieżącymi danymi, InlineAlert „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).”, „Edytuj stronę” z informacją o stronie wspólnej i „Dodaj stronę” jako widok w tym samym dialogu (żaden dialog nie otwiera drugiego). `412` — dane zostają. Wejście z karty „Lokalizacja” i z banera (od E13) |
| AC3 | `03` — dialog „Edytuj dane zlecenia” z 4 polami. Stan „Rozliczone” / „Anulowane”: Banner; edycja danych, zakresu, procesów i płatności wyłączona z podpowiedzią; wpisy, media i dokumenty dostępne (W-08, W-09 bez blokady) |
| AC4 | `03` — tryb „Edytuj zakres” ma: dodanie pozycji z propozycją procesów bez duplikatów (przykład wariantu A), usunięcie pozycji z informacją, gdzie usunąć procesy (oba warianty), parametry wg zestawu i „Inną usługę” z opisem. Makiety dodania i usunięcia procesu i etapu oraz dialogi „Dodaj transzę” i „Zmień kwotę” (`08`) mają po tabeli stanów i ról. Dialog usunięcia etapu zaleca „Nie dotyczy” |
| AC5 | `06` → sekcja compact ma: „Wybierz z galerii” (decyzja 18), cele ≥ `size.touch-target.min`, status przy każdym pliku, teksty „Wysłano 12 zdjęć — możesz je usunąć z telefonu.” i „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” (po blokadzie ekranu — wznowienie, po wyładowaniu karty — stan z serwera), ostrzeżenie o filmie z progiem 100 MB, stany offline i `429`. Wyszukiwanie form z płcią w mikrocopy daje 0 trafień |
| AC6 | `15` — W-19 ma klauzule (3 rodzaje, wersja i data, miejsce na treść `security-engineer`), „Pomoc” z kontaktem i odnośnikiem „Instrukcja dla biura” (EVM-066, układ W-19) w stałym miejscu, wejście z menu konta i ze stopki W-01 (`01`) przed zalogowaniem |
| AC7 | `07` — W-10: lokalizacja pod nazwą klienta, kolumna „Lokalizacja” na `breakpoint.wide`, „Więcej filtrów” (typ obiektu, szablon). `08` — W-11: chip „Do wystawienia” i „Wystaw fakturę…” |
| AC8 | W nowych i zmienionych liniach wyszukiwanie `#[0-9a-fA-F]{3,8}\b`, liczb z `px` / `dp` / `rem` / `pt` i nazw fontów daje 0 trafień. Skrypt tokenów (kopia `.scratch/EVM-015/qa/tokens.mjs` w `.scratch/EVM-071/qa/` z plikami `13`–`15` i diffem `01`, `03`, `06`, `07`, `08`, `README.md`) zwraca `missing: []` dla tokenów i §. Linki i kotwice: `node .scratch/EVM-015/qa/links.mjs <pliki>`. W `flows/README.md` „bez makiety” zostaje tylko przy W-17 („— E9”) i M-11, a mapa, „Ekrany” i macierz są zgodne. Dane syntetyczne: osoby, `example.com` / `*.test`, PPE `TEST`, bez NIP i PESEL. Mermaid renderuje się lokalnie (`.scratch/EVM-015/render.mjs`). `npm run docs:check` — 0 błędów (orkiestrator) |

**Kolejność kroków**
1. Konsultacja `security-engineer` (S1–S7) — równolegle z krokami 2–8. Ustalenia trafiają do tego planu jako „Ustalenia z konsultacji”.
2. `ux-designer`: `13` (W-14) i `01` (tytuł W-04).
3. `ux-designer`: `14` (W-20) i karta „Lokalizacja” w `03`.
4. `ux-designer`: `03` — „Edytuj dane zlecenia”, zlecenie zamknięte, „Edytuj zakres”, procesy i etapy.
5. `ux-designer`: `08` — dialogi transz i „Do wystawienia”.
6. `ux-designer`: `07` — W-10.
7. `ux-designer`: `06` — W-09 compact.
8. `ux-designer`: `15` (W-19) i `01` (stopka W-01).
9. `ux-designer`: `flows/README.md`, `scenariusze-a-d.md`, `10`, `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`, „Dziennik”.
10. `product-owner`: `domain.md` — pojęcia w brzmieniu z makiet.
11. Samokontrola `ux-designer` — wyszukiwania z planu sprawdzenia; skrypt tokenów w `.scratch/EVM-071/qa/`.
12. Przekazanie — zmiany zostają w drzewie roboczym, bo `ux-designer` i `product-owner` nie mają powłoki:
    - `npm run docs:check`, `npm run test:tools` i render Mermaid uruchamia orkiestrator;
    - QA i recenzenci przeglądają `git diff main` i `git status --porcelain` (nowe pliki są nieśledzone);
    - commit robi agent z powłoką: tylko jawne ścieżki z „Zakresu zmian”, hook pre-commit bez `--no-verify`.

## Decyzje
Demo 2026-10-05 (Konrad):

1. **Przyrost — akceptacja z krótką poprawką przed PR:** ustalenia (a)–(i) z „Uwag do rozważenia” 17 poprawia `ux-designer`, potem celowane sprawdzenie przez `qa-engineer`, `web-developer` i `security-engineer` bez kolejnego demo; przy braku blocker / major — PR i „Squash and merge” przez Konrada.
2. **Zmiany brzmienia AC w innych historyjkach — teraz, w tym PR** (rekomendacje z „Uwag do rozważenia” 1, 2 (f), 4 i 10 (b) oraz 17 (b)): `412` jako „(komunikat z makiety)” w EVM-030, EVM-035, EVM-053, EVM-054, EVM-058; EVM-044 AC4 — etykieta z makiety; EVM-041 AC1 (dane klienta usuniętego osadzone w zleceniach), AC2 (komunikat z makiety), AC3 („Przywróć klienta”); EVM-063 AC2 (klauzula pracowników i pracy na prywatnym telefonie — BYOD). Nanosi `product-owner` z wpisami w „Dziennikach” tamtych historyjek; liczba AC bez zmian.

## Uwagi do rozważenia
Wejścia do planów historyjek korzystających z makiet i rozbieżności brzmienia AC (ux-designer, 2026-10-05). Żadna nie blokuje EVM-071; decyzje zapadają w planach tamtych historyjek albo przy `/refine`.

1. **Brzmienie `412` w AC** — EVM-030 AC, EVM-035 AC1, EVM-053 AC8, EVM-054 AC i EVM-058 AC6 cytują „Ktoś zmienił …”; makiety mają formę bezosobową („… zmieniono w międzyczasie…” — `flows/README.md` → zasada wspólna 16). Rekomendacja: w AC „(komunikat z makiety)”, jak EVM-027 AC8. Ten sam tekst zostaje w W-07 (`04`: „Ktoś zmienił ten etap…”) — do wyrównania przy najbliższej zmianie `04`; styleguide § 4.9 i § 6.4 — forma bezosobowa przy najbliższej wersji (EVM-015 → „Uwagi do rozważenia” 4).
2. **EVM-044** — (a) punkt odczytu niedokończonych sesji uploadu użytkownika w zleceniu (kontrole z części D ustaleń); (b) stany „Wysłano” wg A3; (c) ponowny wybór z galerii — kontynuacja tego samego medium po nazwie i rozmiarze z potwierdzeniem zadeklarowanego SHA-256; (d) puste pozycje po utracie plików — w M1 usuwa je Administrator (W-09), bez operacji „Nie wysyłaj” dla Edytora; (e) wznowienie po `401` tylko tej samej osoby w tej samej karcie; (f) akcja główna „Dodaj zdjęcia lub filmy” zamiast „Dodaj zdjęcia” z AC4 — rekomendacja: „(etykieta z makiety)”; (g) próg komunikatu „Sprawdzanie plików trwa dłużej niż zwykle…” — propozycja 2 min; (h) rekomendacja: na czas wysyłania prośba o niewygaszanie ekranu (Screen Wake Lock API, gdy przeglądarka je ma) — mniej wstrzymań po blokadzie ekranu, bez magazynów przeglądarki.
3. **EVM-046** — próg ostrzeżenia o filmie 100 MB przyjęty w makiecie; ostrzeżenie zależy od rozmiaru, nie od sieci.
4. **EVM-041** — (a) maskowanie danych klienta usuniętego w odpowiedziach zleceń dla E i R (A1) — AC1 mówi o liście i wyszukiwaniu klientów; rekomendacja: doprecyzować AC1 o dane osadzone w zleceniach (W-06, W-10, W-11); (b) blokada edycji klienta zanonimizowanego (`409`, kod w planie); (c) anonimizacja klienta usuniętego bez przywracania (A2); (d) odrzucanie parametru filtra „Usunięci” od E i R (B5); (e) „Usuń klienta” bez AlertDialog, z „Cofnij” (§ 4.11) — sekcja „UX / UI” EVM-041 wymienia AlertDialog (danger), który w makiecie dotyczy tylko anonimizacji; (f) AC3 „Przywróć” → etykieta „Przywróć klienta”; (g) liczba niezamkniętych zleceń klienta w odpowiedzi szczegółów — dla podpowiedzi przy wyłączonych akcjach.
5. **EVM-039** — `sortName` w kolumnie listy (rozstrzygnięcie 16); zmiana rodzaju klienta w edycji (pola poprzedniego rodzaju nie są zapisywane — skutek po stronie serwera); bez wczytywania klientów „na zapas” (P10); pusty stan dla roli Tylko odczyt „Nie ma jeszcze klientów.” (AC8 ma tekst tylko dla ról, które dodają klientów).
6. **EVM-035** — (a) czy opiekun może zostać pusty (makieta: wymagany; wariant „Bez opiekuna”); (b) „Inna usługa” — opis w `ScopeItem.notes` (B2 — rozstrzygnięte); (c) `charger_spec` ma w katalogu pola tekstowe „Producent” i „Model”, a B2 mówi o parametrach bez wolnego tekstu — rekomendacja: krótkie pole z limitem długości i podpowiedzią z zasady parametrów, słownik producentów w M4; (d) przywracanie pozycji zakresu — brak w AC M1 (rozstrzygnięcie 17); (e) ilość pozycji — bez pola w M1 (domyślnie 1).
7. **EVM-036** — edycja lokalizacji i strony także w zleceniu zamkniętym (rozstrzygnięcie 15); „Dodaj stronę” jako widok w dialogu W-20; licznik zawsze widoczny; rodzaj strony tylko do odczytu w „Edytuj stronę”.
8. **EVM-053** (`draft`) — dialogi „Dodaj transzę” i „Zmień kwotę…” gotowe na `/refine`; etykieta „Zmień kwotę…” z wielokropkiem (rozstrzygnięcie 19); AC8 — brzmienie `412` (pkt 1).
9. **EVM-059** — kafle sum bez zmian, bez sumy kwot planowanych (AC3 — „ewentualne sumy”).
10. **EVM-063** — (a) kontakt do administratora z minimalnej publicznej konfiguracji (B9) i tekst zastępczy, gdy adresu nie ma; (b) AC2 wymienia trzy klauzule — klauzula pracowników obejmuje BYOD (A5), rekomendacja: brzmienie „pracowników i pracy na prywatnym telefonie (BYOD)”; (c) zgłaszanie utraty sprzętu w „Pomoc” także przed zalogowaniem (A6). (d) blok „Problem z logowaniem?” w „Pomoc” przed zalogowaniem (makieta `15`, zasada 4) wykracza poza AC3 („do tego czasu sekcja pokazuje tylko kontakt”) — do potwierdzenia w planie EVM-063 (QA, „Uwagi do rozważenia” 17 (i)).
11. **EVM-066** — strona „Instrukcja dla biura” w układzie W-19 z tą samą sekcją „Pomoc” na początku (WCAG 3.2.6), dostępna także przed zalogowaniem.
12. **EVM-072 i EVM-034** — maskowanie klienta usuniętego na liście, w wyszukiwaniu i w nagłówku W-06 dla E i R (A1, zasada wspólna 18); druga linia z lokalizacją pod klientem.
13. **EVM-008** — scrubbing nazw dostępnych z danymi osobowymi w breadcrumbs Sentry (B10, SR-PRIV-09).
14. **EVM-065** — nowe RR „panel w przeglądarce prywatnego telefonu” (ustalenie E) z kontrolami kompensującymi z makiet (A3–A6, „Wyloguj teraz”, przypomnienia z EVM-066 AC2).
15. **Styleguide (najbliższa wersja)** — kolumna „Ekrany” w § 8 bez W-14, W-19, W-20 i rozszerzeń EVM-071 (jak przy E1); nota w § 3.12, że zakaz „Z galerii” dotyczy aplikacji mobilnej, a W-09 w przeglądarce telefonu wybiera pliki z galerii (decyzja 18).
16. **Słownik (`domain.md`)** — pojęcia z makiet M1 dopisuje `product-owner` (krok 10 planu): klient usunięty, klient zanonimizowany, filtr „Usunięci”, klauzula informacyjna, instrukcja dla biura, „Nie wysłano” (pliki z przeglądarki w telefonie), „Do wystawienia” (już jest), „Inna usługa”. **Zrealizowane 2026-10-05** — `domain.md` → „Pojęcia z makiet M1 (dodane w EVM-071)”, 12 pojęć; dodatkowo: historia zleceń klienta, lokalizacja i strona wspólna, usunięcie pozycji zakresu, procesu albo etapu (wobec „Nie dotyczy”), kontakt z administratorem, panel w przeglądarce telefonu, „Wysłano”. Wiersz „Zlecenie zamknięte — tylko do odczytu” doprecyzowany o rozstrzygnięcie 15 (lokalizacja i strony edytowalne także w zleceniu zamkniętym).

17. **Ustalenia nieblokujące z weryfikacji (runda 2: `qa-engineer`) — do decyzji na demo:**
   - (a) W-06 (b) — podpowiedzi przy etapach i płatnościach dla Administratora brzmią jak dla Edytora („…po przywróceniu zlecenia przez administratora”, „Przywrócić zlecenie może…”) → rozdzielić wg roli; wyrównać `04` i `08` (minor).
   - (b) W-14 — wyłączona „Anonimizuj klienta…” przy niezamkniętych zleceniach ma podpowiedź usunięcia („Usuniesz go…”), a alert `409` anonimizacji nie mówi, co zrobić (§ 6.4) → „…Zanonimizujesz go, gdy wszystkie będą rozliczone albo anulowane.” w podpowiedzi i alercie; brzmienie EVM-041 AC2 → „(komunikat z makiety)” (minor).
   - (c) W-19 „Pomoc” — link `mailto:`: nazwa dostępna „Napisz do administratora: …” nie zawiera widocznej etykiety, jeśli linkiem jest cała linia (WCAG 2.5.3) → tekst linku = adres, nazwa zaczyna się od widocznego tekstu; analogicznie telefon w W-14 (minor).
   - (d) W-11 „Do wystawienia” — „Licznikowy Adam” (`sortName`) → „Adam Licznikowy” (`displayName`; `sortName` tylko w W-14) (nit).
   - (e) W-06 (d) — ten sam etap jednocześnie aktywny i na liście „Usunięte procesy i etapy” → inny etap albo osobny stan „po usunięciu” (nit).
   - (f) W-06 (a) — alert `409` tylko w wariancie „rozliczone” (brak „anulowane”); W-06 (b) → „Błąd” bez `429` (nit).
   - (g) W-14 — diagram „Usunięcie, przywrócenie i anonimizacja”: wejście z listy „Usunięci” prowadzi do węzła z toastem usunięcia → osobny węzeł „Szczegóły: Banner Klient jest usunięty” (nit).
   - (h) W-14 — AlertDialog anonimizacji: brak fokusu po „Anuluj” (→ wyzwalacz `⋮`) i po powrocie z W-04 (alert w dialogu) (nit).
   - (i) W-19 — blok „Problem z logowaniem?” przed zalogowaniem wykracza poza EVM-063 AC3 („tylko kontakt”) i zasadę 4 w `15` → dopisać do pkt 10 jako (d) i doprecyzować zasadę 4 (nit).

18. **Po naniesieniu zmian AC („Decyzje” 2) — pozostałe rozbieżności (`product-owner`, 2026-10-05), poza zakresem decyzji 2:**
   - (a) cytat „Ktoś zmienił…” przy `412` zostaje w EVM-055 (dialog wpłaty W-11 — makieta ma już formę bezosobową) i EVM-057 (korekty transz) — rekomendacja: ta sama zmiana jak w decyzji 2 przy najbliższej akceptacji zmian AC; EVM-032 (etap W-07) — po wyrównaniu makiety `04` (pkt 1);
   - (b) EVM-041 — AC4 i sekcja „UX / UI” mają „Anonimizuj…” (makieta: „Anonimizuj klienta…”), „UX / UI” — „Przywróć” i AlertDialog (danger) dla usunięcia (makieta: usunięcie z „Cofnij”, pkt 4 (e)) — wyrównać w planie EVM-041 (AC4 — za zgodą Konrada);
   - (c) EVM-044 — sekcja „UX / UI” nadal „Dodaj zdjęcia” — wyrównać w planie EVM-044;
   - (d) EVM-063 — „Poza zakresem” („Klauzula BYOD w aplikacji mobilnej — M2”) jest spójne z nowym AC2 (BYOD w panelu w przeglądarce telefonu), ale warto doprecyzować brzmienie w planie EVM-063.

## Definition of Done
- [x] AC1–AC8 spełnione (weryfikacja QA przez inspekcję) — `qa-engineer` runda 2: PASS AC1–AC8; orkiestrator 2026-10-05: `npm run docs:check` 0 błędów / 0 ostrzeżeń (168 plików), `npm run test:tools` 328/328, lokalny render Mermaid 14/14, linki i kotwice w 16 plikach — 0 zepsutych, tokeny 82 / 0 brakujących, § — 0 brakujących, 0 literałów kolorów, jednostek i fontów; dane syntetyczne (`example.com`, `*.test`, telefony `+48 600 000 00x` jak w makietach EVM-004)
- [x] Przeglądy: web-developer, security-engineer — APPROVE (runda 2; runda 1: `web-developer` 1 × major — nazwa dostępna wiersza W-14 zgodna z widoczną etykietą, WCAG 2.5.3 — naprawiony; konsultacja `security-engineer` A1–A6, B1–B10 wbudowana w makiety)
- [x] `CHANGELOG.md` zaktualizowany (Unreleased → Dodano, wpis EVM-071)
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-015 planu wstępnego)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): AC4 i AC5 połączone (W-06), nowe AC5 — makieta W-09 w przeglądarce telefonu
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — ready → in-progress: start `/deliver` (orkiestrator; sesja w chmurze, gałąź `feature/EVM-071-makiety-m1` — zgoda Konrada na push gałęzi bez force)
- 2026-10-05 — plan techniczny (ux-designer)
- 2026-10-05 — konsultacja `security-engineer` (S1–S7): CHANGES — uzupełnienia A1–A6 i uwagi B1–B10 wpisane do „Ustaleń z konsultacji” i do makiet; bez decyzji Konrada
- 2026-10-05 — implementacja (ux-designer): nowe przepływy `13-klienci.md` (W-14), `14-edycja-lokalizacji-i-strony.md` (W-20), `15-prywatnosc-i-pomoc.md` (W-19); rozszerzenia `03` (W-06 (a)–(d)), `06` (W-09 w przeglądarce telefonu), `07` (W-10), `08` (dialogi transz, W-11 „Do wystawienia”), `01` (stopka W-01, tytuł W-04); `flows/README.md` (mapa, „Ekrany”, macierz, zasady wspólne 16–20, „Pokrycie EVM-071”, polityki P3, P6, P7, P10); `scenariusze-a-d.md` (L7, L8, A1″), `10`; `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`; rozstrzygnięcia 15–20 i „Uwagi do rozważenia”. Zmiany w drzewie roboczym (bez commita — agent bez powłoki); `npm run docs:check`, `npm run test:tools`, render Mermaid i skrypty kontroli (linki, tokeny) uruchamia orkiestrator. Pozostaje krok 10 — `product-owner`: `domain.md`
- 2026-10-05 — implementacja, krok 10 (product-owner): `domain.md` — nowa sekcja „Pojęcia z makiet M1 (dodane w EVM-071)” (12 pojęć w brzmieniu z makiet `13`, `14`, `15`, `03`, `06` i zasad wspólnych 18–19; bez nowych encji; nazwy w kodzie wg `domain-model.md`, brakujące kody — plany EVM-041 i EVM-044), odnośnik w nagłówku słownika, doprecyzowany wiersz „Zlecenie zamknięte — tylko do odczytu” (decyzja 17, rozstrzygnięcie 15); `CHANGELOG.md` — pojęcia we wpisie EVM-071; „Uwagi do rozważenia” 16 — zrealizowane. Decyzje 17–19 sprawdzone w README M1 — jednoznaczne. Zmiany w drzewie roboczym (bez commita — agent bez powłoki); `npm run docs:check` uruchamia orkiestrator
- 2026-10-05 — weryfikacja (workflow `deliver-story`, 2 rundy): runda 1 — QA PASS, `security-engineer` APPROVE, `web-developer` changes_required (1 × major, W-14 nazwa dostępna), poprawka `ux-designer`; runda 2 — QA PASS AC1–AC8, oba przeglądy APPROVE; 9 ustaleń nieblokujących → „Uwagi do rozważenia” 17
- 2026-10-05 — in-progress → in-review: weryfikacja orkiestratora (`docs:check` 0/0, `test:tools` 328/328, Mermaid 14/14, linki, tokeny i § styleguide'u, dane syntetyczne), DoD bez demo
- 2026-10-05 — demo (Konrad): przyrost zaakceptowany z krótką poprawką (a)–(i) przed PR; zmiany brzmienia AC w EVM-030, EVM-035, EVM-041, EVM-044, EVM-053, EVM-054, EVM-058, EVM-063 — teraz, w tym PR („Decyzje” 1–2)
- 2026-10-05 — zmiany AC („Decyzje” 2) naniesione przez `product-owner`: EVM-030 AC5, EVM-035 AC1, EVM-053 AC8 (draft), EVM-054 AC7, EVM-058 AC6 (draft) — `412` jako komunikat z makiety; EVM-044 AC4 — etykiety z makiety W-09 compact; EVM-041 AC1 (klient usunięty w danych osadzonych w zleceniach), AC2, AC3; EVM-063 AC2 (BYOD); pozostałe rozbieżności → „Uwagi do rozważenia” 18; brakujący tekst `412` dla przejść zlecenia i dialogów „Rozlicz…” / „Anuluj zlecenie…” w W-06 — dopisany do poprawki `ux-designer` jako (j)
- 2026-10-05 — poprawka (a)–(i) przed PR („Decyzje” 1) i (j) (`ux-designer`): (a) podpowiedzi zlecenia zamkniętego wg roli w `03`, `04`, `08`; (b) osobna podpowiedź i alert `409` anonimizacji (licznik w nawiasie jak w pozostałych makietach); (c) linki `mailto:` / `tel:` — tekst linku = adres lub numer, nazwa dostępna od widocznego tekstu; (d) W-11 `displayName`; (e) inny etap na liście usuniętych; (f) `409` „anulowane”, `429` w W-06 (b); (g) diagram W-14 — wejście z filtra „Usunięci”; (h) fokus AlertDialog anonimizacji; (i) zasada 4 w `15`; (j) `412` dla przejść zlecenia i dialogów „Wstrzymaj…”, „Anuluj zlecenie…”, „Rozlicz…”, „Zakończ”, „Przywróć zlecenie…” w W-06 (spójność z EVM-030 AC5, EVM-058 AC6)
