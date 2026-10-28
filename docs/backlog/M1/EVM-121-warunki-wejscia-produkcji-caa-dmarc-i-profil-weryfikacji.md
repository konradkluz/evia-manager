---
id: EVM-121
title: Warunki wejścia produkcji — CAA, DMARC rua i profil strict w staging-verify
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: draft
priority: P1
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-121: Warunki wejścia produkcji — CAA, DMARC rua i profil strict w staging-verify

## Cel
Jako **właściciel produktu** chcę, **aby produkcja nie wystartowała bez rekordów CAA i `rua` w DMARC oraz bez zaostrzonej kontroli `staging-verify`**, aby **łagodzenia tylko dla stagingu (RR-40, RR-41) nie przeniosły się na produkcję**. Decyzja Konrada 2026-10-27: CAA i `rua` „dodamy przy stawianiu produkcji”. To warunek wejścia EVM-061 (do dopisania w jego `depends_on` po akceptacji).

## Kryteria akceptacji

**AC1 — Rekordy DNS w OVH (ręczne, Konrad / sesja IaC)**
- Zakładając domenę produkcyjną i staging w OVH
- Gdy dodaję CAA `issue` i `issuewild` (tylko wybrany CA) oraz `rua` w `_dmarc`
- Wtedy kontrola `dns` w profilu `strict` jest zielona dla domeny produkcyjnej bez ostrzeżeń, a dowód (wynik narzędzia, bez sekretów) trafia do `docs/qa/EVM-121/`.

**AC2 — Profil inny niż `strict` odrzucony na produkcji**
- Zakładając uruchomienie `staging-verify` (lub `prod-verify`) w kontekście produkcji
- Gdy ustawiono `VERIFY_PROFILE=staging` albo wartość nieznaną
- Wtedy narzędzie kończy się czerwono z komunikatem o zakazanym profilu; domyślnie (brak zmiennej) stosuje `strict`; test dla trzech przypadków.

**AC3 — Kontrola zautomatyzowana w workflow**
- Zakładając workflow weryfikujący produkcję (`prod-verify`, bramka 10)
- Gdy konfiguracja workflow lub zmienna profilu jest zmieniona w PR
- Wtedy kontrola `repo-policy` zgłasza błąd przy każdym profilu ≠ `strict` w ścieżkach produkcyjnych; staging może zachować `staging`.

**AC4 — Powiązanie z EVM-061**
- Zakładając EVM-061 w statusie `ready`
- Gdy przygotowujemy pierwsze wdrożenie prod
- Wtedy EVM-061 ma EVM-121 w `depends_on` (zmiana frontmattera po akceptacji Konrada), a runbook „CAA przed produkcją” odwołuje się do dowodu z AC1.

## Poza zakresem
- Zmiana profilu stagingu (zostaje łagodzenie RR-40/RR-41); wybór CA poza rekomendacją `security-engineer`.
- Reszta pierwszego wdrożenia prod (EVM-061).

## Decyzje i ograniczenia
- AC1 wymaga konsoli OVH i decyzji Konrada o CA; agent nie ma dostępu.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z zamknięcia EVM-007
- 2026-10-28 — decyzja Konrada (pytania po nocnej kolejce): bez zależności od EVM-061; rekord CAA Let's Encrypt (RR-40) dopiero przed produkcją.
