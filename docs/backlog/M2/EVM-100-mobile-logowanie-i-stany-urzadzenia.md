---
id: EVM-100
title: "Aplikacja: logowanie (hasło + kod) i stany urządzenia"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: ready
priority: P0
path: pelna             # uwierzytelnianie, dane na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-009, EVM-090, EVM-094]
---

# EVM-100: Aplikacja — logowanie (hasło + kod) i stany urządzenia

## Cel
Jako **technik** chcę **zalogować się w aplikacji tym samym hasłem i kodem z aplikacji uwierzytelniającej co w panelu** i widzieć jasny komunikat, gdy telefon jest zablokowany lub wylogowany, aby **bezpiecznie korzystać z aplikacji w terenie**. Makiety: M-01, M-02 ([`01-logowanie-mfa.md`](../../ux/flows/01-logowanie-mfa.md)) z dopiskami z [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) („Uzupełnienia M-01, M-02, M-09”) — nowe ekrany nie są potrzebne.

## Kryteria akceptacji

**AC1 — Logowanie dwuetapowe**
- Zakładając telefon z siecią i aktywne konto Edytora lub Administratora z kodem z aplikacji uwierzytelniającej
- Gdy wpisuję e-mail i hasło (krok 1), a potem 6-cyfrowy kod (krok 2)
- Wtedy jestem zalogowany i przechodzę dalej (kontrole urządzenia i pierwsze pobranie danych — EVM-101, EVM-107; do tego czasu atrapa); hasło i kod są maskowane z „Pokaż”/„Ukryj”, kod można wkleić lub uzupełnić automatycznie (klawiatura numeryczna, bez autokorekty), link „Zmień konto” wraca do e-maila bez utraty wpisanego e-maila (hasło jest czyszczone), a „Nie pamiętasz hasła?” otwiera panel w przeglądarce; ekrany logowania mają `FLAG_SECURE` (w kompilacji produkcyjnej zawsze, wyłączony tylko flagą w kompilacjach testowych); token odświeżania trafia do bezpiecznego magazynu, token dostępu zostaje tylko w pamięci; tokeny są za portem `SessionOwner`/`TokenStore`; hasło i kod są czyszczone ze stanu po użyciu, a żądanie niesie opis urządzenia i sekret instalacji zgodnie z kontraktem EVM-090.

**AC2 — Błędy logowania**
- Zakładając złe dane, zły lub wygasły kod, blokadę (`429` z `Retry-After`) albo błąd serwera lub sieci
- Gdy próbuję się zalogować
- Wtedy widzę: dla złego e-maila/hasła „Nieprawidłowy e-mail lub hasło.” (jeden komunikat, bez ujawniania stanu konta); dla złego kodu „Kod jest nieprawidłowy albo wygasł. Wpisz nowy kod z aplikacji.” (wpisany e-mail zostaje); dla `429` „Zbyt wiele prób. Spróbuj ponownie za 4 min.” (czas z `Retry-After`, tekst odświeżany co minutę, przycisk wyłączony z widocznym powodem w tekście, nie tylko w podpowiedzi); dla `5xx`/błędu sieci „Nie udało się zalogować. Spróbuj ponownie za chwilę.”; komunikaty są ogłaszane czytnikowi ekranu, a hasła, kody i tokeny nie trafiają do logów ani raportów błędów (test redakcji).

**AC3 — Stany blokujące przed sesją (M-02)**
- Zakładając odpowiedź serwera: `403 channel_not_allowed` (Tylko odczyt, także gdy konto nie ma kodu z aplikacji), `403 totp_not_configured` (konto tylko z kluczem dostępu), `403 mfa_enrollment_required` (konto bez drugiego kroku, także z wygasłym oknem konfiguracji), `403 device_limit_reached` albo `426 client_version_unsupported`
- Gdy aplikacja ją odbiera
- Wtedy pokazuje właściwy wariant M-02 z tekstem z makiety (tytuł, treść, jedna akcja główna, drugorzędny link „Pomoc” otwierający M-11): „Aplikacja jest niedostępna dla Twojej roli…”, „Dodaj kod z aplikacji uwierzytelniającej”, „Skonfiguruj drugi krok logowania”, „Limit urządzeń” (z „Masz już 2 aktywne telefony…”) oraz „Aktualizacja wymagana” **bez odesłania do Google Play** (tekst „Poproś administratora o nową wersję aplikacji.”, akcje „Zobacz kolejkę” i „Pomoc”); telefon nie oferuje konfiguracji drugiego kroku; nie zapisuje tokenów ani danych zleceń, a kolejka niewysłanych elementów tego konta (jeśli istnieje) zostaje zaszyfrowana i pokazana tylko w podglądzie „Zobacz kolejkę” przy `426`.

**AC4 — Stany w trakcie sesji (M-02)**
- Zakładając zalogowany telefon i odpowiedź `401 session_revoked` (w tym wygaśnięcie po 14 dniach bezczynności lub 30 dniach) albo `401 device_wipe_required`
- Gdy aplikacja ją odbiera (przy odświeżeniu, synchronizacji lub starcie)
- Wtedy tokeny są usuwane, a ekran pokazuje: dla `session_revoked` „Wylogowano ten telefon. Dane zleceń usunęliśmy z telefonu. Niewysłane elementy (N) są zaszyfrowane w telefonie — wyślemy je, gdy zalogujesz się ponownie na to samo konto.” (wariant „Sesja wygasła. Zaloguj się ponownie…” dla wygaśnięcia), akcja „Zaloguj się”; replika zleceń jest usunięta, a kolejka i sekret instalacji zostają zaszyfrowane i niewidoczne do ponownego logowania tego samego konta (zachowanie EVM-093 AC7); dla `device_wipe_required` „Dane firmowe usunięte z telefonu…” (także niewysłane elementy), akcja „Zaloguj się” (nowe urządzenie), a sygnał czyszczenia jest przekazany portem do EVM-101 (samo czyszczenie nie jest w tej historyjce); liczba N pochodzi z lokalnej kolejki, a przy N = 0 zdanie o kolejce nie występuje.

**AC5 — Odświeżanie sesji**
- Zakładając wygasły token dostępu (ważny 15 min) i dwa równoległe żądania do API
- Gdy aplikacja wywołuje API
- Wtedy wykonuje jedno odświeżenie z rotacją tokenu (oba żądania czekają na ten sam wynik, bez drugiego odświeżenia), po czym ponawia żądania; odpowiedź `401 session_revoked`/`device_wipe_required` przy odświeżaniu prowadzi do AC4; po bezczynności > 14 dni lub wieku sesji > 30 dni użytkownik widzi wariant „Sesja wygasła” i musi zalogować się pełną ścieżką z AC1; błąd sieci przy odświeżaniu nie wylogowuje (ponowienie przy następnym żądaniu).

**AC6 — Offline**
- Zakładając brak sieci
- Gdy otwieram ekran logowania albo aplikację
- Wtedy przy logowaniu widzę baner „Brak zasięgu. Zalogujesz się, gdy wróci połączenie.”, przycisk jest wyłączony (powód w tekście), a wpisany e-mail zostaje; po powrocie sieci baner znika sam; już zalogowany użytkownik otwiera aplikację bez sieci bez żadnego żądania logowania lub odświeżenia blokującego start (stany wymagające odpowiedzi serwera z AC3–AC4 nie są wtedy pokazywane).

**AC7 — Wylogowanie (M-09)**
- Zakładając zalogowanego użytkownika (Administrator lub Edytor)
- Gdy wybieram „Wyloguj”
- Wtedy ostrzeżenie pokazuje liczbę niewysłanych elementów z akcją „Najpierw wyślij” (przy N = 0 zwykłe potwierdzenie) i dostępem do „Wyczyść dane firmowe” (przekazanie do EVM-101); po potwierdzeniu replika i tokeny są usunięte z telefonu (kolejka i sekret instalacji zostają zaszyfrowane), sesja na serwerze kończy się (`mobileLogout`) gdy jest sieć, a offline telefon zapisuje oczekujące odwołanie i wysyła je przy najbliższym połączeniu (zob. „Decyzje i ograniczenia”); kończy ekran M-02 z tytułem „Wylogowano” i informacją o niewysłanych elementach; ponowne uruchomienie aplikacji pokazuje M-01, nie dane.

**AC8 — Dostępność i język**
- Zakładając ekrany M-01 i M-02 w rozdzielczości 360 px, czcionce powiększonej do 200% i z TalkBack
- Gdy przechodzę logowanie i każdy wariant M-02
- Wtedy treści nie są ucięte (akcja główna przyklejona, reszta przewijana), fokus trafia na tytuł wariantu, pola mają etykiety i stany (maskowanie, „Pokaż”), cele dotykowe mają co najmniej `size.touch-target.field`, teksty pochodzą z i18n `pl`, a ekrany używają wyłącznie tokenów i komponentów biblioteki mobilnej.

## Role i dostęp
| Rola / stan | Zachowanie w aplikacji |
|---|---|
| Administrator | Loguje się jak Edytor (kod z aplikacji wymagany; klucz dostępu działa tylko w panelu). |
| Edytor | Pełna ścieżka AC1; konto bez kodu z aplikacji lub bez drugiego kroku → AC3. |
| Tylko odczyt | `403 channel_not_allowed` po poprawnym haśle (przed pytaniem o kod) → M-02 „Aplikacja niedostępna dla Twojej roli” (AC3). |
| Niezalogowany | Widzi wyłącznie M-01, M-02 i M-11 (Prywatność, Pomoc); wszystko inne wymaga sesji. |
| Urządzenie unieważnione / do wyczyszczenia | AC4. |

## Poza zakresem
Kontrole urządzenia (blokada ekranu, dialog „Usunąć dane poprzedniego konta?”, tryb ukrytych danych po 7 dniach, blokada aplikacji po 5 min) i czyszczenie danych (EVM-101); ekran M-12 i pierwsze pobranie (EVM-107); ekran M-11 (EVM-102 — tu tylko link „Pomoc”); logowanie kluczem dostępu; kod odzyskiwania; biometria; konfiguracja drugiego kroku z telefonu; reset hasła w aplikacji (link otwiera panel); „Zapamiętaj mnie”; podłączenie do realnego API (EVM-107) — AC testowane względem portu `AuthClient` z atrapą zgodną z kontraktem EVM-090.

## Decyzje i ograniczenia
- **Zależności zamknięte:** EVM-009 (szkielet), EVM-090 (kontrakt) i EVM-094 (API logowania mobilnego) są `done`. Atrapa `AuthClient` odtwarza kolejność błędów z EVM-094 AC3 (wersja → limit → hasło → drugi krok → kod → rola × kanał → limit urządzeń).
- **Decyzje z README planu M2 (obowiązują domyślnie, dopóki Konrad nie zdecyduje inaczej):** nr 5 — `FLAG_SECURE` na całym oknie w wydaniu, kompilacje testowe bez flagi; nr 10 — „Aktualizacja wymagana” mówi „poproś administratora o nową wersję” (bez Google Play, ADR-0019); nr 17 — jeden właściciel odświeżania tokenów po stronie natywnej (opcja (a) ADR-0020, adnotacja ADR-0020a). Niezależnie od rozstrzygnięcia nr 17 tokeny są za portem `SessionOwner`/`TokenStore`, żeby EVM-109 mógł przenieść właściciela bez zmian ekranów.
- **Oczekujące odwołanie sesji offline (AC7):** w telefonie po wylogowaniu zostaje wyłącznie token odświeżania w bezpiecznym magazynie, oznaczony „do odwołania” — nie służy do niczego poza wywołaniem wylogowania; po udanym `mobileLogout` jest usuwany, a bez sieci wygasa najpóźniej po 14 dniach bezczynności (limit serwera). Wymaga potwierdzenia `security-engineer` (przegląd tej historyjki).
- **Rozróżnienie „Wylogowano ten telefon” / „Sesja wygasła” (AC4):** aplikacja musi znać powód `401 session_revoked`. Jeśli kontrakt EVM-090 go nie niesie, poprawka kontraktu (pole z powodem) idzie do EVM-107/atrapy jako zgłoszenie; do tego czasu wariant „Sesja wygasła” wybierany jest wyłącznie przy odświeżaniu z ostatnim udanym kontaktem sprzed > 14 dni według zegara odpornego na manipulację z EVM-101.
- Logowanie wymaga zgodności z UX 16: baner offline, odliczanie 429 co minutę, `FLAG_SECURE` flagą debug.
- Po logowaniu następuje kontrola urządzenia (EVM-101) i M-12 (EVM-107).
- Test E2E Maestro na serwerze scenariuszy (wariant z i bez sieci); testy jednostkowe i komponentowe oznaczone `EVM-100 AC#`.

## Ryzyka
- **Konsultacja `ux-designer` (reviewer):** specyfikacja jest kompletna (M-01, M-02 z wszystkimi stanami: pusty, ładowanie, błąd, offline, brak uprawnień; dopiski w przepływie 16). Do sprawdzenia w przeglądzie: wariant „Sesja wygasła” (nowy wiersz tabeli stanów), tytuł „Wylogowano”, tekst „Aktualizacja wymagana” bez Google Play (otwarte pytanie UX nr 1) i wygląd baneru 429 na tle `color.bg.brand` (kontrast WCAG 2.2 AA).
- **`security-engineer`:** oczekujące odwołanie offline; `FLAG_SECURE` i jawność zrzutów w kompilacjach testowych; brak wycieku haseł/kodów do stanu, logów i raportów błędów; komunikat bez ujawniania stanu konta; kolejka po `session_revoked` (EVM-093 AC7).
- **`solution-architect`:** kto odświeża token w telefonie (decyzja nr 17, ADR-0020a) i powód unieważnienia sesji w kontrakcie.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
- 2026-10-29 — doprecyzowanie do DoR: zależności 090/094, podział AC3 na dwa (stany przed sesją / w trakcie sesji), konkretne teksty i wartości, macierz ról, AC dostępności, wpis oczekującego odwołania (product-owner)
- 2026-10-29 — zaakceptowano przez Konrada: AC1–8; wylogowanie offline z odwołaniem sesji po powrocie sieci; decyzje 5, 10, 17 z README M2 jak w rekomendacjach; dopuszczono drobny dodatek do kontraktu EVM-090 (powód unieważnienia sesji, bez podbicia wersji) z przeglądem architekta; status ready
