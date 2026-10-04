---
id: EVM-023
title: Kod z aplikacji (TOTP) i kody odzyskiwania
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024]
---

# EVM-023: Kod z aplikacji (TOTP) i kody odzyskiwania

## Historyjka
Jako **pracownik bez klucza dostępu na komputerze** chcę **logować się kodem z aplikacji uwierzytelniającej i mieć kody odzyskiwania na wypadek utraty metody**, aby **korzystać z panelu bez zakupu sprzętu i nie stracić dostępu do konta**.

## Kontekst
- P1: MFA dla wszystkich ról; w panelu klucz dostępu albo TOTP, **Administrator — wyłącznie klucz dostępu** (TOTP Administratora tylko do aplikacji mobilnej, M2); 10 kodów odzyskiwania.
- Zależy od EVM-024: e-maile o zmianie MFA i użyciu kodu odzyskiwania (ADR-0005, SR-AUTH-10, SR-AUTH-15).
- Makiety: [W-02](../../ux/flows/01-logowanie-mfa.md#w-02-drugi-krok), [W-03](../../ux/flows/01-logowanie-mfa.md#w-03-konfiguracja-mfa) (wariant TOTP i krok 3), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie); pole kodu [P-4].

## Kryteria akceptacji
**AC1 — Konfiguracja kodu z aplikacji (SR-AUTH-07, SR-CRYPTO-02)**
- Zakładając Edytora albo Tylko odczyt w W-03
- Gdy wybiera „Kod z aplikacji uwierzytelniającej”, skanuje kod QR (albo „Pokaż klucz do wpisania”) i potwierdza kod
- Wtedy metoda jest aktywna dopiero po poprawnym kodzie (zły kod — „Kod jest nieprawidłowy. Sprawdź, czy czas w telefonie jest ustawiony automatycznie…”), sekret ma co najmniej 160 bitów i jest zaszyfrowany w bazie (`platform/crypto`, P12).

**AC2 — Logowanie kodem**
- Zakładając konto z aktywnym kodem z aplikacji (okres 30 s, tolerancja ±1 krok)
- Gdy w W-02 wpisuję bieżący kod
- Wtedy jestem zalogowany; ten sam kod użyty drugi raz jest odrzucony; pole ma `autocomplete="one-time-code"` i nie wysyła się samo po 6 cyfrach.

**AC3 — Administrator w panelu bez kodu z aplikacji (P1)**
- Zakładając Administratora z zapisanym kodem z aplikacji (do aplikacji mobilnej)
- Gdy loguje się w panelu
- Wtedy W-02 oferuje mu wyłącznie klucz dostępu, a próba drugiego kroku kodem z aplikacji w kanale `web` dla konta Administratora jest odrzucana przez API.

**AC4 — Kody odzyskiwania (SR-AUTH-08)**
- Zakładając koniec konfiguracji drugiego kroku (W-03 krok 3)
- Gdy wyświetlają się kody
- Wtedy jest ich 10 (każdy ≥ 20 znaków base32), są pokazane tylko raz z akcjami „Kopiuj kody” i „Drukuj kody”, „Zakończ konfigurację” wymaga zaznaczenia „Kody są zapisane w bezpiecznym miejscu”, w bazie są tylko skróty Argon2id, a odświeżenie kroku generuje nowe kody i unieważnia poprzednie.

**AC5 — Logowanie kodem odzyskiwania (SR-AUTH-15)**
- Zakładając konto z 10 kodami
- Gdy w W-02 wybieram „Użyj kodu odzyskiwania” i wpisuję kod
- Wtedy jestem zalogowany z komunikatem „Zalogowano kodem odzyskiwania. Pozostało 9 kodów. Wysłaliśmy e-mail z informacją o tym logowaniu.” (Administrator — z podpowiedzią „Poproś innego administratora o reset drugiego kroku logowania.”), ten sam kod drugi raz jest odrzucony, a użycie ma e-mail i zdarzenie audytu.

**AC6 — Powiadomienia o zmianie drugiego kroku (SR-AUTH-10)**
- Gdy konto konfiguruje kod z aplikacji albo generuje kody odzyskiwania
- Wtedy użytkownik dostaje e-mail z informacją o zmianie (bez danych klientów) i powstaje zdarzenie audytu.

**AC7 — Step-up kodem (SR-SESS-08)**
- Zakładając Edytora z kodem z aplikacji i operację wymagającą step-upu (test kontraktu)
- Gdy pojawia się W-04
- Wtedy Edytor może potwierdzić tożsamość kodem z aplikacji albo kluczem dostępu, a Administrator — nadal tylko kluczem dostępu.

**AC8 — Role, limity i stany (SR-AUTHZ-05, SR-API-02)**
- Wtedy każda rola może skonfigurować kod z aplikacji (Tylko odczyt — bez informacji o telefonie), drugi krok ma limit 20 prób/min/IP (`429`), a offline W-02 i W-03 pokazują baner z wyłączonymi przyciskami i zachowanym postępem w pamięci karty.

## Poza zakresem
- Zmiana i usuwanie metod po pierwszej konfiguracji, ponowne generowanie kodów z konta — EVM-028 (konta aktywowane przed tą historyjką generują kody w W-15).
- Kod z aplikacji w aplikacji mobilnej — M2 (E9).

## UX / UI
- W-02 (pole kodu [P-4], „Użyj innej metody”, „Użyj kodu odzyskiwania”), W-03 (wariant TOTP, krok 3), W-04 (kod — Edytor).
- Stany: pusty, ładowanie (Skeleton QR i kodów), błąd (zły kod, `429`), offline, brak uprawnień (nie dotyczy — każda rola ma drugi krok).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | kody odzyskiwania; kod z aplikacji tylko do aplikacji mobilnej (nie w panelu) |
| Edytor | kod z aplikacji, kody odzyskiwania |
| Tylko odczyt | kod z aplikacji, kody odzyskiwania |
| Niezalogowany | W-02 po poprawnym haśle |

- Dane: sekrety TOTP (SEK, szyfrowane), skróty kodów odzyskiwania.
- W AC: SR-AUTH-07, SR-CRYPTO-02, SR-AUTH-08, SR-AUTH-15, SR-AUTH-10, SR-SESS-08, SR-AUTHZ-05, SR-API-02.
- W sekcji: SR-AUTH-06, SR-CRYPTO-03, SR-CRYPTO-05 (porównania w czasie stałym), SR-LOG-03. Polityki P1, P12.

## Notatki techniczne
- Moduły: `identity`, `platform` (`crypto`), `audit` + panel.
- E-maile przez kolejkę z EVM-024 (atrapa w testach, Mailpit lokalnie).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-023 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — zmiana AC zaakceptowana przez Konrada na demo EVM-015 (propozycja `product-owner`, EVM-015 → „Uwagi do rozważenia” 2; liczba AC bez zmian): AC5 — podpowiedź dla Administratora po logowaniu kodem odzyskiwania zgodna z decyzją 16 (kod odzyskiwania niedostępny przy ponownym uwierzytelnieniu — S1 odrzucone)
