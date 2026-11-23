---
id: EVM-150
title: "API: wizja lokalna — wyścig usuwania i dodawania mediów (blokada zlecenia przed zapisem medium i sesji wgrywania)"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P2
path: pelna             # współbieżność w ścieżce usuwania danych (art. 17 RODO), reguła z ADR-0025 M1
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet           # wzorzec blokady już jest w kodzie (lockVisible); tryb `opus` tylko, gdyby realizacja utknęła na teście współbieżnym
depends_on: [EVM-139]
---

# EVM-150: Wyścig usuwania wizji a dodawanie mediów

## Cel
Jako **administrator danych (EVia Charge)** chcę, aby **medium dodane do wizji lokalnej w chwili jej automatycznego usuwania nigdy nie przetrwało z plikiem i danymi przy anonimowym „nagrobku”**, aby **usunięcie wizji (art. 17 RODO, EVM-139) było rzeczywiście zupełne**. Dziś tworzenie mediów i sesji wgrywania czyta zlecenie bez blokady (`findVisible`), a usuwanie blokuje wizję `FOR NO KEY UPDATE SKIP LOCKED`; medium zatwierdzone po porównaniu zbioru, a przed `COMMIT` usuwania, może zostać przy zleceniu z `site_survey_purged_at`. Rozwiązanie jak [ADR-0025](../../architecture/adr/0025-dokumenty-wizji-lokalnej-przed-klientem.md) pkt 2 (M1) dla dokumentów — powiązane z EVM-147.

## Kryteria akceptacji

**AC1 — Dodanie mediów w panelu czeka na usuwanie**
- Zakładając, że usuwanie wizji bez klienta trzyma blokadę zlecenia (transakcja nie jest jeszcze zatwierdzona)
- Gdy Administrator lub Edytor dodaje medium do tej wizji (`POST` mediów zlecenia)
- Wtedy żądanie czeka na koniec transakcji usuwania, a po `COMMIT` dostaje `404` (zlecenie nie jest już widoczne) i w bazie nie ma medium z `work_order_id` tej wizji ani pliku do skasowania; odwrotna kolejność (dodawanie pierwsze) — usuwanie pomija wizję w tym przebiegu i bierze ją w następnym razem z nowym medium.

**AC2 — Sesja wgrywania czeka na usuwanie**
- Zakładając, że jak w AC1
- Gdy tworzona jest sesja wgrywania pliku (`createUploadSession`) dla istniejącego medium wizji
- Wtedy zachowanie jest takie samo: `404` po `COMMIT` usuwania, brak nowego pliku i sesji w bazie; sesja utworzona pierwsza wchodzi do zbioru usunięcia w następnym przebiegu.

**AC3 — Synchronizacja z telefonu (`CreateMediaAsset`)**
- Zakładając, że technik wysyła z telefonu medium wizji w chwili jej usuwania
- Gdy mutacja jest przetwarzana równolegle z usuwaniem
- Wtedy mutacja czeka na blokadę, po `COMMIT` usuwania dostaje dotychczasowy werdykt `rejected` `target_unavailable` (bez nowego kodu i bez zmiany kontraktu synchronizacji), a w bazie nie powstaje medium; odczyt celu mutacji i zapis medium są pod blokadą zlecenia.

**AC4 — Test współbieżny i obrona w głębi**
- Zakładając, że test integracyjny (dwie transakcje) dla każdej z trzech ścieżek: AC1, AC2, AC3
- Gdy usuwanie trzyma blokadę, a zapis medium czeka i dopiero potem usuwanie jest zatwierdzane (oraz wariant odwrotny)
- Wtedy test sprawdza wynik opisany w AC1–AC3 w obu kolejnościach; porównanie zbioru `mediaAssetIds` z rejestrem w `erase` zostaje bez zmian jako obrona w głębi (jego dotychczasowe testy nadal zielone).

**AC5 — Bez zmian dla zwykłych zleceń i uprawnień**
- Zakładając, że zlecenie ma klienta (albo jest zwykłym zleceniem), a rola to Administrator, Edytor, Tylko odczyt, token mobilny lub brak logowania
- Gdy dodawane jest medium lub sesja wgrywania
- Wtedy wynik i kody są jak dziś (Tylko odczyt i brak dostępu — `404`, niezalogowany — `401`; kolejność sprawdzeń: zlecenie niewidoczne `404` → blokada → pozostałe walidacje); blokada nie powoduje zakleszczenia z przypisaniem klienta (EVM-136) ani z usuwaniem (test dwóch operacji naraz kończy się bez błędu `deadlock`).

## Poza zakresem
- Dokumenty wizji (`createDocument`, `updateDocument`, `restoreDocument`) — blokada i test w EVM-147 (ADR-0025 pkt 2).
- Wpisy dziennika (notatki) tworzone z telefonu (`CreateTimelineEntry`) — ten sam wzorzec odczytu bez blokady (`mutation-target.ts`); wymaga osobnej oceny, czy i jak usuwanie obejmuje wpisy (patrz „Notatki”); nie jest częścią tej historyjki.
- Pozostałe ścieżki mediów — **sprawdzone w kodzie, bez zmian, do potwierdzenia testem w realizacji:** części sesji, `complete`, `abort` (`SessionAccess.open` z blokadą pliku `FOR NO KEY UPDATE` i odmową `file_erased` po usunięciu, usuwanie blokuje pliki `FOR UPDATE`); zmiana metadanych medium (`update-media-asset`) i zlecenie odczytu/pobrania (nie tworzą danych przy nagrobku).
- Zmiana trybu `report`/`enforce` i reguł 90 / 14 dni (EVM-139), nowe kody błędów, zmiany kontraktu OpenAPI i protokołu synchronizacji.

## Decyzje i ograniczenia
- Decyzja Konrada (2026-11-23): rozwiązanie jak ADR-0025 M1 — `lockVisible` (`FOR NO KEY UPDATE`, polityka odczytu w zapytaniu) przed sprawdzeniem klienta i statusu; po `COMMIT` usuwania ponowna ocena widoczności daje `404`.
- Blokada obowiązuje każde zlecenie (nie rozpoznajemy wizji przed odczytem); transakcje są krótkie, a wzorzec jest już użyty w modułach `payments`, `procedures`, `work-orders`. Ryzyko: kolejkowanie równoległych dodawań mediów do tego samego zlecenia — do zmierzenia w realizacji, bez zmiany zakresu.
- Bezpieczeństwo: brak nowych danych i endpointów; kontrola ról bez zmian (AC5); błędy bez ujawniania istnienia wizji (jak dziś `404`).

## Notatki
- Do decyzji po realizacji: osobna historyjka dla notatek z telefonu (ten sam wzorzec odczytu bez blokady; do ustalenia, czy tekst wpisu mógłby przetrwać przy nagrobku).
- Priorytet P2: okno wyścigu jest wąskie (zatwierdzenie między porównaniem zbioru a `COMMIT`), ale skutek — dane osobowe przy nagrobku — wymaga zamknięcia przed `enforce` (ADR-0025 pkt 9).

## Dziennik
- 2026-11-23 — utworzono (product-owner) na decyzję Konrada; stan: draft
