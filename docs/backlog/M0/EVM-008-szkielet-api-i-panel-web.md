---
id: EVM-008
title: Chodzący szkielet — API i panel web
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
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
Spec: `ux-designer`, 2026-10-05. Wzorzec: styleguide § 3.15, § 3.16, § 3.17, § 4.8–4.13; ekran W-10 (`docs/ux/flows/07-lista-zlecen-i-filtry.md`). Propozycja doprecyzowań w changelogu styleguide'u („Propozycja do 1.3.0”).
- **Ekran i przepływ:** jeden ekran — powłoka + strona „Zlecenia” (adres `/zlecenia`, `/` przekierowuje tam). Cel: potwierdzić, że panel działa i pokazać miejsce na przyszłą listę. Główna akcja: brak (decyzja Konrada: bez „Nowe zlecenie”). Hierarchia: `h1` „Zlecenia” → EmptyState. Tytuł karty przeglądarki: „Zlecenia · EVia Manager”.
- **Powłoka (§ 3.17):** Sidebar `color.bg.brand-strong`, szer. `size.sidebar.width.expanded` (≥ `breakpoint.expanded`) / `.collapsed` (`breakpoint.medium`–<expanded, z podpowiedzią „Zlecenia”); logo/nazwa „EVia Manager” (tekst, do czasu akceptacji identyfikacji marki — nic nie wymyślamy); jedna pozycja „Zlecenia” z ikoną Lucide `clipboard-list` (`size.icon.md`), aktywna: pasek `color.brand.accent` + `font.weight.semibold` + `aria-current="page"`. TopBar `size.app-bar.height.web`, `color.bg.surface`, bez wyszukiwania i konta (jeszcze nie istnieją). Treść na `color.bg.canvas`, marginesy `grid.*.margin`.
- **Responsywność:** 1280/1440 — Sidebar rozwinięty (1440 tylko szersze marginesy); 768 — Sidebar zwinięty; 360 — Sidebar ukryty, w TopBar przycisk „Menu” (`menu`, cel ≥ `size.touch-target.min`) otwiera szufladę z pozycją „Zlecenia”; fokus wewnątrz szuflady, `Esc` zamyka i zwraca fokus; bez poziomego przewijania.
- **Pusty stan (§ 3.15, wariant bez akcji):** ikona `clipboard-list` `size.icon.2xl` `color.icon.secondary` (`aria-hidden`), tytuł `h2` `text.heading-3` „Brak zleceń”, opis `text.body` `color.text.secondary`: „Zlecenia pojawią się tutaj, gdy zostaną dodane do systemu.” Odstępy `space.stack.md`, wokół `space.stack.2xl`, wyśrodkowany w obszarze treści. Brak przycisku.
- **Pozostałe stany:** ładowanie — nie dotyczy (statyczna powłoka, brak zapytań o dane; wywołanie `GET /api/health` nie jest widoczne); błąd — przy awarii ładowania ekranu (nieobsłużony wyjątek) granica błędu z EmptyState `circle-alert`, „Coś poszło nie tak”, „Odśwież stronę i spróbuj ponownie. Jeśli problem wraca, skontaktuj się z administratorem.”, akcja „Odśwież stronę”, bez szczegółów technicznych; offline — baner § 4.10 „Brak połączenia. Panel działa po jego powrocie.” (`role="status"`), powłoka i pusty stan nadal widoczne; brak uprawnień — nie dotyczy do E1 (jedyny widok jest publiczną statyczną powłoką).
- **Mikrocopy i i18n:** wszystkie teksty z katalogu `pl` (klucze np. `nav.workOrders`, `workOrders.empty.title`, `workOrders.empty.description`, `shell.skipToContent`, `shell.menu`, `shell.offline`, `error.boundary.*`); `lang="pl"`; brak tekstów w kodzie komponentów.
- **Tokeny:** wyłącznie z `@evia/tokens` (zmienne CSS/Tailwind); zakaz zaszytych kolorów, rozmiarów, fontów (przegląd UX sprawdza diff).
- **A11y (WCAG 2.2 AA):** pierwszy element fokusowalny — „Przejdź do treści” (widoczny przy fokusie, kieruje na `main`); landmarki `header`, `nav` (`aria-label="Główna nawigacja"`), `main`, jeden `h1`; widoczny fokus `color.focus.ring-inverse` w Sidebarze, `color.focus.ring` poza nim; kontrast tekstu nawigacji `color.text.on-brand` na `color.bg.brand-strong` zgodny ze styleguide'em; obsługa klawiaturą bez pułapek; `prefers-reduced-motion` — szuflada bez animacji. Zrzuty do przeglądu: 360 / 768 / 1280 / 1440 px w `docs/ux/reviews/EVM-008/` (stan główny; szuflada na 360; stan offline).

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
- Do potwierdzenia przez Konrada na demo: adres listy w panelu to `/work-orders`, a UX/UI w starszych dokumentach mówi `/zlecenia` (QA, minor).
- Minor z przeglądu security: wyrażenia regularne redakcji logów o koszcie kwadratowym przy bardzo długich ciągach (logger.ts); do poprawy przy pierwszym endpoincie z treścią (EVM-016).
- Nie sprawdzone lokalnie (brak Dockera i Firefoksa): testy z PostgreSQL (`backend-integration`), parytet Linux, Playwright Firefox, skany — dowodem ma być CI.
- Schemathesis → EVM-016; pg-boss → pierwsze zadanie w tle lub EVM-076; Sentry, Caddy, HSTS produkcyjny → EVM-076.

## Definition of Done
- [x] AC1–AC6 spełnione i pokryte testami (`EVM-008 AC#`)
- [x] Przeglądy: code-reviewer, security-engineer, ux-designer — APPROVE (runda 2)
- [x] `CHANGELOG.md` zaktualizowany
- [ ] Demo lokalne i akceptacja Konrada; `ci-gate` z nowymi jobami `backend-integration` i `e2e-web` zielony

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-05 — podział decyzją Konrada (EVM-075): wdrożenie na staging (dawne AC6 i część AC5) → EVM-076; zależność od EVM-007 usunięta, `path: pelna`
- 2026-10-05 — start `/deliver` (ścieżka `pelna`, gałąź `feature/EVM-008-szkielet-api-i-panel-web`); EVM-075 zamknięte w tej samej gałęzi
- 2026-10-05 — backend-developer: kontrakt (`packages/contracts`), API (`apps/api`: health, guard deny-by-default, problem+json, nagłówki, logi z redakcją, migracja 0001), `postgres` w compose i job `backend-integration` gotowe (AC1, AC2, AC4 — część API); testy z PostgreSQL 18 tylko w CI
- 2026-10-05 — web-developer: panel (`apps/web`), biblioteka `packages/ui-web`, eksport `@evia/tokens/tailwind-theme.css`, lint `webUi()`, nagłówki i CSP z `apps/web/security-headers.ts`, E2E Playwright i job `e2e-web` gotowe (AC2–AC6 — część web); ścieżka `/work-orders` zamiast `/zlecenia` z UX / UI — do potwierdzenia przez `ux-designer`
- 2026-10-05 — workflow `deliver-story` (pelna, opus): 2 rundy; runda 1 — 4 blocker/major (parsowanie body przed guardem, logowanie błędów pg, podpowiedź w zwiniętym menu WCAG 1.4.13, mapowanie SR do EVM-076), poprawione; runda 2 — QA PASS (AC1–AC6), code-reviewer, security-engineer i ux-designer APPROVE
- 2026-10-05 — weryfikacja orkiestratora: format, lint, typy, build, testy z pokryciem (pnpm -r), `deps:check`, `coverage:diff` 430/430 linii i 237/237 gałęzi, `test:tools`, `docs:check` 0 błędów — zielone; `in-review`
- 2026-10-05 — Koszt: $ n/d (nie do odczytu w sesji — do uzupełnienia z `/cost`); 16 agentów w przebiegu końcowym + 1 w przebiegu planu (łącznie ok. 1,7 mln tokenów podagentów, ok. 650 wywołań narzędzi, ok. 100 min); rundy poprawek 1; ścieżka pelna; model opus; plik historyjki 8 KB (przed: ok. 3 KB) — porównanie z baseline $59 po uzupełnieniu kwoty
- 2026-10-06 — CI czerwone: `allowBuilds` bez `protobufjs` (strictDepBuilds, zależność z dockerode) i fałszywe wykrycie gitleaks w historii (db948ee, syntetyczny klucz w teście) — dodano `protobufjs: false` i wyjątek w `.gitleaksignore`
