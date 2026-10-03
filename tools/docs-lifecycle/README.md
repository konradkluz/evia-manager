# Walidator cyklu życia dokumentów (`tools/docs-lifecycle/`)

Narzędzie z EVM-012: sprawdza, czy każdy plik `.md` w repozytorium ma klasę cyklu życia i leży w dozwolonej lokalizacji, oraz przygotowuje raport sprzątania dla `/milestone close`. Zasady, polecenia, błędy i ostrzeżenia: [`docs/process/document-lifecycle.md`](../../docs/process/document-lifecycle.md).

## Polecenia
- `npm run docs:check` — walidacja całego repozytorium (kody wyjścia 0 / 1 / 2); `node tools/docs-lifecycle/cli.mjs check --list` — dodatkowo każdy plik z klasą i jej źródłem.
- `npm run docs:cleanup -- M#` — raport sprzątania dla kamienia milowego (tylko odczyt).
- `npm run test:tools` — testy (`node:test`) z progami pokrycia linii i gałęzi 90%.

Wymagane: Node.js ≥ 22.15 i git; bez instalacji zależności.

## Budowa
| Plik | Odpowiedzialność |
|---|---|
| `cli.mjs` | cienkie wejście: ustawia `process.exitCode` wynikiem `main(…)` |
| `lib/main.mjs` | argumenty (`util.parseArgs`), kody wyjścia; wejście i wyjście wyłącznie przez parametr `io` |
| `lib/repository.mjs` | jedyne I/O: git (`rev-parse`, `ls-files`, `check-ignore` — lista dozwolonych poleceń, bez powłoki) i odczyt plików `.md` bez podążania za dowiązaniami |
| `lib/analyze.mjs` | klasyfikacja i walidacja — czysta funkcja zbioru plików |
| `lib/cleanup.mjs` | raport sprzątania; jedna funkcja decyzji `proposeAction` |
| `lib/format.mjs` | wyjście po polsku, escapowanie znaków sterujących |
| `lib/config.mjs`, `lifecycle.config.json` | reguły lokalizacji — odpowiednik 1:1 tabeli z polityki (pilnuje test spójności) |
| `lib/patterns.mjs`, `lib/frontmatter.mjs`, `lib/dates.mjs`, `lib/milestones.mjs`, `lib/references.mjs`, `lib/text.mjs` | wzorce lokalizacji, metadane, daty (`Europe/Warsaw`), lista kamieni milowych, odwołania między dokumentami, funkcje pomocnicze |
| `test/` | testy oznaczone `EVM-012 AC#`; fikstury syntetyczne budowane w katalogu tymczasowym (`test/helpers/`) |

## Niezmienniki
- **Tylko odczyt:** w kodzie narzędzia nie ma API zapisu, przenoszenia ani usuwania plików, a git działa wyłącznie z listy dozwolonych poleceń (pilnuje `test/readonly.test.mjs`).
- **Bez zależności:** tylko moduły `node:*` i importy względne; JavaScript ESM z JSDoc i `// @ts-check`, bez kroku budowania.
- **Determinizm:** sortowanie po jednostkach kodu, „dzisiaj” z `Intl` w strefie `Europe/Warsaw`, odwołania rozwiązywane wyłącznie względem listy plików z gita (ścieżek z treści dokumentów nigdy się nie otwiera).
- **Zmiana reguł:** nowa lokalizacja = zmiana tabeli w polityce i `lifecycle.config.json` w tej samej historyjce.

Dług przekazany do EVM-013 / EVM-006 (runner, typy, CI na Linuksie): EVM-012 → „Plan techniczny” → „Ustalenia z konsultacji”.
