---
id: EVM-111
title: "Aplikacja: status każdego pliku w kolejce telefonu"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P2
path: lekka             # tylko ekran nad lokalną kolejką; bez pobierania miniatur i podpisanych adresów (zawężone 2026-11-12)
owner: mobile-developer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-108]
---

# EVM-111: Aplikacja — status każdego pliku w kolejce telefonu

> **Szkic ramowy** — AC do doprecyzowania po EVM-108/109. Zakres zawężony 2026-11-12: galeria i przegląd mediów zlecenia (zdjęcia i filmy z biura, miniatury z serwera) **tylko w panelu web**.

## Cel
Jako **technik** chcę **widzieć stan każdego pliku, który zrobiłem telefonem (czeka, wysyła się, wysłany, wymaga uwagi)**, aby **upewnić się, że dotarły i nic nie brakuje**. Ekran M-08 w wersji uproszczonej: lista plików lokalnych z ich statusem, bez podglądu mediów z serwera.

## Kryteria akceptacji (ramowe)

**AC1 — Lista plików zlecenia z ich stanem**
- Zakładając zlecenie, do którego zrobiłem zdjęcia lub filmy na tym telefonie
- Gdy otwieram „Pliki zlecenia”
- Wtedy widzę każdy plik z kolejki telefonu (nazwa/kategoria, typ, czas wykonania, rozmiar) i jego stan: oczekuje, wysyła się (postęp), wysłany (`clean`), błąd, wymaga uwagi; wskaźnik zbiorczy „wysłano n z m”.

**AC2 — Offline**
- Zakładając brak sieci
- Gdy otwieram listę
- Wtedy widzę wszystkie pliki lokalne i ich stany bez komunikatu o błędzie; miniatura to lokalny podgląd zrobionego pliku (z pamięci aplikacji, nie z serwera).

**AC3 — Kwarantanna i błąd**
- Zakładając plik `quarantined` lub `failed`
- Gdy go oglądam
- Wtedy widzę przyczynę prostym językiem i akcję („Ponów” albo kontakt z biurem); techniczna przyczyna kwarantanny nie trafia na telefon.

**AC4 — Stan pusty**
- Zakładając zlecenie bez plików z tego telefonu
- Gdy otwieram listę
- Wtedy widzę stan pusty z informacją, że zdjęcia i filmy zlecenia są dostępne w panelu biura.

## Poza zakresem
Galeria i przegląd mediów zlecenia na telefonie (zdjęcia z biura, miniatury z serwera, podpisane adresy, pamięć podręczna miniatur) — tylko panel web; pobieranie oryginałów offline; usuwanie mediów z telefonu. Dzięki temu EVM-111 nie zależy od EVM-045 i EVM-068.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — ścieżka zmieniona na `pelna` po konsultacji security (product-owner)
- 2026-11-12 — zawężono do statusu plików w kolejce telefonu; galeria mediów tylko w panelu web; ścieżka `pelna` → `lekka` (brak pobierania miniatur i podpisanych adresów), zależności 045/068 usunięte, 4 AC (decyzja Konrada 2026-11-12 / Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”)
