# GitHub i CI — ustawienia, scalanie, kontrole kompensujące

> Dokument żywy (EVM-006). Właściciel: `devops-engineer`. Decyzja: repozytorium prywatne `konradkluz/evia-manager` na **GitHub Free** — [ADR-0016](../architecture/adr/0016-github-free-ochrona-main-kontrole-kompensujace.md) (Proponowana). Na Free GitHub **nie blokuje** bezpośredniego pushu na `main` ani scalenia przy czerwonym CI — zastępują to kontrole K1–K7 (wykrycie zamiast blokady).

## CI w skrócie
| Workflow | Kiedy | Co |
|---|---|---|
| `.github/workflows/ci.yml` | każdy push każdej gałęzi, ręcznie | `quality` (instalacja z lockfile → format → lint → typy → granice modułów → testy z progami → build), `backend` (kontener `backend-tests`, licencje), `security` (sekrety, SAST, zależności, Dockerfile, workflowy, konfiguracja Renovate, samotest skanerów), `coverage` (pokrycie zmienionego kodu ≥ 90%), **`ci-gate`** (zielony tylko, gdy wszystkie powyższe mają `success`), `main-integrity` (tylko `main`, K6) |
| `.github/workflows/nightly.yml` | codziennie 02:30 UTC na `main`, ręcznie | pełne skany + samotest, `pnpm audit` jako raport |
| `.github/workflows/renovate.yml` | poniedziałek 05:00 UTC na `main`, ręcznie | Renovate — tylko gdy zmienna repozytorium `RENOVATE_ENABLED` = `true` (patrz „Renovate”) |

Te same polecenia działają lokalnie: `pnpm run gate`, `pnpm run scan` (`CLAUDE.md` → „Stack i komendy”). Agenci nie widzą wyników CI bez `gh` — wynik `ci-gate` i linki do przebiegów przekazuje Konrad albo orkiestrator przez `gh` (K4).

## Kontrole kompensujące K1–K7
| # | Kontrola | Kto | Typ |
|---|---|---|---|
| K1 | CI na każdym pushu; jeden check `ci-gate`; e-mail GitHub o nieudanym przebiegu | GitHub / Konrad | wykrywająca |
| K2 | Procedura scalania (niżej) — tylko Konrad klika „Squash and merge”, przy zielonym `ci-gate`, po demo; przegląd widoku Activity po scaleniu | Konrad | proceduralna |
| K3 | Szablon PR z checklistą; pliki wrażliwe (`.github/**`, `.claude/**`, `compose*.yaml`, `lefthook.yml`, `infra/**`, pliki wyjątków skanerów, `renovate.json`, `pnpm-workspace.yaml`) wymagają jawnej uwagi — lista w podsumowaniu joba `security`; `.github/CODEOWNERS` jako dokumentacja (na Free nieegzekwowany) | Konrad | proceduralna |
| K4 | Agenci: klucz wdrożeniowy SSH tylko do tego repozytorium (alias `github-evia-manager`), reguły `deny` w `.claude/settings.json`; w `/deliver` push wykonuje orkiestrator, nigdy agenci. Od 2026-10-03 na stacji `gh` z fine-grained PAT tylko do tego repozytorium (Pull requests RW, Actions R, Contents R, Metadata R; 30 dni; Windows keyring) — orkiestrator zakłada PR i czyta wyniki CI, **nie może scalić** (brak `Contents: write`); ocena `security-engineer` w EVM-006 | Konrad / orkiestrator | zapobiegawcza, częściowa — klucz z zapisem może wypchnąć każdą gałąź, także `main` |
| K5 | Ustawienia repozytorium (checklista niżej) | Konrad | zapobiegawcza |
| K6 | Job `main-integrity` po każdym pushu na `main` (`tools/main-integrity/README.md`): każdy commit ze scalonego PR, scalił Konrad, zielony `ci-gate` HEAD PR, bez force pushu, tytuł z `[EVM-###]` / `[renovate]` / `[M#]` | CI | wykrywająca |
| K7 | Minimum sekretów repozytorium — w EVM-006 jedynie przyszły `RENOVATE_TOKEN` (patrz „Renovate”) | Konrad | ograniczająca |

## Ustawienia repozytorium (K5) — checklista dla Konrada
Wykonaj po pierwszym pushu gałęzi EVM-006 i potwierdź na demo (dowód `manual`: zrzut ekranu albo potwierdzenie).
1. **Settings → General → Pull Requests:** zaznaczone wyłącznie **Allow squash merging**; *Default commit message* = **Pull request title and description**; odznaczone *Allow merge commits* i *Allow rebase merging*; zaznaczone **Automatically delete head branches**.
2. **Settings → General → Features:** odznaczone **Allow forking** (jeśli opcja jest widoczna dla repozytorium prywatnego).
3. **Settings → Actions → General:** *Allow … select actions* — tylko akcje wymienione w workflowach (`actions/*`, `pnpm/action-setup`, `renovatebot/github-action`); **Require actions to be pinned to a full-length commit SHA** (jeśli dostępne na Free); *Workflow permissions* = **Read repository contents and packages permissions**; odznaczone **Allow GitHub Actions to create and approve pull requests**.
4. **Settings → Billing / Actions:** limit wydatków (spending limit) Actions = **0 USD** — po wyczerpaniu puli 2000 min joby stają, bez opłat.
5. **Powiadomienia (profil → Settings → Notifications → Actions):** e-mail o nieudanych workflowach — włączony. Dowód `manual` (K1): czy e-mail o nieudanym przebiegu dociera także, gdy push wykonał klucz wdrożeniowy agentów (powiadomienia trafiają do osoby, która wyzwoliła przebieg; dla `schedule` — do ostatniego autora crona).
6. **Konto:** MFA z passkey (SR-INFRA-09); jedna osoba z dostępem administracyjnym.
7. **Code security:** alerty Dependabot włączone (bezpłatne; źródło dla Renovate). Uwaga: *secret scanning* i *push protection* w repozytorium prywatnym na Free są niedostępne — wiążącą bramką sekretów jest gitleaks w CI.

## Scalanie (D2, K2)
1. Orkiestrator wypycha gałąź `feature/EVM-###-…` (bez force) i zakłada PR przez `gh` albo podaje Konradowi tytuł PR. **Tytuł PR = pierwsza linia commita na `main`**: Conventional Commit z ID, np. `ci: add monorepo, quality gates and CI pipeline [EVM-006]`; Renovate — `chore(deps): … [renovate]`; zamknięcie kamienia milowego — `docs(milestone): close M0 [M0]`. Lekcja z PR #1: squash bez tego ustawienia dał „Feature/evm 010 backlog m1 (#1)”.
2. Konrad sprawdza: demo zaakceptowane; check **`ci-gate` zielony dla ostatniego commita gałęzi**; checklista z szablonu PR (pliki wrażliwe); **tytuł PR** zgodny z punktem 1.
3. Konrad klika **„Squash and merge”** (komunikat = tytuł i opis PR — K5).
4. Konrad otwiera widok **Activity** repozytorium (Insights / „Activity” dla gałęzi `main`, jeśli dostępny na Free): dla `main` widnieją wyłącznie wpisy **„Pull request merge”** wykonane przez Konrada. Każdy **„Direct push”** albo **„Force push”** = incydent → „Czerwony `main`”.
5. Job `main-integrity` dla nowego commita na `main` jest zielony (e-mail przy czerwonym).
6. Orkiestrator lokalnie: `git fetch` + `git merge --ff-only origin/main`; historyjka `status: done`.

Każda zmiana na `main` przechodzi przez PR — także backlog, ADR i `/milestone close` (`docs/process/conventions.md` → „Git”).

## Czerwony `main` (K6) — procedura
1. Nie scalaj niczego nowego. Odczytaj z logu `main-integrity` commit(y) i powód (bez PR, scalił ktoś inny, czerwony `ci-gate`, force push, zły tytuł).
2. Sprawdź widok Activity i listę kluczy wdrożeniowych (Settings → Deploy keys). Nieznany push albo klucz → potraktuj jako incydent bezpieczeństwa: unieważnij klucz wdrożeniowy i tokeny (`rotacja-sekretow.md`), zgłoś `security-engineer`.
3. Przywróć stan: gałąź `revert/…` z `git revert <commit>` (bez przepisywania historii), PR o tytule `revert: <opis> [EVM-###]`, zielony `ci-gate`, scalenie wg „Scalanie”.
4. Sam zły tytuł commita przy poprawnym PR i zielonym `ci-gate`: zapis w historyjce i retrospektywie; revert nie jest wymagany (decyzja Konrada).
5. Każdy przypadek wpisz do „Dziennika” historyjki i do retrospektywy — to warunek powrotu do planu płatnego (ADR-0016).

## Renovate (AC8)
- Konfiguracja: `renovate.json` (grupy, przypinanie SHA akcji i digestów obrazów, karencja 3 dni, bez automerge, bez skryptów instalacyjnych, tytuły `… [renovate]`); walidacja `renovate-config-validator --strict` w `pnpm run scan` i w jobie `security`.
- **Włączenie (po scaleniu EVM-006):** sekret repozytorium `RENOVATE_TOKEN` (fine-grained PAT — `rotacja-sekretow.md`) i zmienna repozytorium `RENOVATE_ENABLED` = `true`. **Najpierw** rozstrzygnięcie ryzyka Q1 (`security-engineer`): sekret repozytorium na Free jest czytelny dla workflowu uruchomionego z dowolnej gałęzi — bez mitygacji ryzyko 2×3 = 6 High.
- Pierwszy przebieg tworzy **Dependency Dashboard** (issue) — dowód `manual`. PR-y Renovate przechodzą tę samą procedurę scalania (Konrad, zielony `ci-gate`); PR z etykietą `security` — przegląd obowiązkowy.

## Minuty Actions i koszty
- Pula Free: 2000 min/mies. dla repozytoriów prywatnych; szacunek 700–1150 min/mies. (przebieg `ci.yml` ok. 12–14 min sumy jobów; nightly ok. 150 min/mies.; Renovate ok. 150 min/mies.).
- Konrad raz w miesiącu: Settings → Billing → Actions usage. Powyżej ok. 1500 min/mies. — propozycja z „Uwag do rozważenia” EVM-006 (pomijanie ciężkich jobów przy zmianach wyłącznie w dokumentacji).

## Przegląd dostępów (SR-INFRA-09) — co kwartał
- Konta z dostępem do repozytorium (Settings → Collaborators): wyłącznie Konrad.
- Klucze wdrożeniowe (Settings → Deploy keys): wyłącznie klucz agentów (`evia_manager`), z datą ostatniego użycia; nieużywane — usuń.
- Tokeny fine-grained (profil → Developer settings): `gh` (orkiestrator) i `RENOVATE_TOKEN` — zakres i data wygaśnięcia zgodne z `rotacja-sekretow.md`.
- MFA (passkey) aktywne; sekrety i zmienne repozytorium: tylko `RENOVATE_TOKEN` / `RENOVATE_ENABLED`.
