---
id: EVM-135
title: "API: wizja lokalna — zakładanie zlecenia bez klienta (telefon i panel), zakres repliki, ochrona adresu"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # nowa polityka dostępu, zakres synchronizacji, dane osobowe
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: opus             # nowa reguła zakresu repliki dla zleceń bez klienta (ADR-0021 / ADR-0024) i nowa polityka dostępu
depends_on: [EVM-099, EVM-127, EVM-133]   # EVM-133 (klauzule) — warunek włączenia flagi, nie startu prac; ADR-0024 Zaakceptowany przed `ready`
---

# EVM-135: API — wizja lokalna: zakładanie zlecenia bez klienta

## Cel
Jako **technik (Edytor) i pracownik biura** chcę **założyć zlecenie bez klienta — samym adresem — już na oględzinach**, aby **zdjęcia i filmy trafiały do systemu przed ofertą, bez zbierania danych klienta, który może nie zostać klientem**. „Wizja lokalna” = zlecenie w statusie „Wycena” z `customerId = null` (bez nowego bytu, bez nowego statusu); kontekst i ocena: [`docs/backlog/M2/README.md`](README.md) → „Epik E15”.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w stanie wstępnym „Wycena”; klient dopiero przy „Zaakceptowane” (EVM-136); bez osobnego bytu.
2. Wizja dostaje zwykły numer zlecenia `ZL-RRRR-NNNN` od razu (po synchronizacji).
3. Wygasanie 90 dni / odrzucona 14 dni (EVM-139, EVM-140).
4. Jedno opcjonalne pole „telefon zamawiającego”.
5. Zakłada technik w aplikacji (także offline) i biuro w panelu.
6. Oferta w systemie — poza zakresem. 7. Kolejność: EVM-133 → wizja lokalna → EVM-112 → EVM-111.

## Kryteria akceptacji
Role: Administrator i Edytor — tak; Tylko odczyt — nie (`403` / `404`); niezalogowany — `401`. Kanał `mobile` tylko dla A i E.

**AC1 — Zakładanie z telefonu (offline, idempotentnie)**
- Zakładając Edytora lub Administratora z zarejestrowanym urządzeniem i włączoną funkcją
- Gdy przychodzi `CreateQuickWorkOrder` w nowej wersji komendy (`commandVersion: 2`) z `workOrderId`, nową lokalizacją (adres) i bez `customerId` / `newCustomer` / `templateId`, opcjonalnie z `requesterPhone` (E.164)
- Wtedy powstaje zlecenie w statusie „Wycena” z numerem `ZL-…`, tytułem „Wizja lokalna”, pustym zakresem i bez klienta, wynik mutacji zwraca numer, a powtórzenie tej samej mutacji nie tworzy duplikatu; komenda w wersji 1 działa bez zmian (klient dalej wymagany).

**AC2 — Zakładanie z panelu**
- Zakładając Edytora lub Administratora w panelu
- Gdy zakładam zlecenie bez klienta z istniejącą albo nową lokalizacją, bez szablonu, opcjonalnie z telefonem zamawiającego
- Wtedy powstaje wizja jak w AC1 (status „Wycena”, numer od razu); zwykłe zlecenie (z klientem i szablonem) tworzy się jak dotąd, a klient pozostaje wymagany wszędzie poza jawnie wybraną wizją (próba „zwykłego” zlecenia bez klienta nadal zwraca `400`).

**AC3 — Walidacja i przypadki negatywne**
- Zakładając wizję
- Gdy brakuje adresu, telefon nie jest poprawnym numerem E.164, `workOrderId` już istnieje (także cudzy), albo przekroczono kwotę synchronizacji urządzenia
- Wtedy mutacja jest odrzucona kodem ze słownika (`validation_failed`, `id_conflict`, `sync_quota_exceeded`), nic się nie zapisuje, a komunikat błędu nie zawiera adresu ani telefonu.

**AC4 — Uprawnienia (deny-by-default)**
- Zakładając każdą nową lub zmienioną operację (tworzenie, lista, szczegóły, filtr, synchronizacja)
- Gdy wywołuje ją Administrator, Edytor, Tylko odczyt, niezalogowany albo urządzenie z kanałem `mobile` roli Tylko odczyt
- Wtedy Administrator i Edytor działają, Tylko odczyt nie widzi wizji ani na liście, ani w szczegółach (`404`), niezalogowany dostaje `401`, a tabela macierzy ról ma test dla każdej operacji (także cudza wizja — IDOR).

**AC5 — Zakres repliki: tylko twórca i opiekun**
- Zakładając wizję założoną przez Edytora A, bez opiekuna albo z opiekunem B
- Gdy telefon Edytora C pobiera zmiany
- Wtedy C nie dostaje wizji (ani wiersza, ani wzmianki o jego istnieniu); A (twórca) i B (opiekun) ją dostają; po przypisaniu klienta (EVM-136) zlecenie wchodzi do zwykłego zakresu wszystkich Edytorów; test zakresu synchronizacji w CI.

**AC6 — Lista, filtr i oznaczenie**
- Zakładając wizje i zwykłe zlecenia
- Gdy pobieram listę zleceń z filtrem `withoutCustomer=true` albo szczegóły wizji
- Wtedy dostaję tylko zlecenia bez klienta (dla A i E), a odpowiedź zawiera `customer: null`, `requesterPhone` i datę wygaśnięcia wizji (utworzenie + 90 dni); filtr jest addytywny (brak parametru = dotychczasowe zachowanie), lista nie zwraca pola adresu poza szczegółami lokalizacji.

**AC7 — Adres i telefon nigdy poza danymi zlecenia**
- Zakładając założenie, odczyt i synchronizację wizji
- Gdy sprawdzam logi API, `change_log`, audyt, metryki, klucze i nazwy obiektów, komunikaty błędów i treść powiadomień
- Wtedy nie ma w nich adresu ani telefonu zamawiającego (tylko identyfikatory i numer zlecenia); test redakcji obejmuje logi i `change_log`.

**AC8 — Przełącznik funkcji**
- Zakładając funkcję wyłączoną konfiguracją wdrożenia (domyślnie wyłączona na środowisku z danymi realnymi do spełnienia warunków z EVM-141)
- Gdy ktokolwiek próbuje założyć wizję (telefon lub panel)
- Wtedy dostaje `403 feature_disabled`, a klienci (aplikacja, panel) mogą odczytać stan funkcji, by ukryć akcję; po włączeniu AC1–AC2 działają bez wdrożenia.

## Poza zakresem
Przypisanie klienta, reguła „Zaakceptowane”, odrzucenie (EVM-136); ekrany (EVM-137, EVM-138); usuwanie, przypomnienia, limity (EVM-139, EVM-140); oferta, termin wizyty, deduplikacja adresów (świadomie — ta sama lokalizacja może mieć wiele wizji), zastosowanie szablonu do istniejącego zlecenia, edycja wizji z telefonu, CHECK w bazie (migracji nie planujemy: `customer_id` jest już nullable).

## Decyzje i ograniczenia
- Kontrakt addytywnie: nowa wersja komendy, nowy filtr, nowe pola; zgodność wstecz — starsza aplikacja nie zakłada wizji, ale może dodawać zdjęcia do widocznej wizji; kolejność wdrożeń: API przed APK.
- **Bezpieczeństwo (security.md):** realizuje W2, W5, W6, W8 (brak pól swobodnych — tytuł stały), W11 (Tylko odczyt bez dostępu); dokumenty i RODO — EVM-141.
- **Pytania do Konrada:**
  1. Czy Tylko odczyt widzi wizje w panelu? Rekomendacja: nie (przed umową nie ma potrzeby; AC4). Jeśli tak — wizje na liście dla roli Tylko odczyt, bez mediów i telefonu.
  2. Zakres repliki „twórca + opiekun” (AC5) zamiast „wszyscy Edytorzy” jak dla zwykłych zleceń — rekomendacja: tak (kradzież telefonu = katalog adresów). Konsekwencja: wizja założona z panelu bez opiekuna nie jest widoczna na żadnym telefonie, dopóki biuro nie wskaże opiekuna.
- **Konsultacje przed `ready`:** architekt (po ADR-0024: reguła zakresu repliki dla W6 — wymaga decyzji, czy zmienia `scopeRuleVersion`; kolumna twórcy; kod `feature_disabled`; limit sesji), security (W6, przełącznik), UX niepotrzebna.

## Dziennik
- 2026-11-16 — szkic (product-owner)
