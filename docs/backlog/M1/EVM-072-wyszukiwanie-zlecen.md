---
id: EVM-072
title: Wyszukiwanie zleceń, klient i lokalizacja na liście
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-018]
---

# EVM-072: Wyszukiwanie zleceń, klient i lokalizacja na liście

## Historyjka
Jako **pracownik biura** chcę **znaleźć zlecenie po numerze, tytule, nazwisku klienta albo adresie i widzieć na liście klienta z miejscem realizacji**, aby **odpowiedzieć klientowi przez telefon w kilka sekund**.

## Kontekst
- Wydzielona z EVM-017: wyszukiwanie po kliencie i adresie wymaga modułów `customers` i `sites` (EVM-020, EVM-021) i zleceń z klientem (EVM-022).
- Makieta: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) (wyszukiwanie, kolumna „Klient”, „Więcej filtrów”), TopBar „Szukaj zleceń…” (szkielet panelu), uwaga PO-6 z EVM-004 (miasto i ulica pod nazwą klienta) — makieta w EVM-071.
- `api-guidelines.md`: wyszukiwanie zleceń łączy wyniki fasad `customers` i `sites` (listy ID) z własnym `search_text` zlecenia — bez kopiowania danych osobowych do `work_orders`.

## Kryteria akceptacji
**AC1 — Klient i lokalizacja na liście**
- Zakładając zlecenia różnych klientów
- Gdy otwieram W-10
- Wtedy kolumna „Klient” pokazuje nazwę klienta, a pod nią miasto i ulicę lokalizacji (PO-6); na `breakpoint.wide` jest osobna kolumna „Lokalizacja”; dane są pobierane wsadowo raz na stronę (test licznika zapytań).

**AC2 — Wyszukiwanie (SR-API-04)**
- Zakładając zlecenie `ZL-2026-0042` klienta „Jan Przykładowy” w Łodzi przy „ul. Żółkiewskiego”
- Gdy wpisuję w pole wyszukiwania W-10 albo TopBar „0042”, „Garaż — pełny”, „przykladowy”, „zolkiewskiego” albo „Lodz”
- Wtedy panel wysyła `POST /api/v1/work-orders/search` z frazą w treści (nie w URL, nie w tytule karty, nie w logach), a wynik zawiera to zlecenie; fraza krótsza niż 3 znaki nie jest wysyłana.

**AC3 — Wyszukiwanie z filtrami i paginacją**
- Zakładając frazę i aktywny filtr statusu albo widok „Moje”
- Gdy wyszukuję
- Wtedy filtry łączą się z frazą, kursor jest w treści żądania, a zmiana frazy wraca na pierwszą stronę.

**AC4 — Więcej filtrów**
- Gdy w „Więcej filtrów” wybieram typ obiektu albo szablon
- Wtedy lista zawiera tylko pasujące zlecenia, a filtry są w pamięci karty (nie w URL).

**AC5 — Polityka i limity (SR-AUTHZ-03, SR-API-02)**
- Zakładając zlecenie usunięte (soft delete) i 60 wyszukiwań w ciągu minuty
- Gdy Edytor wyszukuje
- Wtedy usunięte zlecenie nie występuje w wynikach (warunek w zapytaniu), 61. wyszukiwanie zwraca `429 rate_limited`, a wyniki wliczają się do progu masowego odczytu (P10).

**AC6 — Wydajność**
- Zakładając 10 000 syntetycznych zleceń
- Gdy wyszukuję po nazwisku albo adresie
- Wtedy p95 czasu odpowiedzi API jest < 300 ms.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wyszukuje
- Wtedy A, E i R dostają wyniki, niezalogowany — `401`; operacja jest w macierzy ról.

**AC8 — Stany**
- Wtedy: brak wyników — „Brak zleceń spełniających filtry. [Wyczyść filtry]”; offline — pole wyszukiwania wyłączone z podpowiedzią „Wyszukasz po powrocie połączenia.”; `429` — „Zbyt wiele zapytań. Spróbuj ponownie za 1 min.”; tytuł karty bez frazy.

## Poza zakresem
- Wyszukiwanie pełnotekstowe (M4). Wyszukiwanie offline na telefonie (M2).

## UX / UI
- W-10: SearchField (§ 3.7), kolumna „Klient” z drugą linią lokalizacji, „Więcej filtrów” (Select § 3.3); TopBar — wyszukiwanie zleceń. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wyszukiwanie, filtry |
| Edytor | wyszukiwanie, filtry |
| Tylko odczyt | wyszukiwanie, filtry |
| Niezalogowany | brak (`401`) |

- Dane: nazwa klienta i adres (DO-K) — tylko w odpowiedzi, nigdy w URL.
- W AC: SR-API-04, SR-AUTHZ-03, SR-API-02, SR-AUTHZ-05. W sekcji: SR-INPUT-03 (escapowanie `%`, `_`, `\`), SR-DATA-03. Polityka P10.

## Notatki techniczne
- Moduły: `work-orders` (+ fasady `customers`, `sites`) + panel. Wartości filtrów — rozszerzenie enumów z EVM-017 (addytywnie).
- Test „Lodz” → „Łódź” obowiązkowy. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-072 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-017 planu wstępnego)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
