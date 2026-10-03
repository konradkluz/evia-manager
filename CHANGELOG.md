# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [Unreleased]
### Dodano
- Zespół agentów (`.claude/agents/`), komendy (`.claude/skills/`) i workflow `deliver-story` (`.claude/workflows/`).
- Dokumentacja produktu (wizja, domena, roadmapa), procesu (workflow, DoR, DoD, strategia testów, konwencje), baseline bezpieczeństwa i zasady UX.
- Backlog M0: EVM-001 … EVM-013.
- Styleguide v1.0.0 (`docs/ux/styleguide.md`), design tokens W3C DTCG w warstwach bazowej i semantycznej (`design/tokens/`), materiały marki EVia Charge ze źródłami i licencjami (`design/brand/`) [EVM-003].
- Architektura i stack technologiczny: ADR 0001–0014 (zaakceptowane), przegląd architektury z diagramami C4, NFR i kosztami (`docs/architecture/`) [EVM-001].
- Polityka cyklu życia dokumentów (`docs/process/document-lifecycle.md`): klasy trwały / żywy / kamień milowy / roboczy, dozwolone lokalizacje, pliki robocze w `.scratch/`, archiwum = historia git; walidator i raport sprzątania tylko do odczytu (`tools/docs-lifecycle/`: `npm run docs:check`, `npm run docs:cleanup -- M#`, testy `npm run test:tools`); krok „Sprzątanie dokumentacji” w `/milestone close`, zasady dla agentów i punkt w Definition of Done [EVM-012].
- ADR-0015: środowisko testów per warstwa (backend w kontenerach Linux, web w przeglądarkach na Windows, Android na emulatorze Windows, iOS odłożony), zasada sekretów poza repozytorium, reguły deny/ask w `.claude/settings.json`.
- Model domeny i danych v1 (`docs/architecture/domain-model.md`): ERD, encje, diagramy stanów z tabelami przejść, macierz uprawnień, gotowość offline, klasyfikacja danych, walidacja scenariuszy A–F; wytyczne API (`docs/architecture/api-guidelines.md`); szkic synchronizacji offline (`docs/architecture/offline-sync.md`); zaakceptowane dane startowe katalogu usług i szablonów (`docs/product/service-catalog.md`); potwierdzone nazwy w kodzie w słowniku (`docs/product/domain.md`); doprecyzowana mapa modułów (nowy moduł `parties`) [EVM-002].
- Bezpieczeństwo (`docs/security/`): model zagrożeń v1 (STRIDE, przypadki nadużyć, ryzyka rezydualne), katalog wymagań `SR-…` (ASVS 5.0 L2, MASVS 2.1) z bramkami CI, polityki P1–P12 i ryzyka rezydualne zaakceptowane przez Konrada, szkic operacyjny RODO [EVM-005].
- Przepływy i makiety low-fi MVP (`docs/ux/flows/`): mapa nawigacji panelu web (M1) i aplikacji mobilnej (M2), 10 przepływów z diagramami Mermaid i makietami 21 ekranów (stany, role, komponenty i tokeny, mikrocopy, dostępność), przejście scenariuszy A–D z weryfikacją biznesową; pojęcia z makiet w słowniku (`docs/product/domain.md`); 13 propozycji `[P-n]` do styleguide'u do akceptacji [EVM-004].
- Backlog M1 „MVP Biuro”: 59 historyjek EVM-014 … EVM-072 w statusie `draft` (`docs/backlog/M1/`) z indeksem `docs/backlog/M1/README.md` — tabela epik → historyjki, fazy i graf zależności, punkt pilota (próbny na staging, realny po pentescie), pokrycie zakresu roadmapy, ekranów, scenariuszy A–D i wymagań `SR-…`, zdolności przekrojowe, zasady wspólne, decyzje dla Konrada z rekomendacjami; nowe pojęcia w słowniku (`docs/product/domain.md`) [EVM-010].

### Zmieniono
- Styleguide i tokeny 1.0.0 → 1.1.0: etykieta „Czekamy na…”, status „Anulowana” i oznaczenie wyliczane „Po terminie” dla etapów płatności, klucze tokenów zgodne z kodami modelu (`quoting`, `invoiced`; `quote` i `issued` wycofywane przez `$deprecated`), pełna lista rodzajów stron, mobilny Uploader bez „Z galerii”, `404` vs `403`, szkice w panelu tylko w pamięci karty, „Cofnij” tylko przez przejście odwrotne bez step-upu, URL bez danych osobowych, „Zapisano w telefonie” dopiero po trwałym zapisie pliku i wpisu w kolejce [EVM-004].
- Roadmapa M1 (do akceptacji Konrada): odnośnik do planu szczegółowego, kolejność faz, pilot próbny i realny, uwagi do E8 (plan GitHub, pentest, import), najbliższe kroki [EVM-010].
