# Scenariusze A–D przez makiety (AC5)

> Dokument żywy (EVM-004). Właściciel: `ux-designer`; weryfikacja biznesowa: `product-owner`. Scenariusze: [`domain.md`](../../product/domain.md#scenariusze-walidujące-model); szablony: [`service-catalog.md`](../../product/service-catalog.md#5-szablony-zleceń); przejście scenariuszy przez model: [`domain-model.md`](../../architecture/domain-model.md#walidacja-scenariuszy-af). Indeks makiet: [README.md](README.md).
> **Kryterium:** każdy krok — od utworzenia zlecenia do rozliczenia — wskazuje istniejący ekran z makietą; kolumna „Obejście” = „brak”. Luki znalezione w trakcie przejścia są zamknięte w makietach albo opisane jako „Uwagi do rozważenia” historyjki EVM-004 ([tabela luk](#luki-znalezione-w-przejściu-i-ich-zamknięcie)); wynik weryfikacji biznesowej — [na końcu dokumentu](#weryfikacja-biznesowa-product-owner-2026-10-03). Dane wyłącznie syntetyczne.

Kanały: **web** — panel (biuro), **mobile** — aplikacja (teren). Role: A — Administrator, E — Edytor, R — Tylko odczyt.

## A. Dom — sam montaż
Klient ma własną ładowarkę i gotowe zasilanie; montaż, uruchomienie, pomiary; jedna płatność (szablon „Dom — sam montaż”).

| Krok | Kto i kanał | Ekran | Akcja | Wynik | Obejście |
|---|---|---|---|---|---|
| A1 | E, web | [W-10](07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) → [W-05](02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie) | „Nowe zlecenie”; „Dodaj klienta” (osoba: Jan Przykładowy, telefon); nowa lokalizacja (dom jednorodzinny, ul. Fikcyjna 12, 05-500 Piaseczno); szablon „Dom — sam montaż”; „Utwórz zlecenie” | zlecenie `ZL-2026-0051` „Nowe”: 3 pozycje, 3 procesy, 1 transza „Planowana”; W-06 | brak |
| A1′ (wariant) | E, mobile | [M-10](10-mobile-szybkie-zlecenie.md#m-10-szybkie-zlecenie) → [M-03](03-szczegoly-zlecenia.md#m-03-szczegóły-zlecenia) | technik na oględzinach zakłada szybkie zlecenie bez zasięgu i robi zdjęcia („Oględziny”) | „Oczekuje na numer”; po synchronizacji numer; w W-06 Banner „Zlecenie założone w terenie… Uzupełnij dane” | brak |
| A1″ (wariant, cd.) | E, web | [W-06](03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (baner „Zlecenie założone w terenie”, karta „Lokalizacja”) → W-20 (dialog — pola jak [W-05](02-nowe-zlecenie-z-szablonu.md#w-05-nowe-zlecenie) „2. Lokalizacja”), W-14, sekcja „Płatności” | z banera: „lokalizacji” → „Edytuj lokalizację”: OSD (combobox stron), moc przyłączeniowa, PPE, notatki; „klienta” → W-14: e-mail; „kwoty transz” → „Zmień kwotę” transzy „Planowana” 1 230,00 zł | dane uzupełnione; w dialogu informacja „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (1).”; dalej jak A2 (po „Zaakceptuj bez wyceny” baner znika) | brak |
| A2 | E, web | [W-06](03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (menu zlecenia) | „Zaakceptuj bez wyceny” (`new → accepted`) | „Zaakceptowane”; toast bez „Cofnij” | brak |
| A3 | E, web | [W-07](04-aktualizacja-etapu.md#w-07-zmiana-statusu-etapu) | etap „Weryfikacja modelu i parametrów urządzenia” → „Czekamy na…” → klient | „Czekamy na: klient · od dziś” w podsumowaniu W-06 | brak |
| A4 | E, web | [W-08](05-wpis-i-komentarz.md#w-08-dziennik) → W-07 | wpis „Rozmowa telefoniczna: klient podał model i moc”; etap → „Odpowiedź otrzymana”, potem „Zakończ…” | etap „Zakończony”; „Cofnij” dostępne 10 s | brak |
| A5 | E, web | W-06 (menu zlecenia) → W-07 | „Rozpocznij realizację”; etap „Umówienie terminu montażu” → „Czekamy na…” klient → po ustaleniu „Zakończ…” | „W realizacji”; termin w dzienniku | brak |
| A6 | E (technik), mobile | [M-05](07-lista-zlecen-i-filtry.md#m-05-lista-zleceń) → M-03 → [M-06](09-mobile-zdjecia-filmy-offline.md#m-06-aparat) | zdjęcia „Stan przed pracami” i „Po zakończeniu” (część bez zasięgu) | „Zapisano w telefonie”; [M-07](09-mobile-zdjecia-filmy-offline.md#m-07-kolejka) „Offline · 8” → po powrocie zasięgu „Wysłano”; miniatury z serwera w [M-08](09-mobile-zdjecia-filmy-offline.md#m-08-media-zlecenia) | brak |
| A7 | E (technik), mobile | [M-04](05-wpis-i-komentarz.md#m-04-nowy-wpis) | wpis „Wizyta na miejscu: montaż i uruchomienie bez uwag” | wpis w dzienniku biura z dopiskiem „z telefonu” | brak |
| A8 | E, web | [W-09](06-galeria-i-upload.md#w-09-media-i-dokumenty) | „Dodaj dokument”: „Protokół uruchomienia” i „Protokół pomiarów” (klasa „Standardowy”), przypisane do etapów | dokumenty „Sprawdzanie pliku” → gotowe | brak |
| A9 | E, web | W-07 | etap „Urządzenie dostępne na miejscu montażu” oraz etapy montażu, pomiarów i odbioru → „Zakończ…” | każdy z 3 procesów: „Wszystkie zakończone” | brak |
| A10 | E, web | W-06 (menu zlecenia) | „Zakończ” (`in_progress → completed`) | „Zakończone”; „Cofnij” 10 s | brak |
| A11 | E, web | W-06 → sekcja „Płatności” ([akcje](08-nieoplacone.md#akcje-płatności--status--rola)) | „Wystaw fakturę…”: kwota 1 230,00 zł, nr `FV/TEST/0021/2026`, data; dialog z podsumowaniem | transza „Wystawiona”, termin = data + 7 dni | brak |
| A12 | R (księgowość), web | [W-11](08-nieoplacone.md#w-11-nieopłacone) | podgląd nieopłaconych (bez akcji) | widzi transzę i sumę | brak |
| A13 | E, web | W-11 | „Odnotuj wpłatę” (dialog z podsumowaniem) | „Opłacona”; znika z nieopłaconych | brak |
| A14 | E, web | W-06 (menu zlecenia) | „Rozlicz…” (dialog: 1 z 1 transz opłacona) | „Rozliczone”; Banner „tylko do odczytu…, wpisy i zdjęcia nadal możesz dodawać” | brak |

## B. Dom — pełny pakiet
Zwiększenie mocy (proces z OSD), obwód dedykowany, ładowarka z oferty, montaż, pomiary; zaliczka + płatność końcowa (szablon „Dom — pełny pakiet”).

| Krok | Kto i kanał | Ekran | Akcja | Wynik | Obejście |
|---|---|---|---|---|---|
| B1 | E, web | W-05 | istniejący klient (combobox); nowa lokalizacja; OSD — „Dodaj stronę” (rodzaj OSD, „Stoen Operator”); szablon „Dom — pełny pakiet” | zlecenie z 5 procesami i 2 transzami | brak |
| B2 | E, web; E (technik), mobile | W-06 (menu zlecenia) → M-06 / W-08 → W-09 → W-06 → W-07 | „Rozpocznij wycenę”; oględziny: zdjęcia „Oględziny” z telefonu i wpis „Wizyta na miejscu”; „Dodaj dokument” rodzaju „Oferta / wycena” (Standardowy); po decyzji klienta „Zaakceptuj” i „Rozpocznij realizację”; etap „Pełnomocnictwo od klienta” → „Czekamy na…” klient | „Wycena” → „Zaakceptowane” → „W realizacji” (toasty bez „Cofnij”); oferta w „Dokumentach zlecenia”; „Czekamy na: klient · od dziś” | brak |
| B3 | E, web | W-06 → [akcje płatności](08-nieoplacone.md#akcje-płatności--status--rola) | „Wystaw fakturę…” dla „Zaliczka (30%)” (nr proformy w polu „Nr faktury lub proformy”) | „Wystawiona” | brak |
| B4 | E, web | W-09 → W-07 | „Dodaj dokument”: rodzaj „Pełnomocnictwo” (klasa „Dane identyfikacyjne” z rodzaju) przy etapie; etap → „Zakończ…” | R widzi wiersz z `lock` „Plik dostępny dla administratora i edytora” | brak |
| B5 | E, web | W-07 | „Wniosek do OSD” → „Zakończ…”; „Warunki przyłączenia i projekt umowy” → „Czekamy na…” → strona „Stoen Operator (OSD)” (podpowiedź z lokalizacji, domyślnie z szablonu etapu) | „Czekamy na: Stoen Operator (OSD) · od dziś” | brak |
| B6 | E, web | W-10 | po 15 dniach — zapisany widok „Czekamy na OSD > 14 dni” | zlecenie na liście z `triangle-alert` „od 15 dni” | brak |
| B7 | E, web | W-08 | wpis „Rozmowa telefoniczna: OSD potwierdził wysyłkę warunków” przy etapie | wpis w dzienniku etapu | brak |
| B8 | E, web | W-09 → W-07 | „Dodaj dokument” „Warunki przyłączenia” (Standardowy) przy etapie; etap → „Zakończ…”; „Umowa z OSD podpisana…” → „Czekamy na…” klient | licznik oczekiwania na OSD znika, „Czekamy na: klient” | brak |
| B9 | E, web | W-11 | zaliczka po terminie (`isOverdue`) — „Po terminie” 5 dni → „Odnotuj wpłatę” | „Opłacona” | brak |
| B10 | E (technik), mobile | M-03 → M-06 → M-07 | zdjęcia instalacji zasilającej i montażu, film z pomiarów (czeka na Wi-Fi → „Wyślij teraz przez sieć komórkową”) | wszystko „Wysłano”; pliki w W-09 | brak |
| B11 | E, web | W-07 | „Zgłoszenie gotowości…” → „Zakończ…”; „Wymiana licznika…” → „Czekamy na…” Stoen Operator (OSD) → po załączeniu „Zakończ…”; pozostałe etapy „Zakończ…”, zbędny etap „Prace sieciowe…” → „Nie dotyczy” | procesy zakończone | brak |
| B12 | E, web | W-06 → W-11 | „Zakończ”; „Wystaw fakturę…” dla „Płatność końcowa (70%)”; po wpłacie „Odnotuj wpłatę” | obie transze „Opłacona” | brak |
| B13 | E, web | W-06 | „Rozlicz…” | „Rozliczone” | brak |

## C. Garaż podziemny — pełny proces
Administracja → ekspertyza → opinia ppoż → projekt → OSD → zgoda → instalacja → montaż → pomiary i odbiór; 4 transze; dużo zdjęć bez zasięgu (szablon „Garaż — pełny proces”).

| Krok | Kto i kanał | Ekran | Akcja | Wynik | Obejście |
|---|---|---|---|---|---|
| C1 | E, web | W-05 | klient; nowa lokalizacja „Garaż w budynku wielorodzinnym” z nr miejsca 15 i poziomem −1; zarządca — „Dodaj stronę” (rodzaj „Wspólnota / spółdzielnia”); OSD; szablon „Garaż — pełny proces” | 9 procesów, 4 transze | brak |
| C2 | E, web | W-06 | podgląd: procesy zwinięte (Disclosure, § 3.21) z postępem „0 z 4 etapów” (ProcedureProgress, § 3.23); podsumowanie „Na jakim etapie” per proces | „na jakim etapie jesteśmy z administracją / w OSD” widać osobno | brak |
| C3 | E, web | W-07 → W-09 | „Dokumentacja budynku otrzymana” → „Czekamy na…” strona rodzaju „Administracja” (nowa strona z dialogu); po otrzymaniu — „Dodaj dokument” „Dokumentacja budynku”, „Przypisz do: Lokalizacji” (Bezpieczeństwo budynku) | dokument w sekcji „Dokumenty lokalizacji” | brak |
| C4 | E, web | W-07 | ekspertyza: „Wizja lokalna rzeczoznawcy” → „Czekamy na…” strona „Rzeczoznawca (ekspertyza)”; opinia ppoż — „Rzeczoznawca ppoż”; projekt — „Projektant” | „Na kogo czekamy” pokazuje kilka stron jednocześnie, posortowanych od najdłuższego oczekiwania | brak |
| C5 | E, web | W-09 | ekspertyza, opinia ppoż i projekt jako dokumenty („Bezpieczeństwo budynku” z rodzaju) | R widzi metadane z `lock` | brak |
| C6 | E, web | W-07, W-10 | proces OSD jak w B5–B8; zgoda wspólnoty — „Czekamy na…” Wspólnota (Wspólnota / spółdzielnia) | widoki „Czekamy na OSD > 14 dni” i filtr „Czekamy na: Wspólnota / spółdzielnia dłużej niż 30 dni” | brak |
| C7 | E, web | W-06 / W-11 | transze „Zaliczka”, „Po uzyskaniu zgód”, „Po wykonaniu instalacji”, „Płatność końcowa” wystawiane i opłacane w kolejnych krokach | sumy w W-11 | brak |
| C8 | E, web → A, web | W-06 → [W-04](01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie) | Edytor zauważa złą kwotę wystawionej transzy: „Zmień kwotę…” wyłączone z podpowiedzią → komentarz w W-08 do Administratora; Administrator: „Zmień kwotę…” (dialog z kwotą przed i po) → W-04 (passkey) | korekta wykonana i audytowana; Edytor nie ma ścieżki obejścia (SR-AUTHZ-10) | brak |
| C9 | E (technik), mobile | M-06 → M-07 | 60 zdjęć w garażu bez zasięgu, seria z kategorią „W trakcie prac”, latarka | SyncIndicator „Offline · 60”; po wyjeździe na powierzchnię — „Wysyłanie 12 z 60…” → „Zsynchronizowano” | brak |
| C10 | A, web | W-09 | jeden plik w kwarantannie: „Wymaga uwagi” z przyczyną (tylko A) → „Skanuj ponownie” → W-04 | czysty wynik — plik wraca do przepływu; na telefonie znacznik „Wymaga uwagi” zmienia się na „Wysłano” | brak |
| C11 | E, web | W-07, W-06 | instalacja, montaż, pomiary, odbiór → „Zakończ…”; „Zakończ” zlecenie; ostatnia wpłata; „Rozlicz…” | „Rozliczone” | brak |

## D. Garaż — sama instalacja, potem montaż w tej samej lokalizacji
Pierwsze zlecenie bez urządzenia; po czasie kolejne zlecenie (także dla innego klienta) w tej samej lokalizacji (szablony „Garaż — sama instalacja”, „Garaż — montaż ładowarki”).

| Krok | Kto i kanał | Ekran | Akcja | Wynik | Obejście |
|---|---|---|---|---|---|
| D1 | E, web | W-05 | szablon „Garaż — sama instalacja” dla nowej lokalizacji (garaż, miejsce 15) | `ZL-2026-0017`: 7 procesów, 3 transze | brak |
| D2 | E, web / mobile | W-07, W-09, M-06 | formalności i instalacja jak w C3–C10 (bez montażu); projekt i protokół pomiarów w W-09; dokumentacja budynku z kotwicą lokalizacji | dokumenty pierwszego zlecenia | brak |
| D3 | E, web | W-06, W-11 | „Zakończ”, płatności, „Rozlicz…” | `ZL-2026-0017` „Rozliczone” (z 30 dni na telefonach, potem poza zakresem urządzenia) | brak |
| D4 | E, web | W-05 | po pół roku ten sam klient zamawia ładowarkę: klient z comboboxu klientów; lokalizacja „Istniejąca” (wyszukanie po adresie); szablon „Garaż — montaż ładowarki” | `ZL-2026-0058`: 2 procesy, 1 transza; ten sam `siteId`; dane klienta i lokalizacji bez ponownego wpisywania | brak |
| D4′ (wariant) | E, web | W-05 | jak D4, ale dla nowego klienta (np. nowy najemca miejsca) — „Dodaj klienta”; lokalizacja „Istniejąca” | jak D4 — inny klient, ten sam `siteId` | brak |
| D5 | E, web | W-06 → karta „Lokalizacja” (układ jak w makiecie W-06) | „Inne zlecenia w tej lokalizacji (1)”: `ZL-2026-0017` · tytuł · «Rozliczone» · 12.03.2026 — bez danych poprzedniego klienta i miniatur (także w wariancie D4′) | podgląd historii lokalizacji w zakresie M1 | brak |
| D6 | E, web | W-06 (`ZL-2026-0017`) → W-09 | przejście linkiem (zwykła autoryzacja zlecenia źródłowego); pobranie projektu instalacji (A, E); R — `lock` | technik i biuro znają trasę WLZ z pierwszego zlecenia | brak |
| D7 | E, web | W-06 (`ZL-2026-0058`) → W-09 | „Dokumenty lokalizacji (1)” — dokumentacja budynku widoczna także w nowym zleceniu | bez kopiowania dokumentów | brak |
| D8 | E (technik), mobile | M-05 → M-03 → M-06 | montaż, zdjęcia, wpisy; na telefonie brak „Innych zleceń w tej lokalizacji” (tylko panel) | — | brak |
| D9 | E, web | W-07, W-06, W-11 | etapy zakończone, „Zakończ”, faktura, wpłata, „Rozlicz…” | `ZL-2026-0058` „Rozliczone” | brak |

## Luki znalezione w przejściu i ich zamknięcie
| # | Luka | Zamknięcie |
|---|---|---|
| L1 | Gdzie dodać i zobaczyć dokument z kotwicą lokalizacji lub klienta (dokumentacja budynku — C3, D7) | W-09: „Przypisz do: Zlecenia / Lokalizacji / Klienta” i sekcje „Dokumenty lokalizacji”, „Dokumenty klienta” — makieta zamknięta |
| L2 | Edytor pomylił się przy kwocie wystawionej transzy (C8) | ścieżka przez Administratora ze step-upem; Edytor ma wyłączony przycisk z podpowiedzią i pisze komentarz — makieta zamknięta; ewentualna funkcja „Poproś o korektę” → kandydat do backlogu („Uwagi do rozważenia” EVM-004) |
| L3 | Kolumny „Czekamy na”, „Termin”, „Płatność” na liście (B6, C6) i karta podsumowania W-06 wymagają agregatów z modułów `procedures` i `payments`, a `work-orders` od nich nie zależy | bez zmiany makiet; sposób dostarczenia (widok odczytu / zapytanie kompozytowe) → „Uwagi do rozważenia” dla `solution-architect` |
| L4 | Podniesienie klasy pojedynczego dokumentu (B4, P6) — pole `confidentialityOverride` jeszcze nie w `domain-model.md` | makieta W-09 gotowa; pole (zmiana *expand*) → „Uwagi do rozważenia” dla `solution-architect` przed E6 |
| L5 | Odrzucone szybkie zlecenie z zależnymi zdjęciami (A1′) | M-10 / M-07: „Utwórz ponownie” z przeniesieniem zależnych elementów przed wysłaniem → „Uwagi do rozważenia” dla `mobile-developer` i `solution-architect` (E13, EVM-011) |
| L6 | Dane ładowarki klienta w lokalizacji (A — `Charger` z `ownership = customer_owned`) | w M1 parametry urządzenia w pozycji zakresu (karta „Zakres” w W-06); ładowarka w lokalizacji — kandydat M4/M7 z EVM-002, nie blokuje scenariuszy |
| L7 | Szczegóły edycji zakresu (dodanie pozycji, gdy na miejscu okaże się, że zasilanie nie jest gotowe — wariant A z EVM-002) | W-06 „Edytuj zakres” — szczegóły przy refinemencie E3; scenariusze A–D przechodzą na szablonach |
| L8 | Uzupełnienie danych lokalizacji i strony po utworzeniu zlecenia (A1′ — baner „Uzupełnij dane klienta i lokalizacji”; w praktyce także PPE albo zarządca poznani później) — makiety nie mają akcji edycji lokalizacji ani strony (klienta edytuje się w W-14) | zamknięte (PO-1, poprawki po przeglądach — runda 1): W-06 — baner „Zlecenie założone w terenie” z odnośnikami (klient → W-14, lokalizacja → W-20, kwoty → „Zmień kwotę”), „Edytuj” w karcie „Lokalizacja” i „Edytuj stronę” przy OSD i zarządcy (A, E; R — ukryte) z informacją „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).”; W-20 na mapie nawigacji jako dialog bez makiety (pola z W-05) — pełna makieta przy refinemencie E3 / E4; krok A1″ |

## Weryfikacja biznesowa (product-owner, 2026-10-03)
**Wynik:** scenariusze A–D przechodzą przez makiety bez obejść. Terminologia makiet jest zgodna ze słownikiem ([`domain.md`](../../product/domain.md); nowe pojęcia — „Pojęcia z makiet MVP”) i ze styleguide § 6.2. Uwagi do mikrocopy i kandydaci do backlogu: historyjka EVM-004 → „Uwagi do rozważenia” → „Weryfikacja biznesowa”.

**Co sprawdziłem**
| Obszar | Wynik |
|---|---|
| Szablony: liczby pozycji, procesów i transz (A1, B1, C1, D1, D4) | zgodne z [`service-catalog.md`](../../product/service-catalog.md#5-szablony-zleceń) § 5 |
| Przejścia zlecenia, etapów i transz w krokach; „Cofnij” i dialogi z podsumowaniem | zgodne z `domain-model.md` → „Stany i przejścia” i z listą [„Cofnij”](04-aktualizacja-etapu.md#cofnij--lista-przejść) |
| Role w krokach: E — praca bieżąca, A ↑ — korekty i przywrócenia (C8, C10), R — podgląd płatności i dokumentów „Standardowy” (A12, B4, C5) | zgodne z macierzą uprawnień, P6 i [akcjami płatności](08-nieoplacone.md#akcje-płatności--status--rola) |
| Telefon (A1′, A6, A7, B2, B10, C9, D8) | tylko dodaje: zdjęcia, filmy, wpisy, szybkie zlecenie; bez płatności, zmian statusów i „Innych zleceń w tej lokalizacji” |
| „Na kogo czekamy” i filtr „dłużej niż X dni” (B5–B8, C2–C6) | odpowiada na pytania biura: „na jakim etapie jesteśmy w OSD”, „z administracją”, „u rzeczoznawcy” — osobno dla każdego procesu |
| Rozliczenie (A14, B13, C11, D3, D9) | „Rozlicz…” tylko przy transzach opłaconych albo anulowanych; po rozliczeniu nadal można dodawać wpisy, zdjęcia i dokumenty (zgodnie z `offline-sync.md` — `CreateNote` także dla zleceń rozliczonych) |

**Poprawki wprowadzone przy weryfikacji**
- **B2** przechodzi teraz przez wycenę: „Rozpocznij wycenę” → oględziny → oferta → „Zaakceptuj”. Wcześniej był tu krok „Zaakceptuj bez wyceny”. Pełny pakiet zwykle zaczyna się od oględzin i oferty, a ścieżki `new → quoting → accepted` i dokumentu „Oferta / wycena” nie przechodził dotąd żaden scenariusz. Scenariusz A zostaje bez wyceny (stała cena montażu).
- **A9** — dopisany drugi etap weryfikacji ładowarki klienta; wynik opisany etykietą z makiety („Wszystkie zakończone”).
- **D4** — przejście dotyczy teraz wariantu podstawowego z `domain.md` („klient zamówi później”): ten sam klient, istniejąca lokalizacja. Wariant z nowym klientem jest teraz osobnym krokiem D4′. Drugie zlecenie ma numer `ZL-2026-0058`, bo `ZL-2026-0042` to w makietach inne zlecenie („Garaż — pełny proces”).
- **L8** — nowa luka (edycja lokalizacji i strony) przekazana jako PO-1.
