---
id: EVM-134
title: Administrator w panelu — kod z aplikacji jako drugi krok (z ponownym kodem przed operacją wrażliwą)
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: in-progress
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

## Decyzje Konrada (2026-11-16, „akceptuję wg rekomendacji”)
1. **A + K1** — po zalogowaniu kodem pierwsza operacja wrażliwa wymaga nowego kodu albo klucza dostępu: **tak**.
2. **RR-101** na poziomie 4 Medium (jak RR-17 dla Edytora): **zaakceptowane**, przegląd w 2027-02.
3. E-mail przy każdym logowaniu Administratora kodem: **nie** (alert o nowej przeglądarce wystarcza).
4. Model `opus` dla wykonawców i przeglądów: **tak**.

## Dziennik
- 2026-11-16 — utworzono na decyzję Konrada; ADR-0023 i nota security jako wejścia; status draft (product-owner)
- 2026-11-16 — Konrad zaakceptował treść i rekomendacje (A + K1, RR-101 Medium, bez e-maila, `opus`); ADR-0023 „Zaakceptowana”; realizacja w kolejce `/noc-2026-11-16`; **status `ready`** (Tech Lead)
- 2026-11-16 — start realizacji w kolejce `/noc-2026-11-16` (tor A, etapami: API → panel → dokumenty); **status `in-progress`** (Tech Lead)
