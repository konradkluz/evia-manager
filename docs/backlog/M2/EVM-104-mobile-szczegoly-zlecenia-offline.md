---
id: EVM-104
title: "Aplikacja: szczegóły zlecenia offline"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: in-review
priority: P1
path: pelna             # dane osobowe na urządzeniu (klient, adres, telefon), tryb ukrytych danych (zmiana z lekka — 2026-11-13)
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet           # ekran tylko do odczytu na gotowej replice (EVM-093/097/107) i wzorcu ekranu z EVM-103
depends_on: [EVM-103, EVM-097]
---

# EVM-104: Aplikacja — szczegóły zlecenia offline

## Cel
Jako **technik** chcę **otworzyć zlecenie bez zasięgu i zobaczyć klienta, adres, zakres, etapy i dziennik**, aby **wiedzieć, co jest do zrobienia na miejscu**. Makieta M-03 ([`03-szczegoly-zlecenia.md`](../../ux/flows/03-szczegoly-zlecenia.md), część „Telefon”: tylko odczyt z lokalnej bazy). Wiersze listy M-05 (EVM-103) są dotąd nieaktywne — ta historyjka je uaktywnia. Dane są już w replice (zlecenie, klient, lokalizacja, strony, pozycje zakresu, etapy, wpisy dziennika — EVM-097); historyjka dodaje wyłącznie ekran.

## Kryteria akceptacji

**AC1 — Otwarcie z listy i nagłówek**
- Zakładając zsynchronizowane zlecenie, zalogowanego technika (Administrator lub Edytor) i brak sieci
- Gdy dotykam wiersza zlecenia na M-05
- Wtedy otwiera się M-03 zbudowany wyłącznie z lokalnej bazy (bez żądania do serwera) z numerem, tytułem i statusem zlecenia; wiersz listy jest aktywny (rola przycisku, efekt naciśnięcia, nazwa dostępna z numerem), a „wstecz” wraca do listy z zachowaną pozycją; niezalogowany widzi ekran logowania, nie zlecenie.

**AC2 — Klient i lokalizacja**
- Zakładając otwarte zlecenie
- Gdy oglądam karty „Klient” i „Lokalizacja”
- Wtedy widzę nazwę klienta i jego telefon (akcja „Zadzwoń”, otwiera wybieranie numeru bez uprawnienia do połączeń; nazwa dostępna z nazwą klienta), adres, numer miejsca postojowego, poziom, moc przyłączeniową oraz nazwy OSD i zarządcy, jeśli są w telefonie; brak e-maila, NIP, PPE i płatności (poza projekcją telefonu); bez odnośnika „otwórz w mapach”; brakujące pole nie zostawia pustej etykiety.

**AC3 — Zakres, procesy i etapy**
- Zakładając zlecenie z pozycjami zakresu i procesami
- Gdy przeglądam sekcje „Zakres” i „Procesy i etapy”
- Wtedy widzę pozycje zakresu oraz procesy z etapami w kolejności z danych, każdy etap z odznaką statusu (komponent StatusBadge) i, dla „Czekamy na…”, nazwą strony; bez żadnej akcji zmiany (odczyt); zlecenie bez zakresu lub procesów pokazuje komunikaty z M-03 („Zlecenie nie ma jeszcze pozycji zakresu.”, „Zlecenie nie ma jeszcze procesów.”).

**AC4 — Dziennik i elementy oczekujące**
- Zakładając wpisy zsynchronizowane oraz wpisy lub komentarze utworzone na telefonie i jeszcze niewysłane (elementy kolejki tego zlecenia)
- Gdy oglądam dziennik
- Wtedy wpisy stoją od najnowszych (autor, czas, kategoria, treść; komentarze i zdarzenia rozróżnione znacznikiem i tekstem; zredagowany wpis: „Treść usunięta przez administratora.”), a elementy z kolejki są na górze z oznaczeniem „Czeka na wysłanie” (odrzucone: „Wymaga uwagi” z „Przejdź do kolejki”); po wysłaniu element zamienia się w zwykły wpis bez duplikatu; pusty dziennik: „Brak wpisów.”.

**AC5 — Zlecenie niedostępne**
- Zakładając zlecenie, które wyszło z zakresu urządzenia albo zostało usunięte w biurze (znacznik usunięcia po synchronizacji), także w trakcie oglądania
- Gdy je otwieram lub odświeża się ekran
- Wtedy widzę „Zlecenie niedostępne. Mogło zostać usunięte albo nie masz do niego dostępu.” z akcją „Wróć do listy”, bez danych tego zlecenia; oczekujące elementy tego zlecenia zostają w Kolejce i w „Wymaga uwagi” (nic nie ginie).

**AC6 — Tryb ukrytych danych, prywatność, dostępność**
- Zakładając tryb ukrytych danych (EVM-101) albo wylogowanie, w tym wejście w tryb przy otwartym ekranie i po powrocie z tła
- Gdy ekran jest otwarty
- Wtedy żadne dane osobowe nie są renderowane ani trzymane w modelu ekranu (model zerowany w chwili wejścia w tryb; ekran oferuje akcję z EVM-101), identyfikator zlecenia jest jedyną daną w parametrach nawigacji, a nazwy, adresy, telefon i treści wpisów nie trafiają do logów, breadcrumbów ani stanu odtwarzanego po śmierci procesu; w trybie zwykłym ekran jest czytelny dla TalkBack (nagłówki sekcji, kolejność, cele dotyku ≥ 48 dp).

## Poza zakresem
- Edycja etapów i danych z telefonu (po MVP), płatności, pliki dokumentów, zdjęcia i filmy w dzienniku (E11, EVM-108/111), „Inne zlecenia w tej lokalizacji”, karta podsumowania i baner „Zlecenie założone w terenie” (panel).
- Otwieranie zleceń „Oczekuje na numer” (dochodzi w EVM-106 — do tego czasu ich wiersze zostają nieaktywne).
- Dodawanie wpisów i komentarzy (EVM-105); tu tylko wyświetlanie elementów oczekujących.

## Decyzje i ograniczenia
- Ścieżka `pelna` (zmiana względem `lekka`): ekran wyświetla dane osobowe z urządzenia i tryb ukrytych danych (`workflow.md` → „Ścieżki realizacji”; jak EVM-103). Proponowana 2026-11-13 w ramach delegacji Konrada „tanio, szybko, bezpiecznie” — do potwierdzenia razem z akceptacją AC.
- Telefon klienta: `tel:` otwiera wybieranie numeru (`ACTION_DIAL`), bez `CALL_PHONE`; bez „otwórz w mapach” (adres trafiałby do zewnętrznej usługi). Numer jest przekazywany systemowej aplikacji telefonu — świadome ryzyko, jak dla każdej akcji „Zadzwoń”.
- Odczyt jak w EVM-103: jedna transakcja z repliki i kolejki, odbudowa po powiadomieniu `SyncHost.subscribe`, bez N+1 i bez trwałej kopii danych poza repliką SQLCipher; ekrany bez nowej zależności; nawigacja i układ wg istniejącego Shella (zakładka „Zlecenia”).
- UX / UI: M-03 (wersja telefonu: tylko odczyt, sekcje jedna pod drugą), stany: pusty (AC3/AC4), ładowanie (Skeleton z biblioteki), błąd odczytu bazy (komunikat z „Spróbuj ponownie”), offline (dane lokalne — bez osobnego banera poza SyncIndicator), brak dostępu (AC5), tryb ukryty (AC6). Wyłącznie tokeny i komponenty ze styleguide'u (StatusBadge, EmptyState, Skeleton, AppBar). Bez nowego odstępstwa od styleguide'u.
- Uprawnienia: Administrator i Edytor — pełny odczyt; Tylko odczyt nie loguje się do aplikacji (decyzja Konrada 2026-11-12); niezalogowany — logowanie.

## Notatki
- Nieblokujące do dopracowania przy kolejnej zmianie ekranu: opiekun zlecenia (nazwa z encji `user`, jeśli jest w telefonie).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultację security (product-owner)
- 2026-11-13 — refinement do DoR: 6 AC (dodano zlecenie niedostępne w trakcie oglądania, prywatność i TalkBack, rozgraniczenie z EVM-105/106), ścieżka `lekka` → `pelna` (dane osobowe na urządzeniu), reviewers + security-engineer; status `draft` do akceptacji (product-owner)
- 2026-11-13 — akceptacja Konrada (DoR) do nocnej kolejki `/noc-2026-11-13`: kolejność toru A 104 → 105 → 127 → 106 (tor B: 126 → 066), autokorekta zostaje w długich tekstach (wyłączona w polach klienta, telefonu, adresu; autofill wszędzie wyłączony), bez szkiców i „ostatnio otwieranych” w M2, EVM-126 — budowa panelu bez adresu kończy się błędem; status `ready` (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-13` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-13-mobile`
- 2026-11-14 — implementacja: model i odczyt repliki (K1–K10), ekran M-03 z nakładką w Shellu, aktywny wiersz listy, przepływ Maestro 41 i dane stubu; wskazówki dojazdu i opis zlecenia świadomie poza wersją 1 (rekomendacja K2) (mobile-developer)
- 2026-11-14 — workflow `deliver-story` (pelna) `passed` po 2 rundach: QA pass (AC1–AC6), security-engineer i ux-designer approve w rundzie 1, code-reviewer approve w rundzie 2 (poprawka: wpis zastąpiony poprawką i poprawka oznaczone). Bramka orkiestratora `pnpm run gate` zielona — pokrycie zmienionego kodu 100% linii, 99,2% gałęzi. E2E Maestro (przepływ 41) — na końcu toru A z klonu `C:`. Uwagi nieblokujące (UX: TalkBack w dzienniku, ikona stanu błędu, brak zrzutów — do demo) w raporcie nocnym. Koszt: 10 agentów, ok. 613 tys. tokenów, 51 min (po wznowieniu). Status `in-review` (Tech Lead, kolejka nocna)
