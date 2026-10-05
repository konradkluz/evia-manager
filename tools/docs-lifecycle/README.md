# Walidator cyklu życia dokumentów (`tools/docs-lifecycle/`)

Narzędzie z EVM-012: sprawdza, czy każdy plik `.md` w repozytorium ma klasę cyklu życia i leży w dozwolonej lokalizacji, oraz przygotowuje raport sprzątania dla `/milestone close`. Od EVM-013 jest bramką 11 w CI. Zasady, polecenia, błędy i ostrzeżenia: [`docs/process/document-lifecycle.md`](../../docs/process/document-lifecycle.md).

## Polecenia
- `npm run docs:check` — walidacja całego repozytorium (kody wyjścia 0 / 1 / 2); `node tools/docs-lifecycle/cli.mjs check --list` — dodatkowo każdy plik z klasą i jej źródłem.
- `node tools/docs-lifecycle/cli.mjs check --summary` — podsumowanie przebiegu GitHub Actions w Markdown na stdout, a raport (bajtowo ten sam co `check`) na stderr; używa go krok CI.
- `npm run docs:cleanup -- M#` — raport sprzątania dla kamienia milowego (tylko odczyt).
- `npm run test:tools` — testy (`node:test`) z progami pokrycia linii i gałęzi 90%.

Wymagane: Node.js ≥ 22.15 i git; bez instalacji zależności.

## W CI (bramka 11)
Walidator działa na każdym pushu jako pierwszy krok joba `quality` w `.github/workflows/ci.yml` (krok „Documentation lifecycle validator (docs:check, bramka 11)”), zanim cokolwiek zostanie zainstalowane:

```bash
status=0
node tools/docs-lifecycle/cli.mjs check --summary >> "$GITHUB_STEP_SUMMARY" || status=$?
exit "$status"
```

- Kod wyjścia walidatora jest wynikiem kroku: błędy (kod `1`) i błąd narzędzia (kod `2`) dają czerwony `ci-gate`, a pozostałe kroki `quality` się nie wykonują; ostrzeżenia nie blokują.
- Wynik: sekcja „Walidator dokumentacji (EVM-013)” w podsumowaniu przebiegu (do 100 pozycji na listę), pełna lista w logu kroku.
- Lokalnie to samo sprawdza `npm run docs:check` (i `pnpm run gate`, zaraz po sprawdzeniu hooków).
- Krok jest stały: test `docsCheckStepProblems` w `tools/repo-policy` zgłasza każde osłabienie (inne polecenie, `--today`, `--list`, `if`, `continue-on-error`, potok bez `bash`, zgubiony kod wyjścia, inny skrypt).

## Budowa
| Plik | Odpowiedzialność |
|---|---|
| `cli.mjs` | cienkie wejście: ustawia `process.exitCode` wynikiem `main(…)` |
| `lib/main.mjs` | argumenty (`util.parseArgs`), kody wyjścia; wejście i wyjście wyłącznie przez parametr `io` |
| `lib/repository.mjs` | jedyne I/O: git (`rev-parse`, `ls-files`, `check-ignore` — lista dozwolonych poleceń, bez powłoki) i odczyt plików `.md` bez podążania za dowiązaniami |
| `lib/analyze.mjs` | klasyfikacja i walidacja — czysta funkcja zbioru plików; flaga `classError` przy ustaleniu („Błędy klasy”) |
| `lib/cleanup.mjs` | raport sprzątania; jedna funkcja decyzji `proposeAction` |
| `lib/format.mjs` | wyjście po polsku (`check`, `--list`, raport sprzątania, podsumowanie przebiegu); każda linia przez `safeLine` |
| `lib/config.mjs`, `lifecycle.config.json` | reguły lokalizacji — odpowiednik 1:1 tabeli z polityki (pilnuje test spójności) |
| `lib/patterns.mjs`, `lib/frontmatter.mjs`, `lib/dates.mjs`, `lib/milestones.mjs`, `lib/references.mjs`, `lib/text.mjs` | wzorce lokalizacji, metadane, daty (`Europe/Warsaw`), lista kamieni milowych, odwołania między dokumentami, funkcje pomocnicze (`escapeText`, `safeLine`, `shellQuote`) |
| `test/` | testy oznaczone `EVM-012 AC#` i `EVM-013 AC#`; fikstury syntetyczne budowane w katalogu tymczasowym (`test/helpers/`) |

## Niezmienniki
- **Tylko odczyt:** w kodzie narzędzia nie ma API zapisu, przenoszenia ani usuwania plików, a git działa wyłącznie z listy dozwolonych poleceń (pilnuje `test/readonly.test.mjs`). Narzędzie nie zna pliku podsumowania przebiegu — pisze na stdout, a do podsumowania kieruje je krok workflowu.
- **Bezpieczne wyjście (EVM-013):** każda linia stdout i stderr przechodzi przez `safeLine` — znaki sterujące escapowane, `::` na początku linii i `##[` w dowolnym miejscu linii zneutralizowane, więc nazwa pliku nie staje się poleceniem runnera GitHub Actions; narzędzie nie emituje adnotacji. Wartości w podsumowaniu przebiegu są tylko w bloku kodu. Wskazówka `git rm --cached` cytuje ścieżkę dla powłoki POSIX.
- **Czas liniowy:** wyrażenia regularne bez nakładających się kwantyfikatorów; testy czasu dla plików 200 KB działają w wątku (`worker_threads`) z twardym terminem 10 s (`test/helpers/timed-worker.mjs`), więc regresja kończy test błędem zamiast zawieszać CI.
- **Bez zależności:** tylko moduły `node:*` i importy względne; JavaScript ESM z JSDoc i `// @ts-check`, bez kroku budowania; testy w `node:test` (decyzja EVM-013: bez Vitest i `.ts`).
- **Determinizm:** sortowanie po jednostkach kodu, „dzisiaj” z `Intl` w strefie `Europe/Warsaw`, odwołania rozwiązywane wyłącznie względem listy plików z gita (ścieżek z treści dokumentów nigdy się nie otwiera).
- **Zmiana reguł:** nowa lokalizacja = zmiana tabeli w polityce i `lifecycle.config.json` w tej samej historyjce.

Wyjątki od wspólnych reguł ESLint i TypeScript (`eslint.config.js`, `tsconfig.json`, lista `RELAXED` w `tools/repo-policy`) znosi [EVM-073](../../docs/backlog/M1/EVM-073-wyjatki-jakosci-docs-lifecycle.md).
