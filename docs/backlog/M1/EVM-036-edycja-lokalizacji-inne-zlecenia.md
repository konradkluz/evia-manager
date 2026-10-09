---
id: EVM-036
title: Edycja lokalizacji i stron, inne zlecenia w tej lokalizacji
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: done
path: pelna
priority: P1
owner: backend-developer
contributors: [web-developer, security-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-018, EVM-071]
---

# EVM-036: Edycja lokalizacji i stron, inne zlecenia w tej lokalizacji

## Historyjka
Jako **pracownik biura** chcę **uzupełnić i poprawić dane lokalizacji i stron z poziomu zlecenia oraz zobaczyć wcześniejsze zlecenia w tej samej lokalizacji**, aby **dopisać PPE czy zarządcę, gdy je poznam, i wiedzieć, co już robiliśmy w tym garażu**.

## Kontekst
- Kandydaci P1 z EVM-004: edycja lokalizacji i danych strony (PO-1, luka L8), „Inne zlecenia w tej lokalizacji” (scenariusz D5).
- To częściowa historia lokalizacji — tylko metadane zleceń (konsultacja `security-engineer`, pkt 6e; SR-AUTHZ-08, AB-19). Pełna historia (dokumenty i zdjęcia poprzednich zleceń) — M3.
- Makiety: W-20 (EVM-071), [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) → karta „Lokalizacja”. Scenariusze: A1″ (bez banera z telefonu — M2), D5, D6.

## Kryteria akceptacji
**AC1 — Edytuj lokalizację**
- Zakładając lokalizację wspólną dla 2 zleceń
- Gdy w karcie „Lokalizacja” wybieram „Edytuj” i zmieniam PPE, moc przyłączeniową albo notatki
- Wtedy dialog W-20 ma pola z W-05 wypełnione bieżącymi danymi i informację „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (2).”, zapis odbywa się z `If-Match`, a po zapisie widzę toast „Zapisano zmiany lokalizacji.”, a fokus wraca do „Edytuj”.

**AC2 — OSD i zarządca lokalizacji (SR-INPUT-02)**
- Gdy w W-20 zmieniam OSD albo zarządcę (combobox stron z „Dodaj stronę”)
- Wtedy zapisuje się wybrana strona, a strona niewłaściwego rodzaju zwraca `400 validation_failed`.

**AC3 — Edytuj stronę**
- Gdy z menu `⋮` przy OSD wybieram „Edytuj stronę”
- Wtedy dialog ma pola strony i informację „Strona jest wspólna — zmiana będzie widoczna we wszystkich lokalizacjach i zleceniach z tą stroną.”, a zapis odbywa się z `If-Match` („Zapisano zmiany strony.”).

**AC4 — Konflikt**
- Gdy ktoś zmienił lokalizację albo stronę w międzyczasie
- Wtedy API zwraca `412 version_conflict`, panel pokazuje komunikat § 6.4, a wpisane dane zostają w dialogu.

**AC5 — Inne zlecenia w tej lokalizacji (SR-AUTHZ-03)**
- Zakładając rozliczone zlecenie `ZL-2026-0017` innego klienta w tej samej lokalizacji
- Gdy otwieram zlecenie `ZL-2026-0058`
- Wtedy karta „Lokalizacja” pokazuje „Inne zlecenia w tej lokalizacji (1)”: numer, tytuł, odznakę statusu i datę zamknięcia — bez nazwy i kontaktu klienta i bez miniatur; lista i licznik są liczone tą samą polityką co lista zleceń (warunek w zapytaniu), zlecenia usunięte widzi tylko Administrator, a kliknięcie otwiera W-06 innego zlecenia przez jego zwykłą autoryzację.

**AC6 — Brak dostępu przez lokalizację (SR-AUTHZ-08)**
- Zakładając zlecenia A i B w tej samej lokalizacji
- Gdy użytkownik próbuje przez `siteId` albo listę „inne zlecenia” pobrać media, dokumenty zlecenia lub dane klienta zlecenia B
- Wtedy API nie udostępnia ich inaczej niż przez autoryzację zlecenia B (test IDOR przez `siteId`); sekcja jest tylko w panelu.

**AC7 — Uprawnienia (SR-AUTHZ-04, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda edytuje lokalizację i stronę oraz odczytuje „inne zlecenia”
- Wtedy A i E edytują, R widzi karty bez „Edytuj” i dostaje `403 forbidden` przy zmianie, niezalogowany — `401`; pola kontrolowane przez serwer są odrzucane (`read_only_field`).

**AC8 — Stany**
- Wtedy: brak innych zleceń — sekcja ukryta; offline — „Edytuj” wyłączone; `429` — wzór z README makiet; notatki wyświetlane jako tekst (SR-WEB-03).

## Poza zakresem
- Baner „Zlecenie założone w terenie” z odnośnikami — M2 (E13).
- Pełna historia lokalizacji (dokumenty i zdjęcia poprzednich zleceń) — M3, z przeglądem `security-engineer`. Dokumenty z kotwicą lokalizacji — EVM-050.

## UX / UI
- W-20 (Dialog § 3.13, `size.dialog.width.md`, pola z W-05, InlineAlert z licznikiem), „Edytuj stronę”, sekcja „Inne zlecenia w tej lokalizacji” w karcie „Lokalizacja”.
- Stany: AC4, AC8; brak uprawnień — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | edycja lokalizacji i stron; inne zlecenia (także usunięte) |
| Edytor | edycja lokalizacji i stron; inne zlecenia |
| Tylko odczyt | podgląd kart i innych zleceń |
| Niezalogowany | brak (`401`) |

- Dane: `Site` (DO-K, PPE), `Party` (DO-3); metadane innych zleceń bez danych klientów.
- W AC: SR-INPUT-02, SR-AUTHZ-03, SR-AUTHZ-08, SR-AUTHZ-04, SR-AUTHZ-05, SR-WEB-03.
- W sekcji: SR-AUTHZ-02, SR-API-07 (`If-Match`), SR-DATA-01 (klasyfikacja bez nowych pól — potwierdzenie `security-engineer`), SR-DATA-02. Przegląd `security-engineer` obowiązkowy.

## Notatki techniczne
- Moduły: `sites`, `parties`, `work-orders` (lista z filtrem `siteId` — ta sama polityka) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Operacje API (addytywnie, kanał web): `GET/PATCH /sites/{siteId}` i `GET/PATCH /parties/{partyId}` (merge-patch, `If-Match`, idempotencja związana z zasobem, audyt `site.updated` / `party.updated` bez wartości), `GET /work-orders/{id}/site-orders` (id, numer, tytuł, status, data zamknięcia; limit 20; ta sama polityka co lista zleceń); migracja `0018` z indeksem; panel W-06: edycja lokalizacji i stron, sekcja „Inne zlecenia w tej lokalizacji”. Pełny plan: `.scratch/EVM-036/plan.md` (roboczy).

## Decyzje
- 2026-10-09 — „Inne zlecenia” to dedykowany endpoint `GET /work-orders/{workOrderId}/site-orders`, a nie filtr `siteId` na liście zleceń z notatek technicznych: lista zwraca nazwę klienta, której AC5 zabrania. Intencja (ta sama polityka odczytu `visibleWorkOrders` w zapytaniu listy i licznika) jest zachowana; `siteId` bierze serwer z wiersza zlecenia (`security-engineer`, AB-19).
- 2026-10-09 — AC5 „zlecenia usunięte widzi tylko Administrator”: do czasu EVM-060 zlecenia usunięte (soft delete) nie są widoczne dla nikogo, także dla Administratora — endpoint dziedziczy politykę odczytu zleceń. To bezpieczniejsze, ale formalnie odbiega od AC5; po EVM-060 (podgląd usuniętych) AC będzie spełnione bez zmiany endpointu. Do potwierdzenia przez Konrada na demo.
- 2026-10-09 — Rodzaj strony (`kind`) jest niezmienny (`400 read_only_field` w `PATCH /parties/{partyId}`): zmiana rodzaju mogłaby złamać regułę rodzaju OSD i zarządcy w lokalizacjach (SR-INPUT-02). Zmiana lokalizacji jest ograniczona do rodzaju stron wskazanych w treści żądania.

## Uwagi do rozważenia
1. Opisy w kontrakcie (`sites.yaml`, `parties.yaml`, `work-orders.yaml`) mówią `403 channel_not_allowed` dla tokenu mobilnego, a guard zwraca `403 forbidden` — ujednolicić opisy (rozbieżność całego kontraktu, nie tylko EVM-036).
2. Dialogi edycji: po `412` nieudane odświeżenie (offline/5xx) przyjmuje starą wersję z cache — przyjmować wynik tylko przy sukcesie i wyższej wersji; `legalForm` bez "Aktualnie: …" w konflikcie.
3. UX (minor): menu "Edytuj stronę…" wystaje na 360 px; powód wyłączenia "Edytuj" offline tylko w `title` (użyć `aria-disabled` + opis); przy > 20 zleceniach tylko "pokazano n z m" (pełna historia lokalizacji — M3); wpis do changeloga styleguide'u.
4. Migracja `0018` — zwykły `create index` (mała tabela w M1); przy większej tabeli `concurrently`. Niepokryte gałęzie: `work-order-page.tsx`, `use-party.ts`.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-036 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika (scenariusz D5)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-09 — ready → in-progress (/deliver; ścieżka pelna: 8 AC, dane osobowe (PPE, strony), uprawnienia, nowe endpointy i UI; gałąź feature/EVM-036-site-editing)
- 2026-10-09 — plan gotowy (backend-developer)
- 2026-10-09 — backend gotowy (backend-developer): kontrakt, `sites`/`parties` GET i PATCH, `site-orders`, migracja 0018, audyt; UI (web-developer) czeka
- 2026-10-09 — panel gotowy (web-developer): dialogi W-20 „Edytuj lokalizację” i „Edytuj stronę”, sekcja „Inne zlecenia”, testy komponentów, E2E (Chromium, Firefox, Edge), axe i zrzuty w docs/ux/reviews/EVM-036; do przeglądów
- 2026-10-09 — część bezpieczeństwa (security-engineer): 10 kontroli obowiązkowych sprawdzonych w kodzie i testach (macierz ról, IDOR przez `siteId`, If-Match, idempotencja, audyt bez wartości, XSS), `pnpm run scan` zielony, rodo.md / threat-model.md / api-guidelines.md zgodne z kodem; minor: opis `403 channel_not_allowed` w kontrakcie zamiast zwracanego `403 forbidden`
- 2026-10-09 — bramki i przeglądy zaliczone (QA pass; code-reviewer, security-engineer, ux-designer — approve; 1 runda); orkiestrator: pnpm run gate EXIT 0, coverage:diff linie 99,3% / gałęzie 93,7%; → in-review
- 2026-10-09 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,24 mln tokenów subagentów, 9 agentów, 406 wywołań narzędzi, 1 runda, ok. 85 min; ścieżka pelna; vs baseline: brak danych
- 2026-10-09 — zaakceptowane przez Konrada, scalone do main (PR #41) → done
