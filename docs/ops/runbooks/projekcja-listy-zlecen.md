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
Wyłącznie liczby i identyfikatory zleceń (UUID), z podziałem na grupy kolumn: `authorization` (`deleted_at`), `keys` (numer, status, opiekun, klient, lokalizacja, typ obiektu, szablon), `waiting` (oczekiwania), `deadline` (najbliższy termin) oraz `missing` (brak wiersza). Raport nie zawiera dat, nazw ani kwot, a polecenie nie zapisuje pliku z identyfikatorami — wynik jest tylko na standardowym wyjściu terminala. Log (JSON, stderr) ma `traceId` i liczby.

## Czego nie ma
- Brak endpointu HTTP i funkcji w panelu — przebudowa jest poleceniem serwera.
- Nocne zadanie `verify` (pg-boss, metryka `projection_drift_total`) nie jest jeszcze uruchamiane — to osobny krok EVM-034 po decyzji o zależności i kontenerze `worker`. Do tego czasu `verify` uruchamia operator po każdym odtworzeniu bazy z kopii i po podejrzeniu rozjazdu.
