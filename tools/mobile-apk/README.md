# Weryfikacja zbudowanego APK (`tools/mobile-apk/`)

EVM-009 AC5, AC6 (security-engineer B2, B3, B4). Używane przez job `mobile-apk` w `ci.yml`; działa **bez instalacji zależności** (tylko `node:*`). Sprawdza **gotowy plik**, nie źródła po `expo prebuild` — biblioteki dokładają uprawnienia i komponenty dopiero przy scalaniu manifestów. Odczyt przez `apkanalyzer` z Android SDK (`cmdline-tools/latest`), uruchamiany jako `java -classpath …` (bez powłoki i bez `.bat`).

| Polecenie | Co robi |
|---|---|
| `node tools/mobile-apk/cli.mjs verify --apk <plik> [--application-id <id>]` | manifest, trzy zasoby XML i zawartość; kod 1 przy jakimkolwiek ustaleniu, wypisuje też SHA-256 |
| `node tools/mobile-apk/cli.mjs digest --apk <plik> [--signed]` | SHA-256 pliku; w CI dopisuje podsumowanie do `$GITHUB_STEP_SUMMARY` (z napisem **NIEPODPISANY**, gdy bez `--signed`) |

## Co jest sprawdzane
- **Manifest** (`src/manifest.mjs`): `package`; uprawnienia dokładnie `INTERNET` + własne `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; `targetSdkVersion` ≥ 34; `allowBackup=false`, `usesCleartextTraffic=false`, brak `debuggable`, obecne `networkSecurityConfig`, `dataExtractionRules`, `fullBackupContent`; `expo.modules.updates.ENABLED` nie jest `true`; brak komponentów expo-updates / dev-launcher / dev-menu; **jedyny wyeksportowany komponent lub komponent z filtrem intencji to `MainActivity`** z dokładnie jednym filtrem MAIN/LAUNCHER, bez linków głębokich.
- **Zasoby XML** (`src/resources.mjs`): sieć — `cleartextTrafficPermitted=false`, tylko magazyn systemowy (bez certyfikatów użytkownika), bez `domain-config` i `debug-overrides`; reguły kopii i przenoszenia wykluczają `root`, `file`, `database`, `sharedpref`, `external` i niczego nie włączają.
- **Zawartość** (`src/contents.mjs`): zakazane pliki (keystore, certyfikaty, `.env`, mapy źródeł, konta serwisowe) i wzorce poświadczeń w `assets/` (klucze prywatne, AWS, Google, GitHub, Slack, Stripe, JWT, hasło w adresie URL, przypisanie hasła); jedyną publiczną zmienną paczki jest `EXPO_PUBLIC_API_BASE_URL`. Ustalenia podają ścieżkę i regułę, **nigdy dopasowanego tekstu**.

Fixture'y testów (`test/fixtures/`) to zapis wyjścia `apkanalyzer` dla prawdziwej paczki aplikacji (dane syntetyczne). Testy: `pnpm --filter @evia/mobile-apk run test:coverage` (próg 90%).
