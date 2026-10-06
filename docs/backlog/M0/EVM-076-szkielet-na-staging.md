---
id: EVM-076
title: Szkielet na staging — wdrożenie i test dymny po wdrożeniu
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P0
path: pelna
owner: devops-engineer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-008]
---

# EVM-076: Szkielet na staging — wdrożenie i test dymny po wdrożeniu

## Cel
Jako **właściciel produktu** chcę **widzieć szkielet z EVM-008 działający na staging po scaleniu do `main`**, aby **oglądać postępy na żywo**. Wydzielone z EVM-008 decyzją Konrada 2026-10-05 (pierwszy kod nie czeka na staging z EVM-007).

## Kryteria akceptacji
**AC1 — Wdrożenie**
- Zakładając, że szkielet z EVM-008 jest na `main`, a staging z EVM-007 działa
- Gdy zmiana trafia do `main`
- Wtedy szkielet (API, migracja, panel) działa na staging, a jego adres jest w README.

**AC2 — Test dymny po wdrożeniu**
- Zakładając, że szkielet jest wdrożony na staging
- Gdy kończy się wdrożenie
- Wtedy test dymny E2E z EVM-008 (otwarcie panelu, widoczny pusty stan) przechodzi na staging, a nieudany test blokuje uznanie wdrożenia za udane.

**AC3 — Test dymny aktywacji i konfiguracji (z EVM-016, zaakceptowane przez Konrada 2026-10-06)**
- Zakładając, że na staging działa polecenie aktywacji z EVM-016
- Gdy wykonujemy aktywację na staging
- Wtedy test dymny potwierdza: brak tokenu w logach Caddy i Alloy oraz w Sentry, alert bezpieczeństwa dociera do kanału alertów, API używa roli `evia_app`, a `TRUSTED_PROXIES` zgadza się z proxy.

## Poza zakresem
- Logowanie, dane zleceń (M1); zmiany samego staging (EVM-007).

## Decyzje i ograniczenia
- 2026-10-05 — Konrad: podział EVM-008 na część lokalną (EVM-008) i wdrożenie (ta historyjka).
- Ścieżka `pelna` (infrastruktura); zasoby płatne wyłącznie za zgodą Konrada na koszty (EVM-007).

## Notatki
- Nie blokuje EVM-016 ani EVM-067 (rozwijane lokalnie i w CI); blokuje demo na staging.

## Dziennik
- 2026-10-05 — utworzono i `ready` po podziale EVM-008 zaakceptowanym przez Konrada (orkiestrator, EVM-075)
- 2026-10-06 — dopisano AC z EVM-016 (asercje wymagające infrastruktury), zaakceptowane przez Konrada
