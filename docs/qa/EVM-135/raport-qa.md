# EVM-135 — raport weryfikacji QA

Historyjka: [EVM-135](../../backlog/M2/EVM-135-api-wizja-lokalna-zakladanie.md) (AC1–AC8), ADR: [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md). Data: 2026-11-17. Weryfikator: qa-engineer, niezależnie od raportów wykonawców. Zakres: gałąź `feature/queue-2026-11-16-wizja-lokalna-c`, głowa `e0715114` (gałąź zintegrowana, zawiera też inne historyjki; oceniam wyłącznie funkcje EVM-135).

## Werdykt: PASS z uwagami

AC1–AC8 spełnione; każde zdanie „Wtedy” ma test z asercjami na stanie bazy i kodach HTTP, z przypadkiem negatywnym. Brak blockerów i major. Odstępstwa od litery AC rozstrzygnął Tech Lead (§ 3) — oceniam je jako „PASS z uwagą do decyzji właściciela”. Dopisałem 3 testy brzegowe (zielone).

## 1. Macierz AC → testy → wynik

Skrót: `IT` = `apps/api/test/integration/`, `C` = `packages/contracts/test/`.

| AC | Wynik | Dowód (testy) | Ocena asercji |
|---|---|---|---|
| AC1 telefon | PASS | `IT/site-survey-create-sync.test.ts` „EVM-135 AC1” ×6: Edytor z istniejącą lokalizacją (status Wycena, numer `ZL-`, brak klienta i szablonu, pusta kompozycja, termin +90 dni, twórca i opiekun, `origin mobile_quick`, audyt, zmiana w `change_log`); Administrator z `newSite` i tytułem; powtórzenie = duplikat z tym samym numerem bez drugiego zlecenia i lokalizacji, inna treść z tym samym `mutationId` = `idempotency_mismatch`; po wygaśnięciu rekordu idempotencji własna wizja = duplikat `idempotency_expired`, cudzy użytkownik = `id_conflict`; limit 20 nowych lokalizacji wspólny z `CreateQuickWorkOrder`, 21. = `quota_exceeded` bez zapisu; `CreateQuickWorkOrder` bez klienta nadal `validation_failed /customerId`. Kontrakt: `C/site-survey-contract.test.ts` „AC1”. | Asercje na wierszach bazy; jest przypadek negatywny i brak duplikatu. |
| AC2 panel | PASS | `IT/site-survey-create-panel.test.ts` „AC2” ×4: `201`, `Location`, szczegóły z `siteSurvey` bez klienta, numer, brak opiekuna gdy niepodany, audyt; opiekun nieaktywny = `400 assignee_unavailable`, nic nie zapisane; ten sam `Idempotency-Key` = powtórka, inne ciało = `422`; zwykłe zlecenie bez klienta nadal `400`. `C/…` „AC2” (`CreateWorkOrderRequest` bez zmian). | OK. |
| AC3 walidacja, flaga, limit | PASS z uwagą (kod kwoty) | Telefon: `site-survey-create-sync` „AC3” ×4 — brak lokalizacji, obie lokalizacje, telefon nie-E.164, klient lub szablon w ładunku = `validation_failed` z polem i kodem, nigdy z wartością; istniejące `id` (własne, cudze, usunięte) = to samo `id_conflict`; usunięta lokalizacja = `target_unavailable`; flaga wyłączona = `feature_disabled` przed oceną ładunku, bez zapisu, numeru i rekordu idempotencji; kwota = `quota_exceeded` (AC1). Panel: `site-survey-create-panel` „AC3” ×3 (`400`; `409 id_conflict` bez danych istniejącego zlecenia; `404` dla braku/usuniętej lokalizacji; flaga wyłączona = `404` przed oceną ciała). Flaga odczytywalna: `site-survey-switch.test.ts` ×2 (`features.siteSurveys` w sesji panelu i `ClientConfig`; brak lub `false` = false). Wartość we wdrożeniu: `infra/runtime/compose.staging.yaml:60` i `compose.dev.yaml:76` ustawiają `'true'`, `tools/repo-policy/test/compose.dev.test.ts:183`; domyślnie w kodzie `false` (deny by default). | Odstępstwo: kod kwoty to `quota_exceeded`, nie `sync_quota_exceeded` (rozstrzygnięcie TL). |
| AC4 polityka dostępu | PASS | `IT/site-survey-visibility.test.ts` ×8: manifest odczytów zlecenia (szczegóły i dzieci — media, dziennik itd.) jest generowany, nie ręczny; Tylko odczyt dostaje `404` z identycznym ciałem jak dla nieistniejącego zlecenia na każdym odczycie, a na zapisach `403` przed czymkolwiek; A i E czytają; niezalogowany `401` na każdym; lista, widoki i wyszukiwanie (numer, tytuł, adres): R nie znajduje, A i E tak; „inne zlecenia lokalizacji”: R nie widzi wizji pod tym samym adresem; po przypisaniu klienta R czyta. IDOR: `id_conflict` bez danych istniejącego zlecenia (`create-panel`), jedna odpowiedź dla brakującego i usuniętego. Macierz ról: `IT/role-matrix.test.ts` (generowana z kontraktu, kompletność kontrakt = router = macierz 100%, każda komórka; w tym `createSiteSurvey`). Mój test: wyszukiwanie po polskich znakach (§ 4). | Asercje na statusach i ciałach; porównanie ciał z brakującym zleceniem. |
| AC5 zakres repliki | PASS | `IT/site-survey-sync-scope.test.ts` ×6: A (twórca) i B (opiekun) dostają, C nie dostaje ani wiersza, ani wzmianki (także lokalizacji); migawka wizji dla C = `404`; nowa reguła podnosi wersję zakresu raz (294), kursor starej wersji = `resync_required scope_changed`; zmiana opiekuna podnosi `version`, nowy opiekun dostaje, poprzedni traci przy pełnym pobraniu; wizja z panelu bez opiekuna tylko u twórcy; po przypisaniu klienta w zakresie każdego Edytora, zwykłe zlecenie bez zmian. N-1: `packages/sync-core/test/pull-parse.test.ts:200` (czytnik czyta `siteSurvey` i `customerId null` bez resyncu) oraz `C/…` „AC5” (czytnik N-1 bez pola). | Asercje na odpowiedzi pull dla trzech telefonów. |
| AC6 lista, filtr, raporty | PASS z uwagą (`requesterPhone`) | `IT/site-survey-list.test.ts` ×6: domyślnie wizje razem ze zleceniami, wizja ma `siteSurvey {expiresAt, extensionCount, requesterPhone}`, `customer null`, `site null`, zwykłe `siteSurvey null`; adres tylko zwykłego zlecenia, nigdy wizji; `only` / `exclude`, kursor zachowuje filtr, kursor innego filtru = `400 invalid_cursor`; sortowanie po terminie rosnąco z `only`, bez filtra `400 /sort`; raporty (widoki `overdue_payments`, `unpaid`, lista nieopłaconych transz) pomijają otwarte wizje; projekcja ma `site_survey_expires_at`, `verify` bez dryfu; indeksy częściowe: `site-survey-migration`. | Wiersz listy zwraca `requesterPhone` zgodnie z AC6 (security rekomenduje usunięcie — decyzja właściciela, § 3). „Liczniki” rozumiem jako widoki i raporty `overview` — osobnego licznika w API nie znalazłem. |
| AC7 niezmienniki i blokady | PASS | `IT/site-survey-blocks.test.ts` ×7: lista operacji zamknięta i wyprowadzona z kontraktu (409 `customer_required` = dokładnie te operacje); na otwartej wizji każda z nich daje `409 customer_required` dla A i E bez zapisu i bez rekordu idempotencji; dokument każdej kotwicy; te same operacje na zwykłym zleceniu działają; zakres, procesy, dziennik i media można dodawać; Tylko odczyt: `404`/`403`; telefon zamawiającego na zwykłym zleceniu odrzuca baza. `IT/site-survey-migration.test.ts` ×12: zapytanie kontrolne zatrzymuje 0066 przy zleceniu bez klienta (komunikat tylko z liczbą, nic z 0066 nie zostaje), po nadaniu klienta migracja przechodzi i CHECK-i są zwalidowane; istniejące zlecenia nietknięte, N-1 pisze bez nowych kolumn; „bez klienta i bez terminu” odrzucone dla każdego statusu; wizja ze statusem spoza {Wycena, Wstrzymane, Anulowane} odrzucona; telefon E.164 i najwyżej 2 przedłużenia; telefon tylko przy otwartej wizji; kształt przypisania z EVM-136 (jedno `UPDATE`) przyjęty, połowa odrzucona; znacznik usunięcia zapisywany raz; indeksy; logiczne cofnięcie migracji. | Baza jest drugą linią obrony (testy na SQL). |
| AC8 adres i telefon | PASS | `IT/site-survey-redaction.test.ts` ×4: logi, audyt, `sync.change_log`, alerty, skrzynka nadawcza e-mail (powiadomienia), metryki i pliki mediów bez adresu i telefonu (wartości-znaczniki); odpowiedzi odmów (walidacja, istniejące `id`, brak lokalizacji, limit) bez adresu i telefonu; lista nazywa wizje numerem; `search_text` bez telefonu, wyszukiwanie po telefonie nic nie znajduje. Dodatkowo „AC8” w `create-sync` i `create-panel` (logi, audyt, `change_log`, odmowy). | Wartości-znaczniki i skanowanie tekstu całej odpowiedzi/tabeli. |

## 2. Uruchomione komendy i wyniki

| Komenda | Wynik |
|---|---|
| `docker compose -f compose.yaml run --rm backend-tests pnpm --filter @evia/contracts run build` | kod 0 |
| `… @evia/api exec vitest run --coverage.enabled=false test/work-orders test/sync test/authorization test/overview` | 39 plików, 389 testów — zielone |
| `… vitest run --config vitest.integration.config.ts` na 16 plikach (`site-survey-*` ×12, `work-order-customer-assignment`, `work-order-accepted-needs-customer`, `work-orders-list-customer-site`, `role-matrix`) — jeden przebieg | 16 plików, 137 testów — zielone (135,6 s) |
| Mój `site-survey-qa-edges.test.ts` (osobny przebieg) | 1 plik, 3 testy — zielone |
| `pnpm --filter @evia/contracts exec vitest run --coverage.enabled=false` | 31 plików, 335 testów — zielone |
| `pnpm --filter @evia/contracts run baseline:check` | kod 0 |
| `prettier` i `eslint` na nowym pliku | czyste |

Pokrycie (globalne i zmienionego kodu), pełny `test:integration`, `gate`, skany, E2E: **nie uruchamiałem** (zgodnie z zadaniem — pełny zestaw idzie w CI).

## 3. Rozstrzygnięcia Tech Leada — ocena

| Odstępstwo od AC | Ocena |
|---|---|
| AC3: kod kwoty `quota_exceeded` zamiast `sync_quota_exceeded` | PASS z uwagą do decyzji właściciela. Kod istniejący, wspólny z `CreateQuickWorkOrder`; test AC1 dowodzi, że 21. = `quota_exceeded` bez zapisu. Rekomendacja: poprawić brzmienie AC3 przy zamknięciu. |
| AC6: `requesterPhone` w wierszu listy | PASS (zgodnie z AC6); uwaga: telefon zamawiającego to dana osobowa widoczna w odpowiedzi listy dla A i E (R nie widzi wizji). Security rekomenduje usunięcie — decyzja właściciela. |
| Poza zakresem: lokalizacja wizji widoczna dla Tylko odczyt w wyszukiwaniu lokalizacji; limit otwartych wizji | Nie oceniam (EVM-140 i decyzja właściciela). `site-survey-visibility` dowodzi, że R nie widzi wizji w „innych zleceniach lokalizacji”, ale wiersza lokalizacji w wyszukiwaniu lokalizacji nie testuję — to ten znany wyjątek. |

## 4. Dodane testy

`apps/api/test/integration/site-survey-qa-edges.test.ts` — 3 testy, zielone:
1. `EVM-135 AC3 EVM-136 AC1` przełącznik jest WYŁĄCZONY w aplikacji testowej, a przypisanie klienta do istniejącej wizji nadal działa (przełącznik bramkuje tylko zakładanie);
2. `EVM-136 AC1` wizja po terminie, jeszcze nieusunięta, jest nadal otwarta: przypisanie `200`, termin wyczyszczony;
3. `EVM-135 AC4` wyszukiwanie po polskich znakach (`Żółć`, `Łąka`, `Źdźbło`) w tytule wizji: A i E znajdują, Tylko odczyt nie.

## 5. Przypadki brzegowe (czytanie kodu i testów)

| Przypadek | Wynik |
|---|---|
| Powtórka komendy po wygaśnięciu rekordu idempotencji | jest test (`create-sync`: `idempotency_expired`) — własna wizja duplikat, cudzy `id_conflict` |
| Wizja z wyłączoną flagą | jest test (telefon `feature_disabled`, panel `404`, nic nie zapisane) + mój test (flaga bramkuje tylko zakładanie) |
| Migracja przy istniejącym zleceniu bez klienta | jest test (`site-survey-migration`: zatrzymanie z samą liczbą w komunikacie, nic nie zostaje; po nadaniu klienta przechodzi) |
| Zmiana opiekuna | jest test (`sync-scope`: wersja zlecenia rośnie, poprzedni traci przy pełnym pobraniu) |
| Daty wokół zmiany czasu `Europe/Warsaw` | termin to 90 × 24 h od chwili UTC (`site-survey.ts`), więc zmiana czasu niczego nie przesuwa; osobnego testu na przejście czasu nie ma (minor N1) |
| Polskie znaki | tytuły z polskimi literami w `create-sync` / `create-panel` (zapis, przycięcie spacji); wyszukiwanie — mój test; sortowanie wizji tylko po terminie |
| Przerwany upload, brak sieci, duże pliki | poza zakresem API tej historyjki |

## 6. Ustalenia

| ID | Ważność | Opis | Rekomendacja |
|---|---|---|---|
| N1 | minor | Brak testu, że termin +90 dni jest stały w UTC przez przejście czasu w `Europe/Warsaw` (zachowanie poprawne z kodu). | Opcjonalny test jednostkowy `siteSurveyExpiry` z datą założenia tuż przed 2026-10-25. |
| N2 | minor | `requesterPhone` (dana osobowa) w wierszu listy — zgodne z AC6, ale rozszerza ekspozycję telefonu. | Decyzja właściciela (rekomendacja security: usunąć z listy, zostawić w szczegółach). |
| N3 | nit | AC3 i AC6 dosłownie niezgodne z kodem (kod kwoty; „liczniki” jako osobny byt). | Poprawić brzmienie AC przy zamknięciu historyjki. |

Blockerów i major brak.

## 7. Jak to sprawdzić (dla właściciela, dane testowe)

1. Środowisko lokalne z `SITE_SURVEYS_ENABLED=true` (`compose.dev.yaml`). Jako Edytor wywołać `POST /api/v1/site-surveys` z `id` (UUIDv7), `siteId` testowej lokalizacji, `title`, `requesterPhone` `+48600000001` — `201` i `Location`; szczegóły: status „Wycena”, numer `ZL-…`, bez klienta, termin = dziś + 90 dni.
2. Ten sam `id` jeszcze raz — `409 id_conflict`; telefon `600000001` — `400` z polem, bez wartości.
3. Jako Tylko odczyt: lista, wyszukiwanie po numerze i `GET` wizji — brak wizji, szczegóły `404`.
4. Lista Edytora: `?siteSurvey=only` pokazuje tylko wizje, `exclude` tylko zlecenia; w odpowiedzi brak adresu wizji.
5. Płatność lub dokument dla wizji — `409 customer_required`; dodanie zakresu i wpisu w dzienniku działa.
6. Telefon (emulator): technik-twórca i opiekun widzą wizję po synchronizacji, inny Edytor nie.

## 8. Czego nie sprawdziłem

Pokrycia (globalnego i zmienionego kodu), pełnego `test:integration`, `gate`, skanów, E2E, testów mutacyjnych, aplikacji mobilnej na urządzeniu; sesji eksploracyjnej na żywej aplikacji (zakaz łączenia ze środowiskiem); zachowania pod obciążeniem (testy wydajnościowe listy bywają niestabilne pod obciążeniem partii — informacja wykonawcy, nie odtwarzałem).
