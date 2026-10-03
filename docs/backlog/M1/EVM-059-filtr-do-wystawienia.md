---
id: EVM-059
title: Filtr „Do wystawienia” w Płatnościach
type: story
milestone: M1
epic: E7 Płatności etapowe
status: draft
priority: P2
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
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
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-059 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
