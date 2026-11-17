# EVM-136 — raport weryfikacji QA

Historyjka: [EVM-136](../../backlog/M2/EVM-136-api-wizja-lokalna-przypisanie-klienta.md) (AC1–AC6), ADR: [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md). Data: 2026-11-17. Weryfikator: qa-engineer, niezależnie od raportów wykonawców. Zakres: gałąź `feature/queue-2026-11-16-wizja-lokalna-c`, głowa `e0715114` (gałąź zintegrowana; oceniam wyłącznie funkcje EVM-136).

## Werdykt: PASS z uwagami

AC1–AC6 spełnione; każde zdanie „Wtedy” ma test z asercjami na stanie bazy i kodach HTTP, z przypadkiem negatywnym i testem wyścigu. Brak blockerów i major. Cztery odstępstwa od litery AC rozstrzygnął Tech Lead (§ 3) — oceniam je jako „PASS z uwagą do decyzji właściciela”, kod robi to, co opisano. Dopisałem 3 testy brzegowe (wspólne z EVM-135, zielone).

## 1. Macierz AC → testy → wynik

Skrót: `IT` = `apps/api/test/integration/`, `U` = `apps/api/test/`, `C` = `packages/contracts/test/`.

| AC | Wynik | Dowód (testy) | Ocena asercji |
|---|---|---|---|
| AC1 przypisanie | PASS | `IT/work-order-customer-assignment.test.ts` „AC1” ×4: dla Edytora i Administratora `200`, JEDNO `UPDATE` ustawia klienta i zeruje termin, licznik przedłużeń, przypomnienie i telefon zamawiającego; numer, lokalizacja, status, media i wpisy bez zmian (porównanie wierszy przed/po); audyt `work_order.customer_assigned` (aktor, `object_type`, bez treści) i dokładnie jeden wpis dziennika `work_order_customer_assigned` z samymi identyfikatorami; karta klienta odpowiada, projekcja ma klienta i brak terminu, `PATCH customerId` nadal `read_only_field`; wizja wstrzymana dostaje klienta i zostaje wstrzymana. | Asercje `toEqual` na pełnych wierszach i audycie. |
| AC2 jednorazowość, idempotencja, konflikty | PASS z uwagą (`412`) | `IT/work-order-customer-assignment.test.ts` „AC2” ×9: ten sam klient = `200` bez zmian także ze starą wersją sprzed pierwszego wywołania, bez drugiego audytu i wpisu dziennika; ten sam `Idempotency-Key` = powtórka (`Idempotent-Replayed`), ten sam klucz na innej wizji = `422 idempotency_mismatch`; inny klient = `409 customer_already_set`, nic się nie zmienia; zwykłe zlecenie z innym klientem = `409`; anulowana wizja = `409 invalid_state_transition`; nieaktualna wersja = `412 version_conflict`, nic się nie zmienia; dwa równoległe przypisania RÓŻNYCH klientów = dokładnie jeden `200` i jeden `409 customer_already_set`, jeden wpis audytu; dwa równoległe TEGO SAMEGO klienta = oba `200`, jeden zapis; ciało ścisłe (brak pola, zły id, wersja < 1, pole serwera, nieznane pole = `400` ze wskaźnikiem bez wartości). Kontrakt: `C/customer-assignment-contract.test.ts` „AC2”, „AC2 AC3”. | Test współbieżności uruchamia dwa żądania równolegle i sprawdza stan końcowy. Odstępstwo: `412` zamiast `409` (TL). |
| AC3 uprawnienia i IDOR | PASS z uwagą (token aplikacji, kanał) | „AC3” ×6 w `work-order-customer-assignment.test.ts`: Tylko odczyt `403`, niezalogowany `401`, sesja kanału mobilnego odmówiona (`403 forbidden`), nic się nie zmienia; brakujące i usunięte zlecenie = JEDNA odpowiedź `404` (ten sam status i ciało poza śladem) dla A i E; klient brakujący, usunięty, zanonimizowany lub niewidoczny = `422 customer_unavailable` (jedna odpowiedź), wizja bez zmian; blokada klienta `FOR KEY SHARE` po zleceniu — usunięcie klienta trzymające blokadę każe przypisaniu czekać, a zatwierdzone wcześniej daje `422`; baza jako druga linia (CHECK-i `23514`); redakcja W5 (audyt, logi, dziennik, `change_log`, kolejka e-mail, problemy bez adresu i telefonu). Macierz: `IT/role-matrix.test.ts` „EVM-136 AC3 assignWorkOrderCustomer” (A i E web tak; R, mobile, `mfa_enrollment`, anonim nie; usunięte cudze zlecenie `404` dla obu) + generowana macierz kontraktu. | Odstępstwo: sesja kanału aplikacji = `403 forbidden`, token aplikacji = `401` (AC mówi `channel_not_allowed`) — rozstrzygnięcie TL. |
| AC4 „Zaakceptowane” wymaga klienta | PASS z uwagą (zakres reguły) | `IT/work-order-accepted-needs-customer.test.ts` ×6: wizja w „Wycena”: A i E dostają `409 customer_required` na `accepted`, status, wersja, audyt i dziennik bez zmian; wznowienie wizji wstrzymanej wraca do „Wycena”, a `accepted` nie jest wierszem tabeli z „Wstrzymane” (`invalid_state_transition`); wznowienie zlecenia bez klienta wstrzymanego z „Zaakceptowane” (dane, których komenda nie tworzy) = `409 customer_required` dla każdej roli; po przypisaniu klienta to samo przejście = `200`; kolejność kontroli (R `403` → brak wiersza `invalid_state_transition` → `412` → dopiero `customer_required`); zwykłe zlecenie przechodzi jak dotąd, a baza odrzuca „accepted” bez klienta (`23514`). Jednostkowo: `U/work-orders/work-order-transitions.test.ts` „EVM-136 AC4” ×5 — reguła po CELU w tabeli; każdy wiersz wymagający klienta ma cel spoza statusów wizji; **graf**: z każdego stanu bez klienta żadna ścieżka (dowolna rola, wstrzymanie, wznowienie, anulowanie, przywrócenie) nie sięga statusu zakazanego; „test testu” — bez reguły ten sam spacer DOCIERA do „accepted”. `site-survey-blocks` obejmuje też `transitionWorkOrder`. | Spacer po grafie ma kontrolę negatywną. Odstępstwo: reguła obejmuje każdy cel poza Wycena, Wstrzymane, Anulowane (lustro CHECK-a), nie tylko „Zaakceptowane” (TL) — jest to ostrzejsze, spójne z bazą. |
| AC5 odrzucenie i przywrócenie | PASS | `IT/site-survey-reject-restore.test.ts` ×13: A i E odrzucają kodem „Oferta odrzucona” / „Rezygnacja klienta” → „Anulowane”, termin = mniejsza z (obecny, teraz + 14 dni), powód = kod, audyt bez treści; termin bliższy niż 14 dni zostaje, przeterminowany zostaje w przeszłości; wizja wstrzymana też odrzucalna, wolny tekst wstrzymania bez zmian; brak kodu = `400 /reasonCode`, wolny tekst = `400 /reason not_allowed`, nieznany kod = `400`, bez echa wartości; R `403`, anonim `401`; zwykłe zlecenie anulowane jak dotąd (wolny powód, brak terminu), kod tam `400`; Edytor nie przywraca (`403 forbidden`), Administrator bez świeżego step-upu `403 step_up_required`; Administrator ze step-upem przywraca do „Wstrzymane”, termin = większa z (utworzenie + 90 dni × (1 + przedłużenia), teraz + 14 dni) — trzy przypadki tabeli; cały cykl (odrzucenie, przywrócenie, wznowienie, przypisanie klienta); zwykłe zlecenie przywracane jak dotąd bez terminu; wyścig odrzucenia i przypisania na tej samej wersji = jeden wygrywa, nigdy odrzucona wizja z klientem; redakcja W5. Jednostkowo: `U/work-orders/site-survey-deadline.test.ts`, `transition-input.test.ts`. | Wartości terminów sprawdzone co do instantu; negatywy na rolach i ciele. |
| AC6 synchronizacja po przypisaniu | PASS | `IT/site-survey-assign-sync.test.ts` ×4: replika twórcy trzyma wizję bez klienta, po przypisaniu następne pobranie przynosi zlecenie z `customerId`, którego replika nie zna, a migawka przynosi klienta (ADR-0021 D3) — projekcja klienta dla telefonu (nazwa i telefon, bez e-maila i notatek), wywołanie idempotentne; panel pokazuje klienta w szczegółach i na liście; `change_log` tylko z identyfikatorami. `IT/site-survey-assign-scope.test.ts` ×5: Edytor C bez dotychczasowego dostępu nie ma wizji, po przypisaniu dostaje jak zwykłe zlecenie; `siteSurvey=only` nie zwraca, `exclude` zwraca, raporty (nieopłacone) po przypisaniu ją wymieniają; Tylko odczyt: `404` przed, widzi po; projekcja traci termin i `verify` bez dryfu, także po odrzuceniu i przywróceniu. | Asercje na odpowiedziach pull dla dwóch telefonów i na tabelach raportowych. |

## 2. Uruchomione komendy i wyniki

Te same przebiegi co dla EVM-135 (jeden zestaw, obejmuje obie historyjki):

| Komenda | Wynik |
|---|---|
| `docker compose -f compose.yaml run --rm backend-tests pnpm --filter @evia/contracts run build` | kod 0 |
| `… @evia/api exec vitest run --coverage.enabled=false test/work-orders test/sync test/authorization test/overview` | 39 plików, 389 testów — zielone |
| `… vitest run --config vitest.integration.config.ts` na 16 plikach (w tym `work-order-customer-assignment` 18, `work-order-accepted-needs-customer` 7, `site-survey-reject-restore` 13, `site-survey-assign-sync` 4, `site-survey-assign-scope` 5, `role-matrix`) — jeden przebieg | 16 plików, 137 testów — zielone |
| Mój `site-survey-qa-edges.test.ts` | 1 plik, 3 testy — zielone |
| `pnpm --filter @evia/contracts exec vitest run --coverage.enabled=false` | 31 plików, 335 testów — zielone |
| `pnpm --filter @evia/contracts run baseline:check` | kod 0 |

Pokrycie (globalne i zmienionego kodu), pełny `test:integration`, `gate`, skany, E2E: **nie uruchamiałem** (zgodnie z zadaniem).

## 3. Rozstrzygnięcia Tech Leada — ocena

| Odstępstwo od AC | Ocena |
|---|---|
| AC2: nieaktualna wersja `412 version_conflict` (AC: `409` „jak dziś”), `version` w ciele | PASS z uwagą. `412` to jedyny kod API dla konfliktu wersji (komentarz w teście i opis kontraktu, `If-Match` → `412` w pozostałych operacjach); AC „jak dziś” w istocie żąda spójności z resztą API. Rekomendacja: poprawić brzmienie AC2. |
| AC3: sesja kanału aplikacji `403 forbidden`, token aplikacji `401` | PASS z uwagą (jak w EVM-134 AC5): `401` jest ostrzejsze (operacje kanału `web` nie czytają tokenu Bearer — SR-AUTHZ-12). Rekomendacja: usunąć `channel_not_allowed` z AC3. |
| AC4: reguła „wymaga klienta” dla każdego celu poza Wycena / Wstrzymane / Anulowane | PASS z uwagą. Ścisła nadgrupa AC (obejmuje `accepted`), lustro CHECK-a bazy; test grafu dowodzi braku obejścia. |
| Przypisanie do odrzuconej wizji = `409 invalid_state_transition` | PASS z uwagą: test w AC2 („cancelled survey”); chroni przed użyciem przypisania do wyjścia z „Anulowane” bez Administratora i step-upu. Spoza AC — zapisać w historyjce. |

## 4. Dodane testy

`apps/api/test/integration/site-survey-qa-edges.test.ts` (wspólny z EVM-135) — test 1: przełącznik WYŁĄCZONY, a przypisanie klienta do istniejącej wizji działa; test 2 (`EVM-136 AC1`): wizja po terminie, jeszcze nieusunięta, jest nadal otwarta — przypisanie `200`, termin wyczyszczony. Zielone.

## 5. Przypadki brzegowe (czytanie kodu i testów)

| Przypadek | Wynik |
|---|---|
| Równoległe przypisanie klienta i odrzucenie | jest test (`reject-restore`: jeden wygrywa, brak odrzuconej wizji z klientem) |
| Dwa równoległe przypisania (różni / ten sam klient) | jest test (jeden `200` + `409` / dwa `200`, jeden zapis, jeden audyt) |
| Równoległe przypisanie i usunięcie klienta | jest test (`FOR KEY SHARE`: oczekiwanie lub `422`) |
| Przywrócenie po terminie | jest test (trzy przypadki tabeli: termin wcześniejszy/późniejszy niż teraz + 14 dni; termin = większa z wartości); `U/site-survey-deadline.test.ts` |
| Odrzucenie po terminie (termin już w przeszłości) | jest test („stays in the past”, P4) |
| Przypisanie do wizji po terminie, jeszcze nieusuniętej | mój test (200) |
| Przypisanie do odrzuconej wizji / wstrzymanej | jest test (`409 invalid_state_transition` / klient przypisany, status bez zmian) |
| Wyłączona flaga | przypisanie, odrzucenie i przywrócenie działają przy wyłączonej fladze funkcji (harness `useDeletionApp` nie ustawia flagi; mój test to potwierdza jawnie) |
| Zmiana opiekuna | pokryte w EVM-135 AC5; w EVM-136 opiekun nie zmienia reguł przypisania (A i E) |
| Daty wokół zmiany czasu | dni = 24 h UTC (`site-survey-deadline.ts`, komentarz w kodzie); bez osobnego testu na przejście czasu (minor N1) |
| Brak sieci / duże pliki / przerwany upload | nie dotyczy (operacje panelu, media bez zmian) |

## 6. Ustalenia

| ID | Ważność | Opis | Rekomendacja |
|---|---|---|---|
| N1 | minor | Brak testu jednostkowego, że terminy odrzucenia/przywrócenia (24 h UTC) nie zależą od zmiany czasu w `Europe/Warsaw`. | Opcjonalny test z datą wokół 2026-10-25 / 2027-03-28. |
| N2 | minor | Zakładanie `version` w ciele zamiast `If-Match` różni tę operację od reszty zapisów zlecenia (wybór zgodny z AC). | Zapisać w `api-guidelines.md` lub w opisie operacji (opis kontraktu już mówi). |
| N3 | nit | AC2, AC3 i AC4 dosłownie niezgodne z kodem (`412`, `channel_not_allowed`, zakres reguły) — rozstrzygnięcia TL. | Poprawić brzmienie AC przy zamknięciu historyjki. |

Blockerów i major brak.

## 7. Jak to sprawdzić (dla właściciela, dane testowe)

1. Mając wizję (EVM-135) i testowego klienta, jako Edytor: `PUT /api/v1/work-orders/{id}/customer` z `customerId` i bieżącą `version` — `200`; zlecenie ma klienta, brak terminu wygaśnięcia i telefonu zamawiającego; numer i zdjęcia bez zmian; w dzienniku wpis o przypisaniu klienta.
2. To samo wywołanie ponownie — `200` bez zmian; inny klient — `409 customer_already_set`; stara wersja — `412`.
3. Wizja bez klienta: przejście do „Zaakceptowane” — `409 customer_required`; po przypisaniu klienta działa.
4. Anulowanie wizji z kodem „Oferta odrzucona” — status „Anulowane”, termin skrócony do najwyżej 14 dni; Edytor nie przywraca (`403`); Administrator ze świeżym potwierdzeniem (klucz lub kod) przywraca do „Wstrzymane”.
5. Telefon (emulator): po przypisaniu klienta w panelu inny Edytor po synchronizacji widzi zlecenie jak zwykłe, z klientem.
6. Tylko odczyt: wizja `404`, po przypisaniu klienta widoczna.

## 8. Czego nie sprawdziłem

Pokrycia (globalnego i zmienionego kodu), pełnego `test:integration`, `gate`, skanów, E2E, testów mutacyjnych, aplikacji mobilnej; sesji eksploracyjnej na żywej aplikacji (zakaz łączenia ze środowiskiem); interfejsu panelu (ekrany to EVM-138).
