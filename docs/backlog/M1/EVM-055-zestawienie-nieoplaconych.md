---
id: EVM-055
title: Zestawienie nieopłaconych i po terminie
type: story
milestone: M1
epic: E7 Płatności etapowe
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-054]
---

# EVM-055: Zestawienie nieopłaconych i po terminie

## Historyjka
Jako **pracownik biura albo księgowa (Tylko odczyt)** chcę **jedno zestawienie wystawionych, a nieopłaconych faktur — najpierw po terminie — z sumami**, aby **wiedzieć, komu przypomnieć o płatności i ile pieniędzy czeka**.

## Kontekst
- Słownik: „nieopłacone” = transze „Wystawiona” (także po terminie); „po terminie” = „Wystawiona” z terminem wcześniejszym niż dziś (`Europe/Warsaw`) — wyliczane, niezapisywane.
- P6: Tylko odczyt widzi płatności (decyzja 7 z EVM-004: księgowość = Tylko odczyt).
- Makieta: [W-11](../../ux/flows/08-nieoplacone.md#w-11-nieopłacone). Scenariusze: A12, A13, B9, C7.

## Kryteria akceptacji
**AC1 — Zestawienie**
- Zakładając 12 transz „Wystawiona” w różnych zleceniach
- Gdy otwieram „Płatności” w Sidebarze
- Wtedy widzę tabelę (termin, dni po terminie, zlecenie, klient, transza, nr faktury, kwota, status) posortowaną „Najdłużej po terminie”, z paginacją; wiersz prowadzi do W-06, a A i E mają „Odnotuj wpłatę” (EVM-054).

**AC2 — Po terminie**
- Zakładając zegar `Europe/Warsaw` = 2026-10-03 i transze z terminami 2026-09-28 i 2026-10-03
- Gdy otwieram zestawienie
- Wtedy pierwsza ma „Po terminie” z „5 dni” (ikona, etykieta i liczba — nie sam kolor), a druga jest „Wystawiona” bez oznaczenia.

**AC3 — Kafle i suma (SR-AUTHZ-03)**
- Gdy otwieram zestawienie
- Wtedy kafle pokazują „Nieopłacone: 12 transz · 48 300,00 zł”, „Po terminie: 4 · 15 200,00 zł” i „Najdłużej po terminie: 21 dni · ZL-2026-0031”, a suma pod tabelą zgadza się z filtrami — wszystkie liczone tą samą polityką co lista (warunek w zapytaniu).

**AC4 — Filtry (SR-API-04)**
- Gdy wybieram „Po terminie”, zakres terminów i klienta (wyszukiwanie klienta przez `POST …/search`)
- Wtedy lista i sumy się zawężają, w URL jest tylko „Wszystkie wystawione” / „Po terminie”, a zakres dat i klient są w pamięci karty.

**AC5 — Tylko odczyt (SR-AUTHZ-06, P6)**
- Zakładając rolę Tylko odczyt
- Gdy otwiera zestawienie
- Wtedy widzi kwoty, numery faktur, terminy i „Po terminie” bez akcji i bez `⋮`, a mutacje zwracają `403 forbidden`.

**AC6 — Limity (SR-API-02)**
- Wtedy rekordy zestawienia wliczają się do progu masowego odczytu (P10), a przekroczenie limitów daje `429` z komunikatem.

**AC7 — Uprawnienia (SR-AUTHZ-05)**
- Wtedy A, E i R widzą zestawienie, niezalogowany dostaje `401`; operacja jest w macierzy ról.

**AC8 — Stany**
- Wtedy: brak nieopłaconych — „Wszystkie wystawione faktury są opłacone.” (`circle-check`); brak wyników filtrów — „Brak transz spełniających filtry. [Wyczyść filtry]”; offline — dane z pamięci karty z banerem, akcje wyłączone; `412` / `409` w dialogu wpłaty — „Ktoś zmienił tę transzę…”.

## Poza zakresem
- Filtr „Do wystawienia” — EVM-059 (P2). Eksport zestawienia — M4 (Administrator). Przypomnienia o płatnościach — M3.

## UX / UI
- W-11: kafle sum (Card § 3.8), FilterChip, DatePicker zakres, Combobox klienta, DataTable (§ 3.6) z kwotami `text.numeric`, StatusBadge płatności. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | zestawienie, odnotowanie wpłaty |
| Edytor | zestawienie, odnotowanie wpłaty |
| Tylko odczyt | zestawienie (bez akcji) |
| Niezalogowany | brak (`401`) |

- Dane: kwoty, numery faktur, nazwy klientów (DO-K).
- W AC: SR-AUTHZ-03, SR-API-04, SR-AUTHZ-06, SR-API-02, SR-AUTHZ-05. Polityki P6, P10.

## Notatki techniczne
- Moduły: `payments` (lista), fasady `work-orders`, `customers` (wsadowo) + panel. „Po terminie” liczony w zapytaniu z wstrzykiwanego zegara.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-055 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona
- [ ] Demo i akceptacja użytkownika (scenariusz A12)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
