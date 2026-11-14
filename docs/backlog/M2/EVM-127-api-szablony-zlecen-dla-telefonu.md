---
id: EVM-127
title: "API: szablony zleceń dostępne dla telefonu"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: ready
priority: P1
path: pelna             # zmiana uprawnień i kanału endpointu
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-099]
---

# EVM-127: API — szablony zleceń dostępne dla telefonu

## Cel
Jako **technik** chcę, aby **telefon mógł pobrać aktywne szablony zleceń**, aby **założyć szybkie zlecenie (EVM-106) także bez zasięgu**. Luka znaleziona przy refinemencie EVM-106 (2026-11-13): `CreateQuickWorkOrder` wymaga `templateId`, a szablony są w katalogu biura (`catalog.work_order_templates`), który nie należy do replikowanych encji telefonu, a endpoint `listWorkOrderTemplates` jest dziś dostępny tylko dla kanału web.

## Kryteria akceptacji

**AC1 — Lista szablonów dla kanału mobile**
- Zakładając Administratora lub Edytora zalogowanego z zarejestrowanego urządzenia (kanał mobile)
- Gdy pobiera aktywne szablony zleceń (opcjonalnie z filtrem typu obiektu)
- Wtedy dostaje `200` z tą samą treścią co w panelu (aktywne szablony z podglądem: pozycje, procesy, liczba transz), wycofane są pominięte, a nieznany parametr lub zła wartość filtra daje `400`.

**AC2 — Uprawnienia i kanały**
- Zakładając macierz ról i kanałów
- Gdy wywołuję endpoint jako niezalogowany, jako Tylko odczyt na kanale mobile, z urządzenia oznaczonego do wyczyszczenia albo z kanału spoza listy
- Wtedy dostaję odpowiednio `401`, `403` (`channel_not_allowed`), `401 device_wipe_required` i `403`; dotychczasowe zachowanie kanału web (Administrator, Edytor, Tylko odczyt) nie zmienia się; test macierzy ról i kanałów obejmuje wszystkie przypadki.

**AC3 — Kontrakt i brak danych osobowych**
- Zakładając kontrakt OpenAPI i test zgodności kontraktu mobilnego
- Gdy kanał mobile zostaje dopisany do operacji
- Wtedy zmiana jest addytywna (bez złamania wersji aplikacji w polu), odpowiedź nie zawiera danych klientów, kwot z płatności zleceń ani danych użytkowników (wyłącznie katalog biura), a wygenerowane typy i test kontraktu przechodzą.

## Poza zakresem
- Pobieranie szablonów procesów i etapów oraz planów płatności jako osobnych zasobów; zmiany w panelu; zapis szablonów na telefonie (EVM-106).
- Replikacja katalogu przez dziennik zmian (`/sync/changes`) — wybrano zwykłe pobranie, bo zbiór jest mały i zwracany w całości.

## Decyzje i ograniczenia
- Uprawnienia: dostęp do odczytu dla Administratora i Edytora na kanale mobile; Tylko odczyt nie loguje się do aplikacji (decyzja Konrada 2026-11-12). Decyzja Konrada 2026-11-13 (pytanie 1): wąskie rozszerzenie istniejącego endpointu zamiast nowego zasobu (najtaniej, bez nowego modelu).
- Odpowiedź katalogu zawiera udziały procentowe transz planu płatności (to katalog biura, nie dane zlecenia); telefon może je ignorować.

## Dziennik
- 2026-11-13 — utworzono jako podział EVM-106 (luka: telefon nie ma źródła szablonów) (product-owner)
- 2026-11-13 — akceptacja Konrada (DoR) do nocnej kolejki `/noc-2026-11-13`: kolejność toru A 104 → 105 → 127 → 106 (tor B: 126 → 066), autokorekta zostaje w długich tekstach (wyłączona w polach klienta, telefonu, adresu; autofill wszędzie wyłączony), bez szkiców i „ostatnio otwieranych” w M2, EVM-126 — budowa panelu bez adresu kończy się błędem; status `ready` (Tech Lead)
