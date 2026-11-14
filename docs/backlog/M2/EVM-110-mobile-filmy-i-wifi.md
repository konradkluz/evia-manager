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
depends_on: [EVM-108, EVM-046, EVM-130, EVM-131]
---

# EVM-110: Aplikacja — filmy i „filmy tylko przez Wi-Fi”

> **Szkic ramowy** — AC do doprecyzowania po EVM-046 i wynikach EVM-108/109.

## Cel
Jako **technik** chcę **nagrać film z oględzin lub montażu i wysyłać go tylko przez Wi-Fi, gdy tak ustawię**, aby **nie zużywać pakietu danych**.

## Kryteria akceptacji (ramowe)

**AC1 — Nagranie i kolejka**
- Zakładając zlecenie i zgodę na aparat
- Gdy nagrywam film z kategorią
- Wtedy plik trafia do kolejki jako `MediaAsset` (film), z limitem długości/rozmiaru wg EVM-046; film jest nagrywany **bez dźwięku** (dźwięk to nagranie rozmów klientów), a aplikacja nie ma uprawnienia do mikrofonu (`RECORD_AUDIO` nieobecne w manifeście — kontrola `verify`).

**AC2 — Tylko Wi-Fi**
- Zakładając ustawienie „Filmy tylko przez Wi-Fi” (domyślnie włączone — do potwierdzenia)
- Gdy telefon ma tylko sieć komórkową
- Wtedy filmy czekają z komunikatem, a zdjęcia i wpisy wysyłają się normalnie; po połączeniu z Wi-Fi film rusza sam.

**AC3 — Duże pliki**
- Zakładając film ≥ 500 MB i przerwę sieci
- Gdy wysyłka wznawia się
- Wtedy kończy się bez duplikatu i z poprawną sumą kontrolną.

## Decyzje i ograniczenia
- **Decyzja 6 (Konrad, 2026-11-14): filmy bez dźwięku, aplikacja nie prosi o mikrofon** i nie ma `RECORD_AUDIO` (`expo-camera`: `recordAudioAndroid: false`); zgoda na mikrofon usunięta z AC1. **Uwaga dla ux-designera przy tej historyjce:** poprawić makietę 09 (usunąć „Mikrofon do filmów”, stany mikrofonu i „Nagrywamy dźwięk razem z obrazem”; zostaje chip „Film wyłączony” dla braku miejsca).
- Zależności po podziale EVM-109: EVM-130 (zadanie systemowe) i EVM-131 (kontrakt mediów); **zakaz dystrybucji** paczki z aparatem/wysyłaniem przed dowodami EVM-084 i sign-offem EVM-112.
- Do doprecyzowania (konsultacje 2026-11-14): „tylko Wi-Fi” = ograniczenie zadania do sieci bez opłat za transfer (`NETWORK_TYPE_UNMETERED`, bez `ACCESS_WIFI_STATE` i lokalizacji), ustawienie lokalne w „Więcej → Wysyłanie” domyślnie włączone; zdjęcia nie czekają na Wi-Fi, a „Czeka na Wi-Fi” nie jest błędem; ryzyko `abandoned` po 7 dniach czekania („Ponów” z nowym `assetId`); trwałość nagrania po zabiciu procesu; AC3 ≥ 500 MB → `manual` w EVM-112 (na emulatorze ≤ 128 MiB).

## Poza zakresem
Edycja i kompresja wideo poza ustaleniami EVM-046.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-11-14 — decyzja 6 (bez dźwięku, bez mikrofonu) wpisana, `depends_on` + EVM-130, EVM-131; status `draft`, doprecyzowanie w kolejnej nocy (product-owner)
