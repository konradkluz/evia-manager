---
id: EVM-043
title: Podpowiedź lokalizacji klienta w nowym zleceniu
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: in-progress
priority: P2
path: pelna
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-022]
---

# EVM-043: Podpowiedź lokalizacji klienta w nowym zleceniu

## Historyjka
Jako **pracownik biura** chcę **po wybraniu klienta od razu zobaczyć lokalizacje z jego poprzednich zleceń**, aby **przy kolejnym zleceniu tego samego klienta nie szukać adresu ręcznie**.

## Kontekst
- Kandydat P2 z EVM-004 (decyzja 5): podpowiedź lokalizacji klienta (scenariusz D4). Bez niej D4 działa przez wyszukiwanie po adresie (EVM-021), więc historyjka może przejść do M2/M3 (decyzja 11).
- Klient nie „posiada” lokalizacji — związek wynika ze zleceń (D7); podpowiedź korzysta z listy `work-orders` z filtrem `customerId` (ta sama polityka).
- Makieta: [W-05](../../ux/flows/02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie) sekcja „2. Lokalizacja” — podpowiedź do doprecyzowania przez `ux-designer` w przeglądzie.

## Kryteria akceptacji
**AC1 — Podpowiedź**
- Zakładając klienta z dwoma zleceniami w dwóch lokalizacjach
- Gdy wybieram go w sekcji „Klient”
- Wtedy sekcja „Lokalizacja” pokazuje „Lokalizacje z poprzednich zleceń klienta (2)” z adresem i typem obiektu, a wybór ustawia „Istniejąca lokalizacja”.

**AC2 — Klient bez zleceń**
- Gdy wybieram klienta bez zleceń
- Wtedy podpowiedzi nie ma, a sekcja działa jak w EVM-021.

**AC3 — Polityka (SR-AUTHZ-03)**
- Zakładając zlecenie klienta usunięte (soft delete) albo poza uprawnieniami
- Gdy pobieram podpowiedź
- Wtedy jego lokalizacja nie jest podpowiadana na podstawie tego zlecenia.

**AC4 — Uprawnienia i stany (SR-AUTHZ-05)**
- Wtedy podpowiedź mają A i E (R nie ma W-05), niezalogowany — `401`; offline — podpowiedź niedostępna, formularz działa jak w EVM-021.

## Poza zakresem
- Podpowiedź klienta po lokalizacji, pełna historia lokalizacji (M3).

## UX / UI
- W-05 sekcja „2. Lokalizacja”: lista podpowiedzi (List § 3.6) nad comboboxem. Stany: AC2, AC4.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | podpowiedź |
| Edytor | podpowiedź |
| Tylko odczyt | nie dotyczy (brak W-05) |
| Niezalogowany | brak (`401`) |

- Dane: adresy lokalizacji (DO-K) — tylko z zleceń dostępnych dla użytkownika.
- W AC: SR-AUTHZ-03, SR-AUTHZ-05.

## Notatki techniczne
- Moduły: panel, `work-orders` (lista z filtrem `customerId`), fasada `sites`. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Plan roboczy: `.scratch/EVM-043/plan.md` (nie jest częścią repozytorium). Skrót: `siteType` w liście przez fasadę `sites`; panel — hook `useSiteSuggestions` (jedno żądanie na klienta, bez ponowień) i komponent `SiteSuggestions` w `LocationSection`; wybór przez `getSite` z mapowaniem na dozwolone pola.

## Decyzje
- Podpowiedź obejmuje lokalizacje z **100 najnowszych zleceń** klienta (`limit=100`, `sort=-createdAt`, jedna strona, bez stronicowania) — świadome uproszczenie; przy kliencie z większą liczbą zleceń starsze lokalizacje znajdzie się wyszukiwarką (EVM-021). Pobranie 100 rekordów na wybór klienta mieści się w progu masowego odczytu P10 (2000 na 10 minut).
- Kontrakt rośnie addytywnie o `WorkOrderListSite.siteType` (kod słownika, wymagany; z fasady `sites` tą samą polityką co adres) — AC1 wymaga typu obiektu, a lista go nie niosła. Bez nowej operacji i migracji.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-043 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka pełna — dopisana przy starcie, 3 recenzentów wyklucza lekką; gałąź `feature/EVM-043-podpowiedz-lokalizacji` ułożona na EVM-082 → EVM-079 → EVM-080 → EVM-078 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — implementacja (web-developer): `siteType` w liście zleceń (kontrakt, fasada `sites`), podpowiedź lokalizacji w W-05, testy komponentu, integracyjne i E2E (Chromium, Firefox, Edge), zrzuty w `docs/ux/reviews/EVM-043/`
- 2026-10-14 — weryfikacja backendu (backend-developer): `siteType` przez fasadę `sites`, bramka `pnpm run gate` zielona (kod 0)
