---
id: EVM-001
title: Architektura i stack technologiczny (ADR)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P0
owner: solution-architect
contributors: []
reviewers: [security-engineer, devops-engineer, mobile-developer]
depends_on: []
---

# EVM-001: Architektura i stack technologiczny (ADR)

## Historyjka
Jako **właściciel produktu** chcę **świadomie wybranej i uzasadnionej architektury oraz stacku technologicznego**, aby **zespół agentów budował system szybko, bezpiecznie i tanio w utrzymaniu**.

## Kontekst
Wybór technologii należy do architekta (decyzja Konrada). Wejścia: wymagania niefunkcjonalne (`docs/product/vision.md`), model kompozycji zleceń (`docs/product/domain.md`), czynniki architektoniczne (`docs/architecture/README.md`), baseline bezpieczeństwa (`docs/security/README.md`). Po akceptacji orkiestrator zmienia statusy ADR na „Zaakceptowana”.

## Kryteria akceptacji
**AC1 — Zakres decyzji**
- Zakładając wymagania z dokumentów wejściowych
- Gdy architekt kończy pracę
- Wtedy w `docs/architecture/adr/` istnieją ADR-y (status „Proponowana”) co najmniej dla: architektury ogólnej, backendu, bazy danych i migracji, stylu i kontraktu API, uwierzytelniania i MFA, panelu web, aplikacji mobilnej, synchronizacji offline, storage'u i przetwarzania mediów, hostingu i środowisk w UE, CI/CD i narzędzi jakości, narzędzi testowych każdej warstwy.

**AC2 — Rzetelność**
- Zakładając dowolny ADR z AC1
- Gdy go czytam
- Wtedy zawiera kryteria z wagami, co najmniej 2 realne opcje, tabelę oceny, konsekwencje, ryzyka i plan wyjścia, a wersje, licencje i stan utrzymania są zweryfikowane w sieci (data i źródła).

**AC3 — Mobile i offline**
- Zakładając wymagania pracy bez zasięgu
- Gdy czytam ADR mobile i offline
- Wtedy widzę, jak wybrane podejście realizuje na iOS i Android: upload w tle dużych plików, aparat i wideo, lokalną bazę, bezpieczny magazyn tokenów — oraz listę ryzyk do sprawdzenia w spike'u EVM-011.

**AC4 — Koszty**
- Gdy czytam przegląd architektury
- Wtedy znajduję szacunek miesięcznych kosztów infrastruktury dla MVP (ok. 10 użytkowników, 500 GB mediów) i po 2 latach (ok. 30 użytkowników, 3 TB), z założeniami.

**AC5 — Przegląd architektury**
- Gdy otwieram `docs/architecture/README.md`
- Wtedy zawiera diagramy C4 poziomu 1 i 2 (Mermaid), mapę modułów domenowych i listę NFR z docelowymi wartościami.

**AC6 — Podsumowanie dla decydenta**
- Gdy Konrad ma podjąć decyzję
- Wtedy na początku `docs/architecture/README.md` jest jednostronicowe podsumowanie: rekomendowany stack, uzasadnienie, koszty, główne ryzyka i pytania do decyzji (z rekomendacjami).

## Poza zakresem
Implementacja i konfiguracja repozytorium (EVM-006), szczegółowy model domeny (EVM-002), model zagrożeń (EVM-005).

## UX / UI
Nie dotyczy (ADR panelu web uwzględnia możliwość wdrożenia design tokens z EVM-003).

## Bezpieczeństwo i prywatność
Dotyczy: mechanizmy uwierzytelniania, hosting w UE, przechowywanie mediów. Recenzja: `security-engineer`.

## Notatki techniczne
- Środowisko developerskie Konrada: **Windows 11**. Buildy i testy iOS wymagają macOS — ADR mobile i CI/CD muszą wskazać rozwiązanie (np. chmurowe buildy, runner macOS w CI).
- Dane potrzebne od Konrada (zadaj pytania z rekomendacjami): flota telefonów (iOS / Android, firmowe czy prywatne), budżet miesięczny, preferencje hostingu, domena, konto repozytorium.

## Plan techniczny
_Uzupełnia wykonawca._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC6 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: security-engineer, devops-engineer, mobile-developer — APPROVE
- [ ] Indeks ADR zaktualizowany
- [ ] Demo i akceptacja Konrada; po akceptacji statusy ADR i sekcja „Stack i komendy” w `CLAUDE.md` zaktualizowane

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
