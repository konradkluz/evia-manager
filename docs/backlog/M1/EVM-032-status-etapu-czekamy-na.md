---
id: EVM-032
title: Zmiana statusu etapu i „Czekamy na…”
type: story
milestone: M1
epic: E4 Procesy i etapy
status: in-review
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-031]
path: pelna
---

# EVM-032: Zmiana statusu etapu i „Czekamy na…”

## Historyjka
Jako **pracownik biura** chcę **jednym ruchem zmienić status etapu i zapisać, na kogo czekamy i od kiedy**, aby **zawsze wiedzieć, na jakim etapie jesteśmy w OSD, z administracją czy z klientem**.

## Kontekst
- Model: „Stany i przejścia” → „Etap procesu”, reguły `ProcedureStage` (`waitingOn`, `waitingSince` — nie z przyszłości; zmiana strony = edycja, nowe „od kiedy”).
- Makieta: [W-07](../../ux/flows/04-aktualizacja-etapu.md#w-07-zmiana-statusu-etapu), lista [„Cofnij”](../../ux/flows/04-aktualizacja-etapu.md#cofnij--lista-przejść). Podpowiedzi stron z lokalizacji i „Dodaj stronę” w dialogu — EVM-033.
- Scenariusze: A3, A4, A5, A9, B5, B8, B11, C3, C4, C6, C11.

## Kryteria akceptacji
**AC1 — Menu przejść**
- Zakładając etap „Do zrobienia”
- Gdy otwieram menu odznaki
- Wtedy widzę tylko przejścia z tabeli dla tego stanu: „Rozpocznij”, „Czekamy na…”, „Zakończ…”, „Nie dotyczy”, „Zablokuj…”; „Rozpocznij” zapisuje czas rozpoczęcia.

**AC2 — Czekamy na…**
- Zakładając etap „Warunki przyłączenia i projekt umowy”
- Gdy wybieram „Czekamy na…”, „Stronę”, wyszukuję i wybieram „Stoen Operator (OSD)”, zostawiam „Od kiedy” = dziś i zapisuję
- Wtedy etap ma status „Czekamy na…” z opisem „Czekamy na: Stoen Operator (OSD) · od dziś”; wybór „Klienta” daje „Czekamy na: klient · od dziś”; „Od kiedy” z przyszłości zwraca `400 validation_failed` („Nie później niż dziś.”), a „Stronę” bez wybranej strony — błąd pod polem.

**AC3 — Odpowiedź otrzymana i zmiana strony**
- Zakładając etap „Czekamy na…” od 15 dni
- Gdy wybieram „Odpowiedź otrzymana”
- Wtedy etap wraca do „W toku”, a dane oczekiwania są czyszczone
- Oraz gdy zamiast tego wybieram „Zmień, na kogo czekamy…”, wtedy dialog informuje „Licznik dni zacznie się od nowa.”, a po zapisie „od kiedy” to dziś (edycja, nie przejście).

**AC4 — Zakończ, Nie dotyczy, Zablokuj**
- Gdy wybieram „Zakończ…” (data domyślnie dziś, nie z przyszłości), „Nie dotyczy”, „Zablokuj…” (powód wymagany), a potem „Odblokuj”, „Otwórz ponownie” albo „Przywróć”
- Wtedy status zmienia się zgodnie z tabelą przejść, zakończenie czyści oczekiwanie, a postęp procesu się przelicza.

**AC5 — Cofnij**
- Gdy po przejściu `in_progress → waiting` wybieram „Cofnij” w toaście (10 s)
- Wtedy wykonuje się przejście odwrotne z listy „Cofnij” (dla `waiting → in_progress` — z poprzednim „na kogo” i „od kiedy”); przejścia bez odwrotności (np. `todo → in_progress`) nie mają „Cofnij”; cofnięcie odrzucone przez serwer daje „Nie udało się cofnąć — ktoś zmienił etap w międzyczasie. [Odśwież]”.

**AC6 — Zasady (SR-API-07, SR-AUTHZ-02, SR-INPUT-02)**
- Gdy wysyłam przejście spoza tabeli, `PATCH` z `status`, przejście bez `If-Match` albo z nieaktualną wersją, przejście etapu zlecenia zamkniętego albo etapu innego zlecenia ścieżką zlecenia A
- Wtedy API zwraca odpowiednio `409 invalid_state_transition`, `400` (`read_only_field`), `428`, `412`, `409 work_order_closed`, `404 not_found` — a stan etapu się nie zmienia.

**AC7 — Uprawnienia i ścieżki (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wysyła dowolne przejście etapu
- Wtedy A i E wykonują przejścia, R ma odznaki statyczne i dostaje `403 forbidden`, niezalogowany — `401`; macierz ról zawiera testy ścieżek w grafie przejść.

**AC8 — Stany**
- Wtedy przy etapie w W-06 widać „Czekamy na: … · od n dni”, powyżej 14 dni z `triangle-alert` (zegar: od 2026-09-18, dziś 2026-10-03 → „od 15 dni”); offline — menu wyłączone; `412` — „Ktoś zmienił etap…”, dane dialogu zostają.

## Poza zakresem
- Podpowiedzi stron z lokalizacji i „Dodaj stronę” w dialogu — EVM-033. Kolumna i filtr „Czekamy na” na liście, kafle podsumowania — EVM-034.
- Wpis dziennika o zmianie — EVM-038. Zmiana statusu z telefonu — po MVP.

## UX / UI
- W-07: StatusBadge jako przycisk + ActionMenu [P-1], Dialog „Na kogo czekamy?” (radio Klienta / Stronę, Combobox stron, DatePicker), dialogi „Zakończ…”, „Zablokuj…” z podpowiedzią przy powodzie, Toast z „Cofnij”.
- Stany: AC8; brak uprawnień — AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wszystkie przejścia etapu |
| Edytor | wszystkie przejścia etapu |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: powód blokady (pole swobodne — ostrzeżenie SR-DATA-02), strona, na którą czekamy (DO-3).
- W AC: SR-API-07, SR-AUTHZ-02, SR-INPUT-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-04, SR-INPUT-01, SR-WEB-03.

## Notatki techniczne
- Moduły: `procedures`, fasada `parties` (wyszukiwanie stron) + panel.
- Daty „dziś” i „od n dni” — wstrzykiwany zegar `Europe/Warsaw`.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Plan w `.scratch/EVM-032/plan.md` (ścieżka pełna). Bez migracji (kolumny z 0019), bez nowego modułu i zależności.

## Decyzje
- Ścieżka pełna — Konrad, 2026-10-09.
- Błędy pól przejścia: `400 validation_failed` (AC2, AC4), nie `422` z flow/04; „Zmień, na kogo czekamy…” przez `PATCH`; nieistniejąca/usunięta strona — `400 unknown_party`; `work_order_closed` przed tabelą przejść (security K2, `api-guidelines.md`).

## Uwagi do rozważenia
- README `apps/api` (sekcja „Procesy i etapy zlecenia”) ma nieaktualne zdania o zakresie `PATCH` i polach odczytu (minor, code-reviewer).
- Dialog etapu nie zamraża wersji przy otwarciu — refetch w trakcie może podmienić `If-Match` (minor); `undoOf` przy usuniętej stronie i `400` spoza pól dają ogólny komunikat (nit).
- Po nieudanym zapisie fokus nie przechodzi do pierwszego błędnego pola; brak zrzutów toastu „Cofnij” (`in_progress → waiting`) i nieudanego cofnięcia (minor, UX).
- Token mobilny dostaje `403 forbidden`, a opisy OpenAPI (od EVM-031) mówią o `channel_not_allowed`; audyt bez kolumn from/to (wymagałoby migracji).
- Brak sesji eksploracyjnej na żywym stosie (QA) — do sprawdzenia ręcznie na demo; niepokryte gałęzie `stage-dialog.tsx` (nit, przy EVM-033).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-032 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-09 — ready → in-progress: start `/deliver`, ścieżka pełna (decyzja Konrada)
- 2026-10-09 — plan gotowy (backend-developer)
- 2026-10-09 — backend gotowy (backend-developer): `transitionProcedureStage`, rozszerzony PATCH i odpowiedź etapu; bramka lokalna zielona, web (W-06/W-07) w kolejnym kroku
- 2026-10-09 — panel gotowy (web-developer): menu przejść, dialogi, „Cofnij”, W-06; testy RTL + E2E (Chromium, Firefox, Edge), a11y, zrzuty w `docs/ux/reviews/EVM-032`
- 2026-10-09 — QA pass (8/8 AC), przeglądy kod / security / UX — APPROVE w 1. rundzie; `pnpm run gate` u orkiestratora zielony (diff 99,4% linii, 95,6% gałęzi), `docs:check` 0 błędów → in-review
- 2026-10-09 — Koszt: brak rozbicia w $ (sesja bez odczytu `/cost`); agenci workflow 8 wywołań, ok. 1,0 mln tokenów, 288 wywołań narzędzi, 62 min; rundy poprawek 0; ścieżka pelna; model z definicji agentów; plik historyjki 8 KB; vs baseline — nie do porównania w $
- 2026-10-10 — CI `e2e-web` czerwony: testy EVM-018 (`work-order-details.spec.ts`) nie znały przycisków statusu etapu — zaktualizowane oczekiwania; pełne E2E lokalnie 482/482 (Chromium, Firefox)
