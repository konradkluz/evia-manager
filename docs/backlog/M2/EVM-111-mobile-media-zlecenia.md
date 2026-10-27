---
id: EVM-111
title: "Aplikacja: media zlecenia i status każdego pliku"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P2
path: pelna             # pobieranie miniatur przez podpisane adresy, pamięć podręczna zdjęć poza bazą szyfrowaną
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-108, EVM-045, EVM-068]
---

# EVM-111: Aplikacja — media zlecenia i status każdego pliku

> **Szkic ramowy** — AC do doprecyzowania po EVM-045/068.

## Cel
Jako **technik** chcę **przejrzeć zdjęcia i filmy zlecenia (moje i z biura) wraz ze stanem każdego pliku**, aby **upewnić się, że dotarły i nic nie brakuje**. Makieta M-08.

## Kryteria akceptacji (ramowe)

**AC1 — Galeria zlecenia**
- Zakładając zlecenie z mediami
- Gdy otwieram „Media zlecenia”
- Wtedy widzę miniatury (pobierane na żądanie, gdy `fileState = ready`) i oznaczenia stanu pliku, także dla moich plików oczekujących.

**AC2 — Offline**
- Zakładając brak sieci
- Gdy otwieram galerię
- Wtedy widzę własne pliki lokalne i metadane; pozostałe miniatury pokazują czytelny brak podglądu offline.

**AC3 — Kwarantanna i błąd**
- Zakładając plik `quarantined` lub `failed`
- Gdy go oglądam
- Wtedy widzę przyczynę prostym językiem i akcję („Ponów” albo kontakt z biurem); techniczna przyczyna kwarantanny nie trafia na telefon.

**AC4 — Pamięć podręczna miniatur**
- Zakładając miniatury prywatnych posesji pobierane przez podpisane adresy
- Gdy aplikacja je przechowuje
- Wtedy nie ma trwałej pamięci podręcznej poza kontrolą aplikacji (pamięć w pamięci operacyjnej albo własny katalog wyłączony z kopii zapasowej i czyszczony przy wylogowaniu, `session_revoked` i czyszczeniu urządzenia), a podpisane adresy nie trafiają do logów.

## Poza zakresem
Pobieranie oryginałów offline, usuwanie mediów z telefonu.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — ścieżka zmieniona na `pelna` po konsultacji security (product-owner)
