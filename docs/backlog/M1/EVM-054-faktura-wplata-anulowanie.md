---
id: EVM-054
title: Wystawienie faktury, wpłata i anulowanie transzy planowanej
type: story
milestone: M1
epic: E7 Płatności etapowe
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-053]
---

# EVM-054: Wystawienie faktury, wpłata i anulowanie transzy planowanej

## Historyjka
Jako **pracownik biura** chcę **odnotować wystawienie faktury, wpłatę i anulowanie niepotrzebnej transzy**, aby **status każdej płatności był aktualny bez arkusza**.

## Kontekst
- Model: tabela przejść „Etap płatności” — `planned → invoiced` (kwota, nr faktury, data; termin = data + dni z planu), `invoiced → paid` (data wpłaty nie z przyszłości), `planned → cancelled` (powód) — A, E; audytowane z kwotą. Korekty — tylko Administrator ze step-upem (EVM-057).
- Decyzje z EVM-004: wpłaty odnotowuje Edytor, Edytor anuluje tylko transzę „Planowaną”; zaliczka na proformę — pole „Nr faktury lub proformy” (P4 z EVM-002).
- **Uczestnik przejść zlecenia** (`payments`, zarejestrowany w EVM-053): od tej historyjki transza może być „Wystawiona”, więc tu dochodzi warunek anulowania zlecenia z `domain-model.md` → „Zlecenie” — brak transz `invoiced`. Bez niego anulowanie zlecenia ukryłoby wystawioną fakturę w zleceniu zamkniętym, czyli dałoby skutek zarezerwowany dla korekty Administratora ze step-upem (zasada ścieżek, SR-AUTHZ-10; przegląd EVM-010, `solution-architect`).
- Makiety: [akcje płatności](../../ux/flows/08-nieoplacone.md#akcje-płatności--status--rola) (W-06 i W-11), dialogi z podsumowaniem. Scenariusze: A11, A13, B3, B9, B12, C7, D3, D9.

## Kryteria akceptacji
**AC1 — Wystaw fakturę (SR-LOG-03)**
- Zakładając transzę „Planowana” z planem płatności 7 dni
- Gdy wybieram „Wystaw fakturę…”, podaję kwotę 1 230,00 zł, nr `FV/TEST/0021/2026` i datę wystawienia 2026-10-03, i potwierdzam dialog z podsumowaniem („Cofnąć wystawienie może tylko administrator.”)
- Wtedy transza jest „Wystawiona” z terminem 2026-10-10 (edytowalnym w dialogu), a zdarzenie audytu zawiera kwotę i kody statusów.

**AC2 — Odnotuj wpłatę**
- Zakładając transzę „Wystawiona”
- Gdy wybieram „Odnotuj wpłatę…” z datą wpłaty (domyślnie dziś) i potwierdzam
- Wtedy transza jest „Opłacona”, toast „Odnotowano wpłatę 1 230,00 zł za fakturę FV/TEST/0021/2026.” jest bez „Cofnij”, a data z przyszłości (zegar: dziś 2026-10-03, data 2026-10-04) zwraca błąd „Data wpłaty nie może być późniejsza niż dziś.”

**AC3 — Anuluj transzę planowaną**
- Zakładając transzę „Planowana”
- Gdy wybieram „Anuluj transzę…” z wymaganym powodem
- Wtedy transza ma status „Anulowana” (ton neutralny, ikona `ban`), dialog uprzedza „Przywrócić transzę może tylko administrator.”, a zdarzenie trafia do audytu.
- Oraz każda zmiana statusu transzy (AC1–AC3, także skutek anulowania zlecenia z EVM-053) tworzy w dzienniku zlecenia zdarzenie z kodami statusów, bez kwoty (EVM-038), a filtr „Płatności” w W-08 je pokazuje.

**AC4 — Poprawki danych faktury i wpłaty**
- Gdy w transzy „Wystawiona” poprawiam nr faktury, datę wystawienia albo termin, a w „Opłaconej” — datę wpłaty
- Wtedy zmiana zapisuje się z `If-Match` bez zmiany kwoty i statusu.

**AC5 — Korekty niedostępne dla Edytora (SR-AUTHZ-10)**
- Zakładając Edytora i transze „Wystawiona”, „Opłacona”, „Anulowana”
- Gdy próbuje wycofać fakturę, anulować fakturę, zmienić kwotę, cofnąć wpłatę, przywrócić albo usunąć transzę
- Wtedy pozycje są wyłączone z podpowiedzią „Korektę płatności może wykonać tylko administrator.”, a API zwraca `403 forbidden` — także dla zmiany kwoty przez edycję pola w stanie „Wystawiona” (testy ścieżek w grafie przejść).

**AC6 — Anulowanie zlecenia z transzą wystawioną (SR-AUTHZ-10, SR-API-06)**
- Zakładając zlecenie „W realizacji” albo „Wstrzymane” z transzą „Wystawiona” i transzą „Planowana”
- Gdy Administrator albo Edytor anuluje zlecenie z powodem
- Wtedy API zwraca `422 transition_condition_not_met` z powodem `invoiced_milestones`, zlecenie i obie transze zostają bez zmian (bez zdarzeń audytu i dziennika), a dialog „Anuluj zlecenie…” pokazuje „Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.”
- Oraz testy ścieżek w grafie przejść zlecenia i transz potwierdzają, że żadna sekwencja dostępna dla Edytora ani dla Administratora bez step-upu nie zamyka zlecenia z transzą „Wystawiona”. Test współbieżności: wystawienie faktury równolegle z anulowaniem zlecenia nie zostawia transzy „Wystawiona” w zleceniu „Anulowane”.

**AC7 — Zasady (SR-API-07, SR-INPUT-02)**
- Gdy wysyłam przejście spoza tabeli, brak `If-Match`, nieaktualną wersję albo przejście w zleceniu zamkniętym
- Wtedy API zwraca odpowiednio `409 invalid_state_transition`, `428`, `412` (alert z bieżącym statusem transzy i „Odśwież” — komunikat z makiety W-11, wspólny z sekcją „Płatności” W-06), `409 work_order_closed`.

**AC8 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-06, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wykonuje akcje z tej historyjki
- Wtedy A i E je wykonują, R nie widzi akcji i dostaje `403 forbidden`, niezalogowany — `401`, transza zlecenia B ścieżką zlecenia A — `404`.

## Poza zakresem
- Korekty płatności — EVM-057. Warunek rozliczenia i skutek anulowania zlecenia dla transz planowanych — EVM-053; podsumowanie płatności w dialogach „Rozlicz…” i „Anuluj zlecenie…” i akcje wyłączone przed wysłaniem żądania — EVM-058.
- Integracja z systemem fakturowym (KSeF) — M5. „Poproś administratora o korektę” — M3.

## UX / UI
- W-06 „Płatności” i W-11: akcje w wierszu, AlertDialog z podsumowaniem (§ 4.11), DatePicker, Toast bez „Cofnij”. Stany: offline — akcje wyłączone; błąd — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wszystkie akcje z tej historyjki |
| Edytor | wszystkie akcje z tej historyjki |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: kwoty, numery faktur (WF), audyt z kwotą.
- W AC: SR-LOG-03, SR-AUTHZ-10, SR-API-06, SR-API-07, SR-INPUT-02, SR-AUTHZ-02, SR-AUTHZ-06, SR-AUTHZ-05.
- Warunek anulowania zlecenia nie dodaje operacji API: działa w `POST …/work-orders/{id}/transitions` z EVM-030 (macierz ról bez zmian).

## Notatki techniczne
- Moduły: `payments` (także warunek anulowania w uczestniku przejść z EVM-053), `timeline`, `audit` + panel. „Dziś” — wstrzykiwany zegar `Europe/Warsaw`.
- Kod powodu `invoiced_milestones` (obok `unpaid_milestones`) ta historyjka dopisuje addytywnie do katalogu `api-guidelines.md`. Przejścia transz serializują się z przejściami zlecenia na wierszu zlecenia (jak w EVM-053).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-054 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): blokada anulowania zlecenia z transzą „Wystawiona” z testem ścieżek i współbieżności przeniesiona tu z EVM-058 (AC6); zdarzenia dziennika transz dołączone do AC3
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC7 — komunikat `412` wg makiety W-11 (tabela akcji płatności wspólna z W-06; forma bezosobowa z bieżącym statusem i „Odśwież”, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
