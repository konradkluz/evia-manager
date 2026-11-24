---
id: EVM-139
title: "API i worker: wizja lokalna — automatyczne trwałe usuwanie (90 / 14 dni), rejestr usunięć, tryb report i enforce"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: done
priority: P1
path: pelna             # pierwsze automatyczne usuwanie danych biznesowych, art. 17 RODO, nowy sekret
owner: backend-developer
contributors: [devops-engineer]   # osobny klucz rejestru usunięć dla `worker` (RR-55), manifest sekretów i polityka bucketu w IaC
reviewers: [code-reviewer, security-engineer]
model: opus             # operacja nieodwracalna, sekrety, zegar w testach
depends_on: [EVM-135, EVM-136, EVM-140, EVM-051]
---

# EVM-139: Automatyczne usuwanie wizji

## Cel
Jako **administrator danych (EVia Charge)** chcę, aby **wizje lokalne, które nie zostały klientem, były usuwane automatycznie i trwale — zdjęcia, filmy, adres i pola swobodne — a po zleceniu został anonimowy „nagrobek”**, aby **zysk prywatności z „wizji bez klienta” był realny (dziś anulowane zlecenie leży 12 miesięcy)** (W1, blocker). Wykonuje się w `worker` zgodnie z [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md) pkt 9.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”. 2. Zwykły numer od razu. 3. **Wizja bez klienta usuwana po 90 dniach (przedłużenie A/E), odrzucona po 14 dniach.** 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. Tylko odczyt bez dostępu; telefon: twórca i opiekun. 10. Adres tylko w szczegółach. 11. Klient po przypisaniu niezmienny, telefon czyszczony. 12. **Luki w numeracji akceptowane** (nagrobek zachowuje numer, więc luk nie ma). 13. Wizje na głównej liście. 14. Przypomnienie 15 dni przed; przedłużenie tylko w panelu ≤ 2; limit 20 / 100. 15. **Trwałe usuwanie (`enforce`) dopiero po uruchomieniu kopii zapasowych; do tego czasu tryb `report` (tylko liczy).** 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu.

## Kryteria akceptacji
Operacja systemowa (bez użytkownika); ślad w audycie i alertach dla Administratora.

**AC1 — Wybór kandydatów i tryb `report`**
- Zakładając tryb `report` (domyślny do czasu kopii) i wizje: po terminie, przed terminem, z klientem, już usunięte
- Gdy działa zadanie
- Wtedy wybiera wyłącznie wiersze `site_survey_expires_at < now() AND customer_id IS NULL AND site_survey_purged_at IS NULL` (trzy warunki), **nic nie usuwa**, zapisuje liczbę kandydatów (bez danych osobowych) w dzienniku i metryce; test z kontrolowanym zegarem (dzień 89 — poza, 91 — kandydat); przejście na `enforce` to zmiana konfiguracji (decyzja Konrada po starcie kopii, poza tą historyjką).

**AC2 — `enforce`: rejestr przed zmianą, potem usunięcie**
- Zakładając tryb `enforce` i wizję-kandydata
- Gdy zadanie ją przetwarza (partie, jedna transakcja na wizję)
- Wtedy najpierw powstaje wpis w rejestrze usunięć (identyfikatory zlecenia i mediów, bez treści, adresu i telefonu), potem: media ścieżką EVM-051 (obiekty kasowane po commicie z dokończeniem), wpisy dziennika zredagowane, lokalizacja utworzona dla wizji i niewskazywana przez inne zlecenie ani dokument zanonimizowana (migracja `sites`: `anonymized_at`, `anonymized_by`, CHECK i trigger nieodwracalności), tytuł i opis zlecenia neutralne, telefon `NULL`, `deleted_at` i `site_survey_purged_at` (jednokrotny zapis); zlecenie zostaje jako anonimowy nagrobek z numerem; gdy wpis do rejestru się nie powiedzie, wizja nie jest ruszana i jest alert.

**AC3 — Anulowane po 14 dniach, ochrona zleceń z klientem, wyścig**
- Zakładając wizję anulowaną (termin = najmniejsza z wartości, EVM-136), wizję z przypisanym klientem i wizję przywróconą
- Gdy mija termin lub równolegle przypisuję klienta
- Wtedy anulowana znika po 14 dniach jak w AC2; zlecenie z klientem (także przypisanym w ostatniej chwili) nigdy nie jest usuwane (CHECK i warunek zapytania); przywrócona dostaje nowy termin z EVM-136; test wyścigu „przypisanie ↔ usunięcie”: wygrywa jedno, bez uszkodzenia danych.

**AC4 — Synchronizacja i kolejki telefonów**
- Zakładając usuniętą wizję
- Gdy telefony i panel pobierają zmiany
- Wtedy `sync.change_log` dostaje znacznik `delete` (same identyfikatory), telefon usuwa wizję, a mutacje i pliki z kolejki do niej dostają `rejected target_unavailable` bez ponawiania (W10); `change_log`, audyt i logi nie zawierają adresu ani telefonu; eksportu ZIP wizji nie ma; media usuniętej wizji nie są dostępne dla żadnej roli.

**AC5 — Odporność i ponowienia**
- Zakładając awarię w trakcie (część mediów usunięta) albo błąd usuwania obiektu
- Gdy zadanie ponawia
- Wtedy kończy usuwanie bez duplikatów wpisów w rejestrze i bez osieroconych obiektów (SR-FILE-11), pozostałe wizje są przetwarzane, trwały błąd daje alert i ślad dla Administratora; zadanie ma limit liczby usunięć na przebieg i dziennik bez danych osobowych.

**AC6 — Uprawnienia, konfiguracja i klucz rejestru**
- Zakładając Edytora, Administratora i `worker`
- Gdy ktoś próbuje usunąć wizję „od ręki” albo zmienić okresy
- Wtedy nie ma takiej operacji (usuwa wyłącznie zadanie; wcześniej — zwykłe trwałe usunięcie z EVM-051); okresy 90/14 dni są stałymi w kodzie (SR-PRIV-01) z testem granic; `worker` zapisuje do rejestru własnym poświadczeniem wyłącznie `PutObject` (manifest sekretów i polityka bucketu w IaC; przegląd devops i security) i nie ma `DELETE` na tabelach aplikacji poza zakresem zadania.

## Poza zakresem
Przypomnienia, przedłużenie, limit (EVM-140); ekrany; anonimizacja zamiast usunięcia dla zleceń z klientem; zmiana retencji zwykłych zleceń; odtwarzanie z kopii; samo włączenie `enforce`.

## Decyzje i ograniczenia
- Konsultacja architekta — ADR-0024 (pkt 9, migracje): `worker`, nagrobek, rejestr w tej samej transakcji (TM-128), `report` → `enforce`; pierwsze terminy 90 dni przypadają po 2027-02-14, anulowane wizje czekają najwyżej do włączenia `enforce`. Bezpieczeństwo: W1, W2, W5, W10, W11; RR-55 do aktualizacji przy scaleniu.
- Kopie bazy: termin 2026-12-13 (RR-91) — `enforce` włącza Konrad po ich starcie.

## Notatki
Rozmiar wg ADR-0024: **L**. Ostatnia w kolejności (po 138); do tego czasu wszystkie wizje są testowe (decyzja 16).
- **AC6 spełnione częściowo — decyzja Konrada:** osobne poświadczenie `worker` do rejestru usunięć (wyłącznie `PutObject`; manifest sekretów, polityka bucketu) NIE jest w kodzie infrastruktury — nowy plik w manifeście sekretów zatrzymałby kanał wdrożeń do czasu utworzenia sekretu na VM. Jest opis kroków w `docs/ops/runbooks/retencja.md` („Włączenie `enforce` — kroki”). W trybie `report` rejestr nie jest używany; w `enforce` bez poświadczenia zadanie odmawia bezpiecznie (wizja nietknięta, audyt i alert). Rekomendacja security i Tech Leada: wydzielić część IaC do osobnej historyjki (sesja IaC z Konradem) i zamknąć EVM-139 z tą adnotacją.
- **Warunki konieczne przed włączeniem `enforce` (osobny PR zatwierdzony przez Konrada):** (1) działające kopie zapasowe (RR-91) i test odtworzenia obejmujący wpisy `site_survey_purged` (narzędzie odtwarzania z EVM-062 wymaga rozszerzenia — `docs/ops/runbooks/rejestr-usuniec.md` pkt 4); (2) własny klucz `worker` do rejestru + wynik `bucket-verify.sh`; (3) tydzień zgodnych liczb kandydatów w trybie `report`; (4) decyzja w sprawie wyścigu z zapisami potomnymi (niżej); (5) aktualizacja RR-55 i RR-102.
- **Rozstrzygnięcia z delegacji (do potwierdzenia przy demo):**
  1. „Lokalizacja założona dla wizji” nie ma znacznika w danych — reguła: ten sam twórca, utworzona do 24 h przed wizją, niewskazywana przez inne zlecenie ani dokument; starsze lokalizacje zostają (adres może zostać w bazie).
  2. Rejestr działa „co najmniej raz”: transakcja wycofana po zapisie do rejestru zostawia osierocony wpis (także przy przerwaniu z powodu medium dodanego w trakcie usuwania — licznik `changedDuringPurge`, ponowienie w następnym przebiegu).
  3. `media_assets.deleted_by` = autor uploadu (klucz obcy do użytkowników nie przyjmuje aktora systemowego) — w danych wygląda na usunięcie przez człowieka; do opisania w runbooku audytu.
  4. Znacznik redakcji wpisów dziennika zostaje „…przez administratora” (wyzwalacz przyjmuje tylko ten wzorzec).
  5. Usuwanie zeruje także notatki pozycji zakresu, „powód blokady” i „notatki” etapów procesu, a nazwę etapu dopisanego ręcznie zmienia na „Etap” (ustalenie major z przeglądu security, `810906ca`).
  6. Tryb w `infra/runtime/compose.staging.yaml`: `SITE_SURVEY_PURGE_MODE: report`; pusta lub błędna wartość zatrzymuje start zadania.
- **Ryzyka rezydualne (security / przegląd kodu) — do decyzji przed `enforce`:** wpis potomny (medium, notatka, pozycja) dodany dokładnie w trakcie usuwania może zostać przy nagrobku (propozycja: wyzwalacz odrzucający wstawienia do zlecenia z `site_survey_purged_at`); okno milisekund między ponownym odczytem mediów a ich oznaczeniem nie jest zamknięte blokadą; przy 50 lub więcej trwale błędnych najstarszych kandydatach limit 50 na przebieg blokuje pozostałe.
- **Minor / nit z przeglądów — zostają:** przywrócenie nagrobka z kosza kończy się `500` zamiast `409` (i nagrobki są widoczne w „Koszu”); odwrotna kolejność blokad „pliki → medium” względem reszty modułu mediów (możliwe zakleszczenie = ponowienie); powtarzalny błąd po zapisie do rejestru dopisuje kolejny osierocony wpis i alert przy każdym przebiegu; zapytanie o kandydatów nie korzysta z indeksu częściowego; tytuł jednego testu w `deploy-agent.test.ts` niezgodny z zachowaniem; dowód „bez `DELETE`” dotyczy roli `evia_app` (osobnej roli `worker` nie ma).

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-17 — start realizacji w kolejce `/noc-2026-11-16` (tor E, klon n1, gałąź `feature/queue-2026-11-17-wizja-lokalna-usuwanie` od części API EVM-140 `75050884`); **status `in-progress`** (Tech Lead)
- 2026-11-17 — implementacja (backend-developer): zadanie `work-orders.site-survey-purge`, tryby `report` / `enforce`, uczestnicy `media` / `timeline`, fasada `sites`, migracja `0068` `a6c2f01a`; dokumenty i tryb `report` we wdrożeniu `414b5ac9`; akcje audytu w kontrakcie `fb5560a2`; etykiety audytu w panelu `8d13a9ba` (Tech Lead)
- 2026-11-17 — przeglądy: security-engineer **APPROVE z uwagami** (tylko dla trybu `report`) z jednym major (wolny tekst pozycji zakresu i etapów procesu) — poprawione `810906ca`; QA **PASS z uwagami**, AC6 częściowo (raport `docs/qa/EVM-139/raport-qa.md`, ścisły test AC4 i testy brzegowe `7f8742f3`); code-reviewer **APPROVE z uwagami** z jednym major (medium dodane w trakcie usuwania) — poprawione `040d4ae2`
- 2026-11-17 — bramka lokalna na gałęzi zintegrowanej z `main` po scaleniu PR #148: `pnpm run gate` — 68/68 zadań, pokrycie zmienionego kodu (natywne) linie 96,4%, gałęzie 97,4% po dopisaniu testów `681908ef`; `npm run test:tools`, `npm run docs:check` (0 błędów), `pnpm run gate:deploy` — kody wyjścia 0; pełna integracja API, E2E Linux i skany — w CI PR-u. **Status `in-review`** — PR wspólny z EVM-140; AC6 częściowo — decyzja Konrada (Tech Lead)
- 2026-11-23 — ocena security wyścigu dla dziennika (notatki i komentarze z panelu: `create-entry.service.ts:120`; z telefonu: `push-mutations.service.ts:213`, `stateOf`): **Low (minor)** — wpis zatwierdzony w trakcie usuwania (także korekta `supersedesEntryId`, wpis przypisany do etapu) może zostać z tekstem przy nagrobku; po zatwierdzeniu usuwania zapis jest odrzucany (panel `404`, telefon `target_unavailable`). Konrad: **ryzyko przyjęte do czasu włączenia `enforce`** (decyzja przed `enforce` jak powyżej); EVM-150 obejmuje tylko media. Obrona w głębi (wyzwalacz odrzucający `INSERT`) — backlog, wymaga decyzji architekta
- 2026-11-24 — zaakceptowane przez Konrada (kod scalony w main); status `done`
