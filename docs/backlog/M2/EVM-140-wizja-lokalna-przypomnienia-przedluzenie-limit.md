---
id: EVM-140
title: "Wizja lokalna: przypomnienie przed usunięciem, przedłużenie z powodem (API i panel) i limit otwartych wizji"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-review
priority: P1
path: pelna             # audyt, e-mail, limity nadużyć, zadanie w workerze
owner: backend-developer
contributors: [web-developer, ux-designer]   # panel: dialog przedłużenia (AC6); ux: treść e-maila, komunikaty limitu, dialog
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-135, EVM-138]   # EVM-138: ekran szczegółów, na którym stoi dialog przedłużenia (AC6)
---

# EVM-140: Wizja lokalna — przypomnienie, przedłużenie, limit

## Cel
Jako **pracownik biura** chcę **dostać przypomnienie, zanim wizja zniknie, i móc ją świadomie przedłużyć (np. gdy wspólnota czeka na uchwałę)**, aby **nie tracić dokumentacji oferty, która jeszcze trwa**, a jako administrator chcę **limitu otwartych wizji**, aby **nie powstawało „dzikie archiwum” adresów** (W7). Filtr „wygasające” i data wygaśnięcia w panelu — EVM-138; tu dialog przedłużenia.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”. 2. Zwykły numer od razu. 3. 90 dni (przedłużenie A/E), odrzucona 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. Tylko odczyt bez dostępu; telefon: twórca i opiekun. 10. Adres tylko w szczegółach. 11. Klient po przypisaniu niezmienny; powody odrzucenia: „Oferta odrzucona”, „Rezygnacja klienta”. 12. Luki w numeracji akceptowane. 13. Wizje na głównej liście. 14. **Przypomnienie e-mailem 15 dni przed terminem do twórcy i Administratorów; przedłużenie tylko w panelu, najwyżej 2 razy (do 270 dni); limit 20 otwartych wizji na osobę i 100 łącznie.** 15. `enforce` po kopiach, do tego `report`. 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu.

## Kryteria akceptacji
Role: przedłużenie — Administrator i Edytor (kanał web); przypomnienie — twórca i Administratorzy; Tylko odczyt i niezalogowany — bez dostępu; kanał `mobile` — brak operacji przedłużenia.

**AC1 — Przypomnienie**
- Zakładając otwartą wizję, której termin wygaśnięcia jest za 15 dni lub mniej, bez `site_survey_reminded_at`
- Gdy uruchamia się codzienne zadanie w `worker`
- Wtedy twórca i każdy Administrator dostają jeden e-mail z outboxu (tylko numer zlecenia i data usunięcia, **bez adresu i telefonu**, z linkiem do zlecenia w panelu: „Wizja lokalna ZL-… zostanie usunięta dnia …. Przypisz klienta, przedłuż albo odrzuć.”), `site_survey_reminded_at` jest ustawione, a powtórne uruchomienie nie wysyła drugiego; wizja z klientem, anulowana lub już przypomniana nie dostaje wiadomości.

**AC2 — Przedłużenie z powodem**
- Zakładając otwartą wizję z licznikiem przedłużeń 0 lub 1
- Gdy Edytor lub Administrator woła `POST /work-orders/{id}/site-survey/extensions` z kodem powodu (`awaiting_client_decision`, `awaiting_community_decision`, `second_visit_needed`)
- Wtedy termin przesuwa się o 90 dni, licznik rośnie, `site_survey_reminded_at` jest zerowane (kolejne przypomnienie 15 dni przed nowym terminem), powstaje audyt z kodem powodu (bez treści swobodnej) i wpis dziennika; nieznany kod — `400`.

**AC3 — Najwyżej dwa przedłużenia i warunki**
- Zakładając wizję przedłużoną już dwa razy, wizję anulowaną, zlecenie z klientem albo Tylko odczyt
- Gdy próbuję przedłużyć
- Wtedy `409 extension_limit_reached` (łącznie ≤ 270 dni), `409` dla anulowanej i zwykłego zlecenia (przedłużenie anulowanej nie istnieje — jest przywrócenie z EVM-136), `403`/`404` dla Tylko odczyt, `401` dla niezalogowanego; test macierzy ról i IDOR.

**AC4 — Limit otwartych wizji**
- Zakładając twórcę z 20 otwartymi wizjami (bez klienta, nieanulowanymi) albo 100 otwartych łącznie (wartości w konfiguracji jako kod)
- Gdy zakłada kolejną (telefon lub panel)
- Wtedy odmowa kodem `site_survey_limit_exceeded` (telefon: `rejected` → „Wymaga uwagi”; panel: `409`) z komunikatem „Masz za dużo otwartych wizji — przypisz klienta, odrzuć lub poczekaj na wygaśnięcie”; przypisanie klienta albo anulowanie zwalnia miejsce; limit nie dotyczy zwykłych zleceń; test przy liczbie granicznej.

**AC5 — Adres i dane poza e-mailem i logami**
- Zakładając wysyłkę przypomnień i odmowy limitu
- Gdy sprawdzam outbox, logi zadania, metryki i audyt
- Wtedy nie ma w nich adresu ani telefonu zamawiającego, a dziennik zadania zawiera tylko liczby i identyfikatory; błąd wysyłki jednej wiadomości nie zatrzymuje pozostałych (ponowienie według zasad outboxu).

**AC6 — Przedłużenie w panelu**
- Zakładając Edytora lub Administratora na szczegółach wizji (EVM-138) z licznikiem przedłużeń 0 lub 1
- Gdy wybieram „Przedłuż o 90 dni” i powód z listy („Czeka na decyzję klienta”, „Czeka na uchwałę wspólnoty lub zarządcy”, „Wymaga drugiej wizyty”)
- Wtedy data wygaśnięcia w panelu się przesuwa, a po dwóch przedłużeniach akcja jest wyłączona z podpowiedzią „Przypisz klienta albo odrzuć wizję”; Tylko odczyt nie widzi wizji; błąd serwera ma komunikat i ponowienie; test Playwright (role, klawiatura); przedłużenia z aplikacji nie ma.

## Poza zakresem
Filtr „wygasające” (EVM-138); przedłużenie z aplikacji; push; przypomnienia o ofercie i CRM; raport konwersji wizja → zlecenie; usuwanie (EVM-139).

## Decyzje i ograniczenia
- Bezpieczeństwo: W1 (przedłużenie ×2 z powodem i audytem), W2, W5, W7. E-mail przez istniejący outbox (EVM-089); szablon wiadomości dopisany do zamkniętej listy szablonów.
- Rozstrzygnięcie Tech Leada z delegacji, do potwierdzenia przy demo: nazwy trzech kodów powodu i brzmienie e-maila (ux-designer przegląda treść na starcie).

## Notatki
Rozmiar wg ADR-0024: M. Odstępstwo od grafu ADR-0024 (tam 140 równolegle z 136/137): AC6 wymaga ekranu z EVM-138, więc 140 idzie po 138 (PR 2); część API (AC1–AC5) nie zależy od panelu. Przed 139 (139 zależy od 140).
- **Rozstrzygnięcia z delegacji (kolejka 2026-11-16 / 17, do potwierdzenia przy demo):**
  1. Przypomnienie obejmuje też wizje po terminie, jeszcze nieusunięte (warunek „termin ≤ teraz + 15 dni”); odbiorca musi w chwili wysyłki być aktywnym Administratorem albo aktywnym twórcą wizji (Administrator / Edytor) — inaczej wiadomość jest pomijana.
  2. **Treść e-maila a tryb `report`:** wiadomość mówi „zostanie usunięta dnia …”, a zadanie usuwania (EVM-139) działa na razie w trybie `report` i niczego nie usuwa. Rekomendacja ux-designera i Tech Leada: treści nie zmieniać (rozbieżność przejściowa, tylko wizje testowe); wariant „może zostać usunięta” = zmiana tekstu z AC1 — **decyzja Konrada**.
  3. Nowa fasada `EmailRecipientDirectory` w `identity` zwraca adres aktywnego odbiorcy composerom outboxu (odstępstwo od zasady „fasada nie zwraca e-maili”; security: do ograniczenia regułą granic modułów — backlog).
  4. Migracja `0067` — wyłącznie poszerzenie listy rodzajów e-maili; link w wiadomości `/work-orders/{id}` (poprawiony `docs/ux/flows/e-maile.md`); zapis `site_survey_reminded_at` nie podnosi wersji zlecenia (telefon dostaje zbędny wpis zmiany tej samej wersji).
  5. Limit: licznik po twórcy (`created_by`), jedna globalna blokada doradcza przy zakładaniu wizji; kod `site_survey_limit_exceeded` jest znanym kodem rdzenia synchronizacji (`2cb5bf5e`) — aplikacja pokazuje komunikat limitu. Komunikat w aplikacji w wariancie „Poproś biuro…” (rekomendacja UX) — **decyzja Konrada**.
  6. Panel — teksty spoza makiety zaakceptowane w przeglądzie UX (przepływ 17, sekcja „Teksty i rozwiązania spoza makiet”).
- **Do decyzji Konrada z przeglądu kodu:** przywrócenie odrzuconej wizji nie sprawdza limitu 20 / 100 (limit można tą drogą przekroczyć); przedłużenie wizji po terminie liczy od starego terminu i może dać datę w przeszłości; zadanie usuwania biegnie o 03:20, więc wizja znika w dniu z e-maila albo dzień później, zależnie od godziny terminu.
- **Minor / nit z przeglądów — zostają:** po `409 extension_limit_reached` przycisk w dialogu zostaje aktywny; `400` w dialogu pokazywany jak błąd sieci z „Spróbuj ponownie”; `RadioGroup` biblioteki bez `aria-required` (komunikat walidacji wystarcza); obejście fokusu startowego przez atrybut DOM; Playwright dialogu tylko w Chromium lokalnie (pozostałe przeglądarki w CI); brak zrzutów stanów 403 / 429 / offline; nazwa testu „z klientem” w przypomnieniach bez osobnego przypadku (więz bazy zeruje termin).

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-17 — start realizacji w kolejce `/noc-2026-11-16` (tor E, klon n2, gałąź `feature/queue-2026-11-17-wizja-lokalna-wygasanie` od głowy PR #148 `f139ba05`); **status `in-progress`** (Tech Lead)
- 2026-11-17 — implementacja etapami: API (backend-developer) — kontrakt `82c9ecae`, przedłużenie `7e3632b9`, limit `cbaa3d25`, przypomnienie i migracja `0067` `e0b7c15b`, treść e-maila i dokumenty `75050884`; panel (web-developer) — dialog i komunikat limitu `362a7fbe`, E2E `d02ab807`; rdzeń synchronizacji zna kod limitu `2cb5bf5e` (Tech Lead)
- 2026-11-17 — przeglądy: security-engineer **APPROVE z uwagami**, QA **PASS z uwagami** (raport `docs/qa/EVM-140/raport-qa.md`, testy brzegowe `7f8742f3`), ux-designer **APPROVE z uwagami** (`1d0e59d5`), code-reviewer **APPROVE z uwagami** — bez blocker i major; poprawka z przeglądu kodu: przywrócenie i odrzucenie zerują znacznik przypomnienia przy zmianie terminu (`6e5b0a1a`)
- 2026-11-17 — bramka lokalna na gałęzi zintegrowanej z `main` po scaleniu PR #148: `pnpm run gate` — 68/68 zadań, pokrycie zmienionego kodu (natywne) linie 96,4%, gałęzie 97,4% po dopisaniu testów `681908ef`; `npm run test:tools`, `npm run docs:check` (0 błędów), `pnpm run gate:deploy` — kody wyjścia 0; pełna integracja API, E2E Linux i skany — w CI PR-u. **Status `in-review`** — PR wspólny z EVM-139 (Tech Lead)
