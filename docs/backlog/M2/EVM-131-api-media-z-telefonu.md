---
id: EVM-131
title: "API: media z telefonu"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: done
priority: P1
path: pelna             # zmiana uprawnień i kanałów, pliki, dziennik zmian, migracja
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-044, EVM-096, EVM-098, EVM-127]
---

# EVM-131: API — media z telefonu

## Cel
Jako **technik** chcę, aby **serwer przyjmował zdjęcia i filmy z telefonu i pokazywał telefonowi, że plik jest bezpieczny (`clean`) albo zatrzymany**, aby **aplikacja mogła wysyłać media (EVM-108/130) i kasować oryginał dopiero po potwierdzeniu**. Luka z konsultacji 2026-11-14: wszystkie operacje sesji wysyłania mają dziś tylko kanał `web`, nie ma komendy `CreateMediaAsset`, a zmiany stanu `media_asset` nie trafiają do dziennika zmian.

## Kontekst
[`media-pipeline.md`](../../architecture/media-pipeline.md) §2, §6; [`offline-sync.md`](../../architecture/offline-sync.md) (tabela komend mobilnych, replikacja `MediaAsset` ↓); wzór polityki kanału i macierzy ról — [EVM-127](EVM-127-api-szablony-zlecen-dla-telefonu.md); mutacje i dziennik zmian — EVM-098, EVM-096; sesje wysyłania — EVM-044.

## Kryteria akceptacji

**AC1 — Sesja wysyłania dla kanału mobile**
- Zakładając Administratora lub Edytora zalogowanego z zarejestrowanego urządzenia (kanał mobile) i `MediaAsset` utworzony komendą z AC3
- Gdy tworzy sesję wysyłania, pobiera listę części i adres części, kończy sesję albo ją przerywa (pięć operacji: `createUploadSession`, `listUploadParts`, `getUploadPartUrl`, `completeUploadSession`, `abortUploadSession`)
- Wtedy odpowiedzi są takie same jak w panelu, a sesję kontynuuje tylko jej twórca (inny użytkownik dostaje odmowę); ważność adresu części nie zmienia się (wartość serwera, ≤ 60 min, SR-FILE-02 — test regresji).

**AC2 — Uprawnienia i kanały**
- Zakładając macierz ról i kanałów dla pięciu operacji
- Gdy wywołuję je jako niezalogowany, jako Tylko odczyt z tokenem telefonu, z urządzenia oznaczonego do wyczyszczenia albo z kanału spoza listy
- Wtedy dostaję odpowiednio `401`, `403 channel_not_allowed`, `401 device_wipe_required` i `403`; zachowanie kanału web (Administrator, Edytor, Tylko odczyt) się nie zmienia; test macierzy ról i kanałów obejmuje wszystkie przypadki, a nowy endpoint działa w modelu deny-by-default.

**AC3 — Komenda `CreateMediaAsset`**
- Zakładając telefon z komendą (`id` UUIDv7, `workOrderId`, `mediaType`, `category`, opcjonalnie `description`, `procedureStageId`, `capturedAt`) w mutacjach synchronizacji
- Gdy wysyła ją do `sync/mutations` (także po kolejce `CreateQuickWorkOrder`) i powtarza tę samą mutację
- Wtedy serwer tworzy `MediaAsset` raz (powtórka zwraca ten sam wynik bez duplikatu), a błędne dane dają odrzucenie ze słownika kodów mutacji (`validation_failed`, `id_conflict` dla zajętego `id`); typy komendy są w `packages/sync-core` i kontrakcie.

**AC4 — Zmiany `media_asset` w dzienniku zmian**
- Zakładając urządzenie ze zleceniem w zakresie
- Gdy `media_asset` jest tworzony albo zmienia stan pliku (w tym `clean`, kwarantanna, `failed`)
- Wtedy zmiana trafia do `sync/changes` tylko dla urządzeń mających to zlecenie w zakresie, z minimalnym ładunkiem (identyfikatory, typ, kategoria, stan pliku, kod przyczyny ze słownika — bez nazw plików, kluczy obiektów, adresów i skanowych szczegółów kwarantanny, SR-MOB-10), a telefon widzi stan `clean` lub kwarantannę po kolejnym pobraniu zmian.

**AC5 — Kontrakt**
- Zakładając kontrakt OpenAPI i test zgodności kontraktu mobilnego
- Gdy kanał mobile i komenda zostają dopisane
- Wtedy zmiana jest addytywna (bez złamania wersji aplikacji w polu), wygenerowane typy i test kontraktu przechodzą, a odpowiedzi nie zawierają danych klientów ani danych użytkowników spoza potrzeb operacji.

**AC6 — Migracja**
- Zakładając wyzwalacz zmian `media_asset` (migracja z kolejnym wolnym numerem)
- Gdy migracje są stosowane na pustej bazie i na bazie z istniejącymi mediami z panelu
- Wtedy przechodzą bez błędu i bez utraty danych, a testy integracyjne (kontener) potwierdzają zapis zmian z AC4.

## Poza zakresem
Zmiana czasu ważności adresu części (zostaje ≤ 60 min; kryterium „≤ 15 min” usunięte); pobieranie samych plików i miniatur na telefon (galeria tylko w panelu); aparat i wysyłka po stronie telefonu (EVM-108/130); redakcja i usuwanie mediów z telefonu; deduplikacja plików.

## Decyzje i ograniczenia
- Decyzja Konrada 2026-11-14 (rekomendacja architekta D3): nowa historyjka; kontrakt przed EVM-108, całość przed EVM-112; noc na telefonie pracuje na serwerze scenariuszy zgodnym z kontraktem.
- Ważność podpisanego adresu części — brzmienie security: pobierany tuż przed wysłaniem części, tylko w pamięci; serwer zachowuje wartość ≤ 60 min.
- Uprawnienia: kanał mobile dla Administratora i Edytora; Tylko odczyt nie loguje się do aplikacji (decyzja Konrada 2026-11-12), z tokenem telefonu dostaje `403 channel_not_allowed` (jak EVM-127); niezalogowany — `401`.
- Zakres replikacji `media_asset`: zlecenia w zakresie urządzenia, jak wpisy (`offline-sync.md`: `MediaAsset` ↓ pobieranie); ładunek minimalny wg AC4. Założenie potwierdzone przez Konrada 2026-11-15 (akceptacja zbiorcza tematów z nocy 14/15.11).
- **Scalenie PR = wdrożenie na jedyne środowisko** (migracja i zmiana kanałów trafiają na produkcję razem z kodem); zakaz dystrybucji aplikacji z aparatem/wysyłaniem przed dowodami EVM-084 i sign-offem EVM-112 pozostaje.
- Bezpieczeństwo i prywatność: dane — metadane mediów (kategoria, opis może zawierać dane osobowe — tylko w komendzie i bazie, nie w logach); testy tylko na danych syntetycznych; brak adresów i tokenów w logach.
- UX / UI: nie dotyczy.

| Rola / kanał | mobile | web (bez zmian) |
|---|---|---|
| Administrator, Edytor | tak (5 operacji, `CreateMediaAsset`) | tak |
| Tylko odczyt | `403 channel_not_allowed` | wg obecnej macierzy |
| Niezalogowany | `401` | `401` |

## Notatki techniczne
- Pliki do ograniczenia zmian: `packages/contracts/openapi/paths/media.yaml` (kanały), `apps/api/src/modules/sync/domain/mutations.ts`, `packages/sync-core/src/types.ts`, migracje (kolejny wolny numer; po 0055). Tor B nie dotyka tych katalogów.
- Wzorzec poprawki strażnika kanału — dziennik EVM-127.

## Definition of Done
- [ ] AC1–AC6 pokryte testami oznaczonymi `EVM-131 AC#` (w tym macierz ról i kanałów, integracyjne w kontenerze); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzje: code-reviewer, security-engineer — approve; `CHANGELOG.md`.

## Dziennik
- 2026-11-14 — utworzono (product-owner) po konsultacji architekta (luka: serwer nie obsługuje mediów z telefonu); 6 AC
- 2026-11-14 — draft → ready: kryteria zatwierdzone przez Tech Leada z delegacji Konrada (pytanie przed nocą 2026-11-14); Konrad przegląda je rano w PR
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-14` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-14-api-media-i-drobne`
- 2026-11-14 — plan gotowy (backend-developer)
- 2026-11-14 — implementacja gotowa na gałęzi (backend-developer): kontrakt (5 operacji `[web, mobile]`, `CreateMediaAsset`, `file` w sesji, stany `clean`/`quarantined`), migracja `0065_media_sync`, replikacja `media_asset`, komenda, testy AC1–AC6 w kontenerze; czeka na przegląd (code-reviewer, security-engineer) i bramkę orkiestratora
- 2026-11-14 — workflow `deliver-story` passed (2 rundy; QA pass 6/6 AC; code-reviewer i security-engineer approve po poprawkach: `capturedAt` opcjonalny wg AC3, RR-96 dla medium bez pliku); bramka orkiestratora `pnpm run gate` zielona; część kontenerowa (integracja z PostgreSQL) uruchomiona przez QA dla 8 plików (144 testy), pełna w CI; status `in-review` (Tech Lead)
- 2026-11-14 — do decyzji Konrada: RR-96 (medium bez pliku — brak widoku w panelu, retencji i limitu; warunek sign-offu EVM-112, historyjka przez `/refine`); założenie AC4 (zmiany mediów tylko dla urządzeń ze zleceniem w zakresie); odmowa 404 dla cudzej sesji jak w panelu
- 2026-11-14 — Koszt: 11 agentów, ok. 1,43 mln tokenów subagentów, 123 min pracy agentów
- 2026-11-15 — akceptacja Konrada („Akceptuję tematy z nocy”): kryteria zatwierdzone z delegacji przyjęte, założenie zakresu replikacji potwierdzone, RR-96 zaakceptowane do sign-offu EVM-112 (warunki (1)–(3) blokują wydanie aplikacji z wysyłaniem; historyjka przez `/refine`); scalone przez Konrada (#141, `252b2fd5`); **status `done`** (Tech Lead)
