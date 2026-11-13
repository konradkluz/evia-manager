---
id: EVM-128
title: "Aplikacja: „Utwórz ponownie” odrzuconego szybkiego zlecenia"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: draft
priority: P2
path: pelna             # synchronizacja offline, dane osobowe na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-106]
---

# EVM-128: Aplikacja — „Utwórz ponownie” odrzuconego szybkiego zlecenia

## Cel
Jako **technik** chcę **poprawić i ponownie wysłać odrzucone szybkie zlecenie bez wpisywania wszystkiego od nowa**, aby **zdjęcia i wpisy, które już do niego dodałem, trafiły do nowego zlecenia**. Wydzielone z EVM-106 (AC4 pierwotnej wersji) jako zbyt duży przyrost na jedną sesję; „Wymaga uwagi” z grupą, powodem i „Usuń z telefonu” dostarcza EVM-107 / EVM-106.

## Kryteria akceptacji

**AC1 — Formularz z zachowanymi danymi**
- Zakładając odrzucone szybkie zlecenie (`id_conflict`, `template_unavailable` lub `validation_failed`) w „Wymaga uwagi”
- Gdy dotykam „Utwórz ponownie”
- Wtedy otwiera się formularz M-10 z danymi z odrzuconej komendy; przy `template_unavailable` szablon trzeba wybrać ponownie z szablonów w telefonie; walidacja jak w EVM-106.

**AC2 — Nowe zlecenie i przeniesienie zależnych**
- Zakładając poprawiony formularz
- Gdy zapisuję
- Wtedy powstaje nowa komenda z nowym identyfikatorem, stara grupa znika z „Wymaga uwagi”, a zależne elementy (wpisy, komentarze) przechodzą do nowego zlecenia przed wysłaniem (jedna operacja atomowa kolejki: błąd nic nie zmienia); zlecenie otwiera się z odznaką „Oczekuje na numer”.

**AC3 — Tryb ukrytych danych**
- Zakładając tryb ukrytych danych
- Gdy widzę grupę odrzuconego zlecenia
- Wtedy „Utwórz ponownie” jest niedostępne z widocznym powodem („Zaloguj się ponownie, aby poprawić dane.”), a „Usuń z telefonu” działa.

## Poza zakresem
Edycja zlecenia po utworzeniu, automatyczne ponawianie bez udziału technika.

## Decyzje i ograniczenia
- Automatyczne przeniesienie zależnych elementów — decyzja 13 planu M2 (rekomendacja „Tak, automatycznie”, `sync-core` już to robi w operacji `recreate`) — do potwierdzenia przez Konrada razem z akceptacją.
- Do czasu tej historyjki akcja „Utwórz ponownie” w Kolejce wysyła ponownie te same dane (nic nie ginie; przy `validation_failed` zlecenie zostanie odrzucone ponownie).

## Dziennik
- 2026-11-13 — utworzono jako podział EVM-106 (product-owner)
