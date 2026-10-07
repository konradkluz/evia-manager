---
id: EVM-029
title: Ponowne uwierzytelnienie (step-up) i dziennik audytu dla Administratora
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-review
path: pelna
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-015, EVM-067]
---

# EVM-029: Ponowne uwierzytelnienie (step-up) i dziennik audytu dla Administratora

## Historyjka
Jako **Administrator** chcę **przeglądać dziennik audytu po ponownym potwierdzeniu tożsamości**, aby **sprawdzić, kto i co zrobił w systemie, a operacje wrażliwe były chronione nawet przy pozostawionej otwartej sesji**.

## Kontekst
- Właściciel mechanizmu step-up (konsultacja `security-engineer`, pkt 3d): bez osobnej historyjki EVM-024 przekroczyłaby 8 AC. Dziennik audytu (W-18) to pierwsza operacja wymagająca step-upu i daje wartość od razu — audyt zbiera zdarzenia od EVM-016.
- ADR-0005 (step-up > 15 min), P2 (lista operacji ze step-upem), SR-SESS-08, SR-SESS-02; uwaga 2 EVM-004 (kod odzyskiwania przy step-upie — decyzja 16).
- Makiety: [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie), W-18 (EVM-015).

## Kryteria akceptacji
**AC1 — Step-up wymagany (SR-SESS-08)**
- Zakładając Administratora, którego ostatnie uwierzytelnienie było 16 min temu (zegar kontrolowany)
- Gdy otwiera „Administracja → Dziennik audytu”
- Wtedy API zwraca `403 step_up_required`, panel pokazuje W-04 „Potwierdź tożsamość, aby przejrzeć dziennik audytu”, a po użyciu klucza dostępu żądanie jest wysyłane ponownie automatycznie.

**AC2 — Okno 15 minut**
- Zakładając ostatnie uwierzytelnienie kluczem dostępu 14 min temu
- Gdy Administrator otwiera dziennik audytu
- Wtedy W-04 się nie pojawia; a gdy sesja pochodzi z logowania kodem odzyskiwania (bez późniejszego step-upu), W-04 pojawia się także w ciągu 15 min.

**AC3 — Nowa sesja po step-upie (SR-SESS-02)**
- Gdy Administrator potwierdza tożsamość w W-04
- Wtedy identyfikator sesji się zmienia, poprzedni jest natychmiast nieważny, a czas ostatniego uwierzytelnienia jest zaktualizowany.

**AC4 — Metody i anulowanie (P1, decyzja 16)**
- Zakładając W-04
- Gdy Administrator potwierdza tożsamość
- Wtedy jedyną metodą jest klucz dostępu, kod odzyskiwania jest niedostępny; nieudany klucz daje komunikat w dialogu (dialog zostaje), a „Anuluj” nie wykonuje operacji i zostawia dane formularza.

**AC5 — Dziennik audytu (W-18, P9)**
- Zakładając zdarzenia z ostatnich 30 dni
- Gdy Administrator przegląda dziennik
- Wtedy widzi zdarzenia od najnowszych (czas, osoba — `displayName`, akcja, wynik, obiekt — typ i identyfikator albo numer zlecenia, IP z prefiksem /24 lub /48) z filtrami: akcja, osoba, wynik, okres; paginacja kursorem; bez wartości danych osobowych.

**AC6 — Odczyt audytu jest audytowany (SR-LOG-03)**
- Gdy Administrator otwiera albo filtruje dziennik audytu
- Wtedy powstaje zdarzenie odczytu audytu, a kontrakt nie ma operacji zmiany ani usunięcia zdarzeń.

**AC7 — Uprawnienia (SR-AUTHZ-11, SR-AUTHZ-05)**
- Zakładając role Edytor, Tylko odczyt i niezalogowanego
- Gdy próbują odczytać dziennik audytu
- Wtedy E i R nie widzą pozycji „Administracja”, API zwraca im `403 forbidden`, niezalogowany dostaje `401`, a operacje ze step-upem mają `channels: [web]` (lint).

**AC8 — Stany**
- Wtedy: brak zdarzeń — „Brak zdarzeń w wybranym okresie.”; ładowanie — Skeleton wierszy; błąd — „Nie udało się wczytać dziennika. [Spróbuj ponownie]”; `429` — wzór z README makiet; offline — W-04 „Brak połączenia. Potwierdzenie wymaga połączenia z internetem.”

## Poza zakresem
- Eksport audytu (Administrator ze step-upem) — M4. Usuwanie po retencji 2 lat — zadanie retencji M4 (P4).
- Kod z aplikacji przy step-upie (Edytor) — EVM-023. Kolejne operacje ze step-upem dołączają w swoich historyjkach.

## UX / UI
- W-04 (Dialog § 3.13, `size.dialog.width.sm`), W-18 (DataTable § 3.6, FilterBar § 3.7, DatePicker zakres § 3.5), Sidebar „Administracja” tylko dla A.
- Stany: AC8; brak uprawnień — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | dziennik audytu po step-upie |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: zdarzenia audytu (DO-P: osoba, IP z prefiksem, user agent).
- W AC: SR-SESS-08, SR-SESS-02, SR-LOG-03, SR-AUTHZ-11, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-AUTHZ-12 (step-up tylko kanał `web`), SR-LOG-04, SR-DATA-03. Polityki P1, P2, P9.

## Notatki techniczne
- Moduły: `identity` (step-up), `audit` (odczyt), `authorization` + panel.
- Zdolność przekrojowa wprowadzana tutaj: step-up (`403 step_up_required`, 15 min, nowe ID sesji) i dialog W-04 — używają go EVM-024, EVM-027, EVM-030, EVM-040, EVM-041, EVM-049, EVM-051, EVM-052, EVM-057, EVM-060.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
- Filtr „Osoba” (W-18) pokazuje tylko osoby z wczytanych stron — brak listy kont do M1/EVM-024 (W-16); dopisać w EVM-024 źródło listy osób.
- `isForbidden` w audit-page traktuje każde 403 ≠ step_up_required jako „Brak dostępu” (też csrf_failed) — zawęzić do `forbidden`.
- Ukrycie wczytanej strony po 15 min opiera się na step-upie w tej karcie; rozważyć `passkeyAuthenticatedAt` w `getCurrentSession`.
- `AuditReadEvent.outcome` dopuszcza martwe `denied` (YAGNI); kilka niepokrytych gałęzi web (nit).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-029 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; step-up wydzielony z EVM-024 — konsultacja security-engineer pkt 3d)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo końcowym EVM-015 (EVM-015 → „Uwagi do rozważenia” 8; ustalenie `security-engineer`; liczba AC bez zmian): AC2 — okno step-upu liczone od uwierzytelnienia kluczem dostępu; logowanie kodem odzyskiwania go nie otwiera (decyzja 16)
- 2026-10-07 — ready → in-progress (/deliver; ścieżka pelna: uwierzytelnianie i uprawnienia; gałąź feature/EVM-029-step-up-audit-log)
- 2026-10-07 — plan gotowy (backend-developer)
- 2026-10-07 — implementacja API (backend-developer): kontrakt, migracja 0009, step-up, dziennik audytu, macierz ról; panel W-04 / W-18 — web-developer
- 2026-10-07 — panel W-04 (dialog step-up) i W-18 (dziennik audytu) gotowy (web-developer): nowe komponenty Select, DateField, FilterChip, DataTable; testy Vitest i Playwright (Chromium, Edge, Firefox), axe, zrzuty w docs/ux/reviews/EVM-029
- 2026-10-07 — bramki i przeglądy zaliczone (QA pass; code-reviewer, security-engineer, ux-designer — approve; 1 runda); orkiestrator: pnpm run gate EXIT 0, docs:check 0/0, coverage:diff linie 99,4% / gałęzie 95,6%; → in-review
- 2026-10-07 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,16 mln tokenów subagentów, 8 agentów, 354 wywołania narzędzi, 1 runda, ok. 65 min; ścieżka pelna; vs baseline: brak danych
