# Dokumentacja EVia Manager

| Obszar | Plik | Po co |
|---|---|---|
| Produkt | `product/vision.md` | problem, cele, role, wymagania niefunkcjonalne |
| | `product/domain.md` | słownik (nazwy w kodzie), model „kompozycji” zleceń, scenariusze A–F |
| | `product/service-catalog.md` | dane startowe: katalog usług, szablony procesów i zleceń, rodzaje dokumentów (propozycja do akceptacji) |
| | `product/roadmap.md` | kamienie milowe, MVP, ryzyka, najbliższe kroki |
| Proces | `process/workflow.md` | jak pracuje zespół agentów, bramki, RACI, raport agenta |
| | `process/definition-of-ready.md` | kiedy historyjka może wejść do realizacji |
| | `process/definition-of-done.md` | kiedy historyjka jest skończona |
| | `process/testing-strategy.md` | rodzaje testów, progi pokrycia, test terenowy |
| | `process/conventions.md` | język, ID, git, wersjonowanie |
| | `process/document-lifecycle.md` | klasy cyklu życia dokumentów, dozwolone lokalizacje, pliki robocze, walidator i sprzątanie |
| Architektura | `architecture/README.md` | czynniki architektoniczne, C4, mapa modułów, NFR, koszty |
| | `architecture/adr/` | decyzje architektoniczne |
| | `architecture/domain-model.md` | model domeny i danych: ERD, encje, stany, uprawnienia, gotowość offline, klasyfikacja danych |
| | `architecture/api-guidelines.md` | wytyczne API: zasoby, błędy, paginacja, wyszukiwanie, idempotencja, wersjonowanie, autoryzacja, limity |
| | `architecture/offline-sync.md` | synchronizacja offline (szkic): zasady, komendy mobilne, zakres urządzenia |
| Bezpieczeństwo | `security/README.md` | wymagania bazowe (non-negotiable) |
| | `security/threat-model.md` | model zagrożeń: STRIDE, przypadki nadużyć, ryzyka rezydualne do akceptacji |
| | `security/requirements.md` | wymagania bezpieczeństwa `SR-…` (ASVS 5.0 L2, MASVS 2.1) per moduł i epik, bramki CI |
| | `security/policies.md` | polityki bezpieczeństwa P1–P12 do decyzji |
| | `security/rodo.md` | RODO (szkic operacyjny): inwentaryzacja, podstawy, retencja, podmioty przetwarzające, prawa osób, naruszenia |
| Operacje | `ops/README.md` | runbooki: GitHub i CI (`ops/github-i-ci.md` — ustawienia repozytorium, scalanie PR, kontrole K1–K7, czerwony `main`), rotacja sekretów (`ops/rotacja-sekretow.md`) |
| UX | `ux/README.md` | zasady UX, artefakty; styleguide 1.2.0 (`ux/styleguide.md`; 1.0.0 — EVM-003, 1.1.0 — EVM-004, 1.2.0 — EVM-014) |
| | `ux/flows/README.md` | przepływy i makiety MVP: mapa nawigacji web i mobile, ekrany ze stanami i rolami, scenariusze A–D (EVM-004); makiety E1 — aktywacja i reset hasła, konto i administracja, treści e-maili (EVM-015); makiety M1 — klienci, edycja lokalizacji i strony, prywatność i pomoc, edycja zlecenia i zakresu, W-09 w przeglądarce telefonu, W-10, W-11 (EVM-071) |
| Backlog | `backlog/README.md` | typy, statusy, priorytety, szablon historyjki |
| | `backlog/M0/` | fundamenty: EVM-001 … EVM-013, EVM-074, EVM-075 |
| | `backlog/M1/` | MVP „Biuro”: EVM-014 … EVM-073; indeks `backlog/M1/README.md` — fazy, punkt pilota, pokrycie zakresu, decyzje dla Konrada |

Zespół agentów: `../.claude/agents/` · komendy: `../.claude/skills/` · workflow realizacji: `../.claude/workflows/deliver-story.js`.
