# EVM-137 — raport weryfikacji QA

Historyjka: [EVM-137](../../backlog/M2/EVM-137-mobile-wizja-lokalna.md) (AC1–AC7), plan: [plan-i-polecenia.md](plan-i-polecenia.md), makiety: [17-wizja-lokalna.md](../../ux/flows/17-wizja-lokalna.md). Data: 2026-11-17. Klon `evia-manager-n2`, gałąź `feature/queue-2026-11-16-wizja-lokalna-c`, głowa `5d09516c`. Weryfikator nie uruchamiał emulatora, Maestro, Gradle ani Dockera; dowody z emulatora pochodzą z logów i zrzutów orkiestratora (przebiegi 3 i 4).

## Werdykt: PASS z uwagami do decyzji właściciela

AC1–AC7 mają testy z sensownymi asercjami i przypadkami negatywnymi (Jest, `sync-core`, `node:test`, Maestro). Brak blockerów i major. Odstępstwa uzgodnione z Tech Leadem (kod pocztowy wymagany, `quota_exceeded`, komunikat limitu do EVM-140, szkic tylko w pamięci, telefon zamawiającego „jak wpisany”, komendy plików ukryte w Kolejce, „Usuń z telefonu” grupy usuwa pliki, ikona „info”) kod realizuje zgodnie z opisem. Zrzuty z emulatora dostępne tylko dla przepływu `survey-offline` (zob. 3).

## 1. Macierz AC → testy → wynik

Ścieżki: M = `apps/mobile/test/…`, S = `packages/sync-core/test/…`, T = `tools/mobile-e2e/test/…`, E = `apps/mobile/e2e/…`.

| AC | Zdanie „Wtedy” | Testy | Wynik |
|---|---|---|---|
| AC1 | „Wizja lokalna” pierwsza w „Dodaj”, przed „Nowe zlecenie” | M `site-survey-screen.test.tsx` („FIRST action of the sheet”); E `110-survey-sign-in` (kolejność wierszy) + zrzut `m05-add-sheet-survey.png` | PASS |
| AC1 | Formularz: adres wymagany + opcjonalny telefon z podpowiedzią; bez klienta/szablonu/tytułu | M `site-survey-screen` (dokładnie sześć pól, podpowiedź, klawiatura telefonu), `orders/site-survey-model` (walidacja, limity 200/20/20/100, NN-NNN, błąd bez wpisanego tekstu); E `111-survey-offline` + zrzut `m10-survey-errors.png` | PASS (kod pocztowy wymagany — odstępstwo) |
| AC1 | `feature_disabled` — brak akcji | M `site-survey-screen` (switch off), `sync/survey-service` (przełącznik offline, po restarcie), S `survey-pull` (tylko boolean `true`); E `116-survey-feature-off`; T `sync-stub` | PASS |
| AC2 | Komenda `CreateSiteSurvey` w kolejce, wizja na liście i w szczegółach „Oczekuje na numer” | M `site-survey-screen` (jedna komenda, nowe UUIDv7, odmowa kolejki), `survey-detail-model`, `order-list-survey`, `orders-screen-survey`, `sync/survey-service`; E `111-survey-offline` + zrzuty `m03-survey-pending`, `m05-survey-card-pending` | PASS |
| AC2 | Numer `ZL-…` bez duplikatu, także po `force-stop` | S `survey-queue` (kill → raz; utrata odpowiedzi → `duplicate`), **nowe** `survey-two-offline`; M `survey-service` (restart + powrót sieci, brak drugiego wiersza); E `111-survey-restart`, `111-survey-return` + `check-sync-report` (2 unikalne, 0 duplikatów) + `m05-survey-numbered.png` | PASS |
| AC3 | Aparat jak EVM-108/110, kategoria „Oględziny”, pliki za wizją, wysyłka po numerze | M `capture/camera-screen` (domyślnie „Oględziny”, kategoria `site_survey`), `upload/media-uploads` (`awaitsSurvey`), `sync/survey-queue-view` (plik za wizją); E `111-survey-offline` + `m06-survey-camera.png`, `112-survey-hidden`; wysłanie pliku `m07-survey-queue-sent` | PASS (filmy bez dźwięku / Wi-Fi z testów EVM-110, bez własnych testów wizji — zob. ustalenia) |
| AC4 | Lista: odznaka, numer, data, „Wygasa za N dni”, bez adresu; chip | M `orders-screen-survey` (brak adresu w karcie i w nazwie dostępnej, 15 dni, termin minął, chip z licznikiem i pusty stan), `order-list-survey`; E `111-survey-offline` (`assertNotVisible` adresu) + `m05-survey-chip.png`, `111-survey-return` + `m05-survey-numbered.png` | PASS |
| AC4 | Adres, telefon, „Brak klienta” tylko w szczegółach; brak w tytułach, logach, błędach | M `order-detail-survey`, `survey-service` (spy na `console` i diagnostykę), `survey-picker`; T `device-survey` (`logcat-no-survey-data`: 755 / 874 / 922 linii bez adresu i telefonu); zrzut `m03-survey-pending.png` | PASS |
| AC5 | Tryb ukrytych danych: formularz niedostępny z komunikatem, Kolejka bez adresu, aparat działa | M `site-survey-screen` (komunikat, zrzucenie otwartego formularza), `orders-screen-survey`, `order-detail-survey`, `survey-attention-screen`, `survey-picker`, `survey-source` (brak odczytu); E `112-survey-hidden` (`survey-hidden-data`, w przebiegu 3 zaliczony) | PASS (zrzut niedostępny) |
| AC6 | „Wymaga uwagi” z powodem po polsku bez adresu i „Usuń z telefonu”; wizja znika; pliki/mutacje odrzucone bez pętli | S `survey-attention` (kody, własność), `survey-queue` (`feature_disabled`, nieznany kod, usunięta wizja, brak „Dodaj do innego”); M `survey-attention-screen`, `survey-queue-view`, `media-uploads` (plik odrzuconej komendy: jeden wiersz, bez ponowień; `forgetFiles`); E `113-*` (0/0/1 odrzucona), `114-*` (1/0/2 odrzucone) | PASS (zrzuty niedostępne) |
| AC7 | Odznaka i termin znikają, klient widoczny, zdjęcia i wpisy zostają | S `survey-pull` (siteSurvey null); M `survey-source`, `survey-detail-model`, `order-detail-survey` (ten sam ekran staje się zleceniem, wpisy zostają); E `115-survey-assigned` | PASS (zrzut niedostępny) |

## 2. Wyniki komend (z głowy `5d09516c`, Windows natywnie)

| Komenda | Wynik |
|---|---|
| `pnpm --filter @evia/sync-core exec vitest run --coverage.enabled=false` | 26 plików, 609 testów zaliczonych (przed dodaniem testów); po dodaniu `survey-two-offline.test.ts` +2 zaliczone |
| `pnpm --filter @evia/mobile run test:coverage` | 116 zestawów, 1849 testów zaliczonych; pokrycie globalne: instrukcje 96,02 %, gałęzie 93,23 %, funkcje 91,68 %, linie 97,25 %; progi presetu spełnione |
| `cd tools/mobile-e2e && npm test` | 350 testów, 0 niezaliczonych (w tym `survey-flows`, `sync-stub`, `device-survey`) |
| `pnpm --filter @evia/mobile run typecheck` | kod 0 |
| `npm run docs:check` | zob. odpowiedź orkiestratorowi (wynik w raporcie końcowym) |

Pokrycie zmienionego kodu (`coverage:diff`) — nie uruchamiano (poza zakresem poleceń zleconych); wykona bramka orkiestratora.

## 3. Dowody z emulatora

Przebieg 3 (`survey3.log`): 17 przepływów zaliczonych, 1 niezaliczony (`111-survey-return` — błąd scenariusza, poprawiony w `c87a4f91`). Przebieg 4 (`survey4.log`, `--only survey-offline`): 4 zaliczone, 0 niezaliczonych; serwer scenariuszy: 2 unikalne, 0 duplikatów, 0 odrzuconych. Kroki urządzenia: `tokens-not-in-clear`, `logcat-clean`, `logcat-no-survey-data` — ok; przebieg 3: `113` 0/0/1 odrzucona, `114` 1/0/2 odrzucone.

Zrzuty obejrzane (`C:\e\.scratch\mobile-e2e\maestro-output\2026-11-17_14*`, dostępne tylko z przebiegu 4):

- `m05-add-sheet-survey.png` (AC1) — „Wizja lokalna” pierwszy wiersz z objaśnieniem „Tylko adres — klienta uzupełni biuro”, potem „Wpis”, „Nowe zlecenie”, „Zdjęcie lub film”. Zgodne z AC. 
- `m10-survey-errors.png` (AC1) — pola Miejscowość / Ulica / Nr budynku / Kod pocztowy z komunikatami (ikona + tekst), Nr lokalu i Telefon opcjonalne, podpowiedź „Tylko numer — imion i nazwisk nie wpisuj.”, informacja o 90 dniach. Zgodne.
- `m03-survey-pending.png` (AC2, AC4) — „Oczekuje na numer”, odznaka „Wizja lokalna”, „Wygasa za 90 dni”, adres i telefon w szczegółach, „Zrób zdjęcie”. Zgodne.
- `m06-survey-camera.png` (AC3) — nagłówek „Oczekuje na numer”, „Oględziny” zaznaczone, tryb Zdjęcie, komunikat „Zapisano w telefonie”. Zgodne.
- `m05-survey-chip.png` (AC4) — karta bez adresu, chip „Wizje lokalne (1)” zaznaczony. Zgodne (chip zawija się do drugiego wiersza — zgodne z makietą z odstępstwem).
- `m05-survey-numbered.png` (AC2) — po powrocie sieci `ZL-E2E-3`, „Wycena”, odznaka, „Wygasa za 90 dni”, brak adresu; brak duplikatu. Zgodne.

Niedostępne: zrzuty AC5, AC6, AC7 z przebiegu 3 (katalogi `2026-11-17_13*` nie istnieją już w `maestro-output` — nadpisane/oczyszczone przy przebiegu 4). Dla tych AC dowodem są wyłącznie logi (`survey3.log`: przepływy zaliczone, liczby serwera) i testy Jest; ocena wizualna AC5–AC7 do uzupełnienia z końcowego przebiegu.

## 4. Przypadki brzegowe

| Przypadek | Pokrycie |
|---|---|
| Przełącznik wyłączony przy otwartym formularzu | Brak testu. Flaga czytana tylko przy otwarciu arkusza (`Shell.tsx`); otwarty formularz zapisze komendę, serwer odrzuci `feature_disabled` → „Wymaga uwagi” (przypadek odrzucenia pokryty: `survey-queue`, `113-*`). Skutek bezpieczny — minor |
| Odrzucenie `feature_disabled` | Jest: `survey-queue`, `survey-service`, `survey-attention-screen`; E `113` |
| Restart z wizją w kolejce | Jest: `survey-queue` (kill), `survey-service`; E `111-survey-restart` |
| Dwie wizje offline pod rząd | Był brak; **dodano** `survey-two-offline.test.ts` (obie raz po kill, oddzielne klucze; odrzucona nie blokuje następnej) |
| Wizja usunięta na serwerze, plik w trakcie wysyłania | `media-uploads` (plik odrzuconej komendy: bez ponowień, jeden wiersz), `survey-service` (znacznik W10), E `114`; „w trakcie” = plik w stanie wysyłania nie ma osobnego testu przejścia aktywne → odrzucone (nit) |
| Tryb ukryty przy otwartym formularzu | `site-survey-screen` (zrzucenie formularza, po powrocie pusty) |

## 5. Ustalenia

- **blocker / major:** brak.
- minor: (1) Brak testu „wyłączony przełącznik w trakcie wypełniania formularza” — zachowanie bezpieczne (odrzucenie serwera), do decyzji, czy formularz ma to sygnalizować. (2) Brak zrzutów AC5–AC7 do przeglądu wizualnego; do uzupełnienia z końcowego przebiegu. (3) Filmy w wizji nie mają własnego testu ani zrzutu (AC3 opiera się na testach EVM-110 dla wspólnego kodu; wizja różni się tylko kategorią domyślną).
- nit: (1) chip „Wizje lokalne” zawija się do drugiego wiersza (dobra widoczność, ale odstępstwo od układu — już w uwagach historyjki). (2) Brak testu przejścia „plik w trakcie wysyłania → komenda wizji usunięta”.
- Do decyzji właściciela (odstępstwa uzgodnione): kod pocztowy wymagany; `quota_exceeded` zamiast `sync_quota_exceeded`; komunikat limitu do EVM-140 (telefon pokaże powód ogólny); szkic tylko w pamięci; telefon zamawiającego „jak wpisany”.

## 6. Dodane testy

`packages/sync-core/test/survey-two-offline.test.ts` (2 testy, `EVM-137 AC2`, `EVM-137 AC6`): zaliczone.

## 7. Nie sprawdzono

Emulatora i Maestro (dowody z logów orkiestratora); pokrycia zmienionego kodu; mutacji; przepływów 112–115 na zrzutach; iOS (odłożony); filmów wizji na emulatorze (testy EVM-110 dotyczą wspólnego kodu).

## 8. Końcowy przebieg emulatora (do uzupełnienia przez orkiestratora)

| Data | Przebieg | Wynik | Uwagi |
|---|---|---|---|
| | komplet `--only survey-` | | |
| | regresja domyślna | | |
| | `--only upload-,camera-,video-` | | |

## 9. Jak to sprawdzić na telefonie testowym (dane syntetyczne)

1. Zaloguj się kontem Edytora na serwerze testowym (nie `panel.eviacharge.pl` / `staging.eviacharge.pl`), poczekaj na synchronizację.
2. Włącz tryb samolotowy. „Dodaj” → pierwszy wiersz „Wizja lokalna”. Zapisz pusty formularz — zobaczysz brakujące pola.
3. Wpisz: Piaseczno, Fikcyjna, 12, 05-500, telefon 600000011 → „Zapisz wizję”. Szczegóły: „Oczekuje na numer”, odznaka, „Wygasa za 90 dni”, adres i telefon tylko tu.
4. „Zrób zdjęcie” — kategoria „Oględziny” zaznaczona; zrób zdjęcie. Lista: karta bez adresu, chip „Wizje lokalne (1)”; Kolejka: „Wyślemy po utworzeniu wizji”.
5. Wymuś zamknięcie aplikacji, otwórz ponownie (wszystko jest), wyłącz tryb samolotowy: numer `ZL-…`, plik „Wysłano”, jedna wizja.
6. Po przypisaniu klienta w panelu i synchronizacji: odznaka i termin znikają, klient widoczny, zdjęcia zostają.
