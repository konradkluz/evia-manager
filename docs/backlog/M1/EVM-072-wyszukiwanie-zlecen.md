---
id: EVM-072
title: Wyszukiwanie zleceń, klient i lokalizacja na liście
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: done
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
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

- **Uwaga po EVM-034 (2026-10-13):** `POST /api/v1/work-orders/search` nie istnieje — w EVM-034 przeniesiono do modułu `overview` tylko `GET` listy. Wyszukiwanie powstaje w `overview` na projekcji `work_order_summaries` (polityka odczytu przez `workOrderReadCondition`, kursor z `asOf`, limity i licznik masowego odczytu P10 jak w liście).

## Plan techniczny
Szczegóły i uzasadnienia: sekcja „Decyzje” poniżej. Skrót:
1. **Kontrakt (najpierw):** `searchWorkOrders` (`POST /api/v1/work-orders/search`, treść ścisła, `x-evia-authz` A/E/R, `web`); `listWorkOrders` — addytywnie `siteType`, `templateId`; `WorkOrderListItem` — addytywnie `customer`, `site`.
2. **Migracja `0025` (expand):** kolumna generowana `work_orders.search_text` + indeks GIN `gin_trgm_ops` częściowy na `deleted_at IS NULL`.
3. **Fasady:** `WorkOrderDirectory.searchIds`, `CustomerDirectory.searchIds` / `displayNamesOf`, `SiteDirectory.searchIds` / `linesOf` — każda pod własną polityką odczytu; zbiory jako jeden parametr `uuid[]`.
4. **`overview`:** wspólny `WorkOrderPageService` dla listy i wyszukiwania (jedna ścieżka budowy elementu), `SearchWorkOrdersService` (limiter → walidacja → kursor → P10 `before` → fasady → `too_broad` → strona → `after` / `afterDistinct`), kontroler `POST`.
5. **Testy:** AC → `work-orders-list-customer-site.test.ts` (AC1, AC4), `work-orders-search.test.ts` (AC2, AC3, AC5, AC7), `work-orders-distinct-customers.test.ts` (P10), `work-orders-search-performance.test.ts` (AC6), `search-directories.test.ts`, `work-orders-migration.test.ts`; jednostkowe w `test/overview/`.

## Decyzje
- **D1 — brak kopii danych osobowych do projekcji (ADR-0017 W1, W6).** Wyszukiwanie to trzy zbiory identyfikatorów z fasad (zlecenia, klienci, lokalizacje) + `= ANY(uuid[])` w zapytaniu strony obok `workOrderReadCondition`; zbiory tylko zawężają. Projekcja używa istniejących kolumn `customer_id`, `site_id`, `site_type`, `source_template_id` — bez zmian i bez `rebuild`. `rodo.md`: nowe miejsce przechowywania danych nie powstaje (kolumna generowana w tej samej tabeli `work_orders`, klasa jak `title`; nadąża za zmianą i redakcją tytułu).
- **D2 — `search_text` zlecenia** (numer + tytuł) jest własnością `work-orders` (migracja `0025`, kolumna generowana).
- **D3 — klienci:** wyszukiwanie obejmuje to samo co `searchCustomers` (nazwisko, firma, NIP, cyfry telefonu, e-mail, miasto).
- **D4 — `too_broad`:** ponad 10 000 identyfikatorów z fasady → `400 validation_failed`, `/query`, `too_broad` — przed zapytaniem o projekcję (ADR-0017 W6).
- **D5 — licznik różnych klientów (P10):** lista (`GET`) i wyszukiwanie zasilają go klientami wymienionymi w odpowiedzi; lokalizacje nie.
- **D6 — filtry `siteType` / `templateId`** także w `GET` (AC4 — lista bez frazy); w adresie panelu ich nie ma (pamięć karty).
- **D7 — minimalizacja (security-engineer P1):** `site` na liście to `{ id, city, street, buildingNumber }` — bez kodu pocztowego i numeru lokalu (flows/07 „bez kodu pocztowego i miejsca postojowego”); pole można dodać później addytywnie.
- **D8 — „Klient usunięty” (security-engineer P2):** `customer` rozróżnia trzy stany: `{ id, displayName }`, `{ deleted: true }` (klient usunięty lub niewidoczny — bez `id` i nazwy) i `null` (zlecenie bez klienta); stan z braku wyniku `displayNamesOf` pod polityką klientów. Usunięty klient nie jest znajdowany po nazwisku, zlecenie — po numerze; lokalizacja zostaje.
- **D9 — kursor wyszukiwania:** osobny identyfikator operacji `searchWorkOrders`; fraza tylko jako skrót w `scope`.

## Uwagi do rozważenia
- (minor) `WorkOrderSearchRequest` bez `additionalProperties: false` (api-guidelines l. 244) — dopisać z kolejną zmianą kontraktu.
- (minor) D5: licznik różnych klientów P10 zasilany także zwykłym `GET` — ~13 stron listy w godzinę może dać alert `bulk_read_customers`; ocenić próg przy EVM-007/monitoringu.
- (minor) fraza z ≥ 3 cyfr (np. „0042”) jest przez fasadę klientów traktowana też jako cyfry telefonu — szersze trafienia niż sam numer zlecenia.
- (nit) zdublowane stałe `SEARCH_DELAY_MS` w panelu; niepokryte pojedyncze gałęzie (serwis wyszukiwania, TopBar, tabela).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-072 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-017 planu wstępnego)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-13 — ready → in-progress: start realizacji (/deliver), ścieżka pelna (8 AC i 3 recenzentów wykluczają lekką), gałąź feature/EVM-072-wyszukiwanie-zlecen
- 2026-10-13 — plan gotowy (backend-developer)
- 2026-10-13 — implementacja backendu (backend-developer): kontrakt, migracja `0025`, fasady, `POST /work-orders/search`, `customer` i `site` na liście, testy AC1–AC7; panel — krok web-developera
- 2026-10-13 — panel (web-developer): wyszukiwanie w W-10 i TopBar (fraza tylko w pamięci karty, `POST` z `gcTime: 0`), kolumny „Klient” i „Lokalizacja”, „Więcej filtrów”, stany AC8; testy Vitest i Playwright (Chromium, Firefox), zrzuty w `docs/ux/reviews/EVM-072/`
- 2026-10-13 — przegląd (2 rundy): runda 1 — code-reviewer i security-engineer approve, ux-designer changes_required (1 major); runda 2 — approve, blocker/major: 0
- 2026-10-13 — bramka orkiestratora: `pnpm run gate` zielony (exit 0), coverage:diff linie 99,6% / gałęzie 97,5%; pełne e2e Chromium + Firefox: 684 passed, 14 skipped, 0 failed; poprawione drobne braki dokumentacji (rodo.md: search_text zlecenia; martwe odwołanie do .scratch)
- 2026-10-13 — Koszt: brak rozbicia w $; agenci workflow 11 wywołań, ok. 1,43 mln tokenów subagentów, 492 wywołania narzędzi, ok. 1,8 h; rundy 2; ścieżka pelna; vs ostatnie: EVM-034 2,99 mln, EVM-035 1,94 mln, EVM-037 1,55 mln — poniżej średniej dla nowego endpointu z UI
- 2026-10-13 — in-progress → in-review: czeka na demo i akceptację Konrada
- 2026-10-13 — demo zaakceptowane przez Konrada; PR #61 scalony (squash); in-review → done
