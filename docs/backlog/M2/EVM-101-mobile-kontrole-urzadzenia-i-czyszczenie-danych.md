---
id: EVM-101
title: "Aplikacja: kontrole urządzenia, ukrycie danych po 7 dniach, wyczyszczenie danych"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: draft
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
- Zakładając włączoną blokadę aplikacji
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
- Wartości 7 dni, 5 min, 6/12 miesięcy: ADR-0005, polityka P7; domyślnie włączona blokada aplikacji — do potwierdzenia przez Konrada (czy technik może ją wyłączyć — `security-engineer`).
- **Przed `ready`:** decyzja o `FLAG_SECURE` (README planu, decyzja 5) i o telefonach firmowych vs prywatnych (decyzja 4).
- Reguła 7 dni jest kontrolą kliencką ograniczającą ekspozycję (TM-03), nie granicą zaufania.
- UX / UI: ostrzeżenie dnia 5–6 i arkusz „Dodaj” w trybie ukrytym — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-05/M-09).

## Notatki
- Klawiatura w polach z danymi klienta: `IME_FLAG_NO_PERSONALIZED_LEARNING`.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
