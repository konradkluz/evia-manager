---
id: EVM-092
title: "sync-core: pobieranie zmian, resync i obiekty oczekujące"
type: enabler
milestone: M2
epic: E10 Zlecenia offline
status: in-review
priority: P0
path: pelna             # synchronizacja offline
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, solution-architect]
model: sonnet
depends_on: [EVM-091]
---

# EVM-092: `sync-core` — pobieranie zmian, resync i obiekty oczekujące

## Cel
Jako **technik** chcę, aby **telefon utrzymywał aktualną kopię moich zleceń i nigdy nie zgubił tego, co sam zapisałem, a jeszcze nie wysłałem**, aby **praca bez zasięgu była bezpieczna**. Rozszerza `packages/sync-core` o stronę „pull”: [`offline-sync.md`](../../architecture/offline-sync.md) („Pobieranie”, „Resync…”, „Zakres synchronizacji urządzenia”).

## Kryteria akceptacji

**AC1 — Pierwsze pobranie**
- Zakładając pusty magazyn i transport z atrapą stron zmian
- Gdy silnik pobiera zakres
- Wtedy pierwsze pobranie to migawka stronicowana po agregatach (faza `snapshot` kursora, pozycja dziennika zapamiętana przed migawką), a każda strona jest stosowana atomowo (całość albo nic) razem z zapisem kursora; przerwanie w trakcie nie zostawia częściowej strony ani częściowej listy, a ponowienie dochodzi do tego samego stanu.

**AC2 — Przyrost**
- Zakładając zapisany kursor
- Gdy przychodzą `upsert` (z `version`) i `delete` (znacznik)
- Wtedy kopia lokalna jest aktualizowana, `delete` usuwa obiekt i podrzędne, a nowa wersja nigdy nie jest nadpisywana starszą.

**AC3 — Obiekty oczekujące są chronione**
- Zakładając wpis, komentarz lub szybkie zlecenie bez wyniku `applied` / `duplicate`
- Gdy przychodzi znacznik usunięcia zlecenia, wyjście z zakresu lub `resync_required`
- Wtedy obiekt oczekujący i jego mutacje zostają (widoczne jako oczekujące), a przy `target_unavailable` / `forbidden` trafiają na „Wymaga uwagi” (scenariusze 1–3 z `offline-sync.md`).

**AC4 — Resync**
- Zakładając `resync_required` (zmiana roli, kursor starszy niż 90 dni, kontrolny co 7 dni)
- Gdy silnik go odbiera (także dla kursora niedekodowalnego)
- Wtedy pobiera nową replikę „w cieniu” (obok starej, podmiana atomowa po komplecie; przerwanie zostawia starą), nie dotykając kolejki ani obiektów oczekujących; natychmiastowe usunięcie repliki następuje tylko przy utracie dostępu (`session_revoked`, zmiana roli).

**AC5 — Wejście do zakresu i kompletność referencji**
- Zakładając zlecenie, którego klient lub lokalizacja nie ma lokalnie (scenariusz 5)
- Gdy strona zmian dostarcza zlecenie
- Wtedy obiekt nie jest pokazywany jako niepełny: nieznane lokalnie zlecenie albo brakująca referencja uruchamia pobranie migawki zlecenia (`GET /sync/work-orders/{id}`), zlecenie jest niewidoczne do jej zastosowania, kolejność jest odporna dzięki strażnikowi `version`, a referencje osierocone (klient, lokalizacja, strona bez zlecenia w zakresie) są sprzątane po zastosowaniu strony; zlecenia zamknięte starsze niż N dni wychodzą z zakresu regułą klienta.

**AC6 — Walidacja danych z serwera**
- Zakładając stronę z nieznaną wartością słownika albo niezgodną ze schematem
- Gdy silnik ją stosuje
- Wtedy nieznana wartość jest zapisana jako „nieznana” (SR-MOB-10), a zmiana niezgodna z projekcją (`parseSyncChange` → `invalid`) nie jest zapisywana ani po cichu pomijana: silnik planuje pełny resync (nieznany `type` jest pomijany bez resyncu); zgodnie z kontraktem EVM-090 ocena jest per zmiana, a nie odrzucenie całej strony; błąd techniczny w telemetrii zawiera wyłącznie powód i słownikowy `type`, bez treści i danych osobowych.

**AC7 — Ostatni kontakt z serwerem odporny na zegar**
- Zakładając porty zegara: czas ścienny, czas monotoniczny i identyfikator rozruchu
- Gdy silnik kończy udane (2xx) uwierzytelnione żądanie (nie `health`/`meta`)
- Wtedy zapisuje `serverTime`, czas monotoniczny i identyfikator rozruchu, a upływ liczy tak: w tym samym rozruchu z czasu monotonicznego; po restarcie z zegara ściennego, z przenoszeniem sumy upływów między rozruchami i znacznikiem maksymalnego zaobserwowanego czasu — zegar cofnięty poniżej znacznika lub poniżej `serverTime` daje wynik „fail-closed” (dane ukryte); testy: przestawienie zegara w tył i w przód, restart, cofnięcie po restarcie, strefa czasowa i zmiana czasu (DST). Wartość okna (domyślnie 7 dni) pochodzi z konfiguracji klienta.

## Poza zakresem
Szyfrowana baza (EVM-093), UI, wiring z API (EVM-107). Wartości wymagające pomiaru (N dni zamkniętych zleceń, `limit` strony) — parametry konfiguracyjne.

## Decyzje i ograniczenia
- Otwarte punkty `offline-sync.md` (2–4, 6, 11, 12) rozstrzygnięte w konsultacji architekta i zapisane w ADR-0021 (Proponowana → musi być Zaakceptowana przed `ready`); N = 30 dni i resync kontrolny co 7 dni są parametrami konfiguracji.
- Testy `EVM-092 AC#`, próg pokrycia pakietu bez zmian (warstwa 95% z EVM-113 / EVM-091). Kontrolę zgodności z kontraktem (typy + fixtures w obu kierunkach, `@evia/contracts` tylko jako devDependency testów) wykonuje EVM-107 po scaleniu EVM-090.
- Bezpieczeństwo i prywatność: reguła 7 dni to kontrola kliencka (ogranicza ekspozycję przy kradzieży, nie jest granicą zaufania — TM-03).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-27 — status ready: zaakceptowane przez Konrada ("Tak" na liście decyzji M2); ADR-0021 zaakceptowany (Tech Lead)
- 2026-10-29 — plan gotowy; start implementacji (mobile-developer)
- 2026-10-29 — implementacja pull w `packages/sync-core` (PullEngine, SessionGate wspólny z push, ContactClock, replika w generacjach z cieniem, znaczniki usunięcia, migawka zlecenia, parser ścisły, telemetria słownikowa), README pakietu i offline-sync.md (pkt 4, 5, 11, 12); testy `EVM-092 AC1–AC7` (mobile-developer)
