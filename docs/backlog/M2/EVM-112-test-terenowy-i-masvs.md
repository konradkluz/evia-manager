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
depends_on: [EVM-105, EVM-106, EVM-110, EVM-102]
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

**AC2 — MASVS**
- Zakładając MASVS v2.1 na poziomie L2 dla STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE i PRIVACY (RESILIENCE poza zakresem — jawne ryzyka resztkowe: brak wykrywania roota i obfuskacji poza R8), z testami wg MASTG (m.in. plik bazy nieczytelny, brak danych osobowych w logach/Sentry/schowku, `cleartextTrafficPermitted=false` i brak zaufania do CA użytkownika, rotacja i reuse tokenów, reguła 7 dni z przestawieniem zegara, `FLAG_SECURE`, eksportowane komponenty, analiza ruchu — brak SDK analitycznych)
- Gdy security-engineer ją przechodzi
- Wtedy brak otwartych Critical/High/Medium albo każde ma zaakceptowane ryzyko resztkowe; punkty MASVS są sprawdzane już w historyjkach `pelna`, a ta konsoliduje wyniki.

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

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
