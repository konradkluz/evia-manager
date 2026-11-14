---
id: EVM-064
title: RODO przed startem — umowy powierzenia, rejestr czynności, ćwiczenie naruszeń i runbooki
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: in-review
priority: P1
path: pelna            # dane osobowe (RODO), 8 AC — decyzja Konrada 2026-11-14
owner: security-engineer
contributors: [product-owner, devops-engineer]
reviewers: [solution-architect]
depends_on: []
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
- Wtedy dla każdego dostawcy (m.in. Hetzner, Scaleway, Grafana Labs, GitHub; bez Sentry — rezygnacja 2026-11-12) jest zawarta umowa powierzenia albo udokumentowane zaakceptowane warunki, ustawione regiony UE i retencje — z datą weryfikacji
- Oraz dla dostawców z możliwym dostępem z USA (Grafana Labs, GitHub) podstawa transferu jest sprawdzona — certyfikacja w Data Privacy Framework albo standardowe klauzule umowne z oceną skutków transferu — z datą weryfikacji, a wynik jest w `rodo.md` (punkt `[PRAWNIK/IOD]` 10 rozstrzygnięty albo świadomie oznaczony w „Decyzje”).

**AC2 — Rejestr czynności**
- Wtedy rejestr czynności przetwarzania jest aktualny (dane administratora z decyzji 9) i przechowywany poza repozytorium; w `rodo.md` jest odnośnik do jego miejsca (bez danych).

**AC3 — Ćwiczenie naruszeń (SR-PRIV-07) — wersja prosta**
- Gdy odbywa się jedno spotkanie z checklistą (scenariusz: utrata laptopa biura z otwartą sesją)
- Wtedy procedura 72 h jest przejrzana krok po kroku wg checklisty, wnioski zapisane w historyjce, a kontakty dostawców i formularz UODO są dostępne poza systemem.

**AC4 — Prawa osób (SR-PRIV-02, SR-DATA-09)**
- Wtedy runbook opisuje kanał przyjęcia żądania, weryfikację tożsamości, terminy i operacje systemu (eksport danych osoby — procedura Administratora; sprostowanie; ograniczenie przez soft delete; anonimizacja — EVM-041; redakcja — EVM-040, EVM-051), rejestr żądań jest poza repozytorium, a procedura jest przećwiczona na staging.

**AC5 — Awaryjny reset MFA Administratora (SR-AUTH-13, P1 pkt 5)**
- Wtedy runbook opisuje użycie polecenia w trybie awaryjnym (EVM-016): weryfikację tożsamości poza systemem, zakończenie sesji konta, przegląd kont i alert do Administratorów; procedura jest przećwiczona na staging.

**AC6 — Retencja (SR-PRIV-01, SR-DATA-07)**
- Wtedy okresy retencji z P4 są konfiguracją zgodną z `rodo.md`, retencja danych technicznych działa od pierwszego wydania (sesje — EVM-028, kwarantanna — EVM-049, eksporty — EVM-052), a dla danych biznesowych do M4 jest opisana procedura ręczna.

**AC7 — Telemetria (SR-PRIV-09)**
- Wtedy checklista wydania zawiera przegląd próbek logów (brak danych osobowych), wykonany przed pilotem realnym.

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
- 2026-11-14 — Konrad: ścieżka `pelna`, recenzent `solution-architect` (pytanie `/deliver`).
- 2026-11-14 — Konrad: bez konsultacji z prawnikiem ani IOD. Punkty `[PRAWNIK/IOD]` potrzebne w tej historyjce (10 — transfery do USA, 11 — potrzeba DPIA) agenci przygotowują jako rekomendacje, a Konrad zatwierdza je na demo; zapis jako świadoma decyzja administratora bez porady prawnej.
- 2026-11-14 — Tech Lead (RR-93): agenci nie logują się na jedyne środowisko, nie czytają jego bazy ani logów i nie zakładają kont u dostawców. Czynności ręczne — zawarcie i sprawdzenie umów na kontach dostawców (AC1), rejestr poza repozytorium (AC2), spotkanie z checklistą (AC3), próby procedur na środowisku na danych syntetycznych (AC4, AC5), przegląd próbek logów (AC7), zatwierdzenie DPIA (AC8) — wykonuje Konrad wg przygotowanych checklist i protokołów; do tego czasu historyjka zostaje w `in-review`.

## Uwagi do rozważenia
- Operacje ręczne realizacji praw osób (neutralizacja lokalizacji i stron, soft delete z art. 18) nie trafiają do rejestru usunięć i po odtworzeniu kopii trzeba je powtórzyć ręcznie (runbooki `prawa-osob.md`, `restore.md`) — zapis do rejestru to kandydat do backlogu (M4, `/refine`).
- Brak zadania usuwania dla `sync.change_log` (P4: 90 dni), `media.media_exports`, linków jednorazowych i `security_alert_outbox` — bez danych klientów, identyfikatory pseudonimowe; kandydat do historyjki (`/refine`). **Termin dla `sync.change_log`: zadanie działa najpóźniej 2027-02-11** (90 dni od realnych danych 2026-11-13) — nie czekać na M4 ([`retencja.md` § 4](../../ops/runbooks/retencja.md#4-pytania-do-decyzji-konrada-evm-064-demo)).
- Kandydat (wzmocnienie D3 w [`dpia.md`](../../security/dpia.md#4-ryzyka-dla-praw-i-wolności-osób)): step-up przy pobraniu dokumentu `identity_data` (MFA, gdy ostatnie uwierzytelnienie > 15 min) albo brak pobierania `identity_data` z sesji na telefonie. Dziś P1 opiera się częściowo na zasadach bez kontroli technicznej (blokada ekranu, „Wyloguj”); obowiązkowy, jeśli brak oświadczeń techników albo incydent podniesie ocenę D3 do 6 — wtedy zmiana produktu przez `/refine`.
- SR-PRIV-01 mówi o konfiguracji, a okresy retencji są stałymi w kodzie i regułami IaC — decyzja Konrada w protokole AC6.

## Definition of Done
- [ ] AC1–AC8 spełnione (weryfikacja QA przez inspekcję i protokoły ćwiczeń)
- [x] Przegląd: solution-architect — APPROVE
- [x] `rodo.md`, runbooki i `CHANGELOG.md` zaktualizowane
- [ ] Akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): AC1 — podstawa transferów do USA (DPF albo SCC); AC8 — uproszczona DPIA albo udokumentowana decyzja o jej zbędności
- 2026-10-03 — poprawki z przeglądu EVM-010, runda 2 (security-engineer): AC8 — w zakresie DPIA kopie zdjęć w galerii i ryzyko automatycznej kopii w prywatnej chmurze (decyzja 18)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-11-12 — zmiana AC (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”; decyzja Konrada o rezygnacji z Sentry): AC1 i AC7 bez Sentry; AC3 — jedno spotkanie z checklistą zamiast ćwiczenia tabletop; DPIA (AC8) bez zmian — uproszczona albo uzasadnienie zbędności
- 2026-11-13 — decyzja Konrada „jedno środowisko, realne dane od startu”: `depends_on` bez EVM-061 (przepisanej na warunki startu); „przed startem” = przed wpisaniem pierwszych realnych danych klientów na jedynym środowisku (warunek AC3 w EVM-061); „przećwiczona na staging” czytaj: na jedynym środowisku na danych syntetycznych; AC bez zmian (product-owner)
- 2026-11-14 — start realizacji (`/deliver`): status `in-progress`, gałąź `feature/EVM-064-rodo-przed-startem`, ścieżka `pelna` (Tech Lead)
- 2026-11-14 — plan gotowy (security-engineer)
- 2026-11-14 — implementacja dokumentów (security-engineer): `dpia.md`, `checklista-wydania.md`, runbooki `prawa-osob.md`, `naruszenie-danych.md`, `retencja.md`, procedura awaryjnego resetu MFA, `rodo.md` (dostawcy ze źródeł publicznych, pkt 10 i 11 jako rekomendacje), RR-95, protokoły `docs/qa/EVM-064/protokoly.md`; AC1–AC5, AC7, AC8 czekają na czynności Konrada (`manual`), AC6 — dwa pytania o retencję
- 2026-11-14 — przegląd pokrycia AC (product-owner): dokumenty kompletne względem AC; nic nie wpisano za Konrada (pola protokołów puste); brak zmian kodu produktu
- 2026-11-14 — workflow `deliver-story` (pelna) `passed` po 2 rundach: QA pass przez inspekcję (AC1–AC8 `manual` — dokumenty i protokoły gotowe, czynności i decyzje Konrada otwarte); `solution-architect` — runda 1 `changes_required` (major: runbook obiecywał, że wszystkie usunięcia wracają przez rejestr usunięć), poprawka `029512ab`, runda 2 approve. Weryfikacja orkiestratora: `pnpm run gate` zielona (brak zmian kodu), `npm run docs:check` 0 błędów; status `in-review` do wypełnienia protokołów `docs/qa/EVM-064/protokoly.md` (Tech Lead)
- 2026-11-14 — Koszt: ok. 0,8 mln tokenów agentów (9 wywołań, 1 runda poprawek, ok. 33 min; rozbicia w USD nie odczytano); ścieżka pelna; plik historyjki 10 KB; dla porównania EVM-103 (pelna, kod): ok. 0,9 mln tokenów; porównanie z baseline EVM-013 i celem ścieżki w USD niemożliwe bez rozbicia (Tech Lead)
- 2026-11-14 — poprawki po przeglądzie prawnym (security-engineer; 1 blocker, 7 major, 9 minor): DPIA 0.2 — D3 z W3 (po środkach P1 × W3 = 3 z uzasadnieniem), warunki § 5 (upoważnienia, informacja o audycie, oświadczenia techników, ograniczenia pilota B, kopia w chmurze = naruszenie, oryginały poza systemem), art. 35 ust. 7 i 9, wykaz UODO dosłownie; `rodo.md` — stan prawny DPF, wpisy DPF „Active” (Tech Lead), GitHub bez umowy powierzenia, próg zgłoszenia naruszeń i PESEL; runbooki naruszeń (art. 33 ust. 3, art. 34 ust. 2, kanały UODO bez ePUAP), praw osób (C-154/21, art. 12 ust. 4) i retencji (termin `sync.change_log` 2027-02-11); RR-01, RR-95; nowe [`wzory-dla-pracownikow.md`](../../security/wzory-dla-pracownikow.md); pola w protokołach AC1 i AC8
