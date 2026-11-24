---
id: EVM-119
title: "API odrzuca skompresowane ciała żądań (inflate: false, RR-39)"
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P2
path: lekka
owner: backend-developer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-119: API odrzuca skompresowane ciała żądań (inflate: false, RR-39)

## Cel
Jako **właściciel produktu** chcę, **aby API nie dekodowało skompresowanych ciał żądań**, aby **obrona w głębi przed klasą podatności dekoderów (CVE-2026-111497, Brotli w `zlib` Node.js) nie zależała od samej wersji Node.js**. Klienci (web, mobile) nie wysyłają skompresowanych ciał.

## Kryteria akceptacji

**AC1 — Skompresowane ciało odrzucone**
- Zakładając dowolny endpoint przyjmujący JSON (także publiczny, nieuwierzytelniony)
- Gdy żądanie ma `Content-Encoding: br`, `gzip` lub `deflate`
- Wtedy odpowiedź to błąd klienta (415) w standardowym formacie błędów API, bez dekodowania ciała; sprawdzone dla `br`, `gzip`, `deflate` oraz dla endpointu publicznego i chronionego.

**AC2 — Żądania zwykłe bez zmian**
- Zakładając żądanie bez `Content-Encoding` (lub `identity`)
- Gdy wysyłam poprawny JSON do wszystkich dotychczasowych endpointów
- Wtedy odpowiedzi są jak dotąd; istniejące testy kontraktowe i integracyjne przechodzą bez zmian.

**AC3 — Wszystkie parsery ciał**
- Zakładając inne parsery ciał (np. `urlencoded`, tekst, surowe ciała wgrywania, jeśli istnieją)
- Gdy sprawdzam konfigurację parserów
- Wtedy żaden nie dekoduje kompresji, co potwierdza test architektoniczny/konfiguracyjny; wyjątek wymaga uzasadnienia w komentarzu i ADR/historyjce.

**AC4 — Limit rozmiaru i brak wycieku**
- Zakładając odrzucone żądanie z AC1
- Gdy ciało przekracza limit rozmiaru
- Wtedy odpowiedź jest błędem klienta bez treści ciała i szczegółów dekodera; w logu brak ciała żądania.

## Poza zakresem
- Kompresja odpowiedzi; zmiana limitów rozmiaru; WAF/proxy.

## Notatki
- RR-39 w `docs/security/threat-model.md` wskazuje tę pozycję jako obronę w głębi.
- Z przeglądu security 2026-11-18 (Low, nie blokują): (L1) test konfiguracyjny AC3 działa na tekście źródeł i nie wykryje parsera wywołanego przez alias importu (`import e from 'express'; e.json(...)`) — na później reguła ESLint albo zakaz importu `express` poza `platform/http/` i `app.ts`; istniejącą ścieżkę i tak pilnują testy zachowania; (L2) opis odpowiedzi 415 w kontrakcie mówi tylko o typie treści — przy najbliższej zmianie kontraktu dopisać „lub `Content-Encoding` inne niż `identity`”; (L3) żądanie z `Content-Encoding` bez ciała przechodzi jak dotąd (nie ma czego dekodować).

## Dziennik
- 2026-10-27 — utworzono (product-owner) z RR-39
- 2026-11-13 — triage wg decyzji „jedno środowisko” (product-owner): zostaje, P2 (mała, lekka); API z realnymi danymi jest bardziej wystawione, więc w pierwszych tygodniach użycia — w wolnym oknie między historyjkami; AC bez zmian.
- 2026-11-18 — zaakceptowana przez Konrada („akceptuję EVM-111 i EVM-119”); status `ready` (Tech Lead)
- 2026-11-18 — zaimplementowano (backend-developer): żaden klient (web, mobile wraz z natywnym silnikiem wysyłania, pakiety, infra, tools) nie wysyła skompresowanych ciał; jedyny parser ciał (`express.json` w `json-body.ts`; Nest z `bodyParser: false`) działa z `inflate: false`; testy: `apps/api/test/http/compressed-bodies.test.ts` (AC1, AC2, AC4), `apps/api/test/platform/body-parsers-config.test.ts` (AC3). Kontrakt OpenAPI bez zmian (415 `unsupported_media_type` już istnieje).
- 2026-11-18 — przegląd security (jedyny recenzent): APPROVE z uwagami, bez ustaleń Medium i wyższych; dopisek przy RR-39 potwierdzony, ocena bez zmian (2 Low); uwagi Low w „Notatkach”; status `in-review` (Tech Lead)
- 2026-11-24 — zaakceptowane przez Konrada (kod scalony w main); status `done`
