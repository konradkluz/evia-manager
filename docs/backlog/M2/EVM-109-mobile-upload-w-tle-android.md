---
id: EVM-109
title: "Aplikacja: silnik wysyłania plików (Kotlin), model referencyjny i bramki Kotlin"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: in-progress
priority: P1
path: pelna             # pliki, uwierzytelnianie workera (czysta logika), nowe bramki jakości i zależności Kotlin
owner: mobile-developer
contributors: [devops-engineer]   # bramki, CI, konwerter pokrycia Kover → lcov w tools/diff-coverage
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-009, EVM-093, EVM-044]
---

# EVM-109: Aplikacja — silnik wysyłania plików (Kotlin), model referencyjny i bramki Kotlin

## Cel
Jako **zespół** chcemy mieć **sprawdzony, czysty silnik wysyłania plików (Kotlin, bez zależności od Androida) zgodny z modelem referencyjnym w TypeScript i objęty bramkami jakości Kotlin**, aby **zadanie systemowe Androida (EVM-130) i aparat (EVM-108) powstawały na gotowym, przetestowanym rdzeniu wznawiania bez duplikatów**. To pierwsza połowa dawnej „wysyłki w tle”: podział z 2026-11-14 (rekomendacja architekta). Druga połowa (zadanie systemowe, natywny właściciel tokenów, kolejka plików, powiadomienie) — [EVM-130](EVM-130-mobile-usluga-wysylania-i-tokeny.md).

## Kontekst
[ADR-0020](../../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (własny moduł Kotlin), protokół i stany pliku — [`media-pipeline.md`](../../architecture/media-pipeline.md) §1–§3, §6; kolejność komend i oryginały — [`offline-sync.md`](../../architecture/offline-sync.md) („Komendy mobilne MVP”, pkt 7); endpointy sesji — EVM-044 (kanał mobilny dla telefonu dodaje [EVM-131](EVM-131-api-media-z-telefonu.md)). Punkt wyjścia: spike `spikes/offline-upload` (promocja do modułu produkcyjnego). Materiał źródłowy bramek: [EVM-113](EVM-113-bramki-kotlin.md) (połączona).

## Kryteria akceptacji

**AC1 — Wznawianie sesji bez duplikatów (silnik)**
- Zakładając sesję uploadu z częściami przesłanymi częściowo i przerwę (zerwane połączenie, utrata procesu odtworzona w teście przez nowy egzemplarz silnika)
- Gdy silnik wznawia wysyłanie za sztucznymi abstrakcjami HTTP i plików
- Wtedy źródłem prawdy o przesłanych częściach jest odpowiedź `ListParts` (żadna część nie jest wysłana dwa razy), `403` na adres części odnawia tylko adres tej części, a `complete` jest idempotentny (powtórka po utraconej odpowiedzi nie tworzy drugiego obiektu ani osieroconego multipartu).

**AC2 — Mapowanie odpowiedzi serwera na stany**
- Zakładając wysyłanie w toku
- Gdy serwer lub sieć zwraca `401 session_revoked`, `401 device_wipe_required`, `426`, `id_conflict`, `failed: checksum_mismatch`, `quarantined`, błąd `5xx` albo brak połączenia
- Wtedy silnik zwraca odpowiednio: `paused_revoked` (pliki i kolejka zostają), sygnał czyszczenia urządzenia (silnik niczego już nie wysyła), `paused_update` (wstrzymanie), „wymaga uwagi” (`id_conflict`, `quarantined`), „ponów” (`checksum_mismatch`) i ponowienie z backoffem (`5xx`, brak połączenia); nieznany kod daje ogólny „wymaga uwagi”.

**AC3 — Adresy części, nagłówki i logi**
- Zakładając wysyłkę części przez podpisane adresy
- Gdy silnik pobiera adres i wysyła część
- Wtedy adres jednej części jest pobierany tuż przed jej wysłaniem (ważność nadaje serwer, ≤ 60 min, SR-FILE-02) i trzymany wyłącznie w pamięci; żądanie części idzie tylko do hosta z adresu przez HTTPS i nie niesie nagłówka `Authorization`; utrwalany stan silnika zawiera tylko identyfikatory i ETagi (test schematu — bez tokenów, adresów, nazw ani opisów); logi powstają wyłącznie przez logger z redakcją (test JVM: adresy, tokeny i `X-Amz-*` nie trafiają do logów), a użycie `android.util.Log` poza nim wykrywa test lub reguła repozytorium.

**AC4 — Model referencyjny i wspólne wektory zgodności**
- Zakładając wektory protokołu w `packages/sync-core/conformance/upload/` (planowanie części, pętla wznawiania, backoff, mapowanie z AC2)
- Gdy testy TypeScript (model referencyjny w `sync-core`) i testy Kotlin czytają ten sam zestaw wektorów
- Wtedy oba wyniki są identyczne, rozjazd dowolnego wektora daje czerwony test po którejkolwiek stronie, pakiet `sync-core` mieści się w progu 95% (linie i gałęzie), a zmiana wektora unieważnia cache zadań Turborepo (`inputs`).

**AC5 — Bramki jakości Kotlin (dawne EVM-113)**
- Zakładając kod Kotlin silnika
- Gdy uruchamiam bramkę lokalnie (natywnie) i w CI
- Wtedy ktlint (format i lint) sprawdza Kotlin (naruszenie daje kod ≠ 0), testy JUnit na JVM (bez emulatora i bez `expo prebuild`; oznaczone `EVM-109 AC#`) przechodzą, raport Kover XML jest zamieniany na lcov własnym konwerterem w `tools/diff-coverage` (rozszerzenie `.kt` w obsługiwanych źródłach) i trafia do `coverage:diff` jako artefakt jobu `mobile-apk` (job `coverage` dopisuje go do `needs`), próg linii i gałęzi 95% dotyczy czystej logiki silnika, a klej Androida jest wykluczony z uzasadnieniem w `coverage-exclusions.json`; obniżenie progu lub wyłączenie testu nie przechodzi bramki.

**AC6 — Zależności i łańcuch dostaw**
- Zakładając nowe narzędzia i biblioteki Kotlin/Gradle (ktlint, Kover, JUnit, wrapper Gradle)
- Gdy przeglądam zmianę
- Wtedy wersje są dokładne (bez `+`, zakresów i SNAPSHOT), pochodzą tylko z repozytoriów Google i Maven Central, pobierane narzędzia i dystrybucja Gradle mają przypięte sumy SHA-256, JUnit (EPL-2.0) występuje wyłącznie jako zależność testowa (test: lista zależności produkcyjnych modułu nie zawiera JUnit i innych licencji spoza dozwolonych), a opis PR zawiera tabelę „licencja / opiekun / ostatnie wydanie / znane CVE”.

**AC7 — Dokumentacja bramek**
- Zakładając zmianę bramek
- Gdy ją scalam
- Wtedy `testing-strategy.md` ma wiersz progu dla Kotlin, `coverage-thresholds.json` ma warstwę 95% dla `sync-core` i logiki silnika, ADR-0014 ma notę „częściowo zmieniona przez ADR-0020”, a `tools/repo-policy` i `npm run docs:check` przechodzą.

## Poza zakresem
Zadanie systemowe Androida, natywny właściciel tokenów, trwała kolejka plików, powiadomienie, serwer scenariuszy z sesjami (EVM-130); aparat (EVM-108); filmy i „tylko Wi-Fi” (EVM-110); testy mutacyjne Kotlin; iOS; powiązanie tokenu odświeżania z kluczem urządzenia (backlog po tej historyjce); „tylko twórca kontynuuje sesję” (test backendu — EVM-044/131, nie telefon).

## Decyzje i ograniczenia
- **Podział z 2026-11-14** (decyzja Konrada, rekomendacja architekta D1): EVM-109 = silnik + model referencyjny + bramki; EVM-130 = Android, tokeny, kolejka plików. Dawne AC1–AC5 rozdzielone wg notatki architekta z brzmieniem security (AC2 o odświeżaniu → EVM-130, AC4 o czyszczeniu → EVM-130, AC5 o adresach części → tu i EVM-130).
- **EVM-084 nie jest zależnością** (decyzja Konrada 2026-11-14): noc na silniku, JVM i testach lokalnych. Dowody EVM-084 stają się warunkiem testu terenowego ([EVM-112](EVM-112-test-terenowy-i-masvs.md)).
- **Zakaz dystrybucji:** paczka z aparatem lub wysyłaniem nie trafia do techników ani na środowisko z danymi realnymi przed dowodami EVM-084 (wersjonowanie i kopia mediów) i sign-offem EVM-112; w nocy aplikacja łączy się wyłącznie z serwerem scenariuszy `tools/mobile-e2e` (RR-93).
- **JUnit (EPL-2.0)** spoza listy dozwolonych licencji — wyjątek wyłącznie dla zależności testowych niewchodzących do paczki (decyzja Konrada 2026-11-14, rekomendacja security). Żadnych SDK analityki i raportowania błędów, Play Integrity, binarnych AAR w repo; grupy z denylisty EVM-108 niedozwolone. Skany OSV/Trivy nie widzą zależności Gradle — pozycja do backlogu (np. `gradle.lockfile`).
- **Ważność adresu części** zostaje po stronie serwera (≤ 60 min, SR-FILE-02); kryterium „≤ 15 min” z szkicu usunięte (decyzja Konrada 2026-11-14).
- Decyzja 17 (właściciel odświeżania tokenów — natywny) potwierdzona 2026-11-14; realizuje ją EVM-130.
- Bezpieczeństwo (mobilne): silnik nie utrwala tokenów ani adresów; brak danych osobowych w logach i danych testowych (tylko syntetyczne).
- UX / UI: nie dotyczy (brak ekranów).

## Notatki techniczne
- Pliki wspólne z torem B (ograniczyć zmiany do osobnych sekcji): `packages/config/coverage-exclusions.json`, `CHANGELOG.md`, `docs/backlog/M2/README.md`. Tor A zmienia też `packages/sync-core` (tor B go nie dotyka), `tools/diff-coverage`, `.github/workflows` (job `mobile-apk`, `coverage`).
- Przepływy Maestro toru A: numery 50–69 (w tej historyjce nie powstają).
- Wersje i licencje sprawdza wykonawca w dniu pracy (SR-SUPPLY-06, `minimumReleaseAge`): Kover (Apache-2.0; raport XML bez lcov), ktlint (MIT), JUnit Jupiter (wersja zgodna z Kotlinem z Expo), wrapper Gradle z walidacją sumy.
- Dysk: architekt zaleca ≥ 20 GB wolnego (cache Gradle); po kompaktowaniu VHDX Dockera 2026-11-14 jest 14,8 GB — komenda nocna ma próg: poniżej 10 GB tor B staje, tor A jedzie dalej.

## Definition of Done
- [ ] Wszystkie AC pokryte testami oznaczonymi `EVM-109 AC#`; `pnpm run gate` i `npm run docs:check` zielone; testy Kotlin w CI (job `mobile-apk`) zielone.
- [ ] Recenzje: code-reviewer, security-engineer, solution-architect — approve.
- [ ] Tabela zależności w PR; `CHANGELOG.md`; status `in-review` ustawia Tech Lead.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-11-12 — dołączono bramki Kotlin z EVM-113 jako AC6; `depends_on`: usunięto EVM-113, dodano EVM-009 (decyzja Tech Leada z delegacji Konrada „tanio, szybko, bezpiecznie”)
- 2026-11-14 — refinement do DoR (product-owner): podział na EVM-109 (silnik, model referencyjny, bramki; 7 AC) i EVM-130 (Android, tokeny, kolejka); `depends_on` bez EVM-084 (przeszła do EVM-112); decyzje Konrada: JUnit tylko testowo, ważność adresu części bez zmian, zakaz dystrybucji, decyzja 17 potwierdzona
- 2026-11-14 — draft → ready: kryteria zatwierdzone przez Tech Leada z delegacji Konrada (pytanie przed nocą 2026-11-14); Konrad przegląda je rano w PR
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-14` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-14-mobile-media`
- 2026-11-14 — plan gotowy (mobile-developer)
- 2026-11-14 — implementacja (mobile-developer): model referencyjny i wektory w sync-core, silnik Kotlin z testami JVM, bramka gate:kotlin (ktlint, Kover 95%, Gradle z weryfikacją sum), konwerter Kover→lcov, polityka w repo-policy, CI (mobile-apk, coverage), dokumentacja bramek
- 2026-11-14 — devops-engineer: gate:kotlin, lint (ignorowanie build/ silnika w eslint mobile), testy sync-core/repo-policy/tools, docs:check, deps:check zielone
