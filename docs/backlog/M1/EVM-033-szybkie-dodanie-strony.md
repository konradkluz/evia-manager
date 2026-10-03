---
id: EVM-033
title: Szybkie dodanie strony przy etapie z podpowiedzią z lokalizacji
type: story
milestone: M1
epic: E4 Procesy i etapy
status: ready
priority: P1
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
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
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-033 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
