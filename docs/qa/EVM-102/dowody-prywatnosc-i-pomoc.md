# EVM-102 — dowody: ekran prywatności i pomocy, kontrola telemetrii w paczce

Data: 2026-11-15. Historyjka: [EVM-102](../../backlog/M2/EVM-102-mobile-raportowanie-bledow-i-prywatnosc.md). Dane i konto syntetyczne (serwer scenariuszy `tools/mobile-e2e`). Ścieżka lekka: macierz AC → test zbudował Tech Lead.

## AC → testy

| AC | Testy (`EVM-102 AC#`) | Wynik |
|---|---|---|
| AC1 treść: klauzule, wersja, licencje | Jest `apps/mobile/test/privacy-help.test.tsx` (równość pliku klauzul z panelem, sekcje rozwijane z wersją i datą, wersja z kompilacją, licencje z SQLCipher); Maestro `79` | PASS |
| AC2 wejścia, nakładka, bez zasięgu i bez logowania | Jest `privacy-help.test.tsx`, `session-screens.test.tsx`; Maestro `78` (świeża instalacja w trybie samolotowym, przed logowaniem), `79` (z „Więcej”) | PASS |
| AC3 kontakt bez klienta poczty i bez adresu | Jest `privacy-help.test.tsx`, `expo-config.test.ts`; Maestro `78` („zapytaj przełożonego” w paczce bez adresu) | PASS |
| AC4 informacja o braku raportów awarii | Jest `privacy-help.test.tsx` (dokładny tekst); Maestro `78` | PASS |
| AC5 brak telemetrii w paczce (statycznie) | `node:test` `tools/mobile-apk/test/telemetry.test.mjs`, `verify.test.mjs`; `verify` na paczce release zbudowanej w przebiegu E2E | PASS |
| AC6 podpis odmawia klauzul w stanie projektu | `node:test` `telemetry.test.mjs`, `sign.test.mjs`; Jest `expo-config.test.ts` (na atrapach — klucz podpisu nie był używany) | PASS |

Bramka `pnpm run gate` zielona; pokrycie `tools/mobile-apk/src/telemetry.mjs`: 100% linii, 90,8% gałęzi.

## Emulator (Maestro, scenariusz `privacy-and-help`)

Przebieg: `pnpm --filter @evia/mobile run e2e` z krótkiego klonu, emulator Androida 15 (API 35), 2026-11-15, końcowy przebieg toru: 71 przepływów, 0 niepowodzeń.

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `78-privacy-before-sign-in` | M-11 przed zalogowaniem i bez sieci: kontakt z konfiguracji (brak → „zapytaj przełożonego”), bez „Ostatniej synchronizacji”, tekst o braku raportów awarii, licencje, „Wstecz” wraca do logowania | PASS (63,0 s) |
| `79-privacy-more` | M-11 z „Więcej” po zalogowaniu: „Prywatność” i „Pomoc” otwierają ten sam ekran, wersja i ostatnia synchronizacja | PASS (65,7 s) |

W pierwszym przebiegu `78` nie przeszedł z winy scenariusza (szukał kontaktu bez przewinięcia do sekcji „Pomoc”, która leży nad sekcją startową wejścia „Prywatność”); poprawka scenariusza w `541d80dc`, aplikacja bez zmian.

Paczka release zbudowana w tym samym przebiegu (niedebugowalna, klucz debug szablonu, tylko w `.scratch`) przeszła `tools/mobile-apk verify` z nową kontrolą telemetrii i hostów.

## Czego nie sprawdzono

- Otwarcia klienta poczty i wybierania numeru na urządzeniu (paczka testowa nie ma kontaktu w konfiguracji) — testy Jest.
- Podpisu prawdziwym kluczem (agenci go nie używają) — odmowa `sign` sprawdzona na atrapach.
- TalkBack: treść ekranu pod nakładką M-11 pozostaje w drzewie dostępności — do sprawdzenia w EVM-112.
- Środowisko `panel.eviacharge.pl` (RR-93).
