---
id: EVM-085
title: Obserwowalność, alerty, monitoring dostępności i koszty stagingu (007c)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P1
path: pelna
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-084]
---

# EVM-085: Obserwowalność, alerty, monitoring dostępności i koszty stagingu (007c)

> Część 007c podziału EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) (w tym „Odstępstwo od ADR-0011” i RR-24). Zawiera AC8 dawnego EVM-007 (wymagania z EVM-016, zaakceptowane 2026-10-06).

## Cel
Jako **właściciel produktu** chcę **widzieć błędy, dostępność i koszty stagingu oraz dostawać alert e-mail, gdy coś jest nie tak (także z kanału wdrożeń i kopii)**, aby **reagować, zanim problem dotknie użytkowników**.

## Kryteria akceptacji
**AC1 — Logi, błędy, tokeny per środowisko**
- Gdy staging działa
- Wtedy logi strukturalne bez danych osobowych trafiają do wspólnego stosu Grafana z etykietą `env="staging"`, a błędy do Sentry (projekty `api`, `web`, `environment=staging`, osobny DSN i token zapisu z datą wygaśnięcia, bez zakresów odczytu); odczyt tylko konto Konrada z MFA.

**AC2 — Alerty e-mail do Konrada**
- Gdy występuje: brak heartbeatu agenta > 10 min, HEAD `main` ≠ wdrożony commit > 30 min, blokada V0, wygaśnięcie PAT/klucza za ≤ 30 dni, wyczerpanie limitu API, nieudana kopia, zasoby testu odtworzenia > 24 h, brak danych (kontrola działania alertów), zużycie limitów Grafany/Sentry
- Wtedy e-mail z alertem (bez danych osobowych) dociera do Konrada (test wywołujący każdy z alertów); żadna decyzja wdrożeniowa nie korzysta z danych Grafany.

**AC3 — Monitoring dostępności**
- Gdy panel lub API staging nie odpowiada (`/healthz`) przez ustalony czas
- Wtedy zewnętrzny monitoring dostępności wysyła alert e-mail do Konrada i raz zgłasza powrót.

**AC4 — Koszty**
- Wtedy miesięczny koszt środowiska (VM, storage, TEM, monitoring) jest policzony i zapisany, a alert budżetowy (progi 50% i 80%) działa u dostawców, których plan na to pozwala.

**AC5 — Zbieranie logów i reguła alertu bezpieczeństwa (AC8 z EVM-016)**
- Gdy Alloy zbiera logi
- Wtedy tylko z usług z listy dozwolonych, a reguła alertu działa na polach `alert: "security"` / `alertCode` i dostarcza alert do kanału z AC2; limity szybkości w Alloy i niższe próbkowanie Sentry na staging oraz spike protection chronią wspólne limity.
- Oraz reguła obejmuje alerty logowania z EVM-026 (blokada konta, skok nieudanych logowań, skok porażek drugiego kroku — `alertCode` i progi z EVM-026 AC6); w teście alert wywołany zdarzeniem z aplikacji dociera do kanału z AC2, a próg skoku jest skalibrowany na staging (progi w konfiguracji, nie w kodzie).

**AC6 — Caddy, Sentry, rola bazy (AC8 z EVM-016)**
- Wtedy Caddy działa bez `log_credentials` i z filtrem nagłówka `X-CSRF-Token`; Sentry nie przechowuje treści żądań `/api/v1/auth/activation/*` i czyści fragment URL; API łączy się rolą `evia_app` (członek roli, nie właściciel), a `TRUSTED_PROXIES` wskazuje adresy proxy.

**AC7 — Test braku tokenu aktywacyjnego**
- Zakładając aktywację konta na staging (polecenie z EVM-016 lub token syntetyczny)
- Gdy sprawdzam logi
- Wtedy tokenu aktywacyjnego nie ma w logach Alloy i Caddy ani w zdarzeniach i breadcrumbach Sentry (test negatywny: token celowo wstrzyknięty do żądania nie przechodzi do żadnego z nich).

**AC8 — Runbook alertów i rotacji**
- Wtedy w `docs/ops/runbooks/` jest procedura reakcji na każdy alert z AC2 oraz rotacji tokenów zapisu Grafana i DSN Sentry (także po incydencie na staging).

## Poza zakresem
- Alerty i monitoring prod, alert „brak danych” dla `env="prod"`, e-mail o wdrożeniu prod, `prod-verify` — E8 (EVM-061).
- Alerty bezpieczeństwa aplikacji poza testem kanału (treść i progi — historyjki funkcjonalne, np. EVM-026).
- Płatne konta Grafana/Sentry lub samodzielny hosting (plan wyjścia ADR-0018).

## Decyzje i ograniczenia
- Odstępstwo od ADR-0011 (wspólny stos Grafana i organizacja Sentry) i RR-24 (2 Low pod warunkami) zaakceptowane 2026-10-13.
- AC8 z dawnego EVM-007 przeniesione tu bez zmiany treści; asercja o `evia_app` i `TRUSTED_PROXIES` jest też w EVM-076 AC3 (test dymny).
- Dane tylko po redakcji i scrubbingu (ADR-0013); staging ma dane syntetyczne.

## Dziennik
- 2026-10-13 — utworzono (product-owner, podział EVM-007 wg ADR-0018: dawne AC5, AC6, AC8 i część AC7)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
- 2026-10-20 — dopisano do AC5 alerty logowania z EVM-026 (blokada, skoki porażek) — na polecenie Konrada przy refine EVM-026 (orkiestrator)
- 2026-10-28 — start realizacji (nocna kolejka, tor T3), gałąź feature/EVM-084-085-backupy-obserwowalnosc
