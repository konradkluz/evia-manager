# ADR-0010: Zadania w tle — pg-boss na PostgreSQL, osobny proces `worker`

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-007; ADR-0001, ADR-0003, ADR-0008, ADR-0009, ADR-0013

## Kontekst i problem
System potrzebuje pracy asynchronicznej: skan AV i przetwarzanie mediów (ADR-0009), e-maile (zaproszenia, reset, powiadomienia), eksporty ZIP, backfille migracji (ADR-0003), zadania cykliczne (uzgadnianie storage'u, czyszczenie, później przypomnienia w M3) oraz zdarzenia domenowe między modułami (outbox, ADR-0001). Zlecenie zadania musi być **atomowe ze zmianą w bazie** (bez „zgubionych” zdarzeń). Budżet i prostota przemawiają za brakiem dodatkowych usług.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Brak dodatkowych komponentów, koszt | 5 | jedna VM, mały narzut |
| Transakcyjne zlecanie zadań (outbox w tej samej transakcji) | 5 | spójność, „nic nie ginie” |
| Niezawodność: ponowienia z backoffem, kolejka martwych zadań, deduplikacja | 4 | media, e-maile |
| Zadania cykliczne (cron) | 3 | czyszczenie, uzgadnianie, przypomnienia |
| Obserwowalność (stan kolejek, opóźnienia) | 3 | alerty |
| Utrzymanie i licencja | 3 | ASVS V15 |

## Rozważane opcje
1. **A. pg-boss 12** — kolejka w PostgreSQL (`SKIP LOCKED`), ponowienia, DLQ, cron, deduplikacja (singleton keys).
2. **B. Graphile Worker 0.18** — kolejka w PostgreSQL z `LISTEN/NOTIFY`, bardzo wydajna.
3. **C. BullMQ 6 + Valkey/Redis** — dojrzała kolejka na osobnym magazynie in-memory.
4. **D. Zarządzana kolejka dostawcy** (np. Scaleway Queues, zgodna z SQS).

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Brak dodatkowych komponentów (5) | 5 | 5 | 2 | 3 |
| Transakcyjne zlecanie (5) | 5 | 5 | 2 | 1 |
| Niezawodność (4) | 5 | 4 | 5 | 4 |
| Zadania cykliczne (3) | 5 | 4 | 5 | 2 |
| Obserwowalność (3) | 4 | 3 | 5 | 3 |
| Utrzymanie i licencja (3) | 5 | 4 | 5 | 3 |
| **Suma ważona (maks. 115)** | **112** | **99** | **85** | **60** |

Uwagi: A i B są bliskie; A ma wbudowane DLQ, cron i deduplikację oraz bardzo aktywne utrzymanie (12.35.1 z 2026-09-30), B jest przed 1.0 z rzadszymi wydaniami. C wymaga dodatkowego magazynu (Valkey 9.1) do zabezpieczenia, backupu i monitorowania, a zlecenie zadania nie jest atomowe z transakcją bazy. D wiąże z dostawcą i też nie jest transakcyjne. Wersje i licencje zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. pg-boss** w osobnym schemacie bazy, obsługiwany przez proces **`worker`** (ten sam obraz co `api`, inny punkt wejścia; ADR-0001). API tylko zleca zadania — w **tej samej transakcji** co zmiana domenowa (outbox).
- **Ładunki zadań zawierają wyłącznie identyfikatory** (np. `{ mediaAssetId }`, `{ exportId }`) — **bez danych osobowych**; worker pobiera dane z bazy z bieżącymi uprawnieniami/stanem (security-engineer). Dzięki temu dane osobowe nie trafiają do tabel kolejki, logów zadań ani DLQ.
- **Zadania idempotentne:** każde zadanie można bezpiecznie powtórzyć (sprawdzenie stanu przed działaniem, deterministyczne klucze pochodnych w storage'u, klucz deduplikacji `singletonKey` dla zadań per obiekt).
- Ponowienia z wykładniczym backoffem (domyślnie 5 prób), potem kolejka martwych zadań + alert (ADR-0013). Limity współbieżności per kolejka (np. przetwarzanie wideo: 1, zdjęcia: 2, e-mail: 5).
- Zadania cykliczne (cron pg-boss, strefa `Europe/Warsaw` dla zadań biznesowych): uzgadnianie storage ↔ baza, czyszczenie kluczy idempotencji i dziennika zmian (ADR-0004, ADR-0008), kontrola wieku backupów.
- Rola bazy `evia_app` ma uprawnienia do schematu kolejki; kolejka nie jest wystawiona poza sieć wewnętrzną (ADR-0011).

## Konsekwencje
- **Pozytywne:** zero nowych usług; spójność transakcyjna; backup i PITR kolejki razem z bazą; proste testy integracyjne (Testcontainers z PostgreSQL).
- **Negatywne / koszty:** kolejka obciąża tę samą bazę (pomijalne przy dziesiątkach użytkowników); przepustowość niższa niż Redis (nieistotne dla tej skali).
- **Ryzyka i mitygacje:**
  - *Rozrost tabel kolejki* → automatyczna archiwizacja i usuwanie zakończonych zadań (konfiguracja retencji pg-boss), monitoring rozmiaru.
  - *Długie zadania wideo blokujące kolejkę* → osobna kolejka z własną współbieżnością i limitem czasu (ADR-0009).

## Plan wyjścia
Zadania są wywoływane przez cienki interfejs `platform/jobs` (enqueue, handle). Zmiana na Graphile Worker (ta sama baza) to dni pracy; na BullMQ — dodanie Valkey i rezygnacja z transakcyjnego zlecania (wtedy tabela outbox + publikator).

## Weryfikacja
- EVM-008: zadanie testowe przechodzi przez kolejkę na staging; test integracyjny „rollback transakcji = brak zadania”.
- M1/M2: p95 czasu od uploadu do stanu `ready` dla zdjęcia < 2 min, dla filmu 2-minutowego < 15 min; zero zadań w DLQ bez alertu.

## Źródła (zweryfikowane 2026-10-02)
- pg-boss 12.35.1 (MIT, 2026-09-30): https://github.com/timgit/pg-boss/releases , https://www.npmjs.com/package/pg-boss
- Graphile Worker 0.18.0 (MIT, 2026-09-08): https://www.npmjs.com/package/graphile-worker
- BullMQ 6.3.11 (MIT, 2026-10-01): https://www.npmjs.com/package/bullmq ; Valkey 9.1.2 (2026-09-01): https://github.com/valkey-io/valkey/releases
- Scaleway Queues: https://www.scaleway.com/en/queues/
