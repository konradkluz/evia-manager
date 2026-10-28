---
id: EVM-094
title: "API: logowanie mobilne i rejestr urządzeń"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: in-progress
priority: P0
path: pelna             # uwierzytelnianie, urządzenia, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-090]
---

# EVM-094: API — logowanie mobilne i rejestr urządzeń

## Cel
Jako **Edytor lub Administrator** chcę **zalogować się w aplikacji tym samym kontem i drugim krokiem co w panelu**, aby **telefon firmowy miał własną, odwoływalną sesję**. Dziś API zna tylko sesje cookie panelu; ADR-0005 wymaga dla telefonu tokenu dostępu (15 min) i rotowanego tokenu odświeżania oraz rejestru urządzeń (`Device`). Makiety: M-01, M-02. Operacje i ścieżki: EVM-090.

## Kryteria akceptacji

**AC1 — Logowanie dwuetapowe i rejestracja urządzenia**
- Zakładając aktywne konto Edytora lub Administratora z kodem z aplikacji uwierzytelniającej
- Gdy loguję się z telefonu (hasło, potem kod; opis urządzenia: model, system, poprawki, platforma, wersja aplikacji)
- Wtedy krok pośredni zwraca token wyzwania (256 bit, jednorazowy, TTL ≤ 5 min, związany z urządzeniem z kroku 1; 5 złych kodów go unieważnia), po kodzie dostaję token dostępu (15 min, nieprzezroczysty) i token odświeżania, a serwer zapisuje `Device` z własnym `deviceId` (ostatni kontakt, wersja, poprawki, ostatnio zgłoszona liczba niewysłanych elementów); `user_id` i `device_id` w dalszych żądaniach pochodzą wyłącznie z sesji.

**AC2 — Ta sama instalacja, limit urządzeń**
- Zakładając użytkownika z 2 aktywnymi urządzeniami
- Gdy loguje się ponownie na tej samej instalacji (para `deviceId` + sekret, porównanie stałoczasowe) → wraca do tego samego urządzenia bez zajmowania miejsca, a sekret jest rotowany; brak lub niezgodność sekretu → nowe urządzenie i audyt; gdy loguje się trzeci telefon → `403 device_limit_reached` z pouczeniem, jak zwolnić miejsce (SR-SESS-04), zwracany dopiero po poprawnym drugim kroku
- Wtedy znane urządzenie ma własny licznik blokady (blokada z obcych klientów nie wyłącza telefonu technika), analogicznie do `__Host-evia_device` z EVM-026.

**AC3 — Rola, kanał i kolejność sprawdzeń**
- Zakładając konto z rolą Tylko odczyt, konto bez kodu z aplikacji (tylko klucz dostępu) i konto bez drugiego kroku
- Gdy podają poprawne hasło
- Wtedy kolejność jest: wersja klienta → limit IP i konta → hasło (jedna odpowiedź `401 invalid_credentials` jak dla nieistniejącego konta) → rola × kanał (`403 channel_not_allowed`) → drugi krok skonfigurowany (`403 totp_not_configured` / `403 mfa_enrollment_required`); token mobilny nie działa na operacjach panelu, sesja panelu nie działa na operacjach mobilnych (poświadczenie „nie tego” kanału jest ignorowane i niczego nie ustawia w `Set-Cookie`).

**AC4 — Rotacja tokenu odświeżania**
- Zakładając ważny token odświeżania (256 bit z CSPRNG, w bazie tylko skrót)
- Gdy go używam
- Wtedy zużycie jest jedną transakcją z blokadą wiersza i porównaniem stałoczasowym, dostaję nowy, a stary przestaje działać (okno tolerancji 30 s tylko dla bezpośredniego poprzednika — SR-SESS-09); użycie już unieważnionego tokenu kończy sesję („Wyloguj urządzenie”, urządzenie zostaje zarejestrowane), zapisuje audyt (IP/ASN, bez tokenów) i alert do Administratorów; stan sesji i urządzenia jest sprawdzany przy każdym żądaniu, więc unieważnienie działa natychmiast; bezczynność > 14 dni lub wiek > 30 dni wymaga pełnego logowania, a 30 dni bez kontaktu kończy sesje urządzenia (P2).

**AC5 — Ochrona przed zgadywaniem i powiadomienie**
- Zakładając limity z EVM-026
- Gdy ktoś zgaduje hasło lub kod z telefonu
- Wtedy obowiązują te same blokady i `429` z `Retry-After`; udane logowanie z nowego urządzenia wysyła powiadomienie e-mail do użytkownika (SR-AUTH-15).

**AC6 — Wersja aplikacji**
- Zakładając minimalną wspieraną wersję wyższą niż wersja klienta
- Gdy telefon loguje się lub odświeża sesję
- Wtedy dostaje `426 client_version_unsupported` (przy logowaniu przed kosztownym haszowaniem hasła) bez unieważniania sesji.

**AC7 — Stan urządzenia: czyszczenie i potwierdzenie**
- Zakładając urządzenie oznaczone do wyczyszczenia (EVM-095) i operację potwierdzenia z EVM-090
- Gdy telefon próbuje się zalogować z sekretem takiego urządzenia, odświeżyć sesję albo potwierdza wyczyszczenie
- Wtedy dostaje `401 device_wipe_required` już przed sprawdzeniem hasła, a po potwierdzeniu stan urządzenia zmienia się na „Wyczyszczone”; wszystkie odpowiedzi auth mają `Cache-Control: no-store`.

**AC8 — Macierz ról, audyt i logi**
- Zakładając wszystkie role oraz niezalogowanego
- Gdy wywołują każdą nową operację
- Wtedy deny-by-default; test macierzy ról; zdarzenia logowania, odmowy i odświeżenia w dzienniku audytu bez haseł i tokenów; logger redaguje `password`, `totp`, `challengeToken`, `refreshToken`, `accessToken`, `installationSecret` (test redakcji, SR-LOG-02).

## Poza zakresem
Lista i zdalne wylogowanie urządzeń (EVM-095); ekrany aplikacji (EVM-100); biometria; reset hasła z telefonu (otwiera panel); powiązanie tokenu odświeżania z kluczem urządzenia (PoP — backlog po EVM-109); kod odzyskiwania i klucz dostępu w aplikacji (SR-AUTH-14).

## Decyzje i ograniczenia
- Ścieżki i kody według EVM-090. **Przed `ready`:** decyzja o właścicielu odświeżania tokenów po stronie telefonu (rekomendacja: jeden właściciel natywny — adnotacja ADR-0020a, aktualizacja SR-SESS-09) oraz o refresh tokenie bez powiązania z urządzeniem (rekomendacja: nowe RR na M2 + kompensacje z AC4; README planu, decyzje 17 i 8).
- Regresja: EVM-026, EVM-027, EVM-028 (punkty „od E9”: SR-SESS-04, SR-AUTH-11/13/15, SR-SESS-06). Nowe tabele `devices`, `access_tokens`, `refresh_tokens` i rozszerzenie sesji o `device_id` w schemacie `identity`, migracje w stylu expand.
- Bezpieczeństwo i prywatność: sekret instalacji nie jest czynnikiem uwierzytelnienia, tylko przypina `deviceId` po haśle i kodzie.
- Sekret instalacji (kontrakt EVM-090, runda 3): porównanie w STAŁYM CZASIE także dla nieznanego `deviceId` (porównanie z wartością zastępczą o tej samej długości, bez gałęzi czasowej zdradzającej istnienie urządzenia) — dotyczy `mobileLogin`, `mobileLoginTotp` i `confirmDeviceWipe`. Rotacja dwufazowa (AC2): poprzedni sekret ważny najpóźniej po czasie życia tokenu odświeżania (≤ 7 dni), najwyżej dwa ważne sekrety (wydany, a nieudowodniony sekret przestaje działać po wydaniu następnego), oba unieważniane po potwierdzeniu wyczyszczenia, usunięciu urządzenia i dezaktywacji konta; `confirmDeviceWipe` przyjmuje bieżący albo poprzedni sekret. Do potwierdzenia przez Konrada razem z AC2.

- **Decyzje wykonawcze (backend-developer, 2026-10-28; zmieniają lub doprecyzowują AC — do potwierdzenia przez Konrada razem z decyzjami 8, 9, 17):**
  - AC3 — kolejność: `403 channel_not_allowed` (Tylko odczyt) wraca dopiero po POPRAWNYM kodzie TOTP (kontrakt EVM-090, runda 3), nie po samym haśle — poprawne hasło nie ujawnia roli ani stanu urządzeń; `totp_not_configured` / `mfa_enrollment_required` po poprawnym haśle, przed wyzwaniem. Tekst AC3 („hasło → rola × kanał → drugi krok”) do korekty zgodnie z kontraktem.
  - AC2 — rotacja DWUFAZOWA sekretu instalacji przyjęta warunkowo (alternatywa: brak rotacji + RR-NOC-T4-3); „aktywne” urządzenie = stan `active` z ważną sesją mobilną (wyczyszczone, do wyczyszczenia i bez ważnej sesji nie zajmują miejsca); limit liczony pod blokadą wiersza konta; urządzenie rozpoznane, które nie ma ważnej sesji, też podlega limitowi (inaczej logowanie "na znane" omijałoby 2).
  - AC1 — `pendingItemsReported` (decyzja 9): kolumna istnieje (0–10000, domyślnie 0), ale kontrakt logowania nie niesie tego pola — zapisem zajmie się synchronizacja (EVM-098); nie jest używane do żadnej decyzji.
  - AC4 — audyt odświeżeń: IP wg istniejącego kontekstu zdarzenia (prefiks /24, /48); ASN poza M2 (brak lokalnej bazy ASN, zewnętrzny lookup wysyłałby IP poza UE) — do backlogu. Token odświeżania bez powiązania z Keystore: RR-NOC-T4-2 (numery końcowe nada security).
  - AC4 — wyczyszczenie ma pierwszeństwo przed `session_revoked` także dla tokenu dostępu, dopóki jego wiersz istnieje (wygasłe tokeny dostępu są czyszczone po dobie).
  - AC5 — znane urządzenie ma licznik `browser` (para `deviceId` + sekret zgodna z urządzeniem TEGO konta w stanie `active`); inne pary liczą się na koncie; skradziony telefon z sekretem ma więc drugą pulę prób hasła (ten sam kompromis co RR-28 — RR-NOC-T4-4, numer nada security). Wspólny limit 20/min/IP obejmuje oba kroki, odświeżenie i potwierdzenie wyczyszczenia.
  - Konfiguracja i zależności — brak nowych zmiennych środowiskowych (progi i czasy jako stałe domeny) i zależności.

## Notatki
- Prefiks tokenu odświeżania (np. `evia_rt_`) pod skanery sekretów; rejestr IP/ASN odświeżeń w audycie.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-27 — status ready warunkowo (Tech Lead, polecenie Konrada: decyzje po uruchomieniu torów): przyjęte rekomendowane domyślne decyzje 8, 9 i 17 z README M2 (refresh token bez powiązania z Keystore + RR, pendingItemsReported minimalnie, właściciel odświeżania tokenów po stronie natywnej za portem SessionOwner); ADR-0020a w osobnym kroku; Konrad potwierdza lub zmienia
- 2026-10-28 — EVM-090 gotowa na gałęzi (3 rundy poprawek); start realizacji (nocna kolejka, tor T4), gałąź feature/EVM-090-094-kontrakt-logowanie-mobilne
- 2026-10-28 — plan gotowy (backend-developer)
- 2026-10-28 — implementacja gotowa lokalnie: sześć operacji kanału mobile z trasami, migracje 0050–0052, testy AC1–AC8; bramka lokalna zielona; do potwierdzenia: korekta AC3 (kolejność), rotacja dwufazowa, baseline kontraktu przesunięty pod ADR-0021 (backend-developer)
