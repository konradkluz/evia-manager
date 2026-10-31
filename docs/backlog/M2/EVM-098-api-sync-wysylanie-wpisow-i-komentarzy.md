---
id: EVM-098
title: "API: wysyłanie mutacji — wpisy i komentarze"
type: story
milestone: M2
epic: E12 Wpisy offline
status: ready
priority: P1
path: pelna             # synchronizacja offline, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-090, EVM-094, EVM-096]
---

# EVM-098: API — wysyłanie mutacji (wpisy i komentarze)

## Cel
Jako **technik** chcę, aby **wpis lub komentarz napisany bez zasięgu trafił do dziennika zlecenia dokładnie raz**, aby **biuro widziało go bez ponownego pisania**. `POST /api/v1/sync/mutations` z `CreateNote` i `CreateComment` (kontrakt EVM-090; [`offline-sync.md`](../../architecture/offline-sync.md), zasady 1, 4, 5; ADR-0008). Komendy są jedynymi mutacjami w tej historyjce — `CreateQuickWorkOrder` dochodzi w EVM-099 (ta sama operacja, kolejny `type`).

## Kryteria akceptacji

**AC1 — Partia, kolejność i wyniki**
- Zakładając partię 1–50 mutacji (`CreateNote` / `CreateComment`) od Edytora lub Administratora zarejestrowanego urządzenia
- Gdy ją wysyłam
- Wtedy mutacje wykonują się kolejno w kolejności żądania, każda we własnej transakcji, a odpowiedź `200` zawiera wynik per mutacja w tej samej kolejności (`applied` / `duplicate` / `conflict` z `id_conflict` / `rejected` z kodem z kontraktu); odrzucenie jednej mutacji nie wstrzymuje następnych; zła koperta lub partia (pusta, > 50, nieprawidłowy `mutationId`) → `400 validation_failed`, treść > 1 MB → `413 payload_too_large`, mutacja > 64 KB, zły ładunek (brak pola, pole spoza kontraktu, `body` pusty po normalizacji lub > 10 000 znaków) albo nieznany `type` / `commandVersion` → `rejected: validation_failed` tylko tej mutacji; `type` istniejący w kontrakcie, ale jeszcze nieobsługiwany (`CreateQuickWorkOrder` przed EVM-099) → `rejected: validation_failed`, bez skutków.

**AC2 — Tworzenie wpisu i komentarza**
- Zakładając zlecenie dostępne dla użytkownika i nieusunięte (także rozliczone lub anulowane)
- Gdy przychodzi `CreateNote` / `CreateComment` z identyfikatorem wygenerowanym na telefonie
- Wtedy powstaje wpis dziennika zlecenia (`kind` = `note` / `comment`) pod tym identyfikatorem, z regułami treści i kategorii jak przy dodawaniu wpisu w panelu (normalizacja treści, kategoria wymagana dla notatki, etap `procedureStageId` musi należeć do tego zlecenia — inaczej `rejected: validation_failed`); autor i urządzenie pochodzą wyłącznie z sesji (kolumna `created_via_device_id` na wpisach, nigdy z treści), kolejność w dzienniku wyznacza czas serwera, a `capturedAt` jest metadaną; wpis jest widoczny w panelu (`GET …/timeline`) i niczym nie różni się od wpisu z panelu poza oznaczeniem urządzenia.

**AC3 — Identyfikator tylko INSERT**
- Zakładając identyfikator wpisu, który już istnieje — także cudzy, usunięty albo wpis innego rodzaju lub zlecenia
- Gdy przychodzi komenda z tym identyfikatorem i innym `mutationId`
- Wtedy wynik to `conflict` z kodem `id_conflict` bez żadnej zmiany i bez ujawnienia obiektu (ta sama odpowiedź dla każdego istniejącego identyfikatora) — nigdy upsert; dwie mutacje w jednej partii z tym samym identyfikatorem wpisu: pierwsza `applied`, druga `conflict`.

**AC4 — Idempotencja**
- Zakładając powtórzenie mutacji z tym samym `mutationId` od tego samego użytkownika i urządzenia z sesji (klucz = użytkownik + urządzenie + `mutationId`; ten sam `mutationId` z innego urządzenia lub użytkownika to niezależna mutacja)
- Gdy treść (typ, wersja komendy i ładunek, porównane po skrócie SHA-256 postaci kanonicznej) jest ta sama → `duplicate` bez drugiego wpisu; inna treść lub inny `type` → `rejected: idempotency_mismatch`; poprzednia próba jeszcze trwa → `rejected: idempotency_in_progress` (blokada wygasa po 60 s, po czym mutację można ponowić); po wygaśnięciu rekordu idempotencji (> 30 dni) ponowienie daje `duplicate` z ostrzeżeniem `idempotency_expired` tylko, gdy istniejący wpis ma ten sam identyfikator, rodzaj i zlecenie oraz został utworzony przez tego samego użytkownika **i** to samo urządzenie (`created_via_device_id`), w pozostałych przypadkach `conflict` `id_conflict`.
- Rekord idempotencji powstaje tylko dla `applied` (w tej samej transakcji co wpis); mutacja odrzucona (`rejected` / `conflict`) nie zapisuje rekordu, więc po zmianie okoliczności (np. przywrócony dostęp) ta sama mutacja może zostać zastosowana ponownie.

**AC5 — Dostęp: role, sesja, wersja, limit**
- Zakładając role Administrator, Edytor, Tylko odczyt, brak sesji, sesję kanału web, unieważnione urządzenie, urządzenie do wyczyszczenia, wersję aplikacji poniżej minimalnej i przekroczony limit żądań
- Gdy wywołują `POST /api/v1/sync/mutations`
- Wtedy Administrator i Edytor są obsługiwani; Tylko odczyt `403 forbidden` (także gdy rolę zmieniono po zalogowaniu — rola jest sprawdzana przy każdym żądaniu); brak mobilnej sesji `401`; unieważnione urządzenie `401 session_revoked` i urządzenie do wyczyszczenia `401 device_wipe_required` (to drugie ma pierwszeństwo) dla całej partii, bez przetworzenia żadnej mutacji; wersja poniżej minimalnej `426`; limit **60 żądań/min na urządzenie** (osobny kubełek obok globalnych 300/min na użytkownika, partia to jedno żądanie) → `429 rate_limited` z `Retry-After` i bez żadnych skutków (partia nie jest przetwarzana, można ją powtórzyć w całości); wszystkie odpowiedzi, także błędy, mają `Cache-Control: no-store`.

**AC6 — Autoryzacja w chwili synchronizacji**
- Zakładając wpis napisany w telefonie, gdy użytkownik mógł mieć wtedy dostęp do zlecenia
- Gdy mutacja dociera do serwera
- Wtedy dostęp do zlecenia ocenia bieżąca polityka obiektowa (jak w panelu), a nie stan z chwili napisania wpisu: zlecenie bez dostępu **lub nieistniejące** → `rejected: forbidden` (jedna odpowiedź dla obu przypadków, brak informacji o istnieniu — test IDOR z cudzym `workOrderId`), zlecenie dostępne, lecz usunięte → `rejected: target_unavailable`; w obu przypadkach bez zmian w danych i bez rekordu idempotencji, a mutacja zostaje po stronie telefonu na liście „Wymaga uwagi”.

**AC7 — `capturedAt` poza zakresem**
- Zakładając `capturedAt` starszy niż 60 dni lub późniejszy niż czas serwera + 10 min (wartości stałe)
- Gdy mutacja dociera
- Wtedy jest `applied` z ostrzeżeniem `captured_at_out_of_range`, wpis jest zapisany bez `capturedAt` (dane nie giną); `capturedAt` w zakresie jest zapisany bez zmian; ostrzeżenie nie dotyczy wyniku `duplicate`.

**AC8 — Audyt, atomowość i `pendingItems`**
- Zakładając zastosowaną mutację
- Gdy transakcja się zatwierdza
- Wtedy w tej samej transakcji powstają wpis, rekord idempotencji i wpis audytu (typ komendy, identyfikatory zlecenia i wpisu, urządzenie; bez treści wpisu i bez danych osobowych), a błąd któregokolwiek zapisu cofa całość i daje `500` dla tej partii bez wyniku dla niezatwierdzonych mutacji (telefon ponawia bezpiecznie dzięki AC4); żądanie z poprawną sesją i polem `pendingItems` zapisuje je w rekordzie urządzenia (`pendingItemsReported`, wartość > 10 000 przycinana do 10 000), niezależnie od wyników mutacji, a żądanie odrzucone na poziomie sesji, wersji lub limitu go nie zapisuje; wartość nie wpływa na żadną decyzję serwera.

## Poza zakresem
`CreateQuickWorkOrder` (EVM-099), `CreateMediaAsset` (E11), edycje i korekty z telefonu (po MVP), retencja rekordów idempotencji (EVM-079), pobieranie utworzonych wpisów na telefon i wyzwalacz dziennika zmian dla wpisów (EVM-097), lista „Wymaga uwagi” po stronie aplikacji (EVM-105/107).

## Decyzje i ograniczenia
- Mutacje wywołują komendy domenowe przez fasady modułów (`timeline`, `work-orders`) i wspólne reguły tworzenia wpisu (bez duplikowania walidacji); `sync` nie importuje wnętrza innych modułów. Platformowy mechanizm idempotencji ma być wykorzystany lub rozszerzony, a nie powielony; klucz obejmuje użytkownika i urządzenie z sesji (nie z żądania).
- **Dziennik zmian:** wpisy dziennika są w zakresie synchronizacji dopiero w EVM-097 (wyzwalacz i test kompletności dla `TimelineEntry`); EVM-098 nie zakłada, że telefon pobierze swój wpis z kanału zmian. Kolejność realizacji 097 i 098 jest dowolna.
- **Migracja (addytywna, expand):** kolumna `created_via_device_id` (identyfikator urządzenia z sesji, bez treści i danych osobowych) na wpisach dziennika; numer migracji = następny wolny na `main` w chwili realizacji (kolizje z innym torem rozstrzyga orkiestrator). EVM-099 dodaje analogiczną kolumnę do zleceń.
- Stałe: partia 50, mutacja 64 KB, treść 1 MB, `capturedAt` −60 dni / +10 min, retencja idempotencji 30 dni, blokada „w toku” 60 s, limit 60 żądań/min/urządzenie, `pendingItems` przycinane do 10 000. Kontrakt (`pushSyncMutations`, `x-evia-planned`) jest z EVM-090; zdjęcie flagi planowanej operacji należy do tej historyjki, zmiana kształtu odpowiedzi — nie.
- Bezpieczeństwo i prywatność: `deny-by-default`, test macierzy ról dla tej operacji (w tym IDOR), logi bez treści wpisów i bez `mutationId` powiązanego z osobą; odpowiedź `duplicate` nie zwraca treści wpisu.

## Notatki
- Telefon sam pilnuje kolejności zależności (wpis czeka na `applied` swojego `CreateQuickWorkOrder`); serwer nie buforuje mutacji „na później” — wpis do jeszcze nieistniejącego zlecenia dostaje `forbidden`.
- Testy oznaczamy `EVM-098 AC#`; test równoległości (dwa jednoczesne żądania z tym samym `mutationId` → jeden `applied`, drugi `duplicate` albo `idempotency_in_progress`, zawsze jeden wpis) na PostgreSQL w kontenerze.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-29 — doprecyzowanie do DoR: zgodność z kontraktem (`conflict` + `id_conflict`), podział na 8 AC, macierz ról, kolejność, zakres dziennika zmian (097) (product-owner)
- 2026-10-29 — zaakceptowano przez Konrada: AC1–8; forbidden także dla zlecenia nieistniejącego; limit 60 żądań/min na urządzenie; odrzucone mutacje bez rekordu idempotencji; blokada w toku 60 s; kolizja id to outcome conflict z kodem id_conflict (zgodnie z kontraktem EVM-090); status ready
- 2026-10-31 — plan gotowy (backend-developer)
- 2026-10-31 — implementacja API (push mutacji, migracja 0055, audyt `sync.mutation_applied`); 403 dla Tylko odczyt zwraca `forbidden` zgodnie z kontraktem i decyzją dla EVM-096 AC5 — tekst AC5 (`channel_not_allowed`) do korekty przez Konrada (backend-developer)
- 2026-10-31 — decyzja Konrada: AC5 — rola Tylko odczyt dostaje `403 forbidden` (spójnie z EVM-096 AC5); treść AC poprawiona (tech lead)
