---
id: EVM-001
title: Architektura i stack technologiczny (ADR)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P0
owner: solution-architect
contributors: []
reviewers: [security-engineer, devops-engineer, mobile-developer]
depends_on: []
---

# EVM-001: Architektura i stack technologiczny (ADR)

## Historyjka
Jako **właściciel produktu** chcę **świadomie wybranej i uzasadnionej architektury oraz stacku technologicznego**, aby **zespół agentów budował system szybko, bezpiecznie i tanio w utrzymaniu**.

## Kontekst
Wybór technologii należy do architekta (decyzja Konrada). Wejścia: wymagania niefunkcjonalne (`docs/product/vision.md`), model kompozycji zleceń (`docs/product/domain.md`), czynniki architektoniczne (`docs/architecture/README.md`), baseline bezpieczeństwa (`docs/security/README.md`). Po akceptacji orkiestrator zmienia statusy ADR na „Zaakceptowana”.

## Kryteria akceptacji
**AC1 — Zakres decyzji**
- Zakładając wymagania z dokumentów wejściowych
- Gdy architekt kończy pracę
- Wtedy w `docs/architecture/adr/` istnieją ADR-y (status „Proponowana”) co najmniej dla: architektury ogólnej, backendu, bazy danych i migracji, stylu i kontraktu API, uwierzytelniania i MFA, panelu web, aplikacji mobilnej, synchronizacji offline, storage'u i przetwarzania mediów, hostingu i środowisk w UE, CI/CD i narzędzi jakości, narzędzi testowych każdej warstwy.

**AC2 — Rzetelność**
- Zakładając dowolny ADR z AC1
- Gdy go czytam
- Wtedy zawiera kryteria z wagami, co najmniej 2 realne opcje, tabelę oceny, konsekwencje, ryzyka i plan wyjścia, a wersje, licencje i stan utrzymania są zweryfikowane w sieci (data i źródła).

**AC3 — Mobile i offline**
- Zakładając wymagania pracy bez zasięgu
- Gdy czytam ADR mobile i offline
- Wtedy widzę, jak wybrane podejście realizuje na iOS i Android: upload w tle dużych plików, aparat i wideo, lokalną bazę, bezpieczny magazyn tokenów — oraz listę ryzyk do sprawdzenia w spike'u EVM-011.

**AC4 — Koszty**
- Gdy czytam przegląd architektury
- Wtedy znajduję szacunek miesięcznych kosztów infrastruktury dla MVP (ok. 10 użytkowników, 500 GB mediów) i po 2 latach (ok. 30 użytkowników, 3 TB), z założeniami.

**AC5 — Przegląd architektury**
- Gdy otwieram `docs/architecture/README.md`
- Wtedy zawiera diagramy C4 poziomu 1 i 2 (Mermaid), mapę modułów domenowych i listę NFR z docelowymi wartościami.

**AC6 — Podsumowanie dla decydenta**
- Gdy Konrad ma podjąć decyzję
- Wtedy na początku `docs/architecture/README.md` jest jednostronicowe podsumowanie: rekomendowany stack, uzasadnienie, koszty, główne ryzyka i pytania do decyzji (z rekomendacjami).

## Poza zakresem
Implementacja i konfiguracja repozytorium (EVM-006), szczegółowy model domeny (EVM-002), model zagrożeń (EVM-005).

## UX / UI
Nie dotyczy (ADR panelu web uwzględnia możliwość wdrożenia design tokens z EVM-003).

## Bezpieczeństwo i prywatność
Dotyczy: mechanizmy uwierzytelniania, hosting w UE, przechowywanie mediów. Recenzja: `security-engineer`.

## Notatki techniczne
- Środowisko developerskie Konrada: **Windows 11**. Buildy i testy iOS wymagają macOS — ADR mobile i CI/CD muszą wskazać rozwiązanie (np. chmurowe buildy, runner macOS w CI).
- Dane potrzebne od Konrada (zadaj pytania z rekomendacjami): flota telefonów (iOS / Android, firmowe czy prywatne), budżet miesięczny, preferencje hostingu, domena, konto repozytorium.

## Plan techniczny
Historyjka dokumentacyjna (enabler): brak kodu, kontraktu API, migracji i testów automatycznych. Weryfikacja AC przez inspekcję (QA + recenzenci).

**Zakres zmian (pliki)**
- `docs/architecture/adr/0001` … `0014` — nowe ADR-y wg szablonu `0000-template.md`, status „Proponowana”, data 2026-10-02:
  | ADR | Obszar | Pokrywa AC1 |
  |---|---|---|
  | 0001 | Architektura ogólna (modularny monolit, granice modułów, kierunek zależności) | architektura ogólna |
  | 0002 | Backend — język i framework | backend |
  | 0003 | Baza danych i migracje (expand → migrate → contract, wyszukiwanie z polskimi znakami / collation) | baza i migracje |
  | 0004 | Styl i kontrakt API (contract-first, generowanie typów/klientów, wersjonowanie, minimalna wersja aplikacji) | API |
  | 0005 | Uwierzytelnianie i MFA (własne vs zarządzany IdP, passkeys, klient mobilny, sesje/tokeny) | auth i MFA |
  | 0006 | Panel web (framework, biblioteka komponentów zgodna z design tokens z EVM-003) | web |
  | 0007 | Aplikacja mobilna (cross-platform vs natywnie; iOS + Android; upload w tle, aparat/wideo, lokalna baza, bezpieczny magazyn; buildy iOS bez Maca) | mobile |
  | 0008 | Synchronizacja offline (UUIDv7, kolejka, idempotencja, kursory zmian, soft delete, polityka konfliktów) | offline |
  | 0009 | Storage i przetwarzanie mediów (S3-kompatybilny w UE, uploady wznawialne, miniatury, transkodowanie, skan AV, klasy storage/retencja) | media |
  | 0010 | Zadania w tle (kolejka zadań) | (dodatkowy, wymagany przez media/sync) |
  | 0011 | Hosting i środowiska w UE (dev/staging/prod, RODO/DPA, backupy) + koszty | hosting |
  | 0012 | CI/CD, monorepo i narzędzia jakości (bramki, lint/typy/pokrycie, chmurowe buildy iOS/Android) | CI/CD |
  | 0013 | Obserwowalność (logi bez PII, metryki, błędy, alerty) | (dodatkowy) |
  | 0014 | Narzędzia testowe każdej warstwy (unit/integracja/kontrakt/komponenty/E2E web/E2E mobile) — uzgodnione z zasadami `docs/process/testing-strategy.md` | testy |
- Każdy ADR: kryteria z wagami (1–5), ≥2 realne opcje (zwykle 3), tabela oceny z sumą ważoną, decyzja, konsekwencje, ryzyka i mitygacje, plan wyjścia, weryfikacja oraz linia „zweryfikowane 2026-10-02” z listą źródeł (URL) — wersje, LTS, licencje, aktywność utrzymania, ceny.
- `docs/architecture/README.md` — przebudowa: (1) na początku jednostronicowe podsumowanie dla decydenta (stack, uzasadnienie, koszty vs budżet 300 zł, główne ryzyka, pytania z rekomendacjami); (2) czynniki architektoniczne (zachowane); (3) C4 L1 (kontekst) i L2 (kontenery) w Mermaid; (4) mapa modułów domenowych z kierunkiem zależności (wstępna, doprecyzowana w EVM-002); (5) NFR z wartościami docelowymi (dostępność, RPO/RTO, czasy odpowiedzi, limity plików/wideo, retencja, offline — czas pracy bez sieci, bezpieczeństwo); (6) szacunek kosztów: MVP (10 użytk., 500 GB) i po 2 latach (30 użytk., 3 TB) — tabela pozycji (compute, baza, storage, transfer, backupy, buildy mobilne, konta deweloperskie Apple/Google), założenia, kurs EUR/USD→PLN z datą, wskazanie co mieści się w 300 zł/mies., a co nie; (7) indeks planowanych dokumentów (bez zmian zakresu EVM-002).
- `docs/architecture/adr/README.md` — indeks ADR 0001–0014 (status Proponowana).
- ADR 0007 i 0008 zawierają sekcję „Ryzyka do sprawdzenia w spike'u EVM-011” (lista weryfikowalnych hipotez: upload w tle >1 GB na iOS/Android przy zabitej aplikacji, wznawianie po utracie sieci, zapis wideo do lokalnego storage, rozmiar lokalnej bazy, bezpieczny magazyn tokenów, zachowanie przy niskim miejscu na dysku).
- `CLAUDE.md` „Stack i komendy” — **nie** w tym kroku; dopiero po akceptacji Konrada (DoD), komendy uzupełnia EVM-006.
- Nie tworzymy `domain-model.md`, `api-guidelines.md`, `offline-sync.md`, `media-pipeline.md` (EVM-002 / EVM-011) — ADR-y zawierają decyzje, dokumenty szczegółowe powstaną później.

**Kontrakt API / migracje:** nie dotyczy.

**Plan weryfikacji AC (inspekcja)**
| AC | Jak sprawdzić |
|---|---|
| AC1 | Lista plików w `adr/` i indeks: każdy z 12 obszarów AC1 ma ADR o statusie „Proponowana” (mapowanie w tabeli wyżej). |
| AC2 | Checklista na każdy ADR: tabela kryteriów z wagami; ≥2 opcje; tabela ocen z sumą; sekcje Konsekwencje / Ryzyka / Plan wyjścia; linia weryfikacji z datą 2026-10-02 i ≥1 URL źródła na kluczową technologię (wersja, licencja, utrzymanie). |
| AC3 | ADR 0007/0008: dla każdej z 4 zdolności (upload w tle dużych plików, aparat i wideo, lokalna baza, bezpieczny magazyn tokenów) opis realizacji osobno dla iOS i Android (biblioteka/API systemowe); obecna lista ryzyk dla EVM-011. |
| AC4 | README: dwie tabele kosztów (MVP, 2 lata) z założeniami i źródłami cen; jawne porównanie MVP z budżetem 300 zł/mies. |
| AC5 | README: bloki Mermaid C4 L1 i L2 renderują się (podgląd Mermaid); mapa modułów; tabela NFR z wartościami liczbowymi. |
| AC6 | README zaczyna się podsumowaniem ≤ ~1 strona: stack, uzasadnienie, koszty, top ryzyka, pytania z rekomendacjami. |
| Spójność | Brak sprzeczności między ADR-ami (np. hosting ↔ storage ↔ CI); linki względne działają. |

**Kolejność kroków**
1. Research w sieci (wersje, LTS, licencje, ceny UE, możliwości uploadu w tle na iOS/Android) — notatki ze źródłami.
2. ADR 0001 (architektura) → 0011 (hosting, ograniczenie kosztowe) → 0002, 0003, 0004 → 0005 → 0007, 0008, 0009, 0010 → 0006 → 0012, 0013, 0014 (testy uzgodnione z testing-strategy; konsultacja z qa-engineer w przeglądzie).
3. README architektury: C4, moduły, NFR, koszty, na końcu podsumowanie dla decydenta.
4. Indeks ADR; samosprawdzenie wg checklisty AC.
5. Przeglądy: security-engineer (0005, 0009, 0011), devops-engineer (0011, 0012, 0013), mobile-developer (0007, 0008, 0009).

**Ustalenia z konsultacji**
- **security-engineer (2026-10-02) — APPROVE planu** pod warunkiem, że ADR-y zawierają poniższe treści (brak = ustalenie klasy major w przeglądzie). Odniesienia: ASVS 5.0 L2, MASVS v2. Zagrożenia istotne dla stacku (wejście do EVM-005): przejęcie konta/sesji; były pracownik z aktywną sesją lub kolejką offline; kradzież telefonu z danymi offline; złośliwy plik / exploit w ffmpeg/libvips; IDOR na zleceniach i mediach; wyciek podpisanego URL-a; publiczny bucket; masowe pobranie archiwum przez insidera; replay kolejki offline; podatna zależność lub skompromitowany CI (klucze podpisu); transfer danych poza EOG przez podprocesorów; presja budżetu prowadząca do rezygnacji z backupu poza głównym miejscem lub ze skanu AV.
  - **0001:** jedna centralna warstwa autoryzacji (deny-by-default, RBAC + polityki obiektowe, w każdym żądaniu; V8.1–V8.3); moduł audytu append-only oddzielony od logów operacyjnych (V16); granice zaufania na C4 L2.
  - **0002:** kryteria bezpieczeństwa z wagą: walidacja schematem na granicy (V2/V4), zapytania parametryzowane / ORM (V1), LTS i poprawki bezpieczeństwa, licencja / łańcuch dostaw (V15).
  - **0003:** szyfrowanie w spoczynku, PITR, RPO/RTO; baza niedostępna publicznie; osobne role DB (migracyjna, aplikacyjna z minimalnymi uprawnieniami; brak UPDATE/DELETE na tabeli audytu; V13, V14); możliwość szyfrowania pól (V11, V14).
  - **0004:** kontrakt jako źródło generowania testów macierzy ról dla 100% endpointów; jednolity format błędów bez wycieku szczegółów (V16); limity paginacji i rozmiaru żądań, rate limiting, restrykcyjny CORS (V4, V3); klucze idempotencji powiązane z użytkownikiem i urządzeniem; wymuszanie minimalnej wersji aplikacji.
  - **0005 (przegląd security):** Argon2id lub równoważne, NIST 800-63B, blokada haseł z wycieków (zewnętrzne API tylko k-anonimowość) (V6); MFA obowiązkowe dla Administratora (TOTP i/lub passkeys); limity i opóźnienia brute force, bezpieczny reset; web: ciasteczka HttpOnly/Secure/SameSite + CSRF (V3, V7); mobile: access token ≤ 15 min, rotowany refresh z wykrywaniem ponownego użycia, Keychain/Keystore (MASVS-STORAGE-1, MASVS-AUTH-1/2); zdalne unieważnianie sesji i urządzeń skuteczne także dla tokenów self-contained (V7, V9); maks. czas pracy offline bez ponownego uwierzytelnienia jako NFR; przy zarządzanym IdP: region UE, DPA (art. 28), koszt MFA, plan wyjścia (migracja hashy).
  - **0007:** szyfrowana lokalna baza (SQLCipher lub równoważna), klucz w Keychain/Keystore; zdjęcia i wideo tylko w sandboxie, poza galerią i kopiami iCloud/Google; brak danych osobowych w logach i crash reportach; walidacja deep linków; TLS bez wyjątków ATS/cleartext; unieważnienie sesji → wyczyszczenie danych lokalnych przy następnym kontakcie. Do ryzyk spike'u EVM-011: (a) wydajność szyfrowanej bazy, (b) wygaśnięcie autoryzacji przy wielogodzinnym uploadzie w tle (odnawianie podpisanych URL-i / części multipart bez długożyjących tokenów), (c) czyszczenie danych po unieważnieniu sesji przy niewysłanej kolejce, (d) wykluczenie plików z backupu urządzenia.
  - **0008:** autoryzacja każdej mutacji z kolejki w momencie synchronizacji (odrzucony replay odwołanego użytkownika/urządzenia); idempotencja z kluczem powiązanym z użytkownikiem i urządzeniem; kursory zmian filtrowane uprawnieniami, utrata dostępu → usunięcie z urządzenia; UUIDv7 nie zastępuje kontroli dostępu (CWE-639); czas klienta nie jest źródłem prawdy dla audytu.
  - **0009 (przegląd security):** prywatny bucket z blokadą publicznego dostępu, SSE, dostawca w UE z DPA; podpisane URL-e po autoryzacji obiektu, pobieranie ≤ 5 min, upload ograniczony do klucza/rozmiaru/typu nadanych przez serwer, klucze obiektów generowane przez serwer (V5, CWE-434); typ po zawartości (magic bytes), limity rozmiaru i długości wideo; skan AV z kwarantanną; przetwarzanie w izolowanym workerze z limitami i bez sieci (CWE-400); możliwość usuwania EXIF/GPS (polityka w EVM-005); dokumenty z `Content-Disposition: attachment`, najlepiej z osobnej domeny / bucketu; wersjonowanie lub object lock; lifecycle i retencja; audyt i rate limit masowych pobrań; jawnie wyceniony backup mediów poza głównym miejscem.
  - **0010:** ładunki zadań tylko z identyfikatorami, zadania idempotentne.
  - **0011 (przegląd security):** region UE/EOG, DPA i lista podprocesorów; jawnie opisane ryzyko rezydualne dostawców z USA (CLOUD Act); szyfrowanie w spoczynku; backupy automatyczne, szyfrowane, poza głównym miejscem, test odtworzenia; pełna separacja dev/staging/prod, brak danych produkcyjnych na staging; MFA na konsolach, IAM najmniejszych uprawnień, brak publicznej ekspozycji bazy, kolejki i workerów; TLS 1.2+ (pref. 1.3) i HSTS. **Twardo dla AC4:** koszty zawierają backup poza głównym miejscem, skan AV i MFA/IdP; czego nie da się zmieścić w 300 zł — jawny kompromis do decyzji Konrada.
  - **0012:** SAST, SCA (podatności i licencje), sekrety (pre-commit i CI), IaC/kontenery; akcje przypięte do SHA; Renovate/Dependabot; ochrona `main`; klucze podpisu iOS/Android tylko w sekretach CI / serwisu buildów z planem rotacji; ocena chmurowego serwisu buildów iOS (dostęp do kodu i kluczy, MFA, DPA).
  - **0013:** redakcja danych osobowych w logach, bez ciał żądań; error tracking w UE z wyłączonym session replay i scrubbingiem; alerty na anomalie uwierzytelniania i masowe pobrania; zdefiniowana retencja logów.
  - **0014:** narzędzia obsługują testy macierzy ról generowane z kontraktu; DAST (ZAP baseline) wyłącznie na staging; dane testowe tylko syntetyczne (fabryki).
  - **README:** C4 L2 z granicami zaufania i przepływami danych osobowych i mediów; lista podmiotów zewnętrznych i podprocesorów; NFR z wartościami liczbowymi (RPO/RTO, TTL sesji i tokenów, TTL podpisanych URL-i, maks. czas pracy offline, retencja logów i audytu, MFA administratora); w ryzykach dla decydenta: koszt backupu mediów (3 TB po 2 latach) i podprocesorzy spoza UE.
  - Dokumenty `threat-model.md`, `requirements.md`, `rodo.md` powstaną w EVM-005 — powyższe są ich wejściem.

## Decyzje
- 2026-10-02 — Flota telefonów: **mieszana iOS + Android** — aplikacja musi wspierać obie platformy (Konrad).
- 2026-10-02 — Budżet infrastruktury MVP: **do ok. 300 zł/mies.** (hosting, baza, storage mediów, buildy) (Konrad).
- 2026-10-02 — Hosting: **brak preferencji dostawcy** — wybór należy do architekta, warunek: region UE (Konrad).
- Domena i konto repozytorium zdalnego: do ustalenia w EVM-006 / EVM-007.
- 2026-10-02 — Demo: hosting **wariant A** (≈ 192 zł/mies.); archiwum wideo > 12 mies. w tańszej klasie — **tak**; wideo **1080p, maks. 30 min / 4 GB**; podprocesorzy USA w regionach UE (Sentry, Grafana Cloud) — **tak**; konta Apple / Google Play **firmowe** (zakłada Konrad przed EVM-009), **GitHub Pro** (potwierdzenie przy EVM-006) (Konrad).
- 2026-10-02 — Telefony: **mieszane — firmowe i prywatne (BYOD)**, iOS 17+ / Android 10+ → polityka BYOD do EVM-005 (Konrad).

## Uwagi do rozważenia
- (decyzja „telefony mieszane / BYOD” → EVM-005) model zagrożeń i wymagania muszą objąć telefony prywatne bez MDM: wymuszenie blokady ekranu po stronie aplikacji (sprawdzenie stanu urządzenia), zakres danych offline, czyszczenie danych firmowych przy unieważnieniu urządzenia, informacja RODO dla pracowników.
- (security, minor → EVM-005) Klasa Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` / Keystore bez wymogu uwierzytelnienia (kompromis na rzecz uploadu w tle): ryzyko rezydualne ekstrakcji danych z zablokowanego telefonu w stanie AFU — wpisać do `threat-model.md` (kradzież telefonu z danymi offline) z mitygacjami: obowiązkowa blokada ekranu / MDM, minimalny zakres danych offline, szybkie unieważnienie urządzenia z czyszczeniem danych, test czyszczenia w EVM-011.
- (licencje → backlog mobile, M2) SQLCipher (BSD-3-Clause) jest dystrybuowany w aplikacji — wymagany ekran licencji open source.
- (licencje) Loki (AGPL-3.0) — używany jako usługa Grafana Cloud; przy ewentualnym self-hostingu (plan wyjścia ADR-0013) nie modyfikować. Reguły Semgrep — tylko użycie wewnętrzne.
- Poprawione przez orkiestratora / architekta po QA: brakujące licencje w sekcjach Źródła ADR-0002…0014 (d9446c4); nieaktualne „GitHub Free” w założeniach kosztów README; rezerwa ~108 zł w ADR-0013.

## Definition of Done
- [x] AC1–AC6 spełnione (weryfikacja QA przez inspekcję) — qa-engineer PASS AC1–AC6 (14 ADR, 22 tabele ocen przeliczone, koszty przeliczone, linki działają); licencje uzupełnione po QA
- [x] Przeglądy: security-engineer, devops-engineer, mobile-developer — APPROVE (runda 2; runda 1: 6× major — niezmienne backupy bazy, egzekwowana ochrona `main`, klasy ochrony kluczy przy pracy w tle, strategia części uploadu per platforma — poprawione)
- [x] Indeks ADR zaktualizowany (`docs/architecture/adr/README.md`, ADR 0001–0014)
- [x] Demo i akceptacja Konrada (2026-10-02); statusy ADR 0001–0014 → „Zaakceptowana”, sekcja „Stack i komendy” w `CLAUDE.md` zaktualizowana

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-02 — ready → in-progress: start /deliver, gałąź feature/EVM-001-architektura-i-stack
- 2026-10-02 — plan techniczny (solution-architect)
- 2026-10-02 — implementacja (solution-architect): ADR 0001–0014 (status „Proponowana”), indeks ADR, przebudowa `docs/architecture/README.md` (podsumowanie dla decydenta, C4 L1/L2 z granicami zaufania, mapa modułów, NFR, koszty MVP ≈ 176 zł/mies. i po 2 latach ≈ 386–477 zł/mies.). Samosprawdzenie: sumy ważone wszystkich tabel ocen przeliczone skryptem (zgodne), wymagane sekcje i linki względne obecne, 3 diagramy Mermaid wyrenderowane bez błędów (mermaid-cli). Bramka lokalna z CLAUDE.md jeszcze nie istnieje (stack TBD, EVM-006) — brak kodu i testów automatycznych w tej historyjce. Otwarte pytania do Konrada: w README → „Pytania do decyzji”.
- 2026-10-02 — koszty po poprawkach rundy 1 (GitHub Pro, backupy z object lock): MVP ≈ 192 zł/mies., po 2 latach ≈ 407–498 zł/mies. (zastępują wcześniejsze ≈ 176 / 386–477 zł)
- 2026-10-02 — weryfikacja: QA PASS (AC1–AC6), przeglądy security/devops/mobile APPROVE w rundzie 2; licencje dopisane (solution-architect), drobne poprawki kosztów (orkiestrator)
- 2026-10-02 — in-progress → in-review: demo dla Konrada
- 2026-10-02 — demo: Konrad zaakceptował (decyzje w „Decyzje”); ADR 0001–0014 → Zaakceptowana; in-review → done, squash merge do `main`
