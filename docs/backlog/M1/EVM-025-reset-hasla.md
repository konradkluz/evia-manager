---
id: EVM-025
title: Reset zapomnianego hasła
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: done
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
model: sonnet
depends_on: [EVM-024]
---

# EVM-025: Reset zapomnianego hasła

## Historyjka
Jako **pracownik, który zapomniał hasła** chcę **ustawić nowe hasło z linku wysłanego e-mailem**, aby **wrócić do pracy bez angażowania Administratora — a nikt obcy nie mógł tak przejąć mojego konta**.

## Kontekst
- ADR-0005, SR-AUTH-11 (token 30 min, reset nie omija MFA, kończy sesje), P2.
- **Od E9:** skutki dla urządzeń mobilnych (sesje urządzeń w trybie „Wyloguj urządzenie”, `401 session_revoked`, kolejka zostaje) — M1 ma tylko sesje web (README M1 → „Przeniesione do E9”).
- Makiety: [W-01](../../ux/flows/01-logowanie-mfa.md#w-01-logowanie) („Nie pamiętasz hasła?”), W-12 (EVM-015), W-02.

## Kryteria akceptacji
**AC1 — Prośba o link bez ujawniania kont**
- Zakładając konto istniejące, nieistniejące i dezaktywowane
- Gdy w W-01 wybieram „Nie pamiętasz hasła?” i podaję e-mail
- Wtedy w każdym przypadku widzę ten sam komunikat „Jeśli konto o tym adresie istnieje, wyślemy na nie link do ustawienia nowego hasła. Link jest ważny 30 minut.” przy porównywalnym czasie odpowiedzi, a e-mail (tylko z linkiem — SR-INPUT-07) trafia wyłącznie do aktywnego konta.

**AC2 — Token (SR-AUTH-11, SR-API-04, SR-LOG-02)**
- Zakładając link wysłany 2026-10-05 10:00 (zegar kontrolowany)
- Gdy otwieram go o 10:31 albo drugi raz po użyciu, albo po wysłaniu nowszego linku
- Wtedy widzę jeden komunikat o nieważnym linku; token ma 256 bitów, a w bazie jest tylko jego skrót
- Oraz token jest w linku wyłącznie we fragmencie adresu (`#…`); po otwarciu ważnego linku panel usuwa go z paska adresu i historii przeglądarki i wysyła wyłącznie w treści `POST`; samo otwarcie strony (np. przez skaner linków w poczcie) nie zużywa linku, a token nie występuje w logach Caddy i API, w zdarzeniach i breadcrumbach Sentry ani w historii przeglądarki (test; mechanizm z EVM-016).

**AC3 — Nowe hasło (SR-AUTH-01, SR-AUTH-02)**
- Zakładając ważny link (W-12)
- Gdy ustawiam nowe hasło
- Wtedy obowiązują te same reguły co przy aktywacji (≥ 15 znaków, lista popularnych i kontekstowych, Pwned Passwords k-anonimowo); brak pytań pomocniczych i podpowiedzi hasła.

**AC4 — Reset nie omija drugiego kroku**
- Gdy ustawiam nowe hasło
- Wtedy przechodzę do W-02 i dopiero po drugim kroku powstaje sesja.

**AC5 — Skutki resetu (SR-AUTH-15)**
- Zakładając dwie aktywne sesje web użytkownika
- Gdy reset się kończy
- Wtedy obie sesje kończą się (następne żądanie — `401 session_revoked`), użytkownik dostaje e-mail „Hasło zostało zmienione”, a powstaje zdarzenie audytu bez danych osobowych; urządzenia mobilne — od E9.

**AC6 — Limity (SR-API-02, P10)**
- Zakładając 60 żądań nieuwierzytelnionych w ciągu minuty z jednego IP
- Gdy wysyłam kolejną prośbę o link
- Wtedy API zwraca `429 rate_limited` z tym samym komunikatem dla każdego adresu.

**AC7 — Role i stany (SR-AUTHZ-05)**
- Wtedy reset działa dla każdej roli; offline — baner i wyłączony przycisk, e-mail zostaje w polu; błąd serwera — § 6.4.

## Poza zakresem
- Reset MFA (utrata drugiego kroku) — EVM-027 (przez Administratora). Skutki dla urządzeń — od E9.

## UX / UI
- W-01 (formularz „Zresetuj hasło”), W-12, W-02. Stany: AC7; brak uprawnień — nie dotyczy (przed zalogowaniem).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | reset własnego hasła (potem klucz dostępu) |
| Edytor | reset własnego hasła |
| Tylko odczyt | reset własnego hasła |
| Niezalogowany | prośba o link, W-12 z ważnym linkiem |

- Dane: token resetu (SEK — skrót), e-mail pracownika.
- W AC: SR-INPUT-07, SR-AUTH-11, SR-AUTH-01, SR-AUTH-02, SR-AUTH-15, SR-API-02, SR-AUTHZ-05; spoza listy E1: SR-API-04, SR-LOG-02 (token resetu poza ścieżką, query i logami — przegląd `security-engineer` EVM-010).
- W sekcji: SR-CRYPTO-03, SR-CRYPTO-05, SR-LOG-03. Polityka P2.

## Notatki techniczne
- Moduły: `identity`, `audit` + panel. E-mail przez kolejkę z EVM-024.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Backend (moduły `identity`, `audit`, `platform`): trzy operacje publiczne `/api/v1/auth/password-reset/{request,check,complete}` (`PasswordResetService`), wiadomości przez skrzynkę z EVM-024 (komposer `PasswordEmailComposer` w workerze, token tworzony przy wysyłce, w bazie tylko skrót), wspólny `PasswordSetting` z aktywacją, `openSecondStep` wspólny z logowaniem, migracja `0037`. Panel (W-01, W-12, W-02) — krok web-developera po kontrakcie. Szczegóły: plan roboczy wykonawcy (`.scratch/EVM-025/plan.md`).

## Decyzje
- Decyzja orkiestratora — do potwierdzenia na demo (AC4): po ustawieniu hasła API zwraca `loginToken` pierwszego kroku (jednorazowy, 5 min) i `methods` z faktycznie zarejestrowanych czynników — bez sesji i ciasteczka; sesja powstaje dopiero po `verifyLoginPasskey` w W-02. Konto bez klucza dostępu nie dostaje ani linku, ani `loginToken`, ani sesji `mfa_enrollment` (kontrola security K1).
- Decyzja orkiestratora — do potwierdzenia na demo (AC1, AC6): oprócz limitu 60/min/IP z AC6 prośby o link są ograniczone do 1 wiadomości na 60 s i 5 na godzinę na konto (cichy brak wysyłki, to samo `202`) jako ochrona skrzynki przed zalewem; podłoga czasu odpowiedzi 250 ms to ograniczenie kanału bocznego, nie gwarancja.
- Decyzja orkiestratora — do potwierdzenia na demo (AC2): ważność 30 minut liczona od wysyłki wiadomości (token tworzy worker); wiadomość czekająca w skrzynce dłużej niż 30 minut jest pomijana. Ścieżki panelu w e-mailach: `/reset-password#token` (W-12) i `/login/reset` (formularz W-01).
- Migracja `0037_password_reset` (expand): numeracja 0034 pozostaje nieużyta. Akcja audytu `password.reset` ma aktora `user` (posiadacz linku); kody powodu: dodany `password_reset`.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-025 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [x] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): token resetu tylko we fragmencie URL, otwarcie nie zużywa linku (AC2)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-16 — ścieżka `pelna` (uwierzytelnianie/uprawnienia), `model: sonnet`, realizacja lokalna z portem e-mail i Mailpit z EVM-024 — decyzja Konrada przy planowaniu kolejki 16.10
- 2026-10-16 — ready → in-progress (kolejka 025 → 023 → 027, gałąź feature/queue-2026-10-16-logowanie-2; ścieżka pełna, wykonawcy sonnet)
- 2026-10-16 — backend (API, migracja 0037, testy integracyjne i macierz ról) gotowy, lokalna bramka backendu zielona; panel (W-01, W-12, W-02) i e2e czekają na web-developera [backend-developer]
- 2026-10-16 — panel (W-01 „Zresetuj hasło”, W-12, komunikat nad W-02, wariant `success` InlineAlert), testy komponentów, Playwright (Chromium, Firefox, Edge), axe i zrzuty gotowe [web-developer]
- 2026-10-16 — przegląd r1: code-reviewer, security-engineer, ux-designer — APPROVE; QA: AC1–AC7 pass; bramka `pnpm run gate` zielona; in-progress → in-review (czeka na demo) [orkiestrator]
- 2026-10-20 — demo/akceptacja Konrada → in-review → done
