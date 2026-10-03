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
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-068 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; część (b) podziału EVM-044 — konsultacja solution-architect W3)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
