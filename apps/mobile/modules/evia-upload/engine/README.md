# Silnik wysyłania plików (Kotlin) — `modules/evia-upload/engine`

Czysty silnik wysyłania plików z EVM-109 (ADR-0020, `docs/architecture/media-pipeline.md` §1–§3, §6): wieloczęściowy upload z wznawianiem bez duplikatów, mapowanie odpowiedzi serwera na stany, adresy części tylko w pamięci i logi z redakcją. **Bez zależności od Androida, Expo i JSON** — to samodzielny projekt Gradle/JVM, testowany bez emulatora i bez `expo prebuild`. Usługa Androida, natywny magazyn tokenów, kolejka plików i adaptery HTTP to EVM-130: dołączy te źródła jako `sourceSet` modułu Androida (bez drugiej wtyczki Kotlin w buildzie APK) i dostarczy implementacje portów.

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
| `RedactingLogger.kt` | jedyna droga do logów: kod zdarzenia i pola z listy dozwolonych; redakcja adresów, `Bearer`, `X-Amz-*`, sygnatur, wyjątków (komunikat, przyczyny, stos) |

## Zasady (kontrakt dla EVM-130)
- Adres części jest pobierany tuż przed jej wysłaniem i trzymany wyłącznie w pamięci; `PartUrl` i `PartRequest` nie drukują adresu w `toString`.
- Żądanie części ma tylko nagłówek `Content-Length` (nigdy `Authorization`); host adresu musi być na liście dozwolonych hostów magazynu (konfiguracja; w testach `*.test`) — inaczej `needs_attention(untrusted_part_url)` bez wysyłki. **`PartTransport` nie podąża za przekierowaniami** (adapter musi to wyłączyć).
- Adapter `UploadApi` sam odświeża access token i ponawia raz; do silnika trafia `401` dopiero po nieudanym odświeżeniu, a `401` z innym kodem niż `session_revoked` i `device_wipe_required` daje `needs_attention(unknown)`.
- Silnik ponawia w procesie najwyżej 4 razy (potem `retry_later(delayMs)`) i odnawia adres części po `403` najwyżej 3 razy; dalsze ponawianie należy do harmonogramu systemowego (EVM-130). Brak nieograniczonego `sleep`.
- Silnik nie ma operacji usuwania plików ani wpisów kolejki. `paused_revoked` zapisuje stan i niczego nie kasuje; `device_wipe` zatrzymuje instancję (zero dalszych wywołań); czyszczenie wykonuje EVM-130.
- Logowanie: wyłącznie `RedactingLogger`. `android.util.Log`, `System.out`, `printStackTrace` i `println` w źródłach `apps/mobile/modules/**` pilnuje `tools/repo-policy` (`src/kotlin.ts`).
- Dane z serwera są walidowane przed użyciem i zapisem (numery części w planie, bez duplikatów, rozmiary, ETag: zestaw znaków i długość, identyfikator sesji); niezgodna odpowiedź to `needs_attention(invalid_server_response)`.
- Nieznana wersja zapisanego stanu (`schemaVersion`) nie wywraca silnika: zadanie startuje od początku przez `ListParts` (serwer zwraca aktywną sesję).
- EVM-130: stub scenariuszy `tools/mobile-e2e` musi serwować części przez HTTPS albo lista dozwolonych hostów i polityka adresu muszą dostać jawnie opisany wariant testowy (silnik odrzuca `http`).

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

**Ryzyko rezydualne (do akceptacji Konrada):** wtyczka Kotlin 2.2.21 ma GHSA-r937-wjx7-w2jp (CVE-2026-53914, niebezpieczna deserializacja w pamięci podręcznej budowania Kotlin, poprawka od 2.4.20-Beta1). Wersja zostaje, bo źródła kompiluje też aplikacja z Kotlinem Expo 58 (EVM-130). Środek łagodzący: `org.gradle.caching=false`, brak konfiguracji `buildCache` (lokalnej i zdalnej) — pilnuje tego `tools/repo-policy` (`buildCacheProblems`). Wykorzystanie wymagałoby podstawienia złośliwego wpisu w pamięci podręcznej, której projekt nie czyta ani nie zapisuje; atakujący musiałby więc już mieć zapis w repozytorium albo w katalogu `.gradle` maszyny budującej. To narzędzie budowania, nie trafia do APK.

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
6. `pnpm run gate:kotlin` i testy `tools/repo-policy` muszą być zielone.
