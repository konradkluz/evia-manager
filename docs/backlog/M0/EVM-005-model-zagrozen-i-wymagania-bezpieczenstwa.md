---
id: EVM-005
title: Model zagrożeń v1, wymagania bezpieczeństwa i RODO
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P0
owner: security-engineer
contributors: []
reviewers: [solution-architect, devops-engineer]
depends_on: [EVM-001]
---

# EVM-005: Model zagrożeń v1, wymagania bezpieczeństwa i RODO

## Historyjka
Jako **właściciel firmy** chcę **znać zagrożenia dla danych klientów i dokumentacji oraz mieć konkretne wymagania bezpieczeństwa wplecione w plan**, aby **bezpieczeństwo było budowane od początku, a nie łatane po fakcie**.

## Kontekst
Baseline: `docs/security/README.md`. Architektura: wynik EVM-001.

## Kryteria akceptacji
**AC1 — Model zagrożeń**
- Gdy otwieram `docs/security/threat-model.md`
- Wtedy znajduję analizę STRIDE dla kontenerów i przepływów danych z C4 (EVM-001), przypadki nadużyć (m.in. przejęcie konta, były pracownik, kradzież telefonu z danymi offline, złośliwy plik, IDOR na mediach, wyciek podpisanego URL-a, masowe pobranie archiwum, replay kolejki offline), ocenę ryzyka i mitygacje.

**AC2 — Wymagania**
- Gdy otwieram `docs/security/requirements.md`
- Wtedy kontrole OWASP ASVS 5.0 L2 i MASVS istotne dla systemu są zmapowane na moduły i epiki M1–M2, tak by product-owner mógł wpleść je w AC.

**AC3 — Polityki do decyzji**
- Wtedy dla: MFA (kogo obejmuje, mechanizm), haseł i sesji, EXIF / GPS w zdjęciach, retencji mediów i logów, skanowania plików, zakresu danych dla roli Tylko odczyt — jest rekomendacja do akceptacji Konrada.

**AC4 — RODO**
- Gdy otwieram `docs/security/rodo.md`
- Wtedy znajduję: inwentaryzację danych osobowych, podstawy przetwarzania, retencję, podmioty przetwarzające (umowy powierzenia), realizację praw osób, procedurę naruszeń (72 h) i szkic rejestru czynności przetwarzania.

**AC5 — Bramki CI**
- Wtedy jest lista skanów i progów blokujących (SAST, zależności, sekrety, IaC / kontenery, DAST na staging) gotowa do wdrożenia w EVM-006 / EVM-007.

**AC6 — Ryzyka rezydualne**
- Wtedy jest lista ryzyk rezydualnych do świadomej akceptacji przez Konrada.

## Poza zakresem
Implementacja kontroli (powstaje w historyjkach M1–M2), zewnętrzny pentest (rozważany przed produkcją).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
To jest specyfikacja bezpieczeństwa.

## Notatki techniczne
Uwaga prawna: dokument RODO to szkic operacyjny, nie porada prawna — wskaż punkty do konsultacji z prawnikiem / IOD, jeśli są.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC6 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: solution-architect, devops-engineer — APPROVE
- [ ] Demo i akceptacja Konrada (polityki z AC3, ryzyka z AC6)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
