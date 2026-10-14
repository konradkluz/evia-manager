---
id: EVM-079
title: Sprzątanie wygasłych rekordów idempotencji
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P2
path: lekka
owner: backend-developer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-020, EVM-034]
---

# EVM-079: Sprzątanie wygasłych rekordów idempotencji

## Cel
Jako **właściciel systemu** chcę **by wygasłe rekordy idempotencji były cyklicznie usuwane**, aby **tabela `platform.idempotency_records` nie rosła w nieskończoność**. Retencja kluczy to 30 dni (ADR-0004, `api-guidelines.md` → Limity). Dziś rola aplikacji `evia_app` ma tylko `select, insert, update` (migracja 0012), więc nic nie czyści tabeli; dług zgłoszono w EVM-020. Rekordy nie zawierają treści odpowiedzi ani danych osobowych (status, kod, id zasobu, skrót żądania). Proces w tle (worker, kolejka zadań z harmonogramem) istnieje od EVM-034 — używamy go.

## Kryteria akceptacji

**AC1 — Usuwanie wygasłych**
- Zakładając rekordy z upłyniętym `expires_at` oraz rekordy aktywne (także świeżo wygasły o sekundę i ważny jeszcze o sekundę)
- Gdy uruchamia się zadanie sprzątania
- Wtedy wygasłe rekordy są usunięte, a aktywne pozostają nienaruszone; ponowienie żądania z kluczem aktywnego rekordu nadal zwraca powtórkę (`Idempotent-Replayed`) (dane syntetyczne, zegar kontrolowany).

**AC2 — Cyklicznie i odpornie**
- Zakładając zadanie zarejestrowane w kolejce zadań w tle z harmonogramem (raz na dobę, strefa `Europe/Warsaw` — pora nocna)
- Gdy zadanie uruchomi się równolegle w dwóch instancjach albo jeden przebieg zakończy się błędem
- Wtedy nic nie jest usuwane podwójnie ani z błędem, a kolejny przebieg działa normalnie; duża liczba rekordów jest usuwana porcjami, bez długiej blokady tabeli dla zapisów API.

**AC3 — Minimalne uprawnienia**
- Zakładając, że `evia_app` nie ma ogólnego `DELETE` na tabeli
- Gdy zadanie sprzątania usuwa rekordy
- Wtedy może usuwać wyłącznie rekordy wygasłe (uprawnienie w najwęższym możliwym zakresie), a test uprawnień bazy potwierdza, że bezpośrednie `DELETE` aktywnych rekordów i zwykłe ścieżki API nadal są odrzucane.

**AC4 — Obserwowalność**
- Zakładając wykonany przebieg
- Gdy sprawdzam logi
- Wtedy widać liczbę usuniętych rekordów i czas trwania, a błąd przebiegu jest zalogowany jako błąd zadania; bez identyfikatorów użytkowników, kluczy idempotencji i skrótów żądań.

## Poza zakresem
- Ogólna polityka retencji innych danych (M4); zmiana okna ważności kluczy (30 dni); alert o niepowodzeniu zadania (monitoring: EVM-007/EVM-084).
- Testy macierzy ról: brak nowego endpointu ani widocznej funkcji — rola użytkownika nie ma znaczenia.

## Decyzje i ograniczenia
- Decyzja D2 (2026-10-13, Konrad — przekazana przez orkiestratora): ścieżka lekka, jedyny recenzent `security-engineer`.
- Obszar ryzyka: zmiana uprawnień bazy (migracja) i integralność idempotencji — nie wolno usuwać rekordów przed `expires_at` (odczyt i nadpisanie wygasłych działa jak w EVM-020 niezależnie od sprzątania).
- Migracja tylko „expand” (nowe uprawnienie/mechanizm); wybór techniczny (np. funkcja o ograniczonym zakresie albo osobna rola) należy do wykonawcy, recenzent: `security-engineer`. Ścieżka lekka: jeden recenzent; eskalacja do pełnej, jeśli zmiana wykracza poza uprawnienie do tej jednej tabeli.

## Dziennik
- 2026-10-07 — utworzono (product-owner; dług z EVM-020)
- 2026-10-13 — refinement: zadania w tle istnieją (EVM-034), ścieżka lekka z recenzentem security, harmonogram i porcje w AC (product-owner)
- 2026-10-13 — draft → ready: AC i decyzje (D1–D5) zaakceptowane przez Konrada (refinement przed kolejką nocną)
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka lekka, model sonnet, gałąź `feature/EVM-079-retencja-idempotencji` ułożona na EVM-080 → EVM-078 → EVM-053 — łańcuch za zgodą Konrada)
