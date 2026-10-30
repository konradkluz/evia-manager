---
id: EVM-097
title: "API: pobieranie pozostałych encji, wejście i wyjście z zakresu"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: in-review
priority: P1
path: pelna             # synchronizacja offline, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-090, EVM-096]
---

# EVM-097: API — pozostałe encje, wejście i wyjście z zakresu

## Cel
Jako **technik** chcę, aby **szczegóły zlecenia na telefonie były kompletne (etapy, strony, zakres, wpisy) i aby zlecenia wchodziły i wychodziły z telefonu zgodnie z zakresem**, aby **nie widzieć niepełnych zleceń ani nie nosić zbędnych danych**. Rozszerza EVM-096 (dziennik zmian, kursor, `GET /api/v1/sync/changes` dla `WorkOrder`, `Customer`, `Site`) o pozostałe typy z kontraktu EVM-090 i dodaje `GET /api/v1/sync/work-orders/{workOrderId}` (migawka zlecenia, ADR-0021 D3). Zakres synchronizacji: [`offline-sync.md`](../../architecture/offline-sync.md#zakres-synchronizacji-urządzenia).

## Kryteria akceptacji

**AC1 — Pozostałe typy w pobieraniu zmian**
- Zakładając zlecenie w zakresie urządzenia Edytora
- Gdy pobieram zmiany (pierwsze pobranie i kolejne strony) z EVM-096
- Wtedy dostaję także typy `party`, `scope_item`, `procedure_stage` (proces jest w nim zagregowany: `procedureId`, `procedureCode`, `procedureName`), `timeline_entry` i `user` (tylko `id`, `displayName`, `version`), każdy w projekcji z jawnej listy pól kontraktu (`SYNC_PROJECTIONS_STRICT`); dla każdej tabeli tych typów działa wyzwalacz `sync.record_change` i wpis w rejestrze `SYNCED_ENTITIES` (test kompletności z EVM-096 jest zielony); test negatywny waliduje KAŻDĄ stronę `assertSyncProjectionStrict` (nie przez `SyncChangesResponse`): e-mail, notatki i forma prawna kontrahenta (`Party`), e-mail, rola i czasy logowania użytkownika, płatności, audyt i PPE nie występują w żadnej stronie; liczba zapytań na stronę jest stała niezależnie od liczby encji (test); wpis usunięty przez soft delete daje `delete`, jego przywrócenie `upsert`.

**AC2 — Zakres encji bez kotwicy zlecenia (`Party`, `User`)**
- Zakładając kontrahenta i użytkownika, których wskazuje zlecenie w zakresie (`Site.managerPartyId`, `Site.distributionSystemOperatorPartyId`, `ProcedureStage.waitingOnPartyId`, koordynator, autor wpisu), oraz takich, których nie wskazuje żadne zlecenie w zakresie
- Gdy zmieniam je w biurze i pobieram zmiany
- Wtedy zmiana trafia do pobrania tylko dla wskazanych (zakres oceniany przy każdym odczycie, nie z zapamiętanej listy); niewskazani nie występują w żadnej odpowiedzi, a znacznik `delete` pojawia się tylko dla obiektu, który wcześniej był w zakresie urządzenia, i niesie wyłącznie `type`, `id`, `version`.

**AC3 — Migawka zlecenia `GET /api/v1/sync/work-orders/{workOrderId}`**
- Zakładając Edytora z zarejestrowanym urządzeniem (kanał `mobile`) i zlecenie w jego zakresie
- Gdy telefon nie zna zlecenia albo brakuje mu referencji i wywołuje operację `getSyncWorkOrder`
- Wtedy dostaje `200` z bieżącym agregatem (`serverTime` i `entities`: zlecenie, klient, lokalizacja, strony wskazane w lokalizacji i etapach, pozycje zakresu, etapy, wpisy, nazwy użytkowników; każdy obiekt z `version`) w tej samej projekcji i tym samym czytniku agregatu co pierwsze pobranie (EVM-096 AC2), z `Cache-Control: no-store`; test waliduje migawkę `assertSyncProjectionStrict`, a odpowiedź schematem `SyncWorkOrderSnapshot`; zlecenie nieistniejące, usunięte, poza zakresem (zamknięte ponad N dni) albo bez dostępu daje jednakowe `404 not_found` (identyczne ciało, bez ujawnienia istnienia); agregat > 1 MB zwiększa licznik `sync_snapshot_oversize_total` (pomiar i decyzja o stronicowaniu: EVM-107, bez zmiany odpowiedzi).

**AC4 — Wejście do zakresu (scenariusz 5)**
- Zakładając telefon, który ma kursor sprzed zdarzenia, i cztery zdarzenia w biurze: nowe zlecenie dla istniejącego klienta i lokalizacji spoza telefonu, przywrócenie zlecenia po soft delete (Administrator), ponowne otwarcie zlecenia zamkniętego ponad N dni temu (`settled → completed`, `cancelled → on_hold`), wskazanie nowej strony w etapie
- Gdy telefon pobiera zmiany, a potem migawkę zlecenia
- Wtedy strona zmian zawiera tylko obiekt zmieniony (np. `work_order`, bez klienta, który się nie zmienił), a migawka zwraca komplet obiektów potrzebnych do pokazania zlecenia (klient, lokalizacja, strona z etapu); test integracyjny na PostgreSQL w kontenerze pokrywa każde z czterech zdarzeń osobno i potwierdza, że po zastosowaniu migawki żadna referencja zlecenia nie jest nierozwiązana.

**AC5 — Wyjście z zakresu**
- Zakładając zlecenie zamknięte (`settled`/`cancelled`) z `closedAt` starszym niż N dni (N z konfiguracji serwera, domyślnie 30, ta sama wartość co `closedWorkOrdersInScopeDays` w `GET /api/v1/meta/client-config`), zlecenie usunięte (soft delete lub trwale) oraz zlecenie, do którego Edytor utracił dostęp
- Gdy pobieram zmiany lub migawkę
- Wtedy serwer nie wysyła obiektów spoza zakresu (zmiana wpisu w zleceniu zamkniętym > N dni temu nie trafia do odpowiedzi); usunięcie daje `delete` (`type` + `id` + `version`, bez danych osobowych; po trwałym usunięciu tylko `type` + `id`), wyjście czasowe obsługuje reguła klienta (`closedAt` + N wg `serverTime`; serwer nie emituje osobnego typu zdarzenia), a utrata dostępu idzie ścieżką `resync_required` z AC6.

**AC6 — `resync_required` przy zmianie dostępu lub reguły zakresu**
- Zakładając kursor wydany przed zmianą roli użytkownika albo przed zmianą reguły zakresu (zmiana N, dodanie typów projekcji z tej historyjki)
- Gdy telefon pobiera zmiany tym kursorem
- Wtedy dostaje `resync_required` z powodem `access_changed` (inna rola w kursorze) lub `scope_changed` (inna wersja reguły zakresu), bez danych; wartość `scopeRuleVersion` w `meta/client-config` i w kursorze jest większa niż przed tą historyjką (test porównuje z wartością bazową z EVM-096), zmiana N w konfiguracji serwera podbija ją automatycznie (test), a po resyncu odpowiedź nie zawiera obiektów bez dostępu.

**AC7 — Uprawnienia i limity**
- Zakładając role Administrator, Edytor, Tylko odczyt, niezalogowany, unieważnione urządzenie i urządzenie do wyczyszczenia
- Gdy wywołują pobieranie zmian z nowymi typami oraz migawkę zlecenia
- Wtedy wyniki są jak w EVM-096 AC5 (A i E `200`; Tylko odczyt `403 channel_not_allowed`; niezalogowany `401`; `401 session_revoked`; `401 device_wipe_required`; `Cache-Control: no-store`), macierz ról (test dla każdej nowej encji i dla migawki) obejmuje IDOR (cudzy lub nieistniejący `workOrderId` → `404`), a migawka ma limit 120 żądań na godzinę na urządzenie (`429` z `Retry-After`) i zapisuje w audycie tylko liczbę encji (bez danych), zasilając alerty masowego odczytu z EVM-096 AC8.

## Poza zakresem
- Metadane mediów i dokumentów (`media_asset` jest w kontrakcie, ale tabele powstają w E6: EVM-048), edycje (po MVP), rola Monter i przypisania `WorkOrderAssignment` (M4: w v1 każdy Edytor widzi wszystkie zlecenia).
- **Ładowarki (`Charger`) i globalna konfiguracja do szybkiego zlecenia** (katalog usług, szablony zleceń i procesów, rodzaje dokumentów): kontrakt EVM-090 nie ma dla nich projekcji, więc dodanie typów wymaga zmiany kontraktu (addytywnej, z podbiciem `scopeRuleVersion`) — przenosimy do EVM-099 (potrzebne dopiero przy szybkim zleceniu) albo osobnej historyjki; tabele katalogu zostają na liście `SYNC_EXCLUDED_TABLES` z uzasadnieniem „do EVM-099”.
- Zachowanie klienta (sprzątanie osieroconych, strażnik wersji, lista dociągnięć) — EVM-092; pomiar rozmiaru agregatu i wartości N — EVM-107/EVM-011.

## Decyzje i ograniczenia
- ADR-0021 jest **Zaakceptowana** (2026-10-27): wejście do zakresu jednym mechanizmem sterowanym klientem (migawka zlecenia), wyjście bez nowego typu zdarzenia, powody `resync_required`: `access_changed`, `scope_changed`.
- Migawka zwraca `404` także dla braku dostępu (nie `403`): istnienie jest informacją (kontrakt `getSyncWorkOrder`).
- Bezpieczeństwo i prywatność: projekcja przez jawną listę pól; znaczniki `delete` tylko dla obiektów wcześniej w zakresie urządzenia; ocena zakresu przy każdym odczycie.
- **Na tej nocy tor EVM-007/084/085 nie dodaje migracji** (jak w EVM-096) — migracje wyzwalaczy tej historyjki numerowane po ostatniej z EVM-096 w jednym torze.
- Wartości domyślne: N = 30 dni, limit migawek 120/h na urządzenie, agregat > 1 MB tylko metryka.
- Wymaga zaimplementowanej EVM-096 (dziennik, kursor, czytnik agregatu) — nie zaczynać przed jej scaleniem.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-29 — doprecyzowano do DoR: zgodność z kontraktem EVM-090 (typy projekcji, `404` w migawce, powody resyncu), rozgraniczenie z EVM-096/098/099, konkretne limity (product-owner)
- 2026-10-29 — zaakceptowano przez Konrada: AC1–7; ładowarki i konfiguracja globalna do EVM-099; limit migawek 120/h na urządzenie; sync nie zasila licznika EVM-039; status ready
- 2026-10-30 — plan gotowy (backend-developer)
- 2026-10-30 — zaimplementowano (backend-developer): migracja 0054 (numer po 0053 z EVM-096; EVM-068 w PR #117 też używa 0053 — kolizja do rozstrzygnięcia przy scalaniu), pozostałe typy w `GET /api/v1/sync/changes`, `getSyncWorkOrder` z limitem 120/h na urządzenie w PostgreSQL, `scopeRuleVersion` pochodna N; kod `forbidden` (nie `channel_not_allowed`) dla roli Tylko odczyt, jak w EVM-096; interpretacja zgodna z 096: `delete` ma `type` i `id` (kontrakt `SyncDelete`, bez `version`), a dla trwale usuniętego `Party`/`User` jest wysyłany zawsze (serwer nie zna listy obiektów z urządzenia; znacznik nie niesie danych osobowych); status in-review
- 2026-10-30 — poprawki po przeglądzie, runda 1 (backend-developer): naprawiono korekty wpisów (wyzwalacz w 0054), wznawianie grupy po kluczu, runbook `sync_snapshot_rate_exceeded`; **otwarte pytania do Konrada:** (1) `delete` bez `version` w kontrakcie vs AC2/AC5 i ADR-0021 (opcja A: opcjonalne `version` w `SyncDelete`; opcja B: zmiana AC); (2) usunięty użytkownik jako tombstone (zgodnie z AC2) czy `upsert` z nazwą jak w panelu - do czasu decyzji tombstone rozwiązuje referencję wg `offline-sync.md` pkt 12
- 2026-10-30 — poprawki po przeglądzie, runda 2 (backend-developer): wdrożono wariant zgodny z literą AC i rekomendacją architekta, **do potwierdzenia przez Konrada** - (1) opcja A: opcjonalne `version` w `SyncDelete` (addytywnie; soft delete niesie wersję, purge nie), (2) tombstone: faza migawki `GET /sync/changes` wysyła `delete` dla wskazanego, usuniętego klienta, lokalizacji, kontrahenta i użytkownika; `getSyncWorkOrder` bez zmian kontraktu + reguła klienta w `offline-sync.md` pkt 12; test domknięcia referencji w migawce; baseline kontraktu przesunięty (zmiana niełamiąca)
