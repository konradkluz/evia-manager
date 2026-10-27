---
id: EVM-119
title: "API odrzuca skompresowane ciała żądań (inflate: false, RR-39)"
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
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

## Dziennik
- 2026-10-27 — utworzono (product-owner) z RR-39
