# ADR-0018: Wdrożenia staging i prod na GitHub Free — pull z weryfikacją na VM, zero sekretów w GitHubie, IaC i test odtworzenia poza CI

- **Status:** Zaakceptowana (Konrad, 2026-10-13 — rewizja 3; przeglądy: `security-engineer` APPROVE z warunkami n1–n5 (wprowadzone), `devops-engineer` APPROVE z warunkami)
- **Data:** 2026-10-13
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (przeglądy: security-engineer, devops-engineer)
- **Powiązane:** EVM-007 (podział na 007a/b/c — [Etapy](#etapy-wdrożenia-decyzji)), E8 (EVM-061, EVM-062); ADR-0011 (częściowo zmienia — IaC z CI, test odtworzenia z CI, współdzielenie narzędzi obserwowalności), ADR-0012 (częściowo zastępuje — akapit „Wdrożenia”), ADR-0013, ADR-0016 (warunek powrotu 3, „Ograniczenie dla EVM-007”, K1 — trigger CI); SR-INFRA-01, -03, -05, -07, -08, -09, -13, -14, SR-COMM-05, SR-CRYPTO-04, SR-LOG-07, SR-SUPPLY-04, -05; RR-02, RR-06, RR-11, RR-19, RR-20, RR-21; `docs/backlog/M1/README.md` → „Decyzje dla Konrada” pkt 5

## Kontekst i problem
ADR-0016 przyjął **GitHub Free** (repozytorium prywatne) i wymaga osobnego ADR o mechanizmie wdrożeń przed planem EVM-007. Na Free w repozytorium prywatnym nie ma sekretów środowisk, ograniczenia gałęzi wdrożeń ani rulesetów: **każdy sekret jest sekretem repozytorium, który odczyta workflow z dowolnej gałęzi** — także wypchniętej kluczem wdrożeniowym agentów (RR-21). Workflow z gałęzi może też podnieść uprawnienia `GITHUB_TOKEN` (`contents: write`, `packages: write`, `actions: write`, `checks: write`, `statuses: write`): wypchnąć commit na `main` i cofnąć go force pushem, wypchnąć obraz do GHCR, wyzwolić `workflow_dispatch` na `main` (zapis cache Actions w zakresie `main`) i utworzyć check o dowolnej nazwie. Dlatego SR-INFRA-13, SR-INFRA-14, RR-20 i założenie ADR-0011 „IaC z CI” są na Free niewykonalne. Sekrety prod w repozytorium = P2 × W3 = 6 High, blocker sign-off (M1 README pkt 5).

Ustalenia Konrada (2026-10-13): staging przed prod (staging automatycznie z `main` — AC2 EVM-007, prod po zatwierdzeniu digestu przez Konrada); konta: Hetzner (`evia-staging`, `evia-prod` — puste), Scaleway (`evia-staging` — pusty, MFA), **Grafana Cloud Free — jeden stos w UE**, **Sentry (UE, Developer) — jedna organizacja**, domena `eviacharge.pl` w OVH (`staging.eviacharge.pl` — panel i API, nadawca `powiadomienia@staging.eviacharge.pl`); budżet infrastruktury ok. 300 zł/mies. Stan DNS (publiczny, 2026-10-13): strefa i poczta w OVH, DMARC domeny głównej `p=none`, SPF domeny głównej z `include:resend.com`, DNSSEC i blokada transferu włączone, brak CAA.

## Kryteria decyzji
**Kryterium blokujące (K0):** żadne poświadczenie, które pozwala wdrożyć kod albo odczytać dane prod, nie jest dostępne dla workflowu uruchomionego z dowolnej gałęzi.

| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Ochrona prod przed przejętą gałęzią, workflowem, akcją lub stacją agentów | 5 | dane klientów; RR-02, RR-21 |
| Koszt | 4 | budżet 300 zł/mies., decyzja Free |
| Zgodność z decyzjami Konrada (Free, staging przed prod, automatyczny staging, zatwierdzenie prod) | 4 | AC2 EVM-007, SR-INFRA-13 |
| Prostota i narzut operacyjny | 4 | jedna osoba |
| Weryfikowalność wdrożenia (potwierdzenie wersji, rollback, bramka 10) | 3 | AC2, AC7 EVM-007 |
| Odwracalność | 2 | powrót do Pro bez przebudowy |

## Rozważane opcje
1. **(a) Pull z manifestem w buckecie Scaleway** (SR-INFRA-14 wariant a): job CI zapisuje manifest kluczem „tylko zapis” trzymanym w sekretach; agent systemd na VM wdraża digesty z manifestu. Na Free klucz zapisu jest sekretem repozytorium.
2. **(a') Pull z weryfikacją na VM:** w GitHubie **zero sekretów**; CI na `main` publikuje obrazy (`GITHUB_TOKEN`, `packages: write`) i artefakt `release-manifest`; agent na VM sam sprawdza przez API GitHub (tokeny tylko do odczytu trzymane na VM) historię `main`, pochodzenie commitów i przebieg, z którego pochodzi manifest. Prod dodatkowo wymaga zatwierdzenia Konrada zapisanego poza GitHubem.
3. **(b) Push przez SSH z tymczasową regułą firewalla** (SR-INFRA-14 wariant b): klucz SSH i token Hetzner (pełne uprawnienia projektu) w sekretach repozytorium.
4. **P — GitHub Pro + (a)** (punkt odniesienia; 4 USD ≈ 15,50 zł/mies.): sekrety w środowiskach ograniczonych do `main`, ruleset `main`, 3000 min Actions; SR-INFRA-13/14 i RR-20 bez zmian.

Odrzucone bez oceny: **runner self-hosted na VM** (workflow z dowolnej gałęzi wykona kod na VM); **OIDC GitHub → dostawca** (w dokumentacji Scaleway i Hetzner nie znaleźliśmy federacji tożsamości — 2026-10-13); **atestacje artefaktów GitHub** (w repo prywatnym tylko Enterprise Cloud).

## Ocena
| Kryterium (waga) | (a) | (a') | (b) | P |
|---|---|---|---|---|
| **K0 (blokujące)** | **nie** — klucz zapisu manifestu z dowolnej gałęzi = dowolny obraz na VM | tak | **nie** — klucz SSH i token Hetzner z dowolnej gałęzi | tak |
| Ochrona prod (5) | 1 | 4 | 1 | 4 |
| Koszt (4) | 5 | 5 | 5 | 4 |
| Zgodność z decyzjami (4) | 4 | 5 | 3 | 2 |
| Prostota (4) | 4 | 2 | 3 | 4 |
| Weryfikowalność (3) | 4 | 4 | 4 | 4 |
| Odwracalność (2) | 4 | 4 | 3 | 5 |
| **Suma ważona (maks. 110)** | 77 (odpada — K0) | **88** | 67 (odpada — K0) | 82 |

(a') i P mają podobną ochronę z różnych powodów: P **blokuje** obejście `main` rulesetem, ale trzyma w GitHubie sekrety prod (klucze odczytu kopii, tokeny IaC — TM-100); (a') nie ma w GitHubie nic do ukradzenia, ale obejście `main` (RR-21) i zatrucie cache Actions w zakresie `main` musi wykryć i zablokować sam kanał — **wyłącznie łącznie**: hermetyczny `publish`, kontrola Activity (V0) i kontrola historii (V1–V3). Bez nich zatruty cache przechodzi V1–V5 (przegląd `security-engineer`, B1). Prostota (a') obniżona do 2 — weryfikator to 4–6 dni pracy i kod bezpieczeństwa do utrzymania. (a') działa bez zmian także na Pro. Fakty zweryfikowane 2026-10-13 (źródła niżej).

## Decyzja Konrada o planie GitHub (2026-10-13)
Konrad **ponownie odrzucił GitHub Pro** mimo nowych faktów (brak blokady `main`, zużycie minut — [Minuty Actions](#minuty-actions-i-limit-wydatków)). Konsekwencje: (1) ochrona `main` nadal wykrywająca (K6) — dla wdrażanego kodu blokuje dopiero kanał (V0–V3); (2) pula 2000 min wymaga ograniczenia CI (ADR-0016 K1 do adnotacji); (3) IaC tylko w sesjach ręcznych; (4) Pro pozostaje w [planie wyjścia](#plan-wyjścia).

## Decyzja
Wybieramy **(a') pull z weryfikacją na VM** dla staging i prod. Zasada: **GitHub jest źródłem kodu, obrazów i dowodów (przebiegi, PR, Activity), nigdy poświadczeń** — w repozytorium nie ma sekretów wdrożeniowych, IaC, backupu ani testu odtworzenia (K7 z ADR-0016 bez wyjątków; `RENOVATE_TOKEN` — osobno, Q1). **Realną granicą zaufania jest przegląd i scalenie PR przez Konrada** — kanał gwarantuje, że na VM trafia wyłącznie kod scalony w ten sposób i zbudowany hermetycznie; nie chroni przed złośliwym kodem, który Konrad scali.

**Publikacja hermetyczna (job `publish` w `ci.yml`, B1a).** Tylko przy `push` na `main` (`if: github.ref == 'refs/heads/main' && github.event_name == 'push'`), po `ci-gate`, tylko gdy zmieniły się `apps/`, `packages/`, `infra/` lub lockfile. **Bez żadnego cache:** bez `actions/cache`, bez `cache:` w `setup-node` (dziś `ci.yml` używa `cache: pnpm` w jobach `quality`, `backend-integration` i panelu — w `publish` zabronione), buildx bez `cache-from`/`cache-to` (`gha`, `registry`); `pnpm install --frozen-lockfile` z czystego stanu; obrazy bazowe wyłącznie po digeście; **nic z `ghcr.io/konradkluz/…` po tagu ani jako warstwa bazowa**. `packages: write` tylko w tym jobie. Wynik: obrazy w GHCR i artefakt `release-manifest` (commit, digesty `ghcr.io/konradkluz/evia-*@sha256:…`, ścieżka pliku Compose wdrożenia). Obrazy minimalne (np. distroless) — decyzja w 007a. `publish` nie używa `download-artifact` ani wyjść innych jobów jako wejścia budowy (n4). Niezmienniki `publish` (w tym n4) sprawdza `tools/repo-policy` (test), a `ci.yml` jest plikiem wrażliwym K3. Retencja GHCR: zadanie na `main` zostawia 20 najnowszych wersji, ale **nigdy nie usuwa digestów z `release-manifest` ostatnich 30 przebiegów `push` na `main`** — inaczej gałąź mogłaby wypchnąć 20 śmieciowych wersji i wyprzeć digest zweryfikowany na staging przed zatwierdzeniem prod lub rollbackiem (n2); VM trzyma też lokalne kopie wdrożonych obrazów (niżej).

**Weryfikator na VM (kontrole V0–V6, fail-closed — każde niepowodzenie = brak zmiany, alert):**
| # | Kontrola |
|---|---|
| V0 | **Activity `main`** (`GET /repos/{o}/{r}/activity?ref=refs/heads/main`, B1b): od ostatniego wdrożenia (początkowo `BASELINE`) wyłącznie zdarzenia `pr_merge`, których `actor.id` = **numeryczny ID konta Konrada** (z konfiguracji VM, nie login); każde `push`, `force_push`, `branch_deletion` albo `branch_creation` na `main` blokuje wdrożenie do czasu procedury incydentu (niżej). Wykrywa też cofnięty force pushem commit, który zatruł cache. API Activity może mieć opóźnienie, więc **każdy cykl agenta sprawdza V0 ponownie także za okres już wdrożony**; zdarzenie sprzed startu `publish` wykryte po wdrożeniu = alert i rollback do poprzedniego wdrożenia z rejestru (n5) |
| V1 | commit X należy do historii `main`; od ostatniego wdrożenia do X historia jest przewinięciem. Wyjątek — rollback (niżej) |
| V2 | każdy commit z zakresu to squash PR do `main` scalonego przez Konrada (numeryczny ID), a HEAD PR ma udany **przebieg workflowu `ci.yml` identyfikowanego numerycznym ID workflowu** z jobem `ci-gate` = `success` — nie check o nazwie `ci-gate` (check i status może utworzyć workflow z gałęzi, m1). V2 ma wartość głównie przeciw obejściu przez push (bezpośredni lub tokenem `GITHUB_TOKEN`); nie zastępuje przeglądu Konrada |
| V3 | przebieg `ci.yml` (ID workflowu) dla X: `event = push`, `head_branch = main`, `head_sha = X`, `conclusion = success`, job `publish` = `success`; artefakt `release-manifest` z **tego** przebiegu, a gdy przebiegów lub prób jest kilka — deterministycznie najnowsza udana próba najstarszego przebiegu `push` dla X; schemat manifestu poprawny, obrazy tylko z listy dozwolonych repozytoriów GHCR i wyłącznie po digeście (`sha256:` + 64 znaki hex) |
| V4 | plik Compose wdrożenia pobrany z commita X (API zawartości) i **odrzucony**, gdy: obraz spoza digestów manifestu (lub stałej listy obrazów infrastruktury po digeście z konfiguracji VM), `privileged`, gniazdo Dockera, montowanie ścieżek hosta spoza listy dozwolonych, `network_mode: host`, `pid: host`, `ipc: host`, `uts: host`, `userns_mode: host`, `cgroup: host`, `cap_add`, `devices`, `security_opt` osłabiające izolację (M1), `build:`, `secrets`/`configs` z `file:` spoza listy dozwolonych ścieżek, `env_file` spoza listy dozwolonych (n1) |
| V5 | tylko prod: zatwierdzenie Konrada (niżej) wskazuje X i skrót SHA-256 manifestu; przebieg `staging-verify` dla X zielony z tym samym skrótem; **lokalny** stan testu odtworzenia na VM prod: udany ≤ 7 dni (m4 — nie z Grafany) |
| V6 | wdrożenie (niżej „Rollback i migracje”) |

**Implementacja weryfikatora.** Mały program w TypeScript w obrazie przypiętym po digeście w konfiguracji VM (testy jak `tools/`, uruchamiany przez jednostkę systemd **bez gniazda Dockera**, bez portów, z systemem plików tylko do odczytu); pull i `docker compose` wykonuje krótki skrypt powłoki roota, który **ponownie waliduje** digesty i schemat przekazanego wyniku. Artefakt ZIP to dane niezaufane (m2): limit rozmiaru pobrania i rozpakowania (np. 1 MiB), parsowanie w pamięci, jeden oczekiwany plik, bez zapisu ścieżek z archiwum na dysk. **Weryfikatora i skryptu nie aktualizuje kanał wdrożenia** — wyłącznie sesja IaC Konrada; pochodzenie obrazu weryfikatora (m5): budowany lokalnie w sesji Konrada z czystego `main` albo wzięty z `publish`, który przeszedł V0–V4, i przypinany po digeście w IaC. Ścieżki `infra/deploy-agent/**` dopisujemy do plików wrażliwych K3. Szacunek: **4–6 dni** (z testami negatywnymi).

**Poświadczenia kanału — osobne dla staging i prod (tylko na VM, pliki `0600` root, nigdy w obrazie ani `user-data`):**
1. **Fine-grained PAT** Konrada tylko do tego repozytorium, wyłącznie odczyt (Actions, Contents, Pull requests, Metadata), wygasanie ≤ 12 mies. — uproszczenie `devops-engineer` zamiast GitHub App, **przyjęte**: token jest tylko do odczytu i leży wyłącznie na VM, więc K0 nie słabnie; koszt — powiązanie z kontem Konrada (jak PAT GHCR). Uprawnienie wymagane przez API Activity potwierdzamy w 007a.
2. **PAT classic z jednym zakresem `read:packages`** (GHCR obsługuje tylko PAT classic). W 007a sprawdzamy, że sam `read:packages` wystarcza do pobrania prywatnego obrazu; jeśli GHCR wymagałby `repo` (zapis!) — **konto maszynowe** z dostępem do odczytu nadanym w ustawieniach pakietu, nie `repo` na koncie Konrada.
3. Tylko prod: klucz Scaleway tylko do odczytu obiektu zatwierdzenia (warunek `aws:SourceIp` = IP VM prod).

Skutek kradzieży z VM: odczyt kodu i obrazów — mniej niż daje sama przejęta VM (RR-19). **Limit API (n3):** PAT-y staging i prod oraz `gh` orkiestratora dzielą limit 5000 zapytań/h konta Konrada — przejęta VM staging może zagłodzić weryfikator prod; plan 007a: backoff z poszanowaniem nagłówków limitu, alert przy wyczerpaniu i fail-closed (brak wdrożenia, nie pominięcie kontroli). **Warunek do sprawdzenia w 007a:** jeśli API Activity wymaga uprawnienia innego niż tylko do odczytu, to blocker — zmiana projektu V0 (nowa rewizja ADR), nie poszerzenie tokenu.

**Staging (automatycznie z `main`, AC2 EVM-007).** Timer systemd co 1–2 min sprawdza HEAD `main`; po V0–V4 wdraża (V6). Job `staging-verify` w tym samym przebiegu CI (≤ 15 min) czeka, aż `GET /version` na `https://staging.eviacharge.pl` zwróci X i skrót manifestu, po czym wykonuje bramkę 10 z runnera (skan portów, TLS, nagłówki, „anonimowy `GET` = 403”, rekordy DNS przez `dig`) — **bez sekretów**; wynik w podsumowaniu i artefakcie `staging-verified`.

> **Adnotacja 2026-10-21 (EVM-007) — status: Proponowana, do akceptacji Konrada:** VM stagingu to Hetzner **Arm64 CAX11** (CAX21 przy braku pamięci; [ADR-0011](0011-hosting-i-srodowiska-ue.md), adnotacja z tą samą datą), więc kanał działa na `linux/arm64`. „Publikacja hermetyczna” bez zmian zasad, z doprecyzowaniem: `publish` buduje obrazy wydania `--platform linux/arm64` **krzyżowo na runnerze x86 bez emulacji** (bez QEMU i bez dodatkowych akcji — etapy z poleceniami na `$BUILDPLATFORM`, etap końcowy wyłącznie kopiuje pliki, zależności produkcyjne instalowane dla CPU celu z lockfile; płatne runnery Arm nie są potrzebne), sprawdza platformę obrazów przed bramką 6 i skanuje obrazy infrastruktury w wariancie `linux/arm64`. Obrazy bazowe i infrastruktury są przypięte digestem **indeksu wieloarchitekturowego**; obrazy wydania są jednoplatformowe, a ich digest w `release-manifest` to digest manifestu `linux/arm64`. `deploy.sh` (V6) odrzuca obraz o platformie innej niż host przed migracją. Lista V4 bez zmian zasad; ClamAV z `clamav/clamav-debian` (Alpine `clamav/clamav` jest tylko amd64).

**Monitoring agenta (informacyjny, nie decyzyjny).** Agent wysyła metryki `deploy_agent_last_success`, `deployed_commit`, `deployed_manifest_sha256`, wynik ostatniej weryfikacji; alerty: brak heartbeatu > 10 min, HEAD `main` ≠ wdrożony commit > 30 min, wygaśnięcie PAT lub klucza za ≤ 30 dni, blokada V0. Jednostki systemd z `Restart=on-failure` i `OnFailure=` (lokalny log i e-mail przez alert). Żadna decyzja wdrożeniowa nie korzysta z danych Grafany (RR-24).

**Rollback i migracje (V6, M3).**
- Kolejność: `docker pull` po digeście → migracje jednorazowym kontenerem nowego obrazu (rola `evia_migrator`) → start nowych kontenerów → `GET /healthz` i `/version` (commit + skrót manifestu) → przełączenie ruchu w Caddy; porażka migracji lub testu zdrowia = zostaje poprzednia wersja.
- **Migracje tylko „expand”** w wydaniu (ADR-0003); „contract” w osobnym, późniejszym wydaniu. Test CI wykrywa operacje destrukcyjne (`DROP`, `RENAME`, zawężenie typu, `NOT NULL` bez wartości domyślnej) w migracji bez jawnego oznaczenia fazy „contract”. Niezmiennik: wersja N−1 działa na schemacie N.
- VM trzyma **lokalny rejestr wdrożeń** (commit, skrót manifestu, kopia manifestu, czas) i **lokalne obrazy co najmniej 3 ostatnich wdrożeń** (niezależne od retencji GHCR).
- **Rollback:** zatwierdzenie (prod) albo polecenie administratora (staging) z polem `rollback: true` jest dozwolone **wyłącznie dla commita z lokalnego rejestru wdrożeń**; wtedy V1 nie wymaga przewinięcia, a V0 i V2 sprawdzają zakres do tego commita z chwili jego wdrożenia (zapis w rejestrze). Rollback nie cofa migracji.

**Prod (zatwierdzenie Konrada, zero sekretów prod w GitHubie).** Konrad zatwierdza wydanie, wgrywając przez **konsolę Scaleway (MFA) z urządzenia lub profilu bez agentów AI** (np. telefon; M2) obiekt `approvals/prod.json` (`commit`, `manifestSha256`, opcjonalnie `rollback`, `skipRestoreTest`) do wersjonowanego bucketu zatwierdzeń w projekcie `evia-prod`. Polityka bucketu: zapis tylko `user_id` Konrada, odczyt tylko aplikacja agenta prod z warunkiem `aws:SourceIp`. Zatwierdzenie leży poza GitHubem celowo: `workflow_dispatch` może wyzwolić także workflow z gałęzi (`GITHUB_TOKEN` z `actions: write`). Do wdrożenia prod potrzebne są dwa konta Konrada (GitHub — scalenie, Scaleway — zatwierdzenie); RR-11 pozostaje **1 × 3 = 3 Medium** (oba konta i urządzenie z agentami należą do tej samej osoby). **Test odtworzenia jako warunek:** „udany” = PITR z ponownym zastosowaniem rejestru usunięć i zgodnymi liczbami kontrolnymi, zapisany lokalnie na VM prod; nieudany lub starszy niż 7 dni blokuje wdrożenie (agent najpierw uruchamia test); `skipRestoreTest` z uzasadnieniem — tylko awaryjnie, zawsze z alertem i wpisem w rejestrze wdrożeń. E-mail o każdym wdrożeniu prod (SR-LOG-07). Bramka 10 dla prod: workflow `prod-verify` bez sekretów (co noc i ręcznie po wdrożeniu).

**Gdzie żyją sekrety na Free:**
| Sekrety | Miejsce | Źródło prawdy i odtworzenie |
|---|---|---|
| Aplikacji (hasła ról bazy, klucze `platform/crypto`, klucze S3 API/workera, TEM, token zapisu Grafany, DSN Sentry) | VM środowiska: `/etc/evia/secrets/` (`0600` root), montowane do kontenerów | generowane na VM przy pierwszym starcie albo tworzone przez IaC i przekazywane przez SSH administratora; kopia w menedżerze haseł Konrada; `platform/crypto` także w zestawie awaryjnym offline |
| Kanału wdrożenia (PAT-y, klucz zatwierdzeń) | VM (wyżej), osobne per środowisko | menedżer haseł; rotacja wg SR-CRYPTO-04 |
| IaC (token Hetzner R/W projektu, klucz aplikacji IaC Scaleway, hasło szyfrowania stanu OpenTofu) | **tylko w czasie sesji IaC** | token Hetzner tworzony przed sesją i usuwany po niej; klucz Scaleway z datą wygaśnięcia (≤ 24 h); hasło stanu — menedżer haseł |
| Backupu (hasło pgBackRest, klucze `rclone crypt`, subkonto Storage Box) | VM | menedżer haseł + **kopia offline** w zestawie awaryjnym (bez nich kopie są bezużyteczne) |
| Testu odtworzenia (tokeny `evia-restore*`) | VM środowiska | menedżer haseł |
| GitHub (repozytorium) | **brak** | — |

Menedżer haseł Konrada (AC3 EVM-007: „menedżer sekretów”) — **bez odblokowanego CLI ani rozszerzenia z sesją na stacji agentów**; zestaw awaryjny (wydruk lub nośnik offline w sejfie) z kluczami backupu i `platform/crypto`. `user-data` VM nie zawiera sekretów, a kontenery nie mają dostępu do usługi metadanych (`169.254.169.254`) — wyjątek: tymczasowa VM testu odtworzenia. SOPS+age niepotrzebne w M0.

**IaC (OpenTofu, stan szyfrowany w buckecie Scaleway środowiska).** CI wykonuje tylko kontrole bez poświadczeń: `tofu fmt -check`, `tofu validate` bez backendu, Trivy i reguły własne (bramka 5). `plan`/`apply` w kontenerze (`docker compose -f compose.yaml run --rm iac`, obraz OpenTofu po digeście) z czystego `main`:
- **prod** — wyłącznie Konrad, w sesji bez działających agentów;
- **staging** (007a–c) — może uruchamiać `devops-engineer`; tokeny **tworzy i unieważnia Konrad**, zawężone do projektów `evia-staging` (Hetzner, Scaleway), z wygaśnięciem ≤ 24 h, w pliku poza repozytorium **montowanym do kontenera `iac`** — agent go nie czyta ani nie wypisuje (reguły `deny`, RR-02).

W tej samej sesji Konrad zmienia weryfikator na VM i konfigurację bucketów (wersjonowanie, object lock, lifecycle, polityki) — klucz z VM nadal nie ma do niej uprawnień (ADR-0011). Dryf: `tofu plan` w sesji co kwartał i przed wydaniem.

**Test odtworzenia (SR-INFRA-07) poza GitHub Actions.**
- **Prod (E8):** timer systemd na VM prod (co miesiąc i przed wdrożeniem wg V5) tokenem Hetzner R/W **osobnego projektu `evia-restore`** (bez zasobów prod; dane prod, region UE — dla SR-INFRA-07 to strefa prod) tworzy tymczasową VM bez portów przychodzących. VM dostaje w `user-data` wyłącznie klucze tylko do odczytu (kopie bazy, rejestr usunięć, subkonto Storage Box), hasła odszyfrowania i **jednorazowy podpisany URL `PUT`** na obiekt wyniku; odtwarza PITR z rejestrem usunięć i plik mediów, zapisuje wynik bez danych (czas, RPO, liczby kontrolne) i wyłącza się. Agent zapisuje wynik **lokalnie** (stan dla V5), wysyła metrykę informacyjną i usuwa VM. **Sprzątacz** co godzinę usuwa w `evia-restore` wszystkie serwery starsze niż 24 h oraz snapshoty, obrazy, wolumeny i adresy IP (m3); orkiestrator odmawia utworzenia drugiej VM, gdy jedna istnieje; alert przy zasobach > 24 h i miesięczny przegląd kosztów projektu.
- **Staging (007b):** ten sam kod, projekt `evia-restore-staging`, pełny scenariusz „backup usunięty z przejętej VM” co miesiąc.
- Dane nigdy nie trafiają do GitHuba, na runner ani na staging. Koszt: poniżej 2 zł/mies.

**DNS, TLS i poczta (ręcznie przez Konrada, bez tokenu OVH w CI ani na VM).** Uzasadnienie: kilka rekordów zmienianych rzadko; token DNS pozwala wystawić certyfikat dla domeny (TM-53), a na Free nie ma dla niego bezpiecznego miejsca. Kolejność w 007a:
1. Konrad ustawia `A`/`AAAA` dla `staging.eviacharge.pl` i **CAA na węźle `staging.eviacharge.pl`** (`0 issue "letsencrypt.org"`, `0 issuewild ";"`; rozważyć w 007a parametr `accounturi` z RFC 8657, wiążący wystawienie z kontem ACME Caddy). CAA na wierzchołku domeny dopiero po inwentaryzacji certyfikatów domeny głównej (logi CT) — CAA wierzchołka obejmuje wszystkie subdomeny i mógłby zablokować odnowienie certyfikatów usług firmy.
2. Start Caddy (port 80 otwarty — wyzwanie HTTP-01), trwały wolumen `/data` (certyfikaty, ochrona przed limitami Let's Encrypt).
3. Poczta stagingu: SPF i DKIM TEM **tylko dla `staging.eviacharge.pl`** (domeny głównej z `include:resend.com` nie zmieniamy); **jawny `_dmarc.staging.eviacharge.pl`** (subdomena dziedziczy `p=none` z domeny głównej) — najpierw `p=none` z raportami, `p=reject` (SR-INFRA-12) po potwierdzeniu wyrównania SPF/DKIM w raportach.

**Procedura incydentu „blokada V0” (runbook w 007a, B1c).** Push lub force push na `main` poza PR: (1) wdrożenia wstrzymane (V0); (2) analiza wg `docs/ops/github-i-ci.md` → „Czerwony `main`”; (3) **usunięcie wszystkich cache Actions repozytorium** (`gh cache delete --all` z konta Konrada); (4) przesunięcie `BASELINE`/punktu odniesienia V0 na VM wyłącznie w sesji IaC Konrada; (5) pierwsze wdrożenie po incydencie z nowego przebiegu `publish`.

## Odstępstwo od ADR-0011: wspólny stos Grafana i organizacja Sentry dla staging i prod
ADR-0011: „nic nie jest współdzielone między staging i prod”. Grafana Cloud Free pozwala na **jeden stos**, Sentry Developer to jedna organizacja z 1 użytkownikiem — osobne konta dla prod wymagałyby płatnych planów. Przyjmujemy współdzielenie **wyłącznie narzędzi obserwowalności**; infrastruktura, klucze, buckety, domeny i dane pozostają rozdzielone (SR-INFRA-08 bez innych wyjątków).
- **Tokeny zapisu per środowisko:** Grafana — osobna polityka dostępu i token na środowisko (`metrics:write`, `logs:write`, ewentualnie `traces:write`; realm = stos; z datą wygaśnięcia), Alloy nadaje `env` jako etykietę zewnętrzną; Sentry — projekty per komponent (`api`, `web`, później `mobile`) z `environment` = `staging` / `prod` i osobnym kluczem klienta (DSN) per środowisko, unieważnianym niezależnie. Alerty i pulpity filtrują `env="prod"`.
- **Dane:** wyłącznie po redakcji i scrubbingu (ADR-0013); staging ma dane syntetyczne.
- **Odczyt:** tylko konto Konrada (MFA); tokeny VM nie mają zakresów odczytu.
- **Ryzyko rezydualne:** selektory etykiet działają w Grafanie tylko dla odczytu, więc przejęta VM staging może zapisywać serie z `env="prod"` (fałszywe dane, zalanie alertów) i zużyć wspólne limity (10 tys. serii, 50 GB logów; Sentry 5 tys. błędów). Poufność bez zmian. Ocena: **P1 × W2 = 2 Low — pod warunkami:** żadna decyzja wdrożeniowa ani blokada (V0–V6, test odtworzenia) nie korzysta z danych Grafany; alerty „brak danych” dla prod i alert zużycia limitów; spike protection w Sentry; limity szybkości w Alloy i niższe próbkowanie Sentry na staging; rotacja tokenu staging po incydencie. Alerty bezpieczeństwa SR-LOG-07 zależą od wspólnego stosu — alert „brak danych” jest ich kontrolą działania. Dziennik audytu jest w bazie (ADR-0013).
- **Wyjście:** płatne konto Grafana (do 3 stosów) albo samodzielny hosting; osobne projekty Sentry albo GlitchTip (ADR-0013) — godziny pracy, zmiana tokenów i DSN.

## Minuty Actions i limit wydatków
Dane z `gh api` (`devops-engineer`, 2026-10-13): od 2026-10-01 — 59 przebiegów `ci.yml` (29 na `main`), ok. 31 minut jobów na przebieg (najdłuższy `e2e-web` ≈ 17 min) → **szacunek ok. 4000 min/mies. przy puli 2000 min** (część przebiegów mogła być anulowana — **założenie do potwierdzenia przez Konrada w Billing**; do tego czasu decyzje opieramy na tym szacunku). `publish` i `staging-verify` dodadzą ok. 10–15 min na scalenie z kodem. Limit wydatków 0 USD oznacza, że po wyczerpaniu puli **CI i wdrożenia staging stają** do końca okresu (fail-closed — prod nie jest zagrożony, ale tracimy bramki i staging). Sam Pro (3000 min) nie wystarczy przy 4000 min — ograniczenie CI jest potrzebne niezależnie od planu.

Mitygacje (warunek 007a, zmiana K1 z ADR-0016 do adnotacji): (1) pełne CI na `pull_request` do `main` i na `push` do `main`; push gałęzi bez PR — tylko szybkie kontrole (walidator dokumentacji, lint, typy); (2) `e2e-web` tylko na PR i `main`; (3) zmiany wyłącznie w dokumentacji pomijają ciężkie joby przy zachowaniu raportu `ci-gate` (job wykrywający zmiany, nie `paths-ignore`); (4) `publish` tylko przy zmianach kodu; (5) przegląd zużycia co miesiąc. **Próg ponownej decyzji o planie:** realne zużycie po mitygacjach > 1600 min (80%) w dwóch kolejnych miesiącach albo wyczerpanie puli — decyzja Konrada (Pro, płatne minuty z limitem wydatków > 0 USD albo dalsze cięcia).

## Etapy wdrożenia decyzji
Kontrole chroniące łańcuch obrazów są w 007a, bo te same digesty idą później na prod.
| Etap | Zakres z tego ADR |
|---|---|
| **007a** — IaC staging, VM, Caddy/TLS/DNS, kanał staging | sesje IaC staging (tokeny Konrada, montowany plik); VM bez sekretów w `user-data`, blokada metadanych dla kontenerów; DNS/TLS/CAA/poczta w kolejności wyżej; **hermetyczny `publish`** z testem `tools/repo-policy`; **V0–V4 w pełni** (Activity, ID workflowu, polityka Compose, limity ZIP); V6 z lokalnym rejestrem wdrożeń, rollbackiem, `/healthz`, `/version`, testem migracji destrukcyjnych; `staging-verify` (bramka 10); weryfikator przypięty po digeście (m5), pliki wrażliwe K3; PAT-y staging i test `read:packages` oraz uprawnień API Activity (n3); backoff limitu API; metryki heartbeat; retencja GHCR z ochroną digestów z manifestów (n2); mitygacje minut; runbooki: wdrożenie, rollback, incydent „blokada V0” |
| **007b** — backupy i odtworzenie na staging | pgBackRest i backup mediów (moduł jak prod); orkiestrator testu odtworzenia w `evia-restore-staging` z podpisanym `PUT` wyniku, lokalnym stanem i sprzątaczem (m3); pełny scenariusz „backup usunięty z przejętej VM”; `docs/ops/runbooks/restore.md` |
| **007c** — obserwowalność, koszty, AC8 | wspólny stos Grafana i organizacja Sentry z tokenami/DSN per środowisko; alerty: heartbeat, rozjazd HEAD, wygasanie PAT/kluczy, „brak danych”, zużycie limitów, blokada V0; spike protection; koszty i alert budżetowy; AC8 |
| **E8** (EVM-061/062) — prod | VM prod tymi samymi skryptami; bucket zatwierdzeń z polityką i procedurą zatwierdzenia z urządzenia bez agentów (M2); V5 (zatwierdzenie, `staging-verify`, lokalny stan testu, `skipRestoreTest`); test odtworzenia z VM prod w `evia-restore`; PAT-y prod; `prod-verify`; e-mail o wdrożeniu; sesja IaC prod bez agentów |

## Zmiany wymagań i ryzyk (do wprowadzenia przez `security-engineer` po akceptacji; tu tylko propozycja)
| ID | Proponowane nowe brzmienie (skrót) |
|---|---|
| SR-INFRA-13 | Wdrożenie prod kanałem pull (ADR-0018): zatwierdzenie Konrada = obiekt `commit` + `manifestSha256` w buckecie zatwierdzeń prod, zapisany przez konsolę Scaleway (MFA) z urządzenia bez agentów; agent prod wykonuje V0–V6; zero sekretów prod w GitHubie; e-mail o każdym wdrożeniu. Test: zatwierdzenie commita spoza `main`, po zdarzeniu `push`/`force_push` na `main`, z innym skrótem manifestu, `rollback` dla commita spoza rejestru albo zapis obiektu cudzym kluczem — odrzucone. |
| SR-INFRA-14 | Jedyny kanał: pull z weryfikacją na VM (V0–V6) i hermetyczny `publish`. Zakazane: poświadczenia kanału, IaC, backupu lub testu odtworzenia w sekretach GitHub; port 22 dla CI; push przez SSH; cache w `publish`; aktualizacja weryfikatora przez kanał. Na VM (osobno per środowisko): fine-grained PAT tylko do odczytu, PAT classic `read:packages`, (prod) klucz odczytu zatwierdzenia z warunkiem IP. |
| SR-INFRA-07 | Test odtworzenia orkiestruje timer na VM środowiska w projekcie `evia-restore*` (token tylko na tej VM), nie CI; „udany” = PITR z rejestrem usunięć i liczbami kontrolnymi zapisany lokalnie; usunięcie VM: agent + sprzątacz (serwery, snapshoty, obrazy, wolumeny, IP) + alert > 24 h; „przed wydaniem” = udany test ≤ 7 dni przed wdrożeniem prod (inaczej uruchamiany automatycznie), `skipRestoreTest` awaryjnie z alertem. |
| SR-INFRA-05 | Sekrety: menedżer haseł Konrada (bez odblokowanego CLI na stacji agentów) i pliki `0600` na VM; zestaw awaryjny offline; poświadczenia IaC tylko sesyjne; **w GitHubie brak sekretów**. |
| SR-INFRA-03 | „IaC — konfiguracja bucketów tylko z CI” → „tylko z sesji IaC Konrada”. |
| SR-INFRA-08 | Wyjątek: wspólny stos Grafana i organizacja Sentry z tokenami zapisu i DSN per środowisko (ADR-0018). |
| SR-INFRA-09 | Przegląd dostępów co kwartał obejmuje PAT-y kanału (staging, prod), klucz zatwierdzeń, tokeny `evia-restore*`, polityki bucketów i tokeny Grafana/Sentry per środowisko. |
| SR-INFRA-01, SR-COMM-05 | Usunąć wariant „push przez SSH” i regułę tymczasową dla runnera; kanał wdrożenia bez portów przychodzących. |
| SR-CRYPTO-04 | Inwentarz: fine-grained PAT i PAT `read:packages` (per środowisko), klucz odczytu zatwierdzeń prod, tokeny Hetzner `evia-restore` i `evia-restore-staging`, tokeny zapisu Grafana i DSN per środowisko, poświadczenia sesji IaC (sesyjne). |
| SR-LOG-07 | Dopisać zależność od wspólnego stosu Grafana i alert „brak danych” jako kontrolę działania alertów. |
| SR-SUPPLY-04 | „Sekrety tylko w jobach wdrożeń” → „repozytorium bez sekretów wdrożeniowych; `publish` hermetyczny (bez cache, obrazy bazowe po digeście)”; `packages: write` tylko w `publish` **nie jest granicą** (workflow z gałęzi też go podniesie) — granicą są digesty z manifestu i V0–V4. |
| SR-SUPPLY-05 | Wariant Free: kanał wdrożenia blokuje wdrożenie po zdarzeniu `push`/`force_push` na `main` (V0) i commit spoza PR Konrada z udanym przebiegiem `ci.yml` (V2); uzupełnia K6. |
| `requirements.md` — kryteria EVM-007 i E8, bramka 10 (ok. linii 315, 356, 462) | Usunąć „push przez SSH”, „port 22 po usunięciu reguły tymczasowej” i „CI tylko orkiestruje” test odtworzenia; bramka 10 = `staging-verify` / `prod-verify` bez sekretów; test odtworzenia z VM środowiska. |
| DF-24, DF-27, DF-30 | DF-24: GitHub (odczyt API, GHCR) → VM; DF-27: sesja IaC (stacja Konrada) → API dostawców; DF-30: VM środowiska → API Hetzner (`evia-restore*`) → tymczasowa VM. |
| TM-97, TM-99, TM-100, TM-98 | TM-97/TM-99: bez poświadczeń kanału w CI — 1×1 Low; TM-100: sekrety testu tylko na VM — do RR-19; **TM-98: N/A** (brak klucza wdrożeniowego SSH). |
| nowe TM (np. TM-112, TM-113) | Zatrucie cache Actions w zakresie `main` (push i force push tokenem `GITHUB_TOKEN`, `workflow_dispatch` na `main`) → złośliwy obraz z `publish`; zatrucie obrazu bazowego / warstwy z GHCR po tagu. Mitygacje: hermetyczny `publish`, V0, runbook incydentu. |
| RR-06 | Token Hetzner nie jest w CI: sesyjny (IaC, usuwany po sesji) i tokeny projektów `evia-restore*` na VM. |
| RR-11 | Bez obniżenia: **1 × 3 = 3 Medium**; dopisać dwa konta Konrada i zatwierdzenie z urządzenia bez agentów. |
| RR-20 | Przepisać: test odtworzenia z VM środowiska, nie z CI; sekrety nie opuszczają VM i tymczasowej VM; ocena w ramach RR-19. |
| RR-21 | Przegląd „przed planem EVM-007” zamyka ADR-0018: zero sekretów w repozytorium; obejście `main` nie trafia na staging ani prod dzięki V0–V3 i hermetycznemu `publish`. |
| RR-02 | Dopisać: tokeny sesji IaC staging w pliku montowanym do kontenera (agent go nie czyta); sesja prod bez agentów; menedżer haseł bez odblokowanego CLI na stacji. |
| nowe RR-23 | Kanał wdrożenia oparty na własnym weryfikatorze i API GitHub: błąd weryfikatora = wdrożenie niezweryfikowanego kodu; niedostępność API = wstrzymane wdrożenia. **P1 × W3 = 3 Medium.** Mitygacje: testy negatywne V0–V5, przegląd `security-engineer`, zmiana tylko sesją IaC. |
| nowe RR-24 | Wspólny stos Grafana i organizacja Sentry — **P1 × W2 = 2 Low** pod warunkami z sekcji odstępstwa. |
| ADR-0011, ADR-0012, ADR-0016 (adnotacje) | ADR-0011: IaC i konfiguracja bucketów z sesji IaC (nie z CI), test odtworzenia z VM, wyjątek obserwowalności; ADR-0012: akapit „Wdrożenia” zastąpiony przez ADR-0018; ADR-0016: K1 (trigger CI — mitygacje minut), warunek powrotu 3 rozstrzygnięty. |

## Konsekwencje
- **Pozytywne:** w GitHubie nie ma czego ukraść — przejęta gałąź, akcja, workflow ani stacja agentów nie dają odczytu danych prod; wdrożenie kodu spoza PR Konrada (push, force push, zatruty cache) jest blokowane przez V0–V3 i hermetyczny `publish`, nie tylko wykrywane; brak portu 22 dla CI i tokenu Hetzner w CI; staging testuje ten sam kanał co prod; koszt 0 zł ponad ADR-0011 (MVP ≈ 177 zł/mies. bez GitHub Pro; tymczasowe VM testu odtworzenia < 2 zł).
- **Negatywne / koszty:** własny kod bezpieczeństwa (weryfikator, 4–6 dni w 007a) do utrzymania; `publish` bez cache jest wolniejszy; IaC ręcznie (prod — tylko Konrad); zatwierdzenie prod przez konsolę Scaleway z telefonu; zależność od API GitHub i GHCR (GHCR dla obrazów prywatnych wg dokumentacji obecnie bezpłatny, zmiana z ≥ 1-miesięcznym wyprzedzeniem; plan B — Scaleway Container Registry w UE); PAT-y związane z kontem Konrada; pula minut Actions przekroczona już dziś (szacunek) — wymaga zmiany triggera CI.
- **Ryzyka i mitygacje:** *błąd weryfikatora* (RR-23) → testy z danymi syntetycznymi i atrapą API (ataki: tag lub gałąź `main`, `workflow_dispatch`, check `ci-gate` z gałęzi, commit spoza PR, push + force push, obce repozytorium obrazu, złośliwy Compose, duży ZIP, rollback spoza rejestru), przegląd `security-engineer`, fail-closed; *zatrucie cache* → hermetyczny `publish`, V0, runbook; *wyczerpanie minut* → mitygacje i próg decyzji wyżej; *poświadczenia IaC na stacji* → sesyjne, zawężone, plik montowany, sesja prod bez agentów; *przejęcie konta GitHub Konrada* → do prod potrzebne konto Scaleway i urządzenie bez agentów.

## Plan wyjścia
- **GitHub Pro** (≈ 15,50 zł/mies., ok. 1 h + 1 dzień; odrzucony przez Konrada 2026-10-13, wraca przy progu minut albo warunkach ADR-0016): ruleset `main` (ADR-0016 B), 3000 min; kanał (a') **zostaje** — zero sekretów prod w GitHubie jest korzystne także na Pro; opcjonalnie IaC staging z CI w środowisku ograniczonym do `main`.
- **Rezygnacja z własnego weryfikatora** (gdyby okazał się zbyt kruchy): Pro + wariant (a) z pierwotnego SR-INFRA-14 — 1–2 dni; przywrócenie SR-INFRA-13/14 i RR-20 w obecnym brzmieniu.
- **Rejestr obrazów:** GHCR → Scaleway Container Registry (UE) — zmiana `publish` i PAT na klucz odczytu rejestru; push do Scaleway z CI wymagałby sekretu (wtedy tylko z Pro i środowiskiem `main`).
- **Obserwowalność:** jak w sekcji odstępstwa — godziny pracy.

## Weryfikacja
- 007a: scalenie PR → wdrożenie na staging ≤ 15 min, zielony `staging-verify`; nieudany test zdrowia → poprzednia wersja; **lista sekretów repozytorium pusta** (poza ewentualnym `RENOVATE_TOKEN` po Q1); testy negatywne weryfikatora (V0–V4, rollback) zielone; test `tools/repo-policy` — `publish` bez cache i obrazów po tagu; port 22 niedostępny z runnera.
- 007b: test odtworzenia na staging przez `evia-restore-staging`, zasoby usunięte, alert > 24 h działa (test).
- 007c: alerty heartbeat, rozjazdu HEAD, „brak danych” i zużycia limitów docierają do Konrada.
- E8: zatwierdzenie commita spoza `main`, z innym skrótem manifestu, bez świeżego testu odtworzenia, `rollback` spoza rejestru albo zapis obiektu innym kluczem — odrzucone; e-mail o wdrożeniu dociera.
- Co miesiąc: realne zużycie minut (Billing) vs próg; kwartalnie: limity Grafana/Sentry, przegląd dostępów (SR-INFRA-09).

## Decyzje Konrada (2026-10-13)
Wszystkie pytania rozstrzygnięte zgodnie z rekomendacjami:
1. **Kanał (a')** dla staging i prod; zatwierdzenie prod przez konsolę Scaleway **z telefonu** (urządzenie bez agentów) — **tak**.
2. **Zmiana triggera CI** (pełne CI tylko na PR i `main`, ciężkie joby pomijane przy zmianach samej dokumentacji, adnotacja K1 w ADR-0016) — **tak, w 007a**; realne zużycie minut z Billing Konrad sprawdza przed 007a (próg ponownej decyzji o planie — [Minuty Actions](#minuty-actions-i-limit-wydatków)).
3. **`devops-engineer` uruchamia `tofu plan/apply` wyłącznie dla staging** na tokenach tworzonych i unieważnianych przez Konrada (≤ 24 h, zawężone do `evia-staging`, plik montowany do kontenera, agent go nie czyta) — **tak**; prod wyłącznie Konrad, bez agentów.
4. **Menedżer sekretów (AC3 EVM-007): Bitwarden** Konrada z MFA, **bez odblokowanego CLI (`bw`) na stacji agentów**; zestaw awaryjny offline (kopia kluczy backupu, procedura na wypadek niedostępności Konrada) w sejfie — **tak**.
5. **PAT-y na VM z konta Konrada** (fine-grained tylko do odczytu + classic `read:packages`, osobne dla staging i prod, ≤ 12 mies., przypomnienie przed wygaśnięciem); gdyby GHCR wymagał `repo` — konto maszynowe z dostępem do pakietu — **tak**.
6. **RR-24** (wspólny stos Grafana i organizacja Sentry, 2 Low pod warunkami z sekcji „Odstępstwo od ADR-0011”) — **zaakceptowane**.
7. **Test odtworzenia przed wydaniem** = udany ≤ 7 dni (inaczej uruchamiany automatycznie), `skipRestoreTest` tylko awaryjnie z uzasadnieniem i alertem — **tak**.

## Źródła (zweryfikowane 2026-10-13)
- GitHub — środowiska: sekrety środowisk i deployment branches w repo prywatnym tylko Pro/Team/Enterprise: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments , https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub — `GITHUB_TOKEN` (zdarzenia z tokenu nie tworzą przebiegów, wyjątek `workflow_dispatch` i `repository_dispatch`): https://docs.github.com/en/actions/concepts/security/github_token
- GitHub REST — aktywność repozytorium (`GET /repos/{o}/{r}/activity`: filtr `ref`, typy `push`, `force_push`, `branch_creation`, `branch_deletion`, `pr_merge`, `merge_queue_merge`; `actor.id`): https://docs.github.com/en/rest/repos/repos#list-repository-activities
- GHCR — uwierzytelnianie wyłącznie PAT classic, zakres `read:packages`: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry ; rozliczenie (Container registry obecnie bezpłatny, zmiana z ≥ 1-miesięcznym wyprzedzeniem; Free 500 MB współdzielone z artefaktami Actions): https://docs.github.com/en/billing/concepts/product-billing/github-packages
- GitHub App — token instalacyjny ważny 1 h (wariant odłożony na rzecz fine-grained PAT): https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- Atestacje artefaktów w repo prywatnym — tylko Enterprise Cloud: https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
- Grafana Cloud Free (10 tys. serii, 50 GB logów, 14 dni, 3 użytkowników): https://grafana.com/pricing/ ; konto Free — jeden stos, płatne — do 3: https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/account-management/cloud-stacks/stack-pricing-tiers.md ; polityki dostępu: https://grafana.com/docs/grafana-cloud/authentication-and-permissions/access-policies ; selektory etykiet tylko dla odczytu: https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/label-access-policies.md
- Sentry — Developer: 1 użytkownik, 5 tys. błędów, projekty bez limitu, 30 dni: https://sentry.io/pricing/ ; lokalizacja danych UE: https://docs.sentry.io/organization/data-storage-location/
- Scaleway — polityki bucketów (principal `user_id` / `application_id`, zasoby z prefiksem, warunek `aws:SourceIp`, dozwolone tylko jawnie wymienione akcje): https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/ ; IAM — klucze API z datą wygaśnięcia, reguły zawężone do projektu: https://www.scaleway.com/en/developers/api/iam
- Hetzner Cloud — tokeny API per projekt, „Read” albo „Read & Write”: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token
- Dane o zużyciu minut i stan DNS: `devops-engineer` (`gh api`, publiczne rekordy DNS), 2026-10-13.
