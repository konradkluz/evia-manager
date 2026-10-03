---
id: EVM-026
title: Ochrona przed zgadywaniem haseł i powiadomienia o bezpieczeństwie konta
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024]
---

# EVM-026: Ochrona przed zgadywaniem haseł i powiadomienia o bezpieczeństwie konta

## Historyjka
Jako **użytkownik i Administrator** chcemy **blokady zgadywania haseł oraz powiadomień o podejrzanych zdarzeniach na koncie**, aby **przejęcie konta było trudne, a próba — szybko zauważona**.

## Kontekst
- SR-AUTH-05 (opóźnienia po 5 próbach, blokada 15 min po 10 próbach w 15 min z e-mailem), SR-AUTH-15 (powiadomienia), SR-LOG-07 (alerty), AB-01. Jednakowe odpowiedzi i limit 20 prób/min/IP — od EVM-067.
- **Od E9:** logowanie z nowego urządzenia mobilnego — w M1 „nowe urządzenie” oznacza przeglądarkę, z której konto nie logowało się wcześniej.
- Makiety: [W-01](../../ux/flows/01-logowanie-mfa.md#w-01-logowanie), [W-02](../../ux/flows/01-logowanie-mfa.md#w-02-drugi-krok); treści e-maili — EVM-015.

## Kryteria akceptacji
**AC1 — Rosnące opóźnienie (SR-AUTH-05)**
- Zakładając 5 nieudanych prób logowania na jedno konto
- Gdy następuje kolejna próba
- Wtedy odpowiedź jest opóźniona, a opóźnienie rośnie z kolejnymi próbami — tak samo dla konta istniejącego i nieistniejącego.

**AC2 — Blokada konta**
- Zakładając 10 nieudanych prób w ciągu 15 min (zegar kontrolowany: 2026-10-05 09:00–09:10)
- Gdy następuje próba z poprawnym hasłem o 09:12
- Wtedy jest odrzucona, W-01 pokazuje „Zbyt wiele prób logowania. Spróbuj ponownie za 15 min.” z treścią i czasem odpowiedzi takimi jak dla nieistniejącego konta, a o 09:26 logowanie znów działa.

**AC3 — E-mail i audyt blokady**
- Gdy konto zostaje zablokowane
- Wtedy użytkownik dostaje e-mail o blokadzie z odnośnikiem do resetu hasła (bez danych klientów — SR-INPUT-07), a powstaje zdarzenie audytu.

**AC4 — Nowa przeglądarka (SR-AUTH-15)**
- Zakładając konto, które nie logowało się wcześniej z danej przeglądarki (mechanizm rozpoznania — plan techniczny, bez odcisku przeglądarki)
- Gdy logowanie się udaje
- Wtedy użytkownik dostaje e-mail o nowym logowaniu, a dla konta Administratora wszyscy Administratorzy dostają dodatkowo alert (SR-LOG-07).

**AC5 — Alerty bezpieczeństwa (SR-LOG-07, SR-LOG-06)**
- Zakładając próg skoku nieudanych logowań w konfiguracji
- Gdy liczba nieudanych logowań go przekracza albo następuje blokada konta
- Wtedy kanał alertów z EVM-007 dostaje alert bez danych osobowych (test alertu na staging).

**AC6 — Bez barier dostępności**
- Gdy użytkownik loguje się po blokadzie
- Wtedy nie ma CAPTCHA ani testów poznawczych (WCAG 3.3.8), a komunikaty są w `role="alert"`.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy ochrona dotyczy wszystkich ról, a odblokowanie konta przed czasem nie istnieje jako operacja (konto odblokowuje upływ czasu albo reset hasła).

## Poza zakresem
- Logowanie z nowego urządzenia mobilnego — od E9. Ręczne odblokowanie przez Administratora — poza M1.

## UX / UI
- W-01, W-02 — komunikat blokady identyczny jak `429`. Stany: błąd (AC2), offline (baner), pozostałe jak EVM-067.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | jak każde konto; dodatkowo dostaje alerty |
| Edytor | jak każde konto |
| Tylko odczyt | jak każde konto |
| Niezalogowany | W-01 |

- Dane: liczniki prób per konto i IP, informacja o przeglądarkach konta (DO-P, retencja jak sesje — P4).
- W AC: SR-AUTH-05, SR-INPUT-07, SR-AUTH-15, SR-LOG-07, SR-LOG-06, SR-AUTHZ-05.
- W sekcji: SR-API-02, SR-LOG-03. Polityki P2, P9, P10.

## Notatki techniczne
- Moduły: `identity`, `audit` + panel. `devops-engineer`: reguły alertów w Grafana (ADR-0013) i test alertów.
- Mechanizm opisany w dokumentacji modułu `identity` (wymóg SR-AUTH-05).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-026 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
