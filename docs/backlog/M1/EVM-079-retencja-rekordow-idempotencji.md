---
id: EVM-079
title: Sprzątanie wygasłych rekordów idempotencji
type: enabler
milestone: M1
epic: E00 Fundamenty
status: done
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

## Notatki
- **Kolejność scalania (security, minor):** migracja `0032` (ta gałąź) musi trafić na `main` po `0028`–`0031` z łańcucha EVM-054 → EVM-057 — migrator Kysely działa w trybie ścisłej kolejności, odwrotna kolejność na bazie trwałej da „corrupted migrations”. Scalać łańcuch płatności przed tą gałęzią; do tego czasu nie uruchamiać `db:migrate` z tej gałęzi na bazach trwałych (dev Konrada). Nie włączać `allowUnorderedMigrations`.
- Ryzyko rezydualne (niskie, istniało wcześniej) do akceptacji Konrada: `evia_app` ma `UPDATE` na `platform.idempotency_records` (potrzebny od EVM-020), więc przejęta rola mogłaby przesunąć `expires_at` w przeszłość i usunąć rekord funkcją — do modelu zagrożeń przy zamknięciu kamienia (TM-22/TM-25).
- Nit security: indeks `expires_at` bez `CONCURRENTLY` — dziś pomijalne; przy dużych tabelach indeksy w osobnej migracji `CONCURRENTLY`.
- Test „rekord wygasa między przebiegami” uniezależniony od czasu rzeczywistego po przeglądzie (`0d9c6bf`).

## Dziennik
- 2026-10-07 — utworzono (product-owner; dług z EVM-020)
- 2026-10-13 — refinement: zadania w tle istnieją (EVM-034), ścieżka lekka z recenzentem security, harmonogram i porcje w AC (product-owner)
- 2026-10-13 — draft → ready: AC i decyzje (D1–D5) zaakceptowane przez Konrada (refinement przed kolejką nocną)
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka lekka, model sonnet, gałąź `feature/EVM-079-retencja-idempotencji` ułożona na EVM-080 → EVM-078 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — implementacja: zadanie `platform.purge-idempotency` (04:10 Warsaw, porcje 1000), migracja `0032` (funkcja `SECURITY DEFINER` bez ogólnego `DELETE`), testy `EVM-079 AC1–AC4` (backend-developer)
- 2026-10-14 — potok `wf_94338dfb-290`: passed po 1 rundzie (ścieżka lekka; security-engineer APPROVE — pierwsza funkcja `SECURITY DEFINER` z przypiętym `search_path`, `pnpm run scan` zielony, `rodo.md` zaktualizowany `a90ed56`)
- 2026-10-14 — orkiestrator: `pnpm run gate` zielony (diff-coverage linie 622/623, gałęzie 467/489), `docs:check` 0/0; in-progress → in-review
- 2026-10-14 — Koszt: brak rozbicia w $; potok 2 wywołania agentów, ok. 0,17 mln tokenów subagentów, ok. 40 min (+ stabilizacja testu); rundy poprawek 0; ścieżka lekka; sonnet
- 2026-10-15 — przed scaleniem: scalenie z łańcuchem płatności (rejestr migracji 0028–0031 przed 0032; testy migracji EVM-054/056 migrują tylko do swojej migracji `029005d`), test pustego wyniku `purgeBatch` (`f3e237b`; diff-coverage gałęzi 87,5% → 100%)
- 2026-10-15 — scalona do `main` (PR #76, `2573ffa`); in-review → done
