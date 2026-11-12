---
id: EVM-070
title: Security sign-off wydania 1.0 (z zawężonym pentestem)
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: security-engineer
contributors: [devops-engineer]
reviewers: [solution-architect]
depends_on: [EVM-055, EVM-056, EVM-057, EVM-058, EVM-062, EVM-063, EVM-064, EVM-066]
---

# EVM-070: Security sign-off wydania 1.0 (z zawężonym pentestem)

## Historyjka
Jako **właściciel produktu** chcę **jednego sign-off bezpieczeństwa całego zakresu M1 — z płatnościami i zawężonym testem penetracyjnym — przed pierwszymi realnymi danymi i wydaniem 1.0**, aby **zacząć pracę na danych klientów z rozsądną pewnością, że logowanie, uprawnienia i pliki są bezpieczne, bez dwóch osobnych bramek**.

## Kontekst
- Od 2026-11-12 (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”) EVM-065 (pentest i sign-off pilota) jest **połączona z tą historyjką**: jeden sign-off 1.0 i jeden pentest, zawężony do trzech obszarów (AC7). Zależności EVM-065 (EVM-062, EVM-063, EVM-064, EVM-066) przeniesione tutaj.
- RR-10 (decyzja Konrada z EVM-005): zewnętrzny pentest przed produkcją z realnymi danymi; do tego czasu wyłącznie dane syntetyczne. Zakup — osobna zgoda Konrada (decyzja 6).
- Kryteria wyjścia M1 (roadmapa): security sign-off — brak otwartych Critical / High / Medium, MFA, czysty DAST baseline; backup odtworzony testowo.
- Realne dane na prod trafiają dopiero po tym sign-off. Pozycje P2 z nowymi operacjami wrażliwymi (EVM-052, EVM-060) trafiają na prod najwcześniej z nim albo po osobnym przeglądzie `security-engineer`.

## Kryteria akceptacji
**AC1 — Przegląd zmian M1**
- Gdy przygotowuję sign-off
- Wtedy każde `SR-…` z epików M1 ma dowód (test, bramka, przegląd albo ćwiczenie), a każde odstępstwo jest ryzykiem zaakceptowanym przez Konrada.

**AC2 — Płatności (AB-17, SR-AUTHZ-10)**
- Wtedy testy ścieżek w grafie przejść płatności (EVM-053 — uczestnik przejść zlecenia, EVM-054, EVM-057, EVM-060) są przejrzane przez `security-engineer`; osobny zewnętrzny retest płatności nie jest wykonywany (decyzja 2026-11-12).

**AC3 — Skany i DAST (SR-SUPPLY-07)**
- Gdy kandydat 1.0 jest na staging
- Wtedy ZAP, Schemathesis i bramki CI nie mają ustaleń High ani Medium spoza wyjątków.

**AC4 — Odtworzenie i telemetria (SR-INFRA-07, SR-PRIV-09)**
- Wtedy test odtworzenia przed wydaniem (EVM-062) zakończył się sukcesem, a przegląd próbek telemetrii i logów nie wykazał danych osobowych.

**AC5 — Model zagrożeń i ryzyka**
- Wtedy `threat-model.md` jest aktualny (nowe przepływy z M1, ryzyka z pentestu, kanał wdrożenia wg decyzji 5), a nowe ryzyka rezydualne mają decyzję Konrada.

**AC6 — Sign-off i decyzja**
- Wtedy raport sign-off (lokalizacja zgodna z polityką dokumentów, np. `docs/qa/EVM-070/`) zawiera werdykt, listę dowodów i ryzyka rezydualne, a wydanie 1.0 i start realnych danych (wdrożenie prod) jest decyzją Konrada zapisaną w „Decyzje”.

**AC7 — Pentest zewnętrzny, zakres zawężony (RR-10)**
- Zakładając zgodę Konrada na zakup (decyzja 6)
- Gdy zlecamy pentest zewnętrznemu wykonawcy (2–3 dni, na staging z danymi syntetycznymi; wykonawca nie dostaje danych prod)
- Wtedy zakres obejmuje wyłącznie: uwierzytelnianie i MFA (logowanie, reset, zaproszenia, sesje, step-up), dostęp do cudzych danych (autoryzacja, IDOR) oraz upload plików (skan antywirusowy, pobieranie i podpisane URL-e); każde ustalenie Critical, High i Medium jest naprawione (historyjka `bug`) i potwierdzone retestem w ramach tego zlecenia albo przyjęte przez Konrada jako ryzyko rezydualne (`RR-…`) z uzasadnieniem. Obszary poza zakresem (nagłówki, XSS, eksport ZIP, płatności) pokrywają skany z AC3 i przegląd z AC1–AC2.

**AC8 — Warunki wejścia realnych danych i model zagrożeń BYOD**
- Gdy przygotowuję sign-off
- Wtedy potwierdzam z dowodami: test odtworzenia (EVM-062); MFA Administratorów oraz drugi Administrator albo konto awaryjne (RR-16, EVM-061); klauzule i formalności RODO (EVM-063, EVM-064) z danymi rejestrowymi firmy, podstawą transferów do USA i uproszczoną DPIA albo udokumentowaną decyzją o jej zbędności (EVM-064 AC8); runbooki SR-AUTH-13, SR-PRIV-02, SR-DATA-09; instrukcja w panelu z zasadami SR-PRIV-10 i pracy na telefonie (EVM-066); retencja danych technicznych działa (SR-DATA-07)
- Oraz `threat-model.md` zawiera przepływ „panel w przeglądarce prywatnego telefonu (BYOD) — M1, przejściowo do aplikacji M2” z nową pozycją RR (kradzież odblokowanego telefonu z otwartą sesją Edytora, kopie zdjęć w galerii i automatycznej kopii w chmurze prywatnego konta, pobrane pliki) i kontrolami z instrukcji (EVM-066 AC2) oraz wygasania sesji (EVM-067); RR ma decyzję Konrada (decyzje 18 i 19).

## Poza zakresem
- MASVS i aplikacja mobilna — M2.
- Osobny sign-off pilota, bramka wdrożeń pośrednich w trakcie pilota (dawne EVM-065 AC7) i osobny retest płatności — zrezygnowano 2026-11-12.
- Pentest obszarów spoza AC7 — ewentualnie później, decyzja Konrada.

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (proces) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

- W AC: SR-AUTHZ-10, SR-SUPPLY-07, SR-INFRA-07, SR-PRIV-09, SR-AUTH-13, SR-PRIV-02, SR-DATA-09, SR-PRIV-10, SR-DATA-07. Ryzyka: RR-10, RR-16; nowe RR — panel na prywatnym telefonie (AC8, numer nadaje `security-engineer`).
- Dane: wyłącznie syntetyczne na staging (SR-INFRA-08, SR-PRIV-08).

## Notatki techniczne
- Raport w lokalizacji zgodnej z polityką dokumentów (np. `docs/qa/EVM-070/`).
- Orientacyjny koszt zawężonego pentestu (2–3 dni testera) — do wyceny; zamówienie warto przygotować z wyprzedzeniem (czas oczekiwania na wykonawcę).
- `devops-engineer`: dostęp testera do staging (konta testowe, lista dozwolonych adresów), DAST.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-11-12 (Tech Lead z delegacji Konrada): jeden sign-off 1.0 z pentestem zawężonym (AC7). Konsekwencja do potwierdzenia przez Konrada: realne dane na prod dopiero po tym sign-off, czyli po E7 (dawny pilot B „przed płatnościami” nie ma osobnej bramki — patrz README M1 → „Punkt pilota”).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione (dowody w raporcie sign-off)
- [ ] Przegląd: solution-architect — APPROVE
- [ ] `threat-model.md` i `CHANGELOG.md` zaktualizowane
- [ ] Decyzja Konrada o wydaniu 1.0 i starcie realnych danych

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-065 planu wstępnego — konsultacja security-engineer pkt 2)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): powiązanie z bramką wdrożeń w trakcie pilota (EVM-065 AC7)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): testy ścieżek płatności w EVM-053 i EVM-054 zamiast EVM-058 (AC2)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-11-12 — zmiana AC: EVM-065 połączona z EVM-070 — dodano AC7 (pentest zawężony do uwierzytelniania/MFA, IDOR, uploadu; 2–3 dni) i AC8 (warunki wejścia realnych danych, model zagrożeń BYOD); AC2 bez osobnego retestu płatności; bez bramki wdrożeń pośrednich (AC7 z 065); `depends_on` rozszerzone o zależności 065 (decyzja Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”; AC zmienione na podstawie decyzji delegowanej — do potwierdzenia przez Konrada)
