---
id: EVM-012
title: Polityka cyklu życia dokumentacji i walidator porządku w docs
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P1
owner: product-owner
contributors: [devops-engineer]
reviewers: [code-reviewer, solution-architect]
depends_on: [EVM-001]
---

# EVM-012: Polityka cyklu życia dokumentacji i walidator porządku w docs

## Historyjka
Jako **Konrad (właściciel produktu) i zespół agentów** chcemy **jasnej polityki cyklu życia plików `.md` (co jest trwałe, co żyje razem z kodem, co jest potrzebne tylko do końca kamienia milowego, a co jest robocze) oraz narzędzia, które samo wykrywa bałagan i proponuje sprzątanie**, aby **repozytorium i kontekst agentów nie zarastały nieaktualnymi dokumentami, a każde usunięcie było świadomą, zaakceptowaną decyzją**.

## Kontekst
- Potrzeba zgłoszona przez Konrada 2026-10-02: agenci w trakcie pracy tworzą wiele plików `.md`; część jest ważna do końca developmentu i w utrzymaniu, część tylko na czas kamienia milowego lub doraźnie — potem zostaje i nie wiadomo, czy można ją usunąć. Konrad chce to załatwić **przed kolejnymi historyjkami M0**.
- Zaobserwowane źródła plików o różnym cyklu życia:
  - dokumenty decyzyjne i referencyjne: ADR (`docs/architecture/adr/` — nie usuwa się, tylko status „Zastąpiona”), architektura, `docs/product/*`, `docs/security/`, styleguide, `docs/process/*`, README katalogów, `CHANGELOG.md`, definicje agentów i skilli (`.claude/`);
  - historyjki `docs/backlog/<M#>/` — rosną („Plan techniczny”, „Dziennik”), są pamięcią projektu;
  - dowody przeglądów i QA: `docs/ux/reviews/<EVM-ID>/`, `docs/qa/**` (PNG już ignorowane w `.gitignore`, raporty `.md` — nie);
  - retrospektywy `docs/process/retros/<M#>.md`;
  - spike'i: raport (wiedza — zostaje) i kod w `spikes/` (do wyrzucenia lub świadomej promocji, np. EVM-011);
  - artefakty narzędzi (np. `.playwright-mcp/` — już ignorowane);
  - doraźne notatki i raporty agentów — dziś nie mają wyznaczonego miejsca.
- Proponowane klasy cyklu życia (do zatwierdzenia w polityce):

| Klasa | Znaczenie | Przykłady | Co się z nią dzieje |
|---|---|---|---|
| **trwały** (`permanent`) | zapis historyczny / decyzja; po zamknięciu się nie zmienia | ADR, retrospektywy, historyjki, raporty spike'ów (wnioski) | nigdy nie jest proponowany do usunięcia; ADR wycofuje się statusem „Zastąpiona” |
| **żywy** (`living`) | aktualny stan, utrzymywany razem z kodem | vision, domain, roadmap, architektura, security, styleguide, process, README, CHANGELOG, `.claude/**` | nie jest proponowany do usunięcia; przy zamknięciu kamienia milowego — przegląd aktualności; zastąpienie/scalenie tylko decyzją Konrada |
| **kamień milowy** (`milestone`) | potrzebny do zamknięcia wskazanego kamienia milowego | raporty QA, raporty przeglądów UX, notatki planistyczne, kod spike'a (`spikes/<nazwa>/` z README) | przy `/milestone close M#` trafia do raportu sprzątania jako kandydat do usunięcia (wnioski przenoszone wcześniej do retrospektywy / historyjki) |
| **roboczy** (`ephemeral`) | notatki i szkice na czas jednej sesji / kroku | notatki agentów, wyniki pośrednie | nie trafia do repozytorium — tylko w wyznaczonym miejscu ignorowanym przez git (lub scratchpad sesji) |

- Powiązania: `/milestone close` (`.claude/skills/milestone/SKILL.md`) — tu wpinamy przegląd i sprzątanie; EVM-006 (CI) — tu później bramka automatyczna (proponowana osobna historyjka EVM-013, patrz Notatki).

## Kryteria akceptacji
**AC1 — Polityka cyklu życia dokumentów**
- Zakładając, że zespół potrzebuje jednej reguły dla wszystkich plików `.md` w repozytorium
- Gdy otwieram `docs/process/document-lifecycle.md` (podlinkowany w `docs/README.md` i `docs/process/conventions.md` → „Dokumentacja”)
- Wtedy znajduję w nim: definicje czterech klas (trwały / żywy / kamień milowy / roboczy) z przykładami; sposób oznaczania klasy (reguła dla lokalizacji i/lub metadane w pliku) wraz z polami obowiązkowymi dla każdej klasy (np. kamień milowy wymaga wskazania `M#`, opcjonalnie data ważności); listę dozwolonych lokalizacji plików `.md`; zasadę „archiwizacja vs usunięcie” i miejsce archiwum (wg decyzji Konrada, pytanie 1); kto i kiedy decyduje (tabela w „Bezpieczeństwo i prywatność”); miejsce na pliki robocze.

**AC2 — Klasyfikacja istniejących plików**
- Zakładając, że polityka z AC1 jest zatwierdzona
- Gdy uruchamiam walidator na aktualnym repozytorium
- Wtedy każdy istniejący plik `.md` ma określoną klasę (z reguły lokalizacji lub z metadanych), walidator kończy się wynikiem „0 błędów”, a w raporcie dostarczenia jest zestawienie: liczba plików w każdej klasie oraz lista plików, którym klasę nadano ręcznie (do wglądu Konrada).

**AC3 — Walidator: błędy blokujące**
- Zakładając zestaw plików testowych (syntetycznych) z naruszeniami
- Gdy uruchamiam walidator jednym poleceniem lokalnie (Windows 11 oraz Linux/macOS)
- Wtedy dla każdego z przypadków: plik `.md` bez klasy; nieznana wartość klasy; klasa „kamień milowy” bez wskazania `M#` lub ze wskazaniem nieistniejącego kamienia; niepoprawna data (inna niż `YYYY-MM-DD`); plik trwały lub żywy z datą ważności (sprzeczność); plik `.md` poza dozwolonymi lokalizacjami (np. luźna notatka w katalogu głównym lub w `docs/`); plik roboczy w części repozytorium śledzonej przez git — walidator wypisuje ścieżkę i powód po polsku, a kończy się kodem wyjścia ≠ 0.

**AC4 — Walidator: ostrzeżenia i stan czysty**
- Zakładając pliki z datą ważności lub przeglądu wcześniejszą niż dzisiejsza (strefa `Europe/Warsaw`) oraz pliki, do których nie prowadzi żaden link z innego dokumentu i które nie są objęte indeksem (np. katalog backlogu, katalog ADR)
- Gdy uruchamiam walidator
- Wtedy są one wypisane jako ostrzeżenia („przeterminowany” z datą, „osierocony”) i nie zmieniają kodu wyjścia (0, jeśli brak błędów); gdy repozytorium jest czyste — walidator wypisuje jednoznaczny komunikat o braku błędów i ostrzeżeń.

**AC5 — Raport sprzątania dla kamienia milowego (tylko odczyt)**
- Zakładając zestaw plików syntetycznych obejmujący wszystkie klasy, w tym pliki klasy „kamień milowy” przypisane do `M0` i do `M1`
- Gdy generuję raport sprzątania dla `M0`
- Wtedy raport zawiera wyłącznie pliki przypisane do `M0` oraz pliki przeterminowane i osierocone, każdą pozycję ze ścieżką, klasą, proponowaną akcją (usuń / archiwizuj / przejrzyj / zostaw) i uzasadnieniem; pliki przypisane do `M1` nie są proponowane do usunięcia; generowanie raportu nie zmienia, nie przenosi ani nie usuwa żadnego pliku (dowód: stan plików przed i po jest identyczny).

**AC6 — Ochrona plików trwałych i żywych**
- Zakładając, że w zestawie są: ADR (także ze statusem „Zastąpiona”), historyjka `done`, retrospektywa, raport spike'a i plik żywy z przeterminowaną datą przeglądu
- Gdy generuję raport sprzątania dla dowolnego kamienia milowego
- Wtedy żaden plik trwały ani żywy nie ma proponowanej akcji „usuń” ani „archiwizuj” — co najwyżej „przejrzyj” (aktualność) — co potwierdzają testy oznaczone `EVM-012 AC6`.

**AC7 — Usuwanie tylko za zgodą Konrada, w rytmie `/milestone close`**
- Zakładając, że uruchamiam `/milestone close M#`
- Gdy orkiestrator dochodzi do kroku sprzątania (opisanego w `.claude/skills/milestone/SKILL.md`)
- Wtedy przedstawia Konradowi raport sprzątania i prosi o decyzję dla pozycji (wszystkie / wybrane / żadne); wykonuje wyłącznie zaakceptowane pozycje; listę usuniętych i zarchiwizowanych ścieżek z datą zapisuje w retrospektywie `docs/process/retros/<M#>.md` (sekcja „Sprzątanie dokumentacji”); bez decyzji Konrada żaden plik nie jest usuwany ani przenoszony — także przez agentów poza tym krokiem.

**AC8 — Instrukcje dla agentów i miejsce na pliki robocze**
- Zakładając, że agent potrzebuje zapisać notatkę roboczą lub tworzy nowy dokument
- Gdy czyta `CLAUDE.md` (sekcja zasad pracy / bezpieczeństwa pracy agentów) i swoją definicję w `.claude/agents/`
- Wtedy wie, że: pliki robocze zapisuje wyłącznie w wyznaczonym miejscu ignorowanym przez git (lub w scratchpadzie sesji) — taki plik nie pojawia się jako zmiana do commitu; nowy dokument w repozytorium musi mieć klasę zgodną z polityką; dowody QA/UX są klasy „kamień milowy”; przed oddaniem przyrostu walidator nie może zgłaszać błędów (dopisane jako punkt w `docs/process/definition-of-done.md`).

## Poza zakresem
- Bramka w CI (blokada merge przy błędach walidatora) — po EVM-006, proponowana historyjka **EVM-013**.
- Hook pre-commit uruchamiający walidator — decyzja w pytaniu 4; domyślnie razem z EVM-013.
- Automatyczne usuwanie lub przenoszenie plików bez decyzji Konrada (świadomie wykluczone na stałe).
- Usuwanie danych z historii git (przepisywanie historii) — osobna procedura incydentowa, jeśli kiedykolwiek potrzebna.
- Sprawdzanie jakości treści dokumentów (poprawność merytoryczna, martwe linki zewnętrzne, pisownia).
- Cykl życia plików innych niż `.md` — poza katalogami spike'ów objętymi przez ich README oraz już istniejącymi regułami `.gitignore` dla artefaktów (PNG, raporty testów).
- Wykonanie pierwszego sprzątania M0 — nastąpi przy `/milestone close M0`, nie w tej historyjce.
- Przenoszenie historyjek `done` do archiwum (domyślnie zostają na miejscu — pytanie 2).

## UX / UI
Nie dotyczy (narzędzie wiersza poleceń i dokumentacja procesu). Komunikaty walidatora i raportu po polsku, zwięzłe: ścieżka · klasa · powód · proponowana akcja.

## Bezpieczeństwo i prywatność
Role aplikacji (Administrator / Edytor / Tylko odczyt / Niezalogowany) — nie dotyczy. Uprawnienia w procesie:

| Kto | Może | Nie może |
|---|---|---|
| Konrad | zatwierdzić politykę; zaakceptować (w całości lub per pozycja) usunięcie / archiwizację; zmienić klasę dokumentu trwałego lub żywego | — |
| Orkiestrator | uruchamiać walidator i raport; przedstawić raport przy `/milestone close`; wykonać **zaakceptowane** pozycje i zapisać je w retrospektywie | usunąć lub przenieść plik bez decyzji Konrada |
| Agenci | tworzyć dokumenty z klasą zgodną z polityką; zapisywać pliki robocze w wyznaczonym miejscu; uruchamiać walidator | usuwać lub przenosić dokumenty trwałe, żywe i „kamień milowy”; obniżać klasę dokumentu, by zakwalifikować go do usunięcia |
| Walidator / raport | czytać pliki `.md` i ich metadane | modyfikować, przenosić lub usuwać jakiekolwiek pliki |

Kontrole:
- Walidator czyta wyłącznie pliki `.md` (i ewentualnie listę plików ignorowanych) — nie otwiera `.env*`, kluczy ani innych plików z `.gitignore`; raport zawiera tylko ścieżki i metadane, nie treść dokumentów.
- Działa lokalnie, bez dostępu do sieci i bez wysyłania danych na zewnątrz.
- Pliki robocze w miejscu ignorowanym przez git nadal podlegają zasadzie: brak sekretów i prawdziwych danych osobowych (dane syntetyczne).
- Archiwum (jeśli Konrad wybierze archiwum w repo) nie może zawierać danych osobowych ani sekretów — dotyczy go ten sam przegląd co reszty repozytorium.
- Usunięcie pliku z repozytorium nie usuwa go z historii git — zapisane jawnie w polityce.

## Notatki techniczne
- Zgodnie ze stackiem (ADR-0001…0014): skrypt Node / TypeScript, **bez nowych zależności** (wystarczy biblioteka standardowa Node, w tym wbudowany runner testów, jeśli Vitest z ADR-0014 nie jest jeszcze zainstalowany); każda zależność wymaga uzasadnienia (licencja, utrzymanie, bezpieczeństwo) i zgody. Forma uruchamiania (JS vs TS bez kroku budowania) — decyzja wykonawcy w „Planie technicznym” z konsultacją `solution-architect`; skrypt ma się dać przenieść do monorepo z EVM-006 bez przepisywania.
- **Brak CI do EVM-006** → w tej historyjce uruchamianie lokalne (jedno polecenie) i punkt w DoD; bramka CI w EVM-013.
- Musi działać na Windows 11 (środowisko Konrada) — separatory ścieżek, końce linii CRLF/LF, polskie znaki w nazwach plików i komunikatach.
- Repozytorium git istnieje (lokalnie, gałąź `main`, od 2026-10-02) — wariant „archiwum = historia git” i sprawdzenie „plik roboczy nie jest śledzony” można realizować od razu. Skrypt: Node.js (stack z ADR-0002) — `.ts` uruchamiany natywnie (type stripping) albo `.mjs`, bez kroku budowania i bez nowych zależności.
- Sposób oznaczania: rekomendacja PO — **reguły lokalizacji jako domyślne** (np. cały `docs/architecture/adr/` = trwały, `docs/backlog/**` = trwały, `.claude/**` = żywy) + **metadane we frontmatter tylko tam, gdzie reguła nie wystarcza** (np. `lifecycle: milestone`, `milestone: M1`, opcjonalnie `expires` / `review_by`). Unika to dopisywania nagłówków do każdego pliku i zmian w historyjkach (frontmatter historyjek = źródło prawdy dla `/progress`; nowe pola nie mogą go zepsuć). Ostateczny kształt — w polityce (AC1), z oceną architekta.
- Kod spike'a: katalog `spikes/<nazwa>/` z `README.md` klasy „kamień milowy” wskazującym historyjkę spike'a — dzięki temu katalog spike'a objęty jest raportem bez osobnego mechanizmu dla plików nie-`.md`.
- „Osierocony” = brak linku z innego dokumentu `.md` w repozytorium i brak objęcia regułą indeksu; tylko ostrzeżenie, bo część dokumentów jest odnajdywana przez konwencję katalogów.
- Ryzyko: zbyt surowy walidator zniechęca agentów (fałszywe alarmy) → błędy tylko dla jednoznacznych naruszeń, reszta jako ostrzeżenia.

### Propozycja podziału
- **EVM-012 (ta historyjka):** polityka + klasyfikacja istniejących plików + walidator i raport sprzątania uruchamiane lokalnie + integracja z `/milestone close`, DoD i instrukcjami agentów.
- **EVM-013 (do utworzenia przez `/refine`, depends_on: EVM-006, EVM-012, P2):** walidator jako bramka CI (błędy blokują merge, ostrzeżenia w podsumowaniu), ewentualnie hook pre-commit, przeniesienie testów skryptu do wspólnego runnera i progów pokrycia monorepo.

### Pytania do Konrada (rozstrzygnięte 2026-10-02 — patrz „Decyzje”)
1. **Archiwum: osobny katalog w repo czy tylko historia git?** Rekomendacja: **tylko historia git** + lista usuniętych ścieżek w retrospektywie (sekcja „Sprzątanie dokumentacji”). Konsekwencja: archiwum w repo (`docs/archive/<M#>/`) dalej „zaśmieca” wyszukiwanie i kontekst agentów; historia git wymaga gita (powstanie przy tej historyjce) i umiejętności odtworzenia pliku z commita (orkiestrator robi to na prośbę).
2. **Czy historyjki `done` przenosić do archiwum po zamknięciu kamienia milowego?** Rekomendacja: **nie** — zostają w `docs/backlog/<M#>/` jako trwałe (są już pogrupowane wg kamienia, linkują do nich ADR, CHANGELOG i retrospektywy). Konsekwencja: katalog backlogu rośnie, ale `/progress` i linki działają bez zmian; przeniesienie wymagałoby aktualizacji linków i `/progress`.
3. **Jak długo trzymać dowody QA/UX (raporty `.md` w `docs/qa/**`, `docs/ux/reviews/**`)?** Rekomendacja: **do zamknięcia kamienia milowego, w którym powstały** — wnioski trafiają do historyjki („Uwagi do rozważenia”) i retrospektywy, a raporty są kandydatami do usunięcia przy `/milestone close`. Konsekwencja: dłuższe trzymanie (np. do wydania 1.0) daje pełny ślad audytowy kosztem bałaganu; i tak pozostają w historii git.
4. **Czy walidator ma blokować commit (hook pre-commit) już teraz, czy tylko raportować do czasu EVM-006?** Rekomendacja: **tylko raportować** (uruchamiany ręcznie + punkt w DoD sprawdzany przez orkiestratora), blokada w CI w EVM-013. Konsekwencja: hook teraz wymaga dodatkowej konfiguracji przed istnieniem monorepo i może zostać przerobiony w EVM-006; brak hooka oznacza, że naruszenia mogą przejść do commitu do czasu przeglądu w DoD.

Kolejność: Konrad chce tę historyjkę **przed kolejnymi historyjkami M0** — proponuję ją jako następną do `/deliver`. Priorytet P1 (nie blokuje technicznie EVM-002/005/006/011, ale im wcześniej, tym mniej plików do sklasyfikowania).

## Plan techniczny
_product-owner, 2026-10-02. Część narzędziowa (p. 3–4) do przeglądu `solution-architect` przed implementacją. Treść p. 2 przechodzi 1:1 do polityki i do konfiguracji walidatora._

### 1. Zakres zmian
**product-owner — dokumenty i instrukcje (AC1, AC7, AC8).** Agent bez powłoki: zmiany zostają niezacommitowane, commity wykonuje devops-engineer (p. 7).

| Plik | Zmiana | AC |
|---|---|---|
| `docs/process/document-lifecycle.md` (nowy, żywy) | polityka: cel i zakres (wszystkie `.md` poza ignorowanymi przez git; pliki nie-`.md` tylko przez katalog spike'a); 4 klasy z przykładami i polami (p. 2); nadawanie klasy i metadane; tabela dozwolonych lokalizacji (p. 2); pliki robocze; archiwizacja vs usunięcie (archiwum = historia git, odtworzenie pliku z commita, usunięcie z repo ≠ usunięcie z historii); kto i kiedy decyduje (tabela z „Bezpieczeństwo i prywatność”); walidator i raport (polecenia, błędy vs ostrzeżenia, kody wyjścia); rytm (DoD, `/milestone close`, EVM-013); zmiana polityki (nowa lokalizacja = zmiana polityki i konfiguracji w historyjce, która jej potrzebuje) | AC1 |
| `docs/README.md` | wiersz „Proces → `process/document-lifecycle.md`”; korekta zakresu M0 na EVM-001 … EVM-013 | AC1 |
| `docs/process/conventions.md` → „Dokumentacja” | punkt z linkiem do polityki (klasa dla każdego `.md`, pliki robocze w `.scratch/`) | AC1 |
| `docs/process/definition-of-done.md` → „Przeglądy i dokumentacja” | punkt: `npm run docs:check` — 0 błędów, ostrzeżenia przejrzane; nowe dokumenty z klasą zgodną z polityką | AC8 |
| `CLAUDE.md` | zasada 7: każdy `.md` ma klasę (link do polityki); „Bezpieczeństwo pracy agentów”: pliki robocze tylko w `.scratch/` lub scratchpadzie sesji; usuwanie, przenoszenie i obniżanie klasy dokumentów istniejących na `main` wyłącznie po decyzji Konrada (krok sprzątania `/milestone close` albo zaakceptowana historyjka); „Stack i komendy”: wyłącznie 3 polecenia z p. 3 (reszta TBD do EVM-006) | AC7, AC8 |
| `.claude/agents/*.md` (10 plików) | jednolity akapit `# Dokumenty i pliki robocze` przed `# Granice`: pliki robocze w `.scratch/` lub scratchpadzie sesji; nowy dokument tylko w dozwolonej lokalizacji z klasą (notatka na czas kamienia → `docs/notes/`, dowody QA/UX = kamień milowy); zakaz usuwania i przenoszenia; `npm run docs:check` przed raportem (bez powłoki — informacja w raporcie, sprawdza orkiestrator). Bez innych zmian ról | AC8 |
| `.claude/skills/milestone/SKILL.md` (tryb `close`) | w retrospektywie: przegląd aktualności dokumentów żywych; nowy krok „Sprzątanie dokumentacji” (p. 6) przed aktualizacją roadmapy | AC7 |
| `.gitignore` | wpis `.scratch/` z komentarzem (pliki robocze agentów, EVM-012) | AC8 |

**devops-engineer — walidator i raport (AC2–AC6) oraz testy treści dokumentów (AC1, AC7, AC8), TDD.**

| Plik | Zmiana |
|---|---|
| `tools/docs-lifecycle/cli.mjs` | wejście CLI (p. 3); eksportuje `main(argv, io)` zwracające kod wyjścia — testy w procesie (pokrycie) plus kilka uruchomień przez `process.execPath` (prawdziwe kody wyjścia) |
| `tools/docs-lifecycle/lib/*.mjs` | logika jako czyste funkcje + cienka warstwa I/O (propozycja podziału: lista plików z git, frontmatter, wzorce, klasyfikacja, walidacja, odwołania, daty, raport, komunikaty) |
| `tools/docs-lifecycle/lifecycle.config.json` | reguły lokalizacji z p. 2 jako dane (bez kodu) |
| `tools/docs-lifecycle/test/*.test.mjs`, `test/helpers/` | testy `EVM-012 AC#`; fikstury budowane w czasie testu w katalogu tymczasowym (`fs.mkdtemp` w `os.tmpdir()` + `git init`, sprzątane po teście) — żadnych celowo błędnych `.md` w repozytorium i żadnych wyjątków w regułach |
| `package.json` (nowy, katalog główny) | minimalny: `name`, `private: true`, `engines.node` `>=22.15.0`, 3 skrypty z p. 3; bez zależności i bez `type` (pliki `.mjs`) |
| `CHANGELOG.md` | „Unreleased → Dodano”: polityka, walidator i raport, krok sprzątania w `/milestone close` [EVM-012] |

Bez zmian: frontmatter i treść istniejących historyjek, ADR-ów i pozostałych dokumentów (klasy wyłącznie z reguł lokalizacji), `.claude/workflows/deliver-story.js`, `docs/process/testing-strategy.md` (narzędzia — EVM-006). Żaden istniejący dokument nie jest usuwany ani przenoszony.

### 2. Model klasyfikacji (treść polityki = konfiguracja walidatora)
**Metadane** — frontmatter YAML na początku pliku, tylko płaskie pola `klucz: wartość` (pozostałe pola ignorowane):

| Klasa (`lifecycle`) | Obowiązkowe | Opcjonalne | Niedozwolone (błąd) |
|---|---|---|---|
| trwały (`permanent`) | — | — | `expires`, `review_by` |
| żywy (`living`) | — | `review_by: YYYY-MM-DD` (termin przeglądu) | `expires` |
| kamień milowy (`milestone`) | M# — z lokalizacji albo `milestone: M#` | `expires: YYYY-MM-DD` (data ważności) | `review_by` |
| roboczy (`ephemeral`) | — | — | obecność w części repozytorium widocznej dla git |

- Data: format `YYYY-MM-DD` i prawdziwa data kalendarzowa; „dzisiaj” = data w strefie `Europe/Warsaw`.
- M# istnieje, gdy występuje w tabeli „Przegląd” w `docs/product/roadmap.md` lub ma katalog `docs/backlog/<M#>/`.
- Pole `lifecycle` poza `docs/notes/` jest opcjonalne i musi być zgodne z regułą lokalizacji (inaczej błąd — klasę dokumentu trwałego lub żywego zmienia tylko Konrad, przez zmianę polityki). **Klasa nadana ręcznie** = pliki w `docs/notes/` (klasa z pola `lifecycle`); obecnie brak takich plików.

**Reguły lokalizacji** — ścieżka względem katalogu głównego, separator `/`, wygrywa pierwsza pasująca reguła; `*` — znaki w obrębie segmentu, `**` — dowolna liczba segmentów, `<M#>` = `M` + cyfry, `<EVM-ID>` = `EVM-` + min. 3 cyfry, `<NNNN>` = 4 cyfry, `<nazwa>` = jeden segment.

| # | Wzorce | Klasa | Kamień milowy | Sprawdzanie „osierocony” |
|---|---|---|---|---|
| 1 | `README.md` · `CLAUDE.md` · `CHANGELOG.md` | żywy | — | nie (punkt wejścia) |
| 2 | `.claude/**/*.md` | żywy | — | nie (konwencja narzędzia) |
| 3 | `.scratch/**` | roboczy | — | — (każdy plik widoczny dla git = błąd) |
| 4 | `docs/README.md` | żywy | — | nie (punkt wejścia) |
| 5 | `docs/backlog/README.md` · `docs/backlog/_template.md` · `docs/backlog/<M#>/README.md` | żywy | — | nie (indeks) |
| 6 | `docs/backlog/<M#>/<EVM-ID>-*.md` | trwały | — | nie (indeks, `/progress`) |
| 7 | `docs/architecture/adr/README.md` · `docs/architecture/adr/0000-template.md` | żywy | — | nie (indeks) |
| 8 | `docs/architecture/adr/<NNNN>-*.md` | trwały | — | nie (indeks) |
| 9 | `docs/process/retros/<M#>.md` | trwały | — | nie (konwencja) |
| 10 | `docs/spikes/<EVM-ID>-*.md` (raport spike'a — wnioski) | trwały | — | nie (konwencja) |
| 11 | `docs/qa/<EVM-ID>/**/*.md` | kamień milowy | pole `milestone` historyjki `<EVM-ID>` | nie (konwencja) |
| 12 | `docs/ux/reviews/<EVM-ID>/**/*.md` | kamień milowy | pole `milestone` historyjki `<EVM-ID>` | nie (konwencja) |
| 13 | `spikes/<nazwa>/**/*.md` | kamień milowy | pole `milestone` w `spikes/<nazwa>/README.md` (obowiązkowe; README wskazuje historyjkę spike'a) | nie (konwencja) |
| 14 | `docs/notes/**/*.md` | z pola `lifecycle` (obowiązkowe, nie `ephemeral`) | pole `milestone`, gdy kamień milowy | tak |
| 15 | `docs/backlog/**` · `docs/architecture/adr/**` · `docs/process/retros/**` · `docs/qa/**` · `docs/ux/reviews/**` · `docs/spikes/**` · `spikes/*.md` | niedozwolone | — | — |
| 16 | `docs/product/**/*.md` · `docs/process/**/*.md` · `docs/architecture/**/*.md` · `docs/security/**/*.md` · `docs/ux/**/*.md` · `docs/ops/**/*.md` · `design/**/*.md` | żywy | — | tak (poza `README.md`) |
| 17 | `apps/**/README.md` · `packages/**/README.md` · `services/**/README.md` · `infra/**/README.md` · `tools/**/README.md` · `.github/**/*.md` (struktura z ADR-0012) | żywy | — | nie (punkt wejścia) |
| — | każdy inny plik `.md` | niedozwolone | — | — |

- Każdy katalog `spikes/<nazwa>/` musi mieć `README.md` z polem `milestone` — dzięki temu raport sprzątania obejmuje cały katalog, także kod.
- **Odwołanie** (dla „osierocony”) = link Markdown albo ścieżka pliku `.md` zapisana w tekście (także w `` `kodzie` ``), rozwiązywana względem katalogu dokumentu lub katalogu głównego, z innego pliku `.md` w zbiorze sprawdzanym; `README.md` w dowolnym katalogu jest punktem wejścia.
- **Oczekiwany wynik na obecnym repozytorium (AC2):** 66 plików — trwały 27 (ADR 0001–0014, historyjki EVM-001 … EVM-013), żywy 39 (w tym nowa polityka), kamień milowy 0, roboczy 0; klasa nadana ręcznie: brak; 0 błędów, 0 ostrzeżeń. Liczby zmienią się, jeśli w trakcie powstaną dowody QA (`docs/qa/EVM-012/`).

### 3. Kontrakt CLI (API HTTP i migracje — nie dotyczy)
| Polecenie | Odpowiednik | Działanie |
|---|---|---|
| `npm run docs:check` | `node tools/docs-lifecycle/cli.mjs check [--today YYYY-MM-DD] [--list]` | walidacja całego repozytorium (niezależnie od bieżącego katalogu) |
| `npm run docs:cleanup -- M#` | `node tools/docs-lifecycle/cli.mjs cleanup-report M# [--today YYYY-MM-DD]` | raport sprzątania, tylko odczyt |
| `npm run test:tools` | `node --test` z pokryciem i progami | testy `tools/` (wzorce plików w podwójnych cudzysłowach — działa w cmd.exe, PowerShell i sh) |

- **Kody wyjścia:** `0` — brak błędów (ostrzeżenia dozwolone) albo raport wygenerowany; `1` — błędy walidacji; `2` — błąd użycia lub środowiska (brak repozytorium git, nieznany argument, niepoprawna data w `--today`, M# spoza listy kamieni).
- **Wyjście:** stdout, UTF-8, ścieżki z `/`, sortowanie deterministyczne, bez treści dokumentów.
  - Walidator: wiersz na ustalenie `BŁĄD · <ścieżka> · <klasa lub —> · <powód i wskazówka>` albo `OSTRZEŻENIE · …`; podsumowanie: liczba plików wg klas, lista „klasa nadana ręcznie”, `błędy: N · ostrzeżenia: M`; stan czysty — „Wynik: brak błędów i ostrzeżeń — dokumentacja zgodna z polityką”. `--list` — dodatkowo każdy plik z klasą i źródłem klasy (reguła # albo pole `lifecycle`).
  - Raport: tabela Markdown (Ścieżka · Klasa · Proponowana akcja · Uzasadnienie), liczba pozycji i stopka „tylko odczyt — żaden plik nie został zmieniony; decyzję podejmuje Konrad w `/milestone close`”; brak pozycji — jednoznaczny komunikat; przy błędach walidacji — ostrzeżenie na początku raportu.

**Błędy (AC3 + uzupełnienia wynikające z polityki):**

| Błąd | Kiedy |
|---|---|
| plik poza dozwolonymi lokalizacjami | brak pasującej reguły albo reguła „niedozwolone” (wskazówka: `docs/notes/` z polem `lifecycle` albo `.scratch/`) |
| brak klasy | plik w `docs/notes/` bez `lifecycle` |
| nieznana klasa | `lifecycle` spoza `permanent`, `living`, `milestone`, `ephemeral` (komunikat podaje dozwolone wartości) |
| klasa sprzeczna z lokalizacją | `lifecycle` inne niż klasa z reguły (np. ADR z `lifecycle: milestone` — próba obniżenia klasy) |
| kamień milowy bez M# | brak `milestone` (notatka, README spike'a) albo brak historyjki `<EVM-ID>` dla dowodu QA/UX |
| nieistniejący kamień milowy | M# spoza listy albo w złym formacie |
| niepoprawna data | `expires` / `review_by` nie jest prawdziwą datą `YYYY-MM-DD` |
| data niedozwolona dla klasy | `expires` w pliku trwałym lub żywym (sprzeczność); `review_by` poza klasą żywy |
| plik roboczy w części śledzonej | plik w `.scratch/` widoczny dla git (śledzony albo nieignorowany); `lifecycle: ephemeral` poza `.scratch/` |
| `.scratch/` nieignorowany | `git check-ignore` nie potwierdza ignorowania `.scratch/` |
| spike bez README | katalog `spikes/<nazwa>/` bez `README.md` z polem `milestone` |

**Ostrzeżenia (AC4):** „przeterminowany” — `expires` lub `review_by` wcześniejsze niż dzisiaj (komunikat z datą); „osierocony” — tylko reguły z „tak” w ostatniej kolumnie tabeli reguł.

**Raport sprzątania (AC5, AC6):**
- „usuń” — pliki klasy kamień milowy przypisane do wskazanego M# (spike: jedna pozycja na cały katalog `spikes/<nazwa>/`); uzasadnienie: źródło M# i lista dokumentów, które się do pliku odwołują.
- „przejrzyj” — pliki przeterminowane lub osierocone dowolnej klasy, jeśli nie są już pozycją „usuń” (w tym pliki kamienia milowego innego M#).
- Pliki trwałe i żywe nigdy nie dostają „usuń” ani „archiwizuj”; plik z błędem klasy jest liczony wg reguły lokalizacji.
- „Archiwizuj” nie jest proponowane (decyzja 2026-10-02: archiwum = historia git, „usuń” zostawia plik w historii); „zostaw” to możliwa decyzja Konrada przy pozycji, nie propozycja narzędzia.

### 4. Decyzje techniczne do przeglądu `solution-architect`
1. **JavaScript ESM (`.mjs`) z typami w JSDoc i `// @ts-check`**, bez kroku budowania — działa bez flag na Node 22.15 i na Node 26 (ADR-0002); `.ts` z type stripping wymaga w Node 22.15 flagi eksperymentalnej. Sprawdzanie typów: w IDE teraz, w bramce po EVM-006 (`checkJs`) albo zmiana na `.ts` w EVM-013.
2. **Testy: wbudowany `node:test`** (wyjątek od ADR-0014 przewidziany w „Notatkach technicznych”), pokrycie przez `--experimental-test-coverage` z progami linii i gałęzi ≥ 90% (`testing-strategy.md`; cały kod jest nowy). Flaga eksperymentalna wyłącznie w poleceniu testów, nie w walidatorze; przeniesienie do runnera monorepo — EVM-013.
3. **Katalog `tools/docs-lifecycle/`** — narzędzia repozytorium obok struktury z ADR-0012; samowystarczalny (tylko moduły `node:*` i importy względne), przenośny do workspace'u w EVM-006 bez przepisywania.
4. **`package.json` w katalogu głównym** — krótkie polecenia dla Konrada i agentów; cytowanie wzorców i flag w jednym miejscu (różne powłoki); EVM-006 i tak tworzy główny `package.json` (pnpm workspaces) i przejmie skrypty bez zmian (`pnpm run docs:check`). Bez zależności → bez lockfile, `node_modules` i kroku instalacji.
5. **Źródło listy plików: git** — `git ls-files -z --cached --others --exclude-standard` (bez `-z` git cytuje polskie znaki przy `core.quotePath`), z pominięciem plików usuniętych z dysku; `git check-ignore -q` dla `.scratch/`; katalog główny z `git rev-parse --show-toplevel`; `git` uruchamiany przez `execFileSync` z tablicą argumentów (bez powłoki).
6. **Bez eksperymentalnych API w kodzie walidatora** (`path.matchesGlob`, `fs.glob`) — własne dopasowanie wzorców z p. 2, pokryte testami.
7. **Przenośność i tylko odczyt:** CRLF → LF i BOM usuwane przed parsowaniem; ścieżki repozytorium w `path.posix`, dostęp do dysku przez `path.join`; bez podążania za dowiązaniami symbolicznymi; „dzisiaj” z `Intl.DateTimeFormat` (`timeZone: 'Europe/Warsaw'`), wstrzykiwane w testach; brak wywołań API zapisu w kodzie narzędzia; czytane wyłącznie pliki `.md` ze zbioru git (+ lista podkatalogów `spikes/`); bez sieci.
8. **Spójność polityki i konfiguracji:** test porównuje tabelę reguł w `docs/process/document-lifecycle.md` z `lifecycle.config.json` (każdy wzorzec z klasą występuje w obu miejscach).

### 5. Plan testów AC → testy (`EVM-012 AC#` w nazwie testu)
| AC | Testy automatyczne | Sprawdzenie ręczne / inspekcja |
|---|---|---|
| AC1 | polityka istnieje i jest podlinkowana z `docs/README.md` i `docs/process/conventions.md`; tabela reguł w polityce = konfiguracja walidatora; polityka zawiera 4 klasy i sekcje: oznaczanie, lokalizacje, pliki robocze, archiwizacja vs usunięcie, kto decyduje | QA: treść polityki vs AC1 punkt po punkcie |
| AC2 | walidator na aktualnym repozytorium: 0 błędów, każdy plik `.md` ma klasę | wynik `npm run docs:check` w raporcie dostarczenia (domyślne wyjście: liczby wg klas, „klasa nadana ręcznie: brak” — ustalenie A(c)); lista plików: `node tools/docs-lifecycle/cli.mjs check --list` |
| AC3 | fikstura na każdy przypadek: brak klasy; nieznana klasa; kamień milowy bez M# (notatka, README spike'a, dowód bez historyjki); M# nieistniejący i w złym formacie; daty `2026-13-01`, `02.10.2026`, `2026-02-30`; `expires` w ADR i w pliku żywym; `notatka.md` w katalogu głównym i `docs/notatka-łódź.md`; plik w `.scratch/` śledzony (`git add -f`) i przy nieignorowanym `.scratch/`; `lifecycle: ephemeral` w `docs/notes/` → ścieżka + powód po polsku + kod wyjścia 1. Uzupełnienia: klasa sprzeczna z lokalizacją, spike bez README; CRLF i BOM parsowane jak LF; kod 2 dla złych argumentów i katalogu bez git | Windows 11 (PowerShell): polskie znaki i kody wyjścia; Linux — p. 7 |
| AC4 | przeterminowane `expires` (kamień milowy) i `review_by` (żywy) → ostrzeżenie z datą, kod 0; granica doby w `Europe/Warsaw` (przy `expires: 2026-10-01`: 2026-10-01T21:59:59Z — ważny, 2026-10-01T22:00:00Z — przeterminowany); data równa dzisiejszej nie jest przeterminowana; osierocony vs odwołanie linkiem, ścieżką w `kodzie` i ścieżką względną; samoodwołanie się nie liczy; indeksy nigdy nie są sierotami; czyste repozytorium → komunikat o braku błędów i ostrzeżeń | — |
| AC5 | fikstura ze wszystkimi klasami, plikami M0 i M1, przeterminowanym plikiem M1 i sierotą: raport M0 zawiera wyłącznie pozycje M0 („usuń”) oraz przeterminowane i osierocone („przejrzyj”); pliki M1 bez „usuń”; każda pozycja ma ścieżkę, klasę, akcję ze słownika i uzasadnienie; spike jako jedna pozycja katalogu; migawka (ścieżki, rozmiary, czasy modyfikacji, SHA-256) i `git status --porcelain` identyczne przed i po `check` oraz `cleanup-report`; nieznany M# → kod 2; brak pozycji → jednoznaczny komunikat | — |
| AC6 | ADR „Zaakceptowana” i „Zastąpiona przez ADR-0002”, historyjka `done`, retrospektywa, raport spike'a, plik żywy z przeterminowanym `review_by`, ADR z `lifecycle: milestone` (próba obniżenia klasy): raport dla każdego M# z fikstury — żaden plik trwały ani żywy nie ma „usuń” ani „archiwizuj”; plik żywy przeterminowany = „przejrzyj” | — |
| AC7 | `SKILL.md` (tryb `close`) zawiera krok „Sprzątanie dokumentacji” z `docs:cleanup` i zapisem w `docs/process/retros/<M#>.md`; `CLAUDE.md` zawiera zasadę „bez decyzji Konrada nie usuwamy i nie przenosimy” | QA: inspekcja kroku vs AC7; demo na pliku przykładowym (p. 8); pierwsze faktyczne użycie — `/milestone close M0` (poza zakresem) |
| AC8 | `.scratch/` ignorowany w repozytorium (`git check-ignore -q .scratch/probe.md` → 0); każdy `.claude/agents/*.md` zawiera akapit z `.scratch/` i `docs/process/document-lifecycle.md`; `CLAUDE.md` i `definition-of-done.md` zawierają `docs:check` | QA: inspekcja; demo: plik w `.scratch/` nie pojawia się w `git status` |

Pokrycie (`npm run test:tools`): linie i gałęzie ≥ 90% dla `tools/docs-lifecycle/` (bez testów). Testy deterministyczne (stała data, katalogi tymczasowe), wyłącznie dane syntetyczne. Testy treści dokumentów sprawdzają stałe kotwice (ścieżki, nagłówki, polecenia), nie brzmienie zdań.

### 6. Krok „Sprzątanie dokumentacji” w `/milestone close` (treść dla `SKILL.md`, AC7)
Po retrospektywie (wnioski z dowodów QA/UX i notatek przeniesione do historyjek i retrospektywy), przed aktualizacją roadmapy (ostateczna treść, z ustaleniem C — pozostawiony plik „kamień milowy” dostaje `expires` — w `.claude/skills/milestone/SKILL.md`, krok 5):
1. `npm run docs:check` — 0 błędów.
2. `npm run docs:cleanup -- <M#>`.
3. Raport dla Konrada + pytanie: wszystkie / wybrane (lista) / żadne; pozycje „przejrzyj” — decyzja Konrada (aktualizacja, link, nowy `review_by`, pozostawienie).
4. Wykonanie wyłącznie zaakceptowanych pozycji (`git rm`, dla katalogu spike'a `git rm -r`) — nic poza nimi.
5. W `docs/process/retros/<M#>.md` sekcja „Sprzątanie dokumentacji”: data, decyzja, lista usuniętych ścieżek, pozycje pozostawione z powodem, informacja o odtworzeniu z historii git.
6. Ponownie `npm run docs:check` — 0 błędów; commit.

### 7. Kolejność kroków i commity
1. **product-owner:** pliki z p. 1 (część product-owner) wg p. 2, 3 i 6; wpis w „Dziennik”. Zmiany niezacommitowane.
2. **solution-architect:** przegląd p. 3–4; ustalenia → „Ustalenia z konsultacji”.
3. **devops-engineer — najpierw commity zmian dokumentacji** (trailery wg polecenia orkiestratora): `docs(backlog): add technical plan and consultation findings [EVM-012]` (ta historyjka i notatka o przekazanym długu w EVM-013); `docs(process): add document lifecycle policy [EVM-012]` (polityka, `docs/README.md`, `conventions.md`, `definition-of-done.md`); `docs(agents): add document lifecycle rules for agents and milestone close [EVM-012]` (`CLAUDE.md`, `.claude/agents/*.md`, `SKILL.md`, `.gitignore`).
4. **devops-engineer — TDD** (commit po każdym zielonym kroku, `test(docs-lifecycle)` / `feat(docs-lifecycle)` z [EVM-012]): pomocnik repozytorium tymczasowego → wzorce i konfiguracja → frontmatter i daty → klasyfikacja i błędy (AC3) → ostrzeżenia (AC4) → raport (AC5, AC6) → CLI i kody wyjścia → testy repozytorium (AC1, AC2, AC7, AC8). Następnie `build: add minimal root package.json with docs scripts [EVM-012]` i `docs(changelog): add document lifecycle policy and validator [EVM-012]`.
5. **devops-engineer — weryfikacja:** `npm run test:tools` (zielone, pokrycie ≥ 90%); `npm run docs:check` na repozytorium (wynik w raporcie i „Dzienniku” — AC2; lista plików przez `node tools/docs-lifecycle/cli.mjs check --list` — ustalenie A); uruchomienie na Windows 11 w PowerShell (polskie znaki, kody wyjścia, pliki CRLF, przepis na zapis wyniku do pliku z polityki). Linux: kontener `node:22` wymaga pobrania obrazu za zgodą Konrada (ustalenie K — orkiestrator pyta przy demo); bez zgody AC3 w części Linux/macOS oznaczone „do potwierdzenia w CI (EVM-013)” i zgłoszone w demo.
6. QA → przeglądy (`code-reviewer`, `solution-architect`).

### 8. Scenariusz demo
_Windows 11, PowerShell, katalog repozytorium; polecenia w formie bezpiecznej dla PowerShell (ustalenie A). Pliki tworzone w demo usuwa sam Konrad — to jego pliki, nie dokumenty projektu._
1. `npm run docs:check` → podsumowanie: liczba plików wg klas (trwały / żywy / kamień milowy / roboczy), „klasa nadana ręcznie: brak”, komunikat o braku błędów i ostrzeżeń; `$LASTEXITCODE` = 0 (AC2, AC4). Klasa i źródło klasy każdego pliku: `node tools/docs-lifecycle/cli.mjs check --list`.
2. `Set-Content docs\notatka.md '# Notatka'` → `npm run docs:check` → BŁĄD (poza dozwolonymi lokalizacjami), `$LASTEXITCODE` = 1 (AC3); `Remove-Item docs\notatka.md`.
3. `New-Item -ItemType Directory docs\notes` i `Set-Content docs\notes\demo.md '---','lifecycle: milestone','milestone: M0','expires: 2026-10-01','---','# Demo'` → `npm run docs:check` → ostrzeżenia „przeterminowany” (z datą) i „osierocony”, `$LASTEXITCODE` = 0 (AC4); `npm run docs:cleanup -- M0` → pozycja „usuń” z uzasadnieniem; `npm run docs:cleanup -- M1` → ta sama pozycja jako „przejrzyj” (AC5); `git status` — poza `docs/notes/` bez zmian (tylko odczyt); `Remove-Item -Recurse docs\notes`.
4. `New-Item -ItemType Directory .scratch` i `Set-Content .scratch\notatka.md '# Robocza'` → `git status` go nie pokazuje (AC8).
5. `npm run test:tools` → zielone, pokrycie linii i gałęzi ≥ 90% (AC3–AC6, testy `EVM-012 AC#`).
6. Lektura: polityka `docs/process/document-lifecycle.md` (AC1); krok „Sprzątanie dokumentacji” w `.claude/skills/milestone/SKILL.md` (AC7); akapit „Dokumenty i pliki robocze” w dowolnym `.claude/agents/*.md`, zasady w `CLAUDE.md` i punkt w `docs/process/definition-of-done.md` (AC8).
7. Linux/macOS (AC3): za zgodą Konrada — testy w kontenerze `node:22` (pobranie obrazu, repozytorium tylko do odczytu); bez zgody — „do potwierdzenia w CI (EVM-013)”.

### 9. Ryzyka i przekazanie do EVM-013
- Flaga `--experimental-test-coverage`, brak sprawdzania typów w bramce, brak uruchomienia na Linux/macOS w CI — do EVM-006 / EVM-013 (runner monorepo, `checkJs` lub `.ts`, CI na Linux).
- Heurystyka odwołań jest przybliżona — dlatego „osierocony” to tylko ostrzeżenie.
- Nowy rodzaj dokumentu (np. dokumentacja użytkownika, raporty przeglądów security) wymaga nowej reguły — dodaje ją historyjka, która jej potrzebuje (polityka + konfiguracja; test spójności pilnuje obu).
- Agenci bez powłoki (product-owner, ux-designer) nie uruchomią walidatora — sprawdza orkiestrator w DoD.
- Przy przekierowaniu wyjścia w Windows PowerShell 5.1 polskie znaki mogą się zniekształcić (w konsoli wyświetlają się poprawnie) — opis w polityce.

### Ustalenia z konsultacji
_solution-architect, 2026-10-02 — werdykt **CHANGES**: architektura planu zatwierdzona; poniższe wytyczne są obowiązujące i nie wymagają ponownego przeglądu planu (architekt sprawdzi je w przeglądzie końcowym). Nie dotyczy: model danych, migracje, API HTTP, offline-sync. Nowy ADR nie jest potrzebny. W razie rozbieżności z p. 1–9 obowiązują poniższe ustalenia._

**Zatwierdzone (p. 4, pozycje 1–8):** `.mjs` + JSDoc / `// @ts-check` bez kroku budowania; `node:test` jako czasowy wyjątek od ADR-0014; samowystarczalny katalog `tools/docs-lifecycle/` (tylko `node:*` i importy względne); minimalny główny `package.json` (bez zależności, bez `type`, bez `packageManager`, bez `.npmrc` i lockfile'a); git jako źródło listy plików; własny matcher wzorców; tylko odczyt; polityka = konfiguracja + test spójności.

**Dług przekazany do EVM-013 / EVM-006:** Vitest zamiast `node:test`; `checkJs` albo `.ts` (w Node 26 type stripping jest już stabilny); uruchomienie na Linuksie w CI; `--experimental-test-coverage` jest nadal eksperymentalne także w Node 26; `engines` → Node 26; `tools/*` jako workspace.

**A. PowerShell 5.1 a `--` [devops + PO].** Nakładka `npm.ps1` w Windows PowerShell 5.1 usuwa gołe `--`: `npm run docs:check -- --list` wykonuje się bez `--list` (npm bierze flagę za swoją konfigurację), a `--today 2026-10-02` staje się argumentem pozycyjnym. cmd.exe, Git Bash, `'--'` w cudzysłowie i `npm.cmd` działają poprawnie.
- (a) CLI: `util.parseArgs({ strict: true, allowPositionals: true })` i kontrola liczby argumentów pozycyjnych: `check` = 0, `cleanup-report` = dokładnie 1 (M#); w przeciwnym razie kod 2 i wskazówka „w PowerShell użyj '--' albo node tools/docs-lifecycle/cli.mjs …”.
- (b) W polityce, `CLAUDE.md`, demo i raporcie — formy bezpieczne dla PowerShell: `npm run docs:check '--' --list` albo `node tools/docs-lifecycle/cli.mjs check --list`; `npm run docs:cleanup -- M0` działa wszędzie.
- (c) Dowód do AC2 (liczby wg klas + „klasa nadana ręcznie”) w domyślnym wyjściu `check`, bez flag.

**B. Pokrycie [devops].** W Node 22.15 pliki testów i helpery są domyślnie wliczane do pokrycia (sprawdzone).
- `test:tools` = `node --test --experimental-test-coverage --test-coverage-include="tools/**/*.mjs" --test-coverage-exclude="tools/**/test/**" --test-coverage-lines=90 --test-coverage-branches=90 "tools/**/*.test.mjs"`.
- Katalog jako argument nie działa; helpery nie mogą pasować do `*.test.mjs`.
- Include / exclude wypisują w 22.15 `ExperimentalWarning` „glob” — akceptowalne tylko w poleceniu testów.
- Pokrycie z procesów uruchamianych przez `process.execPath` jest scalane (sprawdzone) — wyjątki dla `cli.mjs` nie są potrzebne.

**C. Luka w cyklu: pozostawiony plik „kamień milowy” [PO].** Pozycja „usuń”, którą Konrad zostawi przy `/milestone close`, nigdy nie wróciłaby w raporcie (reguły 11–13 nie sprawdzają sierot, M# się nie zmienia). Pozostawienie pliku klasy „kamień milowy” wymaga nadania `expires: YYYY-MM-DD` (we frontmatterze albo w README spike'a) — plik wróci jako „przejrzyj”; zapis w retrospektywie. Narzędzie bez zmian.

**D. Frontmatter [devops].**
- Rozpoznawany tylko, gdy pierwsza linia (po usunięciu BOM i zamianie CRLF → LF) to `---` i istnieje linia zamykająca.
- Tylko klucze najwyższego poziomu bez wcięcia; wartości przycięte, pasujące cudzysłowy zdjęte; pozostałe linie ignorowane (wieloliniowe `description` w `.claude/**`). Niezamknięty frontmatter = brak metadanych.
- Pole `milestone` w plikach trwałych i żywych jest ignorowane, bez błędu (historyjki są źródłem dla `/progress`).
- W regułach 11–13 pole `milestone` różne od M# historyjki / README spike'a = błąd „sprzeczne z lokalizacją”.

**E. Odwołania i determinizm [devops].**
- Odwołania rozwiązywane wyłącznie względem zbioru ścieżek z gita trzymanego w pamięci: `path.posix.normalize`, odcięcie `#…` / `?…`, `decodeURIComponent` w `try/catch`, NFC.
- Nigdy `fs.existsSync` ani odczyt ścieżki wziętej z treści dokumentu — ten sam wynik na Windows i Linuksie, brak odczytów poza zbiorem.
- Tokeny ścieżek z `\p{L}\p{N}` (flaga `u`) — polskie nazwy.
- Lista kamieni = wiersze tabeli „Przegląd” w `roadmap.md` (odporne na `**M0**`) ∪ katalogi `docs/backlog/<M#>/` z listy gita; test na repozytorium: wynik M0–M7.
- Katalogi `spikes/<nazwa>/` wyznaczane z listy gita (wszystkie pliki), nie przez `readdir`.

**F. Git [devops].**
- Jedna funkcja z listą dozwolonych podpoleceń: `rev-parse`, `ls-files`, `check-ignore`; `execFileSync` bez powłoki, `{ cwd, env, encoding: 'utf8', maxBuffer: 64 MiB, windowsHide: true }`.
- Bez `git status` w narzędziu; deduplikacja wyniku `ls-files`.
- `check-ignore -q` z ukośnikiem (`.scratch/`) albo ścieżką próbną `.scratch/probe.md` — `.scratch` bez ukośnika zwraca 1, gdy katalogu nie ma (fałszywy błąd, sprawdzone); testy dla obu stanów katalogu.
- Każdy plik w `.scratch/**` widoczny dla gita, niezależnie od typu, to błąd.
- Zalecany test statyczny: brak API zapisu `fs` w kodzie narzędzia.

**G. Izolacja testów [devops].**
- Helper uruchamia git z `GIT_CONFIG_GLOBAL=<pusty plik w tmp>`, `GIT_CONFIG_NOSYSTEM=1`, bez `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE`, z `-c core.autocrlf=false -c init.defaultBranch=main`.
- Plik „śledzony” przez `git add -f`, bez commitów.
- Sprzątanie: `rmSync` z `maxRetries: 5` (EBUSY na Windows).
- `main(argv, io = { cwd, env, now, stdout, stderr })`; `env` przekazywany do każdego wywołania gita — inaczej globalny `core.excludesFile` zmienia wyniki.

**H. Raport fail-safe [devops].** „usuń” tylko dla poprawnej klasy „kamień milowy” z M# równym argumentowi; pliki trwałe i żywe oraz pliki z błędem klasyfikacji — co najwyżej „przejrzyj” (jedna funkcja + testy AC6).

**I. CLI [devops].**
- `process.exitCode` zamiast `process.exit()` — inaczej obcina stdout w potoku.
- Zalecane: `cli.mjs` jako cienkie wejście, `main` w `lib/`.
- „Dzisiaj” wyłącznie przez `Intl.DateTimeFormat(…, { timeZone: 'Europe/Warsaw' }).formatToParts()`; nigdy `toISOString().slice(0, 10)`.
- Sortowanie po jednostkach kodu, nie `localeCompare` (ICU 76 w Node 22 vs 78 w Node 26).
- Znaki sterujące w wypisywanych ścieżkach i wartościach escapowane.
- Ustalenia jako dane `{ severity, code, path, class, reason }`; testy sprawdzają `code` + ścieżkę.

**J. Testy na prawdziwym repozytorium (AC1, AC2, AC7, AC8) [devops].** Tylko odczyt, bez stałych liczb plików i ostrzeżeń; asercje: 0 błędów, każdy plik ma klasę, kotwice istnieją; liczby trafiają tylko do raportu i „Dziennika”; `describe` / `it` + `node:assert/strict`.

**K. Bez kroku instalacji; Linux [PO + devops].**
- `CLAUDE.md`: „Instalacja: brak (do EVM-006)”; nie uruchamiać `npm install` — przy zerowych zależnościach tworzy `package-lock.json` (sprawdzone), nie commitować.
- Linux: Docker Desktop jest wyłączony, w WSL jest tylko dystrybucja `docker-desktop`; test wymaga pobrania obrazu `node:22`, na co Konrad musi się zgodzić — orkiestrator pyta przy demo. Przy uruchomieniu: repozytorium montowane `:ro` + `safe.directory` przez `GIT_CONFIG_COUNT`. Bez zgody: „do potwierdzenia w CI (EVM-013)”.

Źródła: https://nodejs.org/en/blog/release/v26.0.0 · https://nodejs.org/api/cli.html · https://nodejs.org/api/test.html

**Realizacja po stronie product-owner (2026-10-03):** A(b) — polityka (`Walidator i raport sprzątania` → „Polecenia”), `CLAUDE.md`, demo (p. 8); A(c) — p. 5 i p. 7; C — polityka („Archiwizacja a usunięcie”) i krok 5 w `.claude/skills/milestone/SKILL.md`; D — polityka („Pola metadanych”); K — `CLAUDE.md` („Stack i komendy”) i demo (p. 8).

**Realizacja po stronie devops-engineer (2026-10-03):**
- A(a) — `lib/main.mjs` → `parseCli` (`util.parseArgs` strict, kontrola liczby argumentów pozycyjnych, kod 2 ze wskazówką dla PowerShell); A(c) — domyślne wyjście `check`. Sprawdzone w Windows PowerShell 5.1: `npm run docs:check -- --list` — npm połyka `--list` (ostrzeżenie npm, zwykły `check`); `-- --today 2026-10-02` → kod 2 ze wskazówką; `'--' --list` i `npm run docs:cleanup -- M0` — poprawnie; cmd.exe `-- --list --today …` — poprawnie.
- B — `test:tools` w `package.json` 1:1 z ustalenia; pokrycie z procesów potomnych jest scalane (`cli.mjs` 100%).
- C — bez zmian w narzędziu (polityka i `SKILL.md` — product-owner).
- D — `lib/frontmatter.mjs` (dodatkowo: komentarze YAML ` #…` pomijane; wartość pusta, `~` i `null` = brak pola); pole `milestone` w plikach trwałych i żywych ignorowane; w regułach 11–13 rozbieżność = `class-conflict`.
- E — `lib/references.mjs` (wyłącznie zbiór ścieżek z gita, NFC, `decodeURIComponent` w `try/catch`, `\p{L}\p{N}`) i `lib/milestones.mjs` (test na repozytorium: M0–M7); katalogi spike'ów z listy gita — w konfiguracji `spikesDir: "spikes"` zamiast osobnego wzorca (spójność z regułą 13 sprawdza walidacja konfiguracji).
- F — `lib/repository.mjs`: `runGit` z listą `rev-parse` / `ls-files` / `check-ignore`, `execFileSync` bez powłoki z opcjami z ustalenia; `check-ignore -q --no-index .scratch/probe.md` (oba stany katalogu w testach); pliki usunięte z dysku odejmowane przez `ls-files --deleted`; test statyczny `test/readonly.test.mjs`.
- G — `test/helpers/temp-repo.mjs` (dodatkowo `GIT_CEILING_DIRECTORIES` i `XDG_CONFIG_HOME` w katalogu testu — globalny `~/.config/git/ignore` nie wpływa na wynik).
- H — `lib/cleanup.mjs` → `proposeAction`; test wyczerpujący wszystkie kombinacje klasy, M#, błędów, przeterminowania i osierocenia; każdy błąd walidacji (nie tylko klasy) blokuje „usuń”.
- I — `process.exitCode`, `main` w `lib/`, „dzisiaj” z `Intl…formatToParts`, sortowanie po jednostkach kodu, escapowanie `\p{Cc}\p{Cf}\p{Zl}\p{Zp}`, ustalenia jako `{ severity, code, path, class, reason }`.
- J — `test/project-docs.test.mjs` (tylko odczyt, bez stałych liczb plików i ostrzeżeń).
- K — bez `npm install` i lockfile'a (pilnuje test); Linux — do decyzji Konrada (pobranie obrazu `node:22`), bez zgody „do potwierdzenia w CI (EVM-013)”.
- Poza planem (drobne): `tools/docs-lifecycle/README.md` (budowa i niezmienniki; reguła 17, plik żywy); rozszerzenie `.md` w dowolnej wielkości liter; plik z błędem klasy bez dodatkowego ostrzeżenia „osierocony”; polityka doprecyzowana w tych punktach i w poradzie o kodowaniu w Windows PowerShell 5.1 (dotyczy też potoku, np. `Select-String`).

**Poprawki po przeglądzie końcowym — runda 1 (2026-10-03, ustalenie `solution-architect`, major):** testy na prawdziwym repozytorium (`test/project-docs.test.mjs`) sprawdzają tylko trwałe niezmienniki, żeby kolejne historyjki nie musiały ich osłabiać.
- Ustalenie E: lista kamieni milowych **zawiera** M0–M7 (zamiast równości) — nowy kamień w roadmapie nie psuje testów.
- P. 4.4 i ustalenie K: w `package.json` test sprawdza `private: true`, skrypty `docs:check` / `docs:cleanup` / `test:tools` oraz brak `package-lock.json` i `yarn.lock` (pnpm wg ADR-0012). Stan przejściowy do EVM-006 (bez zależności, `type`, `packageManager`, `.npmrc` i `pnpm-lock.yaml`; `engines.node` `>=22.15.0`) nadal obowiązuje w tej historyjce, ale sprawdza go przegląd, nie test — EVM-006 zmieni go bez zmian w testach (notatka w EVM-006 → „Notatki techniczne”).

**Kotwice dla testów treści (AC1, AC7, AC8):**
- Polityka `docs/process/document-lifecycle.md`: nagłówki `## Klasy cyklu życia`, `## Oznaczanie klasy`, `## Dozwolone lokalizacje`, `## Pliki robocze`, `## Archiwizacja a usunięcie`, `## Kto i kiedy decyduje`, `## Walidator i raport sprzątania`, `## Zmiana polityki`; wartości `permanent`, `living`, `milestone`, `ephemeral`. Tabela reguł pod `## Dozwolone lokalizacje`: kolumny `# | Wzorce | Klasa | Kamień milowy | Osierocony`; wzorce = wartości w `…` w kolumnie „Wzorce”; kod klasy = jedyna wartość w `…` w kolumnie „Klasa” (`permanent`, `living`, `milestone`, `ephemeral`, `lifecycle`, `forbidden`); wiersz „—” = reguła domyślna.
- Linki do polityki: `docs/README.md` (`process/document-lifecycle.md`), `docs/process/conventions.md` → „Dokumentacja” (`document-lifecycle.md`).
- `.claude/skills/milestone/SKILL.md` (tryb `close`): `Sprzątanie dokumentacji`, `npm run docs:cleanup`, `docs/process/retros/<M#>.md`, `expires`.
- `CLAUDE.md`: `docs/process/document-lifecycle.md`, `.scratch/`, `/milestone close`, `npm run docs:check`, `npm run docs:cleanup`, `npm run test:tools`.
- Każdy `.claude/agents/*.md`: `# Dokumenty i pliki robocze` (przed `# Granice`), `docs/process/document-lifecycle.md`, `.scratch/`, `npm run docs:check`.
- `docs/process/definition-of-done.md`: `npm run docs:check`; `.gitignore`: `.scratch/`.

## Decyzje
- 2026-10-02 — Archiwum: **tylko historia git** — wycofane pliki są usuwane z repo, lista usuniętych ścieżek trafia do retrospektywy kamienia milowego; bez katalogu `docs/archive/` (Konrad).
- 2026-10-02 — Historyjki `done` **nie są przenoszone** po zamknięciu kamienia milowego — pozostają w `docs/backlog/<M#>/` jako trwałe (Konrad).
- 2026-10-02 — Dowody QA/UX (raporty przeglądów, zrzuty): przechowywane **do zamknięcia kamienia milowego**, w którym powstały; wnioski w historyjce i retrospektywie (Konrad).
- 2026-10-02 — Walidator **na razie tylko raportuje** (uruchamiany ręcznie + punkt DoD); blokada w CI w EVM-013 po EVM-006 (Konrad).
- 2026-10-02 — Bramka CI / hook: osobna pozycja **EVM-013** (draft) (Konrad).
- 2026-10-03 — Demo: **akceptacja pod warunkiem poprawek** 3 drobnych ustaleń QA (wydajność tokenizacji + test regresji, brak ostrzeżenia „osierocony” przy błędzie klasy, wskazówka dla `.MD`) — merge po zielonych testach i przeglądzie code-reviewer, bez kolejnego demo (Konrad).
- 2026-10-03 — AC3 Linux: **weryfikacja w kontenerze Docker** (`node:22`) — Konrad będzie pracował lokalnie na Dockerze i tam uruchamiał środowisko (Konrad).
- 2026-10-03 — Nowe lokalizacje zatwierdzone: `docs/notes/`, `docs/spikes/`, `.scratch/`, README w `apps/`, `packages/`, `services/`, `infra/`, `tools/` oraz `.github/**` (Konrad).

## Uwagi do rozważenia
- **Stan po demo (2026-10-03):** trzy pierwsze pozycje poniżej (wydajność, „osierocony” przy błędzie klasy, wskazówka `.MD`) — **naprawione** (837a62f, bf21c16, eb566e9; 200 KB: 871 s → 0,006 s), code-reviewer APPROVE. AC3 na Linuksie — **sprawdzone** w kontenerze `node:22` (189/189, pokrycie 100%, `docs:check` 0 błędów).
- (code-reviewer, minor → EVM-013) testy czasu 200 KB w `references.test.mjs` używają `timeout`, który nie przerywa synchronicznego kodu — przy regresji test zawiśnie (~14 min) zamiast paść po 2 s; propozycja: `worker_threads` z przerwaniem albo test proporcji czasu 50 KB / 200 KB.
- (code-reviewer, nit → EVM-013) `CLASS_ERRORS` w `analyze.mjs` jako osobna lista kodów — lepiej flaga `classError` w rekordzie; polityka (l. 171) — dopisać listę „błędów klasy”; asercja testu `.MD` nie wiąże ścieżki z numerem reguły.
- (QA, minor — wydajność) `tools/docs-lifecycle/lib/references.mjs` (`extractPathTokens`): kwadratowe backtrackowanie przy długim ciągu bez spacji (np. obraz base64 wklejony do `.md`). Orkiestrator potwierdził 2026-10-03: ciąg 20 KB → 8,3 s; QA: 100 KB → 197 s. Na obecnym repozytorium < 1 s. Poprawka: tokenizacja liniowa + test regresji z limitem czasu (`EVM-012 AC4`). Decyzja przy demo.
- (QA, minor) Plik z błędem klasy (`class-conflict` / `class-unknown`) w lokalizacji z regułą 16 dostaje dodatkowo ostrzeżenie „osierocony” — niezgodne ze zdaniem polityki („plik z błędem klasy ma już błąd — bez dodatkowego ostrzeżenia”). Nie wpływa na kod wyjścia ani na ochronę przed „usuń”. Decyzja przy demo.
- (QA, minor) AC3 — część „Linux/macOS” nie została uruchomiona (brak środowiska; pobranie obrazu `node:22` wymaga zgody Konrada). Przegląd kodu nie wykazał zależności od platformy. Decyzja przy demo.
- (QA, nit) Dla `*.MD` (wielkie litery rozszerzenia) wskazówka „przenieś do docs/notes/” myli — właściwa: „zmień rozszerzenie na .md”.
- (code-reviewer, obserwacje) zagnieżdżone repozytorium git w `spikes/` zgłaszane jako „katalog spike'a bez README.md”; test kolejności kroków w `qa-acceptance.test.mjs:601-603` (sąsiedztwo kroków, pogrubienia w SKILL.md) surowszy niż potrzeba — do rozważenia przy przenoszeniu testów w EVM-013.
- (product-owner, proces → retrospektywa M0) workflow `deliver-story` (`fixerFor`) kieruje poprawki z obszaru `tests` do ownera historyjki, także gdy owner nie pisze kodu (tu: product-owner poprawiał test) — rozważyć kierowanie ich do kontrybutora odpowiedzialnego za kod.
- (solution-architect) dług narzędzia przekazany do EVM-013 / EVM-006: Vitest zamiast `node:test`, `checkJs` albo `.ts`, testy na Linuksie w CI, eksperymentalny pomiar pokrycia, `engines` → Node 26, `tools/*` jako workspace (zapisane w „Notatkach technicznych” EVM-006 i EVM-013).

## Definition of Done
- [x] AC1–AC8 spełnione; walidator i raport pokryte testami (`EVM-012 AC#`) na danych syntetycznych — QA PASS AC1–AC8; orkiestrator 2026-10-03: `npm run test:tools` 182/182, pokrycie linii/gałęzi/funkcji 100% (próg 90%). Wyjątek do decyzji przy demo: AC3 na Linux/macOS nieuruchomione
- [x] Walidator uruchomiony na repozytorium: 0 błędów — orkiestrator 2026-10-03: 67 plików (trwały 27, żywy 40, kamień milowy 0, roboczy 0), klasa nadana ręcznie: brak, 0 błędów, 0 ostrzeżeń; `docs:cleanup -- M0`: brak pozycji
- [x] Przeglądy: code-reviewer, solution-architect — APPROVE (runda 2; runda 1: 1× major solution-architect — test asercji stanu przejściowego `package.json` i równości M0–M7, poprawione)
- [x] `docs/README.md`, `docs/process/conventions.md`, `docs/process/definition-of-done.md`, `CLAUDE.md`, `.claude/skills/milestone/SKILL.md` i `CHANGELOG.md` zaktualizowane (oraz 10 definicji agentów, `.gitignore`, notatki EVM-006 i EVM-013)
- [x] Demo i akceptacja Konrada (2026-10-03, warunkowo — po poprawkach 3 ustaleń QA; warunek spełniony)

## Dziennik
- 2026-10-02 — utworzono (product-owner, /refine)
- 2026-10-02 — draft → ready: Konrad zaakceptował AC1–AC8 i odpowiedzi na pytania (orkiestrator, /refine)
- 2026-10-02 — ready → in-progress: start /deliver, gałąź feature/EVM-012-cykl-zycia-dokumentacji
- 2026-10-02 — plan techniczny (product-owner)
- 2026-10-02 — przegląd planu: solution-architect — CHANGES (architektura zatwierdzona, wytyczne A–K → „Ustalenia z konsultacji”)
- 2026-10-03 — implementacja części product-owner: polityka `docs/process/document-lifecycle.md` (AC1), `docs/README.md`, `docs/process/conventions.md`, `docs/process/definition-of-done.md`, `CLAUDE.md`, akapit „Dokumenty i pliki robocze” w 10 plikach `.claude/agents/`, krok „Sprzątanie dokumentacji” w `.claude/skills/milestone/SKILL.md` (AC7), `.scratch/` w `.gitignore` (AC8); „Ustalenia z konsultacji”, p. 5, 7 i 8 dostosowane do wytycznych A i K; notatka o przekazanym długu w EVM-013. Klasyfikacja ręczna wg reguł (AC2, do potwierdzenia walidatorem): 66 plików `.md` — trwały 27 (ADR 0001–0014, EVM-001 … EVM-013), żywy 39, kamień milowy 0, roboczy 0; klasa nadana ręcznie: brak; oczekiwane 0 błędów i 0 ostrzeżeń. Żaden dokument nie został usunięty ani przeniesiony; zmiany niezacommitowane — commity wykonuje devops-engineer (p. 7) (product-owner)
- 2026-10-03 — implementacja części devops-engineer: commity dokumentacji product-owner; walidator i raport sprzątania `tools/docs-lifecycle/` (TDD, testy `EVM-012 AC#` na danych syntetycznych, pokrycie linii i gałęzi 100%), `package.json` (`docs:check`, `docs:cleanup`, `test:tools`), `tools/docs-lifecycle/README.md`, `CHANGELOG.md`, doprecyzowania polityki. AC2 — `npm run docs:check` (2026-10-03): 67 plików `.md` — trwały 27, żywy 40 (w tym nowy README narzędzia), kamień milowy 0, roboczy 0, bez klasy 0; klasa nadana ręcznie: brak; błędy: 0 · ostrzeżenia: 0. Sprawdzone na Windows 11 (PowerShell 5.1, cmd.exe, Git Bash): kody wyjścia 0/1/2, polskie znaki, `--` w PowerShell 5.1, zapis wyniku do pliku, scenariusz demo (p. 8). Linux/macOS — do decyzji Konrada (ustalenie K). Żaden dokument nie został usunięty ani przeniesiony (devops-engineer)
- 2026-10-03 — poprawki po przeglądzie, runda 1 (ustalenie `solution-architect`, major): `tools/docs-lifecycle/test/project-docs.test.mjs` sprawdza tylko trwałe niezmienniki (kamienie milowe: zawiera M0–M7; `package.json`: `private`, brak `package-lock.json` i `yarn.lock`); notatka o przejęciu `package.json` w EVM-006 → „Notatki techniczne” (bez zmiany AC); opis w „Plan techniczny” → „Poprawki po przeglądzie końcowym”. Zmianę testu wykonał product-owner, bo workflow kieruje poprawki z obszaru `tests` do ownera historyjki. Zmiany niezacommitowane, bo agent nie ma dostępu do powłoki (product-owner)
- 2026-10-03 — weryfikacja orkiestratora: zacommitowano poprawki rundy 1 (2368f6b, 055f941); `npm run test:tools` 182/182, pokrycie 100%; `npm run docs:check` 0 błędów / 0 ostrzeżeń; potwierdzono ustalenie wydajnościowe QA (20 KB → 8,3 s)
- 2026-10-03 — in-progress → in-review: demo dla Konrada
- 2026-10-03 — poprawki po demo (devops-engineer, TDD): 837a62f, bf21c16, eb566e9; code-reviewer APPROVE (1 minor, 3 nity → EVM-013); orkiestrator: Windows i Linux (Docker `node:22`) 189/189, pokrycie 100%, `docs:check` 0 błędów; plik 20 KB 8,3 s → 0,28 s
- 2026-10-03 — in-review → done: warunek akceptacji Konrada spełniony, squash merge do `main`
