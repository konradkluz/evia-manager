---
id: EVM-009
title: Chodzący szkielet — aplikacja mobilna
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P1
owner: mobile-developer
contributors: [devops-engineer]
reviewers: [code-reviewer, ux-designer, security-engineer]
depends_on: [EVM-003, EVM-006, EVM-008]
---

# EVM-009: Chodzący szkielet — aplikacja mobilna

## Historyjka
Jako **zespół** chcemy **minimalnej aplikacji mobilnej budowanej w CI i instalowalnej na telefonach firmy**, aby **M2 zaczynać od działającego fundamentu i kanału dystrybucji**.

## Kontekst
Podejście mobilne i dystrybucja: ADR-y z EVM-001. API ze szkieletu: EVM-008.

## Kryteria akceptacji
**AC1 — Powłoka aplikacji**
- Gdy uruchamiam aplikację
- Wtedy widzę ekran startowy i nawigację wg styleguide'u (tokeny, teksty przez i18n pl) z pustym stanem listy zleceń.

**AC2 — Połączenie z API**
- Zakładając działający endpoint zdrowia na staging
- Gdy aplikacja startuje z siecią i bez sieci
- Wtedy odpowiednio łączy się z API albo pokazuje czytelny stan „offline / brak połączenia z serwerem”.

**AC3 — Minimalna wersja**
- Zakładając, że API zwraca minimalną wspieraną wersję wyższą niż wersja aplikacji
- Gdy aplikacja startuje
- Wtedy pokazuje ekran z prośbą o aktualizację.

**AC4 — Testy**
- Wtedy testy jednostkowe i komponentowe działają w CI z progami pokrycia, a test dymny E2E mobile działa wg ADR.

**AC5 — Build i dystrybucja**
- Wtedy CI buduje wersje iOS i Android, a kanał dystrybucji wewnętrznej jest skonfigurowany.
- Weryfikacja ręczna (Konrad): build zainstalowany na min. 1 telefonie iOS i 1 Android.

**AC6 — Bezpieczeństwo bazowe**
- Wtedy paczka aplikacji nie zawiera sekretów, komunikacja odbywa się wyłącznie przez HTTPS, a bezpieczny magazyn na tokeny jest przygotowany (bez logowania).

## Poza zakresem
Logowanie (M2, E9), praca offline na danych, aparat i upload (spike EVM-011, potem M2).

## UX / UI
Powłoka, pusty stan i ekran aktualizacji wg styleguide'u v1 (wytyczne „Teren”).

## Bezpieczeństwo i prywatność
Klucze podpisu aplikacji tylko w bezpiecznym magazynie CI; publikacja buildów wyłącznie za zgodą Konrada.

## Notatki techniczne
Buildy iOS wymagają macOS (chmura / runner CI) — Konrad pracuje na Windows 11. Konta deweloperskie (Apple, Google) zakłada Konrad — orkiestrator poprosi z wyprzedzeniem.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC4, AC6 pokryte testami (`EVM-009 AC#`); AC5 zweryfikowane ręcznie przez Konrada
- [ ] Przeglądy: code-reviewer, ux-designer, security-engineer — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
