# EVM-142 — dowód AC5 i scenariusze e2e na emulatorze Androida

Historyjka: [EVM-142](../../backlog/M2/EVM-142-mobile-podglad-zdjec-zlecenia.md) (AC2–AC5). Data: 2026-11-23. Wykonawca: mobile-developer. Środowisko (ADR-0015): emulator `sdk_gphone64_x86_64`, Android 15 (API 35, obraz Google Play, bez `adb root`), Maestro 2.11.0, wariant e2e (`debuggable`, `run-as`), build z krótkiego klonu `C:\e` (droga A, `docs/ops/dystrybucja-apk-android.md`), commit `7c76f6e1` + zmiany robocze tej historyjki. Dane wyłącznie syntetyczne; aplikacja łączy się tylko z serwerem scenariuszy (`10.0.2.2`), nigdy z panelem ani stagingiem.

## Werdykt: ZIELONO (z dwiema uwagami do decyzji, § 5)

Cztery scenariusze `photos-*` (22 przepływy Maestro) przeszły. W dowodzie AC5 **nie znaleziono żadnego pliku obrazu ani adresu na dysku telefonu i żadnego wycieku do logcat**, a kontrola dodatnia na tej samej instalacji znalazła plik cache i linię logu (dowód ważny). `FLAG_SECURE` na paczce release potwierdzony.

## 1. Jak to działa

`node tools/mobile-e2e/cli.mjs --only photos-` (po budowie: `--skip-build --only photos-`). Serwer scenariuszy ma część zdjęć (`src/photos-stub.mjs`): replika (3 zdjęcia `ready`, 1 `processing`, 1 w kwarantannie), `createMediaAssetDownloadUrl` dla kanału `mobile`, bucket z `Cache-Control: private, max-age=300` (celowo najgorszy przypadek), sterowanie błędami (403 wygasły adres, 500, 429, opóźnienie obrazu). Kroki urządzenia: `src/device-photos.mjs`. Opis: `tools/mobile-e2e/README.md`.

Przeszukanie (krok `photos-disk-baseline` / `photos-disk-check`): `grep -r -l -a WEBPVP8` i `E2EMARK` w `/data/data/pl.eviacharge.manager` (przez `run-as`) i `/sdcard/Android/data/pl.eviacharge.manager`, `ls cache/http-cache`; bufor logcat 16 MiB wyczyszczony po logowaniu; filtr logu: `10.0.2.2:<port>/bucket`, `/bucket/photos/`, `X-Amz-Signature`, `E2EMARK` poza wierszami sterownika Maestro (pusty log = porażka).

## 2. Wyniki scenariuszy (AC → scenariusz → status)

| AC | Scenariusz / przepływy | Wynik |
| --- | --- | --- |
| AC2 | `photos-grid` (140): wiersz „Zdjęcia zlecenia” „5 zdjęć”, kafelki „[kategoria], [czas]”, „Przygotowujemy podgląd”, „Plik zatrzymany do sprawdzenia”, brak nazw plików i klienta; serwer: 3 adresy i 3 obrazy miniatur, **0 żądań dla `processing` i kwarantanny**, 0 podglądów, 0 oryginałów; wszystkie żądania z `no-store`, bez `Authorization`/`Cookie`/`_=` | passed |
| AC3 | `photos-preview` (141): podgląd z kategorią, czasem, opisem i „Zamknij podgląd”; wygasły adres (403) → **2 adresy, 2 żądania obrazu**, bez komunikatu; 500 → „Nie udało się wczytać zdjęcia” + „Spróbuj ponownie”, **bez drugiego adresu**; ponowienie po usunięciu błędu → nowy adres, obraz; 429 adresu → ten sam komunikat, po `Retry-After` ponowienie działa | passed |
| AC4 | `photos-offline` (142): tryb samolotowy → wiersze z repliki + „Podgląd zdjęć wymaga internetu”, bez błędu serwera, **0 żądań**; powrót sieci → miniatury same (bez dotyku) | passed |
| AC5 | `photos-no-trace` (143): siatka, podgląd z wygasłym adresem, nieudane wczytanie (500), blokada z pobieraniem w toku, zimny start + wylogowanie, ponowne logowanie + „Wyczyść dane firmowe”, kontrola dodatnia | passed |

## 3. Dowód AC5 — liczby po każdym etapie (jeden przebieg, jedna instalacja)

Stan wyjściowy (po logowaniu, przed obejrzeniem czegokolwiek): `WEBPVP8` w 0 plików, `E2EMARK` w 0, katalog zewnętrzny 0/0, `cache/http-cache`: 1 plik `journal`, 0 wpisów `<md5>.0/.1`; galeria: 0 wierszy MediaStore, 2 pliki w `DCIM`/`Pictures`.

| Etap | `WEBPVP8` ponad stan wyjściowy | `E2EMARK` | `http-cache` | logcat (wiersze bez Maestro) | żądania obrazu z `no-store` |
| --- | --- | --- | --- | --- | --- |
| siatka + podgląd z wygasłym adresem (odnowiony raz) | 0 | 0 | tylko `journal` | 884–942, 0 trafień | wszystkie (5 z 5) |
| po zamknięciu podglądu | 0 | 0 | tylko `journal` | — | — |
| nieudane wczytanie (500) | 0 | 0 | tylko `journal` | — | — |
| blokada z pobieraniem w toku (serwer trzyma obraz 100 s) | 0 | 0 | tylko `journal` | 1668, 0 trafień | serwer: **1 żądanie porzucone** przez aplikację |
| zimny start + wylogowanie | 0 | 0 | tylko `journal` | 1794, 0 trafień | 11 z 11 |
| ponowne logowanie + „Wyczyść dane firmowe” | 0 | 0 | tylko `journal` | 2304, 0 trafień | 15 z 15 |

Dodatkowo: drzewo widoków pod nakładką blokady (pełny zrzut `uiautomator` bez `--compressed`, 3 odczyty, 19 węzłów aplikacji) nie zawiera żadnej z 9 wartości ekranów zdjęć (kategorie, opis, stany, `photo-tile`, `photo-preview`, `order-photos`); galeria bez zmian (0 → 0 wierszy, 2 → 2 pliki).

### Kontrola dodatnia (ta sama instalacja, bezpośrednio po powyższym)

Hak e2e `cache: control fetch` pobrał globalnym `fetch` obraz `control.webp` **bez** `Cache-Control: no-store` (serwer odpowiedział `private, max-age=300`). To samo przeszukanie i ten sam filtr logu:

- `WEBPVP8` w **1 nowym pliku**, `E2EMARK` w **1 nowym pliku**, `cache/http-cache`: **2 pliki wpisu** (`<md5>.0` z adresem i `<md5>.1` z bajtami) — przeszukanie widzi plik cache, gdy ten istnieje;
- `adb shell log -t E2E E2EMARK-CTRL` → filtr logu znalazł linię (0 trafień przed, 1 po);
- serwer widział żądanie kontrolne.

Wniosek: bez `no-store` klient HTTP aplikacji (OkHttp) **zapisałby** zdjęcie na dysk, a przeszukanie by je znalazło; widok aplikacji (`Cache-Control: no-store` w żądaniu) niczego nie zapisuje. Dowód jest ważny.

### Odrzucone/zmienione po drodze (dla rzetelności)

- Pierwszy przebieg lock: `abandoned=0`, bo opóźnienie 30 s mijało przed blokadą (przepływ trwa ~65 s); opóźnienie zwiększone do 100 s (limit stuba 120 s) — to błąd scenariusza, nie aplikacji.
- Przełącznik panelu haków e2e leżał w lewym górnym rogu, dokładnie na przycisku „Zamknij podgląd”, więc dotknięcie zamknięcia otwierało panel (tylko wariant e2e). Przełącznik przeniesiony na dół przy prawej krawędzi (kod haków, nie produkcyjny); w wydaniu release slot jest pusty.

## 4. FLAG_SECURE (AC3), paczka release podpisana kluczem debug

Paczka `evm093-release-debugkey.apk` z tego samego przebiegu (SHA-256 `9da7a6351427d91d8f3ba45c0c2e4a9035697950929156d23c4cf4c98d50e5cd`, `dumpsys package`: bez `DEBUGGABLE`), zainstalowana `install -r` na emulatorze:

- `adb shell dumpsys window windows`: okno `pl.eviacharge.manager/.MainActivity` ma `fl=LAYOUT_IN_SCREEN SECURE …`;
- `adb exec-out screencap -p` z aplikacji: 2 592 000 pikseli, **99,8% czarnych**; jedyne niezerowe piksele to wiersze 14–48 (pasek stanu rysowany przez system poza oknem zabezpieczonym), w obszarze treści (wiersze 150–2250) **0 niezerowych pikseli**;
- kontrola dodatnia: zrzut ekranu głównego (launchera) tego samego emulatora — 100% pikseli niezerowych, pełne zakresy kolorów (zrzut działa i nie jest czarny z innej przyczyny).

Uwaga: zrzut dotyczy ekranu zablokowanego/logowania release (adres API paczki to `api.example.invalid`), bo `FLAG_SECURE` jest flagą okna głównego, wspólną dla wszystkich ekranów w tym oknie, także podglądu zdjęcia (AC3: widok w oknie głównym, nie `Modal`). Sam podgląd zdjęcia na paczce release nie był oglądany (wymagałby serwera z bucketem dla release).

## 5. Ustalenia do decyzji (nie naprawiałem)

1. **Dwukrotne pobieranie miniatur po powrocie sieci (AC4):** po `offline → online` na otwartej siatce serwer widział **6 adresów i 6 żądań obrazu dla 3 zdjęć** (przy zwykłym otwarciu dokładnie 3). Prawdopodobnie powtórny odczyt repliki po cyklu synchronizacji zwalnia i ładuje kafelki od nowa. Funkcjonalnie poprawne, ale podwaja zużycie wspólnego limitu 1000 adresów / 10 min (por. przyjęte ryzyko m5). Scenariusz asertuje `>=3`.
2. **Siatka M-08a, kafelki w stanach `processing` i kwarantanna:** na zrzucie (`m08-photos-grid-loaded.png`, 360 dp) odznaki „Przygotowujemy podgląd” i „Plik zatrzymany do sprawdzenia” stoją obok siebie i nachodzą na siebie (pierwsza obcięta). Do oceny ux-designera (AC6, 200% czcionki).

## 6. Polecenia i wyniki

| Polecenie | Wynik |
| --- | --- |
| `node tools/mobile-e2e/cli.mjs --only photos-` (z budową, `C:\e`) | 3 scenariusze zielone, `photos-no-trace` przerwany na kroku `abandoned` (błąd opóźnienia, naprawiony) |
| `node tools/mobile-e2e/cli.mjs --skip-build --only photos-no-trace` | 9/9 przepływów passed, wszystkie kroki dowodu `ok`, kontrola dodatnia `ok` |
| `pnpm --filter @evia/mobile-e2e run test:coverage` | 432 testy zielone; `photos-stub.mjs` 100% linii / 94,9% gałęzi, `device-photos.mjs` 100% / 92,8% |
