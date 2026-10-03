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
