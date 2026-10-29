---
id: EVM-091
title: "sync-core: trwała kolejka mutacji i wysyłka"
type: enabler
milestone: M2
epic: E12 Wpisy offline
status: done
priority: P0
path: pelna             # synchronizacja offline
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, solution-architect]
model: sonnet
depends_on: []
---

# EVM-091: `sync-core` — trwała kolejka mutacji i wysyłka

## Cel
Jako **technik** chcę, aby **wszystko, co zapiszę w terenie bez zasięgu, czekało w trwałej kolejce i trafiło na serwer raz, w kolejności i bez strat**, aby **nic nie zginęło ani nie zdublowało się**. Nowy pakiet `packages/sync-core` (ADR-0007): czysty TypeScript, bez zależności od React Native i od kontraktu OpenAPI; porty: magazyn kolejki, transport, zegar, generator UUIDv7. Zasady: [`offline-sync.md`](../../architecture/offline-sync.md) (zasady 1, 2, 5; „Wysyłanie”).

## Kryteria akceptacji

**AC1 — Zapis do kolejki**
- Zakładając porty z atrapami
- Gdy dodaję mutację (`CreateNote`, `CreateComment`, `CreateQuickWorkOrder`)
- Wtedy dostaje identyfikator obiektu i `mutation_id` (UUIDv7 z generatora), `type` i `commandVersion`; kolejność jest FIFO w obrębie obiektu; mutacja zależna (np. wpis do szybkiego zlecenia) czeka na wynik mutacji nadrzędnej; stan kolejki przetrwa „restart” (odtworzenie z magazynu w teście).

**AC2 — Wysyłka partiami**
- Zakładając kolejkę z 120 mutacjami i transport z atrapą
- Gdy silnik wysyła
- Wtedy partie mają ≤ 50 mutacji, a wynik `applied` lub `duplicate` usuwa mutację z kolejki.

**AC3 — Utrata odpowiedzi nie dubluje**
- Zakładając, że serwer przetworzył partię, ale odpowiedź nie dotarła
- Gdy silnik ponawia te same mutacje z tym samym `mutation_id`
- Wtedy wynik `duplicate` zamyka mutację i nic nie jest wysłane drugi raz jako nowe.

**AC4 — Błędy przejściowe**
- Zakładając brak sieci, `5xx` lub `429` z `Retry-After`
- Gdy silnik próbuje wysłać
- Wtedy ponawia z narastającym opóźnieniem (z losowym rozrzutem, respektując `Retry-After`), nie usuwa i nie przestawia mutacji, a stan jest dostępny dla wskaźnika („oczekuje”, „ponawianie”).

**AC5 — Odrzucenia: „Wymaga uwagi”**
- Zakładając wynik `rejected` albo `conflict`
- Gdy silnik go odbiera
- Wtedy mutacja i jej dane zostają na liście „Wymaga uwagi” z kodem (nie są usuwane); mutacje zależne od odrzuconej są wstrzymane i oznaczone; przy `rejected: target_unavailable` / `forbidden` dane pozostają.

**AC6 — Sesja i wersja**
- Zakładając odpowiedzi `401 session_revoked`, `401 device_wipe_required` i `426`
- Gdy silnik je odbiera
- Wtedy przy `session_revoked` kolejka zostaje nietknięta i wstrzymana, a silnik zgłasza sygnał „usuń replikę, zachowaj kolejkę” (wznowienie tylko po pełnym logowaniu **tego samego `userId`** — właściciel kolejki jest zapisany; inny użytkownik → SR-MOB-13); przy `426` kolejka jest wstrzymana, a replika zostaje; przy `device_wipe_required` silnik zgłasza sygnał pełnego czyszczenia i nie wysyła nic więcej; `401` wywołuje jedno odświeżenie sesji, a po nim stop (bez pętli — fałszywe „reuse”); mutacja starszej `commandVersion` jest wysyłana bez zmian.

**AC7 — Diagnostyka bez danych osobowych**
- Zakładając zdarzenia diagnostyczne silnika
- Gdy kolejka zawiera mutacje z syntetycznymi danymi osobowymi
- Wtedy zdarzenia i komunikaty błędów zawierają tylko identyfikatory techniczne, typy i kody (test na zestawie syntetycznym).

## Poza zakresem
Pobieranie zmian i resync (EVM-092); szyfrowana baza (EVM-093); kolejka plików i upload (E11); UI; mutacje edycji (`UpdateStageStatus` — po MVP).

## Decyzje i ograniczenia
- Próg pokrycia pakietu 95% (ADR-0007; wartość z `testing-strategy.md` do potwierdzenia); testy oznaczone `EVM-091 AC#`; scenariusze „nic nie ginie” 1–3 (część kliencka) zasila EVM-092.
- Nowa zależność runtime — tylko z uzasadnieniem; rekomendacja: brak (własny UUIDv7).
- Nowy workspace wymaga zmian w `tools/repo-policy` (lista workspace'ów, preset pokrycia), warstwy 95% w `coverage-thresholds.json` oraz `tools/ci-changes` (`packages/sync-core/` jako zmiana nieistotna dla E2E web i integracji API) — dodaje je ta historyjka (tor B), bo potrzebuje ich w pierwszym PR; EVM-113 dopisuje tylko część Kotlin.
- Los kolejki po `session_revoked`: wstrzymanie + usunięcie repliki (P2, SR-MOB-04, EVM-011) — potwierdzone przez security.
- Architektura: `sync-core` ma własne typy kopert (`MutationEnvelope`, `MutationResult`, kody) i nie importuje `@evia/contracts` w kodzie runtime; zero `node:*` w `src` (działa w Hermes); losowość i zegar tylko przez porty (UUIDv7 z wstrzykniętym `getRandomValues`). Tokeny za portem `SessionOwner`/`TokenStore` (właściciel odświeżania może zmienić się w EVM-109 bez zmian ekranów).
- Bezpieczeństwo i prywatność: wpisy kolejki są walidowane po odczycie z magazynu (SR-MOB-10); wiek i właściciel elementu dostępne dla UI.

## Notatki
- Ścieżka wznowienia po `426` (blokada pracy online bez usuwania repliki) testowana tu jako stan silnika; ekran — EVM-100.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-27 — status ready: zaakceptowane przez Konrada ("Tak" na liście decyzji M2); ADR-0021 zaakceptowany (Tech Lead)
- 2026-10-29 — plan gotowy (mobile-developer)
- 2026-10-29 — implementacja `packages/sync-core` (kolejka, silnik, porty, UUIDv7), granice pakietu w ESLint i `deps:check`, warstwa `sync` 95%, klasyfikacja `tools/ci-changes`; testy `EVM-091 AC1–AC7`, zgodność z kontraktem sync, testy własności (mobile-developer)
- 2026-10-29 — status done: scalona w #115, zaakceptowana przez Konrada (Tech Lead)
