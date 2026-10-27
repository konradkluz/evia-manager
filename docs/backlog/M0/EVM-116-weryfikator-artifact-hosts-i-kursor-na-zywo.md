---
id: EVM-116
title: Weryfikator wdrożeń — zawężenie artifactHosts i potwierdzenie kursora Activity na żywo
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
path: pelna            # część kodu + część wymagająca sesji IaC; przegląd security
owner: devops-engineer
contributors: [backend-developer]
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-115]
---

# EVM-116: Weryfikator wdrożeń — zawężenie artifactHosts i potwierdzenie kursora Activity na żywo

## Cel
Jako **właściciel produktu** chcę **zawęzić listę dozwolonych hostów pobrania artefaktu do hosta realnie zaobserwowanego i potwierdzić format kursora Activity na żywym API**, aby **zamknąć RR-34 część 2 i ograniczyć powierzchnię pobierania artefaktów**. SSH do VM jest zamknięty od 2026-10-27; zmiana `config.json` na VM wymaga sesji IaC Konrada.

## Kryteria akceptacji

**AC1 — Log hosta pobrania artefaktu (kod)**
- Zakładając pobranie artefaktu `release-manifest` przez przekierowanie
- Gdy weryfikator pobiera artefakt
- Wtedy log cyklu zawiera wyłącznie host (nazwę) adresu pobrania — bez ścieżki, zapytania, sygnatury i tokenu; test sprawdza, że sygnowany adres z parametrami nie trafia do logu.

**AC2 — Zawężenie wartości domyślnej i szablonu konfiguracji (kod)**
- Zakładając zaobserwowany host z logu z AC1 (zapisany w dzienniku tej historyjki z datą i wersją)
- Gdy aktualizuję szablon `config.json` i wartość domyślną `artifactHosts`
- Wtedy lista zawiera tylko zaobserwowane hosty (bez wzorców z `*`), a pobranie z hosta spoza listy jest odrzucone; test negatywny dla hosta podobnego (sufiks, podmieniony subdomenowo).

**AC3 — Zmiana na VM w sesji IaC (ręczna)**
- Zakładając sesję IaC prowadzoną przez Konrada, przebudowany obraz weryfikatora z `main`
- Gdy runbook kroków „config weryfikatora” jest wykonany
- Wtedy kolejny cykl `staging-verify` i weryfikatora jest zielony z zawężoną listą, a dowód (log bez sygnatur) trafia do `docs/qa/EVM-116/`; wykonanie bez sesji IaC Konrada nie jest wymagane do zamknięcia kodu (część ręczna oznaczona w dzienniku).

**AC4 — Format kursora Activity potwierdzony na żywym API (RR-34 część 2)**
- Zakładając żywy staging z włączonym `STAGING_VERIFY_ENABLED` i ≥ 2 stronami Activity
- Gdy porównuję rzeczywistą odpowiedź Activity (kształt kursora `after`/`before`, nagłówki `Link`) z atrapą
- Wtedy różnice są wypisane w dzienniku, atrapa zostaje do nich dopasowana (test kontraktowy) albo potwierdzona jako zgodna; `threat-model.md` RR-34 dostaje przeliczone ryzyko (aktualizuje `security-engineer`).

## Poza zakresem
- Utwardzenie linków `next` (EVM-115), wiązanie z próbą (EVM-122).
- Nowe SSH/Zmiany IaC bez zgody Konrada; tokeny i PAT-y.

## Decyzje i ograniczenia
- AC3–AC4 zależą od sesji IaC; AC1–AC2 mogą wejść wcześniej, ale wartość domyślna zawęża się dopiero po zaobserwowaniu hosta (kolejność: AC1 → obserwacja → AC2).

## Dziennik
- 2026-10-27 — utworzono (product-owner) z przeglądu PR #103 i RR-34
