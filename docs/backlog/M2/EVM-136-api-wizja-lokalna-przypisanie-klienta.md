---
id: EVM-136
title: "API: wizja lokalna — przypisanie klienta, reguła „Zaakceptowane wymaga klienta”, odrzucenie i przywrócenie"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: done
priority: P1
path: pelna             # nowa operacja zmieniająca dane zlecenia, reguła domeny, IDOR
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-135]
---

# EVM-136: API — przypisanie klienta i reguła akceptacji wizji

## Cel
Jako **pracownik biura** chcę **przypisać klienta do wizji lokalnej, gdy oferta zostanie zaakceptowana (albo wizję odrzucić)**, aby **wizja stała się zwykłym zleceniem — z tymi samymi zdjęciami, filmami i wpisami — albo znikła po krótkim czasie**. To „konwersja” (W3) bez przenoszenia mediów: identyfikatory się nie zmieniają.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”; bez osobnego bytu. 2. Zwykły numer od razu. 3. 90 / 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. Tylko odczyt bez dostępu; na telefonie twórca i opiekun. 10. Adres tylko w szczegółach. 11. **Klient po przypisaniu niezmienny (v1); telefon zamawiającego czyszczony; powody odrzucenia: „Oferta odrzucona”, „Rezygnacja klienta”.** 12. Luki w numeracji akceptowane. 13. Wizje na głównej liście z etykietą. 14. Przypomnienie 15 dni przed; przedłużenie tylko w panelu ≤ 2; limit 20 / 100. 15. `enforce` po kopiach, do tego `report`. 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu.

## Kryteria akceptacji
Role: Administrator i Edytor — tak (kanał web); Tylko odczyt — brak dostępu; niezalogowany — `401`; kanał `mobile` — nie (`channel_not_allowed`).

**AC1 — Przypisanie klienta**
- Zakładając otwartą wizję i istniejącego, widocznego, nieusuniętego i niezanonimizowanego klienta
- Gdy Edytor lub Administrator woła `PUT /work-orders/{id}/customer` z `customerId` i `version`
- Wtedy jedno `UPDATE` ustawia klienta i zeruje termin wygaśnięcia, licznik przedłużeń i telefon zamawiającego; numer, media i wpisy bez zmian; powstają audyt `work_order.customer_assigned` (same identyfikatory) i wpis dziennika; lokalizacja się nie zmienia; wizja jest od tej chwili zwykłym zleceniem.

**AC2 — Jednorazowość, idempotencja, konflikty**
- Zakładając zlecenie z klientem albo nieaktualną `version`
- Gdy ponawiam przypisanie
- Wtedy ten sam `customerId` zwraca `200` bez zmian, inny — `409 customer_already_set`, zlecenie nie będące wizją — `409`, nieaktualna wersja — `409` jak dziś; zmiana klienta zwykłego zlecenia nadal niemożliwa (`PATCH` → `read_only_field`); dwa równoległe przypisania różnych klientów dają jeden sukces i jeden `409`.

**AC3 — Uprawnienia i IDOR**
- Zakładając cudzą lub nieistniejącą wizję, klienta niewidocznego, usuniętego lub zanonimizowanego, albo Tylko odczyt
- Gdy przypisuję klienta
- Wtedy „brak” i „brak dostępu” dają to samo (`404`), klient niedostępny — `422 customer_unavailable`, Tylko odczyt — `403`, a żadna próba nie zmienia danych; klient jest blokowany `FOR KEY SHARE` jak w kompozytorze.

**AC4 — „Zaakceptowane” wymaga klienta**
- Zakładając wizję w „Wycena” lub „Wstrzymane”
- Gdy przechodzę do „Zaakceptowane” (także przez wznowienie z „Wstrzymane”)
- Wtedy `409 customer_required`, bez zmian; po przypisaniu klienta przejście działa jak dotąd; reguła jest w tabeli przejść, test po grafie przejść potwierdza, że żadna ścieżka jej nie omija, a CHECK w bazie jest drugą linią obrony.

**AC5 — Odrzucenie i przywrócenie wizji**
- Zakładając otwartą wizję
- Gdy Edytor lub Administrator anuluje ją z kodem powodu „Oferta odrzucona” albo „Rezygnacja klienta”
- Wtedy status „Anulowane”, termin wygaśnięcia = najmniejsza z wartości (obecny termin, teraz + 14 dni), audyt bez treści; przywrócenie robi tylko Administrator (step-up, zgodnie z EVM-030) i ustawia termin = większa z wartości (utworzenie + 90 dni × (1 + przedłużenia), teraz + 14 dni); anulowanie zwykłego zlecenia działa jak dotąd, a Edytor nie przywraca (`403`).

**AC6 — Synchronizacja po przypisaniu**
- Zakładając wizję w replice telefonu twórcy i przypisanie klienta w panelu
- Gdy telefon pobiera zmiany
- Wtedy dostaje migawkę klienta i zlecenie z klientem (test integracyjny: rekord wskazuje nieznany `customerId`, ADR-0021 D3), `overview` w panelu pokazuje klienta i zlecenie wchodzi do liczników; Edytor C bez dotychczasowego dostępu dostaje je jak zwykłe zlecenie.

## Poza zakresem
Zmiana klienta po przypisaniu; łączenie wizji z istniejącym zleceniem; odrzucenie i przypisanie z aplikacji (przejścia statusów tylko w panelu); blokady płatności/dokumentów/ZIP (EVM-135 AC7); ekrany (EVM-138); usuwanie, przypomnienia (EVM-139, EVM-140); oferta, CRM, deduplikacja.

## Decyzje i ograniczenia
- Nowe kody: `customer_required`, `customer_already_set`, `customer_unavailable`; nowa akcja audytu; kod powodu — wartość stała, nie tekst; poszerzenie zamkniętych list wg wzoru 0058 (N-1 pisze podzbiór).
- Konsultacja architekta — ADR-0024 (pkt 3, 4, 9); bezpieczeństwo: W2, W3.

## Notatki
Rozmiar wg ADR-0024: M. Panel przed przypisaniem podstawia telefon zamawiającego do formularza nowego klienta (EVM-138).
- **Rozstrzygnięcia Tech Leada z delegacji (do potwierdzenia przy demo):**
  1. **AC2 — nieaktualna wersja to `412 version_conflict`**, nie „`409` jak dziś” (w całym API i panelu konflikt wersji to `412`); `version` w ciele żądania (ADR-0024); „ten sam klient ponownie → `200`” sprawdzane przed wersją.
  2. **AC3 — kanał aplikacji:** sesja kanału aplikacji dostaje `403 forbidden`, token aplikacji `401` (jak każda operacja tylko-web), nie `channel_not_allowed`.
  3. **AC4 — reguła „wymaga klienta” jest szersza:** `409 customer_required` dla każdego celu poza „Wycena”, „Wstrzymane”, „Anulowane” (lustro więzu bazy), nie tylko dla „Zaakceptowane”.
  4. Przypisanie klienta do odrzuconej wizji → `409 invalid_state_transition` (najpierw przywrócenie przez Administratora); `reasonCode` poza odrzuceniem wizji → `400`; audyt odrzucenia bez kodu powodu (kod w `status_reason`).
  5. Baseline kontraktu przesunięty z `--allow-breaking ADR-0024` (nowa wartość enum akcji audytu `work_order.customer_assigned`).
- **Ryzyka rezydualne (security, do decyzji Konrada — rekomendacja: akceptacja, monitorowanie w EVM-140):** Administrator cyklem „odrzuć → przywróć” może przesuwać termin wizji (przywrócenie daje co najmniej teraz + 14 dni); wizję po terminie, a przed usunięciem, można ocalić przypisaniem klienta.
- **Do EVM-139:** wolny tekst powodu wstrzymania wizji (`status_reason`) może nazwać osobę — zadanie usuwania ma go zerować.
- **Minor / nit z przeglądów — zostają:** testy „równoległych” żądań (poza testem blokady klienta) nie wymuszają faktycznej współbieżności; `SURVEY_REJECTION_CODES` powiela enum kontraktu; opis PUT w kontrakcie mówi jeszcze o `403 channel_not_allowed` dla tokenu aplikacji; opis `allowedTransitions` nie mówi o `accepted` dla wizji; nazwa `lockUsableCustomerForQuickOrder`; brak asercji licznika wprost w AC6 (sprawdzane listy, raporty i projekcja).

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-16 — start realizacji w kolejce `/noc-2026-11-16` (tor C, klon n2, na commicie kontraktu EVM-135 `84766fbf`); **status `in-progress`** (Tech Lead)
- 2026-11-17 — implementacja etapami (backend-developer): przypisanie klienta `72c7680b`, baseline `36db5500`, reguła akceptacji `9fadc083`, odrzucenie i przywrócenie `be68b810`, synchronizacja po przypisaniu `3d259025`, część po scaleniu EVM-135 `22c7bf21`; bez migracji
- 2026-11-17 — QA (`qa-engineer`): **PASS z uwagami**, raport `docs/qa/EVM-136/raport-qa.md`; przeglądy: security-engineer **APPROVE z uwagami** (W2, W3, W5 spełnione), code-reviewer **APPROVE z uwagami** — bez blocker i major
- 2026-11-17 — bramka lokalna na gałęzi zintegrowanej (`bc40eeac` + dokumenty): `pnpm run gate` 68/68 zadań, pokrycie zmienionego kodu zielone, `npm run test:tools`, `npm run docs:check` (0 błędów), `pnpm run gate:deploy` — kody wyjścia 0; pełna integracja API, E2E Linux i skany — w CI PR-u (zasada z 2026-11-17). **Status `in-review`** — PR wspólny dla EVM-135…138 i EVM-141; demo i akceptacja Konrada po scaleniu (Tech Lead)
- 2026-11-24 — zaakceptowane przez Konrada (kod scalony w main); status `done`
