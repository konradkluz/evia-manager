# ADR-0023: Administrator w panelu — kod z aplikacji (TOTP) dopuszczony jak u innych ról; logowanie kodem nie otwiera okna step-upu

- **Status:** Zaakceptowana (Konrad, 2026-11-16) — wariant A + K1; ryzyko rezydualne RR-101 na poziomie 4 Medium zaakceptowane; bez e-maila przy każdym logowaniu kodem
- **Data:** 2026-11-16
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect · **Uwagi security:** `security-engineer` (nota robocza EVM-134, 2026-11-16)
- **Powiązane:** EVM-134; zmienia politykę P1 (`docs/security/policies.md`, decyzja 2026-10-03 — punkt „Administrator — passkey”) i decyzję D3 z EVM-027 (2026-10-19, zmiana roli na Administratora wymaga klucza); SR-AUTH-06, SR-AUTH-14; AB-02, TM-90, TM-11, RR-17; EVM-005, EVM-023, EVM-026, EVM-027, EVM-028. ADR-0005 bez zmian (MFA obowiązkowe, TOTP i passkeys — reguły „Administrator tylko passkey” w nim nie ma).

**Forma:** nowy ADR zamiast aktualizacji ADR-0005, bo reguła nie pochodzi z ADR-0005, lecz z polityki P1 i decyzji D3, a zaakceptowanych ADR nie zmieniamy merytorycznie — jeden nowy zapis zbiera zmianę P1, D3 i SR-AUTH-06/14.

## Kontekst i problem
Dziś Administrator w panelu przechodzi drugi krok **wyłącznie kluczem dostępu** (P1, SR-AUTH-06). Klucz Konrada jest w telefonie (QR przy każdym logowaniu), a zapis klucza w Windows Hello kończy się błędem systemu Windows. Konrad 2026-11-16: „chcę od razu wprowadzić dopuszczenie kodu z aplikacji dla administratora panelu”. Kierunek przesądzony; ten ADR wybiera najprostszy bezpieczny sposób realizacji. Cel bez zmian: bezpieczeństwo danych klientów.

**Gdzie reguła jest egzekwowana (stan `main`, 2026-11-16):**
- **API — jedna reguła kanału** `totpAllowedForRole` (`apps/api/src/modules/identity/domain/channel-rules.ts:16-18`), wołana w: logowaniu kodem (`application/login-totp.service.ts:111` → `403 forbidden`), dowodzie step-upu i ponownego uwierzytelnienia (`application/second-step-proof.ts:102`), liście metod drugiego kroku (`application/second-step.ts:31`), konfiguracji TOTP — aktywacja, okno W-03 po resecie, dodanie z „Konto” (`application/totp-enrolment.service.ts:101, 181, 231`).
- **API — reguła ostatniej metody:** Administrator musi mieć ≥ 1 passkey, TOTP się nie liczy (`domain/second-step-rules.ts:25-29`; kod `passkey_required` w `application/second-step-management.service.ts:101`).
- **API — zmiana roli (D3):** `administrator_passkey_required` (`domain/access-rules.ts:55-56`, fakt `hasPasskey` `:29-30`, `application/user-access.service.ts:290`, katalog `platform/http/problem.ts:50`).
- **API — okno step-upu** jest już niezależne od metody: późniejsze z `passkey_authenticated_at` / `totp_authenticated_at` (`domain/session-policy.ts:41-49`); logowanie kodem otwiera je od razu (`application/session-start.ts:73`). Aplikacja mobilna: `application/mobile-login.service.ts:124` (`totp_not_configured` / `mfa_enrollment_required`) — bez reguły roli.
- **Kontrakt (tylko opisy i przykłady, bez `enum`):** `packages/contracts/openapi/paths/identity.yaml:338, 628, 685, 724, 1027, 1230` oraz „Administrator bez uwierzytelnienia kluczem dostępu w ostatnich 15 minutach” (`:899, 1021, 1085, 1137, 1188, 1224`); `components/responses.yaml:455, 1020-1037`.
- **Panel:** `apps/web/src/pages/mfa-setup-page.tsx:44-48, 107, 141, 156` (Administrator od razu na krok klucza); `apps/web/src/account/second-step-card.tsx:28-32` (`lastMethodRule`), `:105, 166, 179` (ukryte „Dodaj kod” dla Administratora), `:210`; `apps/web/src/session/step-up-dialog.tsx:39, 54, 64, 156`; `apps/web/src/session/reauthentication-dialog.tsx:61, 191, 258`; `apps/web/src/pages/second-step-page.tsx:254`; `apps/web/src/administration/account-failure.ts:53`, `change-role-dialog.tsx:30`; `apps/web/src/account/account-failure.ts:45`; teksty `apps/web/src/i18n/pl.ts:134-135, 231, 2205, 2221, 2230, 2366, 2381, 2435, 2471`.
- **Aplikacja mobilna:** `apps/mobile/src/i18n/pl.ts:326-333` (`totpNotConfigured`, `mfaEnrollmentRequired`) — teksty bez roli. **Dziś są nieprawdziwe dla Administratora:** kodu nie doda w panelu (`second-step-card.tsx:179`, API `403`), więc Administrator bez TOTP sprzed awansu nie zaloguje się w aplikacji.
- **Dokumenty:** `docs/security/requirements.md:101` (SR-AUTH-06), `:109` (SR-AUTH-14); SR-AUTH-08, -10, -13, -15 bez reguły roli (bez zmian); `docs/security/policies.md` P1; `threat-model.md:234, 313, 398, 839`; `dpia.md:56` (D8); `docs/ops/runbooks/aktywacja-i-tryb-awaryjny.md:28, 52, 88, 90`; `docs/architecture/domain-model.md:733`; `docs/architecture/api-guidelines.md:117, 123`. `docs/user/instrukcja-dla-biura.md:46-64` już opisuje obie metody bez wyjątku dla roli — bez zmian.
- **Baza:** brak ograniczeń zależnych od roli i metody (migracje `0004`, `0009`, `0038`, `0041`).

## Kryteria decyzji
| Kryterium | Waga | Uzasadnienie |
|---|---|---|
| Ryzyko rezydualne ≤ Medium | próg | High = blocker bramki bezpieczeństwa (nota security) |
| Prostota dla użytkownika | 5 | powód zmiany; zasada właściciela |
| Ryzyko blokady konta | 4 | jeden Administrator; utrata metody = runbook awaryjny |
| Odporność na wyłudzenie | 4 | Administrator to konto najbardziej warte phishingu (AB-02) |
| Koszt zmiany | 3 | mała firma, jedna historyjka |
| Spójność reguł | 3 | mniej wyjątków ról = mniej błędów i testów |

## Rozważane opcje
1. **A** — pełne zrównanie: passkey albo TOTP, ≥ 1 metoda, TOTP także w step-upie i ponownym uwierzytelnieniu.
2. **A + K1** — jak A, ale **logowanie kodem nie otwiera Administratorowi okna step-upu w panelu**: pierwsza operacja `stepUp: true` po logowaniu kodem → `403 step_up_required`, potwierdzenie nowym kodem (inny krok czasu — wymusza to istniejące `last_used_step`) albo kluczem; dalej okno 15 min jak dziś.
3. **B** — TOTP do logowania, passkey nadal obowiązkowy przy konfiguracji i jako ostatnia metoda.
4. **C** — TOTP do logowania, step-up wymaga passkey, jeśli konto go ma.
5. **D** — bez zmian (status quo); błąd Windows Hello leży poza naszym kodem.

## Ocena
| Kryterium (waga) | A | A + K1 | B | C | D |
|---|---|---|---|---|---|
| Ryzyko rezydualne (próg) | **6 High — nie spełnia** | 4 Medium | 6 High | 4 Medium | 3 Medium |
| Prostota (5) | 5 | 4 — jeden kod więcej przed pierwszą operacją wrażliwą | 2 — konfiguracja klucza zostaje | 3 — QR przy codziennych operacjach ze step-upem | 1 |
| Blokada konta (4) | 5 | 5 | 3 | 3 | 2 |
| Wyłudzenie (4) | 1 | 3 | 1 — napastnik i tak wybierze TOTP | 4 | 5 |
| Koszt zmiany (3) | 4 | 4 | 3 | 2 — reguła zależna od stanu konta | 5 |
| Spójność (3) | 5 | 4 | 2 | 1 — „kara” za posiadanie klucza | 3 |
| **Suma ważona** | 76 (odpada na progu) | **76** | 41 | 52 | 57 |

Zgodność: **ASVS 5.0 L2** — V6.3.3 wymaga MFA (TOTP spełnia; czynnik sprzętowy i odporność na phishing dopiero na L3), V6.3.4 (ścieżki udokumentowane i spójne — SR-AUTH-14 do zmiany), V6.5.1 (kod jednorazowy — spełnione: warunkowe `last_used_step`), V6.5.5 (TOTP ≤ 30 s — spełnione). **NIST SP 800-63B-4** (lipiec 2025): TOTP dopuszczony na AAL2 i „nie jest odporny na phishing”; weryfikator na AAL2 **musi oferować** opcję odporną na phishing (passkey zostaje dostępny — spełnione) i **powinien** do niej zachęcać; obowiązek dotyczy agencji federalnych. Zweryfikowane 2026-11-16 (źródła niżej).

## Decyzja
Wybieramy **A + K1**: Administrator ma te same metody co inne role (passkey albo TOTP, ≥ 1 metoda, step-up i ponowne uwierzytelnienie obiema), a w kanale `web` logowanie kodem nie otwiera mu okna step-upu. K1 to jedna linia w miejscu, gdzie sesja zapisuje metodę (`session-start.ts:73`); okno po konfiguracji TOTP zostaje (`totp-enrolment.service.ts:291` — potrzebne do kodów odzyskiwania w kroku 3). Edytor i Tylko odczyt — bez zmian. Bez nowych e-maili i ustawień.

**Kompensacje istniejące (K2 — bez osłabienia, z testami dla roli Administrator):** e-mail do właściciela i alert do wszystkich Administratorów po logowaniu z nieznanej przeglądarki, także kodem (`browser-register.ts:63-71`, `login-totp.service.ts:136`); jednorazowość kodu (`infrastructure/mfa-queries.ts:78-84`); 5 błędów na `loginToken` i 5 błędnych kodów step-upu → koniec sesji (`domain/constants.ts:24, 26`); blokada 15 min po 10 błędach i opóźnienia (EVM-026); alert `second_step_failure_spike`; sesja 60 min / 12 h; sekret TOTP szyfrowany; zmiana metod MFA wymaga hasła i drugiego kroku oraz wysyła e-mail (SR-AUTH-10). **Odrzucone jako zbędne:** e-mail przy każdym logowaniu kodem (szum — Konrad jest jedynym Administratorem), krótsza sesja (mało daje), wariant C. **Opcjonalnie, bez kodu:** akapit w `wzory-dla-pracownikow.md` (blokada aplikacji uwierzytelniającej, konfiguracja na zaufanym komputerze).

**Ryzyko rezydualne (do rejestru — `security-engineer`, proponowane RR-101, właściciel Konrad):** wyłudzenie hasła i kodu w czasie rzeczywistym przez fałszywą stronę daje sesję Administratora w panelu (do 12 h): odczyt danych klientów w zakresie roli. Bez K1 przez pierwsze 15 min także przejęcie kont i operacje nieodwracalne (6 High); z K1 wymagają one nowego kodu (4 Medium — poziom zaakceptowany w RR-17 dla Edytora). Kradzież telefonu z aplikacją i hasłem: 1×3 = 3 Medium. Wykrycie: alert o nowej przeglądarce.

## Konsekwencje
- **Pozytywne:** koniec QR przy każdym logowaniu i problemu Windows Hello; nowe konto Administratora aktywuje się jak każde inne; Administrator może dodać kod w panelu i zalogować się w aplikacji mobilnej (dzisiejsza luka znika, teksty mobilne stają się prawdziwe); mniej wyjątków ról w kodzie i testach.
- **Negatywne:** konto Administratora podatne na phishing w czasie rzeczywistym (ryzyko wyżej); jeden kod więcej przed pierwszą operacją wrażliwą po logowaniu kodem (czekanie na kolejny kod ≤ 30 s).
- **Istniejące konta i dane:** **migracja danych niepotrzebna** — reguła jest wyłącznie w kodzie, kolumny metod sesji zostają. Konto Konrada (passkey) działa bez zmian; kod doda w „Konto → Drugi krok logowania” (ponowne uwierzytelnienie — ostatni raz kluczem), potem klucz może zostać albo zniknąć (≥ 1 metoda). Zmiana roli na Administratora przestaje wymagać klucza. Runbook awaryjny: po `--emergency` aktywacja z wyborem metody; P1 pkt 5 (drugi Administrator albo konto awaryjne z kluczem FIDO2) bez zmian.
- **Kontrakt:** bez zmian łamiących — kody `administrator_passkey_required` i `passkey_required` znikają tylko z opisów, przykładów i katalogu błędów (w odpowiedzi to nie jest `enum`); opisy step-upu „kluczem dostępu” → „drugim krokiem; logowanie kodem nie otwiera okna Administratorowi”. Gdyby `breaking-changes.ts` zgłosił usunięcie — zostawić kody z opisem „nie występuje od EVM-134”, bez `--allow-breaking`.
- **Aplikacja mobilna:** bez zmian kodu i tekstów (już bez roli); `channel_not_allowed` i brak funkcji administracyjnych w kanale `mobile` bez zmian (SR-AUTHZ-12).

**Miejsca do zmiany (realizacja EVM-134):** API — usunięcie `totpAllowedForRole` i 6 wywołań; gałąź Administratora w `canRemoveMethod`; D3 w `decideRoleChange` z faktem `hasPasskey` i kodem w `problem.ts`; K1 w `session-start.ts:73`; komentarze (`passkey.service.ts:2`, `step-up.service.ts:3`, `constants.ts:36`, opisy w `anonymize-customer`, `media-erasure`, `update-milestone`, `milestone-transitions`); testy `apps/api/test/identity/{totp,account-domain,user-access-rules}.test.ts`, `apps/api/test/integration/{second-step-authz,account-second-step,users-access,sync-mutations}.test.ts` + macierz ról i limity dla Administratora (K2). Kontrakt — opisy jak wyżej, regeneracja. Panel — pliki i klucze z „Kontekstu”; wybór metody na stronie konfiguracji dla wszystkich ról (wskazówka o telefonie `mfa-setup-page.tsx:141` dla każdej roli poza Tylko odczyt), testy `apps/web/test/{account-logic,account-operations,user-access}.test.ts(x)`, `account-second-step.test.tsx`, makiety E2E `test/e2e/mock-{account,users}.ts`. Dokumenty (`security-engineer`): SR-AUTH-06, SR-AUTH-14, P1 (wariant D z K1, decyzja 2026-11-16), AB-02, TM-90, TM-11, RR-17 + RR-101, D8 (brzmienie), runbook, `domain-model.md:733`, `api-guidelines.md:117, 123`.

**Pracochłonność:** **M**, ścieżka **pełna** (uwierzytelnianie); `backend-developer` (owner: reguły, K1, testy), `web-developer` (contributor), `security-engineer` (dokumenty, przegląd), `code-reviewer`; ok. 5–6 AC.

## Plan wyjścia
Powrót do „Administrator tylko passkey” = **zmiana kodu, nie konfiguracji** (przełącznik reguły bezpieczeństwa podwaja macierz testów i grozi pomyłką na jedynym środowisku). Koszt S: przywrócenie reguły w `channel-rules.ts`, `second-step-rules.ts`, `access-rules.ts` i gałęzi panelu (revert PR EVM-134). Warunek przed wdrożeniem: każdy aktywny Administrator ma aktywny klucz (jedno zapytanie licznikowe) — inaczej Administrator z samym kodem zostaje bez drogi do panelu poza kodami odzyskiwania i runbookiem. Pośredni krok bez powrotu: wariant C (passkey w step-upie) — addytywnie, bez przebudowy.

## Weryfikacja
- Testy macierzy ról i integracyjne: logowanie, konfiguracja, step-up i ponowne uwierzytelnienie kodem dla Administratora; K1 (logowanie kodem → `step_up_required`, ten sam kod nie przechodzi, nowy kod lub klucz otwiera okno); limity i alerty bez zmian; ostatnia metoda pod blokadą wiersza.
- Demo: Konrad loguje się kodem bez QR, wykonuje operację wrażliwą po jednym dodatkowym kodzie.
- Przegląd po 3 miesiącach (2027-02): alerty o nowej przeglądarce Administratora, liczba resetów awaryjnych, ewentualne incydenty phishingu.

## Źródła (zweryfikowane 2026-11-16)
- NIST SP 800-63B-4, sekcja 2 (AAL2) i 3.1.4–3.1.5 (OTP): https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP ASVS 5.0.0, V6 Authentication: https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md
