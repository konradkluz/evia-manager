---
id: EVM-041
title: Usunięcie i anonimizacja klienta (Administrator)
type: story
milestone: M1
epic: E2 Klienci
status: in-progress
priority: P1
path: pelna
model: sonnet
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-039, EVM-040]
---

# EVM-041: Usunięcie i anonimizacja klienta (Administrator)

## Historyjka
Jako **Administrator** chcę **ukryć klienta dodanego przez pomyłkę i zanonimizować dane klienta na jego żądanie**, aby **utrzymać porządek w bazie i realizować prawa osób z RODO bez rozbijania historii zleceń**.

## Kontekst
- Model: `Customer` — soft delete tylko bez niezamkniętych zleceń (`409 has_active_dependents`), anonimizacja (A ze step-upem) z zachowaniem powiązań; „Usuwanie danych”.
- Blokada usunięcia: port w `customers` implementowany przez `work-orders` (konsultacja `solution-architect`, C).
- Rejestr usunięć z EVM-040 (SR-PRIV-04). Procedura praw osób — runbook EVM-064.
- Makieta: W-14 (EVM-071), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Usunięcie klienta bez niezamkniętych zleceń**
- Zakładając klienta, którego wszystkie zlecenia są „Rozliczone” albo „Anulowane”
- Gdy Administrator wybiera „Usuń klienta”
- Wtedy klient znika dla Edytora i Tylko odczyt (`404`, brak na liście i w wyszukiwaniu), a zdarzenie trafia do audytu
- Oraz w danych klienta osadzonych w zleceniach (W-06 — nagłówek i karta „Klient”, W-10 — kolumna „Klient” i wyszukiwanie zleceń, W-11) Edytor i Tylko odczyt widzą stan „Klient usunięty” bez danych klienta i bez linku do niego, a wyszukiwanie zleceń po danych tego klienta nie daje trafień — odpowiedzi serwera nie zawierają tych danych (ustalenie A1 `security-engineer` w EVM-071; `flows/README.md` → zasada wspólna 18).

**AC2 — Klient z niezamkniętymi zleceniami**
- Zakładając klienta ze zleceniem „W realizacji”
- Gdy Administrator próbuje go usunąć albo zanonimizować
- Wtedy API zwraca `409 has_active_dependents`, a panel pokazuje informację o niezamkniętych zleceniach z ich liczbą (komunikat z makiety W-14).

**AC3 — Przywrócenie**
- Zakładając usuniętego klienta
- Gdy Administrator włącza filtr „Usunięci” w W-14 i wybiera „Przywróć klienta”
- Wtedy klient znów jest widoczny dla wszystkich ról, a zdarzenie trafia do audytu.

**AC4 — Anonimizacja (SR-DATA-08, SR-SESS-08)**
- Zakładając klienta „Jan Przykładowy” bez niezamkniętych zleceń
- Gdy Administrator wybiera „Anonimizuj…”, potwierdza nieodwracalność w dialogu i tożsamość w W-04
- Wtedy imię, nazwisko, firma, NIP, osoba kontaktowa, telefon, e-mail, adres i notatki mają wartości neutralne („Klient zanonimizowany”), indeks wyszukiwania jest przeliczony (stare dane nie są znajdowane), a zlecenia klienta pokazują „Klient zanonimizowany”.

**AC5 — Rejestr usunięć przed anonimizacją (SR-PRIV-04)**
- Gdy Administrator anonimizuje klienta
- Wtedy przed zmianą w bazie do rejestru usunięć trafia identyfikator klienta, kod operacji i czas
- Oraz gdy zapis do rejestru się nie udaje, anonimizacja nie startuje, a dane są nienaruszone.

**AC6 — Audyt bez wartości (SR-LOG-03)**
- Gdy wykonuje się usunięcie, przywrócenie albo anonimizacja
- Wtedy zdarzenie audytu zawiera tylko identyfikator klienta, kod akcji i wynik.

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda usuwa, przywraca i anonimizuje
- Wtedy tylko Administrator (anonimizacja — ze step-upem); Edytor ma akcje wyłączone z podpowiedzią i dostaje `403 forbidden`; R nie widzi akcji (`403`); niezalogowany — `401`.

**AC8 — Stany**
- Wtedy offline — akcje wyłączone; anulowanie W-04 — „Nie wykonano operacji.”; `412` — komunikat z odświeżeniem.

## Poza zakresem
- Anonimizacja lokalizacji, stron i wpisów dziennika o kliencie — procedura ręczna z runbooka (EVM-064) do M4; trwałe usunięcie (purge) — M4.
- Eksport danych osoby (art. 15, 20) — procedura ręczna (SR-DATA-09, EVM-064).

## UX / UI
- W-14: akcje „Usuń klienta”, „Przywróć”, „Anonimizuj…” w menu, filtr „Usunięci” (tylko A), AlertDialog (danger), W-04 „Potwierdź tożsamość, aby zanonimizować klienta”. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie, przywrócenie; anonimizacja ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: `Customer` (DO-K); rejestr usunięć (identyfikatory).
- W AC: SR-DATA-08, SR-SESS-08, SR-PRIV-04, SR-LOG-03, SR-AUTHZ-02, SR-AUTHZ-05. Polityka P4.

## Notatki techniczne
- Moduły: `customers`, `work-orders` (implementacja portu blokady), `audit` (+ `platform`: rejestr usunięć) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Kontrakt (addytywnie): `deleteCustomer`, `restoreCustomer`, `anonymizeCustomer`; filtr `deleted` (lista, wyszukiwanie); `Customer.deletedAt`/`anonymizedAt`, `CustomerCard.anonymized`, `Problem.openWorkOrders`; kody `customer_anonymized`, `already_anonymized`. Migracje 0043 (kolumny `anonymized_*`, CHECK wartości neutralnych, trigger nieodwracalności znacznika) i 0044 (indeks `(sort_name, id)` usuniętych) — tylko expand. `customers`: port `CustomerDependentsRegistry` (fail-closed, liczby per implementacja), trzy serwisy poleceń, polityki odczytu `visibleCustomers` / `readableCustomers` / `deletedCustomers`, `CustomerDirectory.lockVisible` (`FOR KEY SHARE`, tylko tworzenie zlecenia). `work-orders`: `OpenOrdersDependentsGuard`. `platform/deletion-register`: kod `customer_anonymized`, typ `customer` (ta sama ścieżka co redakcja EVM-040, bez nowego klienta S3). Szczegóły i kolejność kroków: dokumentacja kodu serwisów (`delete-customer.service.ts`, `anonymize-customer.service.ts`) i `docs/architecture/api-guidelines.md`. Panel (W-14, web-developer) — osobny krok.

## Decyzje
Decyzje robocze (rekomendowane wartości domyślne; do potwierdzenia przez Konrada na demo — nie zmieniają AC):
1. **Wartości neutralne (AC4).** Osoba: imię „Klient”, nazwisko „zanonimizowany” (nazwa „Klient zanonimizowany”); firma: nazwa „Klient zanonimizowany”. NIP, osoba kontaktowa, e-mail, adres i notatki — puste. Telefon (kolumna NOT NULL z formatem) — stała domenowa `+48000000000` (nie numer); panel pokazuje „—” (`CustomerCard.anonymized`). Tekst wyszukiwania przelicza baza (kolumna generowana).
2. **Nieodwracalność.** Znacznik `anonymized_at`/`anonymized_by` + CHECK wartości neutralnych + trigger (znacznika nie da się zmienić ani wyzerować). Edycja zanonimizowanego — `409 customer_anonymized`; ponowna anonimizacja — `409 already_anonymized` (sprawdzane przed wersją, więc powtórka po utracie odpowiedzi to „już wykonano”, a nie `412`). Usunięcie i przywrócenie zanonimizowanego jest dozwolone; anonimizacja klienta usuniętego też (bez przywracania — ustalenie A2).
3. **Zlecenia zamknięte** = `settled` i `cancelled`; zlecenia usunięte (soft delete) nie blokują. Licznik niezamkniętych w `409 has_active_dependents` to `openWorkOrders` (sama liczba, tylko dla Administratora; bierze się wyłącznie z implementacji `work-orders`).
4. **Filtr „Usunięci”**: `deleted=true` (lista) / `deleted: true` (wyszukiwanie), tylko Administrator; inne role — `403 forbidden` przed walidacją kursora; kursor wiąże filtr. `GET /customers/{id}` usuniętego: Administrator `200` (z `deletedAt`), E/R `404`; `PATCH` usuniętego — `404` dla każdej roli. Fasada `CustomerDirectory` zostaje na polityce „nieusunięci” także dla Administratora (W-06/W-10/W-11 pokazują „Klient usunięty”).
5. **Idempotencja**: `Idempotency-Key` dla usunięcia i przywrócenia (jak EVM-060); anonimizacja bez klucza (jak redakcja EVM-040). `If-Match` dla wszystkich trzech. „Cofnij” w panelu odczytuje bieżącą wersję (`GET` — Administrator czyta klienta usuniętego); `204` usunięcia nie ma `ETag`.
6. **Fail-closed rejestru** jak redakcja: rejestr zapisywany po wszystkich walidacjach i przed `UPDATE` w jednej transakcji; porażka — rollback, `503 deletion_register_unavailable`, audyt `customer.anonymized` z wynikiem `failed` w osobnej transakcji; brak konfiguracji — to samo, usługa zdrowa. Delete i restore nie piszą do rejestru (soft delete jest odwracalny).
7. **Wyścig z tworzeniem zlecenia (D7).** Usunięcie i anonimizacja blokują klienta `FOR UPDATE`, a zlecenia liczy osobne zapytanie po blokadzie; tworzenie zlecenia blokuje klienta `FOR KEY SHARE` (`CustomerDirectory.lockVisible`). Wynik: albo `409` przy usuwaniu, albo `404` przy tworzeniu. Wyścig z ponownym otwarciem zamkniętego zlecenia nie jest blokowany — patrz „Uwagi do rozważenia”.
8. **Synchronizacja mobilna** — bez zmian (aplikacja nie przechowuje klientów); każda z trzech operacji podbija `version` i `updated_at`.

## Uwagi do rozważenia
1. **Ponowne otwarcie zlecenia klienta usuniętego (RR-NOC-T2-5, kandydat do `/refine`).** Przejścia `restore('cancelled','on_hold')` i `restore('settled','completed')` w `work-order-transitions.ts` pozwalają Administratorowi otworzyć zlecenie klienta już usuniętego zwykłą sekwencją kroków. Skutek: zlecenie pokazuje „Klient usunięty”, danych klienta nie widać (brak wycieku), a anonimizacja takiego klienta daje `409`. Nie blokujemy tego w EVM-041 (poza AC; zmiana `work-orders` byłaby „przy okazji”).
2. **Zakres anonimizacji (RR-NOC-T2-6).** Tylko tabela klientów; lokalizacje (często adres domowy), strony, wpisy dziennika, tytuły zleceń i dokumenty zostają — ręczna procedura z runbooka EVM-064. Do tego czasu adres lokalizacji klienta usuniętego jest widoczny dla E/R w W-06.
3. **Alert na masową anonimizację (RR-NOC-T2-7).** Metryka i alert na liczbę anonimizacji (np. > 5 na godzinę na użytkownika) oraz krok w runbooku EVM-062 „wyklucz wpisy rejestru z okna incydentu przed ponownym zastosowaniem” — do backlogu, nie nowe AC.
4. Kod N-1 przy edycji zanonimizowanego klienta dostanie `500` (naruszenie CHECK) — akceptowalne okno wdrożenia, fail-closed (opis w migracji 0043).

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-041 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 4 (a), 4 (f) i 17 (b); liczba AC bez zmian): AC1 — klient usunięty niewidoczny dla Edytora i Tylko odczyt także w danych osadzonych w zleceniach (W-06, W-10 z wyszukiwaniem zleceń, W-11 — stan „Klient usunięty” bez danych; ustalenie A1, zasada wspólna 18); AC2 — komunikat o niezamkniętych zleceniach wg makiety W-14; AC3 — etykieta „Przywróć klienta”
- 2026-10-27 — nocna kolejka (tor T2): Konrad wskazał ścieżkę lekka, ale historyjka ma 8 AC i 3 recenzentów (lekka: ≤ 6 AC i 1 recenzent, workflow.md) — przyjęto pelna, model sonnet (Tech Lead); do potwierdzenia przez Konrada
- 2026-10-28 — start realizacji (nocna kolejka, tor T2), gałąź feature/EVM-040-041-usuniecie-rejestr-usuniec
- 2026-10-28 — plan gotowy (backend-developer)
- 2026-10-28 — implementacja backendu gotowa (backend-developer): kontrakt, migracje 0043–0044, usunięcie / przywrócenie / anonimizacja, port blokady, rejestr usunięć, testy `EVM-041 AC1–AC8`; panel W-14 — kolejny krok
- 2026-10-28 — panel W-14 gotowy (web-developer): menu „Akcje klienta” (Usuń z „Cofnij”, Anonimizuj… z AlertDialog, polem „Rozumiem” i W-04), banery usunięty / zanonimizowany z „Przywróć klienta”, filtr „Usunięci” (tylko A), karta „Klient” bez numeru zastępczego; testy `EVM-041 AC1–AC8` (komponentowe, Playwright, axe)
