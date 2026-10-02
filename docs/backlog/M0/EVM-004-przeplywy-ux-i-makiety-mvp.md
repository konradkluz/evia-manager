---
id: EVM-004
title: Przepływy UX i makiety MVP
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P1
owner: ux-designer
contributors: [product-owner]
reviewers: [web-developer, mobile-developer]
depends_on: [EVM-002, EVM-003]
---

# EVM-004: Przepływy UX i makiety MVP

## Historyjka
Jako **właściciel produktu** chcę **zobaczyć kluczowe przepływy i ekrany MVP przed implementacją**, aby **wcześnie wyłapać braki i dać zespołowi jednoznaczną specyfikację UI**.

## Kontekst
Zakres M1 i M2: `docs/product/roadmap.md`. Komponenty i tokeny: styleguide v1 (EVM-003). Model danych: EVM-002.

## Kryteria akceptacji
**AC1 — Mapa ekranów**
- Gdy otwieram `docs/ux/flows/README.md`
- Wtedy widzę mapę nawigacji panelu web (M1) i aplikacji mobilnej (M2).

**AC2 — Kluczowe przepływy**
- Wtedy dla każdego przepływu jest diagram (Mermaid) i makieta low-fi: logowanie z MFA; utworzenie zlecenia z szablonu; szczegóły zlecenia „status na pierwszy rzut oka” (etapy, na kogo czekamy, płatności); aktualizacja etapu; wpis i komentarz; galeria i upload; lista zleceń z filtrami (w tym „czekamy na OSD dłużej niż X dni”); zestawienie nieopłaconych; mobile: zdjęcie / film offline → kolejka → upload; mobile: szybkie nowe zlecenie.

**AC3 — Stany i role**
- Wtedy każdy ekran ma opisane stany (pusty, ładowanie, błąd, offline — mobile, brak uprawnień) i różnice dla ról.

**AC4 — Zgodność ze styleguide'em**
- Wtedy makiety używają wyłącznie komponentów i tokenów ze styleguide'u v1; braki są zgłoszone jako propozycje w changelogu styleguide'u.

**AC5 — Walidacja scenariuszami**
- Zakładając scenariusze A–D z `domain.md`
- Gdy przechodzę je przez makiety
- Wtedy żaden krok nie wymaga obejścia (zapis przejścia w dokumencie).

## Poza zakresem
Projekty high-fidelity wszystkich ekranów; ekrany M3+. Klikalny prototyp HTML — opcjonalnie, jeśli ux-designer uzna za pomocny.

## UX / UI
To jest specyfikacja UX.

## Bezpieczeństwo i prywatność
Uwzględnij widoczność danych wg ról (np. Tylko odczyt nie widzi akcji edycji).

## Notatki techniczne
_—_

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC5 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: web-developer, mobile-developer — APPROVE
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
