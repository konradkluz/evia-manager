# 16 — M2: uzupełnienia dla aplikacji „Teren” i urządzeń w panelu

> Dokument żywy (konsultacja UX przed `ready` planu M2, 2026-10-27; `ux-designer`) · przepływ 16 (E9, E10, E12, E13, E14) · kanały: mobile i web · nowe ekrany: **M-12** (pierwsze pobranie danych), **M-11** (prywatność i pomoc), **W-17** (urządzenia użytkowników), sekcja „Urządzenia” w **W-15**; uzupełnienia istniejących ekranów M-01, M-02, M-05, M-07, M-09 · indeks: [README.md](README.md)
> Źródła: plan [M2](../../backlog/M2/README.md) (EVM-090…112, wszystkie `draft`), `offline-sync.md` (odrzucenia mutacji, obiekty oczekujące, resync), styleguide § 3.13, § 3.15, § 3.16, § 3.19, § 3.20, § 3.21, § 4.11, § 4.15, § 4.16, § 4.18, § 5; polityki P2, P5, P7; SR-MOB-05/-06/-08/-12/-13, SR-SESS-04/-06/-07, SR-AUTHZ-12.
> **Zakres tego pliku:** wyłącznie dopiski. Zaakceptowane makiety (01, 05, 07, 09, 10, 12, 15) pozostają bez zmian; tu ich nie nadpisujemy, tylko uzupełniamy (każdy dopisek wskazuje ekran, którego dotyczy). Tokeny i komponenty — tylko z styleguide'u 1.2.0; propozycje nowych elementów oznaczono „do styleguide'u”.

## Zasady wspólne przepływu 16
1. **Dane lokalne są prawdą ekranu** — po pierwszym pobraniu żaden ekran mobilny nie czeka na sieć, żeby się pokazać (M-12 jest wyjątkiem jednorazowym).
2. **Nic nie znika bez decyzji** — każdy odrzucony element ma powód prostymi słowami, co najmniej jedną akcję ratunkową i „Usuń z telefonu” oddzielone od niej (§ 4.16, § 5.1).
3. **Tryb ukrytych danych (§ 4.18) wygrywa z każdym dopiskiem poniżej** — nic z tego pliku nie renderuje nazw, adresów, telefonów ani treści wpisów, gdy dane są ukryte.
4. **Terminologia** — „telefon” (nie „urządzenie”) w tekstach dla technika; „urządzenie” w panelu (W-15, W-17), bo tak nazywa to model domeny; „Kolejka”, „Wymaga uwagi”, „Oczekuje na numer” bez zmian.
5. **Zapytania wyszukiwania i dane kopiowane do schowka nie trafiają do logów, raportów błędów ani historii** (SR-MOB-12; test w EVM-102 AC1 obejmuje te pola).

---

## M-12 Pierwsze pobranie danych („Przygotowujemy dane…”)
- **Cel:** po pierwszym logowaniu (EVM-107 AC1) bezpiecznie pobrać zakres zleceń do zaszyfrowanej bazy i przejść do listy; technik wie, że coś się dzieje, ile to potrwa i co zrobić, gdy nie wyjdzie.
- **Główna akcja:** brak podczas pobierania (ekran informacyjny); po błędzie — „Spróbuj ponownie”.
- **Hierarchia treści:** 1) tytuł „Przygotowujemy dane”, 2) krok i postęp, 3) Skeleton listy zleceń (kształt M-05), 4) wskazówka o czasie, 5) „Wyloguj” (drugorzędnie, na dole).
- **Wejście:** tuż po kroku 2 w M-01 (po kontrolach z M-02: blokada ekranu, rola, limit urządzeń, `426`); także **wznowienie** po zabiciu aplikacji w trakcie pobierania (pobieranie jest transakcyjne — albo cała baza, albo nic, EVM-107 AC1).
- **Wyjście:** M-05 (po zapisie całości). Bez częściowej listy — niepełne dane mogłyby sugerować brak zlecenia.

**Makieta (compact; ekran bez BottomNav, AppBar bez SyncIndicator — nie ma jeszcze czego synchronizować)**
```text
┌──────────────────────────────────┐
│ EVia Manager                     │ AppBar: color.bg.brand-strong
├──────────────────────────────────┤
│ Przygotowujemy dane              │ text.heading-2
│ Pobieramy Twoje zlecenia…        │ krok 1 z 2 (text.body)
│ ██████████░░░░░░░░  120 z 340    │ ProgressBar § 3.19 (gdy znana liczba)
│                                  │
│ ┌──────────────────────────────┐ │
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒                 │ │ Skeleton kart § 3.16
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒             │ │
│ └──────────────────────────────┘ │
│ To zajmie chwilę. Możesz         │
│ zablokować telefon — pobieranie  │
│ wznowimy.                        │
├──────────────────────────────────┤
│ [Wyloguj]                        │ tertiary, size.touch-target.min
└──────────────────────────────────┘
 Krok 2: „Zapisujemy dane w telefonie…” (bez liczb; zaszyfrowany zapis)
 Wolno (brak postępu 30 s): Banner § 3.19 info „Słaby zasięg — pobieranie trwa dłużej. Nic nie jest tracone.”
 Błąd:
 │ ‹circle-alert›  Nie udało się pobrać danych            │ EmptyState § 3.15
 │ Nic nie zostało zapisane w telefonie. Sprawdź          │
 │ połączenie i spróbuj ponownie.                         │
 │ [[ Spróbuj ponownie ]]   [Wyloguj]                     │
```

**Stany**
| Stan | Zachowanie |
|---|---|
| Pusty | Konto bez zleceń w zakresie → zamiast listy M-05 z komunikatem „Nie masz zleceń w telefonie…” (M-05, stan pusty) — to wynik poprawny, nie błąd. |
| Ładowanie | Skeleton + ProgressBar; gdy liczba nieznana — pasek nieokreślony i same kroki („krok 1 z 2”); spinner nie występuje (§ 3.16). Pasek i tekst „120 z 340” ogłaszane co 5 s lub co 25%, nie ciągle (§ 5.4). Animacja Skeleton wyłączona przy „usuń animacje” w systemie. |
| Błąd | Sieć/`5xx`: „Nie udało się pobrać danych. Nic nie zostało zapisane w telefonie. Sprawdź połączenie i spróbuj ponownie.” `429`: „Serwer jest zajęty. Spróbujemy ponownie za 30 s.” (automatyczne ponowienie z odliczaniem w tekście). Brak miejsca: „Za mało miejsca w telefonie, by pobrać dane. Zwolnij miejsce i spróbuj ponownie.” Błąd zapisu w bazie/klucz: „Nie udało się zapisać danych w telefonie. Spróbuj ponownie; jeśli się powtarza, napisz do pomocy.” + „Pomoc” (M-11). Powtórzenie ≥ 3 razy → ten sam ekran z dodatkowym „Pomoc”. |
| Offline | Utrata sieci w trakcie: pobieranie wstrzymane, tekst „Brak zasięgu. Wznowimy pobieranie, gdy wróci połączenie.” (bez utraty postępu, ale bez zapisu częściowego); „Spróbuj ponownie” wyłączone z podpowiedzią tekstową (nie tylko tooltip). Po powrocie sieci wznowienie samo. Wyjście z aplikacji nie niszczy postępu pobranych porcji w pamięci tymczasowej szyfrowanej — decyzja techniczna EVM-107; UI nie obiecuje wznowienia od połowy, tylko „wznowimy pobieranie”. |
| Brak uprawnień | `403 channel_not_allowed`, `401`, `426`, `device_wipe_required` w trakcie pobierania → odpowiednie warianty M-02 (nic nie jest zapisane; kolejka tego konta, jeśli istnieje, zostaje zaszyfrowana). |

- **Kolejka niewysłanych elementów z poprzedniej sesji tego samego konta** (P2): jest już w telefonie, więc na M-12 pod postępem link „Kolejka (5 elementów)” (tylko podgląd, bez danych zleceń, bo jeszcze ich nie ma); wysyłka rusza po zakończeniu pobierania (EVM-107 AC2: najpierw kolejka, potem zmiany — przy pierwszym pobraniu kolejność odwrotna jest bezpieczna, bo serwer jest źródłem zakresu; do potwierdzenia przez architekta).
- **Aparat podczas M-12:** niedostępny (brak zlecenia, do którego można przypisać zdjęcie); to świadoma decyzja — pobranie ma trwać krótko. Gdy trwa > 60 s, pokazujemy ten sam Banner „Słaby zasięg…”; nie dodajemy skrótów.
- **Komponenty i tokeny:** EmptyState (§ 3.15), Skeleton (§ 3.16), ProgressBar i Banner (§ 3.19), Button primary `size.touch-target.field` / tertiary `size.touch-target.min`; ikony `circle-alert`, `wifi-off`, `hard-drive`; tło `color.bg.canvas`, tytuł `text.heading-2`.
- **Mikrocopy:** „Przygotowujemy dane” · „Pobieramy Twoje zlecenia…” · „Zapisujemy dane w telefonie…” · „120 z 340 zleceń” (odmiana § 6.3) · „To zajmie chwilę. Możesz zablokować telefon — pobieranie wznowimy.” · „Słaby zasięg — pobieranie trwa dłużej. Nic nie jest tracone.” · „Nie udało się pobrać danych. Nic nie zostało zapisane w telefonie.” · „Spróbuj ponownie” · „Wyloguj”.
- **Dostępność:** fokus TalkBack na tytule przy wejściu; postęp jako tekst „krok 1 z 2, 120 z 340 zleceń” (nie sam pasek); komunikat końcowy „Dane gotowe. Lista zleceń.” ogłoszony raz po przejściu; błąd ogłoszony jako alert z fokusem na „Spróbuj ponownie”; ekran nie pokazuje danych zleceń, więc nie wymaga `FLAG_SECURE` (obowiązuje tylko M-01).

---

## M-07 Kolejka — uzupełnienie: „Wymaga uwagi” dla wpisów, komentarzy i szybkich zleceń (EVM-107 AC3–AC4, EVM-105, EVM-106 AC4)
M-07 (plik 09) specyfikuje media. Dla pozostałych mutacji obowiązuje ten sam układ elementu (typ + numer zlecenia + powód + akcje). **Powód prostymi słowami, kod techniczny nigdy na pierwszym planie** (szczegóły pod „Szczegóły techniczne” w Disclosure § 3.21, do skopiowania dla wsparcia).

| Odrzucenie (`rejected`) | Element | Powód (mikrocopy) | Akcje (kolejność = ważność; ostatnia zawsze „Usuń z telefonu”) |
|---|---|---|---|
| `target_unavailable`, `forbidden` | Wpis / komentarz | „Zlecenie zostało usunięte albo nie masz do niego dostępu.” | [Dodaj do innego zlecenia] · [Kopiuj treść] · [Usuń z telefonu] |
| `validation_failed` | Wpis / komentarz | „Serwer nie przyjął tego wpisu — treść jest nieprawidłowa albo za długa.” | [Kopiuj treść] · [Dodaj do innego zlecenia] · [Usuń z telefonu] |
| `id_conflict` | dowolny | „Ten element nie mógł zostać zapisany — spróbuj utworzyć go ponownie.” | [Utwórz ponownie] · [Usuń z telefonu] (nowy identyfikator; nigdy edycja w miejscu) |
| `template_unavailable` | Szybkie zlecenie | „Wybrany szablon nie jest już dostępny.” | [Utwórz ponownie] (formularz M-10 z danymi, szablon do wyboru) · [Usuń z telefonu] |
| `validation_failed` | Szybkie zlecenie | „Zlecenie nie zostało utworzone — sprawdź dane klienta i adres.” | [Utwórz ponownie] · [Usuń z telefonu] |
| `target_unavailable` | Zdjęcie / film | (bez zmian — plik 09) | (bez zmian) |

- **„Kopiuj treść”** (AC4 „dane do skopiowania”): kopiuje do schowka samą treść wpisu (lub dane szybkiego zlecenia: klient, adres, szablon); po kopiowaniu Toast „Skopiowano.” Android 13+ pokazuje własny podgląd schowka — **dane osobowe w schowku trwają po wyjściu z aplikacji**, więc kopia jest oznaczona jako wrażliwa (`EXTRA_IS_SENSITIVE`) i **kasowana po 60 s**, jeśli schowek nie zmienił zawartości (wymaga potwierdzenia `security-engineer`). Bez „Kopiuj” treść i tak zostaje do decyzji — jest widoczna w elemencie (po rozwinięciu).
- **Podgląd odrzuconego wpisu:** dotknięcie elementu → rozwija treść wpisu (do 5 linii + „Pokaż całość”), kategorię i czas dodania „Dodano w telefonie 02.10.2026, 9:12”.
- **Szybkie zlecenie z zależnymi elementami:** zlecenie `rejected` pociąga zależne (wpisy, zdjęcia) — pokazujemy je **jako jedną grupę**, żeby nie tworzyć kilkunastu osobnych kafli:
```text
 ┃▣ Nowe zlecenie · Dom — sam montaż
 ┃ Zlecenie nie zostało utworzone — sprawdź dane klienta i adres.
 ┃ Czeka z nim 4 elementy: 3 zdjęcia, 1 wpis.        [▸ Pokaż]
 ┃ [Utwórz ponownie]        ← po utworzeniu zależne przenoszą się do nowego zlecenia
 ┃ [Usuń z telefonu]        ← dialog z liczbą zależnych: „Usunąć zlecenie i 4 zależne elementy?”
```
  „Utwórz ponownie” otwiera M-10 z danymi; po wysłaniu nowego zlecenia zależne elementy dostają nowe komendy z nowym celem (decyzja do potwierdzenia: **przeniesienie automatyczne** — rekomendacja, bo technik nie musi niczego ręcznie przepinać; alternatywa: zależne zostają w „Wymaga uwagi” do ręcznego „Dodaj do innego zlecenia”).
- **„Oczekuje na numer” w Kolejce:** wiersz `clock` „Oczekuje na numer” z tytułem i adresem (w trybie ukrytych danych: tylko „Nowe zlecenie · Oczekuje na numer”) + licznik zależnych „Czeka z nim 4 elementy”. Brak akcji poza „Pokaż” (§ 4.15 — nieinteraktywna odznaka); nie wymyślamy numeru lokalnego, żeby nie pomylić go z ZL-… . Jeśli czeka dłużej niż 24 h: Banner `warning` w tej sekcji „Zlecenie czeka na numer od wczoraj, 13:40. Połącz się z internetem, żeby je wysłać.” (offline) albo „Wysyłamy… spróbuj ponownie” (online, z „Ponów”).
- **SyncIndicator — stany błędów synchronizacji** (nazwa dostępna zawiera stan; wspólne dla wszystkich ekranów):
| Sytuacja | Kapsuła | Baner / tekst | Akcja |
|---|---|---|---|
| Wysyłka kolejki nie powiodła się (sieć/`5xx`) | `Błąd · Ponów` (`cloud-alert`) | „Nie udało się wysłać 3 elementów. Spróbujemy ponownie; nic nie jest tracone.” | [Ponów] |
| Pobieranie zmian nie powiodło się | `Zsynchr. 14:05` + baner w M-05 | „Nie udało się pobrać zmian. Pokazujemy dane z 14:05.” | [Spróbuj ponownie] |
| Serwer żąda pełnego odświeżenia (resync) | bez zmian | Banner info „Odświeżamy dane zleceń… Lista działa dalej.” (dane zamieniane atomowo; przy błędzie zostają stare) | — |
| `429` | `Błąd · Ponów` | „Serwer jest zajęty. Spróbujemy za 30 s.” | — |
| `401 session_revoked`, `device_wipe_required`, `426` | — | pełny ekran M-02 (EVM-100 AC3) | wg M-02 |
- **Responsywność i a11y:** jak M-07; akcje jako widoczne przyciski; każdy element z nazwą „Wpis, ZL-2026-0042, wymaga uwagi: zlecenie usunięte albo brak dostępu”; ogłoszenie nowego „Wymaga uwagi” raz, zbiorczo.

---

## M-05 Lista zleceń — uzupełnienie: wyszukiwanie offline (EVM-103 AC2–AC3)
- **Zasada:** wyszukiwanie jest lokalne, więc offline działa tak samo jak online; różni się tylko tekstem pomocniczym o świeżości danych.
- **Dopasowanie:** numer (także sam fragment, np. „0042”), nazwa klienta, ulica i numer domu, numer miejsca postojowego; bez rozróżniania wielkości liter i polskich znaków („zolkiewskiego” = „Żółkiewskiego”, decyzja nr 7 planu M2). Od 1 znaku; wyniki na bieżąco (lokalna baza, bez opóźnienia „debounce” widocznego dla użytkownika); sortowanie: trafienie w numer > adres > klient, potem ostatnia aktywność. Zapytanie nie jest zapisywane (zasada 5).
- **Zlecenia oczekujące na numer** (§ 4.15) są przeszukiwane po adresie i kliencie; na liście stoją **na górze** do czasu nadania numeru, żeby technik zawsze je widział (po numerze wracają do zwykłego sortowania).
- **Chipy w v1** (decyzja nr 3: „Moje” = wszystkie w zakresie): w makiecie M-05 chipy „Moje” i „Czekamy na…” **nie powinny trafić do M2** — „Moje” dubluje „Wszystkie” i wprowadza w błąd; „Czekamy na…” wymaga danych procesu (EVM-097). Rekomendacja: w M2 chipy **„Wszystkie”** i **„Niewysłane (n)”** (zlecenia z elementami w Kolejce); „Moje” wraca z rolą Monter (M4). To odstępstwo od makiety M-05 — wymaga zgody Konrada i wpisu w changelogu styleguide'u.

| Stan wyszukiwania | Zachowanie |
|---|---|
| Brak wyników (online/offline) | „Brak zleceń dla „kowalski”. Szukamy tylko w zleceniach zapisanych w telefonie.” + [Wyczyść wyszukiwanie]. **Offline lub dane starsze niż 1 h** dodatkowa linia: „Ostatnia synchronizacja: dziś, 14:05. Zlecenia założone w biurze później pojawią się po synchronizacji.” + [Synchronizuj] (wyłączone offline z widocznym tekstem „Wymaga połączenia”). Zapytanie zostaje w polu (nie czyścimy). |
| Brak zleceń w ogóle | „Nie masz zleceń w telefonie. Zlecenia pojawią się po synchronizacji. [Nowe zlecenie]” (makieta M-05); offline dodatkowo: „Brak zasięgu.” |
| W trakcie pobierania / resync | Wyniki z istniejącej bazy; Banner „Odświeżamy dane zleceń…”; wyniki nie „mrugają” (zamiana atomowa). Pierwsze pobranie → M-12, nie M-05. |
| **Tryb ukrytych danych (§ 4.18)** | Pola wyszukiwania i chipów **nie są renderowane** (EmptyState zamiast listy) i zapytanie jest czyszczone w chwili wejścia w tryb — wpisana fraza nie może filtrować ani ujawniać istnienia wyniku. W arkuszu „Do którego zlecenia?” (M-06) wyszukiwanie wyłącznie po numerze zlecenia; wynik pokazuje sam numer lub „Oczekuje na numer”; brak wyników: „Brak zleceń o tym numerze.” (bez podpowiedzi o nazwie/adresie). |
| Brak uprawnień | Tylko odczyt → M-02. |
- **Dostępność:** pole z etykietą „Szukaj zlecenia” (nie sam placeholder), przycisk wyczyść `x` ≥ 48 dp z nazwą „Wyczyść wyszukiwanie”, liczba wyników ogłaszana po zakończeniu pisania („12 wyników” / „Brak wyników”), klawiatura bez autokorekty słów (adresy), `inputMode` tekstowy z przyciskiem „Szukaj”; po wybraniu wyniku fokus na szczegółach zlecenia.

---

## Uzupełnienia M-01, M-02, M-09 (EVM-100, EVM-101)
Makiety M-01, M-02 i M-09 wystarczają dla EVM-100 i EVM-101 po poniższych dopiskach — **nie trzeba rysować nowych ekranów**, tylko doprecyzować.

**M-01 (logowanie)**
- Krok 2: link „Zmień konto” (powrót do e-maila bez utraty wpisanego e-maila; hasło czyszczone); pole kodu: 6 cyfr, `inputMode` numeryczny, **wklejanie i autouzupełnienie dozwolone** (WCAG 3.3.8), „Pokaż”. Ponowienie po złym kodzie: „Kod jest nieprawidłowy albo wygasł. Wpisz nowy kod z aplikacji.” (ten sam tekst co panel, bez ujawniania stanu konta).
- Błąd serwera: „Nie udało się zalogować. Spróbuj ponownie za chwilę.” Blokada `429`: „Zbyt wiele prób. Spróbuj ponownie za 4 min.” (odliczanie jako tekst aktualizowany co minutę; przycisk wyłączony z widocznym powodem).
- Po sukcesie kroku 2: kontrole urządzenia „Sprawdzamy telefon…” (M-02) → **M-12**.
- `FLAG_SECURE`: w kompilacjach testowych (Maestro, zrzuty QA) wyłączony flagą debug — inaczej zrzuty ekranu logowania są czarne; w kompilacji produkcyjnej zawsze włączony (informacja dla `mobile-developer` i `qa-engineer`).

**M-02 (stany urządzenia) — zmiany tekstów**
- **„Aktualizacja wymagana”:** wariant „Otwórz Google Play” **jest nieaktualny** — ADR-0019: dystrybucja APK z CI, bez Google Play. Proponowany tekst: „Zaktualizuj aplikację. Ta wersja nie jest już obsługiwana. Poproś administratora o nową wersję aplikacji. Niewysłane elementy (5) są bezpieczne w telefonie — wyślemy je po aktualizacji.” Akcje: „Zobacz kolejkę” (główna) i „Pomoc”. Gdy ustalony zostanie sposób dostarczenia APK (link w e-mailu, strona pobierania) — akcja „Pobierz nową wersję”. **Do decyzji Konrada** (otwarte pytanie 1).
- **Wygasła sesja:** `session_revoked` z powodu >14 dni bezczynności lub 30 dni: „Sesja wygasła. Zaloguj się ponownie. Niewysłane elementy (5) są zaszyfrowane w telefonie — wyślemy je po zalogowaniu na to samo konto.” (osobny wiersz tabeli stanów, ten sam układ co „Wylogowano telefon”).
- **Wylogowano z M-09 (AC6 EVM-100):** tytuł „Wylogowano” (nie „…ten telefon” — użytkownik sam to zrobił), reszta jak w wariancie „Wylogowano telefon”.
- **Wszystkie warianty blokujące:** drugorzędny link „Pomoc” (M-11), żeby osoba z rolą Tylko odczyt lub z limitem telefonów mogła od razu znaleźć kontakt do administratora.

**M-05 / M-09 — ostrzeżenie przed ukryciem danych (rekomendacja do EVM-101 AC2)**
- Od 5. dnia bez udanego kontaktu: Banner `warning` na M-05 i M-09: „Telefon nie łączył się z serwerem od 5 dni. Za 2 dni ukryjemy dane zleceń. Połącz się z internetem.”; od 6. dnia „Jutro ukryjemy dane zleceń…”. Nie da się zamknąć, znika po kontakcie z serwerem. Bez tego technik w terenie dowiaduje się o ukryciu danych dopiero w garażu bez zasięgu. Liczone tym samym odpornym zegarem co 7 dni.
- **Dodaj (arkusz akcji, ActionMenu § 3.20) w stanach specjalnych:** w trybie ukrytych danych „Wpis” i „Nowe zlecenie” są **wyłączone z widocznym powodem w tekście pozycji** („Dane zleceń są ukryte”), „Zdjęcie lub film” aktywne; podczas M-12 arkusz niedostępny; offline wszystkie pozycje aktywne.
- **M-09:** wiersze „Pomoc” i „Prywatność” zostają (makieta zaakceptowana) i oba otwierają [M-11](#m-11-prywatność-i-pomoc) w odpowiedniej sekcji (kotwice `#pomoc` i `#prywatnosc`). Gdy blokada aplikacji jest wyłączona przez technika — przełącznik „Blokuj aplikację po 5 min w tle” pozostaje włączalny/wyłączalny (decyzja nr 6: domyślnie włączona; czy wolno wyłączyć — do `security-engineer`).

---

## M-11 Prywatność i pomoc
- **Cel:** w telefonie, także bez zasięgu i przed zalogowaniem, znaleźć kontakt do administratora, zgłosić zgubiony telefon, przeczytać klauzule RODO i sprawdzić wersję aplikacji (EVM-102 AC4, SR-PRIV-05, SR-PRIV-10, SR-MOB-12).
- **Główna akcja:** brak jednej — ekran treści; najważniejsze: „Napisz do administratora” (`mailto:`) i, gdy skonfigurowany, „Zadzwoń do biura” (`tel:`; **decyzja Konrada**, otwarte pytanie 2 — adres funkcyjny jest w panelu bez numeru telefonu, ale technik w terenie z problemem częściej zadzwoni).
- **Wejścia:** M-09 „Pomoc” (kotwica `#pomoc`) i „Prywatność” (`#prywatnosc`); M-01 link „Prywatność” (przed zalogowaniem — wariant bez danych); M-02 link „Pomoc”.
- **Hierarchia treści:** 1) „Pomoc” (kontakt, zgłoszenie utraty telefonu, problem z logowaniem — tylko przed zalogowaniem), 2) „Prywatność” (administrator danych, trzy klauzule jako Disclosure — taka sama treść i wersje jak W-19), 3) „O aplikacji” (wersja, ostatnia synchronizacja, raportowanie awarii, licencje open source).

**Makieta (compact; AppBar „Prywatność i pomoc” z ← ; bez SyncIndicator przed zalogowaniem)**
```text
┌──────────────────────────────────┐
│ ← Prywatność i pomoc  ⟨Zsynchr.⟩ │
├──────────────────────────────────┤
│ Pomoc                    #pomoc  │ text.heading-3
│ Kontakt z administratorem:       │
│ pomoc@firma.test                 │ link mailto:, size.touch-target.min
│ [Zadzwoń do biura]  ← jeśli jest numer funkcyjny w konfiguracji
│ ┃‹triangle-alert› Zgubiony telefon│ Banner § 3.19 warning
│ ┃ albo podejrzenie, że ktoś zna  │
│ ┃ hasło — zgłoś to od razu:      │
│ ┃ pomoc@firma.test               │
│ Administrator może zablokować    │
│ i wyczyścić zgubiony telefon     │
│ w panelu.                        │
│                                  │
│ Prywatność           #prywatnosc │
│ Administrator danych: [dane      │
│ firmy — decyzja 9]               │
│ ▸ Klauzula dla klientów          │ Disclosure § 3.21
│   Wersja 1.0 · od 01.11.2026     │
│ ▸ Klauzula dla osób kontaktowych │
│ ▾ Klauzula dla pracowników i BYOD│
│   (treść z EVM-063, offline)     │
│                                  │
│ O aplikacji                      │
│ Wersja 1.0.0 (kompilacja 42)     │
│ Ostatnia synchronizacja: 14:05   │
│ Raporty awarii: włączone — bez   │
│ danych klientów i treści wpisów. │
│ Licencje open source        [›]  │ → lista (SQLCipher, …)
└──────────────────────────────────┘
```
**Stany**
| Stan | Zachowanie |
|---|---|
| Pusty | nd. — treść statyczna. Brak adresu w konfiguracji: „Kontakt z administratorem: zapytaj przełożonego.” (jak W-19). |
| Ładowanie | nd. — klauzule są zapakowane w aplikację w wersji odpowiadającej wydaniu (dostępne offline, EVM-102 AC4); rozwinięcie Disclosure bez opóźnienia. Lista licencji generowana w kompilacji. |
| Błąd | Brak programu pocztowego/telefonu: „Nie udało się otworzyć poczty. Adres: pomoc@firma.test” + [Kopiuj adres] (adres funkcyjny, nie dane osobowe). |
| Offline | Pełna treść bez zmian; `mailto:` działa po powrocie sieci/zapisaniu wersji roboczej w kliencie poczty. Wersja klauzuli w aplikacji może być starsza niż w panelu — podpis „Wersja 1.0 · wydanie aplikacji 1.0.0”. |
| Brak uprawnień | nd. — dostępny dla wszystkich ról i bez logowania (przed zalogowaniem: bez „Ostatnia synchronizacja”, bez danych konta); dostępny też w trybie ukrytych danych i w każdym wariancie M-02. |
- **Role:** A, E — tak; Tylko odczyt — przez M-02 „Pomoc” (bez reszty aplikacji); niezalogowany — z M-01.
- **Komponenty i tokeny:** AppBar (§ 3.18), List/ListItem (§ 3.6) `size.touch-target.min`, Disclosure (§ 3.21), Banner (§ 3.19) `color.feedback.warning.*`, ikony `triangle-alert`, `phone`, `mail`, `chevron-right`; nagłówki `text.heading-3`, treść `text.body`, klauzula `text.body` z interlinią czytelną na 360 dp.
- **Mikrocopy:** „Prywatność i pomoc” · „Pomoc” · „Prywatność” · „O aplikacji” · „Kontakt z administratorem: pomoc@firma.test” · „Zadzwoń do biura” · „Zgubiony telefon albo podejrzenie, że ktoś zna hasło — zgłoś to od razu: pomoc@firma.test” · „Administrator może zablokować i wyczyścić zgubiony telefon w panelu.” · „Raporty awarii: włączone — bez danych klientów i treści wpisów.” · „Licencje open source” · „Nie udało się otworzyć poczty. Adres: pomoc@firma.test” · „Kopiuj adres”.
- **Dostępność:** nagłówki jako nagłówki TalkBack (nawigacja po nagłówkach); link `mailto:` z nazwą „pomoc@firma.test — napisz do administratora” (WCAG 2.5.3); Disclosure z nazwą i stanem („Klauzula dla klientów, zwinięta, wersja 1.0”); tekst klauzuli przewijalny, powiększalny do 200%; brak `FLAG_SECURE` (treść publiczna).

---

## W-15 Konto — sekcja „Urządzenia” (EVM-095 AC1)
Dotychczas „od E9, w M1 niewidoczna” — bez makiety. Sekcja po „Moje sesje” (kotwica `#urzadzenia`), widoczna wszystkim rolom z dostępem do aplikacji (A, E); dla Tylko odczyt — ukryta (nie ma telefonu).
```text
┌─ Urządzenia ─────────────────────────────────────────────── #urzadzenia ┐
│ Telefony z zalogowaną aplikacją (limit: 2).                              │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ ‹smartphone› Samsung SM-G781B · Android 13 · aplikacja 1.0.0         │ │
│ │ Ostatni kontakt: dziś, 14:05            ‹circle-check› Aktywne       │ │
│ │ Zarejestrowano 01.10.2026                         [Wyloguj telefon]  │ │
│ ├──────────────────────────────────────────────────────────────────────┤ │
│ │ ‹smartphone› Pixel 7 · Android 14 · aplikacja 1.0.0                  │ │
│ │ Ostatni kontakt: 3 dni temu                                          │ │
│ │ ‹clock› Brak kontaktu od 3 dni                    [Wyloguj telefon]  │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ Zgubiony telefon? „Wyloguj telefon” kończy sesję; dane i niewysłane      │
│ elementy zostają zaszyfrowane w telefonie. Do wyczyszczenia telefonu     │
│ poproś administratora.                                                   │
└──────────────────────────────────────────────────────────────────────────┘
 Dialog po step-upie (W-04: „Potwierdź tożsamość, aby wylogować telefon”) → AlertDialog § 4.11:
 │ Wylogować telefon „Samsung SM-G781B”?                                      │
 │ Aplikacja na tym telefonie wyloguje się przy najbliższym połączeniu.        │
 │ Niewysłane elementy zostaną zaszyfrowane w telefonie do ponownego          │
 │ zalogowania na to konto.                                                   │
 │ [[ Wyloguj telefon ]]   [Anuluj] ← fokus                                    │
```
- **Stany:** pusty — „Nie masz zalogowanych telefonów. Zalogujesz się w aplikacji na telefonie firmowym.” · ładowanie — Skeleton wierszy · błąd — „Nie udało się wczytać listy telefonów. [Spróbuj ponownie]” · offline — Banner § 4.10, przyciski wyłączone z tekstem „Wymaga połączenia” · brak uprawnień — sekcja ukryta (Tylko odczyt); cudzy identyfikator → `404`, toast „Nie znaleziono telefonu.” i odświeżona lista · po sukcesie toast „Wylogowano telefon. Wyloguje się przy najbliższym połączeniu.” (zdalne wylogowanie działa przy następnym żądaniu telefonu, nie natychmiast).
- Nazwa urządzenia = model z systemu (bez numeru seryjnego, IMEI, adresu IP, lokalizacji — SR-PRIV). „Ostatni kontakt” względnie + dokładny czas w `title`/nazwie dostępnej.

## W-17 Administracja — urządzenia użytkowników (EVM-095 AC2–AC6)
- **Cel:** Administrator widzi wszystkie telefony w firmie, wie, które są nieużywane lub zaniedbane, i może odciąć zgubiony telefon (SR-SESS-06/07, P2, P7).
- **Główna akcja:** brak jednej (lista); akcje wierszowe w menu `⋮` (ActionMenu § 3.20): „Wyloguj urządzenie” i, osobno na dole, „Zablokuj i wyczyść”.
- **Wejście:** Administracja → zakładka „Urządzenia” (Tabs § 3.17, trzecia po „Użytkownicy” i „Dziennik audytu”); **step-up przy wejściu** (W-04 „Potwierdź tożsamość, aby zobaczyć urządzenia”, jak W-18); po „Anuluj” EmptyState `shield` bez danych.

**Makieta (expanded; DataTable § 3.6, `breakpoint.wide` pełna; na `compact` wiersze jako karty)**
```text
Administracja   [Użytkownicy] [Dziennik audytu] [Urządzenia]
[Użytkownik ▾ wszyscy] [Stan ▾ Aktywne] [Sortuj: Ostatni kontakt ▾]   3 urządzenia
┌───────────────┬──────────────────────┬────────┬───────────────┬───────────────────┬──────────────┬────┐
│ Użytkownik    │ Urządzenie           │ Aplik. │ Poprawki      │ Ostatni kontakt   │ Stan         │    │
├───────────────┼──────────────────────┼────────┼───────────────┼───────────────────┼──────────────┼────┤
│ Piotr Testowy │ Samsung SM-G781B     │ 1.0.0  │ ‹circle-check›│ dziś, 14:05       │ ‹circle-check›│ ⋮ │
│               │ Android 13           │        │ 05.2026       │                   │ Aktywne      │    │
│ Anna Testowa  │ Pixel 7 · Android 14 │ 1.0.0  │ ‹triangle-alert›│ 9 dni temu ‹clock›│ Aktywne      │ ⋮ │
│               │                      │        │ Starsze niż 12 mies.│ Ukryte dane (>7 dni)│           │    │
│ Jan Przykład. │ Moto G (Android 12)  │ 0.9.2  │ nieznane      │ 02.10.2026        │ ‹shield-off›  │ ⋮ │
│               │                      │        │               │                   │ Czeka na wyczyszczenie │
└───────────────┴──────────────────────┴────────┴───────────────┴───────────────────┴──────────────┴────┘
 Menu ⋮: „Wyloguj urządzenie” · ───── · „Zablokuj i wyczyść…” (danger)
 Dialog „Wyloguj urządzenie” (AlertDialog § 4.11):
 │ Wylogować „Pixel 7” użytkownika Anna Testowa?                              │
 │ Telefon wyloguje się przy najbliższym połączeniu. Dane zleceń zostaną       │
 │ usunięte z telefonu, niewysłane elementy zostaną zaszyfrowane do ponownego  │
 │ zalogowania na to konto. Miejsce w limicie 2 telefonów się zwolni.          │
 │ [[ Wyloguj urządzenie ]]   [Anuluj] ← fokus                                  │
 Dialog „Zablokuj i wyczyść…” (nieodwracalne; pole potwierdzenia nazwą modelu):
 │ Zablokować i wyczyścić „Pixel 7”?                                          │
 │ Przy najbliższym połączeniu telefon usunie wszystkie dane firmowe,         │
 │ także niewysłane zdjęcia i wpisy — tej operacji nie można cofnąć.           │
 │ Jeśli telefon jest u pracownika i działa, użyj najpierw „Wyloguj urządzenie”│
 │ (zachowa niewysłane elementy). Użyj „Zablokuj i wyczyść” dla zgubionego     │
 │ lub skradzionego telefonu.                                                  │
 │ Wpisz „Pixel 7”, aby potwierdzić: [____________]                            │
 │ [[ Zablokuj i wyczyść ]] (danger, wyłączony do dopasowania)  [Anuluj] ← fokus│
```
- **Stany urządzenia (ikona + etykieta, nie kolor):** `circle-check` „Aktywne” · `log-out` „Wylogowane” · `shield-off` „Czeka na wyczyszczenie” (zlecone, telefon jeszcze się nie połączył) · `shield-check` „Wyczyszczone” (telefon potwierdził — **wymaga potwierdzenia od telefonu w API: do EVM-090/094**; bez tego stan końcowy nie istnieje i zostaje „Czeka na wyczyszczenie”) · `clock` „Brak kontaktu od N dni” od 3. dnia, od 7. dnia dopisek „Dane zleceń ukryte w telefonie”. Poziom poprawek: `circle-check` „Aktualne”, `triangle-alert` „Starsze niż 6 mies.” / „Starsze niż 12 mies.”, „nieznane”. **Propozycja do styleguide'u (P-14):** wariant StatusBadge dla stanu urządzenia (4 wartości powyżej) na istniejących tokenach `color.feedback.*`; do czasu wpisu — tekst + ikona w komórce, bez nowego komponentu.
- **Stany ekranu:** pusty — „Żaden telefon nie jest zalogowany. Urządzenia pojawią się po pierwszym logowaniu w aplikacji.” (przy aktywnych filtrach „Wyczyść filtry”) · ładowanie — Skeleton wierszy · błąd — „Nie udało się wczytać urządzeń. [Spróbuj ponownie]” · offline — Banner § 4.10, akcje wyłączone z tekstem „Wymaga połączenia” · brak uprawnień — Edytor/Tylko odczyt: `403` EmptyState jak reszta administracji (zakładka niewidoczna), bez danych.
- **Reguły:** Administrator może działać na własnych urządzeniach przez W-15 (to samo API); akcje tylko po step-upie; po wykonaniu toast „Zlecono wylogowanie urządzenia.” / „Zlecono zablokowanie i wyczyszczenie urządzenia. Zadziała przy najbliższym połączeniu telefonu.”; wiersz natychmiast zmienia stan; wpis audytu bez tokenów (W-18, nowe etykiety: „Wylogowanie urządzenia”, „Zablokowanie i wyczyszczenie urządzenia”). Kolumna „niewysłane elementy” **nie** w M2 (pytanie 9 planu) — nie rysujemy pustej kolumny.
- **Responsywność:** `compact`/`medium` — karta na urządzenie (użytkownik jako nagłówek, stan jako tekst z ikoną, akcje w `⋮` ≥ 48 dp); filtry w BottomSheet/Drawer wg § 3.7.
- **Komponenty i tokeny:** Tabs (§ 3.17), DataTable (§ 3.6), ActionMenu (§ 3.20), AlertDialog z TextField (§ 3.13, wzór „potwierdź nazwą” — jak usuwanie klienta w W-14, jeśli istnieje; inaczej do styleguide'u), Banner (§ 4.10), Skeleton; ikony wyżej; `color.action.danger.*`.
- **Dostępność:** tabela z `th` i opisem; stan i poprawki jako tekst; menu `⋮` z nazwą „Akcje dla Pixel 7, Anna Testowa”; dialog z pułapką fokusu, fokus na „Anuluj”; wynik akcji ogłaszany `aria-live`.

---

## Dostępność WCAG 2.2 AA w aplikacji mobilnej — lista kontrolna dla M2
Dotyczy EVM-100…107 i dalszych; `ux-designer` sprawdza ją w przeglądzie UX każdej historyjki mobilnej (zrzuty w 360 px + TalkBack).
| Obszar | Wymóg |
|---|---|
| Cele dotyku (2.5.8, styleguide § 5.1) | Każdy element ≥ 48×48 dp (`size.touch-target.min`), akcje główne 56 dp, spust 72 dp; odstęp ≥ 8 dp; akcje niszczące osobno. Test: Maestro sprawdza rozmiary kluczowych przycisków. |
| Czcionki (1.4.4, 1.4.10) | Jednostki `sp`, skalowanie systemowe do 200% bez utraty treści i funkcji (przewijanie, zawijanie, przyklejone akcje nie zasłaniają pól); test na rozmiarze największym i „rozmiar wyświetlania” Android. Adres nigdy skracany. |
| Kontrast (1.4.3, 1.4.11, § 5.3) | Tekst ≥ 7:1 na jasnym tle, elementy interaktywne i ikony ≥ 3:1; stany tylko tokenami `color.*` (bez wartości z ręki); kapsuły SyncIndicator na własnym tle (§ 5.4). |
| TalkBack (4.1.2, 1.3.1) | Każdy element ma nazwę, rolę i stan; kolejność czytania = kolejność wizualna; nagłówki jako nagłówki; fokus na tytule po zmianie ekranu i po otwarciu dialogu (dialog zwraca fokus); zmiany stanów synchronizacji ogłaszane zbiorczo, co kilka sekund (4.1.3), nie każdy plik osobno. |
| Alternatywy dla gestów (2.5.1, 2.5.7) | Brak gestów jako jedynej drogi: przeciągnij-by-odświeżyć ma przycisk „Synchronizuj”; usuwanie, zmiana kolejności, zoom — przyciski. |
| Logowanie (3.3.8, 3.3.7) | Kod i hasło można wkleić i autouzupełnić; bez testów poznawczych; szkic wpisu i dane szybkiego zlecenia nie są wpisywane drugi raz (ponowne użycie danych po „Utwórz ponownie”). |
| Fokus (2.4.7, 2.4.11) | Klawiatura ekranowa i przyklejona akcja główna nie zasłaniają pola z fokusem (przewijanie do pola); widoczny fokus przy sterowaniu zewnętrzną klawiaturą / przełącznikami (`color.focus.ring`, na ciemnym `…-inverse`). |
| Orientacja i ruch (1.3.4, 2.3.3) | Pion i poziom; animacje (Skeleton, pasek) wyłączane przy „usuń animacje”; brak migania poza aparatem. |
| Błędy (3.3.1, 3.3.3) | Błąd przy polu i w podsumowaniu; komunikat mówi, co zrobić; kolor nigdy jedynym nośnikiem; ogłaszany (live region). |
| Czas (2.2.1) | Brak limitów czasu na wpisanie (poza 30 s ważnością kodu TOTP — komunikat „Kod wygasł, wpisz nowy”); blokady 5 min/7 dni zapowiadane tekstem. |
| Dane wrażliwe a dostępność | Tryb ukrytych danych nie renderuje także nazw dostępnych (§ 4.18); `FLAG_SECURE` nie wyłącza TalkBacka. |

---

## Otwarte decyzje (do Konrada / pozostałych specjalistów)
| # | Pytanie | Rekomendacja `ux-designer` |
|---|---|---|
| 1 | Jak technik dostaje nową wersję APK (M-02 „Aktualizacja wymagana” nie może odsyłać do Google Play — ADR-0019)? | Do czasu decyzji: „Poproś administratora o nową wersję”; docelowo link do strony pobierania w panelu (adres w konfiguracji). |
| 2 | Czy pokazać numer telefonu biura w M-11 (adres funkcyjny `pomoc@…` jest, numeru nie)? | Tak, numer funkcjonalny z konfiguracji (nie osoby); w terenie zgłoszenie przez telefon jest szybsze. |
| 3 | Chipy listy M-05 w M2: „Wszystkie” i „Niewysłane (n)” zamiast „Wszystkie/Moje/Czekamy na…”? | Tak (odstępstwo od makiety → wpis w changelogu styleguide'u). |
| 4 | „Utwórz ponownie” przenosi zależne wpisy i zdjęcia automatycznie? | Tak (architekt: czy sync-core dopuszcza ponowne wskazanie celu nowymi komendami). |
| 5 | Ostrzeżenie dnia 5–6 przed ukryciem danych (EVM-101)? | Tak — dopisać do AC2 EVM-101. |
| 6 | Czy technik może wyłączyć blokadę aplikacji po 5 min (M-09)? | `security-engineer`; UX: przełącznik pozostaje, jeśli polityka dopuszcza. |
| 7 | Potwierdzenie wyczyszczenia przez telefon (stan „Wyczyszczone” w W-17)? | Tak — wymaga endpointu potwierdzenia w EVM-090/094; bez niego tylko „Czeka na wyczyszczenie”. |
| 8 | „Kopiuj treść” z odrzuconego wpisu — kopia oznaczona jako wrażliwa i kasowana po 60 s? | `security-engineer` do oceny; UX: akcja zostaje (AC4 EVM-107 wymaga „danych do skopiowania”). |

## Zmiany w styleguide'zie do wpisania w jego changelogu (wykonuje Tech Lead)
- Propozycja P-14: stan urządzenia (StatusBadge, 4 wartości: ikona + etykieta, tokeny `color.feedback.*`) — W-15, W-17.
- Odstępstwo M2: chipy M-05 „Wszystkie / Niewysłane (n)” (decyzja 3 powyżej).
- Wzorzec „potwierdź nazwą” w AlertDialog (jeśli nie istnieje w § 4.11).
- Ekran pierwszego pobrania M-12 jako wzorzec „ładowanie jednorazowe” (Skeleton + ProgressBar + krok) w § 4.
