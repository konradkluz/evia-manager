---
id: EVM-044
title: Zdjęcia w zleceniu — wysyłanie z panelu i skan bezpieczeństwa
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: in-progress
priority: P1
path: pelna
model: sonnet
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-007, EVM-084, EVM-011, EVM-038, EVM-071]
---

# EVM-044: Zdjęcia w zleceniu — wysyłanie z panelu i skan bezpieczeństwa

## Historyjka
Jako **pracownik biura albo technik z przeglądarką w telefonie** chcę **wysłać zdjęcia do zlecenia, a system sprawdził każdy plik, zanim ktokolwiek go otworzy**, aby **dokumentacja zdjęciowa była w archiwum zlecenia i nie wprowadzała złośliwych plików**.

## Kontekst
- Część (a) podziału EVM-044 (konsultacja `solution-architect`, W3): upload i skan. Przetwarzanie i miniatury — EVM-068 (b).
- ADR-0009 (storage, multipart z podpisanymi URL-ami, ClamAV, kwarantanna 30 dni, niedokończone uploady 7 dni), P5 (fail-closed), `StoredFile` i `UploadSession` (`domain-model.md`). Wspólny protokół web i mobile — `docs/architecture/media-pipeline.md` z EVM-011 (rozmiar części, odświeżanie URL-i, SHA-256 / `checksum_mismatch`).
- Roadmapa M1: „Telefon może tymczasowo dodawać zdjęcia przez przeglądarkę” — ten sam protokół (zastępuje kroki mobilne A6, B10, C9 w UAT M1). Zanim technik wyjdzie z garażu bez zasięgu, przeglądarka może utracić kartę (blokada ekranu, wyładowanie z pamięci przy otwarciu aparatu), więc rekomendowanym źródłem zdjęć jest galeria telefonu, a panel mówi, co nie zostało wysłane (zasada „nic nie ginie”, przegląd `ux-designer` EVM-010). Wariant aparat / galeria — decyzja 18; panel na prywatnym telefonie (BYOD) — decyzja 19 i zasady z instrukcji EVM-066.
- Decyzja 14: staging CX33 (8 GB RAM) od tej historyjki. Makiety: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) (panel) i W-09 w szerokości `breakpoint.compact` — przeglądarka w telefonie (EVM-071).

## Kryteria akceptacji
**AC1 — Wysyłanie zdjęć**
- Zakładając zakładkę „Media i dokumenty” zlecenia
- Gdy wybieram albo upuszczam 5 zdjęć JPEG, ustawiam kategorię „W trakcie prac” i wybieram „Wyślij 5 plików”
- Wtedy panel tworzy media (UUIDv7 z klienta) i sesje uploadu, wysyła pliki częściami bezpośrednio do storage'u przez podpisane URL-e, pokazuje „Wysyłanie · 3 z 5 · nie zamykaj karty do końca wysyłania”, a po zakończeniu każdy plik ma stan „Sprawdzanie pliku”; w dzienniku zlecenia powstaje zdarzenie dodania mediów (EVM-038).

**AC2 — Typ i rozmiar (SR-FILE-01, SR-FILE-03)**
- Gdy wybieram plik SVG, HTML, archiwum albo zdjęcie > 50 MB
- Wtedy panel odrzuca go przed wysłaniem z komunikatem (np. „Plik „x.svg” ma nieobsługiwany format…”)
- Oraz gdy plik o rozszerzeniu `.jpg` ma inną zawartość, wtedy po wysłaniu trafia do kwarantanny z przyczyną `type_mismatch` (typ wykrywany z zawartości).

**AC3 — Skan fail-closed i plik z wirusem testowym (SR-FILE-05, SR-ERR-01, SR-ERR-02)**
- Zakładając, że `clamd` jest niedostępny
- Gdy plik czeka na skan
- Wtedy pozostaje w „Sprawdzanie pliku”, skan jest ponawiany i plik nigdy nie przechodzi do `clean` bez skanu; plik jest niedostępny dla nikogo, dopóki nie jest `clean`
- Oraz gdy wysyłam plik testowy EICAR (prawdziwy ClamAV w CI — Testcontainers), plik ma stan kwarantanny z przyczyną `malware_detected`, nie jest przetwarzany ani dostępny do pobrania, a W-09 pokazuje przy nim znacznik „Wymaga uwagi” (przyczyna, alert i ponowny skan — EVM-049).

**AC4 — Wysyłanie z przeglądarki w telefonie (makieta W-09 compact z EVM-071)**
- Zakładając Edytora w przeglądarce telefonu z Androidem (szerokość `breakpoint.compact`) i 12 zdjęć zrobionych aparatem systemowym — zdjęcia są w galerii telefonu (wariant z decyzji 18)
- Gdy wybiera „Dodaj zdjęcia lub filmy” → „Wybierz z galerii” (etykiety z makiety W-09 compact), zaznacza 12 zdjęć i je wysyła
- Wtedy każdy plik ma własny status (w kolejce, wysyłanie z postępem, „Sprawdzanie pliku”, „Wysłano”, „Nie wysłano”), wszystkie cele dotyku mają co najmniej `size.touch-target.min`, a po zakończeniu panel pokazuje „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”; zdjęcia zostają w galerii jako kopia do tego potwierdzenia
- Oraz po zablokowaniu ekranu i powrocie wysyłanie wznawia się od ostatniej potwierdzonej części, a gdy karta została zamknięta albo wyładowana z pamięci przed końcem, po ponownym otwarciu zlecenia panel pokazuje „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” z nazwami tych plików (na podstawie niedokończonych sesji uploadu użytkownika — bez zapisu danych w pamięci przeglądarki, SR-WEB-05).

**AC5 — Integralność (SR-CRYPTO-05)**
- Zakładając zadeklarowany skrót SHA-256 różny od zawartości
- Gdy kończy się wysyłanie
- Wtedy plik ma stan `failed` z przyczyną `checksum_mismatch`, a W-09 pokazuje „Nie wysłano — plik uszkodzony w transmisji” z „Ponów” (plik jest w pamięci karty do jej zamknięcia).

**AC6 — Sesja uploadu (SR-FILE-02)**
- Gdy sesję uploadu wystawia serwer
- Wtedy klucz obiektu nadaje serwer (bez nazwy pliku, numeru zlecenia i danych osobowych), URL części ma TTL 60 min i jest związany z kluczem, numerem i rozmiarem części, `complete` weryfikuje łączny rozmiar, a sesję może kontynuować tylko jej twórca (inny użytkownik — `404`).

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wysyła zdjęcie
- Wtedy A i E wysyłają, R nie widzi Uploadera i dostaje `403 forbidden`, niezalogowany — `401`; sesja uploadu medium zlecenia B ścieżką zlecenia A — `404`.

**AC8 — Stany**
- Wtedy: offline — wysyłanie wstrzymane („Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.”) i wznawiane od ostatniej potwierdzonej części; próba zamknięcia karty z niewysłanymi plikami — ostrzeżenie przeglądarki; brak mediów — „To zlecenie nie ma jeszcze zdjęć…”; `429` — wzór z README makiet; „Wstrzymaj” przy pliku.

## Poza zakresem
- Miniatury, podglądy i usuwanie metadanych z pochodnych — EVM-068. Podgląd i pobranie — EVM-045. Filmy — EVM-046. Dokumenty — EVM-047.
- Przyczyna kwarantanny, alert i ponowny skan — EVM-049. Usuwanie — EVM-051.
- Rozpoznawanie zdjęć już wysłanych przy ponownym wyborze z galerii (duplikaty) — poza M1; komunikat z AC4 podaje nazwy niewysłanych plików. Upload w tle i kolejka offline — aplikacja (M2).

## UX / UI
- W-09: Uploader i UploadQueueItem (§ 3.12) z „Wybierz pliki” obok strefy upuszczania, dialog „Dodaj 5 plików” (kategoria, opcjonalnie opis), znaczniki pliku [P-7] („Sprawdzanie pliku”, „Wymaga uwagi”, „Nie wysłano”), panel postępu.
- W-09 w przeglądarce telefonu (`breakpoint.compact`, makieta EVM-071): „Dodaj zdjęcia” z wyborem źródła wg decyzji 18, status przy każdym pliku, cele dotyku ≥ `size.touch-target.min`, potwierdzenie „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”, stan po powrocie do karty „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” (AC4).
- Stany: AC4, AC8; brak uprawnień — AC7. Wybór etapu w dialogu — od EVM-048.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wysyłanie zdjęć |
| Edytor | wysyłanie zdjęć |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: zdjęcia (mogą zawierać twarze, tablice rejestracyjne, GPS w oryginale — P3), `originalFilename` (oczyszczona metadana).
- Telefon pracownika (M1, przejściowo do aplikacji M2): kopie zdjęć w galerii prywatnego telefonu do potwierdzenia „Wysłano” i sesja panelu w przeglądarce — ryzyko do akceptacji Konrada (decyzje 18 i 19, nowe RR w `threat-model.md` — EVM-065 AC4); zasady pracy na telefonie (w tym wyłączona automatyczna kopia zdjęć w chmurze i opróżniany kosz galerii) — instrukcja EVM-066 AC2.
- W AC: SR-FILE-01, SR-FILE-03, SR-FILE-05, SR-ERR-01, SR-ERR-02, SR-CRYPTO-05, SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05, SR-WEB-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-01, SR-FILE-04 (limity ClamAV), SR-INFRA-02 (bucket prywatny — test „anonimowy GET = 403”), SR-INFRA-11 (limity zasobów), SR-WEB-01 (CSP `connect-src` z domeną bucketu), SR-DATA-01, SR-LOG-03. Polityki P3, P5, P10.

## Notatki techniczne
- Moduły: `media` (`MediaAsset`, `StoredFile`, `UploadSession`), `timeline` (zdarzenie), worker + panel.
- `devops-engineer`: CORS bucketu dla `PUT` z originu panelu (`ExposeHeaders: ETag`), CSP `connect-src`, lifecycle (niedokończone uploady 7 dni, kwarantanna 30 dni), kontenery `clamd` i `freshclam`, wdrożenie workera na staging (CX33 — decyzja 14).
- Atrapa skanera i S3 w testach jednostkowych; prawdziwy ClamAV z EICAR w CI. Media w testach — wyłącznie generowane syntetycznie.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Przyrost „API + skan” (tor T1, backend-developer); panel (zakładka „Media i dokumenty”, Uploader, makiety W-09) — osobny przyrost web-developera. Moduł `media` (nowy, ADR-0009), porty `ObjectStorage` i `MalwareScanner` w `platform`, migracja `0045_media`, kontrakt `paths/media.yaml` + `components/media*.yaml`, skan w workerze. Szczegóły i runbook: [wysylanie-zdjec-i-skan.md](../../ops/runbooks/wysylanie-zdjec-i-skan.md).

## Decyzje
Decyzje wykonawcze (orkiestrator — nocna kolejka 2026-10-27; do potwierdzenia przez Konrada przy demo):
1. **Fail-closed konfiguracji:** brak wszystkich zmiennych mediów → `503 media_storage_unavailable`, `/api/health` zdrowy, worker bez skanu; konfiguracja częściowa → błąd startu z nazwami zmiennych. `compose.staging.yaml` nie jest zmieniany (polityka deploy-agenta odrzuca klucz `networks`, a zmienne `*_FILE` wymagają wpisu w `secrets.manifest.json` — zadanie T3/sesji IaC).
2. **Klucz obiektu:** `media/{rok}/{miesiąc}/{id pliku}/original` (id rekordu pliku, domain-model ma pierwszeństwo przed `{assetId}`); prefiks zgłaszany w PR: `media/`. Brak przenoszenia do prefiksu kwarantanny w 044.
3. **Kolejka skanu to tabela, nie komunikat:** API nie ma producenta kolejki, a wysłanie zadania nie jest w transakcji `complete`, więc komunikat mógłby zginąć po cichu (AC3). Pętla workera (co 5 s) bierze pliki `uploaded` i `scanning` nietknięte od 2 minut przez compare-and-set; ponowienie po 2 minutach jest backoffem; po 30 minutach ostrzeżenie z liczbą. Współbieżność: 1 (kolejno, 5 plików na przebieg). Odchylenie od „kolejki pg-boss `media.scan-file`” z konsultacji architekta; indeks częściowy `stored_files_unscanned_idx` jak zalecono.
4. **Jeden przebieg po przypiętej wersji obiektu:** `GetObject` z `VersionId` i `If-Match` zasila jednocześnie SHA-256, liczbę bajtów, typ (pierwsze 4100 B, `file-type`) i `INSTREAM`; odczyt przerwany po przekroczeniu `declaredSize` (→ `checksum_mismatch`). **Pierwszeństwo wyników:** `malware_detected` (kwarantanna) > `checksum_mismatch` (`failed`) > `type_mismatch` (kwarantanna) > `clean`.
5. **Skaner po TCP lub gnieździe:** `CLAMD_SOCKET` = `tcp://host:port` (staging: kontener w sieci `evia-scan`) albo `unix:///ścieżka`; odchylenie od „gniazda Unix” z ADR-0009 (kontenery nie dzielą gniazda). Odpowiedź `clamd` parsowana ściśle: tylko `stream: OK` to `clean`, `… FOUND` to zakażony, wszystko inne (w tym `INSTREAM size limit exceeded`) to wyjątek i ponowienie.
6. **„Ponów” po `checksum_mismatch`:** nowa sesja wyłącznie dla pliku `failed` z przyczyną `checksum_mismatch` (CAS do `pending_upload`, ten sam klucz — nadpisanie zostawia poprzednią wersję w buckecie z wersjonowaniem); każdy inny stan po `complete` → `409 invalid_state_transition`.
7. **Wznowienie po ponownym wyborze pliku (AC4):** `createUploadSession` dla medium z aktywną, niewygasłą sesją wołającego zwraca ją (`200`), zamiast tworzyć drugą; panel dopasuje plik do niedokończonej sesji po `(declaredSize, sha256)` (do potwierdzenia z `ux-designer` przy panelu). Cudza aktywna sesja → `409 id_conflict` bez szczegółów.
8. **Kontrakt (addytywny):** `fileState` z pełnym enum ADR-0009 (klienci tolerują nieznane); odpowiedzi nigdy nie niosą klucza obiektu, identyfikatora uploadu S3, skrótu ani przyczyny kwarantanny (tylko `needsAttention`; `stateReasonCode` wyłącznie `checksum_mismatch`); nazwa pliku i sesja tylko w liście `uploadState=unfinished`; lista z kursorem i jednym zapytaniem; cudza sesja → `404` (media-pipeline §2 poprawione z `403`).
9. **Zdarzenia:** `media` nie importuje `timeline` ani `audit` — `timeline` zapisuje jeden wpis `media_assets_added` na partię (liczba i identyfikatory, ≤ 50; poza grupą „Zmiany statusów”), `audit` — `media_asset.created` per medium i `media_file.quarantined` (aktor systemowy) w transakcji.
10. **S3:** Scaleway — adresowanie virtual-hosted (`forcePathStyle=false`), żeby CSP przypinał host bucketu; path-style tylko dla SeaweedFS w testach; `requestChecksumCalculation: 'WHEN_REQUIRED'`; TTL URL-a ≤ 3600 s (wyższy odrzucany w kodzie); logger SDK wyłączony.
11. **Zależności (SR-SUPPLY-06):** `@aws-sdk/client-s3` i `@aws-sdk/s3-request-presigner` **3.1157.0** (Apache-2.0; 3.1158.0 z 2026-10-27 18:46 UTC młodsza niż 24 h), `file-type` **22.2.0** (MIT, 2026-10-14), devDependency `testcontainers` 12.2.0 (już w drzewie przez `@testcontainers/postgresql`). Reguła depcruise `api-aws-sdk-only-in-storage-adapters`.
12. **Panel (web-developer):** pliki żyją w pamięci karty (nic w `localStorage`, IndexedDB ani Cache API — test E2E); SHA-256 przez `crypto.subtle` w Web Workerze (plik ≤ 50 MB; filmy z EVM-046 potrzebują skrótu przyrostowego); jeden plik naraz; części `PUT` przez XMLHttpRequest (postęp) z `withCredentials=false`, bez CSRF i bez ciasteczek, adres tylko w pamięci. Zakładka „Media i dokumenty” (W-06) ma strefę upuszczania od `breakpoint.medium` i przycisk „Dodaj zdjęcia lub filmy” → dialog „Wybierz z galerii” (system wybiera plik; bez `capture`); Tylko odczyt nie widzi Uploadera. Miniatur i podglądów nie ma (EVM-045/068) — medium to wiersz z kategorią, datą i stanem pliku.
13. **Wznowienie po ponownym wyborze (AC4) — odchylenie od konsultacji:** lista niedokończonych sesji NIE niesie skrótu (kontrakt: odpowiedzi nigdy nie zawierają `sha256`), więc panel dopasowuje wybrany plik do sesji po (nazwa pliku, rozmiar), nie po (rozmiar, skrót); dopasowanie wznawia sesję przez `ListParts`, nie tworzy medium. Plik o tej samej nazwie i rozmiarze, ale innej zawartości kończy jako `checksum_mismatch` („Nie wysłano — plik uszkodzony w transmisji”). Do potwierdzenia z `ux-designer` na demo.
14. **Banner „Nie wysłano N zdjęć” i „Ponów”:** banner (region) stoi nad zakładkami W-06, a „Wybierz ponownie z galerii” przełącza na zakładkę i otwiera dialog. „Ponów” dostępne tylko dla pliku w pamięci tej karty (po `checksum_mismatch` nowa sesja; po błędzie sieci — od `ListParts`); medium `failed` z listy serwera bez pliku w pamięci pokazuje sam komunikat. `429` — komunikat „Zbyt wiele zapytań. Spróbuj ponownie za 1 min.” (czas z `Retry-After`) i „Ponów”, bez automatycznego odliczania. Offline: wstrzymanie i automatyczne wznowienie po zdarzeniu `online` od `ListParts`; „Wstrzymaj” nie przerywa sesji; `beforeunload` ostrzega, dopóki są pliki niewysłane.
15. **CSP:** `connect-src 'self'` + dokładnie jeden origin z `MEDIA_BUCKET_ORIGIN` (`parseMediaOrigin` — błąd startu przy ścieżce, wildcardzie, `http` albo kilku originach) w `apps/web/security-headers.ts` (podgląd/Vite); `infra/images/web/Caddyfile` jest statyczny i NIE został zmieniony (test `caddy-headers`) — **RR-NOC-T1-7 (Średnie):** dopóki obraz `evia-web` nie dostanie origin bucketu (T3/IaC: szablon Caddyfile z zmienną albo build arg), przeglądarka na stagingu zablokuje `PUT` do bucketu i upload zakończy się „Nie wysłano”.

Ryzyka rezydualne (do akceptacji Konrada; numery RR nadaje security-engineer — nie wpisano do `threat-model.md`):
- **RR-NOC-T1-1 (Średnie):** jeden zestaw zmiennych S3 dla API i workera; SR-INFRA-03 wymaga osobnych kluczy (API — podpisy, worker — odczyt). Kod nie wymaga zmian; T3 wydaje dwa klucze o tych samych nazwach zmiennych.
- **RR-NOC-T1-2 (Niskie):** `file-type` w procesie workera poza piaskownicą SR-FILE-06 do EVM-068 (wywołanie tylko na pierwszych 4100 bajtach).
- **RR-NOC-T1-3 (Średnie, P5):** `clamd` w `compose.infra.yaml` na konfiguracji domyślnej (limity 25M, bez `AlertExceedsMax`); dla zdjęć ≤ 50 MB bezpieczne dzięki ścisłemu parserowi odpowiedzi (nigdy `clean`), ale pliki zostają w `scanning` — wymagane `StreamMaxLength`/`MaxFileSize`/`MaxScanSize` ≥ 64M i `AlertExceedsMax yes` (T3); test z prawdziwym ClamAV używa tych ustawień. Dla filmów (EVM-046) — blokada.
- **RR-NOC-T1-4 (Niskie):** kwarantanna bez 30-dniowego lifecycle do EVM-049.
- **RR-NOC-T1-5 (Niskie):** wymuszanie podpisanego `Content-Length` (403) niezweryfikowane na Scaleway — sprawdzić na demo po IaC.
- **RR-NOC-T1-6 (Niskie):** `clamd` po TCP przyjmuje komendy administracyjne bez uwierzytelnienia; sieć `evia-scan` jest `internal` i ma tylko API oraz worker.

Dla T3 (poza zakresem T1): dołączenie API i workera do `evia-scan` (zmiana polityki V4 deploy-agenta), sekrety S3 w manifeście, bucket `evia-staging-media` (wersjonowanie, SSE, CORS `PUT` z originu panelu z `ExposeHeaders: ETag`, lifecycle: multipart 7 dni, stare wersje 30 dni), limity `clamd`.

## Uwagi do rozważenia
- Panel (W-09 i W-09 compact), SHA-256 w Web Workerze, CSP `connect-src` i testy Playwright (atrapa `PUT` przez `page.route`) wykonane w przyroście web-developera (dziennik, 2026-10-28); prawdziwy S3 i ClamAV — testy integracyjne API. Do przeglądu `ux-designer`: pozostałe odchylenia z decyzji 13 i 14 oraz brak miniatur do EVM-045.
- Brak zapisu `X-Amz-*` i nazw plików w logach potwierdzony testem; test sieci i `Cache-Control: no-store` odpowiedzi z URL-em — w teście integracyjnym.

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-044 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] Dokumentacja (runbook mediów) i `CHANGELOG.md` zaktualizowane
- [ ] Demo (także z przeglądarki w telefonie z Androidem) i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; część (a) podziału EVM-044 — konsultacja solution-architect W3)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer, security-engineer): AC3 i AC4 połączone (skan), nowe AC4 — wysyłanie z przeglądarki w telefonie; zależność od EVM-071 (makieta W-09 compact); decyzje 18 i 19
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 2 (f); liczba AC bez zmian): AC4 — akcja główna „Dodaj zdjęcia lub filmy” zamiast „Dodaj zdjęcia” (etykieta z makiety W-09 compact; obejmuje filmy z EVM-046)
- 2026-10-13 — podział EVM-007 wg ADR-0018: runtime skanera antywirusowego (EVM-007 = 007a) i bucket mediów z wersjonowaniem (EVM-084 = 007b); `depends_on` + EVM-084 (product-owner)
- 2026-10-27 — nocna kolejka (tor T1): path pelna, model sonnet; wyjątek od DoR (zależność od EVM-084 = bucket przy wdrożeniu, nie kod; brak konfiguracji = funkcja wyłączona przy zdrowej usłudze; demo po sesji IaC) — warunkowo, do potwierdzenia przez Konrada
- 2026-10-27 — start realizacji (nocna kolejka, tor T1), gałąź feature/EVM-044-049-media-upload-kwarantanna
- 2026-10-27 — plan gotowy (backend-developer)
- 2026-10-27 — T1 commit 1 (backend-developer): zależności `@aws-sdk/client-s3` i `@aws-sdk/s3-request-presigner` 3.1157.0 (najnowsza stabilna starsza niż 24 h na 2026-10-27; 3.1158.0 z 2026-10-27 18:46 UTC jest zbyt świeża), `file-type` 22.2.0 (MIT, 2026-10-14); T2 używa tej samej wersji SDK według tej reguły; reguła depcruise `api-aws-sdk-only-in-storage-adapters` (`@aws-sdk/*` tylko z `apps/api/src/platform/(object-storage|deletion-register)/`); konfiguracja mediów „wszystko albo nic”
- 2026-10-27 — implementacja API i skanu (backend-developer, tor T1): migracja `0045_media`, moduł `media`, porty `ObjectStorage` i `MalwareScanner`, kontrakt (7 operacji), skan workera, zdarzenia dziennika i audytu, testy jednostkowe i integracyjne (atrapy; ClamAV i SeaweedFS przez Testcontainers — CI i host z Dockerem); panel web i CSP — poza tym przyrostem (patrz „Uwagi do rozważenia”); decyzje i RR-NOC-T1-1…6 w „Decyzjach”
- 2026-10-28 — panel (web-developer, tor T1): zakładka „Media i dokumenty”, Uploader i UploadQueueItem w `@evia/ui-web`, silnik wysyłania (SHA-256 w Web Workerze, części `PUT` bez ciasteczek, wznowienie od `ListParts`, offline, 429, „Wstrzymaj”/„Ponów”), banner niedokończonych sesji, CSP `connect-src` z `MEDIA_BUCKET_ORIGIN`; testy komponentów i Playwright (chromium) zielone; decyzje 12–15 i RR-NOC-T1-7 powyżej; pełna bramka lokalna wstrzymana — dysk C: pełny (brak miejsca)
