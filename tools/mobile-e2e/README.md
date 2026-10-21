# Test dymny Maestro na emulatorze (`tools/mobile-e2e/`)

EVM-009 AC4 (ADR-0015: E2E Android — Maestro na emulatorze Androida na Windows jest jedynym dowodem; w CI bez emulatora). Działa **bez instalacji zależności** (tylko `node:*`); procesy startowane z tablicą argumentów, nigdy przez powłokę (Gradle i Maestro przez `java -classpath …`, bo Node nie uruchamia plików `.bat` bez powłoki).

`pnpm --filter @evia/mobile run e2e` (= `node tools/mobile-e2e/cli.mjs [--skip-build] [--port <n>]`):

1. **Preflight** (`src/preflight.mjs`): `ANDROID_HOME` (domyślnie `%LOCALAPPDATA%\Android\Sdk`), `adb`, `emulator`, `JAVA_HOME` (JDK 17), Maestro (`EVIA_MAESTRO_HOME`, domyślnie `%USERPROFILE%\.evia\tools\maestro-2.11.0`) i — na Windows — **długie ścieżki** (`LongPathsEnabled`), bez których natywny build React Native się nie powiedzie (komunikat z poleceniem naprawczym).
2. **Emulator** (`src/adb.mjs`): dokładnie jeden. Gdy żaden nie działa, startuje AVD `Medium_Phone_API_35` i czeka na `sys.boot_completed`; więcej niż jeden = odmowa (maszyna uruchamia jeden naraz).
3. **Build wariantu e2e** (`expo prebuild --clean`, `gradlew assembleRelease` tylko dla ABI `x86_64`): `EVIA_BUILD_VARIANT=e2e`, adres API `http://10.0.2.2:<port>`, `EXPO_NO_TELEMETRY=1`, `MAESTRO_CLI_NO_ANALYTICS=1`; środowisko procesów to lista dozwolona (`PATH`, `JAVA_HOME`, … — żadnych tokenów hosta). Opcjonalnie `EVIA_ANDROID_CMAKE_VERSION=3.31.6` (CMake z Ninja obsługującym długie ścieżki).
4. **Serwer scenariuszy** (`src/stub-api.mjs`) na `127.0.0.1:<port>` (nigdy 0.0.0.0): `GET /api/health` w trybach `ok` / `update` (minimum 99.0.0) / `down` (503 `problem+json`); zapisuje tylko nagłówki `X-Client-Platform` i `X-Client-Version`.
5. **Przepływy** (`apps/mobile/e2e/*.yaml`, kolejność i stan serwera/trybu samolotowego w `src/scenarios.mjs`): online · tryb samolotowy i powrót sieci (aplikacja w tle → sieć wraca → pierwszy plan) · aktualizacja wymagana · serwer niedostępny i ponowienie. Test `test/flows.test.mjs` pilnuje zgodności przepływów ze scenariuszami i identyfikatora aplikacji.
6. **Raport** `.scratch/mobile-e2e/report.md` (poza gitem): model i **poziom API emulatora**, wersja Maestro, wynik każdego przepływu, nagłówki zgodności na każdym żądaniu, przegląd logcat procesu aplikacji (liczby linii z adresem / słowem „token”, bez treści). Wynik zielony = wszystkie przepływy + nagłówki + czysty log.

**Build z krótkiego klonu (bez administratora):** `EVIA_E2E_SHORT_PATHS=1` pomija kontrolę rejestru i dopisuje do Gradle skrypt inicjujący z `-DCMAKE_OBJECT_PATH_MAX=250` (opis i kroki: `docs/ops/dystrybucja-apk-android.md`, „Droga A”). Serwer scenariuszy działa w wątku roboczym (`src/stub-worker.mjs`), bo runner blokuje swój wątek w synchronicznym procesie Maestro; emulator jest uznany za gotowy dopiero, gdy odpowiada usługa pakietów; pierwszy przepływ po świeżym starcie ma jedną powtórkę (instalacja sterownika Maestro), jawną w raporcie (`passed (retried)`, linia `Retried flows`).

Testy: `pnpm --filter @evia/mobile-e2e run test:coverage` (`node:test`, próg 90%; fałszywy host odtwarza całą sekwencję, w tym awarie na każdym kroku).
