---
id: EVM-105
title: "Aplikacja: wpisy i komentarze offline"
type: story
milestone: M2
epic: E12 Wpisy offline
status: draft
priority: P1
path: pelna             # synchronizacja offline
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-104, EVM-107]
---

# EVM-105: Aplikacja — wpisy i komentarze offline

## Cel
Jako **technik** chcę **dopisać wpis (kategoria, treść, opcjonalnie etap) lub komentarz bez zasięgu**, aby **to, co ustalę na miejscu, trafiło do dziennika zlecenia bez ponownego pisania**. Makieta M-04 ([`05-wpis-i-komentarz.md`](../../ux/flows/05-wpis-i-komentarz.md)).

## Kryteria akceptacji

**AC1 — Dodanie wpisu offline**
- Zakładając brak sieci i otwarte zlecenie
- Gdy zapisuję wpis z kategorią i treścią
- Wtedy trafia do trwałej kolejki jako `CreateNote` (z czasem zapisu na telefonie), jest widoczny od razu w dzienniku jako oczekujący, a po powrocie sieci wysyła się raz.

**AC2 — Komentarz**
- Zakładając wpis w dzienniku
- Gdy dodaję komentarz
- Wtedy działa jak w AC1 (`CreateComment`).

**AC3 — Walidacja**
- Zakładając pustą treść lub przekroczenie limitu
- Gdy próbuję zapisać
- Wtedy dostaję komunikat przy polu, a nic nie trafia do kolejki.

**AC4 — Przetrwanie zabicia aplikacji**
- Zakładając wpis zapisany offline
- Gdy aplikacja zostaje zamknięta siłą przed wysłaniem
- Wtedy po uruchomieniu wpis nadal czeka i zostaje wysłany raz (test Maestro).

**AC5 — Odrzucenie**
- Zakładając zlecenie usunięte w biurze przed wysłaniem
- Gdy serwer odrzuca wpis
- Wtedy wpis lub komentarz trafia do „Wymaga uwagi” z powodem prostymi słowami (np. „Zlecenie zostało usunięte albo nie masz do niego dostępu.”), podglądem treści i czasu dodania, akcjami „Dodaj do innego zlecenia”, „Kopiuj treść” i oddzielnie „Usuń z telefonu” (tabela odrzuceń: EVM-107 AC4).

## Poza zakresem
Edycja i usuwanie wpisu z telefonu (redakcja w panelu — EVM-040), załączniki.

## Decyzje i ograniczenia
- UX / UI: układ elementu „Wymaga uwagi” dla wpisów i komentarzy — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-07).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację UX (product-owner)
