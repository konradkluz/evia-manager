# Moduł wysyłania w tle (Android) — `modules/evia-upload`

Lokalny moduł Expo (EVM-130, ADR-0020 z adnotacją ADR-0020a): zadanie systemowe wysyłające pliki w tle, **jedyny właściciel tokenów** w procesie, magazyn tokenu odświeżania w Android Keystore, prywatne powiadomienie i most do JavaScriptu. Wszystkie decyzje są w czystym silniku Kotlin (`engine/`, testy JVM, Kover ≥ 95%); `android/` to klej bez logiki decyzyjnej (wiązanie z platformą), dołączający źródła silnika jako `sourceSet` (bez drugiej wtyczki Kotlin w buildzie APK i bez nowych zależności — tylko `expo-modules-core` z `expo-module-gradle-plugin` i platforma).

| Ścieżka | Rola |
|---|---|
| `engine/` | czysty Kotlin/JVM: silnik, `TokenOwner`, pliki zadań, adaptery HTTP, polityka harmonogramu, `JobArming`, `UploadWorker` (patrz `engine/README.md`) |
| `android/src/main/java/pl/eviacharge/upload/android/` | klej: `UploadJobService`, `EviaUploadModule`, `UploadRuntime`, `TokenKeystore`, `AndroidSystemJobs`, `UploadNotifications` |
| `android/build.gradle` | moduł Androida; `srcDirs += '../engine/src/main/kotlin'` (testy silnika nie wchodzą do source setu) |
| `expo-module.config.json` | rejestracja `pl.eviacharge.upload.android.EviaUploadModule` (nazwa modułu JS: `EviaUpload`) |
| `src/index.ts` | typowane wiązanie TS: `EviaUploadModule`, typy odpowiedzi i zdarzeń, `loadEviaUpload()` (`requireOptionalNativeModule`; `null` poza Androidem i w Jest) |
| `../../plugins/with-upload.ts` | config plugin: uprawnienia, deklaracja usługi, meta-data builda |

## Interfejs dla JavaScriptu (`EviaUploadModule`)

Zasady: **żadna funkcja nie zwraca tokenu odświeżania ani odwołania** (token wchodzi raz, tylko do zapisu); **bajty pliku nie przechodzą przez most** (oryginał leży w `noBackupFilesDir/evia-upload/originals/<assetId>`, skrót SHA-256 liczy Kotlin strumieniowo); żadna funkcja nie zwraca tekstu wyjątku — porażka to krótki kod albo `false`/`null`. Bez użytecznego adresu API w buildzie (patrz niżej) każda funkcja odpowiada `unavailable` (albo `false`/`null`/pustą listą) i nic nie działa. **Bez hostów magazynu, ale z adresem API** (release bez `EVIA_STORAGE_HOSTS`) działa cała sesja (logowanie, token dostępu, wylogowanie, odwołania, czyszczenie, znacznik kontaktu), a tylko funkcje wysyłające pliki — `armUpload`, `retryUpload`, każdy element `reconcile` — odpowiadają `upload_unavailable` (bez wyjątku i bez żądań sieciowych), `uploadStatuses()` zwraca pustą listę; `originalPath`, `digestOriginal`, `cancelUpload`, `completeUpload`, `wipeUploads`, `lastContact` działają lokalnie jak zawsze.

**Zasada dla JS (etap B):** `upload_unavailable` to NIE brak sesji. Plik zostaje w kolejce w stanie `applied` i Kolejka pokazuje go jako „oczekuje” (nie jako błąd i nie jako „Wymaga uwagi”), a logowanie przebiega normalnie; przy następnym starcie (`reconcile`) plik jest uzbrajany ponownie, więc paczka z hostami podejmie go bez straty. Tylko `unavailable` (brak adresu API albo modułu) oznacza, że sesji nie da się prowadzić. Identyfikatory (`assetId`, `workOrderId`, `userId`, `deviceId`) to UUID z serwera (`assetId` — UUID małymi literami). Liczby (czas, rozmiar) to `number` (JS), po stronie Kotlina `Double` → `Long`.

### Sesja (tokeny)
| Funkcja | Wynik | Uwagi |
|---|---|---|
| `stageLogin(userId, deviceId, refreshToken, accessToken, accessValidForMs, serverTimeMs \| null)` | `'ok' \| 'invalid' \| 'unavailable'` | krok 2 logowania, gdy trwa device check; tylko pamięć; wcześniejsza niezatwierdzona sesja jest kończona |
| `commitStaged(sameInstallation)` | `'ok' \| 'storage_failed' \| 'nothing_staged' \| 'unavailable'` | zapis sesji; `sameInstallation = true` porzuca oczekujące odwołania **bez** ich wysyłania (W1d) |
| `abandonStaged()` | `'ok' \| 'unavailable'` | device check anulowany: sesja kończona na serwerze, a bez odpowiedzi jej token to oczekujące odwołanie |
| `commitLogin(userId, deviceId, refreshToken, accessToken, accessValidForMs, sameInstallation, serverTimeMs \| null)` | `'ok' \| 'invalid' \| 'storage_failed' \| 'unavailable'` | krok 2 bez device check |
| `accessToken(rejected \| null)` | `{status:'ready', accessToken, ownerId, validForMs}` \| `{status:'retry_later'}` \| `{status:'blocked', state}` \| `{status:'unavailable'}` | odświeżenie single-flight natywnie; `rejected` = token, który serwer odrzucił `401`; `validForMs` liczone od teraz (zegar monotoniczny) |
| `reportApiRevoked()` / `reportDeviceWipeRequired()` / `reportUpdateRequired()` | `boolean` | JS (własne żądania) zgłasza `401 session_revoked`, `401 device_wipe_required`, `426` — tokeny znikają / praca się wstrzymuje |
| `signOut(online)` | `boolean` | sesja kończy się od razu (pamięć i magazyn, jeden zapis z oczekującym odwołaniem); online serwer dostaje logout albo ścieżkę odwołania |
| `flushPendingRevocations()` | `boolean` | start aplikacji, powrót sieci, po logowaniu |
| `sessionState()` | `{state, ownerId \| null}` | `signed_out \| signed_in \| needs_login \| paused_revoked \| paused_update \| wipe_required` (`unavailable`) |
| `clearWipeMarkerAfterLogin()` | `boolean` | po PEŁNYM logowaniu: znacznik czyszczenia znika, gdy czyszczenie jest zakończone (`false` = praca dalej zablokowana) |

### Pliki i zadania
| Funkcja | Wynik | Uwagi |
|---|---|---|
| `originalPath(assetId)` | `string \| null` | bezwzględna ścieżka prywatnego miejsca na oryginał (katalog tworzony); tu zapisuje aparat (EVM-108) |
| `digestOriginal(assetId)` | `{sizeBytes, sha256} \| null` | przed `CreateMediaAsset`; `null` — brak pliku albo pusty |
| `importOriginal(assetId, sourceUri)` | `ok \| invalid \| source_missing \| no_space \| io_error \| wipe_active \| exists \| unavailable` | EVM-108: zdjęcie z aparatu (`file://` w `cacheDir/Camera/<uuid>.jpg`) staje się trwałym oryginałem `originals/<assetId>`. Kontrole w silniku (`OriginalImporter`): tylko URI `file:` bez hosta, zapytania i fragmentu; ścieżka bez `..`; plik bezpośrednio w katalogu aparatu (ani `Camera2/`, ani podkatalogi; sam katalog nie może być dowiązaniem); nazwa jak z `expo-camera`; zwykły plik otwarty bez podążania za dowiązaniami; JPEG (`FF D8 FF`), 1 B – 50 MB; `assetId` = UUID; cel nowy (nigdy nadpisany); wolne miejsce ≥ rozmiar + 16 MB. Kopia do pliku tymczasowego `<assetId>.import.tmp` z `fsync`, potem `ATOMIC_MOVE`; źródło znika dopiero po sukcesie (po porażce po rozpoznaniu źródła także — technik robi zdjęcie ponownie). Ustawiony znacznik czyszczenia: odmowa i usunięcie źródła. Do JS tylko kod. |
| `sweepOriginals(keepAssetIds, olderThanMs)` | `number` (ile plików usunięto) | EVM-108: odśmiecacz — oryginały spoza `keepAssetIds`, pliki tymczasowe importu i stare zdjęcia w `cacheDir/Camera/`, wyłącznie starsze niż `olderThanMs` (JS: 10 min); tylko zwykłe pliki w dwóch katalogach, bez rekurencji i dowiązań; pod tym samym zamkiem co import |
| `armUpload(assetId, workOrderId, userId, deviceId, wifiOnly, contentType \| null)` | `armed_user_initiated \| armed \| already_armed \| missing_original \| invalid \| wipe_active \| failed \| upload_unavailable \| unavailable` | **dopiero po `applied` `CreateMediaAsset`**; idempotentne (to samo id zadania z trwałego mapowania; istniejące zadanie systemu nie jest podmieniane); rozmiar pliku bierze Kotlin z dysku; **`contentType`** (MIME z listy kontraktu: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `video/mp4`, `video/quicktime`; aliasy `image/jpg`, `image/heif`) trafia do deklaracji pliku w sesji — typ spoza listy to `invalid`; SHA-256 liczy Kotlin strumieniowo przy pierwszym uzbrojeniu i utrwala w pliku zadania razem z typem (istniejące zadanie nie jest liczone ponownie, deklaracja jest identyczna przy każdym powtórzeniu) |
| `reconcile(items[{assetId, workOrderId, userId, deviceId, contentType}], wifiOnly)` | `Record<assetId, wynik armUpload>` | start aplikacji i powrót na pierwszy plan: każdy plik z mutacją `applied` i bez `clean`; po pełnym logowaniu wznawia zadania `paused_revoked` |
| `retryUpload(assetId, wifiOnly)` | jak `armUpload` | „Ponów”: to samo zadanie oddane systemowi ponownie (owner i zlecenie z pliku zadania) |
| `cancelUpload(assetId, deleteOriginal)` | `boolean` | zatrzymuje zadanie, usuwa plik zadania i id; oryginał tylko przy `deleteOriginal` |
| `completeUpload(assetId, serverState, reasonCode \| null)` | `delete \| keep \| keep_and_retry \| keep_quarantined \| invalid \| unavailable` | stan pliku z repliki `media_asset`; oryginał i zadanie znikają **wyłącznie** przy `delete` (`clean` i dalej) |
| `uploadStatuses()` | `{assetId, state, partsDone, partCount, percent, sizeBytes}[]` | `state`: `queued \| uploading \| uploaded \| paused_revoked`; postęp z ETagów potwierdzonych części, bez zapisu w SQLCipher |
| `wipeUploads()` | `boolean` | **jedno wywołanie kroku E11 przed `confirmDeviceWipe`**: znacznik → anulowanie zadań → zatrzymanie instancji → pliki zadań, oryginały, **`cacheDir/Camera/`**, tymczasowe → magazyn tokenu i alias Keystore (klucz SQLCipher zostaje); idempotentne, `false` = coś zostało, wołać ponownie (dokańcza się też przy starcie procesu) |
| `lastContact()` | `{wallMs, monoMs, bootId, serverTimeMs \| null} \| null` | znacznik ostatniego udanego uwierzytelnionego kontaktu z API, także z pracy w tle; JS bierze max(własny, natywny); `bootId` w formie `boot-<licznik>` lub `boot-w<minuty>` jak `ContactClock` |

### Powiadomienia
| Funkcja | Wynik | Uwagi |
|---|---|---|
| `notificationPermission()` | `'granted' \| 'denied'` (synchronicznie) | uprawnienie Androida 13+ i przełącznik w ustawieniach; nie zależy od konfiguracji uploadu |
| `requestNotificationPermission()` | `'granted' \| 'denied'` | systemowy dialog (ekran wyjaśniający — po stronie aplikacji); przy odmowie „na stałe” dialog się nie pokaże |
| `openNotificationSettings()` | `boolean` | ustawienia powiadomień aplikacji (akcja „Włącz powiadomienia” z Bannera) |
| `launchTarget()` | `'queue' \| null` (synchronicznie) | dokąd zaniosło dotknięcie powiadomienia; wartość tylko z ustalonego zbioru, odczyt jednorazowy (dodatek jest usuwany). `MainActivity` jest eksportowana, więc obca intencja z innym dodatkiem jest ignorowana. Wejście przechodzi przez blokadę aplikacji (P7) — po stronie JS |

### Hak e2e
`e2eInjectFile(assetId, sizeBytes, seed)` → `{sizeBytes, sha256} \| null`: zapisuje plik syntetyczny (deterministyczny z `seed`, ≤ 256 MiB) jako oryginał, bez aparatu. Działa **wyłącznie** w paczce e2e (znacznik `pl.eviacharge.UPLOAD_E2E_CLEARTEXT` w manifeście); w każdej innej paczce zwraca `null` i nic nie zapisuje. Po nim: `digestOriginal`/skrót z wyniku → `CreateMediaAsset` → po `applied` `armUpload`.

### Zdarzenia (`addListener`, tylko gdy moduł żyje; praca w tle bez JS nie traci nic — stan jest w plikach)
| Zdarzenie | Ładunek | Kiedy |
|---|---|---|
| `onUploadProgress` | `{assetId, state, partsDone, partCount, percent, sizeBytes}` | po trwałym zapisie części; **nie częściej niż co 1 s na plik**, koniec pliku i pauza zawsze |
| `onFileState` | `{assetId, state, reason \| null}` | koniec biegu: `uploaded \| queued \| paused_revoked \| paused_update \| wrong_owner \| needs_attention \| wiped \| dropped`; `reason` — kod powodu przy `needs_attention` (`id_conflict`, `quarantined`, `plan_mismatch`, `untrusted_part_url`, `invalid_server_response`, `invalid_state`, `url_renewal_exhausted`, `upload_incomplete`, `declaration_rejected` (serwer odrzucił deklarację pliku w sesji), `unknown`) i `checksum_mismatch` przy `queued` („Ponów”) |
| `onSessionState` | `{state}` | bieg dotknął sesji: `needs_login` (także `signed_out`), `paused_revoked`, `paused_update`, `wipe_required` |

`needs_attention` nie jest zapisywany natywnie — JS zapisuje go w swojej tabeli i **nie uzbraja pliku ponownie** przy `reconcile`, dopóki użytkownik nie wybierze „Ponów” (inaczej każdy start powtarzałby zadanie, które kończy się tym samym).

## Powiadomienie (AC6)
Kanał „Wysyłanie plików” (`evia_upload`, `IMPORTANCE_LOW`: bez dźwięku i wibracji, `VISIBILITY_PRIVATE`, wersja publiczna „EVia Manager”). Jedno powiadomienie na całe wysyłanie (zadania plików je współdzielą); teksty z `NotificationText` wg liczników (`NotificationPlanner`): „Wysyłanie 3 z 12 plików”, „Wysłano 12 plików”, „Nie wysłano 2 plików — otwórz aplikację”, „Wysyłanie wstrzymane — zaloguj się w aplikacji”. Dotknięcie: `PendingIntent` jawny do launchera, bez akcji, `FLAG_IMMUTABLE`, dodatek `pl.eviacharge.upload.OPEN = queue`; bez przycisków. Stan „czeka na Wi-Fi” nie jest powiadomieniem. Bez `POST_NOTIFICATIONS` zadanie działa, powiadomienie jest pomijane. Zadanie inicjowane przez użytkownika (API 34+) ma powiadomienie z `setNotification` (polityka `DETACH` dla stanu zamykającego, `REMOVE` dla postępu).

## Zadania systemowe (ADR-0020a)
- API 34+ i aplikacja widoczna: zadanie inicjowane przez użytkownika (UIDT, `setUserInitiated`, `setEstimatedNetworkBytes`); API ≤ 33, aplikacja w tle albo `SecurityException`: zwykłe zadanie. **Zawsze** z wymaganiem sieci (`ANY`, albo `UNMETERED` przy `wifiOnly`), `setPersisted(true)` (system uzbraja je po restarcie; aplikacja nie ma własnego odbiornika BOOT), wykładniczy backoff 30 s. Bez usługi pierwszoplanowej.
- Jedno zadanie = jeden plik; id zadania z trwałego mapowania (zakres zarezerwowany `0x45560000`+10 000, licznik, nie skrót). Jedyny dodatek zadania to `assetId`.
- Usługa działa w procesie domyślnym i dzieli z aplikacją **jedną instancję `TokenOwner`** (holder na `Application context`): odświeżenie następuje raz; token wchodzący do żądania zawsze po zapisie nowego tokenu odświeżania.
- `onStartJob` łapie wszystko (nic nie trafia do `AndroidRuntime` ani logcat); `onStopJob` przerywa wątek **i** wywołuje `disconnect()` aktywnego połączenia; znacznik czyszczenia i właściciel zadania są sprawdzane przed jakimkolwiek żądaniem (`UploadJobRunner`).
- Logi: klej nie loguje niczego (`RedactingLogger.NONE`; `android.util.Log` jest zakazany w źródłach modułów — `tools/repo-policy`). Ujście logów wymagałoby wyjątku w polityce, testu (kod zdarzenia + pola z allowlisty, nigdy `message`) i przeglądu.

## Konfiguracja builda
| Zmienna (środowisko builda) | Rola |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | adres API aplikacji **i** natywnej sesji oraz wysyłania (`pl.eviacharge.API_BASE_URL`, zapisywany w KAŻDEJ paczce); sama baza (`scheme://host[:port]`) — adres ze ścieżką to błąd builda |
| `EVIA_STORAGE_HOSTS` | **nowa**; hosty magazynu części (lista nazw hostów po przecinku, bez schematu, portu, ścieżki i wildcardów) → `pl.eviacharge.STORAGE_HOSTS`. Nie jest zmienną publiczną (nie trafia do pakietu JS) |
| `EVIA_BUILD_VARIANT=e2e` | wariant e2e: dopuszcza `http` i host emulatora oraz dokłada znacznik `pl.eviacharge.UPLOAD_E2E_CLEARTEXT`; bez `EVIA_STORAGE_HOSTS` host magazynu = host z adresu API (serwer scenariuszy) |

**Fail-closed:** release bez `EVIA_STORAGE_HOSTS` nie dostaje wysyłania (brak usługi, uprawnień wysyłania i hostów magazynu; nigdy pusta ani zgadnięta wartość), ale **zachowuje `pl.eviacharge.API_BASE_URL`, więc sesja natywna działa** (logowanie jest możliwe; funkcje wysyłające odpowiadają `upload_unavailable`). `tools/mobile-apk verify` akceptuje taką paczkę (adres nadal musi być https; usługa wymaga obu meta-data). Błędna wartość to błąd builda (komunikat nie powtarza wartości). Przy ustawionych hostach plugin dokłada: uprawnienia `RUN_USER_INITIATED_JOBS`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`; usługę `pl.eviacharge.upload.android.UploadJobService` (`exported=false`, `BIND_JOB_SERVICE`, bez `directBootAware`, `android:process`, `foregroundServiceType`); meta-data. `usesCleartextTraffic=false` w release bez zmian. Znacznik e2e w release odrzuca `verify`.

## Czego klej nie robi
Nie decyduje o stanach, mapowaniu odpowiedzi, kolejności czyszczenia, rodzaju zadania ani tekstach (silnik); nie przekazuje do JS tokenu odświeżania ani odwołania; nie przepuszcza bajtów pliku przez most; nie loguje; nie zapisuje do galerii ani pamięci zewnętrznej (`noBackupFilesDir`, pamięć CE); nie zna Wi-Fi-only poza przełączeniem wymagania sieci (opcję i filmy robi EVM-110); nie migruje starego tokenu (jedno ponowne logowanie, ADR-0020a); nie ma iOS.
