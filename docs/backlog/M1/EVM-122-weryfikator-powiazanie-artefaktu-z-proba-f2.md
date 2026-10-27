---
id: EVM-122
title: Weryfikator wdrożeń — powiązanie artefaktu release-manifest z próbą (F2) przed produkcją
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: draft
priority: P1
path: pelna            # kanał wdrożeń prod (SR-INFRA-13/14), przegląd security
owner: backend-developer
contributors: [devops-engineer]
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-115]
---

# EVM-122: Weryfikator wdrożeń — powiązanie artefaktu release-manifest z próbą (F2) przed produkcją

## Cel
Jako **właściciel produktu** chcę, **aby wdrażany manifest pochodził z tej samej próby (`runAttempt`), której zielone joby zweryfikowano**, aby **po „Re-run all jobs” nowszy, trwający manifest nie został wdrożony przy zielonej starszej próbie**. Follow-up F2 z przeglądu V3 (2026-10-23); zamknięcie wymagane przed produkcją (EVM-061). Konsolidacja zasad V2/V3 w jednym, testowalnym miejscu.

## Kryteria akceptacji

**AC1 — Artefakt powiązany z próbą**
- Zakładając przebieg z ≥ 2 próbami tego samego commita
- Gdy weryfikator wybiera artefakt `release-manifest`
- Wtedy akceptuje wyłącznie artefakt powstały w próbie, której joby `ci-gate` i `publish` zweryfikowano (przez `runAttempt` w manifeście albo okno czasu jobu `publish`); artefakt innej próby → odrzucenie fail-closed z kodem powodu.

**AC2 — Scenariusz Re-run**
- Zakładając próbę 1 zieloną i próbę 2 trwającą (albo czerwoną) z innym manifestem
- Gdy weryfikator decyduje o wdrożeniu
- Wtedy nie wdraża manifestu próby 2 przy zielonej próbie 1; test negatywny na atrapie z obiema próbami i z odwróconą kolejnością.

**AC3 — Jedna reguła zamiast kilku**
- Zakładając obecne rozproszone kontrole V2/V3 dotyczące artefaktu i próby
- Gdy konsoliduję je w jedną funkcję reguły z tabelą przypadków
- Wtedy dotychczasowe testy `EVM-007 AC3` przechodzą bez osłabienia, a nowe przypadki AC1–AC2 są w tej samej tabeli.

**AC4 — Zgodność z kanałem prod**
- Zakładając weryfikator uruchomiony dla `main` i obiekt zatwierdzenia `approvals/prod.json` (`commit`, `manifestSha256`)
- Gdy skrót manifestu z artefaktu nie zgadza się z zatwierdzonym
- Wtedy wdrożenie jest odrzucone; test negatywny, bez zmiany reguł zatwierdzeń ADR-0018.

## Poza zakresem
- Utwardzenie linków `next` (EVM-115), zawężenie hostów (EVM-116), zmiana ADR-0018.
- Zmiany na VM (sesja IaC Konrada).

## Decyzje i ograniczenia
- Wybór mechanizmu (`runAttempt` w manifeście vs. okno czasu) — `solution-architect`/`security-engineer`; zmiana formatu manifestu wymaga zgodności wstecznej z wydaniami na stagingu.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z follow-upu F2 EVM-007
