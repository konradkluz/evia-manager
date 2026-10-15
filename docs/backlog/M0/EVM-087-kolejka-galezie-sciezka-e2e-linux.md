---
id: EVM-087
title: Kolejka historyjek — jedna gałąź dla zależnych, ścieżka lekka domyślnie, E2E Linux przed pushem
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
priority: P1
path: lekka
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: []
---

# EVM-087: Kolejka historyjek — jedna gałąź dla zależnych, ścieżka lekka domyślnie, E2E Linux przed pushem

## Cel
Jako **Konrad (właściciel produktu)** chcę **tańszego i krótszego dostarczania kolejek historyjek**, aby **mniej czekać na CI i zużywać mniej tokenów**. Kolejka EVM-042/043/053–057/078–082 (PR #69–#79), planowana na 1 noc, trwała >24 h: łańcuch stacked branches + squash merge wymagał przerabiania gałęzi po każdym squashu, a 11 sekwencyjnych przebiegów CI to ok. 27 min. Ścieżka lekka została użyta tylko w EVM-078/079, bo orkiestrator dopisywał `path: pelna` historyjkom M1 (3 recenzentów we frontmatter). Błędy tylko-CI (metryki czcionek Linux: menu EVM-054, tabela W-10 EVM-056) wychodziły dopiero po pushu. Uzupełnia EVM-075 (ścieżki, szablon, pomiar kosztu) i EVM-074 (modele) — nie powtarza ich.

## Kryteria akceptacji

**AC1 — Zależne historyjki na jednej gałęzi**
- Zakładając, że w kolejce są historyjki powiązane łańcuchem `depends_on`
- Gdy orkiestrator je realizuje
- Wtedy mają jedną gałąź, jeden PR i jeden przebieg CI z E2E, z osobnymi commitami `[EVM-###]` (po jednym lub kilku na historyjkę), a `workflow.md`, `conventions.md` i `/deliver` zakazują gałęzi stacked i opisują nazwę gałęzi oraz sposób scalenia wybrane w „Otwartych pytaniach”; każda historyjka ma własny wpis „Dziennika” i status `done` ustawiany przy scaleniu.

**AC2 — Niezależne równolegle**
- Zakładając, że historyjki nie zależą od siebie (bezpośrednio ani pośrednio) i nie zapisują tych samych plików
- Gdy orkiestrator planuje kolejkę
- Wtedy każda dostaje własną gałąź od `main` z osobnym PR i pełnym CI i może iść równolegle (worktree, `workflow.md` → „Delegowanie”); gdy zakresy plików się nakładają (np. ten sam moduł, lockfile, migracje), traktuje je jak zależne (AC1).

**AC3 — Ścieżka przy starcie kolejki wg ryzyka**
- Zakładając, że `/deliver` startuje pojedynczą historyjkę lub kolejkę
- Gdy pole `path` nie istnieje albo wskazuje `pelna` tylko z powodu liczby recenzentów
- Wtedy orkiestrator wylicza propozycję z tabeli ryzyka w `workflow.md` → „Ścieżki realizacji” (nie z liczby recenzentów), zadaje Konradowi jedno pytanie dla całej kolejki (ścieżka i recenzent per historyjka, rekomendacja pierwsza) i zapisuje wynik we frontmatter; historyjka z obszaru ryzyka (np. uwierzytelnianie, dane osobowe, migracje) dostaje rekomendację `pelna` z uzasadnieniem, a cichy zapis `pelna` bez pytania jest zabroniony w `.claude/skills/deliver*` i `deliver-story`.

**AC4 — E2E Linux lokalnie przed pushem**
- Zakładając, że `compose.yaml` ma usługę Playwright (obraz Linux, te same reguły utwardzania co pozostałe usługi, sprawdzane przez `tools/repo-policy`)
- Gdy wykonawca uruchamia ją przed pushem (`docker compose -f compose.yaml run --rm <usługa>`), a `workflow.md` i `docs/ops/github-i-ci.md` wskazują to jako krok przed pushem dla zmian w `apps/web` i `packages/*`
- Wtedy uruchamia te same testy Playwright co job `e2e-web` (Chromium; Firefox jak w CI) na Linuksie, a różnica względem CI jest opisana; zmiana tylko w dokumentacji lub `apps/api` nie wymaga tego kroku. Natywny Playwright na Windows (przeglądarki biura) pozostaje dowodem lokalnym wg ADR-0015.

**AC5 — Diff-coverage dla jednej gałęzi**
- Zakładając, że zależne historyjki leżą na jednej gałęzi od `main`
- Gdy uruchamiam `pnpm run coverage:diff`
- Wtedy baza to `merge-base` z `origin/main`, więc wynik obejmuje całą gałąź (≥ 90% łącznie, nie per historyjka), a `tools/diff-coverage/README.md` i `docs/process/testing-strategy.md` opisują to wprost; spadek poniżej progu po rozdzieleniu łańcucha (EVM-057: 89,8%) nie powstaje, bo łańcuch się nie rozdziela.

**AC6 — Budżet tokenów**
- Zakładając, że `/deliver` lub orkiestrator startuje kolejkę
- Gdy dobiera model i zakres sesji
- Wtedy `workflow.md` (uzupełnienie „Modele i effort” i „Pomiar kosztu” z EVM-074/075) mówi: wykonawcy domyślnie `sonnet` (`opus` tylko z uzasadnieniem), konsultacje przed implementacją tylko gdy plan lub tabela ryzyka wskazuje ryzyko, a jedna sesja obsługuje jedną kolejkę (jedna gałąź lub jedna niezależna historyjka); koszt całej kolejki wpisywany jest do „Dziennika” (format z EVM-075 AC6).

## Poza zakresem
- Zmiana filtrów ścieżek w CI i liczby przeglądarek (EVM-086), limitu minut (EVM-083).
- Zmiana progów pokrycia, bramek, ścieżek `lekka`/`pelna` i szablonu (EVM-075).
- Pokrycie per historyjka w jednej gałęzi (nowa opcja `coverage:diff`) — tylko jeśli Konrad zdecyduje (pytanie 3).
- E2E iOS, zmiany w kodzie produktu, przepisywanie istniejących historyjek `ready`.

## Decyzje i ograniczenia
- 2026-10-15 — Konrad: zależne na jednej gałęzi z jednym przebiegiem E2E i pipeline, niezależne równolegle; ograniczyć tokeny; ścieżka lekka ma być faktycznie używana.
- `path: lekka`: zmiany procesu i narzędzi deweloperskich, nie infrastruktura produkcyjna; `compose.yaml` jest tylko dev/CI (ADR-0015, ADR-0016). Recenzent `security-engineer` (nowa usługa kontenerowa, plik wrażliwy `.claude/`, K3: PR do uwagi Konrada).
- ADR-0015: usługa Playwright Linux to dodatek (dowód przed pushem), nie zmiana reguły „web natywnie na Windows”; potrzebna tylko adnotacja w ADR (do decyzji architekta, nie zmiana decyzji).
- Testy `tools/repo-policy` zmieniane razem z tekstami i `compose.yaml`.
- 2026-10-15 — Konrad (refinement), rozstrzygnięte pytania:
  - Nazwa gałęzi z kilkoma historyjkami: `feature/EVM-042-043-opis` (do 3 ID); dłuższa kolejka: `feature/queue-YYYY-MM-DD-opis`.
  - Scalanie PR z kilkoma historyjkami: rebase merge lub merge commit — zachowuje commity z ID per historyjka; squash zostaje dla gałęzi z jedną historyjką. Metodę w ustawieniach repozytorium włącza Konrad; aktualizacja `docs/ops/github-i-ci.md` i `docs/process/conventions.md` w tej historyjce.
  - `coverage:diff` bez zakresu commitów per historyjka (YAGNI) — próg ≥ 90% dla całej gałęzi; ryzyko maskowania słabo pokrytej historyjki zaakceptowane.
  - Rozmiar gałęzi zależnych: maks. ok. 5 historyjek lub 1 dzień pracy na PR; większe kolejki dzielimy na kolejne gałęzie od `main` po scaleniu poprzedniej.

- 2026-10-15 — Konrad (po przeglądzie security, zmiana decyzji z refinementu): PR z kilkoma historyjkami scalamy **squash** (tytuł z ID pierwszej historyjki, pozostałe ID w opisie PR), bo K6 odrzuca rebase merge i merge commit; „Allow rebase merging” odznaczone; rozszerzenie K6 o rebase merge — osobna historyjka (draft).
## Zależności
- Brak blokujących. Uzupełnia EVM-075 (done) i EVM-074 (done); EVM-083 (done) jest motywacją (minuty Actions). Nakłada się z EVM-086 (draft, filtry ścieżek CI): oba zmieniają `docs/ops/github-i-ci.md`; E2E w CI zostaje bez zmian, EVM-087 dodaje tylko lokalny odpowiednik — kolejność dowolna, dokumentację scalić przy drugim z nich.

## Notatki
- Konsultacja: security (utwardzenie usługi Playwright w `compose.yaml`, brak egressu/portów wg reguł repo-policy) — przez jednego recenzenta ścieżki lekkiej; architekt tylko do adnotacji w ADR-0015.
- Istniejące historyjki M1 z 3 recenzentami: rozstrzyga pytanie o ścieżkę w AC3, bez przepisywania frontmatter na zapas.

- Ryzyka rezydualne (security-engineer, do akceptacji Konrada na demo): przeglądarki w `web-e2e-linux` działają bez sandboksu (cap_drop ALL; tylko lokalny vite preview w sieci `internal`), usługa współdzieli zapisywalny wolumen `bt-work` z `backend-tests`; PR zmienia pliki wrażliwe K3 (`.claude/skills`, `.claude/workflows`, `compose.yaml`).
- Pierwszy przebieg `web-e2e-linux` (12,9 min, równolegle z gałęzią B): Chromium bez porażek, Firefox 14 niestabilnych i 1 czerwony (`page.goto` > 30 s; po ponowieniu zielony).

## Dziennik
- 2026-10-15 — utworzono w /refine (product-owner), `draft`; po ustaleniach Konrada z 2026-10-15
- 2026-10-15 — Konrad zaakceptował historyjkę i rozstrzygnął 4 pytania (decyzje w „Decyzjach i ograniczeniach”); status `ready`
- 2026-10-15 — ready → in-progress (kolejka nocna, gałąź `feature/EVM-087-086-proces-ci`, z EVM-086)
- 2026-10-15 — implementacja (devops-engineer, kolejka nocna): sekcja „Kolejki historyjek” w workflow.md, usługa `web-e2e-linux` (compose.yaml + infra/docker/web-e2e), `deliver-story` wymaga jawnego `path`, testy repo-policy `EVM-087 AC#`; adnotacja w ADR-0015; krok Konrada: włączyć *Allow rebase merging* (github-i-ci.md); koszt kolejki — do wpisu orkiestratora
- 2026-10-15 — poprawki rundy 1 (security-engineer, major): K6 nie przyjmie commitów z rebase merge (tylko ostatni = `merge_commit_sha`); dokumentacja zmieniona na squash także dla kolejek (ID w tytule/opisie PR), *Allow rebase merging* zostaje wyłączone; rozszerzenie K6 (`tools/main-integrity/`) = zmiana zakresu, osobna historyjka do decyzji Konrada. Krok Konrada „włączyć Allow rebase merging” z wpisu powyżej jest wycofany.
- 2026-10-15 — orkiestrator: poprawki security sprawdzone, doprecyzowano tytuł PR (jedno ID — regex K6); AC1–AC6 → testy `EVM-087 AC#`; `pnpm run gate` zielony (diff-coverage 1/1), `docs:check` 0/0; in-progress → in-review
- 2026-10-15 — Koszt: potok 3 wywołania agentów, ok. 0,28 mln tokenów subagentów, ok. 71 min; rundy poprawek 1; ścieżka lekka; sonnet
