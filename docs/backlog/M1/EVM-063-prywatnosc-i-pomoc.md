---
id: EVM-063
title: Prywatność i pomoc w panelu — klauzule informacyjne
type: story
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: web-developer
contributors: [security-engineer, ux-designer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-067, EVM-071]
---

# EVM-063: Prywatność i pomoc w panelu — klauzule informacyjne

## Historyjka
Jako **pracownik i Administrator** chcemy **mieć w panelu klauzule informacyjne i pomoc w stałym miejscu**, aby **spełnić obowiązek informacyjny RODO i wiedzieć, gdzie szukać pomocy**.

## Kontekst
- SR-PRIV-05 (klauzule — klienci, osoby kontaktowe stron, pracownicy — gotowe przed produkcją; link w panelu), `docs/security/rodo.md` → „Obowiązek informacyjny”, WCAG 3.2.6 (pomoc w stałym miejscu).
- Decyzja 9: dane rejestrowe firmy i prawnik / IOD — punkty `[PRAWNIK/IOD]` w treści.
- Makieta: W-19 (EVM-071); link w stopce [W-01](../../ux/flows/01-logowanie-mfa.md#w-01-logowanie) i w menu konta.

## Kryteria akceptacji
**AC1 — Dostęp do W-19**
- Gdy jestem na dowolnym ekranie po zalogowaniu albo na W-01
- Wtedy „Prywatność i pomoc” jest w menu konta, a „Prywatność · Pomoc” w stopce W-01 — przed zalogowaniem bez danych użytkownika.

**AC2 — Klauzule (SR-PRIV-05)**
- Gdy otwieram W-19
- Wtedy widzę klauzule dla klientów (do przekazania), osób kontaktowych stron oraz pracowników i pracy na prywatnym telefonie (BYOD) z danymi administratora z decyzji 9, wersją i datą, w treści przygotowanej przez `security-engineer` i zatwierdzonej przez Konrada; punkty `[PRAWNIK/IOD]` są rozstrzygnięte albo świadomie oznaczone w „Decyzje”.

**AC3 — Pomoc**
- Wtedy W-19 ma sekcję „Pomoc” z kontaktem do Administratora w stałym miejscu (WCAG 3.2.6); odnośnik do instrukcji dla biura dodaje w tej sekcji EVM-066 (instrukcja opublikowana w panelu) — do tego czasu sekcja pokazuje tylko kontakt.

**AC4 — Treść statyczna (SR-WEB-07)**
- Gdy ładuję W-19
- Wtedy treść pochodzi z własnego originu (bez zewnętrznych skryptów, fontów i CDN), nie zawiera danych osobowych użytkowników i spełnia CSP z P11.

**AC5 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy W-19 widzą wszystkie role i niezalogowany (z W-01).

**AC6 — Stany i dostępność**
- Wtedy ładowanie — Skeleton tekstu; offline — „Treść wymaga połączenia.” (chyba że jest w pamięci karty); nagłówki w hierarchii, tytuł karty „Prywatność i pomoc · EVia Manager”.

## Poza zakresem
- Klauzula BYOD w aplikacji mobilnej i link w aplikacji (M-11) — M2 (E14). Rejestr czynności i umowy powierzenia — EVM-064.
- Publikacja instrukcji dla biura w panelu i odnośnik z W-19 — EVM-066 (repozytorium jest prywatne, więc link do pliku w repozytorium nie zadziała dla biura — przegląd `ux-designer` EVM-010).

## UX / UI
- W-19: strona treści (nagłówki, sekcje rozwijane [P-2] dla każdej klauzuli), link w menu konta i stopce W-01. Stany: AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt |
| Edytor | odczyt |
| Tylko odczyt | odczyt |
| Niezalogowany | odczyt (z W-01) |

- Dane: dane administratora danych (firma).
- W AC: SR-PRIV-05, SR-WEB-07, SR-AUTHZ-05.

## Notatki techniczne
- Moduły: panel (treść statyczna w repozytorium panelu, i18n). `security-engineer` — treść klauzul, `ux-designer` — układ.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-063 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo i akceptacja Konrada (treść klauzul)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): odnośnik do instrukcji przeniesiony do EVM-066 (AC3)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 10 (b); liczba AC bez zmian): AC2 — klauzula „pracowników i pracy na prywatnym telefonie (BYOD)” zamiast „pracowników” (ustalenie A5 `security-engineer` w EVM-071; makieta W-19 — panel w przeglądarce prywatnego telefonu, decyzja 19)
