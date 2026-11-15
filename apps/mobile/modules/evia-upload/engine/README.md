# Silnik wysyłania plików (Kotlin) — `modules/evia-upload/engine`

Czysty silnik wysyłania plików z EVM-109 (ADR-0020, `docs/architecture/media-pipeline.md` §1–§3, §6): wieloczęściowy upload z wznawianiem bez duplikatów, mapowanie odpowiedzi serwera na stany, adresy części tylko w pamięci i logi z redakcją. EVM-130 (etap A1) dołożył do tego całą logikę natywną bez Androida: właściciela tokenów, magazyn tokenu z portem szyfru, pliki zadań i kolejkę, adaptery HTTP (`HttpURLConnection`), znacznik i łańcuch czyszczenia, politykę harmonogramu i „runner” jednego zadania. **Bez zależności od Androida, Expo, org.json i OkHttp** (tylko JDK i `kotlin-stdlib`; własny minimalny parser JSON) — to samodzielny projekt Gradle/JVM, testowany bez emulatora i bez `expo prebuild`. Klej Androida (etap A2: `JobService`, moduł Expo, Keystore, powiadomienia, config plugin) dołączy te źródła jako `sourceSet` modułu Androida (bez drugiej wtyczki Kotlin w buildzie APK) i dostarczy implementacje portów z sekcji „Porty dla kleju Androida (etap A2)”.

Odpowiednik w TypeScript (model referencyjny) i wspólne wektory zgodności: `packages/sync-core/src/upload/` i `packages/sync-core/conformance/upload/`. Oba silniki czytają **te same** wektory; rozjazd któregokolwiek daje czerwony test po jednej ze stron.

## Uruchomienie (z katalogu głównego repozytorium)
- `pnpm run gate:kotlin` — ktlint, testy JUnit na JVM, raport Kover z progiem (`engine` w `packages/config/coverage-thresholds.json`, 95% linii i gałęzi), kontrola zależności produkcyjnych, konwersja raportu do `coverage/mobile-kotlin/lcov.info` (dla `coverage:diff`). Wchodzi w skład `pnpm run gate:native`; w CI — job `mobile-apk` (artefakt `lcov-mobile-kotlin`).
- **JDK 17 jest wymagany** (`JAVA_HOME` wskazuje na JDK 17, np. Corretto 17). Brak albo inna wersja = kod 2 z komunikatem, nigdy ciche pominięcie. Gradle nie pobiera JDK sam (`org.gradle.java.installations.auto-download=false`). Na Windows: `JAVA_HOME=C:\Users\<użytkownik>\.jdks\corretto-17.x`.
- Pojedyncze zadania (w tym katalogu, `./gradlew --no-daemon <zadanie>`; po pracy `./gradlew --stop`): `ktlintCheck`, `ktlintFormat` (poprawia formatowanie), `test`, `koverXmlReport`, `koverVerify`, `checkProductionDependencies`.

## Układ
| Plik | Rola |
|---|---|
| `Types.kt` | porty (`UploadApi`, `PartTransport`, `JobStore`, `Sleeper`, `RandomSource`, `IdSource`), typy błędów i wyniku (`Outcome`), limity |
| `UploadEngine.kt` | pętla: sesja → `ListParts` jako źródło prawdy → części → `complete` (idempotentny); jedna nowa sesja na przebieg; `422 upload_incomplete` z `complete` (część zniknęła ze storage'u) cofa znacznik `completeSent`, najwyżej raz na przebieg ponawia `ListParts` i dosyła brakujące części, drugie `422` to `needs_attention(upload_incomplete)` (następny przebieg znów zaczyna od `ListParts`) |
| `Planner.kt` | zakresy bajtów części; serwer dzieli plik, klient liczy i sprawdza spójność (`plan_mismatch`) |
| `Backoff.kt` | pełny jitter, arytmetyka na `Long` (identyczne liczby w TS i Kotlinie) |
| `FailureMapper.kt` | odpowiedź HTTP, stan pliku po `complete` i błąd sieci → wynik silnika (AC2) |
| `PartUrlPolicy.kt` | adres części: tylko `https`, bez `userinfo`, host dokładnie z listy dozwolonych, port domyślny albo jawnie dozwolony |
| `JobSnapshot.kt` | utrwalany stan (tylko identyfikatory, rozmiary, liczniki, ETagi; `schemaVersion`) |
| `RedactingLogger.kt` | jedyna droga do logów: kod zdarzenia i pola z listy dozwolonych; redakcja adresów, `Bearer`, `X-Amz-*`, sygnatur; wyjątek jest logowany **wyłącznie jako nazwa klasy** (i kod `UploadFailure`), nigdy `message`, `toString`, przyczyna ani stos |
| `Json.kt` | minimalny czytnik i zapis JSON (bez zależności): `JsonException` bez treści wejścia, limit zagnieżdżenia |
| `Cancellation.kt` | `UploadCancelledException` (zatrzymanie z zewnątrz — nigdy `Failure.Network`), `OriginalMissingException`, `CancelHandle` (anulowanie wywołuje `disconnect()` na aktywnym połączeniu) |
| `session/TokenOwner.kt` | jedyny właściciel tokenów w procesie: logowanie (krok 2 → zatwierdzenie), single-flight, zapis rotowanego tokenu przed użyciem, okno ≤ 20 s (zegar monotoniczny), wylogowanie z oczekującym odwołaniem (≤ 4, jeden atomowy zapis), refresh → logout, `session_revoked` → pauza, wznowienie tylko po pełnym logowaniu tego samego właściciela; **żadna metoda nie zwraca tokenu odświeżania** |
| `session/TokenVaultFile.kt` | rekord tokenów: `EVTK` + wersja + IV + szyfrogram AES-GCM, AAD z nazwą i wersją, zapis atomowy; uszkodzony rekord / brak klucza = „wymaga logowania”; port szyfru `RecordCipher` (+ `JceRecordCipher` nad kluczem `SecretKey`) |
| `files/` | `AtomicFiles` (plik tymczasowy, fsync, rename), `UploadFiles` (układ katalogu bazowego; ścieżka tylko z UUID sprawdzonego regexem, CWE-22), `JobFile*` (plik zadania: allowlista kluczy, `userId`/`deviceId`, bez tokenów, adresów i ścieżek; `JobFileStore` = `JobStore` silnika), `JobIdRegistry` (trwałe id zadania systemowego: zakres zarezerwowany, licznik), `WipeMarker` + `WipeChain` (znacznik i łańcuch czyszczenia), `ContactMarker` (znacznik ostatniego uwierzytelnionego kontaktu), `FileDigest` (SHA-256 strumieniowo), `OriginalPolicy` (oryginał zostaje do `clean`) |
| `files/UploadTypes.kt` | `UploadTypes`: lista typów MIME kontraktu (aliasy), nazwa pliku w deklaracji = `<assetId>.<rozszerzenie typu>` (nigdy nazwa od użytkownika), kiedy deklaracja jest dopuszczalna (EVM-131; ta sama tabela w TS `declaration.ts`, wektory `declaration.json`) |
| `http/` | `HttpConfig` (adres API i hosty magazynu z konfiguracji builda; https; flaga e2e), `HttpCore` (jedna polityka: bez przekierowań, limity czasu i rozmiaru, `Authorization` tylko do hosta API, mapowanie wyjątków), `HttpUploadApi`, `HttpAuthApi` (refresh i logout), `HttpPartTransport` (PUT części z pliku, tylko `Content-Length`) |
| `schedule/SchedulePolicy.kt` | czysta funkcja: zadanie inicjowane przez użytkownika (API 34+, aplikacja widoczna) albo zwykłe z ograniczeniem sieci; zawsze `persisted` |
| `runner/UploadJobRunner.kt` | jeden bieg jednego zadania: znacznik czyszczenia → plik zadania → właściciel (obcy właściciel odrzucony, jawne wznowienie) → silnik → `JobResult` dla harmonogramu |

## Zasady (kontrakt dla EVM-130)
- **Deklaracja pliku (EVM-131):** `createSession` zawsze niesie `file` (`fileName`, `declaredSize`, `contentType`, `sha256`) — kontrakt odrzuca (`400 validation_failed`) medium bez pliku bez deklaracji. Deklaracja pochodzi z pliku zadania (rozmiar, typ, SHA-256 liczony strumieniowo przy pierwszym uzbrojeniu; wersja schematu pliku zadania 2) i jest identyczna przy każdym powtórzeniu (utracona odpowiedź, wznowienie, nowa sesja). `400 validation_failed` → `needs_attention(declaration_rejected)`.
- Adres części jest pobierany tuż przed jej wysłaniem i trzymany wyłącznie w pamięci; `PartUrl` i `PartRequest` nie drukują adresu w `toString`.
- Żądanie części ma tylko nagłówek `Content-Length` (nigdy `Authorization`); host adresu musi być na liście dozwolonych hostów magazynu (konfiguracja; w testach `*.test`) — inaczej `needs_attention(untrusted_part_url)` bez wysyłki. **`PartTransport` nie podąża za przekierowaniami** (adapter musi to wyłączyć).
- Adapter `UploadApi` sam odświeża access token i ponawia raz; do silnika trafia `401` dopiero po nieudanym odświeżeniu, a `401` z innym kodem niż `session_revoked` i `device_wipe_required` daje `needs_attention(unknown)`.
- Silnik ponawia w procesie najwyżej 4 razy (potem `retry_later(delayMs)`) i odnawia adres części po `403` najwyżej 3 razy; dalsze ponawianie należy do harmonogramu systemowego (EVM-130). Brak nieograniczonego `sleep`.
- **Jedna instancja `UploadEngine` na zadanie, jeden wątek** (silnik ma stan: `wiped`, kontekst biegu; nie jest bezpieczny wątkowo). `UploadJobRunner` tworzy instancję na każdy bieg; `TokenOwner` jest jeden na proces (holder na `Application`), współdzielony z modułem Expo i `JobService`, i sam szereguje wątki (jedna blokada).
- `run(assetId, size, resume)`: zadanie w stanie `paused_revoked` jest odrzucane bez żądań, dopóki ktoś nie poda `resume = true` — runner robi to dopiero po pełnym logowaniu tego samego właściciela (`userId:deviceId` z pliku zadania). `StopCheck.isStopped()` (znacznik czyszczenia) jest sprawdzany przed każdym wywołaniem i daje `device_wipe`.
- Zatrzymanie (`onStopJob`): `CancelHandle.cancel()` + przerwanie wątku; adaptery zamieniają to na `UploadCancelledException`, która przechodzi przez silnik (snapshot jest zapisany po każdym kroku). `429` z `Retry-After` (`Failure.Http.retryAfterSeconds`) jest dolną granicą czekania; czekanie dłuższe niż 30 s przechodzi do harmonogramu systemowego.
- Silnik nie ma operacji usuwania plików ani wpisów kolejki. `paused_revoked` zapisuje stan i niczego nie kasuje; `device_wipe` zatrzymuje instancję (zero dalszych wywołań); czyszczenie wykonuje EVM-130.
- Logowanie: wyłącznie `RedactingLogger`. `android.util.Log`, `System.out`, `printStackTrace` i `println` w źródłach `apps/mobile/modules/**` pilnuje `tools/repo-policy` (`src/kotlin.ts`).
- Dane z serwera są walidowane przed użyciem i zapisem (numery części w planie, bez duplikatów, rozmiary, ETag: zestaw znaków i długość, identyfikator sesji); niezgodna odpowiedź to `needs_attention(invalid_server_response)`.
- Nieznana wersja zapisanego stanu (`schemaVersion`) nie wywraca silnika: zadanie startuje od początku przez `ListParts` (serwer zwraca aktywną sesję).
- Wariant e2e (stub scenariuszy `tools/mobile-e2e`: `http` i host `10.0.2.2`): tylko z flagą `HttpConfig.e2eCleartext` i `UploadEngineDeps.allowCleartextPartUrls` (osobny meta-data builda, który `verify` odrzuca w release); bez flagi silnik i transport odrzucają `http`.

## Zależności i łańcuch dostaw (AC6)
Wersje dokładne, wyłącznie Maven Central (bez Google, JitPack i Plugin Portal; `RepositoriesMode.FAIL_ON_PROJECT_REPOS`), sumy SHA-256 wszystkich artefaktów w `gradle/verification-metadata.xml` (`verify-metadata=true`, bez `<trust>`), dystrybucja Gradle i `gradle-wrapper.jar` z oficjalnymi sumami (sprawdza `tools/repo-policy`).

Stan znanych CVE: **2026-11-14, źródło OSV** (api.osv.dev, zapytanie `querybatch`, ekosystem Maven, wszystkie 77 komponentów z `gradle/verification-metadata.xml`). Data wydania = data publikacji w Maven Central (nagłówek `Last-Modified`).

| Narzędzie | Wersja | Licencja | Zakres | Opiekun | Data wydania | Znane CVE (OSV, 2026-11-14) |
|---|---|---|---|---|---|---|
| Gradle (wrapper) | 9.9.1 | Apache-2.0 | narzędzie budowania | Gradle Inc. | nie ustalono (sumy z gradle.org pilnuje `tools/repo-policy`) | nie sprawdzono w OSV (Gradle nie jest pakietem Maven) |
| Kotlin (wtyczka JVM, `kotlin-stdlib`) | 2.2.21 (poziom języka 2.2 = Kotlin React Native 0.88 / Expo 58) | Apache-2.0 | produkcja (`kotlin-stdlib`, `org.jetbrains:annotations` 13.0) | JetBrains | 2025-10-23 (annotations 13.0: 2013-12-17) | `kotlin-stdlib`, `annotations`: brak. Wtyczka `kotlin-gradle-plugin`: GHSA-r937-wjx7-w2jp (CVE-2026-53914, build cache) — środek łagodzący niżej |
| Kover | 0.9.11 (najnowsza w Maven Central) | Apache-2.0 | pokrycie (raport XML → lcov własnym konwerterem) | JetBrains | 2026-09-29 | brak |
| ktlint (`ktlint-cli`, jeden artefakt `all`) | 1.8.0 (najnowsza w Maven Central) | MIT | format i lint | Pinterest / społeczność ktlint | 2025-11-14 | brak |
| JUnit Jupiter + `junit-platform-launcher` | 6.1.3 | EPL-2.0 | **wyłącznie testy** (wyjątek zaakceptowany przez Konrada 2026-11-14) | zespół JUnit | 2026-08-07 | brak |
| Zależności przechodnie tylko przy budowaniu — nie trafiają do APK ani do ścieżki uruchomieniowej | `bcprov/bcpkix/bcpg/bcutil-jdk18on` 1.87, `freemarker` 2.3.35, `opentelemetry-api/-context/-common` 1.68.0 (wymuszone w `build.gradle.kts`) | MIT / Apache-2.0 / BSD-3 | konfiguracje `kotlinBouncyCastleConfiguration` (publikacja bibliotek), `swiftExportClasspathResolvable` (Swift export), classpath wtyczek (FreeMarker z Kovera, używany tylko do raportu HTML, którego nie generujemy). Dwie pierwsze konfiguracje Gradle rozwiązuje tylko zadanie `dependencies`/zapis sum, nie `check` | Bouncy Castle, FreeMarker, OpenTelemetry | 2026-11-11 / 2026-08-23 / 2026-11-06 | po poprawce brak. Zostaje jedno: `kotlin-gradle-plugin` 2.2.21 — GHSA-r937-wjx7-w2jp |

**Ryzyko rezydualne (zaakceptowane przez Konrada 2026-11-15):** wtyczka Kotlin 2.2.21 ma GHSA-r937-wjx7-w2jp (CVE-2026-53914, niebezpieczna deserializacja w pamięci podręcznej budowania Kotlin, poprawka od 2.4.20-Beta1). Wersja zostaje, bo źródła kompiluje też aplikacja z Kotlinem Expo 58 (EVM-130). Środek łagodzący: `org.gradle.caching=false`, brak konfiguracji `buildCache` (lokalnej i zdalnej) — pilnuje tego `tools/repo-policy` (`buildCacheProblems`). Wykorzystanie wymagałoby podstawienia złośliwego wpisu w pamięci podręcznej, której projekt nie czyta ani nie zapisuje; atakujący musiałby więc już mieć zapis w repozytorium albo w katalogu `.gradle` maszyny budującej. To narzędzie budowania, nie trafia do APK.

Poprawione wersje przechodnie wymusza `resolutionStrategy.eachDependency` w `build.gradle.kts` (dokładne wersje, Maven Central, sumy SHA-256 w `gradle/verification-metadata.xml`, sumy porównane z `.sha256` w Maven Central). Przy podnoszeniu Kotlina, Kovera lub ktlint sprawdź, czy wymuszenia są jeszcze potrzebne, i usuń je, gdy nowe wersje niosą poprawione biblioteki.

Zadanie `checkProductionDependencies` pilnuje, że ścieżka uruchomieniowa zawiera tylko `kotlin-stdlib` i `org.jetbrains:annotations`.

## Aktualizacja zależności
Zmiana wersji dowolnej zależności (też wymuszonej w `resolutionStrategy`) przechodzi przez te kroki:
1. Wersje dokładne, tylko Maven Central; w `build.gradle.kts` zmień jedną rzecz naraz.
2. Zregeneruj sumy od zera (stary plik usuń, żeby nie zostały sumy wersji, których już nie ma), w tym katalogu:
   `./gradlew --no-daemon --write-verification-metadata sha256 buildEnvironment dependencies ktlintCheck test koverXmlReport koverVerify checkProductionDependencies`
   (`JAVA_HOME` = JDK 17; po pracy `./gradlew --stop`). `dependencies` i `buildEnvironment` wciągają konfiguracje, których `check` nie rozwiązuje.
3. Przejrzyj diff `gradle/verification-metadata.xml`: zmieniają się tylko sumy zmienionych komponentów, zero `<trust>` i wersji dynamicznych. Dla nowych artefaktów porównaj SHA-256 z `.sha256` opublikowanym w Maven Central (gdy brak: `.sha512` albo `.sha1` policzone z pobranego pliku).
4. Wrapper: nowa wersja Gradle wymaga sum z gradle.org/release-checksums w `OFFICIAL_GRADLE_CHECKSUMS` (`tools/repo-policy/src/kotlin.ts`), `distributionSha256Sum` i `gradle-wrapper.jar` zgodnych z oficjalnymi; `tools/repo-policy` czerwieni się przy rozbieżności.
5. Sprawdź w OSV wszystkie komponenty z nowego pliku sum (POST `https://api.osv.dev/v1/querybatch`, ekosystem `Maven`, nazwa `group:artifact`, wersja; wysyłamy wyłącznie nazwy i wersje) i zaktualizuj kolumny „Data wydania” oraz „Znane CVE” w tabeli powyżej z datą sprawdzenia.
6. `pnpm run gate:kotlin` i testy `tools/repo-policy` muszą być zielone. Ostatni przebieg `gate:kotlin` zrób na pustym katalogu domowym Gradle (`GRADLE_USER_HOME` na nowy katalog w `.scratch/`) i po usunięciu `engine/build` oraz `engine/.gradle`: rozgrzany katalog i aktualne wyniki zadań ukrywają brakujące sumy (np. plików `.pom`), a CI zaczyna od zera. Do wykrycia braków służy `--write-verification-metadata sha256 --dry-run` (zapisuje `verification-metadata.dryrun.xml`; plik usuń).

## Porty dla kleju Androida (etap A2)
Klej Androida nie ma logiki decyzyjnej: tworzy obiekty z tych portów i wywołuje `UploadJobRunner`, `WipeChain`, `SchedulePolicy`. Wszystkie interfejsy są w silniku (pakiet bazowy `pl.eviacharge.upload`).

| Port / klasa do dostarczenia | Pakiet | Co klej implementuje |
|---|---|---|
| `RecordCipher` (przez `JceRecordCipher { key }`) | `session` | szyfr rekordu tokenów: AES/GCM/NoPadding, klucz 256 bit z Android Keystore pod własnym aliasem (bez uwierzytelnienia użytkownika, `randomizedEncryptionRequired`, IV losuje Keystore); `key()` zwraca `null` albo rzuca, gdy klucza brak |
| `KeyEraser` | `files` | usuwa z Keystore alias klucza magazynu tokenu (klucz bazy SQLCipher zostaje) |
| katalog bazowy `UploadFiles(root)` | `files` | `noBackupFilesDir/evia-upload` (pamięć CE, bez `directBootAware`); silnik tworzy w nim `jobs/`, `originals/`, `token.bin`, `wipe.marker`, `contact.json`, `job-ids.json` |
| `MonotonicClock` | `session` | `SystemClock.elapsedRealtime()` (okno 20 s odświeżania) |
| `ClockReadings` | `files` | odczyt `ClockReading(wallMs, monoMs, bootId)`; `bootId` np. z `/proc/sys/kernel/random/boot_id` albo licznika uruchomień systemu |
| `LogSink` | `(bazowy)` | jedyne ujście zredagowanych linii logu (`RedactingLogger`); nic innego nie loguje |
| `JobCanceller` | `files` | `JobScheduler.cancel(id)` dla każdego id z `JobIdRegistry.allIds()` |
| `InstanceStopper` | `files` | zatrzymuje działające instancje: `CancelHandle.cancel()` i przerwanie wątków workerów |
| `TokenWiper` | `files` | `TokenOwner.wipe()` (pamięć i magazyn) |
| `StopCheck` | `(bazowy)` | `WipeMarker.isStopped()` — ta sama instancja dla `UploadEngineDeps.stop`, `HttpCore` i `HttpPartTransport` |
| `Sleeper`, `RandomSource`, `IdSource` | `(bazowy)` | `Thread.sleep` (przerwanie → `UploadCancelledException`), `ThreadLocalRandom`, UUIDv7 |
| `ContactSink` | `files` | zwykle `ContactMarker(files.contactFile, readings)`; JS bierze max(własny, natywny) |
| `HttpConfig(apiBaseUrl, storageHosts, clientVersion, e2eCleartext)` | `http` | z meta-data builda: `pl.eviacharge.API_BASE_URL`, `pl.eviacharge.STORAGE_HOSTS`, `pl.eviacharge.UPLOAD_E2E_CLEARTEXT`; wersja aplikacji z `PackageInfo` |
| fabryka silnika `(JobFileData) -> UploadEngine` | `runner` | składa `UploadEngineDeps`: `HttpUploadApi(core, tokenOwner, contact, job.workOrderId, job.assetId)`, `HttpPartTransport(core, cancel, marker, files.originalFile(job.assetId))`, `JobFileStore`, `allowedHosts = config.storageHosts`, `allowCleartextPartUrls = config.e2eCleartext`; `HttpCore` i `CancelHandle` są per zadanie (jeden wątek) |
| `TokenOwner(vault, HttpAuthApi, clock, HttpAuthApi, contact)` | `session` | jedna instancja na proces; `FileTokenVault(files.tokenFile, cipher)`; `load()` przy starcie procesu |
| `JobIdRegistry(files.jobIdsFile)` | `files` | `idFor(assetId)` przy uzbrajaniu zadania, `release` po zakończeniu |
| powiadomienia | `notification` | `NotificationText` (teksty); kanał i `PendingIntent` to klej |
| `SchedulePolicy.decide(api, appVisible, userInitiatedRefused, wifiOnly)` → `JobSpec` | `schedule` | klej zamienia `JobSpec` na `JobInfo` (UIDT, sieć `ANY`/`UNMETERED`, `setPersisted(true)`) i po `SecurityException` pyta ponownie z `userInitiatedRefused = true` |
| `JobResult` z `UploadJobRunner.run` → `jobFinished` | `runner` | `Retry`, `RetryChecksum`, `Stopped` = `wantsReschedule = true`; pozostałe = `false`; `DeviceWipe` uruchamia `WipeChain.run()` |

Przy starcie procesu: `WipeChain.finishIfPending()`, `TokenOwner.load()`, potem uzbrajanie zadań z kolejki JS (`JobFileStore.arm`). Znacznik czyszczenia znosi dopiero `WipeMarker.clearAfterLogin()` po pełnym logowaniu, gdy czyszczenie jest zakończone.
