---
id: EVM-022
title: Nowe zlecenie z szablonu
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: done
path: pelna
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-019, EVM-020, EVM-021]
---

# EVM-022: Nowe zlecenie z szablonu

## Historyjka
Jako **pracownik biura** chcę **założyć zlecenie z szablonu w jednym formularzu i od razu zobaczyć jego numer**, aby **każde nowe zlecenie startowało z właściwym zakresem bez ręcznego składania**.

## Kontekst
- Domknięcie ścieżki pionowej: logowanie → lista → **utworzenie zlecenia** (README M1).
- Kompozycja narasta (konsultacja `solution-architect`, B3): ta historyjka tworzy zlecenie, zakres i opiekuna; procesy dochodzą w EVM-031 (kontrybutor `procedures`), transze — w EVM-053 (kontrybutor `payments`). Bez backfillu (dane na staging są syntetyczne).
- Makieta: [W-05](../../ux/flows/02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie) (sekcje „3. Szablon”, „4. Zlecenie”, zapis); po zapisie — nagłówek [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (pełne szczegóły — EVM-018). Model: „Kompozycja zlecenia z szablonu”, `WorkOrder`, `ScopeItem`, `WorkOrderAssignment`; numer `ZL-2026-0042` (decyzja z EVM-002, pytanie 7).

## Kryteria akceptacji
**AC1 — Utworzenie z szablonu**
- Zakładając wybranego klienta i lokalizację „Garaż w budynku wielorodzinnym”
- Gdy wybieram kartę szablonu „Garaż — pełny proces” (karta: „9 pozycji”; szablony przefiltrowane po typie obiektu, „Pokaż wszystkie” zdejmuje filtr), zostawiam tytuł domyślny i opiekuna (domyślnie — ja; lista użytkowników z `id` i `displayName`), opcjonalnie podaję planowaną datę i opis, i wybieram „Utwórz zlecenie”
- Wtedy API zwraca `201`, zlecenie ma status „Nowe”, numer nadany przez serwer (np. `ZL-2026-0042`) i 9 pozycji zakresu skopiowanych z szablonu (kod, nazwa, parametry domyślne, ilość), a panel pokazuje toast „Utworzono zlecenie ZL-2026-0042.” i nagłówek W-06 (numer, tytuł, status, klient, adres lokalizacji, opiekun, data utworzenia); zlecenie jest na liście W-10
- Oraz karta i podgląd szablonu pokazują wyłącznie części, które system w tej wersji utworzy — „Zakres (9 pozycji)”, bez liczby i listy procesów, bez transz, sekcji „Plan płatności” i zdania „Kwoty transz wpiszesz w zleceniu.” (procesy przywraca EVM-031, plan płatności — EVM-053; README M1 → „Punkt pilota”).

**AC2 — Puste zlecenie**
- Gdy wybieram „Puste zlecenie (bez szablonu)”
- Wtedy zlecenie powstaje bez pozycji zakresu; gdy nie ma żadnego aktywnego szablonu, sekcja pokazuje „Brak aktywnych szablonów. Utwórz puste zlecenie i dodaj pozycje w zleceniu.”

**AC3 — Walidacja i obiekty niedostępne (SR-AUTHZ-02)**
- Gdy brakuje klienta, lokalizacji albo wyboru szablonu
- Wtedy na górze formularza jest podsumowanie błędów z linkami do pól i fokus na nim („Wybierz szablon albo „Puste zlecenie”.”)
- Oraz gdy szablon wycofano w trakcie wypełniania, API zwraca `422 template_unavailable` z alertem przy sekcji „Szablon”; gdy klient albo lokalizacja zostały usunięte lub są niedostępne — `404` z komunikatem przy polu („Nie znaleziono wybranego klienta. Wybierz innego.”).

**AC4 — Ponowienie bez duplikatu (SR-API-05)**
- Zakładając zapis przerwany błędem sieci po wysłaniu
- Gdy wybieram ponownie „Utwórz zlecenie”
- Wtedy komunikat brzmi „Nie udało się utworzyć zlecenia. Spróbuj ponownie — nie utworzymy go dwa razy.”, a ponowienie z tym samym `id` i `Idempotency-Key` zwraca to samo zlecenie z tym samym numerem.

**AC5 — Numeracja (SR-API-07)**
- Zakładając zegar kontrolowany ustawiony na 2026-12-31T23:30:00Z (w `Europe/Warsaw` — 2027-01-01 00:30)
- Gdy tworzę zlecenie, a w teście 20 zleceń powstaje równolegle
- Wtedy pierwsze zlecenie roku dostaje `ZL-2027-0001`, numery są unikalne i bez luk, a `number` przesłany w żądaniu zwraca `400 validation_failed` (`read_only_field`).

**AC6 — Spójność kompozycji (SR-API-06)**
- Zakładając kontrybutora kompozycji, który w teście zgłasza błąd
- Gdy tworzę zlecenie
- Wtedy nie powstaje zlecenie, żadna pozycja zakresu ani przypisanie, a numer nie jest zużyty — całość w jednej transakcji.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda tworzy zlecenie
- Wtedy A i E tworzą; R nie widzi „Nowe zlecenie”, wejście z linku pokazuje „Nie możesz tworzyć zleceń. Poproś administratora o uprawnienia.”, a API zwraca `403 forbidden`; niezalogowany — `401`.

**AC8 — Szkic i stany**
- Wtedy formularz ma szkic tylko w pamięci karty („Szkic w tej karcie · 14:05”; znika po zamknięciu karty i wylogowaniu), „Anuluj” przy wypełnionym formularzu pyta „Odrzucić nowe zlecenie? Wpisane dane znikną.”, offline — baner „Brak połączenia. Wpisane dane zostają w tej karcie…” i wyłączony przycisk, ładowanie — Skeleton kart szablonów i przycisk w stanie ładowania.

## Poza zakresem
- Procesy i etapy z szablonu — EVM-031; transze — EVM-053 (każda z nich przywraca swoją część karty i podglądu szablonu; do tego czasu UI nie obiecuje procesów ani transz — przegląd `ux-designer` EVM-010).
- Pełne szczegóły zlecenia (karty, zakres) — EVM-018. Edycja zakresu — EVM-035.
- Wpis dziennika `work_order_created` — EVM-038 (bez backfillu). Podpowiedź lokalizacji klienta — EVM-043.
- Utworzenie klienta lub lokalizacji w tym samym żądaniu (`newCustomer` / `newSite`) — `CreateQuickWorkOrder`, M2.

## UX / UI
- W-05 sekcje „3. Szablon” (SelectableCard [P-3], podgląd szablonu przyklejony po prawej, Disclosure [P-2] na `breakpoint.medium`), „4. Zlecenie” (TextField, Select opiekuna, DatePicker § 3.5), Toast (§ 3.14); nagłówek W-06.
- Karta i podgląd szablonu w tej historyjce — tylko zakres (AC1); makieta W-05 pokazuje stan docelowy po EVM-031 i EVM-053 (heurystyka Nielsena 2 — zgodność UI z tym, co system robi).
- Stany: AC3, AC8; brak uprawnień — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | utworzenie zlecenia |
| Edytor | utworzenie zlecenia |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: `WorkOrder` (tytuł, opis — pola swobodne), `ScopeItem.parameters` (tylko wartości techniczne), `WorkOrderAssignment` (DO-P).
- W AC: SR-AUTHZ-02, SR-API-05, SR-API-06, SR-API-07, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-AUTHZ-04, SR-INPUT-01, SR-INPUT-02 (parametry wg zestawu), SR-DATA-03 (lista użytkowników — tylko `id` i `displayName`).

## Notatki techniczne
- Moduły: `work-orders` (zapis), `catalog` i `identity` (odczyt przez fasady); `customers`, `sites` — walidacja istnienia przez fasady + panel.
- Zdolności przekrojowe wprowadzane tutaj: licznik roczny numerów w tabeli (`UPDATE … RETURNING` w transakcji, nie sekwencja — luki), test równoległego tworzenia; port `WorkOrderCompositionContributor` bez implementacji (ta sama transakcja, ustalona kolejność, błąd kontrybutora wycofuje całość); operacja listy użytkowników (`id`, `displayName`) dla pola „Opiekun”.
- Klucze obce `work_orders` → `customers`, `sites` (jeśli EVM-017 je odłożyła) — zmiana addytywna.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Notatki
- Brak limitu żądań na użytkownika dla zapisów (SR-API-02: 300/min/użytkownika; działa tylko limit IP 1200/min) — do backlogu; wyścig check→use klienta/lokalizacji/szablonu bez blokady wiersza (soft delete i wycofanie szablonu dopiero w EVM-039–041).
- Szkic z wycofanym szablonem może wysłać nieaktualne id (panel); `insertScopeItems` bez ORDER BY przy RETURNING; przy 404 panel pokazuje błąd przy obu polach (świadomie, SR-AUTHZ-02).
- UX (minor/nit): ucięty adres przy 1280 px, numer łamany w toaście na 360 px, podwójny baner offline, aria-live na całym podglądzie, brak zrzutów części stanów.
- Flaky E2E Firefox (timeout page.goto 30 s) w pełnym przebiegu równoległym; 3× powtórka OK.
- Poprawiono uszkodzony wpis o migracji 0015 w apps/api/README.md (artefakt powłoki).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-022 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusze A1, C1, D1 na staging)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): karta i podgląd szablonu bez procesów i transz do EVM-031 / EVM-053 (AC1)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-07 — ready → in-progress (/deliver; ścieżka pelna: migracje, dane osobowe, nowy endpoint i UI; gałąź feature/EVM-022-work-order-from-template)
- 2026-10-07 — backend gotowy (backend-developer): kontrakt createWorkOrder i listAssignableUsers, migracja 0015, fasady CustomerDirectory / SiteDirectory / TemplateDirectory, port WorkOrderCompositionContributor, testy EVM-022 AC1–AC7 (API); panel — web-developer
- 2026-10-07 — panel gotowy (web-developer): W-05 sekcje „3. Szablon” i „4. Zlecenie”, „Utwórz zlecenie”, nagłówek W-06, szkic, stany; komponenty SelectableCardGroup, ErrorSummary, FieldError w ui-web; testy EVM-022 AC1–AC4, AC7, AC8 (Vitest + axe, E2E, zrzuty w docs/ux/reviews/EVM-022)
- 2026-10-07 — bramki i przeglądy zaliczone (QA pass; code-reviewer, security-engineer, ux-designer — approve; 1 runda); orkiestrator: pnpm run gate EXIT 0, coverage:diff linie 98,5% / gałęzie 94,4%; → in-review
- 2026-10-07 — Koszt: brak rozbicia w dolarach (nie odczytane z /usage); 1,13 mln tokenów subagentów, 8 agentów, 388 wywołań narzędzi, 1 runda, ok. 84 min; ścieżka pelna; vs baseline: brak danych
- 2026-10-08 — zaakceptowane przez Konrada, scalone do main (PR #32) → done
