---
id: EVM-136
title: "API: wizja lokalna — przypisanie klienta, reguła „Zaakceptowane wymaga klienta”, odrzucenie wizji"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # nowa operacja zmieniająca dane zlecenia, reguła domeny, IDOR
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-135]
---

# EVM-136: API — przypisanie klienta i reguła akceptacji wizji

## Cel
Jako **pracownik biura** chcę **przypisać klienta do wizji lokalnej, gdy oferta zostanie zaakceptowana (albo oznaczyć wizję jako odrzuconą)**, aby **wizja płynnie stała się zwykłym zleceniem — z tymi samymi zdjęciami, filmami i wpisami — albo zniknęła po krótkim czasie**. To „konwersja” z analizy (security W3): bez przenoszenia mediów, bo identyfikatory się nie zmieniają.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w stanie „Wycena”; **klient wymagany dopiero przy przejściu do „Zaakceptowane”**; bez osobnego bytu.
2. Zwykły numer zlecenia od razu (numer zostaje po przypisaniu klienta). 3. Odrzucona — usuwana po 14 dniach (EVM-139).
4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro.
6. Oferta w systemie — poza zakresem. 7. Kolejność: EVM-133 → wizja → EVM-112 → EVM-111.

## Kryteria akceptacji
Role: Administrator i Edytor — tak (kanał web); Tylko odczyt — `403`/`404`; niezalogowany — `401`; kanał `mobile` — nie (`channel_not_allowed`).

**AC1 — Przypisanie klienta (jednorazowe)**
- Zakładając wizję (zlecenie bez klienta) i istniejącego, nieusuniętego klienta
- Gdy Edytor lub Administrator przypisuje klienta (`PUT /work-orders/{id}/customer` z `customerId` i `version`)
- Wtedy zlecenie ma klienta, ten sam numer, te same media i wpisy, powstaje wpis w dzienniku zlecenia i audyt (bez wartości danych), pole „telefon zamawiającego” jest wyczyszczone, a przy zleceniu z klientem wizja przestaje wygasać.

**AC2 — Klient tylko raz, idempotencja, konflikty**
- Zakładając zlecenie, które ma już klienta, albo nieaktualną `version`
- Gdy ponawiam przypisanie
- Wtedy ten sam `customerId` zwraca sukces bez zmian (idempotencja), inny — `409 customer_already_set`, nieaktualna wersja — `409` z aktualną wersją, a zmiana klienta zwykłego zlecenia nadal jest niemożliwa (`customerId` w `PATCH` — `400 read_only_field`).

**AC3 — IDOR i klient niedostępny**
- Zakładając cudzą lub nieistniejącą wizję, klienta usuniętego lub zanonimizowanego albo Tylko odczyt
- Gdy przypisuję klienta
- Wtedy dostaję te same odpowiedzi dla „brak” i „brak dostępu” (`404`), klient usunięty lub zanonimizowany — `422 customer_unavailable`, Tylko odczyt — `403`, a żadna z tych prób nie zmienia danych; podwójne równoległe przypisanie dwóch różnych klientów kończy się jednym sukcesem i jednym `409`.

**AC4 — „Zaakceptowane” wymaga klienta**
- Zakładając zlecenie bez klienta w statusie „Wycena” lub „Wstrzymane”
- Gdy przechodzę do „Zaakceptowane” (także przez wznowienie z „Wstrzymane”)
- Wtedy dostaję `409 customer_required` i zlecenie zostaje bez zmian; ze zleceniem z klientem przejście działa jak dotąd; test przejść po grafie potwierdza, że żadna ścieżka nie omija reguły (jak AC7 EVM-030).

**AC5 — Operacje wymagające klienta**
- Zakładając wizję bez klienta
- Gdy próbuję dodać plan płatności lub transze, wygenerować dokument dla klienta albo wyeksportować archiwum ZIP
- Wtedy dostaję `409 customer_required` (lista operacji zamknięta w teście; zakres i procesy można dodawać ręcznie), a po przypisaniu klienta operacje działają jak dla zwykłego zlecenia.

**AC6 — Odrzucenie wizji**
- Zakładając wizję w statusie „Wycena” albo „Wstrzymane”
- Gdy Edytor lub Administrator odrzuca wizję (przejście do „Anulowane” z kodem powodu „Oferta odrzucona” albo „Rezygnacja klienta”)
- Wtedy zlecenie jest „Anulowane” z kodem powodu, podaje datę usunięcia (dziś + 14 dni), powstaje audyt bez treści; odrzucenie zwykłego zlecenia działa jak dotąd; Administrator może przywrócić wizję (zgodnie z EVM-030), co czyści datę usunięcia.

**AC7 — Telefon zamawiającego i synchronizacja po przypisaniu**
- Zakładając wizję w replice telefonu twórcy i biuro przypisujące klienta
- Gdy telefon pobiera zmiany
- Wtedy dostaje migawkę klienta i zlecenie z klientem (test integracyjny ścieżki „nieznany klient w rekordzie zlecenia”, ADR-0021 D3), a lista i overview w panelu pokazują klienta bez ponownego logowania.

## Poza zakresem
Odrzucenie z aplikacji (przejścia statusów tylko w panelu); zmiana klienta wizji po przypisaniu; łączenie wizji z istniejącym zleceniem; automatyczne usuwanie i przypomnienia (EVM-139, EVM-140); ekrany (EVM-138); oferta, CRM, deduplikacja, CHECK w bazie (reguła w domenie).

## Decyzje i ograniczenia
- Nowe kody: `customer_required`, `customer_already_set`, `customer_unavailable` (poprawić słownik problemów i kontrakt addytywnie); nowa akcja audytu; kod powodu odrzucenia — wartości stałe, nie tekst swobodny.
- **Bezpieczeństwo:** W2, W3, W11; autoryzujemy wizję i klienta; media i wpisy nie zmieniają identyfikatorów (konflikt „biuro przypisuje, technik dokłada zdjęcia” nie istnieje).
- **Pytania do Konrada:**
  1. Telefon zamawiającego po przypisaniu klienta: wyczyścić (rekomendacja — biuro przepisuje do karty klienta; minimalna retencja) czy zostaje na zleceniu? Konsekwencja „zostaje”: dodatkowe dane osobowe przez 6 lat poza kartą klienta.
  2. Kody powodu odrzucenia: „Oferta odrzucona”, „Rezygnacja klienta” (rekomendacja; 2 wartości) — czy potrzebne „Inne”?
- **Konsultacje przed `ready`:** architekt (ADR-0024: miejsce reguły, kontrakt `PUT customer`, audyt), security (przegląd IDOR, W3).

## Dziennik
- 2026-11-16 — szkic (product-owner)
