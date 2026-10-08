---
id: EVM-082
title: Limit 300 żądań na minutę na użytkownika dla operacji zapisu
type: enabler
milestone: M1
epic: E00 Fundamenty
status: draft
priority: P2
path: pelna
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-022]
---

# EVM-082: Limit 300 żądań na minutę na użytkownika dla operacji zapisu

## Cel
Jako **właściciel systemu** chcę **limitu 300 żądań/min na użytkownika także dla zapisów**, aby **spełnić SR-API-02 i ograniczyć nadużycia kontem A lub E**. Dziś zapisy (np. `createWorkOrder`, `createCustomer`) chroni tylko limit globalny per IP; wyszukiwania mają osobne limity 60/min (EVM-020, EVM-021). Zgłoszone w przeglądzie EVM-022.

## Kryteria akceptacji

**AC1 — Limit na użytkownika**
- Zakładając zalogowanego użytkownika, który wysłał 300 żądań w ciągu minuty
- Gdy wysyła kolejne
- Wtedy dostaje `429 rate_limited` z `Retry-After`, a inni użytkownicy nie są ograniczeni.

**AC2 — Bez wpływu na odczyty i wyszukiwania**
- Zakładając istniejące limity wyszukiwań (60/min) i licznik masowego odczytu (P10)
- Gdy dodano nowy limit
- Wtedy ich zachowanie i testy się nie zmieniają, a limit nie jest liczony przed uwierzytelnieniem i autoryzacją.

**AC3 — Testy i kontrakt**
- Zakładając zegar kontrolowany w testach
- Gdy sprawdzam okno minutowe i jego reset
- Wtedy testy `EVM-082 AC#` pokrywają granice (299/300/301) i reset, a `429` jest opisane w kontrakcie operacji.

## Poza zakresem
- Limity per IP i wyszukiwania (bez zmian); konfiguracja limitów z poziomu panelu.

## Decyzje i ograniczenia
- Obszar ryzyka: bezpieczeństwo (nadużycia, SR-API-02). Do ustalenia przy `/refine`: czy limit obejmuje też odczyty.

## Dziennik
- 2026-10-08 — utworzono (propozycja z przeglądu EVM-022)
