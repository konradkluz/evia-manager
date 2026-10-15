---
id: EVM-088
title: Kontrola main-integrity (K6) akceptuje commity z „Rebase and merge”
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
path: pelna            # plik wrażliwy (tools/main-integrity/) i kontrola kompensująca bezpieczeństwa (ADR-0016) — pełna ścieżka z przeglądem security
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-087]
---

# EVM-088: Kontrola main-integrity (K6) akceptuje commity z „Rebase and merge”

## Cel
Jako **właściciel produktu (Konrad)** chcę, aby kontrola `main-integrity` (K6, `tools/main-integrity/`, ADR-0016) uznawała commity z „Rebase and merge” pod ścisłymi warunkami, aby PR z kilkoma historyjkami (EVM-087) zachowywał osobny commit z ID per historyjka, bez osłabiania gwarancji, że `main` zawiera wyłącznie to, co scalił Konrad.

Dziś K6 wymaga, by każdy commit na `main` był `merge_commit_sha` scalonego PR-a (`lib/main.mjs`, ok. l. 215–218), a przy rebase merge GitHub ustawia to pole tylko na ostatni przepisany commit — pozostałe commity wyglądałyby na obce. Do czasu realizacji kolejki scalamy squashem (decyzja 2026-10-15).

## Kryteria akceptacji

**AC1 — Poprawny rebase merge przechodzi**
- Zakładając, że PR do `main` został scalony przez `MAIN_MERGER` metodą „Rebase and merge”, ma zielony `ci-gate` na HEAD gałęzi, a liczba commitów na `main` w zakresie `merge_commit_sha~pull.commits..merge_commit_sha` równa się `pull.commits`
- Gdy `main-integrity` sprawdza każdy z tych commitów (zakres pobrany compare API)
- Wtedy każdy commit z zakresu jest uznany za zgodny, a przebieg jest zielony.

**AC2 — Commit spoza zakresu PR-a jest odrzucony**
- Zakładając, że w zakresie `main` wstawiono commit niebędący częścią scalonego PR-a (obcy commit w środku albo poza zakresem, bez własnego PR-a)
- Gdy `main-integrity` sprawdza ten commit
- Wtedy przebieg jest czerwony, a log wskazuje SHA i powód; zachowanie dla zwykłego squash merge (commit = `merge_commit_sha`) pozostaje bez zmian.

**AC3 — Niezgodna liczba commitów lub brak warunku jest odrzucone**
- Zakładając, że liczba commitów w zakresie różni się od `pull.commits`, albo PR scalił ktoś inny niż `MAIN_MERGER`, albo `ci-gate` na HEAD gałęzi PR-a nie jest zielony (brak, czerwony, pominięty), albo compare API zwróciło błąd lub wynik ucięty (paginacja)
- Gdy `main-integrity` ocenia commit z takiego PR-a
- Wtedy commity spoza `merge_commit_sha` nie są akceptowane (czerwony przebieg); błąd lub niepewny wynik API traktowany jak odrzucenie (fail closed), nigdy jak akceptacja.

**AC4 — Tytuł każdego commitu nadal weryfikowany**
- Zakładając, że commity z rebase merge są akceptowane wg AC1
- Gdy któryś z nich ma pierwszą linię niezgodną z `COMMIT_TITLE` (Conventional Commit z `[EVM-###]`, `[renovate]` albo `[M#]`)
- Wtedy przebieg jest czerwony z powodem wskazującym ten commit; pozostałe kontrole K6 (autor/merger, zmiany plików wrażliwych) działają dla każdego commitu z zakresu tak samo jak dla pojedynczego.

**AC5 — Testy i dokumentacja kontroli**
- Zakładając, że rozszerzenie jest zaimplementowane
- Gdy uruchamiane są testy `tools/main-integrity/` (z oznaczeniem `EVM-088 AC#`)
- Wtedy pokrywają przypadki: poprawny rebase, obcy commit w środku, zła liczba commitów, inny merger, czerwony/brak `ci-gate`, błąd compare API, zły tytuł; progi pokrycia bez obniżenia, a ADR-0016 / opis K6 w `docs/ops/github-i-ci.md` opisują nową regułę i jej granice.

## Poza zakresem
- Włączenie „Allow rebase merging” w ustawieniach repozytorium (robi Konrad po akceptacji demo) oraz powrót dokumentacji (`github-i-ci.md`, `workflow.md`, `conventions.md`, skill `deliver`) do rebase merge dla kolejek — osobny krok po realizacji, wg decyzji Konrada.
- „Merge commit” (zwykły) jako trzecia metoda scalania.
- Zmiany innych kontroli (K1–K5) i ochrony gałęzi.

## Decyzje i ograniczenia
- 2026-10-15 (Konrad): do czasu tej historyjki kolejki scalamy squashem; historyjka jest osobna od EVM-087.
- Bezpieczeństwo: to kontrola kompensująca (brak płatnych ochron gałęzi na GitHub Free), więc rozluźnienie reguły wymaga przeglądu security-engineer; zasada fail-closed, brak nowych zależności, brak sekretów w logach.
- Propozycja pochodzi z przeglądu security EVM-087 (`docs/ops/github-i-ci.md` → „Kolejka historyjek na jednej gałęzi”).

## Notatki
- Pytanie do architekta/security: czy zmiana wymaga aktualizacji ADR-0016 (nowy ADR czy dopisek).

## Otwarte pytania
1. Czy przy rebase merge wymagać także zgodności `tree` ostatniego commita z HEAD gałęzi PR-a (mocniejsza gwarancja treści)? Rekomendacja: nie w MVP — wystarczy zakres + liczba + zielony `ci-gate`; konsekwencja: rebase na zmienionym `main` zmienia SHA, więc porównanie drzew nie jest trywialne.
2. Maksymalna liczba commitów w PR-ze akceptowana w trybie rebase (np. 20)? Rekomendacja: tak, limit 20, powyżej czerwony — ogranicza koszt i powierzchnię; konsekwencja: większe kolejki trzeba dzielić na PR-y.
3. Czy `ci-gate` ma być sprawdzany na HEAD gałęzi PR-a, czy na `merge_commit_sha`? Rekomendacja: HEAD gałęzi PR-a (zgodnie z checklistą Konrada); konsekwencja: po rebase SHA różni się od testowanego.

## Dziennik
- 2026-10-15 — utworzono (product-owner, po przeglądzie security EVM-087)
