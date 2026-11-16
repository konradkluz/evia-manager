# Runbook: retencja danych — gdzie są okresy i co robimy ręcznie do M4

> Dokument żywy (EVM-064 AC6). Właściciel: `security-engineer`; konfiguracja: `devops-engineer`; procedurę ręczną wykonuje Administrator (Konrad). Wymagania: SR-PRIV-01, SR-DATA-07; okresy: [`policies.md` → P4](../../security/policies.md#p4--retencja-mediów-dokumentów-dzienników-audytu-logów-i-kopii) i [`rodo.md` → „Retencja”](../../security/rodo.md#retencja) (źródło prawdy — zmiana okresu = zmiana `rodo.md` zaakceptowana przez Konrada i zmiana w miejscu z kolumny „Gdzie”). Stan sprawdzony w kodzie i IaC gałęzi 2026-11-14.

## 1. Dane techniczne — usuwane automatycznie
Okresy są **nazwanymi stałymi w kodzie** albo regułami IaC / ustawieniami u dostawcy — każdy okres w jednym miejscu, zmiana przez PR („konfiguracja jako kod” — SR-PRIV-01, decyzja w sekcji 4).

| Dane (P4) | Okres | Mechanizm | Gdzie | Stan |
|---|---|---|---|---|
| Sesje (IP, przeglądarka) | 30 dni od zakończenia | zadanie `identity.purge-sessions` (codziennie 03:50) | `SESSION_RETENTION_MS` — `apps/api/src/modules/identity/domain/constants.ts` | działa (EVM-028) |
| Urządzenia mobilne i stan synchronizacji | 90 dni od unieważnienia albo ostatniego kontaktu | to samo zadanie (`purgeStaleDevices`) | `DEVICE_RECORD_RETENTION_MS` — jw. | działa (EVM-095) |
| Tokeny dostępu kanału `mobile` | doba po wygaśnięciu | to samo zadanie | `ACCESS_TOKEN_RETENTION_MS` — jw. | działa (EVM-094) |
| Liczniki prób, pierwsze kroki logowania, wyzwania mobilne | 30 minut | zadanie `identity.purge-login-security` (co 15 min) | `THROTTLE_RETENTION_MS` — `identity/domain/throttle-policy.ts` | działa (EVM-026) |
| Rejestr przeglądarek konta | 30 dni od ostatniego użycia | jw. | `DEVICE_RETENTION_MS` — `identity/domain/constants.ts` | działa (EVM-026) |
| Klucze idempotencji | 30 dni | zadanie `platform.purge-idempotency` (04:10) | `IDEMPOTENCY_RETENTION_MS` — `apps/api/src/platform/idempotency/idempotency.ts` | działa (EVM-079) |
| Media w kwarantannie | 30 dni (bajty ok. 60 dni — RR-51) | zadanie `media.quarantine-retention` (co godzinę) + wygasanie starszych wersji | `QUARANTINE_RETENTION_DAYS` — `apps/api/src/modules/media/domain/quarantine.ts`; `noncurrent_days = 30` — `infra/tofu/modules/object-storage/main.tf` | działa (EVM-049) |
| Niedokończone uploady | 7 dni | stan `failed` / `abandoned` + reguła multipart | `SESSION_LIFETIME_MS` — `media/domain/upload-plan.ts`; `abort_incomplete_multipart_upload_days = 7` — IaC | działa (EVM-049) |
| Pliki eksportu ZIP | 24 h | worker po `expires_at` + reguła bucketu 1 dzień | `EXPORT_LIFETIME_MS` — `media/domain/export-plan.ts`; `expiration days = 1` — IaC | w kodzie i IaC (EVM-052); bucket z posiedzenia A EVM-084, eksport na żywo — po EVM-124 (A12) |
| Stare wersje obiektów mediów | 30 dni | reguła bucketu | IaC (`noncurrent_days = 30`) | działa |
| Rejestr usunięć | 40 dni | reguła bucketu | IaC (`days = 40`) | działa |
| Kopie bazy (PITR) / niezmienne wersje | 30 / 37 dni | pgBackRest + object lock | `infra/runtime/pgbackrest/pgbackrest.conf`; IaC (`days = 37`) | **nieaktywne do posiedzenia B** (RR-91) |
| Snapshoty kopii mediów (Storage Box) | 14 dni | ustawienie Hetzner | konto Hetzner | po posiedzeniu B (EVM-084) |
| Kopie dysku systemowego VM | 7 dni | ustawienie Hetzner | konto Hetzner | sprawdza Konrad — [protokół AC1](../../qa/EVM-064/protokoly.md) |
| Logi lokalne na VM | 7 dni | journald `MaxRetentionSec=7day` | `infra/tofu/modules/vm/templates/user-data.yaml.tftpl` (istniejąca VM — krok ręczny, RR-66) | ustawione w posiedzeniu A (EVM-084, krok A8) |
| Logi i metryki (Grafana Cloud) | 14 dni | plan Grafana Cloud | konto Grafana | sprawdza Konrad — protokół AC1 |
| Logi e-mail (Scaleway TEM) | dopóki domena TEM jest aktywna | ustawienie dostawcy | konto Scaleway | decyzja EVM-089 (bez skracania; usunięcie adresu na zgłoszenie); raz w roku przegląd przy przeglądzie retencji (sekcja 2) — adresy osób, które odeszły albo zgłosiły żądanie: zgłoszenie usunięcia do wsparcia Scaleway |

**Luki (do decyzji Konrada — sekcja 4):**
- `sync.change_log` (P4: 90 dni) — **nie ma zadania usuwania**, a rola aplikacji ma na tabeli tylko `SELECT` (ADR-0021). Wiersze to identyfikatory encji i kody (migracja 0054) — bez danych klientów; identyfikatory pseudonimowe.
- `media.media_exports` — wiersze (zlecający — identyfikator pracownika `requested_by`, zlecenie, stan, rozmiar; migracja 0063) bez terminu — bez danych klientów; identyfikatory pseudonimowe (opisane w `rodo.md`).
- Poza P4, tylko identyfikatory i skróty: wiersze linków jednorazowych (aktywacja, reset hasła) i `platform.security_alert_outbox` — bez zadania usuwania; do ujęcia w zadaniu retencji M4 (Low).

## 2. Dane biznesowe — procedura ręczna do M4
Zadanie retencji danych biznesowych powstaje w M4 (SR-DATA-07, „polityki retencji” w roadmapie). Do tego czasu Administrator wykonuje przegląd ręczny. **Wyjątek — wizje lokalne bez klienta** (90 / 270 / 14 dni): usuwa je osobne zadanie (EVM-139), a do jego trybu `enforce` — cotygodniowy przegląd ręczny z [sekcji 5](#5-wizja-lokalna--okresy-tryb-report-i-enforce-procedura-ręczna-evm-141). **Pierwsze terminy** (licząc od pierwszych realnych danych w listopadzie 2026): zlecenia anulowane przed akceptacją i klienci bez zleceń — najwcześniej listopad 2027; strony (osoby fizyczne), konta pracowników i dziennik audytu — listopad 2028; zlecenia zamknięte — 2033.

**Kiedy:** raz na kwartał, **pierwszy przegląd w październiku 2027** (przed pierwszym terminem). Jeśli do tego czasu działa zadanie z M4 — przegląd ręczny znika z tego runbooka.

| Kategoria (P4) | Kto spełnia warunek | Operacja w panelu (Administrator) |
|---|---|---|
| Zlecenie anulowane przed akceptacją — 12 mies. od anulowania | lista zleceń, status „Anulowane”, data anulowania | zdjęcia i dokumenty zlecenia: trwałe usunięcie pliku (EVM-051, step-up); wpisy z danymi osób: redakcja (EVM-040); tytuł i opis z danymi osoby: edycja na neutralne; „Usuń zlecenie” (EVM-060); klient bez innych zleceń — jak wiersz niżej |
| Klient bez zleceń — 12 mies. od utworzenia; klient po retencji ostatniego zlecenia | lista klientów | anonimizacja klienta (EVM-041, step-up) + zakres ręczny z [`prawa-osob.md` → „Art. 17”](prawa-osob.md#art-17--usunięcie) (lokalizacje, strony, wpisy, dokumenty — RR-60) |
| Strona — osoba fizyczna lub osoba kontaktowa — 2 lata od ostatniego zlecenia | strony powiązane tylko ze starymi zleceniami | edycja strony: dane osoby zastąpione wartościami neutralnymi („Osoba usunięta”, puste telefon, e-mail i notatki) |
| Konto pracownika — 2 lata od dezaktywacji | Administracja → Użytkownicy, „Dezaktywowane” | do M4 bez operacji anonimizacji konta — zapis w karcie przeglądu „czeka na M4” |

Pełne usunięcie wierszy (purge) zleceń i klientów nie istnieje do M4 — powyższe operacje usuwają dane osób, a struktura (identyfikatory, kody, kwoty) zostaje. Kopie zapasowe wygasają same (do 37 dni — RR-14). Do rejestru usunięć trafiają tylko redakcja wpisu, trwałe usunięcie pliku i anonimizacja klienta; edycje na wartości neutralne (tytuł i opis zlecenia, strony, lokalizacje) i „Usuń zlecenie” nie. Dlatego w karcie przeglądu zapisz identyfikatory edytowanych obiektów, a po odtworzeniu bazy z kopii przejrzyj rejestr żądań i karty przeglądów retencji od punktu odtworzenia i powtórz operacje ręczne (neutralizacja lokalizacji i stron, soft delete z art. 18) — [restore](restore.md).

**Karta przeglądu** (poza repozytorium, w rejestrze żądań i przeglądów — [`rodo.md` → „Rejestry poza repozytorium”](../../security/rodo.md#rejestry-poza-repozytorium)): data · kto · kategoria · liczba obiektów · identyfikatory obiektów edytowanych ręcznie (do powtórzenia po odtworzeniu kopii) · wykonane operacje (bez nazw i danych osób) · co czeka na M4.

## 3. Sprawdzenie zgodności (przy zmianie okresu i przed wydaniem)
1. `rodo.md` „Retencja” i P4 mają ten sam okres.
2. Wartość w miejscu z kolumny „Gdzie” jest taka sama (stała w kodzie, reguła IaC, ustawienie u dostawcy).
3. Zmiana okresu = jeden PR ze zmianą `rodo.md`, P4 i stałej / reguły; test zadania z kontrolowanym zegarem (SR-DATA-07).

## 4. Pytania do decyzji Konrada (EVM-064, demo)
Decyzje: 2026-11-14 — decyzja Tech Leada z delegacji Konrada (demo EVM-064: wybór wariantu najbezpieczniejszego przekazany Tech Leadowi); Konrad potwierdza ją scaleniem PR z tą zmianą.
1. **SR-PRIV-01 („konfiguracja, nie stałe w kodzie”).** Okresy są nazwanymi stałymi w kodzie i regułami IaC, nie zmiennymi środowiska. Rekomendacja: uznać to za „konfigurację jako kod” (jedno miejsce na okres, zmiana przez PR i `rodo.md`) i doprecyzować brzmienie SR-PRIV-01 — bez zmian kodu. **Decyzja: przyjęte** — brzmienie SR-PRIV-01 doprecyzowane w [`requirements.md`](../../security/requirements.md).
2. **Luki `sync.change_log` i `media.media_exports`.** Rekomendacja: zaakceptować jako dług techniczny (bez danych klientów; identyfikatory pseudonimowe) z historyjką w backlogu (`/refine`), nie warunek startu. **Decyzja: przyjęte z warunkiem — zadanie usuwania `sync.change_log` i `media.media_exports` działa najpóźniej 2027-02-11; historyjka przez `/refine`.** **Termin:** zadanie usuwania `sync.change_log` musi działać najpóźniej **2027-02-11** — 90 dni liczone zachowawczo od 2026-11-13, od kiedy środowisko może przyjmować realne dane (RR-93; stan na 2026-11-14 wg Konrada — realnych danych jeszcze nie ma); tabela istnieje od migracji 0054 (na `main` od 2026-10-31); nie czekać na M4.

## 5. Wizja lokalna — okresy, tryb `report` i `enforce`, procedura ręczna (EVM-141)
Wizja lokalna ([ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md)) to **pierwsze dane biznesowe usuwane automatycznie** — bez czekania na zadanie retencji M4. Okresy: [`rodo.md` → „Retencja”](../../security/rodo.md#retencja) i [P4](../../security/policies.md#p4--retencja-mediów-dokumentów-dzienników-audytu-logów-i-kopii); wymaganie SR-PRIV-11. **Stan na 2026-11-16: kodu jeszcze nie ma** (EVM-135…EVM-140 w realizacji) — nazwy stałych w tabeli są robocze; ostateczną nazwę i plik wpisuje historyjka, która stałą wprowadza (DoD: zgodność tej tabeli z kodem w przeglądzie `security-engineer`).

### Mapa okres → stała
| Okres / ustawienie | Wartość | Stała (nazwa robocza) | Gdzie (planowane) | Historyjka | Stan |
|---|---|---|---|---|---|
| Termin wizji od utworzenia | 90 dni | `SITE_SURVEY_RETENTION_DAYS` | domena `work-orders` (API) | EVM-135 | nie istnieje |
| Przedłużenie | +90 dni | `SITE_SURVEY_EXTENSION_DAYS` | jw. | EVM-140 | nie istnieje |
| Najwięcej przedłużeń | 2 (łącznie ≤ 270 dni) | `SITE_SURVEY_MAX_EXTENSIONS` | jw. | EVM-140 | nie istnieje |
| Wizja odrzucona (anulowana bez klienta) | 14 dni od anulowania, nie później niż bieżący termin | `SITE_SURVEY_CANCELLED_RETENTION_DAYS` | jw. | EVM-136 | nie istnieje |
| Przypomnienie przed usunięciem | 15 dni przed terminem | `SITE_SURVEY_REMINDER_LEAD_DAYS` | zadanie w `worker` | EVM-140 | nie istnieje |
| Limit otwartych wizji (przeciw „dzikiemu archiwum”) | 20 na twórcę, 100 łącznie | `SITE_SURVEY_OPEN_LIMIT_PER_CREATOR`, `SITE_SURVEY_OPEN_LIMIT_TOTAL` | domena `work-orders` | EVM-140 | nie istnieje |
| **Tryb usuwania** | `report` (domyślny) albo `enforce` | `SITE_SURVEY_PURGE_MODE` (konfiguracja wdrożenia) | zadanie w `worker` | EVM-139 | nie istnieje |
| Przełącznik funkcji | włączony po scaleniu EVM-135 (decyzja Konrada 16 — zastępuje w tym punkcie ADR-0024 pkt 10; zabezpieczenie zastępcze: zasada „tylko wizje testowe” i lista kontrolna przejścia) | `SITE_SURVEYS_ENABLED` (konfiguracja wdrożenia) | API | EVM-135 | nie istnieje |
| Rejestr usunięć — klucz `worker` | wyłącznie `PutObject` | manifest sekretów i polityka bucketu | IaC | EVM-139 AC6 | nie istnieje (RR-55) |

Okresy są stałymi w kodzie (SR-PRIV-01) — zmiana = jeden PR ze zmianą `rodo.md`, P4, tej tabeli i stałej, z testem granic (sekcja 3). Tryb i przełącznik są konfiguracją wdrożenia, bo zmienia je decyzja Konrada bez zmiany okresów.

### Tryb `report` i `enforce`
- **`report`** (domyślny): zadanie codziennie wybiera kandydatów (termin minął, brak klienta, nieusunięte) i zapisuje **tylko ich liczbę** w dzienniku i metryce — nic nie usuwa (EVM-139 AC1).
- **`enforce`**: zadanie trwale usuwa kandydatów (EVM-139 AC2) — najpierw wpis w rejestrze usunięć, potem pliki, wpisy, lokalizacja wizji i telefon; zostaje anonimowy nagrobek z numerem.
- **Kiedy `enforce` — decyzja Konrada (decyzja 15), gdy:** (1) kopie bazy działają i test odtworzenia przeszedł z krokiem ponownego zastosowania rejestru usunięć ([`restore.md`](restore.md), [`rejestr-usuniec.md`](rejestr-usuniec.md)); (2) `worker` ma własny klucz rejestru (`PutObject`) w IaC; (3) w trybie `report` liczba kandydatów zgadza się z ręcznym przeglądem (widok „Wygasające wizje” i filtr „Tylko wizje”) przez co najmniej tydzień. Datę włączenia zapisz w karcie przeglądu i w RR-102 (model zagrożeń).

### Procedura ręczna do włączenia `enforce` (zobowiązanie Konrada)
Obowiązuje **od pierwszej realnej wizji** do dnia włączenia `enforce` (warunek przejścia z [instrukcji administratora](wizja-lokalna.md#2-lista-kontrolna-przed-pierwszą-realną-wizją-ac6)). Dla wizji testowych nie jest wymagana — można je zostawić do automatycznego usunięcia.

**Kiedy:** co tydzień (stały dzień) oraz po każdym e-mailu „Wizja lokalna ZL-… zostanie usunięta dnia …”.

**Kto spełnia warunek:** panel → lista zleceń → grupa filtrów „Wizje lokalne” → „Tylko wizje”, sortowanie „Termin wygaśnięcia”: wizje bez klienta z terminem **dziś lub wcześniej** oraz odrzucone (oznaczenie „Odrzucona”) z datą usunięcia dziś lub wcześniej. Wizje zbliżające się do terminu pokazuje widok „Wygasające wizje”.

**Operacje w panelu (Administrator, step-up):**
1. **Zdjęcia i filmy** wizji — trwałe usunięcie pliku (EVM-051).
2. **Wpisy dziennika** z treścią (np. notatki z oględzin) — redakcja (EVM-040).
3. **Tytuł i opis** zlecenia — edycja na neutralne („Wizja lokalna”, pusty opis).
4. **Telefon zamawiającego** — w panelu **nie ma funkcji wyczyszczenia ani edycji telefonu zamawiającego** (osobna historyjka w backlogu przez `/refine`, poza kolejką wizji). Telefon znika dziś wyłącznie przy przypisaniu klienta (EVM-136) i przy usunięciu wizji przez zadanie w trybie `enforce` (EVM-139). Dlatego **do wdrożenia tej funkcji albo do włączenia `enforce` realnych wizji nie przyjmujemy** (wizje testowe mają puste pole telefonu). Danych nie zmieniamy bezpośrednio w bazie.
5. **Lokalizacja** założona dla wizji i niewskazywana przez inne zlecenie ani dokument — edycja na wartości neutralne (ulica, numer, lokal, nr miejsca, notatki; miasto może zostać) jak w [`prawa-osob.md` → „Art. 17”](prawa-osob.md#art-17--usunięcie), krok 4.
6. **Zlecenie** — „Usuń zlecenie” (soft delete, EVM-060).

Po włączeniu `enforce` zadanie i tak wybierze te wizje (brak klienta, termin minął, nieoznaczone jako usunięte) i dokończy usunięcie (nagrobek, rejestr) — warunek dla przeglądu EVM-139: wizja usunięta wcześniej ręcznie (soft delete) jest przetwarzana poprawnie, bez błędu i bez duplikatu wpisu w rejestrze.

**Karta przeglądu wizji** (poza repozytorium, jak karta z sekcji 2): data · kto · liczba wizji usuniętych · **identyfikatory i numery zleceń** (bez adresów i telefonów) · wykonane operacje 1–6 · identyfikatory lokalizacji edytowanych ręcznie (do powtórzenia po odtworzeniu kopii — kroki 3–6 nie trafiają do rejestru usunięć) · wizje przedłużone w tym tygodniu (numer, kod powodu) · zaległości (powinno być 0).

**Wzór zobowiązania** (podpisuje Konrad przed pierwszą realną wizją, przechowywane poza repozytorium; dowód w liście kontrolnej):
> Do czasu włączenia automatycznego usuwania wizji lokalnych (tryb `enforce`) zobowiązuję się usuwać ręcznie każdą wizję lokalną bez przypisanego klienta najpóźniej w dniu jej terminu (90 dni od utworzenia, a po przedłużeniu — w nowym terminie, nie później niż 270 dni od utworzenia), a wizję odrzuconą — najpóźniej 14 dni od odrzucenia, według sekcji 5 runbooka retencji, oraz zapisywać kartę przeglądu po każdym przeglądzie. Data, podpis.
