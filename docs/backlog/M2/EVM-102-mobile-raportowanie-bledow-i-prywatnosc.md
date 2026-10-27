---
id: EVM-102
title: "Aplikacja: raportowanie błędów bez danych osobowych i ekran prywatności"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
priority: P2
path: pelna             # dane osobowe w logach, nowa zależność
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-009, EVM-063]
---

# EVM-102: Aplikacja — raportowanie błędów bez danych osobowych i ekran prywatności

## Cel
Jako **zespół** chcemy **dowiadywać się o awariach aplikacji w terenie bez zbierania danych klientów**, a **użytkownik** chce **widzieć klauzulę informacyjną i wersję aplikacji**, aby **spełnić SR-MOB-12 i RODO**. Makieta M-11 jest w przepływie 16 (patrz „Decyzje i ograniczenia”). Konto raportowania (Sentry UE) już istnieje (ADR-0013).

## Kryteria akceptacji

**AC1 — Raport awarii bez danych osobowych**
- Zakładając skonfigurowany adres raportowania
- Gdy aplikacja ulega awarii lub zgłasza błąd
- Wtedy raport zawiera wersję aplikacji, system, kod błędu i identyfikatory techniczne, a nie zawiera e-maila, nazwisk, adresów, telefonów, treści wpisów, zapytań wyszukiwania, schowka ani adresów z identyfikatorami; filtrowanie działa jako **lista dozwolonych pól** w obu hakach (zdarzenia i breadcrumby), `sendDefaultPii` jest wyłączone, brak breadcrumbów konsoli, breadcrumby HTTP bez query i ciał, bez przechwytywania nieudanych żądań, próbkowanie śladów 0, bez danych użytkownika (najwyżej techniczny identyfikator), komunikaty błędów domenowych zastąpione kodami; awarie natywne (Kotlin/NDK) przechodzą przez natywny hak tego samego filtra i bez minidumpów z pamięcią (test na zestawie syntetycznych danych osobowych ścieżką JavaScript i natywną).

**AC2 — Bez śledzenia ekranu**
- Zakładając konfigurację raportowania
- Gdy sprawdzam paczkę
- Wtedy brak zrzutów ekranu, hierarchii widoków, nagrywania sesji, identyfikatorów reklamowych i SDK analitycznych (test `tools/mobile-apk verify`); mapy źródeł nie wymagają sekretu w CI.

**AC3 — Brak konfiguracji**
- Zakładając brak adresu raportowania (lokalnie, CI, testy)
- Gdy aplikacja działa
- Wtedy raportowanie jest wyłączone, nic nie jest wysyłane, a aplikacja działa bez błędów.

**AC4 — Prywatność i pomoc (M-11)**
- Zakładając ekran „Więcej”
- Gdy otwieram „Prywatność i pomoc”
- Wtedy widzę (także offline, przed zalogowaniem i w każdym wariancie M-02 — wejścia z M-01, M-02, M-09, kotwice `#pomoc` i `#prywatnosc`) trzy klauzule jako rozwijane sekcje z wersją i datą (treść z EVM-063, spakowana w aplikacji), wersję aplikacji z numerem kompilacji, informację o raportach awarii, noty licencji open source (m.in. SQLCipher) i kontakt do administratora (`mailto:`, opcjonalnie numer biura); gdy nie da się otworzyć poczty, widzę adres z akcją „Kopiuj adres”.

**AC5 — Aplikacja nieznana serwerowi**
- Zakładając błąd sieci lub `5xx`
- Gdy aplikacja go raportuje
- Wtedy raportowanie nie blokuje aplikacji i nie powiela się w pętli (limit zgłoszeń).

**AC6 — Ustawienia projektu raportowania**
- Zakładając projekt raportowania w UE (region `de`)
- Gdy sprawdzam jego konfigurację
- Wtedy jest włączone czyszczenie danych (Data Scrubbing) z regułami dla e-maila, telefonu PL, PESEL, IBAN i numeru rejestracyjnego, wyłączone zapisywanie adresów IP, retencja 30 dni oraz ochrona limitów (ograniczenie liczby zdarzeń), a konfiguracja jest opisana w dokumentacji operacyjnej.

## Poza zakresem
Push, analityka produktowa, zrzuty ekranu użytkownika, deklaracja Google Play (poza Play na MVP, ADR-0019).

## Decyzje i ograniczenia
- Nowa zależność (klient raportowania) — z uzasadnieniem (licencja, utrzymanie, brak telemetrii poza konfiguracją) i wpisem do bramki licencji.
- Raportowanie włączone domyślnie na telefonach firmowych — do potwierdzenia przez Konrada.
- **Mapy źródeł** wymagają tokenu raportowania, a SR-MOB-11 / ADR-0019 zabraniają sekretów w CI dla APK: rekomendacja — Konrad wysyła mapy lokalnie przy podpisie albo pilotaż bez map (README planu, decyzja 7).
- UX / UI: M-11 „Prywatność i pomoc” (makieta, stany, mikrocopy, dostępność) — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md); numer telefonu biura (decyzja 11); ekran dostępny dla wszystkich ról, bez `FLAG_SECURE` (treść publiczna).
- Bezpieczeństwo i prywatność: zapytania wyszukiwania i dane kopiowane do schowka są objęte testem z AC1 (SR-MOB-12).

## Notatki
- DSN w paczce jest publiczny — stąd ochrona limitów (AC6).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
