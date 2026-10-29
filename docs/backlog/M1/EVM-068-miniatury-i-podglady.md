---
id: EVM-068
title: Miniatury i podglądy zdjęć — przetwarzanie w izolacji
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-011, EVM-044]
---

# EVM-068: Miniatury i podglądy zdjęć — przetwarzanie w izolacji

## Historyjka
Jako **pracownik biura** chcę **widzieć zdjęcia zlecenia jako galerię miniatur pogrupowanych po kategorii**, aby **szybko obejrzeć postęp prac — bez ryzyka, że przetwarzanie pliku zaszkodzi systemowi albo ujawni lokalizację z metadanych**.

## Kontekst
- Część (b) podziału EVM-044 (konsultacja `solution-architect`, W3): `media-processor` (sharp) w izolacji wg ADR-0009, przejście `processing → ready`, miniatury 320 i 1600 px.
- P3: pochodne zawsze bez metadanych (EXIF, XMP, IPTC, GPS); oryginał bez zmian (niezmiennik SHA-256). SR-FILE-06 (piaskownica parserów).
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — galeria (Gallery, Thumbnail § 3.11), stany pliku.

## Kryteria akceptacji
**AC1 — Galeria miniatur**
- Zakładając 24 zdjęcia „W trakcie prac” i 12 „Stan przed pracami” w stanie `clean`
- Gdy kończy się przetwarzanie
- Wtedy pliki przechodzą do `ready`, a W-09 pokazuje „Zdjęcia i filmy · 36 zdjęć” i grupy „W trakcie prac (24)”, „Stan przed pracami (12)” z miniaturami doczytywanymi leniwie.

**AC2 — Pochodne bez metadanych (SR-FILE-08, P3)**
- Zakładając zdjęcie testowe z EXIF i współrzędnymi GPS (wygenerowane syntetycznie)
- Gdy powstają miniatura 320 px i podgląd 1600 px
- Wtedy pochodne nie zawierają EXIF, XMP, IPTC ani GPS (sprawdzenie narzędziem w teście), mają zastosowaną orientację, a oryginał ma niezmieniony skrót SHA-256.

**AC3 — Ochrona przed bombami (SR-FILE-04)**
- Zakładając obraz o rozdzielczości powyżej limitu pikseli (np. 100 MP)
- Gdy trafia do przetwarzania
- Wtedy przetwarzanie kończy się stanem `failed` (`processing_error`) w limicie czasu i pamięci, bez wpływu na inne zadania.

**AC4 — Błąd przetwarzania**
- Zakładając błąd przetwarzania po `clean`
- Gdy kolejne automatyczne próby się nie udają
- Wtedy W-09 pokazuje „Nie udało się przygotować podglądu. Spróbujemy ponownie.”, a Administrator i Edytor mogą pobrać oryginał (od EVM-045).

**AC5 — Izolacja (SR-FILE-06, SR-INPUT-04)**
- Gdy sprawdzam konfigurację `media-processor` (przegląd Compose i skan Trivy w CI)
- Wtedy kontener nie ma sieci, ma system plików tylko do odczytu z `tmpfs`, `cap_drop: ALL`, `no-new-privileges`, użytkownika nie-root, limity pamięci (1,5 GB), CPU, procesów i czasu, komunikuje się tylko gniazdem Unix, a programy są wywoływane bez powłoki, ze ścieżkami nadanymi przez serwer.

**AC6 — Adresy miniatur (SR-WEB-04, SR-FILE-07)**
- Gdy panel pobiera miniaturę
- Wtedy dostaje podpisany `GET` z TTL ≤ 5 min z domeny bucketu (nie z originu aplikacji), pochodna ma stały typ i jest wyświetlana inline, a plik w stanie innym niż `ready` zwraca `404`.

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda pobiera miniatury
- Wtedy A, E i R je widzą, niezalogowany — `401`; miniatura medium zlecenia B pobierana ścieżką zlecenia A — `404`.

**AC8 — Stany**
- Wtedy: ładowanie — Skeleton kafli; miniatura niedostępna — `image` + „Nie można wyświetlić”; brak zdjęć — EmptyState z W-09; offline — galeria z pamięci karty z banerem.

## Poza zakresem
- Lightbox, podgląd 1600 w powiększeniu, pobranie oryginału i limity podpisanych URL-i — EVM-045. Filmy (720p) — EVM-046.
- Grupowanie po etapie — EVM-048.

## UX / UI
- W-09: Gallery, Thumbnail (§ 3.11), grupy po kategorii, znaczniki [P-7]. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | miniatury |
| Edytor | miniatury |
| Tylko odczyt | miniatury |
| Niezalogowany | brak (`401`) |

- Dane: pochodne zdjęć (bez metadanych).
- W AC: SR-FILE-08, SR-FILE-04, SR-FILE-06, SR-INPUT-04, SR-WEB-04, SR-FILE-07, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-INFRA-11 (limity zasobów). Polityka P3.

## Notatki techniczne
- Moduły: `media` (przejście `processing → ready`, warianty URL), worker + kontener `media-processor` + panel.
- `devops-engineer`: kontener `media-processor` w izolacji (ADR-0009), limity, wdrożenie na staging.
- Limity wystawiania podpisanych URL-i miniatur (P10) wchodzą w EVM-045 — przed pilotem realnym obie historyjki są gotowe.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Kolejka w tabeli (wzorzec EVM-044: compare-and-set, licznik prób przy przejęciu), osobna tabela pochodnych (`media.file_derivatives`, migracja `0053`, tylko expand), port `ImageProcessor` z adapterem gniazda Unix i podwójnym w testach, workspace `services/media-processor` (sharp, proces potomny na zadanie), operacja `createMediaAssetDownloadUrl` (`POST …/download-url` z `{ variant }`, zgodnie z api-guidelines), `compose.media.yaml` + obraz, wąskie `PutObject` workera w polityce bucketu, galeria W-09. Szczegóły: `docs/architecture/media-pipeline.md` § 10, `docs/ops/runbooks/media-processor.md`, `CHANGELOG.md`.

## Decyzje
- Operacja adresu to `POST …/media-assets/{mediaAssetId}/download-url` z treścią `{ variant: thumbnail | preview }` (nie `GET …/derivatives/{variant}/url`): zgodnie z `api-guidelines.md`; wartość `original` doda addytywnie EVM-045. Odpowiedź `{ url, expiresAt }`, TTL 300 s ustawia stała serwera. (Konsultacja `solution-architect`.)
- Odpowiedź `MediaAsset` dostaje opcjonalne pole `processingFailed: true` (tylko dla `failed` z `processing_error`), żeby W-09 odróżniło „Nie udało się przygotować podglądu” od porzuconego uploadu; zmiana addytywna, bez zmiany `stateReasonCode` (jego `enum` jest w odpowiedzi, więc dodanie wartości byłoby zmianą łamiącą).
- Pętla bierze `clean` (zdjęcia sprzed wdrożenia też); nagłówek galerii to „Zdjęcia i filmy · N zdjęć”, grupa `before_work` nosi nad kaflami nazwę „Stan przed pracami” (jak w AC), w oknie dialogu zostaje „Przed pracami”.

## Uwagi do rozważenia
- **HEIC:** upload przyjmuje `image/heic`, ale prebuilt libvips z `sharp` nie dekoduje HEVC — takie pliki kończą dziś jako `failed` / `processing_error` od razu (błąd trwały `unsupported`, bez ponowień). Pełne wsparcie (własny build libvips z libheif i x265: licencje GPL i patenty) albo konwersja HEIC→JPEG po stronie klienta to osobna decyzja.
- **Dla EVM-045 (P10):** galerie do 5000 mediów. Panel prosi o adres tylko dla kafli w widoku i po 6 naraz, ale limit wystawiania adresów (300 / 10 min / użytkownika, SR-FILE-10) musi uwzględniać miniatury — inaczej przewinięcie dużej galerii wyczerpie limit; rozważyć wariant zbiorczy (adresy dla wielu mediów jedną operacją) albo osobny, wyższy limit dla pochodnych. Do czasu EVM-045 chroni globalny limit 300/min/użytkownika (akceptowalne na stagingu z danymi syntetycznymi, nie przed pilotem).
- **Dla EVM-045 (AC4):** `failed` z `processing_error` to plik po udanym skanie — jego oryginał ma być do pobrania (niezmiennik zapisany w `domain-model.md`).
- **Dług (infra):** publikacja obrazu `evia-media-processor` w CI (`publish`, manifest) i skan Trivy obrazu; komórki macierzy `bucket-verify` dla `PUT` pochodnej / oryginału (wymaga sufiksu klucza próbnego); `tofu apply` i tmpfs hosta w sesji IaC; weryfikator `deploy-agent` musi być w wersji dopuszczającej wolumen workera przed wdrożeniem tej zmiany na staging.
- **Dla recenzji bezpieczeństwa:** RR-43 (typ po zawartości) — procesor teraz potwierdza format libvips względem typu z rekordu (niezgodność → `unsupported`), co zamyka to ryzyko w głąb; bez NotResource w polityce bucketu (nieweryfikowalne bez sesji IaC) worker może jeszcze tworzyć dowolne nowe klucze warunkowym `PutObject`, nigdy nie nadpisze istniejącego obiektu ani oryginału.

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-068 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; część (b) podziału EVM-044 — konsultacja solution-architect W3)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-29 — plan gotowy (backend-developer)
- 2026-10-29 — implementacja (backend-developer): migracja 0053, `services/media-processor`, pętla przetwarzania i operacja adresu miniatury, galeria W-09, CSP `img-src`, `compose.media.yaml`, polityka bucketu; testy `EVM-068 AC1–AC8`
- 2026-10-29 — implementacja web (web-developer): weryfikacja galerii W-09 (testy web zielone, pokrycie linii 98,65%, typy OK); bez zmian w kodzie
- 2026-10-29 — bramka (devops-engineer): `pnpm run gate` zielony w worktree (w tym parytet Linux, integracja, coverage:diff 97,9% linii / 93,9% gałęzi)
