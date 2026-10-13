---
id: EVM-084
title: Backupy, wersjonowanie mediów, rejestr usunięć i test odtworzenia na staging (007b)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P1
path: pelna
owner: devops-engineer
contributors: []
reviewers: [security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-007]
---

# EVM-084: Backupy, wersjonowanie mediów, rejestr usunięć i test odtworzenia na staging (007b)

> Część 007b podziału EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) („Etapy wdrożenia decyzji”, „Test odtworzenia”).

## Cel
Jako **właściciel produktu** chcę **automatycznych kopii bazy i mediów oraz sprawdzonej procedury odtworzenia na staging**, aby **mieć pewność, że dane są bezpieczne, a ten sam moduł mógł potem posłużyć produkcji**. Test odtworzenia nie działa w GitHub Actions.

## Kryteria akceptacji
**AC1 — Kopie bazy**
- Zakładając działający staging z EVM-007
- Gdy upływa harmonogram kopii
- Wtedy pgBackRest wykonuje automatyczne, szyfrowane kopie bazy z archiwizacją WAL (odtwarzanie do punktu w czasie), zapisywane poza VM; hasło i klucze są tylko na VM, w Bitwarden i w zestawie awaryjnym offline; nieudana kopia daje zdarzenie lokalne i metrykę (dostarczenie alertu — EVM-085).

**AC2 — Media i rejestr usunięć**
- Gdy sprawdzam buckety stagingu
- Wtedy bucket mediów jest wersjonowany i szyfrowany, a media mają kopię; osobny bucket rejestru usunięć (SR-PRIV-04) przyjmuje od aplikacji wyłącznie `PutObject` (próba odczytu, nadpisania i usunięcia kluczem aplikacji → `AccessDenied`); żaden bucket nie jest publiczny (anonimowy `GET` = `403`), a konfigurację wersjonowania i polityk zmienia wyłącznie sesja IaC.

**AC3 — Orkiestrator testu odtworzenia**
- Zakładając projekt `evia-restore-staging` z tokenem tylko na VM staging
- Gdy timer (co miesiąc i ręcznie) uruchamia test
- Wtedy powstaje tymczasowa VM bez portów przychodzących, z kluczami tylko do odczytu i jednorazowym podpisanym URL `PUT` na wynik; odtwarza bazę (PITR) i media, zapisuje wynik bez danych (czas, RPO, liczby kontrolne), wyłącza się, a agent zapisuje wynik lokalnie i usuwa VM także po błędzie; druga VM nie powstaje, gdy jedna istnieje.

**AC4 — Sprzątacz zasobów**
- Gdy w `evia-restore-staging` istnieją zasoby starsze niż 24 h (serwery, snapshoty, obrazy, wolumeny, adresy IP)
- Wtedy sprzątacz (co godzinę) je usuwa i zgłasza zdarzenie (test z sztucznie „starym” zasobem); dostarczenie alertu do Konrada — EVM-085.

**AC5 — Scenariusz „backup usunięty z przejętej VM”**
- Zakładając, że na staging kluczem z VM usuwane są obiekty kopii bazy
- Gdy uruchamiany jest test odtworzenia
- Wtedy odtworzenie nadal się udaje (kopia niezależna od usunięcia przez klucz z VM); scenariusz jest powtarzany co miesiąc, a jego wynik opisany w runbooku.

**AC6 — Runbook odtworzenia i wykonany test**
- Wtedy `docs/ops/runbooks/restore.md` opisuje odtworzenie bazy i mediów z PITR oraz ponowne zastosowanie rejestru usunięć (SR-PRIV-04), a procedura została wykonana na staging z zapisem wyniku (bez danych); dane produkcyjne i prawdziwe dane osobowe nie biorą udziału (dane syntetyczne).

## Poza zakresem
- Test odtworzenia z VM prod w projekcie `evia-restore`, wariant nieniszczący na prod (zablokowane wersje), warunek „udany ≤ 7 dni” przed wdrożeniem prod (V5), `skipRestoreTest` — E8 (EVM-061/062).
- Polecenie ponownego zastosowania rejestru usunięć w modułach aplikacji i zapis do rejestru — EVM-040 / EVM-062.
- Alerty i monitoring — EVM-085.

## Decyzje i ograniczenia
- Podział: decyzja Konrada 2026-10-13. Koszt tymczasowych VM < 2 zł/mies. (ADR-0018). Zasoby płatne po akceptacji kosztów.
- Buckety: ta historyjka tworzy buckety mediów i rejestru usunięć (zależą od niej EVM-040 i EVM-044); EVM-007 (007a) zapewnia VM, sekrety i kanał.
- Dane nigdy nie trafiają do GitHuba, na runner ani na staging z prod.

## Dziennik
- 2026-10-13 — utworzono (product-owner, podział EVM-007 wg ADR-0018: dawne AC4 i część AC7)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
