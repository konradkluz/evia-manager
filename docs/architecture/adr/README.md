# Decyzje architektoniczne (ADR)

Każda nieoczywista decyzja techniczna (stack, hosting, biblioteka o dużym wpływie, wzorzec, zmiana kontraktu) ma swój ADR. Nowy ADR: `/adr <temat>` (szablon: `0000-template.md`). Decyzji zaakceptowanej nie edytujemy merytorycznie — zastępujemy ją nowym ADR.

Statusy: **Proponowana** → **Zaakceptowana** / **Odrzucona** → (ewentualnie) **Zastąpiona przez ADR-XXXX**. Decyzję zaakceptowaną można też **częściowo zastąpić** nowym ADR — status zostaje „Zaakceptowana”, a pod nim notka z zakresem i linkiem.

| ADR | Tytuł | Status | Data |
|---|---|---|---|
| [0001](0001-architektura-ogolna-modularny-monolit.md) | Architektura ogólna — modularny monolit z centralną autoryzacją i audytem | Zaakceptowana | 2026-10-02 |
| [0002](0002-backend-typescript-nestjs.md) | Backend — TypeScript na Node.js LTS z frameworkiem NestJS | Zaakceptowana | 2026-10-02 |
| [0003](0003-baza-danych-postgresql-kysely-migracje.md) | Baza danych i migracje — PostgreSQL 18, Kysely, migracje expand → migrate → contract | Zaakceptowana | 2026-10-02 |
| [0004](0004-api-rest-openapi-contract-first.md) | Styl i kontrakt API — REST/JSON, OpenAPI 3.1 contract-first, generowane typy, klienci i testy | Zaakceptowana | 2026-10-02 |
| [0005](0005-uwierzytelnianie-i-mfa.md) | Uwierzytelnianie i MFA — własny moduł `identity` na sprawdzonych prymitywach, sesje nieprzezroczyste | Zaakceptowana | 2026-10-02 |
| [0006](0006-panel-web-react-vite-shadcn.md) | Panel web — React + Vite (SPA), TanStack Router/Query, shadcn/ui (Base UI) + Tailwind CSS z design tokens | Zaakceptowana | 2026-10-02 |
| [0007](0007-aplikacja-mobilna-expo-react-native.md) | Aplikacja mobilna — React Native z Expo (iOS + Android), upload w tle natywnymi mechanizmami systemu | Zaakceptowana | 2026-10-02 |
| [0008](0008-synchronizacja-offline.md) | Synchronizacja offline — własny protokół: kolejka mutacji (outbox) + kanał zmian z kursorem | Zaakceptowana | 2026-10-02 |
| [0009](0009-storage-i-przetwarzanie-mediow.md) | Storage i przetwarzanie mediów — Scaleway Object Storage (Warszawa), S3 multipart z podpisanymi URL-ami, skan AV i izolowane przetwarzanie | Zaakceptowana | 2026-10-02 |
| [0010](0010-zadania-w-tle-pg-boss.md) | Zadania w tle — pg-boss na PostgreSQL, osobny proces `worker` | Zaakceptowana | 2026-10-02 |
| [0011](0011-hosting-i-srodowiska-ue.md) | Hosting i środowiska w UE — Hetzner Cloud (obliczenia i baza) + Scaleway (storage, backupy bazy, e-mail) + Hetzner Storage Box (backup mediów) | Zaakceptowana · częściowo zastąpiona przez [0015](0015-srodowisko-testow-per-warstwa.md) | 2026-10-02 |
| [0012](0012-ci-cd-monorepo-narzedzia-jakosci.md) | CI/CD, monorepo i narzędzia jakości — GitHub Actions, pnpm + Turborepo, EAS Build dla aplikacji mobilnej | Zaakceptowana | 2026-10-02 |
| [0013](0013-obserwowalnosc.md) | Obserwowalność — logi strukturalne z redakcją, Grafana Cloud (UE) i Sentry (UE), alerty bezpieczeństwa | Zaakceptowana | 2026-10-02 |
| [0014](0014-narzedzia-testowe.md) | Narzędzia testowe każdej warstwy — Vitest, Testcontainers, macierz ról z kontraktu, Playwright, Maestro | Zaakceptowana · częściowo zastąpiona przez [0015](0015-srodowisko-testow-per-warstwa.md) | 2026-10-02 |
| [0015](0015-srodowisko-testow-per-warstwa.md) | Środowisko testów per warstwa — backend na Linuksie w kontenerach, web, mobile i narzędzia natywnie na Windows, CI na Linuksie | Zaakceptowana | 2026-10-03 |
