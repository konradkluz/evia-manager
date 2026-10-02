---
id: EVM-003
title: Styleguide v1 i design tokens
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P0
owner: ux-designer
contributors: []
reviewers: [web-developer, mobile-developer]
depends_on: []
---

# EVM-003: Styleguide v1 i design tokens

## Historyjka
Jako **użytkownik panelu i aplikacji** chcę **spójnego, czytelnego i dostępnego interfejsu zgodnego z marką EVia Charge**, aby **szybko i bez pomyłek pracować w biurze i w terenie**.

## Kontekst
Zasady: `docs/ux/README.md`. Styleguide jest wiążący dla wszystkich agentów implementujących UI. Wymaga materiałów marki od Konrada.

## Kryteria akceptacji
**AC1 — Marka**
- Zakładając, że brak materiałów marki w repozytorium
- Gdy ux-designer rozpoczyna pracę
- Wtedy pozyskuje materiały (logo, kolory, fonty lub adres strony) albo proponuje 2 warianty palety do wyboru; wybór Konrada jest zapisany w „Decyzje”.

**AC2 — Fundamenty**
- Gdy otwieram `docs/ux/styleguide.md`
- Wtedy znajduję: kolory z semantyką (akcje, statusy, błąd, ostrzeżenie, sukces, neutralne) z kontrastem ≥ 4,5:1 dla tekstu i ≥ 3:1 dla elementów UI, typografię (skala, fonty z licencją), odstępy, siatkę i breakpointy, promienie, cienie, ruch i ikony.

**AC3 — Design tokens**
- Gdy otwieram `design/tokens/`
- Wtedy tokeny w formacie W3C DTCG (JSON) pokrywają wszystkie fundamenty — żadna wartość ze styleguide'u nie istnieje bez tokenu.

**AC4 — Komponenty**
- Wtedy styleguide zawiera inwentarz komponentów dla M1–M2 (co najmniej: przyciski, pola formularzy, select, checkbox / radio, data, tabela / lista, filtry, karta, odznaka statusu, oś czasu, miniatura / galeria, uploader i element kolejki uploadu, dialog, toast, pusty stan, szkielet ładowania, nawigacja web i mobile) z wariantami, stanami i zasadami użycia.

**AC5 — Statusy**
- Wtedy statusy zlecenia, etapu i płatności mają system wizualny rozróżnialny bez koloru (ikona + etykieta).

**AC6 — Teren**
- Wtedy są wytyczne mobilne: cele dotyku ≥ 48×48 dp, kontrast w pełnym słońcu, obsługa jedną ręką, wskaźniki offline i synchronizacji.

**AC7 — Treści**
- Wtedy są zasady mikrocopy po polsku: ton, terminologia ze słownika, formaty dat, kwot i telefonów, komunikaty błędów wskazujące wyjście z sytuacji.

**AC8 — Dostępność i egzekwowanie**
- Wtedy jest sekcja dostępności (WCAG 2.2 AA), opis egzekwowania zgodności (tokeny, reguły lint, przegląd UX) i changelog styleguide'u.

## Poza zakresem
Makiety ekranów (EVM-004), implementacja biblioteki komponentów (powstaje w historyjkach implementacyjnych), tryb ciemny (decyzja w trakcie — domyślnie później).

## UX / UI
To jest specyfikacja UX.

## Bezpieczeństwo i prywatność
Nie dotyczy.

## Notatki techniczne
Format tokenów musi dać się przetworzyć do web i mobile (transformację wdraża EVM-006).

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: web-developer, mobile-developer (wykonalność) — APPROVE
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
