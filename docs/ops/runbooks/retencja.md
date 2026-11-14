# Runbook: retencja danych — gdzie są okresy i co robimy ręcznie do M4

> Dokument żywy (EVM-064 AC6). Właściciel: `security-engineer`; konfiguracja: `devops-engineer`; procedurę ręczną wykonuje Administrator (Konrad). Wymagania: SR-PRIV-01, SR-DATA-07; okresy: [`policies.md` → P4](../../security/policies.md#p4--retencja-mediów-dokumentów-dzienników-audytu-logów-i-kopii) i [`rodo.md` → „Retencja”](../../security/rodo.md#retencja) (źródło prawdy — zmiana okresu = zmiana `rodo.md` zaakceptowana przez Konrada i zmiana w miejscu z kolumny „Gdzie”). Stan sprawdzony w kodzie i IaC gałęzi 2026-11-14.

## 1. Dane techniczne — usuwane automatycznie
Okresy są **nazwanymi stałymi w kodzie** albo regułami IaC / ustawieniami u dostawcy — każdy okres w jednym miejscu, zmiana przez PR (pytanie do Konrada o brzmienie SR-PRIV-01 — sekcja 4).

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
| Logi e-mail (Scaleway TEM) | dopóki domena TEM jest aktywna | ustawienie dostawcy | konto Scaleway | decyzja EVM-089 (bez skracania; usunięcie adresu na zgłoszenie) |

**Luki (do decyzji Konrada — sekcja 4):**
- `sync.change_log` (P4: 90 dni) — **nie ma zadania usuwania**, a rola aplikacji ma na tabeli tylko `SELECT` (ADR-0021). Wiersze to identyfikatory i kody, bez danych osobowych.
- `media.media_exports` — wiersze (zlecający, zlecenie, stan, rozmiar; bez danych klienta) bez terminu (opisane w `rodo.md`).
- Poza P4, tylko identyfikatory i skróty: wiersze linków jednorazowych (aktywacja, reset hasła) i `platform.security_alert_outbox` — bez zadania usuwania; do ujęcia w zadaniu retencji M4 (Low).

## 2. Dane biznesowe — procedura ręczna do M4
Zadanie retencji danych biznesowych powstaje w M4 (SR-DATA-07, „polityki retencji” w roadmapie). Do tego czasu Administrator wykonuje przegląd ręczny. **Pierwsze terminy** (licząc od pierwszych realnych danych w listopadzie 2026): zlecenia anulowane przed akceptacją i klienci bez zleceń — najwcześniej listopad 2027; strony (osoby fizyczne), konta pracowników i dziennik audytu — listopad 2028; zlecenia zamknięte — 2033.

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
1. **SR-PRIV-01 („konfiguracja, nie stałe w kodzie”).** Okresy są nazwanymi stałymi w kodzie i regułami IaC, nie zmiennymi środowiska. Rekomendacja: uznać to za „konfigurację jako kod” (jedno miejsce na okres, zmiana przez PR i `rodo.md`) i doprecyzować brzmienie SR-PRIV-01 — bez zmian kodu.
2. **Luki `sync.change_log` i `media.media_exports`.** Rekomendacja: zaakceptować jako dług techniczny (wiersze bez danych osobowych) z historyjką w backlogu (`/refine`; razem z zadaniem retencji M4), nie warunek startu.
