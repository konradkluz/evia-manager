---
id: EVM-013
title: Walidator cyklu życia dokumentacji jako bramka CI
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P2
owner: devops-engineer
contributors: []
reviewers: [code-reviewer, security-engineer]
depends_on: [EVM-006, EVM-012]
---

# EVM-013: Walidator cyklu życia dokumentacji jako bramka CI

## Historyjka
Jako **Konrad (właściciel produktu, jedyna osoba scalająca PR)** chcę, **aby walidator dokumentacji z EVM-012 działał w CI na każdym pushu: błędy polityki cyklu życia dokumentów czerwienią `ci-gate`, a ostrzeżenia widzę w podsumowaniu przebiegu**, aby **porządek w dokumentacji (w tym brak plików roboczych w repozytorium) nie zależał od pamięci agentów ani od ręcznego uruchomienia walidatora przed scaleniem**.

**Rezultat (enabler):** `npm run docs:check` jest bramką 11 z `docs/security/requirements.md` (SR-SUPPLY-11): pierwszym krokiem joba `quality` w CI i częścią `pnpm run gate`. Błąd walidatora daje czerwony `ci-gate`, więc według procedury scalania K2 PR nie zostaje scalony. Ostrzeżenia są widoczne w podsumowaniu przebiegu i niczego nie blokują. Wyjście walidatora jest bezpieczne do odczytu: nazwy plików nie stają się poleceniami runnera ani formatowaniem podsumowania, a złośliwie zbudowany plik nie zawiesza bramki.

## Kontekst
- **Dlaczego teraz.** Decyzja Konrada z 2026-10-02 (refinement EVM-012): do czasu CI walidator tylko raportuje, a blokada w CI powstaje po EVM-006. EVM-006 jest `done`. Ostatnie historyjki dokumentacyjne (EVM-015, EVM-071) dodały kilkadziesiąt plików `.md`, a `docs:check` uruchamiał tylko orkiestrator lokalnie. Błąd polityki (np. plik roboczy dodany do gita albo notatka poza dozwoloną lokalizacją) może dziś trafić na `main` niezauważony.
- **Stan na 2026-10-05 (sprawdzony przez orkiestratora).** EVM-006 uruchamia w CI (`.github/workflows/ci.yml`, job `quality`) lint, typy i testy z pokryciem wszystkich workspace'ów. Obejmuje to testy walidatora (`@evia/docs-lifecycle`) na Linuksie, więc punkt „uruchomienie na Linuksie w CI” z długu EVM-012 jest już zrealizowany. CI **nie** uruchamia samego walidatora na repozytorium: błędy polityki nie czerwienią `ci-gate`, a ostrzeżenia nie są nigdzie widoczne.
- **Zakres po decyzjach Konrada (2026-10-05, „Decyzje” 1–5).**
  - Bramka CI to **krok w jobie `quality`** — pierwszy krok z poleceniem, przed `pnpm install` — a nie osobny job (0 nowych jobów).
  - Bezpieczne wyjście narzędzia: poprawki L1–L4 z „Bezpieczeństwo i prywatność” (neutralizacja logu, bezpieczne podsumowanie z limitem pozycji, wyrażenia bez zawieszania, cytowanie ścieżki we wskazówce).
  - Test 200 KB i testy ReDoS w `worker_threads` z twardym przerwaniem; nity z EVM-012; `docs:check` w `pnpm run gate`.
  - Zniesienie wyjątków ESLint i TypeScript w `tools/docs-lifecycle` przechodzi do [EVM-073](../M1/EVM-073-wyjatki-jakosci-docs-lifecycle.md). Vitest i `.ts` — „nie robimy”. Hook git — nie teraz.
- **Skutek kroku w `quality`.** Przy błędzie dokumentacji pozostałe kroki `quality` (format, lint, typy, testy, build) nie wykonują się w tym przebiegu, a job `coverage` zostaje pominięty — `ci-gate` jest czerwony (fail-closed). Joby `backend` i `security` działają niezależnie. Konrad zaakceptował ten skutek, bo `npm run docs:check` działa lokalnie, także w chmurze.
- **Warunek startu.** Walidator sprawdza całe repozytorium, więc błąd obecny już na `main` czerwieniłby każdą gałąź. Na początku realizacji `npm run docs:check` na `main` musi dać 0 błędów. Jeśli tak nie jest, wykonawca się zatrzymuje i pyta Konrada (naprawa może wymagać przeniesienia dokumentów z `main`, a o tym decyduje Konrad).
- **Ograniczenie środowiska (Konrad, 2026-10-05).** Do odwołania pracujemy wyłącznie w Claude Code web (kontener Linux w chmurze, Node 22, bez demona Dockera, bez Windows i emulatora).
  - Działają: `npm run docs:check`, `npm run test:tools`, push gałęzi `feature/EVM-*` i odczyt wyników CI.
  - Tylko w CI (do czasu Node 26 w środowisku chmury — osobny krok, „Decyzje” 4): `pnpm install` (`engineStrict` wymaga Node 26), lint, typy, Prettier, `pnpm run gate`, `pnpm run scan` i testy Vitest (`tools/repo-policy`).
  - **Wiążącą weryfikacją są przebiegi GitHub Actions** — patrz „Definition of Done”.
- **GitHub Free nie ma twardej blokady (ADR-0016).** „Blokuje merge” oznacza tu trzy rzeczy: czerwony `ci-gate`, procedurę scalania K2 (Konrad scala tylko przy zielonym `ci-gate`) i wykrywanie przez K6 (`docs/ops/github-i-ci.md`).
- Powiązane dokumenty: polityka `docs/process/document-lifecycle.md`, narzędzie `tools/docs-lifecycle/README.md`, CI `docs/ops/github-i-ci.md`. Zagrożenia, ustalenia L1–L5 i kontrole 1–9 — „Bezpieczeństwo i prywatność”; stan długu z EVM-012, wzorzec kroku i weryfikacja w chmurze — „Notatki techniczne”.

## Kryteria akceptacji
Testy automatyczne oznaczamy `EVM-013 AC#`. Przypadki z nazwami plików niemożliwymi w systemie plików Windows (znak nowej linii, niepoprawny UTF-8) sprawdzamy na Linuksie — w chmurze i w CI.

**AC1 — Błąd dokumentacji czerwieni `ci-gate`**
- Zakładając, że ostatni commit gałęzi zawiera plik `.md` łamiący politykę (np. syntetyczny `docs/notatka-evm-013.md` poza dozwolonymi lokalizacjami — przykład z SR-SUPPLY-11 — albo plik z `.scratch/` dodany do gita),
- Gdy gałąź zostaje wypchnięta i przebieg `ci.yml` się kończy,
- Wtedy:
  - krok walidatora dokumentacji w jobie `quality` kończy się błędem, a jego nazwa wskazuje walidator dokumentacji jako przyczynę;
  - log kroku zawiera listę błędów w formacie walidatora (`BŁĄD · <ścieżka> · <klasa> · <powód i wskazówka>`), a podsumowanie przebiegu — sekcję walidatora z błędami (AC5) i podpowiedzią, jak powtórzyć sprawdzenie lokalnie (`npm run docs:check`);
  - pozostałe kroki `quality` się nie wykonują, job `coverage` jest pominięty, a check `ci-gate` tego commita jest czerwony; joby `backend` i `security` dają w tym przebiegu własne wyniki;
  - dowodem jest prawdziwy przebieg CI z celowo wprowadzonym błędem (DoD).

**AC2 — Ostrzeżenia widoczne, ale nieblokujące; wynik zgodny z lokalnym**
- Zakładając, że walidator zgłasza 0 błędów i co najmniej jedno ostrzeżenie (np. „osierocony” albo „przeterminowany”),
- Gdy przebieg CI się kończy,
- Wtedy:
  - krok walidatora jest zielony i nie zmienia wyniku `ci-gate` (decydują pozostałe bramki);
  - podsumowanie przebiegu ma sekcję walidatora z licznikiem `błędy: 0 · ostrzeżenia: N` i listą ostrzeżeń (ścieżka · klasa · powód); przy braku błędów i ostrzeżeń sekcja pokazuje jednoznaczny komunikat o czystej dokumentacji;
  - liczby błędów i ostrzeżeń są takie same jak wynik `npm run docs:check` uruchomionego tego samego dnia (`Europe/Warsaw`) na czystym klonie tego commita;
  - ostrzeżenia zależne od daty („przeterminowany”) nigdy nie zmieniają wyniku bramki: ten sam commit ma ten sam wynik `ci-gate` niezależnie od dnia przebiegu (w CI bez `--today`).

**AC3 — Brak fałszywej zieleni i stała konfiguracja kroku**
- Zakładając, że walidator w CI nie dał wyniku „0 błędów” — zakończył się kodem `1` albo `2` (np. brak repozytorium git), nie uruchomił się, został pominięty albo anulowany — albo że zmiana w gałęzi osłabia bramkę,
- Gdy przebieg CI się kończy,
- Wtedy:
  - `ci-gate` jest czerwony: kod wyjścia kroku jest kodem wyjścia walidatora (`0` — zielony; `1` i `2` — czerwony), job `quality` zostaje w warunku `ci-gate`, a nazwy `ci.yml`, `quality` i `ci-gate` się nie zmieniają (K6);
  - test niezmienników w `tools/repo-policy` kończy się błędem z komunikatem wskazującym naruszenie, gdy krok walidatora:
    - nie istnieje albo nie jest pierwszym krokiem z poleceniem w jobie `quality` (po konfiguracji Node, przed `pnpm install` i przed jakimkolwiek kodem z zależności);
    - uruchamia walidator innym poleceniem niż lokalne `npm run docs:check` (`node tools/docs-lifecycle/cli.mjs check`; dopuszczalny jest tylko wybór formatu podsumowania z AC5) albo z `--today` lub `--list`;
    - ma warunek `if:`, `continue-on-error`, `|| true` lub `set +e`, używa potoku bez `shell: bash` albo nie przekazuje kodu wyjścia;
    - nie zapisuje podsumowania do `$GITHUB_STEP_SUMMARY` albo zawiera wyrażenie `${{ … }}` w `run`;
  - ten sam test kończy się błędem, gdy job `quality` ma uprawnienia inne niż `contents: read` albo pobiera repozytorium bez `persist-credentials: false`;
  - krok nie wymaga instalacji zależności, nowych zależności npm, nowych akcji GitHub ani sekretów, a liczba jobów w `ci.yml` się nie zmienia; krok trwa krócej niż 1 min w każdym przebiegu dowodowym (raport QA);
  - dotychczasowe kontrole workflowów (testy `tools/repo-policy`, zizmor, actionlint) przechodzą bez nowych wyjątków.

**AC4 — Nazwy plików nie sterują logiem CI**
- Zakładając repozytorium testowe z syntetycznymi plikami o nazwach `::error::x.md`, `##[error]x.md` i `::notice::root.md`, z nazwą zawierającą znak nowej linii i `::warning title=OK::…`, z nazwą w niepoprawnym UTF-8 oraz z plikiem `.scratch/$(id).md` dodanym do gita,
- Gdy walidator działa w trybach `check` i `check --list` oraz gdy kończy się błędem użycia lub środowiska (komunikat na stderr, także przy błędzie nieoczekiwanym),
- Wtedy:
  - na stdout i stderr żadna linia (po pominięciu początkowych białych znaków) nie zaczyna się od `::` ani `##[`, a znaki sterujące są escapowane — runner nie tworzy fałszywych adnotacji, nie maskuje wartości i nie wstrzymuje przetwarzania poleceń;
  - narzędzie nie emituje adnotacji (`::warning`, `::error`, `::notice`);
  - kody wyjścia się nie zmieniają (`1` przy błędach walidacji, `2` przy błędzie użycia lub środowiska);
  - wskazówka `git rm --cached` dla `.scratch/$(id).md` zawiera ścieżkę zacytowaną dla powłoki POSIX (`'…'`, `'` → `'\''`), więc wklejone polecenie nie wykona `id`.

**AC5 — Bezpieczne podsumowanie przebiegu**
- Zakładając wynik walidatora ze ścieżkami syntetycznymi zawierającymi `` ` ``, ``` `` ```, `|`, `<img src=x>`, `[a](https://example.invalid)` i `**`, z ponad 100 błędami i ponad 100 ostrzeżeniami oraz z syntetycznym znacznikiem w treści dokumentu i w jego polu `title`,
- Gdy narzędzie wypisuje podsumowanie, a krok CI zapisuje je do podsumowania przebiegu (Step Summary),
- Wtedy:
  - podsumowanie ma stałą strukturę z zaufanych tekstów: nagłówek nazywający źródło (np. „Walidator dokumentacji (EVM-013)”), wynik, licznik `błędy: N · ostrzeżenia: M`, listy błędów i ostrzeżeń (ścieżka · klasa · powód) i podpowiedź `npm run docs:check`;
  - każda wartość z repozytorium jest pokazana dosłownie — nie tworzy linku, obrazka, HTML ani formatowania i nie narusza struktury podsumowania (tabeli, nagłówków, wyniku);
  - każda lista ma najwyżej 100 pozycji, a dalej dopisek „… i N więcej — pełna lista w logu”; całe podsumowanie ma mniej niż 1 MiB;
  - syntetyczny znacznik z treści i z pola `title` nie występuje w żadnym wyjściu (log, podsumowanie) — wyjście zawiera tylko ścieżki i metadane;
  - narzędzie nie czyta i nie zapisuje `GITHUB_STEP_SUMMARY` (pisze na stdout, a do pliku podsumowania kieruje je krok workflowu); test „tylko do odczytu” z EVM-012 AC5 przechodzi bez wyjątków.

**AC6 — Złośliwie zbudowany plik nie zawiesza bramki**
- Zakładając syntetyczne pliki:
  - frontmatter z polem `klucz:` i ok. 200 KB spacji i tabulatorów zakończonych U+2028 (oraz wariant z U+2029);
  - roadmapę z nagłówkiem `#`, ok. 200 KB spacji i U+2028;
  - dotychczasowe przypadki 200 KB z testów odwołań (EVM-012 AC4),
- Gdy testy walidatora mierzą czas analizy,
- Wtedy:
  - każda analiza kończy się w mniej niż 2 s (czas mierzony wewnątrz osobnego wątku, bez czasu jego startu);
  - pomiar ma twardy termin (np. 10 s): po jego przekroczeniu wątek jest przerywany, a test kończy się błędem z komunikatem o przekroczeniu czasu, więc job CI nie wisi do `timeout-minutes`;
  - test kontrolny z obliczeniem, które się nie kończy, potwierdza przerwanie w terminie;
  - pokrycie linii i gałęzi `tools/docs-lifecycle` nie spada (próg ≥ 90%, dziś 100%).

**AC7 — Porządki z EVM-012 bez zmiany reguł**
- Zakładając dotychczasowe testy walidatora i politykę `docs/process/document-lifecycle.md`,
- Gdy wprowadzone są poprawki z AC4–AC6 i nity z EVM-012 („Notatki techniczne” → „Nity”),
- Wtedy:
  - dotychczasowe testy przechodzą bez zmiany oczekiwań; wyjątkiem są oczekiwania dotyczące neutralizacji wyjścia i cytowania wskazówki (AC4), wymienione w „Plan techniczny”; nie zmienia się, co jest błędem, a co ostrzeżeniem;
  - polityka wylicza „błędy klasy” (po których plik nie dostaje ostrzeżenia „osierocony”) — doprecyzowanie bez zmiany reguł, zgodne z jednym źródłem prawdy w kodzie;
  - test rozszerzeń w innej wielkości liter wiąże każdą ścieżkę z numerem reguły (`Cennik.MD` → 16, `X.Md` → 14), więc błąd przypisany do złej reguły kończy test niepowodzeniem;
  - narzędzie działa bez instalacji zależności na Node ≥ 22.15: `npm run test:tools` przechodzi na Node 22 (chmura), a testy `@evia/docs-lifecycle` — w CI na Node 26.

**AC8 — Parytet z lokalną bramką i dokumentacja**
- Zakładając, że Konrad albo agent uruchamia `pnpm run gate` albo chce wiedzieć, jak działa bramka dokumentacji,
- Gdy uruchamia bramkę (Node 26) albo czyta `CLAUDE.md` („Stack i komendy”), `docs/ops/github-i-ci.md` („CI w skrócie”), `tools/docs-lifecycle/README.md` i `docs/process/document-lifecycle.md` (tabela „Kiedy”, „Walidator i raport sprzątania”),
- Wtedy:
  - `pnpm run gate` uruchamia walidator zaraz po sprawdzeniu hooków (`node tools/git-hooks/cli.mjs check`) i kończy się błędem przy błędach dokumentacji — potwierdza to test skryptu `gate` w `tools/repo-policy`;
  - dokumenty mówią, że walidator działa w CI na każdym pushu jako pierwszy krok `quality`, co blokuje (błędy, także kod `2`), czego nie blokuje (ostrzeżenia), gdzie jest wynik (podsumowanie przebiegu, pełna lista w logu), że przy błędzie dokumentacji reszta `quality` się nie wykonuje i jak powtórzyć sprawdzenie lokalnie (`npm run docs:check`);
  - punkt DoD `npm run docs:check` i polecenie w raporcie agenta zostają bez zmian (w chmurze `pnpm run gate` nie działa);
  - odwołania do „długu EVM-013” wskazują EVM-073 i nie zapowiadają migracji na TypeScript ani Vitest: `packages/config/README.md`, `tools/repo-policy/README.md`, komentarz i nazwa testu listy wyjątków w `tools/repo-policy`, `tools/docs-lifecycle/README.md`, komentarze w `tools/docs-lifecycle/eslint.config.js` i `tsconfig.json`;
  - `npm run docs:check` daje 0 błędów.

## Poza zakresem
- **Zniesienie wyjątków ESLint i TypeScript** w `tools/docs-lifecycle` (`noUncheckedIndexedAccess`, 9 reguł ESLint, lista `RELAXED` w `tools/repo-policy`) — [EVM-073](../M1/EVM-073-wyjatki-jakosci-docs-lifecycle.md) („Decyzje” 1). Tutaj tylko odwołania do długu wskazują EVM-073 (AC8).
- **Vitest zamiast `node:test` i `.ts` zamiast `.mjs`** — zamknięte jako „nie robimy” („Decyzje” 1), także dla pozostałych `tools/*` w `.mjs`.
- **Hook git** (pre-commit lub pre-push z walidatorem) — „Decyzje” 5; do rozważenia po powrocie do pracy lokalnej (`lefthook.yml` to plik wrażliwy K3).
- **Osobny job walidatora** — odrzucony na rzecz kroku w `quality` („Decyzje” 2).
- **L5** — `codeCell` dla ścieżek z dwoma backtickami oraz krok K3 w jobie `security` (ścieżki z `git diff` w podsumowaniu bez escapowania Markdown) — do backlogu przez `/refine` („Uwagi do rozważenia”). Wyjątek: jeśli wspólna funkcja code spanu z AC5 obejmie też `codeCell`, wykonawca zapisuje to w „Plan techniczny”; krok K3 zostaje bez zmian.
- **Adnotacje `::warning` / `::error`** przy plikach i komentarze bota w PR — YAGNI, zwiększają powierzchnię Z2; wystarcza podsumowanie przebiegu.
- **Zmiany reguł polityki i logiki walidacji**: co jest błędem, a co ostrzeżeniem (np. „przeterminowany” jako błąd), nowe lokalizacje, treść komunikatów. Wyjątki: doprecyzowanie listy „błędów klasy” (AC7), neutralizacja wyjścia i cytowanie ścieżki we wskazówce (AC4).
- **Node 26 w środowisku Claude Code web** — osobny krok poza historyjką („Decyzje” 4).
- **Obserwacje z EVM-012** — zagnieżdżone repozytorium git w `spikes/` zgłaszane jako „spike bez README” i zbyt surowy test sąsiedztwa kroków w `tools/docs-lifecycle/test/qa-acceptance.test.mjs` — do backlogu przez `/refine` („Uwagi do rozważenia”).
- Twarda blokada scalenia po stronie GitHuba (ochrona gałęzi, ruleset) — niedostępna na GitHub Free (ADR-0016).
- Pomijanie ciężkich jobów przy zmianach wyłącznie w dokumentacji (job `changes`) — EVM-006, „Uwagi do rozważenia”, po przekroczeniu ok. 1500 min/mies. Gdy wejdzie, `docs:check` musi zostać w jobie, który uruchamia się zawsze.
- Nocne raportowanie przeterminowanych dokumentów lub zakładanie zgłoszeń — wystarczają przegląd w `/milestone close` i punkt DoD.
- Sprawdzanie treści dokumentów (merytoryka, linki zewnętrzne, pisownia) — poza polityką z EVM-012.

## UX / UI
Nie dotyczy, bo aplikacja się nie zmienia. Wynik odczytują Konrad i agenci w widoku przebiegu GitHub Actions: log kroku i podsumowanie przebiegu. Komunikaty są po polsku, w formacie walidatora z EVM-012. Nowe teksty pojawiają się tylko w podsumowaniu przebiegu (nagłówek, wynik, licznik, dopisek o obcięciu listy, podpowiedź `npm run docs:check`).

## Bezpieczeństwo i prywatność
Treść: konsultacja `security-engineer` (2026-10-05), z uwzględnieniem decyzji Konrada („Decyzje” 2 — krok w jobie `quality` zamiast osobnego joba). Role aplikacji (Administrator / Edytor / Tylko odczyt / niezalogowany) nie dotyczą tej historyjki — zmiana dotyczy CI i narzędzia deweloperskiego, nie aplikacji ani danych klientów. Wymaganie: **SR-SUPPLY-11**; powiązane: SR-SUPPLY-04, SR-SUPPLY-05 (K3, K6), SR-PRIV-08, SR-LOG-05 (analogicznie do logów CI).

**Dane.** Wejście: lista plików z gita i pliki `.md` (pola `lifecycle`, `milestone`, `expires`, `review_by`, tabela „Przegląd” w roadmapie, odwołania między dokumentami). Wyjście: log joba i podsumowanie kroku (Step Summary) — widoczne tylko dla osób z dostępem do repozytorium, retencja Actions (domyślnie 90 dni). Wyjście zawiera wyłącznie ścieżki, klasę, regułę, powód i liczniki (wartości do 60 znaków tylko dla czterech pól wyżej) — nigdy treść dokumentów. RODO: bez nowego przepływu danych ani podmiotu przetwarzającego; `rodo.md` bez zmian.

**Zagrożenia** (aktor: osoba albo agent z prawem zapisu, także agent po prompt injection; repozytorium prywatne, CI tylko na `push`):
- **Z1 — fail-open (CWE-636):** utrata kodu wyjścia walidatora (potok do `tee` przy domyślnym `bash -e` bez `pipefail`, `|| true`, `continue-on-error`) albo krok pominięty w `ci-gate`.
- **Z2 — wstrzyknięcie poleceń workflow do logu (CWE-117, CWE-74):** nazwa pliku lub wartość wypisana jako `::warning…`, `::stop-commands::`, `::add-mask::`, `##[error]` → fałszywe adnotacje albo ukryty wynik (potwierdzone: L1, L2).
- **Z3 — wstrzyknięcie Markdown/HTML do podsumowania (CWE-116, CWE-451):** linki, obrazy, podrobione „Wynik: brak błędów” albo nagłówek K3 — Konrad decyduje o scaleniu na podstawie podsumowania (K2, K3).
- **Z4 — zawieszenie bramki przez ReDoS (CWE-1333, CWE-400):** job wisi do `timeout-minutes` i zużywa pulę 2000 min (przy limicie wydatków 0 USD CI staje dla wszystkich gałęzi) (potwierdzone: L3).
- **Z5 — uprawnienia joba i łańcuch dostaw (CWE-829, CWE-522; TM-55):** przejęta akcja, token w `.git/config`, instalacja zależności przed walidatorem.
- **Z6 — wskazówka z poleceniem powłoki z niecytowaną ścieżką (CWE-78)** (potwierdzone: L4).

**Ustalenia w istniejącym kodzie** (każde potwierdzone eksperymentem na danych syntetycznych; wszystkie Low — w zakresie EVM-013 wg „Decyzje” 1, poza L5):

| ID | Lokalizacja | Problem | Poprawka |
|---|---|---|---|
| L1 | `tools/docs-lifecycle/lib/main.mjs:96`, `:98` (komunikat z `lib/repository.mjs:77`) | `ToolError` i `inspect(error)` na stderr bez `escapeText` — nazwa pliku z niepoprawnym UTF-8 i LF dała osobną linię `::warning title=…` (fałszywa adnotacja; job i tak czerwony — kod 2) | `escapeText` na stderr + test (CWE-117, ASVS 5.0 V16.4.1) |
| L2 | `lib/format.mjs:55` (`check --list`) | ścieżka na początku linii — plik `::notice::root.md` daje linię traktowaną przez runner jak polecenie | neutralizacja w `render()` linii zaczynających się od `::` / `##[`; w CI bez `--list` (CWE-117, CWE-74) |
| L3 | `lib/frontmatter.mjs:11` (`FIELD`), `lib/milestones.mjs:10` (`HEADING`) | `FIELD` — czas kwadratowy dla spacji zakończonych U+2028/U+2029 (40 000 spacji → 2,6 s; ~1 min dla 200 KB); `HEADING` — czas sześcienny (`#` + 5000 spacji + U+2028 → 21 s) | wyrażenia bez nakładających się kwantyfikatorów (flaga `s` albo pojedyncze `[ \t]` + `trim()`); testy 200 KB w workerze (CWE-1333, CWE-400) |
| L4 | `lib/analyze.mjs:261` | wskazówka `git rm --cached -- ${path}` bez cytowania — dla `.scratch/$(id).md` wklejone polecenie wykona `id` | cytowanie POSIX (`'…'`, `'` → `'\''`) (CWE-78) |
| L5 | `lib/format.mjs:86-87` (`codeCell`), `.github/workflows/ci.yml:113-118` (krok K3) | `codeCell` psuje się dla ścieżek z dwoma backtickami; krok K3 wpisuje ścieżki z `git diff` do podsumowania bez escapowania Markdown | **poza zakresem** — do backlogu przez `/refine` (wyjątek: jeśli powstanie wspólna funkcja code spanu, może wejść tu) (CWE-116) |

**Kontrole obowiązkowe:**
1. **Krok walidatora w jobie `quality`** (decyzja Konrada zamiast osobnego joba): pierwszy krok po `actions/setup-node`, **przed** `pnpm install` i przed jakimkolwiek kodem z zależności; job zachowuje `permissions: contents: read`, akcje przypięte do pełnych SHA z komentarzem wersji, `persist-credentials: false`, bez sekretów i tokenów w `env`. Nazw `ci-gate`, `quality` i `ci.yml` nie zmieniamy (K6 szuka `ci-gate` w `ci.yml`; `quality` już jest w `ci-gate.needs`). SR-SUPPLY-04, SR-SUPPLY-05.
2. **Blokada przy każdym błędzie:** wynik kroku = kod walidatora (0 — zielony; 1 i 2 — czerwony). Zakazane: `continue-on-error`, `|| true`, `set +e`; potok tylko z `shell: bash` (`-eo pipefail`) — zalecany wzorzec bez potoku (zapis do pliku w `$RUNNER_TEMP`, `exit "$status"`). W CI bez `--today` i bez `--list`.
3. **Narzędzie tylko do odczytu (EVM-012 AC5):** narzędzie nie czyta `GITHUB_STEP_SUMMARY` i niczego tam nie zapisuje — wypisuje wynik na stdout, a do `$GITHUB_STEP_SUMMARY` przekierowuje go workflow; `test/readonly.test.mjs` bez wyjątków; w `run:` brak wyrażeń `${{ … }}` z wartościami zależnymi od gałęzi (przez `env`).
4. **Neutralizacja logu (stdout i stderr, wszystkie formaty, także `ToolError`):** znaki sterujące escapowane; żadna linia (po pominięciu początkowych białych znaków) nie zaczyna się od `::` ani `##[`; narzędzie nie emituje adnotacji `::warning` / `::error` (ASVS 5.0 V16.4.1, CWE-117).
5. **Podsumowanie (Step Summary):** stała struktura z zaufanych tekstów (nagłówek nazywa źródło, np. „Walidator dokumentacji (EVM-013)”, liczniki, wynik); każda wartość z repozytorium w code spanie albo bloku kodu z płotkiem dłuższym od najdłuższej serii backticków w wartości, `|` → `\|` w komórkach; bez surowego HTML, linków i obrazów; limit pozycji (np. 100 błędów i 100 ostrzeżeń, dalej „… i N więcej — pełna lista w logu”), całość < 1 MiB na krok.
6. **Dostępność bramki:** wyrażenia z L3 przepisane; testy czasu przerywane twardo (`worker_threads` + `terminate()`).
7. **Wskazówki z poleceniami:** ścieżka cytowana dla POSIX albo polecenie bez ścieżki (L4).
8. **Prywatność:** w testach wyłącznie dane syntetyczne (SR-PRIV-08); w logach tylko ścieżki i metadane (CWE-532, ASVS 5.0 V16.2.5).
9. **Plik wrażliwy (K3):** `ci.yml` jest na liście — punkt checklisty PR; po scaleniu K6 wypisze commit w logu (zmiana `.github/`), Konrad potwierdza „Pull request merge” w Activity. Logika K6 bez zmian. `tools/docs-lifecycle/` nie trafia na listy K3 / K6 (bramka porządku dokumentacji, nie granica bezpieczeństwa; zmiana reguł = zmiana polityki akceptowana przez Konrada).

**Testy do dodania** (oznaczone `EVM-013 AC#`): `tools/repo-policy` — krok walidatora jest pierwszym krokiem `quality` przed `pnpm install`, uruchamia `node tools/docs-lifecycle/cli.mjs check` bez `--today` i `--list`, bez `continue-on-error`, `|| true` i potoku bez `shell: bash`, przekazuje kod wyjścia i pisze do `$GITHUB_STEP_SUMMARY`; job `quality` zachowuje `permissions` `{contents: read}` i `persist-credentials: false`. `tools/docs-lifecycle` (repozytorium tymczasowe, fikstury syntetyczne): wstrzyknięcie do logu (`::error::x.md`, `##[error]x.md`, ścieżka z LF i `::warning title=OK::…`, ścieżka z niepoprawnym UTF-8) — dla `check`, `check --list` i stderr żadna linia nie zaczyna się od `::` / `##[`, kod 2 zachowany; podsumowanie — ścieżki z `` ` ``, ``` `` ```, `|`, `<img src=x>`, `[a](https://example.invalid)`, `**` pokazane dosłownie, struktura nienaruszona, obcięcie z licznikiem; brak treści w wyjściu (syntetyczny znacznik w treści i w polu `title` nie pojawia się w żadnym wyjściu); ReDoS — frontmatter `key:` + 200 KB spacji i tabulatorów + U+2028 (i U+2029) oraz roadmapa z `#` + 200 KB spacji + U+2028, < 2 s w workerze z twardym przerwaniem; wskazówka `git rm --cached` dla `.scratch/$(id).md` z zacytowaną ścieżką.

**Ryzyka rezydualne:** bramka wykrywa, nie zapobiega — plik trafia na zdalną gałąź, zanim CI go zgłosi (w Claude Code web hooków nie ma; zapobiegają: `npm run docs:check` przed commitem w DoD, zasada danych syntetycznych, gitleaks w CI). Osłabienie walidatora w tej samej gałęzi jest możliwe jak przy każdej bramce CI — chronią przegląd kodu i test spójności polityki z konfiguracją.

**Dokumenty bezpieczeństwa do aktualizacji w realizacji** (`security-engineer` przy przeglądzie): `docs/security/requirements.md` — SR-SUPPLY-11, kolumna „Weryfikacja” (krok w `quality`, test `tools/repo-policy`, testy neutralizacji wyjścia); `docs/security/threat-model.md` — nowy wiersz C-17 (wstrzyknięcie do logu i podsumowania CI; Low) i dopisek o puli minut przy Z4; `rodo.md` bez zmian.

## Notatki techniczne
- Dług przekazany z EVM-012 (przegląd `solution-architect` 2026-10-02, szczegóły: EVM-012 → „Plan techniczny” → „Ustalenia z konsultacji”): Vitest zamiast `node:test`; `checkJs` albo `.ts` (w Node 26 type stripping jest stabilny); uruchomienie testów walidatora na Linuksie w CI (w EVM-012 część Linux/macOS AC3 może zostać „do potwierdzenia w CI”); `--experimental-test-coverage` jest nadal eksperymentalne także w Node 26; `engines` → Node 26 i `tools/*` jako workspace (wspólnie z EVM-006).

Do uwzględnienia (przegląd poprawek EVM-012, 2026-10-03): testy czasu 200 KB w `tools/docs-lifecycle/test/references.test.mjs` — `timeout` nie przerywa kodu synchronicznego (w CI regresja = zawieszenie joba); przenieść do `worker_threads` z przerwaniem albo test proporcji czasu. Nity: flaga `classError` zamiast listy `CLASS_ERRORS` w `analyze.mjs`; lista „błędów klasy” w polityce; dokładniejsza asercja testu `.MD`.

### Konsultacja `solution-architect` (2026-10-05) — zweryfikowane na repozytorium i w CI
Nowy ADR niepotrzebny (zakres ADR-0012, ADR-0016 i konwencji EVM-006). Środowisko chmury: Node 22.22, pnpm 12.8.1 — `pnpm install` przy `engineStrict` kończy się `ERR_PNPM_UNSUPPORTED_ENGINE`; `npm run test:tools` przechodzi (~7 s, pokrycie `docs-lifecycle` 100%); w CI na `main` (przebieg 37324746626) `@evia/docs-lifecycle` 189/189 testów na Linuksie i Node 26, pokrycie 100%.

**Stan długu z EVM-012 po EVM-006:**

| Pozycja | Stan | Dowód / decyzja |
|---|---|---|
| `tools/*` jako workspace, `engines` Node 26 | zrobione | `pnpm-workspace.yaml:8`, `package.json:6-8` |
| sprawdzanie typów (`checkJs`) | zrobione, z wyjątkiem `noUncheckedIndexedAccess: false` | `tools/docs-lifecycle/tsconfig.json:4-8` → wyjątek do EVM-073 |
| lint w bramce | zrobione, 9 reguł wyłączonych | `tools/docs-lifecycle/eslint.config.js:10-19`, lista wyjątków `tools/repo-policy/test/structure.test.ts:25-26` → do EVM-073 |
| runner monorepo, progi, lcov | zrobione (`node:test` przez `evia-node-test`) | `packages/config/src/node-test.ts:13-29`, `docs/process/testing-strategy.md:75` |
| testy na Linuksie w CI | zrobione | job `quality` (`ci.yml:51-52`); macOS nie dotyczy (ADR-0015) |
| pokrycie `--experimental-test-coverage` | ryzyko zaakceptowane centralnie w EVM-006 | `packages/config/src/node-test.ts:17` |
| Vitest zamiast `node:test` | **nie robimy** („Decyzje” 1) | EVM-006 ustanowił `node:test` + `evia-node-test` dla `tools/*.mjs`; to jedyne testy, które dziś da się uruchomić w chmurze |
| `.ts` zamiast `.mjs` | **nie robimy** („Decyzje” 1) | spójność z innymi narzędziami `.mjs` (EVM-006 W2); minimum Node 22.15 w polityce (`document-lifecycle.md:133`); `test/readonly.test.mjs` sprawdza źródła `.mjs` |
| test czasu 200 KB nie jest przerywany | **w EVM-013** | `test/references.test.mjs:151`, `:170-172` |
| nity | **w EVM-013** | `lib/analyze.mjs:139,149`; `document-lifecycle.md:171`; `test/analyze-errors.test.mjs:95-98` |

**Bramka CI.** Krok w jobie `quality`, zaraz po `actions/setup-node`, przed `pnpm install` (`ci.yml:37-42`): sprawdza czyste drzewo commita, zanim build i testy utworzą pliki; nie zależy od instalacji ani `engineStrict`; przy błędzie job jest czerwony po ok. 20 s. `ci-gate` bez zmian (`quality` już w `needs`, `ci.yml:156,166`). Koszt: 0 dodatkowych minut (osobny job = +1 rozliczana minuta na przebieg). Skutek: przy błędzie dokumentacji lint i testy `quality` nie wykonają się w tym przebiegu, a `coverage` zostanie pominięty — `ci-gate` czerwony (fail-closed); akceptowalne, bo `npm run docs:check` działa lokalnie, także w chmurze. Polecenie: `node tools/docs-lifecycle/cli.mjs check` (to samo co `npm run docs:check`), bez `--today` i `--list`. Kody wyjścia bez zmian (`lib/main.mjs:4,19,120`): 0 — brak błędów (ostrzeżenia dozwolone), 1 — błędy, 2 — błąd użycia lub środowiska.

**Podsumowanie przebiegu.** CLI nie ma trybu `--format` (`lib/main.mjs:53`) i nie może sam pisać do `$GITHUB_STEP_SUMMARY` (narzędzie tylko do odczytu — `test/readonly.test.mjs:57-60`, polityka l. 184). Format podsumowania z kontroli bezpieczeństwa 5 (płotki, limit pozycji) wymaga nowego wyjścia narzędzia na stdout (np. opcja formatu dla podsumowania); zapis do `$GITHUB_STEP_SUMMARY` robi krok workflowu. **Pułapka:** krok bez `shell:` działa jako `bash -e` **bez `pipefail`** — `… | tee` gubi kod wyjścia (sprawdzone: przy błędach daje 0). Wzorzec bez potoku (sprawdzony z `bash -e` na syntetycznym repo):
```yaml
- name: Documentation lifecycle (docs:check, bramka 11)
  run: |
    status=0
    node tools/docs-lifecycle/cli.mjs check > "$RUNNER_TEMP/docs-check.txt" 2>&1 || status=$?
    cat "$RUNNER_TEMP/docs-check.txt"
    # podsumowanie: bezpieczny format z narzędzia (kontrola bezpieczeństwa 5) → "$GITHUB_STEP_SUMMARY"
    exit "$status"
```
Bez `continue-on-error` i bez `${{ }}` w `run` (zizmor). Adnotacje `::warning` pomijamy (YAGNI; zwiększają powierzchnię Z2).

**Parytet z lokalną bramką** („Decyzje” 3): ten sam krok w `pnpm run gate`, po `node tools/git-hooks/cli.mjs check`; `npm run docs:check` zostaje osobnym punktem DoD, bo w chmurze `gate` nie działa. Niezmienniki repozytorium (Vitest, `tools/repo-policy`) do aktualizacji: `test/workflows.test.ts:53-63` (lista kroków `quality`), `test/structure.test.ts:146-151` (skrypt `gate`); nowy test kroku (wymagania — „Bezpieczeństwo i prywatność” → „Testy do dodania”).

**Zależność od daty.** Od daty zależą wyłącznie **ostrzeżenia** „przeterminowany” (`expires` / `review_by` wcześniejsze niż dzisiaj — `lib/analyze.mjs:518-526`); błędy i kod wyjścia nie. CI nie zaczerwieni się samym upływem czasu; ostrzeżenia trafią do podsumowania. „Dzisiaj” = data w Europe/Warsaw z zegara runnera (`lib/dates.mjs:33`) — ponowne uruchomienie starego commita może pokazać nowe ostrzeżenia; w CI bez `--today`. Zmiana „przeterminowany” na błąd to zmiana polityki (decyzja Konrada) — zaczerwieniłaby `main` bez commita. CI startuje z czystego checkoutu (bez plików nieśledzonych); lokalnie walidator może być surowszy (nieśledzone `.md`) — bezpieczny kierunek.

**Test 200 KB** (`references.test.mjs:151,170`): `timeout` w `node:test` nie przerywa kodu synchronicznego; dziś zapas duży (lokalnie ~30 ms, w CI z pokryciem 66–131 ms przy limicie 2000 ms), ale regresja zawiesiłaby job do `timeout-minutes: 20`. Rozwiązanie: obliczenie w `worker_threads` (`new Worker(url, { workerData })`), pomiar czasu wewnątrz workera (bez startu); wątek główny — `Promise.race` z twardym terminem (np. 10 s) i `worker.terminate()` w `finally`. Asercja „< 2 s” z AC4 EVM-012 bez zmian; test proporcji 50/200 KB niepotrzebny. Sprawdzone na Node 22.22: `terminate()` przerywa w ~300 ms pętlę synchroniczną i katastrofalny backtracking. Pokrycie `references.mjs` (100%) zapewniają inne testy w procesie — potwierdzić, że nie spada. Ten sam wzorzec dla testów ReDoS z L3.

**Nity:** flaga `classError` w rekordzie ustalenia zamiast listy `CLASS_ERRORS` (`lib/analyze.mjs:139,149`); w polityce (`document-lifecycle.md:171`) wyliczyć „błędy klasy” (doprecyzowanie bez zmiany reguł); `test/analyze-errors.test.mjs:95-98` — powiązać ścieżkę z numerem reguły (`Cennik.MD` → 16, `X.Md` → 14).

**Weryfikacja w chmurze (Node 22.22, bez Dockera).** Natywnie: `npm run test:tools` (wszystkie `tools/**/*.test.mjs`, progi 90%) i `npm run docs:check` — wystarcza dla zmian w `tools/docs-lifecycle`. Tylko w CI: lint, typecheck, Prettier, Vitest (`tools/repo-policy`), `evia-node-test`, `pnpm run gate`, zmiany `ci.yml`. Dopóki pracujemy w chmurze, narzędzie musi działać na Node ≥ 22.15 (polityka l. 133) — bez API z Node 24+ (np. `RegExp.escape`); CI testuje tylko Node 26, więc `npm run test:tools` na Node 22 jest częścią weryfikacji. Po wdrożeniu Node 26 w środowisku chmury (osobny krok, „Decyzje” 4) część tych bramek będzie dostępna lokalnie.

**Hook git:** w chmurze hooki się nie instalują (`prepare` uruchamia lefthook z `node_modules`); lokalnie walidator czyta drzewo robocze, nie indeks (fałszywe alarmy od nieśledzonych plików, przepuszczona poprawka spoza indeksu); `lefthook.yml` to plik wrażliwy (K3) → bez hooka; ewentualnie `pre-push` po powrocie do pracy lokalnej.

**Na przyszłość:** jeśli wejdzie pomijanie ciężkich jobów przy zmianach tylko w dokumentacji (`docs/ops/github-i-ci.md:68`), `docs:check` musi trafić do joba, który uruchamia się zawsze.

**Ryzyka:** średnie — o zmianach w `ci.yml` i `repo-policy` dowiadujemy się tylko z CI (spodziewane 1–2 pushe; przebieg ok. 6 rozliczanych minut); niskie — przy błędzie dokumentacji nie widać wyników reszty `quality` (akceptowane); niskie — fałszywa zieleń przez potok bez `pipefail` (chroni wzorzec i test w `repo-policy`). Spike niepotrzebny.

**Obserwacje do backlogu (z EVM-012, poza zakresem):** zagnieżdżone repozytorium git w `spikes/` zgłaszane jako „spike bez README”; zbyt surowy test sąsiedztwa kroków w `test/qa-acceptance.test.mjs:632-639`.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
Refinement 2026-10-05 (Konrad):

1. **Zakres — bramka CI + bezpieczne wyjście:** krok `docs:check` w CI; poprawki L1–L4 (neutralizacja logu, bezpieczne podsumowanie z limitem pozycji, wyrażenia bez zawieszania, cytowanie ścieżki); test 200 KB (i testy ReDoS) w `worker_threads` z twardym przerwaniem; nity z EVM-012. Zniesienie wyjątków ESLint i TypeScript w `tools/docs-lifecycle` (`noUncheckedIndexedAccess` — 47 błędów, 9 reguł ESLint, lista `RELAXED` w `repo-policy`) → nowa historyjka **EVM-073** (szkic). Vitest zamiast `node:test` i `.ts` zamiast `.mjs` — zamknięte jako „nie robimy”.
2. **Krok w jobie `quality`** (pierwszy, przed `pnpm install`; 0 dodatkowych minut) zamiast osobnego joba — kontrole bezpieczeństwa 1–9 obowiązują w tej formie.
3. **`docs:check` w `pnpm run gate`** — parytet z CI; w chmurze dodatkowo osobny punkt DoD.
4. **Node 26 dla środowiska Claude Code web** — osobny krok poza EVM-013: `devops-engineer` przygotowuje i sprawdza polecenia do skryptu konfiguracji środowiska; Konrad wkleja je w ustawieniach środowiska.
5. Bez hooka git (pre-commit / pre-push) — do rozważenia po powrocie do pracy lokalnej. Dowód czerwonego przebiegu — na gałęzi historyjki, commit z celowym błędem, potem `git revert` (squash nie przenosi go na `main`).

Akceptacja 2026-10-05 (Konrad):

6. **AC1–AC8 zaakceptowane** — status `ready`; realizacja (`/deliver EVM-013`) na tej samej gałęzi, refinement trafia do `main` razem z realizacją w jednym PR.
7. **EVM-073 — faza 7 M1** (po historyjkach P1, jeśli nie opóźnia 1.0; wcześniej tylko decyzją Konrada, gdy środowisko chmury będzie miało Node 26).
8. **Pozycje do backlogu (L5, obserwacje z EVM-012)** — jedna historyjka P3 „Porządki walidatora dokumentacji” tworzona po zakończeniu EVM-013, z `security-engineer` jako recenzentem (L5 zmienia `ci.yml`); do tego czasu — „Uwagi do rozważenia”. EVM-073 bez przeglądu `security-engineer` (zachowanie narzędzia bez zmian, poza listami K3/K6).

## Uwagi do rozważenia
Propozycje pozycji backlogu (poza zakresem, przez `/refine` po decyzji Konrada):
1. **L5** — `codeCell` w `tools/docs-lifecycle/lib/format.mjs` psuje się dla ścieżek z dwoma backtickami, a krok K3 w jobie `security` (`ci.yml`) wpisuje ścieżki z `git diff` do podsumowania bez escapowania Markdown (CWE-116, Low).
2. **Zagnieżdżone repozytorium git w `spikes/`** zgłaszane jako „spike bez README” (obserwacja z EVM-012).
3. **Test sąsiedztwa kroków** w `tools/docs-lifecycle/test/qa-acceptance.test.mjs` jest zbyt surowy (obserwacja z EVM-012).

## Definition of Done
- [ ] Warunek startu sprawdzony: `npm run docs:check` na `main` daje 0 błędów (w przeciwnym razie stop i pytanie do Konrada przed włączeniem bramki).
- [ ] AC1–AC8 spełnione. Testy automatyczne oznaczone `EVM-013 AC#` obejmują AC3–AC7 i skrypt `gate` z AC8; AC1 i AC2 potwierdzają przebiegi CI. Nowy i zmieniony kod ma pokrycie linii i gałęzi ≥ 90%, a pokrycie `tools/docs-lifecycle` nie spada.
- [ ] Natywnie w Claude Code web (Node 22): `npm run docs:check` daje 0 błędów (ostrzeżenia przejrzane), a `npm run test:tools` jest zielone (≥ 90%).
- [ ] Bramki niedostępne w chmurze — lint, typy, Prettier, testy Vitest `tools/repo-policy`, testy `@evia/docs-lifecycle` na Node 26 i `pnpm run gate` — potwierdza zielony `ci-gate` na HEAD gałęzi. Raport QA wymienia wprost bramki sprawdzone tylko w CI. Każdą rozbieżność między wynikiem lokalnym a CI wyjaśniamy.
- [ ] Dowody z GitHub Actions (wiążące, bo pracujemy w Claude Code web) — linki w raporcie QA w `docs/qa/EVM-013/`. Każdy przebieg jest zakończony, nie anulowany: kolejny push dopiero po zakończeniu poprzedniego przebiegu, bo `concurrency` anuluje przebiegi gałęzi.
  1. Commit z syntetycznym błędem dokumentacji → czerwony `ci-gate`, przyczyna w kroku walidatora, błąd w podsumowaniu (AC1, AC5); potem `git revert`.
  2. Commit z samymi ostrzeżeniami (np. syntetyczny dokument osierocony) → zielony `ci-gate`, ostrzeżenia w podsumowaniu (AC2); potem `git revert`.
  3. HEAD gałęzi → zielony `ci-gate`, podsumowanie zgodne z lokalnym `npm run docs:check` z tego dnia, czas kroku krótszy niż 1 min (AC2, AC3).

  Pliki syntetyczne nie zawierają danych osobowych. Usuwa je commit `revert` bez przepisywania historii, a squash merge nie przenosi ich na `main`.
- [ ] Przeglądy `code-reviewer` i `security-engineer` — APPROVE (`ci.yml` to plik wrażliwy, K3). `security-engineer` aktualizuje `docs/security/requirements.md` (SR-SUPPLY-11, kolumna „Weryfikacja”) i `docs/security/threat-model.md` (C-17, pula minut przy Z4).
- [ ] Dokumentacja (AC8) i `CHANGELOG.md` (Unreleased) zaktualizowane.
- [ ] Demo i akceptacja Konrada w przeglądarce: PR → zakładka „Checks” → przebieg z dowodu 1 (czerwony `ci-gate`, błąd w podsumowaniu) → przebieg z dowodu 3 (zielony `ci-gate`, podsumowanie walidatora). Konrad odhacza w checkliście PR plik wrażliwy `ci.yml` (K3) i scala wg K2. Po scaleniu K6 wypisze commit w logu (zmiana `.github/`), a Konrad potwierdza „Pull request merge” w Activity.

## Dziennik
- 2026-10-02 — utworzono jako szkic (orkiestrator, refinement EVM-012)
- 2026-10-03 — dopisano dług techniczny przekazany z EVM-012 („Notatki techniczne”) (product-owner)
- 2026-10-05 — refinement (product-owner): historyjka i rezultat, kontekst (stan po EVM-006, warunek startu, praca wyłącznie w Claude Code web), AC1–AC7, „Poza zakresem” (dług z EVM-012 i lokalne wymuszenie — do decyzji Konrada), DoD z dowodami z przebiegów CI; dodany recenzent `security-engineer`. „Notatki techniczne” bez zmian, a „Bezpieczeństwo i prywatność” czeka na konsultację `solution-architect` i `security-engineer` (wkleja orkiestrator). Status `draft` do akceptacji Konrada.
- 2026-10-05 — konsultacje `solution-architect` („Notatki techniczne”) i `security-engineer` („Bezpieczeństwo i prywatność”: L1–L5, kontrole 1–9) wklejone przez orkiestratora; decyzje Konrada 1–5 („Decyzje”)
- 2026-10-05 — AC i DoD dostosowane do „Decyzji” 1–5; szkic EVM-073 (product-owner)
- 2026-10-05 — draft → ready: AC1–AC8 zaakceptowane przez Konrada; decyzje 6–8 (EVM-073 — faza 7; porządki walidatora — P3 po EVM-013)
