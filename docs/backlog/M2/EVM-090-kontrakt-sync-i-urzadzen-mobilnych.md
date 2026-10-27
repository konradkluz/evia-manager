---
id: EVM-090
title: "Kontrakt OpenAPI: logowanie mobilne, urządzenia i synchronizacja"
type: enabler
milestone: M2
epic: E9 Dostęp mobilny
status: draft
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

## Notatki
- Prefiks tokenów (np. `evia_rt_`) ułatwia skanery sekretów — wartość wyboru po stronie EVM-094.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
