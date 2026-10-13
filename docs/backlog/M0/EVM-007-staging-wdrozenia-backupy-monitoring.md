---
id: EVM-007
title: Staging w UE — IaC, VM i kanał wdrożeń (007a)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
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

### Bezpieczeństwo i prywatność
Najmniejsze uprawnienia kont technicznych, szyfrowanie w spoczynku, brak publicznych bucketów, brak danych produkcyjnych na staging, brak sekretów w GitHubie, port 22 niedostępny z internetu. Ryzyka: RR-23 (własny weryfikator), RR-19, RR-24 (w 007c). Wymagania: SR-INFRA-01/05/13/14, SR-SUPPLY-04/05.

## Notatki
- Stan kont (2026-10-13): Hetzner — puste projekty `evia-staging`, `evia-prod`; GitHub Free (prywatne repo); brak konta Scaleway (potrzebne przed startem); domena `eviacharge.pl` (OVH, DNSSEC włączony).

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-06 — dopisano AC z EVM-016 (asercje wymagające infrastruktury), zaakceptowane przez Konrada
- 2026-10-13 — podział wg ADR-0018: treść zawężona do 007a (dawne AC1–AC3, część AC7); dawne AC4 i część AC7 → EVM-084; AC5, AC6, AC8, część AC7 → EVM-085; status ready → draft do akceptacji AC (product-owner)
- 2026-10-13 — draft → ready: podział EVM-007 wg ADR-0018 zaakceptowany przez Konrada; AC przeniesione z EVM-007 zaakceptowane zbiorczo
