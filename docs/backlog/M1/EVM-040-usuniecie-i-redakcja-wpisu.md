---
id: EVM-040
title: Usunięcie i redakcja wpisu w dzienniku (Administrator)
type: story
milestone: M1
epic: E5 Dziennik i komentarze
status: in-progress
priority: P1
path: pelna
model: sonnet
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-084, EVM-029, EVM-037]
---

# EVM-040: Usunięcie i redakcja wpisu w dzienniku (Administrator)

## Historyjka
Jako **Administrator** chcę **ukryć wpis dodany przez pomyłkę albo trwale usunąć z niego treść z danymi osobowymi**, aby **realizować prawo do usunięcia danych (RODO art. 17) bez niszczenia historii zlecenia**.

## Kontekst
- Model: „Usuwanie danych” — soft delete (A), redakcja treści (A ze step-upem, wyjątek od append-only); SR-PRIV-03, SR-PRIV-04, SR-DATA-08.
- **Wprowadza rejestr usunięć poza bazą** (konsultacja `solution-architect`, W4): port zapisu w `platform` do bucketu rejestru z EVM-084 (klucz aplikacji tylko `PutObject`), wpis przed operacją. Zależą od niego EVM-041, EVM-051 i EVM-062.
- Makieta: [W-08](../../ux/flows/05-wpis-i-komentarz.md#w-08-dziennik) (menu `⋮`: „Usuń wpis”, „Zredaguj treść…”), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Usunięcie wpisu**
- Zakładając wpis „Ustalenie” w zleceniu
- Gdy Administrator wybiera „Usuń wpis”
- Wtedy wpis znika z dziennika Edytora i Tylko odczyt (pobranie po `id` — `404`), Administrator widzi go z oznaczeniem „Usunięty”, toast „Usunięto wpis. [Cofnij]” przywraca wpis, a obie operacje są audytowane.

**AC2 — Redakcja treści (SR-PRIV-03, SR-SESS-08)**
- Zakładając wpis z omyłkowo wpisanym numerem dowodu osobistego
- Gdy Administrator wybiera „Zredaguj treść…”, potwierdza dialog „Zredagować treść wpisu? Treść zostanie zastąpiona znacznikiem — tej operacji nie można cofnąć.” i tożsamość w W-04
- Wtedy treść jest zastąpiona znacznikiem „Treść usunięta przez administratora 03.10.2026.”, zapisany jest czas i autor redakcji, a metadane i miejsce wpisu na osi czasu zostają.

**AC3 — Rejestr usunięć przed operacją (SR-PRIV-04)**
- Gdy Administrator redaguje wpis
- Wtedy przed zmianą w bazie do rejestru usunięć trafia nowy obiekt z identyfikatorem wpisu, kodem operacji i czasem (bez treści)
- Oraz gdy zapis do rejestru się nie udaje (atrapa w teście), wtedy redakcja nie startuje, treść jest nienaruszona, a panel pokazuje „Nie udało się zredagować treści. Spróbuj ponownie później.”

**AC4 — Audyt bez treści (SR-LOG-03, SR-DATA-08)**
- Gdy wykonuje się usunięcie, przywrócenie albo redakcja
- Wtedy zdarzenie audytu zawiera identyfikator wpisu, kod akcji i wynik — bez treści wpisu.

**AC5 — Zdarzenia automatyczne**
- Zakładając zdarzenie automatyczne (zmiana statusu)
- Gdy Administrator otwiera menu wpisu
- Wtedy usunięcie i redakcja są niedostępne (zdarzenia nie zawierają danych osobowych), a API odrzuca takie operacje.

**AC6 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda usuwa i redaguje wpis
- Wtedy tylko Administrator (redakcja — ze step-upem) wykonuje operacje; Edytor ma pozycje wyłączone z podpowiedzią „Usunąć wpis może tylko administrator.” i dostaje `403 forbidden`; R nie widzi menu (`403`); niezalogowany — `401`; wpis zlecenia B ścieżką zlecenia A — `404`.

**AC7 — Stany**
- Wtedy offline — akcje wyłączone; anulowanie W-04 — „Nie wykonano operacji.”, brak zmian; `412` — komunikat z odświeżeniem.

## Poza zakresem
- Trwałe usunięcie (purge) całego zlecenia i retencja danych biznesowych — M4 (P4; do tego czasu procedura ręczna z runbooka EVM-064).
- Odtworzenie bazy z ponownym zastosowaniem rejestru — EVM-062.

## UX / UI
- W-08: menu `⋮` [P-1], AlertDialog (danger) dla redakcji, W-04, typ wpisu „Zredagowany” (`eye-off`). Stany: AC7; brak uprawnień — AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie, przywrócenie; redakcja ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: treść wpisów (dane osobowe), rejestr usunięć (tylko identyfikatory).
- W AC: SR-PRIV-03, SR-SESS-08, SR-PRIV-04, SR-LOG-03, SR-DATA-08, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-ERR-01 (nieudany zapis rejestru = odmowa). Polityka P4 (rejestr 40 dni).

## Notatki techniczne
- Moduły: `timeline`, `platform` (port rejestru usunięć), `audit` + panel.
- `devops-engineer`: klucz aplikacji z wyłącznie `PutObject` do bucketu rejestru (EVM-007), konfiguracja na staging; atrapa portu w testach.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- **Kontrakt zgodny z `api-guidelines.md`** (konsultacja `solution-architect`): `DELETE …/timeline/{entryId}` (`deleteTimelineEntry`, `204`), `POST …/restore` (`restoreTimelineEntry`), `POST …/redact` (`redactTimelineEntry`, `200` z `ETag`); wszystkie `roles [administrator]`, kanał `web`, CSRF; tylko redakcja ma `stepUp: true`. `If-Match` wymagany (brak — `428 precondition_required`, zła wersja — `412 version_conflict`); usunięcie i przywrócenie mają opcjonalny `Idempotency-Key` (jak `deleteWorkOrderProcedure` / `restoreWorkOrderProcedure`). Wersja wpisu (`version`) rośnie przy każdej z trzech operacji (wymóg przyszłej synchronizacji: usunięcie → `delete`, redakcja → `upsert`); `getTimelineEntry` zwraca `ETag` (panel pobiera wersję przed operacją — `TimelineEntry` nie ma pola `version`).
- **Nowe kody problemów** (tabela w `api-guidelines.md`): `409 entry_is_event` (wspólny dla usunięcia i redakcji zdarzenia — AC5), `409 already_redacted`, `503 deletion_register_unavailable`.
- **Reprezentacja:** jedno nowe pole `TimelineEntry.deletedAt` (date-time albo `null`; dla zdarzeń zawsze `null`) — bez flagi `deleted` i bez `redactedBy` w odpowiedzi (`redacted_by` zostaje w bazie i w rejestrze). Zmiana addytywna.
- **`includeDeleted`:** tylko Administrator; Edytor i Tylko odczyt z `includeDeleted=true` dostają `403 forbidden` (parametr nie jest po cichu ignorowany); kursor wiąże ten filtr (kursor z innym filtrem — `400 invalid_cursor`). `GET` po `id` usuniętego wpisu: Administrator `200` z `deletedAt`, pozostali `404`. Nowego indeksu nie dodano (indeksy częściowe `where deleted_at is null` nie obsługują listy z usuniętymi — akceptowalne przy wolumenie jednego zlecenia).
- **Migracja `0042_timeline_redaction` (expand):** wyzwalacz `reject_entry_change()` dopuszcza (a) soft delete i `version` jak dotąd oraz (b) redakcję — tylko gdy jednocześnie: wpis nie był zredagowany, `redacted_at` i `redacted_by` ustawione, `kind <> 'event'`, nowa treść pasuje do zakotwiczonego wzorca „Treść usunięta przez administratora DD.MM.RRRR.” (regex `^…[0-9]{2}\.[0-9]{2}\.[0-9]{4}\.$`), a pozostałe kolumny bez zmian. Wzorzec ma jedno źródło w kodzie (`redaction-marker.ts`), test migracji sprawdza jego zgodność z wyzwalaczem; jest celowo obroną w głębi (bez niego redakcja byłaby kanałem dowolnej edycji treści). CHECK `timeline_entries_event_untouchable` (`kind <> 'event' or (deleted_at is null and redacted_at is null)`) jest bezpieczny dla N−1 (dziennik nie uczestniczy w usuwaniu zlecenia, więc zdarzenia nie dostają `deleted_at`).
- **Kolejność redakcji (AC3):** jedna transakcja: zlecenie (`404`) → blokada wpisu `FOR NO KEY UPDATE` z kluczem `(entryId, workOrderId)` → zdarzenie (`409`) → `If-Match` (`428`/`400`) → wersja (`412`) → `already_redacted` (`409`) → `DeletionRegister.record(...)` (termin ≈ 5 s) → `UPDATE` (+ `version + 1`) i zdarzenie audytu → `COMMIT`. Rejestr nie dostaje wpisu dla żądań kończących się `404`/`409`/`412`; zmiana w bazie następuje po zapisie do rejestru. Redakcja działa także dla wpisu usuniętego (dane osobowe usuniętego wpisu nadal są w bazie); wpis zredagowany można usunąć i przywrócić, znacznik zostaje. **Świadome odstępstwo od rady `security-engineer`:** zapis do rejestru odbywa się przy otwartej blokadzie jednego wiersza (≤ 5 s, `NO KEY UPDATE` nie blokuje kluczy obcych poprawek), a nie przed blokadą z ponownym sprawdzeniem — obowiązująca jest rada architekta (prostszy, atomowy przebieg, mniej wpisów osieroconych); koszt: jedno połączenie z puli przez ≤ 5 s, osiągalne tylko dla Administratora po step-upie.
- **Rejestr = dziennik zamiaru „co najmniej raz”** (RR-NOC-T2-2): wpis osierocony (porażka `UPDATE`/`COMMIT` po zapisie do rejestru) jest dopuszczalny — odtwarzanie (EVM-062) ma być idempotentne, pomijać zdarzenia i wpisy już zredagowane lub nieistniejące; opis dla runbooka: `docs/ops/runbooks/rejestr-usuniec.md`. Obiekt: klucz `<rok UTC>/<operationId>.json` (`operationId` — UUIDv7 serwera), treść `schemaVersion: 1`, `operationId`, `operationCode: 'timeline_entry_redacted'`, `subjectType: 'timeline_entry'`, `subjectId`, `workOrderId`, `actorUserId`, `occurredAt` (UTC), nic więcej. **`actorUserId` w obiekcie** (identyfikator pseudonimowy) — minimalizacja z uzasadnieniem: CHECK `timeline_entries_redaction` wymaga `redacted_by` przy odtworzeniu redakcji. Bez `IfNoneMatch` (klucz unikalny, wsparcie zapisu warunkowego u Scaleway niepewne); ochrona przed nadpisaniem = wersjonowanie bucketu (T3, EVM-084).
- **Adapter S3 (`platform/deletion-register`):** osobny klient z jawnymi poświadczeniami (domyślny łańcuch dostawców SDK — `AWS_*`, `~/.aws`, IMDS — nie jest używany; test: `AWS_ACCESS_KEY_ID` ze środowiska jest ignorowane), `forcePathStyle`, `requestChecksumCalculation: 'WHEN_REQUIRED'`, `maxAttempts: 2`, limity połączenia/żądania i łączny termin 5 s (`AbortSignal`), logger SDK wyłączony; wyłącznie `PutObjectCommand` (statyczny test: brak Get/List/Delete/Head); każdy błąd → `DeletionRegisterUnavailable` bez treści odpowiedzi magazynu w logu (tylko nazwa klasy błędu) i licznik `deletion_register_failures_total{reason}`. Reguła `.dependency-cruiser.cjs` o tekście identycznym z torem T1: `@aws-sdk/*` tylko z `apps/api/src/platform/(object-storage|deletion-register)/`. Zależność `@aws-sdk/client-s3` **3.1157.0** (najnowsza stabilna opublikowana ≥ 24 h na 2026-10-27; Apache-2.0).
- **Konfiguracja — wszystko albo nic, bez fail-fast** (decyzja domyślna do czasu odpowiedzi Konrada): pięć zmiennych (`S3_ENDPOINT`, `S3_REGION`, `DELETION_REGISTER_BUCKET`, `DELETION_REGISTER_S3_ACCESS_KEY_ID`, `DELETION_REGISTER_S3_SECRET_ACCESS_KEY` + `_FILE`); brak wszystkich → adapter „unavailable” i jedno ostrzeżenie przy starcie; zestaw niepełny lub zły format → ten sam adapter i błąd w logu z **nazwami** zmiennych. Usługa jest zdrowa, **gotowość nie zależy od rejestru** (scalenie nie może zablokować wdrożeń stagingu); operacja redakcji (**fail-closed**) odpowiada `503 deletion_register_unavailable` — i tylko Administrator po step-upie może to zobaczyć. `S3_ENDPOINT`: https; http wyłącznie dla loopback poza produkcją (testy). `S3_ENDPOINT` i `S3_REGION` deklaruje też tor T1 — przy rebase drugi scalany tor deduplikuje (semantyka musi być identyczna: opcjonalne napisy, walidowane przez `resolveDeletionRegisterSettings`).
- **Audyt:** zdarzenia domenowe `timeline_entry.deleted|restored|redacted` przez `platform/events` w transakcji zmiany (`timeline` nie importuje `audit`); porażka rejestru → osobna, krótka transakcja po wycofaniu z wynikiem `failed` (katalog wyników audytu miał już `failed`). Treść wpisu nie trafia do audytu, logów, obiektu rejestru ani problemów (test kanarkowy).
- **Łańcuch poprawek:** usunięcie wpisu z poprawką nie zmienia poprawki (dla E/R `supersedesEntryId` wskazuje wpis niewidoczny — panel musi to obsłużyć); usunięta poprawka nie liczy się do `supersededByEntryId`, a ponowna poprawka oryginału kończy się zmapowanym `409 entry_superseded` (UNIQUE `supersedes_entry_id`) — wyjściem jest przywrócenie poprawki; redakcja poprawki i oryginału to dwie osobne operacje.
- **Granice modułów:** port i token w `platform/deletion-register`; `timeline` zależy wyłącznie od portu; work-orders i customers bez zmian w EVM-040. Zlecenie usunięte → wpisy pod `404` dla wszystkich ról (obejście: Administrator przywraca zlecenie, redaguje i usuwa je ponownie).
- **Ryzyka rezydualne do akceptacji Konrada (bez numerów RR):** RR-NOC-T2-1 — bez bucketu z EVM-084 redakcja na stagingu jest zablokowana (fail-closed, celowo); RR-NOC-T2-2 — osierocone obiekty rejestru; RR-NOC-T2-3 — wpisy zlecenia usuniętego (obejście powyżej).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-040 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane (opis rejestru usunięć dla runbooka odtworzenia)
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-13 — podział EVM-007 wg ADR-0018: bucket rejestru usunięć powstaje w EVM-084 (007b, zależy od 007a); `depends_on`: EVM-007 → EVM-084 (product-owner)
- 2026-10-27 — nocna kolejka (tor T2): path pelna, model sonnet dopisane przez Tech Leada; wyjątek od DoR (zależność od EVM-084 to bucket przy wdrożeniu, nie kod; demo po sesji IaC) — warunkowo, do potwierdzenia przez Konrada
- 2026-10-27 — start realizacji (nocna kolejka, tor T2), gałąź feature/EVM-040-041-usuniecie-rejestr-usuniec
- 2026-10-27 — plan gotowy (backend-developer)
- 2026-10-27 — implementacja API (backend-developer, tor T2): migracja 0042, rejestr usunięć (`@aws-sdk/client-s3` 3.1157.0), usunięcie / przywrócenie / redakcja wpisu, kontrakt i testy; panel (menu W-08, dialog, W-04) — web-developer
- 2026-10-28 — panel (web-developer, tor T2): menu wpisu W-08 (Usuń wpis z toastem „Cofnij”, Przywróć wpis, Zredaguj treść… z AlertDialog i W-04), oznaczenie „Usunięty” i `includeDeleted` dla Administratora, Edytor z pozycjami wyłączonymi, wpis zdarzenia bez menu; testy komponentów, E2E (Chromium, Edge, Firefox), axe i zrzuty w `docs/ux/reviews/EVM-040/`
- 2026-10-28 — bramka lokalna (devops-engineer): format, lint, typy, testy z progami, deps:check, kontener Linux, integracja API, gate:deploy, coverage:diff (linie 99,4%, gałęzie 91,8%; dodano test logiki błędów panelu) zielone; czerwony tylko `@evia/repo-policy` przez niepoprawny YAML w `EVM-119` (z `main`)
