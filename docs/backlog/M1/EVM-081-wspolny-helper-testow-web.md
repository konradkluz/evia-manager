---
id: EVM-081
title: Wspólny helper testów web (userEvent bez opóźnienia)
type: enabler
milestone: M1
epic: E00 Fundamenty
status: draft
priority: P3
path: lekka
owner: web-developer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-008]
---

# EVM-081: Wspólny helper testów web (userEvent bez opóźnienia)

## Cel
Jako **deweloper web** chcę **jednego współdzielonego helpera testów z `userEvent` bez opóźnienia**, aby **nie kopiować wzorca w każdym pliku i skrócić czas testów**. Dziś nowe testy powielają `setup({ delay: null })`, a `testTimeout` w `apps/web/vitest.config.ts` podniesiono do 20 s jako obejście wolnego CI.

## Kryteria akceptacji

**AC1 — Wspólny helper**
- Zakładając, że w `apps/web/test` istnieje helper tworzący `userEvent` z `delay: null`
- Gdy test web potrzebuje interakcji użytkownika
- Wtedy importuje helper, a w kodzie testów nie ma już lokalnych kopii tej konfiguracji (sprawdzone wyszukaniem).

**AC2 — Brak regresji**
- Zakładając, że istniejące testy przeniesiono na helper
- Gdy uruchamiam `pnpm --filter <web> run test:coverage`
- Wtedy wszystkie testy przechodzą, a progi pokrycia nie są obniżone ani testy osłabione.

**AC3 — Ocena limitu czasu**
- Zakładając, że testy używają helpera
- Gdy zmierzono czasy lokalnie i w CI
- Wtedy `testTimeout` zostaje przywrócony do niższej wartości, jeśli wyniki to uzasadniają; w przeciwnym razie powód pozostawienia 20 s zapisany jest w komentarzu konfiguracji.

**AC4 — Spójna konfiguracja czasu**
- Zakładając, że `testTimeout` (`apps/web/vitest.config.ts`) i `asyncUtilTimeout` (`apps/web/test/setup.ts`) podniesiono jako obejście wolnego CI (EVM-021, EVM-022)
- Gdy helper jest gotowy
- Wtedy obie wartości są ocenione razem z helperem, mają komentarz z powodem i nie kolidują z testami zależnymi od timerów (np. EVM-017 AC8 — `setTimeout` 10 000 ms).

## Poza zakresem
- Zmiana narzędzi testowych, testy mobile/E2E.

## Decyzje i ograniczenia
- Obszar ryzyka: niski; ryzyko niestabilnych testów po usunięciu opóźnień — wtedy poprawić test, nie podnosić limitu.

## Dziennik
- 2026-10-07 — utworzono (product-owner)
