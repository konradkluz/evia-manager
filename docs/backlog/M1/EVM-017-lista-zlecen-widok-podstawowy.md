---
id: EVM-017
title: Lista zleceń — widok podstawowy
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: in-progress
path: pelna
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-067]
---

# EVM-017: Lista zleceń — widok podstawowy

## Historyjka
Jako **pracownik biura** chcę **zobaczyć listę zleceń z podstawowymi filtrami i stronicowaniem**, aby **szybko znaleźć zlecenie i wiedzieć, ile prac jest w toku**.

## Kontekst
- Trzeci krok ścieżki pionowej: logowanie → **lista** → utworzenie zlecenia (README M1).
- Lista rośnie z epikami: EVM-072 — kolumna „Klient” z lokalizacją i wyszukiwanie; EVM-034 — „Czekamy na”, „Termin”; EVM-056 — „Płatność”, widoki „Po terminie” i „Nieopłacone”, sortowanie „Najpilniejsze”.
- Makieta: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń). Model: `WorkOrder`, `WorkOrderAssignment` (`domain-model.md`). Polityka P10 (masowy odczyt), RR-13.

## Kryteria akceptacji
**AC1 — Widok domyślny**
- Zakładając zalogowanego użytkownika i zlecenia w różnych statusach
- Gdy otwieram „Zlecenia” (W-10)
- Wtedy widzę widok „Wszystkie niezamknięte” (bez Rozliczonych i Anulowanych) z kolumnami: Zlecenie (numer i tytuł), Status (odznaka; nieznana wartość — [P-12]), Opiekun, Utworzono; domyślne sortowanie — numer malejąco; cały wiersz prowadzi do szczegółów zlecenia.

**AC2 — Filtry, widoki i sortowanie (SR-INPUT-01, SR-INPUT-03)**
- Zakładając zlecenia różnych opiekunów
- Gdy wybieram status (wielokrotnie), widok „Moje” (opiekun = ja) albo opiekuna w „Więcej filtrów” i sortowanie „Numer” lub „Utworzono”
- Wtedy lista zawiera tylko pasujące zlecenia; w URL są wyłącznie status i identyfikator widoku (bez identyfikatora osoby); nieznany parametr zwraca `400 unknown_parameter`, powtórzony — `400 duplicate_parameter`, wartość `sort` spoza listy — `400 validation_failed`.

**AC3 — Paginacja kursorem**
- Zakładając 60 zleceń spełniających filtry
- Gdy przechodzę „Następna” przy 25 na stronę
- Wtedy dostaję kolejne strony bez powtórzeń i luk (sortowanie stabilne); `limit` 101 zwraca `400`; kursor zmieniony albo użyty z innymi filtrami zwraca `400 invalid_cursor`, a W-10 wraca na pierwszą stronę z komunikatem „Lista się zmieniła — wróciliśmy na początek.”

**AC4 — Wydajność**
- Zakładając 10 000 syntetycznych zleceń (generator danych testowych)
- Gdy pobieram listę z filtrami
- Wtedy p95 czasu odpowiedzi API jest < 300 ms, a dane z innych modułów (nazwa opiekuna) są pobierane wsadowo raz na stronę (test z licznikiem zapytań — brak N+1).

**AC5 — Masowy odczyt (SR-API-02, P10, RR-13)**
- Zakładając użytkownika, któremu listy zwróciły 2000 rekordów w ciągu 10 min
- Gdy pobiera kolejną stronę
- Wtedy powstaje alert bezpieczeństwa „masowy odczyt” (metryka bez danych osobowych), a po przekroczeniu 10 000 rekordów w 10 min API zwraca `429 rate_limited` z `Retry-After`; W-10 pokazuje „Zbyt wiele zapytań. Spróbuj ponownie za … min.”, filtry zostają.

**AC6 — Polityka w zapytaniu (SR-AUTHZ-03)**
- Zakładając zlecenie usunięte (soft delete)
- Gdy Edytor albo Tylko odczyt pobiera listę
- Wtedy zlecenia nie ma w wynikach ani na kolejnych stronach — polityka działa warunkiem w zapytaniu, nie odsiewaniem po pobraniu strony.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda pobiera listę
- Wtedy Administrator, Edytor i Tylko odczyt widzą listę i filtry, niezalogowany dostaje `401`, a operacja jest w macierzy ról.

**AC8 — Stany**
- Wtedy: brak zleceń — „Nie masz jeszcze zleceń.”; brak wyników filtrów — „Brak zleceń spełniających filtry. [Wyczyść filtry]”; ładowanie — Skeleton wierszy, po 10 s „Ładowanie trwa dłużej niż zwykle…”; błąd — „Nie udało się wczytać zleceń. [Spróbuj ponownie]”; offline — ostatnia strona z pamięci karty z banerem „Dane mogą być nieaktualne (z 14:05)” i wyłączonymi filtrami; tytuł karty „Zlecenia · EVia Manager”.

## Poza zakresem
- Kolumna „Klient” z lokalizacją, wyszukiwanie, filtry „Typ obiektu” i „Szablon” — EVM-072.
- „Czekamy na”, „Termin”, sortowania „Najdłużej czekamy” i „Termin” — EVM-034. „Płatność”, widoki „Po terminie”, „Nieopłacone”, „Najpilniejsze” — EVM-056.
- Przycisk „Nowe zlecenie” — pojawia się z EVM-020 (formularz W-05 powstaje w EVM-020–EVM-022).
- Licznik wszystkich wyników („6 zleceń” w makiecie) — `api-guidelines.md` wyklucza liczniki całkowite na listach; do decyzji architekta (README M1 → „Uwagi do potwierdzenia”).
- Zapamiętywanie filtrów po stronie serwera, eksport (M4).

## UX / UI
- W-10 w zakresie AC1–AC2; DataTable (§ 3.6), FilterBar i FilterChip (§ 3.7), StatusBadge (§ 3.9), [P-12], EmptyState (§ 3.15), Skeleton (§ 3.16). Responsywność wg makiety (compact — karty).
- Stany: AC8. Brak uprawnień: lista filtrowana polityką; zapisany widok spoza uprawnień — „Nie znaleziono widoku. [Pokaż wszystkie zlecenia]”.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | lista, filtry, widoki |
| Edytor | lista, filtry, widoki |
| Tylko odczyt | lista, filtry, widoki (bez „Nowe zlecenie”) |
| Niezalogowany | brak (`401`) |

- Dane: identyfikatory, numery, tytuły (pole swobodne), opiekun (`id`, `displayName` — SR-DATA-03).
- W AC: SR-API-02, SR-AUTHZ-03, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-03.
- W sekcji: SR-AUTHZ-01, SR-DATA-03, SR-API-04 (w URL tylko parametry bez danych osobowych). Polityka P10.

## Notatki techniczne
- Moduły: `work-orders` (+ fasada `identity` — nazwy użytkowników) + panel.
- **Tabela `work_orders` powstaje tutaj.** Klucze obce do `customers` i `sites` dochodzą, gdy te moduły powstaną (EVM-020, EVM-021) — najpóźniej w EVM-022, zmianą addytywną. Do potwierdzenia w planie technicznym (`solution-architect`); alternatywa — EVM-017 po EVM-020 i EVM-021 (README M1 → „Ryzyka planu”).
- Zdolności przekrojowe wprowadzane tutaj: paginacja kursorem; licznik masowego odczytu per użytkownik (wspólny dla kolejnych list i wyszukiwań); `sort` i filtry jako rozszerzalne enumy (klient obsługuje wartość nieznaną) — EVM-034, EVM-056 i EVM-072 dodają wartości addytywnie.
- Generator 10 tys. syntetycznych zleceń — narzędzie testowe; na staging wyłącznie dane syntetyczne (SR-INFRA-08).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-017 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-07 — ready → in-progress (/deliver; ścieżka pelna: uprawnienia, masowy odczyt, nowy endpoint i UI; gałąź feature/EVM-017-work-orders-list)
- 2026-10-07 — plan gotowy (backend-developer)
- 2026-10-07 — backend gotowy (backend-developer): kontrakt `listWorkOrders`, migracja `0010`, moduł `work-orders`, kursor i licznik masowego odczytu; testy integracyjne zielone w kontenerze; do zrobienia: panel W-10 (web-developer)
