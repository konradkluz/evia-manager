---
id: EVM-041
title: Usunięcie i anonimizacja klienta (Administrator)
type: story
milestone: M1
epic: E2 Klienci
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-039, EVM-040]
---

# EVM-041: Usunięcie i anonimizacja klienta (Administrator)

## Historyjka
Jako **Administrator** chcę **ukryć klienta dodanego przez pomyłkę i zanonimizować dane klienta na jego żądanie**, aby **utrzymać porządek w bazie i realizować prawa osób z RODO bez rozbijania historii zleceń**.

## Kontekst
- Model: `Customer` — soft delete tylko bez niezamkniętych zleceń (`409 has_active_dependents`), anonimizacja (A ze step-upem) z zachowaniem powiązań; „Usuwanie danych”.
- Blokada usunięcia: port w `customers` implementowany przez `work-orders` (konsultacja `solution-architect`, C).
- Rejestr usunięć z EVM-040 (SR-PRIV-04). Procedura praw osób — runbook EVM-064.
- Makieta: W-14 (EVM-071), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Usunięcie klienta bez niezamkniętych zleceń**
- Zakładając klienta, którego wszystkie zlecenia są „Rozliczone” albo „Anulowane”
- Gdy Administrator wybiera „Usuń klienta”
- Wtedy klient znika dla Edytora i Tylko odczyt (`404`, brak na liście i w wyszukiwaniu), a zdarzenie trafia do audytu.

**AC2 — Klient z niezamkniętymi zleceniami**
- Zakładając klienta ze zleceniem „W realizacji”
- Gdy Administrator próbuje go usunąć albo zanonimizować
- Wtedy API zwraca `409 has_active_dependents`, a panel pokazuje „Klient ma niezamknięte zlecenia (1).”

**AC3 — Przywrócenie**
- Zakładając usuniętego klienta
- Gdy Administrator włącza filtr „Usunięci” w W-14 i wybiera „Przywróć”
- Wtedy klient znów jest widoczny dla wszystkich ról, a zdarzenie trafia do audytu.

**AC4 — Anonimizacja (SR-DATA-08, SR-SESS-08)**
- Zakładając klienta „Jan Przykładowy” bez niezamkniętych zleceń
- Gdy Administrator wybiera „Anonimizuj…”, potwierdza nieodwracalność w dialogu i tożsamość w W-04
- Wtedy imię, nazwisko, firma, NIP, osoba kontaktowa, telefon, e-mail, adres i notatki mają wartości neutralne („Klient zanonimizowany”), indeks wyszukiwania jest przeliczony (stare dane nie są znajdowane), a zlecenia klienta pokazują „Klient zanonimizowany”.

**AC5 — Rejestr usunięć przed anonimizacją (SR-PRIV-04)**
- Gdy Administrator anonimizuje klienta
- Wtedy przed zmianą w bazie do rejestru usunięć trafia identyfikator klienta, kod operacji i czas
- Oraz gdy zapis do rejestru się nie udaje, anonimizacja nie startuje, a dane są nienaruszone.

**AC6 — Audyt bez wartości (SR-LOG-03)**
- Gdy wykonuje się usunięcie, przywrócenie albo anonimizacja
- Wtedy zdarzenie audytu zawiera tylko identyfikator klienta, kod akcji i wynik.

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda usuwa, przywraca i anonimizuje
- Wtedy tylko Administrator (anonimizacja — ze step-upem); Edytor ma akcje wyłączone z podpowiedzią i dostaje `403 forbidden`; R nie widzi akcji (`403`); niezalogowany — `401`.

**AC8 — Stany**
- Wtedy offline — akcje wyłączone; anulowanie W-04 — „Nie wykonano operacji.”; `412` — komunikat z odświeżeniem.

## Poza zakresem
- Anonimizacja lokalizacji, stron i wpisów dziennika o kliencie — procedura ręczna z runbooka (EVM-064) do M4; trwałe usunięcie (purge) — M4.
- Eksport danych osoby (art. 15, 20) — procedura ręczna (SR-DATA-09, EVM-064).

## UX / UI
- W-14: akcje „Usuń klienta”, „Przywróć”, „Anonimizuj…” w menu, filtr „Usunięci” (tylko A), AlertDialog (danger), W-04 „Potwierdź tożsamość, aby zanonimizować klienta”. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie, przywrócenie; anonimizacja ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: `Customer` (DO-K); rejestr usunięć (identyfikatory).
- W AC: SR-DATA-08, SR-SESS-08, SR-PRIV-04, SR-LOG-03, SR-AUTHZ-02, SR-AUTHZ-05. Polityka P4.

## Notatki techniczne
- Moduły: `customers`, `work-orders` (implementacja portu blokady), `audit` (+ `platform`: rejestr usunięć) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-041 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
