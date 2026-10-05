---
id: EVM-008
title: Chodzący szkielet — API i panel web
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: backend-developer
contributors: [web-developer]
path: pelna
model: opus
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-003, EVM-006]
---

# EVM-008: Chodzący szkielet — API i panel web

## Historyjka
Jako **zespół** chcemy **minimalnej działającej ścieżki panel web → API → baza, uruchamianej lokalnie i w CI**, aby **każda kolejna historyjka była małym, pionowym przyrostem**.

## Kontekst
Stack: ADR-y z EVM-001. Styleguide i tokeny: EVM-003. CI: EVM-006. Wdrożenie na staging (dawne AC6 i część AC5 „po wdrożeniu”) wydzielono do EVM-076 decyzją Konrada 2026-10-05, żeby pierwszy kod nie czekał na płatną infrastrukturę (EVM-007).

## Kryteria akceptacji
**AC1 — API**
- Wtedy API ma endpoint zdrowia (bez danych wrażliwych), który zwraca też minimalną wspieraną wersję aplikacji mobilnej, oraz pierwszą migrację bazy; testy integracyjne działają na bazie w kontenerze.

**AC2 — Kontrakt**
- Wtedy specyfikacja API jest źródłem prawdy, a klient dla panelu web jest z niej generowany w buildzie.

**AC3 — Powłoka panelu**
- Gdy otwieram panel
- Wtedy widzę układ wg styleguide'u (nawigacja z pozycją „Zlecenia”) i stronę z pustym stanem „Brak zleceń”; style wyłącznie z tokenów, teksty przez i18n (pl).

**AC4 — Bezpieczeństwo bazowe**
- Wtedy panel i API wysyłają nagłówki bezpieczeństwa i CSP
- Oraz gdy wysyłam nieuwierzytelnione żądanie do dowolnego zasobu poza endpointem zdrowia
- Wtedy API odpowiada 401 (deny-by-default gotowe na epik E1).

**AC5 — E2E**
- Wtedy test dymny E2E (otwarcie panelu, widoczny pusty stan) działa lokalnie i w CI.

**AC6 — Jakość**
- Wtedy bramki CI są zielone, progi pokrycia spełnione, a przegląd UX powłoki obejmuje zrzuty 360 / 768 / 1280 / 1440 px.

## Poza zakresem
Logowanie i użytkownicy (M1, E1), dane zleceń, wdrożenie na staging (EVM-076).

## UX / UI
Powłoka aplikacji i pusty stan wg styleguide'u v1 i makiet EVM-004 (jeśli gotowe).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Niezalogowany | tylko endpoint zdrowia i statyczna powłoka panelu |

## Notatki techniczne
_—_

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
- 2026-10-05 — Konrad: model wykonawców `opus` (szkielet ustanawia wzorce całego produktu).
- 2026-10-05 — Konrad (plan): (1) pusty stan: tytuł „Brak zleceń”, krótki opis od `ux-designer`, bez przycisku „Nowe zlecenie” (wariant dopisany do W-10); (2) `GET /api/health` → `{status:'ok', minSupportedAppVersion:{android, ios}}` ze zmiennych środowiska, 503 problem+json bez szczegółów; `meta/client-config` i 426 → EVM-009; (3) zakres bezpieczeństwa wąski: tylko to, czego wymagają AC; (4) nagłówki panelu z jednego pliku w `apps/web` przez `vite preview` (Caddy w EVM-076), `postgres` w `compose.yaml` i joby `backend-integration` i `e2e-web` w CI w tej historyjce, bez oasdiff i jobu Windows.

## Uwagi do rozważenia
- Odroczone z planu: limit treści 1 MB, 415, 405/TRACE, `x-extensible-enum`, lint `channels` → EVM-016 i dalej; CSRF i limity per użytkownik → EVM-016/EVM-067; macierz ról z IDOR → EVM-016; 426 → EVM-009.
- Schemathesis → EVM-016; pg-boss → pierwsze zadanie w tle lub EVM-076; Sentry, Caddy, HSTS produkcyjny → EVM-076.

## Definition of Done
- [ ] AC1–AC6 spełnione i pokryte testami (`EVM-008 AC#`)
- [ ] Przeglądy: code-reviewer, security-engineer, ux-designer — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo lokalne i akceptacja Konrada

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-05 — podział decyzją Konrada (EVM-075): wdrożenie na staging (dawne AC6 i część AC5) → EVM-076; zależność od EVM-007 usunięta, `path: pelna`
- 2026-10-05 — start `/deliver` (ścieżka `pelna`, gałąź `feature/EVM-008-szkielet-api-i-panel-web`); EVM-075 zamknięte w tej samej gałęzi
