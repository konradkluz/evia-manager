# EVM-108 — plan testów, polecenia dla orkiestratora i miejsce na wyniki

Historyjka: [EVM-108](../../backlog/M2/EVM-108-mobile-zdjecia-aparat-i-kolejka.md) (AC1–AC8). Etap 4: AC7 (30 zdjęć bez duplikatów po przerwach), hak e2e, scenariusze `camera-*` i przepływy Maestro 80–89. Środowisko: emulator Androida na Windows (ADR-0015), Maestro 2.11, AVD `Medium_Phone_API_35`; iOS odłożony. Dane wyłącznie syntetyczne; aplikacja w E2E łączy się tylko z serwerem scenariuszy (RR-93).

## 1. Warunki wstępne

- **AVD z kamerą wirtualną:** `hw.camera.back=virtualscene` w `config.ini` AVD (Device Manager → Edit → Camera → Back: VirtualScene). Bez tylnej kamery (`pm list features` bez `android.hardware.camera`) przepływy 82–85 nie uruchomią aparatu, a krok `original-exif-clean` powie w raporcie **„NOT PERFORMED”** (osobny wiersz i osobny licznik w nagłówku raportu) — nie „ok”. Taki przebieg nie jest dowodem AC1 (bez GPS) dla prawdziwego aparatu.
- Jeden emulator naraz; wolne miejsce na dysku (build wariantu e2e z Gradle, ok. kilka GB).
- `adb emu geo fix` wymaga tokenu konsoli emulatora (`%USERPROFILE%\.emulator_console_auth_token`) — jest tworzony przez sam emulator; brak dostępu kończy krok `camera-geo-fix` błędem.
- Wariant e2e (nie release) — haki są tylko w nim; paczka release z znacznikiem haków jest odrzucana przez `tools/mobile-apk verify`.

## 2. Polecenia (z katalogu głównego repozytorium)

| Krok | Polecenie |
|---|---|
| Testy narzędzia (pokrycie ≥ 90% linii i gałęzi) | `pnpm --filter @evia/mobile-e2e run test:coverage` oraz `npm run test:tools` |
| Testy aplikacji (Jest) | `pnpm --filter @evia/mobile run test:coverage` |
| Pełny przebieg aparatu z buildem | `node tools/mobile-e2e/cli.mjs --only camera-` |
| Powtórka bez buildu | `node tools/mobile-e2e/cli.mjs --skip-build --only camera-` |
| Jeden scenariusz | `node tools/mobile-e2e/cli.mjs --skip-build --only camera-batch-30` (nazwy w tabeli poniżej; `--only` bierze nazwy lub przedrostki po przecinku) |
| Regresja wysyłania EVM-130 | `node tools/mobile-e2e/cli.mjs --skip-build --only upload-` |
| Domyślny przebieg | `node tools/mobile-e2e/cli.mjs --skip-build` |
| Raport | `.scratch/mobile-e2e/report.md` (przepływy, kroki urządzenia z liczbami i kodami, logcat aplikacji); zrzuty do przeglądu UX: `docs/ux/reviews/EVM-108/` (klasa „kamień milowy”) |

Scenariusze zaczynają od czystej instalacji (`80-camera-sign-in`, bez zgody na aparat) i od `upload-reset` na serwerze scenariuszy. Kolejność: `camera-permission`, `camera-capture`, `camera-series-offline`, `camera-add-sheet`, `camera-hidden-data`, `camera-batch-30`.

## 3. Macierz AC → testy → przepływy

| AC | Testy automatyczne (oznaczone `EVM-108 AC#`) | Przepływ Maestro i kroki urządzenia | Uwagi |
|---|---|---|---|
| AC1 | Jest: ścieżka zapisu (`CapturePipeline`), natywny `importOriginal` (JVM), migracja v3, ładunek komendy (dokładny zbiór kluczy); `node:test`: czytnik EXIF z kontrolą pozytywną, galeria, uprawnienia | `82` (`camera-capture`): `camera-geo-fix`, `original-exif-clean:2`, `gallery-baseline` / `gallery-unchanged`, `permissions-minimal`, `upload-checkpoint-many:2` | prawdziwy aparat emulatora; bez kamery „NOT PERFORMED” |
| AC2 | Jest: ekran aparatu (kategoria pierwszego ujęcia, licznik po trwałym zapisie, „Gotowe” wraca do zlecenia, prośba o powiadomienia raz) | `82` (blokada spustu z podpowiedzią, 2 ujęcia, powrót do zlecenia), `83` (3 ujęcia, prośba „Powiadomienia o wysyłaniu” → „Nie teraz”) | |
| AC3 | Jest: ekran zgody, stany zgody; `node:test`: `permissions-minimal` | `81` (`camera-permission`): ekran, odmowa w monicie systemu, „Nie teraz”, Kolejka bez zmian; `80` startuje z `permissions: camera: unset` | **odmowa trwała i powrót z ustawień — `manual`** (monity systemowe różnią się między wersjami Androida) |
| AC4 | Jest: próg miejsca, błędy zapisu i aparatu, brak niepełnego pliku (też JVM) | — | bez przepływu: brak miejsca nie da się wywołać na emulatorze bez zapełnienia dysku; pokrywają testy jednostkowe |
| AC5 | Jest: wejścia, role, tryb ukrytych danych, wybór zlecenia (numer i tytuł; w trybie ukrytym tylko numer) | `80` (dolny pasek: „Zrób zdjęcie”, „Dodaj wpis”), `83` (offline: kapsuła „Offline · n”, bez banera), `84` (arkusz „Dodaj” → „Zdjęcie lub film” → ostatnio otwierane, szukanie po numerze → aparat), `85` (tryb ukrytych danych: numery bez tytułów, pasek „Aparat” bez numeru) | blokada aplikacji i wymuszone czyszczenie — testy EVM-130 / EVM-101 |
| AC6 | Jest: `FileRow`, `QueueFiles` (etykiety, licznik, „Usuń z telefonu” z potwierdzeniem tylko dla plików nie do ponowienia), ikona `triangle-alert` | `83` (3× „Oczekuje”, „3 do wysłania”, `media: status`), `85` (wiersz bez numeru), `89` (30× „Wysłano”, „0 do wysłania”) | „Usuń z telefonu” w Maestro: brak wolnego numeru przepływu w 80–89; stan „Wymaga uwagi” bez ponowienia pokrywa przepływ `59` (EVM-130) i testy Jest |
| AC7 | Jest: hak `media: capture N` przez `CapturePipeline`, syntetyczny JPEG; `node:test`: `judgeBatch`, krok `upload-checkpoint-many`, serwer scenariuszy (`workOrderId` w punkcie kontrolnym) | `86`–`89` (`camera-batch-30`): 30 zdjęć offline (`capture_added=30`), `kill-9`, restart offline (30 do wysłania, `jobs-none`, `upload-none-yet`), powrót sieci, `force-stop`, `kill-9` w trakcie wysyłki, `upload-checkpoint-many:30`, `files=30;…;sent=30` | pliki to syntetyczny JPEG w `cacheDir/Camera/<uuid>.jpg` zapisywany tą samą ścieżką co aparat; aparat emulatora w przepływach 82–85 |
| AC8 | `node:test` `tools/mobile-apk` (zakazane grupy, uprawnienia, `mapping.txt`, drzewo Gradle), ESLint (importy i intencje), test źródeł `expo-camera` | — (job `mobile-apk` w CI) | fixture'y: p. rozdz. 5 |

## 4. Co każdy scenariusz dowodzi i jak czytać porażkę

| Scenariusz | Dowód | Jeśli czerwony |
|---|---|---|
| `camera-permission` | ekran zgody z tekstem „bez zapisu w galerii, bez lokalizacji”, ten sam ekran po odmowie, „Nie teraz” bez zmian w Kolejce; w `dumpsys package` brak uprawnień lokalizacji, mikrofonu i pamięci | nazwa przycisku monitu: przepływ szuka `id: .*permission_deny_button` (AOSP i Google); inny system → zrzut i poprawka selektora |
| `camera-capture` | 2 zdjęcia prawdziwym aparatem, oryginały w katalogu aplikacji bez GPS w EXIF i XMP (emulator miał lokalizację), galeria bez zmian, 2 obiekty na serwerze w zleceniu ZL-E2E-1 | `original-exif-clean`: „1 with a GPS IFD pointer” = blocker (aparat zapisał lokalizację); „NOT PERFORMED” = brak kamery; `gallery-unchanged`: nowy wiersz MediaStore lub plik w `DCIM` / `Pictures` = blocker prywatności |
| `camera-series-offline` | 3 ujęcia w trybie samolotowym, kapsuła zamiast banera, prośba o powiadomienia raz, Kolejka z 3× „Oczekuje”, serwer nic nie widział | `upload-none-yet`: serwer coś ma — komenda poszła mimo braku sieci |
| `camera-add-sheet` | druga droga do aparatu: arkusz → wybór zlecenia (ostatnio otwierane + szukanie po numerze) → aparat zlecenia ZL-E2E-2 | element pod zgięciem: `scrollUntilVisible` (lekcje Maestro z EVM-105/106) |
| `camera-hidden-data` | tryb ukrytych danych (`e2e-lock-off` + powrót na pierwszy plan): wybór zlecenia pokazuje „ZL-E2E-1” bez tytułu, pasek „Aparat” bez numeru, wiersz Kolejki bez numeru, plik dochodzi na serwer | brak ekranu „Dane zleceń są ukryte” po powrocie: aplikacja nie sprawdziła blokady ekranu ponownie (por. `64-upload-hidden`) |
| `camera-batch-30` | 30 zdjęć tą samą ścieżką co aparat bez zasięgu, `kill -9`, restart offline (30 do wysłania), powrót sieci, dwie przerwy w trakcie wysyłki, na końcu 30 obiektów we właściwym zleceniu, po jednym na `assetId`, SHA-256 równe oryginałom, żadne dwa takie same, 0 osieroconych multipartów, 30× „Wysłano”, log bez tokenów | `capture_added=N` < 30: pierwszy kod błędu w statusie; `upload-checkpoint-many`: liczby w szczegółach (assety, obiekty, duplikaty, zlecenie) |

Czas: `camera-batch-30` trwa kilka minut (opóźnienie odpowiedzi na część 3 s, trzydzieści plików); limit kroku punktu kontrolnego 240 s.

## 5. Odświeżenie fixture'ów `tools/mobile-apk` (wymaga prawdziwej paczki release z aparatem)

Fixture'ów nie piszemy ręcznie; po pierwszej paczce release z `expo-camera` (job `mobile-apk` lub lokalny build wydania): `apkanalyzer apk summary`, `manifest print` i `files list` do `tools/mobile-apk/test/fixtures/` oraz trzy pliki `evia_*.xml.txt` — dokładne polecenia w `tools/mobile-apk/README.md`. Potem: manifest fixture'a ma `android.permission.CAMERA`, więc testy budujące „wariant z aparatem” z fixture'a bez niego można uprościć, a `verify` może **wymagać** `CAMERA` w paczce aplikacji (dziś dozwolone, niewymagane) — test pozytywny na nowym fixture'rze i negatywny bez uprawnienia.

## 6. Kryteria `manual` przekazane do EVM-112

30 zdjęć prawdziwym aparatem telefonu (punkt 9 checklisty terenowej w `docs/process/testing-strategy.md`); kontrast panelu aparatu w słońcu; spust w rękawicy; układ 360 dp i poziomy; monity systemowe aparatu i powiadomień; odmowa trwała i powrót z ustawień; analiza ruchu sieciowego całej sesji (brak usług analitycznych, ML Kit, Firebase); brak zdjęć w galerii telefonu i brak GPS w EXIF zdjęcia z prawdziwego aparatu telefonu; TalkBack (ogłoszenie „Zapisano zdjęcie n”), 200% czcionki; `FLAG_SECURE` na ekranie aparatu.

## 7. Wyniki (do uzupełnienia przez orkiestratora)

| Data | Przebieg | Wynik | Uwagi |
|---|---|---|---|
| | `--only camera-` | | |
| | `--only upload-` (regresja) | | |
