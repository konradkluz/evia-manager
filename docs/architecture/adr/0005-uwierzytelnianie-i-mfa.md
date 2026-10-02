# ADR-0005: Uwierzytelnianie i MFA — własny moduł `identity` na sprawdzonych prymitywach, sesje nieprzezroczyste

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-001, EVM-005 (polityki haseł, sesji, MFA), E1 i E9 (M1, M2); ADR-0001, ADR-0004, ADR-0007, ADR-0008, ADR-0011, ADR-0013

## Kontekst i problem
Kilkanaście–kilkadziesiąt kont pracowników (Administrator, Edytor, Tylko odczyt), bez samodzielnej rejestracji. Panel web w przeglądarce i aplikacja mobilna pracująca offline. Wymagania: ASVS 5.0 L2 (V6 uwierzytelnianie, V7 sesje, V9 tokeny), MASVS-AUTH/STORAGE, NIST SP 800-63B-4, **MFA obowiązkowe dla Administratora**, zdalne unieważnianie sesji i urządzeń (były pracownik), budżet ~300 zł/mies., minimum podprocesorów. Decyzja: własny moduł czy dostawca tożsamości (IdP), mechanizmy MFA, model sesji i tokenów dla web i mobile.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Bezpieczeństwo i kontrola nad implementacją (ASVS V6/V7/V9) | 5 | dane klientów, konta firmowe |
| Natychmiastowe unieważnianie sesji i urządzeń | 5 | były pracownik, kradzież telefonu |
| Koszt (w tym koszt MFA) | 4 | budżet |
| Prostota operacyjna | 4 | jedna osoba po stronie firmy |
| MFA (TOTP, passkeys) i obsługa klienta mobilnego offline | 4 | wymaganie baseline |
| RODO i podprocesorzy | 4 | dane pracowników |
| Gotowość na federację w przyszłości (portal klienta, partnerzy, SSO) | 2 | M5+, nie budujemy na zapas |

## Rozważane opcje
1. **A. Własny moduł `identity`** w monolicie na sprawdzonych bibliotekach: `@node-rs/argon2` (Argon2id), `@simplewebauthn/server` (passkeys/WebAuthn), `otpauth` (TOTP); sesje i tokeny nieprzezroczyste przechowywane w bazie.
2. **B. Better Auth** (biblioteka TS „all-in-one” z wtyczkami 2FA, passkeys, sesji).
3. **C. Keycloak 26.8** samodzielnie hostowany (OIDC; aplikacje jako klienci OIDC z PKCE).
4. **D. Zitadel Cloud** (zarządzany IdP, region UE; darmowy do 100 aktywnych użytkowników dziennie).

## Ocena
| Kryterium (waga) | A | B | C | D |
|---|---|---|---|---|
| Bezpieczeństwo i kontrola (5) | 4 | 2 | 5 | 4 |
| Unieważnianie sesji i urządzeń (5) | 5 | 4 | 4 | 4 |
| Koszt (4) | 5 | 5 | 3 | 4 |
| Prostota operacyjna (4) | 5 | 5 | 2 | 4 |
| MFA i klient mobilny offline (4) | 4 | 5 | 5 | 5 |
| RODO i podprocesorzy (4) | 5 | 5 | 5 | 3 |
| Gotowość na federację (2) | 2 | 3 | 5 | 5 |
| **Suma ważona (maks. 140)** | **125** | **116** | **115** | **114** |

Uwagi: B — w 2026 r. seria poważnych podatności (m.in. CVE-2026-53513 SSRF CVSS 9.6, CVE-2026-67336 CVSS 8.7, naprawione w 1.6.11) w szerokiej powierzchni wtyczek; mniejsza kontrola nad tym, co faktycznie działa. C — najdojrzalszy, ale JVM (~1 GB RAM) na małej VM, osobne aktualizacje, motywy logowania i konfiguracja realmów to realny narzut. D — dodatkowy podprocesor danych pracowników, koszt po przekroczeniu darmowego progu (od 100 USD/mies.), zależność od SaaS. A — więcej własnego kodu, ale wąski zakres (logowanie, MFA, sesje, reset, zaproszenia), pełne pokrycie testami, kryptografia wyłącznie z bibliotek. Wersje, licencje, CVE i ceny zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. Własny moduł `identity`** (bez zewnętrznego IdP w MVP) z poniższymi mechanizmami — wartości liczbowe są propozycją do potwierdzenia polityk w EVM-005.

**Hasła (ASVS V6, NIST 800-63B-4):**
- Haszowanie **Argon2id** (`@node-rs/argon2`), parametry co najmniej wg OWASP (m = 19 MiB, t = 2, p = 1), strojone do ~250 ms na produkcyjnej VM; parametry zapisane w hashu, automatyczne przehaszowanie przy logowaniu po zmianie parametrów.
- Długość: **min. 15 znaków** (hasło jako jedyny czynnik wg 800-63B-4), maks. ≥ 128; wszystkie znaki drukowalne i Unicode, bez reguł złożoności i bez okresowej zmiany.
- **Blokada haseł z wycieków:** API Pwned Passwords wyłącznie w trybie **k-anonimowości** (wysyłamy tylko 5 pierwszych znaków skrótu SHA-1, z nagłówkiem dopełnienia) + lokalna lista popularnych haseł i słów kontekstowych (nazwa firmy, e-mail). Gdy API niedostępne — sprawdzenie lokalne i wpis do logu.

**MFA (ASVS V6):**
- **TOTP** (RFC 6238, `otpauth`) i **passkeys / WebAuthn** (`@simplewebauthn/server`) — passkeys najpierw w panelu web; w aplikacji mobilnej TOTP (passkeys natywne w M2+, decyzja w E9).
- **Obowiązkowe dla Administratora:** konto z rolą Administrator bez skonfigurowanego MFA może wyłącznie dokończyć konfigurację MFA; nadanie roli Administrator wymusza MFA przy następnym logowaniu. Dostępne dla wszystkich (rozszerzenie obowiązku — EVM-005).
- 10 jednorazowych kodów odzyskiwania (przechowywane jako hashe); zmiana/wyłączenie MFA wymaga ponownego uwierzytelnienia i generuje powiadomienie e-mail + wpis audytu.

**Ochrona przed brute force i bezpieczny reset:**
- Limity per konto i per IP: po 5 nieudanych próbach rosnące opóźnienie, po 10 próbach w 15 min blokada konta na 15 min + e-mail do użytkownika; per IP maks. 20 prób/min na endpointach logowania i MFA. Jednakowe odpowiedzi i czasy (brak enumeracji kont).
- Reset hasła: token 256-bit, przechowywany jako hash, jednorazowy, **TTL 30 min**; po resecie unieważnienie wszystkich sesji i urządzeń; powiadomienia e-mail o zmianie hasła, MFA, adresu e-mail i logowaniu z nowego urządzenia. Konta tworzy Administrator przez zaproszenie (link **TTL 72 h**). E-mail transakcyjny: Scaleway Transactional Email (UE, ADR-0011).

**Sesje web (ASVS V3, V7):**
- Sesja serwerowa z **nieprzezroczystym** identyfikatorem (256-bit, w bazie tylko hash) w ciasteczku `__Host-evia_session`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- **CSRF:** dla metod zmieniających stan — weryfikacja `Origin` i `Sec-Fetch-Site: same-origin` oraz token synchronizujący w nagłówku `X-CSRF-Token` (powiązany z sesją). Panel i API w tej samej domenie (ADR-0004).
- Wygasanie: **bezczynność 60 min, maks. 12 h**; ponowne uwierzytelnienie (step-up z MFA) dla operacji wrażliwych administratora (zmiana ról, eksport, unieważnianie urządzeń), jeśli ostatnie uwierzytelnienie > 15 min temu. Rotacja identyfikatora po zalogowaniu i zmianie uprawnień.

**Tokeny mobilne (MASVS-AUTH-1/2, MASVS-STORAGE-1, ASVS V9):**
- **Access token nieprzezroczysty, TTL 15 min** (trzymany w pamięci), **refresh token rotowany przy każdym użyciu** z wykrywaniem ponownego użycia: użycie unieważnionego refresh tokenu → unieważnienie całej rodziny tokenów i urządzenia, wpis audytu, alert (ADR-0013). Refresh: bezczynność **14 dni**, maks. **30 dni** — potem pełne logowanie (z MFA, jeśli dotyczy).
- Refresh token i klucz lokalnej bazy w **Keychain (iOS, `AfterFirstUnlockThisDeviceOnly`) / Android Keystore** przez `expo-secure-store` (ADR-0007) — klasa dostępności spójna z ochroną plików bazy i mediów, aby upload i synchronizacja działały w tle przy zablokowanym ekranie; opcjonalna biometria (E9) chroni tylko dostęp do UI i nie wiąże tych kluczy z uwierzytelnieniem użytkownika (ADR-0007, wymaganie spójności klas ochrony).
- Każde logowanie mobilne rejestruje **urządzenie** (`device_id`, platforma, wersja aplikacji, ostatni kontakt). Klucze idempotencji i mutacje synchronizacji są powiązane z `user_id` + `device_id` (ADR-0004, ADR-0008).

**Zdalne unieważnianie (ASVS V7, V9):** Administrator unieważnia sesję, urządzenie lub wszystkie sesje użytkownika (dezaktywacja konta = unieważnienie wszystkiego). Ponieważ **wszystkie tokeny są nieprzezroczyste i sprawdzane w bazie przy każdym żądaniu**, unieważnienie działa natychmiast. Gdyby w przyszłości pojawiły się tokeny samowystarczalne (JWT, np. przy IdP), każdy token musi nieść identyfikator sesji sprawdzany względem listy unieważnień przy każdym żądaniu, a TTL ≤ 5 min. Urządzenie z unieważnioną sesją przy następnym kontakcie dostaje `401` z kodem `session_revoked` i czyści dane lokalne (ADR-0007, ryzyko spike'u EVM-011 c).

**Praca offline (NFR):** aplikacja pozwala przeglądać dane z lokalnej bazy i rejestrować nowe wpisy/media przez **maks. 7 dni** od ostatniego udanego kontaktu z serwerem (odświeżenia tokenu). Po tym czasie dane w aplikacji są ukryte do ponownego zalogowania online; rejestrowanie nowych zdjęć/filmów pozostaje możliwe (zapis do zaszyfrowanej kolejki — „nic nie ginie”), a ich wysłanie wymaga zalogowania. Wartość konfigurowalna, ostateczna decyzja w EVM-005.

**Audyt:** logowania (udane i nieudane), MFA, reset, zmiany ról, unieważnienia, wykrycie ponownego użycia tokenu (ADR-0001).

## Konsekwencje
- **Pozytywne:** zero kosztu i zero dodatkowego podprocesora danych pracowników; natychmiastowe unieważnianie dzięki tokenom nieprzezroczystym; pełna testowalność (macierz ról, testy brute force, reset); kryptografia wyłącznie z bibliotek.
- **Negatywne / koszty:** odpowiadamy za poprawność przepływów (logowanie, MFA, reset, zaproszenia) — wymaga przeglądu `security-engineer` każdej zmiany w `identity` i testów przypadków nadużyć; zapytanie do bazy przy każdym żądaniu (pomijalne przy tej skali; ewentualnie krótki cache w pamięci z unieważnianiem).
- **Ryzyka i mitygacje:**
  - *Błąd we własnej implementacji* → wąski zakres, gotowe prymitywy, testy oparte na ASVS V6/V7 (EVM-005 → AC historyjek E1), zewnętrzny pentest przed produkcją (baseline).
  - *Dostępność API Pwned Passwords (Cloudflare, poza kontrolą)* → tylko k-anonimowość (brak danych osobowych), fallback lokalny.
  - *Utrata telefonu z MFA przez Administratora* → kody odzyskiwania + drugi Administrator; procedura w EVM-005.

## Plan wyjścia
Jeśli pojawi się potrzeba SSO/federacji (portal klienta, partnerzy — M5+) lub wymagania przerosną moduł: przejście na **Keycloak** (samodzielnie) lub **zarządzany IdP w UE**. Warunki dla zarządzanego IdP (security-engineer): **region UE, umowa powierzenia (DPA, art. 28 RODO), koszt MFA ujęty w budżecie, plan wyjścia**. Migracja kont: hashe Argon2id (format PHC) są importowalne do Keycloak (Argon2 domyślny od wersji 25) — bez wymuszania zmiany haseł; MFA TOTP wymaga ponownej rejestracji lub migracji sekretów. Aplikacje przechodzą na OIDC (PKCE) — zmiana w module `identity` i klientach; koszt szacunkowo 1–2 tygodnie.

## Weryfikacja
- E1 (M1): testy ASVS V6/V7 dla logowania, MFA, resetu, blokad; macierz ról; MFA wymuszone dla Administratora (test E2E).
- E9 (M2): unieważnienie urządzenia → odrzucony replay i czyszczenie danych (test E2E mobile).
- Przegląd po 3 miesiącach produkcji: liczba zablokowanych kont, incydenty, zgłoszenia użytkowników.

## Źródła (zweryfikowane 2026-10-02)
- NIST SP 800-63B-4 (finalna 2025; min. 15 znaków dla hasła jako jedynego czynnika): https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf
- OWASP Password Storage Cheat Sheet (Argon2id): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- @node-rs/argon2 2.2.1 (MIT, 2026-09-10), @simplewebauthn/server 14.0.3 (MIT, 2026-09-25), otpauth 9.5.2 (MIT, 2026-09-03): https://www.npmjs.com/package/@node-rs/argon2 , https://www.npmjs.com/package/@simplewebauthn/server , https://www.npmjs.com/package/otpauth
- Better Auth 1.7.7 i podatności 2026: https://better-auth.com/blog/security-update-june-2026 , https://www.sentinelone.com/vulnerability-database/cve-2026-67336/ , https://securityonline.info/better-auth-ssrf-cve-2026-53513/
- Keycloak 26.8.0 (2026-10-01): https://www.keycloak.org/2026/10/keycloak-2680-released ; Argon2 domyślny od 25.0: https://www.keycloak.org/2024/06/keycloak-2500-released
- Zitadel — cennik (darmowy do 100 DAU, Pro od 100 USD/mies.): https://zitadel.com/pricing
- Pwned Passwords API (k-anonimowość): https://haveibeenpwned.com/API/v3#PwnedPasswords
- Scaleway Transactional Email (300 e-maili/mies. bez opłat): https://www.scaleway.com/en/pricing/managed-services/
