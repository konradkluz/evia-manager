---
id: EVM-018
title: Szczegóły zlecenia — nagłówek, klient, lokalizacja i zakres
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: done
path: pelna
priority: P1
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-022]
---

# EVM-018: Szczegóły zlecenia — nagłówek, klient, lokalizacja i zakres

## Historyjka
Jako **pracownik biura** chcę **zobaczyć szczegóły zlecenia — klienta, lokalizację i zakres z parametrami —** aby **mieć w jednym miejscu wszystko, co trzeba wiedzieć o zleceniu**.

## Kontekst
- Rozszerza nagłówek W-06 z EVM-022 o zakładkę „Przegląd”, karty boczne i zakres. Kolejne sekcje W-06 dochodzą z epikami: menu przejść (EVM-030), procesy (EVM-031), podsumowanie (EVM-034, EVM-056), dziennik (EVM-037), media (EVM-044), płatności (EVM-053).
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia). Model: `WorkOrder`, `ScopeItem` (parametry techniczne — D2), `Customer`, `Site`, `Party`.

## Kryteria akceptacji
**AC1 — Przegląd zlecenia**
- Zakładając zlecenie `ZL-2026-0042` klienta „Jan Przykładowy” w lokalizacji „ul. Testowa 7, 00-001 Warszawa, miejsce nr 15, poziom −1”
- Gdy otwieram je z listy albo z linku
- Wtedy widzę nagłówek (numer, tytuł, odznaka statusu, klient, adres, opiekun, data utworzenia), zakładki (w tej historyjce aktywna „Przegląd”) i kolumnę boczną: karta „Klient” (nazwa, telefon, e-mail) i karta „Lokalizacja” (typ obiektu, adres, miejsce i poziom, OSD, zarządca, moc przyłączeniowa, PPE, notatki).

**AC2 — Zakres z parametrami**
- Zakładając 9 pozycji zakresu z parametrami (np. ładowarka AC 11 kW, 3 fazy)
- Gdy otwieram sekcję „Zakres (9 pozycji)”
- Wtedy każda pozycja ma nazwę i parametry techniczne z polskimi etykietami (np. „AC, 11 kW, 3 fazy”), a nieznany zestaw albo wartość pokazuje odznakę wartości nieznanej [P-12].

**AC3 — Nie znaleziono (SR-AUTHZ-02)**
- Zakładając zlecenie nieistniejące, usunięte (dla Edytora i Tylko odczyt) albo pozycję zakresu zlecenia B pobieraną ścieżką zlecenia A
- Gdy otwieram szczegóły albo wysyłam żądanie
- Wtedy API zwraca `404 not_found`, a W-06 pokazuje „Nie znaleziono zlecenia. Mogło zostać usunięte albo nie masz do niego dostępu. [Wróć do listy]” bez danych z poprzedniego ekranu; tytuł karty „Nie znaleziono · EVia Manager”.

**AC4 — Notatki jako tekst (SR-WEB-03)**
- Zakładając notatki lokalizacji z treścią `<script>alert(1)</script>` i linkiem `javascript:alert(1)`
- Gdy wyświetlam kartę „Lokalizacja”
- Wtedy treść jest pokazana jako tekst, żaden skrypt się nie wykonuje, a aktywne są tylko linki `https:`, `tel:` i `mailto:`.

**AC5 — Minimalizacja i wydajność (SR-DATA-03)**
- Gdy pobieram szczegóły zlecenia
- Wtedy odpowiedzi zawierają tylko pola z kontraktu, dane klienta i lokalizacji pochodzą z fasad modułów (bez kopiowania do `work_orders`), a tytuł karty to „ZL-2026-0042 · EVia Manager” (bez nazwiska i adresu).

**AC6 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda otwiera szczegóły
- Wtedy A, E i R widzą wszystkie sekcje (R — bez akcji), niezalogowany dostaje `401`, a operacje odczytu są w macierzy ról z przypadkiem IDOR.

**AC7 — Stany**
- Wtedy: ładowanie — najpierw nagłówek, potem sekcje (Skeleton); błąd sekcji — alert w sekcji z „Spróbuj ponownie”, pozostałe sekcje działają; błąd całości — „Nie udało się wczytać zlecenia. [Spróbuj ponownie]”; offline — dane z pamięci karty z banerem „Dane mogą być nieaktualne (z 14:05)”; zlecenie bez pozycji — „Zlecenie nie ma jeszcze pozycji zakresu.”

## Poza zakresem
- „Przejdź do klienta” (W-14) — EVM-039; „Edytuj” w karcie „Lokalizacja” (W-20) i „Inne zlecenia w tej lokalizacji” — EVM-036; „Edytuj zakres” — EVM-035.
- Menu przejść zlecenia — EVM-030; procesy — EVM-031; podsumowanie — EVM-034 i EVM-056.
- Baner „Zlecenie założone w terenie” — M2 (E13).

## UX / UI
- W-06: nagłówek (`text.heading-1`), Tabs (§ 3.17), karty boczne (Card § 3.8), lista zakresu (List § 3.6), StatusBadge (§ 3.9) statyczna, [P-12]; responsywność wg makiety (medium — jedna kolumna, compact — karty pod sobą).
- Stany: AC3, AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | podgląd wszystkich sekcji |
| Edytor | podgląd wszystkich sekcji |
| Tylko odczyt | podgląd wszystkich sekcji, bez akcji |
| Niezalogowany | brak (`401`) |

- Dane: klient (DO-K), lokalizacja (DO-K, w tym PPE), strony (DO-3), parametry techniczne (bez danych osobowych).
- W AC: SR-AUTHZ-02, SR-WEB-03, SR-DATA-03, SR-AUTHZ-05. W sekcji: SR-AUTHZ-01.

## Notatki techniczne
- Moduły: `work-orders` (odczyt zlecenia i zakresu), fasady `customers`, `sites`, `parties` + panel (główna część pracy).
- W-06 składa SPA z endpointów zakotwiczonych w zleceniu, bez zbiorczego endpointu; dane z innych modułów wsadowo.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
- Przy EVM-039: reguła P10 „> 300 różnych klientów w 1 h” ma liczyć też `getWorkOrderCustomer` i `getWorkOrderSite` (karty nie zasilają dziś licznika; zalecenie security-engineer).
- `gone` w `work-order-page.tsx` nie jest powiązane z id zlecenia — po 404 nawigacja wstecz/dalej do innego zlecenia pokaże „Nie znaleziono”; powiązać z id i dodać test (przy EVM-030 / EVM-036).
- `listScopeItems` bez limitu — dodać `maxItems`/`limit` i test IDOR pojedynczej pozycji przy EVM-035; `header()` może pobierać klienta, lokalizację i opiekuna równolegle (`Promise.all`).
- E2E W-06 działa na mocku API; ręczny test na żywym stosie (API + baza + web) — przy demo.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-018 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-08 — ready → in-progress (/deliver; ścieżka pelna: dane osobowe klienta, uprawnienia, nowy endpoint i UI; gałąź feature/EVM-018-work-order-details)
- 2026-10-08 — implementacja (web-developer): kontrakt (4 odczyty), API (fasady `getCard` / `namesOf`), W-06 „Przegląd”, `Tabs` / `List` / `TextLink`; testy EVM-018 AC1–AC7 (API integracyjne, komponenty, E2E Chromium / Firefox / Edge, axe), zrzuty w `docs/ux/reviews/EVM-018/`
- 2026-10-08 — weryfikacja backendu (backend-developer): bramka lokalna `pnpm run gate` zielona (kontener Linux, integracja, pokrycie zmienionego kodu 100% linii / 96,7% gałęzi); bez zmian w kodzie
- 2026-10-08 — bramki i przeglądy zaliczone (QA pass; code-reviewer, security-engineer, ux-designer — approve; 1 runda); orkiestrator: pnpm run gate EXIT 0, docs:check 0/0, coverage:diff linie 100% / gałęzie 96,7%; → in-review
- 2026-10-08 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 0,90 mln tokenów subagentów, 8 agentów, 320 wywołań narzędzi, 1 runda, ok. 62 min; ścieżka pelna; vs baseline: brak danych
- 2026-10-08 — zaakceptowane przez Konrada, scalone do main (PR #34) → done
