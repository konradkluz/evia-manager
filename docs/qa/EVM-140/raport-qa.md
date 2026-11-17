# EVM-140 — raport weryfikacji QA

Historyjka: [EVM-140](../../backlog/M2/EVM-140-wizja-lokalna-przypomnienia-przedluzenie-limit.md) (AC1–AC6), ADR: [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md). Data: 2026-11-17. Weryfikator: qa-engineer, niezależnie od raportów wykonawców. Zakres: gałąź `feature/queue-2026-11-17-wizja-lokalna-wygasanie`, głowa `8d13a9ba` (gałąź zintegrowana z EVM-139; oceniam funkcje EVM-140).

## Werdykt: PASS z uwagami

AC1–AC6 spełnione; każde zdanie „Wtedy” ma test z asercjami na stanie bazy i kodach HTTP. Brak blockerów. Jeden błąd major w testach (naprawiony przez QA, § 4) i dwie uwagi minor.

## 1. Macierz AC → testy → wynik

`IT` = `apps/api/test/integration/`, `U` = `apps/api/test/work-orders/`, `W` = `apps/web/test/`.

| AC | Wynik | Dowód | Ocena asercji |
|---|---|---|---|
| AC1 przypomnienie | PASS | `IT/site-survey-reminder.test.ts` „AC1” ×9: jeden e-mail dla twórcy i każdego aktywnego Administratora (dezaktywowany i cudzy Edytor — nie), twórca-Administrator raz, `site_survey_reminded_at` ustawione, drugi przebieg 0 wierszy; granica 15 dni (równo = jest, +1 ms = nie, po terminie nieusunięta = jest); przypomniana / anulowana / usunięta / zwykłe zlecenie — nic; zerowanie znacznika po przedłużeniu; treść (numer, data, link, brak adresu, telefonu i tytułu), wariant B po dwóch przedłużeniach; wiadomość przestarzała (klient, odrzucenie, usunięcie) = `superseded`. `IT/email-outbox-kind-migration.test.ts` ×3. Dodany: data usunięcia w `Europe/Warsaw` wokół północy i zmiany czasu 2027-03-28. | Treść sprawdzana na wiadomościach z nadawcy w pamięci, nie tylko na wierszu outboxu. Uwaga: tytuł testu „z klientem” nie ma osobnego przypadku (CHECK bazy wymusza brak terminu przy kliencie — przypadek nieosiągalny). |
| AC2 przedłużenie | PASS | `IT/site-survey-extension.test.ts` „AC2” ×5 (Administrator i Edytor × trzy kody powodu: `200`, +90 dni, licznik, znacznik wyzerowany, wersja, audyt z kodem, wpis dziennika; drugie liczone od nowego terminu; wstrzymana też; nieznany kod i inne ciała `400` bez echa wartości; idempotencja; `412` i wyścig dwóch na tej samej wersji = jeden `200`). `U/site-survey-extension.test.ts`. | Wyścig faktycznie równoległy (dwa żądania). |
| AC3 limit 2 i warunki | PASS | „AC3” ×6: trzecie `409 extension_limit_reached`; anulowana i zwykłe zlecenie `409 invalid_state_transition`; Tylko odczyt `403`, anonim `401`, sesja i token aplikacji odmowa; brak / usunięte zlecenie = jedno `404`; CHECK bazy `23514`. `IT/role-matrix.test.ts` „EVM-140 AC3 extendSiteSurvey” (+2 komórki IDOR, macierz wygenerowana z kontraktu). | Każda rola × kanał; nic się nie zmienia po odmowie. |
| AC4 limit | PASS | `IT/site-survey-limit.test.ts` ×8: 20. utworzona, 21. `409 site_survey_limit_exceeded` bez zlecenia, numeru i audytu; limit na osobę (drugi Edytor 201); anulowane, usunięte, z klientem i zwykłe się nie liczą; przypisanie klienta i odrzucenie zwalniają miejsce; globalnie 100. dozwolona, 101. `409` także dla innej osoby; wyścig przy 19 = `[201, 409]`; telefon: 20. `applied`, 21. `rejected site_survey_limit_exceeded`, brak osieroconej lokalizacji. Web: `W/site-survey-create.test.tsx` (komunikat „Masz za dużo…”, dane zostają, ponowienie z nowym kluczem). Dodany: zwykłe zlecenie przez API przy 20 wizjach = `201`. | Granice 20/21 i 100/101 i wyścig sprawdzone w bazie, nie tylko po kodzie HTTP. |
| AC5 dane poza e-mailem i logami | PASS | `IT/site-survey-reminder.test.ts` „AC5” ×2 (outbox, audyt, `change_log`, log zadania i wiadomości bez sentineli; błąd jednej wizji nie zatrzymuje pozostałych, ta bez znacznika, następny przebieg dokańcza; log bez identyfikatorów); `IT/site-survey-extension.test.ts` „AC5”; `IT/site-survey-limit.test.ts` „AC4 AC5”. Dodany: błąd wysyłki jednej wiadomości (przejściowa odmowa nadawcy) — wiersz zostaje `pending` do ponowienia kolejki, druga wiadomość wysłana, ponowienie wysyła resztę bez duplikatu. | Wcześniej brakowało dowodu na „błąd wysyłki jednej wiadomości”; jest. |
| AC6 panel | PASS z uwagą | `W/site-survey-extend.test.tsx` ×13: dialog (trzy powody bez domyślnego, fokus), brak powodu = komunikat, licznik 0→1 (data, „Przedłużono 1 z 2 razy”), 1→2 („ostatnie”), po dwóch akcja wyłączona z podpowiedzią i osiągalna z klawiatury, offline, odrzucona wizja bez przedłużenia, `412` / `404` / utracona odpowiedź (ten sam klucz), klawiatura (strzałki, Esc, fokus), axe. `apps/web/test/e2e/site-surveys.spec.ts` (Administrator z klawiatury, Edytor, przegrany wyścig). Tylko odczyt bez wizji: EVM-138 AC6. | Playwright **nie uruchamiałem** (zgodnie z zadaniem — robi CI); ocena po kodzie specyfikacji. |

## 2. Uruchomione komendy i wyniki

| Komenda | Wynik |
|---|---|
| `pnpm --filter @evia/contracts run build` natywnie i w kontenerze | kod 0 |
| `backend-tests … vitest run --config vitest.integration.config.ts` na 12 plikach (`site-survey-extension` 17, `-limit` 8, `-reminder` 12, `email-outbox-kind-migration` 3, `-purge` 5, `-purge-resilience` 8, `-purge-migration` 8, `role-matrix` 17, `migrations` 13, `worker-verify` 3, `site-survey-create-sync` 12, `-redaction` 4) | 110 testów: 109 zielonych, 1 czerwony (`email-outbox-kind-migration`, § 4); po poprawce QA plik 3/3 zielone |
| `pnpm --filter @evia/api exec vitest run test/work-orders` | 20 plików, 137 testów — zielone |
| `pnpm --filter @evia/web exec vitest run` (3 pliki: extend, create, journal-procedure-events) | 3 pliki, 50 testów — zielone |
| Mój `site-survey-expiry-qa-edges.test.ts` | 6 testów — zielone |

Pokrycie (globalne i zmienionego kodu), pełny `test:integration`, `gate`, skany, Playwright, emulator: **nie uruchamiałem** (zgodnie z zadaniem; CI).

## 3. Macierz ról

| Funkcja | Administrator | Edytor | Tylko odczyt | Niezalogowany | Kanał `mobile` |
|---|---|---|---|---|---|
| Przedłużenie | `200` | `200` | `403` | `401` | odmowa |
| Cudze / usunięte zlecenie (IDOR) | `404` | `404` | — | — | — |
| Przypomnienie e-mailem | tak (każdy aktywny) | tylko twórca | nie | — | — |
| Limit przy założeniu wizji | `409` przy 20 / 100 | jw. | brak operacji | `401` | `rejected` |

## 4. Ustalenia

| ID | Ważność | Opis | Status |
|---|---|---|---|
| F1 | major | `email-outbox-kind-migration.test.ts` oczekiwał, że `migrateToLatest` zastosuje wyłącznie `0067`; po scaleniu z EVM-139 stosuje też `0068` — test czerwony (bramka CI byłaby czerwona). | Poprawiony przez QA: zestaw migracji ograniczony do ≤ `0067` (asercje nieosłabione); commit `7f8742f3`. |
| F2 | minor | W `site-survey-create.test.tsx` (EVM-138) asercja `not.toContain('600')` zastąpiona regexem pełnego numeru `600[\s-]?123[\s-]?456` (uzasadnienie w komentarzu: fałszywe trafienia na znacznikach czasu). Węższe w teorii (częściowy numer nie zostanie złapany), ale `123 456` nadal sprawdzane. | Akceptowalne. |
| F3 | minor | Nazwa testu „AC1 … one with a customer” bez osobnego przypadku z klientem (nieosiągalny dzięki CHECK). | Do poprawy nazwy przy okazji. |

Zmiany w testach starszych historyjek (`git diff f139ba05..HEAD`): żadna asercja nie usunięta ani osłabiona poza F2; pozostałe to liczniki (`124 → 125` ścieżek kontraktu, `201 → 203` komórek IDOR, lista migracji) i dopasowanie warunków wstępnych do limitu 20.

## 5. Dodane testy

`apps/api/test/integration/site-survey-expiry-qa-edges.test.ts` (wspólny z EVM-139, 6 testów, zielone): `EVM-140 AC4` zwykłe zlecenie przy 20 wizjach przez API, `EVM-140 AC5` błąd wysyłki jednej wiadomości, `EVM-140 AC1` data usunięcia w `Europe/Warsaw` wokół północy i zmiany czasu.

## 6. Jak sprawdzić ręcznie

1. Jako Edytor otwórz wizję, w szczegółach „Przedłuż o 90 dni”, wybierz powód — data wygaśnięcia się przesuwa, licznik „1 z 2”.
2. Przedłuż drugi raz: akcja wyłączona z podpowiedzią „Przypisz klienta albo odrzuć wizję”.
3. Załóż 21. wizję: komunikat „Masz za dużo otwartych wizji…”.
4. Przypomnienie: wizja z terminem ≤ 15 dni — e-mail dla twórcy i Administratorów po uruchomieniu zadania `work-orders.site-survey-reminder`.
