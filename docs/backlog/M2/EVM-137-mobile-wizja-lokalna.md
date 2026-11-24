---
id: EVM-137
title: "Aplikacja: wizja lokalna — zakładanie samym adresem offline, zdjęcia i filmy, oznaczenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: done
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
- **Rozstrzygnięcia Tech Leada z delegacji (do potwierdzenia przy demo):**
  1. **AC1 — pole „Kod pocztowy” wymagane w formularzu** (AC wymienia miejscowość, ulicę, numer): kontrakt nowej lokalizacji i model lokalizacji wymagają kodu, jak w szybkim zleceniu; typ obiektu aplikacja ustawia na „Inny obiekt”. Alternatywa (kod opcjonalny dla wizji) = zmiana kontraktu i modelu — ocenić po teście terenowym EVM-112.
  2. **AC6 — kod `quota_exceeded`** zamiast `sync_quota_exceeded`; komunikat limitu wizji (tekst z AC4 EVM-140) jest w zasobach, ale do czasu EVM-140 telefon pokaże powód ogólny. Przegląd UX rekomenduje wariant telefonu „Poproś biuro…” — **decyzja Konrada** (zmiana tekstu z AC EVM-140).
  3. **AC6 — odrzucona, niewysłana wizja zostaje na liście** ze znacznikiem „Wymaga uwagi” do „Usuń z telefonu” (nic nie znika bez działania technika).
  4. Szkic formularza tylko w pamięci ekranu (jak szybkie zlecenie); telefon zamawiającego pokazywany jak wpisany do czasu synchronizacji; tryb ukrytych danych: wizja na liście jak zwykłe zlecenie.
  5. **Zmiany dotykające zwykłych zleceń (do oceny przy demo):** Kolejka nie pokazuje osobno komend wysyłania plików — plik ma jeden wiersz; odrzucone zdjęcie można tylko usunąć z telefonu (z potwierdzeniem), bez „Dodaj do innego zlecenia”; „Usuń z telefonu” grupy usuwa też pliki z dysku (naprawa osieroconych plików); domyślna ikona komunikatu informacyjnego to „info” (przekreślone Wi-Fi zostało w trzech komunikatach o sieci).
- **Minor / nit z przeglądów — zostają:** odczyt znaczników „to była wizja” z pustym wynikiem przy błędzie (ochrona przed przeniesieniem do innego zlecenia wtedy nie działa); `forgetFiles` bez czekania; zakaz przenoszenia „do wizji” tylko w interfejsie (`retarget` nie sprawdza celu); znaczniki wizji zostają po przypisaniu klienta; termin oczekującej wizji liczony w milisekundach, a na liście w dniach kalendarzowych (przy zmianie czasu możliwe „Wygasa za 89 dni”); kontrola logu urządzenia w scenariuszach szuka krótkich ciągów cyfr; format telefonu bez odstępów (dotyczy całej aplikacji); komenda pliku jako „Element” w „Wysłano w tej sesji”; `Trash2` w używanej wersji ikon to ten sam glif co `Trash`; odrzucone SZYBKIE zlecenie nadal pokazuje „Oczekuje na numer” (poza zakresem); brak testu filmów przy wizji (ta sama ścieżka co zdjęcia); 200% czcionki sprawdzane tylko z kodu.

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-16 — start realizacji w kolejce `/noc-2026-11-16` (tor B, klon n1, na commicie kontraktu EVM-135 `84766fbf`; makiety: przepływ 17); **status `in-progress`** (Tech Lead)
- 2026-11-17 — implementacja etapami (mobile-developer): rdzeń `f24b752a`, formularz i szczegóły `ac811551`, lista i kolejka `4a59c5a0`, scenariusze i przepływy Maestro 110–116 `399771c5`; poprawki po emulatorze `ff84775e` (licznik „Wymaga uwagi”, ikona komunikatu informacyjnego); poprawki przepływów przez orkiestratora `6eda4b90`, `5bad4b95`, `c87a4f91`
- 2026-11-17 — QA (`qa-engineer`): **PASS z uwagami**, raport `docs/qa/EVM-137/raport-qa.md`; przeglądy: security-engineer **APPROVE z uwagami** (W5, W8, W9, W10 spełnione); code-reviewer **APPROVE z uwagami** z jednym major (odczyt kolejki przy każdym zdarzeniu postępu) — poprawione `b0ce2ad2`, ponowny przegląd **APPROVE z uwagami**; ux-designer **REQUEST CHANGES** z dwoma major (ikona „Odrzucona”, znacznik odrzuconej wizji na liście) — poprawione `bc40eeac`
- 2026-11-17 — bramka lokalna na gałęzi zintegrowanej (`bc40eeac` + dokumenty): `pnpm run gate` 68/68 zadań, pokrycie zmienionego kodu zielone, `npm run test:tools`, `npm run docs:check` (0 błędów), `pnpm run gate:deploy` — kody wyjścia 0; pełna integracja API, E2E Linux i skany — w CI PR-u (zasada z 2026-11-17). Emulator: scenariusze wizji 110–116 — 18/18 na `b0ce2ad2`; powtórka po poprawkach UX i regresja — wynik w opisie PR. **Status `in-review`** — PR wspólny dla EVM-135…138 i EVM-141; demo i akceptacja Konrada po scaleniu (Tech Lead)
- 2026-11-24 — zaakceptowane przez Konrada (kod scalony w main); status `done`
