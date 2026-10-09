---
id: EVM-039
title: Klienci — lista, szczegóły, edycja i historia zleceń
type: story
milestone: M1
epic: E2 Klienci
status: done
path: pelna
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
Operacje API (addytywnie): `GET /customers` (kursor, 25 na stronę, sort `sort_name`, `id`, ICU pl-PL), `POST /customers/search` z kursorem, `GET /customers/{id}` (ETag), `PATCH /customers/{id}` (merge-patch, `If-Match`, idempotencja, audyt `customer.updated`), filtr `customerId` w `GET /work-orders`; licznik różnych klientów P10 (`DistinctReadMeter`); migracja `0017` tylko z indeksami; panel W-14 (lista, szczegóły z historią zleceń, dialog edycji). Pełny plan: `.scratch/EVM-039/plan.md` (roboczy).

## Decyzje
- 2026-10-08 — kontrakt `searchCustomers` rozszerzony addytywnie: pozycja wyniku ma teraz `kind`, `sortName` i `email` (kolumny W-14; dostęp mają te same trzy role, co szczegóły), domyślny `limit` 25 (było 20), `cursor` i `limit` w treści. Asercje testu EVM-020 („najwyżej 20”, „bez e-maila”) zmieniono świadomie jako uzgodnioną zmianę kontraktu, nie osłabienie testu (security-engineer, konsultacja przed implementacją).
- 2026-10-08 — kursor listy i wyszukiwania zawiera wyłącznie `id` ostatniego klienta (bez `sort_name`): nazwa może mieć ~400 znaków, nie mieści się w limicie pozycji kursora i trafiałaby do adresu oraz dziennika dostępu (SR-API-04).
- 2026-10-08 — klucz idempotencji `PATCH /customers/{customerId}` jest związany z `customerId` (jak w EVM-030); `maxLength` nazw wyświetlanych klienta (`displayName`, `sortName`) podniesiony z 400 do 401 znaków (imię 200 + spacja + nazwisko 200 — wcześniej taki klient dawał `500`).
- 2026-10-08 — P10: osobny licznik RÓŻNYCH klientów na użytkownika (okno 60 min, `alertCode: bulk_read_customers`), obok licznika rekordów; zasilają go też lista, wyszukiwanie i karta „Klient” zlecenia (`getWorkOrderCustomer`); `getWorkOrderSite` nie (to lokalizacje).

## Uwagi do rozważenia
- P10 dla kart: `getWorkOrderCustomer` zasila licznik różnych klientów; `getWorkOrderSite` i blokada 10 000 rekordów dla karty klienta — świadomie poza zakresem (ryzyko niskie; do backlogu / EVM-082).
- Filtr `customerId` w `GET /work-orders` nie sprawdza, czy klient jest usunięty (zlecenia usuniętego klienta są widoczne jak na liście zleceń); poprawić opis w kontrakcie, dodać test i zapisać decyzję w EVM-041.
- Puste `PATCH {}` (i patch bez zmian) podnosi `version` i zapisuje `customer.updated` — zwracać 200 bez zmiany wersji i bez audytu albo `minProperties: 1`.
- UX (minor): `break-all` → `break-words` dla e-maila na 360 px; ukrywać paginację przy jednej stronie; nagłówek `Disclosure` w dialogu na 360 px; kolumna „Utworzono” (AC2 mówi o dacie) — do potwierdzenia.
- Drobne: duplikat `SEARCH_DELAY_MS` i lokalny `RouterLink` w `panel-shell.tsx`; `MAX_TRACKED_DISTINCT_USERS` 10 000 (obniżyć); luki gałęzi w `edit-customer-dialog.tsx` i `customer-card.tsx`.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-039 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane; klasyfikacja i inwentaryzacja potwierdzone (SR-DATA-01)
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-08 — ready → in-progress (/deliver; ścieżka pelna: 8 AC, dane osobowe klientów, uprawnienia, nowe endpointy i UI; gałąź feature/EVM-039-customers)
- 2026-10-08 — plan gotowy (backend-developer)
- 2026-10-08 — backend gotowy (backend-developer): kontrakt, migracja 0017, lista / szczegóły / edycja, filtr `customerId`, licznik różnych klientów; panel (W-14) czeka na web-developera
- 2026-10-09 — panel gotowy (web-developer): W-14 lista, szczegóły z historią zleceń, dialog edycji (`If-Match`, `412`), „Przejdź do klienta” w W-06, stany AC8; testy komponentów i E2E (Chromium, Edge, Firefox), axe, zrzuty w `docs/ux/reviews/EVM-039/`
- 2026-10-09 — część bezpieczeństwa gotowa (security-engineer): SR-DATA-01 potwierdzone w `rodo.md` i `domain-model.md` (weryfikacja kodu i testów), aktualizacja EVM-039 w `threat-model.md` (AB-08 — drugi próg P10) i `requirements.md` (SR-API-05 — klucz związany z zasobem, SR-API-04, SR-AUTHZ-02)
- 2026-10-09 — bramki i przeglądy zaliczone (QA pass; code-reviewer, security-engineer, ux-designer — approve; 1 runda); orkiestrator: pnpm run gate EXIT 0, coverage:diff linie 99,2% / gałęzie 93,4%; → in-review
- 2026-10-09 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,36 mln tokenów subagentów, 9 agentów, 460 wywołań narzędzi, 1 runda, ok. 102 min; ścieżka pelna; vs baseline: brak danych
- 2026-10-09 — zaakceptowane przez Konrada, scalone do main (PR #39) → done
