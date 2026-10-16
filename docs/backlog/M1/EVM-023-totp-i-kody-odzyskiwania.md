---
id: EVM-023
title: Kod z aplikacji (TOTP) i kody odzyskiwania
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-progress
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
path: pelna
model: sonnet
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
- Moduły: `identity` (domena TOTP i kodów, serwisy enrolmentu, logowania, step-upu), `platform/crypto` (szyfrowanie kopertowe pól), `audit`, e-maile przez outbox z EVM-024. Migracja `0038` (expand): `identity.totp_factors`, `identity.recovery_codes`, `sessions.totp_authenticated_at`, `sessions.step_up_failed_attempts`.
- Kontrakt (`paths/identity.yaml`): `loginTotp`, `loginRecoveryCode`, `startTotpEnrolment`, `confirmTotp`, `generateRecoveryCodes`, `stepUp` z `{ method: totp, code }`; `LoginSecondStep.methods` rozszerzone o `totp` i `recovery_code`.
- Kolejność: szyfrowanie pól i config -> migracja -> domena i kontrakt -> enrolment i kody (AC1, AC4, AC6) -> logowanie (AC2, AC3, AC5, AC8) -> step-up (AC7) -> dokumentacja; panel (W-02, W-03, W-04) po API.

### Uwagi bezpieczeństwa z konsultacji (B1–B6; wpisane do planu przed implementacją)
- B1: enrolment tylko w sesji `mfa_enrollment` związanej z linkiem; potwierdzenie w jednej transakcji (link, aktywacja konta, nowa sesja); `409 mfa_already_configured` przy aktywnym czynniku.
- B2: metody drugiego kroku z jednego miejsca (`secondStepMethods`, rola z bazy), także po resecie hasła; czynnik `pending` nie jest metodą; Administrator w panelu — tylko klucz dostępu.
- B3: licznik porażek: na `loginToken` (5) i na sesji w step-upie (`step_up_failed_attempts`, piąta unieważnia sesję).
- B4: generowanie kodów tylko gdy brak generacji albo z tej samej sesji, która bieżącą wygenerowała; inaczej `403 recovery_codes_regeneration_unavailable`.
- B5: szyfrowanie kopertowe (DEK na wartość owinięty KEK-iem, nagłówek i kontekst `totp:<userId>` w AAD), fail-closed w produkcji, klucz inny niż `CURSOR_KEY`.
- B6: nowe operacje w `AUTHENTICATION_OPERATIONS` (jeden kubełek 20/min/IP z hasłem).
- Odwołanie „decision 16” w kodzie = decyzja 16 z EVM-015 (kod odzyskiwania nie otwiera okna step-upu; AC5).

### Nowe zależności (SR-SUPPLY-06)
- `otpauth` 9.5.2 (`apps/api`): licencja MIT; wskazana w ADR-0005 i SR-CRYPTO-01 (zaakceptowana przez architekta); jedyna zależność `@noble/hashes` 2.4.0 (MIT, audytowana); sprawdzono w źródle, że `TOTP.validate` porównuje kody w czasie stałym; wersja przypięta dokładnie, `osv-scanner` w `pnpm run scan` bez nowych podatności.
- `qr` 0.7.2 (`packages/ui-web`): licencja MIT lub Apache-2.0, zero zależności, generuje macierz modułów (własny `svg` — bez HTML z danych, bez sieci i bez zewnętrznego serwisu QR); sprawdzono `package.json` (licencja, brak zależności) i brak skryptów instalacyjnych; wersja przypięta.

## Decyzje
Decyzje orkiestratora — do potwierdzenia na demo:
- D1. TOTP przez `otpauth` (ADR-0005), sekret 160 bitów; okno ±1 krok, każdy krok działa raz (`last_used_step`).
- D2. Szyfrowanie pól `FIELD_ENCRYPTION_KEYS` (rotacja: nowy klucz na początek; w M1 bez narzędzia re-wrap, stary klucz zostaje — `docs/ops/rotacja-sekretow.md`); poza produkcją brak klucza = `503`, nigdy zapis jawny.
- D3. Przy konfiguracji TOTP albo klucz dostępu (nie oba); TOTP „obok klucza” z W-03 — EVM-028.
- D4. Zasada pierwszej generacji kodów: (a) brak generacji albo (b) ta sama sesja co bieżąca generacja; sesja z kodu odzyskiwania nie wygeneruje kodów.
- D5. Enrolment kodem z aplikacji otwiera okno step-upu (kod właśnie zweryfikowany), więc krok 3 generuje kody bez dialogu; po kluczu dostępu okno jest zamknięte, więc krok 3 w W-03 prosi o step-up kluczem.
- D6. Wspólny kubełek limitu 20/min/IP dla hasła, `loginTotp`, `loginRecoveryCode` i step-upu.
- D7. Operacja `setupTotp` przemianowana na `startTotpEnrolment` (test EVM-016 zabrania ścieżek ze słowem „setup”).
- D8. Kody odzyskiwania: 10 x 20 znaków base32, skróty Argon2id, jednorazowe; kod odzyskiwania nie działa w step-upie.

## Uwagi do rozważenia
- **Do decyzji Konrada (security-engineer, major): brak limitu nieudanych prób drugiego kroku na konto** (SR-AUTH-05, CWE-307). Dziś limitują tylko: 5 prób na `loginToken` i 20/min/IP; napastnik znający hasło dostaje nowy `loginToken` po ponownym podaniu hasła, więc z jednego IP to ok. 16 prób kodu na minutę. Opcje: (a) licznik porażek (`totp_failed`, `recovery_code_failed`) na konto, np. >= 10 w 15 min, po przekroczeniu nowy `loginToken` nie jest wydawany (odpowiedź jak `invalid_credentials`) + test `EVM-023 AC8`; (b) ryzyko rezydualne w `docs/security/threat-model.md` z akceptacją Konrada i dopisanie do AC EVM-026, że porażki drugiego kroku liczą się do opóźnienia i blokady konta. Rekomendacja security: (b), bo M1 nie wyjdzie bez EVM-026. Wymaga decyzji przed zamknięciem historyjki.

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
- 2026-10-16 — ścieżka `pelna` (uwierzytelnianie/uprawnienia), `model: sonnet`, realizacja lokalna z portem e-mail i Mailpit z EVM-024 — decyzja Konrada przy planowaniu kolejki 16.10
- 2026-10-16 — ready → in-progress (kolejka 025 → 023 → 027, gałąź feature/queue-2026-10-16-logowanie-2; ścieżka pełna, wykonawcy sonnet)
- 2026-10-16 — backend gotowy (backend-developer, lokalnie w kontenerze `backend-tests`): migracja `0038`, szyfrowanie kopertowe pól (`FIELD_ENCRYPTION_KEYS`), `otpauth` 9.5.2, operacje `loginTotp`, `loginRecoveryCode`, `startTotpEnrolment`, `confirmTotp`, `generateRecoveryCodes` i `stepUp` z kodem, e-maile i audyt; uwagi bezpieczeństwa B1–B6 wpisane do planu; panel (W-02, W-03, W-04) — zadanie web-developera
- 2026-10-16 — web gotowy (web-developer): W-02 (kod z aplikacji, kod odzyskiwania), W-03 w wariancie „od EVM-023” (wybór metody, QR lokalnie, 10 kodów), W-04 z polem kodu; `TextField` z wariantem kodu i `QrCode` w bibliotece UI; testy komponentów i E2E z `EVM-023 AC#`
