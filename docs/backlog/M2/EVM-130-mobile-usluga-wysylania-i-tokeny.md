---
id: EVM-130
title: "Aplikacja: wysyłanie w tle na Androidzie — zadanie systemowe, natywny właściciel tokenów, kolejka plików"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: in-progress
priority: P1
path: pelna             # synchronizacja offline, pliki, uwierzytelnianie workera, nowe uprawnienia i komponenty paczki
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-109, EVM-100, EVM-101, EVM-107]
---

# EVM-130: Aplikacja — wysyłanie w tle na Androidzie: zadanie systemowe, natywny właściciel tokenów, kolejka plików

## Cel
Jako **technik** chcę, aby **pliki z kolejki same się wysyłały w tle, wznawiały po przerwie, zabiciu aplikacji i restarcie telefonu i nigdy się nie dublowały**, aby **kryterium wyjścia M2 (30 zdjęć, 3 filmy bez strat) dało się spełnić**. Druga połowa dawnej EVM-109 (podział 2026-11-14): Android wokół gotowego silnika z [EVM-109](EVM-109-mobile-upload-w-tle-android.md).

## Kontekst
[ADR-0020](../../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (z adnotacją ADR-0020a o właścicielu tokenów), [`media-pipeline.md`](../../architecture/media-pipeline.md) §1–§3, §7, [`offline-sync.md`](../../architecture/offline-sync.md) („Komendy mobilne MVP”, „Magazyn lokalny”, pkt 7), makieta [09](../../ux/flows/09-mobile-zdjecia-filmy-offline.md) (powiadomienia, zgoda). Serwer dla mediów z telefonu: [EVM-131](EVM-131-api-media-z-telefonu.md) — w nocy aplikacja pracuje na serwerze scenariuszy zgodnym z kontraktem.

## Kryteria akceptacji

**AC1 — Wysyłka przeżywa przerwania (emulator)**
- Zakładając plik syntetyczny z haka testowego (bez aparatu) w trwałej kolejce, `applied` dla `CreateMediaAsset` i sesję na serwerze scenariuszy
- Gdy aplikacja zostaje zabita (`kill -9`), zatrzymana siłą (wysyłanie rusza po ponownym otwarciu), emulator jest restartowany albo sieć zanika (tryb samolotowy)
- Wtedy wysyłanie wznawia się od ostatniej potwierdzonej części, a punkt kontrolny serwera scenariuszy pokazuje dokładnie jeden obiekt na `assetId`, zgodne SHA-256 i zero osieroconych multipartów; zadanie jest uzbrajane dopiero po `applied` komendy `CreateMediaAsset` (z `workOrderId`).

**AC2 — Odświeżanie tokenów wyłącznie natywnie**
- Zakładając wygasły token dostępu podczas wysyłania w tle oraz aplikację na pierwszym planie
- Gdy potrzebny jest nowy token
- Wtedy odświeża go jeden właściciel natywny (jedna blokada w procesie aplikacji; usługa zadań działa w procesie domyślnym — test manifestu) bez uruchamiania JavaScriptu; nowy token jest zapisany trwale przed użyciem; błąd połączenia przed wysłaniem żądania zostawia token bez zmian (ponowienie z backoffem); wysłane żądanie bez odpowiedzi jest ponawiane tym samym tokenem w oknie tolerancji (≤ 20 s); późniejsze `session_revoked` daje `paused_revoked`, a pliki i kolejka zostają (TM-06).

**AC3 — Magazyn tokenu i jednorazowe ponowne logowanie**
- Zakładając decyzję 17 (opcja (a), ADR-0020a, SR-SESS-09)
- Gdy aplikacja zostaje zaktualizowana do tej wersji
- Wtedy token odświeżania jest wyłącznie w magazynie natywnym (AES-256-GCM, klucz Keystore bez uwierzytelnienia użytkownika, pamięć CE, `noBackupFilesDir`), JS dostaje tylko token dostępu w pamięci i nie ma żadnej ścieżki odczytu tokenu odświeżania, stary slot `evia.refresh-token` jest usuwany (bez migracji — technik raz loguje się ponownie, kolejka i baza zostają), a plik zadania nie zawiera żadnego tokenu (test schematu pliku).

**AC4 — Oryginał zostaje do potwierdzenia**
- Zakładając plik wysłany
- Gdy serwer scenariuszy nie potwierdził stanu `clean` w replice `media_asset`
- Wtedy lokalny oryginał nie jest usuwany (`offline-sync.md`, pkt 7); `failed: checksum_mismatch` daje „Ponów”, `quarantined` — „Wymaga uwagi”, a po `clean` oryginał jest usuwany (rekord pliku zostaje zgodnie z EVM-111).

**AC5 — Odwołanie, wersja, czyszczenie i tryb ukrytych danych**
- Zakładając zadania wysyłania w toku (Maestro z `adb` / `run-as` / `dumpsys jobscheduler`)
- Gdy serwer odpowie `401 session_revoked`, `426` lub `401 device_wipe_required`, technik wybierze „Wyczyść dane firmowe” albo włączy się tryb ukrytych danych
- Wtedy odwołanie daje `paused_revoked` (wznowienie dopiero po pełnym logowaniu tego samego właściciela), `426` — wstrzymanie; przy czyszczeniu krok E11 przed `confirmDeviceWipe` anuluje zadania systemowe i usuwa pliki zadań, oryginały i pliki tymczasowe (aparat), a przy aktywnym znaczniku czyszczenia worker nic nie wysyła; w trybie ukrytych danych wysyłka trwa, ale worker nigdy nie przywraca widoczności danych; logcat nie zawiera `X-Amz-` ani tokenów.

**AC6 — Powiadomienie prywatne i zgoda**
- Zakładając pliki w kolejce i wysyłanie w tle
- Gdy system pokazuje powiadomienie albo brak zgody na powiadomienia (Android 13+)
- Wtedy kanał „Wysyłanie plików” ma niski priorytet (bez dźwięku i wibracji), widoczność prywatną i wersję publiczną „EVia Manager”; teksty (liczba mnoga wg § 6.3): „Wysyłanie 3 z 12 plików”, „Wysłano 12 plików”, „Nie wysłano 2 plików — otwórz aplikację”, „Wysyłanie wstrzymane — zaloguj się w aplikacji”; bez numerów zleceń, nazw, adresów i miniatur; dotknięcie otwiera Kolejkę (`PendingIntent` jawny, `FLAG_IMMUTABLE`), bez przycisków akcji; stan „czeka na Wi-Fi” nie jest powiadomieniem o błędzie; bez zgody Kolejka pokazuje Banner „Powiadomienia wyłączone — nie zobaczysz, że wysyłanie się zatrzymało.” z akcją „Włącz powiadomienia”, a komponent prośby „Powiadomienia o wysyłaniu” (BottomSheet z makiety 09) jest gotowy do wywołania po pierwszym „Gotowe” z elementem w kolejce (wywołanie — EVM-108).

**AC7 — Uprawnienia i komponenty paczki (`tools/mobile-apk verify`)**
- Zakładając zbudowany APK
- Gdy uruchamiam `verify`
- Wtedy allowlista uprawnień jest rozszerzona jawnie tylko o `RUN_USER_INITIATED_JOBS`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` (bez własnego odbiornika BOOT) i `POST_NOTIFICATIONS`; wyeksportowana pozostaje wyłącznie `MainActivity`; usługa zadania ma `BIND_JOB_SERVICE`, nie jest eksportowana, bez `directBootAware` i `android:process`; brak `FOREGROUND_SERVICE*`; paczka z dodatkowym uprawnieniem lub eksportowanym komponentem jest odrzucana (test negatywny).

**AC8 — Serwer scenariuszy z sesjami wysyłania**
- Zakładając `tools/mobile-e2e` bez nowych zależności
- Gdy scenariusz Maestro lub test `node:test` używa nowego `upload-stub.mjs`
- Wtedy stub obsługuje pięć operacji sesji z kontraktu (`paths/media.yaml`), przyjmuje PUT części pod `10.0.2.2` z kontrolą `Content-Length`, ma idempotentny `complete`, wstrzykuje błędy (`403` wygasły adres, zerwanie w trakcie części, `401 session_revoked` i `device_wipe_required`, `426`, `id_conflict`), udostępnia punkt kontrolny (liczba obiektów na `assetId`, SHA-256, osierocone multiparty), a jego testy mają pokrycie ≥ 90%.

## Poza zakresem
Aparat i wejścia do zdjęć (EVM-108), filmy i „tylko Wi-Fi” (EVM-110), ekrany stanów plików (EVM-111); UIDT na fizycznym Androidzie 14+, ścieżka Androida 13 na telefonie, restart fizyczny, bateria i producenci zabijający procesy, ekran blokady (EVM-112, `manual`); iOS; migracja starego tokenu; PoP.

## Decyzje i ograniczenia
- Decyzja 17 potwierdzona 2026-11-14 (opcja (a) ADR-0020; adnotacja ADR-0020a zapisana przez architekta). **Zmiana brzmienia SR-SESS-09** w `docs/security/requirements.md` („jeden proces w `sync-core`” → „jeden właściciel natywny”) jest częścią tej historyjki — zmiana dokumentu razem z kodem, przegląd security-engineer. `sync-core` zostaje kontraktem (`SessionOwner`).
- **Bez migracji tokenu** (decyzja Konrada 2026-11-14): aplikacji nikt jeszcze nie używa; po aktualizacji jedno ponowne logowanie.
- **Android 13 i starsze:** zwykłe zadanie systemowe ze wznawianiem, bez usługi pierwszoplanowej (decyzja 2026-11-14); pomiar dużego filmu — EVM-112.
- **Pliki oczekujące:** oryginały i pliki zadań w `noBackupFilesDir` (pamięć CE; nigdy DE, `directBootAware`, pamięć zewnętrzna ani MediaStore), nazwy UUID; plik zadania tylko z identyfikatorami (bez opisu, kategorii, numeru zlecenia i adresów); bez szyfrowania na poziomie aplikacji (FBE + RR-07, jak klucz bazy — SR-MOB-01). Stan pliku w kolejce zapisuje wyłącznie JS (SQLCipher, migracja zachowawcza); worker natywny pisze tylko swój plik zadania (ETagi, postęp).
- **Kolejność zmieniona względem `media-pipeline.md` §1:** zadanie natywne uzbrajane po `applied` `CreateMediaAsset` (koszt: po `force-stop` przed `applied` wysyłka rusza po otwarciu aplikacji — akceptowane w ADR-0007); aktualizacja §1 i §3 w tej historyjce. Identyfikatory: `assetId` i `uploadSessionId` UUIDv7 zapisane przed pierwszym żądaniem, id zadania z trwałego mapowania.
- **Zakaz dystrybucji:** paczka z aparatem lub wysyłaniem nie trafia do techników ani na środowisko z danymi realnymi przed dowodami EVM-084 i sign-offem EVM-112; w nocy aplikacja łączy się wyłącznie z `tools/mobile-e2e` (RR-93). EVM-084 nie jest zależnością (decyzja Konrada 2026-11-14).
- UX / UI: teksty powiadomienia i zgody wg AC6; wskaźnik w aplikacji — istniejąca kapsuła i Kolejka, bez nowego ekranu. Stany: pusty (brak plików — bez powiadomienia), błąd, offline (wysyłanie czeka), brak uprawnień (Banner w Kolejce).
- Bezpieczeństwo i prywatność: dane na urządzeniu — oryginały, pliki zadań; tryb ukrytych danych i czyszczenie wg AC5; brak danych osobowych w logach i powiadomieniach.
- Zależność `EVM-109` jest w tej samej kolejce (jedna gałąź, po kolei); EVM-131 niewymagany do zielonych testów — stub zgodny z kontraktem.

## Notatki techniczne
- Pliki wspólne z torem B (ograniczyć zmiany): `apps/mobile/src/i18n/pl.ts` (nowe klucze w osobnych blokach na końcu sekcji), `screens/QueueScreen.tsx`, `src/e2e-hooks/panel.tsx`, `tools/mobile-e2e/src/scenarios.mjs`, `sync-stub.mjs`, numeracja `apps/mobile/e2e/*.yaml` i `test/flows.test.mjs`, `tools/mobile-apk/src/manifest.mjs` i `verify.mjs` (tu tylko tablica `allowed` i kontrola komponentów), `CHANGELOG.md`, README M2. `MoreScreen` nie ruszamy (nawigacja — tor B).
- Przepływy Maestro toru A: numery 50–69. Emulator jest jeden na maszynę — E2E torów naprzemiennie. Plik testowy 40 MiB (5 × 8 MiB) — dysk.
- Hak e2e wstrzykuje plik syntetyczny (bez aparatu); aktualizacja `media-pipeline.md` §1/§3 i SR-SESS-09 w tej samej gałęzi.

- Ustalenia architekta po zapisaniu ADR-0020a (2026-11-14) — do załatwienia w tej gałęzi razem z kodem: (1) reguła 7 dni offline liczy kontakt z serwerem zegarem `ContactClock` w JS na podstawie odświeżenia tokenu — po przeniesieniu odświeżania do Kotlina moduł natywny przekazuje JS informację o udanym kontakcie, inaczej odświeżenia z zadania w tle nie zostaną policzone (test); (2) `offline-sync.md` → „Magazyn lokalny”: łańcuch czyszczenia danych firmowych uzupełniony o plik i alias Keystore magazynu natywnego, a zdanie o usuwaniu tokenu odświeżania odniesione do magazynu natywnego; (3) `media-pipeline.md` §3 (tabela i akapit o tokenie dostępu zaszyfrowanym kluczem Keystore — stan ze spike’a) zastąpione magazynem tokenu odświeżania wg ADR-0020a; (4) adnotacje w ADR-0005 i ADR-0007 („Bezpieczny magazyn tokenów”, pytanie 7(b)) odsyłające dla Androida do ADR-0020a — przygotowuje `solution-architect` w przeglądzie albo wykonawca wg jego wskazań.

## Definition of Done
- [ ] AC1–AC8 pokryte testami oznaczonymi `EVM-130 AC#` (JVM, Jest, `node:test`, Maestro, `verify`); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzje: code-reviewer, security-engineer, solution-architect — approve; kryteria `manual` przeniesione do EVM-112.
- [ ] `CHANGELOG.md`; status `in-review` ustawia Tech Lead.

## Dziennik
- 2026-11-14 — utworzono jako druga połowa EVM-109 (product-owner); 8 AC
- 2026-11-14 — draft → ready: kryteria zatwierdzone przez Tech Leada z delegacji Konrada (pytanie przed nocą 2026-11-14); Konrad przegląda je rano w PR
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-14` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-14-mobile-media` (EVM-109 `in-review` w tej samej gałęzi)
- 2026-11-14 — plan gotowy (mobile-developer)
- 2026-11-14 — implementacja częściowa (mobile-developer): AC7 (verify paczki) i AC8 (serwer wysyłania) gotowe; JVM: właściciel tokenów, teksty powiadomienia, poprawki przeglądu EVM-109 (1, 6, 7); reszta (klej Androida, JS, Maestro, dokumenty) do kontynuacji
