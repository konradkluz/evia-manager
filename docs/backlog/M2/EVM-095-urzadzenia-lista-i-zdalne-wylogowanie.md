---
id: EVM-095
title: "Urządzenia: lista, zdalne wylogowanie, „Zablokuj i wyczyść” (API + panel)"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: in-progress
priority: P1
path: pelna             # uwierzytelnianie, uprawnienia
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-094, EVM-029]
---

# EVM-095: Urządzenia — lista, zdalne wylogowanie, „Zablokuj i wyczyść”

## Cel
Jako **Administrator** (i **użytkownik** dla własnych telefonów) chcę **widzieć telefony, na których ktoś jest zalogowany, i je wylogować lub zablokować**, aby **zgubiony albo oddany telefon nie miał dostępu do danych** (SR-SESS-06/07). Makiety: W-15 (sekcja „Urządzenia”) i W-17 — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md).

## Kryteria akceptacji

**AC1 — Moje urządzenia (W-15)**
- Zakładając użytkownika z urządzeniami
- Gdy otwieram Konto → Urządzenia
- Wtedy widzę swoje telefony (model, system, wersja aplikacji, ostatni kontakt, stan) i mogę wylogować telefon po ponownym uwierzytelnieniu (step-up); sekcja jest ukryta dla roli Tylko odczyt, a cudzy identyfikator daje `404`.

**AC2 — Urządzenia użytkowników (W-17, Administrator)**
- Zakładając Administratora
- Gdy otwieram Administracja → Urządzenia (step-up przy wejściu; po „Anuluj” brak danych)
- Wtedy widzę urządzenia wszystkich użytkowników z ostatnim kontaktem, poziomem poprawek (gdy znany) i stanem (ikona + etykieta: Aktywne / Wylogowane / Czeka na wyczyszczenie / Wyczyszczone); Edytor i Tylko odczyt dostają `403` bez danych, a zakładka jest dla nich niewidoczna.

**AC3 — Wyloguj urządzenie**
- Zakładając urządzenie z ważną sesją
- Gdy wybieram „Wyloguj urządzenie”
- Wtedy następne żądanie z telefonu kończy się `401 session_revoked`, miejsce w limicie 2 urządzeń się zwalnia, a kolejka niewysłanych elementów na telefonie zostaje zaszyfrowana; komunikat mówi, że efekt nastąpi przy najbliższym połączeniu telefonu.

**AC4 — Zablokuj i wyczyść**
- Zakładając urządzenie użytkownika i ostatnio zgłoszoną liczbę niewysłanych elementów (`pendingItemsReported`, gdy telefon ją przekazał)
- Gdy Administrator wybiera „Zablokuj i wyczyść” — dialog pokazuje tę liczbę, ostrzega o utracie niewysłanych danych i wymaga wpisania nazwy modelu
- Wtedy następne żądanie telefonu daje `401 device_wipe_required`, stan to „Czeka na wyczyszczenie” do czasu potwierdzenia przez telefon (wtedy „Wyczyszczone”), a akcja trafia do dziennika audytu.

**AC5 — Zdarzenia konta**
- Zakładając dezaktywację konta, reset hasła, reset MFA albo zmianę roli
- Gdy zdarzenie ma miejsce
- Wtedy urządzenia są unieważnione zgodnie z tabelą M-02 (wylogowanie albo „wyczyść” przy dezaktywacji i roli Tylko odczyt); przed zmianą roli na Tylko odczyt Administrator widzi liczbę niewysłanych elementów urządzeń użytkownika; regresja EVM-027.

**AC6 — Uprawnienia i audyt**
- Zakładając wszystkie role oraz użytkownika próbującego działać na cudzym urządzeniu
- Gdy wywołują operacje na urządzeniach
- Wtedy operacje są dostępne tylko w kanale `web` (SR-SESS-08), użytkownik zarządza tylko własnymi (cudze → `404`), Administrator wszystkimi, każda akcja ma wpis audytu bez tokenów, a macierz ról obejmuje ten przypadek.

**AC7 — Retencja rekordu urządzenia**
- Zakładając urządzenie bez kontaktu od 90 dni
- Gdy działa zadanie retencji
- Wtedy rekord urządzenia jest usuwany (P2/P4), a wpisy audytu zostają.

## Poza zakresem
Zdalne wymuszenie aktualizacji; e-mail do użytkownika o „Zablokuj i wyczyść” (backlog); kolumna niewysłanych elementów w tabeli W-17 (tu tylko liczba w dialogu).

## Decyzje i ograniczenia
- Zgłaszanie liczby niewysłanych elementów przez telefon (`pendingItems`) wchodzi w M2 w wersji minimalnej (README planu, decyzja 9): pole w żądaniach synchronizacji (EVM-090), kolumna `Device` (EVM-094), wysyłanie z aplikacji (EVM-107), wyświetlenie tutaj. Alternatywa: odstępstwo od P2 z nowym RR.
- UX / UI: ekrany, stany, dialogi i mikrocopy — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (W-15, W-17); wariant StatusBadge dla stanu urządzenia to propozycja P-14 do styleguide'u (do czasu wpisu: tekst + ikona); wzorzec „potwierdź nazwą” w AlertDialog.
- Retencja (AC7, przegląd bezpieczeństwa 2026-11-02): 90 dni liczy się od późniejszego z ostatniego kontaktu i unieważnienia urządzenia (wylogowanie, „Zablokuj i wyczyść”, zdarzenie konta), żeby sygnał `device_wipe_required` nie znikał razem z rekordem; służy do tego kolumna `invalidated_at` (migracja 0064), a `last_contact_at` zostaje bez zmian.
- Bezpieczeństwo i prywatność: nazwa urządzenia = model z systemu (bez numeru seryjnego, IMEI, IP, lokalizacji).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
- 2026-11-01 — refinement: AC zaakceptowane przez Konrada, status `ready` (tor B nocy 1/2.11)
- 2026-11-02 — plan gotowy (backend-developer)
- 2026-11-02 — API i retencja gotowe, testy zielone w kontenerze (backend-developer); panel W-15/W-17 w osobnym kroku
- 2026-11-02 — panel W-15 (Urządzenia w Koncie), W-17 (Administracja → Urządzenia) i liczba telefonów przed zmianą roli na Tylko odczyt gotowe; testy komponentów, Playwright (Chromium, Firefox, Edge) i axe zielone (web-developer)
