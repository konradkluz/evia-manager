---
id: EVM-019
title: Katalog usług i szablony — dane startowe i odczyt konfiguracji
type: enabler
milestone: M1
epic: E3 Zlecenia — rdzeń
status: in-progress
priority: P0
path: pelna
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
depends_on: [EVM-008]
---

# EVM-019: Katalog usług i szablony — dane startowe i odczyt konfiguracji

## Historyjka
Jako **zespół** chcemy **katalogu usług, szablonów procesów, szablonów zleceń z planami płatności i rodzajów dokumentów jako danych startowych z odczytem przez API**, aby **nowe zlecenie (EVM-022), procesy (EVM-031), płatności (EVM-053) i dokumenty (EVM-047) korzystały z jednej, zaakceptowanej konfiguracji**.

## Kontekst
- Dane zaakceptowane przez Konrada w EVM-002 (AC6): `docs/product/service-catalog.md` § 2–7; założenie 6 — „Dom — sam montaż” z „Pomiary i odbiór”.
- Model: moduł `catalog` (`ServiceCatalogItem`, `ServiceCatalogItemProcedure`, `WorkOrderTemplate`, `WorkOrderTemplateItem`, `ProcedureTemplate`, `ProcedureStageTemplate`, `PaymentMilestoneTemplate`, `DocumentKind`), decyzja D1 (kompozycja przez kopię), D2 (zestawy parametrów w kodzie).
- Konsultacja `solution-architect` (B3): jedna migracja danych dla całego katalogu i endpointy odczytu dla W-05, żeby historyjka miała testowalne zachowanie.

## Kryteria akceptacji
**AC1 — Dane startowe jedną migracją**
- Zakładając pustą bazę po migracjach
- Gdy wykonuje się migracja danych katalogu
- Wtedy w bazie są wszystkie pozycje katalogu (§ 2), szablony procesów z etapami, domyślnym „na kogo czekamy” i dokumentami wynikowymi (§ 4), szablony zleceń z pozycjami i planami płatności (§ 5) oraz rodzaje dokumentów z klasą poufności (§ 6) — liczby zgodne z `service-catalog.md` (np. „Garaż — pełny proces”: 9 pozycji, 9 procesów, 4 transze; „Dom — sam montaż”: 3 pozycje, 3 procesy, 1 transza).

**AC2 — Zestawy parametrów technicznych**
- Zakładając zestawy parametrów z § 3
- Gdy walidator otrzymuje wartości domyślne pozycji szablonu
- Wtedy każdy `parameterSetCode` ma ścisły schemat w kodzie (bez pól dodatkowych, ≤ 16 KB, tylko wartości techniczne), a wartości domyślne z danych startowych przechodzą walidację.

**AC3 — Spójność konfiguracji (SR-INPUT-02)**
- Zakładając konfigurację z błędem (suma udziałów planu płatności ≠ 100, kod spoza wzorca `^[a-z][a-z0-9_]{1,63}$`, nieznany `parameterSetCode`, etap odwołujący się do nieistniejącego rodzaju dokumentu)
- Gdy wykonuje się test spójności konfiguracji
- Wtedy test kończy się błędem wskazującym kod elementu.

**AC4 — Odczyt dla nowego zlecenia**
- Zakładając zalogowanego użytkownika
- Gdy pobiera aktywne szablony zleceń (opcjonalnie z filtrem typu obiektu `siteTypeHint`)
- Wtedy każdy szablon ma podgląd: pozycje, procesy z liczbą etapów i transze z udziałami; dostępne są też listy pozycji katalogu, szablonów procesów i rodzajów dokumentów; etykiety po polsku wg § 7 są w panelu (i18n), a wartości w API — `snake_case`.

**AC5 — Szablon wycofany**
- Zakładając szablon z `isActive = false`
- Gdy pobieram listę aktywnych szablonów
- Wtedy go nie ma, a odczyt po `id` zwraca go z `isActive = false` (podstawa `422 template_unavailable` w EVM-022).

**AC6 — Konfiguracja tylko do odczytu w M1**
- Gdy przeglądam kontrakt API
- Wtedy nie ma operacji zmiany konfiguracji (edytor — M4, Administrator ze step-upem), a zmiana danych startowych wymaga nowej migracji danych.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda pobiera konfigurację
- Wtedy A, E i R dostają dane, niezalogowany — `401`, konto bez drugiego kroku — `403 mfa_enrollment_required`; operacje są w macierzy ról.

## Poza zakresem
- Edytor katalogu i szablonów — M4. Nowe pozycje lub szablony spoza `service-catalog.md`.
- Ekran W-05 — EVM-020–EVM-022.

## UX / UI
Nie dotyczy (API konfiguracji; konsumentem jest W-05 w EVM-022). Etykiety w plikach i18n panelu.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt |
| Edytor | odczyt |
| Tylko odczyt | odczyt |
| Niezalogowany | brak (`401`) |

- Dane: konfiguracja (KONF), bez danych osobowych.
- W AC: SR-INPUT-02, SR-AUTHZ-05. W sekcji: SR-AUTHZ-01, SR-DATA-03.

## Notatki techniczne
- Moduł: `catalog`. Rozmiar: jeden moduł, bez panelu.
- Dane startowe to migracja danych (expand); kody stabilne i niezmienne.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-019 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: code-reviewer, security-engineer — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo (podgląd szablonów przez API na staging) i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-06 — ready → in-progress: start /deliver, ścieżka pelna (wybór Konrada), gałąź feature/EVM-019-katalog-i-szablony
- 2026-10-06 — implementacja (backend-developer): moduł `catalog`, migracje `0007`/`0008`, 5 operacji `GET`, zestawy parametrów i test spójności; testy `EVM-019 AC1–AC7`, bramka lokalna zielona
