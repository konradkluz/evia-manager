# EVM-107 — dowody E2E Android (Maestro na emulatorze)

Data: 2026-11-02. Historyjka: [EVM-107](../../backlog/M2/EVM-107-mobile-integracja-synchronizacji.md) (AC6, AC4). Środowisko: emulator `sdk_gphone64_x86_64`, Android 15 (API 35), Maestro 2.11.0, build z krótkiego klonu (droga A z `docs/ops/dystrybucja-apk-android.md`), wariant e2e z modułem natywnym `evia-clipboard` (Kotlin skompilowany w `assembleRelease` i wariancie e2e). Bez danych osobowych; konto i dane syntetyczne.

**Wynik: 42 przepływy zielone, 0 powtórek** (`pnpm --filter @evia/mobile run e2e`; pełny build przy commicie `975ef91f`/`8fa1dc0f`, końcowy przebieg `--skip-build` na commicie `37c64dcc` — zmieniły się tylko pliki przepływów Maestro).

## AC6 — scenariusz `sync-offline-recovery`
| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `30-sync-sign-in` | logowanie, pierwsze pobranie (M-12), zasięg | passed |
| `30-sync-offline-add` | tryb samolotowy, 5 wpisów do kolejki, `force-stop` | passed |
| `30-sync-offline-restart` | po zabiciu procesu: „Offline · 5”, 5 elementów „Oczekuje” (odblokowanie blokady aplikacji w wariancie e2e automatyczne) | passed |
| `30-sync-return` | powrót sieci na pierwszym planie, kolejka pusta, „Zsynchr. HH:MM”; serwer scenariuszy: **5 unikalnych, 0 duplikatów z 5** | passed |

## Kotlin `evia-clipboard` (AC4)
Moduł kompiluje się (przy pierwszym buildzie wykryto błąd typu rekurencyjnego — poprawiony), wariant e2e i paczka release powstają i przechodzą `tools/mobile-apk verify`. **Nie wykonano** ręcznej kontroli schowka na urządzeniu (checklista `testing-strategy.md`, punkt 8: oznaczenie wrażliwe, puste po 60 s z aplikacją w tle, wklejenie w innej aplikacji) — brak przepływu Maestro, który wywołałby „Kopiuj treść” na odrzuconym wpisie; **do demo** (Konrad).

## Inne
Raport runnera: 72 żądania z `X-Client-Platform`/`X-Client-Version`, log aplikacji bez adresów i słów „token” (0). Wykryte i naprawione w tym przebiegu: wariant e2e nie przechodził blokady ekranu/aplikacji (emulator bez PIN-u) — domyślne odpowiedzi „ekran zablokowany” i automatyczne odblokowanie tylko w panelu haków e2e; ekran „Zaktualizuj aplikację” był przesłaniany przez M-12 na świeżej instalacji — poprawione w `SyncGate`.
