---
id: EVM-128
title: "Aplikacja: „Utwórz ponownie” odrzuconego szybkiego zlecenia"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: done
priority: P2
path: pelna             # synchronizacja offline, dane osobowe na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, ux-designer]
model: sonnet
depends_on: [EVM-106]
---

# EVM-128: Aplikacja — „Utwórz ponownie” odrzuconego szybkiego zlecenia

## Cel
Jako **technik** chcę **poprawić i ponownie wysłać odrzucone szybkie zlecenie bez wpisywania wszystkiego od nowa**, aby **wpisy i komentarze, które już do niego dodałem, trafiły do nowego zlecenia**. Wydzielone z EVM-106; „Wymaga uwagi” z grupą, powodem i „Usuń z telefonu” dostarczają EVM-107 / EVM-106.

## Kontekst
Makieta M-10 ([`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md)) i wiersze „rejected” z [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md); operacja `recreate` kolejki w `sync-core` (przenosi zależne generycznie, bez zmian w `sync-core`).

## Kryteria akceptacji

**AC1 — Formularz z danymi i powodem**
- Zakładając odrzucone szybkie zlecenie (`id_conflict`, `template_unavailable` lub `validation_failed`) w „Wymaga uwagi”
- Gdy dotykam „Utwórz ponownie”
- Wtedy otwiera się formularz M-10 z danymi z odrzuconej komendy, a u góry InlineAlert z powodem: „Zlecenie nie zostało utworzone — sprawdź dane klienta i adres.” (dla `id_conflict`: „Ten element nie mógł zostać zapisany — zapisz go jeszcze raz.”), a przy zależnych elementach dodatkowo „Zdjęcia i wpisy (3) przeniesiemy do nowego zlecenia.” (liczba zależnych); pola nie są podświetlane na podstawie serwera, a przy `validation_failed` formularz od razu uruchamia walidację lokalną z podsumowaniem błędów jak w EVM-106.

**AC2 — Szablon niedostępny**
- Zakładając odrzucenie `template_unavailable`
- Gdy formularz się otwiera
- Wtedy szablon jest odznaczony, a pod nagłówkiem „Szablon” stoi „Poprzedni szablon nie jest już dostępny. Wybierz nowy.” (znika po wyborze); tytuł z komendy zostaje i wybór szablonu go nie nadpisuje; zapis bez szablonu jest niemożliwy (walidacja jak w EVM-106).

**AC3 — Zapis: nowa komenda i przeniesienie zależnych**
- Zakładając poprawiony formularz
- Gdy zapisuję (także po wymuszonym zamknięciu aplikacji tuż po zapisie — Maestro)
- Wtedy w jednej operacji atomowej kolejki powstaje nowa komenda z nowymi identyfikatorami zlecenia, klienta i lokalizacji oraz nowym `mutation_id`, stara grupa znika z „Wymaga uwagi”, a zależne elementy (wpisy, komentarze) przechodzą do nowego zlecenia przed wysłaniem; dane klienta i lokalizacji starej komendy nie zostają na urządzeniu (usunięte w tej samej transakcji); zlecenie otwiera się z odznaką „Oczekuje na numer”, a toast i ogłoszenie brzmią „Zapisano ponownie w telefonie. Numer nadamy po synchronizacji.”.

**AC4 — Błąd operacji i zamknięcie bez zapisu**
- Zakładając formularz „Utwórz ponownie”
- Gdy operacja atomowa się nie powiedzie albo zamykam formularz bez zapisu
- Wtedy przy błędzie widzę „Nie udało się zapisać ponownie. Odrzucone zlecenie zostało bez zmian.”, a dane w formularzu zostają; przy zamknięciu z niezapisanymi zmianami dialog „Porzucić zmiany? Odrzucone zlecenie zostanie w kolejce.” i odrzucone zlecenie zostaje w „Wymaga uwagi” z zależnymi bez zmian.

**AC5 — Tryb ukrytych danych**
- Zakładając tryb ukrytych danych (EVM-101) albo wylogowanie
- Gdy widzę grupę odrzuconego zlecenia albo tryb włącza się przy otwartym formularzu
- Wtedy „Utwórz ponownie” jest wyłączone z widocznym tekstem „Zaloguj się ponownie, aby poprawić dane.” (nazwa dostępna z powodem), a „Usuń z telefonu” działa; otwarty formularz zamyka się, a jego dane są zrzucane (fail-closed jak M-10); dane komendy żyją tylko w stanie formularza, nie w parametrach nawigacji ani logach. Zmienia to obecny kod, który zostawia akcję aktywną w tym trybie.

## Poza zakresem
Edycja zlecenia po utworzeniu, automatyczne ponawianie bez udziału technika, przenoszenie `CreateMediaAsset` (generycznie przez `recreate` — test dopisuje EVM-108 po scaleniu), szkice formularza.

## Decyzje i ograniczenia
- **Decyzja 13 planu M2 (Konrad, 2026-11-14): zależne elementy przenoszone automatycznie do nowego zlecenia — tak.**
- Do czasu tej historyjki akcja „Utwórz ponownie” w Kolejce wysyła ponownie te same dane (nic nie ginie).
- Bezpieczeństwo (security, Low): nowe UUIDv7 dla zlecenia **oraz** klienta i lokalizacji i nowy `mutation_id`; dane klienta starej komendy znikają z urządzenia w tej samej transakcji; recenzent security niewymagany.
- UX / UI: komponenty ze styleguide'u (InlineAlert, FilterChip, TextField, dolny pasek akcji, toast); stany: pusty — nie dotyczy, błąd (AC1, AC4), offline (normalna praca), ukryte dane (AC5). Do `manual` w EVM-112: układ alertu na 360 dp, TalkBack, 200% czcionki.
- Rola: Administrator i Edytor (Tylko odczyt nie loguje się do aplikacji).
- **Tech Lead w nocy 2026-11-14 — potwierdzone przez Konrada 2026-11-15 (akceptacja zbiorcza tematów z nocy 14/15.11):** odrzucenie z kodem `quota_exceeded` (AC1 go nie wymienia) otwiera ten sam formularz z ogólnym powodem; notatki i komentarze z `id_conflict` zachowują dotychczasowe „Utwórz ponownie” bez formularza.
- Uwagi nieblokujące z przeglądów (2026-11-14): drugi akapit w `InlineAlert` przekazany przez slot `action` (do decyzji ux-designer: właściwość `detail` albo odstępstwo w styleguide'zie); w trybie ukrytych danych dwa komunikaty pod rząd na karcie; zrzuty ekranu „do demo” i sprawdzenie TalkBack / czcionki 200% — w EVM-112.

## Notatki techniczne
- Przepływy Maestro toru B: numery 70–79. Pliki wspólne z torem A (ograniczyć zmiany): `apps/mobile/src/i18n/pl.ts` (nowe klucze w osobnym bloku na końcu sekcji), `screens/QueueScreen.tsx`, `src/e2e-hooks/panel.tsx`, `tools/mobile-e2e/src/scenarios.mjs` i `sync-stub.mjs` (tylko dopisywanie scenariuszy), `test/flows.test.mjs`, `CHANGELOG.md`, README M2. `sync-core` nie jest zmieniany (dotyka go tylko tor A).
- Emulator jest jeden na maszynę — E2E torów naprzemiennie.

## Definition of Done
- [ ] AC1–AC5 pokryte testami oznaczonymi `EVM-128 AC#` (Jest i Maestro 70–79); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzje: code-reviewer, ux-designer (przegląd statyczny: teksty, tokeny, nazwy dostępne) — approve; `CHANGELOG.md`.

## Dziennik
- 2026-11-13 — utworzono jako podział EVM-106 (product-owner)
- 2026-11-14 — refinement do DoR (product-owner): 3 → 5 AC wg konsultacji UX i security; decyzja 13 potwierdzona
- 2026-11-14 — draft → ready: kryteria zatwierdzone przez Tech Leada z delegacji Konrada (pytanie przed nocą 2026-11-14); Konrad przegląda je rano w PR
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-14` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-14-api-media-i-drobne`
- 2026-11-14 — plan gotowy (mobile-developer)
- 2026-11-14 — implementacja gotowa, w przeglądzie (mobile-developer): testy Jest i scenariusze Maestro 70–77; E2E na emulatorze po stronie orkiestratora
- 2026-11-14 — workflow `deliver-story` passed (1 runda; QA pass 5/5 AC; code-reviewer i ux-designer approve); bramka orkiestratora `pnpm run gate` zielona; przepływy Maestro 70–77 uruchamia orkiestrator na końcu toru; status `in-review` (Tech Lead)
- 2026-11-14 — Koszt: 6 agentów, ok. 0,61 mln tokenów subagentów, 25 min pracy agentów
- 2026-11-15 — akceptacja Konrada („Akceptuję tematy z nocy”): kryteria zatwierdzone z delegacji przyjęte, decyzja o `quota_exceeded` potwierdzona; scalone przez Konrada (#141, `252b2fd5`); **status `done`** (Tech Lead)
