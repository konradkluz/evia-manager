---
id: EVM-106
title: "Aplikacja: szybkie zlecenie z telefonu"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: in-review
priority: P1
path: pelna             # synchronizacja offline, dane osobowe (nowy klient i adres)
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet           # formularz, lokalny zapis do gotowej kolejki (EVM-107) i pobranie katalogu; bez kodu natywnego
depends_on: [EVM-099, EVM-103, EVM-104, EVM-105, EVM-107, EVM-127]
---

# EVM-106: Aplikacja — szybkie zlecenie z telefonu

## Cel
Jako **technik** chcę **założyć zlecenie na miejscu (klient + adres + szablon) także bez zasięgu**, aby **od razu je dokumentować**, a biuro uzupełni resztę. Makieta M-10 ([`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md)). Podział z 2026-11-13: pobranie szablonów to nowa luka (API — EVM-127), a „Utwórz ponownie” z przeniesieniem zależnych wydzielono do EVM-128 (kolejność tej samej kolejki: 104 → 105 → 127 → 106).

## Kryteria akceptacji

**AC1 — Szablony w telefonie**
- Zakładając zalogowanego technika (Administrator lub Edytor) i działającą synchronizację z siecią
- Gdy kończy się cykl synchronizacji (w tym pierwsze pobranie)
- Wtedy aplikacja pobiera aktywne szablony (EVM-127) do zaszyfrowanej bazy lokalnej i zastępuje poprzedni zestaw atomowo (błąd pobrania zostawia stary zestaw); formularz offline korzysta z zapisanego zestawu; szablony nie są danymi osobowymi, a wylogowanie i wyczyszczenie danych kasują je razem z resztą; brak szablonów w telefonie: „Brak szablonów w telefonie. Połącz się z internetem, aby je pobrać.” i „Zapisz zlecenie” niedostępne.

**AC2 — Utworzenie offline i otwarcie**
- Zakładając brak sieci i szablony w telefonie
- Gdy wybieram klienta (istniejącego z telefonu albo nowego: rodzaj, nazwa, telefon), lokalizację (istniejącą albo nową: typ obiektu, ulica, nr budynku, nr lokalu, kod pocztowy, miasto, nr miejsca postojowego dla garażu), szablon (przefiltrowany po typie obiektu, domyślny tytuł z szablonu), tytuł i opcjonalnie notatkę (≤ 2000 znaków) i zapisuję
- Wtedy `CreateQuickWorkOrder` z nowymi identyfikatorami trafia do trwałej kolejki przed zamknięciem formularza (toast „Zapisano w telefonie. Numer nadamy po synchronizacji.”), zlecenie ma odznakę „Oczekuje na numer” (bez wymyślonego numeru), stoi na górze M-05 i otwiera się w M-03 (dane z kolejki, baner „Zapisano w telefonie. Numer nadamy po synchronizacji.”); mogę do niego dodawać wpisy (EVM-105), które czekają w kolejce za zleceniem („Wyślemy po utworzeniu zlecenia”).

**AC3 — Walidacja i podobni klienci**
- Zakładając wpisywanie danych
- Gdy pole jest błędne (telefon poza wzorcem kontraktu, nazwa osoby jednym wyrazem, brak adresu, kod pocztowy inny niż `00-000`, tytuł pusty lub > 200 znaków) albo telefon (znormalizowany do E.164) lub nazwa (bez polskich znaków, bez rozróżniania wielkości liter) nowego klienta pasuje do klienta z telefonu
- Wtedy błędy są przy polach i w podsumowaniu z fokusem (np. „Podaj numer telefonu, np. 600 000 001.”, „Podaj adres lokalizacji.”), nic nie trafia do kolejki, a dla podobnego klienta aplikacja podpowiada „W telefonie jest podobny klient: … [Wybierz]” (lokalne wyszukiwanie przed utworzeniem; nowy klient ma wyłącznie rodzaj, nazwę i telefon; serwer niczego nie deduplikuje).

**AC4 — Synchronizacja**
- Zakładając zlecenie utworzone offline
- Gdy wraca sieć
- Wtedy trafia na serwer raz (także po resyncu i po zabiciu aplikacji przed wysłaniem — test Maestro, scenariusz 2) i dostaje numer: odznaka zamienia się na numer, ogłoszenie „Zlecenie dostało numer ZL-…” (TalkBack) nie przerywa pracy, a zależne wpisy wysyłają się w kolejności; po 24 h bez numeru nie ma osobnej akcji (patrz Poza zakresem).

**AC5 — Odrzucenie**
- Zakładając `id_conflict`, `template_unavailable`, `validation_failed` lub `quota_exceeded`
- Gdy serwer odrzuca zlecenie
- Wtedy zlecenie i zależne wpisy trafiają do „Wymaga uwagi” jako jedna grupa (zlecenie + liczba zależnych elementów) z powodem prostymi słowami i oddzielnie „Usuń z telefonu” (dialog z liczbą zależnych); nieznany kod daje ogólny „Wymaga uwagi” (słownik otwarty); „Utwórz ponownie” z formularzem i przeniesieniem zależnych — EVM-128 (do tego czasu akcja zachowuje się jak w EVM-107).

**AC6 — Tryb ukrytych danych i prywatność**
- Zakładając tryb ukrytych danych (EVM-101) albo wylogowanie
- Gdy próbuję otworzyć formularz albo jest otwarty w chwili wejścia w tryb
- Wtedy formularz jest niedostępny („Nowe zlecenie założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej.”) i zerowany bez szkicu; dane nowego klienta i adresu istnieją wyłącznie w kolejce (SQLCipher), a w polach nazwy, telefonu i adresu autouzupełnianie, autokorekta i sprawdzanie pisowni są wyłączone; dane nie trafiają do logów, parametrów nawigacji ani stanu odtwarzanego po śmierci procesu.

## Poza zakresem
- Edycja zlecenia po utworzeniu, scalanie klientów w biurze i deduplikacja na serwerze, zdjęcia do nowego zlecenia (E11).
- „Utwórz ponownie” z przeniesieniem zależnych (EVM-128), baner dla zlecenia czekającego na numer dłużej niż 24 h i licznik zależnych w wierszu Kolejki (rekomendacja — dopracowanie po teście terenowym), szkic formularza zapisywany w telefonie (pytanie 3).

## Decyzje i ograniczenia
- UX / UI: M-10 oraz „Oczekuje na numer” i grupa odrzuconego zlecenia — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (M-07, M-10). Osoba: pola „Imię” i „Nazwisko” składają jedną nazwę (kontrakt ma jedno pole `displayName`). Stany: pusty („Z telefonu” bez klientów → od razu „Nowy klient”; brak szablonów — AC1), błąd (AC3; brak miejsca w telefonie: „Brak miejsca — zlecenie zostaje w formularzu.”), offline (normalna praca), brak uprawnień / ukryte dane (AC6). Wyłącznie komponenty i tokeny ze styleguide'u (FilterChip, TextField, SelectableCard, InlineAlert, dolny pasek akcji); wejście z „Dodaj → Nowe zlecenie” (już istnieje w AddSheet).
- Uprawnienia: Administrator i Edytor; Tylko odczyt nie loguje się do aplikacji (decyzja Konrada 2026-11-12); niezalogowany — logowanie.
- Zależność nowa względem pierwotnej: EVM-127 (źródło szablonów), EVM-105 (wpisy do zlecenia oczekującego), EVM-104 (ekran szczegółów, w tym wariant zlecenia z kolejki).
- Limit serwera: 20 nowych klientów i lokalizacji na 24 h na urządzenie (`quota_exceeded`, EVM-099) — odrzucenie jak w AC5.
- Automatyczne przeniesienie zależnych przy „Utwórz ponownie” — decyzja 13 planu M2 (rekomendacja „Tak”), realizacja w EVM-128.
- Ryzyko rezydualne klawiatury (EVM-103) bez zmian; dane nowego klienta nie są wpisywane do pól z uczeniem słów tam, gdzie da się to wyłączyć standardowymi właściwościami pola.

## Notatki
- Największa historyjka kolejki (formularz, katalog, kolejka). Linia cięcia, gdyby zabrakło czasu: lokalne podpowiedzi podobnych klientów (część AC3) — do osobnej historyjki; reszta AC bez zmian.
- Ogłoszenie nadania numeru nie zawiera danych klienta ani adresu.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
- 2026-11-13 — refinement do DoR: 6 AC; podział — szablony dla telefonu (EVM-127, luka: kanał web only) i „Utwórz ponownie” (EVM-128); dopisane zależności EVM-104/105/127; usunięto baner 24 h i szkic (YAGNI); pytania 1 i 3 do Konrada z rekomendacją; status `draft` do akceptacji (product-owner)
- 2026-11-13 — akceptacja Konrada (DoR) do nocnej kolejki `/noc-2026-11-13`: kolejność toru A 104 → 105 → 127 → 106 (tor B: 126 → 066), autokorekta zostaje w długich tekstach (wyłączona w polach klienta, telefonu, adresu; autofill wszędzie wyłączony), bez szkiców i „ostatnio otwieranych” w M2, EVM-126 — budowa panelu bez adresu kończy się błędem; status `ready` (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-13` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-13-mobile` (EVM-104, EVM-105, EVM-127 `in-review` na tej gałęzi)
- 2026-11-14 — plan gotowy (mobile-developer)
- 2026-11-14 — implementacja (mobile-developer): szablony w SQLCipher przez bramę sesji, formularz M-10, szczegóły zlecenia z kolejki, grupa odrzucenia, przepływy Maestro 43-*; podpowiedź „podobny klient” w całości (bez linii cięcia)
- 2026-11-14 — poprawki po przeglądach (mobile-developer): szablony pobierane tylko po udanym cyklu, zerowanie niepasującego szablonu po zmianie typu obiektu, obrona onPick w trybie ukrytych danych
- 2026-11-14 — workflow `deliver-story` (pelna) `passed` po 2 rundach (wznowiony po awarii sesji): QA pass (AC1–AC6, całość — bez linii cięcia), code-reviewer i security-engineer approve w rundzie 1, ux-designer approve w rundzie 2 (podsumowanie formularza ogłasza pytanie o podobnego klienta). Po przeglądach trzy poprawki (`a4aefaac`). Bramka orkiestratora `pnpm run gate` zielona — pokrycie zmienionego kodu gałęzi 97,8% linii, 94,5% gałęzi. E2E Maestro (przepływy 43-*) — końcowy przebieg toru A z klonu `C:`. Do decyzji Konrada: ograniczenie pobierania szablonów do raz na 10–15 min (dziś po każdym udanym cyklu, wg AC1). Koszt: 11 agentów, ok. 957 tys. tokenów, ok. 50 min po wznowieniu. Status `in-review` (Tech Lead, kolejka nocna)
