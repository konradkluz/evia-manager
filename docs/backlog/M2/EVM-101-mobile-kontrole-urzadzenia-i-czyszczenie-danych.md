---
id: EVM-101
title: "Aplikacja: kontrole urządzenia, ukrycie danych po 7 dniach, wyczyszczenie danych"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: done
priority: P1
path: pelna             # dane na urządzeniu, uwierzytelnianie
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-100]
---

# EVM-101: Aplikacja — kontrole urządzenia i wyczyszczenie danych

## Cel
Jako **firma** chcemy, aby **dane klientów na telefonach były chronione nawet przy zgubionym lub zaniedbanym telefonie**, aby **spełnić wymagania SR-MOB-03/05/06/13 i polityki P2, P7**. Makieta: M-02 (stany), M-09.

## Kryteria akceptacji

**AC1 — Blokada ekranu**
- Zakładając telefon bez blokady ekranu
- Gdy się loguję, uruchamiam lub wznawiam aplikację → logowanie odrzucone z ekranem „Włącz blokadę ekranu”; gdy blokada zniknie w trakcie sesji → tryb ukrytych danych (aparat i Kolejka działają bez nazw, adresów, telefonów i treści wpisów).

**AC2 — 7 dni bez kontaktu**
- Zakładając brak udanego kontaktu z serwerem przez 7 dni (algorytm odporny na zegar z EVM-092 AC7; cofnięty zegar = dane ukryte)
- Gdy otwieram aplikację
- Wtedy dane zleceń są ukryte z komunikatem i akcją „Zaloguj się ponownie”, a aparat i Kolejka nadal działają (SR-MOB-05); od 5. dnia bez kontaktu na liście zleceń i w „Więcej” widać nieusuwalny baner „Telefon nie łączył się z serwerem od 5 dni. Za 2 dni ukryjemy dane zleceń…” (od 6. dnia „Jutro…”), znikający po kontakcie z serwerem.

**AC3 — Blokada aplikacji po 5 minutach w tle**
- Zakładając blokadę aplikacji (zawsze włączona, bez ustawienia do wyłączenia — decyzja 2026-11-01)
- Gdy wracam po > 5 min (czas w tle mierzony zegarem monotonicznym) lub aplikacja startuje zimno po zabiciu procesu
- Wtedy treść jest zasłonięta do odblokowania systemowym PIN-em lub biometrią (`BIOMETRIC_STRONG` lub poświadczenie urządzenia; wyłącznie bramka UI, nie wiąże kluczy — P7).

**AC4 — Wyczyść dane firmowe**
- Zakładając zalogowanego użytkownika
- Gdy wybieram „Wyczyść dane firmowe” w M-09 po potwierdzeniu z liczbą niewysłanych elementów
- Wtedy uruchamiane jest czyszczenie z EVM-093 AC6 (dane lokalne, tokeny, sekret instalacji, media, zadania natywne) odporne na przerwanie, a przy `device_wipe_required` czyszczenie następuje bez pytania i telefon potwierdza je serwerowi przy najbliższym kontakcie.

**AC5 — Inny użytkownik na instalacji**
- Zakładając dane innego konta na telefonie
- Gdy loguje się inny użytkownik
- Wtedy dialog informuje o liczbie niewysłanych elementów i usunięcie ich jest warunkiem logowania (SR-MOB-13); po anulowaniu nic nie jest usuwane.

**AC6 — Ostrzeżenie o poprawkach systemu**
- Zakładając poziom poprawek starszy niż 6 miesięcy
- Gdy otwieram listę zleceń
- Wtedy widzę nieblokujący baner „Rozumiem”; powyżej 12 miesięcy wariant wyraźniejszy.

**AC7 — Podgląd w „Ostatnich”**
- Zakładając kompilację wydania i aplikację z danymi osobowymi na ekranie
- Gdy przechodzę do tła lub otwieram przełącznik aplikacji
- Wtedy miniatura nie pokazuje klientów ani adresów (rekomendacja: `FLAG_SECURE` na całym oknie w wydaniu; minimum: ekrany z danymi osobowymi i wyłączony zrzut w „Ostatnich”); kompilacje testowe (Maestro, zrzuty QA) mają flagę wyłączoną, a test potwierdza, że wydanie ją ma.

**AC8 — Tryb ukrytych danych: akcje**
- Zakładając tryb ukrytych danych (AC1 lub AC2)
- Gdy otwieram arkusz „Dodaj”
- Wtedy „Wpis” i „Nowe zlecenie” są wyłączone z widocznym powodem („Dane zleceń są ukryte”), „Zdjęcie lub film” jest aktywne, a Kolejka nie pokazuje nazw, adresów ani treści wpisów.

## Poza zakresem
Usuwanie lokalnej bazy SQLCipher (port czyszczenia; podpina EVM-093/107); biometria wiążąca klucze; root detection; zdalne czyszczenie z panelu (EVM-095).

## Decyzje i ograniczenia
- Wartości 7 dni, 5 min, 6/12 miesięcy: ADR-0005, polityka P7.
- **Decyzje Konrada (2026-11-01):** `FLAG_SECURE` na całym oknie w wydaniu, kompilacje testowe bez flagi (decyzja 5 planu); telefony prywatne (BYOD) — kontrole z tej historyjki obowiązują w pełni, bez zależności od spisu floty (decyzja 4); blokada aplikacji zawsze włączona, technik nie może jej wyłączyć. Do wyrównania w docs: README planu (sformułowanie „firmowe”).
- Reguła 7 dni jest kontrolą kliencką ograniczającą ekspozycję (TM-03), nie granicą zaufania.
- UX / UI: ostrzeżenie dnia 5–6 i arkusz „Dodaj” w trybie ukrytym — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-05/M-09).

## Notatki
- Klawiatura w polach z danymi klienta: `IME_FLAG_NO_PERSONALIZED_LEARNING`.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
- 2026-11-01 — refinement: rozstrzygnięto FLAG_SECURE, BYOD i blokadę aplikacji (Konrad); AC zaakceptowane przez Konrada, status `ready`
- 2026-11-02 — plan gotowy (mobile-developer)
- 2026-11-02 — implementacja: `DeviceGuard`/`AppLock`/`CompanyDataWipe`, slot potwierdzenia czyszczenia (kontrakt `confirmDeviceWipe`), `ContactClock.status` w `sync-core`, `androidx.biometric:biometric:1.1.0`; blokada aplikacji liczy czas w tle zegarem rozruchowym (`elapsedRealtime`) i ściennym — `systemClock` dla `ContactClock` bez zmian do EVM-109 (zegar procesu; po restarcie zegar ścienny z kontrolami anomalii); AC bez zmian (mobile-developer)
- 2026-11-02 — poprawki rundy 1 (mobile-developer): czyszczenie nie emituje końca sesji (wynik `done` → „Wylogowano” bez zdania o niewysłanych, `incomplete` → dialog z ponowieniem); bez blokady ekranu nakładka blokady nie zasłania treści (komunikat „Włącz blokadę ekranu”, aparat i Kolejka dostępne); `ContactClock` na zegarze rozruchowym (`elapsedRealtime` + `Settings.Global.BOOT_COUNT`), brak modułu = dane ukryte (zastępuje wcześniejszą wzmiankę o EVM-109); odświeżenie sesji nie przywraca ukrytych danych — tylko pełne logowanie; ryzyko szczątkowe zmiany zegara ściennego przed restartem opisane w threat-model (do akceptacji Konrada); AC bez zmian
- 2026-11-12 — in-review → done: zaakceptowane przez Konrada i scalone 2026-11-02 (PR #125); status dopisany w gałęzi następnej pracy (orkiestrator)
- 2026-11-18 — poprawka AC3 po pierwszym użyciu na telefonie: okno odblokowania się nie pojawiało (brak `USE_BIOMETRIC` w manifeście przez listę blokowanych uprawnień z EVM-009), a przycisk „Odblokuj” był martwy przy niedokończonej prośbie; poprawka `5e118fa5` (uprawnienie, pytanie dopiero przy wznowionej aktywności, przycisk zawsze ponawia, limity czasu, komunikat); właściciel potwierdził odblokowanie na telefonie (Samsung, Android 13) 2026-11-18; zmieniona asercja EVM-009 AC6 (`USE_BIOMETRIC` nie jest już blokowane, weryfikator paczki je dopuszcza) — do akceptacji właściciela (mobile-developer)
- 2026-11-18 — runda po przeglądach poprawki AC3 (security i code-review: REQUEST CHANGES, wspólny błąd natywny): licznik 3 s „brak wznowionej aktywności” był uzbrajany po pokazaniu okna (`addObserver` odtwarza zdarzenia synchronicznie), więc okno otwarte dłużej niż 3 s kończyło się `not_resumed_timeout` — teraz uzbrajany przed obserwatorem i strzeżony warunkiem „okno jeszcze nie pokazane”; zastąpienie próby z otwartym oknem czeka na callback starego okna lub 500 ms, ON_DESTROY rozstrzyga próbę; `superseded` ciche, limit JS = 120 s z własnym kodem `js_timeout`; ekran blokady zapamiętuje prawdziwe przejście w tło także w trakcie prośby; `USE_FINGERPRINT` odblokowane dla Androida 7–8.1 (API 24–27, zmiana listy uprawnień do akceptacji właściciela); weryfikator paczki wymaga `USE_BIOMETRIC`.
- 2026-11-18 — weryfikacja i decyzje poprawki AC3 (Tech Lead): ponowny przegląd security rundy `d1109ede` — **APPROVE z uwagami** (fail-closed utrzymany; wszystkie ustalenia zamknięte). **Konrad na telefonie (Samsung SM-G781B, Android 13, paczka z `d1109ede`):** odblokowanie działa; okno otwarte ok. 5 s i dopiero kod — odblokowuje bez komunikatu; dwa szybkie naciśnięcia „Odblokuj” — okno działa; okno otwarte → Home → powrót — aplikacja sama prosi o odblokowanie. **Decyzje Konrada 2026-11-18:** akceptacja zmiany listy uprawnień — `USE_BIOMETRIC` i `USE_FINGERPRINT` nie są blokowane (zmieniona asercja EVM-009 AC6); weryfikator paczki wymaga `USE_BIOMETRIC`. Emulator (regresja domyślna, budowa z `d1109ede`): 63 zaliczone, 3 niezaliczone i 5 pominiętych w pierwszym przebiegu (dwa razy sterownik Maestro nie wystartował w czasie, raz aplikacja nie pokazała ekranu w 30 s po czystym starcie — przy maszynie obciążonej równoległymi testami panelu), powtórka tych trzech scenariuszy 9/9. **Niesprawdzone na urządzeniu:** Android 7–10 i inni producenci (w tym ścieżka `USE_FINGERPRINT`). **Do „Notatek” (minor z przeglądów):** na Androidzie ≤ 9 po anulowaniu okna z kodem aplikacja może sama poprosić jeszcze raz; w rzadkiej kolejności zdarzeń po powrocie z tła brak automatycznej prośby (przycisk działa); spóźnione anulowanie starego okna po limicie 500 ms może dać ciche `cancelled`; weryfikator nie sprawdza `maxSdkVersion` przy uprawnieniu. **Osobne ustalenie security (poza tą poprawką, decyzja Konrada):** przy zablokowanej aplikacji treść pod nakładką jest nadal wyrenderowana i czytelna dla adb oraz usług ułatwień dostępu z dostępem do widoków „nieistotnych” (czytnik ekranu i zrzuty są zablokowane) — rekomendacja: osobna historyjka przed szerszym wdrożeniem dla techników. Status historyjki bez zmian (`done`).
