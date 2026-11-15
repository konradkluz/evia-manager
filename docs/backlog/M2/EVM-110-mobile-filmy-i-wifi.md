---
id: EVM-110
title: "Aplikacja: filmy i „filmy tylko przez Wi-Fi”"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P1
path: pelna             # pliki, dane osobowe na urządzeniu, synchronizacja offline
owner: mobile-developer
contributors: [ux-designer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-108, EVM-046, EVM-130, EVM-131]
---

# EVM-110: Aplikacja — filmy i „filmy tylko przez Wi-Fi”

## Cel
Jako **technik** chcę **nagrać film z oględzin lub montażu i wysyłać go tylko przez Wi-Fi, gdy tak ustawię**, aby **dokumentacja zawierała nagrania, a pakiet danych nie był zużywany na duże pliki**. Makieta [09](../../ux/flows/09-mobile-zdjecia-filmy-offline.md) (M-06, M-07, M-09) po poprawkach z EVM-108 (bez mikrofonu).

## Kontekst
Z EVM-108 (aparat, zapis oryginału w pamięci wewnętrznej aplikacji, kategoria, wspólny wiersz pliku w Kolejce, progi miejsca 2 GB / 100 MB, tryb ukrytych danych, kontrola paczki `verify`, przepływy Maestro 80–89), EVM-130 (zadanie systemowe, wznawianie od ostatniej części, powiadomienie prywatne) i EVM-131 (`CreateMediaAsset`, stany mediów w replice) ta historyjka dodaje **tryb „Film” w aparacie, limity nagrania, ustawienie „Filmy tylko przez Wi-Fi” i stan „Czeka na Wi-Fi”**. Serwer przyjmuje filmy MP4/MOV (H.264/HEVC) do 4 GB i 30 min (EVM-046, ADR-0009); film > 2 GB nie jest skanowany antywirusem (SR-FILE-12).

## Kryteria akceptacji

**AC1 — Film z kategorią zapisany trwale**
- Zakładając zalogowanego Administratora lub Edytora, otwarte zlecenie, zgodę na aparat i tryb „Film”
- Gdy wybieram kategorię (zasada jak dla zdjęcia: pierwsze nagranie w zleceniu wymaga wyboru, kolejne używają ostatniej), rozpoczynam i kończę nagranie
- Wtedy w jednej transakcji powstają: plik MP4 `<uuid>.mp4` w katalogu kolejki aplikacji (przeniesiony, nie skopiowany; nagranie 720p, 5 Mb/s, opcje filmu to jedna zamrożona stała z testem) i wpis w kolejce z komendą `CreateMediaAsset` — albo żadne z nich; ładunek ma dokładnie 5 kluczy (`id`, `workOrderId`, `mediaType = video`, `category`, `capturedAt`), bez `description` i `procedureStageId` (test dokładnego zbioru kluczy — od tego zależy RR-96); film nie trafia do galerii ani pamięci zewnętrznej; E2E na emulatorze z ustawioną lokalizacją potwierdza, że plik nie ma ścieżki dźwiękowej (`soun`) ani lokalizacji (`©xyz`, `loci`, `location`); po zapisie toast „Zapisano film w telefonie” z ogłoszeniem dla czytnika ekranu, a wiersz w Kolejce (wspólny komponent EVM-108) pokazuje ikonę `video`, czas trwania i rozmiar, bez nazwy klienta i adresu.

**AC2 — Limity nagrania i miejsce na dysku**
- Zakładając tryb „Film”
- Gdy nagranie osiąga 15 minut albo limit rozmiaru (1 000 000 000 B, liczony przy starcie jako mniejsza z wartości: 1 GB i wolne miejsce − 100 MB − 50 MB), wolne miejsce spada w trakcie poniżej 100 MB albo przed startem jest go mniej niż 200 MB
- Wtedy w trakcie nagrania widać licznik „0:42 / 15:00” (rola `timer`, ogłoszenia tylko na starcie, minutę przed końcem i po zatrzymaniu), a na minutę przed końcem ostrzeżenie z ikoną; po limicie nagranie kończy się samo, film zapisuje się normalnie z komunikatem „Osiągnięto limit 15 minut — film zapisano.” (przy rozmiarze: „Osiągnięto limit rozmiaru — film zapisano.”); przy spadku miejsca poniżej 100 MB nagranie kończy się i zapisuje z „Brak miejsca — nagranie zatrzymano i zapisano.”; przy mniej niż 200 MB przed startem chip „Film” jest wyłączony z ikoną `hard-drive` i tekstem „Za mało miejsca na film. Zwolnij miejsce w telefonie.”, a zdjęcia działają wg progów EVM-108 (ostrzeżenie 2 GB bez zmian); nieudany zapis daje „Nie udało się zapisać filmu. Nagraj go ponownie.”; w każdym przypadku błędu kolejka i licznik są nietknięte, bez niepełnego pliku i bez wpisu bez pliku; każdy film z telefonu jest poniżej progu skanu antywirusowego (2 000 000 000 B).

**AC3 — Przerwane nagranie i wylogowanie w trakcie**
- Zakładając trwające nagranie (ekran nie wygasa podczas nagrywania)
- Gdy aplikacja traci pierwszy plan (połączenie, Home, blokada ekranu), naciskam Wstecz, ✕ albo gest cofania, następuje wylogowanie lub „Zablokuj i wyczyść”, albo proces zostaje zakończony (wymuszone zamknięcie, wyczerpana bateria)
- Wtedy aplikacja jawnie zatrzymuje nagranie, a poprawny plik zapisuje się jak zwykły film bez dialogu (komunikat „Nagrywanie przerwane — zapisano 2:13 filmu.”); wylogowanie i czyszczenie danych najpierw zatrzymują nagranie, potem czyszczą; po zakończeniu procesu plik jest nieodtwarzalny, usuwa go odśmiecacz (nie usuwa trwającego nagrania — wiek liczony od ostatniej modyfikacji), a po następnym uruchomieniu widać jednorazowo „Poprzednie nagranie zostało przerwane i nie zostało zapisane.”; w kolejce nigdy nie ma wiersza uszkodzonego filmu.

**AC4 — „Filmy tylko przez Wi-Fi”: czekanie i start**
- Zakładając ustawienie „Filmy tylko przez Wi-Fi” w „Więcej → Wysyłanie” (domyślnie włączone — do potwierdzenia przez Konrada; lokalne dla telefonu, zostaje po wylogowaniu, wyłączenie bez dialogu) i telefon z samą siecią z opłatami za transfer (komórkową, Wi-Fi oznaczone jako sieć z pomiarem albo hotspot z telefonu)
- Gdy w kolejce są film, zdjęcia i wpisy
- Wtedy ograniczenie obejmuje wyłącznie pliki `video/*` — zdjęcia i wpisy wysyłają się normalnie; film ma w wierszu stan „Czeka na Wi-Fi” (ikona `wifi`, `color.sync.waiting-wifi.*`; od 1 doby z wiekiem, np. „od 2 dni”) bez „Wymaga uwagi”, bez powiadomienia o błędzie i bez wliczania do „Nie wysłano n plików”; Kolejka ma baner zbiorczy „n filmów czeka na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.” z linkiem „Zmień ustawienie”; po połączeniu z siecią bez opłat film rusza sam, także gdy aplikacja jest zamknięta; zmiana ustawienia ponownie uzbraja oczekujące filmy (wyłączenie → rusza przez dowolną sieć); stan wylicza aplikacja bez nowych uprawnień.

**AC5 — Zmiana sieci w trakcie wysyłki i czekanie ponad 7 dni**
- Zakładając film wysyłany przez Wi-Fi przy włączonym ustawieniu oraz film czekający na Wi-Fi ponad 7 dni (serwer oznaczył plik bez sesji jako `failed` / `abandoned`)
- Gdy telefon traci Wi-Fi i zostaje przy sieci komórkowej, a potem wraca do Wi-Fi; albo po 7 dniach telefon łączy się z Wi-Fi
- Wtedy przy zmianie sieci wysyłanie wstrzymuje się bez błędu (wiersz „Czeka na Wi-Fi”, zero nowych części przez sieć z opłatami) i po powrocie wznawia się bez duplikatu i z poprawną sumą kontrolną; film czekający ponad 7 dni wysyła się sam po połączeniu z Wi-Fi jako to samo medium (ten sam `assetId`, nowa sesja, części przerwanej wysyłki zaczynają się od nowa), bez „Ponów” i bez „Wymaga uwagi”, 0 duplikatów (test jednostkowy; bez zmian na serwerze).

**AC6 — Przełącznik „Zdjęcie / Film”, role i stany aplikacji**
- Zakładając ekran aparatu z EVM-108, różne role i stany aplikacji
- Gdy otwieram aparat
- Wtedy pod chipami kategorii są dwa FilterChip „Zdjęcie” i „Film” (grupa radio „Tryb”, domyślnie „Zdjęcie” przy każdym otwarciu; kategoria wspólna; w trakcie nagrania przełącznik i kategorie wyłączone); w trybie Film widać znacznik „Film bez dźwięku” (`volume-off`), spust zmienia ikonę `circle` → `square`, cele dotyku ≥ 48 dp, 200% czcionki bez ucinania; Administrator i Edytor nagrywają, Tylko odczyt nie loguje się do aplikacji (`403 channel_not_allowed`), niezalogowany widzi ekran logowania; offline nagrywanie działa bez banera offline (kapsuła „Offline · n”); w trybie ukrytych danych nagrywanie działa, a wiersze filmów w Kolejce nie pokazują numeru zlecenia; blokada aplikacji i wymuszone czyszczenie danych firmowych działają jak dla zdjęć (pliki filmów usuwane wg EVM-130 AC5).

**AC7 — Bez dźwięku i bez mikrofonu (`tools/mobile-apk verify`)**
- Zakładając paczkę z nagrywaniem filmów
- Gdy nagrywam film (emulator) i uruchamiam `verify`, lint i testy
- Wtedy widok aparatu ma wyciszenie (`mute`) zawsze włączone — bez niego nagrywanie żąda `RECORD_AUDIO` (test jednostkowy zamrożonej stałej opcji filmu, jak `PICTURE_OPTIONS`); aplikacja nie prosi o mikrofon, allowlista uprawnień nie rośnie ponad `CAMERA` (paczka z `RECORD_AUDIO` albo innym dodatkowym uprawnieniem jest odrzucana — test negatywny, komunikat `verify` jako zakaz stały, bez „from EVM-110 only”), a kontrole telemetrii z EVM-108 AC8 (brak ML Kit, Firebase, usług Google) pozostają zielone.

**AC8 — Trzy filmy bez duplikatów po przerwach**
- Zakładając 3 filmy (do 128 MiB każdy: syntetyczny MP4 z haka e2e i krótkie nagranie aparatem emulatora) zapisane bez zasięgu tą samą ścieżką zapisu co aparat, włączone „tylko Wi-Fi” i serwer scenariuszy z sesjami wysyłania
- Gdy symuluję przejście z sieci z opłatami na sieć bez opłat, zerwanie połączenia w trakcie części i wymuszone zamknięcie aplikacji w trakcie wysyłki
- Wtedy punkt kontrolny serwera pokazuje 3 obiekty w właściwym zleceniu, po jednym na `assetId`, zgodne sumy SHA-256, 0 duplikatów i 0 osieroconych multipartów po zakończeniu, a wiersze mają stan „Wysłano”; film ≥ 500 MB, realne sieci i pomiary na telefonie sprawdza EVM-112 (`manual`; emulator ≤ 128 MiB).

## Poza zakresem
Dźwięk i mikrofon (decyzja 6); wybór jakości nagrania przez technika; pauza i wznowienie nagrania; latarka; film z galerii, podgląd przed zapisem, odrzucanie i usuwanie niewysłanego filmu; opis i etap filmu; edycja, przycinanie i kompresja; „Wyślij teraz przez sieć komórkową” (wystarcza wyłączenie ustawienia); lista zaufanych sieci Wi-Fi; „tylko Wi-Fi” dla zdjęć i wpisów; ustawienie zsynchronizowane z serwerem; ostrzeżenie po 5 dniach i „Wymaga uwagi” po 7 dniach czekania; ekran „Pliki zlecenia” i przyczyny błędów (EVM-111); pomiary na fizycznym telefonie, film ≥ 500 MB, bateria, ruch sieciowy (EVM-112); odrzucanie audio i limitu 2e9 po stronie serwera dla kanału `mobile` (backlog); iOS.

## Decyzje i ograniczenia
- **Rozstrzygnięte:** decyzja 6 (Konrad, 2026-11-14) — filmy bez dźwięku, aplikacja bez mikrofonu; **technicznie: `mute` w widoku aparatu zawsze włączone** (nie `recordAudioAndroid`, bo projekt nie używa tej wtyczki); „tylko Wi-Fi” = sieć bez opłat za transfer, ustawienie lokalne; zdjęcia i wpisy nie czekają na Wi-Fi, „Czeka na Wi-Fi” nie jest błędem; hotspot z telefonu to sieć z opłatami (film czeka; pozycja `manual` Op w EVM-112); film ≥ 500 MB sprawdzany w teście terenowym; dystrybucja na test bez warunku EVM-084, stałe używanie po sign-offie EVM-132; bez nowego ADR i bez zmiany kontraktu API.
- **Do potwierdzenia przez Konrada (rekomendacja architekta i security):** (1) „tylko Wi-Fi” domyślnie włączone; (2) nagranie 720p, 5 Mb/s (ok. 37,5 MB/min), limit 15 min i 1 000 000 000 B (każdy film poniżej progu skanu 2 000 000 000 B; limit rozmiaru w bibliotece to `Int`, nigdy powyżej 2³¹−1); (3) „Film wyłączony” poniżej 200 MB wolnego miejsca (próg blokady 100 MB + zapas 50 MB + ok. minuta filmu); (4) przerwanie: zapis przy utracie pierwszego planu, utrata nagrania przy zabiciu procesu; (5) przełącznik domyślnie „Zdjęcie”.
- **Film czekający ponad 7 dni:** serwer oznacza plik bez sesji `failed` / `abandoned`, ale nowa sesja wznawia ten sam `assetId`, a telefon ignoruje ten stan dla wiersza oczekującego; panel pokazuje taki film jako porzucony do czasu wysyłki (znane, bez zmian na serwerze).
- **UX / UI (konsultacja UX, skrót):** przełącznik, licznik, spust, ostrzeżenie minutę przed końcem i komunikaty wg AC1–AC3, AC6; znacznik „Film bez dźwięku” tylko w trybie Film, zero próśb o mikrofon; „Więcej → Wysyłanie” z opisem zużycia danych przy włączonym i wyłączonym ustawieniu (ok. 40 MB na minutę przy parametrach wyżej); baner zbiorczy „Czeka na Wi-Fi” w Kolejce; wiersz filmu ze wspólnego komponentu. Zmiany dokumentów UX: makieta 09 (M-06, M-07, M-09), styleguide § 3.4, § 3.24, § 4.14, § 5.4 i changelog § 8; brak nowych komponentów i tokenów. Stany: pusty, ładowanie („Uruchamianie aparatu…”), błąd, offline, brak zgody (EVM-108 AC3), brak miejsca (AC2).
- **Bezpieczeństwo i prywatność (konsultacja security, skrót):** `RECORD_AUDIO` zabronione; ładunek filmu bez `description` (RR-96); import filmu to rozszerzenie reguł TM-140 na MP4 i wymaga przeglądu security-engineera; wylogowanie i czyszczenie w trakcie nagrania najpierw zatrzymują nagranie (Medium, AC3); film chroniony szyfrowaniem urządzenia (RR-98); ocena RR-100 przy aktywnym użyciu `camera-video` — security-engineer w przeglądzie.
- **Konsultacja architekta (skrót):** polityka sieci `video/*` w Kotlinie (dziś `UNMETERED` dla całej partii), testy JVM; bez nowych uprawnień (`ACCESS_NETWORK_STATE` już jest).

## Notatki techniczne
- **Etapy (jeden przebieg `/deliver`; bramki po każdym):** (1) natywnie, bez interfejsu: import MP4 (`<uuid>.mp4`, `ftyp` na offsecie 4, rozmiar 1 B – limit, `Files.move` bez nadpisania w tym samym woluminie, **bez kopii i bez twardego dowiązania** — SELinux je blokuje, wiemy z EVM-108), `.mp4` w odśmiecaczu i czyszczeniu, polityka sieci dla `video/*`, ponowne uzbrajanie, wyliczenie sieci bez opłat, testy JVM, komunikat `verify`; na początku 15-minutowe sprawdzenie, czy emulator nagrywa i czy `svc wifi disable` daje sieć z opłatami; (2) aparat: przełącznik, stała opcji, nagranie → import → kolejka, zatrzymanie w tle, licznik i limity (AC1–AC3, AC6, AC7); (3) ustawienie „tylko Wi-Fi”, stan „Czeka na Wi-Fi”, test 7 dni (AC4, AC5); (4) E2E (Maestro 90–9x) i dokumenty (AC8). **Linia cięcia:** jeśli po etapie 2 się nie mieści, etapy 3–4 przechodzą do nowej historyjki.
- Operacje na dużych plikach (import, skrót, uzbrajanie) natywnie, poza wspólnym wątkiem modułów. Wygaszanie ekranu: `expo-keep-awake` jest w drzewie przez `expo`; bezpośrednie użycie wymaga uzasadnienia SR-SUPPLY-06 albo flaga natywna — wybór w planie realizacji.
- Low (security, do backlogu i dokumentów): model urządzenia i `creation_time` w MP4 (wpis w `rodo.md`); „wiecznie czekający” film widoczny w panelu jako porzucony; `FLAG_SECURE` i koniec nagrania po zablokowaniu ekranu — `manual` w EVM-112. Wiek filmu czekającego liczony od ostatniej modyfikacji pliku.
- Emulator, `expo-camera` 58.0.14: sprawdzić `mute`, limity czasu i rozmiaru oraz zatrzymanie w tle; hotspot z telefonu opisać technikowi.

## Definition of Done
- [ ] AC1–AC8 pokryte testami oznaczonymi `EVM-110 AC#` (Jest, Maestro na emulatorze, `node:test` dla `verify` i serwera scenariuszy, testy JVM); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzje: code-reviewer, security-engineer, ux-designer (statycznie) — approve; kryteria `manual` widoczne w EVM-112; `CHANGELOG.md`.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-11-14 — decyzja 6 (bez dźwięku, bez mikrofonu) wpisana, `depends_on` + EVM-130, EVM-131; status `draft`, doprecyzowanie w kolejnej nocy (product-owner)
- 2026-11-15 — z doprecyzowania EVM-108: lista plików reużywa wspólnego komponentu z EVM-108, makieta 09 bez mikrofonu; dystrybucja bez warunku EVM-084 (Tech Lead)
- 2026-11-15 — doprecyzowanie `/refine`: 8 AC (nagranie, limity i miejsce, przerwania, „tylko Wi-Fi”, zmiana sieci i 7 dni, przełącznik i role, bez dźwięku, E2E 3 filmów), etapy realizacji, pytania do Konrada z rekomendacjami; status `draft` (product-owner)
- 2026-11-15 — naniesiono konsultacje architekta, security i UX oraz rozstrzygnięcia Tech Leada: `mute` zamiast `recordAudioAndroid`, 720p / 15 min / 1 GB, próg 200 MB, wysyłka filmu po 7 dniach tym samym medium, polityka sieci `video/*`, import przez przeniesienie pliku, nowe etapy; status `draft` (product-owner)
