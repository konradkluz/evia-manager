# Potok mediów — upload z urządzenia (wnioski ze spike'a EVM-011)

> Dokument żywy. Właściciel: `solution-architect` (recenzja: `mobile-developer`, `security-engineer`). Stan: **wnioski ze spike'a EVM-011** w części dotyczącej **uploadu z Androida**; przetwarzanie serwerowe (skan, miniatury, retencja) pozostaje w [ADR-0009](adr/0009-storage-i-przetwarzanie-mediow.md), a encje i stany plików w [`domain-model.md`](domain-model.md#storedfile-i-uploadsession). Synchronizacja metadanych: [`offline-sync.md`](offline-sync.md).
>
> **Zakres dowodów:** wszystko poniżej zmierzono **na emulatorze Androida 15 (API 35, `Medium_Phone_API_35`) z lokalnym SeaweedFS 4.48**. **Nie dotyczy iOS** (odłożony, ADR-0015) i **nie zostało zweryfikowane na fizycznym telefonie** (to ręczny krok Konrada — AC2/AC5; instrukcja w [raporcie](../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md#instrukcja-dla-konrada-telefon-ac2-i-ac5)). Android ≤ 13 (foreground service) nie był sprawdzany. Dostawca docelowy (Scaleway) nie był testowany — jego zachowanie trzeba potwierdzić osobno (oznaczone „Scaleway: do sprawdzenia”).

## 1. Stany pliku po stronie urządzenia
`queued` (zadanie zapisane, czeka na sieć lub start) → `uploading` (sesja istnieje, trwa wysyłanie części) → `uploaded` (serwer złożył obiekt) → [spike] `verified` (SHA-256 obiektu = SHA-256 lokalnego pliku) → [spike] `local_deleted`. Poza ścieżką: `paused_revoked` (odpowiedź `401 session_revoked`; **nic nie jest usuwane**) i `failed` (błąd nienaprawialny po stronie klienta, np. `id_conflict`, brak pliku).

Zapis zdjęcia lub filmu: plik trafia z cache aparatu do katalogu prywatnego aplikacji (`filesDir/media`, `fsync`), potem liczony jest SHA-256 (natywnie, strumieniowo), potem plik zadania w `noBackupFilesDir` (zapis atomowy: plik tymczasowy + `fsync` + rename), potem wiersz w szyfrowanej bazie. Użytkownik widzi „zapisano” dopiero po tych krokach. Kolejność „zadanie natywne przed wierszem bazy” jest celowa: awaria między krokami jest naprawiana przy starcie (wiersz bez zadania → ponowna rejestracja zadania z istniejącego pliku).

**Produkcja:** stan lokalny `local_deleted` nie powstaje po `verified`, tylko gdy projekcja `MediaAsset` pokaże `clean` (skan antywirusowy + zgodny SHA-256; [`offline-sync.md`](offline-sync.md#otwarte--evm-011) punkt 7, SR-FILE-05). W spike'u „potwierdzone” oznaczało tylko zgodne SHA-256 obiektu w S3.

## 2. Protokół uploadu (potwierdzony w teście)
> **Trasy poniżej to ilustracja spike'a** (`POST /uploads`, `GET /uploads/{assetId}/parts`, …), a nie kontrakt. Produkcyjnie kroki odpowiadają zasobom z [api-guidelines](api-guidelines.md): sesja = `POST /api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}/upload-sessions` (`id` sesji, `uploadSessionId` UUIDv7, nadaje klient), ListParts = `GET …/upload-sessions/{uploadSessionId}/parts`, URL części = `GET …/parts/{n}/url`, `POST …/upload-sessions/{uploadSessionId}/complete`. `uploadSessionId` (klient) to co innego niż S3 `UploadId` (wyłącznie po stronie serwera, nigdy w kliencie). **`deviceId` i `userId` serwer bierze z kontekstu uwierzytelnienia (sesja związana z urządzeniem, ADR-0005), nigdy z treści ani z nagłówka podanego przez klienta** (w spike'u był to nagłówek tylko dlatego, że nie ma prawdziwego API). Sesję wystawia się dopiero po autoryzacji obiektu (`MediaAsset` w zleceniu dostępnym dla użytkownika, SR-FILE-02). Ewentualne zmiany kontraktu przechodzą do api-guidelines w historyjce M2, nie w spike'u.

1. **`assetId` (UUIDv7) powstaje na urządzeniu przy zapisie pliku**, zanim trafi do kolejki. To klucz idempotencji całego uploadu.
2. `POST /uploads` `{assetId, size, sha256, contentType}` (urządzenie z kontekstu uwierzytelnienia) → **sesja idempotentna**: ponowne wywołanie dla tego samego `assetId` i urządzenia zwraca tę samą sesję (`uploadId`, rozmiar i liczbę części). Klucz obiektu `media/{rok}/{miesiąc}/{assetId}/original` nadaje **serwer** (nigdy z nazwy pliku); klient nie wybiera klucza ani `uploadId`. Inne urządzenie dla tego samego `assetId` → `409 id_conflict` **bez żadnych skutków ubocznych**: istniejąca sesja, multipart i obiekt zostają nietknięte (klient zaczyna od nowa z nowym `assetId`; prawdziwa kolizja UUIDv7 praktycznie nie występuje, więc ta ścieżka to błąd albo atak). Zakończonego obiektu nie można utworzyć ponownie: mapowanie sesji `completed` nie jest nigdy kasowane (także przez `abort` właściciela ani przez `complete`), a klucz nie może zostać nadpisany. Ponowne `complete` dla sesji `completed`, gdy obiekt ma inny rozmiar albo go brak (zmiana poza protokołem), niczego nie usuwa: odpowiada `409 completed_object_mismatch` i zapisuje zdarzenie do wyjaśnienia w logu issuera (identyfikator zasobu i rozmiary, bez klucza, tokenu i danych osobowych); usunięcie obiektu z kontrolą rozmiaru dotyczy wyłącznie pierwszego złożenia. Porzucone multiparty sprząta serwer, osobno od żądań klienta: reguła cyklu życia bucketu `AbortIncompleteMultipartUpload` (np. 7 dni) albo zadanie pg-boss po N dniach — **do sprawdzenia na Scaleway**. Nadpisaniu zapobiega też warunkowy zapis (`If-None-Match: *`) lub losowy komponent klucza nadany przez serwer — **niezweryfikowane w spike'u**.
3. **Źródłem prawdy o częściach jest `ListParts`** (nie stan lokalny): po starcie, wznowieniu i każdym podejrzeniu rozjazdu urządzenie pobiera listę i pomija części, które serwer już ma. ETag zapisywany jest do pliku zadania **zaraz po** każdej części.
4. Część: `GET …/parts/{n}/url` → podpisany URL → `PUT` zakresu bajtów pliku (bez plików tymczasowych; stały `Content-Length`). **`403` na części = „odnów URL i powtórz tę jedną część”**, nie błąd pliku.
5. `complete` jest **idempotentny**: powtórka po sukcesie (także gdy serwer zgubił własny znacznik) zwraca sukces; przy `NoSuchUpload` serwer sprawdza obiekt (`HEAD`, rozmiar zgodny z deklaracją). Rozmiar po złożeniu musi zgadzać się z deklaracją, inaczej obiekt jest usuwany (`422 size_mismatch`).
6. Część wysyłana ponownie mimo znanego ETag liczona jest jako zmarnowane bajty i ponowienie — **nie** jako duplikat. Duplikaty (obiekty o tym samym `assetId`) i osierocone multipart to osobne metryki; w każdym przebiegu spike'u: **0 i 0**.

Sesję kontynuuje wyłącznie jej twórca (użytkownik + urządzenie); wniosek o URL części lub `ListParts` dla cudzej sesji daje `404` (jak medium innego zlecenia — obiekt nie jest ujawniany; EVM-044 AC6, AC7).

## 3. Podział odpowiedzialności: Kotlin, JS, Node
| Warstwa | Odpowiada za | Dlaczego |
|---|---|---|
| **Kotlin (moduł Expo)** | zadanie UIDT, pętla części, ponowienia z backoffem, odnowa URL-i, ETag-i w pliku zadania, SHA-256, przeniesienie pliku, token w Keystore | po `force-stop` lub restarcie zadanie systemowe startuje **bez JS** |
| **JS (React Native)** | aparat, szyfrowana baza kolejki (SQLCipher), UI, uzgadnianie stanu z plikami zadań, planowanie zadań przy akcji użytkownika i przy starcie | jedyny pisarz bazy; natywny worker nie dotyka bazy |
| **TypeScript `core` (Node)** | **model referencyjny protokołu** testowany względem prawdziwego S3, planer części, backoff | w produkcji `packages/sync-core` (ADR-0007) ma ten sam kontrakt; implementacja Kotlin jest jego wykonaniem na urządzeniu |

Zasada jednego pisarza: natywny worker zapisuje ETag-i w **swoim** pliku zadania; JS tylko je czyta i odzwierciedla w bazie. Źródłem prawdy po wątpliwości jest `ListParts`. Plik zadania zawiera wyłącznie identyfikatory techniczne (assetId, uploadId, numery części, ETag-i, liczniki, ścieżkę pliku w sandboxie, SHA-256) — bez nazw plików, danych zlecenia i adresów URL. Token dostępu jest szyfrowany kluczem AES-256-GCM z Android Keystore (bez wymogu uwierzytelnienia użytkownika) i nie trafia do parametrów zadania systemowego ani do logów.

## 4. Zachowanie w scenariuszach (Android 15, emulator)
| Scenariusz | Wynik | Wniosek dla projektu |
|---|---|---|
| tryb samolotowy → zdjęcia i film → powrót sieci | zadania czekają (`queued`, 0 ponowień — system nie startuje zadania bez sieci), po powrocie sieci wszystkie wysłane w ~10 s | warunek sieci realizuje JobScheduler, nie własna pętla |
| utrata sieci w trakcie części | ponowienie z backoffem, wznowienie od następnej części po powrocie sieci | ponowienia w pętli + restart zadania przez system |
| `force-stop` (3 punkty: po 1., 7. i 12. części z 13) | **system kasuje zadania; bez otwarcia aplikacji upload nie rusza**; po otwarciu aplikacji `ensureScheduled()` odtwarza zadanie, wysyłane są tylko brakujące części | ADR-0007 zakłada to poprawnie („wznawiamy przy następnym uruchomieniu”) — UI musi to jawnie pokazywać (wstrzymane — otwórz aplikację) |
| zabicie procesu przez system (`kill -9`, 3 punkty) | JobScheduler **sam wznawia zadanie** w ciągu sekund, bez otwierania aplikacji | UIDT daje to, czego nie daje FGS z `force-stop` |
| zabicie procesu **dokładnie między `complete` w S3 a zapisem stanu lokalnie** | po restarcie zadanie jest bezpiecznym no-op (idempotentny `complete`), obiekt jeden, 0 PUT | wymagana idempotencja `complete` po stronie API |
| restart emulatora w trakcie uploadu (bez blokady ekranu) | zadanie trwałe wraca **samo**, bez otwierania aplikacji | `setPersisted(true)` + `RECEIVE_BOOT_COMPLETED` |
| restart z blokadą ekranu (PIN) | do pierwszego odblokowania zadanie nie startuje i pliki zadań są nieczytelne (magazyn szyfrowany poświadczeniami); ok. 6 s po odblokowaniu upload rusza **sam** | zgodne z wymaganiem ADR-0007 „po pierwszym odblokowaniu” |
| film 512 MiB (syntetyczny) | 32 części, ok. 125 s przy ok. 4 MiB/s (kanał emulatora), SHA-256 urządzenia = Node = obiekt w S3 | rozmiar części 16 MiB; liczenie SHA natywnie |
| przełączenie Wi-Fi → dane komórkowe | **tylko przybliżenie** (emulator wyłącza Wi-Fi i przechodzi na emulowane dane): zadanie zostało zrestartowane przez system, wznowione z `ListParts` | prawdziwe przełączenie — telefon |

Szczegółowe liczby i pliki wyników: [raport spike'a](../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md).

## 5. Podpisane URL-e części (SeaweedFS; Scaleway: do sprawdzenia)
- Podpis SigV4 obejmuje nagłówek `Host`, więc **API podpisuje z adresem, który widzi urządzenie** (emulator: `10.0.2.2:PORT`, telefon z `adb reverse`: `127.0.0.1`), `forcePathStyle`.
- **`Content-Length` jest podpisany**: SeaweedFS odrzuca (`403`) PUT o długości innej niż podpisana — zarówno krótszej, jak i dłuższej. Zgodne z ADR-0009 („URL związany z rozmiarem”). Scaleway: do sprawdzenia.
- **Wygaśnięcie** (TTL 1 s w teście): PUT po terminie → `403`; odnowa URL-a i powtórzenie jednej części działa (test integracyjny Node; na urządzeniu niemierzone). TTL w teście ≤ 3600 s; kod odrzuca TTL > 60 min.
- Podpis części nie jest przenośny: URL dla części N użyty z `partNumber=N+1` daje `403`.
- **Pułapka biblioteki:** domyślnie `@aws-sdk/s3-request-presigner` dodaje do URL-a sumę CRC32 **pustego** ciała (`x-amz-checksum-crc32=AAAAAA==`) i serwer odrzuca każdą część (`500`). Klient presignera musi mieć `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- **Idempotencja `complete`:** SeaweedFS na powtórne `CompleteMultipartUpload` odpowiada sukcesem; magazyny w stylu AWS potrafią odpowiedzieć `NoSuchUpload`. API musi obsłużyć oba przypadki (gałąź `NoSuchUpload` → `HEAD` jest pokryta testem z atrapą). Scaleway: do sprawdzenia.
- Anonimowy GET, PUT i ListObjects na prywatny bucket → `403` (wymaga skonfigurowanych tożsamości S3; bez nich SeaweedFS przepuszcza anonimowy dostęp).

## 6. Limity i parametry
- **Scaleway: 1–1000 części, każda 5 MiB–5 GiB (poza ostatnią)**, nie 10 000 jak w AWS. Planer ma `maxParts` jako parametr dostawcy. Rozmiar części wybiera klient w zakresie 8–64 MiB; domyślnie 16 MiB (film 4 GiB = 256 części, 500 MiB = 32). Plik, który przy 64 MiB potrzebowałby > 1000 części (> 62,5 GiB), jest odrzucany.
- SeaweedFS **nie** wymusza minimum 5 MiB dla części — ograniczenie sprawdzają testy jednostkowe planera, nie integracja.
- Pliki: zdjęcie ≤ 50 MB, wideo ≤ 4 GiB (ADR-0009).

## 7. Bezpieczeństwo i prywatność (Android)
- **Kopie zapasowe:** `allowBackup=false` + `dataExtractionRules` wykluczające wszystkie domeny z `cloud-backup` i `device-transfer` — w manifeście **scalonym** z bibliotekami; pakiet nie ma flagi `ALLOW_BACKUP`, `bmgr backupnow` kończy się „Backup is not allowed”. Kopia Google i transfer urządzenie→urządzenie: wymaga telefonu.
- **Pliki zadań i token w `noBackupFilesDir`**; media w `filesDir/media` (prywatne, bez MediaStore i galerii — zapytania `content query` o wideo i obrazy zwracają „No result found”).
- **Baza SQLCipher:** klucz 256 bit z CSPRNG, w Keystore przez `expo-secure-store`; nagłówek pliku bazy nie jest nagłówkiem SQLite.
- **Uprawnienia scalonego manifestu:** `CAMERA`, `INTERNET`, `ACCESS_NETWORK_STATE`, `RUN_USER_INITIATED_JOBS`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`. Bez lokalizacji, mikrofonu, odczytu/zapisu pamięci i mediów.
- **Logi:** identyfikatory zasobów (końcówka assetId), numery części, rozmiary, czasy, kody HTTP — bez tokenu, bez adresów URL i podpisów (test automatyczny w issuerze).
- **Ryzyko do oceny (nie spike):** `expo-camera` 58 dołącza moduł ML Kit (skaner kodów: `MlKitInitProvider`, komponenty `firebase-*`, modele w `assets/`). Nie sprawdzono, czy próbuje wysyłać telemetrię; przed M2 sprawdzić ruch sieciowy aplikacji albo użyć `react-native-vision-camera` (ADR-0007).
- **Tylko HTTPS w produkcji.** Wariant spike ma wyjątek `cleartext` wyłącznie dla `10.0.2.2`, `127.0.0.1` i `localhost` (nie dla produkcji i nie dla techników).

## 8. Rekomendacje dla M2 (Android)
1. **Własny moduł Expo (Kotlin) zamiast biblioteki społeczności** dla uploadu: biblioteka z ADR-0007 (`@kesha-antonov/react-native-background-downloader` 4.6.3) wysyła na Androidzie cały plik jednym żądaniem z wątku w procesie (bez zakresów bajtów, bez UIDT/WorkManager; „wznowienie” startuje od początku). Szczegóły i decyzja: [ADR-0020](adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (Zaakceptowana, 2026-10-21).
2. Jedno zadanie UIDT na plik, **planowane przy akcji użytkownika** i ponownie przy starcie aplikacji (`ensureScheduled`), `setPersisted(true)`; w UI jawny stan „wstrzymane — otwórz aplikację” po `force-stop`.
3. `assetId` na urządzeniu, klucz i `uploadId` po stronie serwera, **sesja i `complete` idempotentne**, `ListParts` jako źródło prawdy, obsługa `403` jako odnowy URL-a.
4. SHA-256 natywnie, jednorazowo przy zapisie pliku; deduplikacja po SHA-256 wyłącznie w obrębie sesji lub assetu (między użytkownikami byłaby wyrocznią istnienia pliku).
5. Usuwanie lokalnego oryginału dopiero przy `clean`; do tego czasu plik zostaje także po `uploaded` i `verified`.
6. Po `401 session_revoked`: kolejka, oczekujące pliki i sekret instalacji **zostają**; ta sama instalacja po ponownym zalogowaniu wznawia od ostatniej części, inne urządzenie dostaje `id_conflict` bez skutków ubocznych (cudzy multipart i obiekt nietknięte; sprząta je lifecycle bucketu, nie żądanie klienta) i zaczyna od nowa z nowym `assetId` — rekomendacja dla EVM-005.
7. Test terenowy przed wydaniem: scenariusze z sekcji 4 **na fizycznym telefonie** (przełączenie Wi-Fi ↔ LTE, restart, tło > 10 min, bateria).

## 9. Niezmierzone w spike'u
Bateria (emulator nie mierzy), prawdziwe przełączenie Wi-Fi ↔ LTE, wydajność SQLCipher na telefonie, wygaśnięcie URL-a na urządzeniu, Android ≤ 13, iOS (ADR-0007 pytania 13, 14, 16 oraz iOS-owe części 1, 2, 11), Scaleway, strona zmian 200/500 i N = 30 dni z [`offline-sync.md`](offline-sync.md) (to nie dotyczy uploadu plików).
