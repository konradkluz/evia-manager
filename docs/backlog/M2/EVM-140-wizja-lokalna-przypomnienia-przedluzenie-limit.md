---
id: EVM-140
title: "Wizja lokalna: przypomnienie przed usunięciem, przedłużenie z powodem (API i panel) i limit otwartych wizji"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-progress
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

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-17 — start realizacji w kolejce `/noc-2026-11-16` (tor E, klon n2, gałąź `feature/queue-2026-11-17-wizja-lokalna-wygasanie` od głowy PR #148 `f139ba05`); **status `in-progress`** (Tech Lead)
