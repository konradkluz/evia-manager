# EVM-108 — raport weryfikacji QA

Historyjka: [EVM-108](../../backlog/M2/EVM-108-mobile-zdjecia-aparat-i-kolejka.md) (AC1–AC8). Data: 2026-11-15. Weryfikator: qa-engineer (niezależnie od raportów wykonawcy). Zakres: `git diff origin/main...HEAD` do `b3281dec`. Plan i polecenia: [plan-i-polecenia.md](plan-i-polecenia.md). Dane wyłącznie syntetyczne; aplikacja w E2E łączy się tylko z serwerem scenariuszy (RR-93).

## Werdykt: PASS z zastrzeżeniem (AC7 — dowód E2E w toku)

AC1–AC6 i AC8 spełnione. AC7 ma pełny dowód jednostkowy i integracyjny, ale **dowód z emulatora jest niekompletny**: poprzedni przebieg `camera-batch-30` (`camera2`) padł na drugim użyciu przepływu 88 (po `b3281dec` scenariusz ma jedno przerwanie w trakcie wysyłki), a ponowny przebieg (`.scratch/EVM-108/e2e/camera3.log`) w chwili pisania nie ma znacznika `camera3.done` (log kończy się na `[Passed] 80-camera-sign-in`). **Brakuje:** zielonego przebiegu 86 → 87 → 88 → 89 z krokiem `upload-checkpoint-many:30` (30 obiektów, 0 duplikatów, SHA-256 zgodne, 30× „Wysłano”). Do czasu `rc=0` nie oznaczamy AC7 jako PASS na emulatorze; wynik dopisać do tabeli w sekcji 5.

## 1. Macierz AC → testy → werdykt

Pliki Jest w `apps/mobile/test/`, narzędzia w `tools/`. Testy oznaczone `EVM-108 AC#` (łącznie 8 AC; Jest wybrane zestawy: 292/292 zielone, `node:test` `mobile-apk` 163/163, `mobile-e2e` 284/284 — uruchomione przeze mnie).

| AC | Status | Dowód (testy / przepływy) | Uwagi |
|---|---|---|---|
| AC1 zdjęcie z kategorią zapisane trwale | PASS | `capture/capture-pipeline.test.ts` (kolejność: miejsce → aparat → import → skrót → jedna rejestracja; UUIDv7 na każde ujęcie; każdy punkt awarii bez pliku i bez wpisu); `capture/capture-durability.test.ts` (dokładny zbiór kluczy ładunku bez `description` i `procedureStageId`; kill po imporcie / po skrócie / po COMMIT; odśmiecacz); `storage/pending-media.test.ts`, `storage/media-file-store.test.ts`; `capture/camera-static.test.ts` (brak galerii, `setLocation`, zewnętrznej pamięci, intencji aparatu); `capture/camera-wipe.test.ts`; JVM `OriginalImportTest.kt`. Maestro `82-camera-capture` + kroki: `original-exif-clean:2` (0 GPS w EXIF/XMP przy lokalizacji emulatora ustawionej celowo), `gallery-unchanged` (MediaStore 0 → 0; DCIM/Pictures 2 → 2), `permissions-minimal`, `upload-checkpoint-many:2` | przypadek negatywny: każdy punkt awarii; kontrola pozytywna czytnika EXIF w `device-camera.test.mjs`. Brak nazwy klienta i adresu: test kluczy ładunku |
| AC2 seria i powrót do zlecenia | PASS | `capture/camera-screen.test.tsx`: blokada spustu z podpowiedzią „Wybierz kategorię przed zdjęciem.” (widoczną i dla czytnika), 7 chipów, licznik/toast/ogłoszenie dopiero po trwałym zapisie (opóźniony zapis trzyma licznik 0), ostatnia kategoria dla kolejnych ujęć, „Gotowe” i systemowe „wstecz” wracają do zlecenia, prośba „Powiadomienia o wysyłaniu” raz, odmowa nie blokuje. Maestro `82`, `83` (3 ujęcia offline, prośba → „Nie teraz”) | |
| AC3 zgoda na aparat | PASS | `camera-screen.test.tsx`: ekran „Aparat do zdjęć z prac” z „bez zapisu w galerii, bez lokalizacji”, [Zezwól na dostęp do aparatu] / [Nie teraz], ten sam ekran po odmowie, odmowa trwała z dokładnym tekstem i [Otwórz ustawienia] bez drugiego monitu, powrót z ustawień uruchamia aparat sam, brak próśb o mikrofon/lokalizację/pamięć. Maestro `81-camera-permission` + `permissions-minimal` | teksty zgodne z `pl.ts` bajt w bajt. Odmowa trwała i monit systemowy na prawdziwym telefonie: manual → EVM-112 |
| AC4 brak miejsca i błędy aparatu | PASS | `camera-screen.test.tsx` (dokładne teksty: „Mało miejsca w telefonie: 1,2 GB.”, „Brak miejsca — zdjęcie nie zostało zapisane. Zwolnij miejsce w telefonie.”, „Nie udało się zapisać zdjęcia. Zrób je ponownie.”, „Nie udało się uruchomić aparatu.” + [Spróbuj ponownie], „Uruchamianie aparatu…” bez spinnera); `capture/capture-pipeline.test.ts`, `capture/capture-durability.test.ts` (kolejka i wiersze nietknięte, brak pliku); `capture/disk-space.test.ts` (progi 2 GB / 100 MB, wartości graniczne, nieznana wartość nie blokuje); JVM `OriginalImportTest.kt` (brak miejsca w imporcie natywnym) | bez przepływu Maestro (zapełnienie dysku emulatora niepraktyczne) — świadome; pokrycie jednostkowe pełne |
| AC5 wejścia, role, offline, tryb ukrytych danych | PASS | `capture/camera-entries.test.tsx`: dolny pasek („Zrób zdjęcie” główna, „Dodaj wpis” drugorzędna, ≥ 48 dp), arkusz „Dodaj” → wybór zlecenia (ostatnio otwierane, szukanie po numerze i tytule, nie po kliencie i adresie) → aparat; niezalogowany → logowanie; offline: kapsuła „Offline · n” bez baneru; tryb ukrytych danych: tylko numery, wyszukiwanie wyłącznie po numerze, pasek „Aparat” bez numeru, cofanie przy wyczyszczeniu; blokada aplikacji; wyczyszczenie danych firmowych (`camera-wipe.test.ts`, test z prawdziwym `CapturePipeline`). Tylko odczyt: `auth/login-machine.test.ts` (EVM-100, `channel_not_allowed`). Maestro `80`, `83`, `84`, `85` | Administrator vs Edytor: klient nie rozróżnia ról (ta sama ścieżka), egzekwuje serwer (EVM-131) — patrz sekcja 3 |
| AC6 pliki w Kolejce | PASS | `upload/queue-files.test.tsx` (wiersz: kategoria, czas, typ + dokładnie jedna z 4 etykiet; licznik „n do wysłania”; stan pusty = istniejący komunikat; „Usuń z telefonu” tylko dla plików bez „Ponów”, z potwierdzeniem i anulowaniem, odmowa modułu; brak klienta i adresu, w trybie ukrytym bez numeru); `storage/media-file-store.test.ts`; `design-rules.test.ts`. Maestro `83` (3× „Oczekuje”, „3 do wysłania”), `85`, `89` (30× „Wysłano”, „0 do wysłania”) | brak przepływu Maestro dla „Usuń z telefonu” (znana luka a): pokrywa Jest + przepływ 59 / `42-entry-rejected` (EVM-130/105) — akceptowalne |
| AC7 30 zdjęć bez duplikatów po przerwach | PASS z zastrzeżeniem | Jest: `capture/capture-durability.test.ts` (30 plików, 30 komend, 30 wierszy, brak duplikatów `assetId`, przeżywa restart), `e2e-hooks.test.tsx`, `synthetic-picture.test.ts` (ta sama ścieżka zapisu co aparat); `node:test`: `judgeBatch`, `upload-checkpoint-many`, serwer scenariuszy (`workOrderId`). Maestro `86`–`89` (scenariusz `camera-batch-30`) | **Dowód emulatora niekompletny** (p. werdykt). Wcześniejsze `upload-*` (EVM-130) zielone na paczce z aparatem; `upload-checkpoint-many` dla 1 i 2 plików (82, 85) zielone: 0 duplikatów, SHA-256 zgodne |
| AC8 biblioteka aparatu bez telemetrii i uprawnień | PASS | `tools/mobile-apk/test/manifest.test.mjs` (CAMERA przechodzi; `RECORD_AUDIO`, lokalizacja, galeria, pamięć odrzucane; CAMERA w `uses-permission-sdk-23` odrzucone; nieznane uprawnienie odrzucone — test negatywny), `telemetry.test.mjs` (6 zakazanych grup: mlkit, firebase, gms, datatransport, odml, `androidx.camera.mlkit` — DEX, manifest, `META-INF`), `gradle-deps.test.mjs` / `gradle-commands.test.mjs` (drzewo Gradle, `mapping`), `verify.test.mjs`, `camera-library.test.mjs`; ESLint: `packages/config/test/eslint-ui.test.ts` (`expo-image-picker`, `ACTION_IMAGE_CAPTURE`, importy dynamiczne, `exif`/`additionalExif`/`base64`); `apps/mobile/test/camera-plugin.test.ts`, `expo-config.test.ts` (`buildFromSource`), `tools/repo-policy` (Kotlin/Java bez MediaStore, pozycji, intencji). Uzasadnienie SR-SUPPLY-06 w historyjce (wersja dokładna, MIT) | patrz ustalenia F2, F3 |

## 2. Przebiegi emulatora (liczby z raportów orkiestratora; sam emulatora nie uruchamiałem)

| Przebieg | Wynik | Źródło |
|---|---|---|
| Regresja domyślna po etapie 3 (paczka `b5fb11e5`) | 71/71 przepływów, 0 nieudanych, 0 pominiętych; logcat 0 adresów i 0 sekretów | `.scratch/EVM-108/e2e/regress3-default-report/report.md` |
| `camera-` + `upload-` na paczce z `a1b8f009` (`camera2`) | `upload-*` zielone; `camera-permission`, `camera-capture`, `camera-series-offline`, `camera-add-sheet`, `camera-hidden-data` zielone (przepływy 80–85); `camera-batch-30`: 86, 87, 88 zielone, **drugie użycie 88 czerwone** (stąd zmiana w `b3281dec`), 89 pominięty | `.scratch/EVM-108/e2e/camera2-report/report.md` (14 passed, 1 failed, 1 skipped w części aparatu) |
| `camera-batch-30` po `b3281dec` (`camera3`) | **w toku / brak wyniku** (brak `camera3.done`) | `.scratch/EVM-108/e2e/camera3.log` |

Kontrole urządzenia (zielone w `camera2`): EXIF bez GPS (`original-exif-clean:2` i `:3`, przy wstawionej lokalizacji emulatora), galeria bez zmian (MediaStore 0 → 0, DCIM/Pictures bez nowych plików), `permissions-minimal` (brak lokalizacji/mikrofonu/pamięci), `upload-checkpoint-many:2` i `:1` (0 duplikatów, 0 osieroconych multipartów, SHA-256 zgodne), `tokens-not-in-clear`, `logcat-clean`.

## 3. Macierz ról i przypadki brzegowe

| Rola / stan | API (serwer) | UI aplikacji | Dowód |
|---|---|---|---|
| Administrator, Edytor | `CreateMediaAsset` przyjęta dla kanału mobile (EVM-131) | aparat i pliki w Kolejce; klient nie rozróżnia ról | testy EVM-131 (poza zakresem); Jest powyżej |
| Tylko odczyt | token telefonu → `403 channel_not_allowed` | nie loguje się (EVM-100) | `auth/login-machine.test.ts`, odwołanie w `camera-entries.test.tsx` |
| Niezalogowany | — | ekran logowania, brak paska i aparatu | `camera-entries.test.tsx` (AC5) |
| IDOR | zlecenie spoza repliki odrzucone przed otwarciem aparatu (wymaganie security 18) | brak kamery i stanu | `camera-entries.test.tsx` (3 testy „security 18”) |
| Tryb ukrytych danych | — | numery bez tytułów, wyszukiwanie tylko po numerze, pasek bez numeru, wiersz plików bez numeru | `camera-entries.test.tsx`, `queue-files.test.tsx`, przepływ `85` |
| Offline | — | kapsuła „Offline · n”, brak baneru, serwer nic nie widzi do powrotu sieci | `83`, `upload-none-yet` |
| Blokada i czyszczenie | — | aparat zwolniony przy blokadzie i w tle; wipe usuwa oryginały i cache aparatu, przy błędzie „fail closed” | `camera-screen.test.tsx`, `camera-wipe.test.ts` |
| Polskie znaki | nazwy plików to UUID (nie dotyczy); etykiety kategorii „Oględziny”, „Usterka / problem” renderowane w testach chipów | | `camera-screen.test.tsx` |

Przerwany zapis / kill: pokryty (kill po imporcie, po skrócie, po COMMIT; odśmiecacz). Strefa i zmiana czasu: czas ujęcia to chwila ISO (`capturedAt`), wyświetlanie przez istniejące formatowanie Europe/Warsaw; brak osobnego testu DST dla czasu w wierszu pliku (patrz F4).

## 4. Ustalenia

| ID | Severity | Obszar | Lokalizacja | Problem | Poprawka |
|---|---|---|---|---|---|
| F1 | major (do zamknięcia przed „done”) | AC7 / E2E | `camera3` | brak zielonego przebiegu `camera-batch-30` po `b3281dec` | wynik `camera3.done` `rc=0` i raport z `upload-checkpoint-many:30`; wpisać do sekcji 5. Gdy czerwony — blocker AC7 |
| F2 | minor | AC8 / fixtures | `tools/mobile-apk/test/fixtures/` | fixture'y bez `CAMERA`, więc `verify` dopuszcza, ale nie wymaga uprawnienia | po pierwszej paczce release z aparatem (job CI `mobile-apk`) odświeżyć fixture'y i dodać test „paczka aplikacji bez CAMERA odrzucona”; AC8 literalnie tego nie wymaga (allowlista rośnie tylko o `CAMERA`, dodatkowe uprawnienie odrzucane — test negatywny istnieje), więc nie blokuje |
| F3 | minor | AC8 / CI | job `mobile-apk` | `verify`, `deps`, `mapping` na paczce release bez haków e2e nie były jeszcze uruchomione (lokalnie czyste na paczce e2e) | sprawdzić zielony `mobile-apk` w CI po pushu przed scaleniem |
| F4 | nit | testy | `capture/capture-durability.test.ts` (l. 37, 265, 284, 303), `upload/media-uploads.test.ts` (l. 463, 469, 507, 634) | 20–25 ms realnych oczekiwań na tło (single-flight); niedeterministyczne w teorii | zastąpić oczekiwaniem na zdarzenie / fałszywym zegarem; nie blokuje (testy zielone) |
| F5 | nit | testy / narzędzie | JVM `OriginalImportTest.kt` | 4 testy z dowiązaniami symbolicznymi pomijane (`assumeTrue`) na Windowsie z uzasadnieniem; wykonają się w CI Linux | potwierdzić w CI, że nie są pominięte |
| F6 | nit | obserwacja | logcat | klasa `expo.modules.camera.records.DocumentScannerOptions` w kodzie biblioteki (sam rekord, bez ML Kit; zależności Google nieobecne w drzewie) | brak działania; uwaga na ewentualny `NoClassDefFoundError`, gdyby ktoś użył skanera — ESLint go blokuje |

Nie znaleziono blockerów, luk uprawnień ani utraty danych. Brak wyłączonych / osłabionych testów (jedyne `skipped` to pola raportu „NOT PERFORMED”, nie testy); dane syntetyczne; w logcat brak adresów i sekretów.

## 5. Wyniki do uzupełnienia po zakończeniu przebiegu

| Data | Przebieg | Wynik | Uwagi |
|---|---|---|---|
| 2026-11-15 | `--skip-build --only camera-batch-30` (`camera3`) | w toku | wpisać `rc` i liczby z `upload-checkpoint-many:30` |

## 6. Dodane testy

Brak — pokrycie AC okazało się wystarczające; luki małe (F2, F4) lub zależne od CI (F3, F5).

## 7. manual → EVM-112

30 zdjęć prawdziwym aparatem telefonu; kontrast panelu aparatu w słońcu; spust w rękawicy; układ 360 dp i poziomy; monity systemowe aparatu i powiadomień; odmowa trwała i powrót z ustawień; analiza ruchu sieciowego całej sesji (brak usług analitycznych, ML Kit, Firebase); brak zdjęć w galerii i brak GPS w EXIF zdjęcia z prawdziwego aparatu; TalkBack (ogłoszenie „Zapisano zdjęcie n”); 200% czcionki; `FLAG_SECURE` na ekranie aparatu.

## 8. Jak to sprawdzić (właściciel produktu)

1. Zainstaluj paczkę z aparatem, zaloguj się jako Edytor, otwórz zlecenie: na dole „Zrób zdjęcie” i „Dodaj wpis”.
2. Naciśnij „Zrób zdjęcie”, odmów zgody, potem zezwól; spust bez kategorii pokazuje „Wybierz kategorię przed zdjęciem.”.
3. Wybierz kategorię, zrób 3 zdjęcia w trybie samolotowym; licznik rośnie po zapisie, „Gotowe” wraca do zlecenia i pyta o powiadomienia.
4. W „Kolejce” widać 3 pliki „Oczekuje” i „3 do wysłania”; po włączeniu sieci zmieniają się na „Wysłano”, a zdjęcia są w panelu przy zleceniu.
5. Sprawdź, że w galerii telefonu nie ma tych zdjęć.
6. Konto „Tylko odczyt” nie zaloguje się do aplikacji.
