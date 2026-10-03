---
id: EVM-010
title: Backlog M1 gotowy do realizacji
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: product-owner
contributors: []
reviewers: [solution-architect, ux-designer, security-engineer]
depends_on: [EVM-002, EVM-004, EVM-005]
---

# EVM-010: Backlog M1 gotowy do realizacji

## Historyjka
Jako **właściciel produktu** chcę **rozpisanego na małe historyjki zakresu MVP „Biuro”**, aby **zespół mógł realizować go krok po kroku, a ja wiedział, kiedy mogę zacząć korzystać z systemu**.

## Kontekst
Realizacja przez `/milestone plan M1`. Zakres: `docs/product/roadmap.md` (M1, epiki E1–E8). Wejścia: model domeny (EVM-002), makiety (EVM-004), wymagania bezpieczeństwa (EVM-005).

## Kryteria akceptacji
**AC1 — Kompletność**
- Wtedy wszystkie epiki M1 są rozpisane na historyjki w `docs/backlog/M1/` wg szablonu, a tabela „epik → historyjki” pokazuje pokrycie całego zakresu (lub świadome przesunięcie z uzasadnieniem).

**AC2 — Jakość historyjek**
- Wtedy każda historyjka spełnia DoR (poza akceptacją użytkownika): maks. 8 AC, uprawnienia ról, odwołania do makiet EVM-004, wymagania bezpieczeństwa z EVM-005 wplecione w AC, uzupełnione `owner` / `contributors` / `reviewers`.

**AC3 — Kolejność i pilot**
- Wtedy `depends_on` i priorytety są ustawione, a kolejność zaczyna się od pionowego przyrostu (logowanie → lista zleceń → utworzenie zlecenia) i wskazuje punkt pilota.

**AC4 — Decyzje**
- Wtedy jest lista decyzji potrzebnych od Konrada, każda z rekomendacją.

## Poza zakresem
Szczegółowe historyjki M2 (powstaną w `/milestone plan M2`).

## UX / UI
Nie dotyczy (odwołania do EVM-004).

## Bezpieczeństwo i prywatność
Wymagania z EVM-005 wplecione w AC.

## Notatki techniczne
_—_

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC4 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: solution-architect, ux-designer, security-engineer — APPROVE
- [ ] Akceptacja Konrada; zaakceptowane historyjki w statusie `ready`

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-010-backlog-m1` (decyzja Konrada: realizacja w czasie przerwy EVM-006 — praca koncepcyjna równolegle z historyjką z kodem)
