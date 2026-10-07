---
id: EVM-020
title: Klient w nowym zleceniu — wyszukiwanie i dodanie
type: story
milestone: M1
epic: E2 Klienci
status: done
path: pelna
priority: P1
owner: backend-developer
contributors: [web-developer, security-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-017]
---

# EVM-020: Klient w nowym zleceniu — wyszukiwanie i dodanie

## Historyjka
Jako **pracownik biura** chcę **w formularzu nowego zlecenia znaleźć istniejącego klienta albo dodać nowego**, aby **nie przepisywać danych, które system już zna, i nie tworzyć duplikatów**.

## Kontekst
- Część „utworzenia zlecenia” ze ścieżki pionowej: sekcja „1. Klient” i dialog „Dodaj klienta” w [W-05](../../ux/flows/02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie). Od tej historyjki W-10 ma przycisk „Nowe zlecenie” (A, E), a W-05 rośnie w EVM-021 (lokalizacja) i EVM-022 (szablon i zapis).
- Model: `Customer` (moduł `customers`), wyszukiwanie z polskimi znakami (`api-guidelines.md` → „Filtrowanie i sortowanie z polskimi znakami”), idempotencja (→ „Idempotencja”).
- Scenariusze: A1, C1 (nowy klient), B1, D4 (istniejący klient z comboboxu), D4′.

## Kryteria akceptacji
**AC1 — Wyszukiwanie klienta (SR-API-04)**
- Zakładając klientów „Jan Przykładowy” (Łódź) i „Firma Testowa sp. z o.o.”
- Gdy w sekcji „Klient” wpisuję co najmniej 3 znaki, np. „Lodz” albo „przykl”
- Wtedy panel wysyła `POST /api/v1/customers/search` z frazą w treści (nie w URL, nie w tytule karty, nie w logach), a wyniki pokazują nazwę wyświetlaną i telefon; wielkość liter i polskie znaki nie mają znaczenia; fraza krótsza niż 3 znaki nie jest wysyłana (API zwraca dla niej `400 validation_failed`, kod `too_short`).

**AC2 — Dodanie klienta (SR-INPUT-01, SR-DATA-02)**
- Zakładając brak wyników i „Dodaj klienta”
- Gdy wypełniam dialog: osoba (imię, nazwisko) albo firma (nazwa, NIP opcjonalnie, osoba kontaktowa), telefon, e-mail opcjonalnie, adres korespondencyjny opcjonalnie, notatki
- Wtedy telefon jest normalizowany do E.164, e-mail zapisany małymi literami, błędy pokazują się pod polami, przy notatkach jest podpowiedź „Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.”, a zapisany klient jest wybrany w formularzu.

**AC3 — Podobny klient**
- Zakładając istniejącego klienta z telefonem +48 600 000 001
- Gdy w dialogu wpisuję ten telefon albo to samo nazwisko
- Wtedy widzę „Podobny klient: Jan Przykładowy · +48 600 000 001 [Wybierz tego klienta]” — tylko spośród klientów dostępnych dla mojej roli.

**AC4 — Ponowienie bez duplikatu (idempotencja)**
- Zakładając dodanie klienta przerwane błędem sieci po wysłaniu
- Gdy ponawiam zapis
- Wtedy panel wysyła to samo `id` (UUIDv7) i ten sam `Idempotency-Key`, powstaje jeden klient, a odpowiedź ma `Idempotent-Replayed: true`; ten sam klucz z inną treścią zwraca `422 idempotency_mismatch`, żądanie równoległe — `409 idempotency_in_progress`, istniejące `id` — `409 id_conflict`.

**AC5 — Walidacja serwera (SR-AUTHZ-04)**
- Gdy żądanie zawiera pole spoza schematu albo pole kontrolowane przez serwer (`searchText`, `createdAt`, `version`)
- Wtedy API zwraca `400 validation_failed` (dla pól serwera — kod `read_only_field`); przekroczone limity długości (np. nazwa > 200) — `400`.

**AC6 — Limity wyszukiwania (SR-API-02, P10)**
- Zakładając 60 wyszukiwań w ciągu minuty
- Gdy wysyłam 61.
- Wtedy API zwraca `429 rate_limited` z `Retry-After`, a wyniki wyszukiwań wliczają się do progu masowego odczytu z EVM-017.

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wyszukuje i dodaje klienta
- Wtedy A i E wyszukują i dodają; R wyszukuje, a dodanie zwraca `403 forbidden` (R nie ma przycisku „Nowe zlecenie”); niezalogowany dostaje `401`; klient usunięty (soft delete) nie jest znajdowany przez E i R.

**AC8 — Stany**
- Wtedy: brak wyników — „Brak wyników dla „…”. [Dodaj klienta]”; ładowanie — Skeleton 3 wierszy; offline — „Wyszukiwanie wymaga połączenia.”, dane dialogu zostają w pamięci karty; błąd serwera — komunikat § 6.4; `429` — „Zbyt wiele zapytań…”; formularz W-05 ma szkic w pamięci karty („Szkic w tej karcie · 14:05”).

## Poza zakresem
- Lista i szczegóły klientów (W-14) — EVM-039. Usuwanie i anonimizacja — EVM-041.
- Scalanie duplikatów — poza v1. Szybkie dodanie klienta z telefonu — M2.

## UX / UI
- W-05 sekcja „1. Klient” (Combobox § 3.3 z akcją „Dodaj klienta”), dialog „Dodaj klienta” (Dialog § 3.13, `size.dialog.width.md`, radio Osoba/Firma, Disclosure [P-2] „Adres korespondencyjny”), InlineAlert „Podobny klient”.
- Stany: AC8. Brak uprawnień: R nie widzi „Nowe zlecenie”; wejście z linku — `403` „Nie możesz tworzyć zleceń.”.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wyszukiwanie, dodanie |
| Edytor | wyszukiwanie, dodanie |
| Tylko odczyt | wyszukiwanie (bez dodania) |
| Niezalogowany | brak (`401`) |

- Dane: `Customer` — DO-K (imię, nazwisko, firma, NIP, osoba kontaktowa, telefon, e-mail, adres, notatki).
- W AC: SR-API-04, SR-INPUT-01, SR-DATA-02, SR-AUTHZ-04, SR-API-02, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-03 (wzorce trigramowe z escapowaniem), SR-INPUT-05 (NFC, zwykły tekst), SR-WEB-03 (wyniki jako tekst), SR-DATA-01 (potwierdzenie klasyfikacji `Customer` w `domain-model.md` i inwentaryzacji w `rodo.md` — `security-engineer`), SR-DATA-03, SR-API-05. Polityka P10.

## Notatki techniczne
- Moduły: `customers` (+ `platform`: idempotencja, wyszukiwanie) + panel.
- Zdolności przekrojowe wprowadzane tutaj: rozszerzenia `unaccent` i `pg_trgm`, funkcja `f_unaccent`, kolumna `search_text`; pierwsze `id` UUIDv7 nadawane przez klienta; `Idempotency-Key` i `IdempotencyRecord` (retencja 30 dni).
- Klient zapisywany osobnym żądaniem; `CreateWorkOrder` (EVM-022) przyjmuje istniejące ID. Kolacja ICU `pl-PL` bazy — z EVM-007/EVM-008.
- Test „Lodz” → „Łódź” obowiązkowy. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
- Dług techniczny: sprzątanie wygasłych `idempotency_records` (retencja 30 dni) wymaga zadania z jobem pg-boss — ID zadania do nadania przez product-ownera; do tego czasu odczyt filtruje po `expires_at`, a wygasły rekord jest nadpisywany, więc tabela tylko rośnie (`evia_app` nie ma `DELETE`).
- Ogólny limit 300 żądań/min/użytkownika (P10) nie jest egzekwowany; tworzenie klientów przez Edytora ogranicza dziś tylko 1200/min/IP — do backlogu, bez wpływu na AC.

## Notatki
- Błąd graniczny: imię i nazwisko po 200 znaków dają `display_name` 401 znaków > `maxLength: 400` → `internal_error` (500) zamiast 400; poprawić limity pól albo kontrakt.
- Dług: brak zadania sprzątania wygasłych `idempotency_records` (retencja M4) — dopisać ID do backlogu; limity i licznik masowego odczytu w pamięci procesu.
- `search` bez `cursor`/`limit` (stałe 20, `nextCursor: null`) — świadome YAGNI; „podobny klient” dopasowuje frazę w całym `search_text`, nie tylko po nazwisku (możliwe fałszywe trafienia).
- Fasada `CustomerDirectory` przeniesiona do EVM-022; sekcje „Plan techniczny” i „Decyzje” do uzupełnienia z dziennika.
- E2E panelu na mock-api; ścieżka na żywym API do rozważenia przy EVM-021/022.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-020 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane; klasyfikacja i inwentaryzacja danych potwierdzone (SR-DATA-01)
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-07 — ready → in-progress (/deliver; ścieżka pelna: dane osobowe klientów, uprawnienia, nowe endpointy i UI; gałąź feature/EVM-020-customer-in-work-order)
- 2026-10-07 — API gotowe (backend-developer): kontrakt, moduł `customers`, idempotencja, limit 60/min, migracje 0011–0012; panel W-05 — krok web-developera
- 2026-10-07 — panel W-05 gotowy (web-developer): sekcja „1. Klient”, dialog „Dodaj klienta”, szkic w pamięci karty, komponenty `Combobox`, `Dialog`, `RadioGroup`, `TextArea`, `Disclosure` w `@evia/ui-web`; zrzuty w `docs/ux/reviews/EVM-020/`
- 2026-10-07 — SR-DATA-01 potwierdzone (security-engineer): klasyfikacja `Customer` i `IdempotencyRecord` w `domain-model.md`, inwentaryzacja i retencja w `rodo.md`; SR-API-05 w `requirements.md`, wpis EVM-020 w `threat-model.md` (bez nowych RR)
- 2026-10-07 — bramki i przeglądy zaliczone (QA pass; runda 1: security i ux — changes, runda 2: approve; code-reviewer approve); orkiestrator: pnpm run gate EXIT 0, coverage:diff linie 99,5% / gałęzie 94,7%; → in-review
- 2026-10-07 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,44 mln tokenów subagentów, 15 agentów, 478 wywołań narzędzi, 2 rundy, ok. 91 min; ścieżka pelna; vs baseline: brak danych
- 2026-10-07 — zaakceptowane przez Konrada, scalone do main (PR #27) → done
