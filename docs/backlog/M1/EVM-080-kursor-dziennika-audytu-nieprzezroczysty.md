---
id: EVM-080
title: Nieprzezroczysty kursor dziennika audytu i CURSOR_KEY tylko dla serwera
type: bug
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P2
path: pelna
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-029, EVM-017]
---

# EVM-080: Nieprzezroczysty kursor dziennika audytu i CURSOR_KEY tylko dla serwera

## Cel
Jako **właściciel systemu** chcę **by kursor paginacji dziennika audytu był nieprzezroczysty i uwierzytelniony tak jak kursor listy zleceń**, aby **spełnić zasady `api-guidelines` i nie ujawniać ani nie pozwalać fałszować pozycji w dzienniku**. Dziś `GET /api/v1/audit/events` (EVM-029) zwraca kursor w jawnym base64; lista zleceń (EVM-017) używa kursora szyfrowanego i uwierzytelnionego (AES-GCM, `CURSOR_KEY`). Drugi element: `loadConfig` wymaga `CURSOR_KEY` dla każdego polecenia CLI, także `db:migrate`.

## Kryteria akceptacji

**AC1 — Kursor nieprzezroczysty**
- Zakładając, że dziennik audytu ma więcej wpisów niż jedna strona
- Gdy Administrator pobiera kolejną stronę przez zwrócony kursor
- Wtedy kursor nie daje się odczytać prostym dekodowaniem, a paginacja zwraca kolejne wpisy bez duplikatów i luk.

**AC2 — Sfałszowany lub uszkodzony kursor**
- Zakładając, że kursor został zmodyfikowany, uszkodzony albo pochodzi z innego endpointu (np. listy zleceń)
- Gdy wysyłam go do `GET /api/v1/audit/events`
- Wtedy odpowiedź to 400 z błędem walidacji, bez ujawniania szczegółów kryptograficznych; uprawnienia (tylko Administrator) pozostają bez zmian.

**AC3 — Klucz tylko tam, gdzie potrzebny**
- Zakładając, że `CURSOR_KEY` nie jest ustawiony
- Gdy uruchamiam `pnpm --filter @evia/api run db:migrate`
- Wtedy migracje wykonują się poprawnie, a start serwera API bez `CURSOR_KEY` kończy się czytelnym błędem konfiguracji.

**AC4 — Dokumentacja**
- Zakładając, że wymóg konfiguracji się zmienił
- Gdy czytam `docs/ops`
- Wtedy opisane jest, które polecenia wymagają `CURSOR_KEY`, a `.env.example` pozostaje zgodny.

## Poza zakresem
- Rotacja `CURSOR_KEY` i zmiana algorytmu; kursory innych list (jeśli istnieją — osobna pozycja).

## Decyzje i ograniczenia
- Wzorzec do ponownego użycia: kursor z EVM-017. Obszar ryzyka: bezpieczeństwo (integralność paginacji audytu) i konfiguracja.
- Kursory wydane przed zmianą stają się nieważne — akceptowalne (stary format nie był kontraktem wydania produkcyjnego; do potwierdzenia).

## Dziennik
- 2026-10-07 — utworzono (product-owner)
