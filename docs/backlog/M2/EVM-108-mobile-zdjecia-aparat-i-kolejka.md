---
id: EVM-108
title: "Aplikacja: zdjęcia — aparat, kategoria, kolejka plików"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: in-progress
priority: P1
path: pelna             # pliki, dane osobowe na urządzeniu
owner: mobile-developer
contributors: [ux-designer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-107, EVM-130, EVM-131]
---

# EVM-108: Aplikacja — zdjęcia: aparat, kategoria, kolejka plików

## Cel
Jako **technik** chcę **zrobić zdjęcie z poziomu zlecenia, nadać mu kategorię i mieć pewność, że trafi do archiwum**, aby **dokumentacja z oględzin i montażu powstawała na miejscu, także bez zasięgu**. Makiety [09](../../ux/flows/09-mobile-zdjecia-filmy-offline.md) (M-06, M-07) — z poprawkami z „Decyzji i ograniczeń”. Opis zdjęcia jest poza wersją 1 (decyzja Konrada 2026-11-15, niżej).

## Kontekst
Gotowe i zaakceptowane (`main`): silnik i wysyłanie w tle z kolejką plików (schemat v2) — [EVM-109](EVM-109-mobile-upload-w-tle-android.md), [EVM-130](EVM-130-mobile-usluga-wysylania-i-tokeny.md); komenda `CreateMediaAsset`, sesje wysyłania dla kanału mobile i stany mediów w replice — [EVM-131](EVM-131-api-media-z-telefonu.md). EVM-130 dostarczył: zadanie natywne uzbrajane po `applied` komendy `CreateMediaAsset`, powiadomienie prywatne, komponent prośby „Powiadomienia o wysyłaniu” (wywołanie należy do tej historyjki), usuwanie oryginału po potwierdzeniu serwera, czyszczenie plików przy wylogowaniu i w trybie ukrytych danych, hak e2e z plikiem syntetycznym i serwer scenariuszy. Ta historyjka dodaje **aparat, wejścia i zapis pliku z komendą** oraz minimalny widok plików w Kolejce.

## Kryteria akceptacji

**AC1 — Zdjęcie z kategorią zapisane trwale**
- Zakładając zalogowanego Administratora lub Edytora, otwarte zlecenie i zgodę na aparat
- Gdy wybieram jedną z 7 kategorii mediów (`MediaCategory`) i robię zdjęcie
- Wtedy w jednej transakcji powstają: plik w katalogu kolejki aplikacji pod nazwą UUID i wpis w kolejce z komendą `CreateMediaAsset` (`id` UUIDv7, `workOrderId`, `mediaType = photo`, `category`, `capturedAt`; bez `description` i `procedureStageId`) — albo żadne z nich; zdjęcie nie trafia do galerii ani do pamięci zewnętrznej, a w pliku nie ma lokalizacji (EXIF bez GPS; aplikacja nie ma uprawnień lokalizacji); wpis nie zawiera nazwy klienta ani adresu.

**AC2 — Seria i powrót do zlecenia**
- Zakładając otwarty aparat dla zlecenia
- Gdy robię kolejne zdjęcia jedno po drugim
- Wtedy kategoria pierwszego ujęcia w zleceniu jest obowiązkowa (spust zablokowany z podpowiedzią „Wybierz kategorię przed zdjęciem.”), kolejne ujęcia używają ostatnio wybranej; spust zapisuje od razu; licznik „n zdjęć” rośnie dopiero po trwałym zapisie, z toastem „Zapisano w telefonie” i ogłoszeniem dla czytnika ekranu; „Gotowe” wraca do zlecenia (nie do Kolejki), a po pierwszym „Gotowe” z elementem w kolejce aplikacja pokazuje prośbę „Powiadomienia o wysyłaniu” (komponent z EVM-130; odmowa nie blokuje pracy).

**AC3 — Zgoda na aparat**
- Zakładając brak zgody na aparat
- Gdy otwieram aparat po raz pierwszy, odmawiam, odmawiam trwale i wracam z ustawień systemu
- Wtedy widzę ekran wyjaśniający „Aparat do zdjęć z prac” (z informacją „bez zapisu w galerii, bez lokalizacji”) z [Zezwól na dostęp do aparatu] i [Nie teraz] (powrót do zlecenia, bez zmian w kolejce); po odmowie ten sam ekran; po odmowie trwałej „Brak dostępu do aparatu. Zezwól aplikacji na używanie aparatu w ustawieniach telefonu.” z [Otwórz ustawienia]; po powrocie z przyznaną zgodą aparat uruchamia się sam. Aplikacja nie prosi o żadne inne uprawnienie (mikrofon, lokalizacja, pamięć).

**AC4 — Brak miejsca i błędy aparatu**
- Zakładając brak miejsca w telefonie, błąd zapisu albo błąd uruchomienia aparatu
- Gdy robię zdjęcie lub otwieram aparat
- Wtedy: przy małej ilości miejsca widzę ostrzeżenie „Mało miejsca w telefonie: 1,2 GB.” (wartość rzeczywista), przy braku miejsca Banner „Brak miejsca — zdjęcie nie zostało zapisane. Zwolnij miejsce w telefonie.”, przy nieudanym zapisie „Nie udało się zapisać zdjęcia. Zrób je ponownie.”, przy błędzie aparatu „Nie udało się uruchomić aparatu.” z [Spróbuj ponownie] (ładowanie: „Uruchamianie aparatu…”, bez spinnera); w każdym z tych przypadków kolejka i licznik są nietknięte, nie zostaje niepełny plik ani wpis bez pliku.

**AC5 — Wejścia, role, offline i tryb ukrytych danych**
- Zakładając szczegóły zlecenia, arkusz „Dodaj” i różne role oraz stany aplikacji
- Gdy chcę zrobić zdjęcie
- Wtedy w szczegółach zlecenia jest stały dolny pasek z główną akcją „Zrób zdjęcie” i drugorzędną „Dodaj wpis”; pozycja „Zdjęcie lub film” w arkuszu „Dodaj” prowadzi do wyboru zlecenia (ostatnio otwierane + wyszukiwanie), a potem do aparatu (przełącznika „Zdjęcie / Film” nie ma do EVM-110); Administrator i Edytor robią zdjęcia, Tylko odczyt nie loguje się do aplikacji, niezalogowany widzi ekran logowania; offline aparat działa bez banera offline (kapsuła „Offline · n”); w trybie ukrytych danych aparat działa, a wybór zlecenia pokazuje wyłącznie numery zleceń (bez klienta, adresu i opisów), pasek w znanym zleceniu — bez numeru; blokada aplikacji i wymuszone czyszczenie danych firmowych działają jak dla reszty aplikacji (pliki z kolejki są usuwane wg EVM-130 AC5).

**AC6 — Pliki w Kolejce (minimum)**
- Zakładając pliki zdjęć w różnych stanach
- Gdy otwieram „Kolejka”
- Wtedy każdy plik jest wierszem wspólnego komponentu listy plików (kategoria, czas wykonania, typ) z jedną z etykiet: „Oczekuje”, „Wysyła się 45%”, „Wysłano”, „Wymaga uwagi”; nagłówek ma licznik plików do wysłania; stan pusty pokazuje istniejący komunikat Kolejki; dla „Wymaga uwagi” jest jedna akcja „Usuń z telefonu” (z potwierdzeniem); wiersze nie pokazują nazwy klienta ani adresu, a w trybie ukrytych danych — numeru zlecenia.

**AC7 — 30 zdjęć bez duplikatów po przerwach**
- Zakładając 30 zdjęć zapisanych bez zasięgu tą samą ścieżką zapisu co aparat (aparat emulatora i hak testowy z plikiem syntetycznym) oraz wymuszone zamknięcie aplikacji w trakcie wysyłki
- Gdy wraca zasięg (serwer scenariuszy z sesjami wysyłania)
- Wtedy punkt kontrolny serwera pokazuje 30 obiektów w właściwym zleceniu, po jednym na `assetId`, zgodne sumy SHA-256 i 0 duplikatów, a wiersze w Kolejce mają stan „Wysłano”.

**AC8 — Biblioteka aparatu bez telemetrii i uprawnienia (`tools/mobile-apk verify`)**
- Zakładając paczkę z aparatem zbudowaną z `expo-camera` z wyłączonym skanerem kodów
- Gdy uruchamiam `verify`, lint i przegląd zależności
- Wtedy paczka nie zawiera pakietów ani komponentów `com.google.mlkit`, `com.google.firebase`, `com.google.android.gms`, `com.google.android.datatransport` (manifest, DEX, drzewo zależności Gradle), allowlista uprawnień rośnie jawnie tylko o `CAMERA` (bez `RECORD_AUDIO`, lokalizacji, odczytu/zapisu pamięci), a paczka z dodatkowym uprawnieniem albo zakazaną grupą jest odrzucana (test negatywny); ESLint blokuje `expo-image-picker` i intencje systemowego aparatu (`ACTION_IMAGE_CAPTURE`); zależność ma uzasadnienie SR-SUPPLY-06 (licencja, utrzymanie, wersja dokładna).

## Poza zakresem
Filmy, mikrofon i przełącznik „Zdjęcie / Film” (EVM-110); ustawienie „tylko Wi-Fi” (EVM-110); ekran „Pliki zlecenia”, miniatury, przyczyny błędów i „Ponów”, wskaźnik „wysłano n z m”, retencja rekordów wysłanych plików (EVM-111); opis zdjęcia i etap (`procedureStageId`) w telefonie; podgląd przed zapisem i odrzucanie ujęcia; usuwanie niewysłanego pliku (poza „Usuń z telefonu” dla „Wymaga uwagi”); edycja i kompresja zdjęć; galeria; iOS; analiza ruchu sieciowego całej sesji i pomiary na fizycznym telefonie (EVM-112).

## Decyzje i ograniczenia

### UX / UI
- **Ekrany:** (a) dolny pasek szczegółów zlecenia (BottomBar: „Zrób zdjęcie” `size.touch-target.field` + „Dodaj wpis”; `order-detail-add-entry` zostaje); (b) arkusz „Dodaj” → wybór zlecenia (reużycie EntryTargetPicker) → aparat; (c) ekran zgody; (d) aparat (M-06 bez mikrofonu i bez opisu): 7 chipów kategorii, spust `size.touch-target.shutter`, licznik serii, „Gotowe”; (e) wiersze plików w Kolejce (wspólny komponent, który EVM-111 użyje ponownie w „Pliki zlecenia”).
- **Stany:** pusty (Kolejka bez plików), ładowanie („Uruchamianie aparatu…”), błąd (aparat, zapis), offline (normalna praca), brak zgody (AC3), brak miejsca (AC4), tryb ukrytych danych (AC5). Mikrocopy: jak w AC; reszta z makiety 09.
- **Komponenty/tokeny:** tylko biblioteka i tokeny (`color.sync.*`, `size.touch-target.*`); nowe ikony (wifi, cloud-upload, scan-search, cloud-check, cloud-alert, triangle-alert) do `ui/icons.ts` z istniejących pakietów. Etykiety „Oczekuje” / „Wysyła się 45%” zamiast „W kolejce” / „Wysyłanie 45%” z § 5.4 (spójność z Kolejką EVM-009) i brak pozycji „Dodaj” w BottomNav (kontynuacja odstępstwa EVM-009) — ux-designer wpisuje oba odstępstwa do changelogu styleguide'u.
- **Poprawka makiety 09 / M-06** (wejście z paska i arkusza, brak opisu, brak mikrofonu, brak przełącznika „Film” w v1) jest **częścią realizacji** (zadanie ux-designera w tej samej gałęzi), nie warunkiem startu: wszystkie teksty i stany są w AC i tej sekcji, więc developer nie czeka na makietę.
- Nietrafione zdjęcie usuwa biuro w panelu.

### Bezpieczeństwo i prywatność
- **Role → dostęp:** Administrator i Edytor — aparat i kolejka plików; Tylko odczyt nie loguje się do aplikacji (token telefonu → `403 channel_not_allowed`, EVM-131); niezalogowany — ekran logowania.
- **Dane na urządzeniu:** zdjęcie w pamięci wewnętrznej aplikacji (katalog kolejki z EVM-130, nazwa UUID, nigdy galeria, MediaStore ani pamięć zewnętrzna); plik zadania bez kategorii i numeru zlecenia; powiadomienia i podglądy bez danych klienta; w logach brak nazw, adresów i tokenów (SR-MOB).
- **Aparat wbudowany** (CameraX przez `expo-camera`, skaner kodów wyłączony), bez `setLocation`; zakaz intencji systemowego aparatu (obca aplikacja mogłaby dopisać GPS lub skopiować plik do galerii/chmury).
- **Telemetria biblioteki aparatu:** usuwana na etapie budowania (zależność nieobecna), nie wyłączana w działaniu. **Warunek zatrzymania:** jeśli `verify` lub drzewo Gradle wskaże którąkolwiek zakazaną grupę po wyłączeniu skanera i wykluczeniach zależności, wykonawca zatrzymuje się i zgłasza to w raporcie (bez przechodzenia na inną bibliotekę i bez poluzowania kontroli); decyzję o wymianie biblioteki podejmuje Konrad na wniosek architekta.
- **Sesje wysyłania** tworzone leniwie (limit 100 aktywnych, `429` → ponowienie z backoffem w silniku EVM-130).
- **Opis zdjęcia (RR-96):** medium z telefonu nie ma jak być poprawione ani usunięte z panelu, a opis mógłby zawierać dane osobowe — dlatego opis w v1 pominięty (decyzja Konrada 2026-11-15).
- **Dystrybucja (decyzja Konrada 2026-11-15):** technicy dostają paczkę z aparatem i wysyłaniem na test terenowy EVM-112 bez czekania na EVM-084 (kopie zapasowe nie blokują funkcji ani testów); w testach automatycznych tej historyjki aplikacja łączy się wyłącznie z serwerem scenariuszy `tools/mobile-e2e` (RR-93). Dane testowe: pliki syntetyczne.

### Granica z EVM-111
EVM-108 pokazuje w Kolejce **minimum**: wiersz pliku, 4 etykiety stanu, licznik, „Usuń z telefonu” dla „Wymaga uwagi”. EVM-111 dodaje ekran „Pliki zlecenia”, miniatury, przyczyny i „Ponów”, „wysłano n z m” oraz retencję rekordów (7 dni). Decyzja (6) „jeden komponent listy plików” — komponent powstaje tu, EVM-111 go reużywa.

### Decyzje projektowe UX z szkicu (stan)
1. **Opis zdjęcia poza v1** (`CreateMediaAsset.description` niezmienny, seria; RR-96) — **potwierdzone przez Konrada 2026-11-15**.
2. **Stały dolny pasek + arkusz z wyborem zlecenia** — rekomendacja konsultacji, do przeglądu (AC5).
3. **Brak usuwania i odrzucania niewysłanego pliku w v1** (tylko „Usuń z telefonu” dla „Wymaga uwagi”; usuwanie wymaga przerwania sesji i dwóch dialogów) — **potwierdzone przez Konrada 2026-11-15**.
4. **Wybór zlecenia w trybie ukrytych danych po numerach** (zgodnie z § 4.18; ocena security-engineer w recenzji; do czasu recenzji nie rozszerzać numerów w Kolejce poza AC6) — **potwierdzone przez Konrada 2026-11-15**.
5. **Retencja rekordów wysłanych plików 7 dni** — rekomendacja konsultacji, do przeglądu; **przeniesione do EVM-111** (tam powstaje „wysłano n z m”).
6. **Jeden komponent listy plików** — rekomendacja konsultacji, do przeglądu (granica wyżej).

### Decyzje z realizacji (2026-11-15)
- **Akcje dla „Wymaga uwagi” (AC6) — decyzja Konrada:** „Ponów” z EVM-130 zostaje tam, gdzie już jest; „Usuń z telefonu” (z potwierdzeniem) dostają tylko pliki, których nie da się ponowić (`quarantined`, `id_conflict`, `missing_original`).
- **Zakazane grupy w paczce (AC8) — Tech Lead, wariant bezpieczny z konsultacji security, do potwierdzenia przez Konrada w demo:** do czterech grup z AC8 dochodzą `com.google.android.odml` i `androidx.camera.mlkit` (części ML Kit); trafienie w nie też uruchamia warunek zatrzymania.
- **`expo-camera` budowane ze źródeł (AC8) — do potwierdzenia przez Konrada w demo:** gotowy artefakt biblioteki niesie ML Kit i usługi Google w swoim opisie zależności, a przełączniki skanerów działają tylko przy budowie ze źródeł, dlatego `apps/mobile/package.json` ustawia `expo.autolinking.android.buildFromSource: ["expo-camera"]`. Po tym ustawieniu drzewo zależności paczki nie zawiera żadnej zakazanej grupy; biblioteka i kontrole pozostają bez zmian.
- **Progi miejsca (AC4) — Tech Lead:** ostrzeżenie poniżej 2 GB, blokada zdjęcia poniżej 100 MB, jedna stała do korekty po teście terenowym.
- **Wyszukiwanie w wyborze zlecenia (AC5) — Tech Lead:** po numerze i tytule, bez adresu i nazwiska (jak EVM-105); w trybie ukrytych danych wyłącznie po numerze (wymaganie security).
- **„Jedna transakcja” (AC1) — interpretacja potwierdzona przez security:** komenda i wiersz pliku w jednej transakcji lokalnej bazy, plik utrwalony przed nią; przy niepowodzeniu sprzątanie oraz odśmiecacz po zabiciu procesu.
- **Latarka z makiety:** poza wersją 1 (nie ma jej w AC) — propozycja do backlogu.
- Wymagania security przed implementacją (22 punkty, konsultacja 2026-11-15): obowiązują wykonawców wszystkich etapów; ustalenia zmieniające dokumenty trafiają do `threat-model.md`, `requirements.md` i `rodo.md` w etapie 4.

### Kryteria `manual` przekazane do EVM-112 (bez zmian w pliku EVM-112)
30 zdjęć prawdziwym aparatem; kontrast panelu aparatu w słońcu; spust w rękawicy; układ 360 dp i poziomy; monity systemowe aparatu i powiadomień; odmowa trwała i powrót z ustawień; analiza ruchu sieciowego całej sesji (brak usług analitycznych, ML Kit, Firebase); brak zdjęć w galerii telefonu i brak GPS w EXIF zdjęcia z prawdziwego aparatu; TalkBack (ogłoszenie „Zapisano zdjęcie n”), 200% czcionki.

## Notatki techniczne
- Pliki wspólne z innymi historyjkami: `apps/mobile/src/i18n/pl.ts` (nowe klucze w osobnym bloku), `screens/QueueScreen.tsx`, `tools/mobile-apk/src/manifest.mjs` i `verify.mjs`, `tools/mobile-e2e`, numeracja przepływów Maestro (kolejny wolny zakres po 68; 70–79 zajmuje EVM-128).
- „Utwórz ponownie” (EVM-128) przenosi `CreateMediaAsset` generycznie — test EVM-128 należy dopisać po scaleniu tej historyjki.
- Stan pliku w kolejce zapisuje wyłącznie JS (SQLCipher); worker natywny tylko swój plik zadania (EVM-130).
- **Telemetria Google w bibliotece aparatu (AC8, etap 1):** `expo-camera` ma dwa skanery Google (kodów i dokumentów), a właściwości Gradle `expo.camera.*-scanner-enabled=false` (własna wtyczka `plugins/with-camera.ts`) działają tylko przy budowie biblioteki ze źródeł — Expo SDK 58 domyślnie linkuje gotowy artefakt z `local-maven-repo` pakietu z ML Kit i usługami Google w POM-ie. Dlatego `apps/mobile/package.json` wymusza budowę ze źródeł (`expo.autolinking.android.buildFromSource: ["expo-camera"]`). Dowód: drzewo `releaseRuntimeClasspath` bez i z tym ustawieniem (`.scratch/EVM-108/`), kontrola `tools/mobile-apk deps` (drzewo Gradle), `mapping` (R8) i `verify` (manifest, DEX, `META-INF`).

**Uzasadnienie zależności `expo-camera` (SR-SUPPLY-06):**

| Pole | Wartość |
| --- | --- |
| Pakiet i wersja | `expo-camera` **58.0.14** (dokładna, bez zakresu; `bundledNativeModules` SDK 58: `~58.0.11`) |
| Licencja | MIT (bramka licencji CI; zależności npm: `barcode-detector` 3.2.3 i `zxing-wasm` 3.1.6 — MIT, wyłącznie ścieżka web; test w `verify`: brak ich w pakiecie JS) |
| Opiekunowie | Expo (650 Industries), te same konta npm co pozostałe `expo-*` (13 opiekunów, w tym `expo-bot`) |
| Ostatnie wydanie | 2026-10-28 (58.0.14; wydania co 1–2 tygodnie, zgodne z SDK; aktualizacja razem z SDK przez Renovate) |
| Znane CVE | OSV (npm): 0 dla `expo-camera` 58.0.14, `barcode-detector` 3.2.3, `zxing-wasm` 3.1.6 (zapytanie 2026-11-15); `pnpm run scan` (OSV-Scanner) uruchamia orkiestrator |
| Zależności Gradle (z CameraX) | `androidx.camera:*` 1.6.0, `androidx.exifinterface:exifinterface` 1.4.2, `androidx.appcompat:appcompat` 1.7.1 — Google Maven; OSV (Maven): brak wpisów dla `camera-core` 1.6.0 i `exifinterface` 1.4.2 (pokrycie OSV dla Google Maven jest ograniczone — do potwierdzenia przez GitHub Advisory przy przeglądzie) |
| Skrypty instalacyjne | brak; bez nowych wpisów `onlyBuiltDependencies` |
| Wykluczone | ML Kit, Google Play services, Firebase, datatransport, ODML i `androidx.camera:camera-mlkit-vision` (drzewo Gradle, mapping R8, DEX, manifest i `META-INF` — `tools/mobile-apk`) |
| Alternatywa odrzucona | `react-native-vision-camera` (więcej kodu natywnego i worklets; YAGNI), `expo-image-picker` / intencja aparatu systemowego (obca aplikacja dopisuje GPS i kopiuje do galerii) |

## Definition of Done
- [ ] AC1–AC8 pokryte testami oznaczonymi `EVM-108 AC#` (Jest, Maestro na emulatorze z aparatem emulatora, `node:test` dla `verify` i serwera scenariuszy); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzje: code-reviewer, security-engineer (uprawnienia, biblioteka aparatu, telemetria), ux-designer (statycznie: teksty, tokeny, nazwy dostępne, stany) — approve.
- [ ] Makieta 09 / M-06 poprawiona; odstępstwa wpisane do changelogu styleguide'u; kryteria `manual` widoczne w EVM-112; `CHANGELOG.md`.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-14 — `depends_on`: EVM-109 → EVM-130 i EVM-131 po podziale i konsultacjach; dopisano decyzje i wymagania; status `draft`, doprecyzowanie w kolejnej nocy (product-owner)
- 2026-11-15 — doprecyzowanie `/refine`: 8 AC (aparat, zgoda, brak miejsca, wejścia i role, Kolejka — minimum, 30 zdjęć, kontrola paczki), granica z EVM-111, ustalenia konsultacji 2026-11-14, warunek zatrzymania dla telemetrii; pytania do Konrada: opis (RR-96), usuwanie niewysłanego, numery w trybie ukrytym; status `draft` (product-owner)
- 2026-11-15 — akceptacja Konrada (DoR, wg rekomendacji): bez opisu zdjęcia w wersji 1, bez usuwania niewysłanego zdjęcia, w trybie ukrytych danych wybór zlecenia po numerach; pozostałe decyzje wg rekomendacji konsultacji; dystrybucja bez warunku EVM-084; ścieżka `pelna`; **status `ready`** (Tech Lead)
- 2026-11-15 — start realizacji (`/deliver`, ścieżka `pelna`, etapami: AC8 → AC1–AC4 → AC5–AC6 → AC7; gałąź `feature/EVM-108-zdjecia-aparat-i-kolejka`); z tytułu usunięto „opis” (poza wersją 1); **status `in-progress`** (Tech Lead)
- 2026-11-15 — plan gotowy, cztery etapy (mobile-developer)
- 2026-11-15 — etap 1 (AC8) zrealizowany (mobile-developer)
- 2026-11-15 — po etapie 1: scalono `main` (EVM-121, #143) do gałęzi; zapisano decyzje z realizacji (AC6 — decyzja Konrada: „Ponów” zostaje; pozostałe Tech Lead, część do potwierdzenia w demo) (Tech Lead)
- 2026-11-15 — etap 2a (zapis zdjęcia: część natywna, schemat v3, ścieżka zapisu) zrealizowany (mobile-developer)
- 2026-11-15 — etap 2b (ekran aparatu, zgoda, błędy i brak miejsca) zrealizowany (mobile-developer)
- 2026-11-15 — etap 3 (AC5–AC6: wejścia do aparatu, tryb ukrytych danych, pliki w Kolejce) zrealizowany (mobile-developer)
- 2026-11-15 — makieta 09 i changelog styleguide'u poprawione (ux-designer)
- 2026-11-15 — etap 4 (AC7, hak e2e przez ścieżkę aparatu, przepływy Maestro 80–89, dokumenty) zrealizowany (mobile-developer)
- 2026-11-15 — dokumenty bezpieczeństwa uzupełnione: threat-model, requirements, rodo (security-engineer)
- 2026-11-15 — poprawki po przebiegu scenariuszy aparatu na emulatorze i po uwagach security (mobile-developer)
- 2026-11-15 — weryfikacja QA (qa-engineer): PASS z zastrzeżeniem — AC1–AC6 i AC8 spełnione; AC7 bez zielonego przebiegu emulatora `camera-batch-30` po `b3281dec` (w toku), raport: docs/qa/EVM-108/raport-qa.md
