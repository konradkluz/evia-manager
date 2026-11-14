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

| Narzędzie | Wersja | Licencja | Zakres |
|---|---|---|---|
| Gradle (wrapper) | 9.9.1 | Apache-2.0 | narzędzie budowania |
| Kotlin (wtyczka JVM, `kotlin-stdlib`) | 2.2.21 (poziom języka 2.2 = Kotlin React Native 0.88 / Expo 58) | Apache-2.0 | produkcja (`kotlin-stdlib`, `org.jetbrains:annotations`) |
| Kover | 0.9.11 | Apache-2.0 | pokrycie (raport XML → lcov własnym konwerterem) |
| ktlint (`ktlint-cli`, jeden artefakt `all`) | 1.8.0 | MIT | format i lint |
| JUnit Jupiter + `junit-platform-launcher` | 6.1.3 | EPL-2.0 | **wyłącznie testy** (wyjątek zaakceptowany przez Konrada 2026-11-14) |

Zadanie `checkProductionDependencies` pilnuje, że ścieżka uruchomieniowa zawiera tylko `kotlin-stdlib` i `org.jetbrains:annotations`.
