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
depends_on: [EVM-107, EVM-130, EVM-131]
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
- **Zależności (zmiana 2026-11-14):** EVM-109 (silnik) wchodzi pośrednio przez EVM-130 (zadanie systemowe i kolejka plików); EVM-131 dostarcza kontrakt mediów z telefonu (kanał mobile, `CreateMediaAsset`, `media_asset` w dzienniku zmian).
- **Zakaz dystrybucji:** paczka z aparatem nie trafia do techników ani na środowisko z danymi realnymi przed dowodami EVM-084 i sign-offem EVM-112.
- **Wymagania security (do doprecyzowania w `/refine`):** aparat wbudowany (CameraX; rekomendacja architekta: `expo-camera` z wyłączonym skanerem kodów), zapis tylko w katalogu kolejki, bez `setLocation`; zakaz intencji systemowego aparatu (`ACTION_IMAGE_CAPTURE`, `expo-image-picker` blokowany ESLintem); uprawnienie `CAMERA` w allowliście `verify`; AC4 dzielone: w nocy statyczna kontrola `verify` (brak pakietów `com.google.mlkit`, `com.google.firebase`, `com.google.android.datatransport`, `com.google.android.gms`; drzewo zależności Gradle bez tych grup), ruch sieciowy całej sesji → EVM-112 (`manual`); sesje wysyłania tworzone leniwie (limit 100 aktywnych, `429`).
- **Decyzje projektowe UX do potwierdzenia przy doprecyzowaniu:** (1) opis zdjęcia poza wersją 1 (`CreateMediaAsset.description` niezmienny; kategoria jednym dotknięciem); (2) stały dolny pasek „Zrób zdjęcie” w szczegółach zlecenia + „Dodaj wpis”, a AddSheet „Zdjęcie lub film” prowadzi do wyboru zlecenia; (3) brak usuwania i odrzucania niewysłanego pliku w v1 (jest tylko „Usuń z telefonu” dla „Wymaga uwagi”); (4) wybór zlecenia w trybie ukrytych danych po numerach (ocena security w 108; do tego czasu nie rozszerzać numerów w Kolejce); (5) retencja rekordów wysłanych plików na telefonie 7 dni (dla „wysłano n z m”); (6) jeden komponent listy plików (Kolejka + „Pliki zlecenia”). Etap (`procedureStageId`) i podgląd przed zapisem — poza v1. Poprawka makiety 09 (wejście, brak opisu) — zadanie ux-designera.
- Kryteria `manual` (EVM-112): 30 zdjęć z prawdziwym aparatem, kontrast w słońcu, spust w rękawicy, układ 360 dp, odmowa trwała i powrót z ustawień.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-14 — `depends_on`: EVM-109 → EVM-130 i EVM-131 po podziale i konsultacjach; dopisano decyzje i wymagania; status `draft`, doprecyzowanie w kolejnej nocy (product-owner)
