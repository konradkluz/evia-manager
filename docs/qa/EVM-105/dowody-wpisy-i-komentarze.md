# EVM-105 — dowody: wpisy i komentarze offline

Data: 2026-11-14. Historyjka: [EVM-105](../../backlog/M2/EVM-105-mobile-wpisy-i-komentarze-offline.md). Dane i konto syntetyczne (serwer scenariuszy `tools/mobile-e2e`). Stan: testy automatyczne i przebieg na emulatorze wykonane; demo i przegląd wizualny przez Konrada — do wykonania.

## Dowody automatyczne (Jest, `pnpm --filter @evia/mobile run test:coverage`)

Macierz AC → testy z weryfikacji QA (werdykt: pass, AC1–AC6) jest w Dzienniku historyjki. Bramka `pnpm run gate` zielona; pokrycie zmienionego kodu gałęzi po EVM-106: 97,8% linii, 94,5% gałęzi.

## Emulator (Maestro, scenariusz `entries-offline`)

Przebieg: `pnpm --filter @evia/mobile run e2e` z krótkiego klonu, emulator Androida na Windows, 2026-11-14 (końcowy przebieg toru, commit `d2fd3795`).

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `42-entry-sign-in` | pierwsze pobranie | PASS (38,5 s) |
| `42-entry-offline` | tryb samolotowy: wpis z kategorią i listą etapów, pytanie „Odrzucić wpis?” przy zamykaniu z treścią, zapis z toastem „Zapisano w telefonie. Wyślemy, gdy wróci zasięg.”, komentarz, „Czeka na wysłanie” w dzienniku (AC1–AC4) | PASS (74,7 s) |
| `42-entry-restart` | po zabiciu procesu oba elementy nadal czekają w dzienniku (AC5) | PASS (23,2 s) |
| `42-entry-return` | po powrocie sieci kolejka pusta; serwer scenariuszy: 2 unikalne mutacje, 0 duplikatów, 0 odrzuconych | PASS (16,9 s) |
| `42-entry-rejected` | odrzucenie przez serwer: „Wymaga uwagi” z akcjami „Kopiuj treść”, „Dodaj do innego zlecenia”, „Usuń z telefonu”; przeniesienie do innego zlecenia; serwer: 3 unikalne, 0 duplikatów, 1 odrzucona (AC6) | PASS (48,6 s) |

Historia przebiegów tej nocy:

- Przebiegi 1–2: `42-entry-offline` padał na błędach scenariusza (przycisk „Dodaj wpis” pod zgięciem ekranu; krok `hideKeyboard` przy schowanej klawiaturze naciskał Wstecz i ponownie otwierał pytanie o odrzucenie) — poprawione w `d3c125fe`, `4f804793`, `f3805731`.
- Przebieg 3: wpis zapisywał się, ale toast potwierdzenia nie był widoczny w drzewie dostępności Androida — **wada aplikacji**: toast był osadzony w kontenerze o zerowej wysokości. Poprawka `afb6c08c` (nakładka o realnych wymiarach) z testem; od przebiegu 4 PASS, toast widoczny na zrzucie `m04-entry-saved-toast`.

## Poza przebiegiem na emulatorze

- Walidacja (pusta treść, 10 000 / 10 001 znaków) i tryb ukrytych danych są pokryte testami Jest.
- Przepływ nie wybiera etapu z listy (tylko ją otwiera i anuluje) — wybór etapu pokrywają testy Jest.
- Obserwacja do demo: przycisk „Dodaj wpis” jest przy nagłówku sekcji „Dziennik”, pod zgięciem ekranu szczegółów.
