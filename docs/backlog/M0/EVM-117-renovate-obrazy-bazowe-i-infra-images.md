---
id: EVM-117
title: Renovate — regularne odświeżanie zależności i obrazów bazowych (infra-images.json)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P1
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-117: Renovate — regularne odświeżanie zależności i obrazów bazowych

## Cel
Jako **właściciel produktu** chcę, **aby Renovate faktycznie działał i obejmował obrazy bazowe z `infra/runtime/infra-images.json`**, aby **advisories nie łamały bramek ad hoc (jak #98, #99) i nie wygasły wyjątki RR-37/RR-38 (2026-11-20)**. Dziś Renovate nie działa (brak `RENOVATE_TOKEN`); część ręczna należy do Konrada.

## Kryteria akceptacji

**AC1 — customManager dla `infra-images.json` (kod)**
- Zakładając plik `infra/runtime/infra-images.json` z obrazami przypiętymi digestem
- Gdy konfiguracja Renovate jest walidowana (`renovate-config-validator` w `pnpm run scan`)
- Wtedy `renovate.json` ma manager dopasowujący pary obraz+digest z tego pliku (także tagi i digest indeksu wieloarchitekturowego); test w `tools/repo-policy` wykrywa wpis w pliku, którego żaden manager nie obejmuje.

**AC2 — Zasady PR-ów**
- Zakładając aktualizację obrazu bazowego, Node.js albo pakietu z advisory bezpieczeństwa
- Gdy Renovate tworzy PR
- Wtedy PR dotyczący bezpieczeństwa ma priorytet i etykietę, aktualizacje obrazów są grupowane osobno od zależności aplikacji, a digest zawsze jest indeksem zawierającym `linux/arm64` (zgodnie z wymaganiem CAX11) — reguła egzekwowana testem `repo-policy` na pliku po zmianie.

**AC3 — Terminy wyjątków skanerów**
- Zakładając wpisy RR-37/RR-38 wygasające 2026-11-20
- Gdy do terminu zostaje ≤ 14 dni, a wpis nadal istnieje
- Wtedy narzędzie (raport `pnpm run scan` albo `repo-policy`) wypisuje ostrzeżenie z nazwą wpisu i terminem; po terminie wynik jest czerwony.

**AC4 — Uruchomienie Renovate (ręczne, Konrad)**
- Zakładając decyzję Konrada o sposobie uruchomienia (aplikacja GitHub albo token — czynność poza zakresem agenta, token nie trafia do repozytorium)
- Gdy Konrad instaluje/konfiguruje Renovate i uruchamia przebieg
- Wtedy pojawia się co najmniej jeden PR utworzony przez Renovate, a numer PR i data zapisują się w dzienniku jako dowód; do tego czasu historyjka jest `blocked` na części ręcznej, nie `done`.

## Poza zakresem
- Wykrywanie nieużywanych wyjątków i horyzont wyjątków (EVM-118); zmiana Caddy/`evia-web` (EVM-120).
- Automerge bez przeglądu.

## Decyzje i ograniczenia
- Tworzenie tokenu i instalacja Renovate to czynność Konrada; agent nie czyta ani nie wpisuje sekretów.
- Minuty Actions ograniczone (EVM-083) — częstotliwość przebiegów do ustalenia w planie.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z zamknięcia EVM-007
