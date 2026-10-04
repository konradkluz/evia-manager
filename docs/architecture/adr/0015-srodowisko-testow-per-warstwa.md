# ADR-0015: Środowisko testów per warstwa — backend na Linuksie w kontenerach, web, mobile i narzędzia natywnie na Windows, CI na Linuksie

- **Status:** Zaakceptowana (Konrad, 2026-10-03)
- **Częściowo zastąpiona przez:** [ADR-0016](0016-github-free-ochrona-main-kontrole-kompensujace.md) (2026-10-04) — zakres: „Po EVM-006” p. 10 — joby backendu w CI uruchamiamy tym samym poleceniem co lokalnie (`docker compose -f compose.yaml run --rm backend-tests …`), a nie przez `container:`.
- **Data:** 2026-10-03
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-005, EVM-006, EVM-009, EVM-011, EVM-012, EVM-013; ADR-0002, ADR-0007, ADR-0011 (częściowo zastępuje), ADR-0012, ADR-0014 (częściowo zastępuje); `docs/process/testing-strategy.md`, `docs/security/README.md`
- **Historia:** wersja 1 (2026-10-03) — „wszystkie testy wyłącznie na Linuksie”; przegląd `security-engineer` i `devops-engineer` (oba CHANGES_REQUIRED, bez blokerów); wersja 2 (2026-10-03) — zakres doprecyzowany przez Konrada (cytaty 2–4 niżej): środowisko testów per warstwa; uwagi z przeglądów wprowadzone tam, gdzie kontener zostaje (backend); akceptacja Konrada (2026-10-03) z rozstrzygnięciem pytań 1–4 (sekcja „Decyzje Konrada przy akceptacji”).

## Kontekst i problem
Konrad, 2026-10-03, w dwóch krokach:
1. „Testy powinny być robione tylko na Linux. Na razie lokalnie przez Docker. Robienie testów na Windows mija się z celem.”
2. Doprecyzowanie: **„Niech testy Androida odbywają się na Windowsie normalnie przez emulator. Tylko backend niech będzie testowany na Linuksie, bo docelowo zostanie wgrany na środowisko z Linuksem. iOS na razie nie będziemy testować przez chmurę — iOS zostawiamy na potem. Z testowaniem na Linuksie chodzi o to, żeby cały backend był przygotowywany pod Linux docelowo. Co będzie szybsze. Nie upieram się przy przekonaniu, że testy na Windows są całkowicie niepotrzebne. Niech architekt podejmie najlepszą decyzję.”**

3. **„Frontend webowy raczej musi być testowany na przeglądarce na Windows, a nie tylko w CI. Taka moja opinia.”**
4. **„Android w CI nie jest na razie potrzebny.”**

Motywacją jest więc **parytet z platformą docelową każdej warstwy**, a nie zasada „wszystko w Linuksie”, oraz **szybkość pętli deweloperskiej**. Platformy docelowe: backend — serwery Linux (ADR-0011); panel web — przeglądarki na komputerach biura, czyli **Windows** (Chrome, Edge, Firefox); aplikacja mobilna — Android/iOS (system stacji nie jest częścią systemu pod testem).

Dlaczego teraz: EVM-006 (repozytorium, monorepo, CI) startuje jako następne, a ADR-0011/0014 i notatki EVM-006 nie rozstrzygają, gdzie uruchamia się testy backendu i co jest dowodem lokalnym.

Ograniczenia: jedna osoba akceptuje zmiany (Konrad, Windows 11 Home, Docker Desktop z backendem WSL2, edytor WebStorm); kod piszą agenci AI na tym samym hoście (Git Bash i PowerShell); mała firma — bez nowych płatnych usług; flota telefonów techników mieszana (ADR-0014).

**Stan zweryfikowany 2026-10-03 na stacji Konrada** (Docker Desktop: Engine 28.4.0, Compose v2.39.4, WSL2; 16 vCPU, ok. 31 GB RAM dla Dockera):

| Sprawdzenie | Wynik |
|---|---|
| `npm run test:tools` w utwardzonym kontenerze (definicja niżej: repozytorium `:ro`, bez sieci, użytkownik `node`, `read_only`, `cap_drop: [ALL]`, tmpfs `noexec`) | 189/189, pokrycie 100%; ok. 9 s (natywnie na Windows ok. 11 s) |
| `docs:check` natywnie vs w kontenerze | ok. 0,7 s vs ok. 3 s (narzut startu kontenera ok. 2 s) |
| `docker compose -f … run --rm tools npm run docs:check -- --list` z Git Bash | `--list` dociera do narzędzia; 0 błędów, 0 ostrzeżeń |
| Zapis w `/home/node` (tmpfs `uid=1000,gid=1000,mode=0700,noexec`) | działa; katalog należy do `node` |
| `git status` w kontenerze z `core.autocrlf=true` przez `GIT_CONFIG_*` | **czysty** (0 plików; bez tego ustawienia 92 fałszywe zmiany — Git for Windows ma systemowo `autocrlf=true`, indeks zawiera same LF) |
| Maskowanie ścieżek w montażu `:ro` (`/dev/null:/repo/.env:ro`, tmpfs na `/repo/secrets`) | **nie działa, gdy cel nie istnieje** — start kontenera kończy się błędem `read-only file system` (Docker nie może utworzyć punktu montowania); przy montażu do zapisu Docker utworzyłby na hoście puste pliki/katalogi. Wniosek: zamiast masek — montaż listy dozwolonych ścieżek (M2/M3 niżej) |
| Digest obrazu `node:22-bookworm` (`docker buildx imagetools inspect`) | indeks wieloarchitekturowy `sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7` (linux/amd64: `sha256:17b7fd60fd812617654c64b95f9b2dde94f103313073b672bc40fdad6dccbaa2`) |
| `/dev/kvm` w kontenerach Docker Desktop | brak — emulator Androida w kontenerze lokalnie nie ruszy |

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Parytet z platformą docelową każdej warstwy (backend → Linux, web → przeglądarki na Windows) | 5 | motywacja Konrada; klasa błędów „u mnie działa” w backendzie (ścieżki, wielkość liter, moduły natywne, ffmpeg/ClamAV, sygnały) i w UI (renderowanie czcionek, Edge, skalowanie ekranu Windows) |
| Szybkość pętli dev/test (TDD, debugowanie, przeglądarka i emulator z UI) | 5 | „Co będzie szybsze” |
| Prostota dla Konrada i agentów (jasna reguła „gdzie uruchamiam”) | 4 | agenci AI, jedna osoba akceptująca |
| Koszt utrzymania (skrypty i instrukcje dla wielu platform) | 4 | mały zespół, YAGNI |
| Bezpieczeństwo stacji (zależności i skrypty instalacyjne, sekrety) | 3 | łańcuch dostaw npm |
| Koszt (licencje, minuty CI, zasoby) | 2 | budżet |
| Odwracalność | 2 | |

## Rozważane opcje
1. **A. Wszystko w kontenerach Linux lokalnie + CI Linux** (wersja 1 tego ADR) — testy każdej warstwy w Compose; E2E Android i tak poza kontenerem (brak `/dev/kvm`).
2. **B. Wszystko natywnie na Windows + CI Linux** — Node, pnpm i narzędzia na Windows; Docker tylko dla usług (PostgreSQL, SeaweedFS, ClamAV) i Testcontainers.
3. **C. Per warstwa: backend w kontenerach Linux, reszta natywnie na Windows; CI Linux dla wszystkich warstw** — kod uruchamiany na serwerach (API, worker, media-processor, migracje) testowany lokalnie wyłącznie w kontenerze; web, mobile, pakiety współdzielone, `tools/` i dokumentacja — natywnie.
4. **D. Dystrybucja WSL2 (Ubuntu) dla całej pracy** — klon w systemie plików WSL2, narzędzia instalowane w dystrybucji, edytor i agenci zdalnie.

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Parytet z platformą docelową (5) | 4 | 3 | 5 | 4 |
| Szybkość pętli dev/test (5) | 2 | 5 | 4 | 3 |
| Prostota (4) | 3 | 4 | 3 | 2 |
| Koszt utrzymania (4) | 4 | 2 | 4 | 3 |
| Bezpieczeństwo stacji (3) | 4 | 3 | 3 | 4 |
| Koszt (2) | 4 | 5 | 5 | 5 |
| Odwracalność (2) | 4 | 5 | 5 | 3 |
| **Suma ważona (maks. 125)** | **86** | **93** | **102** | **83** |

Uzasadnienie ocen:
- **A** — parytet backendu pełny, ale panel web testowany w przeglądarkach linuksowych, a nie tych, których używa biuro (brak Edge, inne renderowanie czcionek i skalowanie); najwolniejsza pętla: narzut startu kontenera, wolny montaż `node_modules` z dysku Windows, brak przeglądarki z UI (tryb UI Playwright) i emulatora w kontenerze, a edytor na Windows i tak potrzebuje własnych `node_modules` (przegląd devops: problem WebStorm).
- **B** — najszybsza i z parytetem web, ale backend testowany na innej platformie niż produkcja; skrypty backendu (ffmpeg, ścieżki, moduły natywne, np. `argon2`) musiałyby działać na Windows — dokładnie koszt, którego Konrad nie chce.
- **C** — parytet każdej warstwy z jej platformą: backend w Linuksie, web w przeglądarkach Windows (Chrome, Edge, Firefox — jak w biurze), mobile na emulatorze Androida; szybka pętla dla UI, edytor działa na natywnych `node_modules`. Minus: dwa tryby uruchamiania (jasna reguła per warstwa w tabeli niżej) i instalacja zależności na hoście (mitygacja: ustawienia łańcucha dostaw pnpm 11).
- **D** — parytet backendu i szybki system plików, ale web w przeglądarkach Linux (przez WSLg), przeniesienie pracy edytora i agentów do WSL2, ręczna instalacja narzędzi (dryf), a emulator Androida i tak lepiej działa na hoście (dokumentacja Maestro odradza WSL).

Informacje o wersjach, licencjach i kosztach zweryfikowane 2026-10-03 (sekcja „Źródła”).

## Decyzja
Wybieramy **C. Środowisko testów per warstwa: backend lokalnie wyłącznie w kontenerach Linux (Docker Desktop + Compose); panel web natywnie na Windows w przeglądarkach biura (Chrome, Edge, Firefox); mobile i E2E Android natywnie na Windows z emulatorem; pakiety współdzielone, `tools/` i dokumentacja natywnie; CI na runnerach Linux jako dodatkowa bramka merge (bez emulatora Androida); iOS i E2E Android w CI odłożone** — ponieważ daje parytet każdej warstwy z jej platformą docelową, najszybszą pętlę dla UI i narzędzi oraz najniższy koszt utrzymania, bez nowych płatnych usług.

### Decyzje Konrada przy akceptacji (2026-10-03)
Pytania otwarte wersji 2 — rozstrzygnięte:
1. **Podział per warstwa** — zaakceptowany.
2. **iOS — odłożony w całości**, nie tylko testy automatyczne: pilotaż tylko na Androidzie; bez buildów iOS w EAS i bez scenariuszy iOS w spike'u EVM-011 na razie; decyzja o iOS przed planowaniem wydania iOS. Kod mobilny pozostaje zgodny z iOS (Expo). Zmiany AC EVM-009 i EVM-011 wprowadza `product-owner`; zakres platform w ADR-0007 doprecyzowany notką.
3. **Sekrety usług zewnętrznych nigdy w katalogu repozytorium** — obowiązuje od 2026-10-03 (sekcja „Sekrety (M2)”, `docs/security/README.md`).
4. **Uprawnienia agentów:** reguły `deny`/`ask` wprowadzone od razu (wykonane 2026-10-03 przez orkiestratora w `.claude/settings.json`); dokładne reguły `allow` dla `backend-tests` — razem z `compose.yaml` w EVM-006; bez stałej zgody na push gałęzi `feature/*`.

### Co jest dowodem — per warstwa
„Dowód” = wynik, który agent wpisuje do raportu i który liczy się w Definition of Done i na demo. Bramką merge zawsze jest CI Linux (po EVM-006).

| Warstwa / bramka | Dowód lokalny (raport agenta, DoD) | CI Linux (bramka merge) | Uwagi |
|---|---|---|---|
| **Backend**: API, worker, media-processor, migracje — jednostkowe, integracyjne (PostgreSQL, S3, ClamAV), kontraktowe, macierz ról, uprawnienia bazy | **tylko kontener Linux** (`docker compose -f compose.yaml run --rm backend-tests …`, od EVM-006). Wynik natywny na Windows **nie jest dowodem** | tak | nowe skrypty backendu piszemy tylko pod Linuksa |
| Pakiety współdzielone (kontrakt, `sync-core`, tokeny, typy generowane) | natywnie na Windows | tak | wykonywane też pośrednio w testach backendu w kontenerze |
| Format, lint, typy, granice modułów, kontrakt (Redocly, oasdiff, regeneracja klientów) | natywnie na Windows | tak | determinizm generowanego kodu zapewnia `.gitattributes` (`eol=lf`) |
| **Web**: Vitest (jednostkowe, komponentowe z axe), Playwright E2E | **natywnie na Windows, w przeglądarkach biura:** Chromium/Chrome, **Edge** (kanał `msedge`), Firefox | tak — dodatkowa bramka (Chromium, Firefox, WebKit na Linuksie) | WebKit (Safari) tylko w CI Linux. **Testy zrzutów ekranu** (`toHaveScreenshot`) — wzorce generowane i porównywane wyłącznie w CI Linux / obrazie Playwright (renderowanie różni się między systemami); lokalnie na Windows — tylko asercje funkcjonalne i a11y. Job Windows w CI — patrz „E2E web na runnerze Windows w CI” |
| **Mobile**: Jest + jest-expo, logika w Vitest, lint, typy | natywnie na Windows | tak — szybkie joby bez emulatora (unit, lint, typy) | |
| **E2E Android** (Maestro) | **emulator Androida na Windows** (Android Studio, akceleracja WHPX) + Maestro CLI — jedyny dowód | **odłożone** — warunek powrotu niżej | system pod testem to Android |
| **iOS** (build, E2E, testy ręczne) | **odłożony cały iOS** (decyzja Konrada 2026-10-03): pilotaż tylko na Androidzie, bez buildów iOS w EAS i bez scenariuszy iOS w spike'u EVM-011; decyzja o iOS przed planowaniem wydania iOS | — | kod mobilny pozostaje zgodny z iOS (Expo); ADR-0014 już przewidywał E2E iOS dopiero przed wydaniem |
| `tools/` (`test:tools`), `docs:check`, `docs:cleanup` | natywnie na Windows (`npm run …`, Node ≥ 22.15, bez instalacji zależności) | tak (EVM-013) | szybciej (0,7 s vs 3 s); kod narzędzia jest przenośny i przetestowany na Windows (EVM-012 AC3) |
| Skany (gitleaks, Semgrep, OSV-Scanner, Trivy) | gitleaks w hooku pre-commit (natywny plik binarny lub obraz z digestem — EVM-006) | tak (bramka wiążąca) | |
| Mutacyjne, Schemathesis, ZAP, k6 | nie | nocą / staging | bez zmian (ADR-0014) |
| Test terenowy na telefonach | — | — | test ręczny (checklista `testing-strategy.md`) |

Zasady:
1. Windows 11 jest hostem i platformą testów warstw, których środowiskiem docelowym nie jest serwer (web — przeglądarki biura na Windows; mobile — emulator Androida).
2. Kod uruchamiany na serwerach testujemy lokalnie wyłącznie w kontenerze Linux; nie wymagamy, by działał natywnie na Windows.
3. Jedna komenda bramki lokalnej (ADR-0012) zostaje: na hoście, a część backendowa deleguje do kontenera (`docker compose -f compose.yaml run --rm backend-tests …`) — szczegóły EVM-006.
4. Do merge potrzebne są oba wyniki: dowód lokalny właściwy dla warstwy **i** zielone CI Linux. Rozbieżność (lokalnie zielone, CI czerwone lub odwrotnie) to błąd do wyjaśnienia, nie do pominięcia — dla backendu rozstrzyga Linux, dla web nie wolno „naprawić” testu tak, by przestał sprawdzać zachowanie w przeglądarkach Windows.

### E2E web na runnerze Windows w CI — ocena
- Koszt (GitHub Actions, cennik 2026): runner Windows 2-core 0,010 USD/min vs Linux 0,006 USD/min (≈ 1,7×); dokumentacja GitHub po zmianie cennika ze stycznia 2026 nie publikuje już mnożnika zużycia minut wliczonych (historycznie Windows ×2) — do planowania przyjmujemy ostrożnie ×2 względem puli 3000 min/mies. (GitHub Pro). Przebieg E2E web na Windows: szacunkowo 8–15 min (instalacja zależności i przeglądarek + testy), czyli 16–30 min puli na przebieg.
- Wartość: dubluje dowód lokalny (Windows + Chrome/Edge/Firefox), który i tak jest wymagany w DoD; zyskiem byłaby tylko powtarzalność na czystej maszynie i Edge w CI.
- **Rekomendacja: nie na każdy PR.** Job `e2e-web-windows` (`windows-latest`, Chromium + `msedge` + Firefox, bez testów zrzutów ekranu) uruchamiany **ręcznie (`workflow_dispatch`) i przed każdym wydaniem** — dodawany w EVM-008 (pierwszy panel web) lub przed pierwszym wydaniem, nie wcześniej (YAGNI). Przy 1–2 wydaniach miesięcznie to < 2% puli. Na każdy PR — dopiero jeśli w retrospektywie M1 wystąpią regresje widoczne tylko na Windows, które przeszły lokalnie.

### E2E Android w CI — odłożone (warunek powrotu)
Decyzja Konrada (2026-10-03): „Android w CI nie jest na razie potrzebny.” Dowodem E2E Android jest wyłącznie przebieg Maestro na emulatorze na Windows (raport agenta z wynikiem i wersją emulatora/API). W CI dla mobile tylko szybkie joby bez emulatora (Jest, Vitest dla `sync-core`, lint, typy) — tanie i wyłapują większość regresji logiki. **Warunek powrotu** (pierwszy, który nastąpi): przed pierwszym wydaniem aplikacji mobilnej technikom (pilotaż terenowy), najpóźniej przy planowaniu M2; albo gdy regresja Androida przejdzie przez lokalny dowód (np. pominięty przebieg) albo nad aplikacją mobilną pracuje równolegle więcej niż jedna osoba/agent. Wtedy osobny ADR lub notka: emulator z KVM na runnerze Linux, uruchamianie przy zmianach `apps/mobile/**` i nocą, pomiar minut.

### Uprawnienia agentów (M1, M4) — rozstrzygnięte (odpowiedź 4)
- **Reguły `allow` dokładne, z jawnym plikiem** (`-f compose.yaml` wyłącza `compose.override.yaml` i zmienną `COMPOSE_FILE`), bez wieloznacznika `npm run:*`/`pnpm run:*` po nazwie usługi. Wzór (ostateczne nazwy skryptów — EVM-006): `Bash(docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend)`, `Bash(docker compose -f compose.yaml run --rm backend-tests pnpm run test:backend:*)`. Te same formy w `CLAUDE.md` i definicjach agentów. Usługa `backend-tests` bez interpolacji `${...}` (zmienne środowiska hosta nie mogą zmienić montaży ani obrazu).
- **`deny`/`ask` (wprowadzone 2026-10-03 w `.claude/settings.json`):** edycja `**/compose*.y*ml`, `**/docker-compose*.y*ml`, `.claude/settings.json`; `Bash(docker run:*)`, `Bash(docker exec:*)`, `Bash(docker cp:*)`; `git push` do `main`, `git push --delete`, `--mirror`, `--all`, `--tags`.
- **Tryb bypass:** reguły `allow` nic wtedy nie chronią — liczą się wyłącznie `deny` i zasada sekretów (M2). Kontener nie jest granicą bezpieczeństwa wobec tego, co agent może zrobić na hoście.
- **Push gałęzi `feature/*` (M4):** stała zgoda — **nie teraz** (potwierdzone przez Konrada 2026-10-03). Dowód lokalny istnieje dla każdej warstwy, a przed EVM-006 CI nie istnieje. Zgoda per historyjka wraca jako temat w EVM-006, gdy działają: ruleset `main` (tylko PR), Environments ograniczone do `main`, `permissions: contents: read` domyślnie, akcje przypięte po SHA, gitleaks przed pushem, CODEOWNERS na `.github/**`, `.claude/**`, `compose*.yaml`.
- Zmiana `.claude/settings.json` wymaga **osobnej zgody Konrada** — udzielonej 2026-10-03 dla `deny`/`ask` (lista zmian po akceptacji, pozycja 9); reguły `allow` dla `backend-tests` — w EVM-006.

### Sekrety (M2) — zasada (obowiązuje od 2026-10-03, odpowiedź 3)
- Sekrety usług zewnętrznych (EAS, GitHub, Scaleway, Sentry, Grafana Cloud, konta Apple/Google) **nigdy w katalogu repozytorium** — w menedżerze sekretów albo poza repo (np. `%USERPROFILE%\.evia\`). W repo (ignorowane przez git) wyłącznie syntetyczne sekrety dev (hasło lokalnego PostgreSQL itp.).
- Obrona w głąb w kontenerze: zamiast masek (nie działają w montażu `:ro`, gdy cel nie istnieje — sprawdzone) montujemy **listę dozwolonych ścieżek** (np. `apps/api`, `apps/worker`, `packages`, manifesty i lockfile), bez katalogu głównego z plikami lokalnymi; konfiguracja dev przez `environment:` z wartościami syntetycznymi w `compose.yaml`, nie przez `.env` z hosta. Własny Dockerfile → `.dockerignore` (m.in. `.env*`, `secrets/`, `.git`, `.claude`, `.idea`).

### Uruchamianie lokalnie — na teraz (przed EVM-006)
Bez zmian w poleceniach: `npm run test:tools` i `npm run docs:check` natywnie (Node ≥ 22.15), jak w `CLAUDE.md`. `compose.yaml` **nie powstaje teraz** — pierwszą usługą kontenerową jest `backend-tests` w EVM-006 (nie ma jeszcze backendu). Forma zapasowa `docker run` z wersji 1 — usunięta (m2).

Zweryfikowany zestaw utwardzeń kontenera (2026-10-03, na `test:tools` i `docs:check -- --list` jako obciążeniu testowym; plik roboczy poza repozytorium). To punkt wyjścia dla `backend-tests` w EVM-006:

```yaml
# Dev only (ADR-0015): verified hardening baseline for the Linux test container. Never used on staging/prod.
# Always run with an explicit file: docker compose -f compose.yaml run --rm <service> ...
name: evia-manager
services:
  tools:
    # EVM-006: node:26-bookworm (or trixie), tag + digest, updated by Renovate with a cooldown
    image: node:22-bookworm@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7
    init: true
    user: node
    working_dir: /repo
    volumes:
      - .:/repo:ro
    environment:
      GIT_CONFIG_COUNT: "2"
      GIT_CONFIG_KEY_0: safe.directory
      GIT_CONFIG_VALUE_0: /repo
      GIT_CONFIG_KEY_1: core.autocrlf
      GIT_CONFIG_VALUE_1: "true"
      NPM_CONFIG_UPDATE_NOTIFIER: "false"
    network_mode: none
    read_only: true
    tmpfs:
      - /tmp:noexec
      - /home/node:uid=1000,gid=1000,mode=0700,noexec
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
```

Ustalenia:
- `GIT_CONFIG_*` zamiast `git config` w `bash -c` — polecenie zostaje zwykłym `npm run …`/`pnpm run …`, bez powłoki. `core.autocrlf=true` w kontenerze usuwa fałszywe różnice od razu (sprawdzone: `git status` czysty), niezależnie od `.gitattributes`.
- Forma Compose nie ma ścieżek w argumentach, więc w Git Bash nie wymaga `MSYS_NO_PATHCONV`; `docker.exe` to program natywny, więc gołe `--` dociera do narzędzia także z PowerShell 5.1.
- tmpfs `/home/node` z `uid/gid/mode` (domyślny tmpfs należy do roota — `node` nie mógłby pisać) i `noexec` na obu tmpfs.

### Po EVM-006 (wytyczne dla `devops-engineer`)
1. **`compose.yaml` w katalogu głównym, usługa `backend-tests`** na bazie zestawu wyżej; usługi z ADR-0011 (PostgreSQL 18, SeaweedFS, ClamAV, media-processor, Mailpit, API, worker) z profilami Compose. Porty usług dev publikowane wyłącznie na `127.0.0.1:…` (m4). Wszystkie obrazy w Compose i CI jako **tag + digest**, aktualizowane przez Renovate z karencją (m1).
2. **Obraz `backend-tests`:** własny Dockerfile na `node:26-bookworm` albo `node:26-trixie` (digest; wybór dystrybucji w EVM-006 — trixie to bieżący Debian stable, bookworm — oldstable) z pnpm w wersji z `packageManager`; `.dockerignore`. Node 26 wchodzi w LTS 2026-10-28 (ADR-0002); jedna wersja główna w `engines`, `.nvmrc`, obrazie i `setup-node`.
3. **Montaże i zapis (M3):** kod `:ro` z listy dozwolonych ścieżek (`.git` — tylko `:ro` i tylko jeśli potrzebne pokrycie zmienionego kodu); zapis tylko do wolumenów nazwanych (`node_modules` Linux, magazyn pnpm) i katalogów wyjściowych (`coverage/`, `test-results/`, `playwright-report/`). Punkty montowania wewnątrz montażu `:ro` muszą istnieć — projektować tak, by wolumeny zapisywalne nie były zagnieżdżone w montażu `:ro` albo by `node_modules` były w obrazie/wolumenie poza drzewem montowanym z hosta. Jeśli zapis do repo okaże się konieczny — nakładki `:ro` na `.git`, `.claude`, `CLAUDE.md`, `.github`, `.vscode`, `lefthook.yml`, `compose*.yaml`.
4. **Instalacja zależności** w kontenerze osobnym krokiem z siecią, testy bez dostępu do internetu (sieć Compose `internal: true` z usługami bazy/S3/ClamAV). Ustawienia łańcucha dostaw pnpm 11 (te same na hoście): `allowBuilds` — jawna lista pakietów, którym wolno uruchomić skrypty instalacyjne (w pnpm 11 zastępuje `onlyBuiltDependencies`), `minimumReleaseAge` (domyślnie 1 dzień — nie obniżać), `blockExoticSubdeps` (domyślnie włączone).
5. **`node_modules` na hoście a w kontenerze (devops, major):** decyzja C to rozstrzyga — host ma natywną instalację na Windows (edytor WebStorm rozwiązuje typy i uruchamia lint; web, mobile, `tools/`), kontener `backend-tests` ma osobne `node_modules` Linux w wolumenie, z tego samego lockfile. Warianty zapasowe, gdyby podwójna instalacja sprawiała problemy: (a) instalacja w kontenerze na dysk Windows z `supportedArchitectures: {os: [current, win32]}`; (b) Dev Containers / JetBrains Gateway; (c) WSL2. **Kryterium EVM-006:** z czystego klonu edytor na Windows rozwiązuje typy i uruchamia lint, a `backend-tests` przechodzi w kontenerze.
6. **Testy integracyjne a gniazdo Dockera (m3):** gniazdo nigdy w `allow` agentów i nigdy w `backend-tests`. Lokalnie preferujemy usługi z Compose (PostgreSQL, SeaweedFS, ClamAV) bez gniazda; Testcontainers — w CI (Docker natywnie na runnerze). Jeśli lokalnie potrzebne jest gniazdo — wyłącznie przez `docker-socket-proxy` z minimalnym zestawem API i z akceptacją ryzyka przez Konrada; `group_add: ["0"]` oznacza w praktyce root na maszynie Dockera. Testcontainers: kopiowanie plików do kontenera zamiast bind mountów.
7. **Testy zrzutów ekranu web (n1):** wzorce porównywane w CI Linux; lokalnie (aktualizacja wzorców) usługa z `mcr.microsoft.com/playwright:v<wersja>-noble` (wersja = `@playwright/test`), `shm_size: 1gb`, użytkownik `pwuser`, **bez** `--ipc=host`.
8. **Końce linii:** `.gitattributes` z `* text=auto eol=lf` (wyjątki binarne jawnie). Indeks ma już same LF, więc `git add --renormalize .` nie powinien zmienić treści; odświeżenie kopii roboczej jest opcjonalne.
9. **Hooki (lefthook):** natywnie na hoście; część backendowa przez `docker compose -f compose.yaml run --rm backend-tests …`.
10. **CI:** joby backendu bez potrzeby Dockera uruchamiane w tym samym obrazie co `backend-tests` (`container:` z digestem) — pełny parytet z lokalnym; joby z Testcontainers bezpośrednio na runnerze. Mobile w CI — tylko joby bez emulatora (Jest, Vitest, lint, typy); E2E Android w CI odłożone (warunek powrotu wyżej). Job `e2e-web-windows` — wg rekomendacji „E2E web na runnerze Windows w CI”.
11. **Pomiar:** czas bramki backendu lokalnie vs CI w raporcie EVM-006 (próg uwagi: > 2×). Płatne „Synchronized file shares” Docker Desktop — wyłącznie za zgodą Konrada.

### Wpływ na zaakceptowane ADR-y
Treści ADR-0011 i ADR-0014 nie zmieniamy. Po akceptacji orkiestrator dopisuje pod wierszem „Status” notkę i aktualizuje indeks. ADR-0012 **nie** jest zastępowany: kryterium „Działanie na Windows i w CI” pozostaje aktualne (web, mobile, narzędzia natywnie), jedna komenda bramki zostaje (część backendowa deleguje do kontenera), buildy EAS bez zmian.

| ADR | Zastąpiony fragment | Czy zmienia wybór narzędzi |
|---|---|---|
| ADR-0011 | „Decyzja” → „Środowiska”, wiersz `dev` — uzupełniony o kontener `backend-tests`: testy backendu lokalnie wyłącznie w kontenerze Linux; porty dev tylko na `127.0.0.1` | nie |
| ADR-0014 | „Kontekst” (wymaganie działania na Windows) — dla backendu zastąpione „Linux w kontenerze”; „Konsekwencje”: Testcontainers lokalnie → usługi Compose bez gniazda (Testcontainers w CI); „Decyzja” → E2E web: dowodem lokalnym są przeglądarki na Windows (Chrome, Edge, Firefox), CI Linux dodatkowo; E2E mobile: dowodem jest wyłącznie lokalny emulator Androida na Windows, E2E Android w CI odłożone (warunek powrotu), E2E iOS odłożone razem z całym iOS | **nie** — Vitest, Testcontainers, Playwright (75 vs 59), Maestro (92 vs 76 vs 68) bez zmian; kryterium Windows nadal obowiązuje dla web i mobile |

**Teksty notek** (`<data>` = data akceptacji ADR-0015, 2026-10-03; wpisane 2026-10-03):
- ADR-0011: `- **Częściowo zastąpiona przez:** [ADR-0015](0015-srodowisko-testow-per-warstwa.md) (<data>) — zakres: tabela „Środowiska”, wiersz `dev`: testy backendu uruchamiamy lokalnie wyłącznie na Linuksie w kontenerze `backend-tests` w dev Compose; porty usług dev publikowane tylko na `127.0.0.1`. Pozostała treść obowiązuje.`
- ADR-0014: `- **Częściowo zastąpiona przez:** [ADR-0015](0015-srodowisko-testow-per-warstwa.md) (<data>) — zakres: testy backendu lokalnie wyłącznie w kontenerze Linux (natywny wynik na Windows nie jest dowodem); lokalne testy integracyjne preferencyjnie przeciw usługom Compose bez gniazda Dockera, Testcontainers w CI; E2E web — dowodem lokalnym są przeglądarki na Windows (Chrome, Edge, Firefox), CI Linux dodatkowo, zrzuty ekranu tylko na Linuksie; E2E Android — dowodem jest emulator na Windows, w CI odłożone do warunku powrotu z ADR-0015; E2E iOS odłożone razem z całym iOS (decyzja przed planowaniem wydania iOS). Wybór narzędzi bez zmian. Pozostała treść obowiązuje.`
- Indeks `README.md`, kolumna „Status” dla 0011 i 0014: `Zaakceptowana · częściowo zastąpiona przez [0015](0015-srodowisko-testow-per-warstwa.md)`; w legendzie statusów: „Decyzję zaakceptowaną można też **częściowo zastąpić** nowym ADR — status zostaje „Zaakceptowana”, a pod nim notka z zakresem i linkiem.”

### Zmiany w dokumentach po akceptacji
Stan 2026-10-03: pozycje 1–4, 8, 9 i 10 (część `docs/security/README.md`) wykonane; 5–7 — `product-owner` (backlog); ryzyka R1–R3 — threat model w EVM-005.
Polecenia `npm run test:tools`, `npm run docs:check`, `npm run docs:cleanup` i obejście `'--'` zostają bez zmian, więc testy EVM-012 (`project-docs.test.mjs`) nie wymagają zmian.

1. **`CLAUDE.md` → „Stack i komendy”:** w nagłówku „ADR 0001–0015”; nowy wiersz: „**Gdzie uruchamiamy testy (ADR-0015):** backend — lokalnie wyłącznie w kontenerze Linux (`docker compose -f compose.yaml run --rm backend-tests …`, od EVM-006); web — natywnie na Windows w przeglądarkach biura (Chrome, Edge, Firefox); mobile i E2E Android — natywnie na Windows z emulatorem (E2E Android w CI odłożone); pakiety współdzielone, `tools/` i dokumentacja — natywnie; iOS — odłożone; CI Linux to dodatkowa bramka merge (zrzuty ekranu web tylko tam); rozbieżność lokalnie/CI wyjaśniamy, nie pomijamy.” Pozostałe wiersze bez zmian.
2. **`docs/process/testing-strategy.md`** — nowa sekcja „Gdzie uruchamiamy testy (ADR-0015)” z tabelą „Co jest dowodem — per warstwa” (skrót) i zasadą: testy nie zależą od strefy hosta — strefę `Europe/Warsaw` ustawia sam test.
3. **`docs/process/definition-of-done.md`** — nowy punkt: „- [ ] Testy uruchomione w środowisku właściwym dla warstwy (ADR-0015): backend w kontenerze Linux, web w przeglądarkach na Windows, E2E Android na emulatorze na Windows; testy zrzutów ekranu tylko na Linuksie; CI zielone.”
4. **Definicje agentów:** `backend-developer` — „Testy backendu uruchamiasz lokalnie wyłącznie w kontenerze `backend-tests` (ADR-0015); wynik natywny na Windows nie jest dowodem.”; `devops-engineer` — „Polecenia backendu w `CLAUDE.md` w formie `docker compose -f compose.yaml run --rm backend-tests …`; obrazy tag + digest; skrypty backendu nie muszą działać na Windows.”; `mobile-developer` — „E2E Android: dowodem lokalnym jest Maestro na emulatorze Androida na Windows; iOS odłożone (ADR-0015).”; `web-developer` — „Dowodem E2E web są przebiegi Playwright na Windows w Chromium, Edge (`msedge`) i Firefox; testy zrzutów ekranu tylko w obrazie Playwright lub CI (ADR-0015).” Wiersz o `docs:check` bez zmian.
5. **`docs/backlog/M0/EVM-006-repozytorium-i-ci.md` → „Notatki techniczne”** (product-owner, bez zmiany AC): zdanie o Windows → „Środowisko Konrada: Windows 11. Testy per warstwa (ADR-0015): backend w kontenerach Linux (`backend-tests` + usługi z ADR-0011), web/mobile/narzędzia natywnie na Windows; CI Linux dla wszystkich warstw.”; akapit „Środowisko lokalne (… demo EVM-012)” uzupełnić o „doprecyzowane w ADR-0015: w kontenerach — backend”; nowy punkt: „Z ADR-0015 → „Po EVM-006”: `compose.yaml` z `backend-tests` (utwardzenia, digest, `-f`), lista dozwolonych montaży, osobne `node_modules` host/kontener i kryterium edytora, pnpm 11 `allowBuilds`/`minimumReleaseAge`, sieć `internal`, porty `127.0.0.1`, `.gitattributes`, joby CI w obrazie `backend-tests`, E2E Android w CI warunkowo, pomiar czasu.”
6. **`docs/backlog/M0/EVM-009-szkielet-aplikacji-mobilnej.md` → „Notatki techniczne”:** „Testy (AC4) wg ADR-0015: jednostkowe i komponentowe natywnie i w CI Linux; test dymny E2E — Maestro na emulatorze Androida na Windows (jedyny dowód; E2E Android w CI odłożone do warunku powrotu z ADR-0015); w CI tylko joby bez emulatora. iOS odłożony (ADR-0015, odpowiedź 2)” — AC5 obejmuje iOS: zmiana AC przez product-ownera (iOS odłożony w całości).
7. **`docs/backlog/M0/EVM-011-spike-kolejka-offline-i-upload-w-tle.md`:** AC2 („osobno iOS i Android”) — zmiana AC przez product-ownera: tylko Android (odpowiedź 2); zdanie o Windows → „Scenariusze Androida na emulatorze na Windows i na fizycznym telefonie (ADR-0015).”
8. **`docs/architecture/README.md`** — w tabeli stacku pod „Testy”: `| Środowisko testów | Per warstwa: backend w kontenerach Linux, web w przeglądarkach na Windows, mobile i E2E Android na emulatorze Windows, narzędzia natywnie; CI Linux jako dodatkowa bramka (bez emulatora); iOS odłożony | [0015](adr/0015-srodowisko-testow-per-warstwa.md) |`.
9. **`.claude/settings.json`** — reguły `deny`/`ask` z sekcji „Uprawnienia agentów” — **wykonane 2026-10-03 (orkiestrator)**, za zgodą Konrada (odpowiedź 4); dokładne reguły `allow` dla `backend-tests` — razem z `compose.yaml` w EVM-006.
10. **`docs/security/README.md` / EVM-005 (threat model):** zasada sekretów poza repo (M2) — wpisana do `docs/security/README.md` 2026-10-03; ryzyka rezydualne R1–R3 — do threat-modelu w EVM-005.

## Konsekwencje
- **Pozytywne:** backend testowany na tej samej platformie co produkcja (Linux), bez kosztu przenośności na Windows; panel web testowany w tych samych przeglądarkach i systemie co biuro (w tym Edge); szybka pętla dla web, mobile i narzędzi (przeglądarka i emulator z UI, brak narzutu kontenera); brak kosztu minut emulatora w CI; edytor działa na natywnych `node_modules`; E2E Android ma dowód lokalny bez pushu; polecenia `tools/` i dokumentacji bez zmian; brak nowych kosztów.
- **Negatywne / koszty:** dwa tryby uruchamiania (reguła per warstwa musi być w `CLAUDE.md` i u agentów); dwie instalacje zależności z jednego lockfile (host Windows i kontener Linux); zależności npm i ich skrypty instalacyjne działają na hoście z uprawnieniami użytkownika (mitygacja: pnpm 11 `allowBuilds`, `minimumReleaseAge`); możliwe rozbieżności web/mobile między Windows a CI Linux (rozstrzyga CI); Docker Desktop potrzebny do testów backendu (licencja: 0 zł — EVia Charge mieści się w progach bezpłatnego użycia: < 250 pracowników i < 10 mln USD przychodu); iOS (buildy, testy, pilotaż) odłożony do decyzji przed planowaniem wydania iOS.
- **Ryzyka i mitygacje:**
  - *R1 (rezydualne) — tryb bypass agentów: kontener nie jest granicą wobec sekretów leżących w repozytorium* → zasada M2 (żadnych prawdziwych sekretów w katalogu repo), `deny` w `settings.json`, montaż listy dozwolonych ścieżek; do threat-modelu w EVM-005.
  - *R2 (rezydualne) — gniazdo Dockera = kontrola nad maszyną Dockera i współdzielonymi katalogami hosta* → nigdy w `allow` i w `backend-tests`; lokalnie usługi Compose bez gniazda; jeśli konieczne — socket-proxy z akceptacją Konrada; do EVM-005.
  - *R3 (rezydualne) — obrazy bez weryfikacji podpisu* → digesty + Renovate z karencją; weryfikacja podpisów/atestacji do rozważenia w EVM-005.
  - *iOS odłożony w całości przy mieszanej flocie telefonów* — upload w tle na iOS (ADR-0007/0009) jest najbardziej ryzykownym elementem aplikacji mobilnej i nie zostanie sprawdzony w spike'u EVM-011; pilotaż tylko na Androidzie (technicy z iPhone'ami poza pilotażem) → decyzja Konrada (odpowiedź 2); kod mobilny pozostaje zgodny z iOS (Expo), bez bibliotek tylko-Android tam, gdzie istnieje odpowiednik dla obu platform; przy decyzji o iOS (przed planowaniem wydania iOS) — spike uploadu w tle na iOS jako pierwszy krok, przed zobowiązaniem terminu.
  - *Rozbieżności web między Windows a CI Linux (czcionki, ścieżki w testach)* → zrzuty ekranu tylko na Linuksie; rozbieżność wyjaśniana (zasada 4); liczba mierzona w retrospektywie M1; przy regresjach tylko-Windows — job `e2e-web-windows` na każdy PR.
  - *Wolny montaż z dysku Windows dla backendu* → `node_modules` w wolumenach, pomiar w EVM-006; w ostateczności klon w WSL2 (opcja D) albo płatne „Synchronized file shares” — tylko za zgodą Konrada.
  - *Brak E2E Android w CI — dowód zależy od dyscypliny lokalnej (pominięty przebieg, inna wersja emulatora)* → raport agenta musi zawierać wynik Maestro z wersją API emulatora; orkiestrator weryfikuje sam przed demo; warunek powrotu E2E Android do CI (wyżej).
  - *Zmiana warunków licencji Docker Desktop* → Podman Desktop / Rancher Desktop / Docker Engine w WSL2 — ten sam `compose.yaml`.
  - *Agent bez działającego Dockera* → testy backendu: „sprawdzenie wykona orkiestrator”; pozostałe warstwy natywnie bez zmian.

## Plan wyjścia
- **Do B (backend natywnie):** pominąć prefiks `docker compose -f compose.yaml run --rm backend-tests` i doprowadzić skrypty backendu do działania na Windows; koszt rośnie z czasem (skrypty pisane tylko pod Linuksa).
- **Do A (wszystko w kontenerach):** dodać usługi dla web/mobile w tym samym `compose.yaml`; koszt: dni (bez E2E Android — brak `/dev/kvm`).
- **Do D (WSL2):** klon w systemie plików WSL2, te same polecenia Compose; koszt: dzień.

## Weryfikacja
- **Przed akceptacją (wykonane 2026-10-03):** zestaw utwardzeń z sekcji „Na teraz” — `test:tools` 189/189 (pokrycie 100%), `docs:check -- --list` 0 błędów, zapis w `/home/node`, `git status` w kontenerze czysty, digest obrazu.
- **EVM-006:** z czystego klonu: edytor na Windows rozwiązuje typy i uruchamia lint; bramka backendu przechodzi w `backend-tests` i w CI z tym samym wynikiem; czas lokalnie vs CI w raporcie; porty tylko `127.0.0.1`; wszystkie obrazy z digestem.
- **EVM-009:** przepływ Maestro przechodzi na emulatorze Androida na Windows (wynik z wersją API w raporcie); CI mobile — joby bez emulatora.
- **EVM-008:** E2E web przechodzi lokalnie na Windows w Chromium, Edge i Firefox oraz w CI Linux.
- **Retrospektywa M1:** liczba rozbieżności „lokalnie zielone / CI czerwone” per warstwa (cel: 0 dla backendu) i uwagi Konrada o szybkości pracy; przegląd decyzji.

## Źródła (zweryfikowane 2026-10-03)
- Docker Desktop — licencja: https://docs.docker.com/subscription/desktop-license/ ; plany: https://www.docker.com/pricing/
- Docker Desktop + WSL2 — wydajność montażu: https://docs.docker.com/desktop/features/wsl/best-practices/ ; Synchronized file shares: https://docs.docker.com/desktop/features/synchronized-file-sharing/
- Brak `/dev/kvm` w kontenerach Docker Desktop: https://github.com/microsoft/wsl/issues/40736 , https://github.com/microsoft/WSL/issues/13262
- Node.js — wydania: https://nodejs.org/en/about/previous-releases ; obrazy `node` (bookworm, trixie): https://hub.docker.com/_/node ; digest pobrany `docker buildx imagetools inspect node:22-bookworm` (2026-10-03)
- pnpm 11 — `allowBuilds` zastępuje `onlyBuiltDependencies`, `minimumReleaseAge` domyślnie 1 dzień, `blockExoticSubdeps`: https://pnpm.io/blog/releases/11.0 , https://pnpm.io/supply-chain-security
- Playwright w Dockerze (obraz `-noble`, wersja = pakiet, użytkownik `pwuser`): https://playwright.dev/docs/docker
- Testcontainers w kontenerze (gniazdo Dockera): https://java.testcontainers.org/supported_docker_environment/continuous_integration/dind_patterns/
- Emulator Androida z KVM na runnerach Linux (na czas powrotu E2E Android do CI): https://github.com/ReactiveCircus/android-emulator-runner
- GitHub Actions — ceny runnerów 2026 (Linux 2-core 0,006 USD/min, Windows 2-core 0,010 USD/min; 3000 min wliczonych w Pro): https://docs.github.com/en/billing/concepts/product-billing/github-actions , https://docs.github.com/en/billing/reference/actions-minute-multipliers ; historyczny mnożnik Windows ×2: https://trimci.com/learn/github-actions-billing-explained/
- Playwright — kanały przeglądarek (`msedge`): https://playwright.dev/docs/browsers
- Maestro CLI — instalacja (WSL odradzane): https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli
- Pomiary lokalne: stacja Konrada, 2026-10-03 — opis w „Kontekście”.
