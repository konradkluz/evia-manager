---
id: EVM-112
title: "Test terenowy w garażu i przegląd MASVS"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
priority: P1
path: pelna             # kryterium wyjścia M2, bezpieczeństwo
owner: qa-engineer
contributors: [mobile-developer]
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-105, EVM-106, EVM-110, EVM-130, EVM-131]
---

# EVM-112: Test terenowy w garażu i przegląd MASVS

> **Szkic ramowy** — kryterium wyjścia M2; AC do doprecyzowania w fazie 5.

## Cel
Jako **Konrad** chcę **potwierdzić w prawdziwych warunkach, że aplikacja nie gubi ani nie dubluje danych**, aby **zamknąć M2 i dać aplikację technikom**.

## Kryteria akceptacji (ramowe)

**AC1 — Test terenowy**
- Zakładając telefon firmowy z Androidem zainstalowany z APK podpisanego lokalnie, garaż podziemny bez zasięgu
- Gdy technik wykonuje 30 zdjęć, 3 filmy i 2 wpisy, wymuszamy zamknięcie aplikacji w trakcie wysyłki, a po wyjściu na zasięg czekamy
- Wtedy wszystko jest w właściwym zleceniu, 0 duplikatów i 0 strat; wynik zapisany w raporcie.

**AC2 — Checklista MASVS L1 w security sign-off wydania 1.1**
- Zakładając checklistę MASVS v2.1 na poziomie L1 dla STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE i PRIVACY (RESILIENCE poza zakresem — jawne ryzyka resztkowe: brak wykrywania roota i obfuskacji poza R8), wypełnianą na podstawie dowodów z przeglądów historyjek `pelna` (m.in. plik bazy nieczytelny, brak danych osobowych w logach i schowku, `cleartextTrafficPermitted=false`, rotacja i reuse tokenów, reguła 7 dni, `FLAG_SECURE`, eksportowane komponenty, brak SDK analitycznych i telemetrii — EVM-102 AC5)
- Gdy security-engineer wykonuje security sign-off wydania 1.1
- Wtedy checklista jest częścią sign-offu (bez osobnego testu MASTG i pentestu), a brak otwartych Critical/High/Medium albo każde ma zaakceptowane ryzyko resztkowe.

**AC3 — Dystrybucja**
- Zakładając APK z CI
- Gdy Konrad podpisuje go lokalnie i instaluje na telefonach firmowych
- Wtedy aplikacja uruchamia się, loguje i synchronizuje; wymuszenie minimalnej wersji działa.

**AC4 — Utrata telefonu i spis floty**
- Zakładając fizyczny telefon z zalogowaną aplikacją i niewysłanymi elementami
- Gdy Administrator wykonuje „Zablokuj i wyczyść”, a spis floty zawiera poziom poprawek każdego telefonu
- Wtedy procedura utraty telefonu jest przećwiczona (telefon czyści dane i potwierdza to serwerowi), a `threat-model.md`, rejestr ryzyk resztkowych i `rodo.md` są zaktualizowane.

## Decyzje i ograniczenia
- Telefony firmowe vs prywatne (BYOD) wpływają na politykę poprawek (P7) — README planu, decyzja 4; MASVS v2.1 zastępuje „L1+” z v1.
- **Uproszczenie 2026-11-12:** test w garażu (AC1) zostaje jako kryterium wyjścia M2; MASVS to checklista L1 w security sign-offie wydania 1.1 (raz na wydanie, na podstawie dowodów z przeglądów i DAST), bez osobnego testu/pentestu. Zależność od EVM-102 usunięta (aplikacja bez telemetrii; EVM-102 to tylko ekran prywatności).

- **Warunki wejścia (2026-11-14, decyzja Konrada: nie czekamy na EVM-084 w rozwoju):** ~~EVM-084 AC2 (wersjonowanie i kopia mediów) zielone~~ (**decyzja Konrada 2026-11-15:** test terenowy nie czeka na EVM-084; media chroni do tego czasu wersjonowanie i blokada usunięcia 30 dni w buckecie, kopie bazy — RR-91, termin 2026-12-13); EVM-131 wdrożone; scenariusze Scaleway z `media-pipeline.md` §5 (podpisany `Content-Length`, `NoSuchUpload` przy powtórce `complete`, sprzątanie przerwanego multipartu); **dystrybucja (decyzja Konrada 2026-11-15):** technicy dostają paczkę z aparatem i wysyłaniem na ten test bez czekania na EVM-084 („nie blokuje funkcjonalności ani testów”); stałe używanie — po sign-offie tej historyjki.
- **Warunek sign-offu (2026-11-14, przegląd EVM-131, RR-96):** przed wydaniem aplikacji z wysyłaniem panel pokazuje Administratorowi media „Czeka na plik z telefonu” z możliwością usunięcia (także opisu), zadanie retencji czyści opis albo miękko usuwa media bez pliku starsze niż 30 dni, a limit liczby mediów bez pliku na twórcę i zlecenie obowiązuje przy `CreateMediaAsset`; wariant zastępczy: zapisana akceptacja ryzyka przez Konrada.
- **Kryteria `manual` przeniesione z historyjek nocy 2026-11-14 (fizyczny telefon i środowisko, brak w AC EVM-109/130/131/128/102):** UIDT na Androidzie 14+ i agresywni producenci; Android 13 (SM-G781B) — zwykłe zadanie, limit 10 min, wznawianie, pomiar dużego filmu; wysyłanie przy zablokowanym ekranie, po restarcie dopiero po pierwszym odblokowaniu; powiadomienie na ekranie blokady (wygląd, zachowanie bez zgody na Androidzie 13); brak plików w galerii, Plikach i Zdjęciach Google, brak GPS w EXIF przy włączonej lokalizacji systemu; ruch sieciowy całej sesji (tylko API i magazyn, 0 Google/ML Kit/Firebase); `FLAG_SECURE` na ekranie aparatu (zrzut, „Ostatnie”); film 500 MB przy przełączaniu Wi-Fi ↔ LTE i „tylko Wi-Fi” w realnych sieciach; „Zablokuj i wyczyść” w trakcie wysyłki; bateria; układ alertu „Utwórz ponownie” na 360 dp, TalkBack i 200% czcionki (EVM-128); czytelność klauzul na 360 dp i 200%, Disclosure, „Kopiuj adres” (EVM-102); ruch sieciowy całej sesji aparatu (EVM-108 AC4, część dynamiczna).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-12 — AC2: MASVS L2 → checklista L1 w security sign-offie wydania 1.1; usunięto zależność od EVM-102; test w garażu bez zmian (decyzja Konrada 2026-11-12 / Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”)
- 2026-11-13 — dopisane przy teście terenowym: pomiar AC7 EVM-103 (wyszukiwanie na liście, 300 syntetycznych zleceń, p95 ≤ 300 ms na referencyjnym średnim Androidzie, kompilacja wydania) — decyzja Konrada 2026-11-13 (Tech Lead)
- 2026-11-14 — `depends_on` + EVM-084, EVM-130, EVM-131; dopisano warunki wejścia i listę kryteriów `manual` (product-owner; decyzja Konrada 2026-11-14)
- 2026-11-15 — decyzja Konrada: EVM-084 nie blokuje testu terenowego — usunięta z `depends_on` i z warunków wejścia; technicy dostają paczkę z wysyłaniem na test terenowy wcześniej, a do EVM-084 wracamy później (Tech Lead)
- 2026-11-15 — z doprecyzowania EVM-108: jej kryteria `manual` (lista w „Decyzjach i ograniczeniach” EVM-108) do przeniesienia tutaj przy doprecyzowaniu tej historyjki (Tech Lead)
