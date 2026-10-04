---
id: EVM-034
title: „Czekamy na…” na liście zleceń i w podsumowaniu zlecenia
type: story
milestone: M1
epic: E4 Procesy i etapy
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
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
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-034 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz B6)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
