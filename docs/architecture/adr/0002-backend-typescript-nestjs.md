# ADR-0002: Backend — TypeScript na Node.js LTS z frameworkiem NestJS

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-006, EVM-008; ADR-0001, ADR-0003, ADR-0004, ADR-0007, ADR-0014

## Kontekst i problem
Potrzebujemy języka i frameworka dla modularnego monolitu (ADR-0001): API REST z kontraktem OpenAPI (ADR-0004), worker zadań w tle (ADR-0010), centralna autoryzacja i audyt, TDD z wysokimi progami pokrycia. Kod piszą głównie agenci AI, więc liczy się silne typowanie, przewidywalna struktura i dojrzałe narzędzia testowe. Panel web (ADR-0006) i aplikacja mobilna (ADR-0007) powstają w TypeScript — wspólny język pozwala współdzielić typy kontraktu, walidację i logikę synchronizacji.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Jeden język end-to-end (współdzielone typy z web i mobile) | 5 | mniej przełączania kontekstu, wspólne pakiety kontraktu i logiki sync |
| Ekosystem testowy (unit, integracja z kontenerami, mutacyjne) | 5 | TDD i progi z `testing-strategy.md` |
| LTS i aktywne poprawki bezpieczeństwa runtime'u i frameworka | 5 | ASVS V15; aktualizacje bez dużych migracji |
| Walidacja schematem na granicy (ASVS V2/V4) | 4 | dane wejściowe walidowane względem kontraktu |
| Zapytania parametryzowane / dojrzały dostęp do danych (ASVS V1) | 4 | ochrona przed wstrzyknięciami |
| Struktura modułów i produktywność agentów AI | 4 | DI, moduły, konwencje — mniej „wymyślania” architektury |
| Licencja i łańcuch dostaw (ASVS V15) | 3 | licencje permisywne, aktywne utrzymanie |
| Zużycie zasobów na małej VM | 3 | API + worker + baza + ClamAV na jednej maszynie |

## Rozważane opcje
1. **A. TypeScript + Node.js 26 LTS + NestJS 12** (platforma Express 5) — framework z modułami, DI, guardami, interceptorami; walidacja przez Standard Schema (Zod).
2. **B. TypeScript + Node.js + Fastify 5** — lekki framework HTTP z natywną walidacją JSON Schema; strukturę modułów budujemy sami.
3. **C. C# + .NET 10 LTS + ASP.NET Core** — dojrzała platforma, EF Core; drugi język obok TS (web, mobile).
4. **D. Kotlin + Spring Boot 4.1** — dojrzały ekosystem JVM; drugi język, większe zużycie pamięci.

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Jeden język end-to-end (5) | 5 | 5 | 2 | 2 |
| Ekosystem testowy (5) | 5 | 5 | 5 | 5 |
| LTS i poprawki bezpieczeństwa (5) | 4 | 4 | 5 | 3 |
| Walidacja schematem na granicy (4) | 5 | 5 | 4 | 4 |
| Zapytania parametryzowane / dostęp do danych (4) | 4 | 4 | 5 | 5 |
| Struktura modułów i produktywność agentów (4) | 5 | 3 | 4 | 4 |
| Licencja i łańcuch dostaw (3) | 5 | 5 | 5 | 5 |
| Zużycie zasobów (3) | 4 | 5 | 4 | 2 |
| **Suma ważona (maks. 165)** | **153** | **148** | **139** | **123** |

Uwagi do ocen: A i B dzielą runtime; A wygrywa gotową strukturą (moduły, DI, guardy jako naturalne miejsce centralnej autoryzacji, interceptory dla audytu), co ogranicza dowolność agentów. C ma najdłuższe LTS (do 2028-11-14), ale wymusza drugi język i generowanie typów dla TS. D: wsparcie OSS Spring Boot 4.1 tylko do 2027-07-31, JVM zużywa więcej RAM. Ekosystem npm niesie ryzyko łańcucha dostaw (V15) — mitygacja w ADR-0012 (lockfile, SCA, Renovate, przypięte wersje). Wersje, licencje i stan utrzymania zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
Wybieramy **A**:
- **Runtime:** Node.js **26** (LTS od 2026-10-28, EOL 2029-04-30). Jeśli w EVM-006 kluczowa zależność nie wspiera 26 — Node.js 24 LTS (EOL 2028-04-30) i podniesienie w M1. Wersja przypięta w `.nvmrc`/`engines` i obrazie kontenera.
- **Framework:** NestJS **12.x** (MIT; ESM, natywna walidacja Standard Schema w dekoratorach tras), platforma Express 5.
- **Język:** TypeScript w trybie `strict` (wersja kompilatora — ADR-0012).
- **Walidacja na granicy:** schematy Zod **generowane z kontraktu OpenAPI** (ADR-0004) — żadnych ręcznie pisanych DTO rozjeżdżających się z kontraktem; nadmiarowe pola odrzucane (`strict`), limity długości/zakresów z kontraktu.
- **Dostęp do danych:** Kysely — tylko zapytania parametryzowane; surowe SQL wyłącznie przez tagowany szablon `sql` z parametrami (ADR-0003); reguła lint zabrania konkatenacji SQL.
- **Logowanie:** pino z redakcją (ADR-0013). **Konfiguracja:** zmienne środowiskowe walidowane schematem przy starcie (12-factor), sekrety spoza repo.
- **Jeden obraz kontenera, dwa punkty wejścia:** `api` i `worker`.

## Konsekwencje
- **Pozytywne:** wspólne pakiety TS z web i mobile (kontrakt, typy, logika synchronizacji); guard/interceptor jako jedno miejsce autoryzacji i audytu; bogaty ekosystem testów (Vitest, Testcontainers, Stryker — ADR-0014); niski narzut pamięci.
- **Negatywne / koszty:** NestJS dodaje warstwę abstrakcji (dekoratory, DI); duże aktualizacje majorów co ~1,5 roku (12.0 wydany 2026-08-27); Node.js jest jednowątkowy — ciężkie przetwarzanie mediów i tak trafia do osobnego kontenera (ADR-0009).
- **Ryzyka i mitygacje:**
  - *Atak na łańcuch dostaw npm* → lockfile, `pnpm` z blokadą skryptów instalacyjnych poza listą dozwolonych, SCA i Renovate z opóźnieniem nowych wersji (ADR-0012).
  - *NestJS 12 świeży (sierpień 2026)* → pinujemy minor, Renovate grupuje aktualizacje; w razie problemów NestJS 11 (wciąż utrzymywany) jako krok wstecz.
  - *Rozjazd kontraktu i kodu* → generowane typy/schematy + testy kontraktowe (ADR-0004, ADR-0014).

## Plan wyjścia
Domena (`domain`, `application`) nie zależy od NestJS (ADR-0001), więc zmiana frameworka HTTP (np. na Fastify bez Nest) dotyczy warstwy `api` i konfiguracji DI — szacunkowo 1–2 tygodnie. Zmiana języka (np. .NET) = przepisanie backendu; kontrakt OpenAPI i baza pozostają, klienci web/mobile bez zmian.

## Weryfikacja
- EVM-008: szkielet API przechodzi bramki (lint, typy, testy, pokrycie) i działa na staging.
- Po M1: czas p95 endpointów list < 300 ms po stronie serwera; brak incydentów z zależnościami bez łatki > 14 dni.

## Źródła (zweryfikowane 2026-10-02)
- Node.js — harmonogram wydań (Node 26 LTS od 2026-10-28; Node 24 EOL 2028-04-30): https://nodejs.org/en/about/previous-releases , https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule ; licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/nodejs/node/blob/main/LICENSE
- Express 5 (platforma NestJS) — licencja **MIT** (zweryfikowane 2026-10-02): https://github.com/expressjs/express/blob/master/LICENSE
- NestJS 12 (wydanie 2026-08-27; `@nestjs/core` 12.1.2, MIT, 2026-09-30): https://www.npmjs.com/package/@nestjs/core , https://trilon.io/blog/nestjs-12-is-coming
- Fastify 5.12.5 (MIT, 2026-09-16): https://www.npmjs.com/package/fastify
- .NET 10 LTS (wsparcie do 2028-11-14): https://devblogs.microsoft.com/dotnet/announcing-dotnet-10/
- Spring Boot 4.0/4.1 (OSS 4.1 do 2027-07-31): https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now , https://endoflife.date/spring-boot
- Zod 4.6.5 (MIT), Kysely 0.29.6 (MIT), pino 10.4.0 (MIT) — rejestr npm: https://www.npmjs.com/package/zod , https://www.npmjs.com/package/kysely , https://www.npmjs.com/package/pino
