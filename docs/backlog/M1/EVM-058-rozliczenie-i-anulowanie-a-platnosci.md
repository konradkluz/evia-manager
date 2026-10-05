---
id: EVM-058
title: Rozliczenie i anulowanie zlecenia a płatności
type: story
milestone: M1
epic: E7 Płatności etapowe
status: draft
priority: P1
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-054]
---

# EVM-058: Rozliczenie i anulowanie zlecenia a płatności

## Historyjka
Jako **pracownik biura** chcę **przed rozliczeniem i anulowaniem zlecenia widzieć w dialogu stan transz i wiedzieć, dlaczego akcja jest zablokowana**, aby **żadna faktura nie została „zgubiona” przy zamykaniu zlecenia, a ja nie musiał zgadywać, co zrobić dalej**.

## Kontekst
- Reguły serwera wprowadzają wcześniejsze historyjki, w których dany stan staje się osiągalny (przegląd EVM-010, `solution-architect`). EVM-053 rejestruje uczestnika przejść `payments`: warunek `completed → settled` (`422 transition_condition_not_met`, `unpaid_milestones`) i skutek `planned → cancelled` przy anulowaniu zlecenia, w tej samej transakcji. EVM-054 dodaje blokadę anulowania przy transzy `invoiced` (`422`, `invoiced_milestones`) z testami ścieżek.
- Ta historyjka dodaje podsumowanie płatności w dialogach i stany akcji przed wysłaniem żądania. Nie dodaje operacji API.
- Model: przywrócenie z „Anulowane” nie przywraca transz (`domain-model.md` → „Zlecenie”).
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) — dialogi „Rozlicz…”, „Anuluj zlecenie…”. Scenariusze: A14, B13, C11, D3, D9.

## Kryteria akceptacji
**AC1 — Rozlicz z podsumowaniem**
- Zakładając zlecenie „Zakończone” z transzami: 3 „Opłacona”, 1 „Anulowana”
- Gdy wybieram „Rozlicz…”
- Wtedy dialog pokazuje „Opłacone: 3, anulowane: 1, suma wpłat …” i „Cofnąć rozliczenie może tylko administrator.”, a po potwierdzeniu zlecenie jest „Rozliczone” z datą zamknięcia.

**AC2 — Rozliczenie zablokowane przed wysłaniem**
- Zakładając transzę „Wystawiona” albo „Planowana”
- Gdy otwieram menu przejść zlecenia
- Wtedy „Rozlicz…” jest wyłączone z podpowiedzią „Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane.”, a panel nie wysyła żądania (serwer i tak odrzuca je `422` — EVM-053).

**AC3 — Anulowanie z transzami planowanymi**
- Zakładając zlecenie „W realizacji” z transzami: 2 „Planowana”, 1 „Opłacona”
- Gdy otwieram „Anuluj zlecenie…”
- Wtedy dialog z podsumowaniem pokazuje „Planowane transze (2) zostaną anulowane.” oraz opłaconą transzę bez zmian, a po potwierdzeniu sekcja „Płatności” i nagłówek W-06 pokazują stan z odpowiedzi serwera bez ponownego wczytania strony.

**AC4 — Anulowanie zablokowane przed wysłaniem**
- Zakładając transzę „Wystawiona”
- Gdy otwieram „Anuluj zlecenie…”
- Wtedy dialog blokuje potwierdzenie z komunikatem „Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.”, a panel nie wysyła żądania (serwer i tak odrzuca je `422` — EVM-054).

**AC5 — Przywrócenie nie przywraca transz**
- Zakładając zlecenie anulowane z transzami anulowanymi
- Gdy Administrator przywraca zlecenie (step-up, EVM-030)
- Wtedy zlecenie jest „Wstrzymane”, a transze zostają „Anulowane” (przywrócenie transzy to korekta — EVM-057); test integracyjny potwierdza, że uczestnik `payments` nie zmienia transz przy przejściu `cancelled → on_hold`.

**AC6 — Zmiana w międzyczasie**
- Zakładając otwarty dialog „Rozlicz…” albo „Anuluj zlecenie…”, a w tym czasie inna osoba wystawia fakturę albo odnotowuje wpłatę
- Gdy potwierdzam dialog
- Wtedy dialog pokazuje komunikat z odpowiedzi serwera (`422` — jak w AC2 albo AC4; `412` — alert konfliktu z odświeżeniem, komunikat z makiety W-06), odświeża podsumowanie, a wpisany powód zostaje.

**AC7 — Role i stany (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt
- Gdy otwierają W-06 zlecenia z transzami
- Wtedy A i E widzą dialogi z podsumowaniem, Tylko odczyt ma odznakę statyczną bez dialogów (EVM-030), a offline akcje są wyłączone z podpowiedzią „Zmienisz po powrocie połączenia.”; podsumowanie korzysta wyłącznie z danych sekcji „Płatności” dostępnych dla roli.

## Poza zakresem
- Reguły serwera: warunek rozliczenia i skutek anulowania — EVM-053; blokada anulowania przy transzy „Wystawiona” — EVM-054.
- Korekty płatności — EVM-057. Usunięcie zlecenia — EVM-060.

## UX / UI
- W-06: dialogi „Rozlicz…” i „Anuluj zlecenie…” z podsumowaniem (§ 4.11), Banner zlecenia rozliczonego. Stany: offline — akcje wyłączone; `412` / `422` — komunikaty w dialogu (AC6).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | rozliczenie, anulowanie (dialogi z podsumowaniem) |
| Edytor | rozliczenie, anulowanie (dialogi z podsumowaniem) |
| Tylko odczyt | podgląd (odznaka statyczna; API — `403`, EVM-030) |
| Niezalogowany | brak (`401`) |

- Bez nowych operacji API — macierz ról przejść zlecenia z EVM-030, reguły transz z EVM-053 i EVM-054. Wyłączenie akcji w panelu jest tylko podpowiedzią; egzekwuje serwer.
- Dane: statusy transz i zlecenia, suma wpłat (WF).
- W AC: SR-AUTHZ-05. W sekcji: SR-AUTHZ-10 (testy ścieżek — EVM-054), SR-API-07.

## Notatki techniczne
- Panel (W-06) + test integracyjny `payments` dla AC5. Moduły backendu bez nowych tabel i operacji.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-058 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona
- [ ] Demo i akceptacja użytkownika (scenariusze A14, B13)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): reguły serwera przeniesione do EVM-053 (uczestnik `payments`, warunek rozliczenia, skutek anulowania, spójność SR-API-06) i EVM-054 (blokada anulowania przy transzy „Wystawiona”, testy ścieżek); zostają dialogi z podsumowaniem, stany przed wysłaniem, AC5 i spójność UI; `owner` → web-developer
- 2026-10-03 — plan M1 zaakceptowany przez Konrada (EVM-010); historyjka zostaje w `draft` do `/refine` — doprecyzować podział ostrzeżenia o transzach przy anulowaniu zlecenia między EVM-053 AC6 a EVM-058 AC3 (EVM-010 → „Uwagi do rozważenia” 1)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC6 — komunikat `412` wg makiety W-06 (forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”; historyjka zostaje w `draft` (zmiana brzmienia przed `/refine`, status bez zmian)
