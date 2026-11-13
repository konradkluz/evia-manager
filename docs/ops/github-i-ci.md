# GitHub i CI — ustawienia, scalanie, kontrole kompensujące

> Dokument żywy (EVM-006; zmiana 2026-11-12). Właściciel: `devops-engineer`. Repozytorium `konradkluz/evia-manager` na **GitHub Free**, widoczność **publiczna** (stan z `gh repo view`, 2026-11-12) — [ADR-0016](../architecture/adr/0016-github-free-ochrona-main-kontrole-kompensujace.md). Od decyzji 2026-11-12 `main` chroni **ruleset GitHuba** (sekcja „Ruleset na `main`” niżej), który zastąpił workflow `main-integrity` (K6). Reguły rulesetu są dostępne na planie Free **tylko w repozytoriach publicznych** — po zmianie widoczności na prywatną ruleset przestaje działać (wymagałby GitHub Pro/Team), więc taka zmiana wymaga najpierw decyzji o ochronie `main`.

## CI w skrócie
| Workflow | Kiedy | Co |
|---|---|---|
| `.github/workflows/ci.yml` | **push na gałąź (nie `main`): tylko `quick`**; **pełny zestaw: `pull_request` do `main`, `push` na `main`, ręcznie** (EVM-083, ADR-0018) | `quick` (tylko push na gałąź: walidator dokumentacji → instalacja → lint → typy; **bez `ci-gate`** — job `ci-gate` jest wtedy pominięty, nigdy `success`), `changes` (pełny zestaw: wystawia `heavy`, `e2e`, `integration`, `mobile` — `tools/ci-changes`), `quality` (walidator dokumentacji — bramka 11 → instalacja z lockfile → format → lint → typy → granice modułów → testy z progami → build), `backend` (kontener `backend-tests`, licencje), `backend-integration` i `e2e-web` (każdy pomijany tylko, gdy wszystkie zmienione pliki są dla niego „nie dotyczy” — EVM-086; `e2e-web` w CI tylko Chromium), `mobile-apk` (EVM-009: niepodpisany APK Androida bez sekretów, weryfikacja gotowej paczki; pomijany tylko przy `mobile=false` — lista pozytywna w `tools/ci-changes`), `security` (sekrety, SAST, zależności, Dockerfile, workflowy, konfiguracja Renovate, samotest skanerów), `coverage` (pokrycie zmienionego kodu ≥ 90%; pomijane tylko przy zmianie samej dokumentacji, działa też bez integracji), **`ci-gate`** (tylko w pełnym przebiegu; sam ocenia wyniki: `success` wszystkich jobów, pominięcie `e2e-web` tylko przy `e2e=false`, `backend-integration` tylko przy `integration=false`, `coverage` tylko przy `heavy=false`; błąd wykrywania zmian = pełny zestaw / czerwony) |
| `.github/workflows/nightly.yml` | codziennie 02:30 UTC na `main`, ręcznie | pełne skany + samotest, `pnpm audit` jako raport; **pełne E2E panelu z Firefoksem** (`e2e-web`, 2 shardy, EVM-086) |
| `.github/workflows/renovate.yml` | poniedziałek 05:00 UTC na `main`, ręcznie | Renovate — tylko gdy zmienna repozytorium `RENOVATE_ENABLED` = `true` (patrz „Renovate”) |

**Kanał wdrożeń (EVM-007, ADR-0018).** Po zielonym `ci-gate` przebiegu `push` na `main` job **`publish`** (tylko gdy `changes` wystawi `publish=true`: zmiana `apps/`, `packages/`, `infra/`, lockfile lub innego wejścia budowy) buduje obrazy `evia-api` i `evia-web` bez żadnego cache, skanuje je razem z obrazami infrastruktury (bramka 6: Trivy, Critical/High z poprawką = czerwony, SBOM), wypycha do GHCR i zapisuje artefakt `release-manifest`; to jedyny job z `packages: write`. Potem **`staging-verify`** (bramka 10, bez sekretów; tylko przy zmiennej `STAGING_VERIFY_ENABLED=true`). Oba joby są poza `ci-gate`: ich porażka blokuje wdrożenie, nie scalenie. **`publish-infra` (EVM-124):** osobny job na natywnym runnerze `ubuntu-24.04-arm` (repozytorium publiczne, ADR-0022; bez QEMU) przy każdym `push` na `main` po zielonym `ci-gate` — buduje `evia-postgres-pgbackrest` i `evia-media-processor` dla `linux/arm64` bez cache, sprawdza platformę, skanuje oba (Trivy HIGH/CRITICAL z poprawką; procesor bez rejestru wyjątków), a dopiero potem wypycha oba do **prywatnych** pakietów GHCR, wiąże skanowany obraz z opublikowanym digestem (`Metadata.ImageID` = `config.digest` z GHCR), atestuje pochodzenie (`actions/attest-build-provenance`, przypięte po SHA) i zapisuje artefakty `infra-images-record` (obraz, digest, commit, run; osobny od `release-manifest`) oraz `infra-images-evidence` (SBOM, wyniki skanu), retencja 90 dni. Jako jedyny ma `id-token: write` i `attestations: write`; atestacja w repozytorium publicznym trafia do publicznego Sigstore/Rekor (widoczne są nazwa obrazu, digest i workflow) — to akceptowalne, bo repozytorium jest publiczne. Weryfikacja przez sesję IaC: [`runbooks/media-processor.md`](runbooks/media-processor.md). Minuty Actions: runner arm jest bezpłatny w repozytorium publicznym; czas przebiegu (szacunek 10–25 min) do zmierzenia w trzech pierwszych przebiegach i zapisania tutaj. `changes` wystawia też `iac` (krok `iac-check` w `security`, testy `deploy-sh-tests` w `backend` — tylko przy zmianie kodu IaC, skryptów VM, plików Compose albo workflowów). Procedury: [`runbooks/wdrozenie-staging.md`](runbooks/wdrozenie-staging.md), [`runbooks/incydent-blokada-v0.md`](runbooks/incydent-blokada-v0.md).

**Walidator dokumentacji (bramka 11, SR-SUPPLY-11; EVM-013).** Działa na każdym pushu jako pierwszy krok joba `quality` — krok „Documentation lifecycle validator (docs:check, bramka 11)”, zanim cokolwiek zostanie zainstalowane. Błędy polityki cyklu życia dokumentów (kod `1`) i błąd narzędzia (kod `2`) czerwienią ten krok, a przez niego `ci-gate`: pozostałe kroki `quality` się nie wykonują, job `coverage` jest pominięty, a `backend` i `security` dają własne wyniki. Ostrzeżenia („osierocony”, „przeterminowany”) nie blokują. Wynik: sekcja „Walidator dokumentacji (EVM-013)” w podsumowaniu przebiegu (Summary) — wynik, licznik, do 100 pozycji na listę; pełna lista w logu kroku. Powtórzenie lokalnie: `npm run docs:check` albo `pnpm run gate`. Zasady: `docs/process/document-lifecycle.md` → „W CI (bramka 11)”.

Te same polecenia działają lokalnie: `pnpm run gate` (od 2026-11-12 tylko część natywna: hooki, walidator dokumentacji, format, lint, typy, testy z progami pokrycia, granice modułów, pokrycie zmienionego kodu w trybie `--local`), `pnpm run gate:full` (dodatkowo kontenery: `backend-tests`, testy API z PostgreSQL, testy skryptów VM i obserwowalności; pokrycie zmienionego kodu liczone jak w CI), `pnpm run scan` (`CLAUDE.md` → „Stack i komendy”). Część kontenerową zawsze liczy też CI (`backend`, `backend-integration`, wymagane przez `ci-gate`), więc pominięcie jej lokalnie nie otwiera drogi na `main`; zmiany w `infra/`, `compose*.yaml` i skryptach VM sprawdź lokalnie `pnpm run gate:deploy` przed pushem. Agenci nie widzą wyników CI bez `gh` — wynik `ci-gate` i linki do przebiegów przekazuje Konrad albo orkiestrator przez `gh` (K4).

## Kontrole kompensujące K1–K7
| # | Kontrola | Kto | Typ |
|---|---|---|---|
| K1 | pełne CI na PR do `main` i na `main` (push na gałąź — tylko szybkie kontrole, EVM-083); jeden check `ci-gate` (w przebiegu `pull_request`, dla HEAD PR); e-mail GitHub o nieudanym przebiegu | GitHub / Konrad | wykrywająca |
| K2 | Procedura scalania (niżej) — tylko Konrad klika „Squash and merge”, przy zielonym `ci-gate`, po demo; od 2026-11-12 wymusza to ruleset (K6); co miesiąc kontrola, że ruleset jest aktywny (`gh api`, niżej „Ruleset na `main`”) | Konrad | proceduralna |
| K3 | Szablon PR z checklistą; pliki wrażliwe (`.github/**`, `.claude/**`, `compose*.yaml`, `lefthook.yml`, `infra/**` (w tym `infra/deploy-agent/**`, `infra/runtime/**`, `infra/images/**`, `infra/tofu/**`), `services/deploy-agent/**` (EVM-007), `tools/staging-verify/**` (bramka 10 na stagingu, EVM-007), pliki wyjątków skanerów, `renovate.json`, `pnpm-workspace.yaml`) wymagają jawnej uwagi — lista w podsumowaniu joba `security`; `.github/CODEOWNERS` jako dokumentacja (na Free nieegzekwowany; w rulesecie nie włączamy „Require review from Code Owners” — jedyny właściciel) | Konrad | proceduralna |
| K4 | Agenci: klucz wdrożeniowy SSH tylko do tego repozytorium (alias `github-evia-manager`), reguły `deny` w `.claude/settings.json`; w `/deliver` push wykonuje orkiestrator, nigdy agenci. Od 2026-10-03 na stacji `gh` z fine-grained PAT tylko do tego repozytorium (Pull requests RW, Actions R, Contents R, Metadata R; 30 dni; Windows keyring) — orkiestrator zakłada PR i czyta wyniki CI, **nie może scalić** (brak `Contents: write`); ocena `security-engineer` (EVM-006): 2 Low, K4 bez zmian; od 2026-10-04 reguły `deny` na wypisanie tokenu (`gh auth token`, `gh auth status --show-token` / `-t`, `gh auth git-credential`; Git Bash i PowerShell) pilnowane testem `tools/repo-policy` — `docs/security/threat-model.md` → RR-02 | Konrad / orkiestrator | zapobiegawcza, częściowa — klucz z zapisem może wypchnąć każdą gałąź, także `main` |
| K5 | Ustawienia repozytorium (checklista niżej) i Actions: zatwierdzanie workflowów z forków | Konrad | zapobiegawcza |
| K6 | **Ruleset na `main`** (decyzja 2026-11-12, zastępuje workflow `main-integrity` i `tools/main-integrity`): zakaz bezpośredniego pushu, force pushu i usunięcia `main`; scalenie wyłącznie przez PR, tylko „Squash”, z zielonym `ci-gate`; pusta lista obejść (konfiguracja: „Ruleset na `main`” niżej). Kontrola zmienia typ z wykrywającej na **zapobiegawczą**: obejście, które K6 wykrywał po fakcie (np. klucz wdrożeniowy agentów z zapisem), GitHub teraz odrzuca | GitHub / Konrad | zapobiegawcza |
| K7 | Minimum sekretów repozytorium — jedyny to przyszły `RENOVATE_TOKEN` (patrz „Renovate”), **bez wyjątków**: klucz podpisu APK nie trafia do GitHuba (EVM-009, RR-21 — podpis lokalny wg `dystrybucja-apk-android.md`); `tools/repo-policy` odrzuca `secrets.` poza `renovate.yml` | Konrad | ograniczająca |

> **Adnotacja 2026-10-13 ([ADR-0018](../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) — Zaakceptowana):** **K1 i trigger `ci.yml`: wdrożone w EVM-083 (minuty Actions); `publish` i `staging-verify` — EVM-007a.** Pełne CI na `pull_request` do `main` i `push` do `main`; push gałęzi bez PR tylko szybkie kontrole (walidator dokumentacji, lint, typy); `e2e-web` tylko na PR i `main`; zmiany wyłącznie w dokumentacji pomijają ciężkie joby przy zachowaniu `ci-gate`; nowe joby `publish` (hermetyczny, tylko `push` na `main`) i `staging-verify`. **K7 bez wyjątków:** w repozytorium nie ma i nie będzie sekretów wdrożeniowych, IaC, backupu ani testu odtworzenia — poświadczenia kanału wdrożeń leżą na VM, kopie w menedżerze haseł (Bitwarden); `RENOVATE_TOKEN` nadal zależny od Q1. Tabela „CI w skrócie” opisuje stan po EVM-083.

## Ustawienia repozytorium (K5) — checklista dla Konrada
Wykonaj po pierwszym pushu gałęzi EVM-006 i potwierdź na demo (dowód `manual`: zrzut ekranu albo potwierdzenie).
1. **Settings → General → Pull Requests:** zaznaczone **Allow squash merging**; **Allow rebase merging** odznaczone (ruleset też dopuszcza tylko „Squash”); *Default commit message* = **Pull request title and description**; odznaczone *Allow merge commits*; zaznaczone **Automatically delete head branches**.
2. **Settings → General → Features:** odznaczone **Allow forking** (jeśli opcja jest widoczna dla repozytorium prywatnego).
3. **Settings → Actions → General:** *Allow … select actions* — tylko akcje wymienione w workflowach (`actions/*`, `pnpm/action-setup`, `renovatebot/github-action`); **Require actions to be pinned to a full-length commit SHA** (jeśli dostępne na Free); *Workflow permissions* = **Read repository contents and packages permissions**; odznaczone **Allow GitHub Actions to create and approve pull requests**.
4. **Settings → Billing → Budżet Actions:** wg decyzji 2026-10-13 (EVM-083, AC6) budżet z alertami 50% i 80% i **bez** „Stop usage” — instrukcja w „Budżet Actions (AC6)” niżej. (Wcześniejszy limit 0 USD zatrzymałby CI po przekroczeniu puli.)
5. **Powiadomienia (profil → Settings → Notifications → Actions):** e-mail o nieudanych workflowach — włączony. Dowód `manual` (K1): czy e-mail o nieudanym przebiegu dociera także, gdy push wykonał klucz wdrożeniowy agentów (powiadomienia trafiają do osoby, która wyzwoliła przebieg; dla `schedule` — do ostatniego autora crona).
6. **Konto:** MFA z passkey (SR-INFRA-09); jedna osoba z dostępem administracyjnym.
7. **Code security:** alerty Dependabot włączone (bezpłatne; źródło dla Renovate). Uwaga: *secret scanning* i *push protection* w repozytorium prywatnym na Free są niedostępne — wiążącą bramką sekretów jest gitleaks w CI.

## Ruleset na `main` (K6, decyzja 2026-11-12) — konfiguracja dla Konrada (ok. 10 min)
Dlaczego: GitHub sam odrzuca push na `main` i scalenie bez zielonego `ci-gate`, więc nie trzeba wykrywać obejścia po fakcie (workflow `main-integrity` usunięty). Dostępność: rulesety działają na planie **Free tylko w repozytoriach publicznych** (dokumentacja GitHub: „Creating rulesets for a repository”, sprawdzone 2026-11-12); repozytorium jest obecnie publiczne.

**A. Settings → Rules → Rulesets → New ruleset → New branch ruleset**
1. *Ruleset Name:* `main`. **Enforcement status: Active** (nie „Evaluate”, nie „Disabled”).
2. **Bypass list: pusta** (bez roli *Repository admin*, bez Deploy keys, bez aplikacji). Konrad też ich nie omija: awaria rulesetu = świadoma zmiana ustawienia, nie obejście.
3. *Target branches:* **Add target → Include default branch** (`main`).
4. Reguły (zaznacz):
   - **Restrict deletions**
   - **Block force pushes**
   - **Require linear history** (opcjonalnie; przy samym „Squash” jest spełnione z natury — zaznacz, daje dodatkową gwarancję)
   - **Require a pull request before merging:** *Required approvals* = **0** (jedyny właściciel; GitHub nie pozwala zatwierdzić własnego PR); *Allowed merge methods* = tylko **Squash**; pozostałe opcje (dismiss stale approvals, code owners, conversation resolution) bez zaznaczania
   - **Require status checks to pass:** *Add checks* → `ci-gate` (źródło: GitHub Actions); **„Require branches to be up to date before merging” odznaczone** (przy kolejce historyjek i ok. 5 scaleniach dziennie wymuszałoby ciągłe odświeżanie PR i dodatkowe minuty Actions)
   - **Nie** zaznaczaj: *Require signed commits*, *Require deployments to succeed*, *Restrict creations/updates* (zablokowałyby `gh` i Renovate).
5. **Create**.

**B. Settings → Actions → General → „Fork pull request workflows from outside collaborators”:** wybierz **Require approval for all outside collaborators** (w nowszym interfejsie: *Require approval for all external contributors*). Workflowy z forków nie ruszą bez Twojego kliknięcia (repozytorium jest publiczne: forki są możliwe). Pozostałe pola — jak w punkcie 3 checklisty K5.

**C. Sprawdzenie (agent lub Konrad, `gh`):**
```
gh api repos/konradkluz/evia-manager/rulesets
gh api repos/konradkluz/evia-manager/rulesets/<id> --jq '{enforcement, bypass_actors, rules: [.rules[].type]}'
gh api repos/konradkluz/evia-manager/rules/branches/main --jq '[.[].type]'
```
Oczekiwane: `enforcement: "active"`, `bypass_actors: []`, typy `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` (oraz `required_linear_history`, jeśli zaznaczone); w `pull_request` `required_approving_review_count: 0` i `allowed_merge_methods: ["squash"]`; w `required_status_checks` kontekst `ci-gate` i `strict_required_status_checks_policy: false`. Test praktyczny: `git push origin HEAD:main` z gałęzi roboczej musi zakończyć się odrzuceniem („Repository rule violations”) — wykonuje Konrad, nie agent. Odczyt pełnej definicji rulesetu może wymagać uprawnienia Administration (read) tokenu; bez niego użyj widoku Settings → Rules.
Dowód `manual`: zrzut ekranu rulesetu (status Active, pusta lista obejść) i wynik odrzuconego pushu; kontrola miesięczna: `gh api …/rulesets` pokazuje ruleset `active`.

**Skutki:** orkiestrator i agenci (klucz wdrożeniowy, `gh` bez `Contents: write`) nie mogą już zmienić `main` inaczej niż przez PR scalany przez Konrada; `ci-gate` musi być zielony dla HEAD PR; scalenie inną metodą niż „Squash” jest niedostępne. Weryfikator kanału wdrożeń (V0) pozostaje drugą, niezależną warstwą (zdarzenia `push`, `force_push` itd. na `main` wstrzymują wdrożenie).

## Scalanie (D2, K2)
> **Kolejka historyjek na jednej gałęzi (EVM-087).** PR z kilkoma ID scalasz **„Squash and merge”** (jedyna dozwolona metoda w rulesecie), tytuł PR kończysz ID pierwszej historyjki (`[EVM-###]`), a ID pozostałych wpisujesz w opis PR. „Rebase and merge” i zwykły merge są wyłączone w ustawieniach i w rulesecie (decyzja 2026-11-12: po zastąpieniu K6 rulesetem nie ma już powodu do rebase merge). Orkiestrator ustawia `status: done` wszystkich historyjek PR przy scaleniu.

1. Orkiestrator wypycha gałąź `feature/EVM-###-…` (bez force) i zakłada PR przez `gh` albo podaje Konradowi tytuł PR. **Tytuł PR = pierwsza linia commita na `main`**: Conventional Commit z ID, np. `ci: add monorepo, quality gates and CI pipeline [EVM-006]`; Renovate — `chore(deps): … [renovate]`; zamknięcie kamienia milowego — `docs(milestone): close M0 [M0]`. Lekcja z PR #1: squash bez tego ustawienia dał „Feature/evm 010 backlog m1 (#1)”.
2. Konrad sprawdza: demo zaakceptowane; ruleset aktywny; check **`ci-gate` zielony w przebiegu PR (`pull_request`) dla ostatniego commita gałęzi** (szary, pominięty `ci-gate` z przebiegu `push` jest oczekiwany i nie oznacza zgody; ruleset i tak nie pozwoli scalić bez wymaganego checku); checklista z szablonu PR (pliki wrażliwe); **tytuł PR** zgodny z punktem 1.
3. Konrad klika **„Squash and merge”** (komunikat = tytuł i opis PR — K5); przy czerwonym lub brakującym `ci-gate` GitHub blokuje przycisk.
4. Po scaleniu `main` ma jeden nowy commit „squash” z tytułem PR; wpis „Direct push” albo „Force push” w widoku Activity (Insights) byłby sygnałem, że ruleset został wyłączony lub obejście istnieje → „Podejrzenie obejścia `main`”.
5. Orkiestrator lokalnie: `git fetch` + `git merge --ff-only origin/main`; historyjka `status: done`.

Każda zmiana na `main` przechodzi przez PR — także backlog, ADR i `/milestone close` (`docs/process/conventions.md` → „Git”).

## Ograniczenia rulesetu
- Ruleset działa tylko w repozytorium publicznym na planie Free (patrz wyżej); administrator repozytorium (Konrad) może go wyłączyć albo zmienić — to jedyna droga obejścia, bez śladu w `git`. Ślad zostaje w **Settings → Audit log** i w widoku Activity; miesięczna kontrola `gh api …/rulesets` wychwytuje wyłączenie.
- Ruleset nie sprawdza treści tytułu PR ani nie wymaga demo: to nadal odpowiedzialność Konrada przy scalaniu (checklista z szablonu PR).
- „Require branches to be up to date” jest świadomie wyłączone: dwa PR-y zielone osobno mogą po scaleniu być ze sobą niezgodne; wykrywa to przebieg `push` na `main` (pełne CI) i weryfikator wdrożeń V2 (wymaga zielonego `ci-gate` na wdrażanym commicie).

## Podejrzenie obejścia `main` — procedura
Wyzwalacz: wpis „Direct push” / „Force push” w Activity, ruleset nieaktywny albo zmieniony w `gh api …/rulesets`, nieznany commit na `main`, alert weryfikatora V0 ([incydent V0](runbooks/incydent-blokada-v0.md)).
1. Nie scalaj niczego nowego. Sprawdź Settings → Rules (status Active, pusta lista obejść), Settings → Deploy keys i Audit log. Nieznany push albo klucz → incydent bezpieczeństwa: unieważnij klucz wdrożeniowy i tokeny (`rotacja-sekretow.md`), zgłoś `security-engineer`.
2. Przywróć ruleset zgodnie z sekcją „Ruleset na `main`”.
3. Przywróć stan `main`: gałąź `revert/…` z `git revert <commit>` (bez przepisywania historii), PR o tytule `revert: <opis> [EVM-###]`, zielony `ci-gate`, scalenie wg „Scalanie”. Force push i przepisana historia wymagają przywrócenia historii (`security-engineer`).
4. Każdy przypadek wpisz do „Dziennika” historyjki i do retrospektywy.

## Renovate (AC8)
- Konfiguracja: `renovate.json` (grupy, przypinanie SHA akcji i digestów obrazów, karencja 3 dni, bez automerge, bez skryptów instalacyjnych, tytuły `… [renovate]`); walidacja `renovate-config-validator --strict` w `pnpm run scan` i w jobie `security`.
- **Włączenie (po scaleniu EVM-006):** sekret repozytorium `RENOVATE_TOKEN` (fine-grained PAT — `rotacja-sekretow.md`) i zmienna repozytorium `RENOVATE_ENABLED` = `true`. **Stan 2026-10-04: wstrzymane** — Konrad zdecydował nie dodawać sekretu do czasu mitygacji Q1 (`threat-model.md` → RR-21). **Najpierw** rozstrzygnięcie ryzyka Q1 (`security-engineer`): sekret repozytorium na Free jest czytelny dla workflowu uruchomionego z dowolnej gałęzi — bez mitygacji ryzyko 2×3 = 6 High.
- Pierwszy przebieg tworzy **Dependency Dashboard** (issue) — dowód `manual`. PR-y Renovate przechodzą tę samą procedurę scalania (Konrad, zielony `ci-gate`); PR z etykietą `security` — przegląd obowiązkowy.

## Minuty Actions i koszty
> Stan po EVM-083 (2026-10-13). Pula Free: **2000 min/mies.** dla repozytoriów prywatnych; cel: **≤ 1600 min/mies. (≈ 53 min/dzień, 80% puli)**. Wersja sprzed EVM-083 (szacunek 700–1150 min/mies.) była nieaktualna — rzeczywiste zużycie wg Billing: 2999 min w dniach 2026-10-01..13 (≈ 230 min/dzień, ≈ 7000 min/mies.).

### Co zmienia EVM-083
- Push na gałąź (bez PR): tylko `quick` (walidator dokumentacji, lint, typy; ok. 2 min). Pełny zestaw: `pull_request` do `main`, `push` na `main`, ręcznie. `ci-gate` istnieje wyłącznie w pełnych przebiegach; w przebiegu szybkim jest pominięty (`skipped`, nie `success`), więc weryfikator wdrożeń z ADR-0018 (V2) go nie uznaje, a wymagany check rulesetu (`ci-gate`) pochodzi z przebiegu `pull_request` (przebieg szybki `push` dla tego samego commitu go nie zastępuje). Push na `main` zawsze uruchamia pełny zestaw (także dla samej dokumentacji); pomijanie ciężkich jobów dotyczy tylko `pull_request`.
- `changes` (`tools/ci-changes`): zmiana wyłącznie w dokumentacji = wszystkie zmienione pliki leżą w `docs/` albo są plikami `*.md` w katalogu głównym. Wtedy `e2e-web`, `backend-integration` i `coverage` są pominięte; `quality` (z walidatorem dokumentacji), `backend` i `security` działają zawsze. Brak poprawnej bazy porównania, błąd `git diff`, pusta lista zmian, ręczne uruchomienie → **pełny zestaw** (fail-closed).
- `ci-gate` sam ocenia wyniki (job wymagany jako check, który jest pominięty, bywa uznany za spełniony): zielony przy `success` wszystkich jobów albo — gdy `changes` zgłosiło „nie dotyczy” — przy pominięciu dokładnie tych jobów (reguły per job: sekcja „Filtry ścieżek (EVM-086)” niżej); `failure`, `cancelled`, pominięcie przy zmianie kodu, błąd `changes` lub brak jobu = czerwony. Testy: `tools/repo-policy` (niezmienniki triggerów, trasowania jobów i program `jq` bramki na każdym przypadku) oraz `tools/ci-changes`.
- Zmiana wyzwalaczy `ci.yml` to plik wrażliwy K3 (`.github/**`) — przegląd `security-engineer` i uwaga Konrada przy scalaniu.

### Szacunek przed / po (AC5)
Założenia (dane 2026-10-01..13, 13 dni): 164 przebiegi `ci.yml` (100 push na gałąź, 64 na `main`; ≈ 4,9 scalenia dziennie), z historii `main` ok. 50% scaleń to zmiany samej dokumentacji (38 z 75 commitów); koszt jobu = minuty z Billing ÷ liczba przebiegów (rozliczane po zaokrągleniu w górę): e2e-web 8,3 · quality 3,3 · backend-integration 3,5 · security 2,2 · backend 1,9 · coverage 1,0 · ci-gate 1,0 · main-integrity 1,5 (workflow usunięty 2026-11-12) · nightly 2,6. Nowe: `changes` ≈ 1,0 min i `quick` ≈ 2,0 min na przebieg (**oszacowanie do weryfikacji na pierwszych przebiegach**). Po zmianie na jedno scalenie przypadają: 1 przebieg PR + 1 przebieg `main` (oba pełne) + push na gałąź (`quick`; przyjęto 7,7 pushy/dzień jak dotąd). Pełny przebieg z kodem ≈ 22,2 min; pełny przebieg PR samej dokumentacji ≈ 9,4 min (na `main` zawsze ≈ 22,2).

| Job | Przed: min/dzień | Po: przebiegi/dzień | Po: min/dzień |
|---|---:|---:|---:|
| e2e-web | 73,0 | 7,35 (PR z kodem + każdy `main`) | 61,0 |
| quality | 41,8 | 9,8 | 32,3 |
| backend-integration | 30,4 | 7,35 | 25,7 |
| security | 27,2 | 9,8 | 21,6 |
| backend | 24,5 | 9,8 | 18,6 |
| ci-gate | 12,5 | 9,8 | 9,8 |
| coverage | 11,1 | 7,35 | 7,4 |
| changes (nowy) | — | 9,8 | 9,8 |
| quick (nowy) | — | 7,7 | 15,4 |
| main-integrity (usunięty 2026-11-12) + nightly | 10,3 | — | 10,3 |
| **Razem** | **230,8 (≈ 7000/mies.)** | | **≈ 212 (≈ 6400/mies.)** |

**Wynik: szacunek (≈ 212 min/dzień) przekracza próg 53 min/dzień** — pominięcia dokumentacji (tylko w PR; `push` na `main` zawsze pełny, bo weryfikator V2 z ADR-0018 ufa temu przebiegowi) i ograniczenie triggera dają ok. −8%, bo większość minut to pełne przebiegi z kodem (`e2e-web`, integracja), a każde scalenie uruchamia pełny zestaw dwa razy (PR i `main`), przy ok. 5 scaleniach dziennie (4,9) (połowa to PR-y samego backlogu).

### Propozycje dalszych cięć (4 i 5 wdrożone w EVM-086; 1 jako zmiana sposobu pracy; 2, 3, 6 nie wdrożone)
| # | Propozycja | Job(y) | Oszczędność (min/dzień, szacunek) | Koszt / ryzyko |
|---|---|---|---:|---|
| 1 | Zmiany backlogu (`start`/`done` historyjki) w tym samym PR co praca, nie osobnymi PR-ami (o połowę mniej PR-ów samej dokumentacji) | wszystkie | ≈ −26 | proces; mniej atomowe PR-y |
| 2 | Push na `main` bez `e2e-web`, `backend-integration`, `coverage` (drzewo = zielony PR; weryfikuje je przebieg PR) | e2e-web, backend-integration, coverage | ≈ −32 | wymaga zmiany ADR-0018 (V2 / `publish` oczekują pełnego `main`); ryzyko: scalenie przy nieaktualnej bazie PR |
| 3 | Zmiany samej dokumentacji: dodatkowo bez `backend` i bez testów/buildu w `quality` (zostaje walidator, format, `repo-policy`) | backend, quality | ≈ −20 | `quality` przestaje być „pełne”; trzeba zmodyfikować test polityki (walidator zostaje w jobie zawsze uruchamianym) |
| 4 (**wdrożone w EVM-086**) | `e2e-web` tylko gdy zmieniono `apps/web`, `packages/*`, lockfile, `.github/**`; integracja tylko dla `apps/api`, `packages/*`, lockfile | e2e-web, backend-integration | ≈ −20 (zależy od udziału PR-ów backendowych) | filtr ścieżek w `tools/ci-changes`; pominięcie wymaga jawnej listy (fail-closed) |
| 5 (**wdrożone w EVM-086**) | `e2e-web`: Chromium na PR/`main`, Firefox tylko nocą | e2e-web | ≈ −17 | słabsze pokrycie przeglądarek w PR |
| 6 | Pozostały szacunek po 1–5 ≈ 65 min/dzień — nadal powyżej 53; dalej: GitHub Pro (3000 min; odrzucone 2026-10-13), runner na własnej VM (obecnie zabroniony przez politykę repozytorium — wymagałby osobnej decyzji bezpieczeństwa), albo przyspieszenie jobów (osobna historyjka) | — | — | koszt albo ryzyko bezpieczeństwa |

### Job `e2e-web`: dwa shardy Playwright (2026-10-15)
Zestaw E2E rośnie (≈ 840 testów, Chromium + Firefox, `retries: 1`): przebieg PR #71 trwał 15,5–16,1 min, a PR #72 przekroczył limit 20 min przy ≈ 800 z 840 testów (porażki z ponowieniem i timeouty `page.goto` w Firefoksie). Do kolejki dochodzi 7 historyjek ze specyfikacjami, więc sam wzrost do ≈ 1000 testów dałby ≈ 19–20 min bez żadnych porażek.
- Zmiana: `e2e-web` to macierz 2 shardów (`--shard=1/2`, `--shard=2/2`, `fail-fast: false`), `timeout-minutes: 20` na shard. Każdy shard ma ≈ 8–10 min testów dziś i zapas ≈ 2× na kolejne historyjki. Liczba workerów bez zmian (domyślnie połowa vCPU, czyli 2 na 4 vCPU) — więcej workerów zwiększyłoby ryzyko timeoutów Firefoksa; retries, przeglądarki i progi bez zmian.
- `ci-gate`: `needs.e2e-web.result` agreguje macierz (success tylko gdy oba shardy zielone, skipped gdy `e2e=false`), więc wymagany check i jq w `ci-gate` działają bez zmian. Nazwy checków shardów: `e2e-web (1/2)`, `e2e-web (2/2)` (nie są wymagane osobno).
- Artefakty przy porażce: `playwright-report-1`, `playwright-report-2` (7 dni).
- Koszt minut: każdy shard powtarza instalację, build i pobranie przeglądarek (≈ 3–4 min). Szacunek: ≈ 16 min → ≈ 2 × (4 + 7) ≈ 22 min na przebieg (≈ +6 min, +35% dla tego joba, ok. +17 min/dzień przy 7,35 przebiegu/dzień). Zysk: czas ścienny ≈ 11 min zamiast ≥ 20, brak przerwanych (zmarnowanych) przebiegów. To zwiększa wcześniejszy szacunek w tabeli powyżej (61 → ≈ 78 min/dzień dla `e2e-web`); decyzja o planie bez zmian (próg > 1600 min w dwóch kolejnych miesiącach). Wariant 5 (Firefox tylko nocą) wdrożony w EVM-086 — niżej.

### Potwierdzenie z Billing (poza DoD EVM-083)
Po ≥ 7 dniach od scalenia EVM-083: Settings → Billing → Actions usage — wpisz minuty/dzień z tego okresu (suma i per job) tutaj i w „Dzienniku” historyjki. Próg ponownej decyzji o planie: > 1600 min w dwóch kolejnych miesiącach (albo wyczerpanie puli).

| Okres | Minuty (łącznie) | Per job (najdroższe) | Uwagi |
|---|---:|---|---|
| 2026-10-01..13 (przed) | 2999 | e2e-web 949, quality 543, backend-integration 395 | dane Konrada |
| po EVM-083 (≥ 7 dni) | _do uzupełnienia_ | _do uzupełnienia_ | |

### Budżet Actions (AC6) — instrukcja dla Konrada
Stan 2026-10-13: brak karty i opłat, pula 2000 min przekroczona, brak budżetu. Agent nie ma uprawnień do Billing — ustawia Konrad:
1. GitHub → avatar → **Settings** (konta) → **Billing and licensing** → **Budgets and alerts** (nazwy menu mogą się różnić) → **New budget**.
2. Zakres: **konto osobiste**, produkt **Actions** (nie „All products”); kwota: np. **5 USD** (bez karty opłata i tak nie powstanie; kwota wyznacza progi alertów).
3. **Alerty e-mail: 50% i 80%** na adres Konrada (domyślne 75/90/100% — zmień na 50 i 80).
4. **Wyłącz „Stop usage when budget limit is reached”** (zostaw niezaznaczone). Powód: pula jest już przekroczona, więc blokada zatrzymałaby CI i scalanie do 2026-11-01 (odnowienie puli).
5. Zapisz i wpisz datę w „Dzienniku” EVM-083 (dowód `manual`: zrzut ekranu budżetu z alertami 50% i 80% i wyłączonym „Stop usage”).

Skutek przekroczenia: GitHub nalicza użycie ponad pulę jako płatne; bez metody płatności przebiegi mogą zostać wstrzymane lub kolejne zostać odrzucone — przy braku karty traktuj przekroczenie jako zatrzymanie CI do odnowienia puli. Alert 50% i 80% to sygnał do przeglądu propozycji z tabeli wyżej. **Ponowna decyzja o blokadzie (Stop usage): od listopada 2026** (po pierwszym pełnym miesiącu pomiaru), razem z progiem „> 1600 min w dwóch kolejnych miesiącach”.

### Filtry ścieżek i Firefox tylko w nocy (EVM-086)
Wdraża propozycje 4 i 5 (decyzja Konrada 2026-10-13, Firefox tylko w nocy: 2026-10-15). Filtr dotyczy wyłącznie `pull_request` do `main`; `push` na `main`, `workflow_dispatch`, przebieg nocny i każde inne zdarzenie zawsze uruchamiają pełny zestaw (weryfikator V2 z ADR-0018 ufa przebiegowi `main`).
- **Jawne listy „nie dotyczy”** w `tools/ci-changes/lib/classify.mjs` (`tools/ci-changes/README.md`): dla `e2e-web` — dokumentacja (`docs/**`, `*.md` w katalogu głównym), `apps/api/**`, `apps/mobile/**`; dla `backend-integration` — dokumentacja, `apps/web/**`, `apps/mobile/**`. Job jest pomijany **wyłącznie**, gdy KAŻDY zmieniony plik leży na liście „nie dotyczy” tego joba. Nigdy „nie dotyczy”: `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/**`, `tools/**`, `compose*.yaml`, konfiguracja główna, `.claude/**` i każda nieznana ścieżka (lista „nie dotyczy”, nie „dotyczy”: nowa ścieżka domyślnie uruchamia testy). `coverage` pomijane jest tylko przy zmianie samej dokumentacji; przy pominiętej integracji działa dalej (bez raportu `lcov-integration`, próg 90% dla zmienionego kodu bez zmian).
- **Fail-closed:** błąd `git diff`, brak lub niepoprawny commit bazowy, pusta lista zmian, nieznane zdarzenie, ścieżka z `..`, `\` lub znakami sterującymi → wszystkie trzy wyjścia `true`. `ci-gate` jest czerwony, gdy któreś wyjście (`heavy`, `e2e`, `integration`) jest brakujące lub inne niż `true`/`false`, gdy `heavy=false` przy innym wyjściu `true`, albo gdy job jest pominięty bez swojego jawnego „nie dotyczy” (`skipped`, `cancelled`, `failure`, brak jobu). Program `jq` (`GATE_JQ`) jest ten sam w `ci.yml` i `tools/repo-policy`; testy macierzy w `tools/repo-policy`, testy klasyfikacji w `tools/ci-changes`.
- **Firefox tylko w nocy (odstępstwo od ADR-0015 w części CI):** ADR-0015 przewiduje Chromium i Firefox na Linuksie w CI. Od EVM-086 `e2e-web` w `ci.yml` (PR i `main`) uruchamia tylko Chromium (`--project=chromium`, instalowany tylko on); pełny zestaw z Firefoksem (te same 2 shardy i `timeout-minutes`, artefakt `nightly-playwright-report-<n>` przy porażce) działa w `nightly.yml` na `main` (02:30 UTC), a porażka wysyła e-mail GitHub do Konrada jak dla skanów. `apps/web/playwright.config.ts` zachowuje oba projekty (lokalnie i w nocy). Ryzyko: błąd tylko-Firefox wychodzi najpóźniej następnej nocy, już po scaleniu; lokalnie Firefox w `web-e2e-linux` pozostaje opcjonalny (`--project=firefox`).
- **Szacunek „po EVM-086”** (metoda z EVM-083 AC5: przebiegi/dzień × minuty per job). Punkt wyjścia: 9,8 przebiegu `ci.yml`/dzień (4,9 PR + 4,9 `main`), z czego PR z kodem 2,45/dzień (połowa PR-ów to sama dokumentacja). Założony udział PR-ów z kodem: 35% tylko web (integracja pominięta), 35% tylko api (E2E pominięte), 30% mieszane/pakiety/narzędzia/`.github` (oba joby). Skutek: `e2e-web` 7,35 → 6,49 przebiegu (−0,86), `backend-integration` 7,35 → 6,49. Koszt `e2e-web` na przebieg: dziś 2 × (4 + 7) ≈ 22 min wall-clock, rozliczone ≈ 10,6 min (78 min/dzień ÷ 7,35); Chromium only: 2 × (3,5 + 3,5) ≈ 14 min → ≈ 6,8 min rozliczonych. Nowe: nocny pełny `e2e-web` ≈ 1 przebieg/dzień × ≈ 22 min.

| Job | Po EVM-083 + shardy: min/dzień | Po EVM-086: przebiegi/dzień | Po EVM-086: min/dzień |
|---|---:|---:|---:|
| e2e-web (ci.yml, Chromium) | 78,0 | 6,49 | 44,1 |
| e2e-web pełny (nightly.yml, Chromium + Firefox) | — | 1 | 22,0 |
| backend-integration | 25,7 | 6,49 | 22,7 |
| pozostałe (quality, security, backend, ci-gate, coverage, changes, quick, nightly; main-integrity usunięty 2026-11-12) | 125,0 | bez zmian | 125,0 |
| **Razem** | **≈ 229 (≈ 6900/mies.)** | | **≈ 214 (≈ 6400/mies.)** |

**Wynik: ≈ −15 min/dzień (≈ −7%); cel 53 min/dzień nadal poza zasięgiem.** Firefox w nocy zwraca większość oszczędności z Chromium-only (22 min/dzień), a udział PR-ów dotykających tylko web lub tylko api jest założony — kolejki zależnych historyjek na jednej gałęzi (EVM-087) zmniejszają liczbę PR-ów, więc realna oszczędność może być mniejsza. Dźwignie, które zostają: propozycje 2, 3 i 6 oraz opcja „nocą tylko Firefox” (−8 min/dzień, wymaga zmiany AC5). Pomiar po ≥ 7 dniach w „Potwierdzenie z Billing”.

## E2E web na Linuksie przed pushem (EVM-087)
Błędy tylko-CI (metryki czcionek Linuksa, układ tabel) wychodziły dopiero po pushu. Dla zmian w `apps/web` i `packages/*` (nie dla samej dokumentacji ani `apps/api`) wykonawca uruchamia przed pushem:
```
docker compose -f compose.yaml run --rm backend-install      # po zmianie pnpm-lock.yaml (wspólny wolumen bt-work)
docker compose -f compose.yaml run --rm web-e2e-linux
```
- Usługa `web-e2e-linux` (`infra/docker/web-e2e/Dockerfile`: obraz `mcr.microsoft.com/playwright:v<wersja>-noble` z Node.js 26) uruchamia `pnpm run e2e:linux` — te same testy Playwright co job `e2e-web`, w tych samych przeglądarkach (Chromium i Firefox z `apps/web/playwright.config.ts`), przeciw `vite preview` w kontenerze, z `CI=1` (retry, `forbidOnly`). Jeden dowolny test: `… run --rm web-e2e-linux pnpm --filter @evia/web exec playwright test <plik> --project=chromium`.
- Utwardzenie jak pozostałe usługi (`tools/repo-policy`): obraz tag + digest, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, użytkownik 1000, sieć `internal` bez wyjścia na zewnątrz (potrzebny interfejs, inaczej przeglądarka zgłasza `navigator.onLine=false` i panel pokazuje tryb offline), bez portów, sekretów, `env_file` i gniazda Dockera; kod `:ro`, zapis tylko w wolumenie `bt-work`; `shm_size: 1gb` zamiast `--ipc=host`.
- **Różnice względem CI:** (0) od EVM-086 CI (PR i `main`) uruchamia tylko Chromium, a Firefox tylko w `nightly.yml` — lokalnie Firefox jest opcjonalny (`--project=firefox`), pełny przebieg usługi obejmuje oba projekty z `playwright.config.ts`; (1) CI uruchamia 2 shardy na runnerze Ubuntu, lokalnie jeden przebieg całości (dłużej: dziesiąt min); (2) CI instaluje przeglądarki `playwright install` w wersji z lockfile, lokalnie są to przeglądarki obrazu Playwright tej samej wersji; (3) czcionki i renderowanie kontenera Noble bliskie runnerowi `ubuntu-24.04`, ale nie identyczne — rozbieżność wyjaśniamy, nie pomijamy; (4) bez WebKit i bez Edge; (5) Firefox bywa wolny na jednej maszynie z innymi zadaniami (`page.goto` > 30 s — ta sama klasa niestabilności co w CI, łagodzona przez `retries: 1`). Pierwszy pełny przebieg (2026-10-15, jeden przebieg całości, bez równoległych zadań, ok. 13 min): 931 testów zielonych, 14 niestabilnych (Firefox `page.goto`, zielone po ponowieniu) i 1 czerwony Firefox z tej samej klasy; Chromium bez porażek. Podejrzaną porażkę sprawdź pojedynczo: `… run --rm web-e2e-linux pnpm --filter @evia/web exec playwright test <plik> --project=firefox`.
- Natywny Playwright na Windows (`pnpm run e2e`, przeglądarki biura, Edge) pozostaje dowodem lokalnym wg ADR-0015; usługa Linux jest dodatkiem przed pushem.

## Przegląd dostępów (SR-INFRA-09) — co kwartał
- Konta z dostępem do repozytorium (Settings → Collaborators): wyłącznie Konrad.
- Klucze wdrożeniowe (Settings → Deploy keys): wyłącznie klucz agentów (`evia_manager`), z datą ostatniego użycia; nieużywane — usuń.
- Tokeny fine-grained (profil → Developer settings): `gh` (orkiestrator) i `RENOVATE_TOKEN` — zakres i data wygaśnięcia zgodne z `rotacja-sekretow.md`.
- Ruleset `main` aktywny, lista obejść pusta (`gh api repos/konradkluz/evia-manager/rulesets`; miesięcznie).
- MFA (passkey) aktywne; sekrety i zmienne repozytorium: tylko `RENOVATE_TOKEN` / `RENOVATE_ENABLED`.
- *Adnotacja 2026-10-13 ([ADR-0018](../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md)):* od EVM-007a przegląd obejmuje też tokeny kanału wdrożeń trzymane na VM (fine-grained PAT tylko do odczytu i PAT classic `read:packages`, osobno staging i prod) — zakres i data wygaśnięcia (≤ 12 mies.); lista sekretów repozytorium ma pozostać pusta poza ewentualnym `RENOVATE_TOKEN`.
