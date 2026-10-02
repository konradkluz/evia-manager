---
id: EVM-002
title: Model domeny v1 i wytyczne API
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P0
owner: solution-architect
contributors: [product-owner]
reviewers: [backend-developer, mobile-developer, security-engineer]
depends_on: [EVM-001]
---

# EVM-002: Model domeny v1 i wytyczne API

## Historyjka
Jako **zespół** chcemy **modelu domeny, który obsłuży różnorodne zlecenia bez specjalnych przypadków w kodzie, oraz spójnych zasad API**, aby **kolejne historyjki budować bez przeprojektowywania danych**.

## Kontekst
Rekomendacja „kompozycji” i scenariusze A–F: `docs/product/domain.md`. Model musi być od początku gotowy na pracę offline (M2).

## Kryteria akceptacji
**AC1 — Model**
- Gdy otwieram `docs/architecture/domain-model.md`
- Wtedy znajduję diagram ERD (Mermaid) i opis encji: klient, lokalizacja, zlecenie, szablon zlecenia, katalog usług i pozycje zakresu, proces i etapy, etap płatności, dziennik (wpisy, komentarze, zmiany), media, dokument, strona/kontrahent, użytkownik i rola, zdarzenie audytu — z nazwami zgodnymi ze słownikiem.

**AC2 — Scenariusze**
- Zakładając scenariusze A–F z `domain.md`
- Gdy czytam dokument
- Wtedy dla A–D widzę, jak każdy jest reprezentowany w modelu bez specjalnych przypadków, a dla E–F — że model da się rozszerzyć bez niszczących migracji.

**AC3 — Statusy**
- Wtedy dokument zawiera diagramy stanów zlecenia, etapu i etapu płatności z regułami przejść oraz rolami, które mogą je wykonać.

**AC4 — Gotowość offline**
- Wtedy model spełnia zasady opisane w szkicu `docs/architecture/offline-sync.md`: identyfikatory generowane po stronie klienta, soft delete, wersjonowanie / znaczniki zmian, append-only dla danych z terenu, idempotencja mutacji.

**AC5 — Wytyczne API**
- Gdy otwieram `docs/architecture/api-guidelines.md`
- Wtedy znajduję: konwencje zasobów i nazw, format błędów, paginację, filtrowanie i sortowanie (z polskimi znakami), idempotencję, wersjonowanie i politykę kompatybilności wstecznej (minimalna wersja aplikacji), zasady autoryzacji (deny-by-default) i limity.

**AC6 — Dane startowe**
- Wtedy istnieje propozycja startowego katalogu usług, co najmniej 4 szablonów zleceń (dom — pełny pakiet, dom — sam montaż, garaż — pełny proces, garaż — sama instalacja) i procesów z etapami — do akceptacji przez Konrada.

**AC7 — Słownik**
- Wtedy `docs/product/domain.md` ma potwierdzoną kolumnę „Nazwa w kodzie” (zmiany uzasadnione).

## Poza zakresem
Implementacja, edytor szablonów (M4), inwestycje i DC (tylko rozszerzalność).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Klasyfikacja danych w encjach (dane osobowe, dane wrażliwe dla firmy) — recenzja `security-engineer`.

## Notatki techniczne
_—_

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC7 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: backend-developer, mobile-developer, security-engineer — APPROVE
- [ ] Demo i akceptacja Konrada (w tym danych startowych z AC6)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
