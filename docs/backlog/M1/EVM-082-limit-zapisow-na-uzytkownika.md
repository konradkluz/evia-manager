---
id: EVM-082
title: Limit 300 żądań na minutę na użytkownika (SR-API-02)
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P2
path: pelna
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-022]
---

# EVM-082: Limit 300 żądań na minutę na użytkownika (SR-API-02)

## Cel
Jako **właściciel systemu** chcę **limitu 300 żądań/min na zalogowanego użytkownika**, aby **spełnić SR-API-02 i ADR-0004 oraz ograniczyć nadużycia przejętym lub nieuczciwym kontem**. Dziś zapisy (np. `createWorkOrder`, `createCustomer`) i zwykłe odczyty chroni tylko limit globalny per IP (1200/min); wyszukiwania mają osobne limity 60/min na użytkownika (EVM-020, EVM-021). `api-guidelines.md` → Limity wymienia „żądania na użytkownika: 300/min” jako obowiązujący limit, którego brakuje. Zgłoszone w przeglądzie EVM-022.

## Kryteria akceptacji

**AC1 — Limit na użytkownika**
- Zakładając zalogowanego użytkownika (Administrator, Edytor lub Tylko odczyt, kanał web lub mobile), który wysłał 300 żądań w ciągu minuty
- Gdy wysyła kolejne w tej samej minucie
- Wtedy dostaje `429 rate_limited` z `Retry-After`, a inni użytkownicy (także z tego samego adresu IP) nie są ograniczeni; po upływie okna żądania znów przechodzą.

**AC2 — Co się liczy**
- Zakładając limit wspólny dla wszystkich operacji wymagających sesji (zapisy i odczyty)
- Gdy użytkownik wysyła żądania odrzucone walidacją (400) lub brakiem uprawnień (403)
- Wtedy są liczone tak samo jak udane; żądania bez ważnej sesji (401) i operacje anonimowe nie zużywają limitu żadnego użytkownika (chroni je limit per IP), a `GET /api/health` nie jest liczony.

**AC3 — Bez wpływu na istniejące limity**
- Zakładając limity wyszukiwań (60/min na użytkownika i kubełek), limit per IP i licznik masowego odczytu (P10)
- Gdy dodano nowy limit
- Wtedy ich progi, odpowiedzi i testy się nie zmieniają; żądanie wyszukiwania liczy się do nowego limitu, a przekroczenie którejkolwiek granicy daje `429` (bez podwójnego liczenia odrzuconych `429`).

**AC4 — Testy i kontrakt**
- Zakładając zegar kontrolowany w testach
- Gdy sprawdzam okno minutowe i jego reset
- Wtedy testy `EVM-082 AC#` pokrywają granice (299/300/301), reset okna, niezależność dwóch użytkowników i brak liczenia 401; `429` z `Retry-After` jest opisane w kontrakcie wszystkich operacji wymagających sesji (`api-guidelines.md` → Limity zaktualizowane o zakres limitu).

## Poza zakresem
- Limity per IP i wyszukiwania (bez zmian); konfiguracja limitów z poziomu panelu; limit rozproszony między wieloma instancjami (licznik w pamięci procesu, jak pozostałe limity — przy skalowaniu poziomym osobna decyzja).
- Osobne, niższe limity dla wybranych zapisów; obsługa `429` w UI poza istniejącym komunikatem błędu.

## Decyzje i ograniczenia
- Obszar ryzyka: bezpieczeństwo (nadużycia, SR-API-02, TM-22). Wartość 300/min to ADR-0004; zmiana wartości wymaga zmiany ADR.
- Decyzja D5 (2026-10-13, Konrad — przekazana przez orkiestratora): limit obejmuje wszystkie żądania z sesją, także odczyty (zgodnie z ADR-0004; inaczej odczyty, ścieżka masowego pobierania, zostałyby bez limitu na użytkownika).
- Mobile/synchronizacja (M2): partia ≤ 50 mutacji liczy się jako jedno żądanie; wartość 300/min trzeba ponownie ocenić przy EVM synchronizacji.

## Dziennik
- 2026-10-08 — utworzono (propozycja z przeglądu EVM-022)
- 2026-10-13 — refinement: zakres limitu (odczyty + zapisy wg ADR-0004), co się liczy, brak liczenia 401 i `health`; tytuł uogólniony (product-owner)
- 2026-10-13 — draft → ready: AC i decyzje (D1–D5) zaakceptowane przez Konrada (refinement przed kolejką nocną)
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka pełna, model sonnet, gałąź `feature/EVM-082-limit-na-uzytkownika` ułożona na EVM-079 → EVM-080 → EVM-078 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — implementacja (backend-developer): limit 300/min na użytkownika w `decideAccess` (klucz — userId, `consumeSubject`, kubełek `user`), `429` w kontrakcie `listAssignableUsers` + generyczny test kontraktu, testy `EVM-082 AC1–AC4`, dokumentacja (api-guidelines, TM-22, SR-API-02, CHANGELOG)
