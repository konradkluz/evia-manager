# Dystrybucja aplikacji na Androida — APK z CI (sideload)

> Dokument żywy (EVM-009). Właściciel: `devops-engineer`; kroki jednorazowe i instalację wykonuje Konrad. Decyzja Konrada z 2026-10-20: na MVP **bez konta Google Play i bez EAS** — CI buduje APK z lokalnego buildu Gradle po `expo prebuild`, a plik trafia do telefonów firmy ręcznie (sideload). Odroczenie Google Play / EAS Submit opisuje notka do ADR-0007 i ADR-0012 (`solution-architect`, status „do akceptacji Konrada”). iOS jest odłożony (ADR-0015). Wymagania bezpieczeństwa: [`docs/security/requirements.md`](../security/requirements.md) (SR-MOB, SR-SUPPLY-08), ryzyka: `docs/security/threat-model.md` (aktualizuje `security-engineer`).

## Jak to działa
| Element | Co robi |
|---|---|
| Job `mobile-apk` (`ci.yml`) | Buduje **niepodpisany** `*-release-unsigned.apk` (`expo prebuild --clean`, `gradlew assembleRelease`), **bez żadnego sekretu**, z kodu danego przebiegu. Sprawdza gotowy plik (`tools/mobile-apk`: manifest, reguły kopii i sieci, sekrety w zawartości), wpisuje SHA-256 do podsumowania przebiegu i wystawia artefakt `mobile-apk-unsigned` (14 dni). Plik niepodpisany **nie da się zainstalować**. Uruchamia się, gdy zmiana dotyczy aplikacji (`tools/ci-changes`: `apps/mobile`, tokeny, klient kontraktu, lockfile, workflow) i zawsze na `main` |
| Job `mobile-sign` (`ci.yml`) | Tylko `push` na `main` i uruchomienie ręczne z `main`. **Niczego nie pobiera z repozytorium, nie instaluje i nie używa cache** — bierze artefakt z `mobile-apk` tego samego przebiegu i podpisuje go (`apksigner`, schematy v2 i v3). Klucz jest widoczny tylko dla kroku podpisu, keystore to plik tymczasowy usuwany na końcu, hasła idą do `apksigner` zmiennymi środowiskowymi (`env:`), nigdy argumentami. W podsumowaniu: SHA-256 pliku i odcisk SHA-256 certyfikatu. Artefakt `mobile-apk-signed` (30 dni). **Bez sekretów job kończy się sukcesem i mówi, że APK zostaje niepodpisany** |
| Wersja | `version` (semver) jest w jednym miejscu: `apps/mobile/plugins/expo-config.ts` (`APP_VERSION`) → ekran „Aktualizacja wymagana” porównuje ją z minimum z `GET /api/health`. `versionCode` = numer przebiegu CI + 100 000 (rośnie zawsze; Android nie zainstaluje niższego) |
| Adres API | zmienna repozytorium `EVIA_API_BASE_URL` (**https**; build z innym schematem się nie powiedzie). Bez niej paczka dostaje zarezerwowany adres `https://api.example.invalid` i pokaże „Brak połączenia z serwerem”. Ustaw ją na adres API (staging po EVM-007) przed pierwszą instalacją na telefonie |
| Identyfikator aplikacji | `pl.eviacharge.manager` (**trwały** — zmiana to nowa aplikacja na telefonach). Konrad potwierdza go przed pierwszą instalacją |

## Jednorazowe kroki Konrada (po akceptacji)
1. **Potwierdź identyfikator** `pl.eviacharge.manager` (albo podaj inny — zmiana w `ANDROID_APPLICATION_ID` i `IOS_BUNDLE_IDENTIFIER` w `apps/mobile/plugins/expo-config.ts`, wcześniej niż pierwszy build podpisany).
2. **Wygeneruj klucz lokalnie, poza repozytorium** (agenci nie generują ani nie czytają keystore'a; nigdy w repozytorium ani w `.scratch/`):
   ```
   keytool -genkeypair -v -keystore evia-release.keystore -storetype PKCS12 -alias evia-release -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=EVia Manager, O=EVia Charge, C=PL"
   ```
   RSA 4096, ważność 10 000 dni (> 25 lat — wymóg przyszłego przeniesienia klucza do Google Play). Silne hasło z menedżera haseł; dla PKCS12 hasło klucza = hasło keystore'a.
3. **Kopia zapasowa poza GitHubem:** zaszyfrowany keystore i hasła w menedżerze haseł (Bitwarden) **w dwóch miejscach**. Utrata klucza = brak możliwości zaktualizowania aplikacji na telefonach: trzeba ją odinstalować i zainstalować od nowa, a od M2 oznacza to utratę danych offline. Dostęp do klucza ma tylko Konrad.
4. **Dodaj cztery sekrety repozytorium** (Settings → Secrets and variables → Actions → New repository secret):
   | Sekret | Wartość |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | `[Convert]::ToBase64String([IO.File]::ReadAllBytes('evia-release.keystore')) \| Set-Clipboard` (PowerShell) i wklej |
   | `ANDROID_KEYSTORE_PASSWORD` | hasło keystore'a |
   | `ANDROID_KEY_ALIAS` | `evia-release` |
   | `ANDROID_KEY_PASSWORD` | hasło klucza (to samo dla PKCS12) |
   Dodaj też **zmienną** (nie sekret) `EVIA_API_BASE_URL` (Variables). **Nie dodawaj sekretów, dopóki nie zaakceptujesz ryzyka niżej.**
5. Scal PR; na `main` job `mobile-sign` podpisze paczkę. Pobierz artefakt `mobile-apk-signed` z przebiegu i **zapisz z podsumowania przebiegu SHA-256 pliku oraz odcisk certyfikatu** — to dane do weryfikacji na telefonie.
6. Po zdaniu przeglądu: usuń hasło ze schowka; w widoku Activity i na liście sekretów (cotygodniowy przegląd K6/K2) sprawdź, że sekrety są tylko cztery.

### Ryzyko do akceptacji (security-engineer, B1)
Na GitHub Free sekret repozytorium może odczytać workflow uruchomiony z **dowolnej gałęzi** (`docs/security/threat-model.md` → RR-21; z tego powodu wstrzymano `RENOVATE_TOKEN`, Q1). Napastnik z kluczem wdrożeniowym agentów albo złośliwy pakiet w jobie z sekretem mógłby wykraść klucz i podpisać złośliwy APK, który zainstaluje się jako aktualizacja na telefonach techników (ten sam certyfikat); unieważnienie klucza nie jest możliwe. Skutek: dostęp do danych offline i tokenów na telefonach (waga 3). Mitygacje wdrożone: osobny job podpisu bez checkoutu, instalacji i cache; sekret tylko w `env` jednego kroku; tylko `main`; keystore tymczasowy; hasła przez `env:`; test `tools/repo-policy` pilnuje każdego z tych punktów. Ryzyko rezydualne po mitygacjach: średnie (P1×W3) — **do akceptacji Konrada**; `docs/ops/github-i-ci.md` K7 („bez wyjątków”) wymaga wtedy wyjątku dla tych czterech sekretów. **Wariant bezpieczniejszy (rekomendacja `security-engineer`, wymaga zmiany AC5):** klucz w ogóle nie trafia do GitHuba — CI publikuje niepodpisany APK z SHA-256, a Konrad podpisuje go lokalnie (`apksigner sign` z keystore'a poza repozytorium; ok. 2 minut na wydanie). Przejście na ten wariant to usunięcie czterech sekretów i joba `mobile-sign`.

## Instalacja na telefonie (sideload)
Zasady (security-engineer, B6; phishing — fałszywa „nowa wersja”):
1. **Jeden kanał:** preferowane USB z komputera Konrada (`adb install -r evia-manager-….apk`) albo bezpośrednie przekazanie pliku. **Nigdy link w SMS, komunikatorze ani e-mailu**; technik nie instaluje APK z linku, nawet od „biura”.
2. Przed instalacją sprawdź **SHA-256 pliku** i **odcisk certyfikatu** z podsumowania przebiegu CI: `apksigner verify --print-certs evia-manager-….apk` (z `build-tools` Android SDK) i `certutil -hashfile evia-manager-….apk SHA256` (Windows).
3. Telefon prywatny (BYOD): uprawnienie „Instaluj nieznane aplikacje” daj przeglądarce / menedżerowi plików **tylko na czas instalacji** i cofnij; Play Protect zostaje włączony.
4. Aplikacja nie otwiera żadnych adresów pobrania: ekran „Aktualizacja wymagana” mówi tylko „Poproś administratora o nową wersję aplikacji.” (S-02, SR-MOB-07).

**Otwarte pytanie do Konrada:** skąd technik dostaje nowy APK (USB u Konrada, plik przekazany osobiście, strona wydań)? Do czasu rozstrzygnięcia ekran S-02 nie ma przycisku pobrania.

## Aktualizacje i rotacja klucza
- Telefon przyjmie aktualizację tylko podpisaną **tym samym kluczem** i z wyższym `versionCode`. Kolejne wydanie = kolejny przebieg CI na `main` (wyższy numer przebiegu).
- **Kompromitacja klucza:** rotacja przez APK Signature Scheme v3 (`apksigner rotate` — nowy klucz z historią „lineage” podpisaną starym), komunikat do techników przez zaufany kanał, nowy certyfikat w sekretach, usunięcie starych sekretów. Bez Google Play nie ma resetu klucza — procedurę wykonuje Konrad (`docs/ops/rotacja-sekretow.md`).
- Minimalna wersja: `MIN_SUPPORTED_APP_VERSION_ANDROID` w konfiguracji serwera (bez wdrożenia kodu). Uwaga dla lokalnego API: `compose.dev.yaml` ustawia minimum `1.0.0` (EVM-077), a aplikacja ma `0.1.0` — przeciw `pnpm run dev` pokaże więc ekran „Aktualizacja wymagana”. Zmiana minimum w tym pliku (plik compose: zgoda Konrada) na `0.1.0` jest otwartym pytaniem historyjki; test dymny używa własnego serwera scenariuszy i tego nie potrzebuje.

## Lokalny build i test na Windows
- Aplikacja i jej testy jednostkowe działają natywnie: `pnpm --filter @evia/mobile run test:coverage`.
- **Build natywny (Gradle/CMake) wymaga długich ścieżek Windows.** React Native + pnpm daje ścieżki obiektów C++ powyżej 260 znaków, a Ninja z Android SDK kończy się błędem „Filename longer than 260 characters”. Jednorazowo, jako administrator: `reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f`, restart Windows, i `EVIA_ANDROID_CMAKE_VERSION=3.31.6` (CMake z Ninja obsługującym długie ścieżki; Gradle pobiera go sam). `tools/mobile-e2e` sprawdza to przed buildem i podaje to polecenie.
- Test dymny Maestro: `pnpm --filter @evia/mobile run e2e` (`tools/mobile-e2e`): build wariantu e2e (HTTP tylko do 10.0.2.2), instalacja na **jednym** emulatorze AVD `Medium_Phone_API_35`, serwer scenariuszy na 127.0.0.1, 6 przepływów (online, tryb samolotowy i powrót sieci, aktualizacja wymagana, serwer niedostępny i ponowienie), raport w `.scratch/mobile-e2e/report.md` z wersją API emulatora i Maestro. Telemetria Expo i Maestro wyłączona.
- Warianty debug i e2e budujemy **tylko lokalnie** i nigdy nie wysyłamy ich jako artefakt (debuggable, klucz debug, HTTP do hosta emulatora).

## Powrót do Google Play / EAS Submit
Wymaga decyzji Konrada (konto Google Play, Play App Signing, ewentualnie EAS). Warunki powrotu: większa liczba telefonów lub potrzeba automatycznych aktualizacji, wymóg sklepu dla wydania szerszego niż firmowe telefony, utrata kontroli nad ręczną dystrybucją. Klucz z tego dokumentu można przenieść do Play App Signing (stąd ważność ≥ 25 lat). Do tego czasu `docs/architecture/adr/0007-…` i `0012-…` są uzupełnione notką „do akceptacji Konrada”.
