---
id: EVM-016
title: Pierwszy Administrator — aktywacja konta hasłem i kluczem dostępu, wylogowanie
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-progress
priority: P0
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-008, EVM-014, EVM-015]
---

# EVM-016: Pierwszy Administrator — aktywacja konta hasłem i kluczem dostępu, wylogowanie

## Historyjka
Jako **Konrad (pierwszy Administrator)** chcę **aktywować swoje konto jednorazowym linkiem wygenerowanym na serwerze — z hasłem i kluczem dostępu — oraz wylogować się**, aby **bezpiecznie wejść do panelu bez kont domyślnych i bez haseł przekazywanych w poleceniach**.

## Kontekst
- Pierwszy krok ścieżki pionowej (README M1 → „Kolejność”). Logowanie przy kolejnych wejściach — EVM-067.
- ADR-0005 (uwierzytelnianie, MFA), P1 (passkey obowiązkowy dla Administratora), SR-AUTH-12 (bootstrap), RR-16 (tryb awaryjny), uwaga 3 z rundy 3 EVM-005 (awaryjny reset kończy sesje).
- Ustanawia zdolności przekrojowe: dziennik audytu tylko do dopisywania, model 4 ról × kanał z fiksturami testowymi, generowaną macierz ról z przypadkiem IDOR i testem kompletności (EVM-008 AC4 obejmuje tylko `401`), wstrzykiwany zegar `Europe/Warsaw`.
- Makiety: [W-13](../../ux/flows/README.md#ekrany) (EVM-015), [W-03](../../ux/flows/01-logowanie-mfa.md#w-03-konfiguracja-mfa), powłoka panelu z pustym W-10 (EVM-008).

## Kryteria akceptacji
**AC1 — Link aktywacyjny z polecenia na serwerze (SR-AUTH-12, SR-LOG-02)**
- Zakładając, że w systemie nie ma aktywnego Administratora
- Gdy osoba z dostępem SSH uruchamia polecenie aktywacji z adresem e-mail w terminalu interaktywnym (`docker exec -it`; bez hasła w argumentach i zmiennych środowiskowych)
- Wtedy polecenie wypisuje jednorazowy link ważny 72 h z tokenem wyłącznie we fragmencie adresu (`#…` — README M1 → „Zasady wspólne” → „Bezpieczeństwo i dane”; w bazie tylko skrót tokenu), konto ma status „Oczekuje na aktywację” (`invited`) i rolę Administrator, a w audycie jest zdarzenie wydania linku bez adresu e-mail; API nie ma endpointu „setup”, a polecenie nie wysyła e-maili
- Oraz polecenie uruchomione bez terminala interaktywnego (TTY) kończy się odmową bez wydania linku, a token nie występuje w logach kontenera (`docker logs`) ani w logach zebranych przez Alloy (test).

**AC2 — Blokada polecenia i tryb awaryjny (RR-16)**
- Zakładając aktywnego Administratora
- Gdy polecenie jest uruchomione bez trybu awaryjnego
- Wtedy kończy się odmową bez zmian w bazie
- Oraz gdy jest uruchomione w trybie awaryjnym (jawna flaga i powód) dla wskazanego konta Administratora, wtedy konto wraca do stanu „wymaga aktywacji” (hasło i drugi krok do ponownego ustawienia), wszystkie jego sesje web kończą się (`401 session_revoked`), powstaje zdarzenie audytu i alert bezpieczeństwa w kanale alertów z EVM-007 (SR-LOG-07).

**AC3 — Hasło przy aktywacji (SR-AUTH-01, SR-AUTH-02, SR-ERR-02)**
- Zakładając ważny link (W-13)
- Gdy ustawiam hasło
- Wtedy hasło krótsze niż 15 znaków, z listy popularnych, ze słowem kontekstowym (np. „eviacharge2026”) albo z wycieku (Pwned Passwords — wyłącznie k-anonimowo) jest odrzucone z komunikatem; hasło ≥ 15 dowolnych znaków Unicode jest przyjęte, a wklejanie i menedżer haseł działają; przy niedostępnym Pwned Passwords sprawdzenie odbywa się lokalnie z wpisem w logu i aktywacja jest możliwa.

**AC4 — Klucz dostępu obowiązkowy (SR-AUTH-06, SR-AUTH-09, P1)**
- Zakładając ustawione hasło
- Gdy przechodzę do W-03
- Wtedy jedyną metodą jest klucz dostępu (bez wyboru kodu z aplikacji), każde inne żądanie API zwraca `403 mfa_enrollment_required`, a po rejestracji klucza (weryfikacja originu i RP ID, `userVerification: required`) konto jest aktywne, link przestaje działać, powstaje sesja z nowym identyfikatorem i widzę powłokę panelu z pustym W-10.

**AC5 — Otwarcie linku i link nieważny (SR-API-04, SR-LOG-02)**
- Zakładając ważny link
- Gdy go otwieram
- Wtedy panel zaraz po wczytaniu usuwa token z paska adresu i historii przeglądarki, a token trafia do serwera wyłącznie w treści żądania `POST`; samo otwarcie strony nie zużywa linku (np. skaner linków w poczcie go nie „spali”), a token nie występuje w logach Caddy i API, w zdarzeniach i breadcrumbach Sentry ani w historii przeglądarki (test)
- Oraz gdy link jest użyty, zmieniony albo wygasły (zegar kontrolowany: link wydany 2026-10-01 10:00, otwarty 2026-10-04 10:01), widzę jeden komunikat „Link jest nieważny lub wygasł.” bez informacji o koncie, a baza się nie zmienia.

**AC6 — Wylogowanie (SR-SESS-05)**
- Zakładając zalogowanego Administratora
- Gdy wybieram „Wyloguj” z menu konta (dostępne na każdym ekranie)
- Wtedy sesja jest unieważniona w bazie, odpowiedź ma `Clear-Site-Data: "cache", "storage"`, pamięć podręczna zapytań w karcie jest wyczyszczona, a żądanie ze starym ciasteczkiem zwraca `401 session_revoked`.

**AC7 — Audyt tylko do dopisywania (SR-LOG-03, SR-LOG-04)**
- Zakładając zdarzenia wydania linku, aktywacji, rejestracji klucza, wylogowania i trybu awaryjnego
- Gdy przeglądam tabelę audytu w teście
- Wtedy każde zdarzenie ma: kto, co, kiedy (UTC), skąd (IP z prefiksem /24 lub /48 — P9), wynik i `traceId`, bez e-maila i haseł; rola `evia_app` nie może wykonać `UPDATE`, `DELETE` ani `TRUNCATE` na schemacie `audit`, a trigger odrzuca zmiany (test uprawnień bazy).

**AC8 — Macierz ról i kanałów (SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12)**
- Zakładając fikstury testowe dla ról Administrator, Edytor, Tylko odczyt i niezalogowany oraz kanałów `web` i `mobile`
- Gdy CI uruchamia testy
- Wtedy macierz ról generowana z kontraktu obejmuje 100% operacji (test kompletności) z przypadkiem IDOR, niezalogowany dostaje `401` dla każdej operacji poza publicznymi (zdrowie, `client-config`, aktywacja z linku), a lint odrzuca operację z `channels` zawierającym `mobile` (warunek odroczenia „od E9”).

## Poza zakresem
- Logowanie przy kolejnych wejściach i wygasanie sesji — EVM-067.
- Kod z aplikacji i kody odzyskiwania — EVM-023; do tego czasu odzyskanie dostępu Administratora tylko trybem awaryjnym (AC2).
- Drugi klucz dostępu — EVM-028. Zaproszenia i e-maile — EVM-024. Step-up — EVM-029.
- Urządzenia mobilne i logowanie w aplikacji — od E9 (M2).

## UX / UI
- W-13 „Ustaw hasło” (makieta z EVM-015 — ten sam ekran co przyjęcie zaproszenia), W-03 w wariancie Administratora (tylko klucz dostępu, bez kroku kodów odzyskiwania do EVM-023), stan blokujący [P-5], powłoka z pustym W-10, menu konta z „Wyloguj”.
- Stany: ładowanie (przycisk w stanie ładowania, „Postępuj zgodnie z instrukcją systemu.”), błąd (hasło, nieudany klucz, link nieważny), offline (baner § 4.10, dane w pamięci karty), brak uprawnień (`403 mfa_enrollment_required` → W-03), pusty (W-10 „Nie masz jeszcze zleceń.”).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | aktywacja własnego konta z linku; wylogowanie |
| Edytor | nie dotyczy — konta powstają w EVM-024 (fikstury testowe w macierzy) |
| Tylko odczyt | nie dotyczy — jw. |
| Niezalogowany | strona aktywacji tylko z ważnym linkiem; zdrowie i `client-config` |

- Dane: `User` (e-mail, nazwa wyświetlana — DO-P), dane uwierzytelniające (SEK), sesja (IP, user agent), zdarzenia audytu.
- W AC: SR-AUTH-01, SR-AUTH-02, SR-AUTH-06, SR-AUTH-09, SR-AUTH-12, SR-SESS-05, SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12, SR-LOG-03, SR-LOG-04, SR-LOG-07, SR-ERR-02; spoza listy E1: SR-API-04, SR-LOG-02 (token linku poza ścieżką, query i logami — przegląd `security-engineer` EVM-010; CWE-598, CWE-532).
- W sekcji: SR-AUTH-04 (Argon2id), SR-AUTH-14 (jedyne ścieżki uwierzytelnienia, brak obejść), SR-SESS-01 (identyfikator sesji, ciasteczko `__Host-evia_session`), SR-SESS-02, SR-SESS-10 (CSRF dla aktywacji i wylogowania), SR-AUTHZ-06 (reguła rola × kanał w `identity`: Tylko odczyt bez kanału `mobile`), SR-API-13 (ruch wychodzący tylko do Pwned Passwords z listy dozwolonych), SR-WEB-05, SR-DATA-01, SR-DATA-03, SR-CRYPTO-01, SR-CRYPTO-03, SR-CRYPTO-05, SR-LOG-06.
- Polityki: P1, P2, P9, P12.

## Notatki techniczne
- Moduły: `identity`, `audit`, `authorization` (+ `platform`: wstrzykiwany zegar — pierwsze użycie) + panel.
- Polecenie aktywacji działa w kontenerze API na serwerze; brak endpointu „setup” (SR-AUTH-14). Link wypisuje wyłącznie na TTY (`docker exec -it`), nigdy na standardowe wyjście zbierane do logów kontenera (`docker compose run` bez TTY → odmowa).
- Zdolność przekrojowa: token linków jednorazowych (aktywacja, zaproszenie, reset hasła) wyłącznie we fragmencie URL, usuwany z paska adresu (`history.replaceState`), wysyłany w treści `POST`; otwarcie strony go nie zużywa — używają EVM-024 i EVM-025.
- Zdolności przekrojowe wprowadzane tutaj: audyt append-only (`evia_app` tylko `INSERT`/`SELECT` + trigger), model 4 ról × kanał i fikstury, generator macierzy ról z IDOR i testem kompletności, zegar.
- Warunek „od E9”: M1 nie wystawia operacji z `channels: [mobile]` — lint (SR-AUTHZ-12); README M1 → „Przeniesione do E9”.
- Zależności zewnętrzne: domena stagingu z TLS (EVM-007, decyzja 2) — RP ID kluczy dostępu; Pwned Passwords (bezpłatne, k-anonimowość).
- Testy: klucze dostępu w E2E — Chromium i Edge (wirtualny uwierzytelniacz), Firefox — testy integracyjne. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Backend (ścieżka `pelna`, konsultacje `solution-architect` W1–W12 i `security-engineer` A1–A7 — pełny tekst w notatce roboczej; ADR nie jest potrzebny, wszystko wynika z ADR-0001/0003/0004/0005).
- **Kontrakt** (`packages/contracts`): `checkActivationLink`, `setActivationPassword` (publiczne), `getCurrentSession`, `logout`, `getPasskeyRegistrationOptions`, `registerPasskey` pod `/api/v1/auth/*` i `/api/v1/account/passkeys`; ścisła walidacja `x-evia-authz` przy budowie manifestu, lint kanałów (`mobile` zakazane przed E9) i stanu `mfa_enrollment`; kody `activation_link_invalid`, `passkey_verification_failed`, `method_not_allowed`; wyłącznie zmiany addytywne.
- **Moduły:** `platform` (zegar, dispatcher zdarzeń, limiter per IP, walidacja, potok treści 415/413/405, outbox alertów), `identity` (konta, hasła Argon2id + polityka P2, klucze dostępu, linki, sesje, polecenie na serwerze), `audit` (subskrybuje zdarzenia `identity`; `identity` nie importuje `audit` — reguła dependency-cruiser), `authorization` (stała kolejność kontroli w guardzie, resolver sesji przez fasadę `identity`).
- **Migracje** (expand): `0002` rola `evia_app` (NOLOGIN), `0003` schemat `audit` append-only (uprawnienia + triggery), `0004` schemat `identity`, `0005` outbox alertów w `platform`.
- **Link i sesja:** link zużywany atomowo dopiero przy rejestracji klucza (razem z aktywacją, rotacją sesji i audytem); sesja `mfa_enrollment` jest powiązana z linkiem i żyje tylko tak długo, jak on; każde wydanie linku unieważnia wszystkie niezużyte linki i ich sesje.
- **Testy:** jednostkowe (domena, adaptery, potok HTTP, wirtualny uwierzytelniacz WebAuthn) i integracyjne z PostgreSQL rolą `evia_app` (aktywacja, klucz dostępu, wylogowanie, audyt, polecenie na serwerze także przez prawdziwe okablowanie procesu, macierz ról generowana z kontraktu z IDOR i testem testu).
- **Panel (W-13, W-03, menu konta):** część `web-developer` — poza tym krokiem; backend dostarcza kontrakt i klienta.

## Decyzje
- **2026-10-06 (backend-developer, do potwierdzenia przez Konrada):** `getCurrentSession` jest dozwolone także w stanie `mfa_enrollment` (obok opcji i rejestracji klucza oraz wylogowania). Bez tego odświeżenie ekranu W-03 gubi token CSRF (w pamięci karty) i nie ma jak go odzyskać — AC4 („każde inne żądanie API zwraca `403 mfa_enrollment_required`”) rozumiemy jako „każde żądanie biznesowe”; odczyt sesji nie ujawnia nic, czego użytkownik nie zna. Lista operacji jest w kodzie (`MFA_ENROLLMENT_OPERATIONS`) i w lincie kontraktu.
- **2026-10-06:** opcje rejestracji klucza są dostępne dla każdej sesji, a sama rejestracja tylko dla sesji `mfa_enrollment` (drugi klucz = EVM-028).
- **2026-10-06:** pokrycie backendu: kod związany z bazą mierzy przebieg integracyjny (próg 85%), reszta — jednostkowy; żaden próg nie jest obniżony (`docs/process/testing-strategy.md` → Progi).

## Uwagi do rozważenia
- Dług techniczny (ID do nadania): zadanie czyszczące retencję (sesje z pełnym IP 30 dni — P9, wyzwania WebAuthn, linki jednorazowe) przed wydaniem produkcyjnym; Schemathesis na kontrakcie; testy mutacyjne `identity` (od M1 cyklicznie); wygasanie sesji (idle 60 min, absolutne 12 h — EVM-067, do tego czasu bez wydania produkcyjnego).
- Wymagania dla EVM-007 i EVM-076: Alloy zbiera logi tylko z usług z listy dozwolonych; reguła alertu na polach `alert: "security"` / `alertCode`; Caddy bez `log_credentials` i z filtrem `X-CSRF-Token`; Sentry bez treści żądań `/api/v1/auth/activation/*` i z czyszczeniem fragmentu URL; API łączy się rolą `evia_app` (członek roli, nie właściciel); lista `TRUSTED_PROXIES`.

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-016 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane (runbook polecenia aktywacji i trybu awaryjnego w `docs/ops/runbooks/`)
- [ ] Demo i akceptacja użytkownika (decyzja 3 — klucz dostępu Administratora)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; podział EVM-016 planu wstępnego — konsultacja solution-architect W2)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): token linku tylko we fragmencie URL, otwarcie nie zużywa linku, polecenie wypisuje link wyłącznie na TTY (AC1, AC5)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — zmiana AC zaakceptowana przez Konrada na demo EVM-015 (propozycja `product-owner`, EVM-015 → „Uwagi do rozważenia” 2; liczba AC bez zmian): AC1 — status „Zaproszony” → „Oczekuje na aktywację” (`invited`), brzmienie z makiety W-16 i słownika („Status konta”)
- 2026-10-06 — start `/deliver` (ścieżka `pelna`, gałąź `feature/EVM-016-pierwszy-administrator`); EVM-008 done na main
- 2026-10-06 — implementacja backendu (backend-developer): kontrakt, moduły `identity`/`audit`/`authorization`, migracje, polecenie na serwerze z trybem awaryjnym, macierz ról; panel (W-13, W-03, menu konta) — do `web-developer`
