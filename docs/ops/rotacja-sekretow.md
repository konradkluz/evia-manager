# Rotacja sekretów — GitHub i wykryte sekrety

> Dokument żywy (EVM-006). Właściciel: `devops-engineer`; wykonuje Konrad. Zasady: `docs/security/README.md` i ADR-0015 (sekrety usług zewnętrznych **nigdy w katalogu repozytorium** — menedżer sekretów albo `%USERPROFILE%\.evia\`). Sekrety wdrożeniowe i produkcyjne — EVM-007.

## Zasada nadrzędna
**Sekret, który trafił do commita, gałęzi zdalnej, logu CI albo kontekstu agenta, jest skompromitowany** — unieważnij go od razu i wydaj nowy. Przepisanie historii git nie przywraca poufności (kopie, forki, cache, logi) i nie zastępuje unieważnienia. Wyjątek w `.gitleaksignore` jest dozwolony wyłącznie dla fałszywego alarmu, nigdy dla prawdziwego sekretu.

## Wykryty sekret (gitleaks w hooku lub CI)
1. Hook `pre-commit` / `pre-push` odrzucił zmianę: usuń sekret z plików i indeksu, przenieś go poza repozytorium; jeśli kiedykolwiek był w commicie wypchniętym na GitHub — kroki 2–4.
2. Unieważnij sekret u dostawcy (GitHub, Expo, Scaleway, …) i wydaj nowy; zapisz go tylko w menedżerze sekretów / sekretach GitHub.
3. Sprawdź użycie sekretu w okresie ekspozycji (logi dostawcy, Activity repozytorium); zgłoś `security-engineer` (incydent; RODO — jeśli dotyczy danych osobowych).
4. Wpis w historyjce („Dziennik”) i w retrospektywie; fałszywy alarm — fingerprint w `.gitleaksignore` z komentarzem `# reason: … · owner: … · review_by: YYYY-MM-DD` (≤ 90 dni).

## Inwentarz sekretów GitHub (EVM-006)
| Sekret | Gdzie | Zakres | Ważność / rotacja | Kto używa |
|---|---|---|---|---|
| `RENOVATE_TOKEN` (fine-grained PAT) | sekret repozytorium — **dodawany dopiero po rozstrzygnięciu Q1** (`github-i-ci.md` → „Renovate”) | tylko `konradkluz/evia-manager`: Contents RW, Pull requests RW, Workflows RW, Issues RW, Dependabot alerts R, Metadata R (D5) | 90 dni; przypomnienie w kalendarzu Konrada | workflow `renovate.yml` (wyłącznie env kroku Renovate) |
| PAT `gh` orkiestratora (fine-grained) | Windows keyring stacji (`gh auth`) — nigdy w repozytorium | tylko to repozytorium: Pull requests RW, Actions R, Contents R, Metadata R — **bez Contents write** (nie scali PR) | 30 dni; przypomnienie w kalendarzu Konrada | orkiestrator: zakładanie PR, odczyt wyników CI |
| Klucz wdrożeniowy agentów (SSH) | `~/.ssh/evia_manager` (alias `github-evia-manager`), poza repozytorium | zapis do tego repozytorium (wypycha gałęzie) | przy incydencie, odejściu osoby z dostępem do stacji albo co 12 miesięcy | orkiestrator (push gałęzi za zgodą Konrada) |

## Procedury
**Utworzenie / rotacja `RENOVATE_TOKEN`**
1. GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: Resource owner `konradkluz`, *Only select repositories* = `evia-manager`, uprawnienia z tabeli, wygaśnięcie 90 dni.
2. Repozytorium → Settings → Secrets and variables → Actions → *New repository secret* `RENOVATE_TOKEN`; zmienna `RENOVATE_ENABLED` = `true`.
3. Uruchom `renovate` ręcznie (Actions → renovate → Run workflow na `main`); sprawdź Dependency Dashboard.
4. Unieważnij poprzedni token (rotacja) i zapisz datę następnej rotacji.

**Utworzenie / rotacja PAT `gh`** (Konrad): GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: Resource owner `konradkluz`, *Only select repositories* = `evia-manager`, uprawnienia z tabeli, wygaśnięcie 30 dni → `gh auth login --with-token` (token wklejany z menedżera haseł, bez zapisu w plikach) → `gh auth status` bez `--show-token` (token w `keyring`, nie w pliku) → unieważnienie poprzedniego tokenu i data następnej rotacji. Token wypisany w sesji agenta (`gh auth token`, `gh auth status --show-token` / `-t`) jest skompromitowany (zasada nadrzędna) — unieważnij go i wydaj nowy (ocena: `docs/security/threat-model.md` → RR-02).

**Unieważnienie przy incydencie** (dowolny z powyższych): usuń token / klucz (Developer settings albo Settings → Deploy keys) **natychmiast**, potem procedura „Czerwony `main`” w `github-i-ci.md`, jeśli doszło do zmian w repozytorium.
