---
id: EVM-096
title: "API: dziennik zmian i pobieranie zmian (zlecenia, klienci, lokalizacje)"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: in-review
priority: P0
path: pelna             # synchronizacja offline, migracja, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-090, EVM-094]
---

# EVM-096: API — dziennik zmian i pobieranie zmian

## Cel
Jako **technik** chcę **pobrać swoje zlecenia z klientami i lokalizacjami na telefon i dostawać tylko zmiany od ostatniego razu**, aby **widzieć je bez zasięgu**. Pierwszy plasterek „pull” (ADR-0008): dziennik zmian `sync.change_log`, kursor, `GET /api/v1/sync/changes` dla `WorkOrder`, `Customer`, `Site`. Pozostałe encje i wejście/wyjście z zakresu: EVM-097.

## Kryteria akceptacji

**AC1 — Dziennik zmian w tej samej transakcji**
- Zakładając zmianę zlecenia, klienta lub lokalizacji (także soft delete i trwałe usunięcie)
- Gdy transakcja się zatwierdza
- Wtedy generyczny wyzwalacz bazy zapisuje wiersz (`seq`, `txid`, typ, identyfikator, operacja `upsert`/`delete`, kotwica zlecenia) bez danych osobowych, pomijając UPDATE bez zmiany; aplikacja może dziennik tylko czytać (nie sfabrykuje ani nie skasuje wiersza); test kompletności (fail-closed) czerwieni się, gdy tabela z zakresu synchronizacji nie ma wyzwalacza ani wpisu na liście wykluczeń; istniejące endpointy działają bez zmian (testy regresji).

**AC2 — Pierwsze pobranie i projekcja**
- Zakładając Edytora z zarejestrowanym urządzeniem
- Gdy pobiera zmiany bez kursora
- Wtedy dostaje migawkę stronicowaną po agregatach: zlecenia niezamknięte i zamknięte ≤ N dni (N z konfiguracji, domyślnie 30, filtr także po stronie serwera) wraz z bieżącym stanem klienta i lokalizacji, w projekcji z jawnej listy dozwolonych pól (serializer odrzuca pola spoza listy; odpowiedź walidowana schematem kontraktu), a pozycja dziennika jest zapamiętana przed migawką; test negatywny waliduje KAŻDĄ stronę ścisłą walidacją projekcji (`assertSyncProjectionStrict` z `@evia/contracts`, zero pól spoza projekcji), a nie przez `SyncChangesResponse` (Zod usuwa dodatkowe pola i test nic by nie wykrył): e-mail, NIP, adres korespondencyjny, notatki klienta, PPE, płatności i audyt nie występują w żadnej stronie; projekcje czytane partiami (stała liczba zapytań na stronę).

**AC3 — Kursor**
- Zakładając kursor z poprzedniej odpowiedzi
- Gdy pobieram dalej
- Wtedy dostaję tylko późniejsze zmiany; kursor jest nieprzezroczysty, uwierzytelniony i powiązany z użytkownikiem, urządzeniem i wersją reguły zakresu, bez danych osobowych; cudzy lub zmodyfikowany daje `400 invalid_cursor`, a niedekodowalny z innych powodów (starszy niż 90 dni, po rotacji klucza) daje `resync_required`.

**AC4 — Poprawność przy równoległych transakcjach**
- Zakładając dwie transakcje o przeplecionych `txid` i `seq` (scenariusz 6)
- Gdy pobieram z `limit = 1` i z kilkoma zmianami w jednej transakcji, także ze znacznikiem usunięcia
- Wtedy żadna zmiana nie ginie i nie dubluje się (deterministyczny test na PostgreSQL w kontenerze); pula API ma limity czasu transakcji (30 s) i bezczynności w transakcji (10 s).

**AC5 — Uprawnienia przy każdym odczycie**
- Zakładając role Administrator, Edytor, Tylko odczyt, niezalogowany oraz unieważnione urządzenie
- Gdy wywołują pobieranie
- Wtedy A i E dostają zakres według polityk, Tylko odczyt `403 channel_not_allowed`, niezalogowany `401`, unieważnione urządzenie `401 session_revoked`, urządzenie do wyczyszczenia `401 device_wipe_required`; obiekty bez dostępu nie są w odpowiedzi, a znaczniki `delete` dotyczą tylko obiektów wcześniej w zakresie urządzenia (`type` + `id`); odpowiedzi mają `Cache-Control: no-store`.

**AC6 — Resync**
- Zakładając kursor starszy niż 90 dni, flagę urządzenia albo ostatnie pełne pobranie sprzed 7 dni
- Gdy pobieram
- Wtedy odpowiedź to `resync_required` z powodem (m.in. `periodic`) bez danych.

**AC7 — Limity i obserwowalność**
- Zakładając `limit` > 500 (domyślnie 200) lub odpowiedź zbliżającą się do 1 MB
- Gdy pobieram
- Wtedy `limit` jest ograniczany, strona kończy się wcześniej przy ok. 900 KB (kursor na ostatnim w pełni dołączonym wierszu), a operator ma metryki: opóźnienie horyzontu (`sync_horizon_lag_seconds`), czas strony, liczbę `resync_required` wg powodu i odrzuconych kursorów.

**AC8 — Masowy odczyt (AB-08)**
- Zakładając pobranie pełne (bez kursora lub po resyncie)
- Gdy telefon je wykonuje
- Wtedy audyt zapisuje liczbę encji wg typu (bez danych osobowych); ponad limit pełnych pobrań na urządzenie na dobę (konfiguracja, domyślnie 3) odpowiedź to `429` z `Retry-After`, a zwykłe pobieranie zmian nie jest limitowane tym licznikiem; alerty operatora: „więcej niż 2 pełne pobrania urządzenia w 24 h” i „urządzenie pobiera zmiany od ponad 3 dni, nie wysyłając nic” (ten drugi dopiero z EVM-098 — tu tylko metryka bazowa); odczyty sync NIE zasilają licznika różnych klientów z EVM-039 (patrz „Decyzje”).

## Poza zakresem
Pozostałe encje (procesy, etapy, strony, zakres, przypisania, wpisy, użytkownicy, konfiguracja), `GET /sync/work-orders/{id}`, wyjście z zakresu przez utratę dostępu i `resync_required` przy zmianie roli lub reguły N (EVM-097); mutacje i kolejka wysyłki (EVM-098); media (E6, EVM-048); rola Monter (M4); UI aplikacji mobilnej (klient synchronizacji).

## Decyzje i ograniczenia
- Podstawa: ADR-0021 (Zaakceptowana 2026-10-27, Konrad) — wyzwalacz `sync.record_change`, resync „w cieniu”, kursor z listą kluczy; zależności EVM-090 i EVM-094 są `done`.
- **Do akceptacji (propozycja PO, 2026-10-29): odczyty sync nie zasilają licznika EVM-039** (różni klienci/60 min). Powód: jedno prawidłowe pierwsze pobranie obejmuje dziesiątki klientów i dawałoby stałe fałszywe alarmy; masowy odczyt przez telefon pokrywają osobne kontrole z AC8 (limit i alerty pełnych pobrań, audyt liczby encji, sesja urządzenia unieważnialna z EVM-095). Zapis nie powstrzymuje ryzyka kradzieży zarejestrowanego urządzenia — to ryzyko resztkowe.
- Wartości domyślne AC8 (3 pełne pobrania/dobę, alert > 2/24 h) i AC2/AC7 (N = 30, limit 200/500, 900 KB) to konfiguracja serwera, nie stałe w kodzie.
- Moduł `sync` (`apps/api/src/modules/sync/`, schemat `sync`): nic nie zależy od `sync` (nowa reguła granic modułów), a użycie portów systemowych przez `sync` wymaga rozszerzenia istniejącej reguły; kod SQL `sync` liczony w przebiegu integracyjnym.
- Migracje (schemat `sync`, wyzwalacze): przed startem sprawdzić najwyższy numer migracji na `main` (kolizja numeracji z równoległymi torami).
- Bezpieczeństwo i prywatność: klucz kursora z listą rotacji; brak nowego sekretu (rekomendacja: istniejący klucz).

## Notatki
- Znaczniki wyjścia z zakresu: tylko dla obiektów wcześniej w zakresie urządzenia (wyciek istnienia).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-29 — dopracowanie do DoR: ADR-0021 zaakceptowany, AC8 uczyniono testowalnym, rozgraniczenie z EVM-097, propozycja decyzji o liczniku EVM-039 (product-owner).
- 2026-10-29 — zaakceptowano przez Konrada: AC1–8, sync nie zasila licznika EVM-039, domyślne limity (3 pełne pobrania/dobę → 429, alert >2/24 h, N=30, strona 200/500, ~900 KB); status ready
- 2026-10-29 — zaimplementowano (backend-developer): migracja 0053, moduł `sync`, `GET /api/v1/sync/changes`; kod `forbidden` (nie `channel_not_allowed`) dla roli Tylko odczyt, jak w pozostałych operacjach kanału `mobile` (kontrakt EVM-090); `SYNC_CURSOR_KEYS` opcjonalny (pusty = klucz pochodny od `CURSOR_KEY`); status in-review
- 2026-10-30 — plan gotowy (backend-developer)
