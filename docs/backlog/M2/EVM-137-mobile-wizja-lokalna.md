---
id: EVM-137
title: "Aplikacja: wizja lokalna — zakładanie samym adresem offline, zdjęcia i filmy, oznaczenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # dane osobowe na urządzeniu, praca offline, kolejka plików
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer, security-engineer]
model: sonnet
depends_on: [EVM-135, EVM-106, EVM-108, EVM-110]
---

# EVM-137: Aplikacja — wizja lokalna

## Cel
Jako **technik (Edytor)** chcę **na oględzinach jednym ruchem założyć „Wizję lokalną” — wpisując sam adres — i od razu robić zdjęcia i filmy, także bez zasięgu**, aby **dokumentacja z oględzin była w systemie, zanim klient cokolwiek zamówi**. Zasady wspólne z szybkim zleceniem (EVM-106) i kamerą (EVM-108/110); makiety do uzupełnienia: [`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md) (M-10), M-05, M-06.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w stanie „Wycena”; klient dopiero przy „Zaakceptowane” (biuro). 2. Zwykły numer od razu (przed synchronizacją „Oczekuje na numer”).
3. Wygasanie 90 / 14 dni (widoczne w aplikacji, EVM-139/140). 4. Jedno opcjonalne pole „telefon zamawiającego”.
5. Zakłada technik w aplikacji (także offline). 6. Oferta poza zakresem. 7. EVM-133 → wizja → EVM-112 → EVM-111.

## Kryteria akceptacji
Role: aplikacja dla Administratora i Edytora; Tylko odczyt nie loguje się do aplikacji (`channel_not_allowed`).

**AC1 — Wejście i formularz „Wizja lokalna”**
- Zakładając zalogowanego Edytora lub Administratora, włączoną funkcję i odblokowane dane
- Gdy dotykam „Dodaj” na liście zleceń
- Wtedy „Wizja lokalna” jest pierwszą akcją (przed „Nowe zlecenie”), a formularz ma tylko adres (miejscowość, ulica i numer — wymagane) i opcjonalny „Telefon zamawiającego” z podpowiedzią „Tylko numer — imion i nazwisk nie wpisuj”; bez klienta, szablonu i tytułu; walidacja pól jak w EVM-106; gdy funkcja jest wyłączona na serwerze, akcji nie ma.

**AC2 — Zapis offline i numer**
- Zakładając brak sieci
- Gdy zapisuję wizję
- Wtedy trafia do kolejki, pojawia się na liście i w szczegółach jako „Wizja lokalna — Oczekuje na numer” i można od razu robić zdjęcia i filmy; po synchronizacji dostaje numer `ZL-…` bez duplikatu także po wymuszonym zamknięciu aplikacji.

**AC3 — Zdjęcia i filmy**
- Zakładając wizję (także jeszcze bez numeru)
- Gdy otwieram aparat ze szczegółów wizji
- Wtedy kamera działa jak dziś (EVM-108/110: kolejka plików, filmy bez dźwięku, „filmy tylko przez Wi-Fi”), a domyślna kategoria to „Oględziny”; pliki czekają za utworzeniem wizji i wysyłają się po numerze.

**AC4 — Oznaczenie i prywatność w liście**
- Zakładając wizje i zwykłe zlecenia
- Gdy przeglądam listę, szczegóły i kolejkę
- Wtedy wizja ma odznakę „Wizja lokalna”, wiersz pokazuje numer (lub „Oczekuje na numer”), datę założenia i „Wygasa za N dni”, **bez adresu**; adres, telefon zamawiającego i informacja „Brak klienta — uzupełni biuro” są tylko w szczegółach; adresu nie ma w tytułach, powiadomieniach, logach urządzenia ani komunikatach błędów.

**AC5 — Tryb ukrytych danych i blokada**
- Zakładając aplikację w trybie ukrytych danych (EVM-101: po 7 dniach bez synchronizacji / po blokadzie)
- Gdy próbuję założyć wizję albo otworzyć jej szczegóły
- Wtedy formularz jest niedostępny z komunikatem jak dla szybkiego zlecenia, wiersze Kolejki są bez adresu, a robienie zdjęć do już istniejącej wizji nadal działa; test E2E Android (Maestro).

**AC6 — Odrzucenie przez serwer i usunięcie wizji**
- Zakładając wizję odrzuconą przez serwer (`validation_failed`, `id_conflict`, `feature_disabled`, `sync_quota_exceeded`) albo usuniętą automatycznie
- Gdy telefon to odczyta
- Wtedy element trafia do „Wymaga uwagi” z powodem po polsku (bez adresu) i akcją „Usuń z telefonu”, wizja znika z listy, a pliki w kolejce do usuniętej wizji dostają status „odrzucony” z kodem i nie ponawiają się bez końca.

**AC7 — Wizja po przypisaniu klienta**
- Zakładając wizję, której biuro przypisało klienta
- Gdy telefon się zsynchronizuje
- Wtedy odznaka znika, klient widoczny jak w zwykłym zleceniu, a zdjęcia i wpisy zostają w tym samym zleceniu.

## Poza zakresem
Wybór istniejącej lokalizacji na telefonie (wizja zawsze z nową lokalizacją — dopasowanie w panelu); notatka, tytuł i dane klienta; edycja wizji z telefonu; odrzucenie, przypisanie klienta, przedłużenie z aplikacji (panel); „Utwórz ponownie” odrzuconej wizji (zwykły „Usuń z telefonu” i nowa wizja); termin wizyty; przypomnienia push.

## Decyzje i ograniczenia
- **Bezpieczeństwo:** W5, W8 (podpowiedź przy telefonie i wpisach — dla komentarzy w szczegółach wizji ostrzeżenie „Nie wpisuj imion ani telefonów”), W9, W10; przegląd SR-MOB-08.
- Nazwa w interfejsie — patrz pytanie 1.
- **Pytania do Konrada:**
  1. Nazwa w interfejsie: „Wizja lokalna” (rekomendacja — zgodna z decyzjami; „Oględziny” zostaje nazwą kategorii zdjęć) czy „Oględziny”? Konsekwencja: zmiana nazwy po wdrożeniu dotyka tekstów, instrukcji i karty informacyjnej.
  2. Adres w wierszu listy? Rekomendacja: nie (wymóg security: adres tylko w szczegółach); koszt: technik z kilkoma wizjami rozróżnia je po godzinie i numerze — po teście terenowym można poluzować do skrótu „miejscowość”.
- **Konsultacje przed `ready`:** UX (przepływ: M-05 „Dodaj”, formularz wizji, szczegóły z oznaczeniem, tryb ukrytych danych; uzupełnienie `10-…`), security (W5/W9/W10), architekt (kontrakt wersji 2 komendy, stan funkcji w aplikacji — po ADR-0024).

## Dziennik
- 2026-11-16 — szkic (product-owner)
