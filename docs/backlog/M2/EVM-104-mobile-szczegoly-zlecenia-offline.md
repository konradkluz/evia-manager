---
id: EVM-104
title: "Aplikacja: szczegóły zlecenia offline"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: draft
priority: P1
path: lekka
owner: mobile-developer
contributors: []
reviewers: [ux-designer]
model: sonnet
depends_on: [EVM-103, EVM-097]
---

# EVM-104: Aplikacja — szczegóły zlecenia offline

## Cel
Jako **technik** chcę **otworzyć zlecenie bez zasięgu i zobaczyć klienta, adres, zakres, etapy i dziennik**, aby **wiedzieć, co jest do zrobienia na miejscu**. Makieta M-03 ([`03-szczegoly-zlecenia.md`](../../ux/flows/03-szczegoly-zlecenia.md)).

## Kryteria akceptacji

**AC1 — Dane zlecenia**
- Zakładając zsynchronizowane zlecenie i brak sieci
- Gdy je otwieram
- Wtedy widzę klienta (z telefonem do wybrania), lokalizację (adres, miejsce, moc przyłączeniową), zakres, procesy z etapami i ich statusami oraz dziennik wpisów.

**AC2 — Elementy oczekujące**
- Zakładając wpisy lub zdjęcia utworzone na telefonie i jeszcze niewysłane
- Gdy oglądam dziennik
- Wtedy są oznaczone jako oczekujące, a po wysłaniu zmieniają się w zwykłe wpisy bez duplikatu.

**AC3 — Brak dostępu**
- Zakładając zlecenie, które wyszło z zakresu lub zostało usunięte w biurze
- Gdy próbuję je otworzyć
- Wtedy widzę komunikat „zlecenie niedostępne”, a oczekujące elementy tego zlecenia są nadal na liście „Wymaga uwagi” (nic nie ginie).

**AC4 — Dostępność i tryb ukryty**
- Zakładając tryb ukrytych danych
- Gdy otwieram zlecenie
- Wtedy dane osobowe są niewidoczne; w trybie normalnym telefon jest akcją dostępną przez TalkBack.

## Poza zakresem
Edycja etapów i danych z telefonu (po MVP), płatności, pliki dokumentów.

## Notatki
- Telefon klienta: `tel:` otwiera wybieranie numeru (`ACTION_DIAL`), bez uprawnienia `CALL_PHONE`; bez „otwórz w mapach” do czasu decyzji (adres trafiałby do zewnętrznej usługi).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
