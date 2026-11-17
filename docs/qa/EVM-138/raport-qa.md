# EVM-138 — raport weryfikacji QA

Historyjka: [EVM-138](../../backlog/M2/EVM-138-web-wizja-lokalna.md) (AC1–AC6). Data: 2026-11-17. Weryfikator: qa-engineer, niezależnie od raportów wykonawców. Zakres: commity `7e6043cb`, `59a43000`, `8e579668`, `cc4b7251`, `7aad7315`, `9376c2ee`, `58bbc17b` (kod `apps/web/src/**`, `packages/ui-web/src/**`, testy `apps/web/test/**`) na gałęzi zintegrowanej `feature/queue-2026-11-16-wizja-lokalna-c`. Skrót: W = `apps/web/test/`, E2E = `apps/web/test/e2e/`.

## Werdykt: PASS z uwagami

AC1–AC6 spełnione: każde zdanie „Wtedy” ma test z asercjami na tekst, rolę, żądanie HTTP i stan, jest przypadek negatywny. Brak blockerów i major. Znane odstępstwa z delegacji (adres poza listą, baner odrzuconej bez powodu, „Wygasające” liczone w panelu, wyszukiwanie z „Tylko wizje” po stronie panelu, `412` przy przypisaniu, „Przywróć wizję…” wyłączony u Edytora, „Przedłuż o 90 dni” i limit w EVM-140) — kod robi dokładnie to, co opisano; **PASS z uwagą do decyzji właściciela** (§ 3). Dopisałem 1 test (zamknięcie dialogu przyciskiem „Zamknij okno” z wpisanymi danymi nowego klienta; zielony).

## 1. Macierz AC → testy → wynik

| AC | Wynik | Dowód (testy) | Ocena asercji |
|---|---|---|---|
| AC1 lista, odznaki, filtry | PASS | E2E `work-orders-site-surveys.spec.ts`: wiersze z „Wizja lokalna”, „Brak klienta”, terminem (ikona + tekst), „Odrzucona” + „Usunięcie za 9 dni” i bez adresu; radio „Tylko wizje”/„Bez wizji” ze strzałkami, `siteSurvey` w adresie, „Usuń filtr”; „Wygasające wizje (2)” z „2 wizje do rozstrzygnięcia” i linią polite; sortowanie „Termin wygaśnięcia” tylko z „Tylko wizje”; stan pusty „Brak wizji lokalnych.” i „Żadna wizja nie wygasa w ciągu 15 dni.”; błąd listy z „Spróbuj ponownie”. W `work-orders-site-surveys.test.tsx` (26 testów AC1), `site-survey-filters.test.ts` (21: granice 14/15/16, zmiana czasu 28.03.2027, dziś i termin minął, odrzucona nie liczy się, liczebniki 1/2/5/22, wyszukiwanie z frazą), `site-survey-logic.test.ts`. Dostępność: `site-surveys-accessibility.spec.ts` (axe, 4 szerokości). | Asercje na nazwach dostępnych wierszy, parametrach żądań i kolejności; granice testowane wprost. |
| AC2 założenie wizji | PASS | W `site-survey-create.test.tsx` (22 testy AC2: formularz tylko lokalizacja/telefon/opiekun, podpowiedź „Tylko numer — nie wpisuj imion w opisach.”, „Bez opiekuna wizja nie będzie widoczna na żadnym telefonie.”, `POST /site-surveys`, numer po zapisie, ponowienie z tym samym kluczem, `409 id_conflict`, telefon poza szkicem/adresem/storage/cache/konsolą), `site-survey-kind.test.tsx` (9), E2E `site-survey-create.spec.ts` (8: klawiatura, droga do W-06, neutralne 404, brak `600…` w URL i storage); wyłączona funkcja chowa wybór (W `site-survey-kind`, E2E `work-orders-site-surveys.spec.ts`). | Treści żądań i brak telefonu w 5 miejscach sprawdzone wprost. |
| AC3 szczegóły i „Przypisz klienta” | PASS | W `site-survey-details.test.tsx` (baner „Wizja lokalna — brak klienta” z datą i dniami, telefon, karta klienta niewczytywana, ostrzeżenie ≤ 15 dni), `site-survey-assign.test.tsx` (13: istniejący klient `PUT {customerId, version}` bez If-Match; nowy klient z telefonem z wizji; `412` z „Odśwież zlecenie”; `409` `invalid_state_transition`/`customer_already_set`; `422 customer_unavailable`; 5xx/sieć z tym samym Idempotency-Key; offline; „Odrzucić zmiany?”; axe), E2E `site-surveys.spec.ts` (przypisanie, baner znika, klient widoczny, konflikt wersji i ponowienie). | Sprawdzono stan po zapisie (baner znika, klient widoczny) i błędy z ponowieniem. |
| AC4 reguła akceptacji | PASS | W `site-survey-accept.test.tsx` (6): „Zaakceptuj” → „Aby zaakceptować, przypisz klienta”, nic nie wysłano, przycisk prowadzi do „Przypisz klienta”; `409 customer_required` daje ten sam dialog; `site-survey-details.test.tsx` i E2E `site-surveys.spec.ts:94`: płatności, dokumenty i ZIP wyłączone z widocznym powodem (jest też jego opisem), zdjęcia działają. | Asercje na braku żądania i na opisie dostępnym. |
| AC5 odrzucenie i przywrócenie | PASS | W `site-survey-reject.test.tsx` (16): ostrzeżenie „po 14 dniach”, brak powodu = brak żądania i fokus na grupie, `{to:"cancelled", reasonCode}` z If-Match i kluczem, oba powody, „Anulowane” + „Odrzucona” + data usunięcia, `412`, ponowienie, offline, Administrator przywraca z jednorazowym step-up i `{to:"on_hold"}`, Edytor: przycisk wyłączony z „Przywrócić wizję może tylko administrator.” i bez żądania, `403`/`412` przy przywracaniu; E2E `site-surveys.spec.ts:115,139,157`. | Rola Edytora i Administratora rozróżniona na poziomie UI i żądań. |
| AC6 dostęp i stany | PASS | Tylko odczyt na adresie wizji: W `site-survey-details.test.tsx:141`, E2E `site-surveys.spec.ts:107` („Nie znaleziono zlecenia”, bez śladu wizji); filtry: `site-survey-filters.test.ts` (brak filtra i widoku, link „Nie znaleziono widoku”), E2E `work-orders-site-surveys.spec.ts:142` (brak grupy i widoku, brak `siteSurvey` w żądaniach nawet z adresu); wyłączona funkcja: `:161`; stany (pusty, błąd, ładowanie), klawiatura (grupa radio = jeden Tab, Enter otwiera wiersz) i nazwy dostępne odznak: `site-surveys-accessibility.spec.ts`. | Negatywne ścieżki sprawdzone na poziomie żądań. |

## 2. Uruchomione komendy i wyniki

| Komenda | Wynik |
|---|---|
| `pnpm --filter @evia/contracts run build` | kod 0 |
| `pnpm --filter @evia/web run test:coverage` | kod 0; progi presetu spełnione; instrukcje 97,03 % (11765/12125), gałęzie 92,45 % (9484/10258), funkcje 96,89 %, linie 98,21 % (10298/10485). Pliki wizji: m.in. `site-survey-banner.tsx` 100/87,5, `site-survey.ts` 100/85, `survey-list-labels.ts`/`site-survey-labels.ts` 75–86 % linii (nieużywane gałęzie tekstów — nit) |
| `vitest` tylko pliki wizji (`site-survey*`, `work-orders-site-surveys`) | 9 plików, 127 testów zielonych (przed dodaniem mojego) |
| `pnpm --filter @evia/ui-web exec vitest run --coverage.enabled=false` | 162 testy zielone |
| `pnpm --filter @evia/web run typecheck` | kod 0 (także po dodaniu mojego testu); eslint nowego pliku: czysto |
| Playwright chromium: `site-surveys`, `site-survey-create`, `work-orders-site-surveys`, `site-surveys-accessibility` | 43 testy zielone (17,5 s), bez powtórzeń |
| `npm run docs:check` | błędy 0, ostrzeżenia 0 |

Pokrycie zmienionego kodu (`coverage:diff`) nie było uruchamiane (poza zakresem polecenia).

## 3. Ustalenia

Brak blocker i major.

- **minor (do decyzji właściciela, znane z delegacji):** (a) wiersz wizji bez adresu na liście; (b) baner odrzuconej wizji bez powodu; (c) „Wygasające wizje” liczone w panelu z limitem 100 wizji posortowanych po terminie — przy > 100 otwartych wizji licznik byłby zaniżony (limit biznesowy 20/100 temu zapobiega); (d) wyszukiwanie z „Tylko wizje” filtruje wczytaną stronę po stronie panelu — wizja poza wczytaną stroną nie zostanie znaleziona; (e) `412` zamiast `409` przy nieaktualnej wersji; (f) „Przywróć wizję…” u Edytora wyłączony z podpowiedzią (zgodnie z AC „Edytor nie”, ale przycisk jest widoczny).
- **nit:** `site-survey-labels.ts` 75 % i `survey-list-labels.ts` — nieużywane gałęzie funkcji tekstowych (np. wiersz 39, 100, 132, 152–153) niepokryte; nieszkodliwe.
- **nit:** na zrzutach 1280/360 tło poniżej wysokości okna jest białe pod dialogiem (artefakt zrzutu pełnej strony, nie błąd aplikacji).

## 4. Zrzuty (`docs/ux/reviews/EVM-138/`, obejrzane: 360 i 1280)

- AC1 `w10-surveys-all-360`: wizje z odznaką „Wizja lokalna”, „Brak klienta”, „Wygasa za 80/12/15 dni” (ostrzeżenie ikoną i kolorem od 15 dni), odrzucona z „Odrzucona” i „Usunięcie za 9 dni”, widok „Wygasające wizje (2)”, grupa radio „Wizje lokalne”; brak adresu w wierszu — zgodne z AC i delegacją.
- AC2 `w05-survey-new-site-1280`: „Rodzaj” z dwoma opcjami, sekcje „1. Lokalizacja / 2. Zamawiający / 3. Opiekun”, podpowiedź telefonu, „Załóż wizję lokalną” — zgodne.
- AC3 `w06-survey-1280`, `w06-assign-new-360`: baner „Wizja lokalna — brak klienta” z datą i „Przypisz klienta”, telefon zamawiającego; formularz nowego klienta z telefonem „podstawiliśmy z wizji — sprawdź go” — zgodne.
- AC4 `w06-accept-needs-customer-360`: dialog „Aby zaakceptować, przypisz klienta”, płatności z podpowiedzią „Płatności dodasz po przypisaniu klienta.” — zgodne.
- AC5 `w06-reject-1280`, `w06-rejected-editor-1280`: dialog z „po 14 dniach”, dwa powody, „Anulowane” + „Odrzucona”, „Przywróć wizję…” wyłączony z podpowiedzią u Edytora — zgodne.

## 5. Przypadki brzegowe

| Przypadek | Test | Uwaga |
|---|---|---|
| Telefon zamawiającego w URL / localStorage / sessionStorage / cache / szkicu | tak: `site-survey-create.test.tsx` (draft, href, tytuł, storage, konsola), `site-survey-details.test.tsx`, `site-survey-assign.test.tsx:128`, E2E `site-survey-create.spec.ts` | pokryte |
| Granice ≤ 15 dni (14/15/16), zmiana czasu | tak: `site-survey-filters.test.ts:107,126`, `site-survey-logic.test.ts:18,30` | pokryte |
| Odrzucona na liście | tak: E2E `work-orders-site-surveys.spec.ts:25`, nie wchodzi do „Wygasających” | pokryte |
| Tylko odczyt: adres wizji i filtry | tak (AC6) | pokryte |
| Wyłączony przełącznik funkcji | lista i „Nowe zlecenie”: tak; bezpośredni adres istniejącej wizji przy wyłączonej funkcji: nie osobno (decyduje API, panel pokazuje to, co zwróci) | minor |
| `412` / `409` przy przypisaniu | tak (`site-survey-assign.test.tsx:142,174–177`) | pokryte |
| Zamknięcie dialogu z danymi nowego klienta | Esc i „Wróć do wyboru”: tak; „Zamknij okno”: brak → **dodane** `site-survey-assign-close.test.tsx` | zielony |
| Polskie znaki w nazwach/wyszukiwaniu | dane testowe wizji nie używają ąćęłńóśźż w wyszukiwaniu wizji (adres „ul. Testowa”) — luka minor, logika wyszukiwania po stronie panelu bez normalizacji diakrytyków nie była sprawdzana | minor |

## 6. Rozjazdy z instrukcją dla biura (rozdział 4; nie edytowano)

Nazwy zgodne: „Rodzaj”, „Wizja lokalna”, „Załóż wizję lokalną”, „Telefon zamawiającego”, „Przypisz klienta”, „Dodaj nowego klienta”, „Aby zaakceptować, przypisz klienta”, „Odrzuć wizję”, „Oferta odrzucona”, „Rezygnacja klienta”, „Przywróć wizję”, „Wygasa za N dni”, „Wygasające wizje”, „Tylko wizje”, „Zapisz lokalizację”. Rozjazdy:
1. Instrukcja: „Przedłuż o 90 dni” i komunikat limitu „Masz za dużo otwartych wizji…” — brak w panelu (EVM-140); do czasu EVM-140 opisują funkcję, której nie ma. Podpowiedź: dopisek „(od EVM-140)” albo wydanie razem.
2. Przyciski w panelu mają wielokropek („Odrzuć wizję…”, „Przywróć wizję…”) — instrukcja bez; nit.
3. Instrukcja nie wspomina o filtrze „Bez wizji”, sekcjach „2. Zamawiający” i „3. Opiekun” formularza ani o ostrzeżeniu „Klienta możesz przypisać tylko raz”; nit.
4. Instrukcja: „Przywrócić… Administrator („Przywróć wizję”)”; Edytor widzi przycisk wyłączony — warto dopisać; nit.

## 7. Czego nie sprawdzono

Pełnego zestawu Playwright ani przeglądarek innych niż Chromium, Dockera / `web-e2e-linux`, `gate`, skanów, `coverage:diff`; mutacji; sesji eksploracyjnej na żywej aplikacji (zakres ograniczony do testów i zrzutów); przeglądarki mobilnej offline poza testami komponentów; integracji z prawdziwym API (testy używają atrap zgodnych z kontraktem).

## 8. Dodane testy

`apps/web/test/site-survey-assign-close.test.tsx` — EVM-138 AC3: przycisk „Zamknij okno” z wpisanym nazwiskiem pyta „Odrzucić zmiany?”, „Wróć do edycji” zachowuje dane, „Odrzuć zmiany” zamyka dialog bez `PUT …/customer` i `POST /customers` (zielony).

## 9. Jak to sprawdzić (dane testowe)

1. W panelu jako Edytor: „Zlecenia” → „Nowe zlecenie” → „Rodzaj: Wizja lokalna”, nowa lokalizacja, telefon `600 000 002`, opiekun → „Załóż wizję lokalną”; powinien pojawić się numer ZL-… i baner „Wizja lokalna — brak klienta”.
2. Na liście wybierz „Tylko wizje” i „Wygasające wizje”; wizja jest z odznaką i „Wygasa za N dni”.
3. W szczegółach „Zaakceptuj” → „Aby zaakceptować, przypisz klienta”; „Przypisz klienta” → „Dodaj nowego klienta” (telefon podstawiony) → zapisz; baner znika.
4. Na drugiej wizji „Odrzuć wizję…” → powód → „Anulowane / Odrzucona”; Edytor ma „Przywróć wizję…” wyłączony, Administrator — z potwierdzeniem tożsamości.
5. Jako Tylko odczyt: adres wizji daje „Nie znaleziono zlecenia”, na liście nie ma grupy „Wizje lokalne”.
