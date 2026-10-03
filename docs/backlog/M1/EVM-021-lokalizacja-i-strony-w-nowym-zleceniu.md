---
id: EVM-021
title: Lokalizacja i strony w nowym zleceniu
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer, security-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-020]
---

# EVM-021: Lokalizacja i strony w nowym zleceniu

## Historyjka
Jako **pracownik biura** chcę **w formularzu nowego zlecenia wybrać istniejącą lokalizację albo opisać nową — z OSD i zarządcą, których mogę od razu dodać —** aby **zlecenie miało komplet danych miejsca bez osobnego ekranu stron**.

## Kontekst
- Sekcja „2. Lokalizacja” i dialog „Dodaj stronę” w [W-05](../../ux/flows/02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie). Edycja lokalizacji i stron po utworzeniu — EVM-036 (W-20).
- Model: `Site` (moduł `sites`, niezależna od klienta — D7), `Party` (moduł `parties`, OSD to `kind = distribution_system_operator` — D4).
- Scenariusze: A1 (nowa lokalizacja — dom), B1 (OSD — „Dodaj stronę”), C1 (garaż, miejsce 15, poziom −1, zarządca), D4 (lokalizacja istniejąca — wyszukanie po adresie).

## Kryteria akceptacji
**AC1 — Istniejąca lokalizacja (SR-API-04)**
- Zakładając lokalizację „ul. Testowa 7, 00-001 Warszawa, miejsce 15”
- Gdy wybieram „Istniejąca lokalizacja” i wpisuję co najmniej 3 znaki adresu, np. „testowa 7” albo „Lodz”
- Wtedy panel wysyła `POST /api/v1/sites/search` z frazą w treści, a wynik pokazuje typ obiektu, adres i numer miejsca; polskie znaki i wielkość liter nie mają znaczenia.

**AC2 — Nowa lokalizacja (SR-INPUT-01, SR-DATA-02)**
- Gdy wybieram „Nowa lokalizacja” i podaję typ obiektu, ulicę, numer budynku, numer lokalu (opcjonalnie), kod pocztowy, miasto, a dla garażu — numer miejsca i poziom, moc przyłączeniową w kW (opcjonalnie), PPE (opcjonalnie) i notatki
- Wtedy kod pocztowy jest walidowany (`NN-NNN`), moc — w dozwolonym zakresie, PPE ≤ 40 znaków, przy notatkach jest podpowiedź „Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów. Notatki zobaczą technicy w aplikacji.”, a lokalizacja zapisuje się osobnym żądaniem (`id` UUIDv7 i `Idempotency-Key`), niezależnie od klienta.

**AC3 — OSD i zarządca (SR-INPUT-02)**
- Gdy wybieram OSD i zarządcę z comboboxów stron
- Wtedy combobox OSD podpowiada tylko strony rodzaju OSD, a combobox zarządcy — administrację, zarządcę albo wspólnotę / spółdzielnię (`POST /api/v1/parties/search`); strona innego rodzaju wysłana w polu `…PartyId` zwraca `400 validation_failed`.

**AC4 — Dodaj stronę**
- Zakładając brak wyników w comboboxie OSD
- Gdy wybieram „Dodaj stronę” i podaję rodzaj (podpowiedziany z pola), formę (firma albo osoba fizyczna), nazwę, osobę kontaktową, telefon, e-mail i notatki (opcjonalnie)
- Wtedy strona zapisuje się (idempotentnie) i jest wybrana w polu, a przy notatkach jest ostrzeżenie jak w AC2.

**AC5 — Walidacja serwera (SR-AUTHZ-04)**
- Gdy żądanie zawiera pole spoza schematu, pole kontrolowane przez serwer albo przekroczony limit długości
- Wtedy API zwraca `400 validation_failed` (pola serwera — kod `read_only_field`).

**AC6 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wyszukuje i tworzy lokalizację oraz stronę
- Wtedy A i E wyszukują i tworzą, R wyszukuje, a tworzenie zwraca `403 forbidden`, niezalogowany dostaje `401`; lokalizacja i strona usunięte (soft delete) nie są znajdowane przez E i R; operacje są w macierzy ról.

**AC7 — Stany**
- Wtedy: brak wyników — „Nowa lokalizacja” / „Dodaj stronę”; offline — „Wyszukiwanie wymaga połączenia.”, wpisane dane zostają w pamięci karty; `429` (60 wyszukiwań/min) — „Zbyt wiele zapytań…”; błąd zapisu — komunikat § 6.4, dane zostają.

## Poza zakresem
- Edycja lokalizacji i stron, „Inne zlecenia w tej lokalizacji” — EVM-036. Podpowiedź lokalizacji klienta — EVM-043 (P2).
- Ładowarka w lokalizacji (`Charger`) — M4/M7 (luka L6; parametry urządzenia w pozycji zakresu).
- Książka kontaktów stron — M3.

## UX / UI
- W-05 sekcja „2. Lokalizacja” (radio „Istniejąca / Nowa”, Combobox § 3.3, TextField § 3.2 z sufiksem „kW”, Select typu obiektu), dialog „Dodaj stronę” (Dialog § 3.13).
- Stany: AC7; brak uprawnień — jak EVM-020.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wyszukiwanie, utworzenie lokalizacji i strony |
| Edytor | wyszukiwanie, utworzenie lokalizacji i strony |
| Tylko odczyt | wyszukiwanie |
| Niezalogowany | brak (`401`) |

- Dane: `Site` — DO-K (adres, numer miejsca, poziom, PPE, moc przyłączeniowa, notatki); `Party` — DO-3 dla osób fizycznych i osób kontaktowych.
- W AC: SR-API-04, SR-INPUT-01, SR-INPUT-02, SR-DATA-02, SR-AUTHZ-04, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-03, SR-INPUT-05, SR-API-02, SR-API-05, SR-WEB-03, SR-DATA-01 (klasyfikacja `Site` i `Party` w `domain-model.md` i inwentaryzacja w `rodo.md` — `security-engineer`), SR-DATA-03. Polityka P10.

## Notatki techniczne
- Moduły: `sites`, `parties` + panel.
- `search_text` dla `Site` i `Party` — ten sam mechanizm co EVM-020. Test „Lodz” → „Łódź”.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-021 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; klasyfikacja i inwentaryzacja danych potwierdzone (SR-DATA-01)
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
