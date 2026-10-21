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

## Klucz kursorów paginacji `CURSOR_KEY` (EVM-017, EVM-080)
- **Co to jest:** sekret serwera, którym API szyfruje i uwierzytelnia kursory list (zlecenia, klienci, dziennik zlecenia, dziennik audytu). Nowy klucz generuje się zgodnie z instrukcją w `.env.example`; wartość nie trafia do repozytorium, logów ani zgłoszeń. Wdrożenie sekretu w środowiskach — EVM-084.
- **Kto go wymaga:** serwer API, worker i polecenia CLI — tak (bez poprawnego klucza nie wystartują; błąd konfiguracji wymienia tylko nazwę `CURSOR_KEY`); `db:migrate` — nie. Tabela poleceń: `apps/api/README.md` → „Konfiguracja”.
- **Rotacja:** podmiana klucza i restart procesów API (oraz workera i CLI przy następnym uruchomieniu) **unieważnia wszystkie wydane kursory** — klient dostaje `400 invalid_cursor`, panel pokazuje komunikat o odświeżeniu listy i wraca na pierwszą stronę. Nie ma migracji danych; kursory żyją najwyżej 30 minut, więc skutek znika sam. Rotuj przy podejrzeniu wycieku albo odejściu osoby z dostępem do sekretów środowiska.

## Klucz liczników prób logowania `LOGIN_THROTTLE_KEY` (EVM-026)
- **Co to jest:** sekret serwera, pod którym API liczy HMAC-SHA-256 znormalizowanego e-maila i identyfikatora przeglądarki — klucze liczników ochrony przed zgadywaniem haseł (`identity.login_throttle`). Dzięki niemu w bazie nie ma e-maila ani zwykłego skrótu e-maila. Wartość nie trafia do repozytorium, logów ani zgłoszeń.
- **Kto go wymaga:** serwer API i worker w produkcji — tak (brak, zaślepka, mniej niż 32 bajty albo równość z `CURSOR_KEY` / kluczem `FIELD_ENCRYPTION_KEYS` = błąd startu, w komunikacie tylko nazwa zmiennej); `db:migrate` — nie. Poza produkcją pusty = losowy klucz procesu (liczniki z poprzedniego procesu nie są wtedy odnajdywane — wygodne w dev, niedopuszczalne na serwerze). API i worker w produkcji muszą dostać **tę samą** wartość (worker kasuje liczniki przeglądarek).
- **Generowanie:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (polecenie z `.env.example`).
- **Rotacja:** zmiana klucza **zeruje liczniki i blokady w toku** (nowe klucze HMAC nie odnajdują starych wierszy; stare znikają po `expires_at`, najwyżej ~45 minut) — brak migracji danych, nikt nie traci dostępu, ale napastnik dostaje świeży budżet na okres jednego okna. Rotuj przy podejrzeniu wycieku albo odejściu osoby z dostępem do sekretów, najlepiej poza godzinami pracy; zmiana klucza nie unieważnia ciasteczek przeglądarek (kluczem jest identyfikator wiersza, nie ciasteczko).
- **Inwentarz i kopia (SR-CRYPTO-04):** wpis do inwentarza kluczy i kopii w menedżerze haseł; utrata klucza nie niszczy danych (wystarczy wygenerować nowy — jak przy rotacji).
- **Wdrożenie:** sekret do przekazania zespołowi wdrożeń (`devops-engineer`): CI/staging/produkcja (EVM-007, EVM-084) — bez niego produkcja nie wystartuje; timeouty proxy i Node muszą być większe niż 10 s opóźnienia plus weryfikacja Argon2id.

## Klucze szyfrowania pól `FIELD_ENCRYPTION_KEYS` (EVM-023)
- **Co to jest:** lista kluczy głównych (KEK) szyfrowania kopertowego pól bazy — obecnie sekret TOTP (`identity.totp_factors`; AES-256-GCM, SR-CRYPTO-02). Format `id:klucz` (32 bajty w base64url), rozdzielane przecinkami; pierwszy klucz szyfruje, wszystkie odszyfrowują. Wartość nie trafia do repozytorium, logów ani zgłoszeń.
- **Kto go wymaga:** serwer API w produkcji — tak (brak, zaślepka, zła długość albo powtórzone id = błąd startu, w komunikacie tylko nazwa zmiennej); worker i `db:migrate` — nie. Poza produkcją pusty klucz wyłącza konfigurację kodu z aplikacji (`503`). Klucz musi być inny niż `CURSOR_KEY`.
- **Generowanie:** `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64url'))"` (polecenie z `.env.example`); nowe id przy każdej generacji (`k2`, `k3`, …).
- **Inwentarz i kopia (SR-CRYPTO-04):** klucz wpisz do inwentarza kluczy (kto, kiedy, gdzie przechowywany) oraz do kopii w menedżerze haseł i zestawu offline (EVM-007). **Utrata klucza = utrata TOTP wszystkich użytkowników** (sekretów nie da się odszyfrować; użytkownik musi skonfigurować drugi krok od nowa po resecie przez administratora).
- **Rotacja (M1):** dodaj nowy klucz na początek listy, stary zostaw — nowe sekrety są szyfrowane nowym kluczem, stare nadal się odszyfrowują. **Starego klucza nie usuwaj**: w M1 nie ma narzędzia do ponownego opakowania istniejących wierszy pod nowym kluczem, więc nie da się wykazać, że żaden wiersz go nie używa. Świadoma decyzja (EVM-023): rotacja z usunięciem starego klucza (narzędzie re-wrap + licznik wierszy na klucz) czeka na osobną historyjkę; przy podejrzeniu wycieku klucza wymuś ponowną konfigurację drugiego kroku (EVM-028) i dopiero wtedy usuń klucz.
- **Wdrożenie:** sekret do przekazania zespołowi wdrożeń (`devops-engineer`): CI/staging/produkcja (EVM-007, EVM-084) — bez niego produkcja nie wystartuje.
