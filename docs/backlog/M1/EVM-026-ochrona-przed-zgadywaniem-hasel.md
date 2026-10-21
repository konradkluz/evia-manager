---
id: EVM-026
title: Ochrona przed zgadywaniem haseł i powiadomienia o bezpieczeństwie konta
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-review
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024]
path: pelna
model: sonnet
---

# EVM-026: Ochrona przed zgadywaniem haseł i powiadomienia o bezpieczeństwie konta

> **Refinement 2026-10-20:** AC przepisane wg decyzji Konrada z 2026-10-20 (hybryda z ciasteczkiem przeglądarki, licznik w PostgreSQL, reset hasła, alerty lokalnie, ustalenia security H1/H3) i decyzji z 2026-10-19 (RR-26). Zmiany zaakceptowane przez Konrada 2026-10-20 (decyzje przekazane przez orkiestratora).

## Historyjka
Jako **użytkownik i Administrator** chcemy **blokady zgadywania haseł oraz powiadomień o podejrzanych zdarzeniach na koncie**, aby **przejęcie konta było trudne, a próba — szybko zauważona**.

## Kontekst
- SR-AUTH-05 (opóźnienia po 5 próbach, blokada 15 min po 10 próbach w 15 min z e-mailem), SR-AUTH-15 (powiadomienia), SR-LOG-07 (alerty), AB-01. Jednakowe odpowiedzi i limit 20 prób/min/IP — od EVM-067.
- **Co już istnieje (EVM-067, -023, -024, -025, -027) — rozszerzamy, nie powtarzamy:** wspólny limit 20/min/IP dla logowania i MFA; `loginToken` kończący się po 5 porażkach drugiego kroku (`LOGIN_MAX_FAILED_SECOND_STEPS`, `openLoginAttempt` / `recordSecondStepFailure`); jedno miejsce zapisu porażek (`LoginFailures`: audyt `login.failed` z `reasonCode` + metryka `evia_login_failures_total{reason}`); kolejka `email` z outboxem, port e-mail, szablony w `email-templates.ts`; limit wiadomości resetu hasła (1/60 s i 5/h na konto, EVM-025); reset hasła kończy wszystkie sesje; szkielet alertów w `platform/alerts/security-alerts.ts`.
- Treści e-maili 3 (blokada), 7 (nowa przeglądarka) i wariant alertu 9 są w [e-maile.md](../../ux/flows/e-maile.md) (EVM-015) — wymagają aktualizacji (wariant blokady z drugiego kroku; blokada z porażek hasła zdejmowana resetem, z drugiego kroku nie).
- **Od E9:** logowanie z nowego urządzenia mobilnego — w M1 „nowe urządzenie” oznacza przeglądarkę, z której konto nie logowało się wcześniej.
- Makiety: [W-01](../../ux/flows/01-logowanie-mfa.md#w-01-logowanie), [W-02](../../ux/flows/01-logowanie-mfa.md#w-02-drugi-krok).

## Kryteria akceptacji
**AC1 — Licznik porażek i rosnące opóźnienie (SR-AUTH-05)**
- Zakładając porażki logowania `bad_password`, `unknown_user`, `not_active`, `totp_failed`, `recovery_code_failed` oraz `passkey_failed` (wyłącznie odrzucona asercja) — a nie `login_expired` ani `mfa_setup_expired`
- Gdy dla jednego klucza (zob. AC2) zbierze się 5 porażek i następuje kolejna próba (pierwszego albo drugiego kroku)
- Wtedy odpowiedź jest opóźniona wykładniczo (1, 2, 4, 8 s, najwyżej 10 s), identycznie dla konta istniejącego, nieistniejącego i nieaktywnego, a oczekiwanie odbywa się poza transakcją bazy.
- Klucz konta to HMAC(klucz serwera, znormalizowany e-mail), jednakowy dla `unknown_user`, `not_active` i `bad_password`; licznik w PostgreSQL, zapis atomowy (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), retencja do 30 min po końcu okna; w bazie nie ma e-maila ani zwykłego hasha e-maila.
- Testy `EVM-026 AC1` dla każdego liczonego kodu i dla kodów nieliczonych.

**AC2 — Blokada: hybryda z ciasteczkiem przeglądarki**
- Zakładając 10 liczonych porażek w 15 min (zegar kontrolowany: 2026-10-05 09:00–09:10) z przeglądarek nieznanych koncie (bez ciasteczka albo z nieznanym)
- Gdy o 09:12 następuje próba z nieznanej przeglądarki z poprawnym hasłem
- Wtedy jest odrzucona jako `429 rate_limited` z `Retry-After`, W-01 pokazuje „Zbyt wiele prób logowania. Spróbuj ponownie za 15 min.”, treść i czas odpowiedzi są takie same jak przy limicie IP i dla nieistniejącego konta (zawsze dokładnie jedna weryfikacja Argon2, niezależnie od poprawności hasła), a o 09:26 logowanie znów działa.
- Znana przeglądarka (ciasteczko z AC5) ma własny licznik 10/15 min na parę konto + ciasteczko: blokada nieznanych przeglądarek jej nie dotyczy i loguje się w jej trakcie; jej własna blokada działa tak samo jak powyżej. To samo dotyczy drugiego kroku.
- Test współbieżności `EVM-026 AC2`: 20 równoległych błędnych prób → dokładnie jedna blokada i jeden e-mail.

**AC3 — Blokada obejmuje drugi krok (H1; RR-26)**
- Zakładając blokadę dla danej przeglądarki, porażki `totp_failed`, `recovery_code_failed` (i `passkey_failed`) wliczone do 10 z AC2, oraz otwarte `loginToken`
- Gdy następuje blokada albo próba drugiego kroku (kod z aplikacji, kod odzyskiwania, klucz dostępu) w jej trakcie
- Wtedy blokada jest sprawdzana także w `openLoginAttempt`, otwarte `loginToken` konta są unieważniane w chwili blokady, próba z poprawnym kodem jest odrzucona identyczną odpowiedzią `429` jak w AC2, a sesja nie powstaje.
- Testy `EVM-026 AC3` osobno dla `totp_failed` i `recovery_code_failed` (wygaszają RR-26).

**AC4 — E-mail i audyt blokady (SR-AUTH-15)**
- Gdy konto zostaje zablokowane
- Wtedy użytkownik dostaje e-mail 3: jeden na okres blokady, najwyżej 3 na dobę, bez danych klientów (SR-INPUT-07); blokada z porażek drugiego kroku ma osobny wariant („ktoś zna Twoje hasło”). Odnośnik prowadzi do formularza „Zresetuj hasło” — bez tokenu resetu. Powstaje zdarzenie audytu blokady z przyczyną i bez danych osobowych.

**AC5 — Ciasteczko przeglądarki i nowa przeglądarka (SR-AUTH-15)**
- Zakładając pełne logowanie (po drugim kroku, z sesją)
- Gdy przeglądarka nie ma ciasteczka `__Host-evia_device` znanego koncie
- Wtedy użytkownik dostaje e-mail 7 (bez ciasteczka każde logowanie to e-mail, bez limitu), a dla konta Administratora wszyscy Administratorzy dostają alert 9 „nowa przeglądarka” (SR-LOG-07).
- Ciasteczko: HttpOnly, Secure, SameSite=Strict, 256 bitów losowych, ustawiane po pełnym logowaniu i rotowane przy każdym; w bazie tylko SHA-256, `user_id`, `created_at`, `last_seen_at`; retencja 30 dni od ostatniego użycia; kasowane przy dezaktywacji konta, resecie drugiego kroku i resecie hasła; bez UA, IP i geolokalizacji w rekordzie. Nie służy do pomijania MFA ani uwierzytelniania.

**AC6 — Alerty bezpieczeństwa lokalnie (SR-LOG-07, SR-LOG-06)**
- Zakładając progi w konfiguracji (domyślnie: >30 porażek hasła i nieznanych kont w 5 min — poziom warning; ≥3 porażki drugiego kroku jednego konta w 15 min — critical)
- Gdy próg zostaje przekroczony albo następuje blokada konta
- Wtedy aplikacja emituje jedno zdarzenie alertu (`alert: "security"`, `alertCode`; `platform/alerts/security-alerts.ts`) bez danych osobowych oraz zwiększa nową metrykę `evia_account_lockouts_total` (etykiety bez PII), jedno zdarzenie na przekroczenie. Dostarczenie i test na staging — poza tą historyjką.

**AC7 — Odblokowanie i uprawnienia (SR-AUTHZ-05)**
- Gdy konto jest zablokowane z powodu porażek hasła i kończy się reset hasła z EVM-025
- Wtedy reset zeruje blokadę z porażek hasła, ale nie z porażek drugiego kroku; sama prośba o reset nie odblokowuje i działa w trakcie blokady. Ochrona dotyczy wszystkich ról; odblokowanie przez Administratora nie istnieje (konto odblokowuje upływ czasu albo reset w tym zakresie).

**AC8 — Bez barier dostępności**
- Gdy użytkownik loguje się po blokadzie
- Wtedy nie ma CAPTCHA ani testów poznawczych (WCAG 3.3.8), a komunikaty są w `role="alert"`.

## Poza zakresem
- Logowanie z nowego urządzenia mobilnego — od E9. Ręczne odblokowanie przez Administratora — poza M1.
- **Test dostarczenia alertu na staging** — [EVM-085](../M0/EVM-085-obserwowalnosc-alerty-koszty-staging.md) AC2/AC5 (kanał) i [EVM-076](../M0/EVM-076-szkielet-na-staging.md) (test dymny); bez `depends_on` na EVM-007.
- E-maile o zmianie hasła/MFA (EVM-025, -023, -027, -028) i zakończeniu najstarszej sesji (EVM-028).

## UX / UI
- W-01, W-02 — komunikat blokady identyczny jak `429`. Stany: błąd (AC2), offline (baner), pozostałe jak EVM-067. Ciasteczko urządzenia nie ma widocznej funkcji („Zapamiętaj mnie” nadal nie ma); wpis w polityce prywatności / W-19 (DO-P).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | jak każde konto; dodatkowo dostaje alerty |
| Edytor | jak każde konto |
| Tylko odczyt | jak każde konto |
| Niezalogowany | W-01 |

- Dane (DO-P): liczniki prób (klucz HMAC e-maila, para konto + skrót ciasteczka), rejestr przeglądarek konta (SHA-256 ciasteczka, daty). Zapis HMAC e-maila świadomie łamie dotychczasową zasadę z `login-failures.ts` („nie zapisujemy nawet hasha e-maila”) — decyzja Konrada 2026-10-20; wpis w `rodo.md`, komentarz w kodzie do aktualizacji.
- W AC: SR-AUTH-05, SR-INPUT-07, SR-AUTH-15, SR-LOG-07, SR-LOG-06, SR-AUTHZ-05. W sekcji: SR-API-02, SR-LOG-03. Polityki P2, P9, P10.
- RR-26 (threat-model, sekcja 8): wdrożenie AC1–AC3 je wygasza.

## Notatki techniczne
- Moduły: `identity`, `audit` + panel. `devops-engineer`: definicje reguł i metryk alertu w repozytorium, lokalnie testowalne (ADR-0013).
- Mechanizm opisany w dokumentacji modułu `identity` (wymóg SR-AUTH-05); jedno miejsce zapisu porażek (`LoginFailures`).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje i ograniczenia
- **2026-10-19 (Konrad, RR-26):** porażki drugiego kroku liczą się do opóźnienia i blokady — AC1–AC3.
- **2026-10-20 (Konrad), P1 — DoS cudzego konta:** model hybrydowy z ciasteczkiem: porażki z nieznanych przeglądarek blokują tylko nieznane przeglądarki konta; znana przeglądarka ma własny licznik i loguje się w trakcie blokady (AC2). Blokada per IP — bez zmian (limit 20/min/IP).
- **P2 — reset hasła:** zakończony reset zeruje blokadę z porażek hasła, nie z drugiego kroku; sama prośba o reset nie odblokowuje; link z e-maila o blokadzie bez tokenu (AC4, AC7).
- **P3 — nowa przeglądarka i RODO:** ciasteczko `__Host-evia_device` (AC5); wpis do polityki prywatności / W-19 i `rodo.md` (DO-P).
- **P4 — zakres porażek:** do licznika wchodzą `bad_password`, `unknown_user`, `not_active`, `totp_failed`, `recovery_code_failed`, `passkey_failed` (tylko odrzucona asercja); nie `login_expired`, `mfa_setup_expired` (AC1). Licznik po HMAC e-maila w PostgreSQL (AC1).
- **P5 — alerty:** progi i metryka w AC6; test dostarczenia na staging w EVM-085/076.
- **2026-10-20 (wykonawca, do akceptacji Konrada na demo):** blokada kończy otwarte `loginToken` wyłącznie zablokowanego zakresu (konto dla przeglądarek nieznanych albo jedna przeglądarka znana), nie wszystkie tokeny konta — zawężenie brzmienia AC3 wynikające z hybrydy AC2 (inaczej atakujący blokujący zakres nieznany zrywałby drugi krok właściciela ze znanej przeglądarki); testy `EVM-026 AC3` w obu kierunkach. Ponadto: próba rezerwowana atomowo przed weryfikacją; tokeny sprzed migracji 0040 mają ścieżkę zgodności; reset hasła kasuje rejestr przeglądarek konta.
- **Ścieżka `pelna`:** uwierzytelnianie, dane osobowe, antyenumeracja, ochrona przed DoS konta. **Model `sonnet`:** rozszerza istniejące klocki; przy trudnej serializacji liczników orkiestrator może podnieść plan do `opus`.
- **Zależności:** `depends_on: [EVM-024]` (port e-mail/outbox) bez zmian; brak zależności od EVM-007/085.

## Notatki (uwagi nieblokujące z przeglądów)
- UX: komunikat 429 zaokrągla czas do 1 min także dla opóźnień < 60 s; W-02 nie przenosi fokusu na alert blokady (jak W-01); żargon „zapomnimy przeglądarki konta” w e-mailu 3 — kandydaci do backlogu.
- Kod: martwe `ThrottleTicket.reserved` i `'spike'` w `#lock`; `#scopeOf` zawsze `account` (audyt błędnego typu, gdy wiersz znanej przeglądarki zniknie w trakcie); brak indeksu na `login_attempts.throttle_key`; jedno ciasteczko na przeglądarkę — dwie osoby na wspólnym komputerze nadpisują sobie rejestr (e-mail 7 przy każdym logowaniu).
- Security: limit 3 e-maili na dobę ma wąski wyścig; alert `account_locked` także dla nieistniejących adresów — agregacja w EVM-085; klauzula polityki nie wymienia pierwszych kroków logowania (jest w `rodo.md`).
- Proces: filtr po wzorcu w `test:integration` nie zawęża przebiegu — pojedynczy plik: `pnpm --filter @evia/api exec vitest run --config vitest.integration.config.ts <plik>` w kontenerze.

## Uwagi do rozważenia
- Ten sam licznik i ta sama kolejność decyzji powinny obsłużyć logowanie mobilne w E9 — bez rozdwajania mechanizmu.

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-026 AC#`; AC1–AC3 dla `bad_password`, `totp_failed`, `recovery_code_failed`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [x] Dokumentacja i `CHANGELOG.md` zaktualizowane; dokumentacja modułu `identity` (SR-AUTH-05), komentarz `login-failures.ts`, `e-maile.md` (wariant blokady, reset)
- [x] Model zagrożeń: RR-26 wygaszone (przeniesione do zamkniętych, z odwołaniem do testów AC3); nowe pozycje TM/RR: wymuszona blokada kont, enumeracja przez blokadę, rozproszony credential stuffing poniżej progu
- [x] `rodo.md` (DO-P: licznik HMAC e-maila, rejestr przeglądarek) i polityka prywatności / W-19 zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-19 — dopisano propozycję zmiany AC do „Uwag do rozważenia” (porażki drugiego kroku z EVM-023 w blokadzie konta; RR-26) — do potwierdzenia przy refine
- 2026-10-20 — refinement: zmiany AC zaakceptowane przez Konrada 2026-10-20 (decyzje przekazane przez orkiestratora): hybryda z ciasteczkiem `__Host-evia_device`, licznik HMAC w PostgreSQL, reset hasła, alerty lokalnie, ustalenia security H1/H3, RR-26 w AC1–AC3; dodane `path: pelna`, `model: sonnet`; pytania P1–P5 rozstrzygnięte; 8 AC; status `ready`
- 2026-10-20 — ready → in-progress: start realizacji (/deliver, ścieżka pelna, model sonnet), gałąź feature/EVM-026-ochrona-przed-zgadywaniem
- 2026-10-20 — plan gotowy (backend-developer)
- 2026-10-20 — implementacja (backend-developer): migracja 0040, licznik HMAC z rezerwacją próby, opóźnienie i blokada hybrydowa (hasło + drugi krok), ciasteczko `__Host-evia_device` z rejestrem przeglądarek, e-maile 3 i 7, alert 9, audyt, alerty i metryka, zadanie retencji; ustalenia security M1–M6 wdrożone; AC8 bez zmian w web (test komunikatu); dokumentacja, TM/RR (RR-26 zamknięte, RR-28–31), rodo, CHANGELOG
- 2026-10-20 — devops-engineer: przegląd wdrożeniowy (LOGIN_THROTTLE_KEY w `.env.example`, `rotacja-sekretow.md`, walidacja startu w prod), bramka lokalna `pnpm run gate`
- 2026-10-20 — implementacja (backend-developer, web-developer, devops-engineer; workflow deliver-story, sonnet) i weryfikacja QA: AC1–AC8 PASS
- 2026-10-20 — przeglądy runda 1: code-reviewer, security-engineer, ux-designer — CHANGES (0 blocker; major: e-mail 3 dla przeglądarki znanej, test zakresu loginToken, polityka prywatności/W-19); poprawki w 7 commitach
- 2026-10-20 — runda 2 (węższa): wszyscy APPROVE; bramka orkiestratora zielona (gate: 1900 testów integracji; coverage:diff 348/348 linii, 185/191 gałęzi; docs:check 0). Status in-review; demo razem z EVM-028 (jedna gałąź)
- 2026-10-21 — Koszt kolejki A (EVM-026 + EVM-028): brak rozbicia w dolarach (nie odczytane z /usage; do uzupełnienia z /cost); subagenci workflow w zachowanych licznikach ok. 2,65 mln tokenów (EVM-026 przebieg wstępny 0,74 mln; EVM-028 przerwany limitem sesji 0,90 mln i wznowiony 1,01 mln), 18 agentów, 899 wywołań narzędzi, rundy poprawek: EVM-026 2, EVM-028 1; bez liczników przebiegów poprawek EVM-026 i bez bramek orkiestratora; ścieżka pelna; sonnet; pliki historyjek 15,7 KB (EVM-026) i 11,2 KB (EVM-028) przed uzupełnieniem; vs baseline: brak danych
