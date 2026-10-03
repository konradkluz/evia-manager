---
id: EVM-039
title: Klienci — lista, szczegóły, edycja i historia zleceń
type: story
milestone: M1
epic: E2 Klienci
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, security-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-022, EVM-071]
---

# EVM-039: Klienci — lista, szczegóły, edycja i historia zleceń

## Historyjka
Jako **pracownik biura** chcę **przeglądać klientów, poprawiać ich dane i widzieć wszystkie zlecenia danego klienta**, aby **szybko obsłużyć powracającego klienta i mieć aktualne dane kontaktowe**.

## Kontekst
- Zakres roadmapy E2: osoba / firma, dane kontaktowe, wyszukiwanie (polskie znaki), historia zleceń klienta.
- Historia zleceń korzysta z listy `work-orders` z filtrem `customerId` — ta sama polityka co lista zleceń (konsultacja `solution-architect`, C; SR-AUTHZ-03).
- RR-13, P10: alert przy odczycie > 300 różnych klientów w ciągu godziny (konsultacja `security-engineer`, pkt 5a).
- Makieta: W-14 (EVM-071); wejście z W-06 „Przejdź do klienta”. Scenariusze: A1″ (uzupełnienie e-maila klienta), D4.

## Kryteria akceptacji
**AC1 — Lista i wyszukiwanie (SR-API-04)**
- Zakładając klientów „Łukasz Testowy”, „Lucyna Przykładowa”, „Marek Fikcyjny”
- Gdy otwieram „Klienci” w Sidebarze
- Wtedy lista jest posortowana wg polskiego alfabetu (nazwisko przed imieniem; „Ł” po „L”), ma paginację kursorem, a wyszukiwanie (≥ 3 znaki, `POST /api/v1/customers/search`, „Lodz” → „Łódź”) zawęża listę bez umieszczania frazy w URL.

**AC2 — Szczegóły i historia zleceń (SR-AUTHZ-03)**
- Zakładając klienta z 3 zleceniami
- Gdy otwieram jego szczegóły
- Wtedy widzę dane (osoba albo firma, telefon, e-mail, adres korespondencyjny, notatki) i „Historia zleceń”: numer, tytuł, status, data — liczoną tą samą polityką co lista zleceń; kliknięcie otwiera W-06, a „Przejdź do klienta” w W-06 prowadzi tutaj.

**AC3 — Edycja**
- Gdy w dialogu edycji zmieniam telefon albo dodaję e-mail
- Wtedy obowiązuje walidacja jak przy dodaniu (EVM-020), zapis odbywa się z `If-Match`, a przy `412` widzę komunikat z zachowanymi danymi.

**AC4 — Walidacja serwera (SR-AUTHZ-04, SR-DATA-02)**
- Gdy żądanie edycji zawiera pole spoza schematu albo pole kontrolowane przez serwer
- Wtedy API zwraca `400 validation_failed` (`read_only_field`); przy notatkach jest ostrzeżenie „Nie wpisuj PESEL…”.

**AC5 — Masowy odczyt klientów (SR-API-02, P10, RR-13)**
- Zakładając użytkownika, który w ciągu godziny odczytał (lista, wyszukiwanie, szczegóły) 300 różnych klientów
- Gdy odczytuje kolejnego
- Wtedy powstaje alert bezpieczeństwa (bez danych osobowych), a rekordy wliczają się do progu z EVM-017 (> 10 000 w 10 min → `429`).

**AC6 — Klient usunięty (SR-AUTHZ-02)**
- Zakładając klienta usuniętego (soft delete)
- Gdy Edytor albo Tylko odczyt otwiera go po `id`
- Wtedy API zwraca `404 not_found`, a klient nie występuje na liście ani w wynikach wyszukiwania.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda przegląda i edytuje klienta
- Wtedy A i E edytują, R tylko przegląda (`403 forbidden` przy zmianie, akcje ukryte), niezalogowany — `401`.

**AC8 — Stany**
- Wtedy: brak klientów — „Nie masz jeszcze klientów. Dodasz ich przy nowym zleceniu.”; brak wyników — „Brak klientów spełniających kryteria.”; ładowanie — Skeleton; offline — dane z pamięci karty z banerem; `429` — wzór z README makiet; tytuł karty „Klienci · EVia Manager” (bez nazwiska).

## Poza zakresem
- Usunięcie, przywrócenie i anonimizacja — EVM-041. Dokumenty klienta — EVM-050.
- Scalanie duplikatów, eksport danych klienta (M4), osobny formularz „Nowy klient” (klient powstaje przy zleceniu).

## UX / UI
- W-14: DataTable (§ 3.6), SearchField (§ 3.7), szczegóły (Card § 3.8), dialog edycji (pola z „Dodaj klienta”), lista „Historia zleceń”.
- Stany: AC8; brak uprawnień — AC6, AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | lista, szczegóły, edycja |
| Edytor | lista, szczegóły, edycja |
| Tylko odczyt | lista, szczegóły |
| Niezalogowany | brak (`401`) |

- Dane: `Customer` (DO-K).
- W AC: SR-API-04, SR-AUTHZ-03, SR-AUTHZ-04, SR-DATA-02, SR-API-02, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-01, SR-INPUT-03, SR-INPUT-05, SR-WEB-03, SR-DATA-01 (klasyfikacja i inwentaryzacja — `security-engineer`), SR-DATA-03. Polityka P10.

## Notatki techniczne
- Moduły: `customers`, `work-orders` (lista z filtrem `customerId`) + panel.
- Sortowanie wg kolacji ICU `pl-PL` (test kolejności). Test „Lodz” → „Łódź”.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-039 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; klasyfikacja i inwentaryzacja potwierdzone (SR-DATA-01)
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
