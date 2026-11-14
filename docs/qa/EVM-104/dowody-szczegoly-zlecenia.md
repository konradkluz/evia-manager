# EVM-104 — dowody: szczegóły zlecenia offline

Data: 2026-11-14. Historyjka: [EVM-104](../../backlog/M2/EVM-104-mobile-szczegoly-zlecenia-offline.md). Dane i konto syntetyczne (serwer scenariuszy `tools/mobile-e2e`). Stan: testy automatyczne i przebieg na emulatorze wykonane; demo i przegląd wizualny przez Konrada — do wykonania.

## Dowody automatyczne (Jest, `pnpm --filter @evia/mobile run test:coverage`)

Macierz AC → testy z weryfikacji QA (werdykt: pass, AC1–AC6) jest w Dzienniku historyjki. Bramka `pnpm run gate` zielona; pokrycie zmienionego kodu gałęzi po EVM-106: 97,8% linii, 94,5% gałęzi.

## Emulator (Maestro, scenariusz `order-details-offline`)

Przebieg: `pnpm --filter @evia/mobile run e2e` z krótkiego klonu, emulator Androida na Windows, 2026-11-14 (końcowy przebieg toru, commit `d2fd3795`).

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `41-order-details-sign-in` | pierwsze pobranie danych zlecenia do zaszyfrowanej bazy | PASS (38,6 s) |
| `41-order-details-offline` | tryb samolotowy: nagłówek, klient z „Zadzwoń”, lokalizacja, zakres, etapy ze statusem, dziennik, „Wstecz” wraca do listy (AC1–AC4) | PASS (26,4 s) |

Historia przebiegów tej nocy: w pierwszym przebiegu `41-order-details-offline` padł na asercji statusu etapu pod zgięciem ekranu — błąd scenariusza (brak przewinięcia), poprawiony w `d3c125fe`; aplikacja bez zmian. Od drugiego przebiegu PASS w każdym z sześciu kolejnych.

## Poza przebiegiem na emulatorze

- AC5 (zlecenie niedostępne w trakcie oglądania) i AC6 (tryb ukrytych danych, TalkBack) są pokryte testami Jest; na emulatorze nie były odtwarzane.
- Przegląd wizualny (kontrast, cele dotyku, duża czcionka) i TalkBack na urządzeniu — do demo.
