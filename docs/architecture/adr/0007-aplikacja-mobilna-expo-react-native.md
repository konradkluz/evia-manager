# ADR-0007: Aplikacja mobilna — React Native z Expo (iOS + Android), upload w tle natywnymi mechanizmami systemu

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Zakres platform doprecyzowany** 2026-10-03 (decyzja Konrada, [ADR-0015](0015-srodowisko-testow-per-warstwa.md)): iOS odłożony — pilotaż i spike tylko na Androidzie; kod pozostaje zgodny z iOS (Expo); decyzja o iOS przed planowaniem wydania iOS.
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: mobile-developer, security-engineer)
- **Powiązane:** EVM-001, EVM-009, EVM-011 (spike), E9–E14 (M2); ADR-0004, ADR-0005, ADR-0008, ADR-0009, ADR-0012, ADR-0014

## Kontekst i problem
Technicy pracują w garażach podziemnych bez zasięgu. Flota telefonów jest **mieszana iOS + Android** (decyzja Konrada 2026-10-02) — obie platformy obowiązkowe. Aplikacja musi: robić zdjęcia i **długie filmy**, trzymać dane zleceń offline w **szyfrowanej** lokalnej bazie, przechowywać tokeny w bezpiecznym magazynie systemu i **wysyłać duże pliki w tle**, także gdy aplikacja jest zawieszona lub zamknięta przez system, wznawiając po utracie sieci. Konrad pracuje na **Windows 11** — buildy iOS muszą powstawać w chmurze. Wymagania MASVS (STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, PRIVACY) wg security-engineer.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Upload w tle dużych plików na iOS i Android | 5 | najtrudniejsze wymaganie systemu |
| Szyfrowana lokalna baza i bezpieczny magazyn tokenów | 5 | MASVS-STORAGE-1, MASVS-CRYPTO-2 |
| Wspólny język i kod z backendem/web (kontrakt, logika synchronizacji) | 5 | jeden zespół agentów, mniej błędów integracji |
| Aparat i wideo (rozdzielczość, bitrate, zapis do sandboxu) | 4 | dokumentacja z terenu, koszt storage'u |
| Buildy i dystrybucja iOS bez Maca | 4 | środowisko Windows 11 |
| Ekosystem testowy (unit, E2E, scenariusze offline) | 4 | progi 80% / 95% dla sync |
| Koszt utrzymania (jeden kod na dwie platformy) | 4 | mały budżet |

## Rozważane opcje
1. **A. React Native 0.86 + Expo SDK 57** (TypeScript, development builds / prebuild, moduły natywne przez Expo Modules API).
2. **B. Flutter 3.47** (Dart) z pakietem `background_downloader`.
3. **C. Natywnie: Swift (iOS) + Kotlin (Android)** — dwie bazy kodu.
4. **D. PWA** (aplikacja webowa instalowana na ekranie głównym).

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Upload w tle (5) | 4 | 5 | 5 | 1 |
| Szyfrowana baza i magazyn (5) | 5 | 5 | 5 | 2 |
| Wspólny język i kod (5) | 5 | 2 | 1 | 5 |
| Aparat i wideo (4) | 4 | 4 | 5 | 2 |
| Buildy iOS bez Maca (4) | 5 | 4 | 3 | 5 |
| Ekosystem testowy (4) | 4 | 4 | 4 | 4 |
| Koszt utrzymania (4) | 5 | 4 | 1 | 5 |
| **Suma ważona (maks. 155)** | **142** | **124** | **107** | **104** |

Uwagi: **D** odpada — Safari/iOS nie pozwala na upload w tle po zamknięciu strony, a magazyn przeglądarki może być czyszczony. **C** daje pełną kontrolę, ale podwaja koszt i wymaga Maca do pracy nad iOS. **B** ma najdojrzalszą bibliotekę uploadu w tle (`background_downloader` 9.6.x: URLSession na iOS, WorkManager i UIDT na Android 14+), ale wprowadza Dart — kontrakt, logika synchronizacji i walidacja nie byłyby współdzielone z TS. **A** wymaga biblioteki społeczności (`@kesha-antonov/react-native-background-downloader` 4.6.3: background URLSession na iOS, UIDT na Android 14+ / foreground service na starszych, wtyczka Expo) lub własnego modułu Expo — to główne ryzyko, sprawdzane w spike'u EVM-011 przed M2. Wersje, licencje i stan utrzymania zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. React Native + Expo** (SDK 57 / RN 0.86 na dziś; aktualizacja SDK ok. 2× w roku), TypeScript, **development builds** (nie Expo Go — wymagane przez SQLCipher i moduły natywne). Logika synchronizacji i kolejki uploadu w czystym pakiecie TS `packages/sync-core` (testowalnym bez urządzenia, próg pokrycia 95%).

**Realizacja kluczowych zdolności na iOS i Android (AC3):**

| Zdolność | iOS | Android |
|---|---|---|
| **Upload w tle dużych plików** | `URLSession` z konfiguracją **background** (`uploadTask(with:fromFile:)`), `sessionSendsLaunchEvents`; system kontynuuje transfer po zawieszeniu i po zakończeniu aplikacji przez system, wybudza ją po zakończeniu. Po **wymuszonym zamknięciu przez użytkownika** iOS anuluje zadania — wznawiamy z trwałej kolejki przy następnym uruchomieniu (tylko niedokończone części). | Android 14+: **User-Initiated Data Transfer** (JobScheduler `setUserInitiated`, powiadomienie z postępem); Android ≤ 13: WorkManager z foreground service typu `dataSync` (Android 15 limituje `dataSync` do 6 h/24 h — dlatego UIDT jako domyślne). Ograniczenia sieci (Wi-Fi / dowolna) jako warunki zadania. |
| Wspólne dla obu | Biblioteka `@kesha-antonov/react-native-background-downloader` (Apache-2.0, wtyczka Expo) lub — jeśli spike wykaże braki — **własny moduł Expo** (Swift/Kotlin) o tym samym interfejsie. Protokół: **S3 multipart** z podpisanymi URL-ami części wydawanymi przez API po autoryzacji (ADR-0009); po przerwaniu ponawiamy co najwyżej części będące w toku. Kolejka i stan części (ETag) w lokalnej bazie; opcja „filmy tylko przez Wi-Fi” (`allowsCellularAccess=false` / sieć niemierzona). Suma kontrolna SHA-256 liczona przy zapisie pliku. Rozmiar części i sposób zlecania **różnią się per platforma** (wiersz niżej). | |
| **Strategia części** (film do 4 GB) | Background session przyjmuje tylko całe pliki (`fromFile`), więc części to pliki tymczasowe — ale **nie jedna część = jedno wybudzenie**: przy łańcuchu wybudzeń limiter wznowień iOS wydłuża każde kolejne opóźnienie i upload w tle praktycznie staje. Dlatego zlecamy **okno części naraz** (np. 4–8 części po 32–64 MiB, tj. ok. 256–512 MiB na okno; wartości ze spike'u), pliki części tworzone z wyprzedzeniem tylko dla bieżącego okna i tylko gdy wolne miejsce > próg ostrzeżenia + rozmiar okna. Po zakończeniu okna (wybudzenie przez `handleEventsForBackgroundURLSession`): zapis ETag-ów, usunięcie plików części, pobranie nowych podpisanych URL-i (refresh token — dlatego dostępność klucza po pierwszym odblokowaniu, wiersz „Bezpieczny magazyn”), zlecenie następnego okna. Gdy aplikacja jest na pierwszym planie — zlecamy okna bez czekania (zadania niediscretionary). Wygaśnięcie URL-a (zadanie discretionary uruchomione po TTL) → odpowiedź 403 traktowana jako „odnów URL i zleć ponownie tę część”, nie jako błąd pliku. Nie trzymamy drugiej kopii całego filmu na dysku. | **Jedno zadanie systemowe na plik** (nie na część): Android 14+ — jedno zadanie **UIDT** wysyłające części **sekwencyjnie w obrębie zadania**, czytające zakresy bajtów bezpośrednio z pliku źródłowego (bez plików tymczasowych części), odnawiające URL-e w trakcie; Android ≤ 13 — jeden worker WorkManager z foreground service `dataSync`. UIDT (i start FGS na Android 12+) **można zaplanować tylko, gdy aplikacja jest widoczna** (lub w wąskich wyjątkach) — dlatego zadanie planujemy **w momencie akcji użytkownika** (zapis zdjęcia/zakończenie nagrania, otwarcie aplikacji, „Ponów”) z ograniczeniem sieci (dowolna / niemierzona dla „filmy tylko przez Wi-Fi”) i `setPersisted(true)`; czekanie na sieć realizuje JobScheduler, nie łańcuch z tła. Zatrzymanie zadania przez system → `jobFinished(…, reschedule=true)` z postępem z bazy; gdyby system nie pozwolił na ponowienie z tła — komunikat „wysyłanie wstrzymane — otwórz aplikację”. |
| **Aparat i wideo** | `react-native-vision-camera` 5.x (AVFoundation): zdjęcia, nagrywanie wideo z wyborem formatu (domyślnie **1080p30, HEVC/H.264, ograniczony bitrate** — kontrola kosztu storage'u), latarka do ciemnych garaży; zapis bezpośrednio do sandboxu aplikacji. | `react-native-vision-camera` 5.x (CameraX), te same ustawienia; zapis do pamięci wewnętrznej aplikacji (`filesDir`), bez MediaStore. Fallback dla obu: `expo-camera`. |
| **Lokalna baza** | `expo-sqlite` z **SQLCipher** (`useSQLCipher: true`, AES-256); klucz 256-bit losowany przy pierwszym uruchomieniu, przechowywany w Keychain; plik bazy, katalog mediów i pliki części z ochroną `NSFileProtectionCompleteUntilFirstUserAuthentication`. | `expo-sqlite` z SQLCipher; klucz w magazynie opartym o **Android Keystore**; baza w pamięci wewnętrznej aplikacji (credential-encrypted, dostępna po pierwszym odblokowaniu). Warstwa zapytań: Kysely z dialektem dla expo-sqlite lub cienkie repozytoria SQL (decyzja w EVM-009 po spike'u). |
| **Bezpieczny magazyn tokenów** | `expo-secure-store` → **Keychain**, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` dla **klucza bazy i refresh tokenu** (bez synchronizacji iCloud, bez przenoszenia na inne urządzenie); access token tylko w pamięci (ADR-0005). | `expo-secure-store` → wartości szyfrowane kluczem z **Android Keystore**, **bez** `requireAuthentication` / `setUserAuthenticationRequired` dla klucza bazy i refresh tokenu. |


**Wymaganie spójności klas ochrony (praca w tle przy zablokowanym ekranie):** klucz bazy, refresh token, plik bazy, media i pliki części muszą być dostępne w tej samej klasie — **po pierwszym odblokowaniu od startu urządzenia** (iOS: Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` + pliki `CompleteUntilFirstUserAuthentication`; Android: magazyn credential-encrypted + klucz Keystore bez wymogu uwierzytelnienia). Klasa `WHEN_UNLOCKED` uniemożliwiłaby aplikacji wybudzonej w tle przy zablokowanym telefonie (zakończenie zadania background URLSession, BGTaskScheduler, zadanie UIDT) otwarcie bazy, zapis ETag-ów i stanu kolejki oraz odnowienie podpisanych URL-i — upload stałby w typowej sytuacji technika. Kompromis (klucz w pamięci urządzenia dostępny przy zablokowanym ekranie po pierwszym odblokowaniu) akceptujemy jako zgodny z MASVS-STORAGE-1; ochrona przed odczytem przy zablokowanym telefonie opiera się na szyfrowaniu urządzenia i blokadzie ekranu (wymaganej polityką MDM/wdrożenia — EVM-005). **Opcjonalna biometria (E9) może chronić wyłącznie dostęp do UI** (bramka przy otwarciu aplikacji, np. `expo-local-authentication`), **nie może wiązać klucza bazy ani refresh tokenu z uwierzytelnieniem użytkownika** (Android `setUserAuthenticationRequired`, iOS `SecAccessControl` z `.biometryCurrentSet` / `requireAuthentication` w expo-secure-store) — zablokowałoby to pracę w tle. Dotyczy także ADR-0005.

**Wymagania bezpieczeństwa (MASVS, security-engineer):**
- **MASVS-STORAGE-1 / CRYPTO-2:** szyfrowana baza (SQLCipher) z kluczem w Keychain/Keystore; żadnych danych zleceń w `AsyncStorage`/plikach niezaszyfrowanych.
- **MASVS-STORAGE-2 / PRIVACY:** zdjęcia i wideo **wyłącznie w sandboxie aplikacji**, nigdy w galerii systemowej (brak uprawnienia do biblioteki zdjęć); **wykluczone z kopii iCloud/Google**: iOS — atrybut `isExcludedFromBackup` na katalogu mediów i bazy; Android — `android:allowBackup="false"` oraz `dataExtractionRules` wykluczające wszystkie dane (wtyczka konfiguracyjna Expo).
- **Logi i crash reporty bez danych osobowych:** Sentry (region UE) ze scrubbingiem, bez zrzutów ekranu, hierarchii widoków i session replay (ADR-0013); logi aplikacji tylko z identyfikatorami technicznymi.
- **MASVS-PLATFORM-1:** deep linki tylko przez zweryfikowane Universal Links / App Links; każdy parametr walidowany, żadnych akcji wykonywanych automatycznie z linku.
- **MASVS-NETWORK-1:** wyłącznie TLS — iOS ATS bez wyjątków, Android `network_security_config` z `cleartextTrafficPermitted=false`. Przypinanie certyfikatów (MASVS-NETWORK-2) — decyzja w EVM-005.
- **Zdalne unieważnienie:** odpowiedź `401 session_revoked` → aplikacja czyści bazę (plik + klucz), media, magazyn tokenów i kolejkę — postępowanie z niewysłanymi danymi: ryzyko (c) spike'u i polityka w EVM-005. Urządzenie raportuje liczbę niewysłanych elementów, aby Administrator widział ją przed unieważnieniem.
- **Aktualizacje OTA (EAS Update) wyłączone** w MVP; włączenie wymaga ADR i podpisywania aktualizacji.

**Buildy i dystrybucja bez Maca:** **EAS Build** (chmurowe maszyny macOS dla iOS; Android w EAS lub lokalnie), **EAS Submit** do TestFlight (iOS, testerzy wewnętrzni, build ważny 90 dni) i do ścieżki testów wewnętrznych Google Play. Plan Free: 15 buildów iOS + 15 Android/mies. Wymagane konta: Apple Developer Program (99 USD/rok) i Google Play Console (25 USD jednorazowo). Ocena bezpieczeństwa serwisu buildów i kluczy podpisu — ADR-0012. Testy iOS na fizycznym iPhonie (TestFlight lub dystrybucja wewnętrzna EAS).

**Minimalne wersje systemów:** Expo SDK 57 wymaga iOS ≥ 16.4 i Android ≥ 7 (API 24). Proponujemy wspierać **iOS 17+ i Android 10+** (mniejsza macierz testów; UIDT działa od Android 14, starsze używają foreground service) — do potwierdzenia po spisie floty (pytanie do Konrada).

## Ryzyka do sprawdzenia w spike'u EVM-011
Hipotezy weryfikowalne osobno na iOS i Android (scenariusze AC2 spike'u):
1. **Upload > 1 GB w tle** kończy się po zawieszeniu aplikacji i po jej zakończeniu przez system (na iOS symulacja przez `exit`), a po **wymuszonym zamknięciu** przez użytkownika jest wznawiany z kolejki przy następnym uruchomieniu — bez duplikatów obiektów i części.
2. **Android 14+ UIDT** kontynuuje po zabiciu aplikacji i po restarcie telefonu; Android ≤ 13 na foreground service; zachowanie przy limicie `dataSync` (Android 15).
3. **Wznawianie po utracie sieci** i przełączeniu Wi-Fi ↔ LTE: ponownie wysyłane są tylko niedokończone części; opcja „filmy tylko przez Wi-Fi” działa.
4. **Zapis wideo** (1080p, film ≥ 500 MB, > 2 min) do sandboxu: brak wpisu w galerii, rozmiar pliku zgodny z ustawionym bitrate, brak utraty klatek.
5. **(a) Wydajność szyfrowanej bazy:** czas otwarcia i typowych zapytań przy 2 tys. zleceń i 5 tys. wpisów; rozmiar pliku bazy.
6. **Bezpieczny magazyn:** klucz bazy przetrwa aktualizację aplikacji i restart; zachowanie po przywróceniu telefonu z backupu (klucz `ThisDeviceOnly` nie wraca → kontrolowane ponowne pobranie danych bez utraty kolejki?).
7. **(b) Wygaśnięcie autoryzacji podczas wielogodzinnego uploadu w tle:** jak odnawiać podpisane URL-e części (TTL 60 min) przy wybudzeniach aplikacji, bez umieszczania długożyjących tokenów w zadaniach systemowych.
8. **(c) Unieważnienie sesji przy niewysłanej kolejce:** co dzieje się z danymi (czyszczenie vs bezpieczne zachowanie do ponownego logowania tego samego użytkownika) — rekomendacja dla EVM-005.
9. **(d) Wykluczenie z backupu urządzenia:** pliki mediów i baza nie trafiają do kopii iCloud ani Google (weryfikacja atrybutów i reguł ekstrakcji).
10. **Niskie miejsce na dysku:** przy wolnym miejscu < 1 GB **plus rezerwa na pliki części bieżącego okna uploadu (iOS)** aplikacja ostrzega i blokuje nagrywanie wideo bez uszkodzenia kolejki ani bazy; tworzenie plików części wstrzymuje się poniżej progu (bez utraty postępu), a pliki części są usuwane po potwierdzeniu ETag-u i sprzątane przy starcie aplikacji.
11. **Upload przy zablokowanym ekranie** na obu platformach: aplikacja wybudzona w tle przy zablokowanym telefonie (iOS: zakończenie zadań background URLSession i BGTaskScheduler; Android: zadanie UIDT / worker) **odczytuje klucz bazy i refresh token z Keychain/Keystore, otwiera bazę SQLCipher, zapisuje ETag-i i stan kolejki oraz pobiera nowe podpisane URL-e**; scenariusz po restarcie telefonu przed pierwszym odblokowaniem (oczekiwane: brak dostępu, wznowienie po odblokowaniu bez utraty danych); **zużycie baterii** podczas długiego uploadu.
12. **Utrzymanie biblioteki** uploadu w tle (społeczność, 1 opiekun) vs własny moduł Expo — rekomendacja z oszacowaniem kosztu; w tym: czy biblioteka obsługuje strategię części z tabeli (okna części na iOS, sekwencyjne części z zakresów pliku w jednym zadaniu UIDT na Androidzie).
13. **iOS — limiter wznowień background session:** opóźnienia kolejnych wybudzeń przy łańcuchu okien dla filmu 2–4 GB w tle przy zablokowanym ekranie; dobór rozmiaru części i okna (liczba wybudzeń na plik) tak, by upload kończył się w rozsądnym czasie; porównanie z wysyłką przy aplikacji na pierwszym planie.
14. **iOS — wygasanie podpisanych URL-i w zadaniach discretionary:** jak często zadanie zlecone z tła startuje po TTL 60 min; poprawna obsługa 403 (odnowienie URL-a i ponowienie tylko tej części, bez oznaczania pliku jako błąd); czy potrzebna jest zmiana TTL w ADR-0009 (wtedy zgłoszenie do solution-architect/security-engineer).
15. **Android — planowanie z tła:** potwierdzenie, że zaplanowanie UIDT (Android 14+) i start foreground service (Android 12–13) z tła się nie udaje, a strategia „jedno zadanie na plik planowane przy akcji użytkownika” przechodzi utratę sieci, zabicie aplikacji, restart telefonu (`setPersisted`) i zatrzymanie zadania przez system (`reschedule`) bez potrzeby powrotu do aplikacji.
16. **Zajętość dysku przez pliki części (iOS):** szczytowe dodatkowe zużycie miejsca przy wybranym oknie, sprzątanie osieroconych plików części po wymuszonym zamknięciu i restarcie.

## Konsekwencje
- **Pozytywne:** jeden kod TS dla iOS i Android, współdzielony kontrakt, klient API i logika synchronizacji z web/backend; buildy iOS z Windows; dojrzałe moduły Expo dla bazy, magazynu i plików.
- **Negatywne / koszty:** zależność od biblioteki społeczności lub własny kod natywny (Swift/Kotlin) dla uploadu; aktualizacje Expo SDK ok. 2× w roku; konta Apple/Google (ok. 32 zł/mies. + 97 zł jednorazowo).
- **Ryzyka i mitygacje:**
  - *Biblioteka uploadu przestanie być utrzymywana* → cienka warstwa abstrakcji w `sync-core`; własny moduł Expo jako plan B (rozstrzygnięcie w EVM-011).
  - *Limity systemowe (iOS force-quit, Android 15+)* → trwała kolejka i wznawianie, komunikat w UI „wysyłanie wstrzymane — otwórz aplikację”, test terenowy przed wydaniem.
  - *Darmowy plan EAS (kolejka niskiego priorytetu, 15 buildów iOS/mies.)* → wystarczy dla M0–M2; Starter 19 USD/mies. jako opcja w rezerwie budżetu; wyjście: `eas build --local` na runnerze macOS w CI.

## Plan wyjścia
Jeśli spike EVM-011 wykaże, że upload w tle w React Native jest niewykonalny lub zbyt kruchy: (1) własny moduł Expo w Swift/Kotlin (dni–tygodnie), (2) w ostateczności **Flutter** z `background_downloader` — nowy ADR, przepisanie aplikacji mobilnej (kontrakt OpenAPI i backend bez zmian; generowanie klienta Dart). Decyzja przed rozpoczęciem M2, więc koszt odwrócenia jest ograniczony do szkieletu z EVM-009.

## Weryfikacja
- EVM-011: wszystkie hipotezy 1–16 z wynikiem na obu platformach; zero duplikatów i zgodne sumy kontrolne.
- M2: test terenowy z `testing-strategy.md` (30 zdjęć, 3 filmy, wymuszone zamknięcie, restart) zaliczony na iPhonie i telefonie z Androidem; weryfikacja MASVS przez security-engineer.

## Źródła (zweryfikowane 2026-10-02)
- Expo SDK 57 (2026-06-30, RN 0.86; min. iOS 16.4, Android 7): https://expo.dev/changelog/sdk-57 ; `expo` 57.0.26 (MIT): https://www.npmjs.com/package/expo
- React Native — licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/facebook/react-native/blob/main/LICENSE ; moduły Expo (`expo-file-system`, `expo-sqlite`, `expo-secure-store`) — **MIT** (monorepo Expo): https://github.com/expo/expo/blob/main/LICENSE
- Expo FileSystem (upload, `sessionType` background tylko iOS): https://docs.expo.dev/versions/latest/sdk/filesystem/
- SQLCipher (Community Edition) — licencja **BSD-3-Clause** (zweryfikowane 2026-10-02): https://github.com/sqlcipher/sqlcipher/blob/master/LICENSE.md — komponent dystrybuowany w aplikacji; licencja permisywna, wymaga zachowania noty o prawach autorskich (ekran licencji open source w aplikacji).
- Expo SQLite z SQLCipher (`useSQLCipher`): https://docs.expo.dev/versions/latest/sdk/sqlite/ ; expo-secure-store 57.0.4 (MIT): https://docs.expo.dev/versions/latest/sdk/securestore/
- @kesha-antonov/react-native-background-downloader 4.6.3 (Apache-2.0, 2026-09-15; upload, UIDT, wtyczka Expo): https://github.com/kesha-antonov/react-native-background-downloader
- react-native-vision-camera 5.2.3 (MIT, 2026-08-20): https://www.npmjs.com/package/react-native-vision-camera
- Apple — anulowanie zadań background session po wymuszonym zamknięciu: https://developer.apple.com/forums/thread/14855
- Apple — background URLSession (wybudzanie, limiter wznowień, zadania discretionary z tła): https://developer.apple.com/documentation/foundation/downloading-files-in-the-background ; klasy dostępności Keychain: https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
- expo-secure-store — `keychainAccessible` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), `requireAuthentication`: https://docs.expo.dev/versions/latest/sdk/securestore/
- Android — ograniczenia startu zadań/usług z tła: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Android — UIDT: https://developer.android.com/develop/background-work/background-tasks/uidt ; limity foreground service (Android 15): https://developer.android.com/develop/background-work/services/fgs/timeout
- Flutter 3.47.6 (2026-10-01): https://flutterreleases.com/ ; background_downloader 9.6.3: https://pub.dev/packages/background_downloader
- EAS — cennik (Free 15 iOS + 15 Android buildów, Starter 19 USD): https://expo.dev/pricing
- Apple Developer Program (99 USD/rok), TestFlight (build ważny 90 dni): https://developer.apple.com/programs/ , https://developer.apple.com/testflight/
- Google Play Console (25 USD jednorazowo): https://support.google.com/googleplay/android-developer/answer/6112435
