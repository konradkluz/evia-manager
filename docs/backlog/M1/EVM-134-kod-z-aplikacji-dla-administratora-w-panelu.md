---
id: EVM-134
title: Administrator w panelu — kod z aplikacji jako drugi krok (z ponownym kodem przed operacją wrażliwą)
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: done
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [security-engineer, code-reviewer]
model: opus            # uwierzytelnianie i uprawnienia (reguły drugiego kroku, okno step-upu); wykonawcy i przeglądy na opus — zaakceptowane przez Konrada 2026-11-16
depends_on: [EVM-023, EVM-026, EVM-027, EVM-028]
---

# EVM-134: Administrator w panelu — kod z aplikacji jako drugi krok (z ponownym kodem przed operacją wrażliwą)

## Cel
Jako **Administrator** chcę **logować się w panelu i potwierdzać operacje kodem z aplikacji uwierzytelniającej tak jak inne role**, aby **nie skanować kodu QR kluczem w telefonie przy każdym logowaniu i nie zależeć od zapisu klucza w Windows**.

Kontekst: dziś Administrator ma w panelu wyłącznie klucz dostępu (polityka P1, SR-AUTH-06, decyzja D3 z EVM-027). Konrad 2026-11-16: „chcę od razu wprowadzić dopuszczenie kodu z aplikacji dla administratora panelu”. Kierunek wybrany w **ADR-0023 (wariant A + K1)**; ocena ryzyka: `security-engineer`, 2026-11-16 (bez K1 6 High = blocker, z K1 i K2 4 Medium). Miejsca w kodzie i dokumentach — ADR-0023, „Kontekst” i „Miejsca do zmiany”.

## Kryteria akceptacji

**AC1 — Logowanie Administratora kodem**
- Zakładając, że Administrator ma aktywny kod (TOTP), sam klucz dostępu, albo oba, i podaje poprawne hasło w panelu
- Gdy przechodzi do drugiego kroku
- Wtedy konto z samym kodem loguje się kodem; z samym kluczem — kluczem (bez zmian); z oboma — wybiera metodę na ekranie drugiego kroku; zły lub użyty już kod jest odrzucany jak u Edytora (bez `403 forbidden` wynikającego z roli).

**AC2 — Pierwsza konfiguracja drugiego kroku**
- Zakładając, że Administrator aktywuje konto, albo konfiguruje drugi krok po resecie MFA lub po `bootstrap-admin --emergency`
- Gdy dochodzi do kroku konfiguracji
- Wtedy wybiera klucz dostępu albo kod z aplikacji (jak Edytor), a kody odzyskiwania są generowane i pokazywane bez zmian.

**AC3 — „Konto → Drugi krok logowania”**
- Zakładając, że jestem zalogowanym Administratorem z ponownym uwierzytelnieniem
- Gdy dodaję lub usuwam kod albo klucz
- Wtedy obie metody są dostępne; usunięcie ostatniej metody (decyzja pod blokadą wiersza konta, także przy dwóch równoległych usunięciach) kończy się `409 last_second_step_method`, a dowolna jedna metoda wystarcza (koniec wymogu „co najmniej jeden klucz”); zmiana roli użytkownika na Administratora nie wymaga już klucza po stronie tego użytkownika.

**AC4 — K1: logowanie kodem nie otwiera okna operacji wrażliwych**
- Zakładając, że Administrator zalogował się w panelu kodem
- Gdy wykonuje pierwszą operację wrażliwą (`stepUp: true`: m.in. zmiana ról, eksport, unieważnianie urządzeń i sesji, zmiana drugiego kroku, reset MFA innego użytkownika)
- Wtedy API zwraca `403 step_up_required`, a panel prosi o potwierdzenie; ten sam kod co przy logowaniu (ten sam krok czasu) jest odrzucany, nowy kod albo klucz dostępu otwiera okno 15 minut jak dotąd; po logowaniu kluczem i dla kodów odzyskiwania zachowanie bez zmian.

**AC5 — K2: limity i alerty na nowej ścieżce (testy dla roli Administrator)**
- Zakładając, że Administrator loguje się lub potwierdza operację kodem
- Gdy podaje kod użyty ponownie, zły kod wielokrotnie, albo konto jest zablokowane
- Wtedy działają dotychczasowe zabezpieczenia: 5 błędów na `loginToken` kończy próbę, 10 błędów daje blokadę 15 min z e-mailem, 5 błędnych kodów step-upu kończy sesję, powstaje alert `second_step_failure_spike`, a logowanie z nowej przeglądarki wysyła e-mail do właściciela i alert do Administratorów; macierz ról (Administrator / Edytor / Tylko odczyt / niezalogowany / token mobilny z `403 channel_not_allowed`) bez poluzowań.

**AC6 — Aplikacja mobilna i teksty**
- Zakładając, że Administrator ma aktywny kod
- Gdy loguje się w aplikacji mobilnej i gdy widzi komunikaty drugiego kroku w panelu i aplikacji
- Wtedy logowanie w aplikacji działa bez zmian kodu aplikacji (w tym dla Administratora, który dodał kod w panelu), a żaden komunikat ani opis w kontrakcie nie mówi już „klucz dostępu jest obowiązkowy dla Administratora” (lista tekstów: ADR-0023); kody `administrator_passkey_required` i `passkey_required` znikają z opisów i katalogu błędów, bez zmiany łamiącej kontraktu.

**AC7 — Dokumenty i rejestr ryzyk**
- Zakładając, że zmiana jest wdrożona w kodzie
- Gdy `security-engineer` aktualizuje dokumenty
- Wtedy SR-AUTH-06 i SR-AUTH-14, polityka P1, AB-02, TM-90, TM-11, RR-17, nowy RR-101 (z akceptacją Konrada i datą), DPIA D8 (tylko brzmienie mitygacji), runbook awaryjnego dostępu, `domain-model.md`, `api-guidelines.md` odpowiadają nowej regule, a ADR-0023 ma status „Zaakceptowana”; `npm run docs:check` bez błędów.

## Stany i dostępność
- Bez nowych komponentów i makiet: zmieniają się reguły i teksty istniejących ekranów (logowanie — drugi krok, konfiguracja drugiego kroku, „Konto → Drugi krok logowania”, okna step-upu i ponownego uwierzytelnienia).
- Stany: błąd (zły, użyty, wygasły kod; blokada), brak sieci, 200% czcionki, czytnik ekranu (etykiety i komunikaty błędów jak w istniejących ekranach kodu).
- Macierz ról: **Administrator** — zmiana opisana wyżej; **Edytor, Tylko odczyt** — bez zmian (test regresji); niezalogowany — bez zmian.

## Poza zakresem
- E-mail przy każdym logowaniu Administratora kodem (ADR-0023: odrzucone — szum).
- Zmiana reguł i kodu aplikacji mobilnej; funkcje administracyjne w kanale `mobile` (SR-AUTHZ-12).
- Naprawa zapisu klucza w Windows Hello.
- Uproszczenie kreatora pierwszego logowania (osobny temat do `/refine`).
- Przełącznik konfiguracyjny wymogu klucza (powrót = zmiana kodu, plan wyjścia w ADR-0023).
- Krótsza sesja Administratora; step-up kluczem wymuszany przy koncie z kluczem (wariant C).

## Decyzje i ograniczenia
- Decyzja Konrada 2026-11-16: dopuszczenie kodu z aplikacji dla Administratora panelu; ADR-0023, wariant **A + K1** (do akceptacji razem z historyjką).
- Scalenie = wdrożenie na jedyne środowisko (produkcja); **bez migracji danych** — istniejące konta i klucze działają bez zmian. Warunek przed wdrożeniem z planu wyjścia: każdy aktywny Administrator ma aktywny klucz (jedno zapytanie licznikowe).
- Ryzyko rezydualne RR-101: 4 Medium (phishing w czasie rzeczywistym; poziom jak RR-17) — akceptacja właściciela.
- **Bezpieczeństwo (blokery z noty):** K1 i K2 z testami dla roli Administrator; testy macierzy ról; reguła ostatniej metody pod blokadą wiersza; kody odzyskiwania bez okna step-upu jak dziś.

## Notatki
- Kolejność: API (reguły, K1, testy) → kontrakt i regeneracja → panel → dokumenty. Testy E2E panelu na Linuksie przed pushem (`docker compose -f compose.yaml run --rm web-e2e-linux`).
- Dużo plików testowych (API: `totp`, `account-domain`, `user-access-rules`, integracyjne `second-step-authz`, `account-second-step`, `users-access`, `sync-mutations`; web: `account-logic`, `account-operations`, `user-access`, `account-second-step`, makiety E2E) — lista w ADR-0023.
- Opcjonalnie (K3, K6): wskazówka o kluczu na stronie „Konto”, akapit w `wzory-dla-pracownikow.md` — nie są AC.
- DoD: `docs/process/definition-of-done.md` + przegląd `security-engineer` z listą wymagań z noty (blokery 1–4, major 5–8).
- **Rozstrzygnięcia Tech Leada z delegacji (kolejka 2026-11-16, do potwierdzenia przy demo):**
  1. `bootstrap-admin --emergency` usuwa także kod z aplikacji i unieważnia kody odzyskiwania (bez tego AC2 nie do spełnienia: `409 mfa_already_configured`, a kod z utraconego telefonu dalej logowałby do panelu) — opisane w runbooku i CHANGELOG.
  2. Baseline kontraktu zaktualizowany z `--allow-breaking ADR-0023`: narzędzie traktuje każdą zmianę `x-evia-authz` jako łamiącą; tu to dodanie roli `administrator` do `startTotpEnrolment` i `confirmTotp`. Baseline wchłonął też 5 odpowiedzi `426` operacji upload-session (były w źródle kontraktu od EVM-131 — baseline był nieaktualny) i przykład `passkey_required` → `method_required`. Dla klientów nic się nie łamie (QA, security, code-review).
  3. **AC5 — brzmienie do decyzji Konrada:** token aplikacji na operacjach panelu dostaje `401 unauthenticated` (operacje kanału web nie czytają tokenu Bearer — SR-AUTHZ-12), a `403 channel_not_allowed` z AC5 występuje przy logowaniu roli Tylko odczyt w telefonie i na operacjach dwukanałowych. Zachowanie sprzed EVM-134, ostrzejsze, pokryte testem; QA, security i code-review rekomendują poprawić brzmienie AC, nie kod. Opisy 9 operacji w kontrakcie, SR-AUTHZ-12 i `api-guidelines.md` opisują już stan faktyczny.
  4. Zmiana ponad AC (z przeglądu kodu, M3): w oknach potwierdzenia i ponownego uwierzytelnienia konto bez danej metody dostaje komunikat „Twoje konto nie ma kodu z aplikacji. Użyj klucza dostępu.” / „Twoje konto nie ma klucza dostępu. Wpisz kod z aplikacji.” zamiast ogólnego błędu serwera (API bez zmian).
  5. Wskazówka przy polu kodu w oknie potwierdzenia (tylko Administrator): „Wpisz nowy kod z aplikacji — ten sam kod nie zadziała drugi raz.”
- **Minor / nit z przeglądów — zostają (bez zmian w tej historyjce):** brak wskazówki o nowym kodzie w oknie ponownego uwierzytelnienia (dotyczy każdej roli, zachowanie sprzed zmiany); podpowiedź o resecie niepowiązana z polem kodu; różny układ okna potwierdzenia i ponownego uwierzytelnienia; jedyny Administrator widzi „poproś innego administratora”; konto z samym kluczem widzi pole kodu (komunikat z pkt 4 dopiero po wpisaniu); test kontraktu `second-step.test.ts:133` przejdzie przy pustym filtrze; brak testu „inna odmowa zostaje błędem serwera” dla okna ponownego uwierzytelnienia; test równoległego usunięcia metod nie dowodzi konieczności blokady (dowodem jest kod).
- **Do backlogu przez `/refine` (poza zakresem):** (a) **bezpieczeństwo, istnieje od EVM-028:** API ponownego uwierzytelnienia sprawdza hasło przed metodą — `401` przy złym haśle, `403` przy dobrym haśle i metodzie, której konto nie ma — osoba z przejętą sesją może sprawdzać poprawność hasła bez drugiego kroku (ok. 9 prób do blokady); propozycja: sprawdzać istnienie metody przed hasłem; (b) tryb awaryjny nie unieważnia oczekujących prób logowania i wyzwań ani zapamiętanych przeglądarek i urządzeń (fail-closed, obrona w głąb); (c) 42 operacje tylko-web mają w opisie kontraktu `403` dla tokenu aplikacji, faktycznie `401`; (d) `AlertDialog` nie zapętla Tab w Firefoksie; (e) K6 — akapit o kodzie z aplikacji w `wzory-dla-pracownikow.md`; ćwiczenie runbooka awaryjnego ścieżką z kodem; (f) wady układu z przeglądu UX: przycisk „Wyloguj telefon” wychodzi poza obrys, e-mail w tabeli użytkowników łamie się w środku słowa, okno resetu przy 360 px; (g) opis pierwszego kroku logowania w kontrakcie (`identity.yaml`, „konto z kluczem → `methods: [passkey]`”) nieaktualny od EVM-023.
- **Warunek przed scaleniem (wykonuje Konrad, RR-93):** zapytanie licznikowe z planu wyjścia ADR-0023 — każdy aktywny Administrator ma aktywny klucz.

## Decyzje Konrada (2026-11-16, „akceptuję wg rekomendacji”)
1. **A + K1** — po zalogowaniu kodem pierwsza operacja wrażliwa wymaga nowego kodu albo klucza dostępu: **tak**.
2. **RR-101** na poziomie 4 Medium (jak RR-17 dla Edytora): **zaakceptowane**, przegląd w 2027-02.
3. E-mail przy każdym logowaniu Administratora kodem: **nie** (alert o nowej przeglądarce wystarcza).
4. Model `opus` dla wykonawców i przeglądów: **tak**.

## Dziennik
- 2026-11-16 — utworzono na decyzję Konrada; ADR-0023 i nota security jako wejścia; status draft (product-owner)
- 2026-11-16 — Konrad zaakceptował treść i rekomendacje (A + K1, RR-101 Medium, bez e-maila, `opus`); ADR-0023 „Zaakceptowana”; realizacja w kolejce `/noc-2026-11-16`; **status `ready`** (Tech Lead)
- 2026-11-16 — start realizacji w kolejce `/noc-2026-11-16` (tor A, etapami: API → panel → dokumenty); **status `in-progress`** (Tech Lead)
- 2026-11-16 — implementacja etapami (kolejka `/noc-2026-11-16`, tor A): E1a API i kontrakt (`baa1e188`, `651c5867`, `ffbde5a5`), E1b testy limitów, alertów, macierzy ról i K1 po HTTP (`a06cb6e7`, `c93ad10a`), E2 panel (`e6800200`…`8a3d017a`), E3 dokumenty AC7 (`6c79ff08`), przepływy UX (`5d2cb3ec`); bez migracji, bez nowych zależności, `apps/mobile` bez zmian (backend-developer, web-developer, security-engineer, ux-designer)
- 2026-11-16 — QA (`qa-engineer`): **PASS z uwagami**, AC1–AC7 spełnione, raport `docs/qa/EVM-134/raport-qa.md`, 3 testy brzegowe K1 (`6ac09395`); przeglądy: UX **APPROVE z uwagami**, security **APPROVE z uwagami** (blokery 1–4 i major 5–8 z noty spełnione), code-review **APPROVE z uwagami** — bez ustaleń blocker i major
- 2026-11-17 — runda drobnych poprawek po przeglądach (`e6eb5f1a`, `c44f5320`, `722acb78`, `f9e4ec48`, `0ef4aa6c`): opisy step-upu i tokenu aplikacji w kontrakcie i dokumentach, komentarze, README, wzmocniona asercja alertu, teksty panelu, komunikat „konto nie ma metody”; ponowne przeglądy UX (32 zrzuty, 16 widoków × 360 i 1280 px) i kodu: **APPROVE z uwagami**, wszystkie ustalenia zamknięte
- 2026-11-17 — weryfikacja orkiestratora na głowie `0ef4aa6c` (wszystkie kody wyjścia 0): `web-e2e-linux` 1406 passed, 0 failed, 3 flaky (Firefox, specyfikacje niezwiązane), 21 skipped; `gate:backend` w kontenerze (API 1734 testy, kontrakt 315 + 2 pominięte); pełne `test:integration` 2744 passed, 7 skipped (193 pliki); `pnpm run gate` (68 zadań; web 2100 testów, mobile 1706, `gate:kotlin`, pokrycie zmienionego kodu — część natywna zielona; 17 plików zależnych od bazy liczy CI); `npm run test:tools`; `npm run docs:check` 0 błędów; `pnpm run scan` zielony (Semgrep 0 ustaleń, OSV 11 podatności nieblokujących, Trivy 1 ustalenie nieblokujące). Pełne pokrycie zmienionego kodu z częścią kontenerową — do potwierdzenia w CI (lokalna kolejność bramek wyczyściła raporty kontenera). Koszt subagentów (tokeny, narastająco): backend-developer ok. 485 tys., web-developer ok. 343 tys., security-engineer (E3 i poprawki) ok. 217 tys., qa-engineer ok. 186 tys., ux-designer ok. 251 tys., przegląd security ok. 214 tys., przegląd kodu ok. 268 tys. — razem ok. 1,96 mln. **Status `in-review`** (Tech Lead)
- 2026-11-17 — CI PR #147 zielone (jedno ponowienie `quality` po niestabilnym teście EVM-131 AC4, niezwiązanym); Konrad scalił PR #147 (squash, `08ca66a3`); **status `done`** (Tech Lead)
