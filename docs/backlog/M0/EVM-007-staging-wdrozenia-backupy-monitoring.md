---
id: EVM-007
title: Staging w UE, wdrożenia, backupy i monitoring
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P1
owner: devops-engineer
contributors: []
reviewers: [security-engineer, solution-architect]
depends_on: [EVM-006]
---

# EVM-007: Staging w UE, wdrożenia, backupy i monitoring

## Historyjka
Jako **właściciel produktu** chcę **środowiska testowego, na które każda zaakceptowana zmiana trafia automatycznie, z kopiami zapasowymi i monitoringiem**, aby **oglądać postępy na żywo i mieć pewność, że dane są bezpieczne**.

## Kontekst
Hosting i region: ADR z EVM-001. Wymagania: `docs/security/README.md` (backupy, monitoring, sekrety).

## Kryteria akceptacji
**AC1 — Infrastruktura jako kod**
- Wtedy środowisko staging w regionie UE jest opisane kodem (zgodnie z ADR); zasoby płatne tworzone dopiero po akceptacji kosztów przez Konrada.

**AC2 — Wdrożenie**
- Gdy zmiana trafia do `main`
- Wtedy jest automatycznie wdrażana na staging z migracjami i testami dymnymi; nieudane wdrożenie nie zastępuje działającej wersji albo istnieje opisany rollback.

**AC3 — Sekrety**
- Wtedy sekrety są w menedżerze sekretów; brak sekretów w repozytorium i logach CI.

**AC4 — Backup i odtworzenie**
- Wtedy kopie bazy są automatyczne (z odtwarzaniem do punktu w czasie, jeśli dostępne), storage mediów jest wersjonowany, a procedura odtworzenia została wykonana testowo na staging i opisana w `docs/ops/runbooks/restore.md`.

**AC5 — Obserwowalność**
- Wtedy działają logi strukturalne bez danych osobowych, śledzenie błędów i monitoring dostępności z alertem e-mail do Konrada.

**AC6 — Koszty**
- Wtedy znany jest miesięczny koszt środowiska i skonfigurowany alert budżetowy.

**AC7 — Runbooki**
- Wtedy w `docs/ops/runbooks/` są procedury: wdrożenie, rollback, odtworzenie backupu, rotacja sekretów.

## Poza zakresem
Środowisko produkcyjne (powstaje przed wydaniem 1.0 w E8, według tych samych skryptów).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Najmniejsze uprawnienia kont technicznych, szyfrowanie w spoczynku, brak publicznych bucketów, brak danych produkcyjnych na staging.

## Notatki techniczne
Wymaga działań Konrada: założenie konta / płatności u dostawcy chmury, ewentualnie domena — orkiestrator poprosi o to z wyprzedzeniem.

Stan kont (2026-10-03):
- **Hetzner:** konto założone (2FA wg SR-INFRA-09), puste projekty `evia-staging` i `evia-prod` — bez serwerów, wolumenów, IP i tokenów API. Zasoby tworzy OpenTofu w tej historyjce po akceptacji kosztów (AC1); token API projektu Konrad generuje w trakcie i wkleja bezpośrednio do sekretów CI (nigdy do repozytorium ani czatu).
- **GitHub:** prywatne repo, plan Free — zob. EVM-006 → „Decyzje” (wpływ na GitHub Environments, SR-INFRA-13 / SR-INFRA-14, RR-20).
- **Brak:** Scaleway (kopie bazy, storage mediów, e-mail, stan IaC) — potrzebne przed startem tej historyjki.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC7 spełnione i zweryfikowane przez QA
- [ ] Przeglądy: security-engineer, solution-architect — APPROVE
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
