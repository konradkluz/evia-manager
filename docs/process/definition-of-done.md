# Definition of Done (DoD)

Historyjka jest `done`, gdy spełnia **wszystkie** punkty (dla dokumentów — punkty, które dotyczą):

## Funkcjonalność
- [ ] Wszystkie AC spełnione; każde pokryte co najmniej jednym testem automatycznym oznaczonym `EVM-xxx AC#` (wyjątek: AC oznaczone jako ręczne, np. test terenowy — sprawdzone przez użytkownika).
- [ ] Raport QA: PASS dla każdego AC, macierz ról sprawdzona.

## Jakość i testy
- [ ] Bramki CI zielone: lint, formatowanie, typy, testy jednostkowe, integracyjne i E2E.
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
- [ ] `code-reviewer`: APPROVE; `security-engineer` / `ux-designer`: APPROVE (gdy dotyczy).
- [ ] Zaktualizowane: specyfikacja API, ADR (gdy była decyzja), `CHANGELOG.md` (Unreleased), `.env.example`, dokumentacja użytkownika (gdy zmienia się sposób pracy).
- [ ] Walidator dokumentacji `npm run docs:check`: 0 błędów, ostrzeżenia przejrzane; nowe pliki `.md` mają klasę i lokalizację zgodną z `docs/process/document-lifecycle.md`, pliki robocze są poza repozytorium (`.scratch/`).

## Akceptacja
- [ ] Demo przedstawione; użytkownik zaakceptował przyrost; squash merge do `main`; wpis w „Dziennik”.
