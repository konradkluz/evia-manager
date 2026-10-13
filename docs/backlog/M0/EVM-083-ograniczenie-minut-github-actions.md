---
id: EVM-083
title: Ograniczenie zużycia minut GitHub Actions
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
priority: P0
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-006]
---

# EVM-083: Ograniczenie zużycia minut GitHub Actions

> Wydzielone z EVM-007 (podział wg ADR-0018, 2026-10-13), żeby mogło pójść pierwsze; EVM-007 (007a) zależy od tej historyjki.

## Cel
Jako **właściciel produktu** chcę **ograniczyć zużycie minut GitHub Actions poniżej 1600 min miesięcznie**, aby **CI i wdrożenia staging nie stawały po wyczerpaniu puli 2000 min (plan Free) i aby nie płacić za nadwyżkę**. Realizuje „Minuty Actions i limit wydatków” z [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) oraz adnotację K1 do [ADR-0016](../../architecture/adr/0016-github-free-ochrona-main-kontrole-kompensujace.md).

## Kontekst
- Billing (potwierdzone przez Konrada): **2999 min od 2026-10-01 do 2026-10-13**, czyli ok. 230 min/dzień i **ok. 7000 min/mies.** przy puli 2000 (ADR-0018 szacował 4000). Wg jobów: e2e-web 949 (114 przebiegów), quality 543 (164), backend-integration 395 (114), security 353 (164), backend 318 (164), ci-gate 163, coverage 144, main-integrity 108 (71), nightly scans 26 (10); ok. 17,5 min na przebieg `ci.yml`.
- Pipeline'y nadal się uruchamiają mimo przekroczenia puli; Konrad sprawdza, czy GitHub nalicza opłaty za nadwyżkę i czy budżet (spending limit 0 USD) nie blokuje użycia — wynik wpisujemy w „Decyzje”.
- Dziś `ci.yml` startuje na każdym pushu każdej gałęzi (`branches: ['**']`), a `ci-gate` jest jedynym wymaganym checkiem (K1; Free nie ma rulesetów).
- Zmiana wymaga cięcia ponad 75% zużycia; same pominięcia przy zmianach dokumentacji mogą nie wystarczyć (większość minut to e2e-web i integracja przy zmianach kodu) — patrz AC5, dalsze cięcia tylko za zgodą Konrada.

## Kryteria akceptacji
**AC1 — Trigger: pełne CI tylko na PR i `main`**
- Zakładając push na gałąź bez otwartego PR
- Gdy uruchamia się CI
- Wtedy działają tylko szybkie kontrole (walidator dokumentacji, lint, typy), a pełny zestaw jobów uruchamia się na `pull_request` do `main` i na `push` do `main` (oraz ręcznie); przebieg szybki **nie tworzy** wyniku `ci-gate` = `success`, bo weryfikator wdrożeń z ADR-0018 (V2) ufa wyłącznie przebiegom pełnym.

**AC2 — Zmiany wyłącznie w dokumentacji**
- Zakładając PR zmieniający tylko pliki dokumentacji (lista ścieżek zapisana w workflow)
- Gdy uruchamia się CI
- Wtedy job wykrywający zmiany oznacza `e2e-web` i `backend-integration` (oraz zależny `coverage`) jako pominięte, a walidator dokumentacji w `quality` działa zawsze; to samo dla PR mieszanego (dokumentacja + kod), który uruchamia pełny zestaw.

**AC3 — `ci-gate` obsługuje pominięte joby**
- Zakładając PR tylko z dokumentacją
- Gdy joby ciężkie są pominięte
- Wtedy `ci-gate` jest `success` (pominięcie dozwolone wyłącznie dla joba, który wykrywanie zmian jawnie uznało za zbędny)
- Oraz gdy dowolny wymagany job jest `failure` lub `cancelled`, gdy pominięto job przy zmianie kodu albo gdy wykrywanie zmian się nie powiodło (fail-closed: pełny zestaw) — `ci-gate` jest czerwony albo uruchamia pełny zestaw (test negatywny dla każdego przypadku).

**AC4 — Niezmienniki pod kontrolą testu**
- Gdy zmieniany jest `ci.yml`
- Wtedy test w `tools/repo-policy` wymusza: brak `paths-ignore` na poziomie triggera, `ci-gate` zawsze uruchamiany i uwzględniający pominięcia wg AC3, brak `ci-gate` w przebiegu szybkim (AC1), walidator dokumentacji w jobie uruchamianym zawsze; zmiana trigerów to plik wrażliwy K3 (przegląd security).

**AC5 — Cel i szacunek**
- Zakładając wdrożoną zmianę i pierwsze przebiegi po niej
- Gdy mnożę minuty na przebieg per job (z pierwszych przebiegów po zmianie: PR kodowy, PR tylko z dokumentacją, push gałęzi, `main`) przez typową liczbę przebiegów z danych 1–13.10
- Wtedy szacunek wynosi **≤ 53 min/dzień (≈ 1600 min/mies., 80% puli)**, a tabela szacunku przed/po jest zapisana w `docs/ops/github-i-ci.md`
- Oraz jeśli szacunek przekracza próg, wpis zawiera job po jobie propozycje dalszych cięć do decyzji Konrada.
- Potwierdzenie z Billing po ≥ 7 dniach (Settings → Billing → Actions usage) to wpis w Dzienniku i w `docs/ops/github-i-ci.md` — poza DoD; nie blokuje zamknięcia tej historyjki ani EVM-007 (próg ponownej decyzji o planie: > 1600 min w dwóch kolejnych miesiącach).

**AC6 — Budżet Actions ustawiony świadomie**
- Zakładając brak karty i brak opłat (stan 2026-10-13: brak budżetu, pula 2000 min przekroczona)
- Gdy Konrad konfiguruje budżet Actions w ustawieniach GitHub według instrukcji z `docs/ops/github-i-ci.md` (agent nie ma uprawnień)
- Wtedy budżet ma alerty e-mail przy 50% i 80%, a opcja „Stop usage” jest wyłączona
- Oraz `docs/ops/github-i-ci.md` opisuje instrukcję krok po kroku, powód braku blokady (blokada przy przekroczonej puli zatrzymałaby CI do 1.11), skutek przekroczenia i termin ponownej decyzji o blokadzie (od listopada).

## Poza zakresem
- Zakup GitHub Pro (decyzja Konrada 2026-10-13: nie; wraca przy progu z AC5); przeniesienie CI poza GitHub Actions; `publish` i `staging-verify` (EVM-007) — liczone w pomiarze dopiero po ich dodaniu.
- Przebudowa zawartości jobów (przyspieszanie testów) — osobna historyjka, jeśli AC5 wskaże potrzebę.

## Decyzje i ograniczenia
- 2026-10-13 — Konrad: pełne CI tylko na PR i `main`, ciężkie joby pomijane przy zmianach samej dokumentacji, jako część ADR-0018 (decyzja 2).
- Pułapka: job wymagany jako check, który jest pominięty, bywa traktowany jako spełniony; dlatego `ci-gate` sam ocenia wyniki jobów (AC3).
- Bezpieczeństwo: `ci-gate` jest kontrolą K1, a V2 w ADR-0018 sprawdza `ci-gate` w przebiegu `ci.yml` PR; przebieg `pull_request` ma `head_sha` = HEAD PR. Weryfikator (EVM-007) musi akceptować przebiegi `pull_request`, a nie `push` gałęzi.
- 2026-10-13 — Konrad: brak karty i brak opłat; budżet Actions tylko z alertami 50% i 80%, bez „Stop usage” (blokada zatrzymałaby CI do 1.11); blokadę rozważamy ponownie od listopada; budżet konfiguruje Konrad wg instrukcji z historyjki (AC6).
- 2026-10-13 — Konrad: zamknięcie na podstawie szacunku (AC5); potwierdzenie z Billing po ≥ 7 dniach poza DoD.

## Notatki
- Przegląd security (runda 1): 3× major naprawione w rundzie poprawek — `--no-renames` w wykrywaniu zmian, `main-integrity` rozstrzyga przebieg `pull_request`, push na `main` zawsze pełny zestaw (rekomendacja security; koszt ok. +30 min/dzień oszczędności mniej). Minor (testy `jq` pomijane także w CI) i nit (dwa wpisy `ci-gate` w PR) domknięte przez orkiestratora.
- AC5: szacunek ok. 212 min/dzień (≈ 6400 min/mies.) wobec progu 53 — próg nieosiągnięty; propozycje dalszych cięć 1–6 w `docs/ops/github-i-ci.md` do decyzji Konrada (zgodnie z decyzją 2026-10-13 nie blokuje zamknięcia).
- `main-integrity.yml` (K6) i skany nocne zostają bez zmian; ich udział (ok. 134 min) wchodzi do pomiaru.

## Dziennik
- 2026-10-13 — utworzono (product-owner, podział EVM-007 wg ADR-0018); okres raportu Billing potwierdzony (01–13.10), priorytet P0 wg koordynatora
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
- 2026-10-13 — ready → in-progress: start `/deliver` (ścieżka lekka, gałąź `feature/EVM-083-minuty-actions`)
- 2026-10-13 — implementacja (devops-engineer): trigger push/pull_request/dispatch, jobs `quick` + `changes` (tools/ci-changes), `ci-gate` z oceną pominięć (GATE_JQ), niezmienniki w tools/repo-policy, K6 uznaje przebiegi `pull_request`; szacunek AC5 ≈ 181 min/dzień (> 53) + propozycje cięć w docs/ops/github-i-ci.md — decyzja Konrada; budżet AC6 do ustawienia przez Konrada wg instrukcji; potwierdzenie z Billing po ≥ 7 dniach — otwarte
- 2026-10-13 — runda poprawek (devops-engineer): 3× major z przeglądu security; szacunek AC5 zaktualizowany z ok. 181 do ok. 212 min/dzień (push na `main` zawsze pełny)
- 2026-10-13 — weryfikacja orkiestratora: `pnpm run gate` zielony (diff-coverage linie 122/122, gałęzie 67/69), `npm run test:tools` 441/0, testy `repo-policy` 192 + 2 jq (pominięte lokalnie, w CI wymagane); poprawka minor/nit; in-progress → in-review
- 2026-10-13 — Koszt: potok ok. 49 min, 3 agentów (wykonawca + recenzent + poprawki), ok. 272 tys. tokenów subagentów; ścieżka lekka zgodnie z celem
