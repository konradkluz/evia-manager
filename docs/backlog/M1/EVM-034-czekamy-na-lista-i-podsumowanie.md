---
id: EVM-034
title: „Czekamy na…” na liście zleceń i w podsumowaniu zlecenia
type: story
milestone: M1
epic: E4 Procesy i etapy
status: in-progress
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
depends_on: [EVM-032, EVM-069]
---

# EVM-034: „Czekamy na…” na liście zleceń i w podsumowaniu zlecenia

## Historyjka
Jako **pracownik biura** chcę **widzieć na liście i w podsumowaniu zlecenia, na kogo czekamy i od ilu dni, oraz filtrować „czekamy na OSD dłużej niż 14 dni”**, aby **nie przegapić sprawy, która utknęła u OSD, w administracji albo u klienta**.

## Kontekst
- Zakres roadmapy E4: „lista czekamy na OSD / administrację dłużej niż X dni”. Reguła z `domain-model.md` (`ProcedureStage`): `status = waiting` ∧ `waitingOn = party` ∧ rodzaj strony ∧ `waitingSince < dziś − X`.
- **Wymaga ADR EVM-069** (model odczytu listy i podsumowania — luka L3): sposób dostarczenia kolumn, filtrów i sortowań między modułami.
- Makiety: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) (kolumny „Czekamy na”, „Termin”, filtr, zapisany widok), [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (kafle „Na jakim etapie”, „Na kogo czekamy”, „Terminy”; PO-3). Scenariusze: B6, C2, C4, C6.

## Kryteria akceptacji
**AC1 — Kolumna „Czekamy na”**
- Zakładając zlecenie z etapami czekającymi na „Stoen Operator (OSD)” od 15 dni i na klienta od 3 dni
- Gdy otwieram W-10
- Wtedy kolumna pokazuje najdłuższe oczekiwanie „Stoen Operator (OSD) · od 15 dni” z `triangle-alert` (powyżej 14 dni) i „+1”.

**AC2 — Filtr „dłużej niż X dni”**
- Zakładając zegar `Europe/Warsaw` = 2026-10-03 i etap czekający na OSD od 2026-09-18
- Gdy filtruję „Czekamy na: OSD dłużej niż 14 dni”, a potem „…dłużej niż 15 dni”
- Wtedy zlecenie jest w wynikach dla X = 14 i nie ma go dla X = 15; X przyjmuje wartości 1–365 (inne — `400`), a filtr działa też dla klienta i każdego rodzaju strony; w URL są tylko rodzaj strony i X.

**AC3 — Zapisany widok**
- Gdy wybieram widok „Czekamy na OSD > 14 dni”
- Wtedy URL zawiera tylko identyfikator widoku, a przy braku wyników widzę „Nie czekamy na OSD dłużej niż 14 dni. Dobra wiadomość.”

**AC4 — Termin i sortowania**
- Gdy sortuję „Najdłużej czekamy” albo „Termin”
- Wtedy kolejność wynika z najdłuższego oczekiwania albo najbliższego terminu otwartego etapu (rosnąco), a kolumna „Termin” pokazuje najbliższy termin z `alarm-clock` dla terminów minionych.

**AC5 — Podsumowanie W-06**
- Zakładając zlecenie z 9 procesami
- Gdy otwieram W-06
- Wtedy kafel „Na jakim etapie” pokazuje bieżący etap maks. 3 procesów i „+ 6 procesów”, kafel „Na kogo czekamy” — wszystkie oczekiwania od najdłuższego (bez wiersza „klient: —”; brak oczekiwań — „Piłka po naszej stronie — nie czekamy na nikogo.”), a kafel „Terminy” — najbliższy termin i etapy po terminie.

**AC6 — Polityka i wydajność (SR-AUTHZ-03)**
- Zakładając 10 000 syntetycznych zleceń i zlecenie spoza uprawnień użytkownika
- Gdy filtruję i sortuję
- Wtedy p95 czasu odpowiedzi API jest < 300 ms, nie ma zapytań N+1, a zlecenie spoza uprawnień nie wpływa na wyniki, kolejność ani liczbę „+n” — zgodnie z ADR EVM-069.

**AC7 — Uprawnienia (SR-AUTHZ-05, SR-API-04)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda korzysta z filtra i kafli
- Wtedy A, E i R widzą kolumny, filtry i kafle, niezalogowany — `401`; parametry filtra nie zawierają danych osobowych.

**AC8 — Stany**
- Wtedy offline — dane z pamięci karty z banerem, filtry wyłączone; `429` — „Zbyt wiele zapytań…”; błąd kafla — alert w kaflu, pozostałe działają.

## Poza zakresem
- Kolumna „Płatność”, widoki „Po terminie” i „Nieopłacone”, sortowanie „Najpilniejsze”, kafel „Płatności” — EVM-056.
- Przypomnienia o oczekiwaniu (np. e-mail po 14 dniach) — M3.

## UX / UI
- W-10: kolumny „Czekamy na” i „Termin”, FilterBar z polem liczby dni, zapisany widok; W-06: karta podsumowania (Card § 3.8, cztery kafle — kafel „Płatności” w EVM-056), ikony `triangle-alert`, `alarm-clock`.
- Stany: AC3, AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | lista, filtry, kafle |
| Edytor | lista, filtry, kafle |
| Tylko odczyt | lista, filtry, kafle |
| Niezalogowany | brak (`401`) |

- Dane: nazwy stron (DO-3 dla osób fizycznych), daty oczekiwania.
- W AC: SR-AUTHZ-03, SR-AUTHZ-05, SR-API-04. W sekcji: SR-API-02 (masowy odczyt — P10).

## Notatki techniczne
- Moduły: zgodnie z [ADR-0017](../../architecture/adr/0017-model-odczytu-listy-i-podsumowania-zlecenia.md) (EVM-069; status „Zaakceptowana” 2026-10-04 — wariant (a), pytania 1–7 wg rekomendacji). Ta historyjka:
  - **tworzy moduł `overview`:** schemat, `work_order_summaries` bez kolumn płatności i `work_order_waits`; przeliczenie w całości w transakcji zapisu (handlery zdarzeń `work-orders`, `procedures`, `sites` — `siteType`, `parties` — `kind`; rejestr działań przed zatwierdzeniem w `platform`); porty systemowe modułów źródłowych; polecenia `rebuild` i `verify` w kontenerze `worker`; nocny `verify` (pg-boss) z metryką i alertem;
  - **klucze obce i blokady** (ADR-0017 → „Współbieżność”): łańcuch `work_orders` → `work_order_summaries` → `work_order_waits` z `ON DELETE CASCADE`; przegląd istniejących blokad wiersza `work_orders` (np. przejścia z EVM-030) — tryb `SELECT … FOR NO KEY UPDATE`, a nie `FOR UPDATE`; test 6 z przypadkiem blokady wiersza zlecenia;
  - **przenosi `GET /api/v1/work-orders` i `POST /api/v1/work-orders/search`** z `work-orders` do `overview` bez zmiany kontraktu (ścieżka, `operationId`, tag, `x-evia-authz`). Testy EVM-017 i EVM-072 przechodzą bez zmian, w tym limity i licznik masowego odczytu P10 (T9);
  - **dodaje zmiany kontraktu wyłącznie addytywnie:**
    - `sort`: `longestWaitingSince`, `nextDueDate`;
    - `view`: `waiting_on_dso_over_14_days`;
    - filtry `waitingOn`, `waitingOnPartyKind`, `waitingLongerThanDays` (1–365);
    - pola listy `waiting`, `nextDueDate`, `hasOverdueStage`;
    - pola `ProcedureStage.isOverdue`, `ProcedureStage.waitingDays`, `Procedure.currentStageId`.

    Enumy w odpowiedziach mają `x-extensible-enum`; jeśli EVM-008 nie wprowadzi tej konwencji, ta historyjka dopisuje ją do `api-guidelines.md`.
- Definicje D1–D5 i D10–D12 z ADR-0017 → „Definicje wyliczeń”. „Otwarty etap” w AC4 czytamy jako „niezakończony” (`todo`, `in_progress`, `waiting`, `blocked`), jeśli Konrad potwierdzi pytanie 2 ADR-0017.
- „Dziś” i „> X dni” — wstrzykiwany zegar; „po terminie” liczony w zapytaniu, niezapisywany; kolejne strony z `asOf` z kursora (W8).
- Plan techniczny obejmuje wymagania W1–W12 i testy 1–8 oraz T1–T9 z ADR-0017 (AC6 = testy 1–3). Obejmuje też test „projekcja = przeliczenie” po każdym teście integracyjnym zmieniającym zlecenie.
- Dokumenty do aktualizacji przy implementacji:
  - `domain-model.md` — usunięcie oznaczeń „proponowany”, pola wyliczane w „Pola kontrolowane przez serwer”, reguła bieżącego etapu `Procedure` po decyzji o pytaniu 2;
  - `docs/architecture/README.md` — węzeł `overview` na mapie modułów;
  - `docs/security/rodo.md` — inwentaryzacja `ProcedureStage`: w kolumnie „Gdzie” miejsce „projekcja `overview` (serwer)” (W1);
  - `docs/security/threat-model.md` — nowe pozycje TM: rozjazd kolumn autoryzacyjnych, wyrocznia przez sortowanie, agregaty przy polityce drobniejszej niż kotwica, przebudowa (albo przy `/milestone close M1`);
  - reguły dependency-cruiser — `overview` bez zależności przychodzących, porty systemowe niedostępne z warstwy `api` (W5).
- Rozmiar (ryzyko R8 README M1): przy `/refine` rozważyć wydzielenie enablera „moduł `overview` i przeniesienie listy” (pytanie 6 ADR-0017).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- ~~Nocny `verify` nie jest dostarczony w tej historyjce~~ — zastąpione decyzją Konrada z 2026-10-12 poniżej (krok 9 zrealizowany).
- **Decyzja Konrada 2026-10-12 (demo):** nocny `verify` (pg-boss, kontener `worker`, metryka `projection_drift_total`, ADR-0017 W11) wchodzi do EVM-034 teraz — zakres historyjki rozszerzony o krok 9 planu; reszta zakresu zaakceptowana. Push i PR dopiero po tym kroku.
- **Nocny `verify` — realizacja (krok 9, 2026-10-12):** zadanie `overview.verify-projection` w procesie `worker` (`node dist/src/worker.js`, ten sam obraz co API, bez HTTP i bez migracji, rola `evia_app`; usługa `worker` w `compose.dev.yaml`, start po `api`), harmonogram 03:30 `Europe/Warsaw` (omija lukę i powtórzenie godziny przy zmianie czasu), ładunek tylko `{ ids: [UUID] }` (puste dla harmonogramu), walidacja `strict` przy `send` i w handlerze, `output` tylko liczby, błędy zastępowane stałym kodem. Rozjazd to wynik (sukces zadania; wpis `warn` z `metric: "projection_drift_total"`, `value`, `traceId`; alert `projection_authz_drift` jak dotąd), awaria = `projection_verify_failed` z 2 ponowieniami i kolejką martwych listów, retencja 7 dni. **Nie dodano** nowego kodu alertu: rozjazd kolumn nieautoryzacyjnych to jakość danych, nie incydent bezpieczeństwa (skrzynka alertów to alerty `security`); reguła alertu na log metryki — EVM-007.
- **Zależność pg-boss 12.35.1 (SR-SUPPLY-06):** zaakceptowana w ADR-0010; dokładna wersja, tylko `@evia/api` (`pnpm add --save-exact`); licencja MIT, wydanie 2026-09-30, jeden opiekun, `engines` Node ≥ 22.12 (zgodne z Node 26), bez skryptów instalacyjnych (`allowBuilds` bez zmian); zależności tranzytywne `cron-parser` (→ `luxon`), `rrule-temporal` (→ `temporal-spec`), `serialize-error` (→ `non-error`, `type-fest`) — wszystkie MIT; `pg` pozostaje w jednej wersji 8.23.1 (bez drugiej kopii w lockfile). Aktualizacja wymaga nowej migracji schematu — test „wersja schematu pakietu = zamrożona (43)” jest bramką: migracja `0024` wykonuje zamrożony skrypt, a nie wynik biblioteki, więc podniesienie pakietu z nowszym schematem czerwieni test do czasu migracji z `getMigrationPlans('pgboss', 43)`; Renovate nie scala automatycznie.
- **Uprawnienia i kolejka bez DDL w runtime:** schemat `pgboss` tworzy migracja `0024` jako migrator (zamrożony skrypt wersji 43 wygenerowany z `getConstructionPlans`, bez własnej transakcji biblioteki); `evia_app` ma USAGE na schemacie, DML na tabelach, USAGE na sekwencjach i EXECUTE na funkcjach — bez CREATE na schemacie i bazie, bez domyślnych uprawnień (polityka migracji: jawne GRANT; migracja podnosząca pg-boss powtarza GRANT); `evia_readonly` bez dostępu. Test integracyjny jako `evia_app` potwierdził, że `createQueue` z `partition: false` i `schedule` działają bez CREATE, więc kolejki zakłada worker (nie migracja).
- **Granica z EVM-024 i innymi:** EVM-024 przejmuje kolejkę `email`, transakcyjne `send` w tej samej transakcji co zmiana domenowa (test „rollback = brak zadania”), politykę ponowień i kolejki martwych listów per kolejka, healthcheck workera oraz ewentualne odchudzenie modułu (dług: worker ładuje cały `AppModule`, bo `loadConfig` wymaga kluczy HTTP — docelowo `WorkerModule` bez nich). Eksporter metryk i alert na brak przebiegu (powyżej 26 h) — EVM-007; Dockerfile i wdrożenie workera na staging i produkcję — EVM-076.
- **Odstępstwa od wytycznych konsultacji (do wiadomości):** (1) bez `ALTER DEFAULT PRIVILEGES` — testy polityki migracji (EVM-016 AC7) zabraniają domyślnych uprawnień, więc grant jest jawny; (2) testy polityki migracji pomijają migrację `0024` (skrypt biblioteki czyta zegar i ma `DROP`), a jej statementy mają osobny test; (3) `sql.raw` użyte raz, w `platform/database/script.ts` (tekst skryptu biblioteki, nigdy z wejścia), z wyjątkiem w lintingu; (4) dodano usługę `worker` do polityki `compose.dev.yaml` (test repo-policy rozszerzony, nie osłabiony).
- Backfill projekcji na istniejącej bazie: migracja `0023` go nie robi; w środowisku dev robi to `dev`/`dev:seed` (`rebuild`), poza nim — runbook.

## Uwagi do rozważenia
- (nit) filtr `waitingOnPartyKind` ujawnia rodzaj strony niewidocznej dla wołającego (zgodnie z T8); przy 768 px komórka „Czekamy na” zawija się do 3–4 linii.
- (nit) poza środowiskiem dev backfill (`rebuild`) tylko w runbooku — wymusić w runbooku wdrożenia (EVM-007/024).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-034 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz B6)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-12 — ready → in-progress: start realizacji (/deliver), ścieżka pelna (8 AC i 3 recenzentów wykluczają lekką), gałąź feature/EVM-034-czekamy-na-lista-i-podsumowanie
- 2026-10-12 — plan gotowy (backend-developer)
- 2026-10-12 — backend (backend-developer): enabler (moduł `overview`, migracja 0023, `runInTransaction`, przeniesienie listy) i funkcja (filtry, sortowania, widok, pola listy, `currentStageId`, kontrakt) gotowe, bramka `pnpm run gate` zielona; do zrobienia: panel (kroki 10–11, web-developer) i nocny `verify` (pg-boss) po decyzji Konrada
- 2026-10-12 — panel (web-developer): W-10 (kolumny „Czekamy na” i „Termin”, filtr X dni, widok, sortowania) i karta „Podsumowanie” W-06 (3 kafle, błąd per kafel) gotowe; testy jednostkowe i e2e (Chromium, Firefox) zielone; rola `detail` w `DataTable`; do zrobienia: nocny `verify` (pg-boss) po decyzji Konrada
- 2026-10-12 — przegląd (2 rundy): runda 1 — code-reviewer i ux-designer changes_required (4 major: nocny verify, backfill, układ 768 px W-10 i kafla błędu W-06), security-engineer approve; runda 2 — wszyscy approve, blocker/major: 0
- 2026-10-12 — bramka orkiestratora: `pnpm run gate` zielony (exit 0), coverage:diff linie 100% / gałęzie 97,1%; pełne e2e Chromium + Firefox: 652 passed, 14 skipped, 0 failed; README i 3 pliki .md w drzewie roboczym miały CRLF po edycji agentów (index LF) — znormalizowane do LF, bez zmiany treści
- 2026-10-12 — Koszt: brak rozbicia w $ (sesja bez odczytu `/cost`); agenci workflow 14 wywołań, ok. 2,05 mln tokenów subagentów, 738 wywołań narzędzi, ok. 3,0 h; rundy 2; ścieżka pelna; model z definicji agentów; vs baseline — nie do porównania w $ (największa z ostatnich pięciu: EVM-035 1,94 mln, EVM-037 1,55 mln, EVM-038 1,02 mln, EVM-033 0,67 mln; ryzyko R8 — enabler + funkcja + panel w jednej historyjce)
- 2026-10-12 — in-progress → in-review: czeka na demo i akceptację Konrada (scenariusz B6) oraz decyzję o nocnym verify
- 2026-10-12 — demo: Konrad akceptuje dostarczony zakres i decyduje o dołożeniu nocnego verify (pg-boss + worker) do EVM-034; in-review → in-progress (krok 9 planu), push/PR wstrzymane
- 2026-10-12 — plan gotowy (backend-developer): krok 9, nocny verify (pg-boss + worker)
- 2026-10-12 — krok 9 zaimplementowany (backend-developer): pg-boss 12.35.1, migracja 0024, `platform/jobs`, zadanie `overview.verify-projection`, proces `worker` i usługa w compose.dev, runbook/ADR-0017/threat-model/CHANGELOG zaktualizowane; testy `EVM-034 W11`
- 2026-10-12 — krok 9 zweryfikowany (web-developer): zmiana nie dotyka panelu (bez zmian w apps/web i packages/ui-web, e2e web nie wymagane); `gate:native` i `gate:backend` (kontener) zielone, `docs:check` 0 błędów, 0 ostrzeżeń
