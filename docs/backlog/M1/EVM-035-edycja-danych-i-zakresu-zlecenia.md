---
id: EVM-035
title: Edycja danych i zakresu zlecenia
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-038, EVM-071]
---

# EVM-035: Edycja danych i zakresu zlecenia

## Historyjka
Jako **pracownik biura** chcę **zmienić dane zlecenia i jego zakres — dodać pozycję z katalogu z jej procesami, usunąć pozycję, poprawić parametry —** aby **zlecenie odpowiadało temu, co faktycznie robimy, gdy na miejscu okaże się coś innego niż w szablonie**.

## Kontekst
- Zakres roadmapy E3: „zakres z katalogu (edytowalny)”, „podstawowe parametry techniczne”, „opiekun”. Luka L7 i kandydat P1 z EVM-004; wariant A z EVM-002 (brak gotowego zasilania → dodanie „Instalacji zasilającej”).
- Model: `ScopeItem` (dodanie proponuje procesy wnoszone przez pozycję, bez duplikatów po kodzie; usunięcie pozycji nie usuwa procesów), parametry wg `parameterSetCode` (D2).
- PO-8 i decyzja 17 (README M1): w zleceniu zamkniętym dane zlecenia i zakres są tylko do odczytu.
- Makiety: W-06 „Edytuj dane zlecenia”, „Edytuj zakres” (EVM-071).

## Kryteria akceptacji
**AC1 — Dane zlecenia**
- Zakładając zlecenie „W realizacji”
- Gdy w „Edytuj dane zlecenia” zmieniam tytuł, opis, opiekuna albo planowaną datę
- Wtedy zmiana zapisuje się z `If-Match`, a przy `412` widzę alert konfliktu z zachowanymi wpisanymi danymi (komunikat z makiety W-06 (a)).

**AC2 — Dodanie pozycji z procesami**
- Zakładając zlecenie z szablonu „Dom — sam montaż”
- Gdy dodaję pozycję „Instalacja zasilająca”
- Wtedy pozycja ma parametry domyślne, panel proponuje procesy wnoszone przez pozycję (bez procesów o kodach już obecnych w zleceniu), a po zatwierdzeniu dochodzą procesy z etapami „Do zrobienia” — wszystko w jednej transakcji.

**AC3 — Usunięcie pozycji**
- Gdy usuwam pozycję zakresu
- Wtedy pozycja znika z zakresu, a procesy, które wniosła, zostają z informacją, gdzie je usunąć (EVM-042).

**AC4 — Parametry techniczne (SR-INPUT-01, SR-INPUT-02, SR-DATA-02)**
- Gdy zmieniam parametry pozycji albo dodaję „Inną usługę” z opisem
- Wtedy parametry są walidowane schematem zestawu (pole nieznane, wartość spoza zakresu albo > 16 KB → `400 validation_failed`), a parametry nie przyjmują danych osobowych ani identyfikatorów (PPE, numery liczników, nazwiska).

**AC5 — Limity**
- Zakładając zlecenie z 50 pozycjami zakresu
- Gdy dodaję kolejną
- Wtedy API zwraca `422 limit_exceeded` z komunikatem w panelu.

**AC6 — Zlecenie zamknięte (PO-8, decyzja 17)**
- Zakładając zlecenie „Rozliczone” albo „Anulowane”
- Gdy zmieniam dane zlecenia albo zakres
- Wtedy API zwraca `409 work_order_closed`, a w panelu akcje są wyłączone z podpowiedzią.

**AC7 — Dziennik**
- Gdy zmieniam dane zlecenia albo zakres
- Wtedy w dzienniku zlecenia powstaje zdarzenie z nazwami zmienionych pól albo opisem zmiany zakresu — bez wartości danych osobowych (mechanizm EVM-038).

**AC8 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda edytuje
- Wtedy A i E edytują, R nie widzi akcji i dostaje `403 forbidden`, niezalogowany — `401`; pozycja zakresu zlecenia B zmieniana ścieżką zlecenia A zwraca `404`, a pola kontrolowane przez serwer (`number`, `status`) — `400` (`read_only_field`).

## Poza zakresem
- Ręczne dodanie i usunięcie procesu lub etapu — EVM-042 (P2). Zmiana klienta lub lokalizacji zlecenia — poza M1.

## UX / UI
- W-06: dialog „Edytuj dane zlecenia”, tryb „Edytuj zakres” (lista pozycji, dodanie z katalogu z propozycją procesów, parametry wg zestawu, „Inna usługa”) — makiety EVM-071.
- Stany: pusty („Zlecenie nie ma jeszcze pozycji zakresu. [Edytuj zakres]”), ładowanie, błąd (`412`, `422`), offline (akcje wyłączone), brak uprawnień (AC8).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | edycja danych i zakresu |
| Edytor | edycja danych i zakresu |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: tytuł, opis (pola swobodne), parametry techniczne (bez danych osobowych).
- W AC: SR-INPUT-01, SR-INPUT-02, SR-DATA-02, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05. W sekcji: SR-API-07, SR-LOG-03.

## Notatki techniczne
- Moduły: `work-orders`, `procedures` (przez port kompozycji), `timeline` (zdarzenia) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-035 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC1 — komunikat `412` wg makiety W-06 (a) „Edytuj dane zlecenia” (forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
