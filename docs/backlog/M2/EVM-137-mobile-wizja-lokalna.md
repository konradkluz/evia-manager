---
id: EVM-137
title: "Aplikacja: wizja lokalna — zakładanie samym adresem offline, zdjęcia i filmy, oznaczenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: ready
priority: P1
path: pelna             # dane osobowe na urządzeniu, praca offline, kolejka plików
owner: mobile-developer
contributors: [ux-designer]   # makiety M-10 / M-05 / M-06 uzupełnia na początku realizacji (jak przy EVM-110)
reviewers: [code-reviewer, ux-designer, security-engineer]
model: sonnet
depends_on: [EVM-135, EVM-106, EVM-108, EVM-110]
---

# EVM-137: Aplikacja — wizja lokalna

## Cel
Jako **technik (Edytor)** chcę **na oględzinach jednym ruchem założyć „Wizję lokalną” — wpisując sam adres — i od razu robić zdjęcia i filmy, także bez zasięgu**, aby **dokumentacja z oględzin była w systemie, zanim klient cokolwiek zamówi**. Zasady wspólne z szybkim zleceniem (EVM-106) i kamerą (EVM-108/110); makiety do uzupełnienia na starcie przez ux-designera: [`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md) (M-10), M-05, M-06.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane” (biuro); bez osobnego bytu. 2. Zwykły numer od razu (do synchronizacji „Oczekuje na numer”). 3. 90 / 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik (także offline) i biuro. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. **Nazwa „Wizja lokalna”** („Oględziny” zostaje kategorią zdjęć). 9. Tylko odczyt bez dostępu; **na telefonie wizję widzi tylko twórca i opiekun** (wizja z panelu bez opiekuna nie jest na żadnym telefonie). 10. **Adres tylko w szczegółach, nie w wierszu listy.** 11. Klient po przypisaniu niezmienny, telefon czyszczony; powody odrzucenia: „Oferta odrzucona”, „Rezygnacja klienta”. 12. Luki w numeracji akceptowane. 13. Wizje na głównej liście z etykietą. 14. Przypomnienie 15 dni przed terminem; przedłużenie tylko w panelu; limit 20 / 100. 15. `enforce` po kopiach. 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu; w teście EVM-112 bez realnych wizji.

## Kryteria akceptacji
Role: aplikacja dla Administratora i Edytora; Tylko odczyt nie loguje się (`channel_not_allowed`).

**AC1 — Wejście i formularz**
- Zakładając zalogowanego Edytora lub Administratora, funkcję włączoną na serwerze i odblokowane dane
- Gdy dotykam „Dodaj” na liście zleceń
- Wtedy „Wizja lokalna” jest pierwszą akcją (przed „Nowe zlecenie”), a formularz ma tylko adres (miejscowość, ulica, numer — wymagane) i opcjonalny „Telefon zamawiającego” z podpowiedzią „Tylko numer — imion i nazwisk nie wpisuj”; bez klienta, szablonu i tytułu (tytuł domyślny); walidacja jak w EVM-106; gdy funkcja jest wyłączona (`feature_disabled`), akcji nie ma.

**AC2 — Zapis offline i numer**
- Zakładając brak sieci
- Gdy zapisuję wizję
- Wtedy powstaje komenda `CreateSiteSurvey` w kolejce, wizja pojawia się na liście i w szczegółach jako „Wizja lokalna — Oczekuje na numer”, można od razu robić zdjęcia i filmy; po synchronizacji dostaje numer `ZL-…` bez duplikatu także po wymuszonym zamknięciu aplikacji.

**AC3 — Zdjęcia i filmy**
- Zakładając wizję (także jeszcze bez numeru)
- Gdy otwieram aparat ze szczegółów wizji
- Wtedy kamera działa jak dziś (EVM-108/110: kolejka plików, filmy bez dźwięku, „filmy tylko przez Wi-Fi”), domyślna kategoria to „Oględziny”, a pliki czekają za utworzeniem wizji i wysyłają się po numerze.

**AC4 — Oznaczenie, lista i prywatność**
- Zakładając wizje i zwykłe zlecenia w replice (wizje tylko twórcy i opiekuna)
- Gdy przeglądam listę, szczegóły i Kolejkę
- Wtedy wizja jest na głównej liście z odznaką „Wizja lokalna”, numerem (lub „Oczekuje na numer”), datą i „Wygasa za N dni”, **bez adresu**; jest chip „Wizje lokalne” zawężający listę; adres, telefon zamawiającego i „Brak klienta — uzupełni biuro” są tylko w szczegółach; adresu nie ma w tytułach, powiadomieniach, logach urządzenia i komunikatach błędów.

**AC5 — Tryb ukrytych danych**
- Zakładając aplikację w trybie ukrytych danych (EVM-101)
- Gdy próbuję założyć wizję lub otworzyć jej szczegóły
- Wtedy formularz jest niedostępny z komunikatem jak dla szybkiego zlecenia, Kolejka jest bez adresu, a robienie zdjęć do istniejącej wizji nadal działa; test E2E Android (Maestro).

**AC6 — Odrzucenie przez serwer i usunięcie wizji**
- Zakładając wizję odrzuconą przez serwer (`validation_failed`, `id_conflict`, `feature_disabled`, `sync_quota_exceeded`, `site_survey_limit_exceeded`) albo usuniętą (`target_unavailable`)
- Gdy telefon to odczyta
- Wtedy element trafia do „Wymaga uwagi” z powodem po polsku (bez adresu) i akcją „Usuń z telefonu”, wizja znika z listy, a pliki i mutacje do usuniętej wizji dostają status „odrzucony” i nie ponawiają się bez końca.

**AC7 — Po przypisaniu klienta**
- Zakładając wizję, której biuro przypisało klienta
- Gdy telefon się zsynchronizuje
- Wtedy odznaka i „Wygasa za…” znikają, klient jest widoczny jak w zwykłym zleceniu, a zdjęcia i wpisy zostają w tym samym zleceniu.

## Poza zakresem
Wybór istniejącej lokalizacji na telefonie (dopasowanie w panelu); własny tytuł, notatka, dane klienta; edycja wizji z telefonu; odrzucenie, przypisanie klienta i przedłużenie z aplikacji (panel); „Utwórz ponownie” odrzuconej wizji (zwykłe „Usuń z telefonu” i nowa wizja); termin wizyty; push.

## Decyzje i ograniczenia
- Bezpieczeństwo: W5, W8 (podpowiedź przy telefonie i przy komentarzach wizji: „Nie wpisuj imion ani telefonów”), W9, W10; SR-MOB-08. Kontrakt: ADR-0024 pkt 5 (`CreateSiteSurvey` v1; w `sync-core` ta sama semantyka `orderingKey`); stan flagi odczytywany z serwera.
- Rozstrzygnięcie Tech Leada z delegacji, do potwierdzenia przy demo: chip „Wizje lokalne” w M-05 (odstępstwo od układu chipów, wpis w changelogu styleguide'u zgodnie z decyzją 12 planu M2).

## Notatki
Rozmiar wg ADR-0024: M (równolegle z EVM-136 i EVM-140). Testy Maestro: przepływy w zakresie numerów uzgodnionym z orkiestratorem.

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
