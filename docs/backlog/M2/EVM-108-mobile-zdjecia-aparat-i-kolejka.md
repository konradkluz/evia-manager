---
id: EVM-108
title: "Aplikacja: zdjęcia — aparat, kategoria, opis, kolejka plików"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P1
path: pelna             # pliki, dane osobowe na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-107, EVM-109]
---

# EVM-108: Aplikacja — zdjęcia: aparat, kategoria, opis, kolejka plików

> **Szkic ramowy** — AC do doprecyzowania po EVM-044/109.

## Cel
Jako **technik** chcę **zrobić zdjęcie z poziomu zlecenia, nadać mu kategorię i opis i mieć pewność, że trafi do archiwum**, aby **dokumentacja z oględzin i montażu powstawała na miejscu**. Makiety M-06, M-07.

## Kryteria akceptacji (ramowe)

**AC1 — Zdjęcie do zlecenia**
- Zakładając otwarte zlecenie (lub arkusz wyboru zlecenia) i zgodę na aparat
- Gdy robię zdjęcie i wybieram kategorię oraz opcjonalny opis
- Wtedy powstaje `MediaAsset` (`CreateMediaAsset`) i plik w pamięci wewnętrznej aplikacji pod nazwą UUID (bez zapisu do galerii, SR-MOB-02; bez lokalizacji w EXIF, bo aplikacja nie ma tego uprawnienia), a zdjęcie czeka w kolejce.

**AC2 — Status każdego pliku**
- Zakładając pliki w różnych stanach
- Gdy otwieram „Kolejka”
- Wtedy widzę dla każdego: oczekuje, wysyła się (%), wysłano, wymaga uwagi.

**AC3 — Brak duplikatów po przerwach**
- Zakładając 30 zdjęć zrobionych bez zasięgu i wymuszone zamknięcie aplikacji w trakcie wysyłki
- Gdy wraca zasięg
- Wtedy wszystkie 30 jest na serwerze w właściwym zleceniu, 0 duplikatów.

**AC4 — Brak telemetrii w bibliotece aparatu**
- Zakładając paczkę z aparatem
- Gdy analizuję ruch sieciowy aplikacji w całej sesji testu i uruchamiam `tools/mobile-apk verify`
- Wtedy nie ma ruchu do usług analitycznych, ML Kit ani Firebase, a komponenty telemetrii są usunięte albo biblioteka aparatu jest zastąpiona.

## Poza zakresem
Filmy (EVM-110), galeria zlecenia (EVM-111), edycja zdjęć.

## Decyzje i ograniczenia
- Bezpieczeństwo i prywatność: **telemetria `expo-camera` (ML Kit/Firebase) rozstrzygnięta przed `ready`** (usunięcie dostawcy albo inna biblioteka aparatu); powiadomienia i podglądy bez danych klienta.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
