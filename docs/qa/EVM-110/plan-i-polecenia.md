# EVM-110 — plan testów, polecenia dla orkiestratora i miejsce na wyniki

Historyjka: [EVM-110](../../backlog/M2/EVM-110-mobile-filmy-i-wifi.md) (AC1–AC8). Etapy: 1 natywnie (import MP4, polityka sieci, silnik), 2 aparat (tryb „Film”, limity, przerwania), 3 „Czeka na Wi-Fi” i ustawienie, 4 E2E (przepływy Maestro 90–102, scenariusze `video-*`) i dokumenty. Środowisko: emulator Androida na Windows (ADR-0015), Maestro 2.11, AVD `Medium_Phone_API_35`; iOS odłożony. Dane wyłącznie syntetyczne; aplikacja w E2E łączy się tylko z serwerem scenariuszy (RR-93).

## 1. Warunki wstępne

- **AVD z kamerą wirtualną:** `hw.camera.back=virtualscene` (jak w [EVM-108](../EVM-108/plan-i-polecenia.md)). Bez tylnej kamery krok `video-no-audio-no-location` powie w raporcie **„NOT PERFORMED”** (osobny wiersz i licznik), a przepływy z aparatem (90, 96, 100, 101) nie uruchomią nagrania — taki przebieg nie jest dowodem AC1 dla prawdziwego aparatu.
- **Sieć z opłatami naprawdę:** `adb shell svc wifi disable` + `svc data enable` daje po ok. 12 s domyślną sieć komórkową bez `NOT_METERED` (zweryfikowane 2026-11-15, serwer scenariuszy `10.0.2.2` osiągalny); `svc wifi enable` — po ok. 8 s Wi-Fi. Kroki `network-metered` i `network-unmetered` odpytują `dumpsys connectivity`, nie śpią na sztywno (limit 90 s). **Runner zawsze przywraca Wi-Fi** po scenariuszu i w `finally`; gdyby Wi-Fi nie wróciło, kolejne scenariusze są pomijane z komunikatem `CLEANUP`. Po przebiegu przerwanym siłą sprawdź ręcznie: `adb shell svc wifi enable`.
- **Dysk emulatora i hosta:** scenariusz `video-batch-3` zapisuje dwa syntetyczne filmy po 64 MiB i jedno nagranie aparatem (razem ok. 140 MiB na urządzeniu) — wolne co najmniej kilka GB; po przebiegu dane aplikacji czyści następna czysta instalacja (`80-camera-sign-in`).
- Wariant e2e (nie release) — haki są tylko w nim; paczka release ze znacznikiem haków (`evia-e2e-hooks-panel`) jest odrzucana przez `tools/mobile-apk verify`; hak filmu (`media: capture video`) jest importowany wyłącznie przez panel haków (test `e2e-hooks.test.tsx`, SEC-110-18).
- Gradle i budowa wariantu e2e — tylko przez `tools/mobile-e2e` (jak dotąd); testy JVM modułu — osobno po sygnale, że emulator jest wolny.

## 2. Polecenia (z katalogu głównego repozytorium)

| Krok | Polecenie |
|---|---|
| Testy aplikacji (Jest, pokrycie) | `pnpm --filter @evia/mobile run test:coverage` oraz `pnpm --filter @evia/mobile run typecheck` i `lint` |
| Testy narzędzia (pokrycie ≥ 90% linii i gałęzi) | `pnpm --filter @evia/mobile-e2e run test:coverage` oraz `npm run test:tools` |
| Testy `verify` (RECORD_AUDIO, uprawnienia) | `pnpm --filter @evia/mobile-apk run test` |
| Reguły repo-policy (Kotlin: `WifiManager`, mikrofon) | `pnpm --filter @evia/repo-policy exec vitest run test/kotlin.test.ts` |
| Reguły ESLint (mikrofon) | `pnpm --filter @evia/config run test` |
| Testy JVM silnika i modułu (Corretto 17, osobno po sygnale) | `JAVA_HOME=C:\Users\Konrad\.jdks\corretto-17.0.13` → `apps/mobile/modules/evia-upload/engine`: `gradlew test ktlintCheck koverVerify`, potem `gradlew --stop` |
| Pełny przebieg filmu z buildem | `node tools/mobile-e2e/cli.mjs --only video-` |
| Powtórka bez buildu | `node tools/mobile-e2e/cli.mjs --skip-build --only video-` |
| Jeden scenariusz | `node tools/mobile-e2e/cli.mjs --skip-build --only video-batch-3` (nazwy w tabeli niżej; `--only` bierze nazwy lub przedrostki po przecinku) |
| Regresja aparatu i wysyłania | `node tools/mobile-e2e/cli.mjs --skip-build --only camera-,upload-` |
| Domyślny przebieg | `node tools/mobile-e2e/cli.mjs --skip-build` |
| Raport | `.scratch/mobile-e2e/report.md` (przepływy, kroki urządzenia z liczbami i kodami, logcat aplikacji); zrzuty do przeglądu UX: `docs/ux/reviews/EVM-110/` (klasa „kamień milowy”) |

## 3. Scenariusze `video-*` (poza przebiegiem domyślnym)

Każdy zaczyna od czystej instalacji (`80-camera-sign-in`, bez zgody na aparat) i `upload-reset` serwera scenariuszy. Szacowany czas (emulator, przy pierwszym przebiegu bez ponowień): razem ok. 30 min.

| Scenariusz | AC | Przepływy | Co sprawdza | Czas |
|---|---|---|---|---|
| `video-record` | AC1 AC2 AC6 | 90 | prawdziwy aparat (wirtualna scena) po `camera-geo-fix`: przełącznik „Film”, „Film bez dźwięku”, licznik, zapis, wiersz filmu w Kolejce; MP4 ma ścieżkę wideo, **nie ma `soun`, `©xyz`, `loci`, `location`**; MediaStore (wideo) i `DCIM`/`Pictures`/`Movies` bez zmian; `permissions-minimal` (bez mikrofonu i lokalizacji) | ok. 3 min |
| `video-wifi-only` | AC4 AC6 | 91, 92 | sieć z opłatami: film „Czeka na Wi-Fi” z banerem „1 film czeka na Wi-Fi…” i linkiem, zdjęcie „Wysłano”; serwer dostał dokładnie 1 część (zdjęcia), 0 części filmu; po `svc wifi enable` film rusza sam; 2 obiekty, SHA-256 zgodne | ok. 5 min |
| `video-wifi-setting-off` | AC4 | 93 | wyłączenie przełącznika w „Więcej → Wysyłanie” (jedno dotknięcie, bez dialogu) uruchamia film przez sieć z opłatami; 1 obiekt | ok. 3 min |
| `video-wifi-midway` | AC5 | 94, 95, 92 | film wysyłany przez Wi-Fi; `svc wifi disable` w trakcie: „Czeka na Wi-Fi” bez „Wymaga uwagi” i „Nie wysłano”, **zero nowych części** przez sieć z opłatami (`upload-part-puts-hold`); powrót Wi-Fi: dokończenie, 1 obiekt, SHA-256 zgodne | ok. 5 min |
| `video-batch-3` | AC8 | 96–99, 92 | 3 filmy (2 syntetyczne po 64 MiB z haka + 1 nagranie aparatem) zapisane bez zasięgu tą samą ścieżką; `kill -9`; start offline („Czeka na połączenie”); sieć z opłatami (3 filmy czekają, serwer: 0 części); Wi-Fi: wysyłanie, zerwanie połączenia w trakcie części (`drop_mid_part`), `force-stop`, wznowienie; punkt kontrolny: 3 obiekty we właściwym zleceniu, po jednym na `assetId`, zgodne SHA-256, 0 duplikatów, 0 osieroconych multipartów; 3 wiersze „Wysłano”; MediaStore bez zmian | ok. 12 min |
| `video-interrupt` | AC3 | 100, 101, 102 | Home w trakcie nagrania: film zapisany (licznik „1 film”, wiersz w Kolejce); `kill -9` w trakcie nagrania: brak wiersza uszkodzonego filmu, raz „Poprzednie nagranie zostało przerwane i nie zostało zapisane.” | ok. 4 min |

Uwagi do przepływów: toast „Nagrywanie przerwane — zapisano …” (AC3) pojawia się, gdy aplikacja jest w tle, i może zniknąć przed powrotem — komunikat sprawdzają testy Jest, a Maestro sprawdza zapisany film; „Film wyłączony” (< 200 MB) wymaga wypełnienia dysku emulatora i zostaje w testach Jest (`camera-screen-video.test.tsx`) oraz w `manual` M18 (EVM-112).

## 4. Macierz AC → testy

| AC | Jest (aplikacja) | JVM (silnik, `engine`) | `node:test` (narzędzia) | Maestro / emulator |
|---|---|---|---|---|
| **AC1** film z kategorią zapisany trwale (plik `.mp4` przeniesiony, 5 kluczy, bez galerii, bez `soun` i lokalizacji) | `video-durability.test.ts`, `video-options.test.ts`, `create-media-asset.test.ts` (dokładny zbiór kluczy, RR-96), `video-rows.test.tsx` (wiersz: ikona, czas, rozmiar, bez numeru zlecenia), `media-file-store.test.ts` (schemat v4), `camera-screen-video.test.tsx` (toast, licznik) | `VideoImportTest` (przeniesienie bez kopii i dowiązania, `ftyp`, rozmiar, ten sam `FileStore`, bez nadpisania, wyścig), skrót strumieniem | `mp4.test.mjs` (czytnik atomów z kontrolą pozytywną), `device-video.test.mjs` (film bez `soun`/lokalizacji, galeria wideo) | `video-record` (90): `video-no-audio-no-location:1`, `video-gallery-unchanged`, `permissions-minimal` |
| **AC2** limity i miejsce | `video-options.test.ts` (`videoSizeLimit`, progi 200 MB / 100 MB), `video-durability.test.ts` (limit czasu, rozmiaru, miejsce, start poniżej 200 MB), `camera-screen-video.test.tsx` (licznik „0:42 / 5:00”, ogłoszenia, ostrzeżenie, „Film wyłączony”, komunikaty) | — | — | `video-record` (licznik na prawdziwym nagraniu); reszta: Jest i `manual` M16, M18 |
| **AC3** przerwane nagranie i wylogowanie w trakcie | `camera-screen-video.test.tsx` (AppState, Wstecz, ✕, „Gotowe”, odmontowanie), `video-durability.test.ts` (kill: brak wiersza, jednorazowy komunikat; koniec sesji: brak importu; marker), `session-owner.test.ts` (`onBeforeSessionEndAsync`, limit 3 s) | `VideoImportTest` (odśmiecacz: `.mp4` ≥ 15 min, trwające nagranie zostaje; czyszczenie) | `video-flows.test.mjs` | `video-interrupt` (100–102) |
| **AC4** „tylko Wi-Fi”: czekanie i start | `waiting-wifi.test.tsx` (wiersz, wiek, baner, link, „Czeka na połączenie”, przełącznik), `media-uploads.test.ts` (status, zapis ustawienia), `video-rows.test.tsx` (`SwitchRow`) | `VideoNetworkTest` (macierz typ × ustawienie, przezbrajanie, trwałość i wipe), `UploadWorkerTest` (film czeka, zdjęcie idzie, stan), `SchedulePolicyTest` | `device-video.test.mjs` (sieć, części serwera), `run.test.mjs` (przywrócenie Wi-Fi) | `video-wifi-only` (91, 92), `video-wifi-setting-off` (93) |
| **AC5** zmiana sieci w trakcie; film po 7 dniach | `media-uploads.test.ts` (`failed`/`abandoned` ignorowane dla czekającego wiersza, ten sam `assetId`, 0 duplikatów) | `EngineBehaviorTest` (przerwa przy sieci z opłatami bez błędu i bez duplikatu części; **nowa sesja po porzuceniu starej**) | `device-video.test.mjs` (`upload-part-puts-hold`) | `video-wifi-midway` (94, 95, 92) |
| **AC6** przełącznik, role, stany | `camera-screen-video.test.tsx` (grupa „Tryb”, domyślnie „Zdjęcie”, offline z kapsułą „Offline · n”, tryb ukrytych danych), `waiting-wifi.test.tsx` (ukryte dane), `ui` (`FilterChip`, `CameraShutter`) | — | — | `video-record`, `video-wifi-only` (tryb, znacznik „Film bez dźwięku”); Tylko odczyt (`403 channel_not_allowed`) — testy API EVM-131 |
| **AC7** bez dźwięku i bez mikrofonu | `video-options.test.ts` (stała `mute: true`), `camera-static.test.ts` (źródło ekranu), `camera-screen-video.test.tsx` (brak wywołań API mikrofonu), `eslint-ui.test.ts` (reguły) | — | `tools/mobile-apk`: `manifest.test.mjs`, `verify.test.mjs` (RECORD_AUDIO i każde dodatkowe uprawnienie odrzucone), `kotlin.test.ts` (repo-policy) | `permissions-minimal` w `video-record` |
| **AC8** trzy filmy bez duplikatów po przerwach | `e2e-hooks.test.tsx`, `synthetic-video.test.ts` (hak: MP4 `ftyp` + `mdat`, chunki ≤ 1 MiB, SHA-256 z ziarna) | — | `video-flows.test.mjs` (kolejność kroków scenariusza, przepływy), `device-upload.test.mjs` (skrót `.mp4`) | `video-batch-3` (96–99, 92) z punktem kontrolnym serwera |

## 5. Wymagania bezpieczeństwa (`SEC-110-nn`) — gdzie sprawdzone

| ID | Dowód |
|---|---|
| 01 | `tools/mobile-apk`: `manifest.test.mjs`, `verify.test.mjs` |
| 02, 03 | `video-options.test.ts`, `camera-static.test.ts`, `eslint-ui.test.ts`, `kotlin.test.ts` (repo-policy) |
| 04 | `mp4.test.mjs` + `video-record` (`video-no-audio-no-location`); straż biblioteki — `camera-library.test.mjs` (EVM-108) |
| 05, 06, 07, 11, 15 | `VideoImportTest` (JVM) |
| 08 | `camera-static.test.ts`, `video-gallery-unchanged` (`video-record`, `video-batch-3`) |
| 09, 10 | `create-media-asset.test.ts`, `video-durability.test.ts` |
| 12 | `session-owner.test.ts`, `video-durability.test.ts`, `camera-screen-video.test.tsx` |
| 13 | `camera-screen-video.test.tsx` (AppState), `video-interrupt`; koniec nagrania po blokadzie ekranu — `manual` M8 |
| 14 | `video-rows.test.tsx`, `waiting-wifi.test.tsx` (ukryte dane), `NotificationText` (stan „czeka” poza powiadomieniem) |
| 16 | `VideoNetworkTest`, `kotlin.test.ts` (repo-policy: `WifiManager`, SSID) |
| 17 | `VideoNetworkTest` (jedna wartość logiczna, nie czyszczona przez wipe), `media-uploads.test.ts` |
| 18 | `e2e-hooks.test.tsx` (hak tylko w panelu), `synthetic-video.test.ts`; paczka release — `verify` (znacznik panelu) |
| 19 | brak nowych zależności; porównanie drzewa `releaseRuntimeClasspath` z EVM-108 — orkiestrator z paczki e2e |
| 20, 21 | przepływy `video-*` na paczce e2e z R8 (logcat bez `NoClassDefFoundError`); `FLAG_SECURE` na ekranie nagrania — `manual` (M8) |

## 6. Miejsce na wyniki (uzupełnia orkiestrator)

| Data | Przebieg | Wynik | Uwagi |
|---|---|---|---|
| | `--only video-` na buildzie z etapu 4 | | |
| | `--skip-build --only camera-,upload-` (regresja) | | |
| | testy JVM silnika (`gradlew test ktlintCheck koverVerify`) | | |
