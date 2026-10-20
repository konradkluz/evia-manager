# `@evia/mobile` — aplikacja mobilna technika

Pakiet z EVM-009 (AC1–AC6; ADR-0007, ADR-0015). Chodzący szkielet: Expo SDK 58 (React Native 0.88, nowa architektura, Hermes), `i18next` (tylko `pl`), tokeny z `@evia/tokens/mobile`, klient API z `@evia/contracts`. Bez nawigatora (dwie karty „Moje zlecenia” i „Kolejka” jako stan; router dojdzie z pierwszymi ekranami M2), bez logowania, bez lokalnej bazy — tylko to, co potrzebne do AC. **Offline-first od pierwszego ekranu:** powłoka renderuje się od razu; brak sieci i niedostępny serwer nigdy nie blokują; blokuje wyłącznie wersja, którą serwer potwierdził jako nieobsługiwaną — i tylko pracę z serwerem, nie dane na telefonie.

## Polecenia (z katalogu głównego repozytorium)
| Polecenie | Co robi |
|---|---|
| `pnpm --filter @evia/mobile run test:coverage` | Jest + jest-expo + Testing Library; próg `mobile` (80%) z `packages/config/coverage-thresholds.json`; raport `coverage/lcov.info` |
| `pnpm --filter @evia/mobile run lint` / `typecheck` | ESLint (reguły wspólne + `mobileUi()`: teksty przez i18n, tylko tokeny, zakaz `console`, importy kontraktu tylko w `src/api`) / TypeScript |
| `pnpm --filter @evia/mobile run e2e` | test dymny Maestro na emulatorze (`tools/mobile-e2e`; wymaga długich ścieżek Windows — `docs/ops/dystrybucja-apk-android.md`) |
| `pnpm exec expo prebuild --platform android --clean --no-install` (w `apps/mobile`) | generuje natywny projekt `android/` (CNG; **nigdy w commicie**); wymaga `EXPO_PUBLIC_API_BASE_URL` (https) |

APK z CI: [`docs/ops/dystrybucja-apk-android.md`](../../docs/ops/dystrybucja-apk-android.md). Wariant `e2e` buildu (`EVIA_BUILD_VARIANT=e2e`) dopuszcza HTTP wyłącznie do 10.0.2.2 / localhost i **nigdy** nie jest dystrybuowany.

## Struktura
| Ścieżka | Zawartość |
|---|---|
| `app.config.ts`, `plugins/expo-config.ts` | konfiguracja Expo: nazwa, `version` (**jedno źródło** wersji), `versionCode` z `EVIA_ANDROID_VERSION_CODE`, brak uprawnień (+ lista zablokowanych), walidacja adresu API przy buildzie (release bez `https://` przerywa build) |
| `plugins/with-hardening.ts` | config plugin Androida: `allowBackup=false` i reguły wykluczające wszystko z kopii, `network_security_config` (bez HTTP, tylko magazyn systemowy), R8 + skracanie zasobów, **niepodpisany** release (bez klucza debug), usunięcie wyeksportowanego odbiornika profile installer |
| `src/ui/` | biblioteka komponentów wg styleguide'u: `AppBar`, `BottomNav`, `SyncIndicator`, `EmptyState`, `Skeleton`, `InlineAlert`, `Button`; tylko tokeny; teksty przychodzą w propsach (warunek późniejszego wydzielenia do `packages/ui-mobile`); ikony Lucide przez importy pojedynczych plików |
| `src/screens/` | S-01 „Moje zlecenia”, „Kolejka”, S-02 „Aktualizacja wymagana”, powłoka z dolną nawigacją |
| `src/startup/` | stan startu (`checking` / `online` / `offline` / `serverUnavailable` / `updateRequired`), porównanie semver, provider z ponowieniem po powrocie na pierwszy plan (debounce 5 s, bez pętli) |
| `src/api/` | jedyne miejsce z `@evia/contracts`: klient `GET /api/health` (timeout 10 s, `X-Client-Platform`, `X-Client-Version` w jednym miejscu, walidacja Zod) |
| `src/config/` | adres API (https; HTTP do hosta emulatora tylko w wariancie e2e), platforma, wersja |
| `src/secure-store/` | `tokenStore` (Keystore/Keychain przez `expo-secure-store`): sloty `refreshToken` i `databaseKey`, **przygotowany, nieużywany** do logowania (M2); jedyny moduł importujący `expo-secure-store` |
| `src/logging/` | jedyny logger: stałe nazwy zdarzeń (żadnych adresów, treści odpowiedzi ani danych osobowych), cichy w release |
| `e2e/` | przepływy Maestro (`01`…`06`), powiązane ze scenariuszami `tools/mobile-e2e` testem zgodności |
| `test/` | Jest; nazwy `EVM-009 AC#: …` |

## Decyzje i zależności
- Rozstrzygnięcia: SDK 58 (ADR-0007 wspominał SDK 57; engines `expo` 58 obejmują Node 26, `jest-expo` 58 działa na Node 26). Bez `expo-router` w szkielecie (dwie karty; mniej natywnych bibliotek — `react-native-screens`, `gesture-handler`, `reanimated` — i mniej zależności przejściowych). Bez `expo-updates`, `expo-dev-client`, EAS i analityki (SR-MOB-09). Bez `@react-native-async-storage` (reguła `dependency-cruiser`).
- Warstwa zapytań lokalnej bazy (`expo-sqlite` / SQLCipher) i klucz bazy: decyzja przeniesiona do EVM-011 / M2 (notka architekta do ADR-0007).
- Fonty „Inter” i „Exo 2” z tokenów nie są jeszcze dołączone do paczki (systemowa czcionka zastępcza); dołączenie fontów (licencja OFL) to osobna decyzja UX.
- Tokeny: `@evia/tokens/mobile`; ekran „Aktualizacja wymagana” nie zawiera linku (sideload — SR-MOB-07), tylko komunikat „Poproś administratora o nową wersję aplikacji.”.
