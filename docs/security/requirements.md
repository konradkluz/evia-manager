# Wymagania bezpieczeństwa EVia Manager — v1

> Dokument żywy (EVM-005). Właściciel: `security-engineer`. Wersja **v1, 2026-10-03** — do akceptacji Konrada na demo EVM-005 razem z politykami P1–P12 ([`policies.md`](policies.md)). Wejście do EVM-010 (backlog M1) i do `/refine` historyjek M2. Model zagrożeń (`TM-xx`, `AB-xx`, `RR-xx`): [`threat-model.md`](threat-model.md); RODO: [`rodo.md`](rodo.md); baseline: [`README.md`](README.md).

## Spis treści
1. [Jak korzystać](#jak-korzystać)
2. [Katalog wymagań](#katalog-wymagań)
3. [Wymagania do wplecenia w AC — per epik](#wymagania-do-wplecenia-w-ac--per-epik)
4. [Pokrycie ASVS 5.0.0](#pokrycie-asvs-500)
5. [MASVS 2.1.0 — 24 kontrole](#masvs-210--24-kontrole)
6. [Bramki bezpieczeństwa CI (AC5)](#bramki-bezpieczeństwa-ci-ac5)
7. [Źródła](#źródła)
8. [Załącznik A — ASVS 5.0.0 L1 i L2 → SR albo N/D](#załącznik-a--asvs-500-l1-i-l2--sr-albo-nd)

## Jak korzystać
**Dla `product-owner` (wplatanie w AC, EVM-010 i `/refine`)**
- W sekcji „Bezpieczeństwo i prywatność” historyjki wypisz numery `SR-…` z listy jej epiku ([rozdział 3](#wymagania-do-wplecenia-w-ac--per-epik)). Wymagania, które zmieniają zachowanie widoczne dla użytkownika lub klienta API, zapisz jako AC w formie „Zakładając / Gdy / Wtedy” (przykłady przy każdym epiku).
- Wymagania standardowe (np. nagłówki, lint, bramki CI) wystarczy wymienić w sekcji „Bezpieczeństwo i prywatność” — sprawdzają je bramki i Definition of Done; nie zużywaj na nie limitu 8 AC.
- Wartość z polityki, której Konrad jeszcze nie zaakceptował, wpisz jako rekomendowaną z dopiskiem „(P#, do akceptacji)”; po decyzji zaktualizuj historyjkę.
- Wzór:

  ```markdown
  **AC5 — Brak dostępu do cudzych mediów (SR-AUTHZ-02, SR-AUTHZ-05)**
  - Zakładając zlecenie A i zdjęcie należące do zlecenia B
  - Gdy Edytor wysyła `POST /api/v1/work-orders/{A}/media-assets/{zdjęcie z B}/download-url`
  - Wtedy API zwraca `404 not_found`, a przypadek IDOR jest w wygenerowanej macierzy ról
  ```

**Dla `qa-engineer` (weryfikacja)**
- Kolumna „Weryfikacja” mówi, czym sprawdzić wymaganie: test jednostkowy, integracyjny, kontraktowy, macierz ról, E2E web, E2E Android, bramka CI, test wdrożenia, przegląd albo ćwiczenie.
- Raport QA: dla `SR-…` wplecionych w AC — wiersz w macierzy AC → test; dla pozostałych `SR-…` z sekcji „Bezpieczeństwo i prywatność” — dowód z bramki lub przeglądu.
- Sign-off wydania (`security-engineer`): każde `SR-…` przypisane do epików wydania ma dowód; każde odstępstwo jest ryzykiem zaakceptowanym przez Konrada.

**Wersje standardów**
- **OWASP ASVS 5.0.0, poziom 2** = wszystkie wymagania L1 i L2 (253 z 345). Identyfikatory w formacie `V<rozdział>.<sekcja>.<wymaganie>` zgodnie z oficjalnym plikiem CSV wydania 5.0.0. Wymagania L3 cytujemy tylko z dopiskiem „(L3)” — to kontrole wyższego poziomu przyjęte świadomie, bo są tanie lub wynikają z ADR.
- **OWASP MASVS 2.1.0** — 24 kontrole w 8 grupach. Od MASVS v2 standard nie ma poziomów: L1, L2, R i P to **profile testowe** MAS z OWASP MASTG (MAS-L1, MAS-L2, MAS-R, MAS-P). Przyjmujemy **MAS-L1 i MAS-P** oraz wybrane kontrole **MAS-L2** dla danych wrażliwych (STORAGE, AUTH; NETWORK-2 — decyzja P8); MAS-R (odporność na analizę i modyfikację) jest poza zakresem.
- Identyfikatory ASVS i MASVS zweryfikowane skryptem z oficjalnych plików wydań (2026-10-03): 0 nieistniejących, każde L3 oznaczone. Uwaga: [`../architecture/api-guidelines.md`](../architecture/api-guidelines.md) cytuje ASVS 1.2.10 (formula injection) — to wymaganie L3, przyjęte świadomie w SR-API-14.

## Katalog wymagań
Kolumny: wymaganie sformułowane tak, by dało się je wkleić do AC; ASVS / MASVS; moduł lub warstwa (moduły z mapy modułów w [`../architecture/README.md`](../architecture/README.md), w tym `parties` z EVM-002; `web` — panel, `mobile` — aplikacja, `infra` — proxy i infrastruktura, `ci` — CI i łańcuch dostaw); epik E1–E14 albo historyjka M0 (M4, M5 — przyszłe, jawnie oznaczone); weryfikacja; źródło (ADR, `TM`/`AB` z modelu zagrożeń, polityka `P#`).

### AUTH — Uwierzytelnianie (V6)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-AUTH-01 | Hasło ma min. 15 i maks. ≥ 128 znaków, dowolne znaki Unicode (normalizacja NFC), bez reguł złożoności i bez okresowej zmiany; porównanie bez obcinania i zmiany wielkości liter; pole maskowane z opcją podglądu; wklejanie i menedżery haseł działają. | V6.2.1, V6.2.5, V6.2.6, V6.2.7, V6.2.8, V6.2.9, V6.2.10 | `identity`, `web`, `mobile` | E1, E9 | jednostkowe, E2E web | ADR-0005, P2 |
| SR-AUTH-02 | Przy ustawianiu i zmianie hasła odrzucamy: ≥ 3000 najpopularniejszych haseł, słowa kontekstowe z P2 i hasła z wycieków (Pwned Passwords wyłącznie k-anonimowo: 5 znaków skrótu SHA-1 + dopełnienie); przy niedostępności API — sprawdzenie lokalne i wpis w logu. | V6.1.2, V6.2.4, V6.2.11, V6.2.12 | `identity` | E1 | jednostkowe, integracyjne (mock API) | ADR-0005, P2, TM-51 |
| SR-AUTH-03 | Zmiana hasła wymaga bieżącego hasła, wysyła e-mail do użytkownika i proponuje zakończenie pozostałych sesji. | V6.2.2, V6.2.3, V7.4.3 | `identity` | E1 | integracyjne, E2E web | ADR-0005 |
| SR-AUTH-04 | Hasła haszowane Argon2id (`@node-rs/argon2`; co najmniej m = 19 MiB, t = 2, p = 1, strojone do ~250 ms na VM prod); parametry zapisane w hashu, przehaszowanie przy logowaniu po zmianie parametrów. | V11.4.2, V11.2.2 | `identity` | E1 | jednostkowe | ADR-0005 |
| SR-AUTH-05 | Ochrona przed brute force i credential stuffing: rosnące opóźnienie po 5 nieudanych próbach, blokada konta na 15 min po 10 próbach w 15 min z e-mailem do użytkownika, maks. 20 prób/min/IP na logowaniu i MFA; jednakowe odpowiedzi i czasy dla istniejącego i nieistniejącego konta; mechanizm opisany w dokumentacji modułu `identity`. | V6.1.1, V6.3.1, V6.3.8 (L3) | `identity`, `infra` | E1, E9 | integracyjne, DAST | ADR-0005, TM-16, AB-01 |
| SR-AUTH-06 | MFA obowiązkowe dla każdej roli (P1): konto bez MFA może wyłącznie dokończyć konfigurację (`403 mfa_enrollment_required`); w panelu passkey (Administrator — obowiązkowo passkey) lub TOTP, w aplikacji mobilnej TOTP — z dostępem wyłącznie do operacji kanału `mobile`, bez funkcji administracyjnych i step-upu (SR-AUTHZ-12); SMS i e-mail nie są czynnikiem. | V6.3.3, V6.3.4, V6.3.6 (L3) | `identity`, `web`, `mobile` | E1, E9 | integracyjne, E2E web | ADR-0005, P1, AB-01, AB-02 |
| SR-AUTH-07 | TOTP wg RFC 6238: sekret z CSPRNG (≥ 160 bitów), okres 30 s, tolerancja ±1 krok, każdy kod przyjmowany tylko raz (zapamiętany ostatni krok), sekret szyfrowany w bazie przez `platform/crypto` (P12). | V6.5.1, V6.5.3, V6.5.5 | `identity`, `platform` | E1 | jednostkowe | ADR-0005, P12 |
| SR-AUTH-08 | Kody odzyskiwania: 10 kodów z CSPRNG po ≥ 20 znaków base32, przechowywane jako skróty Argon2id, jednorazowe; wygenerowanie nowych unieważnia poprzednie; użycie kodu = e-mail i audyt. | V6.5.1, V6.5.2, V6.5.3, V6.5.4 | `identity` | E1 | jednostkowe, integracyjne | ADR-0005, P1 |
| SR-AUTH-09 | Passkeys (WebAuthn, `@simplewebauthn/server`): weryfikacja RP ID i originu, jednorazowe wyzwanie ≥ 128 bitów z TTL, `userVerification: required`, odrzucenie podpisu niezgodnego z zapisanym kluczem publicznym. | V6.3.3, V11.6.1 | `identity`, `web` | E1 | integracyjne | ADR-0005, P1 |
| SR-AUTH-10 | Zmiana hasła, adresu e-mail i konfiguracji MFA (dodanie, usunięcie, nowe kody) wymaga pełnego ponownego uwierzytelnienia, wysyła e-mail na dotychczasowy adres i zapisuje zdarzenie audytu. | V7.5.1, V6.3.7 (L3) | `identity`, `audit` | E1 | integracyjne | ADR-0005 |
| SR-AUTH-11 | Reset hasła: token 256 bitów z CSPRNG, w bazie tylko skrót, jednorazowy, TTL 30 min; reset nie omija MFA (po ustawieniu hasła wymagany drugi czynnik); kończy wszystkie sesje web i sesje wszystkich urządzeń w trybie „Wyloguj urządzenie” (P2, SR-MOB-04) — następne żądanie: `401 session_revoked`, kolejka zostaje, a ponowne logowanie nowym hasłem i MFA na tej samej instalacji wraca do tego samego `deviceId`; reset nie unieważnia urządzeń na stałe (to tylko „Zablokuj i wyczyść” i dezaktywacja) — nieznane urządzenia z listy urządzeń użytkownika (SR-SESS-07) Administrator po resecie czyści ręcznie trybem „Zablokuj i wyczyść”; brak pytań pomocniczych i podpowiedzi hasła. | V6.4.1, V6.4.2, V6.4.3 | `identity` | E1, E9 | integracyjne (tryb urządzeń po resecie), E2E web, E2E Android (kolejka po resecie) | ADR-0005, P2, TM-44 |
| SR-AUTH-12 | Konta tworzy wyłącznie Administrator (step-up) przez zaproszenie: link jednorazowy, TTL 72 h, w bazie skrót tokenu; konto aktywne dopiero po ustawieniu hasła i MFA; w systemie nie ma kont domyślnych — pierwszy Administrator powstaje jednorazowym poleceniem na serwerze (bootstrap), które po użyciu jest blokowane. | V6.3.2, V6.4.1 | `identity` | E1 | integracyjne | ADR-0005 |
| SR-AUTH-13 | Utrata MFA: użytkownikowi resetuje je Administrator (step-up) po weryfikacji tożsamości (osobiście lub rozmowa wideo), z wymuszoną ponowną rejestracją, e-mailem i audytem; reset kończy wszystkie sesje web i sesje urządzeń w trybie „Wyloguj urządzenie” jak SR-AUTH-11 (`401 session_revoked`, kolejka zostaje, ponowne logowanie z nowym MFA wraca do tego samego `deviceId`); gdy drugi czynnik zginął razem z telefonem z aplikacją (kradzież, zgubienie), Administrator w tej samej procedurze wybiera dla tego urządzenia „Zablokuj i wyczyść” (P2, P7); dla Administratora obowiązuje procedura z P1 (drugi Administrator lub klucz awaryjny, runbook). | V6.4.4 | `identity` | E1, E8 | integracyjne (tryb urządzeń po resecie), ćwiczenie runbooka | ADR-0005, P1, P2, AB-22 |
| SR-AUTH-14 | Ścieżki uwierzytelnienia są udokumentowane i jedyne: web — hasło + passkey/TOTP (Administrator — passkey); mobile — hasło + TOTP, potem refresh token (sekret instalacji urządzenia nie jest czynnikiem — tylko przypina sesję do zarejestrowanego urządzenia, SR-MOB-04); ścieżka logowania nadaje sesji stały kanał (`web` albo `mobile`), który ogranicza dostępne operacje (SR-AUTHZ-12); w produkcji brak endpointów testowych, kont serwisowych i obejść MFA. | V6.1.3, V6.3.4 | `identity` | E1, E9 | przegląd, test inwentarza tras | ADR-0005 |
| SR-AUTH-15 | E-mail do użytkownika o: logowaniu z nowego urządzenia, blokadzie konta, zmianie hasła, e-maila i MFA, użyciu kodu odzyskiwania; alert do Administratorów o logowaniu Administratora z nowego urządzenia. | V6.3.5 (L3), V6.3.7 (L3) | `identity` | E1 | integracyjne (Mailpit) | ADR-0005, ADR-0013 |

### SESS — Sesje i tokeny (V7, V3.3)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-SESS-01 | Sesja web: identyfikator nieprzezroczysty 256 bitów z CSPRNG, w bazie tylko skrót, weryfikowany w backendzie przy każdym żądaniu; ciasteczko `__Host-evia_session` z `HttpOnly; Secure; SameSite=Strict; Path=/`. | V7.2.1, V7.2.2, V7.2.3, V3.3.1, V3.3.2, V3.3.3, V3.3.4 | `identity`, `web` | E1 | integracyjne, DAST | ADR-0005, TM-23 |
| SR-SESS-02 | Nowy identyfikator sesji po zalogowaniu, step-upie i zmianie uprawnień; poprzedni natychmiast nieważny. | V7.2.4 | `identity` | E1 | integracyjne | ADR-0005, TM-23 |
| SR-SESS-03 | Sesja web wygasa po 60 min bezczynności i maks. 12 h od zalogowania (P2); wartości i uzasadnienie w dokumentacji `identity`. | V7.1.1, V7.3.1, V7.3.2 | `identity` | E1 | integracyjne (kontrolowany zegar) | ADR-0005, P2 |
| SR-SESS-04 | Limity równoległych sesji (P2): maks. 5 sesji web na użytkownika (szósta zamyka najstarszą z e-mailem), maks. 2 aktywne urządzenia mobilne (z ważną sesją); ponowne logowanie tego samego użytkownika na tej samej instalacji wraca do tego samego `deviceId` (SR-MOB-04) i nie zajmuje nowego miejsca; trzecie urządzenie wymaga wylogowania albo unieważnienia jednego z aktywnych. | V7.1.2 | `identity` | E1, E9 | integracyjne | P2 |
| SR-SESS-05 | Wylogowanie dostępne na każdym ekranie po zalogowaniu; unieważnia sesję w bazie, czyści pamięć podręczną zapytań w przeglądarce i wysyła `Clear-Site-Data: "cache", "storage"`. | V7.4.1, V7.4.4, V14.3.1 | `identity`, `web` | E1 | E2E web | ADR-0005, TM-10 |
| SR-SESS-06 | Dezaktywacja konta natychmiast unieważnia wszystkie sesje web (następne żądanie: `401 session_revoked`) oraz wszystkie urządzenia i rodziny refresh tokenów użytkownika w trybie „Zablokuj i wyczyść” (następne żądanie z urządzenia: `401 device_wipe_required` — proponowany kod, P2, SR-MOB-04). | V7.4.2 | `identity` | E1, E9 | integracyjne, E2E Android | ADR-0005, P2, AB-03 |
| SR-SESS-07 | Administrator (step-up) kończy wybraną sesję, wszystkie sesje użytkownika lub unieważnia urządzenie; użytkownik widzi listę własnych sesji i urządzeń i kończy je po ponownym uwierzytelnieniu. | V7.4.5, V7.5.2 | `identity`, `web` | E1, E9 | integracyjne, E2E web | ADR-0005, AB-03 |
| SR-SESS-08 | Step-up (MFA, gdy ostatnie uwierzytelnienie > 15 min temu) dla operacji z listy P2: zarządzanie użytkownikami i rolami, unieważnianie cudzych sesji i urządzeń, eksport, korekty płatności, trwałe usunięcie, anonimizacja i redakcja, odczyt audytu, zmiany katalogu i szablonów (`403 step_up_required`); operacje ze step-upem są dostępne wyłącznie w kanale `web` (SR-AUTHZ-12). | V7.5.3 (L3), MASVS-AUTH-3 | `identity`, `authorization` | E1, E2, E3, E5, E6, E7 | macierz ról, integracyjne | ADR-0005, P2, TM-24 |
| SR-SESS-09 | Tokeny mobilne: access token nieprzezroczysty z TTL 15 min tylko w pamięci; refresh token rotowany przy każdym użyciu (bezczynność 14 dni, maks. 30 dni); odświeżanie wykonuje jeden proces w `sync-core` (pierwszy plan i zadania w tle czekają na to samo odświeżenie, nowy refresh token zapisany trwale przed użyciem nowego access tokenu); bezpośrednio poprzedni refresh token przedstawiony ponownie w oknie tolerancji 30 s od rotacji, zanim którykolwiek jego następnik został użyty, daje nową parę tokenów bez wykrycia (utracona odpowiedź, wyścig), a pierwszy użyty następnik unieważnia pozostałe; każde inne użycie unieważnionego refresh tokenu (także poprzedniego po 30 s) unieważnia rodzinę tokenów i sesje urządzenia jak „Wyloguj urządzenie” (kolejka zostaje, P2), zapisuje audyt i wysyła alert. | V7.2.1, V7.2.2, V7.3.1, V7.3.2, MASVS-AUTH-1 | `identity`, `mobile` | E9 | integracyjne (wyścig dwóch odświeżeń, utracona odpowiedź, kontrolowany zegar), jednostkowe (`sync-core`), E2E Android | ADR-0005, P2, TM-02, AB-09 |
| SR-SESS-10 | CSRF (web): każde żądanie zmieniające stan przechodzi weryfikację `Origin` i `Sec-Fetch-Site: same-origin` oraz tokenu synchronizującego `X-CSRF-Token` powiązanego z sesją (`403 csrf_failed`); operacje wrażliwe tylko metodami `POST`/`PUT`/`PATCH`/`DELETE`. | V3.5.1, V3.5.2, V3.5.3 | `identity`, `web`, `platform` | EVM-008, E1 | integracyjne, DAST | ADR-0005, TM-09 |

### AUTHZ — Autoryzacja (V8)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-AUTHZ-01 | Deny-by-default: globalny guard sprawdza każde żądanie; operacja bez polityki zwraca `403`, a test startowy „każda trasa ma politykę” blokuje build; lint kontraktu wymaga `x-evia-authz` w każdej operacji. | V8.1.1, V8.2.1, V8.3.1 | `authorization`, `platform` | EVM-008, E1, E2, E3, E4, E5, E6, E7 | bramka CI (lint, test startowy) | ADR-0001, ADR-0004, TM-18 |
| SR-AUTHZ-02 | Polityka obiektowa działa przez kotwicę (`work_order_id` albo kotwica dokumentu) przy każdym odczycie i zmianie; obiekt spoza uprawnień albo soft-deleted (poza Administratorem) → `404 not_found`; w ścieżkach zagnieżdżonych dziecko musi należeć do rodzica z URL; identyfikator nadany przez klienta nie daje dostępu. | V8.2.2 | `authorization`, `customers`, `sites`, `parties`, `work-orders`, `procedures`, `payments`, `timeline`, `media` | E2, E3, E4, E5, E6, E7 | macierz ról (przypadek IDOR) | ADR-0004, TM-17, AB-06 |
| SR-AUTHZ-03 | Listy, wyszukiwanie, liczniki, sumy i kanał synchronizacji filtruje ta sama polityka co odczyt pojedynczego obiektu — warunkiem w zapytaniu, nie odsiewaniem po pobraniu strony. | V8.2.2 | `authorization`, `work-orders`, `customers`, `sync` | E2, E3, E7, E10 | integracyjne | ADR-0001, ADR-0008, AB-06 |
| SR-AUTHZ-04 | Uprawnienia do pól: pola ukryte per rola deklaruje `x-evia-authz.hiddenFields` (v1: brak — P6); pola kontrolowane przez serwer są `readOnly` i odrzucane na wejściu (`400 validation_failed`, kod `read_only_field`). | V8.1.2, V8.2.3, V15.3.3 | `authorization`, `platform` | EVM-008, E2, E3, E4, E6, E7 | kontraktowe, integracyjne | TM-18, AB-13 |
| SR-AUTHZ-05 | Testy macierzy ról generowane z kontraktu: każda operacja × {Administrator, Edytor, Tylko odczyt, niezalogowany} × kanał {`web`, `mobile`} (SR-AUTHZ-12) + przypadek IDOR (obiekt innej kotwicy) + test kompletności (100% operacji); dla płatności i statusów — testy ścieżek w grafie przejść (sekwencje przejść, edycje pól, soft delete obiektu nadrzędnego). | V8.1.1, V8.2.1, V8.2.2 | `authorization`, `platform` | EVM-008, E1, E2, E3, E4, E5, E6, E7 | bramka CI (macierz ról) | ADR-0004, ADR-0014, TM-18 |
| SR-AUTHZ-06 | Rola Tylko odczyt wg P6: każda mutacja → `403`; widzi płatności; nie pobiera oryginałów mediów ani dokumentów `identity_data` i `building_security` (tylko metadane i podglądy); brak eksportów; brak dostępu do aplikacji mobilnej — reguła rola × kanał w `identity` (SR-AUTHZ-12): logowanie mobilne i każde żądanie tokenem mobilnym → `403 channel_not_allowed`. | V8.1.1, V8.2.1, V8.2.3 | `authorization`, `media`, `payments`, `identity` | E1, E6, E7, E9 | macierz ról | P6 |
| SR-AUTHZ-07 | Klasa poufności dokumentu = maksimum z klasy rodzaju (`DocumentKind`) i nadpisania dla pojedynczego dokumentu; Administrator i Edytor mogą klasę podnieść, nikt nie może jej obniżyć poniżej klasy rodzaju; zmiana jest audytowana; przy rodzaju `other` UI pyta o dane identyfikacyjne. | V8.2.2, V8.2.3 | `media`, `catalog`, `web` | E6 | integracyjne, macierz ról | P6, AB-20 |
| SR-AUTHZ-08 | Historia lokalizacji: każdy dokument i zdjęcie poprzednich zleceń jest autoryzowany kotwicą zlecenia źródłowego (nie samym `siteId`), bez dokumentów `identity_data`, tylko w panelu (nie na telefonie); historyjka wymaga przeglądu `security-engineer`. | V8.2.2 | `sites`, `media`, `authorization` | E3, E6 | macierz ról (IDOR przez `siteId`) | AB-19 |
| SR-AUTHZ-09 | Zmiana roli, dezaktywacja i (od M4) odpięcie od zlecenia działają od następnego żądania (brak pamięci podręcznej uprawnień dłuższej niż żądanie lub unieważnianie zdarzeniem); zmiana roli kończy sesje urządzeń użytkownika wg P2 — między Administratorem a Edytorem jak „Wyloguj urządzenie” (kolejka zostaje), na Tylko odczyt jak „Zablokuj i wyczyść” po potwierdzeniu `pendingItemsReported` przez Administratora (rola bez kanału `mobile`, SR-AUTHZ-12); odpięcie od zlecenia daje urządzeniu `resync_required`. | V8.3.2 (L3) | `authorization`, `identity`, `sync` | E1, E10 | integracyjne | ADR-0008, P2 |
| SR-AUTHZ-10 | Ścieżki nie omijają ról ani step-upu: skutek zarezerwowany dla Administratora ze step-upem (np. korekta płatności) nie jest osiągalny sekwencją przejść, edycją pól ani soft delete; soft delete zlecenia z transzami `paid` wymaga Administratora ze step-upem (z transzami `invoiced` jest niedozwolony — `409 has_active_dependents`, model EVM-002). | V2.3.1, V8.2.1 | `work-orders`, `payments`, `authorization` | E3, E7 | macierz ról (ścieżki) | AB-17, uwaga 1 EVM-002 |
| SR-AUTHZ-11 | Funkcje administracyjne (użytkownicy, role, sesje innych, konfiguracja, audyt, retencja) dostępne wyłącznie dla Administratora ze step-upem w kanale `web` (SR-AUTHZ-12) przez to samo API z tymi samymi kontrolami — bez osobnego panelu, endpointów serwisowych ani dostępu do bazy z panelu. | V8.4.2 (L3) | `authorization`, `identity` | E1 | macierz ról | TM-24 |
| SR-AUTHZ-12 | Najmniejsze uprawnienia kanału: kanał sesji (`web` — ciasteczko panelu, `mobile` — token aplikacji) nadaje ścieżka logowania i jest niezmienny w sesji (nigdy z nagłówków `X-Client-*`); `x-evia-authz.channels` jest obowiązkowe w każdej operacji, z wartością wyjściową `[web]`; `mobile` tylko dla operacji używanych przez aplikację — logowanie mobilne, odświeżenie tokenu i wylogowanie, synchronizacja (`sync/mutations`, `sync/changes`), sesje uploadu, URL-e miniatur, odczyt własnego profilu i konfiguracji potrzebnej offline, `meta/client-config`; operacje z `stepUp: true`, funkcje administracyjne (SR-AUTHZ-11), eksporty, pobieranie oryginałów i dokumentów oraz zmiana hasła i MFA — wyłącznie `web` (lint kontraktu; gdy jedna operacja `download-url` obsługuje kilka wariantów pliku, polityka ogranicza kanał per wariant); reguła rola × kanał w `identity` (MVP: Tylko odczyt bez kanału `mobile`) sprawdzana przy logowaniu, odświeżeniu tokenu i każdym żądaniu; operacja spoza kanału sesji albo rola bez dostępu do kanału → `403 channel_not_allowed` przed sprawdzeniem obiektu (proponowany kod — uwaga dla `solution-architect`); macierz ról ma wymiar kanału (SR-AUTHZ-05). | V8.1.1, V8.2.1, V8.3.1, V8.1.3 (L3), V8.2.4 (L3) | `authorization`, `identity`, `platform` | EVM-008, E1, E9, E10, E11 | bramka CI (lint kontraktu), macierz ról (kanał), integracyjne | ADR-0004, ADR-0005, P1, P6, AB-02 |

### INPUT — Walidacja wejścia i wstrzyknięcia (V1, V2)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-INPUT-01 | Każde wejście (API, kolejka synchronizacji) walidowane po stronie serwera schematem generowanym z kontraktu: `additionalProperties: false`, `maxLength`, `maxItems`, `pattern`/`format`, zakresy liczb, listy dozwolonych dla enumów, sortowania i filtrów; TypeScript `strict`, ścisłe porównania; walidacja w kliencie służy tylko wygodzie. | V2.1.1, V2.2.1, V2.2.2, V1.4.2, V15.3.5 | `platform` | EVM-008, E2, E3, E4, E5, E6, E7, E10, E11, E12, E13 | kontraktowe, integracyjne, Schemathesis | ADR-0002, ADR-0004, TM-19 |
| SR-INPUT-02 | Spójność danych złożonych sprawdza domena i jest opisana w kontrakcie: etap należy do procesu tego zlecenia, rodzaj strony w polach `…PartyId`, suma udziałów planu płatności = 100, daty biznesowe (np. `waitingSince` nie z przyszłości). | V2.1.2, V2.2.3 | `work-orders`, `procedures`, `payments`, `sites`, `catalog` | E3, E4, E7 | jednostkowe | EVM-002 (model) |
| SR-INPUT-03 | Zapytania wyłącznie parametryzowane (Kysely, `sql` z parametrami); konkatenacja SQL zakazana (lint + Semgrep); wzorce `LIKE` i trigramowe z escapowaniem `%`, `_`, `\`; sortowanie i filtry tylko z listy dozwolonych pól. | V1.2.4, V1.1.2 | `platform`, `customers`, `sites`, `parties`, `work-orders` | EVM-008, E2, E3 | SAST (bramka), integracyjne | ADR-0003, TM-19, AB-18 |
| SR-INPUT-04 | Brak dynamicznego wykonywania kodu (`eval`, `new Function`, szablony budowane z danych); programy zewnętrzne (ffmpeg, ffprobe, sharp, clamd) wywoływane z tablicą argumentów, bez powłoki, ze ścieżkami nadanymi przez serwer; komunikaty formatowane bez danych użytkownika w łańcuchu formatu. | V1.2.5, V1.3.2, V1.3.7, V1.3.10 | `platform`, `media` | EVM-008, E6 | SAST (bramka), przegląd | TM-35 |
| SR-INPUT-05 | Tekst wejściowy normalizowany do NFC jeden raz na granicy, przycięty, bez znaków sterujących (poza nową linią w polach wielowierszowych); pola swobodne to zwykły tekst — HTML i Markdown w MVP niedozwolone (ich wprowadzenie wymaga biblioteki sanityzującej i przeglądu security). | V1.1.1, V1.3.1, V1.3.3, V1.3.5 | `platform`, `timeline` | EVM-008, E2, E5 | jednostkowe | TM-08 |
| SR-INPUT-06 | Akceptujemy tylko `application/json` (`415` dla innych); brak XML i deserializacji typów wskazanych przez klienta; zduplikowany lub nieznany parametr zapytania → `400`; schematy ścisłe odrzucają `__proto__`/`constructor` (ochrona przed prototype pollution), a mapy z danych wejściowych budujemy przez `Map` lub obiekty bez prototypu. | V1.5.1, V1.5.2, V15.3.6, V15.3.7 | `platform` | EVM-008 | integracyjne, Schemathesis | TM-19 |
| SR-INPUT-07 | E-maile: odbiorca i temat tylko z walidowanych pól bez CR/LF, treść ze stałych szablonów w kodzie; e-maile do pracowników zawierają link, nie dane klientów. | V1.3.11, V1.3.7 | `identity`, `platform` | E1 | jednostkowe | TM-80 |
| SR-INPUT-08 | Wyrażenia regularne na danych użytkownika: limit długości przed dopasowaniem, brak konstrukcji z katastrofalnym backtrackingiem (reguła Semgrep), metaznaki escapowane przy budowaniu wzorca z danych. | V1.2.9, V1.3.12 (L3) | `platform` | EVM-008 | SAST | AB-18 |

### API — API i logika biznesowa (V2, V4, V13, V15)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-API-01 | Każdy błąd jako `application/problem+json` (RFC 9457) bez stack trace'ów, SQL, nazw klas, ścieżek plików i wartości pól; nieobsłużony wyjątek → `500 internal_error` z `traceId` (globalny handler „ostatniej szansy”); tryb debug wyłączony poza dev. | V16.5.1, V13.4.2, V16.5.4 (L3) | `platform` | EVM-008 | integracyjne, DAST | ADR-0004, TM-20 |
| SR-API-02 | Limity wg P10 i ADR-0004: treść JSON ≤ 1 MB, strona ≤ 100, 300 żądań/min/użytkownika, limity per IP, wyszukiwanie 60/min, limity obiektów podrzędnych i długości pól z `api-guidelines.md`; przekroczenie → `429 rate_limited` z `Retry-After`; limity opisane w kontrakcie. | V2.1.3, V2.3.2, V2.4.1, V15.1.3 | `platform`, `infra` | EVM-008, E1, E2, E3 | integracyjne | ADR-0004, P10, TM-22 |
| SR-API-03 | Każda odpowiedź API (także błąd) ma `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Type` z `charset=utf-8` i `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; brak nagłówków CORS. | V4.1.1, V3.2.1, V3.4.2, V3.4.4, V3.4.5, V14.2.2, V14.3.2 | `platform`, `infra` | EVM-008 | integracyjne, DAST | ADR-0004, P11 |
| SR-API-04 | Dane osobowe i sekrety nigdy w ścieżce ani query: wyszukiwanie przez `POST …/search`, reguła lint zakazuje parametrów zapytania o nazwach danych osobowych, kursory są nieprzezroczyste i nie zawierają danych. | V14.2.1 | `platform` | EVM-008, E2, E3 | bramka CI (lint kontraktu) | AB-16 |
| SR-API-05 | Idempotencja: klucz `Idempotency-Key` (mobile obowiązkowo) powiązany z `userId` + `deviceId` z sesji, ze skrótem treści i wynikiem minimalnym, retencja 30 dni; ta sama treść → zapisany wynik, inna treść → `422 idempotency_mismatch`, równoległe → `409 idempotency_in_progress`. | — | `platform`, `sync` | E11, E12, E13 | integracyjne | ADR-0004, ADR-0008, AB-09 |
| SR-API-06 | Komenda domenowa (zmiana, dziennik, audyt, dziennik zmian, outbox) wykonuje się w jednej transakcji; błąd walidacji lub autoryzacji = brak jakichkolwiek skutków. | V2.3.3, V16.5.3 | `platform` | EVM-008, E3 | integracyjne | ADR-0001, ADR-0010 |
| SR-API-07 | Statusy zmieniają wyłącznie komendy przejść z tabel przejść (`409 invalid_state_transition` dla przejść spoza tabeli, `PATCH` statusu odrzucany); obiekty współdzielone z `If-Match` (`412 version_conflict`); licznik numerów zleceń bez luk i bez wyścigów. | V2.3.1, V2.3.4 | `work-orders`, `procedures`, `payments` | E3, E4, E7 | integracyjne, macierz ról | EVM-002 (model), AB-17 |
| SR-API-08 | Minimalna wersja klienta: `426 client_version_unsupported` sterowane konfiguracją bez wdrożenia kodu — także jako odcięcie wersji z podatnością; kolejka offline zostaje zachowana. | MASVS-CODE-2 | `platform`, `mobile` | EVM-008, EVM-009, E14 | integracyjne, E2E Android | ADR-0004 |
| SR-API-09 | Nagłówki pośrednika (`X-Forwarded-For`, `X-Forwarded-Proto`) ustawia wyłącznie Caddy, nadpisując wartości od klienta; API ufa tylko proxy z sieci wewnętrznej i bierze IP klienta z tego pola (limity, audyt). | V4.1.3, V15.3.4 | `infra`, `platform` | EVM-008 | integracyjne, test wdrożenia | TM-14 |
| SR-API-10 | HTTP → HTTPS przekierowuje tylko ścieżki panelu; `/api/*` po HTTP jest odrzucane bez przekierowania; obsługiwane są wyłącznie metody z kontraktu, `TRACE` wyłączony. | V4.1.2, V13.4.4, V4.1.4 (L3) | `infra` | EVM-008 | test wdrożenia, DAST | TM-12 |
| SR-API-11 | Granice wiadomości HTTP: Caddy jest jedynym punktem wejścia i normalizuje żądania; żądania z niejednoznacznym `Content-Length`/`Transfer-Encoding` są odrzucane; wersje proxy i Node.js aktualne (Renovate). | V4.2.1 | `infra` | EVM-007, EVM-008 | DAST, przegląd konfiguracji | TM-14 |
| SR-API-12 | W produkcji brak publicznej dokumentacji API, interfejsów diagnostycznych i endpointów metryk (OpenAPI UI tylko dev/staging po zalogowaniu; `/api/health` bez danych wrażliwych; metryki tylko w sieci wewnętrznej). | V13.4.5, V15.2.3 | `platform`, `infra` | EVM-007, EVM-008 | test wdrożenia, DAST | TM-15 |
| SR-API-13 | Ruch wychodzący z backendu tylko do hostów z listy w konfiguracji (Scaleway S3 i TEM, Sentry UE, Pwned Passwords; w M5 — integracje), bez podążania za przekierowaniami, z timeoutami; adres docelowy nigdy z danych użytkownika (SSRF); lista komunikacji utrzymywana w modelu zagrożeń. | V1.3.6, V13.1.1, V13.2.4, V13.2.5, V15.3.2 | `platform` | EVM-008, E1, M5 | jednostkowe, przegląd | AB-12 |
| SR-API-14 | Eksporty CSV/XLSX (M4) chronią przed formula injection: wartości zaczynające się od `=`, `+`, `-`, `@`, tabulatora lub CR poprzedzone apostrofem, pola escapowane wg RFC 4180. | V1.2.10 (L3) | `platform` | M4 | jednostkowe | EVM-002 (`api-guidelines.md`) |

### WEB — Panel web (V3)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-WEB-01 | Panel wysyła CSP z P11: skrypty tylko z własnego originu (bez `unsafe-inline`/`unsafe-eval`), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src`/`img-src`/`media-src` ograniczone do własnego originu, domeny bucketu i Sentry UE. | V3.4.3, V3.4.6 | `web`, `infra` | EVM-008 | integracyjne (nagłówki), DAST | ADR-0006, P11, TM-08 |
| SR-WEB-02 | HSTS `max-age=31536000; includeSubDomains` na każdej odpowiedzi HTTPS (P11); preload — osobna decyzja po wyborze domeny. | V3.4.1 | `infra` | EVM-007, EVM-008 | test wdrożenia | ADR-0011, P11, TM-12 |
| SR-WEB-03 | Dane użytkownika renderowane wyłącznie jako tekst (domyślne escapowanie React); `dangerouslySetInnerHTML` zakazane (lint + Semgrep, wyjątek tylko po przeglądzie security); linki z danych tylko `https:`/`mailto:`/`tel:` (blokada `javascript:` i `data:`); JSON budowany przez serializację, nie konkatenację. | V3.2.2, V1.2.1, V1.2.2, V1.2.3, V1.1.2 | `web` | EVM-008, E2, E3, E5, E6 | SAST (bramka), komponentowe | TM-08 |
| SR-WEB-04 | Pliki użytkowników nigdy z originu aplikacji: serwowane z domeny bucketu; oryginały i dokumenty z `Content-Disposition: attachment`, inline tylko pochodne o stałym typie; SVG, HTML i XML niedozwolone w uploadzie. | V3.2.1, V3.5.4, V1.3.4 | `media`, `web` | E6 | integracyjne, E2E web | ADR-0009, AB-05 |
| SR-WEB-05 | Panel nie zapisuje danych osobowych w `localStorage`, `sessionStorage`, IndexedDB ani ciasteczkach (poza ciasteczkiem sesji); pamięć podręczna zapytań tylko w pamięci karty. | V14.3.3, V14.3.1 | `web` | EVM-008, E1 | E2E web (inspekcja magazynów) | TM-10 |
| SR-WEB-06 | Przekierowania po logowaniu tylko na ścieżki względne panelu; brak obsługi `postMessage` z obcych originów. | V3.5.5, V3.7.2 | `web` | E1 | komponentowe, DAST | AB-02 |
| SR-WEB-07 | Panel nie ładuje skryptów, stylów ani fontów z zewnętrznych CDN (wszystko z własnego originu, z lockfile); brak technologii wtyczkowych. | V3.7.1, V3.6.1 (L3) | `web` | EVM-008 | test nagłówków CSP, przegląd | TM-55 |
| SR-WEB-08 | Panel wysyła także `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb wyłączone), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` i `X-Frame-Options: DENY` (P11). | V3.4.4, V3.4.5, V3.5.8 (L3) | `web`, `infra` | EVM-008 | integracyjne (nagłówki), DAST | P11 |

### FILE — Pliki i media (V5)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-FILE-01 | Każda funkcja uploadu ma udokumentowaną listę dozwolonych typów, rozszerzeń i limitów (ADR-0009: zdjęcie ≤ 50 MB JPEG/HEIC/PNG/WebP; wideo ≤ 4 GB i ≤ 30 min MP4/MOV H.264/HEVC; dokument ≤ 100 MB PDF/DOCX/XLSX/JPG/PNG); SVG, HTML, skrypty i archiwa są odrzucane. | V5.1.1, V5.2.1 | `media` | E6, E11 | integracyjne | ADR-0009, AB-05 |
| SR-FILE-02 | Sesję uploadu wystawia serwer po autoryzacji obiektu: klucz obiektu nadaje serwer (bez nazwy pliku, numeru zlecenia i danych osobowych), typ i rozmiar części ustala serwer, URL części (TTL 60 min) jest związany z kluczem, `uploadId`, numerem i rozmiarem części; `complete` weryfikuje łączny rozmiar; niedokończone uploady usuwa lifecycle po 7 dniach; bucket nigdy nie wykonuje plików. | V5.2.1, V5.3.1, V5.3.2 | `media` | E6, E11 | integracyjne | ADR-0009, TM-73, TM-74 |
| SR-FILE-03 | Typ pliku weryfikowany po zawartości (magic bytes) i parsowaniem (sharp/ffprobe) oraz zgodność z rozszerzeniem i deklaracją; niezgodność → `quarantined` z `type_mismatch`. | V5.2.2 | `media` | E6, E11 | integracyjne (pliki podmienione) | ADR-0009, AB-05 |
| SR-FILE-04 | Ochrona przed bombami: limity ClamAV dla kontenerów (`MaxScanSize`, `MaxFiles`, `MaxRecursion`) i rozmiaru po rozpakowaniu dla DOCX/XLSX; obrazy z limitem pikseli (`limitInputPixels`, np. 100 MP); wideo z limitem czasu trwania i czasu przetwarzania. | V5.2.3, V5.2.6 (L3) | `media` | E6, E11 | integracyjne (pliki testowe) | TM-36 |
| SR-FILE-05 | Skan AV wg P5 przed udostępnieniem: plik niedostępny dla nikogo do stanu `clean`; `clean` tylko przy zgodnym SHA-256 i pozytywnym skanie; wykrycie → kwarantanna 30 dni i alert; niedostępność `clamd` = oczekiwanie i ponowienie (fail-closed), nigdy pominięcie skanu. | V5.4.3 | `media` | E6, E11 | integracyjne i E2E (EICAR) | ADR-0009, P5, AB-05, TM-78 |
| SR-FILE-06 | Parsery plików działają wyłącznie w kontenerach `media-processor` i `clamd`: bez sieci, system plików tylko do odczytu + `tmpfs`, `cap_drop: ALL`, `no-new-privileges`, użytkownik nie-root, limity pamięci, CPU, procesów i czasu; komunikacja tylko gniazdem Unix, katalog roboczy per zadanie. | V15.2.2, V13.2.2, V1.4.1, V1.4.3 | `media`, `infra` | EVM-007, E6 | test konfiguracji (Trivy, przegląd Compose) | ADR-0009, TM-35, TM-37, TM-77 |
| SR-FILE-07 | Pobranie: `POST …/download-url` autoryzuje obiekt i wystawia podpisany `GET` z TTL ≤ 5 min (plik nie w `clean`/`ready` → `404`); pobrania oryginałów i dokumentów są audytowane; `Content-Disposition: attachment; filename*=UTF-8''…` z nazwą oczyszczoną wg RFC 6266. | V5.4.1, V5.4.2, V1.3.3 | `media` | E6, E11 | integracyjne, E2E web | ADR-0009, TM-75, AB-07 |
| SR-FILE-08 | EXIF/GPS wg P3: pochodne (miniatury, podglądy, wideo 720p) zawsze bez metadanych; aplikacja mobilna nie prosi o uprawnienie lokalizacji, więc jej zdjęcia i filmy nie mają GPS; baza nie przechowuje GPS; oryginały z uploadu web bez zmian (niezmiennik SHA-256), pobierane tylko przez Administratora i Edytora z ostrzeżeniem o metadanych. | V14.2.8 (L3), MASVS-PRIVACY-1 | `media`, `mobile`, `web` | E6, E11 | integracyjne (plik z GPS), E2E Android | ADR-0009, P3 |
| SR-FILE-09 | Eksport ZIP mediów zlecenia: Administrator i Edytor (Tylko odczyt — nie, P6), po step-upie, zadanie w tle, 1 eksport / 10 min i maks. 5 / dzień / użytkownika, maks. 10 GB; plik w buckecie z TTL 24 h, link jednorazowy; audyt i e-mail do wszystkich Administratorów o każdym eksporcie. Eksport danych (CSV/XLSX, M4) — tylko Administrator ze step-upem. | V2.4.1 | `media` | E6 | integracyjne, macierz ról | ADR-0009, P10, AB-08 |
| SR-FILE-10 | Limity wystawiania podpisanych URL-i per użytkownik (P10): miniatury i podglądy ≤ 1000 / 10 min (alert od 600), oryginały i dokumenty ≤ 100 / 10 min (alert od 50); przekroczenie → `429` i alert „masowe pobranie”. | V2.4.1, V5.2.4 (L3) | `media` | E6, E11 | integracyjne | ADR-0009, P10, AB-08 |
| SR-FILE-11 | Zadanie okresowe uzgadnia storage z bazą (obiekty bez rekordu, rekordy bez obiektu) i alarmuje o rozbieżności; klucze klientów nie mają uprawnienia do listowania bucketu. | — | `media` | E6, E8 | integracyjne | ADR-0009 |
| SR-FILE-12 | Wideo większe niż limit skanu ClamAV (P5): walidacja strukturalna ffprobe (kontener, kodeki, czas), w przeglądarce dostępny tylko podgląd 720p z piaskownicy, oryginał wyłącznie jako załącznik z oznaczeniem „Nieskanowany antywirusem — plik za duży”. | V5.4.3 | `media` | E6, E11 | integracyjne | ADR-0009, P5, TM-38 |

### DATA — Ochrona danych (V14)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-DATA-01 | Każda historyjka dodająca pole lub encję z danymi osobowymi aktualizuje klasyfikację (`domain-model.md` → „Klasyfikacja danych”) i inwentaryzację w `rodo.md`; klasy i wymagania ochrony per klasa — `rodo.md`. | V14.1.1, V14.1.2 | `platform` | E1, E2, E3, E4, E5, E6, E7, E9, E10, E11, E12, E13 | przegląd (DoR, DoD) | EVM-002 (klasyfikacja) |
| SR-DATA-02 | Minimalizacja: brak pól PESEL, numeru dokumentu, daty urodzenia i kodów do bram; dane osobowe tylko w typowanych kolumnach (nigdy w JSONB parametrów); pola `notes` z ostrzeżeniem w UI; nowe pole wrażliwe wymaga przeglądu security i szyfrowania (P12). | V14.2.6 (L3) | `customers`, `sites`, `work-orders`, `parties` | E2, E3 | przegląd, kontraktowe | EVM-002 (model), P12 |
| SR-DATA-03 | Odpowiedzi zawierają tylko pola zdefiniowane w kontrakcie (żadnych całych encji); dane innych użytkowników ograniczone do `id` i `displayName`. | V15.3.1, V8.2.3 | `platform` | EVM-008, E1, E2, E3 | kontraktowe (walidacja odpowiedzi) | ADR-0004 |
| SR-DATA-04 | Szyfrowanie w spoczynku: PostgreSQL na wolumenie LUKS, bucket SSE-ONE, pgBackRest z szyfrowaniem + SSE, kopia mediów `rclone crypt`; klucze wyłącznie w menedżerze sekretów, poza repozytorium. | V14.2.4 | `infra` | EVM-007, E8 | test wdrożenia, checklista | ADR-0003, ADR-0009, ADR-0011, TM-29 |
| SR-DATA-05 | Żaden pośrednik nie buforuje odpowiedzi API (Caddy bez cache dla `/api/*`, `no-store`); dane w pamięci procesu nie są współdzielone między użytkownikami. | V14.2.2 | `infra`, `platform` | EVM-008 | test wdrożenia | TM-10 |
| SR-DATA-06 | Brak trackerów, analityki marketingowej i SDK reklamowych w panelu i aplikacji; dane wychodzą tylko do podmiotów z `rodo.md` (telemetria po redakcji). | V14.2.3, MASVS-PRIVACY-2 | `web`, `mobile` | EVM-008, EVM-009 | SCA (lista zależności), przegląd | ADR-0013 |
| SR-DATA-07 | Retencja wg P4: dane techniczne (sesje, urządzenia, klucze idempotencji, dziennik zmian, kwarantanna, eksporty) usuwane automatycznie od pierwszego wydania; dane biznesowe (zlecenia, klienci, media, audyt) — zadanie retencji przed upływem pierwszego terminu (M4), wcześniej procedura ręczna; raport z wykonania bez danych osobowych. | V14.2.4, V14.2.7 (L3) | `platform`, `identity`, `sync`, `media`, `audit` | E1, E8, M4 | integracyjne (kontrolowany zegar) | P4 |
| SR-DATA-08 | Usuwanie wg `domain-model.md`: soft delete i przywrócenie (Administrator), purge, anonimizacja i redakcja (Administrator ze step-upem); purge usuwa obiekty w storage'u; audyt bez wartości danych osobowych. | V14.2.7 (L3) | `customers`, `sites`, `parties`, `work-orders`, `timeline`, `media` | E2, E3, E5, E6 | integracyjne, macierz ról | EVM-002 (usuwanie danych), AB-15 |
| SR-DATA-09 | Eksport danych osoby (art. 15 i 20 RODO): w MVP procedura Administratora z runbooka (panel + eksport), w M4 funkcja eksportu danych klienta (JSON/CSV) z audytem. | — | `customers`, `media` | E8, M4 | ćwiczenie procedury | rodo.md |

### CRYPTO — Kryptografia (V11)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-CRYPTO-01 | Kryptografia wyłącznie z bibliotek (Node `crypto`, `@node-rs/argon2`, `@simplewebauthn/server`, `otpauth`, SQLCipher, Keystore/Keychain): AES-GCM, SHA-256/SHA-512, Ed25519/ECDSA P-256; zakaz MD5, SHA-1 (wyjątek: protokół k-anonimowości Pwned Passwords — nie jest użyciem kryptograficznym), ECB i własnych algorytmów (Semgrep). | V11.2.1, V11.3.1, V11.3.2, V11.4.1, V11.6.1, MASVS-CRYPTO-1 | `platform`, `identity`, `mobile` | EVM-008, E1, E9 | SAST (bramka), przegląd | ADR-0005, ADR-0007 |
| SR-CRYPTO-02 | Szyfrowanie pól (`platform/crypto`): AES-256-GCM kopertowo, klucz główny z sekretów, identyfikator wersji klucza i algorytmu w szyfrogramie (rotacja bez przestoju), unikalny losowy nonce 96 bitów; zastosowania wg P12. | V11.2.2, V11.2.3, V11.3.3, V11.3.4 (L3) | `platform` | E1 | jednostkowe | ADR-0003, P12 |
| SR-CRYPTO-03 | Wszystkie tokeny i sekrety (sesje, reset, zaproszenia, kody odzyskiwania, sekrety TOTP, sekrety instalacji urządzeń, klucze) z CSPRNG, ≥ 128 bitów entropii (tokeny 256 bitów); UUIDv7 nie jest sekretem ani dowodem dostępu. | V11.5.1, V7.2.3 | `platform`, `identity` | E1 | SAST (`Math.random`), jednostkowe | ADR-0005, ADR-0008 |
| SR-CRYPTO-04 | Inwentarz kryptograficzny i polityka kluczy w runbooku: LUKS, pgBackRest, `rclone crypt`, `platform/crypto`, klucze S3, klucz uploadu aplikacji, klucze SSH, tokeny CI i dostawców — właściciel, miejsce, algorytm, rotacja (co 12 mies., po odejściu osoby z dostępem lub incydencie), zniszczenie. | V11.1.1, V11.1.2, MASVS-CRYPTO-2 | `infra`, `ci` | EVM-007, E8 | przegląd runbooka | ADR-0011, ADR-0012 |
| SR-CRYPTO-05 | Integralność: SHA-256 dla plików (deklaracja klienta + skrót serwera), skróty tokenów w bazie; porównania sekretów w czasie stałym. | V11.4.3 | `media`, `identity` | E1, E6, E11 | jednostkowe | ADR-0009 |
| SR-CRYPTO-06 | Klucze szyfrujące nie są wyprowadzane z haseł; klucz SQLCipher jest losowy (256 bitów) i trzymany w Keystore/Keychain. | V11.4.4, MASVS-CRYPTO-2 | `mobile` | EVM-009, E9 | przegląd, jednostkowe | ADR-0007 |

### COMM — Komunikacja (V12)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-COMM-01 | Caddy: TLS 1.2 i 1.3 (preferowany 1.3) z zalecanymi zestawami szyfrów, certyfikaty publiczne (Let's Encrypt) odnawiane automatycznie z alertem < 14 dni. | V12.1.1, V12.1.2, V12.2.1, V12.2.2 | `infra` | EVM-007, EVM-008 | test wdrożenia | ADR-0011, TM-12, TM-88 |
| SR-COMM-02 | Połączenia wychodzące (Scaleway S3 i TEM, Sentry, Grafana, Pwned Passwords) tylko po TLS z weryfikacją certyfikatu (zakaz `rejectUnauthorized: false`, Semgrep); `rclone` do Storage Box po SFTP z weryfikacją klucza hosta. | V12.3.1, V12.3.2 | `platform`, `infra` | EVM-007, EVM-008 | SAST, przegląd konfiguracji | ADR-0011 |
| SR-COMM-03 | Ruch wewnętrzny jednej VM (proxy → API, API/worker → PostgreSQL, worker → gniazda Unix) w izolowanej sieci Docker bez publikowanych portów — TLS wewnątrz hosta świadomie pominięty; przy rozdzieleniu na kilka hostów TLS z wewnętrznym CA. | V12.3.1, V12.3.3, V12.3.4 | `infra` | EVM-007 | przegląd konfiguracji | ADR-0011, TM-71 |
| SR-COMM-04 | Aplikacja mobilna wyłącznie po HTTPS (`cleartextTrafficPermitted=false`, ATS bez wyjątków), bez zaufania do CA użytkownika; przypinanie certyfikatów wg P8 (MVP: bez przypinania, CAA i monitoring CT). | V12.2.1, MASVS-NETWORK-1, MASVS-NETWORK-2 | `mobile` | EVM-009, E9 | przegląd manifestu, test MITM z CA użytkownika | ADR-0007, P8, TM-68 |
| SR-COMM-05 | SSH tylko z listy dozwolonych adresów administracyjnych, kluczami (bez haseł), bez logowania roota; dostęp do bazy wyłącznie tunelem SSH; jedyny wyjątek — tymczasowa reguła dla IP bieżącego runnera w wariancie „push przez SSH” kanału wdrożenia (SR-INFRA-14). | V12.3.1 | `infra` | EVM-007 | skan portów z zewnątrz, przegląd | ADR-0011, TM-95, TM-99 |

### LOG — Logowanie i audyt (V16)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-LOG-01 | Inwentarz logowania (co, gdzie, format JSON, retencja, kto ma dostęp): pino → Alloy → Grafana UE, Caddy, Sentry UE, audyt w bazie; logi trafiają tylko do miejsc z inwentarza. | V16.1.1, V16.2.3, V16.2.4 | `platform`, `infra` | EVM-007, EVM-008 | przegląd | ADR-0013 |
| SR-LOG-02 | Redakcja w loggerze (lista pól z ADR-0013) z testami jednostkowymi; bez ciał żądań i odpowiedzi, bez query z podpisami URL-i, IP wg P9; zakaz logowania całych obiektów domenowych (reguła lint). | V16.2.5, V14.2.4 | `platform` | EVM-008 | jednostkowe (redakcja), przegląd próbek logów | ADR-0013, P9, TM-86 |
| SR-LOG-03 | Audyt (kto, co, kiedy w UTC, skąd, wynik, `traceId`) dla zdarzeń z ADR-0001 i ADR-0005 oraz przejść audytowanych z `domain-model.md`; bez wartości danych osobowych (wyjątek: kwota i status płatności). | V16.2.1, V16.2.2, V16.3.1, V16.3.2, V16.3.3 | `audit` | E1, E3, E5, E6, E7 | integracyjne | ADR-0001, TM-21 |
| SR-LOG-04 | Audyt niezmienny: rola `evia_app` ma na `audit` tylko `INSERT`/`SELECT`, trigger odrzuca `UPDATE`/`DELETE` (test uprawnień bazy); logi wysyłane do logicznie odrębnego systemu (Grafana Cloud); konta Grafana i Sentry tylko z MFA. | V16.4.2, V16.4.3 | `audit`, `infra` | E1, EVM-007 | testy uprawnień bazy (bramka) | ADR-0003, TM-30, TM-50 |
| SR-LOG-05 | Logi strukturalne JSON (pino) — znaki sterujące escapowane, dane w polach, nie w treści komunikatu (brak wstrzyknięcia logów). | V16.4.1 | `platform` | EVM-008 | jednostkowe | ADR-0013 |
| SR-LOG-06 | Nieudane autoryzacje (403/404 z polityki), odrzucenia walidacji i limitów — metryki z alertem anomalii; nieudane próby operacji wrażliwych — audyt; nieoczekiwane wyjątki i błędy TLS do zależności — Sentry. | V16.3.2, V16.3.3, V16.3.4 | `platform` | EVM-008, E1 | integracyjne | ADR-0013 |
| SR-LOG-07 | Alerty bezpieczeństwa z ADR-0013 skonfigurowane i przetestowane: skok nieudanych logowań, blokady, ponowne użycie refresh tokenu, zmiany ról i MFA Administratora, logowanie Administratora z nowego urządzenia, masowe pobrania i odczyt (P10), kwarantanna, eksport, wdrożenie prod, nieudany backup i test odtworzenia. | — | `infra`, `platform` | EVM-007, E1, E6, E8 | alerty testowe | ADR-0013, AB-01, AB-08 |
| SR-LOG-08 | Aplikacja mobilna nie zapisuje danych osobowych w logach systemowych i raportach błędów; Sentry bez zrzutów ekranu, hierarchii widoków i session replay. | MASVS-STORAGE-2 | `mobile` | EVM-009, E14 | przegląd logcat, przegląd konfiguracji SDK | ADR-0007, ADR-0013, TM-84 |
| SR-LOG-09 | Czas na VM synchronizowany (NTP), wszystkie znaczniki w logach i audycie w UTC. | V16.2.2 | `infra` | EVM-007 | przegląd konfiguracji | ADR-0013 |

### ERR — Obsługa błędów (V16.5)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-ERR-01 | Fail-closed: błąd w autoryzacji, walidacji, skanie lub weryfikacji sesji kończy się odmową, nigdy przepuszczeniem. | V16.5.3 | `platform`, `authorization`, `media` | EVM-008, E6 | integracyjne (wstrzyknięte błędy) | TM-78 |
| SR-ERR-02 | Niedostępność zależności (storage, TEM, Sentry, Pwned Passwords, `clamd`) nie zatrzymuje rdzenia: ponowienia z backoffem, kolejki, degradacja (np. lokalna lista haseł), bez utraty danych. | V16.5.2 | `platform` | EVM-008, E1, E6 | integracyjne | ADR-0010, TM-52 |

### MOB — Aplikacja mobilna (MASVS)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-MOB-01 | Dane zleceń tylko w bazie SQLCipher (AES-256) z losowym kluczem 256 bitów w Keystore (Keychain), media w sandboxie aplikacji; zakaz `AsyncStorage` i plików niezaszyfrowanych dla danych. | MASVS-STORAGE-1, MASVS-CRYPTO-1, MASVS-CRYPTO-2 | `mobile` | EVM-009, E10, E11 | przegląd, test (plik bazy nieczytelny bez klucza) | ADR-0007, TM-01 |
| SR-MOB-02 | Dane aplikacji wykluczone z kopii (`allowBackup=false`, `dataExtractionRules`); brak zapisu do galerii, brak uprawnień do biblioteki zdjęć, kontaktów i lokalizacji. | MASVS-STORAGE-2, MASVS-PRIVACY-1 | `mobile` | EVM-009, EVM-011, E11 | przegląd manifestu, test (`adb backup`) | ADR-0007, TM-04 |
| SR-MOB-03 | Klucz bazy i refresh token w klasie „po pierwszym odblokowaniu” (świadomy kompromis ADR-0007); opcjonalna biometria lub PIN aplikacji wyłącznie jako bramka UI (P7), nie wiąże kluczy. | MASVS-STORAGE-1, MASVS-AUTH-2 | `mobile` | EVM-011, E9 | test na urządzeniu (zablokowany ekran) | ADR-0007, P7, TM-01 |
| SR-MOB-04 | Unieważnienie urządzenia wg P2: „Wyloguj urządzenie” (także automatycznie — ponowne użycie refresh tokenu poza oknem tolerancji, 30 dni bez kontaktu — oraz jako skutek resetu hasła lub MFA i zmiany roli między Administratorem a Edytorem: SR-AUTH-11, SR-AUTH-13, SR-AUTHZ-09) → `401 session_revoked`, ukrycie danych domenowych, zachowanie zaszyfrowanej kolejki, plików oczekujących i sekretu instalacji; ponowne pełne logowanie (hasło + MFA) tego samego użytkownika na tej samej instalacji wraca do tego samego `deviceId` — sekret instalacji 256 bitów z CSPRNG wydany przy rejestracji urządzenia, na telefonie w Keystore, na serwerze tylko skrót, nie jest czynnikiem uwierzytelniania; brak albo niezgodność sekretu → nowe urządzenie i zdarzenie audytu; „Zablokuj i wyczyść”, dezaktywacja i zmiana roli na Tylko odczyt → `401 device_wipe_required` (także przy logowaniu z sekretem takiego urządzenia), usunięcie bazy, klucza, sekretu instalacji, mediów, kolejki i cache miniatur, następne logowanie = nowy `deviceId`; Administrator przed „Zablokuj i wyczyść” i przed zmianą roli na Tylko odczyt widzi liczbę niewysłanych elementów (`pendingItemsReported`) i potwierdza ich utratę. | MASVS-AUTH-1, MASVS-STORAGE-1 | `mobile`, `identity`, `sync` | EVM-011, E9 | integracyjne (przypięcie `deviceId`, niezgodny sekret), E2E Android | ADR-0005, ADR-0007, P2, AB-03, AB-04, AB-09 |
| SR-MOB-05 | Po 7 dniach bez udanego kontaktu z serwerem dane w aplikacji są ukryte do ponownego zalogowania online; rejestrowanie nowych zdjęć i filmów do kolejki nadal działa. | MASVS-AUTH-1 | `mobile` | E9, E10 | jednostkowe (`sync-core`, zegar), E2E Android | ADR-0005, P2, TM-01 |
| SR-MOB-06 | Blokada ekranu urządzenia (`isDeviceSecure`) wymagana przy logowaniu i sprawdzana przy każdym uruchomieniu i wznowieniu aplikacji: bez niej logowanie jest odrzucane, a w trakcie sesji dane zleceń są ukryte (jak w SR-MOB-05 — aparat i kolejka działają, nic nie jest usuwane) do ponownego włączenia blokady; Android ≥ 10; poziom poprawek bezpieczeństwa wg progu i trybu z `meta/client-config` (P7): „tylko ostrzegaj” (start — ostrzeżenie od 6 miesięcy, wyraźne od 12) albo „blokuj” (po spisie floty i decyzji Konrada — logowanie odrzucone przy poprawkach starszych niż 12 miesięcy; zalogowane urządzenie dostaje ostrzeżenie, blokada przy następnym pełnym logowaniu); aplikacja raportuje poziom poprawek na liście urządzeń. | MASVS-CODE-1 | `mobile`, `platform`, `identity` | E9 | jednostkowe, test na urządzeniu (wyłączenie blokady w trakcie sesji) | P7, TM-01 |
| SR-MOB-07 | Deep linki tylko jako zweryfikowane App Links, parametry walidowane, bez automatycznego wykonywania akcji; eksportowane tylko niezbędne komponenty; WebView bez JavaScriptu i dostępu do plików (albo brak WebView). | MASVS-PLATFORM-1, MASVS-PLATFORM-2 | `mobile` | EVM-009, E9 | przegląd manifestu, test intencji | ADR-0007, TM-05 |
| SR-MOB-08 | Pola hasła i kodów maskowane, `FLAG_SECURE` na ekranach logowania i MFA, brak danych wrażliwych w powiadomieniach. | MASVS-PLATFORM-3 | `mobile` | E9 | test na urządzeniu | P7, TM-04 |
| SR-MOB-09 | Aktualizacja wymuszona przez `426` (ekran aktualizacji, kolejka zachowana); aktualizacje OTA wyłączone. | MASVS-CODE-2 | `mobile` | EVM-009, E14 | E2E Android | ADR-0004, ADR-0007 |
| SR-MOB-10 | Dane z serwera i z lokalnej kolejki walidowane schematami z kontraktu; nieznane wartości słowników obsługiwane jako „nieznane”. | MASVS-CODE-4 | `mobile`, `sync` | E10 | jednostkowe (`sync-core`) | ADR-0004 |
| SR-MOB-11 | Paczka release bez sekretów (tylko publiczna konfiguracja), `debuggable=false`, bez logów debug, z R8/minifikacją; podpis przez Play App Signing, klucz uploadu tylko w EAS lub sekretach CI. | MASVS-CODE-3, MASVS-RESILIENCE-2 | `mobile`, `ci` | EVM-009, E14 | skan sekretów w paczce, przegląd | ADR-0012, TM-58 |
| SR-MOB-12 | Prywatność: brak identyfikatorów reklamowych i SDK analitycznych, Sentry bez danych osobowych, deklaracja „Bezpieczeństwo danych” w Google Play zgodna z rzeczywistością, w aplikacji link do klauzuli informacyjnej i opcja „Wyczyść dane firmowe”. | MASVS-PRIVACY-2, MASVS-PRIVACY-3, MASVS-PRIVACY-4 | `mobile` | E14 | przegląd | P7, rodo.md |
| SR-MOB-13 | Jedna instalacja = jeden użytkownik: logowanie innego użytkownika wymaga wyczyszczenia danych poprzedniego (razem z sekretem instalacji — nowe urządzenie, nowy `deviceId`), z ostrzeżeniem o liczbie niewysłanych elementów. | MASVS-STORAGE-1 | `mobile` | E9 | E2E Android | P2 |

### SYNC — Synchronizacja offline (ADR-0008)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-SYNC-01 | `userId` i `deviceId` wyłącznie z sesji; każde żądanie synchronizacji sprawdza ważność sesji i urządzenia — inaczej dla całej partii `401 session_revoked` (sesja zakończona — kolejka zostaje do ponownego logowania) albo `401 device_wipe_required` (urządzenie unieważnione — czyszczenie, P2). | V8.3.1 | `sync`, `identity` | E10, E11, E12, E13 | integracyjne | ADR-0008, P2, AB-03, AB-09 |
| SR-SYNC-02 | Autoryzacja mutacji w momencie synchronizacji wg bieżących ról i polityk; utrata dostępu → `rejected: forbidden` (dane na liście „Wymaga uwagi”) i `resync_required`. | V8.2.2, V8.3.1 | `sync`, `authorization` | E11, E12, E13 | integracyjne | ADR-0008 |
| SR-SYNC-03 | `mutation_id` jest kluczem idempotencji powiązanym z użytkownikiem i urządzeniem (30 dni); powtórka → `duplicate`, po unieważnieniu → `401`; ponowne logowanie na tej samej instalacji wraca do tego samego `deviceId` (SR-MOB-04), więc mutacja zastosowana przed wylogowaniem, ale bez odebranego wyniku, wraca jako `duplicate`, nie `id_conflict`; komendy `Create*` tylko wstawiają (`id_conflict`, nigdy upsert). | — | `sync` | EVM-011, E9, E11, E12, E13 | integracyjne, testy `sync-core` | ADR-0008, P2, AB-09, AB-13 |
| SR-SYNC-04 | Kanał zmian filtrowany politykami przy każdym odczycie; projekcja pól z `offline-sync.md` (bez płatności, PPE, e-maili, NIP, notatek klienta, plików dokumentów i oryginałów); wyjście z zakresu usuwa dane z urządzenia (poza kolejką). | V8.2.2, V15.3.1, MASVS-PRIVACY-1 | `sync` | E10 | integracyjne | ADR-0008, AB-14 |
| SR-SYNC-05 | `capturedAt` z telefonu to tylko metadana w dozwolonym zakresie; kolejność i audyt wg czasu serwera. | — | `sync`, `timeline`, `media` | E11, E12 | integracyjne | ADR-0008, TM-07 |
| SR-SYNC-06 | Limity synchronizacji: partia ≤ 50 mutacji, mutacja ≤ 64 KB, strona zmian ≤ 1 MB; obsługiwane wersje komend do `minSupportedVersion` + 30 dni. | V2.4.1, MASVS-CODE-4 | `sync` | E10, E11, E12, E13 | integracyjne | ADR-0008 |
| SR-SYNC-07 | Kursor nieprzezroczysty, związany z użytkownikiem i urządzeniem (`400 invalid_cursor` przy niezgodności); zmiana kursora nie omija filtra polityk. | V8.2.2 | `sync` | E10 | integracyjne | ADR-0008 |
| SR-SYNC-08 | Sesję uploadu kontynuuje tylko jej twórca (użytkownik + urządzenie), nowe URL-e części po ponownej autoryzacji; po ponownym logowaniu na tej samej instalacji (ten sam `deviceId`, SR-MOB-04) upload wznawia się od ostatniej potwierdzonej części; lokalny oryginał usuwany dopiero, gdy serwer potwierdzi `clean` lub późniejszy stan. | — | `media`, `sync`, `mobile` | EVM-011, E9, E11 | integracyjne, E2E Android | EVM-002 (`offline-sync.md`), P2, TM-06 |

### INFRA — Infrastruktura i operacje (V13, ADR-0011)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-INFRA-01 | Ekspozycja: firewall Hetzner przychodzący tylko 80/443 do Caddy i 22 z listy dozwolonych adresów administracyjnych (nigdy zakresy IP GitHub Actions ani stała reguła dla runnerów — kanał wdrożenia wg SR-INFRA-14); wychodzący tylko 443, 53, 123 i port SFTP Storage Boxa; brak publikowanych portów bazy, kolejki, workera, `clamd` i `media-processor`; porty dev tylko na `127.0.0.1`; skan portów z zewnątrz po każdym wdrożeniu. | V13.2.5 | `infra` | EVM-007 | test wdrożenia (bramka) | ADR-0011, ADR-0015, TM-29, TM-70, TM-99 |
| SR-INFRA-02 | Bucket mediów i backupów prywatny: blokada publicznego dostępu, polityka Deny dla obcych kluczy, test „anonimowy `GET` = 403” po każdej zmianie IaC i wdrożeniu. | — | `infra`, `media` | EVM-007, E6 | test wdrożenia (bramka) | ADR-0009, AB-10, TM-39 |
| SR-INFRA-03 | Najmniejsze uprawnienia: osobne klucze S3 per rola (API — podpisy; worker — odczyt oryginałów i zapis pochodnych; backup; IaC — konfiguracja bucketów tylko z CI), żaden klucz aplikacyjny bez `BypassGovernanceRetention`; role bazy `evia_migrator`, `evia_app`, `evia_backup`, `evia_readonly` bez uprawnień w MVP (P12); kontenery jako nie-root. | V13.2.2, V13.3.2 | `infra` | EVM-007 | test uprawnień (IaC, baza) | ADR-0003, ADR-0009, ADR-0011, TM-31, TM-41 |
| SR-INFRA-04 | Komponenty backendu uwierzytelniają się bez poświadczeń domyślnych: hasła ról bazy z sekretów, gniazda Unix z uprawnieniami plików, klucze S3 per środowisko. | V13.2.1, V13.2.3 | `infra` | EVM-007 | przegląd konfiguracji | ADR-0011 |
| SR-INFRA-05 | Sekrety wyłącznie w menedżerze sekretów lub zaszyfrowanych plikach (SOPS+age) i sekretach środowisk CI; nigdy w repozytorium, obrazach, logach ani — dla usług zewnętrznych — w katalogu repozytorium; rotacja wg SR-CRYPTO-04. | V13.3.1, V13.3.2, V13.3.4 (L3) | `infra`, `ci` | EVM-006, EVM-007 | skan sekretów (bramka), przegląd | ADR-0011, ADR-0015, TM-56 |
| SR-INFRA-06 | Produkcja bez artefaktów deweloperskich: brak `.git`, publicznych map źródeł, trybu debug, listingu katalogów i kodu testowego; nagłówek `Server` bez wersji. | V13.4.1, V13.4.2, V13.4.3, V15.2.3, V13.4.6 (L3) | `infra`, `web` | EVM-007, EVM-008 | DAST, test wdrożenia | TM-15 |
| SR-INFRA-07 | Backupy wg ADR-0003/0011: PITR 30 dni, object lock compliance 37 dni, klucz z VM bez uprawnień do konfiguracji bucketu; media — wersjonowanie, object lock 30 dni, Storage Box ze snapshotami zarządzanymi poza VM; staging ma ten sam moduł backupu z IaC (dane syntetyczne). Test odtworzenia bazy co miesiąc i przed wydaniem **wyłącznie na tymczasowej VM w projekcie prod w UE**: CI tylko orkiestruje (tożsamość i sekrety jobu — RR-20), dane nigdy nie trafiają na runner ani na staging, VM bez portów przychodzących jest usuwana po teście także po błędzie (`if: always()`), alert, gdy przetrwa > 24 h; w logach CI tylko wynik bez danych (czas, RPO, liczby kontrolne). Test miesięczny na prod jest **nieniszczący**: zadanie na VM prod próbuje kluczem z VM usunąć zablokowaną wersję obiektu kontrolnego (`DeleteObjectVersion`) i ustawić wersjonowanie lub lifecycle bucketu na tę samą wartość — oczekiwane `AccessDenied` (wynik jako metryka z alertem); potem odtworzenie PITR z ponownym zastosowaniem rejestru usunięć (SR-PRIV-04) i odtworzenie pojedynczego pliku mediów z kopii. Pełny scenariusz „backup usunięty z przejętej VM” (usunięcie obiektów kluczem z VM, przywrócenie zablokowanych wersji, PITR) — co miesiąc na staging, na prod tylko w corocznym ćwiczeniu DR (ADR-0011). | V11.3.3 | `infra` | EVM-007, E8 | test odtworzenia (bramka wydania), test niezmienności (metryka), ćwiczenie DR | ADR-0003, ADR-0011, AB-21, TM-32, TM-100, TM-101, TM-102 |
| SR-INFRA-08 | Pełna separacja środowisk (projekty, klucze, buckety, domeny); staging wyłącznie z danymi syntetycznymi. | — | `infra` | EVM-007 | przegląd IaC | ADR-0011 |
| SR-INFRA-09 | MFA na wszystkich kontach administracyjnych (Hetzner, Scaleway, GitHub, Expo, Google Play, Sentry, Grafana, rejestrator domeny); minimalna liczba osób z dostępem; przegląd dostępów co kwartał. | — | `infra`, `ci` | EVM-006, EVM-007, E8 | checklista | ADR-0011, TM-63 |
| SR-INFRA-10 | Automatyczne łatki bezpieczeństwa systemu VM, obrazy aktualizowane przez Renovate z karencją; restarty planowe poza 7:00–19:00. | — | `infra` | EVM-007 | przegląd, raport Renovate | ADR-0011, TM-65 |
| SR-INFRA-11 | Konfiguracja zasobów: limity CPU i pamięci kontenerów, limity współbieżności kolejek (wideo: 1), alert dysku > 80%; funkcje zasobożerne (upload, eksport, wyszukiwanie) objęte limitami z P10. | V15.1.3, V15.2.2 | `infra` | EVM-007, E6 | przegląd Compose, test obciążeniowy (k6) | ADR-0010, TM-22 |
| SR-INFRA-12 | Domena i poczta: rekord CAA (tylko Let's Encrypt), DNSSEC (jeśli rejestrator wspiera), SPF, DKIM i DMARC `p=reject` dla domeny nadawczej, monitoring Certificate Transparency, MFA i blokada transferu u rejestratora. | — | `infra` | EVM-007 | checklista | P8, TM-43, TM-53 |
| SR-INFRA-13 | Wdrożenie prod: `workflow_dispatch` tylko z `main`, warunek `github.actor` = konto Konrada, środowisko `production` z sekretami środowiska, niezmienny digest sprawdzony na staging, kanał CI → VM wg SR-INFRA-14, e-mail o każdym wdrożeniu. | — | `ci`, `infra` | EVM-007, E8 | test (wdrożenie z innej gałęzi lub konta odrzucone) | ADR-0012, AB-27, TM-91 |
| SR-INFRA-14 | Kanał wdrożenia CI → VM (staging i prod) nie poszerza ekspozycji VM ani uprawnień CI. Zakazane: zakresy IP GitHub Actions w firewallu, stała reguła dla runnerów, klucz wdrożeniowy z powłoką lub dostępem do Dockera (grupa `docker` = root), token Hetzner w jobie wdrożenia aplikacji poza wariantem (b), poświadczenia kanału poza sekretami środowisk ograniczonych do `main`. Dopuszczalne wzorce — wybór to **otwarta decyzja EVM-007** (`solution-architect` i `devops-engineer`): **(a) pull (rekomendacja)** — job wdrożenia zapisuje manifest z digestami w miejscu, do którego zapis ma tylko jego środowisko (np. obiekt w buckecie projektu środowiska, klucz tylko do zapisu tego obiektu); agent na VM (timer systemd, skrypt bez nowej zależności) czyta manifest kluczem tylko do odczytu, pobiera z GHCR wyłącznie wskazane digesty tokenem z jednym zakresem `read:packages` (classic PAT — tokeny fine-grained nie obsługują Packages), uruchamia migracje i podmienia kontenery; CI czeka na potwierdzenie wersji i uruchamia bramkę 10 — bez portu 22 i bez tokenu Hetzner w jobie; **(b) push przez SSH** — tymczasowa reguła firewalla tylko dla IP bieżącego runnera, usuwana w kroku `if: always()` przed skanem portów, alert, gdy reguła spoza allowlisty istnieje dłużej niż 15 min (kontrola tokenem Hetzner tylko do odczytu); przypięty klucz hosta; użytkownik wdrożeniowy bez powłoki i bez grupy `docker`, z poleceniem wymuszonym w `authorized_keys` (`restrict,command=…`), które przyjmuje wyłącznie digesty (`sha256:` + 64 znaki hex) i wywołuje stały skrypt; konsekwencja: token Hetzner z pełnymi uprawnieniami projektu w każdym jobie wdrożenia (RR-06). | — | `ci`, `infra` | EVM-007, E8 | test wdrożenia (bramka 10: port 22 niedostępny z runnera po wdrożeniu), przegląd konfiguracji (`authorized_keys`, grupy użytkownika, uprawnienia kluczy manifestu) | ADR-0011, ADR-0012, TM-97, TM-98, TM-99, RR-06, RR-19 |

### SUPPLY — Łańcuch dostaw i CI (V15, ADR-0012, ADR-0015)
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-SUPPLY-01 | Lockfile i `--frozen-lockfile`; pnpm 11: `allowBuilds` (jawna lista skryptów instalacyjnych), `minimumReleaseAge` ≥ 1 dzień, `blockExoticSubdeps`; Renovate z karencją 3 dni. | V15.2.1 | `ci` | EVM-006 | bramka CI | ADR-0012, ADR-0015, TM-62 |
| SR-SUPPLY-02 | Terminy naprawy podatności w zależnościach i obrazach: Critical — 7 dni (72 h przy publicznym exploicie dla komponentu w prod), High — 30 dni, Medium — 90 dni, Low — przy najbliższej aktualizacji; nocna kontrola przekroczeń. | V15.1.1, V15.2.1, MASVS-CODE-3 | `ci` | EVM-006, EVM-007 | bramka CI (nocna) | ADR-0012, AB-11 |
| SR-SUPPLY-03 | SBOM (CycloneDX, Trivy) dla każdego obrazu i aplikacji jako artefakt wydania; zależności tylko z rejestru npm, obrazy tylko z digestem. | V15.1.2, V15.2.4 (L3) | `ci` | EVM-006, EVM-007 | bramka CI | ADR-0012, TM-57 |
| SR-SUPPLY-04 | GitHub Actions przypięte do SHA, `permissions: contents: read` domyślnie, joby skanów bez sekretów, sekrety tylko w jobach wdrożeń; narzędzia skanujące instalowane w przypiętej wersji z weryfikacją sumy kontrolnej lub z obrazu po digeście — nigdy po tagu (wzorzec CVE-2026-33634). | V15.2.1 | `ci` | EVM-006 | bramka CI, przegląd workflowów | ADR-0012, AB-26, TM-55 |
| SR-SUPPLY-05 | Ochrona `main`: ruleset bez listy obejść, wymagane checki z tabeli bramek, tylko PR, squash, zakaz force-push i usuwania; CODEOWNERS dla `.github/**`, `.claude/**`, `compose*.yaml` i plików wyjątków skanów. **Wariant GitHub Free (ADR-0016, EVM-006):** rulesetu nie ma — kontrole kompensujące K1–K7 (`docs/ops/github-i-ci.md`): jeden check `ci-gate`, scalanie wyłącznie przez Konrada w PR przy zielonym `ci-gate`, przegląd widoku Activity, kontrola `main-integrity` po każdym pushu na `main`, CODEOWNERS jako dokumentacja. | — | `ci` | EVM-006 | test (push do `main` odrzucony); na Free: `main-integrity` (K6) — commit spoza scalonego PR lub bez zielonego `ci-gate` = czerwony check | ADR-0012, ADR-0016, TM-54 |
| SR-SUPPLY-06 | Nowa zależność tylko z uzasadnieniem w PR (licencja z listy dozwolonych, utrzymanie, znane podatności, liczba opiekunów); licencje sprawdzane automatycznie. | V15.1.2 | `ci` | EVM-006 | bramka CI (licencje), przegląd | ADR-0012 |
| SR-SUPPLY-07 | Bramki skanów z tabeli „Bramki bezpieczeństwa CI” (SAST, SCA, licencje, sekrety, IaC, obrazy, DAST na staging) z progami blokującymi i wyjątkami wygasającymi. | MASVS-CODE-3 | `ci` | EVM-006, EVM-007, E8 | bramka CI | ADR-0012, ADR-0014 |
| SR-SUPPLY-08 | Klucze podpisu aplikacji: Play App Signing (u nas tylko klucz uploadu w EAS/sekretach CI), MFA na kontach Expo i Google, minimum osób z dostępem, plan rotacji z ADR-0012; promocja wydania do testerów ręcznie przez Konrada. | MASVS-CODE-3 | `ci`, `mobile` | EVM-009, E14 | checklista | ADR-0012, TM-58, TM-92 |
| SR-SUPPLY-09 | Stacja deweloperska i agenci (ADR-0015): sekrety usług zewnętrznych poza katalogiem repozytorium; reguły `deny`/`ask` w `.claude/settings.json`; gniazdo Dockera nigdy w kontenerach testowych ani regułach `allow`; tokeny agentów bez uprawnień administracyjnych i bez `actions: write`. | — | `ci` | EVM-006 | przegląd konfiguracji | ADR-0015, AB-24, AB-25, TM-60, TM-61 |
| SR-SUPPLY-10 | Skany uruchamiane lokalnie przez agentów bez `docker run`: natywne binaria w przypiętej wersji albo usługa w `compose.yaml` wywoływana dokładną regułą `allow` (`docker compose -f compose.yaml run --rm …`). | — | `ci` | EVM-006 | przegląd skryptów | ADR-0015 |
| SR-SUPPLY-11 | Walidator dokumentacji blokuje merge przy błędach (m.in. pliki robocze widoczne dla gita), co ogranicza ryzyko trafienia notatek z danymi do repozytorium. | — | `ci` | EVM-013 | bramka CI | EVM-012, EVM-013 |

### PRIV — Prywatność i RODO
| ID | Wymaganie (do wklejenia w AC) | ASVS / MASVS | Moduł / warstwa | Epik / historyjka | Weryfikacja | Źródło |
|---|---|---|---|---|---|---|
| SR-PRIV-01 | Okresy retencji z P4 są konfiguracją (nie stałymi w kodzie) i są zgodne z `rodo.md`; zmiana okresu = zmiana `rodo.md` zaakceptowana przez Konrada. | V14.2.7 (L3) | `platform` | E8, M4 | przegląd | P4 |
| SR-PRIV-02 | Runbook praw osób (art. 15–22): kanał, weryfikacja tożsamości, terminy, operacje systemu (eksport, sprostowanie, ograniczenie przez soft delete, anonimizacja, redakcja, purge); rejestr żądań poza repozytorium. | — | `customers`, `parties`, `timeline`, `media` | E8 | ćwiczenie procedury | rodo.md |
| SR-PRIV-03 | Wyjątek od append-only (art. 17): redakcja treści `TimelineEntry` i opisu medium oraz purge pliku medium z zachowaniem rekordu — Administrator ze step-upem, audyt bez wartości. | — | `timeline`, `media`, `audit` | E5, E6 | integracyjne, macierz ról | EVM-002 (usuwanie danych), AB-15 |
| SR-PRIV-04 | Rejestr usunięć (identyfikatory obiektów, kod operacji — purge, anonimizacja, redakcja — i czas; bez danych) przechowywany **poza odtwarzaną bazą**, bo odtworzenie PITR cofnęłoby go razem z bazą: osobny bucket w projekcie Scaleway środowiska (`pl-waw`) z wersjonowaniem i lifecycle 40 dni (także starsze wersje; IaC); klucz aplikacji ma w nim wyłącznie `PutObject` (bez odczytu, listowania i usuwania), każdy wpis to nowy obiekt o kluczu z identyfikatora operacji, zapisany przed wykonaniem operacji (nieudany zapis = operacja nie startuje); odczyt ma tylko runbook odtworzenia (klucz poza VM; w teście odtworzenia — RR-20). Po każdym odtworzeniu runbook stosuje rejestr ponownie do bazy po PITR i do mediów odtworzonych z kopii w Storage Box albo ze starszych wersji obiektów (operacje idempotentne), a zadanie retencji uruchamia od razu. | — | `platform`, `infra` | EVM-007, E8 | test odtworzenia (EVM-007, staging: purge, anonimizacja i redakcja wykonane po punkcie odtworzenia, potem odtworzenie bazy i mediów — dane nie wracają) | P4, RR-14 |
| SR-PRIV-05 | Klauzule informacyjne (klienci, osoby kontaktowe stron, pracownicy, BYOD) gotowe przed produkcją; link w panelu i w aplikacji. | MASVS-PRIVACY-3 | `web`, `mobile` | E8, E14 | przegląd | rodo.md |
| SR-PRIV-06 | Przed produkcją: umowy powierzenia zawarte, regiony i retencje u dostawców ustawione, rejestr czynności przetwarzania aktualny (checklista `rodo.md`). | — | `infra` | E8 | checklista | ADR-0011, rodo.md |
| SR-PRIV-07 | Procedura naruszeń 72 h z `rodo.md` przećwiczona (tabletop) przed produkcją; kontakty dostawców i formularz UODO dostępne poza systemem. | — | `infra` | E8 | ćwiczenie | rodo.md |
| SR-PRIV-08 | Wyłącznie dane syntetyczne w testach, fixture'ach, przykładach kontraktu, zrzutach ekranu i na staging. | — | `platform`, `ci` | EVM-006, EVM-007, EVM-008, EVM-009, EVM-011 | przegląd | CLAUDE.md, ADR-0014 |
| SR-PRIV-09 | Telemetria: Sentry `sendDefaultPii: false`, scrubbing w SDK i na serwerze, bez replay i zrzutów ekranu, zapis IP wyłączony; przegląd próbek zdarzeń i logów przed każdym wydaniem. | V14.2.3, MASVS-PRIVACY-2 | `platform`, `web`, `mobile`, `infra` | EVM-007, EVM-008, EVM-009, E8, E14 | przegląd próbek (checklista wydania) | ADR-0013, AB-23 |
| SR-PRIV-10 | Instrukcja dla pracowników: nie fotografujemy dokumentów tożsamości, osób ani tablic rejestracyjnych, gdy nie jest to potrzebne; zgłaszamy utratę telefonu od razu (P7). | — | `mobile` | E8, E11 | przegląd instrukcji | P7, AB-20 |

## Wymagania do wplecenia w AC — per epik
Listy wynikają z kolumny „Epik / historyjka” katalogu. Przykładowe AC są punktem startu dla `product-owner` — wartości zgodne z rekomendacjami polityk.

**E1 Dostęp i użytkownicy (M1)** — SR-AUTH-01, SR-AUTH-02, SR-AUTH-03, SR-AUTH-04, SR-AUTH-05, SR-AUTH-06, SR-AUTH-07, SR-AUTH-08, SR-AUTH-09, SR-AUTH-10, SR-AUTH-11, SR-AUTH-12, SR-AUTH-13, SR-AUTH-14, SR-AUTH-15, SR-SESS-01, SR-SESS-02, SR-SESS-03, SR-SESS-04, SR-SESS-05, SR-SESS-06, SR-SESS-07, SR-SESS-08, SR-SESS-10, SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-09, SR-AUTHZ-11, SR-AUTHZ-12, SR-INPUT-07, SR-API-02, SR-API-13, SR-WEB-05, SR-WEB-06, SR-DATA-01, SR-DATA-03, SR-DATA-07, SR-CRYPTO-01, SR-CRYPTO-02, SR-CRYPTO-03, SR-CRYPTO-05, SR-LOG-03, SR-LOG-04, SR-LOG-06, SR-LOG-07, SR-ERR-02
- Zakładając konto Edytora bez skonfigurowanego MFA, gdy loguje się poprawnym hasłem, wtedy może wyłącznie dokończyć konfigurację MFA, a każde inne żądanie API zwraca `403 mfa_enrollment_required` (SR-AUTH-06, P1).
- Gdy w ciągu 15 min nastąpi 10 nieudanych prób logowania na jedno konto, wtedy konto jest zablokowane na 15 min, użytkownik dostaje e-mail, a treść i czas odpowiedzi są takie same jak dla nieistniejącego konta (SR-AUTH-05).
- Gdy Administrator (po step-upie) dezaktywuje konto, wtedy następne żądanie z każdej sesji web tego użytkownika zwraca `401 session_revoked`, z każdego jego urządzenia — `401 device_wipe_required`, a w audycie jest zdarzenie dezaktywacji bez danych osobowych (SR-SESS-06, SR-LOG-03).
- Zakładając urządzenie użytkownika z niewysłanymi elementami (`pendingItemsReported` > 0), gdy użytkownik resetuje zapomniane hasło, wtedy następne żądanie z urządzenia zwraca `401 session_revoked` (nie `device_wipe_required`), urządzenie nie jest oznaczone do czyszczenia (kolejka zostaje na telefonie), a ponowne logowanie nowym hasłem i MFA na tej samej instalacji wraca do tego samego `deviceId` (SR-AUTH-11, SR-MOB-04, P2).
- Gdy Administrator (po step-upie) zmienia rolę użytkownika na Tylko odczyt, a urządzenie użytkownika ma niewysłane elementy, wtedy przed zapisem widzi `pendingItemsReported` i musi potwierdzić ich utratę, a po zapisie następne żądanie z urządzenia zwraca `401 device_wipe_required` (SR-AUTHZ-09, SR-MOB-04, P2).

**E2 Klienci (M1)** — SR-SESS-08, SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-03, SR-INPUT-05, SR-API-02, SR-API-04, SR-WEB-03, SR-DATA-01, SR-DATA-02, SR-DATA-03, SR-DATA-08
- Gdy Edytor wyszukuje klienta po nazwisku, wtedy fraza jest w treści `POST /api/v1/customers/search`, nie w URL, i nie pojawia się w logach (SR-API-04, SR-LOG-02).
- Zakładając klienta po soft delete, gdy Edytor albo Tylko odczyt pobiera go po `id`, wtedy API zwraca `404 not_found` (SR-AUTHZ-02).
- Gdy Administrator anonimizuje klienta, wtedy wymagany jest step-up, pola z danymi osobowymi mają wartości neutralne, a zdarzenie audytu zawiera tylko identyfikator i kod akcji (SR-DATA-08, SR-SESS-08).

**E3 Zlecenia — rdzeń (M1)** — SR-SESS-08, SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-08, SR-AUTHZ-10, SR-INPUT-01, SR-INPUT-02, SR-INPUT-03, SR-API-02, SR-API-04, SR-API-06, SR-API-07, SR-WEB-03, SR-DATA-01, SR-DATA-02, SR-DATA-03, SR-DATA-08, SR-LOG-03
- Gdy użytkownik pobiera proces innego zlecenia przez ścieżkę `/api/v1/work-orders/{A}/procedures/{proces zlecenia B}`, wtedy API zwraca `404 not_found` (SR-AUTHZ-02).
- Gdy żądanie edycji zlecenia zawiera `status`, `number` albo `version`, wtedy API odrzuca je `400 validation_failed` z kodem `read_only_field` (SR-AUTHZ-04).
- Zakładając zlecenie z transzą `paid`, gdy Edytor próbuje je usunąć, wtedy dostaje `403 forbidden`, a Administrator może to zrobić tylko po step-upie (SR-AUTHZ-10).

**E4 Procesy i etapy (M1)** — SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-02, SR-API-07, SR-DATA-01
- Gdy Edytor wysyła przejście etapu, którego nie ma w tabeli przejść, wtedy API zwraca `409 invalid_state_transition`, a stan etapu się nie zmienia (SR-API-07).
- Gdy Tylko odczyt wysyła dowolne przejście etapu, wtedy API zwraca `403 forbidden` (test z macierzy ról — SR-AUTHZ-05).

**E5 Dziennik i komentarze (M1)** — SR-SESS-08, SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-INPUT-01, SR-INPUT-05, SR-WEB-03, SR-DATA-01, SR-DATA-08, SR-LOG-03, SR-PRIV-03
- Gdy wpis dziennika zawiera `<script>alert(1)</script>`, wtedy panel wyświetla go jako tekst, a w konsoli przeglądarki nie wykonuje się żaden skrypt (SR-WEB-03, SR-WEB-01).
- Gdy Administrator redaguje wpis, wtedy wymagany jest step-up, treść zostaje zastąpiona znacznikiem, metadane i kolejność zostają, a audyt nie zawiera treści (SR-PRIV-03).

**E6 Dokumenty i media — web (M1)** — SR-SESS-08, SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-07, SR-AUTHZ-08, SR-INPUT-01, SR-INPUT-04, SR-WEB-03, SR-WEB-04, SR-FILE-01, SR-FILE-02, SR-FILE-03, SR-FILE-04, SR-FILE-05, SR-FILE-06, SR-FILE-07, SR-FILE-08, SR-FILE-09, SR-FILE-10, SR-FILE-11, SR-FILE-12, SR-DATA-01, SR-DATA-08, SR-CRYPTO-05, SR-LOG-03, SR-LOG-07, SR-ERR-01, SR-ERR-02, SR-INFRA-02, SR-INFRA-11, SR-PRIV-03
- Gdy biuro wgrywa plik testowy EICAR, wtedy plik trafia do kwarantanny, nie da się go pobrać (`404`), a Administrator dostaje alert (SR-FILE-05).
- Gdy użytkownik otrzyma podpisany URL do oryginału, wtedy po 5 minutach URL zwraca `403`, a odpowiedź z pliku ma `Content-Disposition: attachment` (SR-FILE-07).
- Gdy Tylko odczyt prosi o URL oryginału zdjęcia albo dokumentu `identity_data`, wtedy API zwraca `403 forbidden`, a miniatura i podgląd są dostępne (SR-AUTHZ-06, P6).

**E7 Płatności etapowe (M1)** — SR-SESS-08, SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-10, SR-INPUT-01, SR-INPUT-02, SR-API-07, SR-DATA-01, SR-LOG-03
- Gdy Edytor zmienia kwotę transzy w stanie `invoiced`, wtedy dostaje `403 forbidden`; Administrator może to zrobić po step-upie, a zdarzenie audytu zawiera kwotę przed i po zmianie (SR-AUTHZ-10, SR-LOG-03).
- Gdy Tylko odczyt otwiera zestawienie nieopłaconych transz, wtedy widzi kwoty i terminy, a każda mutacja płatności zwraca `403` (SR-AUTHZ-06, P6).

**E8 Gotowość produkcyjna (M1)** — SR-AUTH-13, SR-FILE-11, SR-DATA-04, SR-DATA-07, SR-DATA-09, SR-CRYPTO-04, SR-LOG-07, SR-INFRA-07, SR-INFRA-09, SR-INFRA-13, SR-INFRA-14, SR-SUPPLY-07, SR-PRIV-01, SR-PRIV-02, SR-PRIV-04, SR-PRIV-05, SR-PRIV-06, SR-PRIV-07, SR-PRIV-09, SR-PRIV-10
- Gdy wydanie 1.0 jest kandydatem do produkcji, wtedy skan API ZAP i Schemathesis na staging nie mają ustaleń High ani Medium spoza wyjątków (bramka 8, SR-SUPPLY-07).
- Gdy wykonujemy test odtworzenia przed wydaniem, wtedy odtworzenie PITR odbywa się na tymczasowej VM w projekcie prod (nie na runnerze CI), po odtworzeniu ponownie stosowany jest rejestr usunięć spoza bazy, a dane usunięte po punkcie odtworzenia nie wracają (SR-INFRA-07, SR-PRIV-04).
- Gdy startujemy produkcję, wtedy checklista umów powierzenia z `rodo.md` jest zamknięta, a rejestr czynności przetwarzania zaktualizowany (SR-PRIV-06).

**E9 Dostęp mobilny (M2)** — SR-AUTH-01, SR-AUTH-05, SR-AUTH-06, SR-AUTH-11, SR-AUTH-14, SR-SESS-04, SR-SESS-06, SR-SESS-07, SR-SESS-09, SR-AUTHZ-06, SR-AUTHZ-12, SR-DATA-01, SR-CRYPTO-01, SR-CRYPTO-06, SR-COMM-04, SR-MOB-03, SR-MOB-04, SR-MOB-05, SR-MOB-06, SR-MOB-07, SR-MOB-08, SR-MOB-13, SR-SYNC-03, SR-SYNC-08
- Gdy Administrator wybiera „Zablokuj i wyczyść” dla urządzenia z niewysłanymi elementami, wtedy widzi ich liczbę i musi potwierdzić utratę; urządzenie po połączeniu usuwa bazę, klucz, media i kolejkę (SR-MOB-04, P2).
- Zakładając telefon bez blokady ekranu, gdy technik próbuje się zalogować, wtedy aplikacja odmawia i wyjaśnia wymaganie (SR-MOB-06, P7).
- Zakładając zalogowanego technika, gdy wyłączy blokadę ekranu i wróci do aplikacji, wtedy dane zleceń są ukryte do ponownego włączenia blokady, a aparat i kolejka działają (SR-MOB-06, P7).
- Zakładając tryb „tylko ostrzegaj” i telefon z poprawkami bezpieczeństwa starszymi niż 12 miesięcy, gdy technik się loguje, wtedy logowanie się udaje, aplikacja pokazuje ostrzeżenie, a urządzenie jest oznaczone na liście urządzeń Administratora (SR-MOB-06, P7).
- Zakładając mutację zastosowaną na serwerze, której wyniku telefon nie odebrał, i przerwany upload filmu, gdy użytkownik wybierze „Wyloguj urządzenie”, a potem zaloguje się ponownie (hasło + MFA) na tym samym telefonie, wtedy sesja jest przypięta do tego samego `deviceId`, ponowiona mutacja daje `duplicate`, film wznawia się od ostatniej potwierdzonej części, a lista urządzeń ma jeden wpis (SR-MOB-04, SR-SYNC-03, SR-SYNC-08, SR-SESS-04, P2).
- Zakładając telefon technika z niewysłanymi zdjęciami, gdy technik resetuje zapomniane hasło linkiem z e-maila, wtedy aplikacja po `401 session_revoked` ukrywa dane zleceń i zachowuje kolejkę, a po zalogowaniu nowym hasłem i MFA wysyła zdjęcia z tego samego `deviceId` (SR-AUTH-11, SR-MOB-04, P2).
- Gdy aplikacja na pierwszym planie i zadanie uploadu w tle jednocześnie potrzebują nowego access tokenu, wtedy wykonuje się jedno odświeżenie i serwer nie zgłasza ponownego użycia refresh tokenu; użycie poprzedniego refresh tokenu po 30 s kończy sesje urządzenia (`401 session_revoked`, alert), ale kolejka zostaje (SR-SESS-09, P2).
- Gdy użytkownik z rolą Tylko odczyt loguje się w aplikacji mobilnej, wtedy API odrzuca logowanie `403 channel_not_allowed`, a aplikacja pokazuje komunikat o braku dostępu (SR-AUTHZ-06, SR-AUTHZ-12, P6).
- Zakładając Administratora zalogowanego w aplikacji mobilnej, gdy jego tokenem mobilnym zostanie wysłane żądanie zmiany roli użytkownika, wtedy API zwraca `403 channel_not_allowed` bez sprawdzania obiektu i bez propozycji step-upu (SR-AUTHZ-12, P1).

**E10 Zlecenia offline (M2)** — SR-AUTHZ-03, SR-AUTHZ-09, SR-AUTHZ-12, SR-INPUT-01, SR-DATA-01, SR-MOB-01, SR-MOB-05, SR-MOB-10, SR-SYNC-01, SR-SYNC-04, SR-SYNC-06, SR-SYNC-07
- Gdy na telefon trafia zlecenie, wtedy lokalna baza nie zawiera etapów płatności, PPE, e-maila, NIP-u ani notatek klienta (SR-SYNC-04).
- Zakładając 7 dni bez kontaktu z serwerem, gdy technik otwiera aplikację, wtedy dane zleceń są ukryte do zalogowania online, a aparat i kolejka nadal działają (SR-MOB-05, P2).

**E11 Zdjęcia i filmy (M2)** — SR-AUTHZ-12, SR-INPUT-01, SR-API-05, SR-FILE-01, SR-FILE-02, SR-FILE-03, SR-FILE-04, SR-FILE-05, SR-FILE-07, SR-FILE-08, SR-FILE-10, SR-FILE-12, SR-DATA-01, SR-CRYPTO-05, SR-MOB-01, SR-MOB-02, SR-SYNC-01, SR-SYNC-02, SR-SYNC-03, SR-SYNC-05, SR-SYNC-06, SR-SYNC-08, SR-PRIV-10
- Gdy technik robi zdjęcie w aplikacji, wtedy oryginał nie zawiera współrzędnych GPS, a aplikacja nie prosi o uprawnienie lokalizacji (SR-FILE-08, P3).
- Zakładając urządzenie unieważnione („Zablokuj i wyczyść”), gdy wysyła zaległą partię `CreateMediaAsset`, wtedy serwer odpowiada `401 device_wipe_required` dla całej partii i nic nie zapisuje (SR-SYNC-01, SR-SYNC-03).
- Gdy plik został wysłany, wtedy lokalny oryginał jest usuwany dopiero, gdy serwer potwierdzi stan `clean` lub późniejszy (SR-SYNC-08).

**E12 Wpisy offline (M2)** — SR-INPUT-01, SR-API-05, SR-DATA-01, SR-SYNC-01, SR-SYNC-02, SR-SYNC-03, SR-SYNC-05, SR-SYNC-06
- Gdy wpis z telefonu ma `capturedAt` spoza dozwolonego zakresu, wtedy serwer zapisuje wpis w kolejności czasu serwera, a `capturedAt` traktuje tylko jako metadaną (SR-SYNC-05).
- Zakładając, że użytkownik stracił dostęp do zlecenia, gdy telefon wysyła wpis do tego zlecenia, wtedy wynik to `rejected: forbidden`, a wpis trafia na listę „Wymaga uwagi” (SR-SYNC-02).

**E13 Nowe zlecenie z telefonu (M2)** — SR-INPUT-01, SR-API-05, SR-DATA-01, SR-SYNC-01, SR-SYNC-02, SR-SYNC-03, SR-SYNC-06
- Gdy `CreateQuickWorkOrder` zawiera `id` klienta istniejącego na serwerze (także cudzego), wtedy wynik to `rejected: id_conflict`, a istniejący klient nie zostaje zmieniony (SR-SYNC-03).
- Gdy ta sama komenda zostanie wysłana ponownie po zerwanym połączeniu, wtedy wynik to `duplicate` z tym samym identyfikatorem zlecenia (SR-API-05, SR-SYNC-03).

**E14 Dystrybucja i utrzymanie (M2)** — SR-API-08, SR-LOG-08, SR-MOB-09, SR-MOB-11, SR-MOB-12, SR-SUPPLY-08, SR-PRIV-05, SR-PRIV-09
- Zakładając minimalną wersję wyższą niż zainstalowana, gdy aplikacja łączy się z API, wtedy dostaje `426`, pokazuje ekran aktualizacji i zachowuje kolejkę (SR-API-08, SR-MOB-09).
- Gdy w aplikacji wystąpi błąd, wtedy zdarzenie w Sentry nie zawiera zrzutu ekranu, hierarchii widoków ani danych klienta (SR-LOG-08, SR-PRIV-09).

**EVM-006 Repozytorium, monorepo i CI (M0)** — SR-INFRA-05, SR-INFRA-09, SR-SUPPLY-01, SR-SUPPLY-02, SR-SUPPLY-03, SR-SUPPLY-04, SR-SUPPLY-05, SR-SUPPLY-06, SR-SUPPLY-07, SR-SUPPLY-09, SR-SUPPLY-10, SR-PRIV-08
- Gdy commit zawiera testowy sekret, wtedy hook pre-commit (gitleaks) i check CI kończą się błędem (bramka 1).
- Gdy PR dodaje zależność z podatnością High z dostępną poprawką, wtedy check OSV-Scanner jest czerwony i PR nie da się scalić (bramka 3, SR-SUPPLY-05).

**EVM-007 Staging, wdrożenia, backupy, monitoring (M0)** — SR-API-11, SR-API-12, SR-WEB-02, SR-FILE-06, SR-DATA-04, SR-CRYPTO-04, SR-COMM-01, SR-COMM-02, SR-COMM-03, SR-COMM-05, SR-LOG-01, SR-LOG-04, SR-LOG-07, SR-LOG-09, SR-INFRA-01, SR-INFRA-02, SR-INFRA-03, SR-INFRA-04, SR-INFRA-05, SR-INFRA-06, SR-INFRA-07, SR-INFRA-08, SR-INFRA-09, SR-INFRA-10, SR-INFRA-11, SR-INFRA-12, SR-INFRA-13, SR-INFRA-14, SR-SUPPLY-02, SR-SUPPLY-03, SR-SUPPLY-07, SR-PRIV-04, SR-PRIV-08, SR-PRIV-09
- Gdy wdrożenie na staging się kończy, wtedy anonimowy `GET` obiektu w buckecie zwraca `403`, a skan portów z zewnątrz widzi tylko 80/443 i ograniczony 22 (bramka 10).
- Gdy job wdrożenia kończy się, także błędem, wtedy port 22 jest niedostępny z runnera, w firewallu nie ma reguły spoza allowlisty, a poświadczenia kanału wdrożenia nie pozwalają na powłokę ani dostęp do Dockera na VM (SR-INFRA-14).
- Gdy na staging kluczem z VM usuwamy obiekty kopii bazy, wtedy odtworzenie PITR nadal działa; na prod ta sama kontrola jest nieniszcząca — usunięcie zablokowanej wersji obiektu kontrolnego zwraca `AccessDenied` (SR-INFRA-07).
- Zakładając purge pliku i anonimizację klienta wykonane na staging po wybranym punkcie odtworzenia, gdy odtwarzamy bazę do tego punktu i media z kopii w Storage Box, wtedy po zastosowaniu rejestru usunięć ani dane klienta, ani plik nie wracają (SR-PRIV-04).

**EVM-008 Chodzący szkielet — API i panel web (M0)** — SR-SESS-10, SR-AUTHZ-01, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-12, SR-INPUT-01, SR-INPUT-03, SR-INPUT-04, SR-INPUT-05, SR-INPUT-06, SR-INPUT-08, SR-API-01, SR-API-02, SR-API-03, SR-API-04, SR-API-06, SR-API-08, SR-API-09, SR-API-10, SR-API-11, SR-API-12, SR-API-13, SR-WEB-01, SR-WEB-02, SR-WEB-03, SR-WEB-05, SR-WEB-07, SR-WEB-08, SR-DATA-03, SR-DATA-05, SR-DATA-06, SR-CRYPTO-01, SR-COMM-01, SR-COMM-02, SR-LOG-01, SR-LOG-02, SR-LOG-05, SR-LOG-06, SR-ERR-01, SR-ERR-02, SR-INFRA-06, SR-PRIV-08, SR-PRIV-09
- Gdy wysyłam nieuwierzytelnione żądanie do dowolnego zasobu poza `/api/health`, wtedy API zwraca `401`, a operacja bez `x-evia-authz` kończy lint kontraktu błędem (SR-AUTHZ-01).
- Gdy operacja w kontrakcie nie ma `channels` albo ma `stepUp: true` (lub jest funkcją administracyjną) i `channels` zawiera `mobile`, wtedy lint kontraktu kończy się błędem, a wygenerowana macierz ról ma przypadki dla obu kanałów (SR-AUTHZ-12).
- Gdy otwieram panel, wtedy odpowiedź ma CSP bez `unsafe-inline` i `unsafe-eval`, HSTS i pozostałe nagłówki z P11 (SR-WEB-01, SR-WEB-08).

**EVM-009 Chodzący szkielet — aplikacja mobilna (M0)** — SR-API-08, SR-DATA-06, SR-CRYPTO-06, SR-COMM-04, SR-LOG-08, SR-MOB-01, SR-MOB-02, SR-MOB-07, SR-MOB-09, SR-MOB-11, SR-SUPPLY-08, SR-PRIV-08, SR-PRIV-09
- Gdy budujemy wersję release, wtedy paczka nie zawiera sekretów, `allowBackup` jest wyłączone, a ruch nieszyfrowany jest zabroniony w `network_security_config` (SR-MOB-11, SR-MOB-02, SR-COMM-04).

**EVM-011 Spike: kolejka offline i upload w tle (M0)** — SR-MOB-02, SR-MOB-03, SR-MOB-04, SR-SYNC-03, SR-SYNC-08, SR-PRIV-08
- Raport spike'u zawiera wynik weryfikacji: dane i pliki kolejki nie trafiają do kopii Google, a zachowanie kolejki po unieważnieniu urządzenia odpowiada wariantowi z P2 (SR-MOB-02, SR-MOB-04).
- Raport spike'u zawiera scenariusz ciągłości kolejki (serwer symulowany, token testowy — uwierzytelnianie jest poza zakresem EVM-011, pełne logowanie sprawdza E9): mutacja zastosowana bez odebranego wyniku i przerwany upload filmu, potem nowa sesja z tym samym `deviceId` → `duplicate` i wznowienie od ostatniej potwierdzonej części; kontrolnie ta sama sytuacja z nowym `deviceId` → `id_conflict` i upload od nowa (SR-MOB-04, SR-SYNC-03, SR-SYNC-08, P2).

**EVM-013 Walidator dokumentacji w CI (M0)** — SR-SUPPLY-11
- Gdy PR dodaje plik `.md` poza dozwoloną lokalizacją, wtedy check walidatora dokumentacji jest czerwony (bramka 11).

**M4 i później (przyszłe — jawnie oznaczone)** — SR-API-14, SR-DATA-07, SR-DATA-09, SR-PRIV-01
- Przed upływem pierwszego terminu retencji danych biznesowych działa zadanie retencji zgodne z P4 (SR-DATA-07); eksport CSV/XLSX chroni przed formula injection (SR-API-14).

**M5 Integracje (przyszłe — zasady)** — SR-API-13
- Każda integracja ma listę dozwolonych hostów w konfiguracji i przegląd `security-engineer` (SR-API-13, AB-12).

## Pokrycie ASVS 5.0.0
**Stosowalność rozdziałów** (liczby wymagań L1 + L2 z oficjalnego CSV). Rozdziały stosowalne mają w [załączniku A](#załącznik-a--asvs-500-l1-i-l2--sr-albo-nd) każde wymaganie L1 i L2 przypisane do `SR-…` albo oznaczone N/D z uzasadnieniem.

| Rozdział | L1 + L2 | Stosowalny | N/D w załączniku | Uzasadnienie i warunek ponownej oceny |
|---|---|---|---|---|
| V1 Encoding and Sanitization | 27 | tak | 5 | LDAP, XPath, LaTeX, JNDI, memcache — technologie nieużywane |
| V2 Validation and Business Logic | 11 | tak | 0 | — |
| V3 Web Frontend Security | 19 | tak | 0 | — |
| V4 API and Web Service | 10 | tak | 6 | GraphQL i WebSocket nieużywane (ADR-0004) |
| V5 File Handling | 9 | tak | 0 | — |
| V6 Authentication | 35 | tak | 7 | brak uwierzytelniania out-of-band (SMS) i zewnętrznego IdP (ADR-0005) |
| V7 Session Management | 18 | tak | 3 | brak federacji i SSO |
| V8 Authorization | 7 | tak | 1 | system jednej firmy (bez wielodostępności) — ponowna ocena przy portalu klienta i partnerach (M5) |
| V9 Self-contained Tokens | 7 | **N/D** | — | sesje i tokeny są nieprzezroczyste i sprawdzane w bazie przy każdym żądaniu (ADR-0005); kursory synchronizacji i paginacji to nieprzezroczyste odwołania sprawdzane przez serwer, a podpisane URL-e weryfikuje dostawca storage'u. **Ponowna ocena:** wprowadzenie JWT lub innego tokenu samowystarczalnego (np. zewnętrzny IdP z planu wyjścia ADR-0005) |
| V10 OAuth and OIDC | 29 | **N/D** | — | brak OAuth i OIDC (ADR-0005). **Ponowna ocena:** integracje i portal klienta (M5), przejście na IdP |
| V11 Cryptography | 14 | tak | 0 | — |
| V12 Secure Communication | 9 | tak | 1 | brak mTLS |
| V13 Configuration | 13 | tak | 0 | — |
| V14 Data Protection | 9 | tak | 0 | — |
| V15 Secure Coding and Architecture | 13 | tak | 0 | — |
| V16 Security Logging and Error Handling | 16 | tak | 0 | — |
| V17 WebRTC | 7 | **N/D** | — | brak WebRTC |
| **Razem** | **253** | 14 rozdziałów | **23** | rozdziały stosowalne: 210 wymagań — 187 przypisanych do `SR-…`, 23 N/D; rozdziały N/D: 43 |

**Świadomie przyjęte wymagania L3** (tanie albo wynikające z ADR): V1.2.10, V1.3.12, V3.5.8, V3.6.1, V4.1.4, V5.2.4, V5.2.6, V6.3.5, V6.3.6, V6.3.7, V6.3.8, V7.5.3, V8.1.3, V8.2.4, V8.3.2, V8.4.2, V11.3.4, V13.3.4, V13.4.6, V14.2.6, V14.2.7, V14.2.8 (częściowo — P3), V15.2.4, V16.5.4.

## MASVS 2.1.0 — 24 kontrole
Elementy specyficzne dla iOS są **odłożone** razem z całym iOS (ADR-0015) — warunek: weryfikacja MASVS na iOS przed jakimkolwiek wydaniem iOS (RR-09).

| Kontrola | Treść (skrót) | Profil i stosowalność | SR | Epik / historyjka | iOS |
|---|---|---|---|---|---|
| MASVS-STORAGE-1 | bezpieczne przechowywanie danych wrażliwych | MAS-L1, MAS-L2 | SR-MOB-01, SR-MOB-03, SR-MOB-04, SR-MOB-13 | EVM-009, E9, E10, E11 | Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, klasy ochrony plików — odłożone (ADR-0015) |
| MASVS-STORAGE-2 | zapobieganie wyciekom danych | MAS-L1 | SR-MOB-02, SR-MOB-08, SR-LOG-08 | EVM-009, E11, E14 | `isExcludedFromBackup` — odłożone (ADR-0015) |
| MASVS-CRYPTO-1 | aktualna, silna kryptografia | MAS-L1 | SR-MOB-01, SR-CRYPTO-01 | EVM-009, E9 | — |
| MASVS-CRYPTO-2 | zarządzanie kluczami | MAS-L1 | SR-MOB-01, SR-CRYPTO-06, SR-CRYPTO-04 | EVM-009, E9 | Keychain — odłożone (ADR-0015) |
| MASVS-AUTH-1 | bezpieczne protokoły uwierzytelniania i autoryzacji | MAS-L1 | SR-SESS-09, SR-AUTH-06, SR-MOB-04, SR-MOB-05 | E9 | — |
| MASVS-AUTH-2 | lokalne uwierzytelnienie zgodne z platformą | MAS-L1 (biometria opcjonalna, tylko bramka UI) | SR-MOB-03 | E9 | LocalAuthentication — odłożone (ADR-0015) |
| MASVS-AUTH-3 | dodatkowe uwierzytelnienie operacji wrażliwych | MAS-L2 — w MVP nie dotyczy: operacje ze step-upem są wyłącznie w kanale `web` (SR-AUTHZ-12), aplikacja tylko tworzy wpisy i media; operacja wrażliwa na telefonie wymaga zmiany SR-AUTHZ-12, step-upu w aplikacji i przeglądu security | SR-SESS-08, SR-AUTHZ-12 | E9 (gdy dotyczy) | — |
| MASVS-NETWORK-1 | bezpieczny ruch sieciowy | MAS-L1 | SR-COMM-04 | EVM-009, E9 | ATS bez wyjątków — odłożone (ADR-0015) |
| MASVS-NETWORK-2 | przypinanie tożsamości | MAS-L2 — decyzja P8 (rekomendacja: bez przypinania w MVP, CAA i monitoring CT) | SR-COMM-04, SR-INFRA-12 | E9 | — |
| MASVS-PLATFORM-1 | bezpieczne IPC (deep linki, intencje) | MAS-L1 | SR-MOB-07 | EVM-009, E9 | Universal Links — odłożone (ADR-0015) |
| MASVS-PLATFORM-2 | bezpieczne WebView | MAS-L1 | SR-MOB-07 | EVM-009 | — |
| MASVS-PLATFORM-3 | bezpieczny interfejs | MAS-L1 | SR-MOB-08 | E9 | — |
| MASVS-CODE-1 | aktualna wersja platformy | MAS-L1 | SR-MOB-06 | E9 | minimalna wersja iOS — odłożone (ADR-0015) |
| MASVS-CODE-2 | wymuszanie aktualizacji aplikacji | MAS-L1 | SR-MOB-09, SR-API-08 | EVM-009, E14 | — |
| MASVS-CODE-3 | komponenty bez znanych podatności | MAS-L1 | SR-SUPPLY-02, SR-SUPPLY-07, SR-SUPPLY-08, SR-MOB-11 | EVM-006, EVM-009, E14 | — |
| MASVS-CODE-4 | walidacja danych niezaufanych | MAS-L1 | SR-MOB-10, SR-MOB-07, SR-SYNC-06 | E10 | — |
| MASVS-RESILIENCE-1 | weryfikacja integralności platformy | MAS-R — **N/D** (profil poza zakresem; bezpieczeństwo danych nie opiera się na kliencie — autoryzacja na serwerze) | — | — | — |
| MASVS-RESILIENCE-2 | ochrona przed modyfikacją aplikacji | MAS-R — **N/D**; podpis Play App Signing i dystrybucja tylko z Google Play jako higiena | SR-MOB-11 | E14 | — |
| MASVS-RESILIENCE-3 | utrudnianie analizy statycznej | MAS-R — **N/D**; minifikacja R8 jako higiena | SR-MOB-11 | E14 | — |
| MASVS-RESILIENCE-4 | utrudnianie analizy dynamicznej | MAS-R — **N/D** | — | — | — |
| MASVS-PRIVACY-1 | minimalny dostęp do danych i zasobów | MAS-P | SR-MOB-02, SR-SYNC-04, SR-FILE-08 | E10, E11 | — |
| MASVS-PRIVACY-2 | brak identyfikacji i śledzenia użytkownika | MAS-P | SR-MOB-12, SR-DATA-06, SR-PRIV-09 | E14 | — |
| MASVS-PRIVACY-3 | przejrzystość zbierania danych | MAS-P | SR-MOB-12, SR-PRIV-05 | E8, E14 | etykiety prywatności App Store — odłożone (ADR-0015) |
| MASVS-PRIVACY-4 | kontrola użytkownika nad danymi | MAS-P | SR-MOB-12 | E14 | — |

## Bramki bezpieczeństwa CI (AC5)
Gotowe do wdrożenia w EVM-006 (repozytorium i CI), EVM-007 (staging, wdrożenia, backupy), EVM-008 (pierwszy endpoint), EVM-013 (walidator dokumentacji) i E8 (gotowość produkcyjna). Narzędzia wyłącznie z ADR-0012 i ADR-0014; środowisko zgodne z ADR-0015 (gitleaks natywnie w pre-commit, pozostałe skany w CI Linux; skan obrazów tylko w CI — bez gniazda Dockera lokalnie). **DAST wyłącznie na staging — nigdy na produkcji ani na systemach stron trzecich.**

| # | Obszar | Narzędzie (ADR) | Zakres | Wyzwalacz | Środowisko (ADR-0015) | Próg blokujący | Obsługa wyjątków | Historyjka |
|---|---|---|---|---|---|---|---|---|
| 1 | Sekrety | **gitleaks** (ADR-0012) | pełna historia git w każdym przebiegu CI i nocą; w hookach — indeks (pre-commit) i wypychane zakresy (pre-push) | pre-commit, pre-push, każdy push (CI), nocą | hooki i `pnpm run scan`: obraz po digeście przez `docker compose -f compose.yaml run --rm scan-gitleaks` (EVM-006; zawsze `--redact`, jawne `.gitleaks.toml` i `.gitleaksignore`); CI Linux | **każde wykrycie** | wyłącznie fałszywe alarmy: fingerprint w `.gitleaksignore` z komentarzem (powód, właściciel, data przeglądu); prawdziwy sekret = rotacja i usunięcie, nigdy wyjątek | EVM-006 |
| 2 | SAST | **Semgrep CE** — reguły rejestru (TypeScript, Node.js, React) + reguły własne w repozytorium (ADR-0012) | `apps/`, `packages/`, `services/`, `tools/` | każdy push, `main` i nocą — zawsze pełny skan (EVM-006; surowiej niż „tylko nowe ustalenia”) | CI Linux (lokalnie opcjonalnie — wymaganie dla EVM-006 niżej) | ustalenie z **reguły własnej** albo o ważności **ERROR** z rejestru; WARNING — raport i triage w 7 dni | komentarz `nosemgrep: <reguła> — <powód>` + wpis w rejestrze wyjątków | EVM-006 |
| 3 | SCA — podatności | **OSV-Scanner** (blokujący) + **`pnpm audit`** (raport) (ADR-0012) | `pnpm-lock.yaml` — wszystkie workspace'y, zależności prod i dev | PR, `main`, nocą | CI Linux | PR: **Critical/High (CVSS ≥ 7,0) z dostępną poprawką** i **każdy pakiet złośliwy (`MAL-…`)**; nocą: przekroczony termin naprawy (SR-SUPPLY-02) → czerwony check na `main` | `osv-scanner.toml` — `[[IgnoredVulns]]` z `reason` i `ignoreUntil` (≤ 30 dni Critical/High, ≤ 90 dni Medium); dla `MAL-…` brak wyjątków. `pnpm audit --audit-level=high` nocą jako drugie źródło — nie blokuje (nie obsługuje wyjątków z datą wygaśnięcia), rozbieżność → triage | EVM-006 |
| 4 | SCA — licencje | **Trivy** `--scanners license --pkg-types library` (ADR-0012) | zależności produkcyjne każdego workspace'u z `pnpm-lock.yaml` (licencje z linuksowych `node_modules`); obrazy — EVM-007 | każdy push (job `backend`), `pnpm run scan` | CI Linux; lokalnie wolumen `bt-work` po `backend-install` | licencja **spoza listy dozwolonych** albo nieznana w zależności produkcyjnej; dotyczy komponentów dystrybuowanych — **paczka panelu i aplikacja mobilna** (obrazy serwerowe nie są redystrybuowane). Trivy nie odróżnia workspace'ów dystrybuowanych, więc blokuje w każdym; wyjątki serwerowe — przez plik wyjątków. **Reguła dla EVM-008/009:** biblioteki trafiające do paczki panelu i aplikacji mają być w `dependencies` (Vite pakuje też `devDependencies`) albo skan obejmuje je flagą `--include-dev-deps` | plik wyjątków licencji (`.trivyignore.yaml` → `licenses`) — tylko narzędzia niedystrybuowane (GPL/LGPL/AGPL: Renovate, k6, ClamAV, ffmpeg, Semgrep CE) z uzasadnieniem. Dozwolone: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, MPL-2.0, Zlib, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0, CC-BY-4.0 (dane), **OFL-1.1** (fonty panelu) | EVM-006 |
| 5 | IaC i konfiguracja | **Trivy** `config` + reguły własne — w EVM-006 testy `tools/repo-policy` zamiast Rego (akceptacja `security-engineer`); Rego dla OpenTofu — EVM-007 (ADR-0012) | `infra/` (OpenTofu), `compose*.yaml`, `Dockerfile*` | PR, `main` | CI Linux | **HIGH/CRITICAL** oraz zawsze reguły własne: publiczny bucket lub ACL `public-*`; port bazy, kolejki lub workera publikowany (w dev poza `127.0.0.1`); `clamd` albo `media-processor` z siecią; kontener uprzywilejowany lub z gniazdem Dockera; obraz bez digestu; firewall z `0.0.0.0/0` na port inny niż 80/443; port 22 ze źródłem spoza zmiennej allowlisty administracyjnej (w tym zakresy IP GitHub Actions — SR-INFRA-14) | `.trivyignore.yaml` z `statement` i `expired_at` | EVM-006 (reguły), EVM-007 (IaC) |
| 5a | Workflowy GitHub Actions | **zizmor** + **actionlint** (ADR-0016, D3) | `.github/workflows/**` | każdy push (job `security`), `pnpm run scan` | obrazy po digeście, bez sieci (`--offline`); CI Linux | zizmor: **każde ustalenie od ważności `low`** (persona domyślna); actionlint: każdy błąd; dodatkowo testy `tools/repo-policy` (SHA akcji, `permissions`, `persist-credentials: false`, sekrety tylko w `renovate.yml`) | `zizmor.yml` albo `# zizmor: ignore[…]` z powodem, właścicielem i `review_by` ≤ 90 dni | EVM-006 |
| 6 | Obrazy kontenerów | **Trivy** `image` + SBOM CycloneDX (ADR-0012) | obrazy budowane w CI i bazowe (PostgreSQL, Caddy, ClamAV, `media-processor`) po digeście | przed każdym wdrożeniem (staging, prod); nocą — obrazy wdrożone | CI Linux (lokalnie nie — wymagałby gniazda Dockera, ADR-0015) | **Critical/High z dostępną poprawką** blokuje wdrożenie; nocą — alert i termin z SR-SUPPLY-02 | `.trivyignore.yaml` (podatność bez poprawki w pakiecie systemowym: ≤ 30 dni z analizą osiągalności) | EVM-007 |
| 7 | DAST — baseline | **ZAP baseline** (pasywny) (ADR-0012, ADR-0014) | panel i API **staging**; kontekst ograniczony do domeny staging; zalogowane konto syntetyczne | po każdym wdrożeniu na staging | CI Linux (obraz ZAP po digeście) | alert ryzyka **High lub Medium** spoza wyjątków → czerwony status wdrożenia staging i **blokada promocji do prod** (merge nie — skan po merge) | plik reguł ZAP (`IGNORE`/`WARN` z uzasadnieniem i datą przeglądu) | EVM-007 |
| 8 | DAST — API przed wydaniem | **ZAP API scan** z kontraktem OpenAPI + **Schemathesis** (ADR-0012, ADR-0014) | API **staging**, konta syntetyczne każdej roli, dane syntetyczne, ograniczona szybkość; bucket i Sentry poza kontekstem | przed każdym wydaniem | CI Linux; **wyłącznie staging** | **High/Medium** z ZAP; odpowiedzi 5xx i niezgodne z kontraktem z Schemathesis → blokada wydania | jak 7 | E8 (konfiguracja: EVM-007) |
| 9 | Testy bezpieczeństwa | **Redocly** (reguły `x-evia-authz` — w tym obowiązkowe `channels`, `mobile` tylko dla operacji z listy SR-AUTHZ-12 i nigdy przy `stepUp: true` ani funkcjach administracyjnych — oraz zakaz parametrów z danymi osobowymi), test inwentarza tras, test startowy „każda trasa ma politykę”, **generator macierzy ról** (z wymiarem kanału) + IDOR + kompletność, testy uprawnień ról bazy, testy redakcji logów, **dependency-cruiser** (ADR-0001, ADR-0004, ADR-0014) | kontrakt i backend | PR, `main` | backend lokalnie w kontenerze `backend-tests`; CI Linux | **każde niepowodzenie**; kompletność macierzy ról = 100% operacji | brak wyjątków | EVM-008 (pierwszy endpoint), EVM-006 (bramka) |
| 10 | Kontrole wdrożenia | skrypt wdrożenia (ADR-0009, ADR-0011): „anonimowy `GET` = 403” bucketów, skan portów z zewnątrz (80/443 i 22 z allowlisty; w wariancie „push przez SSH” po usunięciu reguły tymczasowej — SR-INFRA-14), nagłówki i TLS (`curl`/`openssl` z runnera, bez nowego narzędzia); backup (SR-INFRA-07): na prod nieniszcząca kontrola niezmienności (zadanie na VM prod, metryka) i test odtworzenia PITR z rejestrem usunięć, na staging pełny scenariusz „backup usunięty z przejętej VM” | staging i prod | po każdym wdrożeniu i zmianie IaC; backup — co miesiąc i przed wydaniem (na prod nieniszcząco; scenariusz z usuwaniem na prod tylko w corocznym ćwiczeniu DR) | CI Linux — kontrole wdrożenia z runnera; test odtworzenia: CI tylko orkiestruje, odtworzenie wyłącznie na tymczasowej VM w projekcie prod w UE (dane nigdy na runnerze ani na staging; tożsamość jobu — RR-20) | **każde niepowodzenie** — rollback albo wstrzymanie wydania | brak | EVM-007, E8 |
| 11 | Dokumentacja | **walidator cyklu życia dokumentów** (`npm run docs:check`, EVM-012) | pliki `.md` | PR | CI Linux; lokalnie natywnie | **błędy walidatora** | brak (zmiana polityki dokumentów — decyzja Konrada) | EVM-013 |
| 12 | Aktualizacje | **Renovate** jako GitHub Action (ADR-0012) | zależności, akcje (SHA), obrazy (digest) | harmonogram i alerty bezpieczeństwa | CI | nie blokuje; karencja 3 dni (poprawki bezpieczeństwa — bez karencji, ale z przeglądem PR) | — | EVM-006 |

**Obsługa wyjątków (wszystkie bramki)**
- Wyjątek zawiera: identyfikator ustalenia, powód (fałszywy alarm albo brak osiągalności), właściciela, datę wygaśnięcia (≤ 30 dni dla Critical/High, ≤ 90 dni dla Medium i Low; licencje i fałszywe alarmy sekretów — przegląd co kwartał) i link do historyjki naprawczej.
- Zmiana pliku wyjątków wymaga akceptacji `security-engineer` (CODEOWNERS — SR-SUPPLY-05; na Free — checklista PR, K3); wygasły wyjątek = czerwona bramka (`tools/repo-policy`, EVM-006). Format (EVM-006): OSV — `[[IgnoredVulns]]` z `id`, `ignoreUntil`, `reason` („… · owner: … · EVM-###”); Trivy — `.trivyignore.yaml` z `id`, `statement` („… · owner: … · EVM-###”), `expired_at`; gitleaks — fingerprint poprzedzony komentarzem `# reason: … · owner: … · review_by: YYYY-MM-DD`; zizmor i `nosemgrep` — komentarz z `reason`, `owner` i `review_by`. Horyzonty: ≤ 30 dni Critical/High, ≤ 90 dni pozostałe, licencje i fałszywe alarmy sekretów.
- Bez wyjątków: prawdziwe sekrety, pakiety złośliwe, brak `x-evia-authz`, brak testów macierzy ról, publiczny bucket.

**Terminy naprawy** (SR-SUPPLY-02, ASVS V15.1.1): Critical — 7 dni (72 h przy publicznym exploicie dla komponentu w produkcji); High — 30 dni; Medium — 90 dni; Low — przy najbliższej aktualizacji. Ustalenia z przeglądów: blocker i major — przed merge (lub ryzyko zaakceptowane przez Konrada), minor — backlog.

**Wymaganie dla EVM-006 — skany lokalne przez agentów (ADR-0015)**
- Jedno polecenie skanów lokalnych (nazwa w EVM-006) dla gitleaks, Semgrep, OSV-Scanner i Trivy (`config`, `license`).
- Uruchamianie bez `docker run` (reguła `deny` w `.claude/settings.json`): natywne binaria w przypiętych wersjach z weryfikacją sum kontrolnych albo usługa w `compose.yaml` wywoływana dokładną regułą `allow` (`docker compose -f compose.yaml run --rm …`); bez gniazda Dockera (skan obrazów tylko w CI).
- Bazy podatności pobierane osobnym krokiem; skany bez wysyłania kodu na zewnątrz (Semgrep CE lokalnie, bez logowania do usług chmurowych Semgrep). **Realizacja EVM-006:** `pnpm run scan` (`tools/scan`) — Trivy działa bez sieci (wbudowane reguły konfiguracji, licencje bez bazy); odstępstwo zaakceptowane przez `security-engineer`: Semgrep pobiera reguły z rejestru w chwili skanu (`scan`, `--metrics=off`, bez tokenu, kod nie wychodzi), OSV-Scanner wysyła do osv.dev wyłącznie nazwy i wersje pakietów.
- Wyniki w artefaktach CI albo w katalogu plików roboczych ignorowanym przez git ([`../process/document-lifecycle.md`](../process/document-lifecycle.md) → „Pliki robocze”), nigdy w części repozytorium śledzonej przez git.
- Narzędzia skanujące w CI instalowane z przypiętej wersji i sumy kontrolnej albo z obrazu po digeście — nigdy przez akcję lub obraz po tagu (CVE-2026-33634, SR-SUPPLY-04); joby skanów bez sekretów.

### Propozycje (poza ADR-0012) — do decyzji architekta i Konrada
Nie są na liście blokującej; każda wymaga decyzji `solution-architect` i Konrada (nowe narzędzie lub konfiguracja).

| Propozycja | Po co | Narzędzie i licencja | Koszt | Rekomendacja |
|---|---|---|---|---|
| Analiza statyczna workflowów GitHub Actions | wstrzyknięcia w `run:`, nadmiarowe uprawnienia, `pull_request_target`, akcje po tagu | zizmor (MIT) albo actionlint (MIT) | 0 zł, ok. 1 h | **wdrożone w EVM-006** — zizmor i actionlint (bramka 5a, ADR-0016) |
| Weryfikacja podpisów obrazów i binarek narzędzi (R3, RR-04) | odrzucenie artefaktu niepodpisanego przez wydawcę | cosign (Apache-2.0), `gh attestation verify` | 0 zł, 0,5–1 dnia | tak — dla obrazów bazowych i Trivy, gdy wydawca podpisuje |
| Osobna tożsamość GitHub dla agentów — GitHub App zainstalowana tylko w tym repozytorium — i wymagana akceptacja PR przez Konrada (RR-02, RR-11; warianty i konsekwencje w RR-02) | token agentów (instalacyjny, ważny 1 h) bez uprawnień `administration` i `actions` — nie zmieni rulesetu i nie wyzwoli wdrożenia; PR scala się dopiero po akceptacji Konrada | funkcje GitHub Pro (konfiguracja, nie narzędzie) | 0 zł, ok. 2 h | na GitHub Free bez efektu (brak rulesetu i wymaganej akceptacji PR) — wraca przy planie płatnym (ADR-0016, decyzja `security-engineer` w EVM-006) |
| Kontrola ruchu wychodzącego runnerów CI | wykrycie wycieku sekretów przez przejęte narzędzie | StepSecurity harden-runner (Apache-2.0) | 0 zł (plan community) | później (po EVM-007) |
| Rozszerzony test TLS po wdrożeniu | pełna ocena konfiguracji TLS | testssl.sh (GPL-2.0, narzędzie niedystrybuowane) | 0 zł | opcjonalnie — podstawowy test w bramce 10 wystarcza |

## Źródła
Zweryfikowane 2026-10-03.
- OWASP ASVS 5.0.0 — wydanie i pliki (CSV, JSON): https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release ; strona projektu: https://owasp.org/www-project-application-security-verification-standard/
- OWASP MASVS 2.1.0 (2024-01-18) — kontrole (YAML): https://github.com/OWASP/masvs/releases/tag/v2.1.0 ; profile testowe MAS (MASTG): https://mas.owasp.org/MASTG/
- CVE-2026-33634 (Trivy, marzec 2026): https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
- OSV-Scanner — wyjątki z `ignoreUntil`: https://google.github.io/osv-scanner/configuration/
- Trivy — `.trivyignore.yaml` (`expired_at`), skan licencji i konfiguracji: https://trivy.dev/latest/docs/configuration/filtering/
- gitleaks — `.gitleaksignore`: https://github.com/gitleaks/gitleaks
- ZAP — baseline i API scan: https://www.zaproxy.org/docs/docker/baseline-scan/ , https://www.zaproxy.org/docs/docker/api-scan/

## Załącznik A — ASVS 5.0.0 L1 i L2 → SR albo N/D
Każde wymaganie L1 i L2 rozdziałów stosowalnych (V1–V8, V11–V16): przypisane `SR-…` albo N/D z uzasadnieniem. Kolumna „L” — poziom z oficjalnego CSV.

| ID | L | Sekcja | SR albo N/D | Uwagi |
|---|---|---|---|---|
| V1.1.1 | 2 | Encoding and Sanitization Architecture | SR-INPUT-05 |  |
| V1.1.2 | 2 | Encoding and Sanitization Architecture | SR-WEB-03, SR-INPUT-03 |  |
| V1.2.1 | 1 | Injection Prevention | SR-WEB-03 |  |
| V1.2.2 | 1 | Injection Prevention | SR-WEB-03 |  |
| V1.2.3 | 1 | Injection Prevention | SR-WEB-03 |  |
| V1.2.4 | 1 | Injection Prevention | SR-INPUT-03 |  |
| V1.2.5 | 1 | Injection Prevention | SR-INPUT-04 |  |
| V1.2.6 | 2 | Injection Prevention | N/D — brak LDAP i katalogów usług. |  |
| V1.2.7 | 2 | Injection Prevention | N/D — brak XML i zapytań XPath. |  |
| V1.2.8 | 2 | Injection Prevention | N/D — brak procesorów LaTeX. |  |
| V1.2.9 | 2 | Injection Prevention | SR-INPUT-08 |  |
| V1.3.1 | 1 | Sanitization | SR-INPUT-05 |  |
| V1.3.2 | 1 | Sanitization | SR-INPUT-04 |  |
| V1.3.3 | 2 | Sanitization | SR-INPUT-05, SR-FILE-07 |  |
| V1.3.4 | 2 | Sanitization | SR-WEB-04 |  |
| V1.3.5 | 2 | Sanitization | SR-INPUT-05 |  |
| V1.3.6 | 2 | Sanitization | SR-API-13 |  |
| V1.3.7 | 2 | Sanitization | SR-INPUT-04, SR-INPUT-07 |  |
| V1.3.8 | 2 | Sanitization | N/D — brak Javy/JNDI (stack TypeScript). |  |
| V1.3.9 | 2 | Sanitization | N/D — brak memcache (cache tylko w pamięci procesu). |  |
| V1.3.10 | 2 | Sanitization | SR-INPUT-04 |  |
| V1.3.11 | 2 | Sanitization | SR-INPUT-07 |  |
| V1.4.1 | 2 | Memory, String, and Unmanaged Code | SR-FILE-06 | Kod aplikacji w TypeScript (pamięć zarządzana); natywne parsery (libvips, ffmpeg, ClamAV) tylko w piaskownicy. |
| V1.4.2 | 2 | Memory, String, and Unmanaged Code | SR-INPUT-01 |  |
| V1.4.3 | 2 | Memory, String, and Unmanaged Code | SR-FILE-06 | Jak wyżej. |
| V1.5.1 | 1 | Safe Deserialization | SR-INPUT-06 |  |
| V1.5.2 | 2 | Safe Deserialization | SR-INPUT-06 |  |
| V2.1.1 | 1 | Validation and Business Logic Documentation | SR-INPUT-01 |  |
| V2.1.2 | 2 | Validation and Business Logic Documentation | SR-INPUT-02 |  |
| V2.1.3 | 2 | Validation and Business Logic Documentation | SR-API-02 |  |
| V2.2.1 | 1 | Input Validation | SR-INPUT-01 |  |
| V2.2.2 | 1 | Input Validation | SR-INPUT-01 |  |
| V2.2.3 | 2 | Input Validation | SR-INPUT-02 |  |
| V2.3.1 | 1 | Business Logic Security | SR-API-07, SR-AUTHZ-10 |  |
| V2.3.2 | 2 | Business Logic Security | SR-API-02 |  |
| V2.3.3 | 2 | Business Logic Security | SR-API-06 |  |
| V2.3.4 | 2 | Business Logic Security | SR-API-07 |  |
| V2.4.1 | 2 | Anti-automation | SR-API-02, SR-FILE-09, SR-FILE-10, SR-SYNC-06 |  |
| V3.2.1 | 1 | Unintended Content Interpretation | SR-API-03, SR-WEB-04 |  |
| V3.2.2 | 1 | Unintended Content Interpretation | SR-WEB-03 |  |
| V3.3.1 | 1 | Cookie Setup | SR-SESS-01 |  |
| V3.3.2 | 2 | Cookie Setup | SR-SESS-01 |  |
| V3.3.3 | 2 | Cookie Setup | SR-SESS-01 |  |
| V3.3.4 | 2 | Cookie Setup | SR-SESS-01 |  |
| V3.4.1 | 1 | Browser Security Mechanism Headers | SR-WEB-02 |  |
| V3.4.2 | 1 | Browser Security Mechanism Headers | SR-API-03 |  |
| V3.4.3 | 2 | Browser Security Mechanism Headers | SR-WEB-01 |  |
| V3.4.4 | 2 | Browser Security Mechanism Headers | SR-API-03, SR-WEB-08 |  |
| V3.4.5 | 2 | Browser Security Mechanism Headers | SR-API-03, SR-WEB-08 |  |
| V3.4.6 | 2 | Browser Security Mechanism Headers | SR-WEB-01 |  |
| V3.5.1 | 1 | Browser Origin Separation | SR-SESS-10 |  |
| V3.5.2 | 1 | Browser Origin Separation | SR-SESS-10 | Nie polegamy na preflight CORS — ochrona CSRF przez `Origin`/`Sec-Fetch-Site` i token. |
| V3.5.3 | 1 | Browser Origin Separation | SR-SESS-10 |  |
| V3.5.4 | 2 | Browser Origin Separation | SR-WEB-04 | Pliki użytkowników z domeny bucketu; panel i API świadomie w jednym originie (ADR-0004). |
| V3.5.5 | 2 | Browser Origin Separation | SR-WEB-06 |  |
| V3.7.1 | 2 | Other Browser Security Considerations | SR-WEB-07 |  |
| V3.7.2 | 2 | Other Browser Security Considerations | SR-WEB-06 |  |
| V4.1.1 | 1 | Generic Web Service Security | SR-API-03 |  |
| V4.1.2 | 2 | Generic Web Service Security | SR-API-10 |  |
| V4.1.3 | 2 | Generic Web Service Security | SR-API-09 |  |
| V4.2.1 | 2 | HTTP Message Structure Validation | SR-API-11 |  |
| V4.3.1 | 2 | GraphQL | N/D — brak GraphQL (REST, ADR-0004); ponowna ocena przy zmianie stylu API. |  |
| V4.3.2 | 2 | GraphQL | N/D — brak GraphQL (REST, ADR-0004); ponowna ocena przy zmianie stylu API. |  |
| V4.4.1 | 1 | WebSocket | N/D — brak WebSocket w M1–M2 (push w E14 przez usługę systemową, nie WebSocket); ponowna ocena przy WebSocket. |  |
| V4.4.2 | 2 | WebSocket | N/D — brak WebSocket w M1–M2 (push w E14 przez usługę systemową, nie WebSocket); ponowna ocena przy WebSocket. |  |
| V4.4.3 | 2 | WebSocket | N/D — brak WebSocket w M1–M2 (push w E14 przez usługę systemową, nie WebSocket); ponowna ocena przy WebSocket. |  |
| V4.4.4 | 2 | WebSocket | N/D — brak WebSocket w M1–M2 (push w E14 przez usługę systemową, nie WebSocket); ponowna ocena przy WebSocket. |  |
| V5.1.1 | 2 | File Handling Documentation | SR-FILE-01 |  |
| V5.2.1 | 1 | File Upload and Content | SR-FILE-01, SR-FILE-02 |  |
| V5.2.2 | 1 | File Upload and Content | SR-FILE-03 |  |
| V5.2.3 | 2 | File Upload and Content | SR-FILE-04 |  |
| V5.3.1 | 1 | File Storage | SR-FILE-02 |  |
| V5.3.2 | 1 | File Storage | SR-FILE-02 |  |
| V5.4.1 | 2 | File Download | SR-FILE-07 |  |
| V5.4.2 | 2 | File Download | SR-FILE-07 |  |
| V5.4.3 | 2 | File Download | SR-FILE-05, SR-FILE-12 |  |
| V6.1.1 | 1 | Authentication Documentation | SR-AUTH-05 |  |
| V6.1.2 | 2 | Authentication Documentation | SR-AUTH-02 |  |
| V6.1.3 | 2 | Authentication Documentation | SR-AUTH-14 |  |
| V6.2.1 | 1 | Password Security | SR-AUTH-01 |  |
| V6.2.2 | 1 | Password Security | SR-AUTH-03 |  |
| V6.2.3 | 1 | Password Security | SR-AUTH-03 |  |
| V6.2.4 | 1 | Password Security | SR-AUTH-02 |  |
| V6.2.5 | 1 | Password Security | SR-AUTH-01 |  |
| V6.2.6 | 1 | Password Security | SR-AUTH-01 |  |
| V6.2.7 | 1 | Password Security | SR-AUTH-01 |  |
| V6.2.8 | 1 | Password Security | SR-AUTH-01 |  |
| V6.2.9 | 2 | Password Security | SR-AUTH-01 |  |
| V6.2.10 | 2 | Password Security | SR-AUTH-01 |  |
| V6.2.11 | 2 | Password Security | SR-AUTH-02 |  |
| V6.2.12 | 2 | Password Security | SR-AUTH-02 |  |
| V6.3.1 | 1 | General Authentication Security | SR-AUTH-05 |  |
| V6.3.2 | 1 | General Authentication Security | SR-AUTH-12 |  |
| V6.3.3 | 2 | General Authentication Security | SR-AUTH-06, SR-AUTH-09 | MFA obowiązkowe dla wszystkich ról — rekomendacja P1 (ADR-0005 wymaga tylko dla Administratora). |
| V6.3.4 | 2 | General Authentication Security | SR-AUTH-14, SR-AUTH-06 |  |
| V6.4.1 | 1 | Authentication Factor Lifecycle and Recovery | SR-AUTH-12, SR-AUTH-11 |  |
| V6.4.2 | 1 | Authentication Factor Lifecycle and Recovery | SR-AUTH-11 |  |
| V6.4.3 | 2 | Authentication Factor Lifecycle and Recovery | SR-AUTH-11 |  |
| V6.4.4 | 2 | Authentication Factor Lifecycle and Recovery | SR-AUTH-13 |  |
| V6.5.1 | 2 | General Multi-factor authentication requirements | SR-AUTH-07, SR-AUTH-08 |  |
| V6.5.2 | 2 | General Multi-factor authentication requirements | SR-AUTH-08 |  |
| V6.5.3 | 2 | General Multi-factor authentication requirements | SR-AUTH-07, SR-AUTH-08 |  |
| V6.5.4 | 2 | General Multi-factor authentication requirements | SR-AUTH-08 |  |
| V6.5.5 | 2 | General Multi-factor authentication requirements | SR-AUTH-07 |  |
| V6.6.1 | 2 | Out-of-Band authentication mechanisms | N/D — brak uwierzytelniania out-of-band (SMS, e-mail, push) — SR-AUTH-06 je wyklucza; reset hasła ma własne SR-AUTH-11. |  |
| V6.6.2 | 2 | Out-of-Band authentication mechanisms | N/D — brak uwierzytelniania out-of-band (SMS, e-mail, push) — SR-AUTH-06 je wyklucza; reset hasła ma własne SR-AUTH-11. |  |
| V6.6.3 | 2 | Out-of-Band authentication mechanisms | N/D — brak uwierzytelniania out-of-band (SMS, e-mail, push) — SR-AUTH-06 je wyklucza; reset hasła ma własne SR-AUTH-11. |  |
| V6.8.1 | 2 | Authentication with an Identity Provider | N/D — brak zewnętrznego IdP w MVP (ADR-0005); ponowna ocena przy planie wyjścia na IdP. |  |
| V6.8.2 | 2 | Authentication with an Identity Provider | N/D — brak zewnętrznego IdP w MVP (ADR-0005); ponowna ocena przy planie wyjścia na IdP. |  |
| V6.8.3 | 2 | Authentication with an Identity Provider | N/D — brak zewnętrznego IdP w MVP (ADR-0005); ponowna ocena przy planie wyjścia na IdP. |  |
| V6.8.4 | 2 | Authentication with an Identity Provider | N/D — brak zewnętrznego IdP w MVP (ADR-0005); ponowna ocena przy planie wyjścia na IdP. |  |
| V7.1.1 | 2 | Session Management Documentation | SR-SESS-03 |  |
| V7.1.2 | 2 | Session Management Documentation | SR-SESS-04 |  |
| V7.1.3 | 2 | Session Management Documentation | N/D — brak federacji i SSO (ADR-0005). |  |
| V7.2.1 | 1 | Fundamental Session Management Security | SR-SESS-01, SR-SESS-09 |  |
| V7.2.2 | 1 | Fundamental Session Management Security | SR-SESS-01, SR-SESS-09 |  |
| V7.2.3 | 1 | Fundamental Session Management Security | SR-SESS-01, SR-CRYPTO-03 |  |
| V7.2.4 | 1 | Fundamental Session Management Security | SR-SESS-02 |  |
| V7.3.1 | 2 | Session Timeout | SR-SESS-03, SR-SESS-09 |  |
| V7.3.2 | 2 | Session Timeout | SR-SESS-03, SR-SESS-09 |  |
| V7.4.1 | 1 | Session Termination | SR-SESS-05 |  |
| V7.4.2 | 1 | Session Termination | SR-SESS-06 |  |
| V7.4.3 | 2 | Session Termination | SR-AUTH-03 |  |
| V7.4.4 | 2 | Session Termination | SR-SESS-05 |  |
| V7.4.5 | 2 | Session Termination | SR-SESS-07 |  |
| V7.5.1 | 2 | Defenses Against Session Abuse | SR-AUTH-10 |  |
| V7.5.2 | 2 | Defenses Against Session Abuse | SR-SESS-07 |  |
| V7.6.1 | 2 | Federated Re-authentication | N/D — brak federacji i SSO (ADR-0005). |  |
| V7.6.2 | 2 | Federated Re-authentication | N/D — brak federacji i SSO (ADR-0005). |  |
| V8.1.1 | 1 | Authorization Documentation | SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-12 |  |
| V8.1.2 | 2 | Authorization Documentation | SR-AUTHZ-04 |  |
| V8.2.1 | 1 | General Authorization Design | SR-AUTHZ-01, SR-AUTHZ-10, SR-AUTHZ-12 |  |
| V8.2.2 | 1 | General Authorization Design | SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-08 |  |
| V8.2.3 | 2 | General Authorization Design | SR-AUTHZ-04, SR-AUTHZ-06 |  |
| V8.3.1 | 1 | Operation Level Authorization | SR-AUTHZ-01, SR-AUTHZ-12, SR-SYNC-01 |  |
| V8.4.1 | 2 | Other Authorization Considerations | N/D — system jednej firmy, bez wielodostępności; ponowna ocena przy portalu klienta i partnerach (M5). |  |
| V11.1.1 | 2 | Cryptographic Inventory and Documentation | SR-CRYPTO-04 |  |
| V11.1.2 | 2 | Cryptographic Inventory and Documentation | SR-CRYPTO-04 |  |
| V11.2.1 | 2 | Secure Cryptography Implementation | SR-CRYPTO-01 |  |
| V11.2.2 | 2 | Secure Cryptography Implementation | SR-CRYPTO-02, SR-AUTH-04 |  |
| V11.2.3 | 2 | Secure Cryptography Implementation | SR-CRYPTO-02 |  |
| V11.3.1 | 1 | Encryption Algorithms | SR-CRYPTO-01 |  |
| V11.3.2 | 1 | Encryption Algorithms | SR-CRYPTO-01 |  |
| V11.3.3 | 2 | Encryption Algorithms | SR-CRYPTO-02, SR-INFRA-07 | pgBackRest obsługuje tylko `aes-256-cbc`; integralność kopii bazy zapewniają object lock (niezmienne wersje) i sumy kontrolne manifestu — uwaga dla architekta. |
| V11.4.1 | 1 | Hashing and Hash-based Functions | SR-CRYPTO-01 | SHA-1 wyłącznie jako format protokołu k-anonimowości Pwned Passwords (nie do podpisów, MAC ani integralności). |
| V11.4.2 | 2 | Hashing and Hash-based Functions | SR-AUTH-04 |  |
| V11.4.3 | 2 | Hashing and Hash-based Functions | SR-CRYPTO-05 |  |
| V11.4.4 | 2 | Hashing and Hash-based Functions | SR-CRYPTO-06 |  |
| V11.5.1 | 2 | Random Values | SR-CRYPTO-03 |  |
| V11.6.1 | 2 | Public Key Cryptography | SR-CRYPTO-01, SR-AUTH-09 |  |
| V12.1.1 | 1 | General TLS Security Guidance | SR-COMM-01 |  |
| V12.1.2 | 2 | General TLS Security Guidance | SR-COMM-01 |  |
| V12.1.3 | 2 | General TLS Security Guidance | N/D — brak uwierzytelniania certyfikatem klienta (mTLS). |  |
| V12.2.1 | 1 | HTTPS Communication with External Facing Services | SR-COMM-01, SR-COMM-04 |  |
| V12.2.2 | 1 | HTTPS Communication with External Facing Services | SR-COMM-01 |  |
| V12.3.1 | 2 | General Service to Service Communication Security | SR-COMM-02, SR-COMM-03, SR-COMM-05 | Ruch wewnątrz jednej VM bez TLS — świadome odstępstwo (SR-COMM-03). |
| V12.3.2 | 2 | General Service to Service Communication Security | SR-COMM-02 |  |
| V12.3.3 | 2 | General Service to Service Communication Security | SR-COMM-03 | Jak wyżej — jedna VM, sieć Docker bez publikowanych portów. |
| V12.3.4 | 2 | General Service to Service Communication Security | SR-COMM-03 | Jak wyżej — przy rozdzieleniu hostów: wewnętrzny CA. |
| V13.1.1 | 2 | Configuration Documentation | SR-API-13 |  |
| V13.2.1 | 2 | Backend Communication Configuration | SR-INFRA-04 |  |
| V13.2.2 | 2 | Backend Communication Configuration | SR-INFRA-03, SR-FILE-06 |  |
| V13.2.3 | 2 | Backend Communication Configuration | SR-INFRA-04 |  |
| V13.2.4 | 2 | Backend Communication Configuration | SR-API-13 |  |
| V13.2.5 | 2 | Backend Communication Configuration | SR-API-13, SR-INFRA-01 |  |
| V13.3.1 | 2 | Secret Management | SR-INFRA-05 |  |
| V13.3.2 | 2 | Secret Management | SR-INFRA-05, SR-INFRA-03 |  |
| V13.4.1 | 1 | Unintended Information Leakage | SR-INFRA-06 |  |
| V13.4.2 | 2 | Unintended Information Leakage | SR-INFRA-06, SR-API-01 |  |
| V13.4.3 | 2 | Unintended Information Leakage | SR-INFRA-06 |  |
| V13.4.4 | 2 | Unintended Information Leakage | SR-API-10 |  |
| V13.4.5 | 2 | Unintended Information Leakage | SR-API-12 |  |
| V14.1.1 | 2 | Data Protection Documentation | SR-DATA-01 |  |
| V14.1.2 | 2 | Data Protection Documentation | SR-DATA-01 |  |
| V14.2.1 | 1 | General Data Protection | SR-API-04 |  |
| V14.2.2 | 2 | General Data Protection | SR-DATA-05, SR-API-03 |  |
| V14.2.3 | 2 | General Data Protection | SR-DATA-06, SR-PRIV-09 |  |
| V14.2.4 | 2 | General Data Protection | SR-DATA-04, SR-LOG-02, SR-DATA-07 |  |
| V14.3.1 | 1 | Client-side Data Protection | SR-SESS-05, SR-WEB-05 |  |
| V14.3.2 | 2 | Client-side Data Protection | SR-API-03 |  |
| V14.3.3 | 2 | Client-side Data Protection | SR-WEB-05 |  |
| V15.1.1 | 1 | Secure Coding and Architecture Documentation | SR-SUPPLY-02 |  |
| V15.1.2 | 2 | Secure Coding and Architecture Documentation | SR-SUPPLY-03, SR-SUPPLY-06 |  |
| V15.1.3 | 2 | Secure Coding and Architecture Documentation | SR-INFRA-11, SR-API-02 |  |
| V15.2.1 | 1 | Security Architecture and Dependencies | SR-SUPPLY-02, SR-SUPPLY-01, SR-SUPPLY-04 |  |
| V15.2.2 | 2 | Security Architecture and Dependencies | SR-INFRA-11, SR-FILE-06 |  |
| V15.2.3 | 2 | Security Architecture and Dependencies | SR-INFRA-06, SR-API-12 |  |
| V15.3.1 | 1 | Defensive Coding | SR-DATA-03, SR-SYNC-04 |  |
| V15.3.2 | 2 | Defensive Coding | SR-API-13 |  |
| V15.3.3 | 2 | Defensive Coding | SR-AUTHZ-04 |  |
| V15.3.4 | 2 | Defensive Coding | SR-API-09 |  |
| V15.3.5 | 2 | Defensive Coding | SR-INPUT-01 |  |
| V15.3.6 | 2 | Defensive Coding | SR-INPUT-06 |  |
| V15.3.7 | 2 | Defensive Coding | SR-INPUT-06 |  |
| V16.1.1 | 2 | Security Logging Documentation | SR-LOG-01 |  |
| V16.2.1 | 2 | General Logging | SR-LOG-03 |  |
| V16.2.2 | 2 | General Logging | SR-LOG-09, SR-LOG-03 |  |
| V16.2.3 | 2 | General Logging | SR-LOG-01 |  |
| V16.2.4 | 2 | General Logging | SR-LOG-01 |  |
| V16.2.5 | 2 | General Logging | SR-LOG-02 |  |
| V16.3.1 | 2 | Security Events | SR-LOG-03 |  |
| V16.3.2 | 2 | Security Events | SR-LOG-06, SR-LOG-03 |  |
| V16.3.3 | 2 | Security Events | SR-LOG-06, SR-LOG-03 |  |
| V16.3.4 | 2 | Security Events | SR-LOG-06 |  |
| V16.4.1 | 2 | Log Protection | SR-LOG-05 |  |
| V16.4.2 | 2 | Log Protection | SR-LOG-04 |  |
| V16.4.3 | 2 | Log Protection | SR-LOG-04 |  |
| V16.5.1 | 2 | Error Handling | SR-API-01 |  |
| V16.5.2 | 2 | Error Handling | SR-ERR-02 |  |
| V16.5.3 | 2 | Error Handling | SR-ERR-01, SR-API-06 |  |
