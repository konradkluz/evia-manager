# Alarm o czerwonej publikacji na `main` — `tools/publish-watch/`

EVM-153 AC4b. Krok joba `publish-watch` w `.github/workflows/nightly.yml` (jedyny job z `actions: read`; `GITHUB_TOKEN` tylko w env tego kroku). Działa bez instalacji zależności (wbudowany `fetch`).

- Bierze ostatni zakończony przebieg `ci.yml` (`push`, `main`), w którym `publish` lub `publish-infra` się wykonał (wynik inny niż `skipped`); czerwony wynik, gdy któryś wykonany job nie jest `success`. Pominięte przebiegi i zielone nie dają alarmu.
- Joby czytane przez `filter=latest` (ponowne próby zastępują wcześniejsze), nazwy dopasowywane dokładnie, pełna paginacja. Brak joba na liście (np. zmieniona nazwa) = czerwony.
- **Fail-closed:** błąd API (403, 429, 5xx), nieczytelna odpowiedź, brak przebiegu z wykonaną publikacją, nieznany wynik — exit 1.
- Komunikat zawiera tylko nazwę joba, numer i adres przebiegu, SHA commita i wiek awarii w dniach (od najstarszego przebiegu nieprzerwanej serii niepowodzeń) — nigdy autora, e-maila ani treści commita (repozytorium publiczne). Host API z `GITHUB_API_URL`, repozytorium z `GITHUB_REPOSITORY` (format sprawdzany), bez wejścia od użytkownika.
- E-mail do właściciela: standardowe powiadomienie GitHub o nieudanym zaplanowanym przebiegu (linia `cron` w `nightly.yml` bez zmian — powiadomienie trafia do osoby, która ją ostatnio zmieniła); bez nowych sekretów.
- Testy (atrapa API, dane syntetyczne): `pnpm --filter @evia/publish-watch run test:coverage` (próg 90%, znakowane `EVM-153 AC4b`).
