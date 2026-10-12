# Runbook: projekcja listy zleceń — `rebuild` i `verify`

> Dokument żywy (EVM-034). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem SSH do serwera). Wymagania: ADR-0017 (W2, W11), SR-LOG-02, SR-LOG-03, SR-DATA-08.

Lista zleceń (W-10) czyta **projekcję** (schemat `overview`): wiersz na zlecenie i wiersz na oczekiwanie — same identyfikatory, kody, daty i liczniki. Projekcję aktualizuje w tej samej transakcji każda zmiana zlecenia, etapu, lokalizacji i strony. Polecenia poniżej są potrzebne tylko w trzech sytuacjach.

## Kiedy użyć
| Sytuacja | Polecenie | Po co |
|---|---|---|
| Pierwsze wdrożenie EVM-034 na bazie, w której są już zlecenia (migracja `0023` nie robi backfillu) | `rebuild` | wypełnia projekcję wszystkich zleceń |
| Po odtworzeniu bazy z kopii (runbook odtworzenia, EVM-062) | `verify`, a przy rozbieżności `rebuild` | kopia mogła być starsza niż kolumny autoryzacyjne projekcji |
| Alert bezpieczeństwa `projection_authz_drift` albo wynik `verify` z grupą `authorization` | `verify`, potem `rebuild --only <uuid>` | rozjazd kolumny `deleted_at` — zlecenie usunięte mogło być widoczne na liście; sprawdź też, kto zmieniał dane SQL-em |

## Jak uruchomić
Z katalogu aplikacji w kontenerze API (ten sam obraz co serwer HTTP; **bez nasłuchu** — polecenie nie otwiera portu):
```
docker exec <kontener-api> node dist/src/cli/overview.js verify
docker exec <kontener-api> node dist/src/cli/overview.js rebuild
docker exec <kontener-api> node dist/src/cli/overview.js rebuild --only <uuid-zlecenia> [<uuid> …]   # do 100 identyfikatorów
```
- Polecenie działa jako rola aplikacji (`evia_app`: tylko DML), w partiach po 500 zleceń, jedna partia naraz, tymi samymi blokadami co komendy użytkowników — **system może działać**. Partia trzyma blokady wierszy projekcji krócej niż `lock_timeout` 5 s komend (zmierzone w teście wydajności: ok. 0,2 s na partię).
- `rebuild` jest idempotentny: drugie uruchomienie niczego nie zmienia. Zlecenie usunięte trwale w trakcie przebudowy jest pomijane (liczba w raporcie „pominięto”).
- `verify` niczego nie zapisuje w projekcji; przy rozbieżności `deleted_at` dopisuje alert bezpieczeństwa do skrzynki alertów platformy (jak tryb awaryjny z EVM-016).
- Kody wyjścia: `0` — w porządku, `1` — `verify` znalazł rozbieżność, `2` — błędne argumenty.

## Co zobaczysz
Wyłącznie liczby i identyfikatory zleceń (UUID), z podziałem na grupy kolumn: `authorization` (`deleted_at`), `keys` (numer, status, opiekun, klient, lokalizacja, typ obiektu, szablon), `waiting` (oczekiwania), `deadline` (najbliższy termin) oraz `missing` (brak wiersza). Raport nie zawiera dat, nazw ani kwot, a polecenie samo nie zapisuje pliku — wynik jest na standardowym wyjściu (przekierowanie z crona poniżej zapisuje UUID zleceń do logu, który ma mieć ograniczony dostęp). Log (JSON, stderr) ma `traceId` i liczby.

## Czego nie ma
- Brak endpointu HTTP i funkcji w panelu — przebudowa jest poleceniem serwera.
- Nocne zadanie `verify` (pg-boss, metryka `projection_drift_total` z alertem) nie jest uruchamiane — wymaga decyzji Konrada o zależności pg-boss i kontenerze `worker` (zapisane jako otwarta decyzja w historyjce EVM-034). Licznik `projection_drift_total` rośnie tylko w krótkożyjącym procesie polecenia, **nie jest eksportowany** do metryk — jedynym sygnałem jest kod wyjścia `1`, wynik na terminalu i alert bezpieczeństwa dla kolumny `deleted_at`.

## Harmonogram do czasu zadania w `worker`
Operator uruchamia `verify` z crona hosta (raz na dobę, poza godzinami pracy, np. 03:30 czasu `Europe/Warsaw`) i reaguje na kod wyjścia `1`:
```
30 3 * * * docker exec <kontener-api> node dist/src/cli/overview.js verify >> /var/log/evia-overview-verify.log 2>&1 || logger -p user.err "evia overview verify: drift"
```
Plik wyniku zawiera tylko liczby i UUID zleceń (bez danych osobowych). Dodatkowo uruchom `verify` po każdym odtworzeniu bazy z kopii i po podejrzeniu rozjazdu.

## Środowisko lokalne
`pnpm run dev` i `pnpm run dev:seed` wykonują `rebuild` po stronie narzędzia dev (dla aktywnego Administratora), więc istniejąca baza dev nie wymaga ręcznego kroku.
