---
id: EVM-048
title: Kategorie, opis i przypisanie mediów i dokumentów do etapu
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-047]
---

# EVM-048: Kategorie, opis i przypisanie mediów i dokumentów do etapu

## Historyjka
Jako **pracownik biura** chcę **przypisywać zdjęcia i dokumenty do etapu, poprawiać ich kategorię i opis oraz grupować galerię po etapach**, aby **przy każdym etapie (np. warunki przyłączenia, montaż) mieć jego dokumenty i zdjęcia**.

## Kontekst
- Zakres roadmapy E6: „kategorie”, „przypisanie do etapu”. Model: edycja `MediaAsset` (`category`, `description`, `procedureStageId`) i `Document` (`title`, `description`, `procedureStageId` — tylko przy kotwicy zlecenia).
- Konsultacja `security-engineer` (pkt 6d): etap musi należeć do zlecenia z URL (SR-AUTHZ-02, SR-INPUT-02).
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — „Grupuj: Kategoria / Etap”, „Etap (opcjonalnie)” w dialogach, „Edytuj opis” w lightboxie. Scenariusze: A8, B4, B8.

## Kryteria akceptacji
**AC1 — Etap przy wysyłaniu**
- Gdy w dialogu wysyłania zdjęć albo „Dodaj dokument” wybieram „Etap (opcjonalnie)”
- Wtedy lista zawiera wyłącznie etapy tego zlecenia, a media lub dokument zapisują się z przypisaniem do etapu.

**AC2 — Edycja metadanych medium**
- Gdy w lightboxie albo z `⋮` zmieniam kategorię, opis albo etap zdjęcia
- Wtedy zmiana zapisuje się z `If-Match` (`412` — dane zostają), a opis ma podpowiedź „Nie wpisuj PESEL…” i jest wyświetlany jako tekst (SR-WEB-03).

**AC3 — Edycja metadanych dokumentu**
- Gdy zmieniam tytuł, opis albo etap dokumentu zlecenia
- Wtedy zmiana zapisuje się z `If-Match`; etap można wskazać tylko dla dokumentu z kotwicą zlecenia.

**AC4 — Etap innego zlecenia (SR-AUTHZ-02, SR-INPUT-02)**
- Gdy wysyłam identyfikator etapu zlecenia B dla medium zlecenia A
- Wtedy API zwraca `400 validation_failed`, a przypisanie się nie zmienia.

**AC5 — Grupowanie po etapie**
- Gdy wybieram „Grupuj: Etap”
- Wtedy galeria grupuje zdjęcia po etapach (z grupą „Bez etapu”), a dokumenty pokazują kolumnę „Etap”.

**AC6 — Zlecenie zamknięte**
- Zakładając zlecenie „Rozliczone”
- Gdy zmieniam metadane mediów albo dokumentów
- Wtedy zmiana jest przyjęta (media i dokumenty w zleceniu zamkniętym nadal są edytowalne — PO-8).

**AC7 — Uprawnienia (SR-AUTHZ-04, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda edytuje metadane
- Wtedy A i E edytują, R widzi metadane bez akcji (`403 forbidden`), niezalogowany — `401`; pola spoza listy edytowalnych (np. `mediaType`, stan pliku) są odrzucane (`read_only_field`).

**AC8 — Stany**
- Wtedy offline — edycja wyłączona; etap usunięty w międzyczasie — komunikat i odświeżenie listy etapów; `429` — wzór z README makiet.

## Poza zakresem
- Wiele etapów dla jednego pliku — poza v1. Edycja metadanych z telefonu — po MVP.

## UX / UI
- W-09: radio „Grupuj”, Select „Etap”, „Edytuj opis” w lightboxie, menu `⋮` dokumentu. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | edycja metadanych |
| Edytor | edycja metadanych |
| Tylko odczyt | podgląd metadanych |
| Niezalogowany | brak (`401`) |

- Dane: opisy (pola swobodne).
- W AC: SR-WEB-03, SR-AUTHZ-02, SR-INPUT-02, SR-AUTHZ-04, SR-AUTHZ-05. W sekcji: SR-INPUT-01, SR-DATA-02.

## Notatki techniczne
- Moduły: `media`, fasada `procedures` (walidacja etapu) + panel. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-048 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
