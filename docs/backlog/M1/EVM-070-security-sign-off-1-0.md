---
id: EVM-070
title: Security sign-off wydania 1.0
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: security-engineer
contributors: [devops-engineer]
reviewers: [solution-architect]
depends_on: [EVM-055, EVM-056, EVM-057, EVM-058, EVM-065]
---

# EVM-070: Security sign-off wydania 1.0

## Historyjka
Jako **właściciel produktu** chcę **sign-off bezpieczeństwa całego zakresu M1 — z płatnościami — przed wydaniem 1.0**, aby **wydanie spełniało kryteria wyjścia M1 i nie wprowadzało niesprawdzonych zmian na prod**.

## Kontekst
- Druga część podziału EVM-065 (konsultacja `security-engineer`, pkt 2b): przegląd zmian od sign-off pilota (głównie E7), DAST, ewentualny retest płatności (AB-17 — obejście korekt).
- Kryteria wyjścia M1 (roadmapa): security sign-off — brak otwartych Critical / High / Medium, MFA, czysty DAST baseline; backup odtworzony testowo.
- Wdrożenia prod między EVM-065 a tą historyjką przechodzą bramkę z EVM-065 AC7; przegląd zmian (AC1) obejmuje listy kontrolne tych wdrożeń. Pozycje P2 z nowymi operacjami wrażliwymi (EVM-052, EVM-060) trafiają na prod najwcześniej z tym sign-off albo po osobnym przeglądzie.

## Kryteria akceptacji
**AC1 — Przegląd zmian od pilota**
- Gdy przygotowuję sign-off
- Wtedy każde `SR-…` z epików M1 ma dowód (test, bramka, przegląd albo ćwiczenie), a każde odstępstwo jest ryzykiem zaakceptowanym przez Konrada.

**AC2 — Płatności (AB-17, SR-AUTHZ-10)**
- Wtedy testy ścieżek w grafie przejść płatności (EVM-053 — uczestnik przejść zlecenia, EVM-054, EVM-057, EVM-060) są przejrzane, a decyzja o zewnętrznym reteście płatności jest zapisana (rekomendacja do decyzji Konrada w momencie sign-off; zakup — osobna zgoda).

**AC3 — Skany i DAST (SR-SUPPLY-07)**
- Gdy kandydat 1.0 jest na staging
- Wtedy ZAP, Schemathesis i bramki CI nie mają ustaleń High ani Medium spoza wyjątków.

**AC4 — Odtworzenie i telemetria (SR-INFRA-07, SR-PRIV-09)**
- Wtedy test odtworzenia przed wydaniem (EVM-062) zakończył się sukcesem, a przegląd próbek telemetrii nie wykazał danych osobowych.

**AC5 — Model zagrożeń i ryzyka**
- Wtedy `threat-model.md` jest aktualny, a nowe ryzyka rezydualne mają decyzję Konrada.

**AC6 — Sign-off i decyzja**
- Wtedy raport sign-off zawiera werdykt i dowody, a wydanie 1.0 (wdrożenie prod) jest decyzją Konrada zapisaną w „Decyzje”.

## Poza zakresem
- MASVS i aplikacja mobilna — M2.

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (proces) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

- W AC: SR-AUTHZ-10, SR-SUPPLY-07, SR-INFRA-07, SR-PRIV-09. Ryzyka: RR-10.

## Notatki techniczne
- Raport w lokalizacji zgodnej z polityką dokumentów (np. `docs/qa/EVM-070/`).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC6 spełnione
- [ ] Przegląd: solution-architect — APPROVE
- [ ] `threat-model.md` i `CHANGELOG.md` zaktualizowane
- [ ] Decyzja Konrada o wydaniu 1.0

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-065 planu wstępnego — konsultacja security-engineer pkt 2)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): powiązanie z bramką wdrożeń w trakcie pilota (EVM-065 AC7)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): testy ścieżek płatności w EVM-053 i EVM-054 zamiast EVM-058 (AC2)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
