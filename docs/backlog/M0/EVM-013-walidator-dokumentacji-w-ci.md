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
_Do uzupełnienia — treść przygotowuje `security-engineer` (konsultacja 2026-10-05: zmiana pliku wrażliwego `.github/workflows/ci.yml` — K3, uprawnienia joba, łańcuch dostaw); wkleja orkiestrator._ Role aplikacji (Administrator / Edytor / Tylko odczyt / niezalogowany) nie dotyczą tej historyjki, bo zmiana nie dotyka aplikacji ani danych klientów.

## Notatki techniczne
- Dług przekazany z EVM-012 (przegląd `solution-architect` 2026-10-02, szczegóły: EVM-012 → „Plan techniczny” → „Ustalenia z konsultacji”): Vitest zamiast `node:test`; `checkJs` albo `.ts` (w Node 26 type stripping jest stabilny); uruchomienie testów walidatora na Linuksie w CI (w EVM-012 część Linux/macOS AC3 może zostać „do potwierdzenia w CI”); `--experimental-test-coverage` jest nadal eksperymentalne także w Node 26; `engines` → Node 26 i `tools/*` jako workspace (wspólnie z EVM-006).

Do uwzględnienia (przegląd poprawek EVM-012, 2026-10-03): testy czasu 200 KB w `tools/docs-lifecycle/test/references.test.mjs` — `timeout` nie przerywa kodu synchronicznego (w CI regresja = zawieszenie joba); przenieść do `worker_threads` z przerwaniem albo test proporcji czasu. Nity: flaga `classError` zamiast listy `CLASS_ERRORS` w `analyze.mjs`; lista „błędów klasy” w polityce; dokładniejsza asercja testu `.MD`.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

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
