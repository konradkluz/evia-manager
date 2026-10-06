---
id: EVM-067
title: Logowanie hasłem i kluczem dostępu, wygasanie i rotacja sesji
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-review
priority: P0
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-016]
---

# EVM-067: Logowanie hasłem i kluczem dostępu, wygasanie i rotacja sesji

## Historyjka
Jako **użytkownik panelu** chcę **zalogować się hasłem i kluczem dostępu, a po bezczynności zostać bezpiecznie wylogowany z ostrzeżeniem**, aby **codziennie wchodzić do systemu szybko, bez ryzyka, że ktoś przejmie pozostawioną sesję**.

## Kontekst
- Drugi krok ścieżki pionowej (po EVM-016). ADR-0005, P1, P2 (sesja web 60 min / 12 h), SR-AUTH-05 (jednakowe odpowiedzi, limit 20 prób/min/IP — wymagane już tutaj, konsultacja security pkt 3c).
- Blokada konta i e-maile o bezpieczeństwie — EVM-026; kod z aplikacji i kody odzyskiwania — EVM-023; limit 5 sesji — EVM-028.
- Makiety: [W-01](../../ux/flows/01-logowanie-mfa.md#w-01-logowanie), [W-02](../../ux/flows/01-logowanie-mfa.md#w-02-drugi-krok), ostrzeżenie o wygaśnięciu sesji [P-11] (styleguide 1.2.0).

## Kryteria akceptacji
**AC1 — Logowanie (SR-SESS-02, SR-WEB-06)**
- Zakładając aktywne konto z kluczem dostępu
- Gdy podaję e-mail i hasło (W-01), a potem używam klucza dostępu (W-02)
- Wtedy powstaje sesja z nowym identyfikatorem (poprzedni, jeśli był, jest nieważny), trafiam na W-10 albo na ścieżkę względną panelu z linku (adres zewnętrzny jest ignorowany), `lastLoginAt` jest zapisany, a w audycie jest zdarzenie logowania.

**AC2 — Jednakowa odpowiedź (SR-AUTH-05)**
- Zakładając złe hasło, nieistniejący e-mail, konto zaproszone albo dezaktywowane
- Gdy próbuję się zalogować
- Wtedy w każdym przypadku dostaję ten sam kod błędu i komunikat „Nieprawidłowy e-mail lub hasło.” z porównywalnym czasem odpowiedzi (test z tolerancją), e-mail zostaje w polu, a hasło jest czyszczone.

**AC3 — Limit prób z jednego adresu (SR-AUTH-05, SR-API-02)**
- Zakładając 20 prób logowania albo drugiego kroku w ciągu minuty z jednego IP
- Gdy wysyłam 21. próbę
- Wtedy API zwraca `429 rate_limited` z `Retry-After`, a W-01 pokazuje „Zbyt wiele prób logowania. Spróbuj ponownie za 1 min.” — tak samo dla konta istniejącego i nieistniejącego.

**AC4 — Drugi krok (SR-AUTH-06, SR-AUTH-09, P1)**
- Zakładając poprawne hasło
- Gdy jestem na W-02
- Wtedy Administrator widzi wyłącznie „Użyj klucza dostępu” (bez kodu z aplikacji i bez „Użyj innej metody”); nieudany albo anulowany klucz daje „Nie udało się użyć klucza dostępu…” z możliwością ponowienia; po przekroczeniu czasu na drugi krok widzę „Logowanie trwało zbyt długo. Zaloguj się ponownie.”; żądanie drugiego kroku bez poprawnego pierwszego zwraca `401`.

**AC5 — Wygasanie sesji (SR-SESS-03, P2)**
- Zakładając sesję rozpoczętą 2026-10-05 08:00 (zegar kontrolowany)
- Gdy nie ma aktywności przez 60 min albo mija 12 h od zalogowania mimo aktywności
- Wtedy następne żądanie zwraca `401 session_expired`, a W-01 pokazuje komunikat „Sesja wygasła…”.

**AC6 — Ostrzeżenie przed wygaśnięciem [P-11]**
- Zakładając zbliżający się koniec bezczynności
- Gdy pojawia się ostrzeżenie i wybieram „Przedłuż sesję”
- Wtedy bezczynność liczy się od nowa, ale sesja nie przekracza 12 h od zalogowania; szkic formularza (tylko w pamięci karty) wraca po ponownym zalogowaniu tej samej osoby w tej samej karcie, a po zalogowaniu innej osoby jest odrzucany.

**AC7 — Ciasteczko i CSRF (SR-SESS-01, SR-SESS-10)**
- Zakładając zalogowaną sesję
- Gdy sprawdzam odpowiedź logowania i żądania zmieniające stan
- Wtedy ciasteczko to `__Host-evia_session` z `HttpOnly; Secure; SameSite=Strict; Path=/`, a żądanie zmieniające stan bez poprawnego `Origin` / `Sec-Fetch-Site` / `X-CSRF-Token` zwraca `403 csrf_failed`.

**AC8 — Role i stany (SR-AUTHZ-05)**
- Zakładając fikstury Administratora, Edytora i Tylko odczyt
- Gdy każde z kont się loguje
- Wtedy każda rola wchodzi do panelu, konto bez skonfigurowanego drugiego kroku trafia na W-03 (`403 mfa_enrollment_required`), a bez połączenia W-01 pokazuje baner „Brak połączenia. Logowanie wymaga połączenia z internetem.” i wyłączony przycisk.

## Poza zakresem
- Blokada konta po 10 próbach, e-maile o blokadzie i nowej przeglądarce — EVM-026.
- Kod z aplikacji i kody odzyskiwania w W-02 — EVM-023.
- Limit 5 sesji web i lista „Moje sesje” — EVM-028. „Zapamiętaj mnie” — brak (P1).
- Logowanie w aplikacji mobilnej — od E9.

## UX / UI
- W-01, W-02 (wariant Administratora — klucz dostępu), [P-11] na wszystkich ekranach po zalogowaniu.
- Stany: pusty (fokus na „E-mail”), ładowanie (przycisk z `aria-busy`), błąd (jeden komunikat, `429`, błąd serwera § 6.4), offline (baner § 4.10), brak uprawnień (nie dotyczy przed zalogowaniem — stan konta nie jest ujawniany). Tytuł karty „Logowanie · EVia Manager”.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | logowanie hasłem i kluczem dostępu |
| Edytor | logowanie hasłem i kluczem dostępu (kod z aplikacji od EVM-023) |
| Tylko odczyt | jak Edytor |
| Niezalogowany | W-01, W-02 |

- Dane: sesja (IP pełny — P9, user agent, czasy), `lastLoginAt`, audyt logowań.
- W AC: SR-AUTH-05, SR-AUTH-06, SR-AUTH-09, SR-SESS-01, SR-SESS-02, SR-SESS-03, SR-SESS-10, SR-API-02, SR-WEB-06, SR-AUTHZ-05.
- W sekcji: SR-AUTH-14 (ścieżka web: hasło + klucz dostępu albo kod; kanał sesji `web`), SR-WEB-05 (szkice tylko w pamięci karty), SR-LOG-03, SR-LOG-06 (metryki nieudanych logowań).
- Polityki: P1, P2, P9, P10.

## Notatki techniczne
- Moduły: `identity`, `audit` + panel.
- Wygasanie liczone wstrzykiwanym zegarem; limity per IP z IP ustawianego przez Caddy (SR-API-09, EVM-008).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
**Backend (backend-developer, zrealizowany):** moduł `identity` bez zmian architektury i bez nowych zależności ani zmiennych środowiska.
- **Kontrakt** (`packages/contracts`, najpierw specyfikacja): publiczne `login` (`POST /api/v1/auth/login`), `getLoginPasskeyOptions`, `verifyLoginPasskey` oraz `extendSession` (`POST /api/v1/auth/session/extend`, wszystkie role, także `mfa_enrollment`); `CurrentSession` + `idleExpiresAt`, `absoluteExpiresAt` (addytywnie); kody `invalid_credentials`, `passkey_failed`, `login_expired`, `session_expired`.
- **Dwa kroki:** pierwszy krok (e-mail + hasło, jednakowe odpowiedzi, jedna weryfikacja Argon2id także dla nieistniejącego konta) wydaje jednorazowy `loginToken` (5 min, w bazie tylko hash) albo — dla konta bez klucza — sesję `mfa_enrollment` bez linku (nie może zarejestrować czynnika); drugi krok weryfikuje klucz konta z tokenu (userVerification wymagane, origin i RP ID z konfiguracji) i w jednej transakcji zużywa wyzwanie i token, tworzy sesję (rotacja), zapisuje `lastLoginAt` i audyt.
- **Wygasanie:** 60 min bezczynności i 12 h bezwzględnie we wszystkich stanach sesji (`401 session_expired`, audyt raz); aktywność zapisywana przez guard po dopuszczeniu żądania (co najwyżej co 30 s), odczyt sesji i `extendSession` są pasywne.
- **Migracja `0006_login`** (expand): `identity.login_attempts` (bez IP i user agenta), wyzwania także dla logowania (`login_attempt_id`), powód unieważnienia `expired`.
- **Limity i CSRF:** trzy operacje logowania w buckecie 20/min/IP (liczone przed bazą), CSRF publicznych mutacji (Origin + Sec-Fetch-Site) bez zmian.
- **Testy** (`EVM-067 AC#`): integracyjne w kontenerze `backend-tests` (`login`, `login-passkey`, `session-expiry`, `login-migration`, macierz ról z kolumną „sesja wygasła”), jednostkowe (polityka sesji, adaptery, metryki, guard).
- **Panel web (web-developer, do zrobienia po API):** W-01, W-02, P-11 (ostrzeżenie 2 min przed końcem, bez żądań podtrzymujących), szkice tylko w pamięci karty, `returnTo` walidowany przez `new URL` względem originu panelu, baner offline; wymagania security z § 4.17 styleguide'u (TM-10, SR-WEB-05).

## Decyzje
_—_

## Uwagi do rozważenia
- (code-reviewer, minor) `session-expiry-warning.tsx:67-76`: w etapie `ended` zapytania do serwera mogą iść częściej niż co 15 s (zależność efektu od `now`) — użyć `localNow`.
- (ux-designer, minor) W-02 po „Logowanie trwało zbyt długo” fokus przepada na `body` — przenieść na „Wróć do logowania”.
- (ux-designer, minor) Dowody UX niepełne: offline w 768/1280/1440 i na W-02, W-02 „klucz nie zadziałał”, P-11 błąd przedłużenia/offline, notatka z przejścia klawiaturą.
- (qa, nit) `pnpm run gate` bez przebiegu `test:integration` kończy się czerwonym `coverage:diff` (opisane w testing-strategy); rozważyć włączenie do gate.
- (qa, nit) Nieobjęte pojedyncze gałęzie: `use-now.ts`, `alert-dialog.tsx`, `draft-store.ts`.
- Przycisk „Pokaż” hasła (TextField) bez `aria-pressed` / nazwy „Pokaż hasło” wg makiety W-01 — dotyczy też W-13; poza zakresem.
- AC3 mówi o „próbach”; pobranie opcji klucza (`getLoginPasskeyOptions`) liczy się do tego samego limitu 20/min/IP, więc jedno logowanie zużywa 3 jednostki (za wspólnym NAT biura ok. 6 logowań na minutę). Rekomendacja `security-engineer` (Low, do backlogu): przenieść opcje do limitu `anonymous` (60/min).

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-067 AC#`) — QA r2: AC1–AC8 PASS
- [x] Bramki CI zielone, progi pokrycia spełnione — gate natywny + kontener zielone; coverage:diff po test:integration: linie 501/501, gałęzie 291/303 (orkiestrator powtórzył)
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE — r2: code-reviewer, security-engineer APPROVE; ux-designer APPROVE (r1)
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane (wartości sesji w dokumentacji modułu `identity`) — docs:check 0 błędów
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-016 planu wstępnego — konsultacja solution-architect W2)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-06 — ready → in-progress: start realizacji (/deliver), gałąź feature/EVM-067-logowanie-i-sesje
- 2026-10-06 — plan gotowy (backend-developer)
- 2026-10-06 — backend zaimplementowany (backend-developer): kontrakt, migracja 0006, logowanie dwukrokowe, wygasanie i przedłużanie sesji, testy `EVM-067 AC#`; panel web (W-01, W-02, P-11) czeka na web-developera
- 2026-10-06 — panel web zaimplementowany (web-developer): W-01, W-02, P-11 (`AlertDialog` w `@evia/ui-web`), `returnTo`, szkice i `loginToken` tylko w pamięci karty, E2E z inspekcją magazynów, axe i zrzuty do `docs/ux/reviews/EVM-067/`
- 2026-10-06 — przeglądy i weryfikacja QA: 2 rundy, 0 blokujących (workflow deliver-story); orkiestrator powtórzył bramkę i pokrycie → in-progress → in-review
