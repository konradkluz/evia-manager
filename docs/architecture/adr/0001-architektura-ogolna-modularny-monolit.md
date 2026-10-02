# ADR-0001: Architektura ogólna — modularny monolit z centralną autoryzacją i audytem

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-002, EVM-005; ADR-0002, ADR-0003, ADR-0004, ADR-0008, ADR-0010, ADR-0011

## Kontekst i problem
Budujemy jeden system dla dwóch klientów (panel web w biurze, aplikacja mobilna offline w terenie) ze wspólnym API. Wymagania: elastyczny model zleceń (kompozycja z klocków, `docs/product/domain.md`), archiwum mediów (TB, lata), ASVS L2 / MASVS, RODO, budżet ok. 300 zł/mies., jeden człowiek akceptujący zmiany, zespół agentów AI jako wykonawcy. Skala: dziesiątki użytkowników, tysiące zleceń. Trzeba zdecydować o kształcie systemu (liczba jednostek wdrożeniowych, granice modułów, kierunek zależności) i o tym, gdzie leżą mechanizmy przekrojowe: autoryzacja i audyt.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Prostota i narzut operacyjny | 5 | jedna osoba po stronie firmy, agenci AI; każdy dodatkowy element to koszt utrzymania |
| Testowalność | 5 | TDD, progi pokrycia, testy integracyjne z prawdziwą bazą |
| Bezpieczeństwo (jedna warstwa autoryzacji, audyt, mała powierzchnia ataku) | 5 | ASVS V8, V16; deny-by-default w każdym żądaniu |
| Granice modułów i ewolucja (inwestycje, DC, integracje) | 4 | wzrost zakresu bez przepisywania |
| Koszt infrastruktury | 4 | budżet ~300 zł/mies. |
| Gotowość na offline i integracje | 3 | kursory zmian, zdarzenia domenowe, kolejka zadań |

Skala ocen 1–5 (5 = najlepiej); suma ważona = Σ (waga × ocena).

## Rozważane opcje
1. **A. Modularny monolit** — jedna baza kodu backendu, dwa procesy z tego samego obrazu (API i worker), moduły domenowe z jawnym publicznym API, zdarzenia w procesie + trwała kolejka zadań w PostgreSQL.
2. **B. Mikroserwisy** — osobne usługi (zlecenia, media, auth, sync) z osobnymi bazami i komunikacją sieciową.
3. **C. Backend-as-a-Service** (np. Supabase/Firebase) + funkcje serverless — logika w politykach bazy (RLS) i funkcjach.
4. **D. Klasyczny monolit warstwowy** bez granic modułów (kontrolery → serwisy → repozytoria dla całej domeny).

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Prostota i narzut operacyjny (5) | 5 | 1 | 4 | 5 |
| Testowalność (5) | 5 | 3 | 3 | 4 |
| Bezpieczeństwo (5) | 5 | 3 | 3 | 4 |
| Granice modułów i ewolucja (4) | 4 | 5 | 2 | 1 |
| Koszt infrastruktury (4) | 5 | 1 | 4 | 5 |
| Gotowość na offline i integracje (3) | 4 | 4 | 3 | 3 |
| **Suma ważona (maks. 130)** | **123** | **71** | **83** | **98** |

Uzasadnienie ocen: B mnoży wdrożenia, bazy, sieć i autoryzację między usługami — bez zysku przy tej skali. C przenosi logikę i autoryzację do polityk bazy i funkcji dostawcy (trudniejsze testy, lock-in, hosting poza kontrolą — Supabase Cloud to podmiot z USA). D jest prosty na start, ale szybko splata moduły (zlecenia, media, płatności), co utrudni M3–M7. Informacje o technologiach zweryfikowane 2026-10-02 (źródła na końcu i w ADR-0002/0003/0011).

## Decyzja
Wybieramy **A — modularny monolit**:

**Jednostki wdrożeniowe (C4 L2 w `../README.md`):** `api` (HTTP), `worker` (zadania w tle, ten sam kod i obraz, inny punkt wejścia), `media-processor` (izolowana piaskownica bez sieci, ADR-0009), `clamd` (skan AV, bez sieci), PostgreSQL, reverse proxy (TLS). Panel web to statyczne pliki SPA serwowane z tej samej domeny co API. Aplikacja mobilna komunikuje się wyłącznie z API i (przez podpisane URL-e) z object storage.

**Moduły domenowe (wstępnie; doprecyzowanie w EVM-002):** `identity` (użytkownicy, role, sesje, urządzenia, MFA), `authorization` (silnik polityk), `audit`, `customers`, `sites`, `catalog` (katalog usług, szablony), `work-orders` (zlecenie, pozycje zakresu, status), `procedures` (procesy i etapy), `payments` (etapy płatności), `timeline` (dziennik, wpisy, komentarze), `media` (media, dokumenty, sesje uploadu), `sync` (kanał zmian, przyjmowanie mutacji z urządzeń), `platform` (jądro współdzielone: identyfikatory, czas, pieniądze, błędy, zdarzenia, dostęp do bazy, konfiguracja). Później: `notifications` (M3), `reporting` (M4), `integrations` (M5), `investments` (M6).

**Reguły zależności (egzekwowane automatycznie w CI — `dependency-cruiser`, ADR-0012):**
1. Każdy moduł ma warstwy `api` → `application` → `domain` ← `infrastructure`; `domain` nie zależy od frameworka ani bazy.
2. Moduł korzysta z innego modułu wyłącznie przez jego publiczne API (fasada + typy + zdarzenia) — nigdy przez jego tabele, repozytoria czy klasy wewnętrzne. Brak cykli.
3. Komunikacja asynchroniczna: zdarzenia domenowe zapisywane w tej samej transakcji co zmiana (wzorzec outbox na kolejce pg-boss, ADR-0010).
4. Kierunek: `sync`, `audit`, `timeline` zależą od modułów domenowych (subskrybują ich zdarzenia / fasady), nigdy odwrotnie. Wszystko może zależeć od `platform`; `platform` od nikogo.
5. Każda tabela ma właściciela-moduł (prefiks lub schemat PostgreSQL per moduł — decyzja w EVM-002).

**Bezpieczeństwo jako element architektury (wymagania security-engineer, ASVS V8.1–V8.3, V16):**
- **Jedna, centralna warstwa autoryzacji** w module `authorization`: globalny guard HTTP działa w **każdym** żądaniu i jest **deny-by-default** — endpoint bez zadeklarowanej polityki jest odrzucany (403), a test startowy wykrywa takie trasy i kończy build błędem. Model: RBAC (Administrator / Edytor / Tylko odczyt; później Monter, partnerzy) + **polityki na poziomie obiektu** (np. „Monter widzi tylko przypisane zlecenia”) rejestrowane przez moduły w centralnym silniku i wywoływane w przypadkach użycia przed odczytem/zmianą obiektu oraz jako filtr zapytań list i kanału synchronizacji (ADR-0008). Polityki są danymi testowymi macierzy ról generowanej z kontraktu (ADR-0004, ADR-0014).
- **Moduł `audit`** z dziennikiem **tylko do dopisywania** (kto, co, kiedy, skąd, wynik) w osobnej tabeli, oddzielony od logów operacyjnych: rola aplikacyjna bazy ma na nim wyłącznie `INSERT`/`SELECT` (ADR-0003), a logi operacyjne (ADR-0013) nie są źródłem audytu. Audytujemy: logowania i nieudane próby, zmiany ról i użytkowników, unieważnienia sesji/urządzeń, usunięcia, eksporty i masowe pobrania, zmiany konfiguracji.
- **Granice zaufania** (Internet ↔ reverse proxy ↔ sieć wewnętrzna kontenerów ↔ piaskownica przetwarzania mediów; urządzenie mobilne; dostawcy zewnętrzni) są zaznaczone na C4 L2 w `../README.md` — to wejście do STRIDE w EVM-005.

## Konsekwencje
- **Pozytywne:** jedno wdrożenie, jedna baza, transakcje ACID między modułami, proste testy integracyjne; autoryzacja i audyt w jednym miejscu; niski koszt (1 VM, ADR-0011); granice modułów pozwalają w przyszłości wydzielić usługę (np. przetwarzanie mediów już teraz jest osobnym kontenerem).
- **Negatywne / koszty:** dyscyplina granic wymaga narzędzi (dependency-cruiser) i przeglądu; skalowanie tylko pionowe + replikacja procesów `api`/`worker` (wystarczające dla dziesiątek użytkowników).
- **Ryzyka i mitygacje:**
  - *Erozja granic modułów przez agentów* → reguły dependency-cruiser w CI (blokujące), szablon modułu, przegląd architekta przy zmianach granic.
  - *Pojedynczy punkt awarii (1 VM)* → RTO ≤ 8 h przez odtworzenie z IaC i backupów (ADR-0011), test odtworzenia; dostępność docelowa 99,5%.
  - *Pominięcie autoryzacji na nowym endpoincie* → deny-by-default + test „każda trasa ma politykę” + generowana macierz ról dla 100% operacji kontraktu.

## Plan wyjścia
Moduły z własnymi tabelami i publicznym API można wydzielić do osobnej usługi (najpierw `media`, potem `sync`) bez przepisywania domeny: zdarzenia z outboxu stają się wiadomościami między usługami. Koszt: dni–tygodnie na moduł, głównie infrastruktura i autoryzacja usługa-usługa. Decyzja odwracalna stopniowo.

## Weryfikacja
- CI: zero naruszeń reguł zależności; test „każda trasa ma politykę” zielony; macierz ról pokrywa 100% operacji.
- Przegląd po M2 (MVP Teren): czy któryś moduł wymaga osobnego skalowania (miernik: CPU/RAM workera vs API, czas kolejki mediów).

## Źródła (zweryfikowane 2026-10-02)
- OWASP ASVS 5.0 (V8 Authorization, V16 Security Logging): https://owasp.org/www-project-application-security-verification-standard/
- dependency-cruiser 18.5.0 (MIT, wydanie 2026-09-30): https://www.npmjs.com/package/dependency-cruiser
- pg-boss 12.35.1 (MIT, 2026-09-30): https://github.com/timgit/pg-boss/releases
- Supabase / BaaS — porównanie: hosting i podmiot w USA (rozważane jako opcja C): https://supabase.com/
