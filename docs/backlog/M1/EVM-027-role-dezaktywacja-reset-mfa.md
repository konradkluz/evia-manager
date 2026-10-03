---
id: EVM-027
title: Role, dezaktywacja, sesje i reset MFA użytkownika
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-024]
---

# EVM-027: Role, dezaktywacja, sesje i reset MFA użytkownika

## Historyjka
Jako **Administrator** chcę **zmieniać role, dezaktywować i reaktywować konta, kończyć sesje i resetować drugi krok logowania pracowników**, aby **zarządzać dostępem przy zmianach w zespole i utracie telefonu — bez ryzyka, że system zostanie bez Administratora**.

## Kontekst
- SR-AUTH-13 (reset MFA po weryfikacji tożsamości), SR-SESS-06 (dezaktywacja), SR-SESS-07, SR-AUTHZ-09 (zmiana roli od następnego żądania), SR-AUTHZ-11, P1 pkt 5, P2 (step-up).
- **Ochrona ostatniego aktywnego Administratora** (decyzja 10; konsultacja `solution-architect` B5): reguła w `identity`, także dla zmian własnego konta; równoległe zmiany serializowane; ta historyjka aktualizuje reguły `User` w `domain-model.md`.
- **Od E9:** skutki dla urządzeń (dezaktywacja → `device_wipe_required`, zmiana roli na Tylko odczyt z `pendingItemsReported`, reset MFA → „Wyloguj urządzenie”) — README M1 → „Przeniesione do E9”.
- Makiety: W-16 (EVM-015), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Zmiana roli (SR-AUTHZ-09, SR-SESS-02)**
- Zakładając Administratora po step-upie i Edytora „Anna Testowa” z aktywną sesją web
- Gdy zmienia jej rolę na Tylko odczyt
- Wtedy sesje web Anny kończą się (`401 session_revoked`), po ponownym zalogowaniu działa nowa rola (każda mutacja — `403`), nie ma pamięci podręcznej uprawnień dłuższej niż żądanie, a powstaje zdarzenie audytu z kodami ról przed i po.

**AC2 — Dezaktywacja i reaktywacja (SR-SESS-06)**
- Zakładając aktywne konto z dwiema sesjami web
- Gdy Administrator (step-up) je dezaktywuje
- Wtedy obie sesje zwracają `401 session_revoked`, logowanie daje komunikat jak dla złego hasła, a konto ma status „Dezaktywowane”; reaktywacja (step-up) przywraca dostęp z dotychczasowymi metodami drugiego kroku; obie operacje są audytowane.

**AC3 — Zakończenie sesji użytkownika (SR-SESS-07)**
- Gdy Administrator (step-up) wybiera „Wyloguj ze wszystkich sesji” dla użytkownika
- Wtedy każda sesja web tego użytkownika zwraca `401 session_revoked`, a zdarzenie trafia do audytu.

**AC4 — Reset drugiego kroku (SR-AUTH-13)**
- Zakładając, że pracownik zgubił telefon z kodem z aplikacji, a Administrator potwierdził jego tożsamość osobiście albo wideo (pole potwierdzenia w dialogu)
- Gdy Administrator (step-up) resetuje drugi krok
- Wtedy metody i kody odzyskiwania pracownika są usunięte, jego sesje web kończą się, przy logowaniu trafia na W-03 (`403 mfa_enrollment_required`), dostaje e-mail, a zdarzenie trafia do audytu; reset drugiego kroku Administratora może wykonać tylko inny Administrator.

**AC5 — Ostatni aktywny Administrator (decyzja 10)**
- Zakładając jednego aktywnego Administratora
- Gdy ktoś próbuje go dezaktywować albo zmienić mu rolę
- Wtedy API zwraca `409 last_active_administrator` (kod dopisany addytywnie do katalogu `api-guidelines.md`)
- Oraz Administrator nie może dezaktywować samego siebie ani odebrać sobie roli, nawet gdy są inni Administratorzy (odrzucenie z kodem ustalonym w planie technicznym).

**AC6 — Współbieżność**
- Zakładając dwóch aktywnych Administratorów
- Gdy w teście równolegle każdy dezaktywuje drugiego
- Wtedy co najmniej jeden aktywny Administrator zostaje (zmiany serializowane — test współbieżności).

**AC7 — Alerty (SR-LOG-07)**
- Gdy ktoś zostaje albo przestaje być Administratorem, albo drugi krok Administratora jest resetowany
- Wtedy wszyscy Administratorzy dostają alert bezpieczeństwa.

**AC8 — Uprawnienia i stany (SR-AUTHZ-11, SR-AUTHZ-05)**
- Zakładając role Edytor, Tylko odczyt i niezalogowanego
- Gdy próbują operacji z tej historyjki
- Wtedy dostają `403 forbidden` (E, R) albo `401`; operacje mają `stepUp: true` i `channels: [web]`; W-16 pokazuje dialogi z podsumowaniem, `412 version_conflict` przy równoczesnej zmianie („Ktoś zmienił to konto w międzyczasie…”), offline — akcje wyłączone.

## Poza zakresem
- Urządzenia i ich czyszczenie (W-17) — od E9. Anonimizacja konta po 2 latach (P4) — M4.
- Rola Monter — M4.

## UX / UI
- W-16: akcje w menu wiersza [P-1], dialogi z podsumowaniem (§ 4.11), W-04 z tytułem „Potwierdź tożsamość, aby zmienić rolę użytkownika”. Komunikat ochrony ostatniego Administratora z EVM-015.
- Stany: pusty, ładowanie, błąd (`409`, `412`, `429`), offline, brak uprawnień (pozycja „Administracja” niewidoczna dla E i R).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wszystkie operacje ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: konta pracowników (DO-P), audyt zmian ról i MFA.
- W AC: SR-AUTHZ-09, SR-SESS-02, SR-SESS-06, SR-SESS-07, SR-AUTH-13, SR-LOG-07, SR-AUTHZ-11, SR-AUTHZ-05.
- W sekcji: SR-SESS-08, SR-AUTHZ-12, SR-LOG-03, SR-INPUT-07 (e-mail po resecie), SR-DATA-03. Polityki P1, P2.

## Notatki techniczne
- Moduły: `identity`, `authorization`, `audit` + panel.
- Serializacja zmian Administratorów (blokada wierszy aktywnych Administratorów albo advisory lock) — plan techniczny.
- Aktualizacja reguł `User` w `domain-model.md` (ostatni aktywny Administrator, zmiany własnego konta) — przegląd `solution-architect`.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-027 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] `domain-model.md` (reguły `User`), `api-guidelines.md` (kody) i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
