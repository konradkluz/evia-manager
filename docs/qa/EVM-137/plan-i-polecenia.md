# EVM-137 — plan testów, polecenia dla orkiestratora i miejsce na wyniki

Historyjka: [EVM-137](../../backlog/M2/EVM-137-mobile-wizja-lokalna.md) (AC1–AC7). Etapy: 1 rdzeń (`sync-core`, modele, kolejka, usługa), 2 formularz M-10 i szczegóły oczekującej wizji, 3 lista, szczegóły, „Wymaga uwagi”, tryb ukrytych danych, 4 E2E (przepływy Maestro 110–116, scenariusze `survey-*`) i dokumenty. Makiety: [`17-wizja-lokalna.md`](../../ux/flows/17-wizja-lokalna.md). Środowisko: emulator Androida na Windows (ADR-0015), Maestro 2.11, AVD `Medium_Phone_API_35` z `hw.camera.back=virtualscene`; iOS odłożony. Dane wyłącznie syntetyczne (miejscowość „Piaseczno”, ulica „Fikcyjna 12”, kod „05-500”, telefon „600000011”); aplikacja w E2E łączy się tylko z serwerem scenariuszy (RR-93), nigdy z `panel.eviacharge.pl` ani `staging.eviacharge.pl`.

## 1. Warunki wstępne

- **AVD z kamerą wirtualną** (jak w [EVM-108](../EVM-108/plan-i-polecenia.md)): przepływy 111, 112, 113 i 114 robią zdjęcie prawdziwym aparatem emulatora (krok `camera-grant` przed przepływem; przepływ 110 startuje bez zgody na aparat).
- **Serwer scenariuszy** (`tools/mobile-e2e/src/sync-stub.mjs`) zna komendę `CreateSiteSurvey` i tryby kroku: `survey` (`ok`, `feature_disabled`, `validation_failed`, `deleted`, `assigned`) oraz `features` (`on`, `off` — przełącznik w `client-config`). Numer wizji to `ZL-E2E-3` (kolejny po dwóch zleceniach serwera). Tryby `deleted` i `assigned` działają na wizjach, które serwer już utworzył, raz, przy następnej stronie zmian.
- **Przerwanie `force-stop`** (przepływ `111-survey-offline`) i tryb samolotowy ustawia runner; przepływy nie włączają ich same.
- Wariant e2e (nie release) — haki ukrytych danych (`e2e-lock-off`) są tylko w nim. Gradle i budowa — tylko przez `tools/mobile-e2e`; emulator uruchamia orkiestrator.

## 2. Polecenia

| Co | Polecenie |
|---|---|
| Testy narzędzia (bez emulatora) | `pnpm --filter "./tools/mobile-e2e" run test:coverage` (`node --test`; spójność przepływów ze scenariuszami: `test/survey-flows.test.mjs`, serwer: `test/sync-stub.test.mjs`, krok logu: `test/device-survey.test.mjs`) |
| Testy aplikacji i `sync-core` | `pnpm --filter @evia/mobile run test:coverage`, `pnpm --filter @evia/sync-core run test:coverage` |
| Pełny przebieg wizji z buildem | `node tools/mobile-e2e/cli.mjs --only survey-` |
| Powtórka bez buildu | `node tools/mobile-e2e/cli.mjs --skip-build --only survey-` |
| Jeden scenariusz | `node tools/mobile-e2e/cli.mjs --skip-build --only survey-offline` (nazwy w tabeli niżej; `--only` bierze nazwy lub przedrostki po przecinku) |
| Regresja aparatu i wysyłania | `node tools/mobile-e2e/cli.mjs --skip-build --only camera-,upload-` |
| Domyślny przebieg (bez wizji) | `node tools/mobile-e2e/cli.mjs --skip-build` |
| Raport | `.scratch/mobile-e2e/report.md`; zrzuty do przeglądu UX: `docs/ux/reviews/EVM-137/` (klasa „kamień milowy”, kopiuje orkiestrator) |

## 3. Scenariusze `survey-*` (poza przebiegiem domyślnym)

Każdy kończy się liczbami z serwera scenariuszy (`expectSync`); scenariusze, które wysyłają wizję, kończą krokami `tokens-not-in-clear`, `logcat-clean` i **`logcat-no-survey-data`** (W5: w logu urządzenia nie ma żadnego z wpisanych słów; zapis w raporcie to liczba linii, nigdy treść).

| Scenariusz | AC | Przepływy (każdy zaczyna tam, gdzie skończył poprzedni) | Co sprawdza | `expectSync` |
|---|---|---|---|---|
| `survey-offline` | AC1 AC2 AC3 AC4 | `110` (świeża instalacja, lista) → `111-survey-offline` (samolot, lista) → `111-survey-restart` (po `force-stop`, samolot) → `111-survey-return` (powrót sieci, aplikacja w tle) | wiersz „Wizja lokalna” pierwszy w „Dodaj”; pusty formularz mówi, czego brakuje; zapis offline samym adresem (z kodem pocztowym) → „Oczekuje na numer” z adresem tylko w szczegółach; aparat z kategorią „Oględziny” bez wyboru; Kolejka („Wyślemy po utworzeniu wizji”) i lista (odznaka, „Wygasa za 90 dni”, chip „Wizje lokalne (1)”) bez adresu; po restarcie wszystko jest; po powrocie sieci numer `ZL-E2E-3` i plik „Wysłano” | 2 unikalne, 0 duplikatów, 0 odrzuconych |
| `survey-hidden-data` | AC5 | `110` → `112-survey-seed` (online, numer) → `112-survey-hidden` | tryb ukrytych danych: wiersz zostaje, otwiera komunikat „Wizję lokalną założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej.”; lista bez oznaczeń, terminu, chipa i adresu; wybór zlecenia pokazuje sam numer; aparat wizji działa (kategoria „Oględziny”), plik w Kolejce bez adresu | — |
| `survey-rejected` | AC6 | `110` → `113-survey-rejected-offline` (samolot: wizja, wpis, zdjęcie) → `113-survey-rejected-return` (tryb serwera `feature_disabled`) | jeden wiersz „Wymaga uwagi” z powodem „…funkcja jest wyłączona. Zapytaj administratora.” bez adresu, „Czekają z nim 2 elementy.”, jedyna akcja „Usuń z telefonu” (brak „Dodaj do innego zlecenia”, kopiowania i „Utwórz ponownie”); dialog „Razem z nią usuniemy z telefonu 2 elementy: 1 zdjęcie i 1 wpis.”; po potwierdzeniu Kolejka pusta, wizji nie ma na liście; podpowiedź W8 przy wpisie wizji | 0 unikalnych, 0 duplikatów, 1 odrzucona |
| `survey-deleted` | AC6 (W10) | `110` → `112-survey-seed` → `114-survey-deleted-offline` (samolot: wpis i zdjęcie do znanej wizji) → `114-survey-deleted-return` (tryb serwera `deleted`) | wizja znika z listy; wpis i zdjęcie to „Wymaga uwagi” z własnymi słowami („Wizja została usunięta — wpis nie został wysłany.” / „…zdjęcie nie zostało wysłane.”), każde z jedną akcją „Usuń z telefonu”, bez ponawiania; po obu usunięciach Kolejka pusta | 1 unikalna, 0 duplikatów, 2 odrzucone |
| `survey-assigned` | AC7 | `110` → `112-survey-seed` → `115-survey-assigned` (tryb serwera `assigned`, aplikacja w tle) | karta traci odznakę, termin i chip; szczegóły pokazują klienta i status „Zaakceptowane”, bez „Brak klienta…”; numer ten sam | — |
| `survey-feature-off` | AC1 | `116-survey-feature-off` (świeża instalacja, `features: off`) | w „Dodaj” nie ma „Wizja lokalna”; pozostałe akcje są | — |

Uwagi do przepływów: `scrollUntilVisible` zawsze z `centerElement: true`; tekst dopasowywany jako regex do całego węzła (kropki i znaki zapytania w zdaniach z `\`); `hideKeyboard` tylko tuż po `inputText`; widok poza granicami rodzica jest niewidoczny dla UiAutomator, więc elementy pod zgięciem przewijamy przed asercją. Test `survey-flows.test.mjs` pilnuje tych reguł, zgodności przepływów ze scenariuszami (110–119 ⇔ zestaw `survey-`) i nagłówków `# EVM-137 AC…`.

## 4. Macierz AC → testy

| AC | Jest / Vitest (aplikacja, `sync-core`) | `node:test` (narzędzia) | Maestro / emulator |
|---|---|---|---|
| **AC1** wejście, formularz, funkcja wyłączona | `site-survey-model.test.ts`, `site-survey-screen.test.tsx`, `survey-pull.test.ts` (przełącznik), `survey-service.test.ts` (przełącznik offline) | `sync-stub.test.mjs` (config, `feature_disabled`) | `110`, `111-survey-offline` (walidacja), `116` |
| **AC2** zapis offline, numer, bez duplikatu | `survey-queue.test.ts`, `survey-offline` w `survey-service.test.ts`, `survey-detail-model.test.ts`, `order-list-survey.test.ts` | `sync-stub.test.mjs` (jedno `applied`, `duplicate`, numer na następnej stronie) | `111-survey-offline/restart/return` |
| **AC3** zdjęcia i filmy | `camera-screen.test.tsx` („Oględziny”), `survey-queue-view.test.ts` (plik za wizją), `media-uploads.test.ts` (`awaitsSurvey`) | — | `111-survey-offline` (aparat), `112-survey-hidden` |
| **AC4** lista, szczegóły, prywatność | `orders-screen-survey.test.tsx`, `order-detail-survey.test.tsx`, `survey-picker.test.tsx`, `survey-service.test.ts` (brak adresu w logach i diagnostyce — W5) | `device-survey.test.mjs` (`logcat-no-survey-data`) | `111-*` (`assertNotVisible` adresu), `CLEAN_LOG` |
| **AC5** tryb ukrytych danych | `site-survey-screen.test.tsx`, `orders-screen-survey.test.tsx`, `order-detail-survey.test.tsx`, `survey-attention-screen.test.tsx`, `survey-picker.test.tsx` | — | `112-survey-hidden` |
| **AC6** odrzucenie i usunięcie | `survey-attention.test.ts`, `survey-queue.test.ts`, `survey-attention-screen.test.tsx`, `survey-queue-view.test.ts`, `media-uploads.test.ts` (pliki odrzuconych komend) | `sync-stub.test.mjs` (`feature_disabled`, `validation_failed`, `deleted`) | `113-*`, `114-*` |
| **AC7** po przypisaniu klienta | `survey-pull.test.ts`, `survey-source.test.ts`, `order-detail-survey.test.tsx` | `sync-stub.test.mjs` (`assigned`) | `115-survey-assigned` |
| **W5** adres i telefon poza logami, powiadomieniami, komunikatami | `survey-service.test.ts` (spy na `console` i diagnostykę), nazwy dostępne kart bez adresu | `device-survey.test.mjs` | `logcat-no-survey-data` po scenariuszach z wysyłką |
| **W8** brak pól swobodnych na dane klienta | `site-survey-screen.test.tsx` (dokładnie sześć pól), `order-detail-survey.test.tsx` (podpowiedź przy wpisie) | — | `113-survey-rejected-offline` (podpowiedź) |
| **W9** tryb ukrytych danych | jak AC5 | — | `112-survey-hidden` |
| **W10** po usunięciu wizji: bez „Dodaj do innego zlecenia”, bez pętli | `survey-attention.test.ts`, `survey-queue.test.ts`, `survey-service.test.ts` (znaczniki), `media-uploads.test.ts` | `sync-stub.test.mjs` (stabilne odrzucenie) | `114-survey-deleted-return` |

## 5. Ręczny test terenowy (propozycja wiersza do checklisty w `docs/process/testing-strategy.md`)

„Wizja lokalna w garażu bez zasięgu: założenie samym adresem, 3 zdjęcia i 1 film, restart telefonu, powrót zasięgu — numer `ZL-…` bez duplikatu i pliki wysłane.” Nie edytuję strategii testów bez zgody; wiersz do dopisania przez orkiestratora.

## 6. Miejsce na wyniki (uzupełnia orkiestrator)

| Data | Przebieg | Wynik | Uwagi |
|---|---|---|---|
| | | | |
