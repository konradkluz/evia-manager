---
id: EVM-059
title: Filtr „Do wystawienia” w Płatnościach
type: story
milestone: M1
epic: E7 Płatności etapowe
status: in-review
priority: P2
owner: backend-developer
contributors: [web-developer]
reviewers: [security-engineer]
path: lekka
model: sonnet
depends_on: [EVM-055, EVM-071]
---

# EVM-059: Filtr „Do wystawienia” w Płatnościach

## Historyjka
Jako **pracownik biura** chcę **widzieć transze planowane, dla których trzeba wystawić fakturę**, aby **nie pominąć faktury za wykonany etap**.

## Kontekst
- Kandydat P2 z EVM-004 (decyzja 5). Nowe pojęcie w słowniku: „Do wystawienia” = transze w stanie „Planowana” (`docs/product/domain.md`).
- Makieta: W-11 — chip „Do wystawienia” z akcją „Wystaw fakturę” (EVM-071).

## Kryteria akceptacji
**AC1 — Filtr**
- Zakładając 5 transz „Planowana” w zleceniach niezamkniętych i 2 w zleceniach anulowanych
- Gdy w W-11 wybieram „Do wystawienia”
- Wtedy widzę 5 transz (zlecenie, klient, transza, udział, kwota albo „—”), posortowanych wg zlecenia, a URL zawiera tylko identyfikator filtra.

**AC2 — Akcja**
- Gdy przy transzy wybieram „Wystaw fakturę…”
- Wtedy otwiera się dialog z EVM-054, a po wystawieniu transza znika z filtra.

**AC3 — Polityka (SR-AUTHZ-03)**
- Wtedy lista i ewentualne sumy są liczone tą samą polityką co zestawienie (warunek w zapytaniu).

**AC4 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A i E widzą filtr i akcję, R — filtr bez akcji, niezalogowany — `401`.

**AC5 — Stany**
- Wtedy brak transz — „Wszystkie transze mają wystawione faktury.”; offline — dane z pamięci karty, akcje wyłączone.

## Poza zakresem
- Automatyczne przypomnienie o wystawieniu faktury po zakończeniu etapu — M3.

## UX / UI
- W-11: FilterChip „Do wystawienia”, akcja w wierszu. Stany: AC5.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | filtr, akcja |
| Edytor | filtr, akcja |
| Tylko odczyt | filtr |
| Niezalogowany | brak (`401`) |

- Dane: jak EVM-055. W AC: SR-AUTHZ-03, SR-AUTHZ-05.

## Notatki techniczne
- Moduły: `payments` + panel. Wartość filtra dodana addytywnie do enumu.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-10-15 — Konrad: ścieżka `lekka`, recenzent `security-engineer`, wspólna gałąź z EVM-058 (058 → 059).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-059 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Notatki
- Security (nit, CWE-400): widok `planned` czyta bez limitu identyfikatory zleceń z transzą „Planowana” i przekazuje je jednym parametrem do `refsOf` (wzorzec z EVM-055; dziś ogranicza to limit P10) — do backlogu wydajności zestawień: zawężenie w SQL lub indeks częściowy + test wolumenu.
- Kontrakt: `items` w `listUnpaidPaymentMilestones` to teraz unia pozycji wystawionych i planowanych (rozróżnia `status`) — addytywnie w JSON, zmiana typu dla klienta (panel dostosowany).
- Poza AC (do potwierdzenia na demo): w widoku „Do wystawienia” pola „Termin od/do” są nieaktywne, bo API zwraca `400` dla `dueFrom`/`dueTo` z `view=planned`.
- E2E widoku odpowiada na `view=planned` przez `page.route` (syntetyczny serwer zna tylko transze wystawione); pełny przepływ wystawienia — w testach komponentów i integracyjnych.
- Ścieżka lekka z recenzentem security — UI nie miał przeglądu UX; zrzuty z E2E do obejrzenia na demo.

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-15 — ready → in-progress (kolejka nocna, gałąź `feature/EVM-058-059-platnosci-web`, po EVM-058)
- 2026-10-15 — backend: widok `view=planned` na `listUnpaidPaymentMilestones` (kontrakt, zapytanie z polityką, testy `EVM-059 AC1–AC4`); panel (chip, dialog, stany AC5) — krok web-developera (backend-developer)
- 2026-10-15 — panel: chip „Do wystawienia” w W-11 (`view=planned`), tabela transz planowanych, „Wystaw fakturę…” (dialog EVM-054) dla A/E, stany AC5, testy `EVM-059 AC1–AC5` + E2E + zrzuty (web-developer)
- 2026-10-15 — przegląd security-engineer: approve (1 nit → „Notatki”); orkiestrator: poprawka typu w teście (`e213a0f`), AC1–AC5 → testy `EVM-059 AC#`, `pnpm run gate` zielony (diff-coverage gałęzi: linie 123/123, gałęzie 173/183), `docs:check` 0/0; in-progress → in-review
- 2026-10-15 — Koszt: potok 3 wywołania agentów, ok. 0,33 mln tokenów subagentów, ok. 50 min; rundy poprawek 0; ścieżka lekka; sonnet
