---
id: EVM-098
title: "API: wysyłanie mutacji — wpisy i komentarze"
type: story
milestone: M2
epic: E12 Wpisy offline
status: draft
priority: P1
path: pelna             # synchronizacja offline, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-090, EVM-094, EVM-096]
---

# EVM-098: API — wysyłanie mutacji (wpisy i komentarze)

## Cel
Jako **technik** chcę, aby **wpis lub komentarz napisany bez zasięgu trafił do dziennika zlecenia dokładnie raz**, aby **biuro widziało go bez ponownego pisania**. `POST /api/v1/sync/mutations` z `CreateNote` i `CreateComment` (ADR-0008, zasady 1, 4, 5).

## Kryteria akceptacji

**AC1 — Partia i wyniki**
- Zakładając partię ≤ 50 mutacji od Edytora zarejestrowanego urządzenia
- Gdy ją wysyłam
- Wtedy każda mutacja wykonuje się we własnej transakcji i dostaje wynik (`applied` / `duplicate` / `rejected` z kodem); partia > 50, mutacja > 64 KB lub treść > 1 MB jest odrzucona.

**AC2 — Tworzenie wpisu i komentarza**
- Zakładając zlecenie dostępne i nieusunięte (także rozliczone lub anulowane)
- Gdy przychodzi `CreateNote` / `CreateComment` z identyfikatorem z telefonu
- Wtedy powstaje wpis w dzienniku zlecenia (czas serwera jako kolejność, `capturedAt` jako metadana, autor z sesji), widoczny w panelu i w kolejnym pobraniu zmian.

**AC3 — Identyfikator tylko INSERT**
- Zakładając identyfikator istniejącego, także cudzego lub usuniętego obiektu
- Gdy przychodzi komenda z tym identyfikatorem
- Wtedy wynik to `rejected: id_conflict` bez zmiany i bez ujawnienia obiektu — nigdy upsert.

**AC4 — Idempotencja**
- Zakładając powtórzenie mutacji z tym samym `mutation_id` (powiązanym z użytkownikiem i urządzeniem z sesji)
- Gdy treść jest ta sama → `duplicate`; inna → `rejected: idempotency_mismatch`; trwająca → `idempotency_in_progress` (blokada wygasa); po wygaśnięciu rekordu idempotencji (> 30 dni) ponowienie wpisu utworzonego przez tego samego użytkownika **i** to samo urządzenie (kolumna `created_via_device_id` na wpisach) daje `duplicate` z ostrzeżeniem `idempotency_expired`, w pozostałych przypadkach `id_conflict`.

**AC5 — Autoryzacja w chwili synchronizacji**
- Zakładając utratę dostępu do zlecenia po utworzeniu wpisu w telefonie, zlecenie usunięte, etap spoza zlecenia
- Gdy mutacja dociera
- Wtedy `rejected: forbidden` / `target_unavailable` / `validation_failed` (bez zmian w danych); Tylko odczyt `403`; unieważnione urządzenie `401 session_revoked` i urządzenie do wyczyszczenia `401 device_wipe_required` dla całej partii; macierz ról obejmuje przypadek IDOR (cudze `workOrderId`); obowiązuje limit żądań na urządzenie, a odpowiedzi mają `Cache-Control: no-store`.

**AC6 — `capturedAt` poza zakresem**
- Zakładając `capturedAt` starszy niż 60 dni lub o > 10 min w przód
- Gdy mutacja dociera
- Wtedy jest `applied` bez `capturedAt` z ostrzeżeniem `captured_at_out_of_range` (dane nie giną).

**AC7 — Audyt i dziennik zmian**
- Zakładając udaną mutację
- Gdy się zatwierdza
- Wtedy powstaje wpis audytu (bez treści wpisu) i wiersz dziennika zmian (wyzwalacz z EVM-096), a zapis jest w tej samej transakcji.

## Poza zakresem
`CreateQuickWorkOrder` (EVM-099), `CreateMediaAsset` (E11), edycje (po MVP), retencja rekordów idempotencji — wykorzystuje EVM-079.

## Decyzje i ograniczenia
- Żądanie może nieść `pendingItems` (liczba niewysłanych elementów) — serwer zapisuje je w rekordzie urządzenia (EVM-094, README planu decyzja 9).
- Mutacje wywołują komendy domenowe przez fasady modułów (`timeline`, `work-orders`); `capturedAt` poza zakresem: stałe −60 dni / +10 min względem czasu serwera.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
