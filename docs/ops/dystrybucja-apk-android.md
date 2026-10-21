# Dystrybucja aplikacji na Androida — APK z CI (sideload)

> Dokument żywy (EVM-009). Właściciel: `devops-engineer`; kroki jednorazowe i instalację wykonuje Konrad. Decyzja Konrada z 2026-10-20: na MVP **bez konta Google Play i bez EAS** — CI buduje APK z lokalnego buildu Gradle po `expo prebuild`, a plik trafia do telefonów firmy ręcznie (sideload). Odroczenie Google Play / EAS Submit opisuje ADR-0019 (proponowana, do akceptacji Konrada); podpis wyłącznie lokalny (RR-21), CI bez sekretów. iOS jest odłożony (ADR-0015). Wymagania bezpieczeństwa: [`docs/security/requirements.md`](../security/requirements.md) (SR-MOB, SR-SUPPLY-08), ryzyka: `docs/security/threat-model.md` (aktualizuje `security-engineer`).

## Jak to działa
| Element | Co robi |
|---|---|
| Job `mobile-apk` (`ci.yml`) | Buduje **niepodpisany** `*-release-unsigned.apk` (`expo prebuild --clean`, `gradlew assembleRelease`), **bez żadnego sekretu** (`contents: read`), z kodu danego przebiegu. Sprawdza gotowy plik (`tools/mobile-apk`: manifest, reguły kopii i sieci, sekrety w zawartości), wpisuje do podsumowania przebiegu **SHA-256 pliku, gałąź i SHA commita** i wystawia artefakt `mobile-apk-unsigned` (14 dni). Plik niepodpisany **nie da się zainstalować**. Uruchamia się, gdy zmiana dotyczy aplikacji (`tools/ci-changes`) i zawsze na `main` |
| Podpis lokalny (`tools/mobile-apk` `sign`) | **Wyłącznie Konrad, na swoim komputerze.** CI nie ma klucza ani sekretu (RR-21, ADR-0019 — proponowana). Skrypt wyrównuje paczkę (`zipalign -P 16`), podpisuje (`apksigner` przez `java -jar`, schematy v2 i v3), sprawdza podpis i wypisuje **ścieżkę, SHA-256 pliku i SHA-256 certyfikatu** |
| Wersja | `version` (semver) jest w jednym miejscu: `apps/mobile/plugins/expo-config.ts` (`APP_VERSION`) → ekran „Aktualizacja wymagana” porównuje ją z minimum z `GET /api/health`. `versionCode` = numer przebiegu CI + 100 000 (rośnie zawsze; Android nie zainstaluje niższego) |
| Adres API | **zmienna** repozytorium (nie sekret) `EVIA_API_BASE_URL`, wyłącznie **https** (build z innym schematem się nie powiedzie, SR-COMM-04). Konrad ustawia ją po EVM-007 na adres API (staging). Bez niej paczka dostaje zarezerwowany adres `https://api.example.invalid` i pokaże „Brak połączenia z serwerem”; takiej paczki nie rozdajemy |
| Identyfikator aplikacji | `pl.eviacharge.manager` (**trwały** i potwierdzony przez Konrada 2026-10-20 — zmiana to nowa aplikacja na telefonach) |

## Klucz podpisu (jednorazowo, Konrad)
Agenci **nigdy** nie generują, nie czytają ani nie używają prawdziwego klucza i nie uruchamiają `sign` z nim (TA-7, SR-INFRA-05).
1. **Wygeneruj klucz lokalnie, poza repozytorium** (nigdy w repozytorium, także w `.scratch/`):
   ```
   keytool -genkeypair -v -keystore evia-release.p12 -storetype PKCS12 -alias evia-release -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=EVia Manager, O=EVia Charge, C=PL"
   ```
   Parametry: PKCS12, RSA 4096 (albo EC P-256), ważność **co najmniej 25 lat** (10 000 dni; wygaśnięcie też blokuje aktualizacje), silne hasło z menedżera haseł; dla PKCS12 hasło klucza = hasło keystore'a.
2. **Przechowywanie:** plik keystore i hasła w **Bitwarden Konrada (MFA)** oraz **kopia offline** (zaszyfrowany nośnik) — dwa niezależne miejsca. Na czas podpisu keystore odtwarzasz do katalogu **poza repozytorium** (nie `.scratch`), a po podpisie go usuwasz. Na stacji, na której pracują agenci, nie trzymaj odblokowanego CLI `bw` ani sesji menedżera haseł.
3. **Zapisz odcisk certyfikatu** (nie jest sekretem): `keytool -list -v -keystore evia-release.p12 -alias evia-release` → `SHA256:`. Wpisz go w zmiennej `EVIA_APK_CERT_SHA256` (profil użytkownika) lub podawaj jako `--expected-cert-sha256`: skrypt odmówi, gdy podpis wyjdzie innym kluczem albo aliasem.
4. **Utrata lub kompromitacja klucza** = **nowa aplikacja** na telefonach (inny podpis nie zaktualizuje starej): trzeba odinstalować starą i zainstalować nową, co **kasuje lokalną bazę i kolejkę offline**. Przed odinstalowaniem technik musi zsynchronizować kolejkę (wskaźnik synchronizacji „wszystko wysłane”). Dlatego klucz ma dwie kopie, a odinstalowanie planujesz jak wydanie.
5. **Planowana rotacja** (bez reinstalacji): APK Signature Scheme v3 — `apksigner rotate` tworzy linię rotacji nowego klucza podpisaną starym; kolejne wydania podpisujesz nowym kluczem z tą linią. Przeprowadź na zapas, zanim ważność certyfikatu zbliży się do końca.
6. **Sprawdź jednorazowo** w GitHub → Settings → Secrets and variables → Actions, że **nie ma** sekretów `ANDROID_*`. Gdyby keystore kiedykolwiek był wgrany do GitHuba, uznaj go za skompromitowany i wygeneruj nowy (bazy instalacji jeszcze nie ma, więc koszt jest zerowy). Ustaw też zmienną (Variables) `EVIA_API_BASE_URL` po EVM-007.

## Wydanie: podpis i przekazanie (Konrad)
1. Otwórz przebieg CI **na `main`** z zielonym `ci-gate` (nie z gałęzi PR — złośliwy push mógłby dać artefakt o tej samej nazwie). W podsumowaniu sprawdź **gałąź `main`**, SHA commita i **SHA-256 pliku**; pobierz artefakt `mobile-apk-unsigned`.
2. Odtwórz keystore poza repozytorium i ustaw hasła w zmiennych środowiskowych **tylko dla tej sesji** (PowerShell: `$env:EVIA_APK_KS_PASS = Read-Host` — zmienne `EVIA_APK_KS_PASS`, `EVIA_APK_KEY_PASS`; bez nich `apksigner` zapyta o hasło w terminalu). Haseł **nie wpisuje się w argumentach** (`pass:` i `file:` są odrzucane).
3. Uruchom (`ANDROID_HOME` wskazuje Android SDK; użyta zostanie najwyższa wersja `build-tools` albo `--build-tools <wersja>`):
   ```
   node tools/mobile-apk/cli.mjs sign --apk <pobrany>-release-unsigned.apk --expect-sha256 <SHA-256 z podsumowania przebiegu> --keystore <ścieżka poza repo>\evia-release.p12 --key-alias evia-release --out <katalog poza repo albo ignorowany>\evia-manager-<wersja>.apk --expected-cert-sha256 <odcisk z kroku 3 klucza>
   ```
   Skrypt odmawia, gdy: SHA-256 wejścia ≠ `--expect-sha256`; paczka jest już podpisana (także kluczem debug); nie przechodzi kontroli `verify` (debuggable, allowBackup, cleartext, eksportowane komponenty, sekrety); keystore leży w drzewie roboczym git; wyjście nadpisałoby wejście; odcisk certyfikatu ≠ oczekiwany. Wynik: ścieżka, SHA-256 pliku i SHA-256 certyfikatu — nic więcej (komunikaty narzędzi są redagowane).
4. Usuń keystore z dysku i hasła z sesji (`Remove-Item Env:EVIA_APK_KS_PASS, Env:EVIA_APK_KEY_PASS`).
5. Przekaż plik **administratorowi** (to Konrad albo osoba przez niego wskazana; technicy nie pobierają APK sami) razem z SHA-256 pliku i certyfikatu — innym kanałem niż plik.

### Dlaczego tak (RR-21)
Na GitHub Free sekret repozytorium może odczytać workflow z dowolnej gałęzi (`docs/security/threat-model.md` → RR-21), a bez Google Play wyciek klucza jest nieodwracalny (nie da się go unieważnić). Dlatego **klucz nigdy nie trafia do GitHuba**: CI publikuje niepodpisany APK z SHA-256, Konrad podpisuje go lokalnie (ok. 2 minuty na wydanie). Koszt: ręczny krok przy każdym wydaniu i klucz na stacji Konrada (TM-58) oraz ryzyko podpisu zmienionego artefaktu — ogranicza je podpis wyłącznie z przebiegu na `main` ze zgodnym SHA-256 i przypięty odcisk certyfikatu.

## Instalacja na telefonie (sideload)
Zasady (security-engineer; phishing — fałszywa „nowa wersja”, bo bez Google Play to jedyny kanał):
1. **Jeden kanał: administrator.** USB z komputera (`adb install -r evia-manager-….apk`) albo plik przekazany osobiście. **Nigdy link w SMS, komunikatorze ani e-mailu**; technik nie instaluje APK z linku, nawet od „biura”.
2. Przed instalacją porównaj **SHA-256 pliku** i **odcisk certyfikatu** z danymi z podpisu (`apksigner verify --print-certs`, `certutil -hashfile <plik> SHA256`).
3. Telefon prywatny (BYOD): uprawnienie „Instalowanie nieznanych aplikacji” dla menedżera plików lub przeglądarki daj **tylko na czas instalacji** i **cofnij po niej**; Play Protect zostaje włączony.
4. Aplikacja nie otwiera żadnych adresów pobrania: ekran „Aktualizacja wymagana” mówi tylko „Poproś administratora o nową wersję aplikacji.” (S-02, SR-MOB-07).
5. **APK debug i e2e nigdy nie trafiają do techników** (klucz debug jest publiczny, wariant e2e ma HTTP do hosta emulatora).

## Aktualizacje
- Telefon przyjmie aktualizację tylko podpisaną **tym samym kluczem** (albo następcą z linii rotacji v3) i z wyższym `versionCode`. Kolejne wydanie = kolejny przebieg CI na `main` + podpis lokalny. Nie ma automatycznych aktualizacji: administrator instaluje je ręcznie.
- Minimalna wersja: `MIN_SUPPORTED_APP_VERSION_ANDROID` w konfiguracji serwera (bez wdrożenia kodu). Lokalne API (`compose.dev.yaml`) ma minimum `0.1.0` = wersja aplikacji, więc `pnpm run dev` jej nie blokuje (granica równości); wartość produkcyjna przychodzi z konfiguracji VM (EVM-007).

## Lokalny build i test na Windows
- Aplikacja i jej testy jednostkowe działają natywnie: `pnpm --filter @evia/mobile run test:coverage`.
- **Build natywny (Gradle/CMake) wymaga długich ścieżek Windows.** React Native + pnpm daje ścieżki obiektów C++ powyżej 260 znaków, a Ninja z Android SDK kończy się błędem „Filename longer than 260 characters”. Jednorazowo, jako administrator: `reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f`, restart Windows, i `EVIA_ANDROID_CMAKE_VERSION=3.31.6` (CMake z Ninja obsługującym długie ścieżki; Gradle pobiera go sam). `tools/mobile-e2e` sprawdza to przed buildem i podaje to polecenie.
- Test dymny Maestro: `pnpm --filter @evia/mobile run e2e` (`tools/mobile-e2e`): build wariantu e2e (HTTP tylko do 10.0.2.2), instalacja na **jednym** emulatorze AVD `Medium_Phone_API_35`, serwer scenariuszy na 127.0.0.1, 6 przepływów (online, tryb samolotowy i powrót sieci, aktualizacja wymagana, serwer niedostępny i ponowienie), raport w `.scratch/mobile-e2e/report.md` z wersją API emulatora i Maestro. Telemetria Expo i Maestro wyłączona.
- Warianty debug i e2e budujemy **tylko lokalnie** i nigdy nie wysyłamy ich jako artefakt (debuggable, klucz debug, HTTP do hosta emulatora).

## Powrót do Google Play / EAS Submit
Odroczone (ADR-0019 — proponowana, do akceptacji Konrada). Wymaga decyzji Konrada (konto Google Play, Play App Signing, ewentualnie EAS). Warunki powrotu: większa liczba telefonów lub potrzeba automatycznych aktualizacji, wymóg sklepu dla wydania szerszego niż firmowe telefony, utrata kontroli nad ręczną dystrybucją. Ścieżka wyjścia: ten sam klucz można zarejestrować w Google Play (jako klucz aplikacji albo przez klucz wysyłania, upload key), dlatego ważność ≥ 25 lat.
