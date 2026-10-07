---
id: EVM-078
title: Błąd 500 przy bardzo długim imieniu i nazwisku klienta
type: bug
milestone: M1
epic: E2 Klienci
status: draft
priority: P2
path: lekka
owner: backend-developer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-020]
---

# EVM-078: Błąd 500 przy bardzo długim imieniu i nazwisku klienta

## Cel
Jako **Edytor** chcę **dostać czytelny błąd walidacji (400) przy zbyt długim imieniu lub nazwisku klienta**, aby **nie trafiać na błąd wewnętrzny (500)**. Obecnie imię i nazwisko po 200 znaków dają `display_name` o długości 401 znaków, przekraczające `maxLength` 400 z kontraktu, i API zwraca `internal_error` (EVM-020, `apps/api` — klienci).

## Kryteria akceptacji

**AC1 — Odtworzenie i test regresji**
- Zakładając, że Edytor tworzy klienta osobę z imieniem i nazwiskiem po 200 znaków
- Gdy wysyła żądanie utworzenia klienta
- Wtedy odpowiedź nie jest 500; test z oznaczeniem `EVM-078 AC1` odtwarza przypadek brzegowy (200+200).

**AC2 — Spójne limity**
- Zakładając, że limity pól imienia, nazwiska i `display_name` są spójne z kontraktem
- Gdy suma znaków po złożeniu `display_name` mogłaby przekroczyć limit
- Wtedy żądanie jest odrzucane 400 z błędem walidacji wskazującym pole, albo limity pól są tak dobrane, że przekroczenie jest niemożliwe (wybór rozstrzyga refinement).

**AC3 — Brak zmiany dla poprawnych danych**
- Zakładając, że imię i nazwisko mieszczą się w limitach
- Gdy Edytor tworzy lub wyszukuje klienta
- Wtedy zachowanie i kontrakt pozostają bez zmian (istniejące testy EVM-020 przechodzą).

## Poza zakresem
- Zmiany limitów dla innych pól i innych encji.

## Decyzje i ograniczenia
- Do rozstrzygnięcia: obniżyć limity pól czy podnieść limit `display_name` w kontrakcie (zmiana kontraktu → wpływ na klientów API). Rekomendacja: obniżyć limity pól tak, by suma (+ separator) ≤ 400.
- Obszar ryzyka: niski; walidacja wejścia.

## Dziennik
- 2026-10-07 — utworzono (product-owner)
