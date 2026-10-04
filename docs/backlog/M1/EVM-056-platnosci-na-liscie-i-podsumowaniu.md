---
id: EVM-056
title: Płatności na liście zleceń i w podsumowaniu zlecenia
type: story
milestone: M1
epic: E7 Płatności etapowe
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-034, EVM-054, EVM-069]
---

# EVM-056: Płatności na liście zleceń i w podsumowaniu zlecenia

## Historyjka
Jako **pracownik biura** chcę **widzieć na liście zleceń i w podsumowaniu zlecenia, co jest nieopłacone i po terminie, oraz mieć listę posortowaną od najpilniejszych**, aby **zaczynać dzień od spraw, które wymagają działania**.

## Kontekst
- **Wymaga ADR EVM-069** (model odczytu — luka L3): kolumna „Płatność”, widoki „Po terminie” i „Nieopłacone”, sortowanie „Najpilniejsze” łączą dane `payments` i `procedures` z listą `work-orders`.
- Makiety: [W-10](../../ux/flows/07-lista-zlecen-i-filtry.md#w-10-lista-zleceń) (kolumna „Płatność”, widoki, „Najpilniejsze” — § 4.2 styleguide'u), [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (kafel „Płatności”).

## Kryteria akceptacji
**AC1 — Kolumna „Płatność”**
- Zakładając zlecenia: z transzą po terminie (3 600,00 zł), z jedną wystawioną (4 500,00 zł), z wszystkimi opłaconymi i bez wystawionych
- Gdy otwieram W-10
- Wtedy kolumna pokazuje odpowiednio: mocną odznakę „Po terminie” z kwotą, „Nieopłacone (1)” z sumą, „Opłacone”, „—”.

**AC2 — Widoki „Po terminie” i „Nieopłacone”**
- Gdy wybieram widok „Po terminie” albo „Nieopłacone”
- Wtedy lista zawiera zlecenia z transzą po terminie albo z transzą „Wystawiona”, a URL zawiera tylko identyfikator widoku.

**AC3 — Sortowanie „Najpilniejsze”**
- Gdy wybieram „Najpilniejsze” (od tej historyjki — domyślne sortowanie W-10)
- Wtedy najpierw są zlecenia z płatnością i etapem po terminie, potem z najdłuższym oczekiwaniem powyżej progu, potem wg najbliższego terminu rosnąco — zgodnie z definicją w ADR EVM-069.

**AC4 — Kafel „Płatności” w W-06**
- Gdy otwieram zlecenie z 4 transzami
- Wtedy kafel pokazuje „Nieopłacone: 3 600,00 zł (1)”, „Po terminie” z liczbą dni, „Planowane: 3” i „Opłacone: 0 z 4”.

**AC5 — Po terminie liczone z daty**
- Zakładając zegar `Europe/Warsaw` przestawiony z 2026-10-07 na 2026-10-08 i transzę z terminem 2026-10-07
- Gdy odświeżam listę
- Wtedy transza jest „po terminie” dopiero 2026-10-08 — wartość jest liczona w zapytaniu, nie zapisywana.

**AC6 — Polityka i wydajność (SR-AUTHZ-03)**
- Zakładając 10 000 syntetycznych zleceń
- Gdy sortuję „Najpilniejsze” z widokiem „Nieopłacone”
- Wtedy p95 czasu odpowiedzi API jest < 300 ms, bez zapytań N+1, a zlecenia spoza uprawnień nie wpływają na kolejność ani sumy.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A, E i R (P6) widzą kolumnę, widoki i kafel; niezalogowany — `401`.

**AC8 — Stany**
- Wtedy offline — dane z pamięci karty z banerem; błąd kafla — alert w kaflu; `429` — wzór z README makiet.

## Poza zakresem
- Pulpit z lejkiem zleceń i nieopłaconymi — M3. Zapamiętywanie sortowania po stronie serwera — później.

## UX / UI
- W-10: kolumna „Płatność” (StatusBadge `color.status.payment.overdue.*`, kwoty `text.numeric`), zapisane widoki, sortowanie; W-06: kafel „Płatności”. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | kolumna, widoki, kafel |
| Edytor | kolumna, widoki, kafel |
| Tylko odczyt | kolumna, widoki, kafel |
| Niezalogowany | brak (`401`) |

- Dane: kwoty i statusy (WF).
- W AC: SR-AUTHZ-03, SR-AUTHZ-05. W sekcji: SR-API-04 (parametry bez danych osobowych), SR-API-02. Polityka P6.

## Notatki techniczne
- Moduły: zgodnie z [ADR-0017](../../architecture/adr/0017-model-odczytu-listy-i-podsumowania-zlecenia.md) (EVM-069; status „Proponowana” — wariant zależy od decyzji Konrada na `/adr`): `overview` (moduł z EVM-034), `payments`, `work-orders` + panel. Wartości sortowania i widoków dodawane addytywnie do enumów z EVM-017.
- **Projekcja `overview`** dostaje sygnały płatności jako zmianę *expand*:
  - kolumny `invoiced_count`, `paid_count`, `earliest_invoiced_due_date` z wartością domyślną;
  - wypełnienie poleceniem `rebuild`;
  - handlery zdarzeń `PaymentMilestone` i port systemowy `payments` (status i termin transz, bez kwot — W5).

  Projekcja nie przechowuje kwot. Sumy (wystawione, po terminie z tym samym „dziś”) zwraca fasada `payments` jednym zapytaniem wsadowym na stronę.
- **Kontrakt wyłącznie addytywnie:**
  - `sort`: `urgency`;
  - `view`: `overdue_payments`, `unpaid`;
  - pole listy `payment` (stan jako `x-extensible-enum`, liczba wystawionych, sumy);
  - pola `PaymentMilestone.isOverdue` i `PaymentMilestone.overdueDays`.

  Domyślne sortowanie API z EVM-017 zostaje bez zmian. W-10 wysyła `sort=urgency` jawnie (domyślne sortowanie AC3 to decyzja UI).
- Definicje D6–D9 i D13 z ADR-0017 → „Definicje wyliczeń”: „Najpilniejsze” — grupy i klucze (pytanie 3 ADR-0017); kolumna „Płatność” (pytanie 4); widoki tylko dla zleceń niezamkniętych (pytanie 7).
- **W4:** sortowanie „Najpilniejsze” (składowa płatności), widoki płatności i pole `payment` wymagają prawa odczytu płatności (v1: A, E, R — P6). Reguła jest w `x-evia-authz` (pole `payment` w `hiddenFields`, ograniczenie wartości `view` i `sort`). Kontrola ma test jednostkowy z atrapą polityki.
- Plan techniczny obejmuje W1–W12 i testy z ADR-0017 dla sygnałów płatności: wydajność „Najpilniejsze” z widokiem „Nieopłacone” (AC6), licznik zapytań, polityka (zlecenie spoza uprawnień nie zmienia kolejności ani sum), granice dat 2026-10-07 / 2026-10-08 i zmiana czasu 2026-10-25, T1–T4.
- Dokumenty do aktualizacji przy implementacji:
  - `docs/security/rodo.md` — inwentaryzacja `PaymentMilestone`: w kolumnie „Gdzie” miejsce „projekcja `overview` (serwer)”, bez kwot (W1);
  - `domain-model.md` — pola wyliczane transzy w „Pola kontrolowane przez serwer”.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-056 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
