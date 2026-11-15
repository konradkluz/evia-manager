# EVM-128 — dowody: „Utwórz ponownie” odrzuconego szybkiego zlecenia

Data: 2026-11-15. Historyjka: [EVM-128](../../backlog/M2/EVM-128-mobile-utworz-ponownie-szybkie-zlecenie.md). Dane i konto syntetyczne (serwer scenariuszy `tools/mobile-e2e`). Stan: testy automatyczne i przebieg na emulatorze zielone; układ na 360 dp, TalkBack i czcionka 200% — do sprawdzenia w EVM-112.

## Dowody automatyczne (Jest, `pnpm --filter @evia/mobile run test:coverage`)

Macierz AC → testy z weryfikacji QA (werdykt: pass, AC1–AC5) jest w Dzienniku historyjki. Bramka `pnpm run gate` zielona.

## Emulator (Maestro, scenariusze `quick-order-recreate*`)

Przebieg: `pnpm --filter @evia/mobile run e2e` z krótkiego klonu, emulator Androida 15 (API 35) na Windows, 2026-11-15, końcowy przebieg toru: 71 przepływów, 0 niepowodzeń (paczka z commitu `9f1d3d8b`, przepływy z `541d80dc`).

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `70-recreate-sign-in` | pierwsze pobranie w scenariuszu odrzucenia | PASS (42,0 s) |
| `71-recreate-offline` | zlecenie i wpis utworzone bez sieci | PASS (134,3 s) |
| `72-recreate-rejected` | serwer odrzuca zlecenie; grupa „Wymaga uwagi” z akcją „Utwórz ponownie”; serwer scenariuszy: 0 unikalnych mutacji, 1 odrzucona | PASS (15,8 s) |
| `73-recreate-edit` | formularz z powodem odrzucenia i liczbą zależnych, poprawa danych, zapis, zabicie aplikacji tuż po zapisie (AC1–AC3) | PASS (48,4 s) |
| `74-recreate-restart` | po restarcie nowe zlecenie i przeniesione wpisy nadal czekają (AC3) | PASS (29,6 s) |
| `75-recreate-return` | po powrocie sieci zlecenie dostaje numer; serwer scenariuszy: 2 unikalne mutacje, 0 duplikatów, 1 odrzucona z 3 (AC3) | PASS (17,2 s) |
| `76-recreate-discard-sign-in` | pierwsze pobranie w scenariuszu porzucenia | PASS (41,2 s) |
| `77-recreate-discard` | zamknięcie formularza bez zapisu („Porzucić zmiany?”) nie zmienia kolejki; serwer scenariuszy: 0 unikalnych mutacji (AC4) | PASS (151,9 s) |

Pierwszy przebieg tej nocy: 69 z 71 przepływów zielonych — jedyny błąd dotyczył scenariusza `78` (EVM-102), przepływy 70–77 przeszły od razu.

## Czego nie sprawdzono

- Tryb ukrytych danych (AC5) — tylko testy Jest (wymaga 7 dni bez kontaktu albo braku blokady ekranu).
- Zachowanie na fizycznym telefonie; środowisko `panel.eviacharge.pl` (RR-93).
