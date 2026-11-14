# EVM-106 — dowody: szybkie zlecenie z telefonu

Data: 2026-11-14. Historyjka: [EVM-106](../../backlog/M2/EVM-106-mobile-szybkie-zlecenie.md). Dane i konto syntetyczne (serwer scenariuszy `tools/mobile-e2e`). Stan: testy automatyczne i przebieg na emulatorze wykonane; demo i przegląd wizualny przez Konrada — do wykonania.

## Dowody automatyczne (Jest, `pnpm --filter @evia/mobile run test:coverage`)

Macierz AC → testy z weryfikacji QA (werdykt: pass, AC1–AC6) jest w Dzienniku historyjki. Bramka `pnpm run gate` zielona; pokrycie zmienionego kodu gałęzi: 97,8% linii, 94,5% gałęzi.

## Emulator (Maestro, scenariusze `quick-order-*`)

Przebieg: `pnpm --filter @evia/mobile run e2e` z krótkiego klonu, emulator Androida na Windows, 2026-11-14 (końcowy przebieg toru, commit `d2fd3795`).

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `43-quick-order-sign-in` | po pierwszej synchronizacji szablony są w telefonie (AC1) | PASS (53,4 s) |
| `43-quick-order-offline` | tryb samolotowy: nowy klient, nowa lokalizacja, szablon dopasowany do typu obiektu, notatka, zapis; szczegóły „Oczekuje na numer”; wpis do nowego zlecenia „Wyślemy po utworzeniu zlecenia” (AC2) | PASS (123,2 s) |
| `43-quick-order-restart` | po zabiciu procesu zlecenie i wpis nadal czekają (AC2) | PASS (23,1 s) |
| `43-quick-order-return` | po powrocie sieci zlecenie dostaje numer, kolejka pusta; serwer scenariuszy: 2 unikalne mutacje, 0 duplikatów, 0 odrzuconych (AC4) | PASS (21,0 s) |
| `43-quick-order-rejected-sign-in` | pierwsze pobranie w scenariuszu odrzucenia | PASS (38,5 s) |
| `43-quick-order-rejected-offline` | zlecenie i wpis utworzone bez sieci | PASS (118,2 s) |
| `43-quick-order-rejected-return` | serwer odrzuca zlecenie (`quota_exceeded`): jedna grupa „Wymaga uwagi” z liczbą zależnych, „Utwórz ponownie”, „Usuń z telefonu” z oknem wymieniającym zależne; po usunięciu kolejka pusta; serwer: 0 unikalnych, 0 duplikatów, 1 odrzucona (AC5) | PASS (21,1 s) |
| `43-quick-order-no-templates` | brak szablonów: komunikat „Brak szablonów w telefonie. Połącz się z internetem, aby je pobrać.”, „Zapisz zlecenie” niedostępne (AC1) | PASS (52,3 s) |
| `43-quick-order-forbidden` | serwer odpowiada na listę szablonów `403 channel_not_allowed` (Tylko odczyt z tokenem telefonu) → ekran „Aplikacja jest niedostępna dla Twojej roli”, nic nie jest usuwane z telefonu (AC1) | PASS (39,4 s) |

Historia końcowych przebiegów (wszystkie niepowodzenia to błędy scenariuszy, aplikacja bez zmian):

- Przebieg 1: 55 zaliczonych, 3 niezaliczone, 3 pominięte — karta szablonu liczyła się jako widoczna pod przyklejonym paskiem „Zapisz zlecenie”; jedna asercja dotyczyła tekstu przewiniętego poza ekran. Poprawka `4285b15f`.
- Przebieg 2: 60 zaliczonych, 1 niezaliczony — po usunięciu odrzuconego zlecenia kolejka pokazuje stan pusty „Nic nie czeka na wysłanie.”, a scenariusz czekał na „0 elementów w kolejce”. Poprawka `d2fd3795`.
- Przebieg 3: wszystkie przepływy `41-*`, `42-*`, `43-*` zaliczone; łącznie 60 zaliczonych, 1 niezaliczony — `21-login-rate-limited` (aplikacja nie uruchomiła się po `clearState`, na zrzucie ekran główny emulatora). Ten przepływ nie dotyczy zmian toru i przeszedł w dwóch poprzednich przebiegach na tym samym kodzie aplikacji; uznany za niestabilność emulatora, nie powtarzano całego przebiegu czwarty raz.

## Poza przebiegiem na emulatorze

- Walidacja i podpowiedź podobnego klienta (AC3) oraz tryb ukrytych danych (AC6) są pokryte testami Jest; na emulatorze nie były odtwarzane.
- Przegląd wizualny formularza (kontrast, ucinanie tekstu w kartach szablonów, duża czcionka) i TalkBack na urządzeniu — do demo.
- Obserwacja do demo: w szczegółach zlecenia „Oczekuje na numer” ten sam tekst „Zapisano w telefonie. Numer nadamy po synchronizacji.” widać jednocześnie w banerze i w toaście.
