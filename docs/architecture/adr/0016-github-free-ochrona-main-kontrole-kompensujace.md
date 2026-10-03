# ADR-0016: GitHub Free — ochrona `main` procedurą i kontrolami kompensującymi K1–K7, zizmor i actionlint, CI backendu przez `docker compose run`

- **Status:** Proponowana
- **Data:** 2026-10-03
- **Decydent:** Konrad (akceptacja na demo EVM-006 razem z ryzykiem rezydualnym RR-21) · **Autor:** devops-engineer (szkic wg wytycznych `solution-architect` W12; przegląd `solution-architect` przed demo)
- **Powiązane:** EVM-006, EVM-007; ADR-0012 (częściowo zastępuje — plan GitHub i weryfikacja ochrony `main`, lista narzędzi CI), ADR-0015 (częściowo zastępuje — „Po EVM-006” p. 10), ADR-0014; `docs/ops/github-i-ci.md`, `docs/security/threat-model.md` (RR-21)

## Kontekst i problem
ADR-0012 zakładał plan **GitHub Pro albo Team**, bo tylko płatny plan egzekwuje ochronę `main` (ruleset) w repozytorium prywatnym, i weryfikację „próba bezpośredniego pushu do `main` zostaje odrzucona”. 2026-10-03 Konrad zdecydował: repozytorium prywatne `konradkluz/evia-manager` na **GitHub Free** (EVM-006 → „Decyzje”). Na Free w repozytorium prywatnym nie ma gałęzi chronionych, rulesetów, sekretów środowisk ani ograniczeń gałęzi wdrożeń (sprawdzone 2026-10-03 w dokumentacji GitHub). Jednocześnie EVM-006 dodaje narzędzia spoza listy ADR-0012 (zizmor — decyzja D3; actionlint — rekomendacja architekta) i uruchamia joby backendu w CI inaczej niż wskazuje ADR-0015 p. 10 (`container:` z digestem). Te trzy odstępstwa wymagają zapisu w ADR (`docs/architecture/README.md` → „Koszty”: płatnego planu GitHub „nie wolno usunąć bez nowego ADR”).

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Koszt | 4 | budżet 300 zł/mies.; w M0 nie ma wdrożeń ani sekretów produkcyjnych |
| Egzekwowanie ochrony `main` | 4 | czerwony etap ma blokować merge (EVM-006 AC4) |
| Wykrywalność obejścia | 4 | jedna osoba z prawem zapisu i agenci AI z kluczem wdrożeniowym |
| Ochrona sekretów CI | 3 | sekrety wdrożeniowe przychodzą w EVM-007 |
| Prostota utrzymania | 3 | jedna osoba, bez dodatkowych kont |
| Odwracalność | 2 | zmiana planu bez zmian w kodzie |

## Rozważane opcje
1. **A — GitHub Free + kontrole kompensujące K1–K7** (procedura scalania, CI na każdym pushu z jednym checkiem `ci-gate`, kontrola `main-integrity` po każdym pushu na `main` i co noc, minimum sekretów).
2. **B — GitHub Pro** (4 USD/mies. ≈ 15,50 zł) z rulesetem `main` bez listy obejść i wymaganym checkiem `ci-gate`.
3. **C — GitHub Team** (organizacja, 4 USD/użytkownika/mies.) — jak B plus konta maszynowe w organizacji; wymaga przeniesienia repozytorium.

## Ocena
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| Koszt (4) | 5 | 4 | 3 |
| Egzekwowanie ochrony `main` (4) | 1 | 5 | 5 |
| Wykrywalność obejścia (4) | 4 | 5 | 5 |
| Ochrona sekretów CI (3) | 2 | 3 | 3 |
| Prostota utrzymania (3) | 4 | 4 | 3 |
| Odwracalność (2) | 5 | 5 | 3 |
| **Suma ważona (maks. 100)** | **68** | **87** | **76** |

B wygrywa w ocenie technicznej; A wybiera **decyzja kosztowa Konrada** dla M0, przy założeniu, że do czasu sekretów wdrożeniowych w CI (EVM-007) ryzyko obejścia jest wykrywalne i odwracalne. Informacje o planach i funkcjach zweryfikowane 2026-10-03 (źródła niżej).

## Decyzja
Wybieramy **A — GitHub Free z kontrolami K1–K7**, ponieważ spełnia decyzję kosztową Konrada, a **obejście proceduralne** (bezpośredni push, scalenie przy czerwonym `ci-gate` albo przez kogoś innego niż Konrad, force push, zły tytuł) zostaje wykryte (K6) i jest odwracalne (revert), dopóki w CI nie ma sekretów wdrożeniowych. **Obejście złośliwe** K6 może przeoczyć: osoba z prawem zapisu (także agent z kluczem wdrożeniowym) może w workflowie swojej gałęzi podnieść `permissions: contents: write` i wypchnąć commit na `main` tokenem `GITHUB_TOKEN` — taki push nie uruchamia żadnego workflowu, a jeśli ten sam commit zmienia `tools/main-integrity/**` albo workflowy, kolejne przebiegi K6 działają już na zmienionym kodzie. Takie obejście wykrywa wyłącznie widok Activity repozytorium (wpis „Direct push” od `github-actions[bot]`) — przeglądany przy każdym scaleniu i co tydzień (K2).

**Kontrole kompensujące** (szczegóły i procedury: `docs/ops/github-i-ci.md`):
| # | Kontrola | Typ |
|---|---|---|
| K1 | CI (`.github/workflows/ci.yml`) na każdym pushu każdej gałęzi; jeden check `ci-gate`, zielony wyłącznie przy `success` wszystkich wymaganych jobów; e-mail o nieudanym przebiegu | wykrywająca |
| K2 | Scalanie: „Squash and merge” klika wyłącznie Konrad w PR, przy zielonym `ci-gate` dla HEAD gałęzi, po akceptacji demo; tytuł PR = Conventional Commit z ID; po scaleniu i co tydzień przegląd widoku Activity dla `main` (tylko „Pull request merge” Konrada); orkiestrator lokalnie tylko `git fetch` + `git merge --ff-only origin/main` | proceduralna |
| K3 | Szablon PR z checklistą; zmiany plików wrażliwych (`.github/**`, `.claude/**`, `compose*.yaml`, `lefthook.yml`, pliki wyjątków skanerów) wymagają jawnej uwagi Konrada; `CODEOWNERS` jako dokumentacja; lista zmienionych plików wrażliwych w podsumowaniu joba `security` | proceduralna |
| K4 | Agenci: klucz wdrożeniowy tylko do tego repozytorium; reguły `deny` w `.claude/settings.json`; push wykonuje orkiestrator; tokeny GitHub na stacji bez prawa scalania (`Contents: write`) | zapobiegawcza, częściowa |
| K5 | Ustawienia repozytorium: wyłącznie squash merge z komunikatem „tytuł i opis PR”, akcje tylko przypięte po SHA, `GITHUB_TOKEN` domyślnie tylko do odczytu, wyłączone tworzenie i akceptowanie PR przez Actions, wyłączone forkowanie, MFA (passkey) | zapobiegawcza |
| K6 | `main-integrity` (`tools/main-integrity`; osobny workflow `.github/workflows/main-integrity.yml` bez grupy `concurrency`, żeby GitHub nie anulował oczekujących przebiegów) po każdym pushu na `main` i co noc: każdy commit z **okna kroczącego** — 30 najnowszych commitów `main` aż do `BASELINE` (ostatni commit `main` sprzed K6) — pochodzi ze scalonego PR (scalił Konrad), HEAD tego PR ma zielony `ci-gate` w przebiegu `ci.yml`, tytuł z `[EVM-###]`, `[renovate]` albo `[M#]`; przy pushu historia jest przewinięciem bez force pushu; commity zmieniające `.github/`, `tools/main-integrity/` albo `tools/scan/` wypisane osobno do sprawdzenia w Activity; każdy błąd = czerwony. Wykrywa obejście proceduralne, także commit wypchnięty bez uruchomienia workflowu — przy następnym pushu albo w nocy | wykrywająca |
| K7 | Minimum sekretów repozytorium: w EVM-006 wyłącznie `RENOVATE_TOKEN` (dodawany dopiero po rozstrzygnięciu ryzyka Q1 przez `security-engineer` i Konrada) | ograniczająca |

**Zmiany względem ADR-0012:**
- Plan GitHub Free zamiast Pro/Team; koszt repozytorium i CI 0 zł (pula 2000 min Actions/mies., limit wydatków 0 USD).
- Weryfikację „bezpośredni push do `main` odrzucony” zastępuje **K6** (wykrycie zamiast blokady).
- Lista narzędzi CI rozszerzona o **zizmor** (MIT; analiza bezpieczeństwa workflowów, `--offline`, blokuje od ważności `low`) i **actionlint** (MIT; składnia, wyrażenia, `needs`, shellcheck w `run:`) — obrazy po digeście, bez sieci.

**Zmiana względem ADR-0015 (p. 10 „Po EVM-006”):** joby backendu w CI uruchamiają **te same polecenia co lokalnie** — `docker compose -f compose.yaml run --rm backend-install` i `… backend-tests pnpm run gate:backend` — zamiast `container:` z digestem. Ten sam Dockerfile z bazą po digeście daje pełny parytet bez publikacji obrazu w GHCR (bez `packages: write`, dodatkowego tokenu i powierzchni ataku).

**Struktura monorepo** (ADR-0012) — potwierdzona bez zmian w EVM-006; zapis w `docs/architecture/README.md` → „Struktura repozytorium”.

**Warunki powrotu do planu płatnego (B)** — którykolwiek wystąpi pierwszy:
1. druga osoba (lub konto maszynowe) z prawem zapisu do repozytorium;
2. K6 wykryje scalenie bez zielonego `ci-gate` albo commit spoza PR na `main`;
3. sekrety wdrożeniowe w CI (najpóźniej przed planem EVM-007, jeśli wybrany mechanizm wdrożeń ich wymaga).

**Ograniczenie dla EVM-007:** na Free każdy sekret jest sekretem repozytorium, dostępnym dla workflowu uruchomionego z dowolnej gałęzi; środowiska nie mają sekretów ani ograniczenia gałęzi wdrożeń. Założenia SR-INFRA-13, SR-INFRA-14 i RR-20 („poświadczenia tylko w środowiskach ograniczonych do `main`”) są na Free niewykonalne. Mechanizm wdrożeń wybiera **osobny ADR przed planem EVM-007**.

## Konsekwencje
- **Pozytywne:** 0 zł zamiast ≈ 15,50 zł/mies.; te same polecenia lokalnie i w CI (kontener `backend-tests`, skany przez `compose run`); obejście proceduralne jest wykrywane po fakcie (K6) i odwracalne; workflowy sprawdzane statycznie przed pushem (zizmor, actionlint, `tools/repo-policy`).
- **Negatywne / koszty:** brak twardej blokady — bezpośredni push lub scalenie z czerwonym CI jest możliwe i wykrywane dopiero po fakcie; K6 działa z workflowu i narzędzia, które ten sam push może zmienić — push tokenem `GITHUB_TOKEN` z workflowu gałęzi nie uruchamia workflowów, więc złośliwe obejście połączone ze zmianą K6 wykrywa tylko przegląd widoku Activity (K2, przy scaleniu i co tydzień); pula 2000 min Actions (szacunek 700–1150 min/mies.); `RENOVATE_TOKEN` jako sekret repozytorium byłby czytelny dla workflowu z dowolnej gałęzi (Q1 — do rozstrzygnięcia przed dodaniem sekretu).
- **Ryzyka i mitygacje:** RR-21 „GitHub Free: brak egzekwowanej ochrony `main`, środowisk i sekretów per gałąź” — 1×3 = 3 Medium po K1–K7 (w M0 faktycznie wpływ W2 — brak wdrożeń), do akceptacji Konrada (`docs/security/threat-model.md`); RR-02 wariant (a) (GitHub App z wymaganą akceptacją PR) niewykonalny bez rulesetu — powrót przy planie B.

## Plan wyjścia
Przejście na **B (Pro)**: zmiana planu konta (≈ 15,50 zł/mies.), ruleset `main` — tylko PR, wymagany check `ci-gate`, zakaz force-pushu i usuwania, historia liniowa, bez listy obejść; K6 zostaje jako dodatkowa kontrola. Koszt: ok. 1 h, bez zmian w kodzie i workflowach. Przejście na `container:` w CI: publikacja obrazu `backend-tests` w GHCR i zmiana jobu `backend` — ok. 0,5 dnia.

## Weryfikacja
- EVM-006 (dowody `manual` na demo): zielony `ci-gate` na gałęzi; czerwony przebieg przy celowo niepokrytym kodzie; ustawienia K5; e-mail o nieudanym przebiegu dociera do Konrada (także przy pushu kluczem wdrożeniowym).
- Przed scaleniem EVM-006: `BASELINE` w `main-integrity.yml` = bieżący HEAD `main` (rodzic commita EVM-006).
- Po pierwszym scaleniu: `main-integrity` zielony (push i pierwszy przebieg nocny); widok Activity pokazuje wyłącznie „Pull request merge” Konrada.
- Retrospektywa M0 i co miesiąc: liczba czerwonych `main-integrity` (cel: 0), zużycie minut Actions; przegląd warunków powrotu do planu B przed planem EVM-007.

## Źródła (zweryfikowane 2026-10-03)
- GitHub — gałęzie chronione i rulesety (repozytoria prywatne: Pro, Team, Enterprise): https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub — środowiska (sekrety środowisk i deployment branches w repo prywatnym: Pro/Team; wymagani recenzenci: Enterprise): https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub — pula minut Actions (Free: 2000 min/mies. dla repo prywatnych): https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
- GitHub REST — commity i PR (`/commits/{sha}/pulls`), przebiegi i joby Actions: https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit , https://docs.github.com/en/rest/actions/workflow-runs , https://docs.github.com/en/rest/actions/workflow-jobs
- zizmor 1.30.1 (MIT): https://github.com/zizmorcore/zizmor/releases ; actionlint 1.7.12 (MIT, 2026-03-30): https://github.com/rhysd/actionlint/releases
