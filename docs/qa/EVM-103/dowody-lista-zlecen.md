# EVM-103 — dowody: lista zleceń offline i wyszukiwanie

Data: 2026-11-13. Historyjka: [EVM-103](../../backlog/M2/EVM-103-mobile-lista-zlecen-offline-i-wyszukiwanie.md). Dane i konto syntetyczne. Stan: przygotowane przez implementację; **wyniki przebiegu na emulatorze i pomiaru na telefonie uzupełnia orkiestrator / Konrad** (tabele „Wynik” poniżej są puste do czasu przebiegu).

## Dowody automatyczne (Jest, `pnpm --filter @evia/mobile run test:coverage`)
| AC | Gdzie | Co dowodzi |
|---|---|---|
| AC1 | `test/sync/order-list.test.ts`, `test/orders-screen.test.tsx` | lista z repliki i kolejki bez dotknięcia transportu (0 żądań), kolejność data malejąco, znacznik usunięcia znika z listy i wyników, ten sam wynik po restarcie procesu, wiersz nieaktywny |
| AC2 | `test/orders/*.test.ts`, `test/orders-screen.test.tsx` | „lodz” = „Łódź”, fragment numeru, od 1 znaku, zestaw znaków specjalnych i wejście 10 kB dosłownie, trafność numer > adres > klient, komunikat „12 wyników” po zakończeniu pisania |
| AC3 | `test/orders-screen.test.tsx` | chipy ze stanem, n niezależne od zapytania, chip + zapytanie łącznie, „Wszystko wysłane.”, „Oczekuje na numer” na górze |
| AC4 | `test/orders-screen.test.tsx` | stany pusty / brak wyników / offline / dane starsze niż 1 h / odświeżanie bez migotania / M-12 |
| AC5 | `test/orders-screen.test.tsx`, `test/storage/order-list-source.test.ts`, `test/sync/order-list.test.ts` | tryb ukryty: brak pola, chipów i danych, model zredagowany, zerowanie zapytania, wyścig „odczyt w toku → tryb ukryty → odpowiedź”, SQL bez kluczy osobowych |
| AC6 | `test/storage/order-list-source.test.ts`, `test/storage/connection-hardening.test.ts`, `test/orders-screen.test.tsx`, `test/ui.test.tsx` | brak surowej kolumny `fields`, `temp_store=MEMORY` na każdym połączeniu, właściwości pola (bez autokorekty, pisowni i autofill), brak zapytania w logach i nawigacji |
| AC7 | `test/orders/order-list-model.test.ts` | budżet filtra: 300 zleceń, mediana < 50 ms |

## AC6 — emulator (Maestro, scenariusz `orders-list-and-search`)
Przebieg: `pnpm --filter @evia/mobile run e2e` (emulator Androida na Windows; po przebiegu `adb emu kill`). Znacznik `EVM093-SENTINEL` jest w nazwie klienta 2 serwera scenariuszy i jest wpisywany jako zapytanie; po przepływie `40-orders-after-kill` krok `check-encrypted` sprawdza 0 trafień w katalogu danych aplikacji (`databases` z `-wal`/`-shm`, `files`, `cache`, `shared_prefs`, `code_cache`), w pamięci zewnętrznej aplikacji i w logcat oraz nagłówek zaszyfrowanej bazy.

| Przepływ | Co sprawdza | Wynik |
|---|---|---|
| `40-orders-sign-in` | pierwsze pobranie kończy się listą dwóch zleceń | PASS (2026-11-13, 45,6 s) |
| `40-orders-offline-search` | tryb samolotowy: lista z lokalnej bazy, wyszukiwanie (fragment numeru, znak `%`, znacznik w nazwie klienta), „Wyczyść wyszukiwanie”, „Wymaga połączenia” | PASS (2026-11-13, 60,0 s) |
| `40-orders-after-kill` | po `kill -9` pole wyszukiwania puste, lista wraca offline; `check-encrypted`: 0 trafień znacznika w plikach i logcat | PASS (2026-11-13, 20,0 s); `check-encrypted`: ok — 0 plików w katalogu aplikacji, 0 linii logcat, 0 plików w pamięci zewnętrznej |

Rozstrzygnięte 2026-11-13: sterownik Maestro (tag `Maestro`) wypisuje w logcat teksty pomijanych widoków, w tym wpisane zapytanie — trzeci przebieg dał 3 takie linie, wszystkie z procesu Maestro, żadnej z aplikacji. Kontrola `judgeLogcat` pomija od tej pory wyłącznie linie sterownika (commit d93bec4d, test `EVM-103 AC6`); każdy inny proces (aplikacja, klawiatura, system) zostaje w zakresie. Przebieg końcowy (czwarty): 45/45 przepływów zielonych (jeden ponowiony: `09-durability-reboot`, niezwiązany z EVM-103), wynik `check-encrypted` jak w tabeli. Dwie wcześniejsze poprawki scenariusza (bez zmian w aplikacji): potwierdzenie banera bezpieczeństwa EVM-100 („Rozumiem”, obraz emulatora starszy niż 12 miesięcy), schowanie klawiatury i przewinięcie do „Wymaga połączenia” (stan pusty ciągnie się pod zgięciem ekranu).

„Nie zachowuj aktywności” (opcja programisty): proces zabijany w scenariuszu (`kill -9`) jest warunkiem ostrzejszym niż zniszczenie aktywności; stan pola to wyłącznie `useState` ekranu, bez `onSaveInstanceState` i bez parametrów nawigacji. Ręczna kontrola (opcjonalnie, Konrad): włącz opcję, wpisz zapytanie, przejdź na ekran główny, wróć — pole jest puste.

## AC7 — pomiar ręczny na referencyjnym średnim Androidzie (kompilacja wydania)
Do wykonania przez Konrada / QA (emulator nie jest referencją). Procedura: syntetyczne 300 zleceń w zakresie, wpisanie ok. 20 znaków, czas od zmiany tekstu do odświeżenia listy; próg p95 ≤ 300 ms.

| Urządzenie | Kompilacja | p50 | p95 | Wynik |
|---|---|---|---|---|
| _do uzupełnienia_ | _wydanie_ | | | |
