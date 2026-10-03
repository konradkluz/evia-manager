---
id: EVM-053
title: Plan płatności z szablonu i transze w zleceniu
type: story
milestone: M1
epic: E7 Płatności etapowe
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-038]
---

# EVM-053: Plan płatności z szablonu i transze w zleceniu

## Historyjka
Jako **pracownik biura** chcę **żeby nowe zlecenie miało transze z planu płatności szablonu, a ja mógł wpisać kwoty i dodać transzę**, aby **od początku wiedzieć, ile i kiedy klient ma zapłacić**.

## Kontekst
- Kompozycja narasta: ta historyjka rejestruje kontrybutora `payments` w porcie z EVM-022 (konsultacja `solution-architect`, B3). **Bez backfillu:** zlecenia założone wcześniej (także w pilocie realnym, jeśli Konrad wybierze wariant B — decyzja 4) nie mają transz; biuro dodaje je ręcznie („Dodaj transzę”).
- **Uczestnik przejść zlecenia:** od tej historyjki zlecenie może mieć transze, więc tu `payments` rejestruje się w porcie uczestnika przejść z EVM-030 (synchronicznie, w tej samej transakcji — konsultacja `solution-architect`, C). Wnosi dwie reguły z `domain-model.md` → „Zlecenie”: warunek `completed → settled` (wszystkie transze `paid` albo `cancelled`) i skutek anulowania zlecenia (transze `planned → cancelled`). Blokada anulowania przy transzy `invoiced` dochodzi w EVM-054, bo dopiero tam ten stan jest osiągalny; dialogi z podsumowaniem — EVM-058 (przegląd EVM-010, `solution-architect`). Późniejsze dodanie `422` byłoby zmianą kodu błędu dla istniejącej sytuacji, czyli zmianą łamiącą (`api-guidelines.md` → „Wersjonowanie”).
- Do EVM-054 transz nie da się opłacić ani anulować, więc zlecenia z transzami czekają na rozliczenie w „Zakończone”. Na prod ta historyjka trafia w jednym wydaniu z EVM-054 (README → [Punkt pilota](README.md#punkt-pilota)).
- Model: `PaymentMilestone` (kwota brutto w groszach, PLN; status `planned`; zmiana kwoty w `planned` — A, E, audytowana), decyzje P2 i P5 z EVM-002, P6 (Tylko odczyt widzi płatności).
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) → „Płatności”, [akcje płatności](../../ux/flows/08-nieoplacone.md#akcje-płatności--status--rola) („Zmień kwotę”, „Dodaj transzę” — dialogi w EVM-071). Scenariusze: A1″, C7.

## Kryteria akceptacji
**AC1 — Transze z szablonu**
- Zakładając szablon „Garaż — pełny proces” z planem 20% / 30% / 30% / 20%
- Gdy tworzę zlecenie
- Wtedy powstają 4 transze „Planowana” z nazwami i udziałami (bez kwot) w tej samej transakcji co zlecenie (błąd kontrybutora — brak zlecenia)
- Oraz karta szablonu w W-05 pokazuje liczbę transz („9 pozycji · 9 procesów · 4 transze”), a podgląd szablonu — sekcję „Plan płatności” z udziałami i zdaniem „Kwoty transz wpiszesz w zleceniu.” (część ukryta w EVM-022, AC1).

**AC2 — Sekcja „Płatności”**
- Gdy otwieram W-06
- Wtedy sekcja pokazuje transze (nazwa z udziałem, kwota, status, nr faktury, termin) i sumy „Nieopłacone … · Opłacone …”, kwoty w formacie „3 600,00 zł”.

**AC3 — Zmień kwotę transzy planowanej (SR-LOG-03)**
- Zakładając transzę „Zaliczka (20%)” w stanie „Planowana”
- Gdy Edytor wpisuje kwotę 3 600,00 zł
- Wtedy kwota zapisuje się w groszach (360000, PLN) z `If-Match`, kwota ≤ 0 albo z więcej niż 2 miejscami po przecinku zwraca `400`, a zdarzenie audytu zawiera kwotę przed i po (wyjątek audytu dla płatności).

**AC4 — Dodaj transzę**
- Gdy wybieram „Dodaj transzę” z nazwą i opcjonalną kwotą
- Wtedy transza „Planowana” pojawia się na końcu listy; 21. transza zwraca `422 limit_exceeded`.

**AC5 — Zlecenie zamknięte (PO-8)**
- Zakładając zlecenie „Rozliczone”
- Gdy dodaję transzę albo zmieniam kwotę
- Wtedy API zwraca `409 work_order_closed`, a akcje są wyłączone z podpowiedzią „Zlecenie jest rozliczone — płatności są tylko do odczytu…”.

**AC6 — Rozliczenie i anulowanie zlecenia z transzami (uczestnik przejść; SR-API-06, SR-LOG-03)**
- Zakładając zlecenie „Zakończone” z transzą „Planowana” oraz zlecenie „W realizacji” z 3 transzami „Planowana”
- Gdy rozliczam pierwsze zlecenie, a drugie anuluję z powodem (także z „Wstrzymane”)
- Wtedy rozliczenie zwraca `422 transition_condition_not_met` z powodem `unpaid_milestones`, a dialog „Rozlicz…” pokazuje „Rozliczysz, gdy wszystkie transze będą opłacone albo anulowane.”
- Oraz anulowanie zapisuje w jednej transakcji zlecenie „Anulowane” i 3 transze „Anulowana”. Aktor skutku jest ten sam co w komendzie, a każda anulowana transza ma zdarzenie audytu z kwotą. Dialog „Anuluj zlecenie…” uprzedza „Planowane transze (3) zostaną anulowane.”
- Oraz błąd uczestnika `payments` w teście cofa całe przejście zlecenia (SR-API-06). Zmiany transz i przejścia zlecenia serializują się na wierszu zlecenia (test współbieżności: „Dodaj transzę” równolegle z rozliczeniem nie zostawia transzy „Planowana” w zleceniu „Rozliczone”). Zlecenie bez transz rozlicza się jak w EVM-030.

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-06, P6)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda otwiera sekcję „Płatności” i wykonuje akcje z tej historyjki
- Wtedy A i E dodają transze i zmieniają kwoty planowanych; Tylko odczyt widzi kwoty, statusy i sumy bez akcji, a każda jego mutacja zwraca `403 forbidden`
- Oraz niezalogowany dostaje `401`, transza zlecenia B ścieżką zlecenia A — `404`, a pola serwera (`status`, `sharePercent` z szablonu) są odrzucane (`read_only_field`).

**AC8 — Stany**
- Wtedy: zlecenie bez transz — „Brak transz. [Dodaj transzę]”; offline — akcje wyłączone; `412` — „Ktoś zmienił tę transzę w międzyczasie…”, dane zostają.

## Poza zakresem
- Wystawienie faktury, wpłata, anulowanie transzy planowanej, blokada anulowania zlecenia z transzą „Wystawiona” i zdarzenia dziennika o zmianie statusu transzy — EVM-054. Korekty — EVM-057.
- Podsumowanie płatności w dialogach „Rozlicz…” i „Anuluj zlecenie…” oraz akcje wyłączone przed wysłaniem żądania — EVM-058.
- Wartość zlecenia i podpowiedź kwot wg udziałów — M3 / M4. Częściowe wpłaty — poza MVP. Płatności na telefonie — nie (decyzja P3 z EVM-002).

## UX / UI
- W-06 sekcja „Płatności”: DataTable (§ 3.6), StatusBadge płatności (§ 3.9), kwoty `text.numeric`, dialogi „Dodaj transzę” i „Zmień kwotę” (EVM-071). Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt, dodanie transzy, kwota transzy planowanej; rozliczenie i anulowanie zlecenia z warunkami uczestnika `payments` |
| Edytor | odczyt, dodanie transzy, kwota transzy planowanej; rozliczenie i anulowanie zlecenia z warunkami uczestnika `payments` |
| Tylko odczyt | odczyt |
| Niezalogowany | brak (`401`) |

- Uczestnik przejść nie dodaje operacji API: działa w `POST …/work-orders/{id}/transitions` z EVM-030, więc macierz ról tej operacji się nie zmienia.
- Dane: kwoty i numery faktur (WF; przy kliencie — osobie fizycznej także DO-K).
- W AC: SR-LOG-03, SR-API-06, SR-AUTHZ-06, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-01, SR-INPUT-02 (suma udziałów w szablonie), SR-API-07 (`If-Match`), SR-DATA-01 (klasyfikacja `PaymentMilestone` bez zmian). Polityka P6.

## Notatki techniczne
- Moduły: `payments` (zapis, kontrybutor kompozycji, uczestnik przejść zlecenia), `work-orders` (porty z EVM-022 i EVM-030), `audit` + panel.
- Uczestnik przejść: kontrola warunku i skutek w transakcji komendy zlecenia; transze zlecenia i przejścia zlecenia blokują ten sam wiersz zlecenia (np. `SELECT … FOR UPDATE`; szczegóły w planie technicznym), żeby nie powstał zapis „rozliczone zlecenie z transzą nieopłaconą” przy równoległych żądaniach. Kod powodu `unpaid_milestones` — z katalogu `api-guidelines.md`.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-053 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona o płatności
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): przywrócenie transz i „Planu płatności” w karcie i podglądzie szablonu W-05 (AC1)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): uczestnik przejść `payments` przeniesiony tu z EVM-058 — warunek rozliczenia i skutek anulowania zlecenia (AC6); Tylko odczyt włączony do macierzy ról (AC7); wydanie na prod razem z EVM-054
