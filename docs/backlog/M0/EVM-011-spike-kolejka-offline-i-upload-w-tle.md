---
id: EVM-011
title: "Spike: kolejka offline i upload w tle"
type: spike
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P1
owner: mobile-developer
contributors: []
reviewers: [solution-architect, security-engineer]
depends_on: [EVM-001]
---

# EVM-011: Spike — kolejka offline i upload w tle

## Cel
Sprawdzić w praktyce, czy podejście mobilne z ADR spełnia najtrudniejsze wymaganie systemu: **zdjęcia i duże filmy zrobione bez zasięgu trafiają na serwer automatycznie, w tle i bez strat** — zanim zbudujemy na nim M2. Time-box: jedna sesja realizacji; kod spike'a nie trafia na produkcję.

## Kryteria akceptacji
**AC1 — Prototyp**
- Wtedy w `spikes/offline-upload/` jest prototyp: aparat → trwały zapis lokalny → trwała kolejka → wznawialny upload porcjami do storage'u zgodnego z ADR (staging albo lokalny emulator S3).

**AC2 — Scenariusze (osobno iOS i Android)**
- Wtedy raport zawiera wyniki dla: tryb samolotowy → powrót sieci; zabicie aplikacji w trakcie uploadu; restart telefonu; aplikacja w tle przez ponad 10 min; film ≥ 500 MB; przełączenie Wi-Fi ↔ LTE.

**AC3 — Pomiary**
- Wtedy raport podaje: czas uploadu, orientacyjne zużycie baterii, liczbę ponowień, liczbę duplikatów (oczekiwane 0) i wynik weryfikacji integralności (suma kontrolna).

**AC4 — Rekomendacja**
- Wtedy `docs/architecture/offline-sync.md` i `docs/architecture/media-pipeline.md` zawierają wnioski; jeśli podejście z ADR się nie sprawdza — jest propozycja zmiany ADR.

**AC5 — Weryfikacja na telefonie (ręczna)**
- Gdy Konrad lub technik wykonuje scenariusz „tryb samolotowy → zdjęcia i film → powrót sieci” na fizycznym telefonie
- Wtedy pliki docierają na serwer bez duplikatów.

## Poza zakresem
Jakość produkcyjna kodu, UI zgodny ze styleguide'em, uwierzytelnianie (prototyp może używać tokenu testowego bez danych klientów).

## UX / UI
Nie dotyczy (prototyp techniczny).

## Bezpieczeństwo i prywatność
Tylko dane testowe; storage testowy prywatny; żadnych sekretów w kodzie spike'a.

## Notatki techniczne
Na Windows 11 dostępny jest emulator Androida; testy iOS wymagają urządzenia lub usługi chmurowej (wg ADR) — scenariusze iOS mogą wymagać pomocy Konrada.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC4 spełnione; AC5 potwierdzone przez Konrada
- [ ] Przeglądy: solution-architect, security-engineer — APPROVE
- [ ] Decyzja Konrada: kontynuujemy z podejściem z ADR / zmieniamy ADR

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
