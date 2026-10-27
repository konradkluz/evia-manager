---
id: EVM-110
title: "Aplikacja: filmy i „filmy tylko przez Wi-Fi”"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P1
path: pelna             # pliki, synchronizacja offline
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-108, EVM-046]
---

# EVM-110: Aplikacja — filmy i „filmy tylko przez Wi-Fi”

> **Szkic ramowy** — AC do doprecyzowania po EVM-046 i wynikach EVM-108/109.

## Cel
Jako **technik** chcę **nagrać film z oględzin lub montażu i wysyłać go tylko przez Wi-Fi, gdy tak ustawię**, aby **nie zużywać pakietu danych**.

## Kryteria akceptacji (ramowe)

**AC1 — Nagranie i kolejka**
- Zakładając zlecenie i zgodę na aparat i mikrofon
- Gdy nagrywam film z kategorią i opisem
- Wtedy plik trafia do kolejki jako `MediaAsset` (film), z limitem długości/rozmiaru wg EVM-046; film jest domyślnie nagrywany **bez dźwięku** (dźwięk to nagranie rozmów klientów), mikrofon jest używany tylko przy nagrywaniu, a ewentualne włączenie dźwięku wymaga informacji dla technika i wpisu w `rodo.md`.

**AC2 — Tylko Wi-Fi**
- Zakładając ustawienie „Filmy tylko przez Wi-Fi” (domyślnie włączone — do potwierdzenia)
- Gdy telefon ma tylko sieć komórkową
- Wtedy filmy czekają z komunikatem, a zdjęcia i wpisy wysyłają się normalnie; po połączeniu z Wi-Fi film rusza sam.

**AC3 — Duże pliki**
- Zakładając film ≥ 500 MB i przerwę sieci
- Gdy wysyłka wznawia się
- Wtedy kończy się bez duplikatu i z poprawną sumą kontrolną.

## Decyzje i ograniczenia
- Dźwięk w filmach — README planu, decyzja 6 (rekomendacja: domyślnie bez dźwięku).

## Poza zakresem
Edycja i kompresja wideo poza ustaleniami EVM-046.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
