---
id: EVM-034
title: „Czekamy na…” na liście zleceń i w podsumowaniu zlecenia
type: story
milestone: M1
epic: E4 Procesy i etapy
status: draft
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
- Moduły: zgodnie z ADR EVM-069 (wstępna rekomendacja — moduł odczytu z projekcją aktualizowaną w tej samej transakcji), `procedures`, `work-orders` + panel.
- „Dziś” i „> X dni” — wstrzykiwany zegar; „po terminie” liczony w zapytaniu, niezapisywany.
- Wartości filtrów i sortowań dodawane addytywnie do enumów z EVM-017.
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
