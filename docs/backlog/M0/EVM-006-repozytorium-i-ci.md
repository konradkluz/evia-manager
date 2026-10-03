---
id: EVM-006
title: Repozytorium, monorepo i CI z bramkami jakości
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: devops-engineer
contributors: []
reviewers: [code-reviewer, security-engineer]
depends_on: [EVM-001]
---

# EVM-006: Repozytorium, monorepo i CI z bramkami jakości

## Historyjka
Jako **zespół** chcemy **repozytorium z automatycznymi bramkami jakości od pierwszego dnia**, aby **żadna zmiana nie obniżyła jakości, pokrycia testami ani bezpieczeństwa**.

## Kontekst
Stack i narzędzia: ADR-y z EVM-001. Progi: `docs/process/testing-strategy.md`. Lista skanów: EVM-005 (jeśli gotowa; inaczej standardowy zestaw, uzupełniany później).

## Kryteria akceptacji
**AC1 — Repozytorium**
- Gdy klonuję repozytorium i wykonuję instrukcję z README
- Wtedy uruchamiam środowisko od zera; struktura monorepo jest zgodna z ADR. Repozytorium zdalne (np. prywatne na GitHub) tworzone wyłącznie za zgodą Konrada.

**AC2 — Bramka lokalna**
- Gdy uruchamiam jedno polecenie bramki
- Wtedy wykonuje się lint, formatowanie, sprawdzanie typów i testy z pomiarem pokrycia dla wszystkich aplikacji i pakietów.

**AC3 — Progi pokrycia**
- Zakładając progi z `testing-strategy.md` (w tym ≥ 90% pokrycia zmienionego kodu)
- Gdy zmiana obniża pokrycie poniżej progu
- Wtedy bramka kończy się błędem (dowód w raporcie: celowo niepokryty kod → czerwona bramka).

**AC4 — CI**
- Gdy powstaje PR lub push
- Wtedy CI wykonuje: instalację z lockfile → lint → typy → testy i pokrycie → build → skany (SAST, zależności, sekrety); czerwony etap blokuje merge do `main` (konfiguracja lub instrukcja ochrony gałęzi).

**AC5 — Sekrety**
- Wtedy istnieje `.env.example`, skan sekretów działa w pre-commit i CI, `.gitignore` jest rozszerzony pod stack.

**AC6 — Design tokens**
- Wtedy tokeny z `design/tokens/` są automatycznie przetwarzane do formatów web i mobile (przy braku EVM-003 — na przykładowym tokenie).

**AC7 — Instrukcje dla agentów**
- Wtedy sekcja „Stack i komendy” w `CLAUDE.md` zawiera polecenia: instalacja, uruchomienie, testy, lint, typy, pokrycie, E2E; `testing-strategy.md` → „Narzędzia” jest uzupełnione.

**AC8 — Aktualizacje zależności**
- Wtedy skonfigurowany jest bot aktualizacji zależności z grupowaniem zmian.

## Poza zakresem
Środowiska chmurowe i wdrożenia (EVM-007), kod aplikacji (EVM-008, EVM-009).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
Akcje CI przypięte do wersji/SHA, minimalne uprawnienia tokenów CI, brak sekretów w logach.

## Notatki techniczne
Środowisko Konrada: Windows 11. Testy per warstwa (ADR-0015): backend w kontenerach Linux (`backend-tests` + usługi z ADR-0011), web/mobile/narzędzia natywnie na Windows; CI Linux dla wszystkich warstw.

Środowisko lokalne (Konrad, 2026-10-03, demo EVM-012): Konrad będzie pracował lokalnie na **Dockerze** i tam uruchamiał środowisko — instrukcja uruchomienia (AC1) i bramka lokalna (AC2) muszą działać w kontenerach (Docker Desktop na Windows 11); natywne uruchomienie na Windows — opcjonalnie. Doprecyzowane w ADR-0015: w kontenerach — backend.

Z ADR-0015 (zaakceptowany 2026-10-03, bez zmiany AC):
- „Po EVM-006”: `compose.yaml` z `backend-tests` (utwardzenia, digest, `-f`), lista dozwolonych montaży, osobne `node_modules` host/kontener i kryterium edytora, pnpm 11 `allowBuilds`/`minimumReleaseAge`, sieć `internal`, porty `127.0.0.1`, `.gitattributes`, joby CI w obrazie `backend-tests`, E2E Android w CI warunkowo, pomiar czasu.
- Sekrety usług zewnętrznych (prawdziwe klucze, tokeny, certyfikaty) **nigdy w katalogu repozytorium** — także nie w plikach ignorowanych przez git; w repo wyłącznie `.env.example` z wartościami przykładowymi (dotyczy AC5 i instrukcji z AC1).

Przejęcie z EVM-012 (dopisane 2026-10-03 po przeglądzie `solution-architect`, bez zmiany AC):
- Główny `package.json` z EVM-012 (minimalny: `private: true`, bez zależności) ma trzy skrypty — `docs:check`, `docs:cleanup`, `test:tools` — do przejęcia bez zmian (wywołanie także przez `pnpm run …`). `tools/docs-lifecycle/` jest samowystarczalny (tylko moduły `node:*` i importy względne) i wchodzi do monorepo jako workspace `tools/*`.
- Testy EVM-012 (`tools/docs-lifecycle/test/project-docs.test.mjs`) sprawdzają w głównym `package.json` wyłącznie trwałe niezmienniki: `private: true`, te trzy skrypty, brak `package-lock.json` i `yarn.lock`. Zmiana `engines` na Node 26 (ADR-0002) oraz `packageManager`, `devDependencies`, `pnpm-lock.yaml` i `.npmrc` (ADR-0012) nie wymagają zmian w tych testach.
- Pozostały dług narzędzia (Vitest zamiast `node:test`, `checkJs` albo `.ts`, testy na Linuksie w CI, eksperymentalny pomiar pokrycia): EVM-013 → „Notatki techniczne”.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
- 2026-10-03 — Konrad: repozytorium zdalne = prywatne `konradkluz/evia-manager` na GitHubie, plan **GitHub Free (bez Pro)**. Skutki do uwzględnienia w planie:
  - prywatne repo na Free nie ma ochrony gałęzi ani rulesetów — AC4 („czerwony etap blokuje merge do `main`”) realizujemy jako CI na każdym PR / pushu + instrukcja i kontrole kompensujące, bez twardej blokady po stronie GitHuba;
  - mitygacja RR-02 / RR-11 z EVM-005 („wymagana akceptacja PR przez Konrada”) nie jest wymuszalna — do ponownej oceny przez `security-engineer` w planie; kontrole już działające: deploy key tylko do tego repo (`~/.ssh/evia_manager`, alias `github-evia-manager`), reguła `deny` na `git push origin main` w `.claude/settings.json`, squash merge lokalnie przez orkiestratora po akceptacji, push na `main` wykonuje Konrad;
  - sprawdzić dostępność GitHub Environments (sekrety środowisk, ograniczenie gałęzi wdrożeń) w prywatnym repo na Free — polegają na nich SR-INFRA-13 / SR-INFRA-14 i RR-20 (EVM-007).
- 2026-10-03 — remote `origin` dodany, `main` wypchnięty przez Konrada (stan: `e4b4a2f`).
- 2026-10-03 — Konrad: zgoda na `git push` **wyłącznie gałęzi `feature/EVM-006-repo-i-ci`** do `origin` (agenci i orkiestrator) w celu weryfikacji CI; bez force-pusha, bez `main`. PR na GitHubie otwiera Konrad (brak `gh` na stacji); push na `main` — tylko Konrad.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione i zweryfikowane przez QA
- [ ] Przeglądy: code-reviewer, security-engineer — APPROVE
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — dopisano notatkę o przejęciu głównego `package.json` i narzędzia z EVM-012 („Notatki techniczne”, bez zmiany AC) (product-owner)
- 2026-10-03 — „Notatki techniczne” zaktualizowane wg ADR-0015 (testy per warstwa, zadania „Po EVM-006”, sekrety usług zewnętrznych poza katalogiem repo), bez zmiany AC (product-owner)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-006-repo-i-ci`
