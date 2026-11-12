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
depends_on: [EVM-105, EVM-106, EVM-110]
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

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-12 — AC2: MASVS L2 → checklista L1 w security sign-offie wydania 1.1; usunięto zależność od EVM-102; test w garażu bez zmian (decyzja Konrada 2026-11-12 / Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”)
