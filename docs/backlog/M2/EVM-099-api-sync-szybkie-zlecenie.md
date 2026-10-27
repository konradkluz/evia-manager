---
id: EVM-099
title: "API: wysyłanie szybkiego zlecenia (CreateQuickWorkOrder)"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: draft
priority: P1
path: pelna             # synchronizacja offline, dane osobowe
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-098]
---

# EVM-099: API — szybkie zlecenie z telefonu (`CreateQuickWorkOrder`)

## Cel
Jako **technik** chcę **założyć zlecenie z telefonu (klient + adres + szablon) także bez zasięgu**, aby **zacząć dokumentację od razu na miejscu**, a **biuro** chce **je uzupełnić**. Komenda z [`offline-sync.md`](../../architecture/offline-sync.md); scenariusz A1′.

## Kryteria akceptacji

**AC1 — Utworzenie zlecenia**
- Zakładając Edytora i aktywny szablon
- Gdy przychodzi `CreateQuickWorkOrder` z `workOrderId` oraz istniejącym klientem i lokalizacją albo `newCustomer` / `newSite` (identyfikatory z telefonu)
- Wtedy w jednej transakcji powstaje zlecenie z kompozycją wg szablonu (i nowy klient i lokalizacja), numer nadaje serwer, a wynik zawiera numer; `newCustomer` przyjmuje tylko rodzaj, nazwę i telefon (bez e-maila i NIP), a twórca-urządzenie jest zapisane (`created_via_device_id`).

**AC2 — Tylko INSERT**
- Zakładając istniejący identyfikator zlecenia, klienta lub lokalizacji (także cudzy)
- Gdy komenda dociera
- Wtedy `rejected: id_conflict` bez żadnej zmiany (także w pozostałych identyfikatorach komendy).

**AC3 — Szablon i walidacja**
- Zakładając szablon nieaktywny, brak wymaganych pól lub zły format telefonu
- Gdy komenda dociera
- Wtedy `rejected: template_unavailable` / `validation_failed` bez częściowych zapisów.

**AC4 — Idempotencja i zależności**
- Zakładając powtórkę komendy lub wpisy czekające na to zlecenie
- Gdy dociera ponownie
- Wtedy `duplicate`, a mutacje zależne (wpisy, komentarze) są przyjmowane dopiero po `applied`.

**AC5 — Oznaczenie w panelu**
- Zakładając zlecenie założone z telefonu
- Gdy biuro je otwiera
- Wtedy widzi baner „Zlecenie założone w terenie” z listą pól do uzupełnienia (W-09), znikający po uzupełnieniu.

**AC6 — Uprawnienia**
- Zakładając role
- Gdy wysyłają komendę
- Wtedy Administrator i Edytor tak; Tylko odczyt `403`; niezalogowany `401`; urządzenie do wyczyszczenia `401 device_wipe_required`; test macierzy obejmuje przypadek IDOR (cudze `workOrderId`, `siteId`, `customerId`).

## Poza zakresem
Podpowiedź duplikatów klientów po stronie biura i deduplikacja na serwerze (scalanie — poza v1), media do nowego zlecenia (E11).

## Decyzje i ograniczenia
- Serwer nie odrzuca „podobnych” klientów (wyszukiwanie lokalne w EVM-106; README planu, decyzja 15).
- Bezpieczeństwo i prywatność: obowiązuje limit nowych klientów na urządzenie na dobę z alertem po przekroczeniu (minimalizacja danych, AB-13).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
