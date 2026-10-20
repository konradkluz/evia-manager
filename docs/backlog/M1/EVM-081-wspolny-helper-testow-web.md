---
id: EVM-081
title: Wspólny helper testów web (userEvent bez opóźnienia)
type: enabler
milestone: M1
epic: E00 Fundamenty
status: done
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
- 2026-10-16 — zaakceptowana przez Konrada (DoR): ścieżka `lekka`, recenzent `code-reviewer`, `model: sonnet`; draft → ready
- 2026-10-16 — ready → in-progress (kolejka 2026-10-16, wątek B; ścieżka lekka, wykonawca sonnet)
- 2026-10-16 — wdrożono: wspólny helper apps/web/test/user.ts (userEvent bez opóźnienia) we wszystkich testach web; testTimeout 20 s i asyncUtilTimeout 5 s zostają z uzasadnieniem w komentarzach (najwolniejszy test ok. 5 s lokalnie; CI wolniejsze) — decyzja orkiestratora — do potwierdzenia na demo (web-developer)
- 2026-10-16 — przegląd `code-reviewer`: APPROVE (runda 1, bez blocker/major); tabela AC1–AC4 → dowody: wyszukiwanie `delay: null` / importów `user-event` poza helperem (AC1), `web test:coverage` 1334 testów, linie 98,8% (AC2), komentarze w `vitest.config.ts` (AC3, AC4); pełna bramka orkiestratora po EVM-073 (czas kolejki)
- Notatki (minor/nit): 4 lokalne `userEvent.setup({ advanceTimers })` w `audit.test.tsx` — rozważyć parametr opcji w `setupUser`; współdzielona instancja `userEvent` (stan klawiatury); brak reguły ESLint `no-restricted-imports` pilnującej helpera; `packages/ui-web/test` poza zakresem; pomiar czasów w CI do dopisania po pierwszym przebiegu (do potwierdzenia na demo)
- 2026-10-16 — Koszt: 2 agenty, ok. 86 tys. tokenów podagentów, 23 wywołania narzędzi, ok. 14 min; status → in-review
- 2026-10-20 — demo/akceptacja Konrada → in-review → done
