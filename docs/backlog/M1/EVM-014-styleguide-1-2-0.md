---
id: EVM-014
title: Styleguide 1.2.0 — propozycje [P-1…P-13] i poprawki makiet z EVM-004
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-progress
priority: P0
owner: ux-designer
contributors: [security-engineer]
reviewers: [web-developer, mobile-developer, product-owner]
depends_on: [EVM-004]
---

# EVM-014: Styleguide 1.2.0 — propozycje [P-1…P-13] i poprawki makiet z EVM-004

## Historyjka
Jako **zespół wykonawców panelu i aplikacji** chcemy **styleguide'u 1.2.0 z zaakceptowanymi propozycjami [P-1…P-13] i poprawionymi makietami**, aby **każdy ekran M1 powstawał wyłącznie z komponentów i tokenów biblioteki, bez interpretowania „propozycji”**.

## Kontekst
- Decyzja Konrada z EVM-004 (pytanie 4): propozycje [P-1…P-13] są zaakceptowane, a wdrożenie w styleguide 1.2.0 następuje **przed pierwszą historyjką, która ich używa** (EVM-016: P-5; EVM-067: P-11; EVM-022: P-3; EVM-031: P-2, P-6; EVM-023: P-4; EVM-044: P-7; EVM-030: P-1; [P-12] — każda lista ze słownikami).
- Wejścia: `docs/ux/styleguide.md` § 8 („Propozycje (EVM-004)”), `docs/ux/flows/README.md` → „Propozycje do styleguide'u”, uwagi EVM-004: PO-2–PO-5 oraz „Uwagi nieblokujące z weryfikacji (runda 2)” pkt 1, 2, 8, 9, 10.
- Plan M1 i kolejność: [README.md](README.md).

## Kryteria akceptacji
**AC1 — Propozycje w bibliotece**
- Zakładając zaakceptowane propozycje [P-1…P-13] (styleguide § 8)
- Gdy wykonawca szuka komponentu lub wzorca dla ekranu M1
- Wtedy każda propozycja ma w styleguide 1.2.0 własny opis w rozdziale komponentów albo wzorców (anatomia, warianty, stany, tokeny, dostępność, mikrocopy), a § 8 wskazuje jej nowe miejsce z oznaczeniem „od 1.2.0”.

**AC2 — Makiety bez oznaczeń „spoza styleguide'u”**
- Zakładając makiety w `docs/ux/flows/`
- Gdy czytam listę „Komponenty i tokeny” dowolnego ekranu
- Wtedy odwołania `[P-n]` są zastąpione odwołaniami do § styleguide'u 1.2.0, a tabela propozycji w `flows/README.md` ma pełną kolumnę „Ekrany” (runda 2 pkt 1: m.in. P-2 → W-05, M-07; P-8 → M-06, M-07; P-9 → M-03, M-04, M-10).

**AC3 — Tokeny**
- Zakładając propozycję, która wymaga nowych tokenów
- Gdy wykonawca używa komponentu
- Wtedy tokeny są w `design/tokens/` (warstwa semantyczna, format DTCG, poprawny JSON, wersja 1.2.0), opisy komponentów nie zawierają literałów kolorów, rozmiarów ani fontów, a klucze `quote` / `issued` zostają z `$deprecated` do najbliższej wersji MAJOR (decyzja 1 z EVM-004).

**AC4 — Formy bezosobowe (PO-2, runda 2 pkt 2)**
- Zakładając, że `User` ma tylko `displayName` (bez płci)
- Gdy mikrocopy opisuje działanie osoby (dziennik, etap, osoba odpowiedzialna)
- Wtedy styleguide § 4.5, `flows/03-szczegoly-zlecenia.md` i `flows/05-wpis-i-komentarz.md` używają form bezosobowych, np. „Zmiana statusu etapu „…”: «Czekamy na…»”, „Dodano 12 zdjęć · W trakcie prac”, „Osoba odpowiedzialna: Anna Testowa”, a autor zostaje w nagłówku wpisu.

**AC5 — Poprawki drobne makiet**
- Zakładając uwagi PO-3–PO-5 i runda 2 pkt 8–10 z EVM-004
- Gdy czytam poprawione makiety
- Wtedy:
  - kafel „Na kogo czekamy” w W-06 nie ma wiersza „klient: —” (PO-3);
  - etykieta dużego filmu brzmi „Nieskanowany antywirusem — plik za duży” (PO-4) — po potwierdzeniu przez `security-engineer`, który aktualizuje brzmienie w SR-FILE-12 i P5;
  - PPE w makietach występuje wyłącznie w formie oznaczonej `TEST`, zgodnie z zasadą „Dane w makietach” (PO-5);
  - trzy odnośniki banera „Zlecenie założone w terenie” mają różne komponenty i opisy dostępne — nawigacja (W-14), dialog (W-20), przewinięcie do „Płatności” (pkt 8);
  - kolejność kontroli w diagramie logowania mobilnego jest taka jak w tabelach M-01 / M-02 — `403 channel_not_allowed` przed „Dodaj kod z aplikacji” (pkt 9);
  - nieaktualne zdanie o luce L8 w `scenariusze-a-d.md` jest usunięte.

**AC6 — Dostępność nowych elementów**
- Zakładając nowe komponenty i wzorce z AC1
- Gdy sprawdzam je wg WCAG 2.2 AA
- Wtedy kontrasty wynikają z tokenów i są w tabeli kontrastów (§ 2.1.4), fokus jest widoczny, cele dotyku mają co najmniej `size.touch-target.min`, a nazwy dostępne i ogłaszanie zmian są opisane.

**AC7 — Wersja i spójność dokumentacji**
- Gdy publikuję wersję 1.2.0
- Wtedy nagłówek styleguide'u i `docs/ux/README.md` wskazują 1.2.0 z historią zmian, `CHANGELOG.md` ma wpis w „Zmieniono”, a `npm run docs:check` kończy się wynikiem 0 błędów.

## Poza zakresem
- Makiety ekranów „bez makiety” — EVM-015 (E1) i EVM-071 (pozostałe ekrany M1).
- Uwagi mobilne z rundy 2 (pkt 3–7: wyszukiwanie offline a polskie znaki, usuwanie z Kolejki, dialog po `duplicate`, moment prośby o powiadomienia, medium usunięte w biurze) — refinement M2 (E10–E12).
- Prototyp HTML (decyzja 6 z EVM-004).

## UX / UI
Dokumentacja: styleguide, tokeny i makiety. Nowych ekranów nie ma. Przykłady wyłącznie z danymi syntetycznymi (styleguide § 6.3).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | nie dotyczy (dokument) |
| Edytor | nie dotyczy |
| Tylko odczyt | nie dotyczy |
| Niezalogowany | nie dotyczy |

Nie dotyczy danych osobowych. Zmiana etykiety z PO-4 wymaga potwierdzenia `security-engineer` (P5, SR-FILE-12).

## Notatki techniczne
- Tokeny w formacie z EVM-003; konsumenci: panel (EVM-008 — Tailwind z tokenów) i aplikacja (EVM-009). Jeśli pakiet tokenów jest już w monorepo (EVM-006/008), zmiana wymaga przebudowy pakietu — `ux-designer` zgłasza to `web-developer`.
- Bez nowych zależności.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC7 spełnione (weryfikacja QA przez inspekcję)
- [ ] `npm run docs:check` — 0 błędów; diagramy Mermaid renderują się lokalnie
- [ ] Przeglądy: web-developer, mobile-developer, product-owner — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — ready → in-progress: start /deliver w nocy 3/4.10 (decyzja Konrada — kolejka EVM-006 → EVM-014 → EVM-069, demo rano); gałąź `feature/EVM-014-styleguide-1-2-0` **ułożona na `feature/EVM-006-repo-i-ci`** (EVM-006 w PR #2, jeszcze nie na `main`): hooki lefthook, `.gitignore` i walidacja tokenów (`@evia/tokens`) pochodzą z EVM-006; po scaleniu PR #2 orkiestrator wciąga `origin/main` merge'em (bez force-pusha). `security-engineer` jako współwykonawca dla AC5 (PO-4: SR-FILE-12, P5)
