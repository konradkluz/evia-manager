---
id: EVM-103
title: "Aplikacja: lista zleceń offline i wyszukiwanie"
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
depends_on: [EVM-107]
---

# EVM-103: Aplikacja — lista zleceń offline i wyszukiwanie

## Cel
Jako **technik** chcę **widzieć listę zleceń i szukać po numerze, kliencie lub adresie także bez zasięgu**, aby **znaleźć właściwe zlecenie na miejscu w garażu**. Makieta M-05 ([`07-lista-zlecen-i-filtry.md`](../../ux/flows/07-lista-zlecen-i-filtry.md)).

## Kryteria akceptacji

**AC1 — Lista z bazy lokalnej**
- Zakładając zsynchronizowane zlecenia i brak sieci
- Gdy otwieram „Moje zlecenia”
- Wtedy widzę zlecenia z lokalnej bazy (numer, klient, adres, status, etap), w tym oczekujące utworzone na telefonie z oznaczeniem; w v1 zakres obejmuje wszystkie zlecenia w zakresie urządzenia.

**AC2 — Wyszukiwanie lokalne**
- Zakładając listę
- Gdy wpisuję numer, nazwę klienta, ulicę lub numer miejsca postojowego
- Wtedy wyniki pojawiają się offline tak samo jak online (od 1 znaku, na bieżąco, także po fragmencie numeru), bez rozróżniania wielkości liter i polskich znaków diakrytycznych; zapytanie nie jest zapisywane ani logowane.

**AC3 — Stany**
- Zakładając brak zleceń, brak wyników, pierwsze pobranie (ekran M-12 z EVM-107), tryb ukrytych danych (EVM-101)
- Gdy otwieram listę
- Wtedy widzę odpowiedni stan pusty/komunikat z akcją zgodnie z makietą; brak wyników pokazuje „Szukamy tylko w zleceniach zapisanych w telefonie” oraz, offline lub przy danych starszych niż 1 h, czas ostatniej synchronizacji; w trybie ukrytych danych lista nie pokazuje nazw ani adresów, pole wyszukiwania i chipy nie są renderowane, a zapytanie jest czyszczone w chwili wejścia w ten tryb.

**AC4 — Brak danych poufnych**
- Zakładając listę
- Gdy sprawdzam ją
- Wtedy nie ma płatności ani danych spoza projekcji telefonu.

**AC5 — Chipy i zlecenia oczekujące**
- Zakładając zlecenia, w tym utworzone na telefonie i czekające na numer, oraz elementy w Kolejce
- Gdy oglądam listę
- Wtedy dostępne są chipy „Wszystkie” i „Niewysłane (n)” (zlecenia z elementami w Kolejce), a zlecenia oczekujące na numer stoją na górze listy do czasu nadania numeru (przeszukiwane po adresie i kliencie).

## Poza zakresem
Filtry zaawansowane i sortowanie niestandardowe, „Moje” i „Czekamy na…” (rola Monter — M4, dane procesu).

## Decyzje i ograniczenia
- UX / UI: wyszukiwanie offline, stany, tryb ukrytych danych, chipy — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-05). Chipy „Wszystkie / Niewysłane (n)” to odstępstwo od makiety M-05 wymagające zgody Konrada (README planu, decyzja 12) i wpisu w changelogu styleguide'u.

## Notatki
- Wyszukiwanie i indeks pełnotekstowy wyłącznie w bazie SQLCipher.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
