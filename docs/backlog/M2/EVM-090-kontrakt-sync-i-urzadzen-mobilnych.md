---
id: EVM-090
title: "Kontrakt OpenAPI: logowanie mobilne, urządzenia i synchronizacja"
type: enabler
milestone: M2
epic: E9 Dostęp mobilny
status: done
priority: P0
path: pelna             # kontrakt uwierzytelniania i synchronizacji offline
owner: backend-developer
contributors: []
reviewers: [solution-architect, security-engineer]
model: sonnet
depends_on: []
---

# EVM-090: Kontrakt OpenAPI — logowanie mobilne, urządzenia i synchronizacja

## Cel
Jako **zespół** chcemy **opisać w kontrakcie OpenAPI (contract-first, ADR-0004) wszystkie operacje, których potrzebuje aplikacja mobilna do logowania i synchronizacji**, aby **tory API i aplikacji mogły powstawać równolegle, a rozjazd wychodził w testach kontraktowych, nie w terenie**. Źródło wymagań: [`offline-sync.md`](../../architecture/offline-sync.md), ADR-0005 (access token 15 min, refresh rotowany) i ADR-0021 (zakres, wejście/wyjście z zakresu, resync).

## Kryteria akceptacji

**AC1 — Logowanie mobilne w kontrakcie**
- Zakładając kontrakt z operacjami web (cookie), w którym `channels` jest dziś wymagane tylko dla operacji niepublicznych
- Gdy dodajemy rodzinę operacji: `mobileLogin` (`POST /api/v1/auth/mobile/login`), `mobileLoginTotp` (`…/login/totp`), `refreshMobileSession` (`…/token`) — publiczne z `channels: [mobile]` — oraz `mobileLogout` (`…/logout`, Administrator i Edytor, kanał `mobile`)
- Wtedy manifest dopuszcza `channels` także przy `public: true` (domyślnie `[web]`), linter wymaga, by operacja publiczna z `mobile` była na liście publicznych i mobilnych, istnieją `securitySchemes` (`mobileBearer`, `webSession`) użyte tylko na nowych operacjach mobilnych (istniejące operacje web bez zmian), a żadna operacja web nie przyjmuje tokenów mobilnych i odwrotnie; tokeny występują wyłącznie w treści lub w `Authorization`, nigdy w URL.

**AC2 — Rejestracja urządzenia i potwierdzenie czyszczenia**
- Zakładając pierwsze logowanie telefonu
- Gdy opisujemy żądania i odpowiedzi logowania
- Wtedy `deviceId` nadaje serwer (klient przy ponownym logowaniu podaje parę `deviceId` + sekret instalacji), żądanie niesie `device: {model, osVersion, securityPatch}` i opcjonalnie `devicePublicKey` (rezerwa pod powiązanie tokenu z urządzeniem), kroku pośredniego dotyczy jednorazowy token wyzwania (TTL ≤ 5 min), odpowiedź zawiera `serverTime` i terminy wygaśnięcia tokenów, a osobna operacja pozwala telefonowi **potwierdzić wyczyszczenie** (stan „Wyczyszczone” w W-17); żądania synchronizacji mogą nieść `pendingItems` (liczba niewysłanych elementów).

**AC3 — Pobieranie zmian i migawka zlecenia**
- Zakładając zakres urządzenia z `offline-sync.md`
- Gdy opisujemy `GET /api/v1/sync/changes` (kursor nieprzezroczysty, `limit` domyślnie 200, maks. 500) i `GET /api/v1/sync/work-orders/{id}` (migawka agregatu, kanał `mobile`)
- Wtedy odpowiedź ma warianty: strona zmian (`upsert` z `version`, `delete` jako znacznik `type` + `id` bez danych osobowych, nowy kursor) oraz `resync_required` z powodem (m.in. `periodic`); projekcje zawierają wyłącznie pola z tabeli „Projekcja pól na telefonie”, a kursor niedekodowalny daje `resync_required`, nie błąd klienta.

**AC4 — Wysyłanie mutacji**
- Zakładając komendy `CreateNote`, `CreateComment`, `CreateQuickWorkOrder`
- Gdy opisujemy `POST /api/v1/sync/mutations` (partia ≤ 50, mutacja ≤ 64 KB, `type` + `commandVersion`)
- Wtedy odpowiedź zwraca wynik per mutacja (`applied` / `duplicate` / `conflict` / `rejected` z kodem z katalogu: `id_conflict`, `forbidden`, `target_unavailable`, `validation_failed`, `idempotency_mismatch`, `idempotency_in_progress`, `template_unavailable`) oraz ostrzeżenia (`captured_at_out_of_range`, `idempotency_expired`); schematy mają `additionalProperties: false` i limity długości; `newCustomer` niesie tylko rodzaj, nazwę i telefon.

**AC5 — Katalog błędów urządzenia i nagłówki**
- Zakładając katalog błędów API
- Gdy opisujemy odpowiedzi logowania i synchronizacji
- Wtedy są w nim: `401 invalid_credentials`, `401 session_revoked`, `401 device_wipe_required` (także dla pobierania, wysyłania i logowania z sekretem takiego urządzenia), `426 client_version_unsupported`, `403 channel_not_allowed`, `403 mfa_enrollment_required`, `403 totp_not_configured`, `403 device_limit_reached`, `400 invalid_cursor`, `409 completed_object_mismatch` (EVM-011), `429` z `Retry-After`; odpowiedzi auth i sync mają `Cache-Control: no-store`.

**AC6 — Konfiguracja klienta**
- Zakładając parametry zależne od serwera
- Gdy opisujemy odpowiedź konfiguracyjną dla aplikacji mobilnej
- Wtedy zawiera: okno braku kontaktu (domyślnie 7 dni), N dni zamkniętych zleceń w zakresie (domyślnie 30), minimalną wersję aplikacji i wersję reguły zakresu (rozszerzenie istniejącej konfiguracji albo nowa operacja — decyzja architekta).

**AC7 — Atrapa i typy**
- Zakładając wygenerowany pakiet kontraktu
- Gdy uruchamiam testy kontraktowe
- Wtedy każda nowa operacja ma przykłady odpowiedzi (także błędów z AC5), istnieją wygenerowane typy dla klienta mobilnego, serwer-atrapa zwraca te przykłady, a zmiana łamiąca poprzedni kontrakt jest wykrywana.

## Poza zakresem
Implementacja serwera (EVM-094, 096, 098, 099); operacje uploadu plików (`upload-sessions` — EVM-044); powiadomienia push; wymaganie podpisu urządzenia przy odświeżaniu (tylko pole opcjonalne).

## Decyzje i ograniczenia
- Ścieżki i kody są zgodne z konsultacją architekta (2026-10-27); dwie rzeczy zostają do potwierdzenia: ścieżka operacji potwierdzenia wyczyszczenia i miejsce konfiguracji klienta.
- Zakres, wejście i wyjście z zakresu (AC3) zależą od ADR-0021 (Proponowana → Zaakceptowana przed `ready`).
- **Kolejność:** EVM-090 scalić **przed startem torów B i C** (typy i przykłady są źródłem fixture'ów i atrapy `AuthClient`); tor A zaczyna od niej samodzielnie. Tor A jako jedyny zmienia kontrakt; kolejne historyjki dopisują tylko swoje pliki `paths/*.yaml`.
- Bezpieczeństwo i prywatność: kontrakt nie ujawnia, czy konto istnieje (jeden komunikat dla złych danych); `devicePublicKey` nie jest wymagany w M2 (patrz README planu, decyzja 8).

- **Rozstrzygnięte w realizacji (2026-10-27; konsultacje architekta i security):**
  - Potwierdzenie wyczyszczenia: `POST /api/v1/devices/current/wipe-confirmation` (`confirmDeviceWipe`), operacja publiczna kanału `mobile`; para `deviceId` + sekret instalacji **w treści** (nigdy w adresie ani nagłówku), bez trzeciego schematu uwierzytelnienia — AC1 (dokładnie dwa schematy) zostaje spełnione dosłownie. `204` idempotentnie dla poprawnej pary, `401 invalid_credentials` jednym komunikatem dla nieznanego urządzenia i złego sekretu, `429` z `Retry-After`. Brak `426` (potwierdzenie musi zawsze działać).
  - Konfiguracja klienta: **nowa** operacja `getClientConfig`, `GET /api/v1/meta/client-config` (ścieżka z ADR-0021 D7 i `api-guidelines.md`), **uwierzytelniona** (kanał `mobile`, Administrator i Edytor, `mobileBearer`), bez `426`. Pola: `offlineContactWindowDays` (7), `closedWorkOrdersInScopeDays` (30), `periodicResyncDays` (7), `scopeRuleVersion`, `minSupportedVersion` i `recommendedVersion` (`{android, ios}`). Przed zalogowaniem minimalną wersję podaje publiczne `GET /api/health`; `api-guidelines.md` i ADR-0021 D7 poprawione.
  - `x-evia-planned: true` — operacje w kontrakcie bez trasy (bez zaślepek `501`) do czasu EVM-094/096/098/099; znacznik jest jedynym źródłem prawdy (test tras: planned ⇒ brak trasy, nie-planned ⇒ trasa), testy iterujące po manifeście pomijają takie operacje wspólnym helperem `implementedManifest()`. Każda z tych historyjek usuwa znacznik razem z implementacją.
  - AC1 doprecyzowane: `webSession` jest zdefiniowany, ale nieużywany przez żadną operację (istniejące operacje panelu bez `security`, mobilne go nie przyjmują; wyjątek w `.redocly.lint-ignore.yaml`); operacja publiczna ma **dokładnie jeden** kanał (`[web, mobile]` zabrania lint).
  - AC4/AC5 doprecyzowane: zły ładunek albo nieznany `type` mutacji to wynik tej jednej mutacji (`rejected` `validation_failed`), `400` tylko dla złej koperty lub partii; `409 completed_object_mismatch` jest w katalogu i w komponencie odpowiedzi (zwraca go `complete` sesji uploadu, EVM-044 — w EVM-090 żadna operacja go nie zwraca); w EVM-090 kontrakt synchronizacji ma 9 typów projekcji (zlecenie, klient, lokalizacja, strona, pozycja zakresu, etap, wpis dziennika, materiał, użytkownik) — pozostałe encje dodaje EVM-097 (patrz „Poprawki rundy 1”: koperta otwarta, bez `--allow-breaking`).
  - **Poprawki rundy 1 (2026-10-27; przegląd architekta i security):**
    - Baseline = kontrakt ostatniego wydania, nie HEAD: `check` i test sprawdzają tylko brak zmian łamiących (zmiany addytywne go nie unieważniają); `baseline:update` ręcznie przy wydaniu albo zaakceptowanej zmianie łamiącej. Operacje `x-evia-planned: true` w baseline są pomijane w porównaniu. Do dopisania w runbooku wydania i `/milestone close` (krok: `baseline:update`).
    - Zgodność w przód typów encji: `SyncEntity` to otwarta koperta `{type, id, version}` (typy projekcji opisują schematy `SyncWorkOrder` itd.); klient pomija zmianę z nieznanym `type`, a dodanie typu podbija `scopeRuleVersion` (`resync_required` `scope_changed`). Dodanie typu nie jest zmianą łamiącą.
    - Kolejność logowania mobilnego: `426` → limit prób → para `deviceId` + sekret zgodna z urządzeniem w stanie `wipe_required` daje `401 device_wipe_required` PRZED hasłem → hasło (`401 invalid_credentials`, `403 mfa_enrollment_required`/`totp_not_configured`) → TOTP → `403 channel_not_allowed`, `403 device_limit_reached`. Niezgodna para jest ignorowana (telefon liczy się jak nowy, limit urządzeń, wpis audytu). **Zmiana wobec AC3 EVM-094** (rola × kanał po haśle, przed `totp_not_configured`): w kontrakcie `channel_not_allowed` pozostaje po poprawnym TOTP (samo hasło nie ujawnia roli) — AC3 EVM-094 wymaga korekty przez Konrada; AC7 EVM-094 jest zgodne z kontraktem.
    - ~~Rotacja sekretu instalacji: każde udane `mobileLoginTotp` zwraca NOWY `installationSecret` i atomowo unieważnia poprzedni~~ (zastąpione rundą 2: rotacja dwufazowa; treść pierwotna dalej): (pole pozostaje opcjonalne; odświeżanie go nie zwraca). Rekomendacja security; do potwierdzenia przez Konrada razem z EVM-094 AC2.
    - Pierwszeństwo wyczyszczenia: token urządzenia w stanie `wipe_required` (także unieważniony, zużyty lub wygasły z istniejącym rekordem) zawsze daje `401 device_wipe_required`, przed `session_revoked` i `unauthenticated`; token nieznany — tylko `session_revoked`.
  - **Poprawki rundy 2 (2026-10-28):**
    - Odczyt zmian: `parseSyncChange` i mapa `SYNC_PROJECTIONS` w `@evia/contracts/sync` (jedno źródło prawdy; lustro `x-evia-sync-projections` w `SyncEntity`, test pilnuje równości z `SyncEntityType`). Znany `type` ściśle według projekcji (dodatkowe pole, np. e-mail klienta, odrzuca zmianę), nieznany jest pomijany; nie czytać encji przez `zSyncChangesResponse`.
    - Narzędzie zmian łamiących porównuje projekcje przez mapę (kontekst `getSyncChanges`/`getSyncWorkOrder`), pomija je, gdy wszystkie te operacje w baseline są `planned`; usunięcie typu jest łamiące (`sync-projection-removed`), dodanie nie.
    - Rotacja sekretu instalacji jest dwufazowa (poprzedni sekret ważny do udowodnienia nowego) — zapisane w `mobileLogin`, `mobileLoginTotp`, `MobileSession.installationSecret`, `offline-sync.md`. Do potwierdzenia przez Konrada razem z EVM-094 AC2 (alternatywa: brak rotacji w M2 z ryzykiem RR-69, dawniej RR-NOC-T4-3); implementacja serwera w EVM-094.
    - Katalog błędów (`api-guidelines.md`): `device_wipe_required` w pierwszym kroku logowania przed hasłem + reguła pierwszeństwa.
  - **Poprawki rundy 3 (2026-10-28; przeglądy architekta i security, decyzje domyślne Tech Leada):**
    - `parseSyncChange` jest TOLERANCYJNY (zachowuje znane pola, odrzuca nieznane, nie odrzuca zmiany — ADR-0004: dodanie pola jest niełamiące). Zmiana znanego typu niezgodna z projekcją albo uszkodzona daje `{ kind: "invalid", resync: true }` (wymuszenie resyncu, nie ciche pominięcie); telemetria bez treści (tylko `reason` i słownikowy `type`). Ścisła walidacja zero dodatkowych pól to osobne `assertSyncProjectionStrict` / `SYNC_PROJECTIONS_STRICT` dla testów serwera (EVM-096/097: test negatywny przez nią, nie przez `SyncChangesResponse`). Opis w `SyncEntity` i `offline-sync.md`.
    - `confirmDeviceWipe` przyjmuje bieżący albo poprzedni, jeszcze nieprzekreślony sekret instalacji.
    - Rotacja dwufazowa: poprzedni sekret ma górny termin = czas życia tokenu odświeżania (≤ 7 dni); najwyżej dwa ważne sekrety (wydany, a nieudowodniony sekret przestaje działać po wydaniu następnego); oba unieważniane po potwierdzeniu wyczyszczenia, usunięciu urządzenia i dezaktywacji konta. Porównanie w stałym czasie także dla nieznanego `deviceId` — uwaga w EVM-094.
    - Ujednolicone AC: EVM-092 AC6 (ocena per zmiana + resync), EVM-096 AC2 i EVM-097 AC2 (ścisła walidacja projekcji); zdanie o atomowym unieważnieniu w rundzie 1 oznaczone jako zastąpione rundą 2.
  - Zmiany łamiące: własny, bezzależnościowy diff kontraktu z baseline'em (`packages/contracts/baseline/openapi.json`) jako **tymczasowy zamiennik oasdiff** (ADR-0004/0012), którego nie ma w CI — rozbieżność z `api-guidelines.md` zgłoszona jako dług techniczny.
  - Decyzje Konrada nadal pending (rekomendacje domyślne z `docs/backlog/M2/README.md`): `devicePublicKey` opcjonalny (decyzja 8), `pendingItems` w kontrakcie (decyzja 9), telefony prywatne (BYOD, decyzja 4). Zadanie przed EVM-094: addendum ADR-0005 „Ścieżka mobilnego logowania” (dziś tylko w ADR-0021). Ryzyka rezydualne zapisane jako RR-67, dawniej RR-NOC-T4-1 (potwierdzenie wyczyszczenia deklaratywne) i RR-68, dawniej RR-NOC-T4-2 (refresh token bez powiązania z urządzeniem w M2) — numery nadane 2026-10-28 w `threat-model.md`.

## Notatki
- Prefiks tokenów (np. `evia_rt_`) ułatwia skanery sekretów — wartość wyboru po stronie EVM-094.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
- 2026-10-27 — status ready: zaakceptowane przez Konrada ("Tak" na liście decyzji M2); ADR-0021 zaakceptowany (Tech Lead)
- 2026-10-27 — start realizacji (nocna kolejka, tor T4), gałąź feature/EVM-090-094-kontrakt-logowanie-mobilne
- 2026-10-27 — plan gotowy (backend-developer)
- 2026-10-27 — implementacja kontraktu: narzędzie zmian łamiących z baseline'em, 9 operacji `x-evia-planned`, reguły lint, atrapa serwera, testy `EVM-090 AC1–AC7` (backend-developer)
- 2026-10-28 — status in-review (Tech Lead): gate zielony na gałęzi T4; decyzje z rund 1–3 w sekcji Decyzje czekają na akceptację Konrada.
- 2026-10-28 — numery ryzyk rezydualnych nadane w `docs/security/threat-model.md`: RR-67…RR-69 (zastępują tymczasowe RR-NOC-…; security-engineer)
- 2026-10-28 — done po scaleniu #110 (Tech Lead)
