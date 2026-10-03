---
id: EVM-061
title: Środowisko produkcyjne, wdrożenie i monitoring
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: draft
priority: P1
owner: devops-engineer
contributors: []
reviewers: [security-engineer, solution-architect]
depends_on: [EVM-006, EVM-007]
---

# EVM-061: Środowisko produkcyjne, wdrożenie i monitoring

## Historyjka
Jako **właściciel produktu** chcę **środowiska produkcyjnego w UE, wdrażanego bezpiecznym kanałem, z kopiami i monitoringiem**, aby **firma mogła pracować na realnych danych, a ja wiedział o każdym wdrożeniu i problemie**.

## Kontekst
- EVM-007 (staging) — te same skrypty IaC; ADR-0011 (Hetzner `evia-prod`, Scaleway `pl-waw`), ADR-0012, ADR-0013; SR-INFRA-13 i SR-INFRA-14.
- **Decyzja 5 (plan GitHub — przed planem EVM-007):** na GitHub Free w repozytorium prywatnym nie ma Environments ani rulesetów — każdy sekret CI byłby sekretem repozytorium dostępnym dla workflow z dowolnej gałęzi. Ta historyjka realizuje wariant wybrany przez Konrada (README M1 → „Decyzje”, pkt 5): (Pro) środowisko `production` z sekretami ograniczonymi do `main`; (Free) wzorzec pull z weryfikacją na VM i zero sekretów prod w GitHubie (wymaga zmiany ADR-0012 i SR-INFRA-13 oraz nowego ryzyka do akceptacji).
- Decyzje 7 (drugi Administrator / konto awaryjne, RR-16), 3 (klucze dostępu), 14 (rozmiar VM). Zasoby płatne — po akceptacji kosztów; pierwsze wdrożenie prod — wyłącznie po wyraźnej zgodzie Konrada.

## Kryteria akceptacji
**AC1 — Infrastruktura prod jako kod (SR-INFRA-08)**
- Zakładając zaakceptowane koszty
- Gdy uruchamiam IaC dla prod
- Wtedy powstaje środowisko w UE z tych samych modułów co staging, w osobnych projektach (Hetzner `evia-prod`, projekt Scaleway prod), z osobnymi kluczami, bucketami (media, kopie bazy, rejestr usunięć) i domeną; staging i prod nie współdzielą żadnych poświadczeń.

**AC2 — Kanał wdrożenia (SR-INFRA-13, SR-INFRA-14)**
- Zakładając wariant z decyzji 5
- Gdy wdrażam wersję na prod
- Wtedy wdraża się wyłącznie niezmienny digest sprawdzony na staging i zatwierdzony przez Konrada: (Pro) `workflow_dispatch` tylko z `main`, `github.actor` = konto Konrada, sekrety tylko w środowisku `production` ograniczonym do `main`, kanał CI → VM wg SR-INFRA-14 (rekomendacja: pull); (Free) VM sama pobiera digest po sprawdzeniu commita na `main` i zielonego `ci-gate` tokenem tylko do odczytu trzymanym na VM, bez sekretów wdrożeniowych w GitHubie
- Oraz próba wdrożenia z innej gałęzi, innego digestu albo przez inne konto jest odrzucona (test), a port 22 jest niedostępny z runnera po wdrożeniu (bramka 10).

**AC3 — Powiadomienie o wdrożeniu (SR-LOG-07)**
- Gdy wdrożenie prod się kończy (sukces albo błąd)
- Wtedy Konrad dostaje e-mail z wersją i wynikiem, a kanał alertów — zdarzenie.

**AC4 — Zgoda na pierwsze wdrożenie**
- Gdy środowisko jest gotowe
- Wtedy pierwsze wdrożenie prod odbywa się dopiero po wyraźnej zgodzie Konrada, zapisanej w „Decyzje” z datą.

**AC5 — Kopie i szyfrowanie (SR-DATA-04, SR-INFRA-07)**
- Gdy prod działa
- Wtedy baza ma PITR 30 dni i niezmienne kopie 37 dni, media — wersjonowanie i object lock, wolumen bazy — LUKS, bucket — SSE, a nieudany backup wywołuje alert (SR-LOG-07).

**AC6 — Monitoring i alerty (SR-LOG-07)**
- Gdy wykonuję test alertów na prod
- Wtedy działają alerty dostępności, błędów i bezpieczeństwa z ADR-0013 (nieudane logowania, blokady, zmiany ról i MFA Administratora, masowe pobrania i odczyt, kwarantanna, eksport, wdrożenie, backup) z e-mailem do Konrada.

**AC7 — Konta i klucze (SR-INFRA-09, SR-CRYPTO-04)**
- Wtedy wszystkie konta administracyjne dostawców (Hetzner, Scaleway, GitHub, Grafana, Sentry, rejestrator) mają MFA, a runbook zawiera inwentarz kryptograficzny i politykę kluczy (właściciel, miejsce, algorytm, rotacja, zniszczenie).

**AC8 — Administratorzy prod (RR-16)**
- Zakładając wdrożone prod
- Gdy Konrad aktywuje konto poleceniem na serwerze (EVM-016) i zaprasza drugiego Administratora albo zakłada konto awaryjne (decyzja 7)
- Wtedy na prod są co najmniej dwa konta Administratora (albo Administrator + konto awaryjne), każde z co najmniej dwoma kluczami dostępu i kodami odzyskiwania przechowywanymi poza telefonem; konta prod są oddzielne od kont staging.

## Poza zakresem
- Test odtworzenia i rejestr usunięć po odtworzeniu — EVM-062. Wysoka dostępność (druga VM) — poza MVP (RR-16).
- Warunki kolejnych wdrożeń prod w trakcie pilota realnego (do sign-off 1.0) — EVM-065 AC7 (README M1 → „Punkt pilota”); kanał z AC2 pozostaje ten sam.
- Dystrybucja aplikacji mobilnej — M2 (E14).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (infrastruktura) — konta aplikacji wg AC8 |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | tylko 80/443 (Caddy) |

- Dane: realne dane osobowe klientów i pracowników (prod).
- W AC: SR-INFRA-08, SR-INFRA-13, SR-INFRA-14, SR-LOG-07, SR-DATA-04, SR-INFRA-07, SR-INFRA-09, SR-CRYPTO-04.
- W sekcji: SR-INFRA-01, SR-INFRA-02, SR-INFRA-05, SR-COMM-01, SR-SUPPLY-07. Ryzyka: RR-06, RR-11, RR-16, RR-19.

## Notatki techniczne
- Obie ścieżki kanału wdrożenia opisane w planie technicznym; wybór wg decyzji 5. Wariant Free: zmiana ADR-0012 (GitHub Pro to pozycja „nie usuwać bez nowego ADR”) i SR-INFRA-13 przez `solution-architect` i `security-engineer` — przed planem EVM-007.
- Rozmiar VM prod: CX33 (jak staging od EVM-044 — decyzja 14).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione i zweryfikowane przez QA (testy wdrożenia, test alertów)
- [ ] Przeglądy: security-engineer, solution-architect — APPROVE
- [ ] Runbooki (`docs/ops/runbooks/`) i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja Konrada (w tym zgoda na pierwsze wdrożenie prod)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): odesłanie do bramki wdrożeń w trakcie pilota (EVM-065 AC7)
