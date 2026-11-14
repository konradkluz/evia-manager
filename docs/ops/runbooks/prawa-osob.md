# Runbook: żądania osób (art. 15–22 RODO)

> Dokument żywy (EVM-064 AC4). Właściciel: `security-engineer`; kanał i procedura biznesowa: `product-owner`. Wykonuje Administrator (Konrad). Wymagania: SR-PRIV-02, SR-DATA-09; zasady: [`rodo.md` → „Realizacja praw osób”](../../security/rodo.md#realizacja-praw-osób-art-1522). Procedura operacyjna, nie porada prawna.

## 1. Przyjęcie żądania
- **Kanał:** adres kontaktowy w sprawach danych z klauzul w panelu (W-19) albo pismo na adres siedziby. Żądanie, które trafi inną drogą (telefon, e-mail do biura, rozmowa z technikiem), pracownik przekazuje Konradowi **tego samego dnia**; forma żądania jest dowolna.
- **Rejestr żądań** (poza repozytorium — [`rodo.md` → „Rejestry poza repozytorium”](../../security/rodo.md#rejestry-poza-repozytorium)): każde żądanie dostaje kartę od razu po wpływie.

**Karta żądania** (pola w rejestrze; w repozytorium nigdy wartości)

| Pole | Treść |
|---|---|
| Numer sprawy, data wpływu, kanał | data wpływu = początek terminu |
| Rodzaj | art. 15 / 16 / 17 / 18 / 20 / 21 (może być kilka) |
| Termin | data wpływu + 1 miesiąc; przedłużenie (+2 mies.) — data i powód przekazany osobie |
| Weryfikacja tożsamości | sposób (bez kopii dokumentów), data, kto |
| Obiekty w systemie | identyfikatory (klient, zlecenia; edytowane lokalizacje i strony, obiekty usunięte w trybie art. 18 — do powtórzenia po odtworzeniu kopii) — bez nazw |
| Decyzja i podstawa | wykonano / częściowo (wyjątek z art. 17 ust. 3 albo 21) / odmowa z uzasadnieniem |
| Wykonane operacje | kody operacji z sekcji 4 i data |
| Odpowiedź | data i kanał |

## 2. Weryfikacja tożsamości
1. Porównaj z danymi, które już mamy: adres e-mail albo telefon z danych klienta, numer zlecenia, adres lokalizacji.
2. Odpowiadaj **wyłącznie** na adres albo numer, który już jest w systemie; przy wątpliwości — oddzwoń na znany numer.
3. Nie żądaj kopii dowodu ani skanów dokumentów (minimalizacja). Pełnomocnik — pisemne upoważnienie.
4. Nie da się potwierdzić tożsamości — poproś o dodatkową informację (np. numer zlecenia, adres montażu), termin biegnie dalej.

## 3. Terminy
- Bez zbędnej zwłoki, najpóźniej **1 miesiąc** od wpływu (art. 12 ust. 3), bezpłatnie.
- Przedłużenie o 2 miesiące tylko ze względu na złożoność lub liczbę żądań — informacja z powodem do osoby **w pierwszym miesiącu**.
- Odmowa (np. żądanie ewidentnie nieuzasadnione, wyjątek z art. 17 ust. 3) — uzasadnienie oraz informacja o możliwości skargi do Prezesa UODO i skorzystania ze środka ochrony prawnej przed sądem (art. 12 ust. 4), też w terminie.

## 4. Operacje w systemie (Administrator)
Operacje ze step-upem wymagają potwierdzenia tożsamości w panelu (W-04). Przed operacją nieodwracalną sprawdź, czy nie zachodzi wyjątek z art. 17 ust. 3 (obowiązek prawny — np. dokumenty rozliczeń, lit. b; roszczenia z umowy — lit. e).

### Art. 15 i 20 — dostęp, kopia, przenoszenie (SR-DATA-09)
Procedura ręczna do M4 (funkcja eksportu danych klienta — M4):
1. Wyszukaj klienta; z karty klienta przepisz dane osoby do zestawienia (dokument albo arkusz CSV — CSV spełnia art. 20).
2. Dopisz: lokalizacje (adresy), zlecenia (numery, statusy, daty, transze), listę dokumentów i zdjęć, wpisy dziennika, które dotyczą osoby. **Fragmenty dotyczące innych osób pomiń** (np. dane sąsiada, pracowników poza imieniem).
3. Kopie zdjęć: w zleceniu „Eksportuj zdjęcia (ZIP)” (step-up, maks. 5 dziennie, link 24 h — EVM-052). Kopie dokumentów: pobranie pliku (A, E).
4. Przekaż kanałem z sekcji 2 (na zweryfikowany adres albo osobiście). Pobrane pliki i zestawienie usuń z komputera po wysłaniu (środki organizacyjne biura w `rodo.md`).
5. Informacje z art. 15 ust. 1 podaj **dla tej osoby**: konkretni odbiorcy jej danych (który OSD, która administracja lub wspólnota, który podwykonawca — z dokumentów jej zleceń; TSUE C-154/21), cele, okres przechowywania dla jej zleceń, źródło danych (gdy nie od niej), prawa i skarga do Prezesa UODO; klauzula w panelu (W-19) tylko jako uzupełnienie.

### Art. 16 — sprostowanie
Edycja klienta (W-14), lokalizacji (W-20) albo strony — A lub E. Audyt `customer.updated`, `site.updated`, `party.updated` bez wartości. Nazwa ręcznie dodanego etapu nie jest edytowalna — usuń etap i dodaj nowy (RR-25).

### Art. 18 — ograniczenie
- Klient: „Usuń klienta” (soft delete; dane widzi tylko Administrator) — tylko bez niezamkniętych zleceń (`409 has_active_dependents`). Gdy klient ma niezamknięte zlecenie — wpis w karcie żądania i wstrzymanie dalszych prac z danymi osoby poza przechowywaniem.
- Wpis dziennika: „Usuń wpis”; zdjęcie lub dokument: usunięcie (do cofnięcia).
- Zniesienie ograniczenia = „Przywróć” (klient, wpis, zdjęcie, dokument) i informacja do osoby przed zniesieniem.

### Art. 17 — usunięcie
Kolejność (najpierw elementy powiązane, na końcu klient — po anonimizacji trudniej je znaleźć):
1. **Wpisy dziennika** z danymi osoby — redakcja treści (EVM-040, step-up; zostaje znacznik „Treść usunięta przez administratora DD.MM.RRRR.”).
2. **Zdjęcia i filmy** z osobą (także osoba trzecia, np. sąsiad, tablica rejestracyjna) — trwałe usunięcie pliku (EVM-051, step-up).
3. **Dokumenty** klienta, lokalizacji i zleceń (pełnomocnictwa, wnioski) — trwałe usunięcie plików (EVM-051), chyba że zachodzi wyjątek z art. 17 ust. 3 (np. dokument potrzebny do obrony roszczeń — wtedy art. 18).
4. **Lokalizacje** klienta — edycja: ulica, numer, lokal, nr miejsca postojowego, PPE i notatki zastąpione wartościami neutralnymi (miasto może zostać) — chyba że lokalizacja służy innemu klientowi (garaż wielorodzinny — tylko numer lokalu i miejsca).
5. **Strony** będące osobą fizyczną lub osobą kontaktową — edycja na wartości neutralne („Osoba usunięta”, puste telefon, e-mail, notatki).
6. **Klient** — anonimizacja (EVM-041, step-up; wymaga zamkniętych zleceń — `409 has_active_dependents`). Nieodwracalna.
7. **Pracownik** — dezaktywacja konta; anonimizacja konta — M4; zgłoszenie do wsparcia Scaleway o usunięcie logów TEM z adresem osoby (decyzja EVM-089).
8. **Kopie zapasowe** — dane zostają w kopiach do 37 dni (RR-14); powiedz o tym osobie. Po odtworzeniu bazy z kopii:
   - kroki 1, 2, 3 i 6 (redakcja wpisu, trwałe usunięcie zdjęcia lub dokumentu, anonimizacja klienta) są w **rejestrze usunięć** i wracają do usunięcia przez jego ponowne zastosowanie ([rejestr usunięć](rejestr-usuniec.md));
   - kroki 4–5 (neutralizacja lokalizacji i stron) oraz ograniczenie z art. 18 (soft delete) **nie trafiają do rejestru** — po odtworzeniu trzeba je powtórzyć ręcznie. Dlatego w karcie żądania, w polu „Obiekty w systemie”, zapisz identyfikatory każdej edytowanej lokalizacji i strony oraz każdego obiektu usuniętego w trybie art. 18.

Anonimizacja (krok 6), redakcja (krok 1) i trwałe usunięcie pliku (kroki 2–3) zapisują identyfikatory do rejestru usunięć; gdy panel zwróci błąd niedostępności rejestru (`503`), operacja się nie wykonała — zgłoś to `devops-engineer` i powtórz.

### Art. 19 — powiadomienie odbiorców
Odbiorcy danych z dokumentów zlecenia (OSD, administracja, projektant) — powiadomienie o sprostowaniu, usunięciu lub ograniczeniu poza systemem (e-mail, pismo); odnotuj w karcie.

### Art. 21 — sprzeciw
Dotyczy danych przetwarzanych na podstawie prawnie uzasadnionego interesu (osoby kontaktowe stron, osoby na zdjęciach, dokumentacja po realizacji). Bez nadrzędnych podstaw — kroki jak w art. 17 dla danych objętych sprzeciwem.

## 5. Ćwiczenie (AC4 — niezwłocznie, najpóźniej do 2026-11-28)
Na jedynym środowisku, **wyłącznie na danych syntetycznych** (reguła 4 RR-93: nazwa z prefiksem „TEST”, adres `@example.test`); wykonuje Konrad, agenci nie biorą udziału. Wynik — [`docs/qa/EVM-064/protokoly.md` → „AC4”](../../qa/EVM-064/protokoly.md#ac4--prawa-osób-ćwiczenie).
1. Załóż klienta „TEST Prawa osób” z lokalizacją, stroną (osoba fizyczna „TEST Kontakt”), zleceniem, wpisem, zdjęciem i dokumentem `standard`.
2. Kartę żądania „ćwiczenie” załóż w rejestrze żądań (sekcja 1) — sprawdzasz, czy rejestr istnieje i ma pola.
3. Art. 15: zestawienie (krok 1–2) i eksport ZIP zdjęć zlecenia.
4. Art. 16: zmiana telefonu klienta.
5. Art. 18: „Usuń klienta” → „Przywróć klienta” (najpierw zamknij lub anuluj zlecenie testowe).
6. Art. 17: kroki 1–6 (redakcja wpisu, usunięcie pliku zdjęcia i dokumentu, edycja lokalizacji i strony, anonimizacja).
7. Zmierz czas całości i zapisz utrudnienia (np. `503` rejestru usunięć, brak eksportu przed EVM-124) w protokole.
