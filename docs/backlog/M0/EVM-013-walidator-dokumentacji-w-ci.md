---
id: EVM-013
title: Walidator cyklu życia dokumentacji jako bramka CI
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
owner: devops-engineer
contributors: []
reviewers: [code-reviewer, security-engineer]
depends_on: [EVM-006, EVM-012]
---

# EVM-013: Walidator cyklu życia dokumentacji jako bramka CI

## Historyjka
Jako **Konrad (właściciel produktu, jedyna osoba scalająca PR)** chcę, **aby walidator dokumentacji z EVM-012 działał w CI na każdym pushu: błędy polityki cyklu życia dokumentów czerwienią `ci-gate`, a ostrzeżenia widzę w podsumowaniu przebiegu**, aby **porządek w dokumentacji (w tym brak plików roboczych w repozytorium) nie zależał od pamięci agentów ani od ręcznego uruchomienia walidatora przed scaleniem**.

**Rezultat (enabler):** `npm run docs:check` jest bramką 11 z `docs/security/requirements.md` (SR-SUPPLY-11). Błąd walidatora daje czerwony `ci-gate`, więc według procedury scalania K2 PR nie zostaje scalony. Ostrzeżenia są widoczne w podsumowaniu przebiegu i niczego nie blokują.

## Kontekst
- **Dlaczego teraz.** Decyzja Konrada z 2026-10-02 (refinement EVM-012): do czasu CI walidator tylko raportuje, a blokada w CI powstaje po EVM-006. EVM-006 jest `done`. Ostatnie historyjki dokumentacyjne (EVM-015, EVM-071) dodały kilkadziesiąt plików `.md`, a `docs:check` uruchamiał tylko orkiestrator lokalnie. Błąd polityki (np. plik roboczy dodany do gita albo notatka poza dozwoloną lokalizacją) może dziś trafić na `main` niezauważony.
- **Stan na 2026-10-05 (sprawdzony przez orkiestratora).** EVM-006 uruchamia w CI (`.github/workflows/ci.yml`, job `quality`) lint, typy i testy z pokryciem wszystkich workspace'ów. Obejmuje to testy walidatora (`@evia/docs-lifecycle`) na Linuksie, więc punkt „uruchomienie na Linuksie w CI” z długu EVM-012 jest już zrealizowany. CI **nie** uruchamia samego walidatora na repozytorium: błędy polityki nie czerwienią `ci-gate`, a ostrzeżenia nie są nigdzie widoczne.
- **Warunek startu.** Walidator sprawdza całe repozytorium, więc błąd obecny już na `main` czerwieniłby każdą gałąź. Na początku realizacji `npm run docs:check` na `main` musi dać 0 błędów. Jeśli tak nie jest, wykonawca się zatrzymuje i pyta Konrada (naprawa może wymagać przeniesienia dokumentów z `main`, a o tym decyduje Konrad).
- **Ograniczenie środowiska (Konrad, 2026-10-05).** Do odwołania pracujemy wyłącznie w Claude Code web (kontener Linux w chmurze, Node 22, bez demona Dockera, bez Windows i emulatora).
  - Działają: `npm run docs:check`, `npm run test:tools`, push gałęzi `feature/EVM-*` i odczyt wyników CI.
  - Tylko w CI: `pnpm install` (`engineStrict` wymaga Node 26), `pnpm run gate`, `pnpm run scan` i testy Vitest (`tools/repo-policy`).
  - **Wiążącą weryfikacją są przebiegi GitHub Actions** — patrz „Definition of Done”.
- **GitHub Free nie ma twardej blokady (ADR-0016).** „Blokuje merge” oznacza tu trzy rzeczy: czerwony `ci-gate`, procedurę scalania K2 (Konrad scala tylko przy zielonym `ci-gate`) i wykrywanie przez K6 (`docs/ops/github-i-ci.md`).
- Powiązane dokumenty: polityka `docs/process/document-lifecycle.md`, narzędzie `tools/docs-lifecycle/README.md`, CI `docs/ops/github-i-ci.md`. Dług narzędzia z EVM-012 opisują „Notatki techniczne”; propozycja wydzielenia jest w sekcji „Poza zakresem”.

## Kryteria akceptacji
**AC1 — Błąd dokumentacji czerwieni `ci-gate`**
- Zakładając, że ostatni commit gałęzi zawiera plik `.md` łamiący politykę (np. syntetyczny `docs/notatka-evm-013.md` poza dozwolonymi lokalizacjami — przykład z SR-SUPPLY-11 — albo plik z `.scratch/` dodany do gita),
- Gdy gałąź zostaje wypchnięta i przebieg `ci.yml` się kończy,
- Wtedy check `ci-gate` tego commita jest czerwony, a nazwa kroku lub joba wskazuje walidator dokumentacji jako przyczynę. Log i podsumowanie przebiegu zawierają listę błędów w formacie walidatora (`BŁĄD · <ścieżka> · <klasa> · <powód i wskazówka>`) oraz podpowiedź, jak powtórzyć sprawdzenie lokalnie (`npm run docs:check`). Dowodem jest prawdziwy przebieg CI z celowo wprowadzonym błędem (DoD).

**AC2 — Ostrzeżenia widoczne, ale nieblokujące**
- Zakładając, że walidator zgłasza 0 błędów i co najmniej jedno ostrzeżenie (np. „osierocony” albo „przeterminowany”),
- Gdy przebieg CI się kończy,
- Wtedy walidator dokumentacji nie zmienia wyniku `ci-gate` (decydują pozostałe bramki). Podsumowanie przebiegu (GitHub Step Summary) ma sekcję walidatora z licznikiem `błędy: 0 · ostrzeżenia: N` i listą ostrzeżeń (ścieżka · klasa · powód). Przy braku błędów i ostrzeżeń sekcja pokazuje jednoznaczny komunikat o czystej dokumentacji. Ostrzeżenia zależne od daty („przeterminowany”) nigdy nie zmieniają wyniku bramki, więc ten sam commit ma ten sam wynik `ci-gate` niezależnie od dnia przebiegu.

**AC3 — Wynik dotyczy commita i jest zawsze widoczny**
- Zakładając dowolny przebieg CI, także taki, w którym czerwony jest inny etap (np. formatowanie, testy, skany),
- Gdy przebieg się kończy,
- Wtedy wynik walidatora jest dostępny w tym samym przebiegu, więc błędy dokumentacji widać bez naprawiania innych etapów. Liczby błędów i ostrzeżeń są takie same jak wynik `npm run docs:check` uruchomionego tego samego dnia na czystym klonie tego commita. Pliki wygenerowane przez inne etapy CI (np. zależności, raporty pokrycia i skanów) nie zmieniają wyniku.

**AC4 — Brak fałszywej zieleni**
- Zakładając, że walidator w CI nie dał wyniku „0 błędów”, bo zakończył się błędem użycia lub środowiska (kod `2`, np. brak repozytorium git), nie uruchomił się, został pominięty albo anulowany,
- Gdy przebieg się kończy,
- Wtedy `ci-gate` jest czerwony. Jeśli zmiana w gałęzi osłabia bramkę (usuwa walidator z CI, ignoruje jego kod wyjścia, np. przez `continue-on-error` albo `|| true`, albo wyłącza go z warunku `ci-gate`), automatyczny test w bramce CI (oznaczony `EVM-013 AC4`) kończy się błędem z komunikatem wskazującym naruszenie.

**AC5 — Lekka bramka**
- Zakładając obecny `ci.yml` jako punkt odniesienia,
- Gdy walidator działa w CI,
- Wtedy uruchamia się tym samym poleceniem co lokalnie i nie wymaga instalacji zależności projektu, nowych zależności npm, nowych akcji GitHub ani sekretów. Wydłuża czas od pushu do wyniku `ci-gate` o nie więcej niż 1 min i zwiększa zużycie minut Actions o nie więcej niż 1 min na przebieg. Pomiar porównuje przebieg przed zmianą i po niej; wynik trafia do raportu QA.

**AC6 — Bezpieczny workflow i bezpieczne podsumowanie**
- Zakładając, że zmieniony został `.github/workflows/ci.yml` (plik wrażliwy — K3),
- Gdy przebiega CI,
- Wtedy:
  - wszystkie dotychczasowe kontrole workflowów przechodzą bez nowych wyjątków (testy niezmienników `tools/repo-policy`, zizmor, actionlint);
  - walidator działa z uprawnieniami wyłącznie do odczytu treści repozytorium i bez sekretów;
  - podsumowanie przebiegu zawiera wyłącznie ścieżki i metadane, nigdy treść dokumentów;
  - ścieżka pliku ze znakami Markdown lub HTML (test na danych syntetycznych) jest wyświetlana dosłownie — nie tworzy linku, obrazka ani formatowania.

**AC7 — Dokumentacja i odwołania**
- Zakładając, że Konrad albo agent chce wiedzieć, jak działa bramka dokumentacji,
- Gdy czyta `CLAUDE.md` („Stack i komendy”), `docs/ops/github-i-ci.md` („CI w skrócie”), `tools/docs-lifecycle/README.md`, `docs/process/document-lifecycle.md` (tabela „Kiedy” i „Walidator i raport sprzątania”) oraz `docs/security/requirements.md` (bramka 11),
- Wtedy:
  - dowiaduje się, że walidator działa w CI na każdym pushu, co blokuje (błędy), czego nie blokuje (ostrzeżenia), gdzie zobaczyć wynik (podsumowanie przebiegu) i jak powtórzyć go lokalnie (`npm run docs:check`);
  - lokalny punkt DoD i polecenie w raporcie agenta zostają bez zmian;
  - `CHANGELOG.md` (Unreleased) ma wpis;
  - odwołania do „długu EVM-013” w repozytorium (README narzędzi, komentarze w konfiguracji, nazwy testów) wskazują historyjkę, która przejmuje dług (jeśli Konrad zaakceptuje podział — patrz „Poza zakresem”);
  - `npm run docs:check` daje 0 błędów.

## Poza zakresem
- **Dług techniczny narzędzia z EVM-012** („Notatki techniczne”): Vitest zamiast `node:test` (także w pozostałych `tools/*` w `.mjs`), `.ts` albo `checkJs`, zniesienie wyjątku od wspólnych reguł ESLint i TypeScript dla `tools/docs-lifecycle`, test czasu 200 KB w `worker_threads`, nity (`classError`, lista „błędów klasy” w polityce, asercja testu `.MD`). Propozycja: osobna historyjka (decyzja Konrada). Ta historyjka zmienia tylko to, **gdzie** walidator działa i **gdzie** widać jego wynik.
- Lokalne wymuszenie: hook pre-commit lub pre-push z walidatorem albo dopisanie `docs:check` do `pnpm run gate` (decyzja Konrada). Wiążące jest CI, a `npm run docs:check` zostaje w DoD i w raporcie agenta.
- Zmiany reguł polityki i logiki walidacji (co jest błędem, a co ostrzeżeniem, nowe lokalizacje, treść komunikatów).
- Twarda blokada scalenia po stronie GitHuba (ochrona gałęzi, ruleset) — niedostępna na GitHub Free (ADR-0016).
- Pomijanie ciężkich jobów przy zmianach wyłącznie w dokumentacji (job `changes`) — EVM-006, „Uwagi do rozważenia”, po przekroczeniu ok. 1500 min/mies.
- Adnotacje przy plikach w PR i komentarze bota — wystarcza podsumowanie przebiegu.
- Nocne raportowanie przeterminowanych dokumentów lub zakładanie zgłoszeń — wystarczają przegląd w `/milestone close` i punkt DoD.
- Sprawdzanie treści dokumentów (merytoryka, linki zewnętrzne, pisownia) — poza polityką z EVM-012.

## UX / UI
Nie dotyczy, bo aplikacja się nie zmienia. Wynik odczytują Konrad i agenci w widoku przebiegu GitHub Actions. Komunikaty są po polsku, w formacie walidatora z EVM-012, bez nowych tekstów interfejsu.

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

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Warunek startu sprawdzony: `npm run docs:check` na `main` daje 0 błędów (w przeciwnym razie stop i pytanie do Konrada przed włączeniem bramki).
- [ ] AC1–AC7 spełnione. Testy automatyczne oznaczone `EVM-013 AC#` obejmują co najmniej AC4 i AC6. Nowy kod (jeśli powstanie, np. budowa podsumowania) ma pokrycie linii i gałęzi ≥ 90%.
- [ ] Dowody z GitHub Actions (wiążące, bo pracujemy w Claude Code web). Każdy przebieg jest zakończony, nie anulowany, a linki leżą w `docs/qa/EVM-013/`:
  1. commit z syntetycznym błędem dokumentacji → czerwony `ci-gate`, przyczyna w walidatorze (AC1, AC3);
  2. commit z samymi ostrzeżeniami → zielony `ci-gate`, ostrzeżenia w podsumowaniu (AC2);
  3. ostatni commit gałęzi → zielony `ci-gate`, podsumowanie zgodne z lokalnym `npm run docs:check` (AC2, AC3);
  4. pomiar czasu i minut przed zmianą i po niej (AC5).

  Pliki syntetyczne (bez danych osobowych) usuwa commit `revert`, bez przepisywania historii, więc nie trafiają na `main`.
- [ ] Lokalnie w Claude Code web: `npm run docs:check` daje 0 błędów (ostrzeżenia przejrzane), a `npm run test:tools` jest zielone (≥ 90%). Kroki niedostępne lokalnie (`pnpm run gate`, `pnpm run scan`, testy Vitest) zastępuje zielony `ci-gate` ostatniego commita gałęzi, co raport QA zaznacza wprost. Każdą rozbieżność między wynikiem lokalnym a CI wyjaśniamy.
- [ ] Przeglądy `code-reviewer` i `security-engineer` — APPROVE (`ci.yml` to plik wrażliwy, K3).
- [ ] Dokumentacja (AC7) i `CHANGELOG.md` zaktualizowane.
- [ ] Demo i akceptacja Konrada w przeglądarce: PR → zakładka „Checks” → przebieg z dowodu 1 (czerwony `ci-gate`, błąd w podsumowaniu) → przebieg z dowodu 3 (zielony `ci-gate`, czysta dokumentacja); scalenie wg K2.

## Dziennik
- 2026-10-02 — utworzono jako szkic (orkiestrator, refinement EVM-012)
- 2026-10-03 — dopisano dług techniczny przekazany z EVM-012 („Notatki techniczne”) (product-owner)
- 2026-10-05 — refinement (product-owner): historyjka i rezultat, kontekst (stan po EVM-006, warunek startu, praca wyłącznie w Claude Code web), AC1–AC7, „Poza zakresem” (dług z EVM-012 i lokalne wymuszenie — do decyzji Konrada), DoD z dowodami z przebiegów CI; dodany recenzent `security-engineer`. „Notatki techniczne” bez zmian, a „Bezpieczeństwo i prywatność” czeka na konsultację `solution-architect` i `security-engineer` (wkleja orkiestrator). Status `draft` do akceptacji Konrada.
- 2026-10-05 — konsultacje `solution-architect` („Notatki techniczne”) i `security-engineer` („Bezpieczeństwo i prywatność”: L1–L5, kontrole 1–9) wklejone przez orkiestratora; decyzje Konrada 1–5 („Decyzje”)
