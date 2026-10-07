---
id: EVM-079
title: Sprzątanie wygasłych rekordów idempotencji
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
depends_on: [EVM-020]
---

# EVM-079: Sprzątanie wygasłych rekordów idempotencji

## Cel
Jako **właściciel systemu** chcę **by wygasłe rekordy idempotencji były cyklicznie usuwane**, aby **tabela `idempotency_records` nie rosła w nieskończoność**. Dziś rola `evia_app` nie ma uprawnienia DELETE, więc nic jej nie czyści (wprowadzone w EVM-020). Powiązane z polityką retencji w M4.

## Kryteria akceptacji

**AC1 — Usuwanie wygasłych**
- Zakładając, że w tabeli są rekordy z upłyniętym terminem ważności i rekordy aktywne
- Gdy uruchamia się zadanie sprzątania
- Wtedy wygasłe rekordy są usunięte, a aktywne pozostają nienaruszone (test na danych syntetycznych).

**AC2 — Cykliczność i odporność**
- Zakładając, że zadanie jest zarejestrowane w kolejce zadań w tle (np. pg-boss — wybór techniczny po stronie architekta)
- Gdy minie interwał lub zadanie uruchomi się równolegle w dwóch instancjach
- Wtedy sprzątanie wykonuje się cyklicznie, bez podwójnego usuwania i bez błędów; awaria jednego przebiegu nie blokuje kolejnych.

**AC3 — Minimalne uprawnienia**
- Zakładając, że `evia_app` nie ma DELETE na całej tabeli
- Gdy zadanie usuwa rekordy
- Wtedy uprawnienie jest nadane w najwęższym możliwym zakresie (osobna rola lub ograniczone), a testy uprawnień bazy potwierdzają, że zwykłe ścieżki API nadal nie mogą usuwać rekordów.

**AC4 — Obserwowalność**
- Zakładając, że zadanie się wykonało
- Gdy sprawdzam logi/metryki
- Wtedy widać liczbę usuniętych rekordów i czas przebiegu, bez danych osobowych ani treści żądań.

## Poza zakresem
- Ogólna polityka retencji innych danych (M4); zmiana czasu ważności kluczy idempotencji.

## Decyzje i ograniczenia
- Obszar ryzyka: zmiana uprawnień bazy (migracja), integralność gwarancji idempotencji — nie usuwać rekordów przed końcem okna ponowień.
- Konsultacja: solution-architect (wybór mechanizmu zadań w tle, np. pg-boss zgodnie ze stackiem) i security-engineer (uprawnienia).

## Dziennik
- 2026-10-07 — utworzono (product-owner)
