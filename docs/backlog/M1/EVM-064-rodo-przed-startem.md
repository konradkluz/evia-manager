---
id: EVM-064
title: RODO przed startem — umowy powierzenia, rejestr czynności, ćwiczenie naruszeń i runbooki
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: security-engineer
contributors: [product-owner, devops-engineer]
reviewers: [solution-architect]
depends_on: [EVM-061]
---

# EVM-064: RODO przed startem — umowy powierzenia, rejestr czynności, ćwiczenie naruszeń i runbooki

## Historyjka
Jako **właściciel produktu (administrator danych)** chcę **zamknąć formalności RODO i przećwiczyć procedury, zanim w systemie pojawią się dane klientów**, aby **firma była przygotowana na kontrolę, żądanie klienta i incydent**.

## Kontekst
- `docs/security/rodo.md` (checklista umów, rejestr czynności, procedura naruszeń 72 h, prawa osób), SR-PRIV-01, -02, -06, -07, -09, SR-DATA-07, SR-DATA-09, SR-AUTH-13 (runbook awaryjnego resetu MFA Administratora — kończy sesje; uwaga 3 z rundy 3 EVM-005).
- Decyzja 9: dane rejestrowe firmy i prawnik / IOD (w tym punkty 10 — transfery do USA i 11 — potrzeba DPIA z `rodo.md`). Warunek wejścia pilota realnego (README M1 → „Punkt pilota”, warunek 4).
- Przegląd `security-engineer` EVM-010: `rodo.md` rekomenduje uproszczoną DPIA przed startem produkcyjnym i weryfikację transferów do USA — AC1 i AC8.

## Kryteria akceptacji
**AC1 — Umowy powierzenia, dostawcy i transfery (SR-PRIV-06, art. 44–46 RODO)**
- Zakładając listę podmiotów przetwarzających z `rodo.md`
- Gdy zamykam checklistę
- Wtedy dla każdego dostawcy (m.in. Hetzner, Scaleway, Grafana Labs, Sentry, GitHub) jest zawarta umowa powierzenia albo udokumentowane zaakceptowane warunki, ustawione regiony UE i retencje — z datą weryfikacji
- Oraz dla dostawców z możliwym dostępem z USA (Sentry, Grafana Labs, GitHub) podstawa transferu jest sprawdzona — certyfikacja w Data Privacy Framework albo standardowe klauzule umowne z oceną skutków transferu — z datą weryfikacji, a wynik jest w `rodo.md` (punkt `[PRAWNIK/IOD]` 10 rozstrzygnięty albo świadomie oznaczony w „Decyzje”).

**AC2 — Rejestr czynności**
- Wtedy rejestr czynności przetwarzania jest aktualny (dane administratora z decyzji 9) i przechowywany poza repozytorium; w `rodo.md` jest odnośnik do jego miejsca (bez danych).

**AC3 — Ćwiczenie naruszeń (SR-PRIV-07)**
- Gdy przeprowadzamy ćwiczenie tabletop (scenariusz: utrata laptopa biura z otwartą sesją)
- Wtedy procedura 72 h jest przećwiczona, wnioski zapisane w historyjce, a kontakty dostawców i formularz UODO są dostępne poza systemem.

**AC4 — Prawa osób (SR-PRIV-02, SR-DATA-09)**
- Wtedy runbook opisuje kanał przyjęcia żądania, weryfikację tożsamości, terminy i operacje systemu (eksport danych osoby — procedura Administratora; sprostowanie; ograniczenie przez soft delete; anonimizacja — EVM-041; redakcja — EVM-040, EVM-051), rejestr żądań jest poza repozytorium, a procedura jest przećwiczona na staging.

**AC5 — Awaryjny reset MFA Administratora (SR-AUTH-13, P1 pkt 5)**
- Wtedy runbook opisuje użycie polecenia w trybie awaryjnym (EVM-016): weryfikację tożsamości poza systemem, zakończenie sesji konta, przegląd kont i alert do Administratorów; procedura jest przećwiczona na staging.

**AC6 — Retencja (SR-PRIV-01, SR-DATA-07)**
- Wtedy okresy retencji z P4 są konfiguracją zgodną z `rodo.md`, retencja danych technicznych działa od pierwszego wydania (sesje — EVM-028, kwarantanna — EVM-049, eksporty — EVM-052), a dla danych biznesowych do M4 jest opisana procedura ręczna.

**AC7 — Telemetria (SR-PRIV-09)**
- Wtedy checklista wydania zawiera przegląd próbek zdarzeń Sentry i logów (brak danych osobowych), wykonany przed pilotem realnym.

**AC8 — Ocena skutków (DPIA, art. 35 RODO)**
- Zakładając wstępną ocenę w `rodo.md` (dwa kryteria WP248 spełnione częściowo — rekomendacja: uproszczona DPIA przed startem produkcyjnym)
- Gdy przygotowuję start pilota realnego
- Wtedy istnieje uproszczona DPIA oparta na `rodo.md` i `threat-model.md` — obejmująca także panel w przeglądarce prywatnych telefonów pracowników (pilot B, decyzja 19) z kopiami zdjęć w galerii i ryzykiem automatycznej kopii w prywatnej chmurze (decyzja 18) — albo udokumentowana decyzja o jej zbędności z rozstrzygniętym punktem `[PRAWNIK/IOD]` 11 i sprawdzonym wykazem rodzajów operacji wymagających DPIA ogłoszonym przez Prezesa UODO; dokument jest zatwierdzony przez Konrada i przechowywany w lokalizacji zgodnej z polityką dokumentów (bez danych osobowych).

## Poza zakresem
- Funkcja eksportu danych klienta w systemie — M4. Klauzula BYOD i aplikacja — M2.

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wykonuje procedury z runbooków |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

- Dane: rejestr czynności i rejestr żądań — poza repozytorium; w repozytorium wyłącznie procedury bez danych osobowych.
- W AC: SR-PRIV-06, SR-PRIV-07, SR-PRIV-02, SR-DATA-09, SR-AUTH-13, SR-PRIV-01, SR-DATA-07, SR-PRIV-09; art. 35 i art. 44–46 RODO (AC1, AC8).

## Notatki techniczne
- Runbooki w `docs/ops/runbooks/`; `product-owner` — procedury biznesowe (kanał żądań), `devops-engineer` — konfiguracja retencji i dostawców.
- Część pracy może iść równolegle z fazą 4 (praca koncepcyjna).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione (weryfikacja QA przez inspekcję i protokoły ćwiczeń)
- [ ] Przegląd: solution-architect — APPROVE
- [ ] `rodo.md`, runbooki i `CHANGELOG.md` zaktualizowane
- [ ] Akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): AC1 — podstawa transferów do USA (DPF albo SCC); AC8 — uproszczona DPIA albo udokumentowana decyzja o jej zbędności
- 2026-10-03 — poprawki z przeglądu EVM-010, runda 2 (security-engineer): AC8 — w zakresie DPIA kopie zdjęć w galerii i ryzyko automatycznej kopii w prywatnej chmurze (decyzja 18)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
