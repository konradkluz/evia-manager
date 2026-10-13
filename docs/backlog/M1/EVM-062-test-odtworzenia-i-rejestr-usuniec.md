---
id: EVM-062
title: Test odtworzenia kopii produkcji i rejestr usunięć
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: devops-engineer
contributors: [backend-developer]
reviewers: [security-engineer, solution-architect]
depends_on: [EVM-040, EVM-061]
---

# EVM-062: Test odtworzenia kopii produkcji i rejestr usunięć

## Historyjka
Jako **właściciel produktu** chcę **regularnie sprawdzać, że kopię produkcji da się odtworzyć, a dane usunięte na żądanie nie wracają po odtworzeniu**, aby **mieć pewność, że awaria nie zabierze danych firmy, a odtworzenie nie złamie RODO**.

## Kontekst
- SR-INFRA-07 (test odtworzenia wyłącznie na tymczasowej VM w projekcie prod w UE, test niezmienności), SR-PRIV-04 (rejestr usunięć stosowany po odtworzeniu), RR-14, RR-20 (tożsamość testu odtworzenia), uwaga 2 EVM-002 (kursor synchronizacji po odtworzeniu — M2).
- **Decyzja 5:** (Pro) wariant B z RR-20 — środowisko `prod-restore-test` ograniczone do `main`, uruchamiane harmonogramem; (Free) test poza GitHub Actions — klucze tylko w projekcie prod, uruchamiany przez Konrada wg runbooka, z przypomnieniem i alertem „brak testu > 35 dni” (nowe ryzyko do akceptacji). Wariant A z RR-20 (`production` w GitHubie) na Free nie istnieje.
- SR-FILE-11 — zadanie uzgadniania powstaje w EVM-051; tutaj — alerty i weryfikacja na prod.

## Kryteria akceptacji
**AC1 — Odtworzenie bazy (SR-INFRA-07)**
- Zakładając kopie prod
- Gdy uruchamiany jest test odtworzenia (przed pilotem realnym, przed wydaniem 1.0 i co miesiąc)
- Wtedy timer systemd na VM prod tokenem Hetzner osobnego projektu `evia-restore` tworzy tymczasową VM w UE (nie na runnerze CI ani na staging), VM nie ma portów przychodzących, dostaje klucze tylko do odczytu i jednorazowy podpisany URL `PUT` na wynik, jest usuwana także po błędzie (sprzątacz usuwa zasoby starsze niż 24 h), a w logach jest tylko wynik bez danych (czas, RPO, liczby kontrolne); wynik zapisuje lokalnie agent na VM prod.

**AC2 — Rejestr usunięć po odtworzeniu (SR-PRIV-04)**
- Zakładając na staging redakcję wpisu, anonimizację klienta i trwałe usunięcie pliku wykonane po punkcie odtworzenia
- Gdy odtwarzam bazę i media, a runbook stosuje rejestr usunięć
- Wtedy żadne z tych danych nie wracają, a operacje ponownego zastosowania są idempotentne.

**AC3 — Test niezmienności na prod (nieniszczący)**
- Gdy zadanie na VM prod próbuje kluczem z VM usunąć zablokowaną wersję obiektu kontrolnego i zmienić wersjonowanie lub lifecycle bucketu
- Wtedy dostaje `AccessDenied`, a wynik trafia do metryki z alertem.

**AC4 — Tożsamość testu (RR-20, decyzja 5)**
- Wtedy test działa poza GitHub Actions (timer na VM prod, ADR-0018), poświadczenia testu (token `evia-restore`, klucze odczytu) są tylko na VM prod i w menedżerze haseł, nie ma ich w GitHubie, a każde uruchomienie wysyła e-mail do Konrada.

**AC5 — Alerty (SR-LOG-07)**
- Gdy backup albo test odtworzenia się nie udaje, zasoby w `evia-restore` istnieją dłużej niż 24 h albo ostatni udany test jest starszy niż 7 dni przed wdrożeniem prod
- Wtedy kanał alertów wysyła alert (test alertu); „udany” = PITR z ponownym zastosowaniem rejestru usunięć i zgodnymi liczbami kontrolnymi, zapisany lokalnie na VM prod; przy teście starszym niż 7 dni agent uruchamia go automatycznie przed wdrożeniem (V5), a `skipRestoreTest` jest dozwolone tylko awaryjnie, z uzasadnieniem, alertem i wpisem w rejestrze wdrożeń.

**AC6 — Spójność storage'u z bazą (SR-FILE-11)**
- Wtedy zadanie uzgadniania z EVM-051 działa na prod, a rozbieżność wywołuje alert.

**AC7 — Runbook**
- Wtedy `docs/ops/runbooks/restore.md` opisuje odtworzenie prod z ponownym zastosowaniem rejestru usunięć, uruchomienie zadań retencji i (dla M2) wymuszenie pełnej synchronizacji urządzeń po odtworzeniu.

## Poza zakresem
- Coroczne ćwiczenie DR na prod (scenariusz „backup usunięty z przejętej VM”) — po wydaniu 1.0; na staging — co miesiąc wg SR-INFRA-07.

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (operacje) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

- Dane: pełne kopie danych prod (tylko na tymczasowej VM w UE).
- W AC: SR-INFRA-07, SR-PRIV-04, SR-LOG-07, SR-FILE-11. Ryzyka: RR-14, RR-20.

## Notatki techniczne
- `backend-developer`: polecenie ponownego zastosowania rejestru usunięć (idempotentne operacje w modułach).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC7 spełnione i zweryfikowane przez QA (raport testu odtworzenia bez danych)
- [ ] Przeglądy: security-engineer, solution-architect — APPROVE
- [ ] Runbook i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-13 — zmiana AC zaakceptowana przez Konrada (ADR-0018): AC1, AC4, AC5 — test z VM prod w projekcie `evia-restore` uruchamiany timerem, „udany ≤ 7 dni, inaczej automatycznie”, `skipRestoreTest` z alertem; liczba AC bez zmian (product-owner)
