# Definition of Done (DoD)

Historyjka jest `done`, gdy spełnia **wszystkie** punkty (dla dokumentów — punkty, które dotyczą):

## Funkcjonalność
- [ ] Wszystkie AC spełnione; każde pokryte co najmniej jednym testem automatycznym oznaczonym `EVM-xxx AC#` (wyjątek: AC oznaczone jako ręczne, np. test terenowy — sprawdzone przez użytkownika).
- [ ] Weryfikacja AC: PASS dla każdego AC, macierz ról sprawdzona — ścieżka pełna z danymi osobowymi lub uprawnieniami: raport `qa-engineer` w `docs/qa/`; pozostałe (lekka oraz pełna bez danych osobowych i uprawnień): tabela AC → test sprawdzona przez orkiestratora w demo (bez osobnego raportu).

## Jakość i testy
- [ ] Bramka lokalna natywna zielona (`pnpm run gate` lokalnie: hooki, docs, format, lint, typy, testy z progami, granice modułów, `coverage:diff` natywny) oraz **zielony `ci-gate` w PR** (część kontenerowa: backend w Linuksie, integracja z PostgreSQL, E2E) — wymagany rulesetem na `main`; pełna bramka z kontenerami lokalnie tylko na żądanie (ADR-0015, ADR-0022; polecenia: `CLAUDE.md`).
- [ ] Testy uruchomione w środowisku właściwym dla warstwy (ADR-0015): backend w kontenerze Linux, web w przeglądarkach na Windows, E2E Android na emulatorze na Windows; testy zrzutów ekranu tylko na Linuksie; CI zielone.
- [ ] Progi pokrycia spełnione (`testing-strategy.md`), w tym ≥ 90% pokrycia zmienionego kodu; brak nieuzasadnionych wykluczeń.
- [ ] Brak nowych ostrzeżeń, martwego kodu i TODO bez ID historyjki.

## Bezpieczeństwo
- [ ] Brak otwartych ustaleń Critical / High / Medium (lub ryzyko zaakceptowane przez użytkownika i zapisane).
- [ ] Nowe endpointy: deny-by-default + testy macierzy ról + test IDOR.
- [ ] Skany zielone (SAST, zależności, sekrety); brak danych osobowych w logach i danych testowych.

## UX
- [ ] Zgodność ze styleguide'em (tylko tokeny i komponenty z biblioteki), wszystkie stany ze specyfikacji.
- [ ] Dostępność: zero naruszeń w testach automatycznych (axe), obsługa klawiaturą, kontrast WCAG 2.2 AA.
- [ ] Teksty po polsku przez i18n, terminologia ze słownika domeny.

## Przeglądy i dokumentacja
- [ ] `code-reviewer`: APPROVE; `security-engineer` / `ux-designer`: APPROVE (ścieżka pełna, gdy dotyczy); ścieżka lekka — jeden przegląd (recenzent dobrany do ryzyka: UI → `ux-designer`, endpoint/pliki/zależność → `security-engineer`; narzędzia i CI → jeden recenzent, a dla `.github/**`, kanału wdrożeń i łańcucha dostaw jedynym recenzentem jest `security-engineer`), bez blocker/major po jednej rundzie poprawek.
- [ ] Security sign-off wydania (1.0, 1.1) jest jeden na wydanie, na podstawie dowodów z przeglądów historyjek i DAST — nie jest wymagany per historyjka ani dla pilota.
- [ ] Zaktualizowane: specyfikacja API, ADR (gdy była decyzja), `CHANGELOG.md` (Unreleased), `.env.example`, dokumentacja użytkownika (gdy zmienia się sposób pracy).
- [ ] Walidator dokumentacji `npm run docs:check`: 0 błędów, ostrzeżenia przejrzane; nowe pliki `.md` mają klasę i lokalizację zgodną z `docs/process/document-lifecycle.md`, pliki robocze są poza repozytorium (`.scratch/`).

## Akceptacja
- [ ] Demo przedstawione (jedno na PR-kolejkę, obejmujące wszystkie historyjki gałęzi — nie osobno na historyjkę); użytkownik zaakceptował przyrost; squash merge do `main`; wpis w „Dziennik”, w tym „Koszt” (`workflow.md` → „Pomiar kosztu”).
