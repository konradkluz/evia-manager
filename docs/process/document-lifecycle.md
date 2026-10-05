# Cykl życia dokumentów

> Dokument żywy (EVM-012). Właściciel: `product-owner`; walidator i raport sprzątania: `devops-engineer`; zmiany polityki zatwierdza Konrad. Tabela „Dozwolone lokalizacje” jest jednocześnie konfiguracją walidatora — zmieniamy je razem.

## Cel i zakres
- **Po co.** Agenci i ludzie tworzą wiele plików `.md`: część jest potrzebna przez cały czas życia systemu, część tylko do zamknięcia kamienia milowego, część tylko na chwilę. Polityka mówi, gdzie co zapisać, jak długo to trzymamy i kto decyduje o usunięciu — żeby repozytorium i kontekst agentów nie zarastały nieaktualnymi dokumentami, a każde usunięcie było świadomą decyzją Konrada.
- **Zakres.** Wszystkie pliki `.md` w repozytorium z wyjątkiem ignorowanych przez git (`.gitignore`, np. `node_modules/`, `.idea/`); rozszerzenie w dowolnej wielkości liter (np. `NOTATKA.MD` też podlega polityce). Pliki inne niż `.md` — wyłącznie kod spike'a, objęty w całości przez `README.md` katalogu `spikes/<nazwa>/`; artefakty narzędzi i dowody binarne (zrzuty PNG, raporty testów) obsługuje `.gitignore`.
- **Poza zakresem.** Jakość treści (merytoryka, pisownia, linki zewnętrzne) oraz usuwanie danych z historii git (procedura incydentowa).

## Klasy cyklu życia
| Klasa | Wartość `lifecycle` | Znaczenie | Przykłady | Co się z nią dzieje |
|---|---|---|---|---|
| **trwały** | `permanent` | zapis historyczny lub decyzja; po zamknięciu się nie zmienia | ADR-y, historyjki, retrospektywy, raporty spike'ów (wnioski) | nigdy nie jest proponowany do usunięcia; ADR wycofuje się statusem „Zastąpiona przez ADR-XXXX” |
| **żywy** | `living` | aktualny stan, utrzymywany razem z kodem | wizja, domena, roadmapa, architektura, bezpieczeństwo, styleguide, proces, README, `CHANGELOG.md`, `CLAUDE.md`, `.claude/**` | nie jest proponowany do usunięcia; przy zamknięciu kamienia milowego — przegląd aktualności; zastąpienie lub scalenie tylko decyzją Konrada |
| **kamień milowy** | `milestone` | potrzebny do zamknięcia wskazanego kamienia milowego | raporty QA, raporty przeglądów UX, notatki planistyczne, kod spike'a (`spikes/<nazwa>/`) | przy `/milestone close M#` trafia do raportu sprzątania jako kandydat do usunięcia; wcześniej wnioski przenosimy do historyjki i retrospektywy |
| **roboczy** | `ephemeral` | notatka lub szkic na czas jednej sesji lub kroku | notatki agentów, wyniki pośrednie, wynik polecenia zapisany do pliku | nie trafia do repozytorium — tylko `.scratch/` albo scratchpad sesji (patrz „Pliki robocze”) |

## Oznaczanie klasy
1. **Domyślnie z lokalizacji.** Klasę nadaje pierwsza pasująca reguła z tabeli „Dozwolone lokalizacje” — większość plików nie potrzebuje żadnych metadanych.
2. **Metadane tylko tam, gdzie reguła nie wystarcza** (frontmatter na początku pliku):
   - `docs/notes/**` — pole `lifecycle` jest obowiązkowe; to jedyne pliki z **klasą nadaną ręcznie** — walidator wypisuje ich listę do wglądu Konrada;
   - `spikes/<nazwa>/README.md` — pole `milestone` jest obowiązkowe (w treści README wskazuje historyjkę spike'a);
   - terminy: `expires` (data ważności pliku „kamień milowy”) i `review_by` (termin przeglądu aktualności pliku żywego, np. dokumentu z cenami lub wersjami zewnętrznych usług).
3. **Pole `lifecycle` poza `docs/notes/`** jest opcjonalne, ale musi być zgodne z regułą lokalizacji — klasy nie zmienia się wpisem w pliku (np. ADR z `lifecycle: milestone` to błąd). Zmiana klasy dokumentu = zmiana tej polityki decyzją Konrada.

Przykład — notatka planistyczna potrzebna do zamknięcia M1:

```markdown
---
lifecycle: milestone
milestone: M1
expires: 2027-01-31
---
# Notatka planistyczna M1
```

### Pola metadanych
| Klasa | Obowiązkowe | Opcjonalne | Niedozwolone (błąd) |
|---|---|---|---|
| trwały | — | — | `expires`, `review_by` |
| żywy | — | `review_by: YYYY-MM-DD` — termin przeglądu aktualności | `expires` |
| kamień milowy | M#: z pola `milestone` historyjki `<EVM-ID>` (reguły 11–12), z pola `milestone` w README spike'a (reguła 13) albo z pola `milestone` notatki (reguła 14) | `expires: YYYY-MM-DD` — data ważności | `review_by` |
| roboczy | — | — | jakikolwiek plik widoczny dla gita |

- **Frontmatter** jest rozpoznawany tylko wtedy, gdy pierwsza linia pliku to `---` i istnieje linia zamykająca `---`. Liczą się płaskie pola najwyższego poziomu `klucz: wartość` (bez wcięcia; cudzysłowy wokół wartości są pomijane); pozostałe pola i linie są ignorowane (np. pola historyjek i definicji agentów). Niezamknięty frontmatter = brak metadanych.
- **Pole `milestone`** w plikach trwałych i żywych jest ignorowane (np. we frontmatterze historyjek — źródle prawdy dla `/progress`). W plikach z reguł 11–13 musi być zgodne z M# wynikającym z lokalizacji.
- **Daty:** `YYYY-MM-DD` i prawdziwa data kalendarzowa (`2026-02-30` to błąd). „Dzisiaj” = data w strefie `Europe/Warsaw`. Plik jest **przeterminowany**, gdy `expires` lub `review_by` jest wcześniejsze niż dzisiaj; termin równy dzisiejszej dacie jeszcze obowiązuje.
- **Kamień milowy istnieje**, gdy występuje w tabeli „Przegląd” w `docs/product/roadmap.md` albo ma katalog `docs/backlog/<M#>/` (dziś M0–M7). Nagłówek „Przegląd” i pierwsza kolumna tej tabeli są kotwicą walidatora.

## Dozwolone lokalizacje
Ścieżka względem katalogu głównego repozytorium, separator `/`; **wygrywa pierwsza pasująca reguła**. `*` — dowolne znaki w obrębie jednego segmentu, `**` — dowolna liczba segmentów (także zero); `<M#>` = `M` + cyfry, `<EVM-ID>` = `EVM-` + co najmniej 3 cyfry, `<NNNN>` = 4 cyfry, `<nazwa>` = jeden segment. Wielkość liter ma znaczenie.

| # | Wzorce | Klasa | Kamień milowy | Osierocony |
|---|---|---|---|---|
| 1 | `README.md` · `CLAUDE.md` · `CHANGELOG.md` | żywy (`living`) | — | nie — punkt wejścia |
| 2 | `.claude/**/*.md` | żywy (`living`) | — | nie — konwencja narzędzia |
| 3 | `.scratch/**` | roboczy (`ephemeral`) | — | — (każdy plik widoczny dla gita = błąd) |
| 4 | `docs/README.md` | żywy (`living`) | — | nie — punkt wejścia |
| 5 | `docs/backlog/README.md` · `docs/backlog/_template.md` · `docs/backlog/<M#>/README.md` | żywy (`living`) | — | nie — indeks |
| 6 | `docs/backlog/<M#>/<EVM-ID>-*.md` | trwały (`permanent`) | — | nie — indeks, `/progress` |
| 7 | `docs/architecture/adr/README.md` · `docs/architecture/adr/0000-template.md` | żywy (`living`) | — | nie — indeks |
| 8 | `docs/architecture/adr/<NNNN>-*.md` | trwały (`permanent`) | — | nie — indeks |
| 9 | `docs/process/retros/<M#>.md` | trwały (`permanent`) | — | nie — konwencja |
| 10 | `docs/spikes/<EVM-ID>-*.md` — raport spike'a (wnioski) | trwały (`permanent`) | — | nie — konwencja |
| 11 | `docs/qa/<EVM-ID>/**/*.md` | kamień milowy (`milestone`) | pole `milestone` historyjki `<EVM-ID>` | nie — konwencja |
| 12 | `docs/ux/reviews/<EVM-ID>/**/*.md` | kamień milowy (`milestone`) | pole `milestone` historyjki `<EVM-ID>` | nie — konwencja |
| 13 | `spikes/<nazwa>/**/*.md` | kamień milowy (`milestone`) | pole `milestone` w `spikes/<nazwa>/README.md` (obowiązkowe) | nie — konwencja |
| 14 | `docs/notes/**/*.md` | z pola `lifecycle` | pole `milestone` (gdy `lifecycle: milestone`) | tak (poza `README.md`) |
| 15 | `docs/backlog/**` · `docs/architecture/adr/**` · `docs/process/retros/**` · `docs/qa/**` · `docs/ux/reviews/**` · `docs/spikes/**` · `spikes/*.md` | niedozwolone (`forbidden`) | — | — |
| 16 | `docs/product/**/*.md` · `docs/process/**/*.md` · `docs/architecture/**/*.md` · `docs/security/**/*.md` · `docs/ux/**/*.md` · `docs/ops/**/*.md` · `design/**/*.md` | żywy (`living`) | — | tak (poza `README.md`) |
| 17 | `apps/**/README.md` · `packages/**/README.md` · `services/**/README.md` · `infra/**/README.md` · `tools/**/README.md` · `.github/**/*.md` | żywy (`living`) | — | nie — punkt wejścia |
| — | każdy inny plik Markdown | niedozwolone (`forbidden`) | — | — |

- **Reguła 14** (`docs/notes/`): pole `lifecycle` obowiązkowe — `permanent`, `living` albo `milestone`; `ephemeral` to błąd (plik roboczy należy do `.scratch/`).
- **Reguła 15** chroni katalogi o ściśle określonej strukturze — np. luźna notatka w `docs/backlog/` albo plik `.md` bezpośrednio w `spikes/` to błąd.
- **Spike'i:** każdy katalog `spikes/<nazwa>/` musi mieć `README.md` z polem `milestone` — raport sprzątania obejmuje wtedy cały katalog, także kod.
- **Osierocony** (ostrzeżenie, tylko reguły z „tak”): do pliku nie odwołuje się żaden inny plik `.md` w repozytorium. Odwołanie = link Markdown albo ścieżka pliku `.md` zapisana w tekście (także w `kodzie`), względna do katalogu dokumentu albo do katalogu głównego. `README.md` w dowolnym katalogu jest punktem wejścia i nigdy nie jest osierocony; „indeks” i „konwencja” oznaczają pliki odnajdywane przez strukturę katalogów.
- **Dla utrzymujących walidator** (budowa narzędzia: `tools/docs-lifecycle/README.md`): tabela odpowiada 1:1 konfiguracji `tools/docs-lifecycle/lifecycle.config.json` (te same reguły w tej samej kolejności); test spójności porównuje wzorce (wartości w `…` w kolumnie „Wzorce”) i kod klasy (jedyna wartość w `…` w kolumnie „Klasa”: `permanent`, `living`, `milestone`, `ephemeral`, `lifecycle` — klasa z pola w pliku, `forbidden` — lokalizacja niedozwolona). Wiersz „—” to reguła domyślna.

## Gdzie zapisać dokument
| Potrzebuję zapisać… | Gdzie | Klasa |
|---|---|---|
| notatkę roboczą, szkic, wynik pośredni, wynik polecenia | `.scratch/` albo scratchpad sesji | roboczy |
| decyzję architektoniczną | `docs/architecture/adr/<NNNN>-<opis>.md` (`/adr`) | trwały |
| historyjkę | `docs/backlog/<M#>/<EVM-ID>-<opis>.md` (`/refine`) | trwały |
| retrospektywę kamienia milowego | `docs/process/retros/<M#>.md` (`/milestone close`) | trwały |
| raport spike'a (wnioski, rekomendacja) | `docs/spikes/<EVM-ID>-<opis>.md` | trwały |
| kod spike'a | `spikes/<nazwa>/` + `README.md` z polem `milestone` i ID historyjki spike'a | kamień milowy |
| raport QA | `docs/qa/<EVM-ID>/` | kamień milowy (M# historyjki) |
| raport przeglądu UX | `docs/ux/reviews/<EVM-ID>/` | kamień milowy (M# historyjki) |
| notatkę planistyczną na czas kamienia milowego | `docs/notes/<opis>.md` z `lifecycle: milestone` i `milestone: M#` | kamień milowy |
| dokument produktu, procesu, architektury, bezpieczeństwa, UX lub operacji | `docs/product/`, `docs/process/`, `docs/architecture/`, `docs/security/`, `docs/ux/`, `docs/ops/`, `design/` | żywy |
| opis aplikacji, pakietu lub narzędzia | `README.md` w jego katalogu (`apps/`, `packages/`, `services/`, `infra/`, `tools/`) | żywy |
| coś, co nie pasuje do żadnego wiersza | `docs/notes/` z polem `lifecycle` albo nowa reguła (patrz „Zmiana polityki”) | z pola `lifecycle` |

## Pliki robocze
- **Miejsce:** katalog `.scratch/` w katalogu głównym repozytorium (wpis w `.gitignore`) albo scratchpad sesji Claude Code (poza repozytorium). Układ wewnątrz `.scratch/` jest dowolny; dobra praktyka: podkatalog z ID historyjki, np. `.scratch/EVM-012/`.
- **Nie trafiają do commitu** — `git status` ich nie pokazuje. Walidator zgłasza błąd, gdy jakikolwiek plik w `.scratch/` jest widoczny dla gita (np. dodany przez `git add -f`), gdy `.scratch/` przestał być ignorowany albo gdy plik z `lifecycle: ephemeral` leży poza `.scratch/`.
- **Nie są pamięcią projektu.** Nic ważnego nie może istnieć tylko w `.scratch/` — wnioski przenieś do historyjki („Plan techniczny”, „Dziennik”, „Uwagi do rozważenia”) albo do właściwego dokumentu. Dokumenty w repozytorium nie odwołują się do `.scratch/`.
- **Bez sekretów i prawdziwych danych osobowych** — także tutaj (wyłącznie dane syntetyczne).
- Pliki robocze usuwa ich autor (albo Konrad) po zakończeniu kroku — bez osobnej procedury.

## Archiwizacja a usunięcie
- **Archiwum = historia git** (decyzja Konrada z 2026-10-02) — nie ma katalogu `docs/archive/`. Akcja „usuń” oznacza `git rm` w commicie zamknięcia kamienia milowego: plik znika z bieżącej wersji repozytorium (i z kontekstu agentów), ale zostaje w historii git.
- **Ślad:** lista usuniętych ścieżek z datą i decyzją Konrada trafia do `docs/process/retros/<M#>.md`, sekcja „Sprzątanie dokumentacji”.
- **Odtworzenie** (orkiestrator, na prośbę Konrada): `git log --diff-filter=D --oneline -- <ścieżka>` wskazuje commit usunięcia; `git restore --source=<commit>~1 -- <ścieżka>` przywraca plik, a `git show <commit>~1:<ścieżka>` pokazuje jego treść.
- **Usunięcie z repozytorium ≠ usunięcie z historii git.** Sekrety lub dane osobowe, które trafiły do repozytorium, wymagają osobnej procedury incydentowej (przepisanie historii, rotacja sekretów) — poza tą polityką.
- **Nie usuwamy:** historyjek (także `done` zostają w `docs/backlog/<M#>/` — decyzja Konrada z 2026-10-02), ADR-ów (status „Zastąpiona przez ADR-XXXX”), retrospektyw ani raportów spike'ów.
- **Przed usunięciem** pliku „kamień milowy” wnioski z niego trafiają do historyjki („Uwagi do rozważenia”) i retrospektywy. Dowody QA/UX (raporty `.md` i zrzuty) trzymamy do zamknięcia kamienia milowego, w którym powstały (decyzja Konrada z 2026-10-02).
- **Plik „kamień milowy”, którego Konrad nie usuwa** przy zamknięciu kamienia, dostaje `expires: YYYY-MM-DD` (we frontmatterze; dla spike'a — w `spikes/<nazwa>/README.md`). Po tej dacie wróci w raporcie jako „przejrzyj”; bez `expires` nie pojawiłby się już w żadnym raporcie. Decyzja i termin trafiają do retrospektywy.

## Kto i kiedy decyduje
### Uprawnienia
| Kto | Może | Nie może |
|---|---|---|
| Konrad | zatwierdzić politykę i jej zmiany; zaakceptować usunięcie (w całości lub per pozycja); zmienić klasę dokumentu trwałego lub żywego | — |
| Orkiestrator | uruchamiać walidator i raport; przedstawić raport przy `/milestone close`; wykonać **zaakceptowane** pozycje i zapisać je w retrospektywie; odtworzyć plik z historii git na prośbę Konrada | usunąć lub przenieść plik bez decyzji Konrada |
| Agenci | tworzyć dokumenty z klasą zgodną z polityką; zapisywać i usuwać własne pliki robocze w `.scratch/`; uruchamiać walidator; zmieniać własne, jeszcze niescalone dokumenty z bieżącej gałęzi w ramach historyjki | usuwać lub przenosić dokumenty istniejące na `main` (dowolnej klasy, także „kamień milowy”); obniżać klasę dokumentu, by zakwalifikować go do usunięcia |
| Walidator i raport | czytać pliki `.md` ze zbioru gita i ich metadane | modyfikować, przenosić lub usuwać jakiekolwiek pliki |

### Kiedy
| Moment | Co się dzieje | Decyduje |
|---|---|---|
| praca nad historyjką | pliki robocze w `.scratch/`; nowe dokumenty w dozwolonych lokalizacjach; nowy rodzaj dokumentu = zmiana polityki w tej historyjce | Konrad (akceptacja historyjki) |
| raport końcowy agenta | `npm run docs:check` — 0 błędów; agent bez dostępu do powłoki zaznacza w raporcie, że sprawdzenie wykona orkiestrator | agent |
| Definition of Done historyjki | `npm run docs:check` — 0 błędów; ostrzeżenia przejrzane (naprawione albo opisane w historyjce) | orkiestrator |
| zastąpienie lub scalenie dokumentu żywego; wycofanie ADR (status „Zastąpiona”) | w historyjce lub ADR, które to obejmują | Konrad |
| `/milestone close M#` | przegląd aktualności dokumentów żywych; raport sprzątania; wykonanie zaakceptowanych pozycji; zapis w retrospektywie | Konrad |
| każdy push (CI, bramka 11) | walidator jako pierwszy krok joba `quality`: błędy (kod `1`) i błąd narzędzia (kod `2`) dają czerwony `ci-gate`, więc PR nie zostaje scalony (K2); ostrzeżenia nie blokują — trafiają do podsumowania przebiegu (szczegóły: „Walidator i raport sprzątania” → „W CI (bramka 11)”) | CI; scala Konrad przy zielonym `ci-gate` |

## Walidator i raport sprzątania
### Polecenia
Wymagane: Node.js ≥ 22.15 i git; **bez instalacji zależności** (nie uruchamiaj `npm install`). Polecenia działają z dowolnego katalogu repozytorium i sprawdzają całe repozytorium.

| Cel | Polecenie |
|---|---|
| walidacja całego repozytorium | `npm run docs:check` |
| lista wszystkich plików z klasą i źródłem klasy (reguła # albo pole `lifecycle`) | `node tools/docs-lifecycle/cli.mjs check --list` |
| walidacja na wskazany dzień (np. co się przeterminuje) | `node tools/docs-lifecycle/cli.mjs check --today YYYY-MM-DD` |
| raport sprzątania dla kamienia milowego (tylko odczyt) | `npm run docs:cleanup -- M#` (na wskazany dzień: `node tools/docs-lifecycle/cli.mjs cleanup-report M# --today YYYY-MM-DD`) |
| podsumowanie przebiegu w CI — Markdown na stdout, raport na stderr (używa go krok CI, patrz „W CI (bramka 11)”) | `node tools/docs-lifecycle/cli.mjs check --summary` |
| testy walidatora i raportu (progi pokrycia linii i gałęzi ≥ 90%) | `npm run test:tools` |

- **Windows PowerShell 5.1** usuwa „gołe” `--` przed przekazaniem argumentów do npm, więc opcje podane po nim giną albo zmieniają znaczenie. Opcje podawaj przez `node tools/docs-lifecycle/cli.mjs …` albo z `'--'` w cudzysłowie, np. `npm run docs:check '--' --list`. `npm run docs:cleanup -- M0` działa w każdej powłoce. Nadmiarowe lub brakujące argumenty kończą się kodem wyjścia `2` ze wskazówką.
- **`pnpm run gate`** uruchamia walidator zaraz po sprawdzeniu hooków git — jak pierwszy krok CI. W chmurze (Claude Code web) `pnpm run gate` nie działa, więc punkt DoD to nadal `npm run docs:check`.
- **Polskie znaki przy zapisie wyniku do pliku lub w potoku:** w konsoli wyświetlają się poprawnie, ale Windows PowerShell 5.1 przy przekierowaniu (`>`) i w potoku do swoich poleceń (np. `Select-String`) dekoduje wyjście programu wg `[Console]::OutputEncoding` (np. strona kodowa 852) i zniekształca je. W PowerShell 5.1 najpierw ustaw `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` albo zapisuj z cmd.exe (bajty bez zmian) lub PowerShell 7.4+. Plik z wynikiem to plik roboczy — tylko w `.scratch/`.

### W CI (bramka 11)
Bramka 11 z `docs/security/requirements.md` (SR-SUPPLY-11), od EVM-013:
- **Gdzie:** walidator działa na każdym pushu jako pierwszy krok joba `quality` w `.github/workflows/ci.yml` („Documentation lifecycle validator (docs:check, bramka 11)”), zanim cokolwiek zostanie zainstalowane. CI sprawdza czysty checkout commita; lokalnie walidator widzi też pliki nieśledzone, więc bywa surowszy.
- **Co blokuje:** błędy (kod `1`) i błąd narzędzia (kod `2`) czerwienią krok, a przez niego `ci-gate` — PR nie zostaje scalony (K2). Przy błędzie dokumentacji pozostałe kroki `quality` się nie wykonują, a job `coverage` jest pominięty; joby `backend` i `security` dają własne wyniki.
- **Czego nie blokuje:** ostrzeżenia nie blokują — także „przeterminowany” zależny od daty. CI działa bez `--today`, więc ten sam commit ma ten sam wynik `ci-gate` każdego dnia; zmienić się może tylko liczba ostrzeżeń.
- **Wynik:** sekcja „Walidator dokumentacji (EVM-013)” w podsumowaniu przebiegu (Summary): wynik, licznik `błędy: N · ostrzeżenia: M`, listy błędów i ostrzeżeń (do 100 pozycji na listę, dalej „… i N więcej — pełna lista w logu”) i podpowiedź `npm run docs:check`. Pełna lista jest w logu kroku. Przy kodzie `2` podsumowanie jest puste, a komunikat jest w logu.
- **Lokalnie:** `npm run docs:check` (ten sam wynik w tym samym dniu) albo `pnpm run gate`. Punkt DoD „`npm run docs:check` — 0 błędów” zostaje bez zmian.

### Wynik i kody wyjścia
- Wyjście: stdout, UTF-8, ścieżki z `/`, kolejność deterministyczna; wyłącznie ścieżki i metadane — nigdy treść dokumentów.
- **Bezpieczne wyjście (EVM-013):** każda linia jest jedną linią bez znaków sterujących (escapowane jako `\u{…}`), a w ścieżkach i argumentach polecenia runnera GitHub Actions są neutralizowane: `::` na początku linii i `##[` w dowolnym miejscu linii — pierwszy znak zapisany jak escapowanie (np. `\u{3A}:error::x.md`, `\u{23}#[error]`). Narzędzie nie emituje adnotacji (`::warning`, `::error`, `::notice`). Dotyczy stdout i stderr, także komunikatów błędów.
- **Walidator:** wiersz na każde ustalenie — `BŁĄD · <ścieżka> · <klasa lub —> · <powód i wskazówka>` albo `OSTRZEŻENIE · …`; na końcu podsumowanie: liczba plików wg klas, lista „klasa nadana ręcznie”, `błędy: N · ostrzeżenia: M`. Gdy repozytorium jest czyste — jednoznaczny komunikat o braku błędów i ostrzeżeń.
- **Raport sprzątania:** tabela Markdown (Ścieżka · Klasa · Proponowana akcja · Uzasadnienie), liczba pozycji i stopka „tylko odczyt — żaden plik nie został zmieniony; decyzję podejmuje Konrad w `/milestone close`”. Brak pozycji — jednoznaczny komunikat; przy błędach walidacji — ostrzeżenie na początku raportu.
- **Kody wyjścia:** `0` — brak błędów (ostrzeżenia dozwolone) albo raport wygenerowany; `1` — błędy walidacji; `2` — błąd użycia lub środowiska (brak repozytorium git, nieznany argument, zła liczba argumentów, niepoprawna data w `--today`, M# spoza listy kamieni milowych).

### Błędy (kod wyjścia 1)
| Błąd | Kiedy |
|---|---|
| plik poza dozwolonymi lokalizacjami | brak pasującej reguły albo reguła „niedozwolone” — wskazówka: `docs/notes/` z polem `lifecycle` albo `.scratch/`; gdy plik pasowałby do reguły po zmianie rozszerzenia na `.md` (np. `docs/product/Cennik.MD`) — wskazówka: zmień rozszerzenie na `.md` |
| brak klasy | plik w `docs/notes/` bez pola `lifecycle` |
| nieznana klasa | `lifecycle` spoza `permanent`, `living`, `milestone`, `ephemeral` (komunikat podaje dozwolone wartości) |
| klasa sprzeczna z lokalizacją | `lifecycle` inne niż klasa z reguły (np. ADR z `lifecycle: milestone` — próba obniżenia klasy); w plikach z reguł 11–13 pole `milestone` inne niż M# z lokalizacji |
| kamień milowy bez M# | brak pola `milestone` (notatka „kamień milowy”, README spike'a) albo — dla dowodu QA/UX — brak historyjki `<EVM-ID>`, kilka historyjek o tym ID lub historyjka bez pola `milestone` |
| nieistniejący kamień milowy | M# spoza listy kamieni milowych albo w złym formacie |
| niepoprawna data | `expires` lub `review_by` nie jest prawdziwą datą `YYYY-MM-DD` (np. `2026-13-01`, `02.10.2026`, `2026-02-30`) |
| data niedozwolona dla klasy | `expires` w pliku trwałym lub żywym (sprzeczność); `review_by` w pliku innym niż żywy |
| plik roboczy w części śledzonej | plik w `.scratch/` widoczny dla gita (śledzony albo nieignorowany) albo `lifecycle: ephemeral` poza `.scratch/` |
| `.scratch/` nieignorowany | git nie potwierdza, że `.scratch/` jest ignorowany |
| spike bez README | katalog `spikes/<nazwa>/` bez `README.md` z polem `milestone` |

### Ostrzeżenia (bez wpływu na kod wyjścia)
| Ostrzeżenie | Kiedy |
|---|---|
| przeterminowany | `expires` lub `review_by` wcześniejsze niż dzisiaj (`Europe/Warsaw`); komunikat podaje datę |
| osierocony | plik z reguły oznaczonej „tak” w kolumnie „Osierocony”, do którego nie odwołuje się żaden inny plik `.md` (plik z błędem z listy „Błędy klasy” niżej ma już błąd — bez dodatkowego ostrzeżenia) |

**Błędy klasy:** plik poza dozwolonymi lokalizacjami; brak klasy; nieznana klasa; klasa sprzeczna z lokalizacją; plik roboczy w części śledzonej — po takim błędzie plik nie dostaje ostrzeżenia „osierocony”; pozostałe błędy (np. niepoprawna data) go nie wyłączają. Listę wyznacza walidator (flaga przy ustaleniu), a test spójności porównuje ją z tą linią (EVM-013).

### Raport sprzątania — proponowane akcje
| Akcja | Kiedy | Uwagi |
|---|---|---|
| **usuń** | plik klasy „kamień milowy” bez błędów walidacji, przypisany do wskazanego M#; katalog spike'a = jedna pozycja (błąd w dowolnym pliku katalogu blokuje „usuń”) | uzasadnienie: skąd pochodzi M# i które dokumenty odwołują się do pliku |
| **przejrzyj** | plik przeterminowany lub osierocony dowolnej klasy (także „kamień milowy” innego M#), jeśli nie jest już pozycją „usuń”; plik „kamień milowy” wskazanego M# z błędami walidacji | Konrad decyduje: aktualizacja, dodanie odwołania, nowy termin, pozostawienie albo usunięcie |
| **archiwizuj** | nie jest proponowana — archiwum = historia git, więc „usuń” zachowuje plik w historii | — |
| **zostaw** | nie jest proponowana przez narzędzie — to możliwa decyzja Konrada przy każdej pozycji | pozostawiony plik „kamień milowy” dostaje `expires` |

Pliki trwałe i żywe oraz pliki z błędami walidacji **nigdy** nie dostają „usuń” ani „archiwizuj” — najwyżej „przejrzyj”. Raport zawiera wyłącznie pliki przypisane do wskazanego M# oraz pliki przeterminowane i osierocone.

### Bezpieczeństwo
- **Tylko odczyt:** walidator i raport nigdy nie zmieniają, nie przenoszą ani nie usuwają plików. Narzędzie nie zna pliku podsumowania przebiegu: pisze na stdout, a do podsumowania kieruje je krok workflowu.
- **Wartości w podsumowaniu przebiegu** są wyłącznie w bloku kodu (płotek dłuższy od każdej serii backticków), więc nie tworzą linków, obrazów, HTML ani formatowania; poza blokiem są tylko stałe teksty i liczby; najwyżej 100 pozycji i 400 KiB na blok.
- **Wskazówka `git rm --cached`** cytuje ścieżkę dla powłoki POSIX (`'…'`, `'` → `'\''`), więc wklejona do bash albo sh nie wykona poleceń z nazwy pliku.
- **Dostępność bramki:** wyrażenia regularne działają w czasie liniowym, a testy czasu dla plików 200 KB mają twardy termin (wątek przerywany) — złośliwie zbudowany plik nie zawiesza CI.
- Czytają wyłącznie pliki `.md` ze zbioru gita (śledzone i nieignorowane) oraz listę plików z gita; nie otwierają `.env*`, kluczy ani plików ignorowanych; ścieżek znalezionych w treści dokumentów nie otwierają.
- Działają lokalnie, bez dostępu do sieci; wynik zawiera tylko ścieżki i metadane.

## Zmiana polityki
- **Nowy rodzaj dokumentu lub nowa lokalizacja** (np. dokumentacja użytkownika, notatki wydania, raporty przeglądów bezpieczeństwa) — historyjka, która go potrzebuje, zmienia tabelę „Dozwolone lokalizacje” i konfigurację walidatora razem (test spójności pilnuje obu); zmianę akceptuje Konrad wraz z historyjką. Do tego czasu: `docs/notes/` z polem `lifecycle`.
- **Zmiana klasy dokumentu trwałego lub żywego** i usunięcie reguły — wyłącznie decyzją Konrada.
- Ten dokument jest żywy; rozbieżność z praktyką zgłaszamy w retrospektywie kamienia milowego.
