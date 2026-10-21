# ADR-0020: Android — upload w tle własnym modułem Expo (Kotlin, UIDT) zamiast biblioteki społeczności

- **Status:** Proponowana (do akceptacji Konrada)
- **Data:** 2026-10-21
- **Decydent:** Konrad (akceptacja) · **Autor:** mobile-developer (spike EVM-011; do recenzji: solution-architect, security-engineer)
- **Powiązane:** EVM-011 (spike, dowody), EVM-009, EVM-005; ADR-0007 (częściowo zmienia: wiersz „Wspólne dla obu” w tabeli zdolności i „Plan wyjścia” (1) — dla Androida), ADR-0009 (doprecyzowania w [`media-pipeline.md`](../media-pipeline.md), bez zmiany decyzji), ADR-0015 (iOS odłożony)

## Kontekst i problem
ADR-0007 zakłada, że upload w tle na Androidzie realizuje biblioteka `@kesha-antonov/react-native-background-downloader` (4.6.3) „lub — jeśli spike wykaże braki — własny moduł Expo”, i wskazuje to jako główne ryzyko (pytanie 12). Strategia z ADR-0007 dla Androida wymaga: jednego zadania systemowego na plik (UIDT na Androidzie 14+), części wysyłanych sekwencyjnie z **zakresów bajtów pliku źródłowego**, odnawiania URL-i w trakcie, trwałości po restarcie telefonu i wznawiania po zabiciu procesu.

Spike EVM-011 sprawdził kod biblioteki (wersja 4.6.3 pobrana z rejestru npm, przegląd źródeł; biblioteki nie uruchamiano) oraz zmierzył własny moduł na emulatorze Androida 15. **Zakres dowodów: tylko Android (emulator API 35); iOS odłożony (ADR-0015), fizyczny telefon niezweryfikowany.**

## Dowody
- **Biblioteka (`Uploader.kt`, 4.6.3):** upload to wątek w procesie (`HttpURLConnection`, `setFixedLengthStreamingMode` dla **całego pliku**); brak zakresów bajtów i multipart S3; „resume” zaczyna **od początku** (kod: „restarts from beginning since HTTP upload resume is not standard”); UIDT (`UIDTDownloadJobService`) i usługa pierwszoplanowa obsługują **wyłącznie pobieranie**; zadanie uploadu nie przeżywa zabicia procesu. Biblioteka ma jednego opiekuna (zgodnie z ADR-0007).
- **Własny moduł (669 linii Kotlin w spike'u):** zadanie UIDT `setPersisted(true)`, pętla części z zakresów pliku, ETag-i po każdej części, ponowienia z backoffem, odnowa URL-a po `403`, SHA-256 strumieniowo. Zmierzone na emulatorze: tryb samolotowy → powrót sieci (3/3 przebiegi), `force-stop` i `kill -9` w trzech punktach (początek, środek, koniec), zabicie dokładnie między `complete` a zapisem stanu, restart emulatora (także z PIN), film 512 MiB, tło 14 min — **0 duplikatów obiektów, 0 osieroconych multipart, SHA-256 zgodne** (liczby w [raporcie](../../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md)).

## Rozważane opcje
1. **A. Biblioteka społeczności** — nie realizuje strategii z ADR-0007 na Androidzie (dowód wyżej); użycie wymagałoby forka lub kontrybucji.
2. **B. Własny moduł Expo (Kotlin)** dla Androida o interfejsie niezależnym od platformy (ten sam, który ma wypełnić iOS) — **działa w spike'u**.
3. **C. Flutter z `background_downloader`** (Plan wyjścia (2) ADR-0007) — przepisanie aplikacji; nie ma uzasadnienia, skoro B działa.

## Decyzja (propozycja)
Dla Androida wybieramy **B**: własny lokalny moduł Expo w Kotlinie (zadanie UIDT na plik, pętla części, SHA-256, trwałe pliki zadań w `noBackupFilesDir`, token zapieczętowany kluczem z Keystore), a w TypeScript — model referencyjny protokołu (`packages/sync-core`) testowany względem prawdziwego S3. Biblioteka społeczności nie jest używana do uploadu na Androidzie. Dla iOS decyzja pozostaje otwarta (ADR-0015); interfejs modułu ma być wspólny.

## Konsekwencje
- **Pozytywne:** zachowanie zmierzone (zadanie wraca po `kill -9` i restarcie samo; wznowienie od brakującej części; brak zależności od jednego opiekuna biblioteki).
- **Negatywne / koszty:** ok. 700 linii Kotlin do utrzymania i testowania; zależność od API Androida (UIDT: planowanie tylko przy widocznej aplikacji; zmiany w Androidzie 16+); `force-stop` kasuje zadania (wznowienie po otwarciu aplikacji — ujęte już w ADR-0007).
- **Ryzyka i mitygacje:** zachowanie na Androidzie ≤ 13 (foreground service `dataSync`) niezweryfikowane — ścieżka zapasowa do sprawdzenia przed M2, jeśli flota ma takie telefony; telefon fizyczny (bateria, Wi-Fi ↔ LTE, producenci agresywnie zabijający procesy) niezweryfikowany — test terenowy z `testing-strategy.md`.

## Plan wyjścia
Jeśli biblioteka społeczności doda upload zakresów z UIDT i będzie utrzymywana — wymiana implementacji za tym samym interfejsem. Jeśli UIDT okaże się zawodny na telefonach floty — WorkManager z foreground service (ADR-0007, Android ≤ 13) za tym samym interfejsem.

## Weryfikacja
Ręczny scenariusz Konrada na fizycznym telefonie (AC5 EVM-011: tryb samolotowy → zdjęcia i film → powrót sieci, zero duplikatów) oraz test terenowy M2 (30 zdjęć, 3 filmy, wymuszone zamknięcie, restart).
