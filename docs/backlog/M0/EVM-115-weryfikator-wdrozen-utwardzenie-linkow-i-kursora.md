---
id: EVM-115
title: Weryfikator wdrożeń — utwardzenie linków next, kursora Activity i budżetu żądań
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P2
path: pelna            # kod kanału wdrożeń (SR-INFRA-13/14), przegląd security
owner: backend-developer
contributors: []
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-115: Weryfikator wdrożeń — utwardzenie linków next, kursora Activity i budżetu żądań

## Cel
Jako **właściciel produktu** chcę **ściślejszych kontroli w `services/deploy-agent`**, aby **kanał wdrożeń odrzucał podejrzane odpowiedzi API GitHub jak najwcześniej i w jednoznaczny sposób**. Źródło: przegląd security PR #103 (1 minor, 2 nit) i logowanie potrzebne do EVM-116.

## Kryteria akceptacji

**AC1 — Zmiana ID repozytorium w `next` odrzucana natychmiast (minor)**
- Zakładając pierwszą stronę wyników z linkiem `next` adresowanym po `/repositories/<id>/…`
- Gdy kolejny link `next` (lub pierwszy `next` w stosunku do `<id>` z bieżącego cyklu) ma inne `<id>` repozytorium
- Wtedy cykl kończy się odrzuceniem w chwili parsowania linku (bez wykonania żądania pod ten adres i bez odroczenia do następnej strony), z powodem w logu; test negatywny na atrapie `linkStyle: 'repositories'`.

**AC2 — Przełączenie kursora Activity zabronione (nit)**
- Zakładając żądanie Activity z kursorem `after`
- Gdy link `next` zawiera kursor `before` (lub odwrotnie) — ten sam klucz kursora co w bieżącym żądaniu jest dozwolony, inny nie
- Wtedy link jest odrzucony przed wykonaniem żądania; testy dla obu kierunków i dla poprawnego przejścia `after`→`after`.

**AC3 — Osobne pole `nextRejected` w odpowiedzi strony (nit)**
- Zakładając typ `JsonPage`, w którym odrzucenie `next` jest dziś zakodowane znacznikiem w napisie
- Gdy link `next` zostaje odrzucony
- Wtedy wynik niesie osobne pole logiczne `nextRejected` (bez znaczników w napisach), a wszystkie miejsca odczytu go używają; testy jednostkowe nie odwołują się do napisu znacznika.

**AC4 — Znacznik nie zużywa budżetu żądań**
- Zakładając budżet żądań na cykl
- Gdy wywołanie `json(...)` kończy się odrzuceniem `next` (ścieżka bez wykonania żądania)
- Wtedy licznik żądań cyklu się nie zmienia (asercja liczby żądań przed/po); drugi test: wyczerpanie budżetu nadal daje `fail-closed`.

**AC5 — Dziennik odrzuceń bez danych wrażliwych**
- Zakładając odrzucenie z AC1–AC2
- Gdy zapisuję je w logu
- Wtedy log zawiera kod powodu i operację, a nie zawiera tokenów, pełnych adresów z zapytaniem ani sygnatur; test sprawdza brak tych wartości.

## Poza zakresem
- Zawężenie `artifactHosts` i test na żywym API (EVM-116).
- Wiązanie artefaktu z próbą (F2; EVM-122).
- Jakakolwiek zmiana konfiguracji na VM (SSH zamknięty od 2026-10-27; wymaga sesji IaC Konrada).

## Decyzje i ograniczenia
- Zmiana wchodzi do VM dopiero po przebudowie obrazu weryfikatora z `main` w sesji IaC (runbook) — wdrożenie nie jest częścią tej historyjki.
- Fail-closed bez zmian; brak nowych zależności.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z przeglądu security PR #103
