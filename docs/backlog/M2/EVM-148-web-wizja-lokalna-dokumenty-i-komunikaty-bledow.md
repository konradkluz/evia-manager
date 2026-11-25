---
id: EVM-148
title: "Panel: wgrywanie oferty w wizji lokalnej, ostrzeżenie o danych osobowych i czytelne komunikaty błędów wgrywania"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: done
priority: P1
path: pelna             # formularz z ostrzeżeniem o danych osobowych, uprawnienia ról
owner: web-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-147, EVM-138]   # oba done (EVM-147 scalone w #167, EVM-138 zaakceptowane 2026-11-24); decyzja: ADR-0025
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
- Wtedy „Przypisz do” oferuje tylko „Zlecenie” (bez lokalizacji i klienta), rodzaj tylko „Oferta/wycena”, a obok pól tytułu i opisu jest ostrzeżenie: oferta z imieniem i nazwiskiem zamawiającego jest dozwolona, ale bez skanów dokumentów tożsamości i bez imion w tytule i opisie; w wizji pola „Przypisz do” i „Rodzaj” są tekstem tylko do odczytu („Zlecenie”, „Oferta/wycena”; kod rodzaju stały `quote`), a pola „Podnieś klasę poufności” i „Etap” są ukryte (API: `400 requires_customer` dla `/confidentialityOverride`; wizja nie ma etapów); po przypisaniu klienta formularz jest zwykły (wszystkie rodzaje i kotwice jak dziś).

**AC3 — Stan pusty i podpowiedzi**
- Zakładając wizję bez dokumentów albo przyciski ZIP i płatności w wizji
- Gdy oglądam szczegóły
- Wtedy stan pusty dokumentów mówi, że dokumenty znikną razem z wizją (z datą usunięcia), jeśli klient nie zostanie przypisany; przy ZIP i płatnościach zostaje podpowiedź „po przypisaniu klienta”; `documentsHint` zostaje tylko tam, gdzie dokumenty są nadal zablokowane; przy niepustej liście pod nagłówkiem sekcji stoi stała linia „Dokumenty znikną razem z wizją dnia …” (nie tylko w stanie pustym).

**AC4 — Przyczyny `409` i błąd rodzaju przy wgrywaniu**
- Zakładając wgrywanie dokumentu
- Gdy serwer odpowie `409` z przyczyną `customer_required`, `id_conflict`, `invalid_state_transition` (sesja przerwana lub wygasła) albo `work_order_closed` (wizja odrzucona — tylko do odczytu)
- Wtedy każda przyczyna ma własny polski komunikat: `customer_required` — „Najpierw przypisz klienta do tej wizji” (bez „Ponów”, ze wskazówką); `id_conflict` — komunikat o konflikcie identyfikatora (jedyne miejsce, gdzie zostaje obecny tekst); `invalid_state_transition` — „Sesja wgrywania wygasła lub została przerwana” z „Ponów”; `work_order_closed` — „Ta wizja jest odrzucona i jest tylko do odczytu — dokumentów nie można już dodawać.” (bez „Ponów”, nie „identyfikator już istnieje”); komunikat nie zawiera nazwy pliku ani tytułu.
- Gdy serwer odpowie `400 validation_failed` z błędem pola `/kindCode` i kodem `requires_customer` (ADR-0025 pkt 2; obrona w głębi — formularz oferuje tylko ofertę), komunikat wskazuje pole „Rodzaj” (np. „Przed przypisaniem klienta można dodać tylko ofertę/wycenę”), bez „Ponów”, a nie „Najpierw przypisz klienta”.

**AC5 — Pozostałe błędy**
- Zakładając wgrywanie dokumentu
- Gdy dostaję `403`, `429`, `5xx` albo brak sieci
- Wtedy komunikat jest prawdziwy i po polsku: `403` — brak uprawnień (bez „Ponów”), `429` — poczekaj i spróbuj ponownie, `5xx` i brak sieci — „Ponów”; dane nie giną: przy błędach z „Ponów” plik i pola zostają w pozycji wgrywania; przy pozostałych pozycja zostaje do „Ukryj”, a po `customer_required` i `requires_customer` działa „Dodaj ponownie” z otwartym, wypełnionym formularzem (dialog zamyka się przy zapisie jak dziś).

**AC6 — Dostępność i dokumentacja przepływu**
- Zakładając zmiany z AC1–AC5
- Gdy sprawdzam dostępność i dokumentację UX
- Wtedy ostrzeżenie, komunikaty błędów i nieaktywne przyciski są dostępne dla czytników ekranu i klawiatury (WCAG 2.2 AA), używają tylko komponentów i tokenów ze styleguide'u, a `docs/ux/flows/17-wizja-lokalna.md` opisuje nowy przepływ; `docs/user/instrukcja-dla-biura.md` — wiersz o „dokumentach niedostępnych” zaktualizowany.

## Poza zakresem
Zmiany w API i usuwaniu (EVM-147); klauzula, karta, DPIA (EVM-149); inne rodzaje niż Oferta/wycena (lista rozszerzalna później); aplikacja mobilna; ręczne usuwanie dokumentu odrzuconej wizji; moduł ofert.

## Decyzje i ograniczenia
- **UX / UI (konsultacja ux-designera 2026-11-24, skrót):** ostrzeżenie w `InlineAlert` (ton `info`, ikona + tytuł „Dane osobowe w ofercie”, bez `role`, nad polem „Tytuł”): „Oferta może zawierać imię i nazwisko zamawiającego. Nie dodawaj skanów dokumentów tożsamości i nie wpisuj imion ani nazwisk w tytule i opisie.”; podpowiedź pod „Opis”: „Nie wpisuj imion, nazwisk, PESEL ani numerów dokumentów.”; stan pusty: „Brak dokumentów.” + „Dokumenty znikną razem z wizją dnia …, jeśli nie przypiszesz klienta.” (odrzucona: „Wizja jest odrzucona. Dokumenty zostaną usunięte razem z nią dnia …”); powody nieaktywnego „Dodaj dokument” widocznym tekstem i `aria-describedby` (odrzucona: „Wizja jest odrzucona — dokumentów nie można już dodawać.”; wygasła: „Termin wizji minął — …”; ładowanie: „Wczytujemy dane wizji…”; błąd: „Nie wczytano danych wizji.” + „Spróbuj ponownie”); komunikaty błędów w panelu wgrywania z `role="alert"`: `customer_required` „Nie dodano dokumentu. Najpierw przypisz klienta do tej wizji.” + wskazówka o „Przypisz klienta”; `/kindCode` „Przed przypisaniem klienta można dodać tylko ofertę/wycenę. Zmień pole „Rodzaj”.”; `invalid_state_transition` „Sesja wgrywania wygasła lub została przerwana. Spróbuj ponownie.” (Ponów); `403` „Nie masz uprawnień do dodawania dokumentów do tej wizji.”; `429` „Zbyt wiele zapytań. Poczekaj chwilę i spróbuj ponownie.” (z `Retry-After`: „…za 30 s”, Ponów); `5xx` „Nie udało się wysłać dokumentu. Spróbuj ponownie.” (Ponów); brak sieci „Nie wysłano — przerwane połączenie.” (Ponów). Flow 17 zasada 1 (słowo „oferta”) dopuścić jako rodzaj dokumentu „Oferta/wycena”. Sprawdzić, czy `TextField` obsługuje `aria-describedby`.
- Decyzje Konrada 2026-11-24: AC5 — dane zachowuje pozycja wgrywania (bez przebudowy dialogu); przyjęte zmiany AC z konsultacji UX (`work_order_closed`, stała linia o dacie, ukrycie klasy poufności i etapu w wizji).
- Decyzje Konrada 2026-11-20: kotwica tylko „zlecenie”, rodzaj tylko Oferta/wycena, dane zamawiającego w ofercie z ostrzeżeniem w formularzu, bez nowych ról.
- Punkty dotknięte w kodzie (architekt): `documents-section.tsx:91-92`, `document-upload-dialog.tsx:206-208` (`hasSite` pokazałby „Lokalizacja”).
- UX: brzmienie ostrzeżenia i komunikatów ustala `ux-designer` w przeglądzie; ostrzeżenie „nie wpisuj imion” przy tytule i opisie wynika z przeglądu security (Low).
- Decyzje techniczne: [ADR-0025](../../architecture/adr/0025-dokumenty-wizji-lokalnej-przed-klientem.md) (zaakceptowany 2026-11-23): rodzaj ≠ `quote` to `400` z `/kindCode`, nie `409`.
- Realne oferty w produkcji dopiero po EVM-147 i EVM-149 (oraz `enforce` albo RR-102 — patrz EVM-147).

## Notatki
Błąd komunikatów (AC4, AC5) jest niezależny od API — w razie potrzeby można go wyprzedzić jako osobną drobną poprawkę.
- Uwagi nieblokujące (2026-11-24): `400 requires_customer` na `/kindCode` w wizji mówi „Zmień pole „Rodzaj””, choć pole jest tylko do odczytu (dotyczy wyłącznie rozjazdu z serwerem; do potwierdzenia przy demo); stan ładowania danych wizji nie występuje na tym ekranie (sekcja renderuje się po załadowaniu zlecenia); nieznany kod 409 daje teraz komunikat ogólny z „Ponów” (wcześniej „conflict”); niepokryte gałęzie: `document-labels.ts:167`, wiersze `invalid_state_transition` i brak sieci w `site-survey-documents.test.tsx` (nit); realne oferty nadal po EVM-149 i `enforce` albo RR-102.

## Dziennik
- 2026-11-20 — utworzono przy podziale EVM-147 na trzy historyjki (product-owner)
- 2026-11-23 — AC4: obsługa `400 /kindCode requires_customer` po ADR-0025 (product-owner)
- 2026-11-24 — refinement: zależności EVM-147 i EVM-138 done; konsultacja ux-designera (brzmienia, komponenty, luki AC); Konrad akceptuje zmiany AC (AC2–AC5); 6 AC; status `ready`
- 2026-11-24 — start realizacji (/deliver): gałąź `feature/EVM-148-oferta-w-panelu-wizji`, ścieżka `pelna`, wykonawca web-developer (`sonnet`), recenzenci code-reviewer, ux-designer
- 2026-11-24 — plan gotowy (web-developer)
- 2026-11-24 — implementacja AC1–AC6 gotowa (web-developer): silnik, formularz oferty, panel błędów, testy, e2e, dokumentacja
- 2026-11-24 — przeglądy (code-reviewer, ux-designer): approve w rundzie 1; bramka `pnpm run gate` zielona u Tech Leada (pokrycie zmienionego kodu 100% linii / 93,5% gałęzi); `web-e2e-linux`: 1568 przeszło, 3 flaky, 1 pad Firefoksa w niezwiązanym `work-order-media-preview` (EVM-045) pod obciążeniem — osobno 26/26 zielone; status `in-review`
- 2026-11-24 — Koszt: ścieżka `pelna`, 6 agentów, ok. 0,52 mln tokenów podagentów, 141 wywołań narzędzi, ok. 56 min, 1 runda, 0 poprawek
- 2026-11-25 — zaakceptowano (Konrad); PR #169 scalony do `main` (squash), status `done`
