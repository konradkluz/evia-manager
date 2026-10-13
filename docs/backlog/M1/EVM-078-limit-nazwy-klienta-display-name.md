---
id: EVM-078
title: Test regresji — klient z imieniem i nazwiskiem po 200 znaków
type: bug
milestone: M1
epic: E2 Klienci
status: ready
priority: P2
path: lekka
owner: backend-developer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-020, EVM-039]
---

# EVM-078: Test regresji — klient z imieniem i nazwiskiem po 200 znaków

## Cel
Jako **Edytor** chcę **zapisać klienta z bardzo długim imieniem i nazwiskiem (po 200 znaków) bez błędu wewnętrznego (500)**, aby **długie dane nie psuły tworzenia klienta ani zleceń**. Błąd zgłoszono w EVM-020 (`display_name` 401 znaków > `maxLength` 400 → `internal_error`). W EVM-039 (dziennik 2026-10-08) podniesiono `maxLength` nazw wyświetlanych klienta do 401, ale nie dodano testu regresji — ta historyjka domyka dług: dowodzi, że poprawka działa na wszystkich ścieżkach, i naprawia ewentualne miejsca, które nadal zwracają 500.

## Kryteria akceptacji

**AC1 — Utworzenie klienta 200 + 200**
- Zakładając, że Edytor tworzy klienta osobę z imieniem i nazwiskiem po 200 znaków
- Gdy wysyła utworzenie klienta (także jako krok „nowe zlecenie” z EVM-020) i potem tworzy zlecenie z tym klientem
- Wtedy odpowiedzi to 201 (nie 500), a `displayName` ma 401 znaków; test `EVM-078 AC1` odtwarza przypadek brzegowy.

**AC2 — Odczyt we wszystkich widokach**
- Zakładając klienta z imieniem i nazwiskiem po 200 znaków
- Gdy Administrator, Edytor lub Tylko odczyt otwiera szczegóły klienta, listę klientów, wyszukiwanie (klientów i zleceń) oraz zlecenie z kartą „Klient”
- Wtedy każda odpowiedź to 200 z pełną nazwą (`displayName`, `sortName`), bez `internal_error`; test sprawdza też, że kontrakt dopuszcza 401 znaków we wszystkich schematach nazwy klienta.

**AC3 — Edycja**
- Zakładając klienta z imieniem 200 znaków
- Gdy Edytor zmienia nazwisko na 200 znaków (PATCH z `If-Match`)
- Wtedy odpowiedź to 200, nie 500.

**AC4 — Granice pól bez zmian**
- Zakładając pole imienia, nazwiska albo nazwy firmy o 201 znakach
- Gdy Edytor tworzy lub edytuje klienta
- Wtedy odpowiedź to 400 `too_long` ze wskazaniem pola, a dane poprawne (do 200 znaków) działają jak dotąd; istniejące testy EVM-020 i EVM-039 przechodzą.

## Poza zakresem
- Zmiana limitów pól (200) i innych encji (strony/OSD: `display_name` ≤ 200, `maxLength` 400 jest tam poprawne).
- Zmiany UI (formularz klienta); uprawnienia (bez zmian: Tylko odczyt → 403 przy zapisie, niezalogowany → 401).

## Decyzje i ograniczenia
- Decyzja D1 (2026-10-13, Konrad — przekazana przez orkiestratora): historyjka zostaje jako test regresji 200+200; limity pól zostają 200, limit nazw wyświetlanych w kontrakcie to 401 (już wprowadzony w EVM-039) — bez nowych zmian kontraktu.
- Testy mogą od razu przejść (poprawka już jest); jeśli którykolwiek scenariusz nadal daje 500, wykonawca naprawia ten schemat/walidację w ramach tej historyjki.
- Obszar ryzyka: niski (walidacja wejścia; dane testowe wyłącznie syntetyczne).

## Dziennik
- 2026-10-07 — utworzono (product-owner; uwaga z EVM-020)
- 2026-10-13 — refinement: sprawdzono, że EVM-039 podniósł `maxLength` do 401; zakres zawężony do testów regresji i ewentualnych luk (product-owner)
- 2026-10-13 — draft → ready: AC i decyzje (D1–D5) zaakceptowane przez Konrada (refinement przed kolejką nocną)
