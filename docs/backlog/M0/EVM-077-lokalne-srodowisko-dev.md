---
id: EVM-077
title: Lokalne środowisko do ręcznego testu (pnpm run dev)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P3
path: lekka
owner: devops-engineer
contributors: [backend-developer]
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-016]
---

# EVM-077: Lokalne środowisko do ręcznego testu (pnpm run dev)

> Pozycja nie jest następnym krokiem po EVM-021 (decyzja Konrada) — świadomie bez priorytetu P1; do rozważenia później przez `/refine`.

## Cel
Jako **deweloper / Konrad** chcę **jednym poleceniem uruchomić lokalnie panel, API i PostgreSQL z danymi syntetycznymi**, aby **ręcznie przetestować funkcje bez ustawiania środowiska krok po kroku**. Dotyczy wyłącznie maszyny lokalnej (nie staging, nie produkcja).

## Kryteria akceptacji

**AC1 — Jedno polecenie uruchamia całość**
- Zakładając, że zainstalowano zależności i jest plik `.env` skopiowany z `.env.example` (z wartością `CURSOR_KEY` dla środowiska lokalnego)
- Gdy uruchamiam `pnpm run dev`
- Wtedy startuje PostgreSQL (compose), wykonują się migracje, uruchamiają się API i panel web, a w konsoli widać adresy usług.

**AC2 — Seed syntetycznego Administratora**
- Zakładając, że baza lokalna jest pusta
- Gdy `pnpm run dev` kończy przygotowanie danych
- Wtedy istnieje jeden syntetyczny Administrator (fikcyjny adres e-mail) z możliwością aktywacji i logowania kluczem dostępu w lokalnym panelu; powtórne uruchomienie nie tworzy duplikatów.

**AC3 — Instrukcja w README**
- Zakładając, że nowy deweloper czyta README
- Gdy wykonuje kroki z sekcji „Uruchomienie lokalne”
- Wtedy dociera do działającego logowania bez dodatkowej wiedzy; instrukcja opisuje też zatrzymanie i wyczyszczenie danych lokalnych.

**AC4 — Tylko lokalnie**
- Zakładając, że `NODE_ENV`/konfiguracja wskazuje środowisko inne niż lokalne
- Gdy ktoś próbuje uruchomić seed
- Wtedy seed odmawia działania z czytelnym komunikatem; w repozytorium nie ma prawdziwych sekretów ani danych osobowych.

## Poza zakresem
- Staging/produkcja, dane demo klientów i zleceń, aplikacja mobilna.

## Decyzje i ograniczenia
- Docker wyłącznie przez `docker compose -f compose.yaml run --rm <usługa>` (CLAUDE.md); klucz dostępu działa lokalnie (origin `localhost`).
- Obszar ryzyka: seed konta z uprawnieniami Administratora — nie może trafić poza środowisko lokalne.

## Notatki
- Zależność od EVM-016 (pierwszy Administrator): potwierdzić w refinemencie, czy seed zastępuje, czy wywołuje jego procedurę.

## Dziennik
- 2026-10-07 — utworzono (product-owner)
