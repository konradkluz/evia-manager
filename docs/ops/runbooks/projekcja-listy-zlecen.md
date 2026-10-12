# Runbook: projekcja listy zleceń — `rebuild` i `verify`

> Dokument żywy (EVM-034). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem SSH do serwera). Wymagania: ADR-0017 (W2, W11), SR-LOG-02, SR-LOG-03, SR-DATA-08.

Lista zleceń (W-10) czyta **projekcję** (schemat `overview`): wiersz na zlecenie i wiersz na oczekiwanie — same identyfikatory, kody, daty i liczniki. Projekcję aktualizuje w tej samej transakcji każda zmiana zlecenia, etapu, lokalizacji i strony. Polecenia poniżej są potrzebne tylko w trzech sytuacjach.

## Kiedy użyć
| Sytuacja | Polecenie | Po co |
|---|---|---|
| Pierwsze wdrożenie EVM-034 na bazie, w której są już zlecenia (migracja `0023` nie robi backfillu) | `rebuild` | wypełnia projekcję wszystkich zleceń |
| Po odtworzeniu bazy z kopii (runbook odtworzenia, EVM-062) | `verify`, a przy rozbieżności `rebuild` | kopia mogła być starsza niż kolumny autoryzacyjne projekcji |
| Alert bezpieczeństwa `projection_authz_drift` albo wynik `verify` (polecenie lub nocne zadanie) z grupą `authorization` | `verify`, potem `rebuild --only <uuid>` | rozjazd kolumny `deleted_at` — zlecenie usunięte mogło być widoczne na liście; sprawdź też, kto zmieniał dane SQL-em |

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

## Nocne zadanie w workerze
Od kroku 9 EVM-034 `verify` uruchamia się samo: zadanie `overview.verify-projection` (kolejka pg-boss, schemat `pgboss`) o **03:30 czasu `Europe/Warsaw`** w procesie `worker` (ten sam obraz co API, polecenie `node dist/src/worker.js`, bez portu i bez migracji). Godzina omija lukę i powtórzenie godziny 02:00–03:00 przy zmianie czasu — zadanie wykonuje się raz na dobę, także w dniach zmiany czasu. Przy kilku procesach `worker` harmonogram tworzy jedno wykonanie.
- **Rozjazd to wynik, nie błąd:** zadanie kończy się sukcesem i zostawia wpis w logu workera `projection verify: drift found` (poziom `warn`) ze stałymi polami `metric: "projection_drift_total"`, `value` (liczba zleceń z rozjazdem w tym przebiegu), `traceId` oraz liczbami po grupach. Rozjazd kolumny `deleted_at` dodatkowo daje alert bezpieczeństwa `projection_authz_drift` w skrzynce alertów (jak w poleceniu `verify`).
- **Awaria** (baza niedostępna, przekroczony limit czasu) kończy zadanie błędem o stałym kodzie `projection_verify_failed`; kolejka ponawia je 2 razy (co 60 s), potem zadanie trafia do kolejki martwych listów `overview.verify-projection.dead-letter`. W logu jest tylko rodzaj błędu i kod SQLSTATE — bez SQL, parametrów i danych. Ponowienie jest bezpieczne (`verify` nic nie zapisuje w projekcji); przy awarii po zapisie alertu `projection_authz_drift` ten sam alert może się powtórzyć (co najmniej raz).
- Zadania w kolejce niosą wyłącznie identyfikatory (UUID) i liczby, bez danych osobowych; zakończone zadania są usuwane po 7 dniach. Tabele kolejki są zapisywalne tylko dla roli aplikacji (`evia_app`), rola tylko do odczytu nie ma do nich dostępu.

### Jak sprawdzić ostatni przebieg
Zapytaniem jako rola z dostępem do schematu `pgboss` (administrator bazy lub `evia_app`):
```
select name, cron, timezone from pgboss.schedule where name = 'overview.verify-projection';
select state, completed_on, output from pgboss.job
  where name = 'overview.verify-projection' and state = 'completed' order by completed_on desc limit 1;
```
`output` to liczby (`checked`, `inSync`, `missing`, `differing`, `authz`). Brak przebiegu z ostatniej doby oznacza, że `worker` nie działa (sprawdź kontener i jego log) albo baza była niedostępna o 03:30. Zadania w stanie `failed` i wpisy w kolejce `overview.verify-projection.dead-letter` to nieudane przebiegi.

### Ograniczenia (stan na EVM-034)
- Eksporter metryk (Prometheus/OpenTelemetry) przychodzi w EVM-007: **dziś** `projection_drift_total` to licznik w procesie i stały wpis w logu workera; reguła alertu na ten wpis powstaje w EVM-007.
- Alert `projection_authz_drift` dociera przez skrzynkę alertów, którą emituje **proces API** — wymaga działającego API (worker nie emituje alertów).
- Log workera musi trafiać do kolektora logów (wymaganie dla EVM-007 i wdrożenia EVM-076); bez tego wpis `drift found` nie wywoła alertu.
- **Brak przebiegu nie jest dziś alarmowany** (alarm przy braku udanego przebiegu powyżej 26 h — EVM-007); do tego czasu sprawdzaj ostatni przebieg zapytaniem powyżej.
- Wdrożenie workera na staging i produkcję (obraz, usługa) — EVM-076; lokalnie usługa `worker` w `compose.dev.yaml`. Kolejkę `email`, politykę ponowień i kolejki martwych listów per kolejka, transakcyjne `send` oraz healthcheck workera wprowadza EVM-024.
- **Aktualizacja pg-boss wymaga migracji schematu `pgboss`.** Test integracyjny „wersja schematu = wersja pakietu” czerwienieje po podniesieniu wersji pakietu (np. przez Renovate), dopóki nie powstanie nowa migracja z `getMigrationPlans`; nie scalaj podniesienia bez niej.

## Zapas: harmonogram operatora
Gdy `worker` nie działa (awaria, brak wdrożenia), operator może uruchomić `verify` z crona hosta (raz na dobę, poza godzinami pracy) i reagować na kod wyjścia `1` — to zapas, nie podstawowa kontrola:
```
30 3 * * * docker exec <kontener-api> node dist/src/cli/overview.js verify >> /var/log/evia-overview-verify.log 2>&1 || logger -p user.err "evia overview verify: drift"
```
Plik wyniku zawiera tylko liczby i UUID zleceń (bez danych osobowych). Nie uruchamiaj obu naraz o tej samej porze (zbędne obciążenie, podwójny alert). Dodatkowo uruchom `verify` po każdym odtworzeniu bazy z kopii i po podejrzeniu rozjazdu.

## Czego nie ma
- Brak endpointu HTTP i funkcji w panelu — przebudowa jest poleceniem serwera.

## Środowisko lokalne
`pnpm run dev` i `pnpm run dev:seed` wykonują `rebuild` po stronie narzędzia dev (dla aktywnego Administratora), więc istniejąca baza dev nie wymaga ręcznego kroku.
