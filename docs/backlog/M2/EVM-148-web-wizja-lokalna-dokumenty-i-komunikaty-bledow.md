---
id: EVM-148
title: "Panel: wgrywanie oferty w wizji lokalnej, ostrzeżenie o danych osobowych i czytelne komunikaty błędów wgrywania"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # formularz z ostrzeżeniem o danych osobowych, uprawnienia ról
owner: web-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-147, EVM-138]   # EVM-147: API przyjmuje ofertę w wizji (po ADR-0025); EVM-138: ekran szczegółów wizji (in-review — DoR wymaga done)
---

# EVM-148: Panel — oferta w wizji lokalnej i komunikaty błędów wgrywania

## Cel
Jako **pracownik biura (Administrator, Edytor)** chcę **dodać ofertę do wizji lokalnej w panelu i rozumieć, dlaczego wgranie się nie udało**, aby **materiały do wyceny były przy wizji, a błąd mówił, co zrobić**. Dziś panel blokuje „Dodaj dokument” w wizji i każde `409` przy wgrywaniu opisuje jako „dokument o tym identyfikatorze już istnieje” (mylące). Zasady i API: EVM-147; klauzula i karta: EVM-149.

## Kryteria akceptacji
Role: Administrator i Edytor — tak; Tylko odczyt wizji nie widzi (`404`); niezalogowany — przekierowanie do logowania. Mobile poza zakresem.

**AC1 — Odblokowanie „Dodaj dokument” w wizji**
- Zakładając szczegóły wizji (W-06/W-09) otwartej wizji i Administratora lub Edytora
- Gdy otwieram sekcję dokumentów
- Wtedy oba przyciski „Dodaj dokument” działają; w wizji odrzuconej lub wygasłej są nieaktywne z podanym powodem; gdy dane wizji nie zostały załadowane (błąd, ładowanie), przycisk jest nieaktywny, a ekran pokazuje błąd z „Ponów” — nie zgaduję, czy wizja ma klienta.

**AC2 — Formularz: tylko zlecenie i tylko oferta, ostrzeżenie**
- Zakładając formularz dodawania dokumentu w wizji bez klienta
- Gdy go otwieram
- Wtedy „Przypisz do” oferuje tylko „Zlecenie” (bez lokalizacji i klienta), rodzaj tylko „Oferta/wycena”, a obok pól tytułu i opisu jest ostrzeżenie: oferta z imieniem i nazwiskiem zamawiającego jest dozwolona, ale bez skanów dokumentów tożsamości i bez imion w tytule i opisie; po przypisaniu klienta formularz jest zwykły (wszystkie rodzaje i kotwice jak dziś).

**AC3 — Stan pusty i podpowiedzi**
- Zakładając wizję bez dokumentów albo przyciski ZIP i płatności w wizji
- Gdy oglądam szczegóły
- Wtedy stan pusty dokumentów mówi, że dokumenty znikną razem z wizją (z datą usunięcia), jeśli klient nie zostanie przypisany; przy ZIP i płatnościach zostaje podpowiedź „po przypisaniu klienta”; `documentsHint` zostaje tylko tam, gdzie dokumenty są nadal zablokowane.

**AC4 — Przyczyny `409` przy wgrywaniu**
- Zakładając wgrywanie dokumentu
- Gdy serwer odpowie `409` z przyczyną `customer_required`, `id_conflict` albo `invalid_state_transition` (sesja przerwana lub wygasła)
- Wtedy każda przyczyna ma własny polski komunikat: `customer_required` — „Najpierw przypisz klienta do tej wizji” (bez „Ponów”, ze wskazówką); `id_conflict` — komunikat o konflikcie identyfikatora (jedyne miejsce, gdzie zostaje obecny tekst); `invalid_state_transition` — „Sesja wgrywania wygasła lub została przerwana” z „Ponów”; komunikat nie zawiera nazwy pliku ani tytułu.

**AC5 — Pozostałe błędy**
- Zakładając wgrywanie dokumentu
- Gdy dostaję `403`, `429`, `5xx` albo brak sieci
- Wtedy komunikat jest prawdziwy i po polsku: `403` — brak uprawnień (bez „Ponów”), `429` — poczekaj i spróbuj ponownie, `5xx` i brak sieci — „Ponów”; wybrany plik i wpisane pola zostają w formularzu.

**AC6 — Dostępność i dokumentacja przepływu**
- Zakładając zmiany z AC1–AC5
- Gdy sprawdzam dostępność i dokumentację UX
- Wtedy ostrzeżenie, komunikaty błędów i nieaktywne przyciski są dostępne dla czytników ekranu i klawiatury (WCAG 2.2 AA), używają tylko komponentów i tokenów ze styleguide'u, a `docs/ux/flows/17-wizja-lokalna.md` opisuje nowy przepływ; `docs/user/instrukcja-dla-biura.md` — wiersz o „dokumentach niedostępnych” zaktualizowany.

## Poza zakresem
Zmiany w API i usuwaniu (EVM-147); klauzula, karta, DPIA (EVM-149); inne rodzaje niż Oferta/wycena (lista rozszerzalna później); aplikacja mobilna; ręczne usuwanie dokumentu odrzuconej wizji; moduł ofert.

## Decyzje i ograniczenia
- Decyzje Konrada 2026-11-20: kotwica tylko „zlecenie”, rodzaj tylko Oferta/wycena, dane zamawiającego w ofercie z ostrzeżeniem w formularzu, bez nowych ról.
- Punkty dotknięte w kodzie (architekt): `documents-section.tsx:91-92`, `document-upload-dialog.tsx:206-208` (`hasSite` pokazałby „Lokalizacja”).
- UX: brzmienie ostrzeżenia i komunikatów ustala `ux-designer` w przeglądzie; ostrzeżenie „nie wpisuj imion” przy tytule i opisie wynika z przeglądu security (Low).
- Realne oferty w produkcji dopiero po EVM-147 i EVM-149.

## Notatki
Błąd komunikatów (AC4, AC5) jest niezależny od API — w razie potrzeby można go wyprzedzić jako osobną drobną poprawkę.

## Dziennik
- 2026-11-20 — utworzono przy podziale EVM-147 na trzy historyjki (product-owner)
