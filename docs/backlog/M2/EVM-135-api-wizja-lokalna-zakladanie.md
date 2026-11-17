---
id: EVM-135
title: "API: wizja lokalna — zakładanie zlecenia bez klienta (telefon i panel), widoczność, blokady, flaga"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-review
priority: P1
path: pelna             # migracje, nowa polityka dostępu, zakres synchronizacji, dane osobowe
owner: backend-developer
contributors: [devops-engineer]   # tylko wartość flagi w konfiguracji wdrożenia
reviewers: [code-reviewer, security-engineer]
model: opus             # nowa reguła zakresu repliki i polityka odczytu (ADR-0024)
depends_on: [EVM-099, EVM-127]
---

# EVM-135: API — wizja lokalna: zakładanie zlecenia bez klienta

## Cel
Jako **technik (Edytor) i pracownik biura** chcę **założyć zlecenie bez klienta — samym adresem — już na oględzinach**, aby **zdjęcia i filmy trafiały do systemu przed ofertą, bez zbierania danych klienta, który może nie zostać klientem**. Wizja lokalna = zlecenie w statusie „Wycena” z jawnym terminem wygaśnięcia ([ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md), wiążący); plan: [`README.md`](README.md) → „Epik E15”.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w stanie wstępnym „Wycena”; klient dopiero przy „Zaakceptowane”; bez osobnego bytu. 2. Zwykły numer zlecenia od razu. 3. Wygasanie: 90 dni (przedłużenie A/E), odrzucona 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik (także offline) i biuro. 6. Oferta w systemie — poza zakresem. 7. Kolejność: EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa w interfejsie „Wizja lokalna”. 9. Tylko odczyt nie widzi wizji; na telefonie wizję widzi tylko twórca i opiekun (koordynator) zlecenia. 10. Adres tylko w szczegółach, nie w wierszu listy. 11. Klient po przypisaniu niezmienny, telefon zamawiającego czyszczony; powody odrzucenia: „Oferta odrzucona”, „Rezygnacja klienta”. 12. Luki w numeracji akceptowane. 13. Wizje na głównej liście z etykietą. 14. Przypomnienie e-mailem 15 dni przed terminem; przedłużenie tylko w panelu, najwyżej 2 razy; limit 20 na osobę i 100 łącznie. 15. Trwałe usuwanie (`enforce`) po uruchomieniu kopii; do tego czasu `report`. 16. Do czasu EVM-139, EVM-141 i klauzul EVM-133 tylko wizje testowe; **przełącznik funkcji WŁĄCZONY w konfiguracji wdrożenia po scaleniu** (zasada „tylko testowe” organizacyjna — EVM-141).

## Kryteria akceptacji
Role: Administrator i Edytor — tak; Tylko odczyt — brak dostępu (`404`/`403`); niezalogowany — `401`; kanał `mobile` tylko dla A i E.

**AC1 — Telefon: `CreateSiteSurvey`**
- Zakładając Edytora lub Administratora z zarejestrowanym urządzeniem i włączoną funkcją
- Gdy przychodzi komenda `CreateSiteSurvey` v1 z `workOrderId`, `siteId` albo `newSite`, opcjonalnym `title` (domyślnie „Wizja lokalna”) i `requesterPhone` (E.164), bez klienta i szablonu
- Wtedy powstaje zlecenie „Wycena” z numerem `ZL-…`, pustą kompozycją, terminem wygaśnięcia (utworzenie + 90 dni), `createdBy` i telefonem, mutacja zwraca numer, a powtórzenie nie tworzy duplikatu (idempotencja i limit 20 nowych lokalizacji jak w `CreateQuickWorkOrder`); `CreateQuickWorkOrder` działa bez zmian (klient wymagany).

**AC2 — Panel: `POST /site-surveys`**
- Zakładając Edytora lub Administratora
- Gdy wołam `POST /api/v1/site-surveys` z `id`, `siteId`, opcjonalnym `title` i `requesterPhone`
- Wtedy dostaję `201` z `Location` zlecenia-wizji o właściwościach z AC1 (opiekun opcjonalny); `CreateWorkOrderRequest` nie zmienia się — zwykłe zlecenie bez klienta nadal `400`.

**AC3 — Walidacja, flaga i limit techniczny**
- Zakładając wizję zakładaną z telefonu lub panelu
- Gdy brakuje lokalizacji, telefon nie jest E.164, `id` już istnieje (także cudzy), kwota synchronizacji jest przekroczona albo flaga `SITE_SURVEYS_ENABLED` jest wyłączona
- Wtedy telefon dostaje `rejected` z kodem (`validation_failed`, `id_conflict`, `sync_quota_exceeded`, `feature_disabled`), panel — `400`/`409`/`404` (flaga), nic się nie zapisuje, a komunikat nie zawiera adresu ani telefonu; flaga w konfiguracji wdrożenia jest ustawiona na włączoną (decyzja 16), a jej stan jest odczytywalny dla aplikacji i panelu.

**AC4 — Polityka dostępu i macierz ról**
- Zakładając otwartą wizję
- Gdy lista, szczegóły, media, dziennik, wyszukiwanie i `overview` są wywoływane przez Administratora, Edytora, Tylko odczyt i niezalogowanego
- Wtedy A i E widzą wizję, Tylko odczyt jej nie widzi w żadnym źródle (jedna polityka odczytu dla zleceń i projekcji, `404`), niezalogowany — `401`; test macierzy ról dla każdej nowej i zmienionej operacji oraz test IDOR (cudze `id`).

**AC5 — Zakres repliki telefonu**
- Zakładając wizję założoną przez Edytora A, z opiekunem B, i telefon Edytora C
- Gdy telefony pobierają zmiany
- Wtedy dostają ją A (twórca) i B (opiekun), C nie dostaje ani wiersza, ani wzmianki; zmiana reguły podnosi wersję reguły zakresu (jednorazowy `scope_changed`), zmiana opiekuna podnosi `version`; po przypisaniu klienta (EVM-136) zlecenie jest w zakresie jak zwykłe; wizja bez opiekuna z panelu nie jest na żadnym telefonie poza twórcą; N-1 odczytuje nowe pola `SyncWorkOrder.siteSurvey` bez błędu.

**AC6 — Lista, filtr, raporty**
- Zakładając wizje i zwykłe zlecenia
- Gdy pobieram listę z `siteSurvey=only`, `siteSurvey=exclude` albo bez parametru, oraz liczniki i raporty `overview`
- Wtedy domyślnie lista pokazuje wizje razem ze zleceniami (obiekt `siteSurvey: {expiresAt, extensionCount, requesterPhone}`, `customer: null`), filtry działają jak opisano, liczniki i raporty pomijają otwarte wizje, projekcja ma kolumnę terminu (filtr, sortowanie), a adres nie występuje w odpowiedzi listy.

**AC7 — Niezmienniki i blokady do czasu klienta**
- Zakładając wizję bez klienta
- Gdy próbuję dodać plan płatności lub transze, wygenerować dokument dla klienta, wyeksportować ZIP mediów albo zapisać w bazie „zlecenie bez klienta i bez terminu” lub „wizja ze statusem spoza {Wycena, Wstrzymane, Anulowane}”
- Wtedy API zwraca `409 customer_required` (lista operacji zamknięta w teście; zakres i procesy można dodawać), a bazę chronią CHECK-i z ADR-0024 (dodane `NOT VALID` + `VALIDATE` po zapytaniu kontrolnym „0 zleceń bez klienta” — inaczej historyjka staje i pyta); telefon zamawiającego dozwolony tylko przy otwartej wizji.

**AC8 — Adres i telefon poza danymi zlecenia**
- Zakładając założenie, odczyt i synchronizację wizji
- Gdy sprawdzam logi, `change_log`, audyt, metryki, klucze i nazwy obiektów, komunikaty błędów, `search_text` (telefon) i treści powiadomień
- Wtedy nie ma w nich adresu ani telefonu zamawiającego (tylko identyfikatory i numer); test redakcji obejmuje logi i `change_log`.

## Poza zakresem
Przypisanie klienta, reguła `accepted`, odrzucenie (EVM-136); ekrany (EVM-137, EVM-138); przypomnienia, przedłużenie, limit otwartych wizji (EVM-140); usuwanie (EVM-139); oferta, termin wizyty, deduplikacja adresów, szablon przy wizji, edycja wizji z telefonu, nowy status.

## Decyzje i ograniczenia
- Migracje wyłącznie addytywne (N-1 działa na schemacie N), kolumny, indeks częściowy i CHECK-i wg sekcji „Migracje” ADR-0024; kolejność wdrożeń: API przed paczką; minimalna wersja aplikacji bez zmian.
- Konsultacja architekta — ADR-0024: zakres „twórca + opiekun” to **nowa wersja reguły zakresu** (jednorazowy `scope_changed` dla ≤ 3 telefonów), bez zmiany ADR-0021; poprzedni opiekun traci wizję najpóźniej przy kontrolnym resyncu (≤ 7 dni).
- Bezpieczeństwo: W2, W5, W6, W8, W11 (mapowanie w README).
- DoD ponad standard: `domain.md` i `domain-model.md` — definicja „Wizja lokalna” i zmiana zasady „klient najpóźniej przy akceptacji”; macierz ról i IDOR w testach.

## Notatki
Rozmiar wg ADR-0024: **L**. Pierwszy punkt planu technicznego: zapytanie kontrolne i kolejność migracji `NOT VALID` → `VALIDATE`. Zasada organizacyjna: do czasu EVM-139/141/133 tylko wizje testowe.
- **Rozstrzygnięcia Tech Leada z delegacji (kolejka 2026-11-16, do potwierdzenia przy demo):**
  1. **AC3 — kod przekroczonej kwoty to `quota_exceeded`**, nie `sync_quota_exceeded` (istniejący kod wyniku mutacji, ten sam mechanizm co w szybkim zleceniu); do poprawy brzmienie AC.
  2. **AC6 — wiersz listy zwraca `requesterPhone`** (zgodnie z AC6); przegląd security rekomenduje usunięcie telefonu z wiersza listy (minimalizacja) — **decyzja Konrada**; interfejs telefonu w wierszu nie pokazuje, adresu w wierszu nie ma.
  3. Wizja z panelu bez podanego opiekuna = bez opiekuna; „raporty” bez wizji = widoki `waiting_on_dso_over_14_days`, `overdue_payments`, `unpaid` i lista nieopłaconych transz; sortowanie po terminie tylko z `siteSurvey=only`; stan przełącznika w `features.siteSurveys`.
  4. „Odwracalność” migracji 0066: runner działa tylko w przód — wycofanie logiczne opisane w nagłówku migracji i wykonane w teście; migracja sama sprawdza „0 zleceń bez klienta” i przy wyniku > 0 cofa całą transakcję.
  5. Baseline kontraktu przesunięty z `--allow-breaking ADR-0024` (nowy wariant unii mutacji); `POST /site-surveys` wszedł do kontraktu razem z trasą, filtr listy razem z implementacją.
  6. Przełącznik `SITE_SURVEYS_ENABLED` włączony w `infra/runtime/compose.staging.yaml` (decyzja 16); zabezpieczeniem jest zasada „tylko wizje testowe”.
- **Skutki wdrożenia:** nowa wersja reguły zakresu telefonu (294) — jednorazowa pełna synchronizacja telefonów; **EVM-135 i EVM-136 tylko w jednym wydaniu** (bez reguły z EVM-136 przejście wizji do „Zaakceptowane” kończy się błędem bazy); przy otwartych wizjach nie wycofywać kodu do wersji sprzed EVM-135 (runbook `docs/ops/runbooks/wizja-lokalna.md`).
- **Znane i poza zakresem:** lokalizacja założona dla wizji jest widoczna dla roli Tylko odczyt w wyszukiwaniu lokalizacji (sam adres; TM-149, pkt 9 listy kontrolnej — decyzja Konrada przed pierwszą realną wizją); limit otwartych wizji dopiero w EVM-140.
- **Minor / nit z przeglądów — zostają:** test migracji bez zlecenia usuniętego miękko bez klienta; brak testu kursora z wersją zakresu 293; brak testu widoku `waiting_on_dso_over_14_days` bez wizji i limitu mieszanego (szybkie zlecenia + wizje); test redakcji bez asercji niepustego logu i bez `timeline`, `overview`, `idempotency_records`; test widoczności obejmuje odczyty o jednym segmencie; `WorkOrderListRef.siteSurvey` opcjonalne; fikstura „sprawdź, potem wstaw”; test czytający zbudowany kontrakt; trzy równoległe definicje kształtu wizji; niestabilny `work-orders-payments-performance.test.ts` (limit czasu SQL w przygotowaniu danych, niezwiązany); brak testu niezależności terminów od zmiany czasu (kod liczy pełne doby UTC).

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-16 — start realizacji w kolejce `/noc-2026-11-16`; **status `in-progress`** (Tech Lead)
- 2026-11-16 … 2026-11-17 — implementacja etapami (backend-developer, devops-engineer): migracja 0066 `0d968f03`, przełącznik `8f8c17e2` i `447ead71`, kontrakt `84766fbf`, zakładanie z telefonu `ac244a1d` i z panelu `b220ab80`, polityka Tylko odczyt `218e8cfa`, lista i filtr `8df4f608`, zakres telefonu `3d956a6e`, blokady `b7489ac4`, test AC8 `506e63f4`, dokumenty `6815808d`
- 2026-11-17 — przeglądy: code-reviewer **APPROVE z uwagami**, security-engineer **APPROVE z uwagami** (W2, W4, W5, W6, W8, W11 spełnione; migracja oceniona jako bezpieczna dla wdrożenia bez kopii) — bez blocker; ustalenie major (osłabiony test listy) poprawione w `1d7eb47e`; QA (`qa-engineer`): **PASS z uwagami**, raport `docs/qa/EVM-135/raport-qa.md`, testy brzegowe `5d09516c`
- 2026-11-17 — bramka lokalna na gałęzi zintegrowanej (`bc40eeac` + dokumenty): `pnpm run gate` 68/68 zadań, pokrycie zmienionego kodu zielone, `npm run test:tools`, `npm run docs:check` (0 błędów), `pnpm run gate:deploy` — kody wyjścia 0; pełna integracja API, E2E Linux i skany — w CI PR-u (zasada z 2026-11-17). **Status `in-review`** — PR wspólny dla EVM-135…138 i EVM-141; demo i akceptacja Konrada po scaleniu (Tech Lead)
