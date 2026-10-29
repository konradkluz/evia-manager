---
id: EVM-093
title: "Aplikacja: szyfrowana baza lokalna i adapter magazynu"
type: enabler
milestone: M2
epic: E10 Zlecenia offline
status: ready
priority: P0
path: pelna             # dane na urządzeniu, synchronizacja offline, migracje
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: opus             # kryteria workflow.md: synchronizacja offline + migracje danych + kryptografia na urządzeniu; błąd = utrata niewysłanych danych albo wyciek (uzasadnienie w „Decyzjach”)
depends_on: [EVM-091, EVM-092]
---

# EVM-093: Aplikacja — szyfrowana baza lokalna i adapter magazynu

## Cel
Jako **firma** chcemy, aby **dane zleceń i kolejka na telefonie leżały wyłącznie w szyfrowanej bazie, a niewysłana praca technika nigdy nie ginęła po cichu**, aby **utrata telefonu nie ujawniała danych klientów, a aktualizacja aplikacji, awaria klucza czy zmiana użytkownika nie kasowały pracy w terenie** (SR-MOB-01/02/03/04/13, ADR-0007: SQLCipher, klucz 256 bit w Keystore). Implementuje porty magazynu `sync-core`: `QueueStore` (EVM-091) i magazyn repliki (EVM-092) oraz port czyszczenia dla EVM-101. Baza istnieje tylko dla zalogowanego Administratora lub Edytora — Tylko odczyt nie ma aplikacji (SR-AUTHZ-06), a niezalogowany nie powoduje utworzenia ani odczytu bazy.

## Kryteria akceptacji

**AC1 — Szyfrowanie i klucz**
- Zakładając świeżą instalację i pierwsze udane pełne logowanie
- Gdy aplikacja tworzy bazę
- Wtedy klucz bazy (256 bit z CSPRNG) jest opakowany nieeksportowalnym kluczem Keystore (AES-GCM, bez `setUserAuthenticationRequired`; sprzętowym, gdy dostępny — fakt `isInsideSecureHardware`/StrongBox raportowany diagnostycznie, ale jego brak, np. na emulatorze, niczego nie blokuje), nie trafia do logów, telemetrii ani komunikatów błędów, a trybu awaryjnego bez szyfrowania nie ma (brak klucza = brak bazy); baza używa SQLCipher ≥ 4.6 z `temp_store=MEMORY`, a dane zleceń nie trafiają do `AsyncStorage`, pamięci podręcznej HTTP ani plików niezaszyfrowanych. Dowód na emulatorze (wariant e2e, `run-as`): plik bazy nie zaczyna się od nagłówka `SQLite format 3`, a znacznik syntetyczny (np. `EVM093-SENTINEL`) zapisany w kolejce nie występuje w żadnym pliku katalogu aplikacji.

**AC2 — Schemat: replika oddzielona od kolejki, migracje**
- Zakładając model z `offline-sync.md` (zasada 2) i wersjonowany schemat lokalny
- Gdy zapisuję dane z serwera i obiekty utworzone na telefonie oraz gdy aplikacja startuje z bazą w starszej, tej samej albo nowszej wersji schematu
- Wtedy replika (usuwalna i odbudowywana przy resyncu, także podmianą „w cieniu” z EVM-092) i kolejka z obiektami oczekującymi oraz „Wymaga uwagi” (nieusuwalne przez resync i migrację) są rozdzielone; migracje są rosnące, każda w jednej transakcji, a migracja repliki może ją porzucić i zażądać resyncu, ale **nigdy** nie traci ani nie przestawia kolejki; test: baza w wersji N−1 z 120 wpisami syntetycznymi po migracji ma identyczną kolejkę (kolejność, `mutation_id`, właściciel); migracja przerwana w połowie (wstrzyknięty błąd) cofa się i baza otwiera się dalej w wersji N−1; baza nowsza niż aplikacja (downgrade) nie jest modyfikowana, a aplikacja zgłasza stan „wymagana aktualizacja” (SR-MOB-09, kolejka nietknięta).

**AC3 — Adapter magazynu i trwałość**
- Zakładając zestaw testów portu `QueueStore` z `packages/sync-core` (EVM-091) i analogiczny dla magazynu repliki (EVM-092)
- Gdy uruchamiam go na adapterze oraz zabijam proces (`adb shell am force-stop`, `kill -9`) albo restartuję emulator
- Wtedy adapter przechodzi cały zestaw (w tym atomowość `settle`: po wstrzykniętym błędzie w transakcji mutacja jest albo w kolejce, albo rozliczona — nigdy w obu miejscach ani w żadnym), wynik `append`/`update`/`settle` rozwiązuje się dopiero po trwałym zapisie, a po starcie kolejka i obiekty oczekujące są nienaruszone (dowód: Maestro na emulatorze z 20 wpisami w kolejce, w tym jednym po `force-stop` zaraz po zapisie); odczyty z magazynu zwracają dane niezwalidowane, a walidację schematem wykonuje rdzeń (SR-MOB-10).

**AC4 — Kopie zapasowe i uprawnienia**
- Zakładając paczkę release
- Gdy `tools/mobile-apk verify` ją sprawdza, a na emulatorze (wariant e2e) uruchamiam `adb backup` i kopię z Auto Backup (`bmgr`)
- Wtedy `allowBackup=false` i reguły wykluczeń (`dataExtractionRules`, `fullBackupContent`) są ustawione, kopia nie zawiera bazy ani wpisów magazynu kluczy, a manifest nie deklaruje uprawnień do galerii (`READ_MEDIA_*`, `READ/WRITE_EXTERNAL_STORAGE`), kontaktów ani lokalizacji (`ACCESS_*_LOCATION`); każde odstępstwo daje kod wyjścia ≠ 0 weryfikatora.

**AC5 — Baza nieotwieralna (utrata klucza, uszkodzenie)**
- Zakładając brak klucza przy istniejącym pliku bazy, klucz niepasujący do bazy (np. unieważniony w Keystore, przywrócenie na innym telefonie) albo uszkodzony plik
- Gdy aplikacja startuje
- Wtedy nie ulega awarii ani nie próbuje zgadywać: rozróżnia przyczynę (`key_missing`, `key_invalid`, `file_corrupt`; bez klucza i bez pliku to zwykła świeża instalacja), a po zalogowaniu pokazuje jeden blokujący komunikat: „Dane zapisane na tym telefonie, które nie zostały wysłane, są niedostępne. Dane zleceń pobierzemy ponownie.” z jedną akcją „Rozumiem”; dopiero po niej usuwa stary plik, tworzy nowy klucz i bazę od nowa i uruchamia pierwsze pobranie; sekret instalacji z utraconego magazynu kluczy oznacza nowe urządzenie (nowe `deviceId`, SR-MOB-04); zdarzenie diagnostyczne zawiera tylko kod przyczyny, bez liczby, treści i ścieżek. Test na emulatorze: usunięcie wpisu klucza i uszkodzenie pliku przez `run-as` w wariancie e2e (dwa scenariusze Maestro), przyczyny dodatkowo w testach jednostkowych adaptera.

**AC6 — Czyszczenie danych firmowych (port dla EVM-101)**
- Zakładając wywołanie portu czyszczenia (EVM-101: „Wyczyść dane firmowe”, `device_wipe_required`, inny użytkownik)
- Gdy czyszczę dane firmowe
- Wtedy najpierw zapisywany jest znacznik „czyszczenie w toku” (poza bazą, bez danych), potem w tej kolejności: klucz bazy (crypto-shred), plik bazy i pliki pomocnicze (`-wal`, `-shm`, `-journal`), sekret instalacji, wpisy secure-store, preferencje, pamięć podręczna raportowania błędów, a na końcu zarejestrowane kroki dodatkowe (media, miniatury i zadania natywne anulowane — podpina je E11/EVM-109 przez ten sam port; do tego czasu brak kroków nie jest błędem); każdy krok jest idempotentny, błąd kroku zostawia znacznik i jest ponawiany przy każdym starcie z komunikatem „Kończymy czyszczenie…”; po zabiciu procesu w dowolnym kroku (test z wstrzykniętą awarią po każdym kroku) czyszczenie kończy się przy starcie, zanim UI pokaże jakiekolwiek dane; po zakończeniu znacznik znika, a odtworzenie bazy ze starego pliku jest niemożliwe (test: kopia pliku sprzed czyszczenia nie otwiera się nowym kluczem).

**AC7 — Właściciel kolejki: wylogowanie, `session_revoked`, zmiana użytkownika**
- Zakładając niewysłane elementy w kolejce oraz wylogowanie, `session_revoked` albo logowanie innego użytkownika
- Gdy aplikacja usuwa replikę lub startuje po przerwaniu tej operacji
- Wtedy replika jest usunięta atomowo (po zabiciu procesu w trakcie: po starcie jest albo cała, albo wcale), a kolejka, pliki oczekujące, „Wymaga uwagi” i sekret instalacji zostają zaszyfrowane; magazyn zapisuje `userId` właściciela i udostępnia zawartość kolejki tylko po jawnym odblokowaniu tym samym `userId` po pełnym logowaniu; dla innego `userId` odmawia odczytu zawartości (`owner_mismatch`), podaje wyłącznie liczbę niewysłanych elementów (do ostrzeżenia EVM-101 AC5) i pozwala tylko na czyszczenie z AC6 (SR-MOB-13); test: kolejka z 5 elementami użytkownika A, logowanie użytkownika B → odmowa odczytu i liczba 5, po czyszczeniu B startuje z pustą bazą i nowym `deviceId`.

## Poza zakresem
Pliki mediów, miniatury i kolejka uploadu (E11, EVM-109 — podpinają się do portu czyszczenia z AC6); ekrany i teksty poza komunikatem z AC5 (ekrany stanów: EVM-100/101, listy: EVM-103/107); synchronizacja z API i wiring silnika (EVM-107); blokada ekranu, 7 dni offline i blokada aplikacji (EVM-101); rozdzielenie kluczy repliki i kolejki; dostęp do bazy z procesu natywnego (zadania w tle — EVM-109); iOS (ADR-0015); ekran licencji open source z notą SQLCipher (E14).

## Decyzje i ograniczenia
- **Model `opus`:** historyjka spełnia kryteria z `workflow.md` → „Modele i effort agentów” (synchronizacja offline, migracje danych, nowy wzorzec natywny); błędy skutkują utratą niewysłanych danych klientów albo wyciekiem, a dowód wymaga emulatora, więc poprawki na `sonnet` kosztowałyby więcej rund. Przegląd security zostaje przy `security-engineer`. Konrad zatwierdza razem z AC.
- Wybór biblioteki SQLCipher dla Expo SDK 58 / RN 0.88 (development build) — decyzja wykonawcy z uzasadnieniem zależności (licencja, utrzymanie, SR-SUPPLY-06, dokładna wersja); wpływ na rozmiar APK zgłosić w raporcie.
- Klasa dostępu klucza „po pierwszym odblokowaniu” (świadomy kompromis ADR-0007, RR-07 zaakceptowane 2026-10-03): chroni telefon wyłączony lub zrestartowany, nie włączony.
- **Testowalność (ADR-0015):** logika adaptera (SQL, migracje, transakcje, maszyna stanów otwarcia i czyszczenia) w Jest natywnie na Windows, z natywną powłoką za cienkim interfejsem; szyfrowanie, Keystore, trwałość po zabiciu procesu, kopie zapasowe i scenariusze AC5/AC6 — wyłącznie na emulatorze (Maestro, wariant e2e `debuggable`, wersja API w raporcie, `Medium_Phone_API_35`). Haki testowe (uszkodzenie pliku, usunięcie klucza) istnieją tylko w wariancie e2e, a `tools/mobile-apk verify` potwierdza ich brak w release. Część natywna poza progiem Jest wymaga wpisu w `packages/config/coverage-exclusions.json` z uzasadnieniem.
- Testy oznaczone `EVM-093 AC#`; zestawy testów portów pochodzą z `packages/sync-core` (adapter ich nie osłabia). Jest w `apps/mobile` musi transformować `@evia/sync-core` (uwaga z EVM-107).
- Bezpieczeństwo i prywatność: wymagania SR-MOB-01/02/03/04/13, SR-LOG (brak danych osobowych i kluczy w logach); TM-01, TM-04; uprawnienia i kopie zapasowe — AC4. Komunikat AC5 i brak liczby w diagnostyce świadomie nie ujawniają zawartości.
- **Przed `ready`:** (1) potwierdzenie Konrada, że po utracie klucza (AC5) dane niewysłane są bezpowrotnie tracone z komunikatem (bez odzyskiwania); (2) uwaga dla architekta: dostęp do tej samej bazy z procesu natywnego zadań w tle (EVM-109) może zmienić model otwarcia (jedno połączenie vs blokada między procesami) — nie blokuje 093, ale kształt portu otwarcia nie może tego uniemożliwiać.

## Notatki
- Backlog po M2: rozdzielenie kluczy (replika z `setUnlockedDeviceRequired`, kolejka z kluczem „po pierwszym odblokowaniu”) — wymaga własnego kodu Kotlin i dwóch baz.
- Zależność od EVM-092 dotyczy portu magazynu repliki; port `QueueStore` (EVM-091) jest scalony i można zacząć od AC1–AC5.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-10-29 — doprecyzowanie do DoR: migracje i downgrade schematu, utrata klucza z komunikatem, właściciel kolejki, kroki czyszczenia i testowalność na emulatorze, zależność od EVM-092, model `opus` do zatwierdzenia (product-owner)
- 2026-10-29 — zaakceptowano przez Konrada: AC1–7; utrata klucza = niewysłane dane przepadają (crypto-shred); model opus; zależność od EVM-092; status ready
