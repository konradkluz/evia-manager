# Wspólne wektory zgodności protokołu wysyłania plików (EVM-109 AC4)

Wektory JSON czytają **dwie** implementacje: model referencyjny w TypeScript (`packages/sync-core/src/upload`, test `test/upload-vectors.test.ts`) i silnik w Kotlinie (`apps/mobile/modules/evia-upload/engine`, test `VectorsTest`). Wynik musi być identyczny; rozjazd dowolnego wektora to czerwony test po którejkolwiek stronie. Dane wyłącznie syntetyczne (hosty `*.test`).

| Plik            | Co opisuje                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.json`    | lista plików z wektorami; plik poza listą albo wymieniony, a nieistniejący, to czerwony test po obu stronach                                                                         |
| `planning.json` | zakresy bajtów części (serwer decyduje o `partSize` i `partCount`, klient liczy i sprawdza: `partCount = ceil(rozmiar / partSize)`, `1 ≤ partCount ≤ 1000`, inaczej `plan_mismatch`) |
| `backoff.json`  | stałe limitów silnika i opóźnienia pełnego jitteru (`floor(rng * (sufit + 1))`, `rng` w wektorze)                                                                                    |
| `mapping.json`  | odpowiedź HTTP (status i `code`), stan pliku po `complete` i błąd sieci → wynik silnika                                                                                              |
| `declaration.json` | deklaracja pliku w sesji (EVM-131): lista typów kontraktu z aliasami, nazwa `<assetId>.<rozszerzenie>` (nigdy nazwa od użytkownika), kiedy serwer przyjmie deklarację (typ, rozszerzenie, 1 B – 4 GiB, SHA-256 małymi literami); `resume.json` sprawdza po obu stronach, że każde `createSession` niesie TĘ SAMĄ ważną deklarację |
| `urlcheck.json` | zaufanie do adresu części (https, bez `userinfo`, host z listy, port)                                                                                                                |
| `resume.json`   | scenariusze pętli wznawiania na deterministycznym fałszywym serwerze (format w polu `$comment` pliku)                                                                                |

## Jak dodać wektor

1. Dopisz przypadek do właściwego pliku (nowy plik — także do `index.json`). W `resume.json` podaj: `initialStore`, `server`, `faults`, `runs` (`crashAt` zabija proces w n-tym punkcie kontrolnym, kolejny przebieg używa nowej instancji silnika) i `final`.
2. Oczekiwane wartości wyprowadź z protokołu (`media-pipeline.md`, kontrakt `paths/media.yaml`), nie z wyniku programu.
3. Uruchom oba testy: `pnpm --filter @evia/sync-core run test` i `pnpm run gate:kotlin`. Zmiana wektora unieważnia cache Turborepo (`packages/sync-core/turbo.json`, `inputs`) i zadanie `test` w Gradle (`inputs.dir`); w CI zmiana w `packages/sync-core/` uruchamia job `mobile-apk` z testami Kotlin.
4. Fałszywe tokeny i podpisy nie mogą przypominać prawdziwych kluczy (gitleaks), a hosty muszą być syntetyczne.
