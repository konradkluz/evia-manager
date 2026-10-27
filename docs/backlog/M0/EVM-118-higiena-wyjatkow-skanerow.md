---
id: EVM-118
title: Higiena wyjątków skanerów — horyzont High/Critical i wykrywanie nieużywanych wpisów
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-118: Higiena wyjątków skanerów — horyzont High/Critical i wykrywanie nieużywanych wpisów

## Cel
Jako **właściciel produktu** chcę, **aby wyjątki w `.trivyignore.yaml` i `osv-scanner.toml` miały wymuszony krótki termin i nie zalegały, gdy podatność zniknęła**, aby **zaakceptowane ryzyko nie stawało się trwałe**. Z EVM-007: reguła w `tools/repo-policy/src/exceptions.ts` rozpoznaje horyzont tylko po słowie „high/critical”, a nie wymaga wersjonowanego purl dla podatności.

## Kryteria akceptacji

**AC1 — Horyzont ≤ 30 dni dla High/Critical**
- Zakładając wpis wyjątku z uzasadnieniem dotyczącym High albo Critical (w treści lub z poziomu w wyniku skanera)
- Gdy `expired_at` jest później niż 30 dni od dnia dodania (data z historii git albo pola wpisu)
- Wtedy kontrola `repo-policy` zgłasza błąd; wpis ≤ 30 dni przechodzi; test dla granicy (30 i 31 dni) i dla wpisu bez `expired_at`.

**AC2 — Rozpoznawanie poziomu nie zależy od słowa w komentarzu**
- Zakładając wpisy w obu plikach
- Gdy poziom jest podany w ustrukturyzowanym polu (albo brak poziomu)
- Wtedy brak poziomu traktowany jest jak High (fail-closed), a słowo „high/critical” w opisie nie jest jedynym źródłem; test z wpisem bez słowa kluczowego.

**AC3 — Wymóg precyzyjnego purl**
- Zakładając wpis dla podatności pakietu
- Gdy purl nie ma dokładnej wersji (np. `pkg:apk/alpine/curl` bez `@wersja`) albo ma `paths` zamiast purl
- Wtedy kontrola zgłasza błąd z nazwą wpisu; wpis z wersjonowanym purl przechodzi.

**AC4 — Wykrywanie nieużywanych wyjątków**
- Zakładając skan Trivy/OSV wykonany bez wyjątków (tryb diagnostyczny, raport w `.scratch/scans/`)
- Gdy wpis nie wyciszył żadnego znaleziska
- Wtedy raport wypisuje „nieużywany wyjątek” z ID, a kontrola kończy się ostrzeżeniem (dla wpisów starszych niż 7 dni — błędem); test na zestawie syntetycznych raportów.

## Poza zakresem
- Uruchomienie Renovate (EVM-117); usuwanie wpisów RR-37/RR-38 (EVM-120).
- Zmiana progów samych skanerów.

## Decyzje i ograniczenia
- Wyjątek High/Critical nadal wymaga akceptacji Konrada w `threat-model.md`; ta historyjka dodaje tylko kontrolę automatyczną.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z zamknięcia EVM-007
