---
id: EVM-045
title: Galeria — podgląd i pobranie oryginału
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-068]
---

# EVM-045: Galeria — podgląd i pobranie oryginału

## Historyjka
Jako **pracownik biura** chcę **oglądać zdjęcia w powiększeniu i w razie potrzeby pobrać oryginał**, aby **sprawdzić szczegóły wykonania i przekazać dokumentację — wiedząc, że oryginał może zawierać lokalizację**.

## Kontekst
- ADR-0009 (podpisane URL-e — pobieranie TTL ≤ 5 min), P3 (ostrzeżenie o metadanych, poza firmę — podgląd), P6 (Tylko odczyt bez oryginałów), P10 (limity podpisanych URL-i: miniatury i podglądy ≤ 1000 / 10 min z alertem od 600; oryginały i dokumenty ≤ 100 / 10 min z alertem od 50).
- Konsultacja `security-engineer` (pkt 5b): SR-FILE-10 i audyt pobrań oryginałów (SR-FILE-07) w tej historyjce.
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — Lightbox, dialog „Pobrać oryginał?”.

## Kryteria akceptacji
**AC1 — Lightbox**
- Zakładając galerię zlecenia
- Gdy klikam miniaturę
- Wtedy widzę podgląd 1600 px z przyciskami „Poprzednie” / „Następne”, powiększeniem przyciskami i metadanymi (kategoria, autor, czas, „z telefonu”), bez panelu EXIF / GPS i bez „Kopiuj link”; Esc zamyka, a fokus wraca do miniatury.

**AC2 — Pobranie oryginału (SR-FILE-07, SR-FILE-08)**
- Zakładając Edytora w lightboxie
- Gdy wybiera „Pobierz oryginał”
- Wtedy widzi dialog „Pobrać oryginał? Plik może zawierać metadane, np. lokalizację. Do udostępnienia poza firmą użyj podglądu.” z „Pobierz podgląd”, a po potwierdzeniu dostaje plik z podpisanego URL-a z `Content-Disposition: attachment; filename*=UTF-8''…` (nazwa oczyszczona); ten sam URL po 5 min zwraca `403`.

**AC3 — Audyt pobrań (SR-FILE-07, SR-LOG-03)**
- Gdy ktoś pobiera oryginał
- Wtedy powstaje zdarzenie audytu (kto, które medium, kiedy, wynik).

**AC4 — Tylko odczyt (SR-AUTHZ-06, P6)**
- Zakładając rolę Tylko odczyt
- Gdy prosi o URL oryginału zdjęcia
- Wtedy API zwraca `403 forbidden`, przycisku nie ma, a miniatury i podgląd 1600 są dostępne.

**AC5 — Limity (SR-FILE-10, SR-LOG-07)**
- Zakładając użytkownika, który w 10 min dostał 100 URL-i oryginałów (albo 1000 URL-i miniatur i podglądów)
- Gdy prosi o kolejny
- Wtedy API zwraca `429 rate_limited`, W-09 pokazuje „Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.”, a od 50 oryginałów (600 miniatur) powstaje alert „masowe pobranie”.

**AC6 — Plik niedostępny (SR-WEB-04, SR-AUTHZ-02)**
- Zakładając plik w stanie innym niż `clean` / `ready` albo medium zlecenia B pobierane ścieżką zlecenia A
- Gdy proszę o URL
- Wtedy API zwraca `404 not_found`; pliki są serwowane wyłącznie z domeny bucketu.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda pobiera podgląd i oryginał
- Wtedy A i E — podgląd i oryginał; R — podgląd; niezalogowany — `401`; operacja jest w macierzy ról z wariantami pliku.

**AC8 — Stany**
- Wtedy: ładowanie podglądu — Skeleton; błąd — „Nie można wyświetlić”; offline — pobieranie wyłączone z podpowiedzią; plik usunięty w międzyczasie — „Nie znaleziono pliku. Mógł zostać usunięty.”

## Poza zakresem
- Eksport ZIP — EVM-052. Edycja opisu i kategorii — EVM-048. Filmy — EVM-046. Dokumenty — EVM-047.

## UX / UI
- W-09: Lightbox (§ 3.11), Dialog pobrania oryginału, przyciski „Pobierz podgląd” / „Pobierz oryginał”. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | podgląd, oryginał |
| Edytor | podgląd, oryginał |
| Tylko odczyt | podgląd (`403` dla oryginału) |
| Niezalogowany | brak (`401`) |

- Dane: oryginały zdjęć (mogą mieć GPS z przeglądarki), audyt pobrań.
- W AC: SR-FILE-07, SR-FILE-08, SR-LOG-03, SR-AUTHZ-06, SR-FILE-10, SR-LOG-07, SR-WEB-04, SR-AUTHZ-02, SR-AUTHZ-05. Polityki P3, P6, P10.

## Notatki techniczne
- Moduły: `media`, `audit` + panel. Jedna operacja `download-url` dla wariantów — polityka ogranicza wariant „oryginał” per rola (i kanał — SR-AUTHZ-12).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-045 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
