---
id: EVM-138
title: "Panel: wizja lokalna — lista i filtr, założenie w biurze, „Przypisz klienta”, odrzucenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # zmiana statusu i danych zlecenia, nowa reguła widoczna dla użytkownika
owner: web-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-135, EVM-136]
---

# EVM-138: Panel — wizja lokalna

## Cel
Jako **pracownik biura (Administrator, Edytor)** chcę **widzieć wizje lokalne, zakładać je ze zgłoszenia i — po akceptacji oferty — przypisać klienta (istniejącego lub nowego) albo wizję odrzucić**, aby **dokumentacja z oględzin przechodziła w zwykłe zlecenie bez przepisywania**. Ekrany: W-10 (lista), W-05 (nowe zlecenie), W-06 (szczegóły) — [`docs/ux/flows/`](../../ux/flows/README.md).

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w stanie „Wycena”; klient wymagany dopiero przy „Zaakceptowane”; bez osobnego bytu. 2. Zwykły numer zlecenia od razu.
3. Wygasanie: 90 dni (przedłużenie A/E), odrzucona 14 dni (EVM-139, EVM-140). 4. Jedno opcjonalne pole „telefon zamawiającego”.
5. Zakłada technik i biuro w panelu. 6. Oferta poza zakresem. 7. EVM-133 → wizja → EVM-112 → EVM-111.

## Kryteria akceptacji
Role: Administrator i Edytor — pełne działanie; Tylko odczyt — wizje niewidoczne (decyzja w pytaniu 1); niezalogowany — logowanie.

**AC1 — Lista i filtr**
- Zakładając wizje i zwykłe zlecenia
- Gdy otwieram listę zleceń i wybieram filtr „Wizje lokalne”
- Wtedy widzę tylko wizje (numer, odznaka „Wizja lokalna”, „Wygasa za N dni” / „Usunięcie za N dni”, data), a w widoku podstawowym wizje mają odznakę i „Brak klienta”; stan pusty: „Brak wizji lokalnych”; ładowanie i błąd jak w reszcie listy; wyszukiwanie po adresie znajduje wizję.

**AC2 — Założenie wizji w biurze**
- Zakładając Edytora lub Administratora i włączoną funkcję
- Gdy w „Nowe zlecenie” wybieram „Wizja lokalna”
- Wtedy formularz pyta tylko o lokalizację (istniejąca z podpowiedzią lub nowa), opcjonalny „Telefon zamawiającego” (z podpowiedzią „Tylko numer — nie wpisuj imion w opisach”) i opiekuna; nie wymaga klienta ani szablonu; po zapisie widzę wizję ze zwykłym numerem; Tylko odczyt nie widzi akcji, a wyłączona funkcja chowa wybór „Wizja lokalna”.

**AC3 — Szczegóły wizji i „Przypisz klienta”**
- Zakładając wizję w „Wycena”
- Gdy otwieram jej szczegóły
- Wtedy widzę baner „Wizja lokalna — brak klienta. Przypisz klienta przy akceptacji oferty” z akcją „Przypisz klienta” i datą wygaśnięcia, telefon zamawiającego oraz media i wpisy jak w zwykłym zleceniu; „Przypisz klienta” otwiera wybór istniejącego klienta albo dodanie nowego (dialog klienta jak w W-05); po zapisie baner znika, klient jest widoczny, numer i media bez zmian; błąd serwera i konflikt wersji pokazują komunikat z możliwością ponowienia.

**AC4 — Reguła akceptacji w interfejsie**
- Zakładając wizję bez klienta
- Gdy wybieram status „Zaakceptowane”
- Wtedy interfejs nie wykonuje zmiany, pokazuje „Aby zaakceptować, przypisz klienta” i prowadzi do „Przypisz klienta”; po przypisaniu mogę zaakceptować; przy `409 customer_required` z serwera widzę ten sam komunikat; akcje wymagające klienta (płatności, dokumenty, eksport) są wyłączone z podpowiedzią.

**AC5 — Odrzucenie wizji**
- Zakładając wizję
- Gdy wybieram „Odrzuć wizję” i wskazuję powód („Oferta odrzucona” / „Rezygnacja klienta”)
- Wtedy dialog uprzedza „Wizja zostanie trwale usunięta po 14 dniach”, zlecenie dostaje status „Anulowane” z odznaką „Odrzucona” i datą usunięcia, a Administrator ma akcję „Przywróć” w ciągu tych 14 dni; Edytor nie ma akcji przywrócenia.

**AC6 — Dostęp**
- Zakładając Tylko odczyt, Edytora i Administratora
- Gdy wchodzę bezpośrednio na adres wizji albo używam filtra
- Wtedy Tylko odczyt dostaje „nie znaleziono” (jak w innych niedostępnych zasobach), Edytor i Administrator widzą wizję; testy Playwright obejmują role i cztery stany (pusty, ładowanie, błąd, brak uprawnień), nawigację klawiaturą i czytnik ekranu dla odznak.

## Poza zakresem
Przedłużenie wygasania i przypomnienia (EVM-140), tabela „wizje starzejące się” i licznik (EVM-140), oferta, CRM, scalanie wizji z istniejącym zleceniem, „Zastosuj szablon do istniejącego zlecenia” (kandydat do backlogu, jeśli ręczne dodawanie pozycji okaże się uciążliwe), edycja telefonu zamawiającego (decyzja przy refine; rekomendacja: edycja w panelu przez Edytora i Administratora).

## Decyzje i ograniczenia
- Nazwa „Wizja lokalna” — pytanie 1 w EVM-137 (jedna decyzja dla aplikacji i panelu).
- **Bezpieczeństwo:** adres w widoku listy tylko w kolumnie lokalizacji zleceń, jak dziś; brak adresu w tytułach i powiadomieniach (W5).
- **Pytania do Konrada:**
  1. Czy Tylko odczyt widzi wizje w panelu? Rekomendacja: nie (jak w EVM-135 pyt. 1).
  2. Czy odrzucenie wizji wymaga drugiego potwierdzenia (Administrator)? Rekomendacja: nie — jak zwykłe anulowanie; usunięcie następuje po 14 dniach i da się cofnąć.
- **Konsultacje przed `ready`:** UX (przepływ listy, banera, dialogów, komunikatów reguły; makiety W-10/W-05/W-06), architekt niepotrzebny po EVM-136.

## Dziennik
- 2026-11-16 — szkic (product-owner)
