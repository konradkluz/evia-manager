---
id: EVM-125
title: Przemianowanie staging → produkcja (domena, nazwy zasobów, słownictwo)
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: draft
priority: P3
path: pelna            # zmiana domeny i nazw w infrastrukturze, kanale wdrożeń i poczcie
owner: devops-engineer
contributors: [backend-developer]
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-061, EVM-084]
---

# EVM-125: Przemianowanie staging → produkcja (domena, nazwy zasobów, słownictwo)

## Cel
Jako **właściciel produktu** chcę, **aby jedyne środowisko, na którym pracuje firma, nazywało się „produkcja” w domenie, konfiguracji, dokumentacji i panelu**, aby **nazwa nie wprowadzała w błąd (realne dane na „stagingu”) i nie zostawiała pozostałości po nieistniejącej drugiej instancji**. Decyzja Konrada 2026-11-13: jedno środowisko; przemianowanie później, osobną małą historyjką — **nie blokuje startu realnych danych**.

## Kryteria akceptacji
**AC1 — Domena i certyfikat**
- Zakładając docelową nazwę domeny zatwierdzoną przez Konrada (pytanie 1 w EVM-089)
- Gdy przełączam środowisko na nową nazwę
- Wtedy panel i API działają pod nową domeną po HTTPS (CAA, DNSSEC bez zmian poza nazwą), stary adres przekierowuje na nowy przez uzgodniony okres, a nadawca e-maili ma komplet rekordów SPF, DKIM i DMARC `p=reject` dla nowej nazwy (EVM-089 AC3); zaproszenia i linki w e-mailach prowadzą na nową domenę.

**AC2 — Nazwy i konfiguracja bez „staging”**
- Gdy przeszukuję IaC, konfigurację wdrożeń (`staging-verify`, `VERIFY_PROFILE`), nazwy bucketów, projektów i alertów
- Wtedy nie ma nazw „staging” tam, gdzie oznaczają jedyne środowisko; zasoby z nietykalną nazwą (np. bucket z blokadą 37 dni) mają zapisane odstępstwo w runbooku; bez utraty danych, kopii i ciągłości kanału wdrożeń (test: wdrożenie i rollback po zmianie).

**AC3 — Słownictwo w dokumentach i interfejsie**
- Gdy czytam README, runbooki, ADR-y (adnotacje), model zagrożeń i teksty panelu
- Wtedy „staging” oznacza tylko ewentualne środowisko próbne lokalne (EVM-114), a „produkcja” — jedyne środowisko; historia (ADR, dzienniki) pozostaje nietknięta.

## Poza zakresem
- Drugie środowisko (próbne w chmurze) — nowa historyjka, jeśli kiedyś potrzebne.

## Decyzje i ograniczenia
- Wymaga od Konrada: nazwy domeny i zmiany rekordów DNS w OVH; operacje na żywym środowisku wyłącznie w sesji IaC za jego zgodą.

## Dziennik
- 2026-11-13 — utworzono (product-owner) wg decyzji Konrada „jedno środowisko; przemianowanie osobną małą historyjką”; `draft`, P3 (3 AC)
- 2026-11-13 — decyzja Konrada: adres `panel.eviacharge.pl` wchodzi od razu z EVM-089 (przed wpuszczeniem biura, żeby nikt nie rejestrował kluczy dostępu dwa razy); w tej historyjce zostaje tylko kosmetyka nazw (projekty w konsolach, nazwy zasobów i dokumentów; nazwy bucketów zostają) (Tech Lead)
