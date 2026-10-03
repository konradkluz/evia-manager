---
id: EVM-024
title: Zaproszenie użytkownika i aktywacja konta
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-007, EVM-029]
---

# EVM-024: Zaproszenie użytkownika i aktywacja konta

## Historyjka
Jako **Administrator** chcę **zaprosić pracownika e-mailem z wybraną rolą**, aby **sam ustawił hasło i drugi krok logowania, a ja nie znał jego hasła**.

## Kontekst
- ADR-0005, SR-AUTH-12 (konta tylko przez zaproszenie, link 72 h), P1 (MFA dla wszystkich), P2 (zaproszenie wymaga step-upu).
- **Wprowadza e-mail transakcyjny:** kolejkę `email` (worker pg-boss z outboxem), adapter Scaleway TEM, tryb staging (lista dozwolonych adresów). Zależą od tego EVM-023, EVM-025, EVM-026, EVM-027, EVM-028, EVM-049, EVM-052.
- Decyzje dla Konrada: 1 (konto Scaleway), 2 (domena i adres nadawcy), 15 (adresy e-mail na staging).
- Makiety: W-16 i W-13 (EVM-015), [W-03](../../ux/flows/01-logowanie-mfa.md#w-03-konfiguracja-mfa), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Zaproszenie (SR-AUTH-12, SR-SESS-08)**
- Zakładając Administratora po step-upie w W-16
- Gdy zaprasza osobę: e-mail `anna.testowa@example.com`, nazwa „Anna Testowa”, rola Edytor
- Wtedy konto ma status „Zaproszony”, w bazie jest tylko skrót tokenu z ważnością 72 h, powstaje zdarzenie audytu, a e-mail z linkiem trafia do kolejki w tej samej transakcji co zaproszenie (outbox); token jest w linku wyłącznie we fragmencie adresu (`#…`), a ładunek zadania w kolejce zawiera tylko identyfikatory (README M1 → „Zasady wspólne” → „Bezpieczeństwo i dane”).

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

**AC6 — E-mail na staging i w testach**
- Zakładając środowisko staging
- Gdy system wysyła e-mail
- Wtedy trafia on wyłącznie na adresy z listy dozwolonych (decyzja 15), a pozostałe są przechwytywane lokalnie; w środowisku deweloperskim i testach e-maile trafiają do Mailpit; system nigdy nie wysyła przez TEM na domeny `example.com` ani `.test`.

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
- W sekcji: SR-API-13 (ruch wychodzący tylko do TEM z listy dozwolonych), SR-CRYPTO-03 (token 256 bitów), SR-DATA-01, SR-INFRA-12 (SPF, DKIM, DMARC `p=reject` dla domeny nadawczej — `devops-engineer`). Polityki P1, P2.

## Notatki techniczne
- Moduły: `identity`, `platform` (outbox, worker, adapter e-mail), `audit` + panel.
- Zdolności przekrojowe wprowadzane tutaj: worker pg-boss z outboxem (ładunki zadań — same ID), kolejka `email`, port e-mail z atrapą w testach.
- `devops-engineer`: konfiguracja Scaleway TEM, domena nadawcy, SPF / DKIM / DMARC `p=reject`, wdrożenie workera na staging, tryb staging z listą dozwolonych adresów. Domena jest potrzebna już w EVM-007 (TLS stagingu).
- Obejścia (np. pokazanie linku zaproszenia Administratorowi zamiast e-maila) tylko po przeglądzie `security-engineer` i decyzji Konrada — zmieniają SR-AUTH-12 i AB-02.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-024 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane (runbook kolejki e-mail)
- [ ] Demo na staging (zaproszenie na adres z listy dozwolonych) i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): token zaproszenia tylko we fragmencie URL, otwarcie nie zużywa linku (AC1, AC3)
