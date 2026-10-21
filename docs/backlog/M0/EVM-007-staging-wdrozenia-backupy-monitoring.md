---
id: EVM-007
title: Staging w UE — IaC, VM i kanał wdrożeń (007a)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P1
path: pelna
owner: devops-engineer
contributors: []
reviewers: [security-engineer, solution-architect]
model: opus
depends_on: [EVM-006, EVM-083]
---

# EVM-007: Staging w UE — IaC, VM i kanał wdrożeń (007a)

> Podział EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md) (decyzja Konrada 2026-10-13): **007a** = ta historyjka (EVM-007), **007b** = [EVM-084](EVM-084-backupy-i-test-odtworzenia-staging.md), **007c** = [EVM-085](EVM-085-obserwowalnosc-alerty-koszty-staging.md). Ograniczenie minut Actions: [EVM-083](EVM-083-ograniczenie-minut-github-actions.md) (idzie pierwsze).

## Cel
Jako **właściciel produktu** chcę **środowiska testowego w UE, na które każda zmiana scalona przeze mnie do `main` trafia automatycznie bezpiecznym kanałem**, aby **oglądać postępy na żywo, a w GitHubie nie było żadnych poświadczeń wdrożeniowych**. Ten sam kanał posłuży później produkcji (E8).

## Kryteria akceptacji
**AC1 — Infrastruktura jako kod i VM**
- Zakładając zaakceptowane przez Konrada koszty
- Gdy `devops-engineer` uruchamia `tofu plan/apply` w sesji IaC (tokeny Hetzner i Scaleway tworzy i unieważnia Konrad, zawężone do projektów `evia-staging`, ≤ 24 h, plik poza repozytorium montowany do kontenera `iac`, którego agent nie czyta)
- Wtedy środowisko staging w UE (VM, sieć, usługi runtime: baza, Caddy, skaner antywirusowy dla uploadów — ze stałej listy obrazów po digeście) powstaje z kodu; zasoby płatne nie powstają bez tej zgody; `user-data` VM nie zawiera sekretów, kontenery nie mają dostępu do usługi metadanych; CI wykonuje tylko kontrole bez poświadczeń (`tofu fmt -check`, `tofu validate`, Trivy), a `plan/apply` nie działa w CI.

**AC2 — Publikacja hermetyczna**
- Zakładając push na `main` ze zmianą w `apps/`, `packages/`, `infra/` lub lockfile
- Gdy `ci-gate` jest zielony
- Wtedy job `publish` buduje obrazy bez żadnego cache, z obrazów bazowych po digeście i bez warstw z GHCR po tagu, wypycha je do GHCR i zapisuje artefakt `release-manifest` (commit, digesty, ścieżka Compose); `publish` nie uruchamia się na PR, gałęziach ani przy zmianie samej dokumentacji, a test w `tools/repo-policy` wykrywa cache, obraz po tagu, `download-artifact` w budowie i `packages: write` poza `publish`; retencja GHCR nie usuwa digestów z manifestów ostatnich 30 przebiegów `push` na `main`.

**AC3 — Weryfikator na VM (V0–V4, fail-closed)**
- Zakładając agenta (timer co 1–2 min) z osobnym fine-grained PAT tylko do odczytu i PAT `read:packages`
- Gdy HEAD `main` różni się od wdrożonego
- Wtedy wdrożenie następuje wyłącznie po spełnieniu V0–V4 z ADR-0018, a każde z poniższych jest odrzucone z alertem lokalnym i brakiem zmiany (testy negatywne na atrapie API GitHub): `push`/`force_push`/usunięcie lub utworzenie `main` w Activity, merge przez inne konto niż Konrad (numeryczny ID), commit bez udanego przebiegu `ci.yml` z `ci-gate` (check z gałęzi nie wystarcza), brakujący lub podrobiony `release-manifest`, obraz spoza listy lub po tagu, złośliwy Compose (m.in. `privileged`, gniazdo Dockera, `network_mode: host`, `build:`), ZIP ponad limit, wyczerpany limit API; weryfikator jest przypięty po digeście i zmieniany wyłącznie w sesji IaC.

**AC4 — Wdrożenie, migracje i rollback**
- Zakładając zweryfikowany commit X
- Gdy agent wdraża (V6)
- Wtedy kolejność to: pull po digeście → migracje jednorazowym kontenerem (rola `evia_migrator`) → start → `GET /healthz` i `/version` (commit + skrót manifestu) → przełączenie ruchu w Caddy; zmiana trafia na staging ≤ 15 min od scalenia; porażka migracji lub testu zdrowia pozostawia poprzednią wersję; migracja destrukcyjna bez oznaczenia fazy „contract” czerwieni test CI; VM trzyma lokalny rejestr wdrożeń i obrazy 3 ostatnich wdrożeń, a rollback (`rollback: true`, polecenie administratora) działa wyłącznie dla commita z rejestru; agent zapisuje lokalnie stan i metryki heartbeat (alerty — EVM-085).

**AC5 — DNS, TLS i poczta stagingu**
- Zakładając rekordy `A`/`AAAA` i CAA na węźle `staging.eviacharge.pl` ustawione ręcznie przez Konrada (kolejność wg ADR-0018)
- Gdy startuje Caddy (port 80, trwały wolumen `/data`)
- Wtedy panel i API są dostępne po HTTPS z certyfikatem wystawionym wyłącznie przez dozwolonego wystawcę, a Scaleway TEM wysyła z `powiadomienia@staging.eviacharge.pl` z przechodzącym SPF i DKIM oraz jawnym `_dmarc.staging.eviacharge.pl` (`p=none` z raportami; `p=reject` po potwierdzeniu wyrównania); domena główna i jej rekordy nie są zmieniane.

**AC6 — `staging-verify` (bramka 10)**
- Gdy wdrożenie na staging się kończy
- Wtedy job `staging-verify` (bez sekretów, ≤ 15 min) czeka, aż `GET /version` zwróci commit X i skrót manifestu, po czym sprawdza z runnera: tylko porty 80/443 (port 22 niedostępny), TLS, nagłówki, anonimowy skan ZAP baseline (bez logowania; ustalenia High/Medium spoza wyjątków = czerwony wynik), anonimowy `GET` obiektu w buckecie = `403` (kontrola dołączana, gdy bucket powstanie w EVM-084), rekordy DNS (`dig`); wynik trafia do podsumowania i artefaktu `staging-verified`; niezgodność wersji po czasie oczekiwania lub naruszenie kontroli = czerwony wynik.

**AC7 — Sekrety**
- Gdy sprawdzam repozytorium, logi CI i VM
- Wtedy lista sekretów repozytorium jest pusta (poza ewentualnym `RENOVATE_TOKEN`), sekrety aplikacji i kanału są w `/etc/evia/secrets/` (`0600` root) z kopią w Bitwarden Konrada (bez odblokowanego CLI na stacji agentów) i zestawem awaryjnym offline; potwierdzono testem, że sam `read:packages` wystarcza do pobrania prywatnego obrazu i że uprawnienie API Activity jest tylko do odczytu (w przeciwnym razie blokada i nowa rewizja ADR, nie poszerzenie tokenu).

**AC8 — Runbooki (wdrożenie, rollback, sekrety, incydent)**
- Wtedy w `docs/ops/runbooks/` są procedury: wdrożenie, rollback, rotacja sekretów i tokenów kanału (PAT ≤ 12 mies. z przypomnieniem) oraz incydent „blokada V0” (wstrzymanie, analiza, `gh cache delete --all`, przesunięcie `BASELINE` wyłącznie w sesji IaC Konrada, pierwsze wdrożenie z nowego `publish`).

## Poza zakresem
- Backupy, wersjonowanie mediów, rejestr usunięć, test odtworzenia, `docs/ops/runbooks/restore.md` — [EVM-084](EVM-084-backupy-i-test-odtworzenia-staging.md).
- Alloy/Grafana/Sentry, alerty, monitoring dostępności, koszty, wymagania z EVM-016 (AC8 dawnego EVM-007) — [EVM-085](EVM-085-obserwowalnosc-alerty-koszty-staging.md).
- Środowisko produkcyjne i E8 (EVM-061/062): V5 (zatwierdzenie Konrada, bucket zatwierdzeń, `staging-verify` jako warunek prod), pełna weryfikacja z zatwierdzeniem prod, test odtworzenia z VM prod w projekcie `evia-restore`, PAT-y prod, `prod-verify`, e-mail o wdrożeniu prod, sesja IaC prod bez agentów.
- Ograniczenie minut Actions — [EVM-083](EVM-083-ograniczenie-minut-github-actions.md) (warunek wstępny).

## Decyzje i ograniczenia
- Podział i kanał: ADR-0018, decyzje Konrada 2026-10-13 (pull z weryfikacją, IaC staging przez `devops-engineer` na tokenach Konrada, Bitwarden, PAT-y z konta Konrada).
- **Decyzja Konrada (2026-10-13), przypisania:** e-mail transakcyjny (TEM, SPF/DKIM/DMARC dla `staging.eviacharge.pl`) i DNS/TLS → tu; runtime skanera antywirusowego (ClamAV) dla EVM-044 → tu (AC1); buckety mediów i rejestru usunięć (z wersjonowaniem) → EVM-084. Obraz skanera musi mieścić się na liście V4.
- Weryfikator (V2) ma akceptować przebiegi `pull_request` (HEAD PR), nie przebiegi szybkie `push` gałęzi — zgodnie z EVM-083 AC1.
- Obrazy minimalne (np. distroless) — wybór w planie technicznym.
- **Decyzja Konrada (2026-10-13), bramki 7–8 (DAST):** w CI tylko anonimowy ZAP baseline (w `staging-verify`); skany z logowaniem (ZAP po zalogowaniu, ZAP API, Schemathesis na kontach ról) uruchamiane poza GitHubem — z VM albo z sesji Konrada — zgodnie z „zero sekretów w GitHubie” (ADR-0018). Wiersze w `docs/security/*` aktualizuje `security-engineer`. Wpływ także na E8 (bramka 8 przed wydaniem).
- Zasoby płatne wyłącznie po akceptacji kosztów; Scaleway (konto) jest warunkiem startu. Rozmiar historyjki jest na granicy (weryfikator 4–6 dni): kolejność w planie — IaC/VM/DNS → `publish` → weryfikator → wdrożenie → `staging-verify`.
- **Decyzja Konrada (2026-10-21), zakres pierwszej sesji realizacji — faza offline:** równolegle z kolejkami A (EVM-026/028) i B (EVM-009/011) startuje część bez tokenów Konrada i bez płatnych zasobów: kod OpenTofu (wyłącznie `tofu fmt -check`, `tofu validate`, Trivy), job `publish` z testami `tools/repo-policy` (AC2), weryfikator V0–V4 z testami negatywnymi na atrapie API GitHub (AC3), agent wdrożeń z migracjami i rollbackiem testowany lokalnie (AC4), kod `staging-verify` (AC6), układ sekretów i testy polityk bez VM (AC7), runbooki (AC8). Poza fazą offline, na sesję IaC z Konradem: tokeny Hetzner/Scaleway i PAT-y, `tofu plan/apply`, rekordy DNS/CAA i weryfikacja domeny TEM w OVH, pierwsze wdrożenie na VM, `staging-verify` na żywym stagingu, kopie sekretów w Bitwarden; AC1 i AC4–AC7 są w pełni weryfikowalne dopiero wtedy. Faza offline kończy się w `in-progress` (nie `in-review`); plan techniczny zawiera tabelę kosztów zasobów do akceptacji w sesji IaC (budżet ADR-0018: 300 zł/mies.) i listę kroków Konrada.

### Bezpieczeństwo i prywatność
Najmniejsze uprawnienia kont technicznych, szyfrowanie w spoczynku, brak publicznych bucketów, brak danych produkcyjnych na staging, brak sekretów w GitHubie, port 22 niedostępny z internetu. Ryzyka: RR-23 (własny weryfikator), RR-19, RR-24 (w 007c). Wymagania: SR-INFRA-01/05/13/14, SR-SUPPLY-04/05.

## Notatki
- Stan kont (2026-10-13): Hetzner — puste projekty `evia-staging`, `evia-prod`; GitHub Free (prywatne repo); brak konta Scaleway (potrzebne przed startem); domena `eviacharge.pl` (OVH, DNSSEC włączony).

### Plan techniczny (faza offline, devops-engineer 2026-10-21)
Kod: `infra/tofu/` (AC1), `infra/images/`, job `publish`, `tools/ghcr-retention/` (AC2), `services/deploy-agent/` (AC3, V0–V4), `infra/deploy-agent/`, `infra/runtime/` (AC4, AC7), job `staging-verify`, `tools/staging-verify/` (AC6), `docs/ops/runbooks/` (AC8). Opis kanału: `services/deploy-agent/README.md`, `infra/deploy-agent/README.md`.

**1. Koszty zasobów stagingu — do akceptacji Konrada w sesji IaC** (ceny netto z publicznych cenników pobranych 2026-10-21; kurs NBP tabela A z 2026-10-20: 1 EUR = 4,3716 zł; budżet ADR-0018/0011: 300 zł/mies. łącznie)

| Zasób | Typ / region | EUR/mies. | zł/mies. | Uwagi |
|---|---|---|---|---|
| VM (rekomendacja, Q1) | Hetzner CX33 (4 vCPU, 8 GB RAM, 80 GB NVMe, IPv4 w cenie), NBG1 | 8,99 | 39,30 | ClamAV trzyma sygnatury w RAM (ok. 1,5–3 GB) obok PostgreSQL i API; dostępność planu sprawdzić w konsoli |
| VM (alternatywa z ADR-0011) | Hetzner CX23 (2 vCPU, 4 GB RAM) | 5,99 | 26,19 | ryzyko braku pamięci przy ClamAV |
| Wolumen danych PostgreSQL | Hetzner Volume 10 GB (LUKS na VM) | ok. 0,57 | ok. 2,50 | 0,0572 EUR/GB wg ADR-0011 — potwierdzić w konsoli |
| Zapora, sieć prywatna, IPv6 | Hetzner | 0 | 0 | bez opłat |
| Scaleway TEM | Essential, `staging.eviacharge.pl` | 0 | 0 | 300 e-maili/mies. w progu bezpłatnym, potem 0,25 EUR / 1000 |
| Bucket stanu OpenTofu | Scaleway Object Storage `pl-waw`, < 1 MB, wersjonowany | < 0,01 | < 0,05 | potwierdzić w cenniku Object Storage |
| GHCR (obrazy prywatne) | GitHub Free | 0 | 0 | **ryzyko:** dziś bezpłatne przechowywanie i transfer w Container registry, zmiana z co najmniej miesięcznym uprzedzeniem (docs.github.com, billing GitHub Packages); retencja w trybie próbnym — bez szacunku |
| **Razem (CX33)** | | **ok. 9,57** | **ok. 41,85** | przy CX23 ok. 28,7 zł; backupy (EVM-084) i obserwowalność (EVM-085) osobno |

**2. Kroki Konrada w sesji IaC (kolejność; szczegóły: `docs/ops/runbooks/wdrozenie-staging.md`)**
1. Akceptacja tabeli kosztów (CX33 / CX23) i odpowiedzi na Q1–Q3, Q5 (planu); zgoda na reguły `deny` dla `../.evia-iac/**` w `.claude/settings.json` (Q3) — **przed** utworzeniem pliku z tokenami.
2. Scaleway: projekt `evia-staging` z MFA, klucz API aplikacji IaC tylko dla projektu, wygasanie ≤ 24 h; Hetzner: token R/W projektu `evia-staging` (usuwany po sesji).
3. Plik `../.evia-iac/staging.env` poza repozytorium (tokeny, klucz S3 backendu stanu, hasło szyfrowania stanu — także do Bitwarden), pliki `*.tfvars` (typ VM, lokalizacja, klucz publiczny SSH, `admin_ssh_cidrs` = własny adres IP), katalog `state/`.
4. Przegląd planów `tofu plan` (bootstrap, staging) przed `apply`.
5. OVH, w kolejności ADR-0018: `A`/`AAAA` `staging.eviacharge.pl` → CAA na węźle (`0 issue "letsencrypt.org"`, potem `accounturi`; `0 issuewild ";"`) → (start Caddy, certyfikat) → SPF i DKIM TEM tylko dla subdomeny → `_dmarc.staging.eviacharge.pl` `p=none` z `rua`; weryfikacja domeny w TEM. Domena główna bez zmian.
6. PAT-y z konta Konrada: fine-grained tylko to repozytorium, tylko odczyt (Actions, Contents, Pull requests, Metadata), ≤ 12 mies. z przypomnieniem; PAT classic tylko `read:packages`; przekazanie na VM przez SSH administratora; kopie w Bitwarden (bez odblokowanego CLI na stacji agentów) i zestaw awaryjny offline.
7. Potwierdzenie: lista sekretów repozytorium pusta (poza `RENOVATE_TOKEN`); `read:packages` wystarcza do pobrania; Activity działa z PAT tylko do odczytu (inaczej blokada i rewizja ADR-0018).
8. Zmienna repozytorium `STAGING_VERIFY_ENABLED=true`; scalenie pierwszego PR z kodem i obserwacja wdrożenia ≤ 15 min.
9. Zamknięcie: `apply` z pustym `admin_ssh_cidrs`, unieważnienie tokenów Hetzner i Scaleway, usunięcie `../.evia-iac/staging.env`.

**3. Co wykona agent (`devops-engineer`) w sesji IaC** — nigdy nie czyta ani nie wypisuje pliku z tokenami: `docker compose -f compose.iac.yaml run --rm iac init|plan|apply|output bootstrap|staging`; na VM: sekrety aplikacji generowane w `/etc/evia/secrets/` (hasła ról `evia_migrator`/`evia_api`, `cursor-key`, `field-encryption-keys`), instalacja `infra/runtime/*` (Caddy, PostgreSQL z rolami, ClamAV), obrazu weryfikatora z czystego `main` (przypięcie po ID w `compose.agent.yaml`), `config.json` (ID Konrada i workflowu, `baseline` z ID zdarzenia Activity), `deploy.sh`, `cycle.sh`, jednostek systemd; testy: blokada `169.254.169.254` z kontenera aplikacji i weryfikatora (po restarcie Dockera i po reboocie), pierwsze wdrożenie, rollback próbny, porażka zdrowia, `staging-verify` na żywo, sprawdzenie usuwania wersji GHCR przez `GITHUB_TOKEN` (warunek włączenia retencji); wyniki w `docs/qa/EVM-007/`. Przed pierwszym wdrożeniem — przegląd kodu weryfikatora i `deploy.sh` przez `security-engineer` (RR-23).

**4. Stan fazy offline**
- Zrobione (offline, z testami): AC1 kod IaC + `iac-check` (fmt, validate, Trivy) + polityki; AC2 `publish` (bez cache, bramka 6, GHCR, `release-manifest`), retencja w trybie próbnym, polityki; AC3 weryfikator V0–V4 z testami negatywnymi na atrapie API; AC4 `deploy.sh` (kolejność, porażki, rollback z rejestru, retencja obrazów) testowany w kontenerze Linux, test migracji destrukcyjnych, jednostki systemd; AC6 job i narzędzie `staging-verify` z testami offline; AC7 układ `/etc/evia/secrets`, `user-data` bez sekretów, testy polityk; AC8 runbooki.
- **Niezrobione — wymaga sesji IaC:** tokeny i PAT-y, `tofu plan/apply`, DNS/CAA/TEM w OVH, certyfikat TLS, pierwsze wdrożenie na VM (≤ 15 min), rollback i blokada metadanych na żywej VM, `staging-verify` na żywym stagingu, kopie w Bitwarden, test `read:packages` i uprawnień Activity, potwierdzenie usuwania wersji GHCR.
- **Niezrobione — poza rolą devops / kolejny krok:** `GET /api/version` (`getVersion`, kontrakt, macierz ról) i odczyt sekretów z plików `*_FILE` przez API i workera (`backend-developer`); test integracyjny migracji jako `evia_migrator` (Testcontainers); zapytania warunkowe ETag w weryfikatorze (dług); aktualizacje `docs/security/*` (`security-engineer`); komendy `iac-check`, `gate:deploy` w `CLAUDE.md` (orkiestrator).

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-06 — dopisano AC z EVM-016 (asercje wymagające infrastruktury), zaakceptowane przez Konrada
- 2026-10-13 — podział wg ADR-0018: treść zawężona do 007a (dawne AC1–AC3, część AC7); dawne AC4 i część AC7 → EVM-084; AC5, AC6, AC8, część AC7 → EVM-085; status ready → draft do akceptacji AC (product-owner)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
- 2026-10-21 — ready → in-progress: start fazy offline (decyzja Konrada 2026-10-21, „Faza offline teraz”) w kolejce C, gałąź feature/EVM-007-staging-iac-kanal-wdrozen (osobny klon evia-manager-c), pelna, opus; bez tokenów i bez płatnych zasobów, sesja IaC z Konradem później
- 2026-10-21 — plan gotowy (devops-engineer)
- 2026-10-21 — implementacja fazy offline (devops-engineer): IaC + `iac-check`, `publish` z bramką 6 i retencją (dry-run), weryfikator V0–V4, `deploy.sh` i pliki VM, `staging-verify`, runbooki; odstępstwa: `iac` w osobnym `compose.iac.yaml` (architekt 22), `staging-verify` z `contents: read` zamiast `{}` (checkout prywatnego repozytorium), `fflate` niepotrzebny (ZIP przez `node:zlib`), zależność `yaml` 2.9.1 w `services/deploy-agent` (parser V4, SR-SUPPLY-06), `jq` i ShellCheck z Debiana w obrazie testów `deploy-sh-tests`
