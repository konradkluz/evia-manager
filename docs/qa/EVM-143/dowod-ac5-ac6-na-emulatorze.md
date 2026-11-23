# EVM-143 — dowód AC2–AC6 na emulatorze Androida

Historyjka: [EVM-143](../../backlog/M2/EVM-143-mobile-odtwarzanie-filmow-zlecenia.md) (AC2–AC6). Data: 2026-11-23. Wykonawca: mobile-developer. Środowisko (ADR-0015): emulator `sdk_gphone64_x86_64`, Android 15 (API 35, obraz Google Play, bez `adb root`), Maestro 2.11.0, wariant e2e (`debuggable`, `run-as`), build z krótkiego klonu `C:\e` (droga A), gałąź `feature/EVM-143-odtwarzanie-filmow`. Dane wyłącznie syntetyczne; aplikacja łączy się tylko z serwerem scenariuszy (`10.0.2.2`).

## Werdykt: ZIELONO (22 z 22 przepływów Maestro, 4 scenariusze `film-*`), z uwagami z § 5

Polecenie: `node tools/mobile-e2e/cli.mjs --skip-build --only film-` (build wcześniej: `tools/mobile-apk verify` paczki release zielony po poprawce WAKE_LOCK, § 4). Opis kroków: `tools/mobile-e2e/README.md`. Plik filmu: próbka MP4 profilu Main (13,7 s, `moov` na końcu) spoza repozytorium, `EVIA_E2E_VIDEO_FIXTURE`; próbki z Android SDK mają profil High 4:4:4, którego dekoder emulatora odmawia („Decoder init failed”).

## 1. AC → scenariusz → wynik

| AC | Scenariusz / przepływy | Wynik |
| --- | --- | --- |
| AC2 (siatka, wiersz „…, 1 film”, kafel „Film, [kategoria], [czas]”, nic nie jest pobierane przed „Odtwórz”) | `film-play` 160-film-grid: wiersz, kafel, brak nazw plików; serwer: **0 adresów i 0 bajtów filmu** | passed |
| AC3 (odtwarzanie, wygasły adres, błąd, ponowienie) | 160-film-play: „Odtwórz” → film gra do „Odtwórz ponownie”; **1 adres, 3 żądania (2 z `Range`)**, bez `Authorization`/`Cookie`/`_=`; 161-film-expired: adres wydany już wygasły → **2 adresy**, 4 żądania `403`, film gra bez komunikatu; 162-film-error: 500 → „Nie udało się odtworzyć filmu” + „Spróbuj ponownie” (bez kodu i adresu); 162-film-retry: po usunięciu błędu nowy adres, film gra | passed |
| AC4 (offline) | `film-offline`: tryb samolotowy + otwarty odtwarzacz → „Film wymaga internetu”, **0 adresów, 0 żądań**; powrót sieci → nic nie startuje samo (0 żądań), ręczne „Spróbuj ponownie” gra (1 adres) | passed |
| AC5 (nic na dysku, zero adresu w logu, blokada, tło, wylogowanie, wyczyszczenie danych) | `film-no-trace` (§ 2) | passed |
| AC6 (manifest, nazwy i cele, 200% z przewijaniem) | `film-manifest`, `permissions-minimal`, `tools/mobile-apk verify` (§ 4); `film-font-scale` (§ 3) | passed |

## 2. Dowód AC5 — brak śladu na dysku i w logu

Przeszukanie (`film-disk-baseline` / `film-disk-check`): pliki o zawartości `ftyp` (nagłówek MP4) lub znaczniku adresu `E2EMARK` w `/data/data/<pakiet>` (przez `run-as`) i `/sdcard/Android/data/<pakiet>`, pliki o nazwach `*.mp4`, `*.exo`, `*.m4s`, `*.webm`, wpisy `cache/http-cache`; filtr logu (`photos-logcat-clean`): adres bucketu, `X-Amz-Signature`, `E2EMARK` poza wierszami sterownika Maestro (pusty log = porażka). Serwer odpowiada filmem z `Cache-Control: private, max-age=300` (najgorszy przypadek), a źródło odtwarzacza to `{ uri, useCaching: false }`.

Stan wyjściowy (po logowaniu): `ftyp` w 0 plików, `E2EMARK` w 0, nazwy 0, `http-cache` 0 wpisów.

| Etap | Ślad ponad stan wyjściowy | Log | Uwagi serwera |
| --- | --- | --- | --- |
| film odtworzony do końca i zamknięty (164-film-view) | 0 plików, `http-cache` tylko `journal` | czysty (1761 wierszy) | 1 adres, 3 żądania, nagłówki bez `Authorization`/`Cookie`/`_=` |
| blokada z filmem ładowanym (serwer podaje 16 KiB co 5 s) | 0 | czysty (1582) | **porzucone żądania ≥ 1** (odtwarzacz zwolniony od razu) |
| tło (Home → powrót): ekran zostaje, odtwarzacz zatrzymany („Odtwórz”, nie „Pauza”), nic nie startuje samo | 0 | czysty (1774) | porzucone ≥ 2 |
| film odtworzony, zamknięty, wylogowanie | 0 | czysty (1448) | 7 żądań, nagłówki czyste |
| ponowne logowanie, film, „Wyczyść dane firmowe” | 0 | czysty (2638) | 10 żądań, nagłówki czyste |

**Kontrola dodatnia wyszukiwania** (`film-disk-control`, ta sama instalacja): krok podkłada plik `cache/E2E-control.mp4` z `ftyp` i znacznikiem; to samo przeszukanie znalazło go po zawartości (1), po znaczniku (1) i po nazwie (1), po czym plik jest usuwany. Przeszukanie widzi więc pliki, gdy istnieją. To kontrola narzędzia, nie samego odtwarzacza: w przeciwieństwie do EVM-142 nie wymusiliśmy zapisu pamięci podręcznej przez bibliotekę (wymagałoby buildu z `useCaching: true`); dowodem, że odtwarzacz nic nie zapisuje, jest wynik zerowy przy filmie serwowanym jako cacheowalny, z 1 do 10 żądań na etap.

Ograniczenie: film trwa 13,7 s, a Maestro czyta drzewo widoków wolniej, niż emulator go odtwarza, więc blokadę i tło sprawdzano przy filmie ładowanym bardzo powoli (stan `loading`, pobieranie w toku), nie w stanie „Pauza”. Pauza i wznowienie są pokryte testami jednostkowymi sesji.

## 3. AC6 — 130% i 200% czcionki, przewijanie

`film-font-scale`: 130% / 411 dp, 200% / 411 dp, 200% / 360 dp; w każdym siatka, odtwarzacz, przewinięcie do „Odtwórz” (`scrollUntilVisible`), odtworzenie do końca, zamknięcie przewiniętym przyciskiem. Zrzuty (`docs/ux/reviews/EVM-143/f130-*`, `f200-*`, `f200n-*`, `m08-*`, `m08c-*`; PNG poza gitem) obejrzane: nagłówek (kategoria, czas, „Film”) zawija się bez łamania słów, przycisk „Odtwórz” w pełnej szerokości i osiągalny, nazwy „Zamknij odtwarzacz” i „Odtwórz”/„Pauza” dostępne w drzewie (asercje Maestro). Uwaga otwarta z EVM-142 (scenariusz 140 przy 130/200% wymaga przewijania) nie dotyczy tego scenariusza: ten przewija.

## 4. Manifest i paczka (AC6)

- `tools/mobile-apk verify` na paczce release (budowa przez `cli.mjs`) **wykrył realny problem**: `expo-video` (media3 ExoPlayer) wnosi do scalonego manifestu `android.permission.WAKE_LOCK`. Poprawka: `plugins/with-video.ts` usuwa je (`tools:node="remove"`; `expo-video` 58.0.12 nie woła `setWakeMode`); po niej `verify` zielony i lista uprawnień aplikacji bez zmian.
- Scalony manifest zainstalowanej aplikacji (`dumpsys package`, krok `film-manifest`): brak uprawnień `FOREGROUND_SERVICE*` i `RECORD_AUDIO`, brak `FullscreenPlayerActivity` i usług odtwarzania; `permissions-minimal` zielony. `POST_NOTIFICATIONS` **jest** na liście — pochodzi z wysyłania plików (EVM-130 AC7, na białej liście `tools/mobile-apk`), nie z odtwarzacza; AC6 sformułowane „brak … POST_NOTIFICATIONS” jest w tym punkcie niezgodne ze stanem aplikacji (zob. pytania).
- Dziennik systemu pokazuje sesję multimedialną `ExpoVideoBasicMediaSession` biblioteki (wpis `MediaSessionService`) — bez usługi i bez powiadomienia; znika po zwolnieniu odtwarzacza.

## 5. Ustalenia

1. **AC4 „utrata sieci w trakcie”:** gdy sieć znika przy otwartym odtwarzaczu, a aplikacja jeszcze nie odświeżyła statusu (status startu zmienia się po powrocie na pierwszy plan), pierwszy błąd daje „Nie udało się odtworzyć filmu” zamiast „Film wymaga internetu” (sesja ocenia sieć sygnałem `online` aplikacji, nie rodzajem błędu). Po powrocie aplikacji na pierwszy plan komunikat jest poprawny (scenariusz `film-offline`). Do decyzji: czy rozróżniać błąd sieci od błędu serwera w warstwie źródła adresu.
2. **Zwolnienie natywnego odtwarzacza (code-review):** `release()` portu jest teraz odroczone o 300 ms po wyciszeniu (pauza, brak słuchaczy), żeby widok `VideoView` zdążył się odmontować; ścieżki blokady, tła, wylogowania i `session_revoked` przeszły na emulatorze bez awarii (w dzienniku brak `FATAL`/`AndroidRuntime` z aplikacji).
3. Pauza w stanie „gra” nie jest asertowana w Maestro (patrz § 2, ograniczenie).
