---
id: EVM-112
title: "Test terenowy w garażu i dystrybucja"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
priority: P1
path: pelna             # kryterium wyjścia M2, dane na urządzeniu
owner: qa-engineer
contributors: [mobile-developer, devops-engineer]
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-105, EVM-106, EVM-110, EVM-130, EVM-131]
---

# EVM-112: Test terenowy w garażu i dystrybucja

> **Podział 2026-11-15 (decyzja Konrada „podziel 112 na dwie”):** ta historyjka zostaje częścią praktyczną (test na telefonach i dystrybucja paczki); checklista MASVS L1, warunek RR-96 i utrata telefonu przeszły do [EVM-132](EVM-132-sign-off-wydania-aplikacji.md), żeby „papier” nie blokował wyjścia aplikacji w teren.

## Cel
Jako **Konrad** chcę **potwierdzić w prawdziwych warunkach, że aplikacja nie gubi ani nie dubluje danych, i zainstalować ją na telefonach testowych**, aby **zamknąć praktyczną część M2 i przekazać wyniki do sign-offu (EVM-132)**.

## Kryteria akceptacji

**AC1 — Test terenowy w garażu**
- Zakładając telefon ze spisu testu (decyzja o telefonach i osobach: niżej) z APK podpisanego lokalnie, spełnione warunki wejścia, zlecenie testowe (niżej), konta Administratora (Konrad) i Edytora (technik) oraz garaż podziemny bez zasięgu
- Gdy technik wykonuje 30 zdjęć, 3 filmy (w tym co najmniej jeden ≥ 500 MB — przy 720p i 5 Mb/s to ok. 13–15 min nagrania, limit filmu to 15 min) i 2 wpisy, wymuszamy zamknięcie aplikacji w trakcie wysyłki, a po wyjściu na zasięg i Wi-Fi czekamy do końca wysyłania
- Wtedy w zleceniu jest dokładnie 33 media (30 zdjęć i 3 filmy, wszystkie w stanie gotowym, filmy odtwarzają się w panelu) i 2 wpisy w dzienniku, 0 duplikatów i 0 strat, żaden wiersz Kolejki nie ma stanu „Wymaga uwagi”, a wynik jest zapisany w raporcie; jakakolwiek strata albo duplikat = wynik NOK i błąd z priorytetem blokującym M2.

**AC2 — Dystrybucja: podpis lokalny i instalacja**
- Zakładając APK z przebiegu CI na `main` z zielonym `ci-gate` (SHA-256 z podsumowania przebiegu), w którym CI ustawia hosty magazynu (`EVIA_STORAGE_HOSTS` — dziś nieustawione, więc paczka z `main` nie wysyła plików; devops-engineer zmienia CI i akapit „Zakaz dystrybucji” w `docs/ops/dystrybucja-apk-android.md`, wciąż wiążący wysyłanie z EVM-084), i klucz podpisu Konrada
- Gdy Konrad podpisuje paczkę lokalnie (`sign` z oczekiwanym SHA-256 i odciskiem certyfikatu — RR-21, RR-32) i administrator instaluje ją na telefonach testowych bez wcześniejszej wersji aplikacji (RR-97)
- Wtedy skrypt wypisuje ścieżkę, SHA-256 pliku i certyfikatu (zapisane w raporcie), aplikacja uruchamia się, loguje (hasło + kod), pobiera dane i synchronizuje, a po instalacji uprawnienie „Instalowanie nieznanych aplikacji” jest cofnięte; paczka z innym odciskiem certyfikatu albo SHA-256 niezgodnym z CI jest odrzucona przez skrypt i nie jest instalowana.

**AC3 — Wymuszenie minimalnej wersji**
- Zakładając serwer z minimalną wersją aplikacji wyższą niż zainstalowana i telefon z zasięgiem
- Gdy uruchamiam aplikację
- Wtedy widzę ekran „Aktualizacja wymagana” z instrukcją „poproś administratora” (decyzja 10), a po zainstalowaniu nowszej wersji podpisanej tym samym kluczem aplikacja działa, a kolejka plików i wpisów jest nietknięta; po teście minimalna wersja wraca do poprzedniej wartości.

**AC4 — Sprawdzenia `manual` na telefonie**
- Zakładając listę sprawdzeń z tabeli niżej (O = obowiązkowe, Op = opcjonalne)
- Gdy qa-engineer i Konrad wykonują je na telefonach testowych
- Wtedy każde sprawdzenie O ma w raporcie wynik OK albo NOK z dowodem (notatka, zrzut bez danych osobowych); NOK to błąd z oceną wpływu, a M2 zamyka się tylko przy wszystkich O = OK albo NOK z decyzją Konrada o akceptacji; Op — „wykonano / nie wykonano” z wynikiem, bez blokady.

**AC5 — Pomiar wyszukiwania (EVM-103 AC7)**
- Zakładając telefon referencyjny, paczkę zbudowaną w trybie wydania z serwerem scenariuszy (niedystrybuowaną) i 300 syntetycznych zleceń w zakresie urządzenia
- Gdy wpisuję zapytanie o długości ok. 20 znaków (co najmniej 20 pomiarów)
- Wtedy p95 czasu odświeżenia listy ≤ 300 ms; wynik trafia do raportu, a przekroczenie jest błędem EVM-103 z decyzją Konrada.

**AC6 — Scenariusze magazynu Scaleway (`media-pipeline.md` §5)**
- Zakładając magazyn w jedynym środowisku i plik syntetyczny w zleceniu testowym
- Gdy devops-engineer sprawdza: (1) część o długości innej niż podpisana jest odrzucana (`403`), (2) powtórka `complete` kończy się sukcesem także przy `NoSuchUpload` (kontrola obiektu), (3) przerwany multipart jest sprzątany
- Wtedy wyniki trzech scenariuszy są w raporcie przed AC1, a rozbieżność względem SeaweedFS jest poprawiona (albo opisana w dokumencie z decyzją Konrada), zanim ruszy test w garażu.

**AC7 — Raport i przekazanie do sign-offu**
- Zakładając wykonane AC1–AC6
- Gdy qa-engineer składa raport w `docs/qa/EVM-112/` (kamień milowy)
- Wtedy raport zawiera wersję aplikacji, modele telefonów i wersje Androida z poziomem poprawek (bez numerów seryjnych i IMEI), wyniki AC1–AC6, tabelę sprawdzeń, listę NOK z decyzjami i potwierdzenie usunięcia zlecenia testowego; Konrad ocenia praktyczną część kryterium wyjścia M2 jako spełnioną albo nie, a raport jest wejściem do EVM-132.

### Lista sprawdzeń `manual` (AC4)
Zebrana z EVM-109, 130, 131, 128, 102, 108 i 110. Sesje: G — w garażu i po wyjściu, B — „na biurku” (ok. 30 min), S — z monitorowaniem ruchu.

| Nr | Sprawdzenie | Źródło | O/Op | Sesja |
|---|---|---|---|---|
| M1 | Wysyłanie w tle po zablokowaniu ekranu i odłożeniu telefonu: Android 14+ (zadanie z priorytetem użytkownika) i Android 13 (zwykłe zadanie) | 130 | O | G |
| M2 | Telefony agresywnych producentów (Xiaomi, Huawei, OPPO) nie zabijają wysyłania po ~15 min — tylko jeśli technik ma taki telefon | 130 | Op | G |
| M3 | Android 13 (SM-G781B): limit okna 10 min, wznawianie od ostatniej części, czas wysłania dużego filmu | 130, decyzja 21 | O | G |
| M4 | Po restarcie telefonu wysyłanie rusza dopiero po pierwszym odblokowaniu | 130, RR-98 | O | B |
| M5 | Powiadomienie na ekranie blokady: wygląd, wersja publiczna „EVia Manager”, brak danych klienta, zachowanie bez zgody (Android 13) | 130 | O | B |
| M6 | Galeria, aplikacja Pliki i Zdjęcia Google (także chmura) puste; zdjęcie bez GPS w EXIF oraz film MP4 bez lokalizacji i bez audio przy włączonej lokalizacji systemu — Konrad pobiera oryginał testowy z panelu i sprawdza lokalnie `exiftool` / `ffprobe` | 130, 108, 110 | O | G |
| M7 | Ruch sieciowy całej sesji (aparat, zdjęcie, film, wysyłanie) rejestrowany PCAPdroid (open source, bez roota, filtr aplikacji): tylko panel i hosty magazynu; ruch usług Google idzie innym procesem — pokrywa go kontrola statyczna `verify` / `deps` | 130, 108 AC4 | O | S |
| M8 | `FLAG_SECURE` na ekranie aparatu i nagrywania (zrzut ekranu, „Ostatnie”, koniec nagrania po zablokowaniu ekranu) | 130, 101, 110 | O | B |
| M9 | Film ≥ 500 MB: przełączanie Wi-Fi ↔ LTE, „tylko Wi-Fi” w realnych sieciach, wznowienie bez duplikatu; hotspot z innego telefonu (sieć z pomiarem) | 110 AC8 | O (hotspot: Op) | G |
| M10 | „Zablokuj i wyczyść” w trakcie wysyłki, na końcu testu na jednym telefonie: pliki znikają, wysyłanie się kończy, telefon potwierdza serwerowi; to samo ćwiczenie jest dowodem do EVM-132 AC3 | 130 | O | G |
| M11 | Bateria: zużycie podczas wysyłania dużego filmu (obserwacja, bez progu) | 130 | Op | G |
| M12 | Układ na 360 dp i 200% czcionki oraz TalkBack („Zapisano zdjęcie n”, „Zapisano film n”): aparat, Kolejka, alert „Utwórz ponownie”; układ poziomy — Op | 128, 108, 110 | O | B |
| M13 | Czytelność klauzul (M-11) na 360 dp i 200%, Disclosure, „Kopiuj adres” | 102 | O | B |
| M14 | Monity systemowe aparatu i powiadomień przy pierwszym uruchomieniu (Android 13 i 14+), odmowa, odmowa trwała i powrót z ustawień | 108 AC3 | O | B |
| M15 | Kontrast panelu aparatu w słońcu, spust w rękawicy | 108 | Op | G |
| M16 | Film prawdziwym aparatem: limit 15 min kończy nagranie i zapisuje; film odtwarza się w panelu bez dźwięku; brak wskaźnika mikrofonu w telefonie | 110 AC2, AC7 | O | G |
| M17 | Przerwania nagrania: połączenie telefoniczne w trakcie nagrywania (zapis „Nagrywanie przerwane — zapisano …”); wymuszone zamknięcie w trakcie nagrania (brak pliku i komunikat po starcie) | 110 AC3 | O | G |
| M18 | Telefon z < 200 MB wolnego miejsca: chip „Film” wyłączony, zdjęcia działają | 110 AC2 | Op | B |
| M19 | Film czeka na Wi-Fi: stan i wiek, rusza po Wi-Fi przy zamkniętej aplikacji, najdłuższy zmierzony czas oczekiwania zapisany do EVM-132 AC4 (reguła 7 dni — tylko testy automatyczne) | 110 AC4, AC5 | O | G |

## Poza zakresem
Checklista MASVS L1, warunek RR-96, procedura utraty telefonu i spis floty (EVM-132); stałe używanie aplikacji przez techników (po sign-offie EVM-132); test MASTG i pentest; macierz ról (testy automatyczne EVM-094/131); test na iOS; Google Play; pomiary kosztów i kopie zapasowe mediów (EVM-084, RR-91).

## Decyzje i ograniczenia
- **Telefony (pytanie do Konrada):** decyzja 4 (2026-11-01) — prywatne (BYOD); security rekomenduje telefony firmowe na czas testu (mniej formalności). AC piszą neutralnie „telefon ze spisu testu”; maks. 3 telefony w spisie w raporcie (model, Android, poziom poprawek, firmowy/prywatny — bez nazwisk), wchodzą do spisu floty EVM-132. Przy prywatnym telefonie — oświadczenie (wzór 2). MASVS v2.1 zastępuje „L1+” z v1.
- **Uproszczenie 2026-11-12:** test w garażu zostaje kryterium wyjścia M2; MASVS jako checklista L1 w sign-offie wydania 1.1 — od 2026-11-15 w EVM-132.
- **Warunki wejścia — formalności (security):** klauzula dla pracowników o aplikacji (checklista wydania S8); upoważnienie, poufność i informacja o audycie dla każdego technika **przed pierwszym logowaniem** (przy umowie o pracę informacja ≥ 2 tygodnie wcześniej — pytanie do Konrada o formę zatrudnienia); jeden datowany akapit ponownej oceny DPIA dla zakresu testu (pisze security-engineer, akceptuje Konrad).
- **Bezpiecznik „wiecznego testu”:** test kończy się **2026-12-13 (RR-91) albo sign-offem EVM-132, co nastąpi pierwsze**; wersja testowa niższa niż wydanie; po terminie bez sign-offu Konrad podnosi `MIN_SUPPORTED_APP_VERSION_ANDROID`. Utrata telefonu w trakcie testu: zgłoszenie do Konrada → „Zablokuj i wyczyść”.
- **Warunki wejścia (stan 2026-11-15):** EVM-110 gotowe; EVM-131 wdrożone; paczka z CI wysyłająca pliki (AC2); AC6 wykonane przed AC1; klucz podpisu istnieje (pytanie do Konrada); dystrybucja bez warunku EVM-084 (**decyzja Konrada 2026-11-15:** test nie czeka na EVM-084; media chroni wersjonowanie i blokada usunięcia 30 dni w buckecie, kopie bazy — RR-91, termin 2026-12-13; technicy dostają paczkę z aparatem i wysyłaniem na ten test; stałe używanie — po sign-offie EVM-132).
- **Środowisko z realnymi danymi (RR-93):** test na zleceniu testowym ze znacznikiem „TEST EVM-112” i klientem syntetycznym `example.*`, zakładanym przez Konrada lub biuro; bez osób, tablic rejestracyjnych i wnętrz klientów w kadrze; media i zlecenie usunięte ≤ 7 dni po raporcie (pliki w buckecie wygasają z blokadą 30 dni); raport bez zrzutów z produkcji; konta techników prawdziwe.
- **UX / UI:** historyjka bez nowego UI. **Bezpieczeństwo i prywatność (konsultacja security, skrót):** paczka wyłącznie z przebiegu CI na `main` z zielonym `ci-gate`, podpis lokalny, instalacja przez administratora, kontrola SHA-256 i certyfikatu; obowiązkowe sprawdzenia M5–M8, M10 (galeria i chmura, EXIF i MP4, PCAPdroid, `FLAG_SECURE`, powiadomienie bez danych klienta, wyczyszczenie w trakcie wysyłki); dane testowe bez osób trzecich.
- **Pomiar AC5:** wariant e2e paczki jest osobnym wariantem (EVM-130: `verify` odrzuca paczkę release ze znacznikiem serwera scenariuszy), więc pomiar wymaga budowy w trybie wydania z tym znacznikiem — developer potwierdza, że wynik jest reprezentatywny; „referencyjny średni Android” z EVM-103 trzeba wskazać (SM-G781B to model z wyższej półki — do ustalenia).
- Wcześniejsze „kryteria `manual` z historyjek nocy 2026-11-14” i lista z EVM-108 są w tabeli wyżej (każda pozycja ma numer M#); opcjonalne pozycje (Op) nie blokują zamknięcia M2.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-12 — AC2: MASVS L2 → checklista L1 w security sign-offie wydania 1.1; usunięto zależność od EVM-102; test w garażu bez zmian (decyzja Konrada 2026-11-12 / Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”)
- 2026-11-13 — dopisane przy teście terenowym: pomiar AC7 EVM-103 (wyszukiwanie na liście, 300 syntetycznych zleceń, p95 ≤ 300 ms na referencyjnym średnim Androidzie, kompilacja wydania) — decyzja Konrada 2026-11-13 (Tech Lead)
- 2026-11-14 — `depends_on` + EVM-084, EVM-130, EVM-131; dopisano warunki wejścia i listę kryteriów `manual` (product-owner; decyzja Konrada 2026-11-14)
- 2026-11-15 — decyzja Konrada: EVM-084 nie blokuje testu terenowego — usunięta z `depends_on` i z warunków wejścia; technicy dostają paczkę z wysyłaniem na test terenowy wcześniej, a do EVM-084 wracamy później (Tech Lead)
- 2026-11-15 — z doprecyzowania EVM-108: jej kryteria `manual` (lista w „Decyzjach i ograniczeniach” EVM-108) do przeniesienia tutaj przy doprecyzowaniu tej historyjki (Tech Lead)
- 2026-11-15 — naniesiono konsultacje security i rozstrzygnięcia Tech Leada: formalności i bezpiecznik terminu (2026-12-13), paczka z CI wysyłająca pliki (devops w AC2), zlecenie testowe z `example.*`, obowiązkowe M5–M8 i M10 wg security, parametry filmu (15 min, 720p) w M16 i AC1, telefony neutralnie (product-owner)
- 2026-11-15 — **podział** (decyzja Konrada „podziel 112 na dwie”): tu zostają AC1 (test) i AC3 (dystrybucja, teraz AC2–AC3) oraz skonsolidowana lista `manual` (M1–M19) z EVM-103, 109, 130, 131, 128, 102, 108 i 110; dotychczasowe AC2 (MASVS L1), AC4 (utrata telefonu, spis floty), warunek sign-offu RR-96 i „stałe używanie po sign-offie” przeniesione do nowej EVM-132; tytuł zmieniony na „Test terenowy w garażu i dystrybucja”; nowe AC5–AC7 (pomiar, Scaleway, raport), status `draft` (product-owner)
