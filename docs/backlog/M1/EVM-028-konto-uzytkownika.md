---
id: EVM-028
title: Konto — profil, hasło, drugi krok logowania i moje sesje
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-review
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-023]
path: pelna
model: sonnet
---

# EVM-028: Konto — profil, hasło, drugi krok logowania i moje sesje

## Historyjka
Jako **użytkownik** chcę **samodzielnie zmienić nazwę, hasło i metody drugiego kroku oraz zobaczyć i zakończyć swoje sesje**, aby **dbać o bezpieczeństwo konta bez proszenia Administratora**.

## Kontekst
- SR-AUTH-03, SR-AUTH-10 (pełne ponowne uwierzytelnienie, e-mail, audyt), SR-SESS-04 (limit 5 sesji web), SR-SESS-07, SR-DATA-07 (retencja sesji — P4: 30 dni).
- Decyzja 3: Administrator rejestruje co najmniej dwa klucze dostępu (Windows Hello i telefon) — drugi klucz dodaje tutaj; konta aktywowane przed EVM-023 generują tu kody odzyskiwania.
- **Od E9:** „Moje urządzenia” (sekcja W-15 i limit 2 urządzeń mobilnych).
- Makieta: W-15 (EVM-015).

## Kryteria akceptacji
**AC1 — Profil**
- Gdy zmieniam nazwę wyświetlaną (≤ 200 znaków)
- Wtedy nowa nazwa jest widoczna w nagłówku i u innych użytkowników (tylko `id` i `displayName` — SR-DATA-03).

**AC2 — Zmiana hasła (SR-AUTH-03, SR-AUTH-10)**
- Zakładając zalogowanego użytkownika z dwiema sesjami
- Gdy zmienia hasło
- Wtedy musi podać bieżące hasło i przejść pełne ponowne uwierzytelnienie (hasło + drugi krok), nowe hasło przechodzi reguły SR-AUTH-01 i SR-AUTH-02, użytkownik dostaje e-mail „Hasło zostało zmienione”, panel proponuje „Zakończ pozostałe sesje”, a zmiana jest audytowana.

**AC3 — Metody drugiego kroku (SR-AUTH-10, SR-AUTH-15)**
- Zakładając „Drugi krok logowania” w W-15
- Gdy po pełnym ponownym uwierzytelnieniu dodaję kolejny klucz dostępu, usuwam klucz, dodaję albo usuwam kod z aplikacji
- Wtedy lista metod pokazuje nazwę i datę dodania każdego klucza, a każda zmiana wysyła e-mail na adres konta i tworzy zdarzenie audytu, a zmiana na koncie Administratora wysyła też alert bezpieczeństwa do wszystkich aktywnych Administratorów (SR-LOG-07).

**AC4 — Reguły metod**
- Zakładając Administratora z jednym kluczem dostępu albo dowolne konto z jedną metodą
- Gdy próbuje usunąć ostatni klucz (Administrator) albo ostatnią metodę
- Wtedy operacja jest odrzucona z komunikatem, co trzeba najpierw dodać.

**AC5 — Nowe kody odzyskiwania (SR-AUTH-08)**
- Gdy po pełnym ponownym uwierzytelnieniu generuję nowe kody
- Wtedy widzę 10 nowych kodów jeden raz, poprzednie przestają działać, liczba pozostałych kodów jest widoczna w W-15, a zmiana ma e-mail i audyt.

**AC6 — Moje sesje (SR-SESS-07, SR-SESS-04)**
- Zakładając 5 aktywnych sesji web użytkownika
- Gdy loguje się szósty raz
- Wtedy najstarsza sesja kończy się, a użytkownik dostaje e-mail; w W-15 widzi swoje sesje (przeglądarka, pełny IP — P9, ostatnia aktywność, oznaczenie „ta sesja”) i po ponownym uwierzytelnieniu kończy wybraną albo wszystkie pozostałe.

**AC7 — Retencja sesji (SR-DATA-07, P4)**
- Zakładając sesję wygasłą 2026-09-01 (zegar kontrolowany)
- Gdy 2026-10-02 działa zadanie retencji
- Wtedy rekord sesji jest usunięty, a raport zadania nie zawiera danych osobowych.

**AC8 — Uprawnienia i stany (SR-AUTHZ-05)**
- Zakładając dowolną rolę
- Gdy użytkownik odwołuje się do profilu albo sesji innej osoby po identyfikatorze
- Wtedy API zwraca `404 not_found`; niezalogowany dostaje `401`; offline — akcje wyłączone, dane formularza w pamięci karty; `429` — wzór z README makiet; sekcja urządzeń niewidoczna (od E9).

## Poza zakresem
- Zmiana adresu e-mail konta — poza M1 (obejście: Administrator zaprasza nowy adres i dezaktywuje stary).
- Urządzenia mobilne — od E9.

## UX / UI
- W-15 (sekcje: Profil, Hasło, Drugi krok logowania, Moje sesje), dialog pełnego ponownego uwierzytelnienia (wzorzec W-04), lista kodów jak W-03 krok 3.
- Stany: AC8; pusty (jedna sesja — „Tylko ta sesja”).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | własne konto (min. 1 klucz dostępu) |
| Edytor | własne konto |
| Tylko odczyt | własne konto |
| Niezalogowany | brak (`401`) |

- Dane: nazwa, metody MFA (SEK), sesje (IP, user agent).
- W AC: SR-DATA-03, SR-AUTH-03, SR-AUTH-10, SR-AUTH-15, SR-AUTH-08, SR-SESS-07, SR-SESS-04, SR-DATA-07, SR-AUTHZ-05.
- W sekcji: SR-AUTH-01, SR-AUTH-02, SR-CRYPTO-05, SR-LOG-03. Polityki P1, P2, P4, P9.

## Notatki techniczne
- Moduły: `identity`, `audit` (+ `platform`: zadanie retencji w pg-boss) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Skrót planu (pełny plan z kontrolami K1–K14 to plik roboczy poza gitem):
- **Pełne ponowne uwierzytelnienie:** znacznik na wierszu sesji (migracja 0041), z `POST /api/v1/account/reauthentication`; ważny 5 minut, jednorazowy, związany z sesją i celem; zużywa go warunkowy `UPDATE` w transakcji operacji docelowej; bez niego `403 reauthentication_required` (dialog W-04).
- **Licznik prób z EVM-026:** weryfikacje hasła i drugiego kroku w koncie (reauth, zmiana hasła, step-up z EVM-029) przechodzą przez `VerificationGate` → `LoginThrottle`/`LoginFailures`; trwająca blokada zakresu kończy sesję przed weryfikacją (`429`).
- **API:** `getAccount`, `updateAccount`, `changePassword`, `removePasskey`, `removeTotp`, `listAccountSessions`, `endAccountSession`, `endOtherAccountSessions` oraz gałąź dla sesji `active` w operacjach z EVM-023 (klucze, kod z aplikacji, kody odzyskiwania); własność obiektu w `WHERE` (cudzy = nieistniejący = `404`), `DELETE` bieżącej sesji = `409 current_session`.
- **Zmiana hasła:** bieżące hasło → reguły nowego → drugi krok → zapis; zdejmuje tylko blokadę z przyczyną `password`, woła `forgetBrowsers`, wysyła e-mail 4; sesje nie kończą się same (odpowiedź niesie `otherActiveSessions` dla „Zakończ pozostałe sesje”).
- **Ostatnia metoda drugiego kroku** rozstrzygana pod blokadą wiersza konta (Administrator `409 last_second_step_method`, Edytor `method_required`); limit 5 sesji (szósta kończy najstarszą, e-mail 8); retencja sesji 30 dni po wygaśnięciu (zadanie pg-boss).
- **Panel:** strona W-15 (Profil, Hasło, Drugi krok logowania, Moje sesje), dialog W-04 w trybie pełnego ponownego uwierzytelnienia, menu „Konto”.

## Decyzje
- **2026-10-20 (Konrad):** ścieżka `pelna` (uwierzytelnianie, sesje), model `sonnet`, recenzenci code + security + ux; realizacja na jednej gałęzi z EVM-026 (nakładanie plików `identity`: logowanie, sesje, hasło, drugi krok), jeden PR, demo obu historyjek razem.
- **2026-10-21 (orkiestrator, do decyzji Konrada):** ustalenie OSV dla `apps/web` (vite 8.3.2: GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw; poprawka od 8.3.3) pochodzi z `main`, nie z tej gałęzi. Naprawa osobną zmianą utrzymaniową na `main` (dokładna wersja, `pnpm add`), potem scalenie `main` do gałęzi; do tego czasu skan OSV, a z nim `ci-gate`, jest czerwony dla każdego PR. Nie poprawiamy przy okazji EVM-028 bez Twojej zgody.

## Notatki (uwagi nieblokujące z przeglądów)
- Kod i testy: `account-queries.ts` i `account.controller.ts` nie są w `DATABASE_BOUND` (`apps/api/coverage.config.ts`); `revokeOtherSessions` nie filtruje po terminach wygaśnięcia (zawyżone `ended`, szum w audycie); podwójny zapis porażki (`login.failed` i zdarzenie własne) zawyża `evia_login_failures_total`; `account-failure-alert.tsx` 56% linii, `add-passkey-dialog.tsx` 82% gałęzi (testy wariantów błędu do dopisania).
- Security: znacznik reauth leży na wierszu sesji (id sesji się nie zmienia); odświeżenie kroku 3 kodów odzyskiwania w oknie 15 minut nie wymaga pełnego reauth; blokada zakresu konta kończy sesję z przeglądarki nieznanej koncie (rozszerza RR-28, wpisane do threat-model); po usunięciu TOTP/klucza świeżość step-upu trwa do 15 minut.
- UX: tertiary „Usuń…” poniżej 48 px na 360 px; komplet zrzutów 1440 px niepełny (zrzuty są lokalne, `docs/ux/reviews/**/*.png` jest w `.gitignore`).
- Proces: `pnpm --filter @evia/web run e2e:screenshots` ma 10 błędów w specach EVM-030/032/034 (zmienione lokatory; gałąź nie dotyka work-orders; poza CI); testy niestabilne pod obciążeniem lub losowo, niezwiązane z gałęzią: `work-orders-create` (EVM-022 AC3: asercja `/TTTT|DDDD|1999/` na całym ciele trafia losowo w `traceId`), `worker-email` (EVM-024 AC5: limit czasu ponowień SMTP), `ui-web` (selectable-card, timeline: limit 5 s) — drobna historyjka utrzymaniowa.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-028 AC#`; QA: AC1–AC8 PASS)
- [x] Bramki lokalne zielone, progi pokrycia spełnione (bramka orkiestratora etapami, zob. Dziennik); bramki CI — po PR
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE (UX po poprawce listy sesji 360 px)
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (decyzja 3 — drugi klucz dostępu Administratora)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — zmiana AC zaakceptowana przez Konrada na demo EVM-015 (propozycja `product-owner`, EVM-015 → „Uwagi do rozważenia” 2; liczba AC bez zmian): AC3 — dopisany alert bezpieczeństwa dla Administratorów przy zmianie drugiego kroku konta Administratora
- 2026-10-20 — ready → in-progress: start realizacji w kolejce z EVM-026 (gałąź feature/EVM-026-ochrona-przed-zgadywaniem), pelna, sonnet
- 2026-10-20 — plan gotowy (backend-developer)
- 2026-10-20 — backend gotowy (backend-developer): API konta (9 operacji + 5 rozszerzonych), migracja 0041, licznik zgadywania w reauth/step-upie, limit 5 sesji, retencja sesji, testy AC1–AC8, dokumentacja; panel W-15 i dialog W-04 czekają na web-developera (kontrakt stabilny)
- 2026-10-21 — web gotowy (web-developer): strona W-15 (Profil, Hasło, Drugi krok logowania, Moje sesje), dialog W-04 w trybie pełnego ponownego uwierzytelnienia, menu „Konto”, testy komponentów, E2E i axe (360/768/1280/1440 px), zrzuty do przeglądu UX w `docs/ux/reviews/EVM-028/`
- 2026-10-21 — QA (qa-engineer): PASS AC1–AC8; `pnpm run gate` zielony (pokrycie zmienionego kodu: linie 94,7%, gałęzie 91,6%); `web-e2e-linux` 1170 przeszło, 2 flaky w Firefoxie (EVM-018 AC6, EVM-032 AC3/AC5 — niezwiązane); `docs:check` 0 błędów
- 2026-10-21 — przeglądy, runda 1: code-reviewer APPROVE (4 minor, 2 nit); security-engineer APPROVE (w kodzie EVM-028 brak blocker/major; major infra: vite z `main`, zob. „Decyzje”); ux-designer changes_required (major: lista sesji przy 360 px, minor: „Usuń…” poniżej 48 px). Uwagi nieblokujące → „Notatki”
- 2026-10-21 — poprawki, runda 1: web-developer — lista „Moje sesje” w jednej kolumnie przy 360 px, „Zakończ sesję” na pełną szerokość (7bf4218); `web-e2e-linux` zielony; devops-engineer — vite poza zakresem, pytanie do Konrada; workflow zakończył się `blocked`; security-engineer dopisał rozszerzenie RR-28 do threat-model (1cd5cbd)
- 2026-10-21 — ponowny przegląd UX (ux-designer): poprawka listy „Moje sesje” przy 360 px — APPROVE; uwagi nieblokujące w „Notatkach”
- 2026-10-21 — weryfikacja orkiestratora: `pnpm run gate` etapami na HEAD kodu (1cd5cbd): natywny (format, lint, typy, testy z progami, granice modułów) zielony; parytet Linux (`gate:backend`) zielony; testy integracyjne z PostgreSQL 143 pliki / 1985 testów zielone; `coverage:diff` zielony — zmieniony kod: linie 94,7% (1289/1361), gałęzie 91,6% (855/933); `docs:check` 0 błędów; `web-e2e-linux` (po poprawce UX) 1169 przeszło, 0 błędów. Przebiegi, które padły losowo lub z obciążenia (2 testy `ui-web` z limitem 5 s, `work-orders-create` przez losowy `traceId`, `worker-email` z limitem czasu), nie powtórzyły się — zob. „Notatki”
- 2026-10-21 — in-progress → in-review: demo razem z EVM-026 (decyzja 3 — drugi klucz dostępu Administratora; jedna gałąź, jeden PR); naprawa vite (OSV) osobno — zob. „Decyzje”
