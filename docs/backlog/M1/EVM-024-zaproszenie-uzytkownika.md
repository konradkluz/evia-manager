---
id: EVM-024
title: Zaproszenie użytkownika i aktywacja konta
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-progress
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
path: pelna
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-029]
---

# EVM-024: Zaproszenie użytkownika i aktywacja konta

## Historyjka
Jako **Administrator** chcę **zaprosić pracownika e-mailem z wybraną rolą**, aby **sam ustawił hasło i drugi krok logowania, a ja nie znał jego hasła**.

## Kontekst
- ADR-0005, SR-AUTH-12 (konta tylko przez zaproszenie, link 72 h), P1 (MFA dla wszystkich), P2 (zaproszenie wymaga step-upu).
- **Wprowadza e-mail transakcyjny lokalnie:** kolejkę `email` (worker pg-boss z outboxem), port e-mail z atrapą w testach i adapterem SMTP do Mailpit w dev. Zależą od tego EVM-023, EVM-025, EVM-026, EVM-027, EVM-028, EVM-049, EVM-052.
- **Podział (2026-10-16):** część staging — adapter Scaleway TEM, tryb staging z listą dozwolonych adresów (decyzja 15), SPF / DKIM / DMARC, worker na staging, demo na staging — przeniesiona do [EVM-089](EVM-089-email-na-staging.md). Ta historyjka nie wymaga EVM-007; demo lokalne (Mailpit).
- Makiety: W-16 i W-13 (EVM-015), [W-03](../../ux/flows/01-logowanie-mfa.md#w-03-konfiguracja-mfa), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Zaproszenie (SR-AUTH-12, SR-SESS-08)**
- Zakładając Administratora po step-upie w W-16
- Gdy zaprasza osobę: e-mail `anna.testowa@example.com`, nazwa „Anna Testowa”, rola Edytor
- Wtedy konto ma status „Oczekuje na aktywację” (`invited`), w bazie jest tylko skrót tokenu z ważnością 72 h, powstaje zdarzenie audytu, a e-mail z linkiem trafia do kolejki w tej samej transakcji co zaproszenie (outbox); token jest w linku wyłącznie we fragmencie adresu (`#…`), a ładunek zadania w kolejce zawiera tylko identyfikatory (README M1 → „Zasady wspólne” → „Bezpieczeństwo i dane”).
- Oraz gdy zaproszenie (także wysłane ponownie) ma rolę Administrator, wszyscy aktywni Administratorzy dostają alert bezpieczeństwa (SR-LOG-07).

**AC2 — Treść e-maila (SR-INPUT-07)**
- Gdy e-mail zaproszenia jest wysyłany
- Wtedy treść pochodzi ze stałego szablonu w kodzie i zawiera tylko link i informację o zaproszeniu (bez danych klientów), a adres odbiorcy z CR/LF albo niepoprawny jest odrzucony przy zaproszeniu (`400 validation_failed`).

**AC3 — Aktywacja konta**
- Zakładając ważny link
- Gdy zaproszona osoba otwiera W-13, ustawia hasło (SR-AUTH-01, SR-AUTH-02) i konfiguruje drugi krok w W-03 (Administrator — wyłącznie klucz dostępu)
- Wtedy konto staje się aktywne, link przestaje działać, a do zakończenia konfiguracji każde inne żądanie zwraca `403 mfa_enrollment_required` (SR-AUTH-06)
- Oraz po otwarciu linku panel usuwa token z paska adresu i historii przeglądarki i wysyła go wyłącznie w treści `POST`; samo otwarcie strony (np. przez skaner linków w poczcie) nie zużywa zaproszenia, a token nie występuje w logach Caddy i API, w zdarzeniach i breadcrumbach Sentry ani w historii przeglądarki (test; SR-API-04, SR-LOG-02).

**AC4 — Link nieważny i ponowne wysłanie**
- Zakładając link użyty, wygasły (zegar: wydany 2026-10-01 10:00, otwarty 2026-10-04 10:01) albo zastąpiony
- Gdy osoba go otwiera
- Wtedy widzi jeden komunikat bez informacji o koncie
- Oraz gdy Administrator (step-up) wybiera „Wyślij zaproszenie ponownie”, poprzedni link przestaje działać, a nowy ma ważność 72 h.

**AC5 — Niedostępna usługa e-mail (SR-ERR-02)**
- Zakładając, że usługa e-mail nie odpowiada
- Gdy wysyłka się nie udaje
- Wtedy zadanie jest ponawiane z wydłużającymi się przerwami, zaproszenie pozostaje ważne, a po wyczerpaniu prób W-16 pokazuje „Nie wysłano” z akcją „Wyślij ponownie” — bez utraty danych.

**AC6 — E-mail w dev i testach**
- Zakładając środowisko deweloperskie albo testy
- Gdy system wysyła e-mail
- Wtedy w dev trafia on do Mailpit, a w testach do atrapy; system nigdy nie wysyła e-maila na domeny `example.com` ani `.test` przez dostawcę zewnętrznego (test: adapter dostawcy odrzuca takie adresy). Wysyłka na staging i lista dozwolonych adresów — EVM-089.
- Oraz (fail-closed) transport e-mail jest jawnym, wymaganym ustawieniem bez wartości domyślnej, a walidacja konfiguracji odrzuca SMTP/Mailpit w `staging` i `production` (błąd startu); bez transportu worker nic nie wysyła, zadania czekają w kolejce bez utraty (SR-ERR-02), a healthcheck zgłasza brak transportu.

**AC7 — Konflikt adresu**
- Zakładając istniejące konto z tym adresem e-mail
- Gdy Administrator zaprasza ten adres
- Wtedy API zwraca `409` z kodem ustalonym w planie technicznym (dopisanym addytywnie do katalogu `api-guidelines.md`), a W-16 wskazuje istniejące konto.

**AC8 — Uprawnienia i audyt (SR-AUTHZ-11, SR-AUTHZ-05, SR-LOG-03)**
- Zakładając role Edytor, Tylko odczyt i niezalogowanego
- Gdy próbują zaprosić użytkownika
- Wtedy E i R nie widzą „Administracja”, API zwraca im `403 forbidden`, niezalogowany — `401`; zaproszenie, ponowne wysłanie i aktywacja mają zdarzenia audytu bez adresu e-mail.

## Poza zakresem
- Kod z aplikacji jako metoda w W-03 — EVM-023 (do tego czasu zaproszeni wybierają klucz dostępu).
- Zmiana roli, dezaktywacja, reset MFA — EVM-027. Zmiana adresu e-mail konta — poza M1.
- Adapter TEM i jakikolwiek transport wychodzący poza atrapą (testy) i SMTP do Mailpit (dev) — EVM-089; kod TEM bez strażnika odbiorców nie trafia na `main`.

## UX / UI
- W-16 (lista użytkowników, „Zaproś użytkownika”, „Wyślij ponownie”, stan „Nie wysłano”), W-13, W-03, W-04 „Potwierdź tożsamość, aby zaprosić użytkownika”.
- Stany: pusty (tylko Administrator na liście), ładowanie, błąd (walidacja pól, `409`), offline (baner, dane formularza w pamięci karty), brak uprawnień (AC8).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | zaproszenie i ponowne wysłanie (step-up) |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | W-13 tylko z ważnym linkiem |

- Dane: e-mail i nazwa pracownika (DO-P); token zaproszenia (SEK — tylko skrót).
- W AC: SR-AUTH-12, SR-SESS-08, SR-INPUT-07, SR-AUTH-01, SR-AUTH-02, SR-AUTH-06, SR-ERR-02, SR-AUTHZ-11, SR-AUTHZ-05, SR-LOG-03; spoza listy E1: SR-API-04, SR-LOG-02 (token zaproszenia poza ścieżką, query i logami — mechanizm z EVM-016; przegląd `security-engineer` EVM-010).
- W sekcji: SR-CRYPTO-03 (token 256 bitów), SR-DATA-01. Polityki P1, P2. SR-API-13 (ruch wychodzący tylko do TEM) i SR-INFRA-12 (SPF, DKIM, DMARC `p=reject`) — EVM-089.

## Notatki techniczne
- Moduły: `identity`, `platform` (outbox, worker, adapter e-mail), `audit` + panel.
- Zdolności przekrojowe wprowadzane tutaj: worker pg-boss z outboxem (ładunki zadań — same ID), kolejka `email`, port e-mail z atrapą w testach.
- `devops-engineer`: dodaje usługę Mailpit do `compose.yaml` (profil, tag + digest, port tylko na `127.0.0.1` — ADR-0011, ADR-0015). Konfiguracja Scaleway TEM, DNS nadawcy, worker na staging i tryb staging — EVM-089.
- Obejścia (np. pokazanie linku zaproszenia Administratorowi zamiast e-maila) tylko po przeglądzie `security-engineer` i decyzji Konrada — zmieniają SR-AUTH-12 i AB-02.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).
- (a) SR-INPUT-07 egzekwowane w porcie / typie domenowym, nie w adapterze; wspólny zestaw testów kontraktu portu (EVM-089 uruchomi go dla TEM) i kontrakt błędów przejściowy / trwały.
- (b) Jedna droga wysyłki: outbox → kolejka `email` → port. Bibliotekę SMTP importuje tylko adapter w `platform` — reguła w `deps:check` + test; nowa zależność SMTP z uzasadnieniem (SR-SUPPLY-06), dokładna wersja.
- (c) Surowy token: worker generuje go w chwili wysyłki i zapisuje jego skrót (każde wysłanie unieważnia poprzedni link, zgodnie z AC4) — nigdy jawny token w ładunku zadania ani w outboxie; decyzję w planie przegląda `security-engineer`.
- (d) Mailpit: porty SMTP i UI tylko na `127.0.0.1`, dane syntetyczne.

- **Uwaga po EVM-034 (2026-10-13):** minimalny worker już istnieje (`apps/api/src/worker.ts`, `platform/jobs` z adapterem pg-boss 12.35.1, migracja `0024`, usługa `worker` w `compose.dev.yaml`). Ta historyjka rozszerza go o kolejkę `email`, transakcyjne `send` (test „rollback = brak zadania”), politykę ponowień i DLQ per kolejka, healthcheck oraz reguły alertów; szczegóły w „Decyzjach” EVM-034.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
Numeracja migracji (kolejka 2026-10-16): wątek A zaczyna od `0035_…`; `0033`–`0034` zarezerwowane dla wątku B (EVM-060).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-024 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane (runbook kolejki e-mail)
- [ ] Demo lokalne (zaproszenie widoczne w Mailpit, aktywacja konta) i akceptacja użytkownika; demo na staging — EVM-089

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): token zaproszenia tylko we fragmencie URL, otwarcie nie zużywa linku (AC1, AC3)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — zmiana AC zaakceptowana przez Konrada na demo EVM-015 (propozycja `product-owner`, EVM-015 → „Uwagi do rozważenia” 2; liczba AC bez zmian): AC1 — status „Zaproszony” → „Oczekuje na aktywację” (`invited`); dopisany alert bezpieczeństwa dla Administratorów przy zaproszeniu z rolą Administrator (treść: `docs/ux/flows/e-maile.md`, e-mail 9)
- 2026-10-13 — podział EVM-007 wg ADR-0018: zależność `EVM-007` oznacza część 007a (staging, domena, TLS, Scaleway TEM, SPF/DKIM/DMARC `staging.eviacharge.pl`); `depends_on` bez zmian (product-owner)
- 2026-10-16 — podział: część staging (TEM, SPF/DKIM/DMARC, lista dozwolonych, demo na staging) → EVM-089; depends_on bez EVM-007 (propozycja product-owner, do akceptacji Konrada)
- 2026-10-16 — warunki security-engineer wpisane: fail-closed w AC6, „Poza zakresem”, notatki (a)–(d); liczba AC bez zmian
- 2026-10-16 — podział i warunki security-engineer zaakceptowane przez Konrada (planowanie kolejki 16.10); status ready
- 2026-10-16 — ready → in-progress (kolejka 2026-10-16, wątek A, gałąź feature/queue-2026-10-16-logowanie; ścieżka pełna, wykonawcy sonnet)
