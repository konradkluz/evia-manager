---
id: EVM-055
title: Zestawienie nieopłaconych i po terminie
type: story
milestone: M1
epic: E7 Płatności etapowe
status: in-review
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-017, EVM-039, EVM-054]
---

# EVM-055: Zestawienie nieopłaconych i po terminie

## Historyjka
Jako **pracownik biura albo księgowa (Tylko odczyt)** chcę **jedno zestawienie wystawionych, a nieopłaconych faktur — najpierw po terminie — z sumami**, aby **wiedzieć, komu przypomnieć o płatności i ile pieniędzy czeka**.

## Kontekst
- Słownik: „nieopłacone” = transze „Wystawiona” (także po terminie); „po terminie” = „Wystawiona” z terminem wcześniejszym niż dziś (`Europe/Warsaw`) — wyliczane, niezapisywane.
- P6: Tylko odczyt widzi płatności (decyzja 7 z EVM-004: księgowość = Tylko odczyt).
- Makieta: [W-11](../../ux/flows/08-nieoplacone.md#w-11-nieopłacone). Scenariusze: A12, A13, B9, C7.

## Kryteria akceptacji
**AC1 — Zestawienie**
- Zakładając 12 transz „Wystawiona” w różnych zleceniach
- Gdy otwieram „Płatności” w Sidebarze
- Wtedy widzę tabelę (termin, dni po terminie, zlecenie, klient, transza, nr faktury, kwota, status) posortowaną „Najdłużej po terminie”, z paginacją; wiersz prowadzi do W-06, a A i E mają „Odnotuj wpłatę” (EVM-054).

**AC2 — Po terminie**
- Zakładając zegar `Europe/Warsaw` = 2026-10-03 i transze z terminami 2026-09-28 i 2026-10-03
- Gdy otwieram zestawienie
- Wtedy pierwsza ma „Po terminie” z „5 dni” (ikona, etykieta i liczba — nie sam kolor), a druga jest „Wystawiona” bez oznaczenia.

**AC3 — Kafle i suma (SR-AUTHZ-03)**
- Gdy otwieram zestawienie
- Wtedy kafle pokazują „Nieopłacone: 12 transz · 48 300,00 zł”, „Po terminie: 4 · 15 200,00 zł” i „Najdłużej po terminie: 21 dni · ZL-2026-0031”, a suma pod tabelą zgadza się z filtrami — wszystkie liczone tą samą polityką co lista (warunek w zapytaniu).

**AC4 — Filtry (SR-API-04)**
- Gdy wybieram „Po terminie”, zakres terminów i klienta (wyszukiwanie klienta przez `POST …/search`)
- Wtedy lista i sumy się zawężają, w URL jest tylko „Wszystkie wystawione” / „Po terminie”, a zakres dat i klient są w pamięci karty.

**AC5 — Tylko odczyt (SR-AUTHZ-06, P6)**
- Zakładając rolę Tylko odczyt
- Gdy otwiera zestawienie
- Wtedy widzi kwoty, numery faktur, terminy i „Po terminie” bez akcji i bez `⋮`, a mutacje zwracają `403 forbidden`.

**AC6 — Limity (SR-API-02)**
- Wtedy rekordy zestawienia wliczają się do progu masowego odczytu (P10), a przekroczenie limitów daje `429` z komunikatem.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A, E i R widzą zestawienie, niezalogowany dostaje `401`; operacja jest w macierzy ról.

**AC8 — Stany**
- Wtedy: brak nieopłaconych — „Wszystkie wystawione faktury są opłacone.” (`circle-check`); brak wyników filtrów — „Brak transz spełniających filtry. [Wyczyść filtry]”; offline — dane z pamięci karty z banerem, akcje wyłączone; `412` / `409` w dialogu wpłaty — alert z bieżącym statusem transzy i „Odśwież” (komunikat z makiety W-11).

## Poza zakresem
- Filtr „Do wystawienia” — EVM-059 (P2). Eksport zestawienia — M4 (Administrator). Przypomnienia o płatnościach — M3.

## UX / UI
- W-11: kafle sum (Card § 3.8), FilterChip, DatePicker zakres, Combobox klienta, DataTable (§ 3.6) z kwotami `text.numeric`, StatusBadge płatności. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | zestawienie, odnotowanie wpłaty |
| Edytor | zestawienie, odnotowanie wpłaty |
| Tylko odczyt | zestawienie (bez akcji) |
| Niezalogowany | brak (`401`) |

- Dane: kwoty, numery faktur, nazwy klientów (DO-K).
- W AC: SR-AUTHZ-03, SR-API-04, SR-AUTHZ-06, SR-API-02, SR-AUTHZ-05. Polityki P6, P10.

## Notatki techniczne
- Moduły: `payments` (lista), fasady `work-orders`, `customers` (wsadowo) + panel. „Po terminie” liczony w zapytaniu z wstrzykiwanego zegara.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
- Kontrakt: `GET /api/v1/payment-milestones` (`listUnpaidPaymentMilestones`, tylko web, role A/E/R) — filtry `view=unpaid|overdue`, `dueFrom`/`dueTo`, `customerId`; porządek `(due_date, id)`, paginacja kursorowa (kursor AES-GCM z `asOf`, związany z operacją, użytkownikiem i filtrami); `summary` (kafle i suma filtrowana w `MoneyTotal`) i `asOf`; `version` w pozycji do `If-Match` przejścia wpłaty (EVM-054).
- Granica modułów (architekt, wariant C′, bez ADR): `payments` wybiera `DISTINCT work_order_id` transz „Wystawiona”; nowa addytywna metoda fasady `WorkOrderDirectory.refsOf(tx, principal, ids)` zawęża zbiór polityką odczytu zlecenia jednym zapytaniem (`= any($1::uuid[])`); lista, kafle i suma dostają widoczne ID jako warunek zapytania; nazwy klientów z `CustomerDirectory.displayNamesOf`. Wszystko w jednej transakcji `repeatable read` (jedna migawka, jeden `asOf` z `CLOCK`, Europe/Warsaw), stała liczba zapytań.
- `overdueDays` — jedna funkcja domenowa; SQL tylko `due_date < :asOf`.
- Migracja `0030` (expand only): częściowy indeks `(due_date, id) WHERE status='invoiced' AND deleted_at IS NULL`; test p95 < 300 ms na 10 tys. transz.
- P10: `before` → odczyt → `after(items.length)`, `objectType payment_milestone`, licznik różnych klientów 300/h; bez audytu odczytu.
- Panel: trasa `/payments` (W-11) — kafle, filtry (w URL tylko `view=overdue`), tabela/karty, „Odnotuj wpłatę” i menu z dialogami EVM-054, stany z AC8. Pełny plan: `.scratch/EVM-055/plan.md`.

## Decyzje
- 2026-10-13 — Konrad zaakceptował (P1–P7 z `/refine` EVM-053): P6 — `model: sonnet` (głównie odczyt); P2 — zmiana kwoty transzy innej niż „Planowana” zwraca `403`; P3 — sumy „Nieopłacone” liczą tylko transze „Wystawiona”, bez zmiany AC.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-055 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona — dokumentacja (wytyczne API, README, CHANGELOG) tak; instrukcji EVM-066 jeszcze nie ma (EVM-066 `ready`) — do decyzji Konrada na demo (jak w EVM-053/EVM-054)
- [ ] Demo i akceptacja użytkownika (scenariusz A12)

## Notatki
- Uwagi z przeglądu domknięte przez web-developera po potoku (`50237ea`, `2c866fe`, `ec520f0`, `8ba1ef6`): jedna etykieta odznaki „Po terminie” z i18n w W-11 i W-06 (styleguide § 4.4), `CustomerPicker` wyłączony offline (AC8), token szerokości zamiast `w-80`, pomocnicze funkcje dat w osobnym module.
- Do backlogu (security, nit): metryka rozmiaru zbioru `unpaidOrderIds` i osobny kubełek rate limitu dla `listUnpaidPaymentMilestones` przy wzroście danych (M3/M4; CWE-400); test „brak wyroczni” bez przypadku widocznego klienta bez faktur (dowód, nie podatność).
- Nit QA: przypadek integracyjny w dniu zmiany czasu (2026-10-25) tylko jednostkowo.
- Do backlogu (UX): `DataTable` nie rysuje widocznego wskaźnika sortowania (jest `aria-sort`) i w kartach na 360 pokazuje pusty wiersz „Dni po terminie: —” — zmiana we wspólnej bibliotece, decyzja ux-designera.
- UX: przegląd ux-designera bez żywej aplikacji (oparty na kodzie i zrzutach) — klawiatura, fokus i kontrast „N dni” do potwierdzenia na demo (A12).

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada (refinement EVM-013; EVM-071 → „Uwagi do rozważenia” 18; liczba AC bez zmian): AC8 — komunikat `412` / `409` w dialogu wpłaty wg makiety W-11 (forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka pełna, model sonnet, gałąź `feature/EVM-055-zestawienie-nieoplaconych` ułożona na EVM-054 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — backend EVM-055 gotowy: kontrakt `listUnpaidPaymentMilestones`, migracja `0030`, fasada `refsOf`, serwis i testy (backend-developer); panel W-11 — kolejny krok
- 2026-10-14 — panel W-11 gotowy (web-developer): strona `/payments`, kafle, filtry, tabela, „Odnotuj wpłatę” i menu, stany; testy komponentów i Playwright (Chromium, Firefox, Edge), axe, zrzuty w `docs/ux/reviews/EVM-055/`
- 2026-10-14 — potok `wf_cd02d06e-f1b`: passed po 1 rundzie (QA PASS AC1–AC8; code-reviewer, security-engineer, ux-designer APPROVE; konsultacja architekta przed implementacją — wariant C′ z fasadą `refsOf`, bez ADR)
- 2026-10-14 — web-developer: uwagi z przeglądu domknięte (etykieta „Po terminie” z i18n w W-11 i W-06, `CustomerPicker` offline, token szerokości, moduł `milestone-days`); asercje E2E akcji transz dopuszczają „Wystawiona” lub „Po terminie” (zależność od zegara przeglądarki — jak w propozycji dla EVM-037 AC3)
- 2026-10-14 — orkiestrator: `pnpm run gate` zielony (diff-coverage linie 1474/1492, gałęzie 1277/1387), `docs:check` 0/0; in-progress → in-review
- 2026-10-14 — Koszt: brak rozbicia w $; potok 9 wywołań agentów, ok. 1,21 mln tokenów subagentów, ok. 87 min (+ poprawki web ok. 0,08 mln, 7 min); rundy poprawek 0; ścieżka pełna; sonnet
