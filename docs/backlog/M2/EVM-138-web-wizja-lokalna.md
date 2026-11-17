---
id: EVM-138
title: "Panel: wizja lokalna — lista i filtry, założenie, „Przypisz klienta”, odrzucenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-progress
priority: P1
path: pelna             # zmiana statusu i danych zlecenia, nowa reguła widoczna dla użytkownika
owner: web-developer
contributors: [ux-designer]   # makiety W-10 / W-05 / W-06 uzupełnia na początku realizacji (jak przy EVM-110)
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-135, EVM-136]
---

# EVM-138: Panel — wizja lokalna

## Cel
Jako **pracownik biura (Administrator, Edytor)** chcę **widzieć wizje lokalne, zakładać je ze zgłoszenia i — po akceptacji oferty — przypisać klienta (istniejącego lub nowego) albo wizję odrzucić**, aby **dokumentacja z oględzin przechodziła w zwykłe zlecenie bez przepisywania**. Ekrany: W-10 (lista), W-05 (nowe zlecenie), W-06 (szczegóły) — [`docs/ux/flows/`](../../ux/flows/README.md).

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”; bez osobnego bytu. 2. Zwykły numer od razu. 3. 90 dni (przedłużenie A/E), odrzucona 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro w panelu. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. **Tylko odczyt nie widzi wizji.** 10. Adres tylko w szczegółach (w liście — jak dotąd kolumna lokalizacji zleceń). 11. **Klient po przypisaniu niezmienny; telefon zamawiającego czyszczony (panel podstawia go do formularza nowego klienta); powody: „Oferta odrzucona”, „Rezygnacja klienta”.** 12. Luki w numeracji akceptowane. 13. **Wizje na głównej liście z etykietą „Wizja lokalna”.** 14. Przypomnienie e-mailem 15 dni przed terminem; **przedłużenie tylko w panelu, najwyżej 2 razy (do 270 dni) — EVM-140**; limit 20 / 100. 15. `enforce` po kopiach. 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu.

## Kryteria akceptacji
Role: Administrator i Edytor — pełne działanie; Tylko odczyt — wizje niewidoczne; niezalogowany — logowanie.

**AC1 — Lista, etykieta i filtry**
- Zakładając wizje i zwykłe zlecenia
- Gdy otwieram listę zleceń
- Wtedy wizje są na liście z odznaką „Wizja lokalna”, „Brak klienta” i „Wygasa za N dni” (anulowana: „Usunięcie za N dni”); filtry „Tylko wizje”, „Bez wizji” i „Wygasające” (sortowanie po terminie, licznik „do rozstrzygnięcia”, ≤ 15 dni) działają; stan pusty „Brak wizji lokalnych”; ładowanie i błąd jak w reszcie listy; wyszukiwanie po adresie znajduje wizję.

**AC2 — Założenie wizji w biurze**
- Zakładając Edytora lub Administratora i włączoną funkcję
- Gdy w „Nowe zlecenie” wybieram „Wizja lokalna”
- Wtedy formularz pyta tylko o lokalizację (istniejąca z podpowiedzią lub nowa), opcjonalny „Telefon zamawiającego” (z podpowiedzią „Tylko numer — nie wpisuj imion w opisach”) i opiekuna (bez opiekuna wizja nie jest na żadnym telefonie — podpowiedź); zapis woła `POST /site-surveys`; po zapisie widzę wizję ze zwykłym numerem; wyłączona funkcja chowa wybór.

**AC3 — Szczegóły i „Przypisz klienta”**
- Zakładając wizję
- Gdy otwieram szczegóły
- Wtedy widzę baner „Wizja lokalna — brak klienta” z datą wygaśnięcia i akcją „Przypisz klienta”, telefon zamawiającego oraz media i wpisy jak w zwykłym zleceniu; akcja otwiera wybór istniejącego klienta albo dodanie nowego (telefon zamawiającego podstawiony do formularza); po zapisie baner znika, klient jest widoczny, numer i media bez zmian; konflikt wersji i błąd serwera mają komunikat i ponowienie.

**AC4 — Reguła akceptacji w interfejsie**
- Zakładając wizję bez klienta
- Gdy wybieram „Zaakceptowane”
- Wtedy interfejs pokazuje „Aby zaakceptować, przypisz klienta” i prowadzi do „Przypisz klienta”; `409 customer_required` z serwera daje ten sam komunikat; płatności, dokumenty i eksport ZIP są wyłączone z podpowiedzią.

**AC5 — Odrzucenie i przywrócenie**
- Zakładając wizję
- Gdy wybieram „Odrzuć wizję” i powód („Oferta odrzucona” / „Rezygnacja klienta”)
- Wtedy dialog uprzedza „Wizja zostanie trwale usunięta po 14 dniach”, zlecenie jest „Anulowane” z odznaką „Odrzucona” i datą usunięcia; Administrator ma „Przywróć” (z ponownym uwierzytelnieniem), Edytor nie.

**AC6 — Dostęp i stany**
- Zakładając Tylko odczyt, Edytora i Administratora
- Gdy wchodzę na adres wizji albo używam filtrów
- Wtedy Tylko odczyt dostaje „nie znaleziono”, A i E widzą wizję; testy Playwright obejmują role i stany (pusty, ładowanie, błąd, brak uprawnień), klawiaturę i czytnik ekranu dla odznak.

## Poza zakresem
Oferta, CRM, scalanie wizji z istniejącym zleceniem, „Zastosuj szablon do istniejącego zlecenia” (kandydat do backlogu), zmiana klienta po przypisaniu, przedłużenie z aplikacji, raport konwersji; przedłużenie (EVM-140).

## Decyzje i ograniczenia
- Adres tylko w kolumnie lokalizacji i szczegółach; brak adresu w tytułach i powiadomieniach (W5).
- Rozstrzygnięcia Tech Leada z delegacji, do potwierdzenia przy demo: edycja telefonu zamawiającego w panelu przez Edytora i Administratora (decyzja przy refine w UX — rekomendacja: tak, jeśli mały koszt; w przeciwnym razie poza zakresem); brak drugiego potwierdzenia przy odrzuceniu (jak zwykłe anulowanie).
- Przedłużenie w panelu (dialog, powody, limit) realizuje EVM-140 na ekranie szczegółów z tej historyjki; tu tylko filtr „Wygasające” i data wygaśnięcia (dane z EVM-135). Odstępstwo od grafu ADR-0024 (tam 140 równolegle z 136/137): część panelowa 140 wymaga EVM-138, więc 140 idzie po niej — zgodnie z podziałem PR (PR 1: 135–138 + 141, PR 2: 139–140).

## Notatki
Rozmiar wg ADR-0024: M.

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-17 — start realizacji w kolejce `/noc-2026-11-16` (tor C, klon n2, po scaleniu toru B: `POST /site-surveys` z EVM-135 i `PUT …/customer`, odrzucenie, przywrócenie z EVM-136); **status `in-progress`** (Tech Lead)
