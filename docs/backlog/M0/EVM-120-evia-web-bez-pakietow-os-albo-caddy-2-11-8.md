---
id: EVM-120
title: Obraz evia-web bez pakietów OS albo Caddy 2.11.8 — usunięcie wyjątków RR-37/RR-38
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P1
path: pelna            # obraz brzegowy, wyjątki bezpieczeństwa
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-120: Obraz evia-web bez pakietów OS albo Caddy 2.11.8 — usunięcie wyjątków RR-37/RR-38

## Cel
Jako **właściciel produktu** chcę **usunąć u źródła podatności w obrazie `evia-web` i brzegowym Caddy**, aby **wyjątki RR-37 i RR-38 (wygasają 2026-11-20, tylko staging) mogły zniknąć, a produkcja miała zero wpisów dla Caddy**. Wariant A: `evia-web` na `distroless/static` (bez `curl`, `brotli-libs`, Alpine); wariant B: Caddy 2.11.8 (RR-37) z poprawionymi pakietami Alpine (RR-38).

## Kryteria akceptacji

**AC1 — Wybrany wariant, zero wyjątków**
- Zakładając decyzję wariantu A albo B (zaakceptowaną przez Konrada na podstawie rekomendacji `solution-architect`/`security-engineer`)
- Gdy buduję obrazy `evia-web` i brzegowy Caddy oraz uruchamiam bramkę 6 (Trivy)
- Wtedy 0 HIGH/CRITICAL bez wyjątków, a z `.trivyignore.yaml` usunięte wpisy RR-37 i RR-38 (w tym `usr/local/bin/caddy`); wpisy RR-36 poza zakresem.

**AC2 — Zachowanie bez zmian**
- Zakładając obraz po zmianie
- Gdy `evia-web` serwuje panel pod flagami stagingu (user nie-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `tmpfs`)
- Wtedy odpowiedzi, nagłówki bezpieczeństwa i healthcheck są takie jak przed zmianą (test integracyjny/E2E web), a binarka Caddy nie ma file capability (reguła `repo-policy` z #100 zielona).

**AC3 — Obraz wieloarchitekturowy i przypięcie**
- Zakładając wymaganie CAX11 (`linux/arm64`)
- Gdy aktualizuję `infra/runtime/infra-images.json`, `infra/runtime/compose.infra.yaml`, `infra/images/web/Dockerfile`
- Wtedy digesty są indeksami zawierającymi `linux/arm64`, a kontrola platformy w `publish` przechodzi; brak nowej zależności bez uzasadnienia licencyjnego.

**AC4 — Dokumentacja ryzyk**
- Zakładając usunięte wyjątki
- Gdy kończę zmianę
- Wtedy `security-engineer` oznacza RR-37 i RR-38 jako zamknięte w `threat-model.md` z datą i odnośnikiem do PR; termin: zmiana scalona przed 2026-11-20.

## Poza zakresem
- Wyjątek RR-36 (`gosu` w PostgreSQL); aktualizacja Node.js w `api`; Renovate (EVM-117).

## Decyzje i ograniczenia
- Wymaga decyzji Konrada: wariant A (większa zmiana, trwałe usunięcie pakietów OS) vs B (mniejsza, zależna od wydania Caddy). Rekomendacja PO: B jeśli 2.11.8 jest dostępny wcześnie; A jako rozwiązanie docelowe przed produkcją, bo B nie chroni przed kolejnymi CVE w Alpine.
- Termin twardy: 2026-11-20 (bez przedłużenia bez nowej decyzji Konrada).

## Dziennik
- 2026-10-27 — utworzono (product-owner) z RR-37/RR-38
