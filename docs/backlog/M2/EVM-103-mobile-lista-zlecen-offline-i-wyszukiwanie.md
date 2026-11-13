---
id: EVM-103
title: "Aplikacja: lista zleceń offline i wyszukiwanie"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: in-review
priority: P1
path: pelna             # dane osobowe na urządzeniu (lista, indeks wyszukiwania), synchronizacja offline, tryb ukrytych danych
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet           # ekran i zapytania na gotowej bazie (EVM-093) i silniku (EVM-107); indeks wyszukiwania ustala konsultacja architekta
depends_on: [EVM-107]
---

# EVM-103: Aplikacja — lista zleceń offline i wyszukiwanie

## Cel
Jako **technik** chcę **widzieć listę zleceń i szukać po numerze, kliencie, adresie lub miejscu postojowym także bez zasięgu**, aby **znaleźć właściwe zlecenie na miejscu w garażu**. Makieta M-05 ([`07-lista-zlecen-i-filtry.md`](../../ux/flows/07-lista-zlecen-i-filtry.md)) z uzupełnieniem w [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md). Dane i silnik już są (EVM-093, 096/097, 107: pierwsze pobranie M-12, SyncIndicator, Kolejka, „Wymaga uwagi”; EVM-100/101: stany urządzenia, ukrycie danych po 7 dniach); ta historyjka dodaje wyłącznie ekran listy i wyszukiwanie.

## Kryteria akceptacji

**AC1 — Lista z bazy lokalnej**
- Zakładając zsynchronizowane zlecenia i brak sieci
- Gdy otwieram „Moje zlecenia” (M-05)
- Wtedy widzę zlecenia wyłącznie z lokalnej bazy (numer, klient, adres, status, etap), bez żadnego żądania do serwera; zlecenia stoją w stałej kolejności (data utworzenia malejąco — projekcja nie ma daty zmiany; decyzja Konrada 2026-11-12), a jeśli zlecenie przestało należeć do zakresu urządzenia (znacznik usunięcia po synchronizacji), znika z listy i wyników bez dodatkowej akcji. Użytkownik niezalogowany nie widzi listy (ekran logowania).

**AC2 — Wyszukiwanie lokalne**
- Zakładając listę
- Gdy wpisuję numer zlecenia, nazwę klienta, ulicę lub numer miejsca postojowego
- Wtedy wyniki pojawiają się na bieżąco od 1 znaku, offline tak samo jak online, także po fragmencie numeru, bez rozróżniania wielkości liter i polskich znaków diakrytycznych (np. „lodz” znajdzie „Łódź”); zapytanie jest traktowane dosłownie — dowolne znaki (`"`, `%`, `_`, `*`, nawiasy, apostrof) nie powodują błędu ani nie zmieniają dopasowania (test na zestawie znaków specjalnych); przy aktywnym zapytaniu wyniki są sortowane wg trafności (numer > adres > klient), potem wg kolejności bazowej, a „Oczekuje na numer” zostaje na górze; po wyczyszczeniu pola wraca pełna lista; zapytanie nie jest zapisywane ani logowane (SR-MOB-12, AC6).

**AC3 — Chipy i zlecenia oczekujące**
- Zakładając zlecenia, w tym utworzone na telefonie i czekające na numer, oraz elementy w Kolejce
- Gdy oglądam listę
- Wtedy dostępne są chipy „Wszystkie” i „Niewysłane (n)” (zlecenia z elementami w Kolejce; n = liczba wszystkich takich zleceń w zakresie, niezależnie od zapytania; chip działa łącznie z wyszukiwaniem; pusty chip: „Wszystko wysłane.”), a zlecenia oczekujące na numer są oznaczone „Oczekuje na numer”, stoją na górze listy do czasu nadania numeru i dają się znaleźć po adresie i kliencie.

**AC4 — Stany pustej listy i braku wyników**
- Zakładając brak zleceń, brak wyników wyszukiwania albo trwające odświeżanie po resyncu
- Gdy oglądam listę
- Wtedy widzę stan zgodny z makietą: brak zleceń — „Nie masz zleceń w telefonie…” z akcją (offline dodatkowo „Brak zasięgu”); brak wyników — „Szukamy tylko w zleceniach zapisanych w telefonie” z „Wyczyść wyszukiwanie”, a offline lub przy danych starszych niż 1 h także czas ostatniej synchronizacji (zapytanie zostaje w polu); podczas odświeżania pokazywane są dotychczasowe dane bez „mrugania”; pierwsze pobranie pokazuje M-12 (EVM-107), nie listę.

**AC5 — Tryb ukrytych danych**
- Zakładając tryb ukrytych danych (EVM-101: brak blokady ekranu albo 7 dni bez kontaktu)
- Gdy otwieram M-05
- Wtedy lista nie pokazuje nazw, adresów ani numerów miejsc, pole wyszukiwania i chipy nie są renderowane, model listy nie zawiera nazwy, adresu ani numeru miejsca, a model i zapytanie są zerowane w chwili wejścia w tryb (także po powrocie z tła) i przy wylogowaniu (zapytanie nie filtruje i nie ujawnia istnienia wyniku); w tle dozwolone są tylko odczyty bez danych osobowych (identyfikatory, statusy, licznik „Niewysłane”); ekran oferuje akcję z EVM-101, a po przywróceniu danych lista startuje bez poprzedniego zapytania.

**AC6 — Zakres i brak danych poufnych**
- Zakładając technika z zakresem zleceń nadanym przez uprawnienia (Administrator, Edytor; Tylko odczyt nie loguje się do aplikacji, tylko do panelu — decyzja Konrada 2026-11-12)
- Gdy przeglądam i przeszukuję listę
- Wtedy widzę wyłącznie zlecenia z repliki urządzenia (zakres wyznacza serwer, EVM-097), a wyszukiwanie nie sięga poza nie; lista nie zawiera płatności ani innych danych spoza projekcji telefonu; klucz wyszukiwania istnieje wyłącznie w pamięci procesu (brak trwałego indeksu i kopii danych poza repliką SQLCipher), każde połączenie z bazą ma `temp_store=MEMORY`; pole wyszukiwania wyłącza autokorektę, sprawdzanie pisowni i autofill standardowymi właściwościami pola tekstowego (bez kodu natywnego; flaga `IME_FLAG_NO_PERSONALIZED_LEARNING` poza zakresem — decyzja Konrada 2026-11-12); zapytanie nie trafia do parametrów nawigacji, utrwalanego stanu, stanu odtwarzanego po śmierci procesu, breadcrumbów ani logów. Dowód na emulatorze: znacznik syntetyczny w nazwie klienta i w zapytaniu daje 0 trafień w plikach katalogu aplikacji (jak EVM-093 AC1) i w logcat; z opcją „Nie zachowuj aktywności” pole startuje puste.

**AC7 — Szybkość na zakresie docelowym**
- Zakładając syntetyczne 300 zleceń w zakresie urządzenia na testowym urządzeniu referencyjnym
- Gdy wpisuję kolejne znaki w polu wyszukiwania
- Wtedy lista odświeża się bez blokowania pisania: test w CI budżetu funkcji filtrującej (300 syntetycznych zleceń, próg ok. 50 ms) oraz pomiar ręczny na referencyjnym średnim Androidzie w kompilacji wydania (p95 z ok. 20 znaków ≤ 300 ms; emulator nie jest referencją); wyniki pomiaru trafiają do dowodów historyjki.

## Poza zakresem
- Filtry zaawansowane, sortowanie niestandardowe, chipy „Moje” i „Czekamy na…” (rola Monter — M4, dane procesu).
- Szczegóły zlecenia po dotknięciu wiersza (EVM-104; do czasu jej dostarczenia wiersz otwiera istniejący ekran docelowy lub jest nieaktywny — ustala plan), tworzenie zleceń (EVM-106), wpisy (EVM-105).
- Pierwsze pobranie, SyncIndicator, Kolejka i „Wymaga uwagi” (EVM-107), mechanizm ukrycia danych i jego komunikaty (EVM-101).
- Wyszukiwanie po treści wpisów, komentarzach, kontaktach i dokumentach; wyszukiwanie online na serwerze.

## Decyzje i ograniczenia
- UX / UI: wyszukiwanie offline, stany, tryb ukrytych danych, chipy — flow 16 (M-05). Chipy „Wszystkie / Niewysłane (n)” to odstępstwo od makiety M-05 — zgoda Konrada 2026-11-12 (README planu, decyzja 12), wpis „Odstępstwo M2” w changelogu styleguide'u (§ 8).
- Ścieżka `pelna` (zmiana względem `lekka` z planu): lista i indeks to dane osobowe na urządzeniu i obszar synchronizacji offline (`workflow.md` → „Ścieżki realizacji”; ≤ 8 AC). Zatwierdzona 2026-11-12 (Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”).
- Decyzje Konrada z 2026-11-01: telefony prywatne (BYOD), `FLAG_SECURE` w wydaniu, blokada aplikacji zawsze włączona — wpływają na 103 tylko przez AC5/AC6 (ukrycie danych i zrzut w „Ostatnich” działają w pełni, bez zależności od spisu floty). Sformułowanie „firmowe” w README planu M2 jest nieaktualne, ale nie zmienia zakresu tej historyjki.
- Architektura (konsultacja 2026-11-12, bez ADR): bez FTS5 i bez kolumny w SQL (`unicode61` nie zamienia Ł→L, `trigram` wymaga ≥ 3 znaków). Model listy (numer, klient, ulica, miasto, miejsce, etap) budowany jednym odczytem z repliki i kolejki (zlecenia „Oczekuje na numer” istnieją tylko w kolejce), dopasowanie `includes` na kluczu znormalizowanym w JS (małe litery `pl` → NFD → bez znaków łączących → jawnie `ł→l`), jedna czysta funkcja współdzielona po obu stronach (z testami „lodz”/„Łódź” i fragmentu numeru). Brak trwałego indeksu = brak migracji schematu; model odbudowywany przy wejściu na ekran i po powiadomieniu `SyncHost.subscribe` (jeśli nie pokrywa wszystkich zmian — licznik rewizji w tych samych transakcjach). Nie używać `listWorkOrders` (`LIMIT 500`); bez N+1. Cała lista w pamięci, `FlatList` z wirtualizacją (do ok. 1500 zleceń), bez nowej zależności; zamiana generacji atomowa (`promoteShadow`) daje „bez mrugania”. Notatka w `docs/architecture/offline-sync.md` w ramach historyjki.
- UX / UI (dopisek): wiersz do czasu EVM-104 nieaktywny wizualnie i dla TalkBacka (bez „>”, efektu naciśnięcia, roli przycisku i toastu); live region `polite` po zakończeniu pisania („12 wyników” / „Brak wyników”); pole z etykietą „Szukaj zlecenia”, „Wyczyść wyszukiwanie” ≥ 48 dp; chipy jako przełączniki ze stanem („Niewysłane, 3 zlecenia, wybrane”), odstęp ≥ 8 dp; odznaka „Oczekuje na numer” z ikoną i tekstem, odczytywana od statusu. Wpis „Odstępstwo M2” w changelogu styleguide'u — dodany 2026-11-12 (Tech Lead).
- Bezpieczeństwo i prywatność: zapytanie i wyniki nie trafiają do logów, diagnostyki ani historii (AC6). Ryzyko rezydualne zaakceptowane przez Konrada 2026-11-12: bez flagi IME klawiatura na prywatnym telefonie (np. Gboard) może zapamiętać nazwy klientów i adresy wpisane w wyszukiwarkę i podpowiadać je w innych aplikacjach (słownik klawiatury leży poza katalogiem aplikacji); dane w trybie ukrytym zostają w bazie (EVM-101, TM-03).

## Notatki
- Uwagi nieblokujące 2026-11-13: (security, Low) opcjonalnie `keyboardType="visible-password"` w polu wyszukiwania na Androidzie ogranicza naukę słów przez popularne klawiatury bez kodu natywnego — do decyzji przy kolejnej zmianie ekranu (UX: układ klawiatury); (QA, nit) brak osobnego testu powrotu z tła w trybie ukrytym (pokryte przejściem `guard.hidden`); na małym ekranie z banerem i klawiaturą stan „Brak zleceń dla…” jest pod zgięciem — „Brak wyników” widać przy polu.
- Low: `PRAGMA secure_delete=ON`; wiersze listy bez `selectable`; jedna funkcja normalizacji po obu stronach.
- Kolejność listy i wygląd stanów Kolejki pozostają zgodne z EVM-107 (bez duplikowania wskaźnika).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
- 2026-11-12 — refinement do DoR: 7 AC (dodano zakres/uprawnienia, szybkość, rozdzielono stany i tryb ukrytych danych), ścieżka `lekka` → `pelna`, reviewers + security-engineer, rozgraniczenie z EVM-101/107/104; status `draft` do akceptacji (product-owner)
- 2026-11-12 — naniesiono konsultacje: architekt (wyszukiwanie w pamięci, bez FTS i migracji, sortowanie), security (AC2, AC5, AC6), UX (AC2, AC3, dostępność) (product-owner)
- 2026-11-12 — akceptacja Konrada (DoR): kolejność wg daty utworzenia malejąco, chipy „Wszystkie / Niewysłane (n)” (odstępstwo M2 wpisane w styleguide'zie), bez pluginu IME (ryzyko rezydualne zaakceptowane), Tylko odczyt tylko w panelu; ścieżka `pelna` zatwierdzona z delegacji; status `ready` (Tech Lead)
- 2026-11-13 — start realizacji (`/deliver`, ścieżka `pelna`, równolegle z EVM-124 za zgodą Konrada; EVM-084/085 zostają `in-progress` — posiedzenia B/C, bez kodu w toku) (Tech Lead)
- 2026-11-13 — plan gotowy (mobile-developer)
- 2026-11-13 — implementacja gotowa (ścieżka `pelna`): model i wyszukiwanie w pamięci (bez FTS i migracji), odczyt repliki z listą kluczy `json_extract`, ekran M-05 z chipami i stanami, tryb ukrytych danych, scenariusz Maestro offline, dowody w `docs/qa/EVM-103/` (wyniki emulatora i pomiaru AC7 czekają na przebieg orkiestratora i telefon referencyjny) (mobile-developer)
- 2026-11-13 — weryfikacja orkiestratora: `pnpm run gate` zielona (pokrycie zmienionego kodu 99,5% linii / 97,2% gałęzi); E2E na emulatorze z krótkiego klonu `C:\e`: 45/45 przepływów zielonych (przebieg 4), AC6 `check-encrypted` ok (0 trafień znacznika w plikach, logcat i pamięci zewnętrznej) — po poprawkach scenariusza (baner EVM-100, klawiatura, przewinięcie) i kontroli logcat (linie sterownika Maestro); QA PASS AC1–AC6, AC7 — pomiar ręczny do decyzji Konrada; przeglądy code/security/UX: akceptacja; status `in-review` (Tech Lead)
- 2026-11-13 — Koszt: ok. 0,9 mln tokenów agentów (10 agentów, 2 rundy) + 4 przebiegi E2E orkiestratora — w granicach ścieżki `pelna` (Tech Lead)
- 2026-11-13 — akceptacja Konrada (demo); AC7 — pomiar ręczny na prawdziwym telefonie przesunięty do testu terenowego EVM-112 (decyzja Konrada 2026-11-13; test CI budżetu filtra zielony) (Tech Lead)
