# EVM-011 — raport ze spike'a: kolejka offline i upload w tle (Android)

Data: 2026-10-21 · wykonawca: `mobile-developer` · historyjka: [EVM-011](../backlog/M0/EVM-011-spike-kolejka-offline-i-upload-w-tle.md) · kod: [`spikes/offline-upload/`](../../spikes/offline-upload/README.md) · gałąź `feature/EVM-009-011-aplikacja-mobilna`.

## Wynik w jednym akapicie
Podejście z ADR-0007/0009 (S3 multipart z podpisanymi URL-ami części, jedno zadanie UIDT na plik, trwała kolejka, SHA-256) **sprawdza się na emulatorze Androida 15** — ale **nie z biblioteką społeczności** wskazaną w ADR-0007: jej uploadu na Androidzie nie da się użyć (cały plik jednym żądaniem, bez UIDT, bez zakresów). Własny moduł Expo (Kotlin, 669 linii w spike'u) przeszedł wszystkie scenariusze emulatora bez duplikatów, osieroconych multipart i niezgodnych sum kontrolnych. **Propozycja zmiany ADR:** [ADR-0020](../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (Proponowana, do akceptacji Konrada). **Czego nie wiemy:** zachowanie na fizycznym telefonie (bateria, prawdziwe przełączenie Wi-Fi ↔ LTE, producenci zabijający procesy), Android ≤ 13, iOS, Scaleway — sekcje „Niezrobione”.

## Granice dowodów (czytać najpierw)
| | Zmierzone | Niewykonane |
|---|---|---|
| Platforma | **emulator Androida 15, API 35** (`Medium_Phone_API_35`, x86_64, obraz Google APIs Play Store), Maestro 2.11.0, SeaweedFS 4.48 w Dockerze | **fizyczny telefon** (AC2 część „telefon”, AC5 — decyzja Konrada 2026-10-20, instrukcja niżej), **iOS** (ADR-0015), Android ≤ 13 (brak AVD) |
| Sieć | emulowana (kanał emulatora ok. 4 MiB/s), HTTP po `10.0.2.2` | prawdziwe Wi-Fi ↔ LTE, słaby zasięg |
| Bateria | — | **do pomiaru na telefonie** (emulator nie mierzy) |
| Pliki | syntetyczne pseudolosowe z ziarna (**nie nagrania z kamery**) dla wszystkich scenariuszy rozmiarowych; kamera emulatora (`virtualscene`) tylko w przepływie aparatu | nagrania z prawdziwej kamery telefonu |
| Magazyn | SeaweedFS (emulator S3) | Scaleway — zachowanie do sprawdzenia osobno |

Wyniki pochodzą wyłącznie z faktycznych przebiegów; pliki wynikowe (JSON, bez tokenów i podpisanych URL-i) leżą w `.scratch/EVM-011/results/` (poza gitem; pliki unieważnione — `invalid/`, patrz „Przebiegi odrzucone”).

## AC → dowód → status
| AC | Dowód | Status |
|---|---|---|
| **AC1** prototyp: aparat → trwały zapis → trwała kolejka → wznawialny upload porcjami do storage'u zgodnego z ADR | `spikes/offline-upload/` — 33 testy jednostkowe `core` + 19 integracyjnych względem SeaweedFS (`EVM-011 AC#`), aplikacja Expo + moduł Kotlin; przepływ aparatu Maestro `app/maestro/capture.yaml` (przeszedł, 1 min 16 s): zdjęcie (6990 B) i film (1,3 MB, bez dźwięku) z kamery `virtualscene` → sandbox → kolejka → S3, SHA-256 obiektu = urządzenia, MediaStore i `cache/Camera` puste po przeniesieniu | **spełnione** (emulator) |
| **AC2** scenariusze: emulator | sekcja „Scenariusze AC2” | **spełnione dla emulatora**; część „telefon” **niewykonana** (decyzja Konrada 2026-10-20) |
| **AC3** pomiary: czas, bateria, ponowienia, duplikaty, integralność | sekcja „Pomiary AC3” | czas, ponowienia, duplikaty, integralność — **zmierzone na emulatorze**; bateria — **do pomiaru na telefonie** |
| **AC4** wnioski w dokumentach i propozycja zmiany ADR | [`media-pipeline.md`](../architecture/media-pipeline.md) (nowy), [`offline-sync.md`](../architecture/offline-sync.md) (sekcja wniosków), [ADR-0020](../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) | **spełnione** (z oznaczeniem: tylko Android/emulator) |
| **AC5** weryfikacja na telefonie | instrukcja niżej | **niewykonane — czeka na Konrada** (historyjka kończy w `in-review`) |

## Prototyp (AC1)
**Co działa gdzie.** Urządzenie (Kotlin, bez JS): zadanie UIDT, pętla części, ponowienia, odnowa URL-a, pliki zadań w `noBackupFilesDir`, SHA-256 strumieniowo, przeniesienie pliku do sandboxu. Urządzenie (JS): aparat, szyfrowana baza kolejki (SQLCipher, klucz 256 bit w Keystore), UI, uzgadnianie stanu. Host (Node): `core/` — model referencyjny protokołu testowany względem prawdziwego S3; `host/` — url-issuer (zastępnik API, nasłuch tylko na `127.0.0.1`), skrypty i scenariusze. Pętla części na urządzeniu jest osobną implementacją Kotlin tego samego protokołu — zachowanie obu pokrywają dwa zestawy dowodów (testy Node vs scenariusze na urządzeniu).

**Decyzja 2a/2b (pytanie 12 ADR-0007).** Biblioteka `@kesha-antonov/react-native-background-downloader` 4.6.3 (Apache-2.0, 1 opiekun, ostatnia publikacja 2026-09-15) — przegląd kodu źródłowego z rejestru npm, **bez uruchamiania**: upload na Androidzie to wątek w procesie (`HttpURLConnection`, `setFixedLengthStreamingMode` dla całego pliku); brak zakresów bajtów i multipart; „resume” = od początku; UIDT i usługa pierwszoplanowa obsługują tylko pobieranie. Nie spełnia strategii ADR-0007 → **2b: własny moduł Expo (Kotlin)** (`app/modules/spike-uploader`: `UploadJobService` — UIDT, `UploadEngine` — pętla części, `Storage` — pliki zadań i token w Keystore, `SpikeUploaderModule`).

**Pułapki znalezione w trakcie** (zapisane w [`media-pipeline.md`](../architecture/media-pipeline.md)): domyślny presigner `@aws-sdk` dodaje CRC32 pustego ciała i serwer odrzuca każdą część (`requestChecksumCalculation: 'WHEN_REQUIRED'`); `pidof` zwraca kod 1 bez procesu (skrypty); `adb push` + `run-as cp` tworzy pliki `rw-rw-rw-` w sandboxie (artefakt narzędzia, katalog nadrzędny jest prywatny); zdarzenie intencji wysłane przed uruchomieniem JS ginie — moduł trzyma kolejkę poleceń; prefiks UUIDv7 (8 znaków) jest wspólny dla plików z tej samej minuty — w logach używamy końcówki identyfikatora.

## Scenariusze AC2 (emulator API 35)
Każdy scenariusz startuje od czystego stanu (`pm clear`, pusty bucket, brak mapowania w issuerze). Czas „od pierwszego startu” zawiera przestoje (np. 45 s offline), więc nie jest czasem transferu. Przebiegi: airplane ×3 (4 pliki każdy), `force-stop` ×3 punkty, `kill -9` ×3 punkty, pozostałe po 1.

| Scenariusz | Przebieg | Wynik |
|---|---|---|
| **Tryb samolotowy → powrót sieci** (3 zdjęcia po 2 MiB + film 48 MiB, plik wprowadzony do kolejki offline; sprawdzone, że `ping` do hosta nie działa) | 3 powtórzenia | zadania w stanie `queued`, 0 ponowień (system nie startuje zadania bez sieci); po powrocie sieci wszystkie wysłane po **10,2 / 10,4 / 11,4 s**; SHA-256 zgodne we wszystkich 12 plikach |
| **Utrata sieci w trakcie uploadu** (200 MiB, samolot po 3. części, 45 s offline) | 2 | 1–2 ponowienia, zadanie zrestartowane przez system (2 uruchomienia), wznowienie od brakującej części (3 części pominięte po `ListParts`), 13 `PUT`, SHA zgodne; drugi przebieg (po poprawce licznika): 2,75 MiB zmarnowanych bajtów |
| **`force-stop`** (200 MiB, 13 części; po 1., 7. i 12. części) | 3 | po `force-stop` **zadanie systemowe znika i przez ≥ 20 s upload nie rusza bez otwarcia aplikacji**; po otwarciu aplikacji (`ensureScheduled`) wysyłane tylko brakujące części (pominięte 1 / 7 / 12), łącznie 13 `PUT` na plik = **żadna część nie poszła dwa razy** |
| **Zabicie procesu przez system** (`kill -9`; te same punkty) | 3 | **JobScheduler wznawia zadanie sam w ciągu sekund, bez otwierania aplikacji** (3/3), 13 `PUT` na plik, SHA zgodne |
| **Zabicie dokładnie między `complete` w S3 a zapisem stanu lokalnie** (film 80 MiB; punkt wymuszony hookiem testowym) | 1 | lokalnie `uploading`, na serwerze obiekt złożony; po restarcie (JobScheduler, 1,9 s) `complete` idempotentny → `uploaded`, **0 `PUT`**, jeden obiekt |
| **Restart emulatora w trakcie uploadu** (300 MiB, `adb reboot` po 4. części, bez blokady ekranu) | 1 | zadanie trwałe wróciło **samo** po starcie (bez otwierania aplikacji), pominięte 4 części, SHA zgodne |
| **Restart z blokadą ekranu (syntetyczny PIN, usunięty po teście)** | 1 | (a) po starcie systemu **przed pierwszym odblokowaniem** pliki zadań są nieczytelne i zadanie nie startuje (magazyn szyfrowany poświadczeniami; bez błędu i bez utraty danych); (b) upload ruszył **ok. 6 s po odblokowaniu**, sam; 4 części pominięte, SHA zgodne |
| **Film ≥ 500 MB** (512 MiB = 536 870 912 B, **syntetyczny, nie z kamery**) | 1 | 32 części po 16 MiB, **125,3 s** (ok. 4,1 MiB/s), 0 ponowień, SHA-256 liczone na urządzeniu (natywnie, strumieniowo) = Node = obiekt w S3; wolne miejsce w partycji danych przed/po wprowadzeniu pliku: 4,08 GiB → 3,58 GiB |
| **Aplikacja w tle > 10 min** (256 MiB, ruch S3 ograniczony na hoście do ok. 250 KiB/s, aplikacja po `HOME`) | 1 | 256 MiB wysłane w **1089 s (18,2 min)** przy aplikacji w tle przez cały czas; 1 uruchomienie zadania, 0 zatrzymań przez system, 0 ponowień, 16 `PUT`, SHA zgodne |
| **Tło > 10 min, wymuszony tryb oszczędzania** (`deviceidle force-idle`, kubełek `restricted`, odłączone zasilanie — **jawnie wymuszone, nie zachowanie domyślne**) | 1 | 256 MiB w **1107 s (18,4 min)**; 0 zatrzymań, 0 ponowień, SHA zgodne. **Zastrzeżenie:** tryb wymuszono 1 s po starcie zadania — zadanie już działające (UIDT) nie zostało zatrzymane; nie sprawdzono zadania startującego w trakcie trwania idle/restricted |
| **Przełączenie Wi-Fi ↔ LTE** | 1 | **wymaga telefonu.** Przybliżenie na emulatorze (`svc wifi disable` w trakcie, 160 MiB): zadanie zostało zrestartowane przez system i wznowione z `ListParts` (1 ponowienie, 2 części pominięte), SHA zgodne. To nie jest dowód dla prawdziwego przełączenia sieci |

**Przebiegi odrzucone** (nie wchodzą do wyników): pierwszy przebieg „airplane” (ponownie użyte ziarno plików → zadania z poprzedniego przebiegu; naprawione: ziarno z unikalnym znacznikiem, czysty stan i sprawdzenie `ping`), pierwsze próby „tło” (ograniczenie przez konsolę emulatora `network speed` **nie wpływa na transfer** — upload szedł ok. 4 MiB/s przy Wi-Fi włączonym i wyłączonym; zastąpione proxy ograniczającym na hoście; w scenariuszach `forcestop`, `kill9`, `airplane-mid`, `wifi-lte` to ustawienie też nie działało, więc przebiegi szły z naturalną prędkością), pierwsza próba „killcomplete” (błąd skryptu: `pidof` bez procesu).

## Pomiary AC3
Wszystko poniżej: **emulator API 35**, SeaweedFS lokalnie; liczby z plików wynikowych.
| Pomiar | Wynik |
|---|---|
| Czas uploadu | zdjęcie 2 MiB: 1,1–1,3 s; film 48 MiB: 8,3–8,7 s; 200 MiB bez przerw: ok. 48–51 s (z `kill -9`), 512 MiB: 125,3 s. Dla scenariuszy z przerwami czas obejmuje przestoje |
| Liczba ponowień | 0 przy poprawnej sieci; 1 przy utracie sieci w trakcie części (samolot w trakcie, przełączenie Wi-Fi); ponowienie = nieudana próba `PUT` części lub pobrania URL-a. Odnowy URL-a po `403` na urządzeniu: 0 (niezmierzone na urządzeniu — patrz niżej) |
| Duplikaty | **0** we wszystkich przebiegach: (a) duplikaty obiektów/`assetId` = 0, (b) osierocone multipart po zakończeniu = 0, (c) części wysłane ponownie mimo znanego ETag = 0 (`PUT` na plik = liczbie części w każdym przebiegu z przerwaniem) |
| Integralność | SHA-256 zapisane na urządzeniu (natywnie) = SHA-256 liczone w Node z pliku = SHA-256 obiektu pobranego strumieniowo z S3 — **wszystkie pliki wszystkich przebiegów** |
| Baza SQLCipher (pyt. 5) | emulator (nieporównywalne z telefonem): otwarcie bazy z kluczem z Keystore 54–85 ms; 2000 zleceń + 5000 wpisów (7000 `INSERT` w jednej transakcji, każdy przez most asynchroniczny): 12,0 s / 13,6 s; lista 50 zleceń z licznikiem 5–6 ms, 50 wpisów zlecenia 3 ms, `COUNT` 2 ms; plik bazy+WAL ok. 1,4 MB |
| Zmarnowane bajty (ponowny `PUT` części) | utrata sieci w trakcie części (200 MiB, powtórzony przebieg po poprawce licznika): 2 ponowienia, **2,75 MiB** retransmisji (część przerwana w trakcie), 0 ponownych `PUT` części ze znanym ETag |
| Bateria | **do pomiaru na telefonie** — nie mierzono (emulator) |

Testy `core`: pokrycie (informacyjnie, `@vitest/coverage-v8`) linie 96,2 %, gałęzie 92,0 %, funkcje 93,5 %. Wyniki testów: `core` 33/33, `host` (integracyjne z SeaweedFS) 19/19.

## Bezpieczeństwo — wymagania przypisane do EVM-011
| Wymaganie | Dowód / wynik |
|---|---|
| **SR-MOB-02 / MASVS-STORAGE-2** — kopie zapasowe | Manifest **scalony** z APK (`aapt2 dump xmltree`): `allowBackup=false`, `dataExtractionRules` i `fullBackupContent` wykluczają wszystkie domeny (`cloud-backup`, `device-transfer`); pakiet nie ma flagi `ALLOW_BACKUP` (kontrolnie aplikacja systemowa ją ma); `bmgr backupnow` → „Backup is not allowed”. **Kopia Google i transfer D2D: wymaga telefonu.** |
| **SR-MOB-03 / MASVS-STORAGE-1** — klucz i baza | Klucz SQLCipher 256 bit z CSPRNG (`expo-crypto`), w Keystore przez `expo-secure-store`; nagłówek pliku bazy nie jest nagłówkiem SQLite (`2d 6e 1a 07 …`); token zapieczętowany AES-256-GCM kluczem z Keystore (bez `setUserAuthenticationRequired`); stan natywny — tylko identyfikatory techniczne. Test z PIN-em: patrz scenariusze (a) i (b) |
| **SR-MOB-04 / SR-SYNC-03 / SR-SYNC-08** — ciągłość kolejki po unieważnieniu | Test integracyjny Node (core + issuer + SeaweedFS): `401 session_revoked` → kolejka, plik i klucze zostają (`paused_revoked`); nowa sesja z tym samym `deviceId` wznawia od ostatniej części (`ListParts`, bez ponownego `PUT` części z ETag-iem); nowy `deviceId` → `id_conflict` bez skutków ubocznych (cudzy multipart i obiekt nietknięte, test: B nie przerywa ani nie nadpisuje uploadu A), nowy `assetId`/klucz; cudza sesja → `403`; lokalny oryginał usuwany dopiero po zgodnym SHA-256 (**w produkcji warunkiem jest `clean`, SR-FILE-05**). **Niezrobione:** wynik `duplicate` dla *mutacji* zastosowanej bez odebranego wyniku — w spike'u nie ma serwera mutacji; do testów `sync-core` |
| **SR-FILE-02** — klucz i walidacja | Klucz obiektu nadaje issuer (`media/{rok}/{miesiąc}/{assetId}/original`), walidacja `assetId`, rozmiaru, SHA-256, typu, numeru części i rozmiaru części; TTL ≤ 60 min (kod odrzuca więcej) |
| **SR-FILE-08 / MASVS-PRIVACY-1** — uprawnienia i galeria | Uprawnienia scalonego manifestu: `CAMERA`, `INTERNET`, `ACCESS_NETWORK_STATE`, `RUN_USER_INITIATED_JOBS`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`. Brak lokalizacji, `RECORD_AUDIO` (film nagrywany bez dźwięku — mikrofon emulatora to mikrofon hosta), pamięci i mediów. Pliki w `filesDir/media`, `content query` o obrazy i wideo: „No result found” |
| **SR-COMM-04 / MASVS-NETWORK-1** | `network_security_config`: baza `cleartext=false`, wyjątek HTTP tylko dla `10.0.2.2`, `127.0.0.1`, `localhost`; brak globalnego `usesCleartextTraffic` — wariant spike, nigdy dla techników |
| **SR-LOG / MASVS-STORAGE-2** — logi | Test automatyczny: log issuera nie zawiera tokenu, `X-Amz`, `Signature`, kluczy S3, kluczy obiektów ani `assetId`; logi aplikacji: końcówka `assetId`, numery części, rozmiary, czasy, kody |
| **SR-MOB-11 / CWE-798** — sekrety w APK | Skan rozpakowanego APK i bundla JS (1191 plików) pod kątem klucza dostępu, klucza tajnego i tokenu testowego: **0 trafień**; w bundlu brak `aws-sdk`, `X-Amz-Signature`, `presigner`; `@aws-sdk/*` nie występują w zależnościach aplikacji (importer `app` w lockfile) |
| **SR-MOB-09** — OTA, analityka | Brak `expo-updates` (meta-dane `expo.modules.updates.ENABLED=false`), brak Sentry/analityki |
| **Ryzyko do oceny** | `expo-camera` 58 dołącza ML Kit (skaner kodów): `MlKitInitProvider`, komponenty `firebase-*`, modele w `assets/`. **Nie sprawdzono**, czy wysyła telemetrię — przed M2 sprawdzić ruch sieciowy albo użyć `react-native-vision-camera` (ADR-0007) |
| **Magazyn S3 / issuer** | Bucket prywatny (anonimowy GET/PUT/ListObjects → `403`), tożsamość S3 z syntetycznym kluczem generowanym do `.scratch`, tylko port S3 na `127.0.0.1:8333`, obraz po digeście, projekt compose `evm011-spike-s3`; issuer na `127.0.0.1`, token porównywany w stałym czasie, deny-by-default |

### Skany łańcucha dostaw
Spike jest poza zakresem bramek skanów CI (OSV skanuje tylko główny `pnpm-lock.yaml`, Semgrep tylko `apps packages tools infra .github`; gitleaks obejmuje całą historię, więc także spike). Konfiguracji skanów i wyjątków (`osv-scanner.toml`, `.semgrepignore`) **nie zmieniano**; skany uruchomiono ręcznie przez istniejące usługi `docker compose -f compose.yaml run --rm scan-…` z dodatkowym wolumenem spike'a:
- **gitleaks** (cała historia, 872 commity, w tym commity spike'a): **0 znalezisk**.
- **Semgrep CE** (`p/typescript`, `p/javascript`, `p/nodejs`, `p/react`, `p/kotlin` + reguły własne repozytorium) na `spikes/`: 85 reguł, 44 pliki, **0 znalezisk**.
- **OSV-Scanner** na `spikes/offline-upload/pnpm-lock.yaml` (532 pakiety, **bez** wyjątków z `osv-scanner.toml`): 3 znaleziska, wszystkie w narzędziach budowania, nie w aplikacji — `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm, High; DoS przy głęboko zagnieżdżonych wzorcach), `node-forge` 1.4.0 (GHSA-86w9-cpqp-85rv, High; weryfikacja podpisu RSA PKCS#1 v1.5), `uuid` 7.0.3 (GHSA-w5hq-g745-h8pq, Moderate; tranzytywnie przez `xcode`, prebuild). Te same wersje występują w głównym lockfile (Expo CLI / Metro); bundle JS i APK ich nie zawierają (sprawdzone `grep` po bundlu). **Critical/High w komponentach działających na telefonie: brak.** Podbicie wersji (z `minimumReleaseAge`) nie jest konieczne dla AC5; do oceny razem z korzeniem w osobnej historyjce (to samo ryzyko dotyczy `apps/mobile`).
- **Licencje** (pakiety w `node_modules` spike'a): MIT 385, Apache-2.0 32, ISC 21, BSD 7, BlueOak 5 i inne permisywne; poza tym tylko narzędzia budowania: `lightningcss` (MPL-2.0), `caniuse-lite` (CC-BY-4.0 — dane), `node-forge` (BSD-3-Clause OR GPL-2.0 — wybieramy BSD-3-Clause). Żadnej licencji silnie copyleft w aplikacji.
- Standardowe `pnpm run scan` (korzeń): wynik w sekcji „Komendy i wersje” (bramka `pnpm run gate`).

### Zależności (SR-SUPPLY-06)
| Zależność | Wersja | Licencja | Utrzymanie | Uwagi / podatności |
|---|---|---|---|---|
| expo, expo-camera, expo-sqlite, expo-secure-store, expo-crypto | 58.0.16, 58.0.11, 58.0.13, 58.0.2, 58.0.7 | MIT | monorepo Expo, 13 opiekunów, publikacje 2026-10 | te same wersje SDK co `apps/mobile` (expo, secure-store); `expo-sqlite` z SQLCipher (BSD-3-Clause, nota licencyjna w aplikacji produkcyjnej); `expo-camera` — patrz ryzyko ML Kit |
| react, react-native | 19.3.0, 0.88.0 | MIT | Meta | jak `apps/mobile` |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | 3.1153.0 | Apache-2.0 | AWS, 2 opiekunów npm | **tylko `host/` (issuer, skrypty), nie w aplikacji** |
| vitest, typescript, `@types/node`, `@types/react` | 5.0.3, 6.0.3, 26.6.3, 19.3.0 | MIT / Apache-2.0 | — | narzędzia |
| ~~`@kesha-antonov/react-native-background-downloader`~~ | 4.6.3 (nie zainstalowana) | Apache-2.0 | 1 opiekun | przejrzano źródła z rejestru; **odrzucona** dla Androida |
| SeaweedFS (obraz) | 4.48 @ `sha256:4e61d15f…` | Apache-2.0 | — | tylko środowisko lokalne; MinIO wykluczone (ADR-0011) |

Wszystkie wersje dokładne, `minimumReleaseAge` 1440 min, `strictDepBuilds`, `blockExoticSubdeps` — jak w korzeniu. **Renovate** obejmie `spikes/offline-upload/package.json`: propozycja dla Konrada — `ignorePaths: ["spikes/**"]` w konfiguracji Renovate (nie wprowadzono).

## Wnioski dla ADR-0009 (SeaweedFS; Scaleway do sprawdzenia)
- **URL związany z rozmiarem działa:** `Content-Length` podpisany; PUT o innej długości (krótszej i dłuższej) → `403`.
- **Wygaśnięcie:** `403` po TTL; odnowa i powtórzenie jednej części przechodzą w teście Node (TTL 1 s). Założenie TM-73/TM-74 (URL wygasa i jest związany z kluczem/częścią/rozmiarem) potwierdzone dla SeaweedFS; **Scaleway trzeba zweryfikować osobno**.
- **Limit części 1000** (Scaleway) jest parametrem planera; film 4 GiB = 256 części po 16 MiB.
- **Powtórne `complete`:** SeaweedFS zwraca sukces, AWS-podobne magazyny mogą zwrócić `NoSuchUpload` — API obsługuje oba przypadki (HEAD + rozmiar).
- **Brak potrzeby zmiany TTL 60 min** z danych tego spike'a; pytanie 14 (iOS: zadania discretionary po TTL) pozostaje otwarte.

## Pytania ADR-0007 (1–16)
Spike odpowiada tylko dla Androida/emulatora. **Zweryfikowane** = zmierzone w tym spike'u na emulatorze; **częściowo** = z zastrzeżeniem; **niezweryfikowane** = nie dotyczy tego spike'a lub wymaga telefonu/iOS.
| # | Pytanie (skrót) | Status | Wynik |
|---|---|---|---|
| 1 | upload > 1 GB w tle, wznowienie po zabiciu | częściowo | max 512 MiB (nie > 1 GB); po `kill -9` i `force-stop` wznowienie bez duplikatów; iOS niezweryfikowany |
| 2 | UIDT po zabiciu i restarcie; limity Android 15 | częściowo | `kill -9` i restart: zadanie wraca samo (API 35); w 18 min tła limit nie wystąpił; Android ≤ 13 (FGS) niezweryfikowany |
| 3 | utrata sieci, Wi-Fi ↔ LTE, „filmy tylko Wi-Fi” | częściowo | utrata sieci: tak; Wi-Fi ↔ LTE: tylko przybliżenie (telefon); opcja „tylko Wi-Fi” (`NETWORK_TYPE_UNMETERED`) nie zaimplementowana — niezweryfikowana |
| 4 | zapis wideo 1080p ≥ 500 MB, bez galerii | częściowo | kamera AVD (`virtualscene`, bez dźwięku): zapis do sandboxu bez galerii potwierdzony; film 1080p ≥ 500 MB i bitrate **niezmierzone** (film z emulatora 1,3 MB; ≥ 500 MB tylko syntetyczny); utrata klatek — telefon |
| 5 | wydajność SQLCipher (2 tys. zleceń, 5 tys. wpisów) | częściowo | wyniki jak w „Pomiary AC3” (emulator); na telefonie do powtórzenia |
| 6 | klucz bazy po aktualizacji i restarcie; backup | częściowo | klucz przetrwał `adb install -r` (aktualizacja APK) i restart procesu: baza otwarta tym samym kluczem (`mediaRows` zgodne, 85 ms); restart telefonu i przywrócenie z backupu (`ThisDeviceOnly`) — telefon |
| 7 | odnowa podpisanych URL-i w długim uploadzie | częściowo | URL pobierany tuż przed każdą częścią, `403` → odnowa; przetestowane w Node (TTL 1 s); na urządzeniu niezmierzone; w zadaniu systemowym tylko `assetId` (token w Keystore, nie w parametrach zadania) |
| 8 | unieważnienie sesji przy niewysłanej kolejce | zweryfikowane (Node) | kolejka zostaje, wznowienie na tej samej instalacji; rekomendacja w [`offline-sync.md`](../architecture/offline-sync.md) |
| 9 | wykluczenie z backupu | częściowo | manifest scalony + `bmgr`; kopia Google/D2D — telefon |
| 10 | niskie miejsce na dysku | niezrobione | wymaga osobnego eksperymentu z zapełnieniem partycji (czas); zmierzono tylko spadek wolnego miejsca po wprowadzeniu 512 MiB |
| 11 | upload przy zablokowanym ekranie, przed pierwszym odblokowaniem, bateria | częściowo | przed odblokowaniem: brak dostępu, po odblokowaniu wznowienie (zweryfikowane z PIN); upload z zablokowanym ekranem po pierwszym odblokowaniu — zadanie działa w tle bez UI (tło 18 min); **bateria: telefon**; iOS niezweryfikowany |
| 12 | biblioteka vs własny moduł | zweryfikowane | własny moduł; biblioteka nie spełnia strategii — [ADR-0020](../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md); koszt: ok. 700 linii Kotlin |
| 13, 14, 16 | iOS: limiter wznowień, wygasanie URL-i w zadaniach discretionary, pliki części | niezweryfikowane | iOS odłożony (ADR-0015) |
| 15 | Android: planowanie UIDT z tła | częściowo | zadania planowane przy akcji użytkownika i przy starcie aplikacji; po `force-stop` brak wznowienia bez otwarcia aplikacji (zmierzone); **nie próbowano** planować UIDT z tła (oczekiwane odrzucenie według dokumentacji Androida — niepotwierdzone) |

## Rekomendacje (AC4)
Patrz [`media-pipeline.md`](../architecture/media-pipeline.md) sekcja 8 i [ADR-0020](../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md). Najważniejsze: własny moduł Kotlin dla Androida; `assetId` na urządzeniu + sesja i `complete` idempotentne + `ListParts` jako źródło prawdy; UIDT na plik planowany przy akcji użytkownika, `ensureScheduled` przy starcie, jawny stan „wstrzymane — otwórz aplikację”; usuwanie oryginału dopiero przy `clean`; test terenowy na telefonie przed wydaniem. **Decyzja dla Konrada:** kontynuujemy z podejściem z ADR-0007/0009 z własnym modułem na Androidzie (ADR-0020) — po jego ręcznej weryfikacji na telefonie.

## Niezrobione (z powodem)
- **Fizyczny telefon** (AC2 część „telefon”, AC5, bateria, prawdziwe Wi-Fi ↔ LTE, restart telefonu, kopia Google/D2D): decyzja Konrada 2026-10-20 — ręcznie rano.
- **iOS**: odłożony (ADR-0015).
- **Android ≤ 13 (foreground service):** brak AVD i zakres spike'a.
- **Scaleway:** brak konta/testu; SeaweedFS to emulator.
- **Wygaśnięcie URL-a na urządzeniu** i odnowa na urządzeniu: pokryte testem Node (TTL 1 s), nie na urządzeniu.
- **Mutacje (`duplicate`):** w spike'u nie ma serwera mutacji.
- **Pytanie 10 ADR-0007 (próg miejsca):** nie wykonano eksperymentu zapełnienia partycji.
- **Opcja „filmy tylko przez Wi-Fi”:** nie zaimplementowana.
- **Telemetria ML Kit (`expo-camera`):** obecność modułu stwierdzona, ruch niezbadany.
- **Pomiary strony zmian (200/500), N = 30 dni, mechanizm wyjścia z zakresu** (`offline-sync.md`): nie dotyczą uploadu plików, **niezmierzone**.

## Instrukcja dla Konrada: telefon (AC2 i AC5)
Cel: potwierdzić na prawdziwym telefonie z Androidem scenariusz „tryb samolotowy → zdjęcia i film → powrót sieci”, brak duplikatów i zgodność sum kontrolnych, oraz (opcjonalnie) restart telefonu, tło > 10 min, przełączenie Wi-Fi ↔ LTE i baterię. Telefon z Androidem 14+ (UIDT); na starszym zadanie może nie wystartować — zapisz to w wyniku.

**Zasady bezpieczeństwa:** połączenie telefonu z komputerem **wyłącznie przez USB i `adb reverse`** (żadnego adresu LAN, żadnych portów w zaporze); fotografuj **neutralne obiekty** (bez ludzi, tablic rejestracyjnych, dokumentów, posesji klientów) — to prawdziwe nagrania na prywatnym telefonie; po teście odinstaluj aplikację i usuń dane.

1. **Przygotowanie komputera** (katalog `spikes/offline-upload` w klonie; wymagane Docker, Node 26, pnpm 12, `adb`):
   ```
   pnpm install --frozen-lockfile
   node infra/gen-local-secrets.mjs
   $env:EVM011_SECRETS_DIR = "<ścieżka wypisana przez skrypt>"
   docker compose -f infra/compose.seaweedfs.yaml up -d
   cd host
   node scripts/issuer-cli.ts --sign-endpoint http://127.0.0.1:8333      # zostaw otwarte okno
   ```
2. **APK** (nie ma go w repozytorium): zbudowany uniwersalny wariant spike leży w `.scratch/EVM-011/spike-universal.apk` na komputerze orkiestratora, albo zbuduj sam według README (`-PreactNativeArchitectures=arm64-v8a`). To wariant **debuggable** o osobnym `applicationId` (`pl.eviacharge.spike.offlineupload`) — nie nadpisze aplikacji produkcyjnej.
3. **Telefon:** włącz opcje programisty i debugowanie USB, podłącz kablem, zaakceptuj klucz. W nowym oknie, w katalogu `spikes/offline-upload/host`:
   ```
   adb devices                                                           # telefon musi być na liście
   adb install -r <ścieżka>\spike-universal.apk
   node scripts/phone.ts info                                            # model, wersja Androida i poprawki -> do raportu
   node scripts/phone.ts configure                                       # adb reverse (USB), uprawnienia, przekazanie tokenu (nie jest wypisywany)
   ```
   `adb reverse` ponów po każdym restarcie telefonu lub odłączeniu kabla.
4. **Scenariusz AC5:** na telefonie włącz **tryb samolotowy** (zostaw USB). W aplikacji „EVM-011 SPIKE”: **Permissions** (zezwól na aparat i powiadomienia), **Open camera**, zrób **5 zdjęć** (przycisk **Photo**) i **film ok. 2 minut** (**Record video** / **Stop video**) neutralnego obiektu. Lista w aplikacji ma pokazywać stany `queued`. (W trybie samolotowym `adb reverse` przez USB nadal działa; połączenie z hostem nie jest „internetem”, ale zadanie czeka na warunek sieci — jeżeli telefon uważa, że sieci nie ma, zadanie nie startuje, i o to chodzi.) Wyłącz tryb samolotowy i poczekaj, aż wszystkie pozycje mają stan `uploaded` (`node scripts/phone.ts status`).
5. **Weryfikacja bez duplikatów i zgodności sum** (w `host`):
   ```
   node scripts/phone.ts export                                          # .scratch/EVM-011/results/phone-export.json
   node scripts/count-duplicates.ts                                      # oczekiwane: duplicateAssetIds [], orphanedMultipart [], kod wyjścia 0
   node scripts/verify-integrity.ts ..\..\..\.scratch\EVM-011\results\phone-export.json   # oczekiwane: wszystkie "ok": true, kod 0
   ```
6. **Opcjonalnie (AC2 telefon):** (a) w trakcie wysyłania filmu przełącz telefon z Wi-Fi na dane komórkowe i z powrotem — `phone.ts status` pokaże `retries`/`runs`; (b) zrestartuj telefon w trakcie wysyłania, odblokuj, **nie otwieraj aplikacji**, ponów `adb reverse` (`phone.ts configure` ponownie nic nie zepsuje) i sprawdź, czy upload rusza sam; (c) wyślij aplikację w tło (przycisk Home) na > 10 minut przy wysyłce dużego filmu; (d) **bateria:** `adb shell dumpsys batterystats --reset` przed testem, po teście `adb shell dumpsys batterystats pl.eviacharge.spike.offlineupload`, plus poziom baterii (`phone.ts info`) przed i po przy wyłączonym ekranie (USB zasila telefon — do poprawnego pomiaru użyj debugowania bezprzewodowego; `adb reverse` działa także tam; po teście wyłącz).
7. **Sprzątanie:** `adb uninstall pl.eviacharge.spike.offlineupload`, `docker compose -f infra/compose.seaweedfs.yaml down -v` (zawsze z `-f`), zamknij issuer, usuń `.scratch/EVM-011/results` i `secrets`, wyłącz debugowanie USB.
8. **Co wkleić do raportu (do tego pliku, sekcja „Wynik na telefonie”):** model telefonu, wersja Androida i poziom poprawek (`phone.ts info`), wyjście `phone.ts status`, plik `phone-export.json` (zawiera tylko identyfikatory, rozmiary, sumy kontrolne i liczniki — bez adresów URL i tokenu), wyjście `count-duplicates.ts` i `verify-integrity.ts`, czasy z kolumny `ms`, wynik opcjonalnych punktów 6 i poziom baterii.

### Wynik na telefonie (do uzupełnienia przez Konrada)
_Niewykonane — czeka na ręczną weryfikację (AC2 część „telefon”, AC5)._

## Komendy i wersje
Emulator: Android 15 (API 35), `Medium_Phone_API_35`, kamery AVD: tył `virtualscene`, przód `emulated` (nie kamera hosta), uruchamiany z `-no-audio`; Maestro 2.11.0; Gradle 9.4.1, droga A (`C:\e`, `nodeLinker: hoisted`, `CMAKE_OBJECT_PATH_MAX=250`); Node 26.10.0, pnpm 12.8.1; SeaweedFS 4.48 `@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`. Testy: `cd spikes/offline-upload/core && npx vitest run` (33), `cd host && npx vitest run` (19, wymaga SeaweedFS). Scenariusze: `node scripts/scenarios.ts <nazwa>`. Bramka repozytorium po zmianach: `pnpm run gate` — **zielona** (kod 0, także `prettier --check .` z spike'iem, walidator dokumentacji 0 błędów; spike nie zmienia konfiguracji bramek ani głównego lockfile). Telemetria wyłączona: `EXPO_NO_TELEMETRY=1`, `MAESTRO_CLI_NO_ANALYTICS=1`. Sprzątanie po zadaniu: emulator zatrzymany, demony Gradle zatrzymane, kontener SeaweedFS i wolumen usunięte (`docker compose -f spikes/offline-upload/infra/compose.seaweedfs.yaml down -v`).
