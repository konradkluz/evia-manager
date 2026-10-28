# Runbook: rejestr usunięć poza bazą — format obiektu i ponowne stosowanie po odtworzeniu bazy

> Dokument żywy (EVM-040). Właściciel: `backend-developer`; przegląd: `security-engineer`. Wykonuje Konrad (osoba z dostępem do serwera). Wymagania: SR-PRIV-03, SR-PRIV-04, SR-DATA-08, SR-LOG-03; ADR-0003, ADR-0018; polityka P4 (rejestr przechowywany 40 dni). Odtwarzanie bazy z ponownym zastosowaniem rejestru — EVM-062 (to jest jego wejście). Bucket i klucz tylko do zapisu — EVM-084 (EVM-007, IaC).

Przed redakcją treści wpisu dziennika (EVM-040; później anonimizacja klienta — EVM-041) API zapisuje do osobnego bucketu **jeden nowy obiekt**. Po odtworzeniu bazy z kopii (PITR, zrzut) obiekty z okresu od momentu kopii wskazują, które operacje usunięcia trzeba **zastosować ponownie**, żeby usunięte dane osobowe nie wróciły razem z kopią (RODO art. 17).

## Obiekt rejestru
| Element | Wartość |
|---|---|
| Bucket | `evia-staging-deletion-register` (EVM-084; wersjonowanie bucketu chroni przed nadpisaniem; klucz aplikacji ma wyłącznie `PutObject`) |
| Klucz | `<rok>/<operationId>.json` — rok w UTC z zegara serwera; `operationId` to UUIDv7 nadawany przez serwer (porządek czasowy obiektów = porządek zapisu), nigdy z żądania ani z `Idempotency-Key` |
| `Content-Type` | `application/json`; bez metadanych `x-amz-meta-*` i bez ACL |

Treść (JSON; **tylko** te pola, bez treści wpisu, imion, nazw i adresów):

| Pole | Znaczenie |
|---|---|
| `schemaVersion` | `1` |
| `operationId` | UUIDv7 operacji (jak w kluczu) |
| `operationCode` | `timeline_entry_redacted` (redakcja treści wpisu dziennika); EVM-041 dołoży kod anonimizacji klienta |
| `subjectType` | `timeline_entry` |
| `subjectId` | identyfikator wpisu |
| `workOrderId` | identyfikator zlecenia wpisu (pole pomijane, gdy obiekt nie należy do zlecenia) |
| `actorUserId` | identyfikator Administratora (pseudonimowy) — minimalizacja z uzasadnieniem: powtórzenie redakcji ustawia `redacted_by` (CHECK `timeline_entries_redaction` wymaga autora, gdy jest `redacted_at`); nazwa i e-mail nie występują |
| `occurredAt` | chwila zapisu, UTC (ISO 8601) |

## Semantyka: dziennik zamiaru „co najmniej raz”
1. API sprawdza wszystko (zlecenie, wpis, wersję, zdarzenie, `already_redacted`), **potem** zapisuje obiekt, **potem** zmienia bazę (jedna transakcja; blokada `FOR NO KEY UPDATE` jednego wiersza przez ≤ 5 s). Żądanie zakończone `404`, `409` albo `412` nie zostawia obiektu. Zapis obiektu się nie udał → `503 deletion_register_unavailable`, treść i wersja bez zmian, w audycie `timeline_entry.redacted` z wynikiem `failed`.
2. Możliwy jest **obiekt osierocony**: obiekt zapisany, a `UPDATE` albo `COMMIT` w bazie nie doszedł do skutku (awaria procesu, porażka zapisu). Jest bezpieczny — kierunek zawsze ku prywatności: ponowne zastosowanie zredaguje wpis, który użytkownik chciał zredagować.
3. **Ponowne stosowanie musi być idempotentne** i odporne na brak celu: wpis, który jest już zredagowany (`redacted_at is not null`) — pomiń; wpis nieistniejący w odtworzonej bazie — pomiń; wpis typu zdarzenie (`kind = event`) — pomiń (zdarzeń nie redagujemy; trigger bazy też to odrzuci). Wpis zredagowany ustawia: treść = znacznik `Treść usunięta przez administratora DD.MM.RRRR.` (dzień wg `occurredAt` w Europe/Warsaw), `redacted_at = occurredAt`, `redacted_by = actorUserId`, `version + 1`. Redakcja wpisu usuniętego (soft delete) jest dozwolona.
4. **Walidacja przy odczycie (EVM-062):** obiektu rejestru nie traktujemy jako zaufanego wejścia — kto ma zapis do bucketu, mógłby podstawić obiekt, który „zredaguje” cudzy wpis. Odtwarzanie przyjmuje obiekt tylko, gdy: `schemaVersion` = `1`; klucz ma postać `<rok>/<operationId>.json` i jest zgodny z `operationId` w treści; `operationId`, `subjectId`, `workOrderId`, `actorUserId` są poprawnymi UUIDv7; `operationCode`, `subjectType` pochodzą z białych list (`timeline_entry_redacted`, `timeline_entry`); `occurredAt` to poprawna data UTC; nie ma **żadnych dodatkowych pól** (schemat ścisły); rozmiar jest mały (rzędu kilkuset bajtów). Obiekt niespełniający któregoś warunku jest pomijany i zgłaszany operatorowi — nie stosowany. Przy odczycie nie wolno wykonywać niczego, co zależy od treści obiektu poza wymienionymi polami.
5. Obiekty czytamy rolą administracyjną (nie kluczem aplikacji — ten nie ma odczytu ani listowania), w kolejności kluczy w obrębie roku.

## Brak konfiguracji (celowo: fail-closed)
Zmienne `S3_ENDPOINT`, `S3_REGION`, `DELETION_REGISTER_BUCKET`, `DELETION_REGISTER_S3_ACCESS_KEY_ID`, `DELETION_REGISTER_S3_SECRET_ACCESS_KEY` (lub `…_FILE`) działają **wszystkie albo żadna**. Brak wszystkich: ostrzeżenie w logu przy starcie; zestaw niepełny lub zły format: błąd w logu z **nazwami** zmiennych (nigdy wartości). W obu przypadkach usługa startuje i jest zdrowa (gotowość nie zależy od rejestru — brak bucketu nie blokuje wdrożenia stagingu), a redakcja odpowiada `503 deletion_register_unavailable`. Awarie zapisu zlicza metryka `deletion_register_failures_total{reason}` (`not_configured`, `write_failed`).

## Współbieżność i obciążenie (RR-NOC-T2-4)
Zapis do rejestru odbywa się w transakcji, która trzyma blokadę wiersza wpisu i połączenie z puli (do ok. 5 s, termin zapisu). Dlatego:
- Równoległe zapisy do rejestru są ograniczone do **3** naraz; kolejny czeka najwyżej 1,5 s na miejsce, potem dostaje `503 deletion_register_unavailable` (powód `busy` w metryce `deletion_register_failures_total`) i redakcja nie startuje.
- Inna operacja na **tym samym** wpisie (usunięcie, przywrócenie, druga redakcja) czeka na blokadę nie dłużej niż `statement_timeout` (2 s), po czym dostaje `503 service_unavailable` z `Retry-After: 2` (kody `57014` i `55P03` nigdy nie kończą się `500`). Nic nie zostało zmienione; bezpiecznie ponowić po odświeżeniu dziennika.
- Sesja bazy bezczynna w transakcji jest kończona po 10 s (`idle_in_transaction_session_timeout`), więc zawieszony proces nie trzyma blokady bez końca.

## Ryzyka rezydualne (do akceptacji Konrada)
- **RR-NOC-T2-1:** dopóki bucket z EVM-084 nie istnieje na stagingu, redakcja jest tam zablokowana (celowo, fail-closed).
- **RR-NOC-T2-2:** obiekty osierocone przy porażce zapisu w bazie po zapisie do rejestru (akceptowalne; kierunek prywatności, odtwarzanie idempotentne).
- **RR-NOC-T2-3:** wpisy zlecenia usuniętego (soft delete) są dla wszystkich ról pod `404`; aby zredagować treść takiego wpisu, Administrator przywraca zlecenie, redaguje wpis i usuwa zlecenie ponownie.
- **RR-NOC-T2-4:** koszt współbieżności zapisu do rejestru — wolne magazyn (do 5 s) wydłuża blokadę wiersza i zajmuje połączenie z puli; skutek jest ograniczony (3 zapisy naraz, oczekiwanie 1,5 s, `idle_in_transaction_session_timeout` 10 s), a nadmiar i kolizje na tym samym wpisie kończą się czytelnym `503` z możliwością ponowienia, nie `500`. Redakcja jest rzadką operacją Administratora, więc akceptujemy brak kolejki i ponowień po stronie serwera.
- Pozostałe: rekordy idempotencji zawierają skrót żądania i wygasają (purger); martwe wersje wiersza (MVCC) do czasu VACUUM; po wdrożeniu synchronizacji mobilnej redakcja musi się propagować na urządzenia (kanał `upsert`, usunięcie — `delete`).
