# EVM-139 — raport weryfikacji QA

Historyjka: [EVM-139](../../backlog/M2/EVM-139-api-wizja-lokalna-automatyczne-usuwanie.md) (AC1–AC6), ADR: [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md). Data: 2026-11-17. Weryfikator: qa-engineer, niezależnie od raportów wykonawców. Zakres: gałąź `feature/queue-2026-11-17-wizja-lokalna-wygasanie`, głowa `8d13a9ba` (gałąź zintegrowana z EVM-140; oceniam funkcje EVM-139).

## Werdykt: PASS z uwagami

AC1–AC5 spełnione, AC6 **częściowo** (kod, testy i runbook są; osobnego poświadczenia `worker` do rejestru w IaC brak — świadomie, § 3). Brak blockerów. Tryb `enforce` pozostaje wyłączony (`SITE_SURVEY_PURGE_MODE: report` w `compose.staging.yaml`).

## 1. Macierz AC → testy → wynik

`IT` = `apps/api/test/integration/`.

| AC | Wynik | Dowód | Ocena asercji |
|---|---|---|---|
| AC1 kandydaci i `report` | PASS | `IT/site-survey-purge.test.ts` „AC1” ×2: tryb `report` — kandydaci tylko z trzema warunkami (przed terminem, z klientem, termin równo = nie), `everything()` (zlecenia, lokalizacje, media, pliki, dziennik) identyczne przed/po, rejestr bez wywołań, liczba w dzienniku i mierniku bez sentineli; zegar kontrolowany: dzień 89 = 0, 91 = 1. Konfiguracja: `test/platform/config.test.ts` (domyślnie `report`, `enforce` tylko dla dokładnego słowa, inne wartości zatrzymują start). Dodane: termin równo = nie, +1 ms = tak; domyślny tryb bez zmiennej. | `change_log` i audyt w `report` sprawdzone pośrednio (stan tabel + brak wywołań rejestru). |
| AC2 `enforce`: rejestr przed zmianą | PASS | „AC2” ×3 + `site-survey-purge-migration.test.ts` ×8: rejestr wywołany, gdy baza jest jeszcze nietknięta (`onRecord` robi migawkę równą stanowi przed); wpis ma tylko identyfikatory (bez sentineli); nagrobek: neutralny tytuł, brak opisu / telefonu / powodu, numer zachowany, `deleted_at` = `site_survey_purged_at`; lokalizacja zanonimizowana tylko gdy utworzona dla wizji i niewskazywana przez inne (negatywy: obca, trzymana przez inne zlecenie lub dokument, starsza niż okno); media: obiekty usunięte, pliki `erased_at`, sesje przerwane; wpisy dziennika zredagowane; błąd rejestru = wizja nietknięta + audyt + alert + porażka zadania; migracja: CHECK-i, trigger nieodwracalności (`EV001`), jednokrotny zapis (`EV003`). | Kolejność „rejestr → zmiana” dowiedziona migawką bazy w chwili zapisu, nie samym porządkiem kodu. |
| AC3 anulowane, klient, wyścig | PASS | `IT/site-survey-purge-resilience.test.ts` „AC3” ×3: anulowana z terminem w przeszłości usunięta, przywrócona z terminem +14 dni nie (13 dni = nic, 15 = kandydat); wyścig: transakcja przypisująca klienta TRZYMA blokadę wiersza (niezatwierdzona), zadanie w tym czasie pomija wiersz (`purged: 0`), po zatwierdzeniu wizja nie jest kandydatem, rejestr bez wywołań, dane i klient nietknięte; dwa równoległe przebiegi = jeden wpis i jeden nagrobek. Baza: CHECK klient + purged (`23514`). | Współbieżność jest wymuszona (otwarta transakcja), nie założona. |
| AC4 synchronizacja i kolejki | PASS z uwagą (uzupełnione) | „AC4” ×1: `change_log` ma `delete` dla zlecenia, bez sentineli; panel: media i zlecenie `404` dla Administratora i Tylko odczyt. Uwaga: asercja `stateOf` przyjmowała `target_unavailable` ALBO `forbidden` — to osłabia dowód (`forbidden` znaczy brak dostępu, nie „usunięte”). Dla Administratora i Edytora polityka `access` zawsze daje dostęp, więc oczekiwanie ścisłe jest poprawne. **Dopisany test ścisły** (przez `POST /sync/mutations`, Edytor-twórca): notatka do usuniętej wizji = `rejected target_unavailable`, to samo przy powtórce, nic nie zapisane, brak adresu w pull. | Dowód AC4 jest teraz kompletny. Pliki z kolejki idą tą samą ścieżką `stateOf` (kod `#performMedia`). |
| AC5 odporność | PASS | „AC5” ×3: awaria po commicie — pliki oznaczone, sweep `worker` kończy, jeden wpis rejestru, brak osieroconych obiektów; błąd jednej wizji nie zatrzymuje pozostałych, porażka zadania z jednym alertem, następny przebieg bierze resztę; limit 50 usunięć na przebieg; dziennik bez danych osobowych. | |
| AC6 uprawnienia i klucz | PASS częściowo | „AC6” ×1: brak trasy usunięcia „od ręki” (`404/405`) dla Administratora (ze step-upem) i Edytora; rola aplikacji `evia_app` nie ma `DELETE` na pięciu tabelach zadania; okresy jako stałe w kodzie (test granic w AC1/AC3, `config.test.ts`); runbook `retencja.md` „Włączenie `enforce` — kroki”. **Brak:** osobnego poświadczenia `worker` (wyłącznie `PutObject`) w IaC — wykonawca świadomie nie ruszył manifestu sekretów (zatrzymałoby kanał wdrożeń do czasu pliku sekretu); są tylko kroki (aplikacja `register_writer_worker` w `object-storage/main.tf`, sekret na VM, `bucket-verify.sh`). Fail-closed bez klucza opisany w runbooku. | Do dokończenia w sesji IaC przed włączeniem `enforce`; część IaC niezamknięta. Test „bez `DELETE`” dotyczy `evia_app`; osobnej roli `worker` nie ma (minor). |

## 2. Uruchomione komendy i wyniki

Wspólne z EVM-140 (jeden zestaw): kontrakt (natywnie i w kontenerze) kod 0; integracyjne 12 plików — 110 testów, w tym `site-survey-purge` 5, `-purge-resilience` 8, `-purge-migration` 8, `migrations` 13, `worker-verify` 3 (harmonogramy zadań), `role-matrix` 17 — zielone (jedyny czerwony test, `email-outbox-kind-migration`, to EVM-140 F1, naprawiony); `test/work-orders` 137 testów zielone (w tym jednostkowy `site-survey-purge.test.ts`); mój plik 6 testów zielone. Pokrycie, pełny `test:integration`, `gate`, skany, Playwright: nie uruchamiałem (zgodnie z zadaniem).

## 3. Ustalenia

| ID | Ważność | Opis |
|---|---|---|
| F1 | minor / do decyzji | AC6 część IaC: brak osobnego poświadczenia `worker` do rejestru — blokada dla włączenia `enforce`, nie dla scalenia (tryb `report`). Zapisane w runbooku i modelu zagrożeń; zalecam jawny wpis w historyjce przy `done`. |
| F2 | minor | Test AC4 nie miał wersji ścisłej — dopisana (§ 4). |
| F3 | minor | Dowód „worker bez `DELETE`” dotyczy roli `evia_app`; nie ma testu osobnej roli `worker`. |

## 4. Dodane testy

`apps/api/test/integration/site-survey-expiry-qa-edges.test.ts` (6 testów, zielone; commit `7f8742f3`): `EVM-139 AC4` ścisłe `rejected target_unavailable` dla twórcy (przez API synchronizacji, z powtórką), `EVM-139 AC3` granica ścisła terminu (równo = nie, +1 ms = usunięta), `EVM-139 AC1` domyślny tryb `report` — plus 3 testy EVM-140 (raport EVM-140).

## 5. Jak sprawdzić ręcznie

W trybie `report` (domyślny na stagingu): po przebiegu zadania `work-orders.site-survey-purge` (03:20) w dzienniku jest wpis „site survey purge: report only” z liczbą kandydatów, a w bazie nic się nie zmienia. `enforce` — dopiero po kopiach zapasowych i kluczu rejestru (runbook `retencja.md`).
