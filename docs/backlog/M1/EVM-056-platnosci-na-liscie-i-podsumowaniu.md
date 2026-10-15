---
id: EVM-056
title: Płatności na liście zleceń i w podsumowaniu zlecenia
type: story
milestone: M1
epic: E7 Płatności etapowe
status: done
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: opus
depends_on: [EVM-034, EVM-054, EVM-069]
---

# EVM-056: Płatności na liście zleceń i w podsumowaniu zlecenia

## Historyjka
Jako **pracownik biura** chcę **widzieć na liście zleceń i w podsumowaniu zlecenia, co jest nieopłacone i po terminie, oraz mieć listę posortowaną od najpilniejszych**, aby **zaczynać dzień od spraw, które wymagają działania**.

## Kontekst
- **Wymaga ADR EVM-069** (model odczytu — luka L3): kolumna „Płatność”, widoki „Po terminie” i „Nieopłacone”, sortowanie „Najpilniejsze” łączą dane `payments` i `procedures` z listą `work-orders`.
- Makiety: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) (kolumna „Płatność”, widoki, „Najpilniejsze” — § 4.2 styleguide'u), [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (kafel „Płatności”).

## Kryteria akceptacji
**AC1 — Kolumna „Płatność”**
- Zakładając zlecenia: z transzą po terminie (3 600,00 zł), z jedną wystawioną (4 500,00 zł), z wszystkimi opłaconymi i bez wystawionych
- Gdy otwieram W-10
- Wtedy kolumna pokazuje odpowiednio: mocną odznakę „Po terminie” z kwotą, „Nieopłacone (1)” z sumą, „Opłacone”, „—”.

**AC2 — Widoki „Po terminie” i „Nieopłacone”**
- Gdy wybieram widok „Po terminie” albo „Nieopłacone”
- Wtedy lista zawiera zlecenia z transzą po terminie albo z transzą „Wystawiona”, a URL zawiera tylko identyfikator widoku.

**AC3 — Sortowanie „Najpilniejsze”**
- Gdy wybieram „Najpilniejsze” (od tej historyjki — domyślne sortowanie W-10)
- Wtedy najpierw są zlecenia z płatnością i etapem po terminie, potem z najdłuższym oczekiwaniem powyżej progu, potem wg najbliższego terminu rosnąco — zgodnie z definicją w ADR EVM-069.

**AC4 — Kafel „Płatności” w W-06**
- Gdy otwieram zlecenie z 4 transzami
- Wtedy kafel pokazuje „Nieopłacone: 3 600,00 zł (1)”, „Po terminie” z liczbą dni, „Planowane: 3” i „Opłacone: 0 z 4” (drugą liczbę tworzą transze bez „Anulowana”).

**AC5 — Po terminie liczone z daty**
- Zakładając zegar `Europe/Warsaw` przestawiony z 2026-10-07 na 2026-10-08 i transzę z terminem 2026-10-07
- Gdy odświeżam listę
- Wtedy transza jest „po terminie” dopiero 2026-10-08 — wartość jest liczona w zapytaniu, nie zapisywana.

**AC6 — Polityka i wydajność (SR-AUTHZ-03)**
- Zakładając 10 000 syntetycznych zleceń
- Gdy sortuję „Najpilniejsze” z widokiem „Nieopłacone”
- Wtedy p95 czasu odpowiedzi API jest < 300 ms, bez zapytań N+1, a zlecenia spoza uprawnień nie wpływają na kolejność ani sumy.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A, E i R (P6) widzą kolumnę, widoki i kafel; niezalogowany — `401`.

**AC8 — Stany**
- Wtedy offline — dane z pamięci karty z banerem; błąd kafla — alert w kaflu; `429` — wzór z README makiet.

## Poza zakresem
- Pulpit z lejkiem zleceń i nieopłaconymi — M3. Zapamiętywanie sortowania po stronie serwera — później.

## UX / UI
Specyfikacja (ux-designer, 2026-10-14). Makiety wiążące: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) i [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (kafel „Płatności”); to nie nowe ekrany, tylko dopięcie danych do istniejących. Bez nowych tokenów i komponentów.

**Przepływ:** W-10 otwiera się z „Najpilniejsze” (`sort=urgency` wysyłane jawnie, zapamiętane tylko w pamięci karty — poza URL; widok to jedyny parametr URL: ID widoku) → wybór widoku „Po terminie” / „Nieopłacone” → wiersz → W-06, kafel „Płatności” prowadzi kotwicą `#platnosci` do sekcji transz (istniejące zachowanie, EVM-054). Widoki dotyczą tylko zleceń niezamkniętych (ADR-0017 pyt. 7).

**W-10 — kolumna „Płatność”** (DataTable § 3.6; StatusBadge § 3.9; kolumna i nagłówek do prawej, liczby `text.numeric` — § 4.2). Pierwszeństwo wg ADR-0017 pyt. 4: Po terminie > Nieopłacone > Opłacone > „—”.
| Stan | Zawartość komórki |
|---|---|
| Po terminie | mocna StatusBadge `color.status.payment.overdue.*`, ikona `alarm-clock`, etykieta „Po terminie” (klucz `workOrders.status.paymentOverdue`); pod nią suma transz po terminie, np. „3 600,00 zł” |
| Nieopłacone | subtelna StatusBadge `color.status.payment.invoiced.*` z etykietą „Nieopłacone (1)”; pod nią suma wystawionych, np. „4 500,00 zł” |
| Opłacone | subtelna StatusBadge `color.status.payment.paid.*`, etykieta „Opłacone”, bez kwoty |
| Brak wystawionych | „—” (`color.text.secondary`) z ukrytą dla wzroku nazwą „Brak wystawionych transz” |
- Pełna nazwa dostępna wiersza dopisuje płatność: „płatność po terminie, 3 600,00 zł” / „nieopłacone: 1, 4 500,00 zł” / „opłacone” / „brak wystawionych transz” (zdanie na końcu nazwy wiersza z makiety). Liczba dni po terminie nie jest na liście (tylko w W-06).
- Zapisane widoki „Po terminie” i „Nieopłacone”: chipy widoków bez zmian; widoczne tylko z prawem odczytu płatności (A, E, R — P6; reguła z `x-evia-authz`). Opis widoku w `aria-describedby`: „Tylko zlecenia niezamknięte.”
- Sortowanie: Select „Sortuj” (§ 3.3) z opcjami „Najpilniejsze” (domyślna, pierwsza), „Najdłużej czekamy”, „Termin”, „Numer”; zmiana ogłaszana `aria-live="polite"` („Sortowanie: Najpilniejsze”). Bez ikon „strzałek”, bo kolejność złożona; nagłówki kolumn bez `aria-sort` przy „Najpilniejsze”.
- Responsywność: `breakpoint.expanded`/`wide` — kolumna „Płatność” jak w makiecie; `medium` — kolumna zostaje (Sidebar zwinięty); `compact` — karta (§ 3.6/3.8): ostatni wiersz karty = odznaka + kwota obok siebie, cel dotyku karty cały. Brak ikon-tylko: etykieta zawsze widoczna.
- Stany: ładowanie — Skeleton wierszy (§ 3.16), kolumna „Płatność” też szkieletem (nie pusta); pusty widok „Po terminie” — „Brak zleceń z płatnością po terminie. Dobra wiadomość.”; „Nieopłacone” — „Brak zleceń z nieopłaconymi transzami.” (oba EmptyState bez przycisku, jak widok OSD); błąd — wzór listy („Nie udało się wczytać zleceń. [Spróbuj ponownie]”); `429` — „Zbyt wiele zapytań. Spróbuj ponownie za 1 min.” (czas z `Retry-After`), filtry zostają; offline — ostatnia strona z pamięci karty z banerem „Dane mogą być nieaktualne (z 14:05)”, Select sortowania i chipy widoków wyłączone z podpowiedzią, kolumna „Płatność” z danych z pamięci (kwoty z tego samego zapisu); brak uprawnień (rola bez odczytu płatności, poza v1) — kolumna, chipy płatności i opcja płatności w sortowaniu nie istnieją (`hiddenFields`), link do widoku płatności spoza uprawnień → „Nie znaleziono widoku. [Pokaż wszystkie zlecenia]”.

**W-06 — kafel „Płatności”** (czwarty kafel karty podsumowania, Card § 3.8, reguły z W-06 „Karta podsumowania”): wiersze „Nieopłacone: 3 600,00 zł (1)” (`text.numeric`), mocna odznaka „Po terminie” + „5 dni” (najdłużej po terminie z transz wystawionych; odmiana „1 dzień / 5 dni”, § 6.3; tylko gdy jest transza po terminie — inaczej wiersz nieobecny, bez „0”), „Planowane: 3”, „Opłacone: 0 z 4” (y bez „Anulowana” — P3). Wiersz „Nieopłacone” bez wystawionych — „Nieopłacone: 0,00 zł”; zlecenie bez transz — jedna linia „Brak transz.” (bez własnego przycisku — akcja „Dodaj transzę” jest w sekcji). Cały kafel to odnośnik do `#platnosci` (kotwica z EVM-054, nazwa dostępna: „Płatności: nieopłacone 3 600,00 zł, 1 transza, po terminie 5 dni, planowane 3, opłacone 0 z 4”). Stany: ładowanie — Skeleton czterech kafli (istniejący); błąd kafla — InlineAlert w kaflu (`role="alert"`, `circle-alert`) „Nie udało się wczytać płatności. [Spróbuj ponownie]”, pozostałe kafle działają; `429` — wzór z README; offline — dane z pamięci karty pod banerem strony; brak odczytu płatności — kafel ukryty, kolejne kafle się nie przesuwają „z dziurą” (siatka kafli układa pozostałe). Responsywność: kafle 4 → 2×2 (`medium`) → kolumna (`compact`).

**A11y:** „Po terminie” niesie ikona + etykieta (nie sam kolor); kontrast tokenów 8,31:1 (§ 2); kwoty i dni `tabular-nums`; fokus widoczny `color.focus.ring` na wierszu-linku, chipach, Select i kaflu-odnośniku; wszystkie akcje klawiaturą; zmiana wyników po sortowaniu/widoku — `aria-live="polite"` z licznikiem („6 zleceń”).

**Mikrocopy (PL):** „Po terminie” · „Nieopłacone (n)” · „Opłacone” · „—” · „Najpilniejsze” · „Płatności” · „Nieopłacone: 3 600,00 zł (1)” · „Planowane: 3” · „Opłacone: 0 z 4” · „Brak transz.” · „Nie udało się wczytać płatności.” · komunikaty pustych widoków wyżej. Kwoty w formacie PL z § 6.3 („3 600,00 zł”, twarda spacja).

**Styleguide:** brak nowego wzorca poza doprecyzowaniem w propozycji do 1.3.0 (changelog § 8, wpis EVM-056, do akceptacji Konrada).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | kolumna, widoki, kafel |
| Edytor | kolumna, widoki, kafel |
| Tylko odczyt | kolumna, widoki, kafel |
| Niezalogowany | brak (`401`) |

- Dane: kwoty i statusy (WF).
- W AC: SR-AUTHZ-03, SR-AUTHZ-05. W sekcji: SR-API-04 (parametry bez danych osobowych), SR-API-02. Polityka P6.

## Notatki techniczne
- Moduły: zgodnie z [ADR-0017](../../architecture/adr/0017-model-odczytu-listy-i-podsumowania-zlecenia.md) (EVM-069; status „Zaakceptowana” 2026-10-04 — wariant (a), pytania 1–7 wg rekomendacji): `overview` (moduł z EVM-034), `payments`, `work-orders` + panel. Wartości sortowania i widoków dodawane addytywnie do enumów z EVM-017.
- **Projekcja `overview`** dostaje sygnały płatności jako zmianę *expand*:
  - kolumny `invoiced_count`, `paid_count`, `earliest_invoiced_due_date` z wartością domyślną;
  - wypełnienie poleceniem `rebuild`;
  - handlery zdarzeń `PaymentMilestone` i port systemowy `payments` (status i termin transz, bez kwot — W5).

  Projekcja nie przechowuje kwot. Sumy (wystawione, po terminie z tym samym „dziś”) zwraca fasada `payments` jednym zapytaniem wsadowym na stronę.
- **Kontrakt wyłącznie addytywnie:**
  - `sort`: `urgency`;
  - `view`: `overdue_payments`, `unpaid`;
  - pole listy `payment` (stan jako `x-extensible-enum`, liczba wystawionych, sumy);
  - pola `PaymentMilestone.isOverdue` i `PaymentMilestone.overdueDays`.

  Domyślne sortowanie API z EVM-017 zostaje bez zmian. W-10 wysyła `sort=urgency` jawnie (domyślne sortowanie AC3 to decyzja UI).
- Definicje D6–D9 i D13 z ADR-0017 → „Definicje wyliczeń”: „Najpilniejsze” — grupy i klucze (pytanie 3 ADR-0017); kolumna „Płatność” (pytanie 4); widoki tylko dla zleceń niezamkniętych (pytanie 7).
- **W4:** sortowanie „Najpilniejsze” (składowa płatności), widoki płatności i pole `payment` wymagają prawa odczytu płatności (v1: A, E, R — P6). Reguła jest w `x-evia-authz` (pole `payment` w `hiddenFields`, ograniczenie wartości `view` i `sort`). Kontrola ma test jednostkowy z atrapą polityki.
- Plan techniczny obejmuje W1–W12 i testy z ADR-0017 dla sygnałów płatności: wydajność „Najpilniejsze” z widokiem „Nieopłacone” (AC6), licznik zapytań, polityka (zlecenie spoza uprawnień nie zmienia kolejności ani sum), granice dat 2026-10-07 / 2026-10-08 i zmiana czasu 2026-10-25, T1–T4.
- Dokumenty do aktualizacji przy implementacji:
  - `docs/security/rodo.md` — inwentaryzacja `PaymentMilestone`: w kolumnie „Gdzie” miejsce „projekcja `overview` (serwer)”, bez kwot (W1);
  - `domain-model.md` — pola wyliczane transzy w „Pola kontrolowane przez serwer”.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
- Kontrakt (addytywnie): sort `urgency` („Najpilniejsze”, domyślne w panelu, wysyłane jawnie), widoki `overdue_payments` i `unpaid` (lista i wyszukiwanie), opcjonalne pole elementu listy `payment` = {state, invoicedCount, invoicedTotal, overdueTotal} (`state` jako x-extensible-enum), `PaymentMilestone.overdueDays`; nowy klucz `x-evia-authz.restrictedParams` (`paymentMilestone.read` → params view/sort + fields `payment`), ściśle walidowany w `manifest.ts`.
- Migracja `0031` (expand): `invoiced_count`, `paid_count`, `earliest_invoiced_due_date` w `overview.work_order_summaries` (bez kwot) + CHECK spójności; po `migrate` od razu `rebuild` (krok w CHANGELOG).
- `payments`: port systemowy statusów i terminów transz (bez kwot) dla projekcji; fasada `paymentTotalsOf` — jedno zapytanie na stronę, tylko dla ID widocznych po polityce (wzorzec C′), `today` z `asOf` kursora; `overdueDays` w reprezentacji transzy.
- `authorization`: `canReadPayments` (v1: A, E, R) jako wstrzykiwany token — W4: zastrzeżony widok bez prawa → 403, `urgency` bez składowej płatności, brak pola `payment`.
- `overview`: handlery zdarzeń transz (P4), widoki D6/D7, „Najpilniejsze” wg D9 z kursorem [grupa, data, id] (wspólne CTE dla ORDER BY i kursora), grupa `payments` w raporcie `verify`.
- Panel: W-10 kolumna „Płatność”, widoki „Po terminie” / „Nieopłacone”, „Najpilniejsze” (pamięć karty, poza URL), tabela gęsta; W-06 kafel „Płatności”. E2E z czasem zamrożonym w mocku. Pełny plan: `.scratch/EVM-056/plan.md`.

## Decyzje
- 2026-10-13 — Konrad zaakceptował (P1–P7 z `/refine` EVM-053): P3 — „Opłacone: x z y” liczy y bez transz „Anulowana” (AC4); P4 — ta historyjka dopina zdarzenia `PaymentMilestone` dla projekcji `overview` do jednego punktu zapisu transz z EVM-053 (bez zmiany zachowania 053/054); P6 — `model: opus`; P7 — bez podziału, a gdy plan techniczny wykaże przekroczenie rozmiaru (4 moduły), wynik `blocked` z propozycją podziału (backend `overview` / panel).

## Uwagi do rozważenia
- Do akceptacji Konrada na demo: pole `payment` jest zadeklarowane w `x-evia-authz.restrictedParams.fields` (predykat polityki wyliczany w kodzie), a nie w `hiddenFields` (statyczna lista per rola), jak sugerowała notatka techniczna W4 — decyzja architekta w potoku, opis w `docs/architecture/api-guidelines.md` (ADR-0017 zostawił kształt reguły tej historyjce).
- Do akceptacji Konrada (styleguide 1.3.0, wpis EVM-056): na `expanded` tabela zleceń ma 6 kolumn priorytetowych, „Opiekun” i „Utworzono” jako kolumny dopiero od `wide`, wariant gęsty tabeli W-10.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-056 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Notatki
- Uwagi z przeglądu domknięte po potoku: testy P4 przeliczenia projekcji (korekta terminu, anulowanie zlecenia, dodanie transzy, plan z szablonu), komunikat `aria-live` z licznikiem wyników, opis `400 read_only_field` dla pól tylko-do-odczytu w wyszukiwaniu, nazwy i komentarze.
- Ogłoszenie przy wielu stronach: „25 zleceń na stronie” (liczba wczytanych pozycji; API nie zwraca sumy) — decyzja web-developera bez wzorca w styleguide, do oceny na demo.
- Do backlogu (security, nit, M4 — wyzwalacz rewizji ADR-0017 / TM-108): fasada `paymentTotalsOf` ufa, że dostaje ID przefiltrowane polityką (dziś wymusza to reguła dependency-cruiser i jedyny wywołujący) — przy drobniejszej polityce zleceń typ znakowany albo zawężenie przez `WorkOrderDirectory` w fasadzie.
- Strona listy czyta projekcję i sumy płatności bez wspólnej migawki — świadoma tolerancja chwilowego rozjazdu stanu i sum (komentarz w kodzie; kontrakt ich nie wiąże).
- Responsywność W-10: przy 768 px pierwsza komórka ma do 9–10 linii (numer, tytuł, klient, adres, opiekun, data), kolumna „Termin” zostaje (§ 3.6), choć makieta flows/07 jej dla `medium` nie wymienia — do oceny na demo.

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-13 — zmiana AC zaakceptowana przez Konrada 2026-10-13 (liczba AC bez zmian): AC4 — „Opłacone: x z y” liczy y bez transz anulowanych; decyzje P3, P4, P6, P7 w „Decyzjach”
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka pełna, model opus, gałąź `feature/EVM-056-platnosci-na-liscie` ułożona na EVM-055 → EVM-054 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — backend zaimplementowany (backend-developer): kontrakt (`urgency`, `overdue_payments`, `unpaid`, `payment`, `overdueDays`, `restrictedParams`), migracja `0031`, sygnały płatności w projekcji, fasada sum, W4; panel — web-developer
- 2026-10-14 — panel zaimplementowany (web-developer): W-10 kolumna „Płatność”, widoki „Po terminie” / „Nieopłacone”, domyślne „Najpilniejsze”; W-06 kafel „Płatności”; E2E (Chromium, Edge, Firefox) i zrzuty `docs/ux/reviews/EVM-056/`
- 2026-10-14 — potok `wf_ae463788-e6f`: passed po 2 rundach (QA PASS AC1–AC8; konsultacja architekta — kształt `restrictedParams`, CTE „Najpilniejszych”, CHECK w `0031`; runda 1: code-reviewer i security-engineer APPROVE, ux-designer changes — blocker kolumny „Płatność” przy 768 px i regresja szerokości przy 1280/1440; runda 2: APPROVE)
- 2026-10-14 — po potoku: backend-developer — testy P4 przeliczenia projekcji, opis `read_only_field` (`e19b9e3`, `dc3a2f4`); web-developer — `aria-live` z licznikiem, nazwy (`418e9e1`); orkiestrator — zaległe commity specyfikacji UX, styleguide'u i modelu zagrożeń (`b39ca6b`)
- 2026-10-14 — orkiestrator: `pnpm run gate` zielony (diff-coverage linie 1749/1769, gałęzie 1593/1721), `docs:check` 0/0; in-progress → in-review
- 2026-10-14 — Koszt: brak rozbicia w $; potok 13 wywołań agentów, ok. 1,82 mln tokenów subagentów, ok. 160 min (+ poprawki po potoku ok. 0,14 mln, ok. 13 min); rundy poprawek 1; ścieżka pełna; opus
- 2026-10-15 — przed scaleniem poprawki CI (Ubuntu — szersze glify): układ W-10 odporny na metryki czcionek (`af8ee52`), decyzje UX „budżet szerokości” — „Termin” linią pierwszej komórki poniżej `expanded` (`ec261d4`, `114cd8d`), „Opiekun” i „Utworzono” liniami pierwszej komórki na każdej szerokości (`e827c18`, `829d8d6`); `e2e-web` w dwóch shardach (`4a2bf17`)
- 2026-10-15 — scalona do `main` (PR #72, `24fd524`); in-review → done
