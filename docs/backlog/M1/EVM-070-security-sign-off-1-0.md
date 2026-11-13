---
id: EVM-070
title: Wewnętrzny przegląd bezpieczeństwa i sign-off wydania 1.0 (bez pentestu zewnętrznego)
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: security-engineer
contributors: [devops-engineer]
reviewers: [solution-architect]
depends_on: [EVM-055, EVM-056, EVM-057, EVM-058, EVM-084, EVM-063, EVM-064, EVM-066, EVM-061]
---

# EVM-070: Wewnętrzny przegląd bezpieczeństwa i sign-off wydania 1.0 (bez pentestu zewnętrznego)

> **Zmiana 2026-11-13 (decyzja Konrada):** bez zewnętrznego pentestu (AC7 zastąpiony wewnętrznym przeglądem prowadzonym przez `security-engineer`); jedno środowisko, realne dane od startu (EVM-061) — sign-off **nie jest już bramką przed pierwszymi realnymi danymi**, tylko przeglądem wydania 1.0 na środowisku już używanym; test odtworzenia z EVM-084 (połączona z EVM-062). Pentest zewnętrzny można zamówić później osobną decyzją Konrada.

## Historyjka
Jako **właściciel produktu** chcę **jednego wewnętrznego przeglądu bezpieczeństwa całego zakresu M1 (w tym płatności, uwierzytelniania, uprawnień i plików) zakończonego sign-off wydania 1.0**, aby **mieć udokumentowaną ocenę ryzyka i listę ryzyk rezydualnych w czasie, gdy biuro już pracuje na realnych danych, bez kosztu zewnętrznego pentestu**.

## Kontekst
- Od 2026-11-12 (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”) EVM-065 (pentest i sign-off pilota) jest **połączona z tą historyjką**: jeden sign-off 1.0 i jeden pentest, zawężony do trzech obszarów (AC7). Zależności EVM-065 (EVM-062, EVM-063, EVM-064, EVM-066) przeniesione tutaj.
- RR-10 (decyzja Konrada z EVM-005: zewnętrzny pentest przed realnymi danymi) — **zmieniona 2026-11-13**: pentest zewnętrzny nie jest wykonywany; ryzyko własnego kodu bezpieczeństwa bez niezależnego testu to ryzyko rezydualne do akceptacji Konrada (kompensacja: wewnętrzny przegląd AC7, skany i DAST AC3, MFA Administratorów). Aktualizację RR-10 w modelu zagrożeń robi `security-engineer`.
- Kryteria wyjścia M1 (roadmapa): przegląd bezpieczeństwa — brak otwartych Critical / High / Medium, MFA, czysty DAST baseline; backup odtworzony testowo (EVM-084).
- Realne dane trafiają do systemu wg EVM-061 (przed tym przeglądem); EVM-052 i EVM-060 (nowe operacje wrażliwe) są już `done` — ich przegląd wchodzi w AC1.

## Kryteria akceptacji
**AC1 — Przegląd zmian M1**
- Gdy przygotowuję sign-off
- Wtedy każde `SR-…` z epików M1 ma dowód (test, bramka, przegląd albo ćwiczenie), a każde odstępstwo jest ryzykiem zaakceptowanym przez Konrada.

**AC2 — Płatności (AB-17, SR-AUTHZ-10)**
- Wtedy testy ścieżek w grafie przejść płatności (EVM-053 — uczestnik przejść zlecenia, EVM-054, EVM-057, EVM-060) są przejrzane przez `security-engineer`; osobny zewnętrzny retest płatności nie jest wykonywany (decyzja 2026-11-12).

**AC3 — Skany i DAST (SR-SUPPLY-07)**
- Gdy kandydat 1.0 działa na środowisku (skan na danych syntetycznych, bez zapisów na realnych danych)
- Wtedy ZAP, Schemathesis i bramki CI nie mają ustaleń High ani Medium spoza wyjątków.

**AC4 — Odtworzenie i telemetria (SR-INFRA-07, SR-PRIV-09)**
- Wtedy test odtworzenia (EVM-084, połączona z EVM-062) zakończył się sukcesem, a przegląd próbek telemetrii i logów nie wykazał danych osobowych.

**AC5 — Model zagrożeń i ryzyka**
- Wtedy `threat-model.md` jest aktualny (nowe przepływy z M1, ryzyka z pentestu, kanał wdrożenia wg decyzji 5), a nowe ryzyka rezydualne mają decyzję Konrada.

**AC6 — Sign-off i decyzja**
- Wtedy raport sign-off (lokalizacja zgodna z polityką dokumentów, np. `docs/qa/EVM-070/`) zawiera werdykt, listę dowodów i ryzyka rezydualne, a wydanie 1.0 jest decyzją Konrada zapisaną w „Decyzje” (start realnych danych — EVM-061 AC6, wcześniej).

**AC7 — Wewnętrzny przegląd trzech obszarów (RR-10, bez pentestu zewnętrznego)**
- Gdy `security-engineer` przeprowadza przegląd własny (kod, konfiguracja, testy ręczne i automatyczne na danych syntetycznych; bez zapisów na realnych danych)
- Wtedy obejmuje on: uwierzytelnianie i MFA (logowanie, reset, zaproszenia, sesje, step-up), dostęp do cudzych danych (autoryzacja, IDOR — macierz ról na wszystkich endpointach) oraz upload plików (skan antywirusowy, pobieranie i podpisane URL-e); każde ustalenie Critical, High i Medium jest naprawione (historyjka `bug`) i potwierdzone ponownym sprawdzeniem albo przyjęte przez Konrada jako ryzyko rezydualne (`RR-…`) z uzasadnieniem; raport wprost wskazuje, że przegląd nie jest niezależnym testem penetracyjnym, a RR-10 (brak niezależnego testu) ma decyzję Konrada.

**AC8 — Warunki wejścia realnych danych i model zagrożeń BYOD**
- Gdy przygotowuję sign-off
- Wtedy potwierdzam z dowodami (większość jest już sprawdzona w EVM-061 — odsyłam do jej dowodów): test odtworzenia (EVM-084; do czasu jego wykonania ryzyko RR z EVM-061 AC5 pozostaje otwarte); MFA Administratorów oraz drugi Administrator albo konto awaryjne (RR-16, EVM-061 AC1); klauzule i formalności RODO (EVM-063, EVM-064) z danymi rejestrowymi firmy, podstawą transferów do USA i uproszczoną DPIA albo udokumentowaną decyzją o jej zbędności (EVM-064 AC8); runbooki SR-AUTH-13, SR-PRIV-02, SR-DATA-09; instrukcja w panelu z zasadami SR-PRIV-10 i pracy na telefonie (EVM-066); retencja danych technicznych działa (SR-DATA-07)
- Oraz `threat-model.md` zawiera przepływ „panel w przeglądarce prywatnego telefonu (BYOD) — M1, przejściowo do aplikacji M2” z nową pozycją RR (kradzież odblokowanego telefonu z otwartą sesją Edytora, kopie zdjęć w galerii i automatycznej kopii w chmurze prywatnego konta, pobrane pliki) i kontrolami z instrukcji (EVM-066 AC2) oraz wygasania sesji (EVM-067); RR ma decyzję Konrada (decyzje 18 i 19).

## Poza zakresem
- MASVS i aplikacja mobilna — M2.
- Osobny sign-off pilota, bramka wdrożeń pośrednich w trakcie pilota (dawne EVM-065 AC7) i osobny retest płatności — zrezygnowano 2026-11-12.
- Zewnętrzny test penetracyjny (jakikolwiek zakres) — nie wykonujemy (decyzja Konrada 2026-11-13); ewentualnie później, nową decyzją.

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
- Dane: testy i skany wyłącznie na danych syntetycznych (SR-INFRA-08, SR-PRIV-08), mimo że na środowisku są też realne (EVM-061 AC4) — przegląd nie zapisuje i nie czyta realnych danych klientów.

## Notatki techniczne
- Raport w lokalizacji zgodnej z polityką dokumentów (np. `docs/qa/EVM-070/`).
- `devops-engineer`: DAST (konta testowe na danych syntetycznych; adresy `.test` nie wysyłają poczty — EVM-089 AC2).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-11-13 (Konrad): bez zewnętrznego pentestu — EVM-070 to wewnętrzny przegląd i sign-off (AC7); realne dane startują na jedynym środowisku wg EVM-061, bez czekania na ten sign-off (zastępuje konsekwencję z 2026-11-12). Ryzyko rezydualne RR-10 — do akceptacji w AC6/AC7.
- 2026-11-12 (Tech Lead z delegacji Konrada): jeden sign-off 1.0 z pentestem zawężonym (AC7). Konsekwencja do potwierdzenia przez Konrada: realne dane na prod dopiero po tym sign-off, czyli po E7 (dawny pilot B „przed płatnościami” nie ma osobnej bramki — patrz README M1 → „Punkt pilota”).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione (dowody w raporcie sign-off; AC7 = przegląd wewnętrzny)
- [ ] Przegląd: solution-architect — APPROVE
- [ ] `threat-model.md` i `CHANGELOG.md` zaktualizowane
- [ ] Decyzja Konrada o wydaniu 1.0

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-065 planu wstępnego — konsultacja security-engineer pkt 2)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): powiązanie z bramką wdrożeń w trakcie pilota (EVM-065 AC7)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): testy ścieżek płatności w EVM-053 i EVM-054 zamiast EVM-058 (AC2)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-11-12 — zmiana AC: EVM-065 połączona z EVM-070 — dodano AC7 (pentest zawężony do uwierzytelniania/MFA, IDOR, uploadu; 2–3 dni) i AC8 (warunki wejścia realnych danych, model zagrożeń BYOD); AC2 bez osobnego retestu płatności; bez bramki wdrożeń pośrednich (AC7 z 065); `depends_on` rozszerzone o zależności 065 (decyzja Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”; AC zmienione na podstawie decyzji delegowanej — do potwierdzenia przez Konrada)
- 2026-11-13 — zmiana AC wg decyzji Konrada (jedno środowisko, bez pentestu): AC7 → wewnętrzny przegląd `security-engineer` (te same trzy obszary), AC2/AC4/AC8 odesłania do EVM-084 (połączona z EVM-062) i EVM-061; sign-off nie jest bramką przed realnymi danymi; `depends_on`: EVM-062 → EVM-084, + EVM-061; liczba AC bez zmian (8), status `ready` zachowany (product-owner; zmiana wg decyzji Konrada)
