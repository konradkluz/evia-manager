---
id: EVM-038
title: Automatyczna historia zmian w dzienniku
type: story
milestone: M1
epic: E5 Dziennik i komentarze
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-032, EVM-037]
---

# EVM-038: Automatyczna historia zmian w dzienniku

## Historyjka
Jako **pracownik biura** chcę **widzieć w dzienniku zlecenia automatyczne wpisy o zmianach statusów zlecenia i etapów**, aby **odtworzyć przebieg zlecenia bez dopisywania ręcznie każdej zmiany**.

## Kontekst
- Model: `TimelineEntry` z `kind = event` (tylko serwer; kody, typ i ID obiektu, nazwy pól — **bez wartości danych osobowych i bez kwot**), „Trzy dzienniki” (dziennik zlecenia nie zastępuje audytu).
- Ta historyjka wprowadza mechanizm i obsługuje zdarzenia zlecenia i etapów. Kolejne historyjki dopisują swoje zdarzenia i zależą od niej (konsultacja `solution-architect`, W4): EVM-035 (dane i zakres zlecenia), EVM-042 (procesy i etapy), EVM-044 i EVM-046 (media), EVM-047 i EVM-050 (dokumenty), EVM-054 (transze, także skutek anulowania zlecenia z EVM-053), EVM-057 (korekty transz).
- Makieta: [W-08](../../ux/flows/05-wpis-i-komentarz.md#w-08-dziennik) — typy wpisów; formy bezosobowe (PO-2, styleguide 1.2.0).

## Kryteria akceptacji
**AC1 — Zdarzenia obsługiwane w tej historyjce**
- Gdy powstaje zlecenie, zmienia się status zlecenia, zmienia się status etapu, zmienia się strona, na którą czekamy, albo osoba odpowiedzialna lub termin etapu
- Wtedy w dzienniku zlecenia powstaje dokładnie jedno zdarzenie (`work_order_created`, `work_order_status_changed`, `stage_status_changed`, `stage_waiting_on_changed`, `stage_updated` — ostateczne kody w planie technicznym) w tej samej transakcji co zmiana.

**AC2 — Bez wartości danych osobowych i kwot (SR-LOG-03, SR-DATA-01)**
- Gdy zapisuje się zdarzenie
- Wtedy zawiera ono wyłącznie kody stanów, typ i identyfikator obiektu oraz nazwy zmienionych pól — bez powodów wstrzymania, nazwisk, adresów i kwot; nazwy (np. strony) panel pokazuje z bieżących danych przy wyświetlaniu.

**AC3 — Prezentacja**
- Zakładając zmianę etapu „Warunki przyłączenia i projekt umowy” na „Czekamy na…” (Stoen Operator)
- Gdy otwieram dziennik
- Wtedy widzę wpis z autorem w nagłówku i treścią w formie bezosobowej: „Zmiana statusu etapu „Warunki przyłączenia i projekt umowy”: «Czekamy na…» · Czekamy na: Stoen Operator (OSD)”, z kompaktową odznaką statusu.

**AC4 — Filtr „Zmiany statusów”**
- Gdy wybieram filtr „Zmiany statusów”
- Wtedy widzę tylko zdarzenia automatyczne zlecenia i etapów (chipy „Media i dokumenty” i „Płatności” pojawiają się z E6 i E7).

**AC5 — Spójność (SR-API-06)**
- Zakładając błąd zapisu zdarzenia w teście
- Gdy wykonuje się przejście etapu
- Wtedy przejście też nie zostaje zapisane (jedna transakcja).

**AC6 — Tylko serwer tworzy zdarzenia**
- Gdy klient API próbuje utworzyć wpis z `kind = event`
- Wtedy API zwraca `400 validation_failed`, a zdarzeń nie da się poprawić („Popraw wpis” jest niedostępne).

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A, E i R widzą zdarzenia, a niezalogowany dostaje `401`.

## Poza zakresem
- Zdarzenia mediów, dokumentów i płatności — w historyjkach E6 i E7 (zależą od tej). Backfill zdarzeń dla zleceń sprzed tej historyjki — brak (dane syntetyczne).
- Powiadomienia o zmianach — M3.

## UX / UI
- W-08: typ „Zmiana statusu” (StatusBadge kompaktowa), filtr „Zmiany statusów”. Stany jak EVM-037.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt zdarzeń |
| Edytor | odczyt zdarzeń |
| Tylko odczyt | odczyt zdarzeń |
| Niezalogowany | brak (`401`) |

- Dane: kody i identyfikatory (bez wartości).
- W AC: SR-LOG-03, SR-DATA-01, SR-API-06, SR-AUTHZ-05. W sekcji: SR-INPUT-01.

## Notatki techniczne
- Moduły: `timeline` (handlery zdarzeń w procesie), `work-orders`, `procedures` (publikacja zdarzeń) + panel.
- Wpis `event` i audyt w tej samej transakcji co zmiana (handlery w procesie); pg-boss tylko do pracy asynchronicznej.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-038 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja (lista kodów zdarzeń) i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): zdarzenia transz — EVM-054 (także skutek anulowania zlecenia z EVM-053); EVM-058 bez nowych zdarzeń
