---
id: EVM-012
title: Polityka cyklu życia dokumentacji i walidator porządku w docs
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
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
_Uzupełnia wykonawca przed implementacją: zakres zmian, kontrakt API, migracje, plan testów AC → testy, ustalenia z konsultacji._

## Decyzje
- 2026-10-02 — Archiwum: **tylko historia git** — wycofane pliki są usuwane z repo, lista usuniętych ścieżek trafia do retrospektywy kamienia milowego; bez katalogu `docs/archive/` (Konrad).
- 2026-10-02 — Historyjki `done` **nie są przenoszone** po zamknięciu kamienia milowego — pozostają w `docs/backlog/<M#>/` jako trwałe (Konrad).
- 2026-10-02 — Dowody QA/UX (raporty przeglądów, zrzuty): przechowywane **do zamknięcia kamienia milowego**, w którym powstały; wnioski w historyjce i retrospektywie (Konrad).
- 2026-10-02 — Walidator **na razie tylko raportuje** (uruchamiany ręcznie + punkt DoD); blokada w CI w EVM-013 po EVM-006 (Konrad).
- 2026-10-02 — Bramka CI / hook: osobna pozycja **EVM-013** (draft) (Konrad).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione; walidator i raport pokryte testami (`EVM-012 AC#`) na danych syntetycznych
- [ ] Walidator uruchomiony na repozytorium: 0 błędów (wynik w raporcie dostarczenia)
- [ ] Przeglądy: code-reviewer, solution-architect — APPROVE
- [ ] `docs/README.md`, `docs/process/conventions.md`, `docs/process/definition-of-done.md`, `CLAUDE.md`, `.claude/skills/milestone/SKILL.md` i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (product-owner, /refine)
- 2026-10-02 — draft → ready: Konrad zaakceptował AC1–AC8 i odpowiedzi na pytania (orkiestrator, /refine)
