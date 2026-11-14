---
id: EVM-129
title: "Stabilne testy: okno północy i obciążenie"
type: bug
milestone: M0
epic: E00 Fundamenty
status: done
priority: P1
path: lekka
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-126]
---

# EVM-129: Stabilne testy: okno północy i obciążenie

## Historyjka
Jako **zespół (Konrad)** chcę **testów, które nie zależą od pory dnia ani od obciążenia maszyny**, aby **czerwone CI oznaczało prawdziwy błąd, a scalanie nie zależało od tego, czy PR jest sprawdzany tuż po północy**. Jeśli okaże się, że jeden z testów ujawnia prawdziwy błąd dostępności dziennika w panelu, chcę go naprawić, bo użytkownik biura o tej porze zobaczyłby ten sam błąd.

Zasada nadrzędna (`CLAUDE.md`, reguła 3): przyczynę usuwamy w teście lub kodzie — nie osłabiamy, nie wyłączamy testów i nie podnosimy limitów czasu „na ślepo”. Historyjka ma być wykonana bez udziału człowieka.

## Kontekst
Obserwacje z nocnej kolejki 13/14.11.2026 (PR #137, przebieg CI 43523376456) oraz z lokalnej bramki:

1. **Web E2E, `apps/web/test/e2e/work-order-journal.spec.ts:64`** — „EVM-037 AC3 a correction is a new entry…”: o 00:01 czasu polskiego test padł (także przy ponowieniu w tym samym jobie). Oczekiwano „Poprawka wpisu z dziś,”, było „Poprawka wpisu z wczoraj, 23:31”. Test zasiewa wpis „30 minut temu”, więc między 00:00 a 00:30 wpis jest „wczoraj”.
2. **Web E2E, `apps/web/test/e2e/work-order-journal-accessibility.spec.ts:92`** — „EVM-038 AC3 AC4 the automatic entries and the filter "Zmiany statusów"” przy 360/768/1280/1440 px: o 00:36–00:45 czasu polskiego (23:36–23:45 UTC) axe zgłosił `landmark-unique (2)` w dzienniku; ten sam plik przeszedł o 00:01 i po 01:08, lokalnie o 23:40 także. Hipoteza: w oknie 00:00–01:00 czasu polskiego (data UTC ≠ data lokalna) dane „względem teraz” dają w dzienniku dwa regiony (grupy dni) o tej samej nazwie dostępnej. **Nie wiadomo**, czy to wada wyłącznie danych testowych, czy prawdziwy błąd dostępności dziennika (WCAG 2.2 AA) widoczny dla użytkownika o tej porze — historyjka ma to rozstrzygnąć.
3. **API, test `session-activity` „EVM-067 AC5”** — przekroczył limit 20 s przy pełnym równoległym przebiegu lokalnej bramki (jednorazowo; po ponowieniu bramka zielona).
4. **Web E2E na Firefoksie** (lokalny kontener `web-e2e-linux`): `login-accessibility.spec.ts:68` (EVM-067 AC6) i `work-order-editing.spec.ts:224` (EVM-035 AC5) przeszły dopiero przy ponowieniu (flaky).

Kontynuacja EVM-126 (ta sama klasa problemu: niestabilne testy blokujące scalanie), dotyczy innych testów.

## Kryteria akceptacji

**AC1 — Testy dziennika niezależne od pory dnia**
- Zakładając testy z pkt 1 i 2 (EVM-037 AC3, EVM-038 AC3 AC4) i zegar ustawiony w oknie 00:00–01:00 czasu Europe/Warsaw oraz dokładnie na granicy doby (23:59:59 / 00:00:00)
- Gdy testy zostaną uruchomione (zegar przeglądarki zamrożony albo jawnie ustawiony czas danych zasiewanych, bez zależności od rzeczywistej pory)
- Wtedy oba przechodzą dla wszystkich tych czasów, przy tych samych szerokościach (360/768/1280/1440 px dla EVM-038), z niezmienionymi asercjami (tekst „z dziś,” / „z wczoraj,” sprawdzany zgodnie z zamierzeniem testu).

**AC2 — Rozstrzygnięcie `landmark-unique`**
- Zakładając dziennik zlecenia ze wpisami z dwóch różnych dat lokalnych (Europe/Warsaw), w tym przypadek, gdy data UTC ≠ data lokalna
- Gdy przyczyna `landmark-unique (2)` zostanie ustalona (dowód w Dzienniku historyjki: który element, jakie nazwy dostępne, przy jakich danych)
- Wtedy: (a) jeśli to błąd panelu — poprawka w kodzie panelu z testem (`EVM-129 AC2`), po której dziennik ma unikalne nazwy dostępne regionów/grup dla dowolnej pory i podziału dni wg strefy Europe/Warsaw (zapis w UTC), a axe nie zgłasza `landmark-unique`; (b) jeśli to wyłącznie dane testowe — poprawka danych i zapis uzasadnienia w Dzienniku, wraz ze wskazaniem, że panel nie ma błędu.

**AC3 — `session-activity` EVM-067 AC5 odporny na obciążenie**
- Zakładając test API `session-activity` „EVM-067 AC5” w kontenerze `backend-tests`
- Gdy ustalono przyczynę wrażliwości na obciążenie (np. kolejność/oczekiwanie, wspólne zasoby w równoległym przebiegu) i usunięto ją bez ślepego podnoszenia limitu 20 s
- Wtedy test przechodzi co najmniej 10 razy z rzędu, w tym pod sztucznym obciążeniem (pełny równoległy przebieg bramki); liczby przebiegów zapisane w Dzienniku. Zmiana dotyczy wyłącznie testu — logika sesji bez zmian.

**AC4 — Dwa testy Firefoksa**
- Zakładając `login-accessibility.spec.ts:68` (EVM-067 AC6) i `work-order-editing.spec.ts:224` (EVM-035 AC5) uruchamiane na Firefoksie w `web-e2e-linux`
- Gdy ustalono przyczynę niestabilności (np. oczekiwanie na stan zamiast czasu, wyścig z renderem) i usunięto ją
- Wtedy każdy z testów przechodzi 20 razy z rzędu na Firefoksie bez ponowień; jeśli awarii nie da się odtworzyć, w Dzienniku jest udokumentowana próba (liczba powtórzeń, warunki, wynik), a testy pozostają **bez zmian „na ślepo”**.

**AC5 — Bez osłabiania**
- Zakładając wszystkie zmiany tej historyjki
- Gdy przegląd `code-reviewer` porównuje diff
- Wtedy żaden test nie jest wyłączony, pominięty ani osłabiony (asercje, liczba przypadków), limity czasu nie wzrosły bez udokumentowanej przyczyny, a progi pokrycia pozostają bez zmian (pokrycie zmienionego kodu ≥ 90%).

**AC6 — CI**
- Gdy PR jest gotowy
- Wtedy `ci-gate` (w tym `e2e-web`) jest zielony; jeśli to wykonalne, w CI (lub w przebiegu lokalnym `web-e2e-linux`) jest dowód uruchomienia testów dziennika z czasem ustawionym na okno północy.

## Poza zakresem
- Inne niestabilne testy niewymienione wyżej — kolejna historyjka.
- Zmiany funkcjonalne dziennika poza ewentualną poprawką nazw dostępnych regionów (AC2a).
- Zmiany logiki sesji i uwierzytelniania; zmiana progów pokrycia; ogólna zmiana strategii testowania.

## UX / UI
Bez zmian wizualnych. Ewentualna poprawka nazw dostępnych regionów dziennika (AC2a) — do wglądu `ux-designer` przy demo.

## Bezpieczeństwo i prywatność
- Dane testowe wyłącznie syntetyczne.
- Test sesji (`session-activity`) dotyczy obszaru uwierzytelniania — dozwolona zmiana tylko w teście. Jeśli okaże się potrzebna zmiana logiki sesji: stop, zapis w Dzienniku i raporcie oraz pytanie o ścieżkę pełną (z `security-engineer`).

## Notatki techniczne
- `web-developer`: pkt 1, 2, 4 (testy E2E i ewentualna poprawka dziennika w panelu).
- `backend-developer`: pkt 3 (`session-activity`).
- Uruchamianie: testy web natywnie oraz `docker compose -f compose.yaml run --rm web-e2e-linux`; testy API w kontenerze `backend-tests` (`docker compose -f compose.yaml run --rm backend-tests ...`).
- Blokadę (np. brak powtarzalności awarii) wykonawca zapisuje w Dzienniku i raporcie, nie zgaduje.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją (ścieżka lekka — krótka notatka w Dzienniku wystarczy)._

## Decyzje
- Ścieżka `lekka` (testy i drobna ewentualna poprawka nazw regionów; bez zmiany logiki sesji), jeden recenzent `code-reviewer` — do potwierdzenia rano.
- Zależność od EVM-126 (ta sama klasa problemu, wcześniejsze poprawki; unikanie konfliktów w testach) — do potwierdzenia rano.
- Zakres AC4 dopuszcza brak zmiany testów, gdy awarii nie da się odtworzyć (zamiast zmiany „na ślepo”) — do potwierdzenia rano.
- Liczby powtórzeń (10 dla API, 20 dla Firefoksa) przyjęte analogicznie do EVM-126 — do potwierdzenia rano.
- Jeśli `landmark-unique` okaże się błędem panelu, poprawka mieści się w tej historyjce (tylko nazwy dostępne regionów), bez zmian funkcjonalnych — do potwierdzenia rano.

## Uwagi do rozważenia
- Wspólny pomocnik czasu w testach E2E (jeden sposób ustawiania zegara) mógłby zapobiec nawrotom — decyzja wykonawcy, bez rozszerzania zakresu.
- Nocne uruchomienie CI z czasem w oknie północy jako stała bramka — osobna historyjka, jeśli problem wróci.

## Definition of Done
- [ ] AC1–AC6 spełnione, testy oznaczone `EVM-129 AC#` tam, gdzie dodano kod/test
- [ ] Przyczyny (pkt 1–4) i rozstrzygnięcie `landmark-unique` zapisane w Dzienniku z liczbami przebiegów
- [ ] Brak osłabionych, wyłączonych i pominiętych testów; progi bez zmian (przegląd `code-reviewer`)
- [ ] `pnpm run gate` zielony, `npm run docs:check` bez błędów
- [ ] `ci-gate` (w tym `e2e-web`) zielony na PR
- [ ] Ewentualna poprawka nazw regionów dziennika zaakceptowana przez `ux-designer` przy demo

## Dziennik
- 2026-11-14 — utworzono (product-owner) na podstawie obserwacji z nocnej kolejki 13/14.11 (PR #137, przebieg 43523376456)
- 2026-11-14 — akceptacja Konrada (czat nocny: „Niech ruszy tor stabilności testów”) — zakres: testy dziennika w oknie północy, session-activity EVM-067 AC5, dwa testy Firefoksa; status `ready` (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej (Tech Lead): status `in-progress`, gałąź `feature/EVM-129-stabilne-testy-okno-polnocy`
- 2026-11-14 — web-developer, AC1/AC2/AC4. AC2: przyczyna `landmark-unique (2)` pewna — `seedEvents` dawał listę poza kolejnością serwera (zdarzenia 5–45 min, potem notatki 30/60/90 min); o 00:36–00:59 (zima) wychodziło dziś, wczoraj, dziś, wczoraj, więc dwie sekcje `<section aria-labelledby>` z nagłówkiem „Dziś” i dwie „Wczoraj”; panel grupuje po dobie `Europe/Warsaw` poprawnie dla wejścia posortowanego (serwer sortuje po `createdAt`) — to wyłącznie dane testowe (b), kod panelu bez zmian. Odtworzone deterministycznie zegarem: 8 niepowodzeń (00:40 zima i lato × 4 szerokości) przed poprawką, 0 po. AC1: wspólny pomocnik `clock.ts` (`freezeClock`, `MIDNIGHT_WINDOW`: zima 23:59:59, 00:00:00, 00:01, 00:20, 00:40, 00:59, lato 00:01, 00:40, 23:59:59), zegar karty `page.clock.setFixedTime` i `journal.now` serwera zsynchronizowane; EVM-037 AC3 zasiewa wpis w tej samej dobie co „teraz” (krok 0 min), asercje „z dziś,” bez zmian, plus przypadek 00:00:00 z wpisem z 23:59:59 („z wczoraj, 23:59”); EVM-038 × 4 szerokości × 9 czasów. Wynik: 130/130 w `web-e2e-linux` (Chromium + Firefox). Uwaga: Firefox pisze „00:00”, Chromium „0:00” (ICU) — asercja regex. AC4: `work-order-editing.spec.ts` EVM-035 AC5 — przyczyna pewna: pętla 41 kolejnych dialogów trwała ~21 s, pod obciążeniem przekraczała limit testu 30 s (18/20 niepowodzeń w Firefoksie przy `--repeat-each=20`, `Test timeout of 30000ms`); poprawka: serwer syntetyczny ma od razu 49 pozycji, test dodaje 50. przez dialog, asercje przycisku bez zmian; 20/20 po poprawce (6 s na przebieg). `login-accessibility.spec.ts:68` (EVM-067 AC6) — nie odtworzono: 160 przebiegów Firefox (4 szerokości × 20 × 2 serie, w tym `--workers=8`), 0 niepowodzeń; test bez zmian.
- 2026-11-14 — backend-developer, AC3. `session-activity.test.ts` w `backend-tests`: pojedyncze przypadki trwają 40–250 ms. Awarii (limit 20 s) nie odtworzono: 10 przebiegów pod 64-krotnym przeciążeniem CPU (16 rdzeni, 64 pętle) — wszystkie zielone, przypadki ≤ 2 s. Przyczyna to hipoteza: jedyny przypadek budujący kilka aplikacji (`a denied request records nothing`, trzy pełne uruchomienia grafu modułów w jednym `it`) dzielił jeden budżet 20 s i jako jedyny skaluje się z obciążeniem krotnie. Poprawka tylko w teście: `it.each` z trzema przypadkami (wrong role, session in enrolment, failed query check), każdy z własną aplikacją i budżetem; asercje (status, `touch` nie wywołane) i limit 20 s bez zmian, liczba przypadków 7 → 9. Dowód: 10/10 zielonych przebiegów pliku przy równoległym pełnym przebiegu testów jednostkowych API i 32 pętlach CPU. Logika sesji bez zmian. Do potwierdzenia rano: poprawka na hipotezie.
- 2026-11-14 — workflow `deliver-story` (lekka) `passed`, code-reviewer: approve (uwagi minor: poprawka `session-activity` na hipotezie; test limitu 50 pozycji zasiewa 49 w atrapie). Sprawdzenie orkiestratora: pełny `web-e2e-linux` 1372 passed, 0 failed, 21 skipped, 3 flaky na Firefoksie przeszły przy ponowieniu (`customer-erasure.spec.ts:92` EVM-041 AC7, `customer-management-accessibility.spec.ts:26` EVM-039, `work-orders.spec.ts:78` EVM-017 AC8 — inne niż objęte historyjką; przebieg szedł równolegle z pracą drugiego toru); `pnpm run gate` zielona u wykonawców po ostatniej zmianie kodu (zmieniono tylko testy — brak mierzalnych zmian kodu źródłowego). AC6 potwierdzi `ci-gate` na PR. Koszt: 3 agentów, ok. 210 tys. tokenów, 45 min. Status `in-review` (Tech Lead, kolejka nocna)
- 2026-11-14 — akceptacja Konrada przez scalenie PR #138 (main `c5918489`); status `done` (Tech Lead)
