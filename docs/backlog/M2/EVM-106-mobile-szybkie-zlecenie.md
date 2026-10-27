---
id: EVM-106
title: "Aplikacja: szybkie zlecenie z telefonu"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: draft
priority: P1
path: pelna             # synchronizacja offline, dane osobowe
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-099, EVM-103, EVM-107]
---

# EVM-106: Aplikacja — szybkie zlecenie z telefonu

## Cel
Jako **technik** chcę **założyć zlecenie na miejscu (klient + adres + szablon) także bez zasięgu**, aby **od razu je dokumentować**, a biuro uzupełni resztę. Makieta M-10 ([`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md)).

## Kryteria akceptacji

**AC1 — Utworzenie offline**
- Zakładając brak sieci i zsynchronizowane szablony
- Gdy wybieram szablon, klienta (istniejącego lub nowego: rodzaj, nazwa, telefon) i lokalizację (istniejącą lub nowy adres)
- Wtedy zlecenie powstaje lokalnie z odznaką „Oczekuje na numer” (bez wymyślonego numeru lokalnego), stoi na górze listy i jest od razu otwieralne; do niego mogę dodawać wpisy; w Kolejce widać je z licznikiem zależnych elementów, a po 24 h bez numeru pojawia się baner z czasem utworzenia.

**AC2 — Walidacja i duplikaty**
- Zakładając wpisywanie nowego klienta
- Gdy telefon (znormalizowany do E.164) lub nazwa (bez polskich znaków) pasuje do istniejącego klienta (lokalne wyszukiwanie przed utworzeniem)
- Wtedy aplikacja podpowiada istniejących klientów, a nowy klient ma tylko rodzaj, nazwę i telefon; błędne pola są oznaczone przy polu; serwer niczego nie deduplikuje, a klient założony w terenie jest oznaczony w panelu (EVM-099 AC5).

**AC3 — Synchronizacja**
- Zakładając zlecenie utworzone offline
- Gdy wraca sieć
- Wtedy trafia na serwer raz i dostaje numer; przed wysłaniem przeżywa resync i zabicie aplikacji (scenariusz 2).

**AC4 — Odrzucenie**
- Zakładając `id_conflict`, `template_unavailable` lub `validation_failed`
- Gdy serwer odrzuca
- Wtedy zlecenie i powiązane wpisy trafiają do „Wymaga uwagi” jako jedna grupa (zlecenie + liczba zależnych elementów) z powodem prostymi słowami i akcjami „Utwórz ponownie” (formularz z zachowanymi danymi, nowy identyfikator; zależne elementy przenoszą się do nowego zlecenia) oraz oddzielnie „Usuń z telefonu” (dialog z liczbą zależnych).

## Poza zakresem
Edycja zlecenia po utworzeniu, scalanie klientów w biurze i deduplikacja na serwerze, zdjęcia do nowego zlecenia (E11).

## Decyzje i ograniczenia
- UX / UI: „Oczekuje na numer”, grupa odrzuconego zlecenia, „Utwórz ponownie” — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-07, M-10). Automatyczne przeniesienie zależnych elementów to rekomendacja czekająca na zgodę Konrada (README planu, decyzja 13); `sync-core` musi dopuszczać ponowne wskazanie celu nowymi komendami.
- Bezpieczeństwo i prywatność: dane nowego klienta są niewidoczne w trybie ukrytych danych; „Kopiuj treść” ze schowkiem oznaczonym jako wrażliwy i czyszczonym po 60 s (jak EVM-107).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
