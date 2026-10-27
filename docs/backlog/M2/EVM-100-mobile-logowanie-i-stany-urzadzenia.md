---
id: EVM-100
title: "Aplikacja: logowanie (hasło + kod) i stany urządzenia"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: draft
priority: P0
path: pelna             # uwierzytelnianie, dane na urządzeniu
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-009]
---

# EVM-100: Aplikacja — logowanie (hasło + kod) i stany urządzenia

## Cel
Jako **technik** chcę **zalogować się w aplikacji tym samym hasłem i kodem z aplikacji uwierzytelniającej co w panelu** i widzieć jasny komunikat, gdy telefon jest zablokowany lub wylogowany, aby **bezpiecznie korzystać z aplikacji w terenie**. Makiety: M-01, M-02 ([`01-logowanie-mfa.md`](../../ux/flows/01-logowanie-mfa.md)).

## Kryteria akceptacji

**AC1 — Logowanie dwuetapowe**
- Zakładając telefon z siecią i aktywne konto Edytora lub Administratora
- Gdy wpisuję e-mail i hasło, a potem kod
- Wtedy jestem zalogowany; pola hasła i kodu są maskowane z „Pokaż” (kod można wkleić lub uzupełnić automatycznie, z linkiem „Zmień konto” bez utraty e-maila), ekrany logowania mają `FLAG_SECURE` (wyłączone tylko w kompilacjach testowych), token odświeżania trafia do bezpiecznego magazynu (token dostępu tylko w pamięci), tokeny są za portem `SessionOwner`/`TokenStore`, a dane logowania są czyszczone ze stanu po użyciu.

**AC2 — Błędy logowania**
- Zakładając złe dane, blokadę (`429` z `Retry-After`) lub błąd serwera
- Gdy próbuję się zalogować
- Wtedy widzę jeden komunikat dla złych danych (bez ujawniania stanu konta), odliczanie przy blokadzie (przycisk wyłączony z widocznym powodem) lub „Nie udało się zalogować. Spróbuj ponownie za chwilę.”; dane nie są logowane.

**AC3 — Stany M-02**
- Zakładając odpowiedzi serwera: rola Tylko odczyt (`403 channel_not_allowed`), konto bez kodu z aplikacji, konto bez drugiego kroku, limit urządzeń, `401 session_revoked`, `401 device_wipe_required`, `426`
- Gdy aplikacja je odbiera
- Wtedy pokazuje właściwy wariant ekranu M-02 z tekstem, jedną akcją główną i linkiem „Pomoc” (w tym „Aktualizacja wymagana” bez odesłania do Google Play oraz „Sesja wygasła” po 14/30 dniach); po `session_revoked` dane zleceń są usunięte z telefonu („Dane zleceń usunęliśmy z telefonu”), a kolejka niewysłanych elementów zostaje zaszyfrowana i niewidoczna do ponownego logowania tego samego konta, po `device_wipe_required` sygnał czyszczenia trafia do EVM-101.

**AC4 — Odświeżanie sesji**
- Zakładając wygasły token dostępu
- Gdy aplikacja wywołuje API
- Wtedy odświeża sesję jednym żądaniem (rotacja), a po bezczynności > 14 dni lub 30 dniach wymaga pełnego logowania; dwa równoległe żądania nie powodują dwóch odświeżeń.

**AC5 — Offline**
- Zakładając brak sieci
- Gdy otwieram ekran logowania
- Wtedy widzę baner „Brak zasięgu. Zalogujesz się, gdy wróci połączenie.”, a przycisk jest wyłączony; już zalogowany użytkownik otwiera aplikację bez sieci.

**AC6 — Wylogowanie**
- Zakładając zalogowanego użytkownika
- Gdy wybieram „Wyloguj” (M-09)
- Wtedy ostrzeżenie pokazuje liczbę niewysłanych elementów z akcją „Najpierw wyślij” i dostępem do „Wyczyść dane firmowe”; po potwierdzeniu replika i tokeny są usunięte z telefonu (kolejka i sekret instalacji zostają), a sesja na serwerze kończy się, gdy jest sieć — offline telefon zapisuje oczekujące odwołanie i wysyła je przy najbliższym połączeniu; ekran M-02 ma tytuł „Wylogowano” i informuje o niewysłanych elementach.

## Poza zakresem
Kontrole urządzenia i czyszczenie danych (EVM-101); logowanie kluczem dostępu; reset hasła w aplikacji (link otwiera panel); podłączenie do realnego API (EVM-107) — AC testowane względem portu `AuthClient` z atrapą zgodną z EVM-090.

## Decyzje i ograniczenia
- **Start wymaga akceptacji EVM-009** (szkielet aplikacji jest `in-review`, nie `done`) — warunek DoR dla toru C.
- **Przed `ready`:** decyzja o właścicielu odświeżania tokenów (rekomendacja: jeden właściciel natywny, adnotacja ADR-0020a) — tokeny za portem, żeby EVM-109 przeniósł właściciela bez zmiany ekranów; decyzja o `FLAG_SECURE` na całym oknie w wydaniu (README planu, decyzja 5).
- UX / UI: dopiski do M-01 i M-02 (teksty 429/5xx, wariant „Sesja wygasła”, tytuł „Wylogowano”, link „Pomoc”, `FLAG_SECURE` wyłączony w buildach testowych) — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md); po logowaniu następuje M-12 (EVM-107).
- Brak „Zapamiętaj mnie” (sesję utrzymuje token odświeżania).
- Teksty przez i18n `pl`; tylko tokeny i komponenty biblioteki mobilnej; test Maestro na serwerze scenariuszy.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
