---
id: EVM-093
title: "Aplikacja: szyfrowana baza lokalna i adapter magazynu"
type: enabler
milestone: M2
epic: E10 Zlecenia offline
status: draft
priority: P0
path: pelna             # dane na urządzeniu, synchronizacja offline
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-091]
---

# EVM-093: Aplikacja — szyfrowana baza lokalna i adapter magazynu

## Cel
Jako **firma** chcemy, aby **dane zleceń i kolejka na telefonie leżały wyłącznie w szyfrowanej bazie**, aby **utrata telefonu nie ujawniała danych klientów** (SR-MOB-01/02/03, ADR-0007: SQLCipher, klucz 256 bit w Keystore). Implementuje porty magazynu `sync-core` (EVM-091).

## Kryteria akceptacji

**AC1 — Szyfrowanie**
- Zakładając świeżą instalację
- Gdy aplikacja tworzy bazę
- Wtedy klucz bazy (256 bit z CSPRNG) jest opakowany nieeksportowalnym kluczem Keystore (AES-GCM; sprzętowym, gdy dostępny — raportowane jako `isInsideSecureHardware`/StrongBox), nie trafia do logów i nie istnieje tryb awaryjny bez szyfrowania; baza używa SQLCipher ≥ 4.6 i `temp_store=MEMORY`, plik jest nieczytelny bez klucza (test na emulatorze), a dane zleceń nie trafiają do `AsyncStorage`, pamięci podręcznej HTTP ani plików niezaszyfrowanych.

**AC2 — Schemat: replika oddzielona od kolejki**
- Zakładając model z `offline-sync.md` (zasada 2)
- Gdy zapisuję dane z serwera i obiekty utworzone na telefonie
- Wtedy replika (usuwalna przy resyncu) i obiekty oczekujące / kolejka (nieusuwalne przez resync) są rozdzielone; migracje schematu lokalnego zachowują kolejkę (test aktualizacji wersji).

**AC3 — Trwałość**
- Zakładając wpisy w kolejce
- Gdy aplikacja zostaje zabita (`force-stop`, `kill -9`) lub telefon restartuje
- Wtedy po starcie kolejka i obiekty oczekujące są nienaruszone (test Maestro na emulatorze).

**AC4 — Kopie zapasowe i uprawnienia**
- Zakładając paczkę release
- Gdy `tools/mobile-apk verify` ją sprawdza
- Wtedy `allowBackup=false` i wykluczenia kopii są ustawione, brak uprawnień do galerii, kontaktów i lokalizacji.

**AC5 — Nieotwieralna baza**
- Zakładając utracony klucz lub uszkodzony plik
- Gdy aplikacja startuje
- Wtedy nie ulega awarii: informuje, że lokalne niewysłane dane są niedostępne, i po zalogowaniu tworzy bazę od nowa (nic nie jest zgadywane po cichu).

**AC6 — Czyszczenie**
- Zakładając wywołanie portu czyszczenia (EVM-101)
- Gdy czyścimy dane firmowe
- Wtedy najpierw zapisywany jest znacznik „czyszczenie w toku”, potem usuwane są: baza i klucz (crypto-shred), sekret instalacji, media i miniatury, kolejka, „Wymaga uwagi”, wpisy secure-store, preferencje i pamięć podręczna raportowania błędów, a zadania natywne anulowane; po zabiciu procesu w trakcie czyszczenie kończy się przy starcie, zanim UI pokaże jakiekolwiek dane; plik nie da się odczytać.

**AC7 — Ukrycie kolejki po `session_revoked` / wylogowaniu**
- Zakładając wylogowanie lub `session_revoked` przy niewysłanych elementach
- Gdy aplikacja usuwa replikę
- Wtedy kolejka, pliki oczekujące, „Wymaga uwagi” i sekret instalacji zostają zaszyfrowane i niewidoczne do pełnego logowania tego samego `userId`; inny użytkownik wymusza czyszczenie (SR-MOB-13).

## Poza zakresem
Pliki mediów i miniatury (E11); ekrany; synchronizacja z API (EVM-107).

## Decyzje i ograniczenia
- Wybór biblioteki SQLCipher dla Expo SDK 58 (development build) — decyzja wykonawcy z uzasadnieniem zależności; wpływ na rozmiar APK zgłosić.
- Klasa dostępu klucza „po pierwszym odblokowaniu” (świadomy kompromis ADR-0007, RR-07 zaakceptowane 2026-10-03): chroni telefon wyłączony lub zrestartowany, nie włączony.
- Bezpieczeństwo i prywatność: wymagania SR-MOB-01/02/03; uprawnienia i kopie zapasowe — AC4.

## Notatki
- Backlog po M2: rozdzielenie kluczy (replika z `setUnlockedDeviceRequired`, kolejka z kluczem „po pierwszym odblokowaniu”) — wymaga własnego kodu Kotlin i dwóch baz.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
