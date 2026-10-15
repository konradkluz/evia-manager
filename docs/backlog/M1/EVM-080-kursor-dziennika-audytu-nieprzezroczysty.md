---
id: EVM-080
title: Nieprzezroczysty kursor dziennika audytu i CURSOR_KEY tylko dla serwera
type: bug
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-review
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
Jako **właściciel systemu** chcę **by kursor paginacji dziennika audytu był nieprzezroczysty i uwierzytelniony tak jak kursor listy zleceń**, aby **spełnić SR-API-04 i `api-guidelines.md` → Paginacja oraz nie ujawniać ani nie pozwalać fałszować pozycji w dzienniku**. Dziś `GET /api/v1/audit/events` (EVM-029) zwraca kursor jako jawny base64url z czasem zdarzenia i `id`, a błędny kursor daje `400 validation_failed`; pozostałe listy (EVM-017 i kolejne) używają kursora szyfrowanego i uwierzytelnionego (AES-GCM, `CURSOR_KEY`, kod `invalid_cursor`). Drugi element: `loadConfig` wymaga `CURSOR_KEY` także dla `db:migrate`.

## Kryteria akceptacji

**AC1 — Kursor nieprzezroczysty**
- Zakładając, że dziennik ma więcej wpisów niż jedna strona (także przy domyślnym okresie, bez `from`/`to` w żądaniu, oraz z filtrami `action`, `actorUserId`, `outcome`)
- Gdy Administrator pobiera kolejne strony przez zwrócony `nextCursor`
- Wtedy kursor nie daje się odczytać prostym dekodowaniem (nie zawiera jawnie czasu ani `id`), a paginacja zwraca wszystkie wpisy bez duplikatów i luk, nawet gdy między stronami upłynął czas.

**AC2 — Sfałszowany, cudzy lub wygasły kursor**
- Zakładając kursor zmieniony, uszkodzony, wygasły, użyty z innymi filtrami niż wydany, wydany innemu użytkownikowi albo pochodzący z innej operacji (np. z listy zleceń lub klientów)
- Gdy wysyłam go do `GET /api/v1/audit/events`
- Wtedy odpowiedź to `400 invalid_cursor` (jak w pozostałych listach, `api-guidelines.md`), bez szczegółów kryptograficznych, a kontrakt opisuje ten kod; panel dalej obsługuje taki błąd jak dotąd (komunikat o odświeżeniu listy).

**AC3 — Uprawnienia bez zmian**
- Zakładając dziennik dostępny wyłącznie dla Administratora (z krokiem step-up, jak w EVM-029)
- Gdy Edytor, Tylko odczyt lub niezalogowany woła endpoint z kursorem albo bez
- Wtedy dostaje odpowiednio `403` lub `401` — jak dotąd, bez sprawdzania kursora; odczyt strony nadal zapisuje się w audycie tak jak w EVM-029.

**AC4 — Klucz tylko tam, gdzie potrzebny**
- Zakładając, że `CURSOR_KEY` nie jest ustawiony
- Gdy uruchamiam `pnpm --filter @evia/api run db:migrate`
- Wtedy migracje wykonują się poprawnie, a start serwera API bez (lub z błędnym) `CURSOR_KEY` kończy się czytelnym błędem konfiguracji, który nie wypisuje wartości klucza; worker i pozostałe polecenia CLI zachowują dotychczasowe wymagania.

**AC5 — Dokumentacja**
- Zakładając zmianę wymagań konfiguracji
- Gdy czytam `docs/ops` i `apps/api/README.md`
- Wtedy opisano, które polecenia wymagają `CURSOR_KEY` (serwer API, worker, CLI — tak; `db:migrate` — nie), że rotacja klucza unieważnia kursory, a `.env.example` pozostaje zgodny.

## Poza zakresem
- Rotacja `CURSOR_KEY`, zmiana algorytmu lub czasu życia kursora (30 min z kodeka); kursory innych list; konfiguracja klucza w środowiskach (EVM-084).
- Wymaganie klucza od workera i CLI — bez zmian (osobny dług: konfiguracja workera bez kluczy HTTP, EVM-024).

## Decyzje i ograniczenia
- Wzorzec do ponownego użycia: kodek kursora z EVM-017 (identyfikator operacji `listAuditEvents`, zakres = filtry, związanie z użytkownikiem, ważność). Uwaga na domyślny okres: `to` domyślnie = „teraz”, więc zakres kursora musi być stabilny między stronami (AC1) — rozwiązanie techniczne po stronie wykonawcy.
- Zmiana kodu błędu z `validation_failed` na `invalid_cursor` to zmiana kontraktu; jedyny klient to panel (audit-page obsługuje oba kody).
- Decyzja D3 (2026-10-13, Konrad — przekazana przez orkiestratora): kod błędu `invalid_cursor`; `CURSOR_KEY` zdejmujemy tylko z `db:migrate`, worker i CLI to osobny dług.
- Decyzja D4 (2026-10-13, Konrad — przekazana przez orkiestratora): kursory wydane przed zmianą stają się nieważne — akceptowalne (nie ma jeszcze produkcji).
- Przekazać `CURSOR_KEY` jako sekret serwera przy wdrożeniu (EVM-084). Obszar ryzyka: bezpieczeństwo (integralność paginacji audytu), konfiguracja sekretu.

## Notatki
- Przeglądy bez blocker/major; konsultacja security przed implementacją wymusiła limit kursora 512 (przy 256 każdy prawdziwy `nextCursor` byłby odrzucany).
- Otwarte minor (propozycje do backlogu): test granicy `loadMigrationConfig` skanuje źródła (szczegół implementacji); test kontraktu AC2 porównuje surowy YAML; podwójne parsowanie zapytania w `audit-read.service.ts` (kursor cudzy + zły zakres → `invalid_cursor` zamiast `validation_failed`).
- Nit: README API wymienia nieistniejące skrypty CLI `overview` / `process-run`; długa linia w `audit.yaml`; `api-guidelines.md` (`listAuditEvents`) bez rozróżnienia `validation_failed` / `invalid_cursor`; TM-107 w modelu zagrożeń bez dziennika audytu (security-engineer dopisze).
- QA bez ręcznej sesji eksploracyjnej (stos `dev` nieuruchomiony nocą) — zachowanie HTTP pokryte testami integracyjnymi na PostgreSQL.

## Dziennik
- 2026-10-07 — utworzono (product-owner; uwagi z przeglądów EVM-029 i EVM-017)
- 2026-10-13 — refinement: kod `invalid_cursor`, stabilność domyślnego okresu, zakres klucza (tylko `db:migrate`), uprawnienia w AC (product-owner)
- 2026-10-13 — draft → ready: AC i decyzje (D1–D5) zaakceptowane przez Konrada (refinement przed kolejką nocną)
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce nocnej (ścieżka pełna, model sonnet, gałąź `feature/EVM-080-kursor-audytu` ułożona na EVM-078 → EVM-053 — łańcuch nocny)
- 2026-10-14 — implementacja (backend-developer): kursor audytu przez wspólny kodek (`invalid_cursor`, `asOf` w kursorze, limit 512), `loadMigrationConfig` dla `db:migrate`, kontrakt, testy AC1–AC4 i dokumentacja AC5
- 2026-10-14 — potok `wf_e19c41c5-d5b` (przerwany ok. 02:45 w QA, wznowiony 07:25): passed w 1 rundzie (QA PASS AC1–AC5; code-reviewer i security-engineer APPROVE); orkiestrator: `pnpm run gate` zielony (diff-coverage linie 587/588, gałęzie 460/481), `docs:check` 0/0; in-progress → in-review
- 2026-10-14 — Koszt: brak rozbicia w $; ok. 6 wywołań agentów (plan, konsultacja security, implementacja, QA, 2 przeglądy), ok. 0,5 mln tokenów subagentów łącznie z przerwanym przebiegiem; rundy poprawek 0; ścieżka pełna; sonnet
