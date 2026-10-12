---
id: EVM-033
title: Szybkie dodanie strony przy etapie z podpowiedzią z lokalizacji
type: story
milestone: M1
epic: E4 Procesy i etapy
status: done
priority: P1
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
depends_on: [EVM-032]
---

# EVM-033: Szybkie dodanie strony przy etapie z podpowiedzią z lokalizacji

## Historyjka
Jako **pracownik biura** chcę **przy „Czekamy na…” od razu widzieć OSD i zarządcę tej lokalizacji, a brakującą stronę dodać bez wychodzenia z dialogu**, aby **ustawić oczekiwanie w kilka sekund, mimo że w M1 nie ma osobnego ekranu stron**.

## Kontekst
- Kandydat P1 z EVM-004 (decyzja 5): szybkie dodanie strony z comboboxu z podpowiedzią z lokalizacji; korzystają z niego B5, C3, C4 (oraz B1, C1 — w W-05 przez EVM-021).
- Makieta: [W-07](../../ux/flows/04-aktualizacja-etapu.md#w-07-zmiana-statusu-etapu) — „Podpowiedzi z lokalizacji”, „+ Dodaj stronę” (formularz jak w W-05, w miejscu dialogu).
- Domyślne „na kogo czekamy” z szablonu etapu (`defaultWaitingOn`, `defaultWaitingOnPartyKind`) — podpowiedź UI, nie automatyka.

## Kryteria akceptacji
**AC1 — Podpowiedzi z lokalizacji**
- Zakładając zlecenie w lokalizacji z OSD „Stoen Operator” i zarządcą „Wspólnota Mieszkaniowa „Zielony Dziedziniec””
- Gdy otwieram „Czekamy na…” i wybieram „Stronę”
- Wtedy na górze listy są te dwie strony (z rodzajem), a poniżej wyszukiwanie wszystkich stron.

**AC2 — Domyślny wybór z szablonu etapu**
- Zakładając etap „Warunki przyłączenia i projekt umowy” z domyślnym oczekiwaniem na stronę rodzaju OSD
- Gdy otwieram „Czekamy na…”
- Wtedy zaznaczona jest „Stronę” i OSD tej lokalizacji (z `check`), a użytkownik może wybrać inną stronę albo klienta.

**AC3 — Dodaj stronę w miejscu dialogu**
- Zakładając brak potrzebnej strony (np. rzeczoznawca ppoż)
- Gdy wybieram „+ Dodaj stronę”
- Wtedy formularz strony (rodzaj podpowiedziany z szablonu etapu, forma, nazwa, kontakt, notatki z ostrzeżeniem) zastępuje treść dialogu (bez dialogu na dialogu), a po zapisie wracam do „Na kogo czekamy?” z nową stroną wybraną; ponowienie zapisu nie tworzy duplikatu.

**AC4 — Lokalizacja bez stron**
- Zakładając lokalizację bez OSD i zarządcy
- Gdy otwieram „Czekamy na…”
- Wtedy nie ma sekcji podpowiedzi, jest tylko wyszukiwanie i „+ Dodaj stronę”.

**AC5 — Strony niedostępne (SR-INPUT-02)**
- Zakładając stronę usuniętą (soft delete)
- Gdy otwieram podpowiedzi
- Wtedy strona nie jest podpowiadana, a wysłanie jej identyfikatora zwraca błąd walidacji.

**AC6 — Uprawnienia i stany (SR-AUTHZ-05)**
- Wtedy A i E korzystają z podpowiedzi i dodają strony; R nie ma menu etapu, a utworzenie strony zwraca mu `403 forbidden`; niezalogowany — `401`; offline — „Dodaj stronę” wyłączone, wpisane dane zostają; błąd zapisu strony — komunikat, dane zostają.

## Poza zakresem
- Osobny ekran listy stron i książka kontaktów — M3. Edycja strony — EVM-036.

## UX / UI
- W-07: Combobox (§ 3.3) z grupą „Podpowiedzi z lokalizacji”, formularz „Dodaj stronę” (pola z W-05). Stany: AC4, AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | podpowiedzi, dodanie strony |
| Edytor | podpowiedzi, dodanie strony |
| Tylko odczyt | brak menu etapu (`403` przy utworzeniu strony) |
| Niezalogowany | brak (`401`) |

- Dane: `Party` (DO-3 dla osób fizycznych i kontaktowych).
- W AC: SR-INPUT-02, SR-AUTHZ-05. W sekcji: SR-DATA-02 (ostrzeżenie przy notatkach), SR-API-05.

## Notatki techniczne
- Panel składa podpowiedź z danych karty „Lokalizacja” W-06 — moduł `procedures` nie zależy od `sites` (konsultacja `solution-architect`, C). Utworzenie strony — operacja z EVM-021.
- Moduły: panel (główna praca), `parties` (bez zmian w API, jeśli wystarczy operacja z EVM-021).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Tylko panel — bez zmian w API, kontrakcie i migracjach (wystarczą `searchParties`, `createParty`, `getParty`, `getWorkOrderSite`, `listProcedureTemplates`, `transitionProcedureStage`, `updateProcedureStage`). Podpowiedzi składa `buildWaitingHints` z karty Lokalizacja (ten sam klucz zapytania co karta); `PartyPicker` dostaje grupę „Podpowiedzi z lokalizacji”, `StageDialog` — domyślny wybór z szablonu i widok „Dodaj stronę” w miejscu okna (idempotencja przez `useAttempt`). Pełny plan: `.scratch/EVM-033/plan.md` (roboczy).

## Decyzje
- Rodzaj OSD wynika z pola karty, rodzaj zarządcy z `getParty` (tylko `kind`, `gcTime: 0`); alternatywa — `kind` w `SitePartyRef` (zmiana kontraktu) odłożona (zob. uwagi).
- Domyślny wybór z szablonu jest stosowany raz i tylko do pierwszej zmiany pól użytkownika; otwarcie okna niczego nie wysyła.
- AC5 i AC6 po stronie API mapują się na istniejące testy: `parties-create.test.ts` (macierz ról `createParty`, `id_conflict`), `parties-search.test.ts`, `procedure-stage-transitions.test.ts` (`unknown_party`); nowych testów API nie dodano.

## Uwagi do rozważenia
- (minor, UX) po wyborze podpowiedzi strona widnieje dwa razy (radio i linia „Strona: …”); w widoku „Dodaj stronę” brak kontekstu etapu; komunikat sukcesu w tonie ostrzegawczym; powód wyłączenia offline tylko w `title`; etykieta „Dodaj stronę: Strona” tautologiczna.
- (minor) `getParty` zarządcy pobiera cały rekord (DO-3) tylko po `kind` — rozważyć `kind` w `SitePartyRef` (kontrakt) przy EVM-036/M3; `useWaitingHints` (3 zapytania) wołany w każdym wierszu etapu.
- (minor) `party-picker.tsx:112`: przycisk „Dodaj stronę” po wyborze strony zależy od `suggestions.length > 0` (niejawny proxy na dialog etapu).
- (nit) eksploracja QA na mocku API w e2e, bez pełnego stosu z PostgreSQL (zgodnie z CLAUDE.md).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-033 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-12 — ready → in-progress: start realizacji (/deliver), ścieżka pelna (3 recenzentów wyklucza lekką), gałąź feature/EVM-033-szybkie-dodanie-strony
- 2026-10-12 — plan gotowy (web-developer)
- 2026-10-12 — implementacja panelu gotowa (web-developer): podpowiedzi z lokalizacji, domyślny wybór z szablonu, „Dodaj stronę” w miejscu okna; bez zmian w API i kontrakcie
- 2026-10-12 — bramka lokalna zielona (backend-developer): pnpm run gate 0, pokrycie zmienionego kodu 100% linii / 98,1% gałęzi; brak zmian w API (AC5/AC6 pokryte istniejącymi testami API)
- 2026-10-12 — przegląd (runda 1): code-reviewer, security-engineer i ux-designer approve; blocker/major: 0; bez rund poprawek
- 2026-10-12 — bramka orkiestratora: `pnpm run gate` zielony (exit 0), coverage:diff linie 100% / gałęzie 98,1%; pełne e2e Chromium + Firefox: 602 passed, 14 skipped (istniejące pominięcia Firefoksa), 0 failed
- 2026-10-12 — Koszt: brak rozbicia w $ (sesja bez odczytu `/cost`); agenci workflow 8 wywołań, ok. 0,67 mln tokenów subagentów, 194 wywołania narzędzi, ok. 48 min; rundy poprawek 0; ścieżka pelna; model z definicji agentów; vs baseline — nie do porównania w $ (najtańsza z ostatnich czterech: EVM-037 1,55 mln, EVM-038 1,02 mln, EVM-035 1,94 mln)
- 2026-10-12 — in-progress → in-review: czeka na demo i akceptację Konrada
- 2026-10-12 — demo zaakceptowane przez Konrada; PR #57 scalony (squash, `66acc4c`); in-review → done
