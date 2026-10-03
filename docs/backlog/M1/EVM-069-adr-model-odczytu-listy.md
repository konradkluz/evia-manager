---
id: EVM-069
title: ADR — model odczytu listy i podsumowania zlecenia
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: solution-architect
contributors: []
reviewers: [security-engineer, backend-developer]
depends_on: [EVM-002]
---

# EVM-069: ADR — model odczytu listy i podsumowania zlecenia

## Historyjka
Jako **zespół backendu** chcemy **decyzji architektonicznej, jak lista zleceń i karta podsumowania pokazują i sortują dane z modułów `procedures` i `payments`**, aby **EVM-034 i EVM-056 dało się zrealizować bez łamania granic modułów, z autoryzacją w zapytaniu i w wymaganym czasie odpowiedzi**.

## Kontekst
- Luka L3 z EVM-004 (`scenariusze-a-d.md`) i uwaga 5 EVM-004: kolumny „Czekamy na”, „Termin”, „Płatność”, sortowanie „Najpilniejsze” i kafle W-06 wymagają danych z `procedures` i `payments`, a `work-orders` od nich nie zależy.
- Reguła 2 z ADR-0001: moduły nie robią joinów do cudzych tabel — więc nie mogą też sortować ani filtrować między sobą.
- Konsultacja `solution-architect` (EVM-010, W1): warianty do oceny i wstępna rekomendacja (a).

## Kryteria akceptacji
**AC1 — Ocena wariantów**
- Zakładając warianty: (a) projekcja `work_order_summaries` w nowym module odczytu, aktualizowana w tej samej transakcji przez handlery zdarzeń w procesie, wyłącznie z ID, kodami, datami i kwotami (bez danych osobowych), z poleceniem przebudowy; (b) widok SQL w schemacie odczytu (wyjątek od ADR-0001); (c) składanie z fasad przez listy ID (tylko filtry, bez sortowania między modułami)
- Gdy czytam ADR w `docs/architecture/adr/`
- Wtedy każdy wariant jest oceniony wg kryteriów: zgodność z ADR-0001, autoryzacja warunkiem w zapytaniu (SR-AUTHZ-03), p95 < 300 ms przy 10 tys. syntetycznych zleceń, spójność z zapisem, brak danych osobowych, możliwość przebudowy, wpływ na synchronizację w M2 — z rekomendacją i konsekwencjami.

**AC2 — Definicje wyliczeń**
- Wtedy ADR definiuje źródło i regułę dla: „Najpilniejsze”, „Najdłużej czekamy”, „Termin”, „Czekamy na [klient / rodzaj strony] dłużej niż X dni”, „Po terminie” (liczone w zapytaniu z daty `Europe/Warsaw`, niezapisywane), „Nieopłacone”, kolumny „Płatność” i kafli „Na jakim etapie”, „Na kogo czekamy”, „Terminy”, „Płatności” w W-06.

**AC3 — Kontrakt**
- Wtedy ADR opisuje rozszerzenie listy z EVM-017 wyłącznie addytywnie: nowe wartości rozszerzalnych enumów `sort` i filtrów oraz nowe pola listy i podsumowania (oasdiff bez zmian łamiących).

**AC4 — Plan testów**
- Wtedy ADR wskazuje testy: wydajność przy 10 tys. zleceń, licznik zapytań (brak N+1), polityka w zapytaniu (wiersz spoza uprawnień nie wpływa na wynik ani sortowanie), spójność po błędzie transakcji, przebudowa projekcji (jeśli wariant (a)).

**AC5 — Wpływ na backlog i model**
- Wtedy ADR wskazuje zmiany w `domain-model.md` (np. nowy moduł odczytu i własność tabel) oraz w „Notatkach technicznych” EVM-034 i EVM-056, a ADR-0001 dostaje adnotację tylko wtedy, gdy rekomendacją jest wariant (b).

**AC6 — Akceptacja**
- Wtedy ADR ma przeglądy `security-engineer` i `backend-developer` (APPROVE) i decyzję Konrada (`/adr`), zapisaną w „Decyzje”.

## Poza zakresem
Implementacja (EVM-034, EVM-056). Raporty i pulpit (M3/M4).

## UX / UI
Nie dotyczy (wejście: W-06 i W-10 z EVM-004).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (dokument) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

Wymagania do oceny: SR-AUTHZ-03 (polityka w zapytaniu), SR-DATA-01 (projekcja bez danych osobowych), SR-API-04 (filtry bez danych osobowych w URL).

## Notatki techniczne
- Wstępna rekomendacja architekta: wariant (a).
- Termin: przed EVM-034 (faza 3). Może powstać równolegle z fazami 0–2 (praca koncepcyjna).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC6 spełnione
- [ ] ADR w indeksie `docs/architecture/adr/README.md`; `npm run docs:check` — 0 błędów
- [ ] Przeglądy: security-engineer, backend-developer — APPROVE
- [ ] Decyzja Konrada (ADR zaakceptowany)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; konsultacja solution-architect W1)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — ready → in-progress: start /deliver w nocy 3/4.10 (decyzja Konrada — kolejka EVM-006 → EVM-014 → EVM-069, demo rano); gałąź `feature/EVM-069-adr-model-odczytu-listy` **ułożona na `feature/EVM-006-repo-i-ci`** (EVM-006 w PR #2, jeszcze nie na `main`: hooki, `.gitignore`, numeracja ADR po ADR-0016); po scaleniu PR #2 orkiestrator wciąga `origin/main` merge'em (bez force-pusha). Decyzja Konrada o ADR (AC6) — rano (`/adr`)
