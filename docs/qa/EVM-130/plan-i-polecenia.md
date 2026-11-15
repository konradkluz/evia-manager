# EVM-130 — plan testów, polecenia dla orkiestratora i miejsce na wyniki

Historyjka: [EVM-130](../../backlog/M2/EVM-130-mobile-usluga-wysylania-i-tokeny.md) (AC1–AC8). Etap C (przepływy Maestro 50–68, serwer scenariuszy w przebiegu, kroki urządzenia). Środowisko: emulator Androida na Windows (ADR-0015), Maestro 2.11.0, wariant e2e aplikacji; wyłącznie dane i konto syntetyczne. **Stan: przepływy i narzędzia gotowe i przetestowane jednostkowo (`node:test`); przebieg na emulatorze jeszcze nie wykonany — tabele wyników na końcu czekają na orkiestratora.**

## 1. Warunek wstępny: lokalne scalenie obu torów

Na samej gałęzi toru A (`feature/queue-2026-11-14-mobile-media`) kolejka **nie przyjmuje** komendy `CreateMediaAsset` — typ komendy przychodzi z gałęzi EVM-131 (`feature/queue-2026-11-14-api-media-i-drobne`: `packages/sync-core/src/types.ts`, `validate.ts`, kontrakt). Aplikacja buduje wpis (`createMediaAssetInput`), ale `enqueue` odpowiada `invalid_input`, więc przepływy 50–68 nie mają czego wysłać. Typu **nie dodajemy** do `packages/sync-core` w tej gałęzi (zgłoszono w historyjce; typecheck dowodzi zgodności z kontraktem).

Przebieg: lokalne scalenie obu gałęzi (bez `push`, najlepiej w osobnym klonie), potem zwykły build wariantu e2e. Miejsca, w których oba tory zmieniają te same pliki i gdzie scalenie może wymagać ręcznego rozstrzygnięcia: `tools/mobile-e2e/src/{scenarios,sync-stub,stub-api,stub-worker,process,run}.mjs`, `tools/mobile-e2e/test/{flows,run,sync-stub,process}.test.mjs`, `apps/mobile/src/i18n/pl.ts`, `apps/mobile/src/screens/QueueScreen.tsx`, `apps/mobile/src/e2e-hooks/panel.tsx`, `CHANGELOG.md`. Zmiany toru A w plikach wspólnych są w osobnych blokach (nowe pliki: `src/upload-scenarios.mjs`, `src/device-upload.mjs`, `src/media-replica.mjs`; w `scenarios.mjs` tylko pole `upload` typu kroku). Po scaleniu uruchom `npm run test:tools` i `pnpm --filter @evia/mobile-e2e run test:coverage`, zanim ruszysz emulator.

## 2. Polecenia

Maszyna: jeden emulator naraz (E2E torów naprzemiennie; sprawdź, czy nie istnieje `C:\Users\Konrad\evia-manager\.scratch\queue-2026-11-14\gate.lock`); wolne miejsce na dysku — plik testowy ma 40 MiB (część scenariuszy 24 MiB), plus pakiety APK i dane Gradle. Build z krótkiego klonu (`EVIA_E2E_SHORT_PATHS=1`, `docs/ops/dystrybucja-apk-android.md`, „Droga A”). Wariant e2e nie wymaga `EVIA_STORAGE_HOSTS` (host magazynu to host adresu API, dopuszczone `10.0.2.2`).

| Krok | Polecenie (z katalogu głównego repozytorium) |
|---|---|
| Testy narzędzia | `pnpm --filter @evia/mobile-e2e run test:coverage` oraz `npm run test:tools` |
| Pełny przebieg wysyłania z buildem | `node tools/mobile-e2e/cli.mjs --only upload-` |
| Powtórka bez buildu | `node tools/mobile-e2e/cli.mjs --skip-build --only upload-` |
| Jeden scenariusz | `node tools/mobile-e2e/cli.mjs --skip-build --only upload-interruptions` (nazwy poniżej; `--only` bierze nazwy lub przedrostki po przecinku) |
| Domyślny przebieg (bez wysyłania) | `node tools/mobile-e2e/cli.mjs --skip-build` — scenariusze z `src/scenarios.mjs`, jak dotąd |
| Raport | `.scratch/mobile-e2e/report.md` (przepływy, kroki urządzenia z liczbami i kodami, przegląd logcat aplikacji) |

Kolejność scenariuszy jest ustalona w `src/upload-scenarios.mjs`; każdy zaczyna od czystej instalacji (`50-upload-sign-in`) i od `upload-reset` na serwerze scenariuszy. `--only upload-` trwa długo (restart emulatora w scenariuszu AC1, pliki 40 i 24 MiB z opóźnieniem 5 s na część): najpierw `upload-interruptions` osobno, bo jest najważniejszy i najbardziej zależny od czasu.

Diagnoza ręczna: runner nie wypisuje portu sterującego części wysyłania (hostowi udostępnia go w kodzie, `stub.uploadControlPort`). Do prób bez emulatora uruchom samodzielny serwer `node tools/mobile-e2e/upload-stub-cli.mjs` (wypisuje oba porty) i steruj nim żądaniami `POST /control/…` na `127.0.0.1`.

Po scaleniu torów i zielonym przebiegu scenariusze wysyłania można włączyć do domyślnego przebiegu (`selectScenarios(null)` w `src/upload-scenarios.mjs` zwracałby oba zestawy; wymaga to dostosowania oczekiwań w `test/run.test.mjs`, które dziś liczą tylko scenariusze z `src/scenarios.mjs`) — decyzja orkiestratora.

## 3. Scenariusze i przepływy

Zasada przepływów: dane syntetyczne; plik generuje hak e2e (losowa zawartość natywnie, nic binarnego w repozytorium); rozmiar to jedna decyzja przepływu i scenariusza (`upload-size`): 40 MiB = 10 części po 4 MiB (rozmiar części w przebiegu), 24 MiB = 6, 1 MiB = 1; opóźnienie odpowiedzi na część (`upload-part-delay:5000`) to okno na przerwanie — część jest zapisana od razu, odpowiedź przychodzi późno, więc aplikacja zabita w tym czasie nie widziała ETagu, a wznowienie znajduje część przez `ListParts` zamiast wysyłać ją znowu.

| Scenariusz (`--only`) | AC | Kroki (przepływ → kroki urządzenia/serwera po przepływie) | Co dowodzi |
|---|---|---|---|
| `upload-interruptions` | AC1, AC3, AC5 (log), AC6 (powiadomienie) | `50` logowanie → `51` (samolot) plik 40 MiB do kolejki, **`jobs-none`, `upload-none-yet`** → `52` (sieć wraca, aplikacja w tle → pierwszy plan) postęp, **`jobs-armed`, `notification-private`, `kill-9`** → `52` po zabiciu, **`force-stop`** → `52` po ponownym otwarciu → `53` (samolot w trakcie części) → `52` (sieć wraca), **`reboot`** → `54` „Wysłano”, **`upload-checkpoint:4`, `original-present`, `tokens-not-in-clear`, `logcat-clean`** | Zadanie uzbrojone dopiero po `applied` (brak zadania i zero żądań do serwera offline); wznowienie po `kill -9`, `force-stop` (rusza dopiero po otwarciu), przerwaniu sieci i restarcie emulatora; jeden obiekt na `assetId`, SHA-256 równe SHA-256 oryginału na urządzeniu, zero osieroconych multipartów, najwyżej 4 części wysłane ponownie (po jednej na przerwanie); w logu i plikach aplikacji brak `X-Amz-` i tokenów |
| `upload-original-until-clean` | AC4 | `50` → `55` plik 1 MiB → `54` „Wysłano”, **`upload-checkpoint:0`, `original-present`** → `54` (w tle → pierwszy plan; przed nim **`upload-file-state:clean`**), **`original-absent`** | Oryginał zostaje, dopóki serwer nie potwierdził stanu (replika „uploading”); po `clean` (ogłoszone w replice jako `ready`) oryginał znika, rekord zostaje („Wysłano”) |
| `upload-file-verdicts` | AC4 | `50` (werdykt `checksum_mismatch`) → `55` → `57` „Nie wysłano — plik uszkodzony w transmisji” + „Ponów”, **`original-present`** → `58` (przed nim `upload-verdict:none`) „Ponów” → „Wysłano” → `55` (werdykt `quarantined`) → `59` karta „Plik wymaga uwagi” bez „Ponów”, **`original-present`** | `failed: checksum_mismatch` daje „Ponów”; kwarantanna — „Wymaga uwagi” bez ponowienia; oryginał zostaje w obu przypadkach |
| `upload-token-refresh` | AC2, AC3, AC5 (log) | `50` → `56` plik 24 MiB w trakcie, **`upload-expire-access`** → `54` „Wysłano”, nie „Wylogowano”, **`upload-refreshed`, `upload-checkpoint:1`, `tokens-not-in-clear`, `logcat-clean`** | Wygasły token dostępu w trakcie wysyłki odświeża moduł natywny (serwer widzi rotację, zero ponownego użycia tokenu), bez wylogowania; tokeny nigdzie jawnie w danych aplikacji ani w logu |
| `upload-session-revoked` | AC5 | `50` → `56`, **`upload-fault:session_revoked`** → `60` (w tle → pierwszy plan) „Wylogowano ten telefon” → (przed nim `upload-fault-clear:…`) `61` ponowne logowanie, „Wysłano”, **`upload-checkpoint:2`, `tokens-not-in-clear`, `logcat-clean`** | `401 session_revoked` wstrzymuje wysyłkę (`paused_revoked`), kolejka zostaje; po pełnym logowaniu tego samego właściciela wznowienie i jeden obiekt |
| `upload-update-required` | AC5 | `50` → `56`, **`upload-fault:version_unsupported`** → `62` „Zaktualizuj aplikację”, **`original-present`** | `426` wstrzymuje wysyłkę i pokazuje ekran aktualizacji; plik zostaje |
| `upload-device-wipe` | AC5 | `50` → `56`, **`upload-fault:device_wipe_required`** → `63` „Dane firmowe usunięte z telefonu”, **`jobs-none`, `app-files-none`, `tokens-not-in-clear`, `logcat-clean`** | Czyszczenie na polecenie serwera: brak zadań systemowych, plików zadań, oryginałów i pliku tokenu; log czysty |
| `upload-manual-wipe` | AC5 | `50` → `56` → `68` („Więcej” → „Wyczyść dane firmowe” → potwierdzenie → ekran logowania), **`jobs-none`, `app-files-none`, `tokens-not-in-clear`, `logcat-clean`** | To samo przy czyszczeniu wybranym przez technika (krok E11 przed `confirmDeviceWipe`) |
| `upload-hidden-data` | AC5 | `50` → `56` → `64` (hak „no contact 8 days”, powrót na pierwszy plan) „Dane zleceń są ukryte”, **`upload-checkpoint:2`** → `65` ekran nadal ukryty | W trybie ukrytych danych wysyłka trwa i kończy się jednym obiektem, a worker nie przywraca widoczności danych |
| `upload-notification` | AC6 | `50` → `56`, **`notification-private`** | Kanał o niskim priorytecie (bez dźwięku i wibracji), widoczność prywatna z wersją publiczną, tekst z listy AC6, bez numerów zleceń, nazw i adresów, bez przycisków |
| `upload-permission-banner` | AC6 | `50` → `51` (samolot) → `66` aplikacja otwarta bez zgody na powiadomienia: Banner „Powiadomienia wyłączone — nie zobaczysz, że wysyłanie się zatrzymało.” + „Włącz powiadomienia” → `67` (przed nim `notifications-grant`) Banner znika | Kolejka pokazuje Banner bez zgody; stan „czeka” nie jest błędem |

## 4. Mapa AC → dowody (wszystkie etapy)

| AC | Dowody automatyczne | Dowód na emulatorze (etap C) | Poza etapem C / ręcznie |
|---|---|---|---|
| AC1 | JVM (wznawianie, uzbrajanie po `applied`), Jest `media-uploads.test.ts`, `media-file-store.test.ts`; `node:test` serwera (punkt kontrolny) | `upload-interruptions` | Restart fizyczny, producenci zabijający procesy, UIDT na fizycznym Androidzie 14+ — EVM-112 |
| AC2 | JVM `TokenOwner` (jedna blokada, zapis przed użyciem, okno ≤ 20 s), test manifestu (proces domyślny), Jest `session-owner`, `native-contact` | `upload-token-refresh` | — |
| AC3 | JVM (schemat pliku zadania bez tokenów, magazyn AES-GCM), Jest `token-store`, `design-rules`, `session-owner` | `tokens-not-in-clear` w scenariuszach (`upload-interruptions`, `upload-token-refresh`, `upload-session-revoked`, wipe) | **Aktualizacja ze starej wersji** (jedno ponowne logowanie, kolejka zostaje) nie ma automatycznego przepływu: wymaga dwóch pakietów — Jest `session-owner.test.ts`/`session-composition.test.ts` pokrywa logikę; ręcznie (opcjonalnie, EVM-112): zainstalować poprzedni APK z danymi, `adb install -r` nowy, zalogować raz, sprawdzić kolejkę |
| AC4 | JVM (`OriginalVerdict`), Jest `media-uploads`, `queue-files` | `upload-original-until-clean`, `upload-file-verdicts` | — |
| AC5 | JVM (`paused_revoked`, 426, znacznik czyszczenia), Jest `media-wipe`, `session-owner`, tryb ukryty | `upload-session-revoked`, `-update-required`, `-device-wipe`, `-manual-wipe`, `-hidden-data` (+ `jobs-none`, `app-files-none`, `logcat-clean`) | — |
| AC6 | JVM `NotificationText`/`NotificationPlanner`, Jest `queue-files` (Banner, zgoda) | `upload-notification`, `upload-permission-banner` | Dotknięcie powiadomienia otwiera Kolejkę (za blokadą), ścieżka Androida 13 na telefonie — Jest i EVM-112; Maestro nie dotyka powiadomień |
| AC7 | `node:test` `tools/mobile-apk` (testy pozytywne i negatywne) | `tools/mobile-apk verify` w przebiegu (release i e2e) | — |
| AC8 | `node:test` `upload-stub.mjs`, `media-replica.mjs`, `stub-api.mjs` (montaż), `device-upload.mjs`, `run.mjs`; pokrycie pliku ≥ 90% | cały przebieg (serwer jest częścią przebiegu) | — |

## 5. Miejsca, które najpewniej wymagają poprawek po pierwszym przebiegu na emulatorze

Narzędzia są sprawdzone na atrapach; poniższe zależą od zachowania systemu i aplikacji, którego atrapy nie odtwarzają.

1. **Format `dumpsys jobscheduler` i `dumpsys notification`** (`jobs-armed`/`jobs-none`, `notification-private`): wzorce w `device-upload.mjs` są oparte na formacie Androida 14/15 (`JOB #u0a…/id: … pakiet/…UploadJobService`, `vis=PRIVATE`, `publicVersion=`, `NotificationChannel{… mName=Wysyłanie plików, mImportance=2 …}`); pierwszy przebieg pokaże, czy pasują. Sprawdzaj wynik kroku w raporcie (opis kroku zawiera liczby, nigdy treść).
2. **Okna czasowe**: opóźnienie 5 s na część i rozmiar części 4 MiB zakładają, że między przerwaniami wysyłka nie skończy się przed restartem emulatora (zapas: około 3 części). Gdy plik skończy się za wcześnie, zwiększ `SLOW` w `src/upload-scenarios.mjs` (nie zmniejszaj sprawdzeń).
3. **`force-stop` anuluje zadania systemowe** — `52` po ponownym otwarciu zakłada, że uzgadnianie przy starcie uzbraja zadanie od nowa; jeśli nie, przepływ wyczeka limitu 120 s i zawiedzie z czytelnym powodem.
4. **Teksty widoczne dla UiAutomator**: wiersz pliku to węzeł z opisem „Plik, <stan>” (dostępny, scala dzieci); `file-progress-*` nie jest używany. Karta „Wymaga uwagi” jest sprawdzana przez identyfikator i nagłówek sekcji, nie przez treść karty.
5. **Ekrany stanów** (`60`, `62`, `63`, `64`, `68`): teksty i identyfikatory pochodzą z katalogu i źródeł (test `upload-flows.test.mjs` pilnuje ich istnienia), ale przejście z natywnego stanu sesji do ekranu zależy od uzgadniania `reconcileNative` przy powrocie na pierwszy plan; przepływy używają `background: true` (HOME → powrót) właśnie po to.
6. **Tryb ukrytych danych** (`64`): hak `e2e-contact-8` zmienia przesunięcie czasu bez kontaktu, a ponowne sprawdzenie następuje przy powrocie na pierwszy plan; jeśli ekran nie reaguje, przepływ wyczeka 60 s.
7. **`launchApp … permissions: notifications: deny`** (`66`): Maestro domyślnie nadaje wszystkie uprawnienia przy każdym uruchomieniu; cofnięcie uprawnienia kończy proces aplikacji, więc przepływ otwiera ją od nowa.
8. **Czas restartu emulatora** (`reboot`): po restarcie Maestro instaluje sterownik od nowa (jedna powtórka następnego przepływu jest wbudowana w runner).

## 6. Otwarte kwestie widoczne dopiero przy tym etapie (do decyzji, bez zmiany AC)

- **Aplikacja nie deklaruje pliku w sesji.** Kontrakt EVM-131 wymaga w `CreateUploadSessionRequest` pola `file` (`fileName`, `declaredSize`, `contentType`, `sha256`) dla medium z telefonu (`400 validation_failed` `/file` `required`). Silnik Kotlin (etap A) tego pola nie wysyła, więc **z prawdziwym serwerem EVM-131 utworzenie sesji nie przejdzie**. Serwer scenariuszy tego etapu akceptuje oba warianty (z deklaracją i bez; bez niej rozmiar bierze ze scenariusza). Potrzebna zmiana w silniku (`modules/evia-upload/engine/**`, poza zakresem tego etapu) przed integracją z EVM-131 — zgłoszone w raporcie etapu.
- **`@evia/sync-core` nie zna `clean` ani `quarantined`.** Projekcja pobierania czyta tylko `pending | uploading | processing | ready | failed`; kontrakt EVM-131 dopuszcza `clean` i `quarantined` (telefon kasuje oryginał po `clean` albo `ready`). Serwer scenariuszy ogłasza `clean` jako `ready`, a kwarantannę — tak jak serwer (`quarantined`; encja jest pomijana, bo pobieranie jej nie czyta); aplikacja bierze werdykt kwarantanny z odpowiedzi `complete`. Do decyzji w EVM-131/111: rozszerzyć projekcję o `clean` i `quarantined`.
- **Brak `EVIA_STORAGE_HOSTS` w `ci.yml`** — paczka z CI nie ma wysyłania (fail-closed); zmienna jest opisana w `docs/ops/dystrybucja-apk-android.md`.

## 7. Wyniki (do wypełnienia po przebiegu)

Commit, na którym wykonano przebieg: _(brak)_ · data: _(brak)_ · emulator / API: _(brak)_ · Maestro: 2.11.0.

| Scenariusz | Wynik | Uwagi / poprawki |
|---|---|---|
| `upload-interruptions` | _niewykonany_ | |
| `upload-original-until-clean` | _niewykonany_ | |
| `upload-file-verdicts` | _niewykonany_ | |
| `upload-token-refresh` | _niewykonany_ | |
| `upload-session-revoked` | _niewykonany_ | |
| `upload-update-required` | _niewykonany_ | |
| `upload-device-wipe` | _niewykonany_ | |
| `upload-manual-wipe` | _niewykonany_ | |
| `upload-hidden-data` | _niewykonany_ | |
| `upload-notification` | _niewykonany_ | |
| `upload-permission-banner` | _niewykonany_ | |

Weryfikacja wersji zależności w buildzie aplikacji (po `prebuild`, w katalogu z `android/`): `gradlew :app:buildEnvironment` oraz `gradlew :app:dependencies --configuration releaseRuntimeClasspath`, wynik filtrowany po `org.bouncycastle|org.freemarker|io.opentelemetry`; sprawdź też, że `org.gradle.caching` nie jest `true` w wygenerowanym `gradle.properties` (CVE-2026-53914, wtyczka Kotlin 2.2.21).
