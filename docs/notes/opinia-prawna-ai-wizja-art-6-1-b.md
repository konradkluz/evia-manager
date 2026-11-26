---
lifecycle: milestone
milestone: M2
---

> **Opinia modelu AI (2026-11-25), nie weryfikacja przez licencjonowanego prawnika.** Warunek W9 (sprawdzenie podstawy prawnej przez człowieka) pozostaje otwarty — zob. EVM-152. Dane wyłącznie syntetyczne.

# Opinia prawna: podstawa przetwarzania danych na etapie wizji lokalnej (art. 6 ust. 1 lit. b RODO), retencja, obowiązek informacyjny, rejestr i DPIA

| | |
|---|---|
| Data | 2026-11-25 |
| Dotyczy | EVia Manager — wizja lokalna bez klienta z ofertą/wyceną (EVM-141, EVM-147, EVM-148, EVM-149; ADR-0024, ADR-0025); klauzula „Klienci” w wersji 1.1, karta A6 w wersji 1.1 |
| Zleceniodawca | Tech Lead (orkiestrator) na rzecz administratora danych (Electroplus Realty sp. z o.o., marka EVia Charge) |
| Autor | **model AI (Claude, Anthropic)** w roli radcy ds. ochrony danych osobowych — **nie jest to porada licencjonowanego radcy prawnego** (zob. rozdz. 10) |
| Charakter | opinia robocza, plik roboczy w `.scratch/` (poza repozytorium) |

---

## 0. Werdykt w skrócie

**Podstawa wystarczająca pod warunkami.**

- Art. 6 ust. 1 lit. b RODO (druga alternatywa: „działania na żądanie osoby, której dane dotyczą, przed zawarciem umowy”) jest **właściwą i wystarczającą** podstawą w **scenariuszu podstawowym**: osoba fizyczna sama prosi o oględziny lub ofertę **dla siebie** i to ona byłaby stroną umowy. Obejmuje wtedy: (a) adres miejsca instalacji i telefon, (b) zdjęcia i filmy elementów potrzebnych do wyceny, (c) ofertę z imieniem, nazwiskiem i adresem — **dopóki żądanie jest aktualne** (do zawarcia umowy, rezygnacji, odrzucenia oferty albo wygaśnięcia zainteresowania).
- Lit. b **nie obejmuje**: (1) danych zamawiającego, który działa **dla innej osoby, wspólnoty albo firmy**; (2) danych osoby wskazanej w ofercie, **która sama nie prosiła** (zapytanie zgłosił członek rodziny, zarządca); (3) właściciela lub mieszkańców, którzy wizji nie zamawiali; (4) osób trzecich w kadrze; (5) **przechowywania przez 14 dni po rezygnacji lub odrzuceniu**; (6) przetwarzania z inicjatywy firmy. Dla (1)–(5) właściwa jest **lit. f** z udokumentowanym testem równowagi i z informacją o konkretnym uzasadnionym interesie **w chwili zbierania danych** (TSUE C-394/23 *Mousse*). Dla (6) nie ma podstawy w ogóle — zakaz w instrukcji jest prawidłowy.
- Obecna klauzula 1.1 i karta A6 **częściowo** to rozróżniają (lit. f dla właściciela, który nie zamawiał, i osób trzecich), ale: zdanie o „innym zamawiającym” jest dwuznaczne, brakuje podstawy dla zamawiającego działającego za kogoś innego i dla osoby wskazanej w ofercie, brakuje podstawy dla 14 dni po odrzuceniu, a zdanie „możemy zapisać ofertę” jest mniej precyzyjne, niż wymaga art. 12 ust. 1. Potrzebna jest **wersja 1.2 klauzuli i karty** — gotowy tekst w rozdz. 9.
- Okresy **90 / 270 / 14 dni** są co do zasady **proporcjonalne** (art. 5 ust. 1 lit. c i e). Warunki: przedłużenie tylko przy potwierdzonym, aktualnym zainteresowaniu osoby, niezwłoczne zamykanie wizji po rezygnacji, usunięcie na żądanie od razu oraz usuwanie kopii poza systemem w tych samych terminach. Art. 17 ust. 3 **nie jest** ani potrzebny, ani właściwy do uzasadnienia 14 dni.
- Rejestr czynności (czynność 9) **wymaga** aktualizacji. Odrębna DPIA dla samej oferty **nie jest** obowiązkowa, ale aneks v1.2 do istniejącej DPIA jest właściwy i trzeba go zatwierdzić przed przetwarzaniem. Kopie zapasowe do 37 dni (treść pliku w starszych wersjach obiektów do 30 dni) są **akceptowalne** pod warunkami z rozdz. 6.3. Ryzyko jest niezerowe: biuletyn UODO z 28.11.2025 r. prezentuje podejście surowsze niż raport EROD z 2026 r.
- **Ta opinia nie spełnia warunku „podstawa prawna zweryfikowana przez prawnika”** z `rodo.md` (sekcja „Klauzula 1.1 i dokumenty wizji”, pkt 6 lit. b) ani warunku 3 aneksu DPIA v1.2. Tych warunków nie należy oznaczać jako spełnionych na podstawie tego dokumentu (rozdz. 10).

---

## 1. Stan faktyczny przyjęty

Ustalony na podstawie dokumentów repozytorium (stan gałęzi `docs/EVM-149-done`, 2026-11-25) i opisu zleceniodawcy. Opinia **nie** obejmuje weryfikacji praktyki biura, wzorów ofert ani umów z dostawcami.

1. **Wizja lokalna** to zlecenie bez przypisanego klienta, zakładane wyłącznie na zgłoszenie osoby uprawnionej do nieruchomości albo działającej za jej wiedzą, np. najemcy lub zarządcy. Wizje „z inicjatywy firmy” są zakazane (`docs/security/rodo.md` → „Wizja lokalna — zasady”, pkt 1; `docs/user/instrukcja-dla-biura.md`, rozdz. 4).
2. **Zakres danych w systemie:** adres lokalizacji, zdjęcia i filmy posesji, garażu i instalacji (filmy z aplikacji bez dźwięku, metadane pliku, w plikach z panelu także miejsce wykonania), notatki z oględzin i opcjonalny „Telefon zamawiającego” (bez imienia). Od EVM-147/148 dochodzi wyłącznie dokument rodzaju `quote` (oferta/wycena) z imieniem, nazwiskiem i adresem zamawiającego, zakresem i ceną. Obowiązują zakazy: imion w tytule, opisie i nazwie pliku, klasy `identity_data` i skanów dokumentów tożsamości (`ADR-0025`, pkt 1–2).
3. **Dostęp:** panel — Administrator i Edytor; Tylko odczyt i aplikacja mobilna — bez dostępu do oferty (`ADR-0025`, pkt 7).
4. **Retencja:** 90 dni od zapisania wizji w systemie; przedłużenie o 90 dni najwyżej dwa razy (łącznie 270 dni) z zamkniętą listą powodów: `awaiting_client_decision`, `awaiting_community_decision`, `second_visit_needed`, z audytem. Wizja odrzucona — 14 dni od anulowania, nie później niż bieżący termin. W tym czasie dokumenty są tylko do odczytu, ale trwałe usunięcie pliku na żądanie działa (`ADR-0025`, pkt 5). Po przypisaniu klienta dane trafiają do zlecenia (6 lat od końca roku zamknięcia), a telefon zamawiającego jest czyszczony. Kopie: starsze wersje obiektów (treść pliku) do 30 dni, kopie bazy (metadane) do 37 dni, rejestr usunięć stosowany ponownie po odtworzeniu (`rodo.md` → „Retencja”; `docs/ops/runbooks/retencja.md`, sekcja 5).
5. **Wykonanie retencji:** zadanie usuwania działa dziś w trybie `report` (niczego nie usuwa). Do włączenia `enforce` obowiązuje ręczna procedura Administratora z pisemnym zobowiązaniem (RR-102). Kopie zapasowe jeszcze nie działają (EVM-084, termin 2026-12-13). Narzędzie ponownego stosowania rejestru usunięć (EVM-062) ma status `ready`.
6. **Kopie oferty poza systemem** (plik źródłowy, e-mail do zamawiającego, wydruk) usuwa ręcznie biuro w terminach wizji (`instrukcja-dla-biura.md`, rozdz. 4, „Oferta w wizji”). Dostawca poczty firmowej nie jest wskazany w repozytorium (`rodo.md`, pkt 13 listy konsultacji — otwarty).
7. **Informacja:** technik wręcza kartę A6 (wersja 1.1) przed pierwszym zdjęciem. Gdy zamawiającego nie ma na miejscu, karta trafia do osoby, która wpuściła technika, a biuro przekazuje informację „najpóźniej przy przesłaniu oferty”. Pełna klauzula „Klienci” 1.1 jest dostępna publicznie pod kodem QR (`apps/web/src/privacy/content.ts`, `docs/user/karta-wizji-lokalnej.md`). Z repozytorium nie wynika, by przy **przyjęciu zgłoszenia** (telefon, e-mail) przekazywano jakąkolwiek informację.
8. **„Zamawiający”** to osoba, która zleca wizję. Bywa inna niż przyszły klient: wizję zleca np. zarządca, członek rodziny albo pracownik firmy. Oferta może więc być wystawiona na osobę, która sama się do firmy nie zwróciła.
9. Dokumentacja RODO jest **oceną własną administratora bez prawnika i IOD** (RR-95). Aneksy DPIA v1.1 i v1.2 oraz czynność 9 rejestru mają status „projekt do zatwierdzenia”. W wizjach obowiązuje zasada „tylko wizje testowe” do spełnienia listy kontrolnej.

**Założenia** — przy innym stanie faktycznym wnioski mogą się zmienić:
- (Z1) oferta to plik przygotowany przez biuro poza systemem i do niego wgrany, zwykle wysyłany zamawiającemu e-mailem;
- (Z2) firma nie prowadzi na etapie wizji marketingu ani profilowania i nie wykorzystuje danych z wizji do innych celów (statystyki tylko zanonimizowane);
- (Z3) kategorie szczególne (art. 9) nie są przetwarzane celowo;
- (Z4) wśród zamawiających są konsumenci, osoby prowadzące jednoosobową działalność, zarządcy nieruchomości i pracownicy firm.

---

## 2. Ramy prawne i źródła

- **RODO:** art. 5 ust. 1 lit. a, c, e i ust. 2; art. 6 ust. 1 lit. b i f; art. 11; art. 12 ust. 1 i 3; art. 13; art. 14 (zwłaszcza ust. 2 lit. b i f, ust. 3 i ust. 5 lit. b); art. 17 ust. 1 i 3; art. 21 ust. 1 i 4; art. 25; art. 30 ust. 1 i 5; art. 32; art. 35 ust. 1, 7 i 11; art. 36; motywy 39, 47 i 58.
- **Wytyczne EROD 2/2019** w sprawie art. 6 ust. 1 lit. b, wersja 2.0 z 8.10.2019: pkt 22–25 (niezbędność), 40–44 (ustanie umowy, zmiana podstawy), 45–47 i przykłady 5–6 (działania przed zawarciem umowy). Wytyczne dotyczą usług online, ale część ogólna o niezbędności i działaniach przedumownych ma charakter uniwersalny.
- **Wytyczne EROD 1/2024** w sprawie art. 6 ust. 1 lit. f, **wersja 2.0 przyjęta 10.11.2026** (po konsultacjach): pkt 6–7 (trzy przesłanki, ocena przed przetwarzaniem, odrębna podstawa dla każdego celu), 48–51 (rozsądne oczekiwania; klient a „zaledwie potencjalny klient”), 65–66 (informacja o konkretnym uzasadnionym interesie).
- **Grupa Robocza Art. 29, WP260 rev.01** (wytyczne w sprawie przejrzystości): warstwowe przekazywanie informacji i unikanie sformułowań warunkowych typu „możemy”. **WP248 rev.01** (DPIA).
- **Raport EROD z CEF 2025** „Implementation of the right to erasure by controllers”, przyjęty 10.02.2026, Issue 6 (kopie zapasowe).
- **Orzecznictwo TSUE:**
  - C-252/21 *Meta Platforms/Bundeskartellamt* (4.07.2023): lit. b tylko przy przetwarzaniu „obiektywnie niezbędnym” do celu stanowiącego integralną część świadczenia umownego; trzy przesłanki lit. f; pkt 90 — każdy cel wymaga własnej podstawy;
  - C-394/23 *Mousse/CNIL, SNCF Connect* (9.01.2025): pkt 52 — o uzasadnionym interesie trzeba poinformować w chwili zbierania danych, inaczej zbieranie nie może opierać się na lit. f;
  - C-708/18 *TK/Asociaţia de Proprietari* (11.12.2019), pkt 40; C-13/16 *Rīgas satiksme* (4.05.2017), pkt 28; C-621/22 *KNLTB* (4.10.2024) — interes handlowy może być uzasadnionym interesem;
  - C-77/21 *Digi* (20.10.2022) — ograniczenie przechowywania dotyczy także kopii technicznych.
- **Prawo polskie i UODO:**
  - Komunikat Prezesa UODO o wykazie operacji wymagających DPIA (M.P. 2019 poz. 666);
  - Biuletyn UODO „Usuwanie danych z kopii zapasowych systemów informatycznych” (28.11.2025; zgodnie z zastrzeżeniem biuletynu **nie jest to oficjalne stanowisko organu**);
  - poradnik UODO dla pracodawców (2018) i wyrok NSA z 20.02.2024, III OSK 2700/22 (przechowywanie danych niedoszłych kandydatów do pracy) — **analogia** dla danych osób, które nie zawarły umowy; wyrok znam wyłącznie z omówień prasowych, do weryfikacji w CBOSA;
  - Kodeks cywilny: art. 66 § 2 (wiązanie ofertą), art. 95 (przedstawicielstwo);
  - Prawo komunikacji elektronicznej z 12.07.2024 r., art. 398 — zgoda na marketing bezpośredni telefoniczny i elektroniczny (do weryfikacji, rozdz. 10).

Pełne adresy źródeł — rozdz. 11.

---

## 3. Pytanie 1 — czy art. 6 ust. 1 lit. b jest właściwą i wystarczającą podstawą

### 3.1 Przesłanki drugiej alternatywy lit. b

Z brzmienia przepisu („do podjęcia działań na żądanie osoby, której dane dotyczą, przed zawarciem umowy”), z wytycznych EROD 2/2019 (pkt 22–25 i 45–47) i z wyroku C-252/21 wynikają cztery łączne przesłanki:

1. **Żądanie pochodzi od osoby, której dane dotyczą.** EROD wprost wyłącza przetwarzanie „carried out solely on the initiative of the data controller, or at the request of a third party” (pkt 47).
2. **Żądanie pada w kontekście potencjalnego zawarcia umowy z tą osobą.** Dopuszczalna jest niepewność, czy umowa dojdzie do skutku: „may nonetheless apply as long as the data subject makes the request in the context of potentially entering into a contract” (pkt 46).
3. **Obiektywna niezbędność** do podjęcia żądanych działań. Nie wystarcza przydatność („useful but not objectively necessary”, pkt 25). Jeżeli istnieje realna, mniej ingerująca alternatywa, przetwarzanie nie jest niezbędne (pkt 25; C-252/21).
4. **Czasowy charakter:** podstawa trwa, dopóki trwają działania, o które poproszono. Po rezygnacji, odrzuceniu oferty albo wygaśnięciu zainteresowania przetwarzanie przestaje być niezbędne. Analogicznie do ustania umowy (pkt 40–41): „generally unfair to swap to a new legal basis when the original basis ceases to exist”, chyba że odrębny cel i podstawę wskazano i zakomunikowano **od początku** (pkt 43–44).

Przykład 5 wytycznych (osoba podaje kod pocztowy, by sprawdzić, czy usługodawca działa w jej okolicy) to model dla wizji: osoba prosi o sprawdzenie, czy i za ile można wykonać instalację w jej miejscu.

### 3.2 (a) Adres i telefon zamawiającego

- **Adres miejsca instalacji:** lit. b jest **właściwa**. Bez adresu nie da się wykonać oględzin ani wycenić prac — to warunek konieczny działań, o które poproszono.
- **Telefon:** lit. b jest **właściwa**, choć pole jest opcjonalne. Niezbędność nie oznacza obowiązku podania danej: osoba wybiera kanał kontaktu, a przetwarzanie numeru do umówienia wizji i przekazania oferty mieści się w działaniach, o które prosiła (pkt 46: obsługa zapytania osoby).
- **Granica:** po rezygnacji lub odrzuceniu oferty telefon nie może służyć do dalszego kontaktu handlowego, np. „może jednak się Pan zdecyduje”. To byłby marketing, który poza lit. b wymaga zgody na kontakt telefoniczny w celu marketingu bezpośredniego (art. 398 PKE). Pytanie o decyzję w sprawie oferty, której osoba **wciąż oczekuje**, nie jest marketingiem.
- **Wyjątek:** gdy zamawiający działa **dla innej osoby lub podmiotu** (zarządca, pracownik firmy, członek rodziny zamawiający dla rodzica), jego telefon nie służy działaniom przed zawarciem umowy, której **on** byłby stroną. Lit. b jest wtedy wątpliwa, właściwa jest lit. f (pkt 3.5 i 3.6). Klauzula ma już analogiczną konstrukcję dla osób kontaktowych klientów będących firmami (lit. f).

### 3.3 (b) Zdjęcia i filmy z wizji

- **Zdjęcia elementów potrzebnych do wyceny** (rozdzielnica, przyłącze, trasa przewodu, miejsce montażu, garaż, odległości): lit. b jest **właściwa**. Ofertę przygotowuje biuro, często nie ten sam pracownik, który był na miejscu. Utrwalenie stanu technicznego jest obiektywnie potrzebne do rzetelnej wyceny, a sama notatka byłaby realnie mniej skuteczna. Filmy bez dźwięku i zasada kadrowania (SR-PRIV-10) spełniają wymóg minimalizacji.
- **Granica niezbędności:** zdjęcia całej posesji, elewacji, otoczenia, sąsiednich garaży czy wnętrz poza miejscem instalacji są co najwyżej „przydatne” i nie mieszczą się w lit. b (pkt 25). Instrukcja powinna wprost zawężać kadr do elementów potrzebnych do wyceny. Dziś zawęża go tylko negatywnie (bez osób, tablic i dokumentów).
- **Cel „udokumentowanie stanu miejsca przed pracami”:** przed zawarciem umowy nie jest to cel, któremu służy przetwarzanie danych zamawiającego. Prac jeszcze nie ma i może ich nie być. Cel ten pojawia się dopiero po zawarciu umowy, a klauzula przewiduje dla niego lit. f („zdjęcia i filmy z prac — dokumentacja stanu przed montażem…”). Rekomenduję, by przy wizji mówić o tym celu tylko w trybie „po zawarciu umowy” (tekst — rozdz. 9.1 i 9.3). Zmiana celu po konwersji wizji w zlecenie jest zgodna z celem pierwotnym (art. 6 ust. 4) i ujawniona od początku, więc pkt 43–44 wytycznych 2/2019 są spełnione — pod warunkiem, że zostanie to powiedziane wprost.
- **Metadane miejsca wykonania** w plikach z panelu nie są potrzebne, bo adres jest znany. Ujawnienie ich w klauzuli spełnia wymóg przejrzystości, ale nie zastępuje minimalizacji (art. 5 ust. 1 lit. c). Ryzyko jest niskie (lokalizacja pokrywa się z adresem). Rekomendacja R3: usuwanie danych lokalizacji przy wgrywaniu, przez backlog (`/refine`).

### 3.4 (c) Oferta z imieniem, nazwiskiem i adresem

- **Sporządzenie oferty i jej przekazanie** to istota działania, o które osoba prosi. Imię i nazwisko adresata identyfikują drugą stronę przyszłej umowy, a oferta jest oświadczeniem skierowanym do oznaczonej osoby (art. 66 KC). **Lit. b jest właściwa**, gdy oferta jest wystawiona **na osobę, która o nią poprosiła**.
- **Zapis kopii oferty w systemie** przez czas, w którym osoba może ją przyjąć albo negocjować, mieści się w lit. b. Bez treści oferty nie da się zawrzeć umowy zgodnej z ofertą ani odpowiedzieć na pytania osoby. Argument ADR-0025, że kopia w systemie podlega automatycznemu usunięciu, a kopia w poczcie nie, wzmacnia ocenę proporcjonalności (art. 25).
- **Po ustaniu żądania** (rezygnacja, odrzucenie, wygaśnięcie) dalsze przechowywanie nie jest już objęte lit. b — rozdz. 4.4.
- **Oferta wystawiona na inną osobę niż zamawiający:**
  - Gdy syn zamawia wizję i ofertę „dla taty”, dane ojca pozyskano od osoby trzeciej, a żądanie nie pochodzi od ojca. EROD wyłącza z lit. b przetwarzanie „at the request of a third party” (pkt 47), więc lit. b **nie ma zastosowania** — do czasu, gdy ojciec sam potwierdzi zainteresowanie.
  - Wyjątek obronny: zamawiający jest **pełnomocnikiem** (art. 95 § 2 KC — czynność przedstawiciela działa bezpośrednio na reprezentowanego). Ciężar wykazania pełnomocnictwa spoczywa jednak na administratorze (art. 5 ust. 2), a w praktyce biuro tego nie weryfikuje.
  - Bezpiecznie: **lit. f + art. 14** do czasu potwierdzenia przez adresata, potem lit. b.
  - Mniej ingerująca alternatywa: oferta adresowana do zamawiającego z oznaczeniem nieruchomości („dla nieruchomości przy ul. …”), bez nazwiska osoby trzeciej. Nazwisko trafia do oferty dopiero wtedy, gdy zamawiający potwierdzi, że ta osoba wie o zapytaniu, albo gdy osoba sama się zgłosi (rekomendacja W3).

### 3.5 Macierz scenariuszy — kto jest „zamawiającym” i jaka podstawa

| # | Scenariusz | Dane zamawiającego | Dane osoby wskazanej w ofercie / właściciela / mieszkańca | Informacja | Uwagi |
|---|---|---|---|---|---|
| S1 | Osoba fizyczna (właściciel, mieszkaniec, najemca) zamawia **dla siebie** | **lit. b** | to ta sama osoba — **lit. b** | art. 13 (karta A6, klauzula) | scenariusz podstawowy |
| S2 | Najemca zamawia dla siebie; właściciel nie zamawiał | **lit. b** | właściciel (adres, zdjęcia jego nieruchomości) — **lit. f** | art. 13 dla najemcy; właściciel zwykle nieidentyfikowany z nazwiska — art. 11 ust. 1 i art. 14 ust. 5 lit. b | sprzeciw właściciela = usunięcie całej wizji (`prawa-osob.md` — prawidłowo) |
| S3 | Członek rodziny lub znajomy zamawia **dla innej osoby**; oferta na tę osobę | **lit. f** (kontakt w sprawie wizji i oferty), chyba że sam będzie stroną umowy — wtedy lit. b | **lit. f** do potwierdzenia przez adresata, potem **lit. b** | art. 13 dla zamawiającego; **art. 14** dla adresata oferty: najpóźniej przy pierwszym kontakcie, inaczej w ciągu miesiąca | nazwisko adresata w ofercie tylko po potwierdzeniu, że ta osoba wie o zapytaniu (W3) |
| S4 | Zarządca lub administrator zamawia dla **wspólnoty albo spółdzielni** (garaż wspólny) | **lit. f** (osoba kontaktowa podmiotu) | przyszłym klientem jest podmiot, a nie osoba fizyczna; mieszkańcy lub pojazdy w kadrze — **lit. f** | art. 13 dla zarządcy (karta A6) | klauzula już przewiduje lit. f dla osób kontaktowych firm — dopisać wprost dla wizji |
| S5 | Mieszkaniec bloku zamawia dla siebie; zgoda zarządcy lub wspólnoty potrzebna | **lit. b** | zarządca (kontakt) — **lit. f** (klauzula „osoby kontaktowe stron”, art. 14) | art. 13 i 14 | — |
| S6 | Pracownik firmy zamawia dla firmy (flota, parking) | **lit. f** | klientem jest firma; jednoosobowa działalność — jak S1 (lit. b) | art. 13 | — |
| S7 | Pełnomocnik z wykazanym pełnomocnictwem | **lit. f** dla danych pełnomocnika | mocodawca — **lit. b** (żądanie przypisane mocodawcy), przy braku dowodu — jak S3 | art. 13 (pełnomocnik), art. 14 (mocodawca) | ciężar dowodu (art. 5 ust. 2) |
| S8 | Wizja **z inicjatywy firmy** (akwizycja, „przy okazji” u sąsiada) | **brak podstawy** | **brak podstawy** | — | lit. f nie przechodzi testu równowagi (dom prywatny, brak relacji, brak rozsądnych oczekiwań — EROD 1/2024 pkt 51); kontakt marketingowy wymaga zgody z art. 398 PKE; **zakaz zostaje** |

### 3.6 Lit. f jako podstawa uzupełniająca — test trzech przesłanek

Trzy łączne przesłanki: C-252/21 pkt 106; C-708/18 pkt 40; EROD 1/2024 pkt 6. Ocenę trzeba przeprowadzić i **udokumentować przed rozpoczęciem przetwarzania** (EROD 1/2024 pkt 7), a uzasadniony interes podać osobie **w chwili zbierania danych** (C-394/23 pkt 52; EROD 1/2024 pkt 65). Interes handlowy przygotowania oferty może być uzasadnionym interesem (C-621/22).

| ID | Przetwarzanie | 1. Uzasadniony interes | 2. Niezbędność | 3. Równowaga (oczekiwania, wpływ, zabezpieczenia) | Wynik |
|---|---|---|---|---|---|
| F1 | Dane kontaktowe zamawiającego działającego za inną osobę lub podmiot (S3, S4, S6, S7) | umówienie i przeprowadzenie wizji, przekazanie oferty, o którą poproszono | brak mniej ingerującej drogi kontaktu z osobą organizującą wizję | osoba sama podała dane i oczekuje kontaktu (motyw 47); dane zwykłe; krótki okres; sprzeciw | **przeważa interes administratora** |
| F2 | Imię, nazwisko i adres osoby wskazanej w ofercie, która sama nie prosiła (S3) | przygotowanie oferty dla osoby, w której imieniu zgłoszono zapytanie; umożliwienie zawarcia umowy | **warunkowo** — istnieje alternatywa: oferta na zamawiającego z oznaczeniem nieruchomości; nazwisko niezbędne dopiero, gdy adresat jest znany i wie o zapytaniu | dane zwykłe, ale pozyskane od osoby trzeciej, adresat może nie oczekiwać przetwarzania (EROD 1/2024 pkt 51: potencjalny klient); zabezpieczenia: informacja z art. 14 przy przekazaniu oferty, sprzeciw, retencja 90 / 14 dni, brak dostępu z telefonu i dla roli Tylko odczyt | **przeważa pod warunkami W3** |
| F3 | Adres i zdjęcia posesji właściciela lub mieszkańców, którzy nie zamawiali (S2, S4) | przygotowanie oferty dla zamawiającego uprawnionego do korzystania z nieruchomości | oględziny miejsca są konieczne; kadr ograniczony do elementów instalacji | prywatność domu, ryzyko włamania (DPIA D2); typowa sytuacja (najemca zamawia ładowarkę, a na prace i tak potrzebna jest zgoda właściciela); zabezpieczenia: minimalizacja kadru, dostęp A/E, retencja, usunięcie całej wizji po sprzeciwie właściciela | **przeważa pod warunkiem minimalizacji kadru** |
| F4 | Osoby trzecie w kadrze | przygotowanie oferty; po umowie — dokumentacja prac | przypadkowe utrwalenie, unikane | rozstrzygnięte w EVM-133 A5 (art. 11, art. 14 ust. 5 lit. b, sprzeciw, usunięcie pliku) | **bez zmian** |
| F5 | Przechowywanie danych z wizji przez ≤ 14 dni po rezygnacji lub odrzuceniu, tylko do odczytu | naprawa pomyłki w oznaczeniu rezygnacji (przywrócenie), uporządkowane usunięcie razem z rejestrem usunięć | krótki, zamknięty okres; brak użycia danych | osoba nie oczekuje dalszego wykorzystania — dlatego żadnego użycia; usunięcie od razu na żądanie (art. 17, 21); przywrócenie tylko w razie pomyłki, ze step-upem | **przeważa pod warunkami z rozdz. 4.4** |

Test powinien mieć postać jednej strony w rejestrze poza repozytorium. Szablon — rozdz. 9.9.

### 3.7 Przetwarzanie z inicjatywy firmy

Brak podstawy z lit. b (EROD 2/2019 pkt 47). Lit. f nie przechodzi testu równowagi: fotografowanie prywatnej posesji bez relacji z osobą, przy braku rozsądnych oczekiwań i ryzyku dla bezpieczeństwa domu. Kontakt w celu oferowania usług wymaga dodatkowo uprzedniej zgody (art. 398 PKE). **Zakaz z `rodo.md` (zasada 1) i z instrukcji dla biura jest prawidłowy i powinien zostać.** Uzupełnienie: po rezygnacji lub odrzuceniu oferty nie dzwonimy z propozycjami bez zgody na marketing.

### 3.8 Czy klauzula ma wskazywać podstawy rozdzielnie — tak

- Art. 13 ust. 1 lit. c i d oraz art. 14 ust. 1 lit. c i ust. 2 lit. b wymagają wskazania podstawy dla celu oraz — przy lit. f — konkretnego interesu. Każdy cel musi mieć własną podstawę (C-252/21 pkt 90; EROD 1/2024 pkt 7). Ten sam cel (przygotowanie oferty) może mieć **różne podstawy wobec różnych kategorii osób**, ale trzeba to powiedzieć wprost.
- Skutek braku informacji jest poważny: według C-394/23 (pkt 52) zbieranie danych, o którego uzasadnionym interesie nie poinformowano w chwili zbierania, **nie może opierać się na lit. f**. Rozdzielenie podstaw jest więc **warunkiem ważności lit. f**, a nie kwestią redakcyjną.
- **Uwagi do obecnej treści 1.1:**
  1. Zdanie „Jeżeli wizję zamawia ktoś inny niż właściciel lub mieszkaniec, **ich** dane przetwarzamy… (lit. f)” jest dwuznaczne: nie wiadomo, czy „ich” oznacza właściciela i mieszkańca, czy zamawiającego. Nie obejmuje też zamawiającego, który działa za inną osobę, ani adresata oferty, który sam nie prosił.
  2. Brak podstawy dla 14 dni po rezygnacji lub odrzuceniu. Zgodnie z pkt 43–44 wytycznych 2/2019 trzeba ją wskazać od początku, inaczej przejście z lit. b na lit. f po rezygnacji byłoby niedozwoloną „podmianą podstawy” (pkt 41).
  3. „Na etapie wizji **możemy** zapisać ofertę” — WP260 wskazuje słowa warunkowe („may”, „might”, „possible”) jako złą praktykę, gdy zaciemniają, czy i kiedy przetwarzanie następuje. Lepiej sformułować regułę: „Jeżeli przygotujemy ofertę, zapisujemy ją…”.
  4. Kategorie danych dla wizji nie wymieniają **adresu e-mail**, na który faktycznie wysyłana jest oferta (Z1), ani **kopii oferty poza systemem**.
  5. Na karcie A6 cel „udokumentowania stanu miejsca przed pracami” jest przypisany do etapu sprzed umowy (pkt 3.3).

---

## 4. Pytanie 2 — okresy retencji 90 / 270 / 14 dni

### 4.1 Standard oceny

- Dane mają być przechowywane „przez okres nie dłuższy, niż jest to niezbędne do celów” (art. 5 ust. 1 lit. e). Okres ma być „ograniczony do ścisłego minimum”, a administrator ustala termin usunięcia lub okresowego przeglądu (motyw 39). Okres albo kryteria jego ustalania podaje się w informacji (art. 13 ust. 2 lit. a).
- Gdy cel przedumowny ustaje (rezygnacja, odrzucenie), dalsze przetwarzanie na lit. b jest niedopuszczalne (EROD 2/2019 pkt 41, stosowany odpowiednio).
- Ograniczenie przechowywania dotyczy **każdej kopii**, także technicznej (C-77/21 *Digi*: przechowywanie w bazie testowej ponad potrzebny okres narusza art. 5 ust. 1 lit. e).
- Polska analogia — dane osób, które nie zawarły umowy: UODO w poradniku dla pracodawców (2018) zalecał usuwanie danych kandydatów niezwłocznie po zakończeniu rekrutacji. NSA (III OSK 2700/22, według omówień) dopuścił dalsze przechowywanie tylko z uwagi na **realne** roszczenia i tylko w postaci przechowania. Wniosek dla wizji: bez umowy dane powinny znikać szybko, a „na wszelki wypadek” nie stanowi uzasadnienia. Ryzyko roszczeń z etapu wizji jest znikome, z zastrzeżeniem szkody wyrządzonej w czasie oględzin — wtedy rozstrzyga art. 17 ust. 3 lit. e, ale tylko w konkretnej sprawie.

### 4.2 90 dni (wizja bez umowy)

**Ocena: uzasadnione jako termin maksymalny.** Decyzja o instalacji ładowarki (finansowanie, dopłaty, zgoda współwłaściciela lub wynajmującego, warunki od operatora sieci) trwa zwykle tygodnie. 90 dni to rozsądna górna granica, krótsza niż 12 miesięcy dla zlecenia anulowanego przed akceptacją. Proporcjonalność zależy jednak od tego, czy wizje są **zamykane wcześniej**, gdy cel ustaje. 90 dni nie może być domyślnym czasem przechowywania danych osoby, która już odmówiła albo przestała odpowiadać.

**Warunki:**
- biuro niezwłocznie wybiera „Odrzuć wizję” po rezygnacji, odrzuceniu oferty albo — zalecane — gdy po upływie terminu ważności oferty i jednym przypomnieniu osoba nie odpowiada;
- rekomendacja R4: oferta wskazuje termin związania (art. 66 § 2 KC), np. 30 dni, co ułatwia obiektywne zamknięcie.

Liczenie od zapisania wizji na serwerze (nie od dnia oględzin) jest dla osoby mniej korzystne o kilka dni, ale zostało prawidłowo ujawnione („najpóźniej po 90 dniach od zapisania wizji w naszym systemie”).

### 4.3 Przedłużenia do 270 dni

**Ocena: uzasadnione wyjątkowo**, bo cel nadal trwa: decyzje wspólnot i spółdzielni zapadają na zebraniach i w formie uchwał, zgody zarządcy i warunki przyłączenia wymagają czasu. Zamknięta lista powodów, limit dwóch przedłużeń, audyt i przypomnienie 15 dni przed terminem to dobre zabezpieczenia.

**Warunek kluczowy:** przedłużenie tylko wtedy, gdy **osoba potwierdziła** (np. w rozmowie), że nadal oczekuje oferty lub decyzji. Lit. b istnieje tylko dopóty, dopóki żądanie jest aktualne. Kod `awaiting_client_decision` nie powinien być nadawany „z urzędu”. Wystarczy reguła w instrukcji i data kontaktu w karcie przeglądu albo we wpisie, bez danych osobowych. Klauzula może opisać kryterium przedłużenia — tekst w rozdz. 9.2.

### 4.4 14 dni po odrzuceniu lub rezygnacji — czy potrzebny art. 17 ust. 3 i jaka podstawa

1. **Art. 17 ust. 3 nie jest tu właściwy ani potrzebny.** Przepis wylicza wyjątki od **prawa do usunięcia** (wolność wypowiedzi, obowiązek prawny, zdrowie publiczne, archiwizacja i statystyka, roszczenia). „Czas na pomyłkę” ani „uporządkowane usunięcie” nie są takim wyjątkiem.
   - Jeżeli osoba **zażąda usunięcia** w okresie 14 dni, administrator usuwa dane bez zbędnej zwłoki. Odmowa jest możliwa wyłącznie przy **konkretnej** przesłance z ust. 3, najczęściej lit. e przy realnym sporze, np. o szkodę z oględzin albo o to, czy oferta została przyjęta. Odmowę uzasadnia się w karcie żądania.
   - System na to pozwala: `purgeDocumentFile` i `deleteDocument` są wyłączone spod blokady „tylko do odczytu” (ADR-0025 pkt 5) — rozwiązanie prawidłowe. Procedura z `prawa-osob.md` („Art. 17 — usunięcie wizji na żądanie”) przewiduje usunięcie od razu w trybie `report`, a w trybie `enforce` „najpóźniej po 14 dniach”. Rekomenduję także w trybie `enforce` usuwać **od razu na żądanie**, a nie czekać na zadanie. Art. 12 ust. 3 wyznacza maksimum miesiąca, ale wymóg to „bez zbędnej zwłoki”, a narzędzie natychmiastowego usunięcia istnieje.
2. **Bez żądania** 14 dni jest dopuszczalne jako krótki, z góry określony okres na wykonanie usunięcia i naprawę pomyłek. Z chwilą rezygnacji lit. b jednak ustaje, więc to przechowywanie potrzebuje **własnej podstawy: lit. f** (test F5). Trzeba ją **wskazać w klauzuli od początku** (pkt 3.8, uwaga 2).
   - Alternatywna konstrukcja: traktowanie 14 dni jako części procesu usuwania „bez zbędnej zwłoki” (art. 5 ust. 1 lit. e w zw. z art. 17 ust. 1 lit. a) jest możliwa, ale słabsza, bo usunięcie technicznie jest dostępne od razu.
3. **„Tylko do odczytu”** nie jest wymogiem prawa. To trafny środek minimalizacji, funkcjonalnie zbliżony do ograniczenia przetwarzania: dane nie są używane ani zmieniane.
4. **Przywrócenie odrzuconej wizji** (Administrator, step-up) dopuszczalne jest wyłącznie przy **omyłce pracownika** albo gdy osoba **sama wznowi** zapytanie. Przywrócenie „bo może się zdecyduje” byłoby przetwarzaniem bez podstawy. Rekomendacja R6: odnotowywać powód przywrócenia (kod, bez danych).
5. **Wniosek:** 14 dni jest uzasadnione pod warunkami: podstawa lit. f ujawniona w klauzuli, brak jakiegokolwiek użycia danych, natychmiastowe usunięcie na żądanie i przywracanie tylko w razie pomyłki.

### 4.5 Kopie oferty poza systemem

Każda kopia podlega ograniczeniu przechowywania (C-77/21). Ręczna procedura biura jest **prawnie wystarczająca, jeśli faktycznie działa i daje się wykazać** (art. 5 ust. 2). To dziś najsłabszy element rozwiązania: e-mail w „Wysłanych”, plik roboczy, kosz. Rekomenduję:
- **(W6)** wpis o usunięciu kopii w karcie przeglądu wizji;
- **(R2)** techniczną retencję w poczcie i na dysku: oferty wizji w dedykowanym folderze lub etykiecie z automatycznym usuwaniem po 90 dniach (z koszem) i plik roboczy w folderze z cyklicznym czyszczeniem;
- poinformowanie osoby, że kopie poza systemem usuwamy w tych samych terminach (rozdz. 9.2).

### 4.6 Podsumowanie retencji

| Okres | Ocena | Podstawa w okresie | Warunki |
|---|---|---|---|
| 90 dni | uzasadniony jako termin maksymalny | lit. b (lit. f w S2–S7) | niezwłoczne zamykanie po rezygnacji; zalecany termin ważności oferty |
| do 270 dni | uzasadniony wyjątkowo | lit. b, o ile żądanie jest aktualne | przedłużenie po potwierdzeniu zainteresowania; zamknięta lista powodów; audyt |
| 14 dni po odrzuceniu | uzasadniony | **lit. f** (nie art. 17 ust. 3) | ujawnione w klauzuli; brak użycia; usunięcie od razu na żądanie; przywrócenie tylko przy pomyłce |
| kopie poza systemem | wymagają usunięcia w tych samych terminach | jak wyżej | procedura z dowodem; zalecana retencja techniczna |
| kopie zapasowe 30 / 37 dni | akceptowalne pod warunkami | art. 32 (bezpieczeństwo) — kopie poza użyciem | rozdz. 6.3 |

---

## 5. Pytanie 3 — czy klauzula spełnia art. 13 (i art. 14)

### 5.1 Elementy obowiązkowe a obecne nośniki

| Element (art. 13) | Karta A6 1.1 | Klauzula „Klienci” 1.1 | Ocena |
|---|---|---|---|
| Administrator i kontakt (ust. 1 lit. a) | tak (pola `[…]` do uzupełnienia przy druku) | tak, pełne dane rejestrowe | OK — karta wymaga wypełnienia przed drukiem |
| IOD (ust. 1 lit. b) | — | „nie wyznaczyliśmy inspektora” | OK |
| Cele i podstawy (ust. 1 lit. c) | lit. b dla zamawiającego; lit. f dla osób w kadrze | lit. b; lit. f dla właściciela, który nie zamawiał, i osób trzecich | **niepełne** — brak lit. f dla zamawiającego działającego za inną osobę, dla adresata oferty, który nie prosił, i dla 14 dni po rezygnacji (pkt 3.8) |
| Uzasadniony interes (ust. 1 lit. d) | dla osób w kadrze | dla osób w kadrze i właściciela | **niepełne** — jak wyżej; C-394/23 |
| Odbiorcy (ust. 1 lit. e) | pracownicy, dostawcy IT w UE | pełna lista | OK, z zastrzeżeniem poczty (pkt 5.5) |
| Transfer poza EOG (ust. 1 lit. f) | odesłanie do pełnej informacji | tak (Grafana — DPF i SCC) | **do weryfikacji** — dostawca poczty (W7) |
| Okres (ust. 2 lit. a) | 90 / 270 / 14 dni, kopie 37 dni | jak karta | OK; dodać kryterium przedłużenia i kopie poza systemem |
| Prawa (ust. 2 lit. b) i sprzeciw odrębnie (art. 21 ust. 4) | tak, sprzeciw osobno | tak, osobny akapit | OK |
| Zgoda (ust. 2 lit. c) | nie dotyczy | nie dotyczy | OK |
| Skarga (ust. 2 lit. d) | tak | tak | OK |
| Wymóg i skutki niepodania (ust. 2 lit. e) | tak | tak | OK; dodać e-mail jako nieobowiązkowy |
| Decyzje zautomatyzowane (ust. 2 lit. f) | tak | tak | OK |
| Zmiana celu (ust. 3) | „po zawarciu umowy — jak dokumentację zlecenia” | „staje się częścią dokumentacji zlecenia” | **doprecyzować** cel i podstawę zdjęć po konwersji (pkt 3.3) |
| Kategorie danych | adres, zdjęcia, notatki, telefon, oferta | jak karta | **dodać** adres e-mail i kopie oferty poza systemem |

### 5.2 Język i forma (art. 12 ust. 1)

Tekst jest prosty, w drugiej osobie, z krótkimi zdaniami i konkretnymi okresami. Warstwowość (karta A6 → klauzula pod kodem QR, naklejka jako warstwa najkrótsza) odpowiada WP260: w kontekście niecyfrowym pierwsza warstwa podaje cel, administratora, prawa i informacje o największym wpływie, reszta jest pod łatwo dostępnym odesłaniem.

**Do poprawy:**
- „możemy zapisać ofertę” → zdanie warunkowe z regułą (pkt 3.8, uwaga 3);
- dwuznaczne „ich” (pkt 3.8, uwaga 1);
- sprawdzić, czy po zmianach karta A6 zmieści się na formacie A6 przy minimalnym rozmiarze 9 pt; ewentualnie skrócić inne fragmenty, a nie pomijać podstaw.

### 5.3 Moment przekazania

- Art. 13 ust. 1 wymaga informacji **„podczas pozyskiwania”** danych. Karta wręczana przed pierwszym zdjęciem spełnia ten wymóg dla danych zbieranych **na miejscu** (zdjęcia, notatki) — rozwiązanie wzorcowe.
- **Luka 1 — przyjęcie zgłoszenia:** adres, telefon i często imię i nazwisko zbiera się już przy zgłoszeniu wizji (telefon, e-mail, formularz), czyli przed wizytą technika. Wtedy nie jest przekazywana żadna informacja. Rozwiązanie o niskim koszcie (W4): krótka informacja ustna przy zgłoszeniu telefonicznym i potwierdzenie SMS lub e-mail z linkiem do klauzuli, a przy zgłoszeniu e-mailem — odpowiedź z tą samą informacją. Tekst — rozdz. 9.6.
- **Luka 2 — nieobecność zamawiającego:** karta zostaje u osoby, która wpuściła technika, a zamawiający dostaje informację dopiero z ofertą. Dla zamawiającego to opóźnienie w stosunku do art. 13. Luka 1 rozwiązana przez W4 usuwa także ten problem, bo zamawiający ma informację z potwierdzenia zgłoszenia.
- **Klauzula w panelu i aplikacji** nie jest kanałem doręczenia osobie, której dane dotyczą. Jest źródłem pod kodem QR i linkiem — tak ją traktować. Docelowa publikacja na publicznej stronie firmy (EVM-133 C9) jest słuszna.

### 5.4 Art. 14 — gdy dane pochodzą od zamawiającego, a dotyczą innej osoby

Dotyczy scenariuszy S3 (adresat oferty), S2 i S4 (właściciel, mieszkańcy) oraz S5 (zarządca).

- **Termin (art. 14 ust. 3):** najpóźniej przy pierwszej komunikacji z osobą (lit. b), w innym wypadku w rozsądnym terminie, najpóźniej w ciągu miesiąca (lit. a). Wysłanie oferty do adresata jest pierwszą komunikacją, więc informacja powinna być **w samej ofercie lub w wiadomości z ofertą**.
- **Wyjątek z art. 14 ust. 5 lit. b** (niewspółmierny wysiłek) **nie ma zastosowania**, gdy administrator zna imię, nazwisko i adres. Ma zastosowanie do właściciela nieidentyfikowanego z nazwiska (S2): administrator nie musi go ustalać (art. 11 ust. 1), a informacja jest dostępna publicznie.
- **Dodatkowe elementy art. 14:** źródło danych (ust. 2 lit. f) — „od osoby, która zamówiła wizję”; kategorie danych (ust. 1 lit. d); uzasadniony interes (ust. 2 lit. b); prawo sprzeciwu wyraźnie i odrębnie (art. 21 ust. 4).
- Klauzula „osoby kontaktowe stron” nie pasuje do tej sytuacji: mówi o danych „od klienta, z dokumentów zlecenia albo od Twojej organizacji” i o okresie 2 lat. Informację dla adresata oferty lepiej dać w **stopce oferty** (rozdz. 9.5) i w sekcji „Wizja lokalna” klauzuli „Klienci” (rozdz. 9.1).

### 5.5 Odbiorcy, okres, sprzeciw, transfer

- **Odbiorcy:** oferta wysyłana e-mailem trafia do dostawcy poczty (podmiot przetwarzający). Klauzula wymienia „dostawców poczty elektronicznej”, a karta mówi o „dostawcach usług IT… na serwerach w UE” i że danych z wizji „nie przekazujemy innym firmom”. Jeżeli dostawca poczty przetwarza dane poza EOG albo z możliwym dostępem spoza EOG, zdania o UE i EOG są **nieprawdziwe** (art. 5 ust. 1 lit. a). Wymaga to weryfikacji (W7) i ewentualnie zmiany treści. Dostawca poczty powinien mieć umowę powierzenia (art. 28) i być w rejestrze.
- **Okres:** rozdz. 4 — dodać kryterium przedłużenia i kopie poza systemem.
- **Sprzeciw:** jest wyraźnie i odrębnie na karcie i w klauzuli — OK. Po rozdzieleniu podstaw warto przy liście podstaw w sekcji wizji odesłać do akapitu o sprzeciwie.

### 5.6 Co dodać — lista

1. Rozdzielone podstawy według kategorii osób (S1–S7), z interesem przy lit. f.
2. Podstawa i warunki 14 dni po rezygnacji (lit. f; usunięcie wcześniej na żądanie).
3. Zdanie o ofercie jako reguła, nie możliwość („możemy”); kategorie danych w ofercie (imię i nazwisko adresata, adres, zakres, cena), adres e-mail, kopie poza systemem.
4. Źródło danych dla osób, których dane podał zamawiający (art. 14 ust. 2 lit. f).
5. Cel i podstawa zdjęć po zawarciu umowy (dokumentacja prac — lit. f, jak w części ogólnej).
6. Kryterium przedłużenia („po uzgodnieniu z Tobą”).
7. Informacja przy zgłoszeniu (SMS lub e-mail) i w stopce oferty.

---

## 6. Pytanie 4 — rejestr czynności, DPIA, ryzyka rezydualne

### 6.1 Rejestr czynności (art. 30) — aktualizacja wymagana

Wyłączenie z art. 30 ust. 5 nie ma zastosowania (przetwarzanie nie jest sporadyczne). Czynność 9 trzeba zaktualizować **przed pierwszą realną wizją z ofertą**:
- **Kategorie danych:** oferta (imię, nazwisko, adres adresata; zakres; cena); adres e-mail, na który wysłano ofertę.
- **Kategorie osób:** zamawiający; adresaci ofert, którzy nie zamawiali; zamawiający działający za inną osobę lub podmiot.
- **Podstawy rozdzielone** jak w macierzy S1–S8; lit. f dla 14 dni po rezygnacji.
- **Odbiorcy:** dostawca poczty (powierzenie) — po ustaleniu, kim jest.
- **Okresy:** w tym kopie poza systemem w terminach wizji i kopie zapasowe (30 / 37 dni).
- **Powiązanie z czynnością „poczta firmowa”** (dziś punkt 13 listy konsultacji, otwarty).

Wzór wiersza — rozdz. 9.7.

### 6.2 DPIA — czy wymagana

- **Dla samej zmiany** (oferta z imieniem, nazwiskiem, adresem i ceną) odrębna DPIA **nie jest wymagana**. Dane są zwykłe, skala mała, nie ma profilowania, oceny, monitorowania, łączenia zbiorów ani nowej technologii. Według WP248 i wykazu UODO (M.P. 2019 poz. 666) zmiana nie dodaje żadnego kryterium. Jedynym kryterium częściowo spełnionym w obszarze wizji pozostają **zdjęcia domów i garaży** (dane o charakterze wysoce osobistym), a jedno kryterium zwykle nie przesądza o obowiązku DPIA.
- **Istniejąca DPIA systemu** (v1.0, wymagana z powodu dwóch kryteriów: dokumenty z PESEL i prywatne telefony pracowników) obejmuje wizję w aneksie v1.1. Aneks v1.2 jest **właściwym i proporcjonalnym** sposobem przeglądu z art. 35 ust. 11. Ocena D14 (Low z `enforce`, Medium do `enforce`) jest spójna z moją oceną.
- **Warunek formalny:** aneksy v1.1 i v1.2 są projektami. DPIA zatwierdza się **przed** rozpoczęciem przetwarzania (art. 35 ust. 1), więc zatwierdzenie przez administratora musi poprzedzić pierwszą realną wizję z ofertą. Uprzednie konsultacje z Prezesem UODO (art. 36) **nie są wymagane**, bo ryzyko rezydualne nie jest wysokie.
- **Dopisać do aneksu v1.2:** scenariusz „oferta na osobę, która nie prosiła” (S3: brak informacji z art. 14, zaskoczenie osoby; środki W3; P1 × W1) oraz „transfer przez dostawcę poczty” (W7).
- **Ryzyko „Medium do `enforce`” (RR-102)** to ocena ryzyka dla osób, nie zgoda na naruszenie. Każda wizja nieusunięta w terminie deklarowanym w klauzuli jest **naruszeniem art. 5 ust. 1 lit. e i obowiązku informacyjnego** (treść nieprawdziwa), niezależnie od oceny ryzyka. Procedura ręczna musi więc faktycznie działać i zostawiać dowód (karta przeglądu).

### 6.3 Ryzyka rezydualne — kopie zapasowe do 37 dni (treść oferty w starszych wersjach obiektów do 30 dni)

- **Stanowisko EROD:** raport CEF 2025 (10.02.2026, Issue 6) uznaje, że modyfikowanie lub usuwanie informacji z kopii „might not always be advisable” ze względu na integralność kopii (np. ochronę przed ransomware). Organizacje powinny jednak mieć procedury, które śledzą żądania usunięcia i stosują je ponownie w odtworzonych systemach. Rekomendacje: bezpieczne standardy usuwania, weryfikacja i możliwość wykazania usunięcia. EROD zapowiada dalsze wytyczne.
- **Biuletyn UODO** (28.11.2025; zgodnie z zastrzeżeniem biuletynu nie jest to oficjalne stanowisko organu) przyjmuje ujęcie **surowsze**: przy braku wyjątku z art. 17 ust. 3 dane trzeba usunąć „również z kopii zapasowych” bez zbędnej zwłoki, a techniczna trudność usunięcia pojedynczych rekordów nie jest podstawą odmowy. Kopie należy projektować zgodnie z art. 25.
- **Ocena:**
  - Rozwiązanie projektu — kopie szyfrowane, poza bieżącym użyciem, z określonym maksimum (37 dni), odtwarzane tylko po awarii, z ponownym stosowaniem rejestru usunięć i z informacją dla osób — mieści się w podejściu EROD. Daje się obronić argumentem z art. 32: niezmienność kopii jest środkiem bezpieczeństwa, a krótki, deterministyczny okres rotacji realizuje usunięcie „bez zbędnej zwłoki” w rozsądnym rozumieniu.
  - **Ryzyko prawne jest niskie, ale niezerowe**, bo polski organ może przyjąć podejście z biuletynu.
- **Warunki akceptowalności:**
  1. maksimum 37 dni wymuszone technicznie (IaC), a nie deklaratywnie;
  2. dostęp do kopii i do starszych wersji obiektów tylko dla ról infrastrukturalnych, bez dostępu aplikacji i użytkowników biznesowych;
  3. **przed włączeniem `enforce` i przed pierwszym odtworzeniem** — działające ponowne stosowanie rejestru usunięć (EVM-062, z obsługą `documentIds`), a do tego czasu ręczny krok w runbooku odtworzenia;
  4. pisemne uzasadnienie w DPIA lub rejestrze, dlaczego kopie są niezmienne (ransomware, art. 32) i dlaczego 30 / 37 dni;
  5. w odpowiedzi na żądanie usunięcia podanie osobie **konkretnej daty**, do której dane mogą pozostać w kopiach — runbook już to przewiduje.
- **Rekomendacja R5:** sprawdzić, czy przy **żądaniu z art. 17** można usuwać starsze wersje obiektów **plików oferty** od razu (usunięcie konkretnej wersji obiektu), jeżeli nie wyklucza tego blokada niezmienności bucketu. Treść oferty (imię i nazwisko) znikałaby wtedy natychmiast, a w kopiach bazy zostawałyby tylko metadane. Jeżeli wersjonowanie jest celowo nieusuwalne dla aplikacji (ochrona przed ransomware), zostawić obecne rozwiązanie z uzasadnieniem z pkt 4.
- **Pozostałe ryzyka rezydualne** z aneksu v1.2 (pozostawienie oferty po usunięciu wizji, skan dowodu jako „oferta”, imię w tytule, dostęp nieuprawniony, kopie poza systemem) mają adekwatne środki. Najwyższe ryzyko prawne to **kopie poza systemem** (pkt 4.5), bo zależy wyłącznie od dyscypliny biura.

---

## 7. Pytanie 5 — ryzyka i rekomendacje

### 7.1 Ryzyka prawne

| ID | Ryzyko | Prawdopodobieństwo | Skutek prawny | Środek |
|---|---|---|---|---|
| RP1 | Zamawiający ≠ przyszły klient (S3–S7) bez poprawnej, ujawnionej podstawy | średnie (scenariusz częsty) | brak podstawy z lit. b; lit. f nieważna bez informacji o interesie (C-394/23); naruszenie art. 6 i 13–14 | W1, W2, W3 |
| RP2 | Dane osób, które zrezygnowały, leżą do 90 lub 270 dni, bo wizji nie zamknięto | średnie | art. 5 ust. 1 lit. e; nieprawdziwa informacja o okresie | W5 |
| RP3 | Przedłużenie bez aktualnego żądania | niskie lub średnie | brak podstawy z lit. b w okresie przedłużenia | W5 (potwierdzenie przy przedłużeniu) |
| RP4 | Kopie oferty w poczcie i na dysku bez usunięcia | wysokie bez środka technicznego | art. 5 ust. 1 lit. e; niepełna realizacja art. 17 | W6, R2 |
| RP5 | Brak informacji przy zgłoszeniu i przy nieobecności zamawiającego | wysokie (brak procesu) | art. 13 ust. 1 (moment) | W4 |
| RP6 | Treść klauzuli i karty niezgodna z praktyką (EOG i poczta; „usuwamy” przy `report` bez procedury) | nieznane / średnie | art. 5 ust. 1 lit. a, art. 13 | W5, W7 |
| RP7 | 14 dni po rezygnacji bez ujawnionej podstawy | pewne przy obecnej treści | „podmiana podstawy” (EROD 2/2019 pkt 41), art. 13 | W1 |
| RP8 | Kopie zapasowe a stanowisko UODO z biuletynu | niskie | spór o art. 17 i art. 5 ust. 1 lit. e | warunki z pkt 6.3, R5 |
| RP9 | Kontakt handlowy po rezygnacji bez zgody | niskie lub średnie | art. 398 PKE, art. 6 RODO | instrukcja (rozdz. 9.8) |
| RP10 | Przywrócenie odrzuconej wizji bez pomyłki | niskie | brak podstawy | R6 |
| RP11 | Skan dowodu lub dokument z PESEL jako „oferta” | niskie | art. 5 ust. 1 lit. c; ryzyko jak DPIA D1 | środki istniejące (ADR-0025) |
| RP12 | Wydruk kart A6 1.1, które trzeba będzie znowu niszczyć | średnie | koszt, ryzyko użycia nieaktualnej karty | wstrzymać druk do wersji 1.2 |

### 7.2 Rekomendacje (zbiorczo)

- **Treść:** klauzula „Klienci” 1.2, karta A6 1.2, naklejka — rozdz. 9.1–9.4. Zgodnie z mechanizmem z EVM-133/149: nowa wersja i data, karta zgodna z klauzulą, test zgodności. **Jeżeli karty 1.1 nie zostały jeszcze wydrukowane — nie drukować ich**, poczekać na 1.2.
- **Proces:** informacja przy zgłoszeniu (9.6), stopka oferty (9.5), reguły dla biura (9.8).
- **Dokumenty:** test równowagi (9.9), czynność 9 rejestru (9.7), uzupełnienie aneksu DPIA v1.2 (pkt 6.2).
- **Backlog** — wyłącznie przez `/refine`, poza zakresem tej opinii:
  - (R1) pole „rola zamawiającego” z zamkniętej listy (dla siebie / dla innej osoby / zarządca lub wspólnota / firma), bez danych osobowych — ułatwia wybór podstawy i obowiązku z art. 14;
  - (R3) usuwanie danych lokalizacji z plików wgrywanych w panelu;
  - (R5) usuwanie starszych wersji obiektów oferty na żądanie;
  - (R6) kod powodu przywrócenia wizji.

---

## 8. Werdykt i warunki

### WERDYKT: **PODSTAWA WYSTARCZAJĄCA POD WARUNKAMI**

Art. 6 ust. 1 lit. b RODO jest właściwą i wystarczającą podstawą dla adresu, telefonu, zdjęć i filmów oraz oferty z imieniem i nazwiskiem **wobec osoby, która sama prosi o oględziny lub ofertę dla siebie, przez czas, w którym jej żądanie jest aktualne**. W pozostałych sytuacjach (S2–S7, 14 dni po rezygnacji) przetwarzanie jest zgodne z prawem **tylko jeśli** opiera się na lit. f z udokumentowanym testem równowagi i z informacją podaną w chwili zbierania danych. Przetwarzanie z inicjatywy firmy (S8) nie ma podstawy.

### Warunki — do spełnienia przed pierwszą realną wizją z ofertą

| # | Warunek | Uzasadnienie |
|---|---|---|
| **W1** | Klauzula „Klienci” 1.2 i karta A6 / naklejka 1.2 z **rozdzielonymi podstawami** (lit. b dla zamawiającego dla siebie; lit. f z konkretnym interesem dla zamawiającego za inną osobę, adresata oferty, który nie prosił, właściciela i mieszkańców, osób w kadrze), z **podstawą dla 14 dni po rezygnacji**, ze zdaniem o ofercie w formie reguły (bez „możemy”), z adresem e-mail i kopiami poza systemem w kategoriach i okresach oraz z celem zdjęć po zawarciu umowy (tekst: rozdz. 9.1–9.4) | art. 6, 12, 13; C-394/23 pkt 52; EROD 2/2019 pkt 41–44 |
| **W2** | Pisemny **test równowagi interesów** F1–F5 przed rozpoczęciem przetwarzania, w rejestrze poza repozytorium (szablon: 9.9) | art. 5 ust. 2, art. 6 ust. 1 lit. f; EROD 1/2024 pkt 7 |
| **W3** | **Adresat oferty, który sam nie prosił:** jego imię i nazwisko trafia do oferty tylko wtedy, gdy zamawiający potwierdzi, że ta osoba wie o zapytaniu (w przeciwnym razie oferta na zamawiającego z oznaczeniem nieruchomości), a **każda oferta ma stopkę informacyjną** spełniającą art. 13 i 14 (tekst: 9.5) | art. 5 ust. 1 lit. c, art. 14 ust. 3 lit. b, art. 21 ust. 4 |
| **W4** | **Informacja przy przyjęciu zgłoszenia:** krótka formuła ustna i SMS lub e-mail z linkiem do klauzuli (tekst: 9.6) | art. 13 ust. 1 („podczas pozyskiwania”) |
| **W5** | **Retencja w praktyce:** `enforce` włączony albo udokumentowana procedura ręczna RR-102 z ofertami i funkcja usunięcia telefonu zamawiającego (warunki już przyjęte w projekcie); **przedłużenie tylko po potwierdzeniu przez osobę aktualnego zainteresowania**; niezwłoczne „Odrzuć wizję” po rezygnacji lub odrzuceniu; **usunięcie od razu na żądanie** także w trybie `enforce` | art. 5 ust. 1 lit. e, art. 12 ust. 3, art. 17 ust. 1 |
| **W6** | **Kopie oferty poza systemem** usuwane w terminach wizji z dowodem w karcie przeglądu (zalecana retencja techniczna w poczcie — R2) | art. 5 ust. 1 lit. e i ust. 2; C-77/21 |
| **W7** | **Weryfikacja dostawcy poczty** (lokalizacja przetwarzania, transfery, umowa powierzenia) i odpowiednia korekta zdań o UE i EOG; wpis poczty do rejestru | art. 5 ust. 1 lit. a, art. 13 ust. 1 lit. e–f, art. 28, art. 44 i n. |
| **W8** | **Rejestr** (czynność 9 według 9.7) i **aneks DPIA v1.2** (z dopiskami z pkt 6.2) zatwierdzone przez administratora **przed** przetwarzaniem; warunki kopii zapasowych z pkt 6.3 (ponowne stosowanie rejestru usunięć przed pierwszym odtworzeniem i przed `enforce`) | art. 30, art. 35 ust. 1 i 11, art. 17, art. 32 |
| **W9** | **Weryfikacja przez licencjonowanego radcę prawnego lub adwokata** — warunek z `rodo.md` (pkt 6 lit. b) i z aneksu DPIA v1.2 (warunek 3) **pozostaje otwarty**; ta opinia go nie spełnia | rozdz. 10 |

### Rekomendacje (nieblokujące)

- **R1** — pole „rola zamawiającego” (backlog).
- **R2** — techniczna retencja ofert w poczcie i na dysku.
- **R3** — usuwanie lokalizacji z plików wgrywanych w panelu (backlog).
- **R4** — termin ważności w każdej ofercie (np. 30 dni) jako obiektywny moment zamknięcia wizji.
- **R5** — kopie zapasowe: usuwanie starszych wersji obiektów oferty na żądanie, jeśli technicznie możliwe; uzasadnienie niezmienności w DPIA; obserwacja stanowiska UODO i przyszłych wytycznych EROD.
- **R6** — przywracanie odrzuconej wizji tylko przy pomyłce lub wznowieniu przez osobę, z kodem powodu.
- **R7** — zawężenie kadru w instrukcji do elementów potrzebnych do wyceny (pozytywna lista).

---

## 9. Rekomendowane brzmienie (gotowy tekst)

Teksty zachowują styl i stałe z `apps/web/src/privacy/content.ts` (forma „Ty”, odesłania do sekcji). Każda zmiana to nowa wersja klauzul (1.2) i karty z nową datą, zgodnie z mechanizmem EVM-133/149. Pola `[…]` uzupełnia się jak na karcie A6.

### 9.1 Klauzula „Klienci” — sekcja „Wizja lokalna (oględziny przed ofertą)” (zastępuje obecne akapity tej sekcji)

> **Wizja lokalna (oględziny przed ofertą)**
>
> Jeżeli prosisz nas o ofertę, nasz pracownik może najpierw obejrzeć miejsce instalacji (wizja lokalna). Wizję robimy wyłącznie na zgłoszenie osoby, która prosi o oględziny lub ofertę (zamawiającego) — nigdy z własnej inicjatywy.
>
> Na tym etapie zapisujemy w naszym systemie: adres miejsca instalacji, zdjęcia i filmy miejsca instalacji — posesji, garażu i instalacji elektrycznej (filmy nagrane w aplikacji — bez dźwięku; wraz z danymi zapisanymi w pliku, np. datą, a w plikach dodanych w panelu także miejscem wykonania), notatki z oględzin oraz — jeśli zamawiający go poda — numer telefonu do kontaktu w sprawie oferty.
>
> Jeżeli przygotujemy ofertę, zapisujemy ją w systemie razem z danymi z wizji. Oferta zawiera imię i nazwisko osoby, dla której ją przygotowaliśmy, adres miejsca instalacji (i adres korespondencyjny, jeśli go podasz), zakres prac i cenę. Jeżeli wysyłamy ofertę e-mailem, przetwarzamy też adres e-mail, na który ją wysyłamy. Na etapie wizji nie zapisujemy w systemie innych dokumentów, w szczególności kopii dokumentów tożsamości.
>
> Podstawy przetwarzania na etapie wizji:
> - jeżeli prosisz o oględziny lub ofertę dla siebie — przetwarzamy Twoje dane, żeby podjąć działania, o które prosisz, przed zawarciem umowy: oględziny, przygotowanie i przedstawienie oferty oraz kontakt w jej sprawie (art. 6 ust. 1 lit. b RODO); dane pochodzą od Ciebie i z oględzin wykonanych przez naszego pracownika,
> - jeżeli zamawiasz wizję dla innej osoby, wspólnoty albo firmy (np. jako członek rodziny, zarządca nieruchomości albo pracownik) — Twoje dane kontaktowe przetwarzamy w naszym prawnie uzasadnionym interesie, którym jest kontakt w sprawie wizji i oferty (art. 6 ust. 1 lit. f RODO),
> - jeżeli o ofertę dla Ciebie poprosiła inna osoba albo jesteś właścicielem lub mieszkańcem posesji, a wizję zamówił ktoś inny (np. najemca) — Twoje dane (adres i zdjęcia posesji, a gdy oferta jest przygotowana dla Ciebie — także imię i nazwisko w ofercie) otrzymaliśmy od zamawiającego i przetwarzamy je w naszym prawnie uzasadnionym interesie, którym jest przygotowanie oferty, o którą poproszono (art. 6 ust. 1 lit. f RODO); gdy sam potwierdzisz zainteresowanie ofertą, dalsze działania przed zawarciem umowy podejmujemy na Twoje żądanie (art. 6 ust. 1 lit. b RODO),
> - po rezygnacji albo odrzuceniu oferty przechowujemy dane z wizji jeszcze najwyżej 14 dni i nie korzystamy z nich — w naszym prawnie uzasadnionym interesie, którym jest naprawienie ewentualnej pomyłki w oznaczeniu rezygnacji i uporządkowane usunięcie danych (art. 6 ust. 1 lit. f RODO); na Twoje żądanie usuniemy je wcześniej,
> - jeżeli zawrzemy umowę, zdjęcia, filmy i notatki z wizji stają się częścią dokumentacji zlecenia i przetwarzamy je w celach i na podstawach opisanych wyżej dla zlecenia i dla zdjęć z prac.
>
> Jeżeli na zdjęciach mimo naszej ostrożności znajdą się inne osoby, ich pojazdy albo tabliczki z nazwiskami, przetwarzamy je w naszym prawnie uzasadnionym interesie, którym jest przygotowanie oferty, a po zawarciu umowy — udokumentowanie stanu miejsca przed pracami (art. 6 ust. 1 lit. f RODO); zasady opisuje sekcja „Osoby postronne na zdjęciach i filmach”.
>
> Wobec przetwarzania na podstawie prawnie uzasadnionego interesu przysługuje Ci prawo sprzeciwu — zob. sekcję „Twoje prawa”.
>
> Podanie adresu i umożliwienie oględzin jest dobrowolne, ale bez nich nie przygotujemy oferty. Numer telefonu jest nieobowiązkowy; adres e-mail podajesz, jeśli chcesz otrzymać ofertę e-mailem.

### 9.2 Klauzula „Klienci” — lista „Jak długo przechowujemy dane” (zastępuje dwa pierwsze punkty, dodaje trzeci)

> - dane z wizji lokalnej, po której nie zawarliśmy umowy (także oferta zapisana na etapie wizji) — najpóźniej po 90 dniach od zapisania wizji w naszym systemie (zwykle w dniu wizji); gdy ustalimy z Tobą, że decyzja wymaga więcej czasu (np. czekasz na uchwałę wspólnoty albo na warunki przyłączenia), możemy ten okres przedłużyć najwyżej dwa razy o 90 dni — łącznie nie dłużej niż 270 dni od zapisania wizji,
> - dane z wizji lokalnej po rezygnacji albo odrzuceniu oferty — 14 dni od rezygnacji lub odrzucenia, a na Twoje żądanie wcześniej; jeżeli zawrzemy umowę, dokumentacja z wizji staje się częścią dokumentacji zlecenia i przechowujemy ją jak dane zlecenia,
> - kopie oferty poza systemem (wiadomość e-mail z ofertą, plik roboczy, wydruk) — usuwamy w tych samych terminach co dane z wizji,

### 9.3 Karta A6 (wersja 1.2) — fragmenty do zmiany

**„Po co zbieramy dane?”** (zamiast obecnego akapitu):
> Żeby przygotować ofertę, o którą prosisz — to działania na Twoje żądanie przed zawarciem umowy (art. 6 ust. 1 lit. b RODO). Jeżeli zamawiasz wizję dla kogoś innego (np. członka rodziny, wspólnoty albo firmy) albo oferta jest dla Ciebie, ale poprosił o nią ktoś inny, dane przetwarzamy w naszym prawnie uzasadnionym interesie: przygotowania oferty i kontaktu w jej sprawie (art. 6 ust. 1 lit. f RODO). Na tej samej podstawie przetwarzamy osoby, pojazdy i tabliczki z nazwiskami, które przypadkiem znajdą się w kadrze, a po zawarciu umowy — dokumentujemy stan miejsca przed pracami.

**„Jakie dane zapisujemy?”** (zamiast obecnego akapitu):
> Adres miejsca instalacji, zdjęcia i filmy posesji, garażu i instalacji elektrycznej (filmy bez dźwięku), notatki z oględzin oraz numer telefonu — tylko jeśli go podasz. Jeżeli przygotujemy ofertę, zapisujemy ją razem z wizją: zawiera imię i nazwisko osoby, dla której jest oferta, adres, zakres prac i cenę; gdy wysyłamy ją e-mailem — także adres e-mail. Innych dokumentów i kopii dokumentów tożsamości na tym etapie nie zapisujemy. Staramy się nie fotografować osób, tablic rejestracyjnych i tabliczek z nazwiskami — jeśli czegoś nie chcesz na zdjęciu, powiedz technikowi.

**„Jak długo?”** (zamiast obecnej listy):
> - bez umowy — usuwamy najpóźniej po **90 dniach** od zapisania wizji w naszym systemie (zwykle w dniu wizji); gdy ustalimy z Tobą, że decyzja wymaga czasu (np. uchwały wspólnoty), możemy przedłużyć ten okres najwyżej dwa razy o 90 dni (łącznie nie dłużej niż **270 dni**),
> - po Twojej rezygnacji albo odrzuceniu oferty — po **14 dniach**; w tym czasie z danych nie korzystamy, a na Twoje żądanie usuniemy je od razu,
> - kopie oferty wysłane e-mailem lub wydrukowane — w tych samych terminach,
> - po zawarciu umowy — tak jak dokumentację zlecenia (szczegóły w pełnej informacji).
>
> Usunięte dane mogą jeszcze do 37 dni pozostawać w zaszyfrowanych kopiach zapasowych.

**„Kto otrzymuje dane?”** — bez zmian, **pod warunkiem** pozytywnej weryfikacji W7. Jeżeli poczta przetwarza dane poza EOG, zdanie o serwerach w UE trzeba zmienić.

Po zmianach sprawdzić, czy treść mieści się na A6 przy co najmniej 9 pt.

### 9.4 Naklejka (wersja 1.2)

> **Wizja lokalna — Twoje dane**
> [pełna nazwa spółki] przetwarza adres, zdjęcia i filmy posesji, telefon (jeśli go podasz) oraz — gdy ją przygotujemy — ofertę z imieniem i nazwiskiem, żeby przygotować ofertę, o którą prosisz (art. 6 ust. 1 lit. b RODO; gdy wizję zamawia ktoś inny — art. 6 ust. 1 lit. f RODO). Bez umowy usuwamy je najpóźniej po 90 dniach od zapisania wizji w naszym systemie (z przedłużeniem — najwyżej 270), po rezygnacji — po 14 dniach. Prawa, sprzeciw i kontakt:
> [kod QR] [adres strony z klauzulą „Klienci”]

### 9.5 Stopka każdej oferty przygotowanej na etapie wizji (art. 13 i 14)

> **Informacja o danych osobowych.** Administratorem danych osobowych zawartych w tej ofercie jest [pełna nazwa spółki i forma prawna] (marka EVia Charge), [adres siedziby]; w sprawach danych: [adres e-mail w sprawach danych]. Ofertę przygotowaliśmy na prośbę osoby, która zamówiła wizję lokalną. Jeżeli to nie Ty prosiłeś o ofertę, Twoje imię, nazwisko i adres otrzymaliśmy od tej osoby i przetwarzamy je w naszym prawnie uzasadnionym interesie, którym jest przygotowanie oferty (art. 6 ust. 1 lit. f RODO); możesz w każdej chwili wnieść sprzeciw. Jeżeli to Ty prosiłeś o ofertę, przetwarzamy dane, żeby podjąć działania na Twoje żądanie przed zawarciem umowy (art. 6 ust. 1 lit. b RODO). Jeżeli nie zawrzemy umowy, usuwamy ofertę i dane z wizji najpóźniej po 90 dniach od zapisania wizji (po uzgodnionym przedłużeniu — najwyżej po 270 dniach), a po rezygnacji — po 14 dniach. Dostęp do danych mają nasi pracownicy i dostawcy usług IT, którzy przechowują dane w naszym imieniu. Masz prawo dostępu do danych, ich sprostowania, usunięcia i ograniczenia przetwarzania oraz prawo skargi do Prezesa UODO. Pełna informacja: [adres strony z klauzulą „Klienci”].

### 9.6 Informacja przy przyjęciu zgłoszenia

**Formuła ustna (telefon)**, wypowiadana przed zapisaniem adresu i numeru:
> Administratorem danych jest [nazwa spółki], marka EVia Charge. Adres i numer telefonu zapisujemy, żeby umówić oględziny i przygotować ofertę. Jeśli nie zawrzemy umowy, usuwamy je najpóźniej po 90 dniach. Pełną informację wyślemy SMS-em i dostanie ją Pan / Pani od technika.

**SMS lub e-mail z potwierdzeniem** — bez adresu posesji i bez imienia w treści SMS:
> EVia Charge: potwierdzamy zgłoszenie wizji lokalnej. Administratorem danych podanych w zgłoszeniu jest [nazwa spółki]; przetwarzamy je, żeby przygotować ofertę, i usuwamy, jeśli nie zawrzemy umowy. Szczegóły i Twoje prawa: [adres klauzuli „Klienci”].

### 9.7 Rejestr czynności — czynność 9 (pola do zmiany)

| Pole | Treść |
|---|---|
| Cel | przygotowanie i przedstawienie oferty na żądanie przed zawarciem umowy (oględziny, zapis oferty, kontakt w jej sprawie); uporządkowane usunięcie danych po rezygnacji |
| Podstawa | lit. b — zamawiający działający dla siebie; adresat oferty po potwierdzeniu zainteresowania; lit. f — zamawiający działający za inną osobę lub podmiot (kontakt), adresat oferty, który nie prosił (do potwierdzenia), właściciel lub mieszkańcy, którzy nie zamawiali, osoby trzecie w kadrze, przechowywanie ≤ 14 dni po rezygnacji; test równowagi F1–F5 z dnia […] |
| Kategorie osób | zamawiający (dla siebie / za inną osobę lub podmiot), adresaci ofert, właściciele i mieszkańcy posesji, osoby trzecie w kadrze, pracownicy (twórca, opiekun) |
| Kategorie danych | adres lokalizacji, zdjęcia i filmy (z metadanymi), notatki, opcjonalny telefon zamawiającego; oferta: imię, nazwisko i adres adresata, zakres, cena; adres e-mail, na który wysłano ofertę |
| Odbiorcy | pracownicy wg ról (A, E; telefon — twórca i opiekun, bez dokumentów); Hetzner, Scaleway (powierzenie); dostawca poczty firmowej [nazwa] (powierzenie) |
| Transfer poza EOG | nie — **po weryfikacji dostawcy poczty** (W7) |
| Okresy | 90 dni od zapisania; przedłużenie ×2 do 270 dni tylko po potwierdzeniu zainteresowania; po rezygnacji 14 dni; kopie oferty poza systemem — te same terminy; kopie zapasowe: starsze wersje obiektów ≤ 30 dni, kopie bazy ≤ 37 dni; po przypisaniu klienta — jak czynności 1 i 2 |
| Źródło danych | osoba, której dane dotyczą; zamawiający (dla osób wskazanych przez niego); oględziny |
| Informacja | art. 13: zgłoszenie (formuła ustna + SMS lub e-mail), karta A6 1.2, klauzula „Klienci” 1.2; art. 14: stopka oferty |

### 9.8 Instrukcja dla biura — dopiski do rozdz. 4

> - **Kto zamawia.** Przy zgłoszeniu zapytaj: „Czy oferta ma być dla Pana / Pani, czy dla innej osoby albo firmy?”. Wypowiedz formułę o danych i wyślij SMS z linkiem do klauzuli.
> - **Oferta dla innej osoby.** Imię i nazwisko innej osoby wpisz do oferty tylko wtedy, gdy zamawiający potwierdzi, że ta osoba wie o zapytaniu; w przeciwnym razie wystaw ofertę na zamawiającego z oznaczeniem nieruchomości. Każda oferta ma stopkę „Informacja o danych osobowych”.
> - **Przedłużenie.** „Przedłuż o 90 dni” wybieraj tylko po rozmowie, w której osoba potwierdziła, że nadal czeka na ofertę albo decyzję; datę rozmowy zapisz w karcie przeglądu (bez imion i telefonów).
> - **Rezygnacja.** Gdy osoba rezygnuje, odrzuca ofertę albo nie odpowiada po terminie ważności oferty i jednym przypomnieniu — od razu „Odrzuć wizję”. Po rezygnacji nie dzwonimy i nie piszemy z propozycjami, chyba że osoba zgodziła się na kontakt marketingowy.
> - **Prośba o usunięcie.** Przekaż ją Administratorowi tego samego dnia — usuwamy od razu, nie czekamy 14 dni.
> - **Zdjęcia.** Fotografuj tylko to, co potrzebne do wyceny: rozdzielnicę, przyłącze, trasę przewodu, miejsce montażu, garaż.
> - **Przywrócenie odrzuconej wizji** — tylko gdy wizję odrzucono przez pomyłkę albo osoba sama wróciła z zapytaniem.

### 9.9 Szablon testu równowagi interesów (jedna strona, rejestr poza repozytorium)

> **Test równowagi — wizja lokalna (F1–F5)** · data: […] · zatwierdził: […]
> 1. **Przetwarzanie:** [F1 / F2 / F3 / F4 / F5 — opis, kategorie osób i danych].
> 2. **Uzasadniony interes:** [np. przygotowanie oferty, o którą poproszono; kontakt w sprawie wizji; naprawa pomyłki i uporządkowane usunięcie] — zgodny z prawem, określony, realny i aktualny.
> 3. **Niezbędność:** dlaczego cel nie może być osiągnięty mniej ingerującymi środkami [np. oferta bez nazwiska adresata, gdy osoba nie wie o zapytaniu]; minimalizacja [kadr, brak imion w tytułach, brak dokumentów tożsamości].
> 4. **Równowaga:** charakter danych [zwykłe / zdjęcia domu]; rozsądne oczekiwania [potencjalny klient, relacja przez zamawiającego]; możliwy wpływ [prywatność domu, zaskoczenie]; zabezpieczenia [informacja z art. 13 i 14 w chwili zbierania, sprzeciw, retencja 90 / 14 dni, dostęp A/E, brak użycia po rezygnacji].
> 5. **Wynik:** [interes przeważa / nie przeważa]; warunki: [...]; przegląd: przy zmianie przetwarzania, najpóźniej za 12 miesięcy.

---

## 10. Zastrzeżenia i punkty do weryfikacji przez człowieka

**Zastrzeżenie zasadnicze.** Tę opinię przygotował **model sztucznej inteligencji (Claude, Anthropic)** działający w roli radcy ds. ochrony danych. **Nie jest to porada prawna ani opinia licencjonowanego radcy prawnego lub adwokata** i nie korzysta z ich odpowiedzialności zawodowej ani ubezpieczenia OC. Może zawierać błędy w ocenie, w odczycie źródeł albo nieaktualne informacje. Model nie ma dostępu do baz komercyjnych (LEX, Legalis), do pełnych tekstów wszystkich orzeczeń ani do faktycznej praktyki firmy.

**Opinia nie spełnia warunku „weryfikacja podstawy prawnej przez prawnika”** (`docs/security/rodo.md`, sekcja „Klauzula 1.1 i dokumenty wizji”, pkt 6 lit. b; aneks DPIA v1.2, warunek 3). Nie należy jej rejestrować jako takiej weryfikacji. Może służyć jako materiał wejściowy do konsultacji z człowiekiem.

**Ograniczenia stanu faktycznego:** opinia opiera się wyłącznie na dokumentach repozytorium i opisie zleceniodawcy. Nie sprawdzałem wzorów ofert, umów z dostawcami (w szczególności poczty), faktycznego obiegu zgłoszeń ani tego, czy karty A6 1.1 zostały wydrukowane.

**Punkty, które szczególnie warto zweryfikować u licencjonowanego radcy prawnego:**
1. Czy lit. b obejmuje dane zamawiającego, który działa za inną osobę, **ale sam będzie stroną umowy lub płatnikiem** (np. syn zawiera umowę dotyczącą domu rodziców), oraz jak traktować pełnomocnika lub posłańca (art. 95 KC) przy ocenie „żądania osoby, której dane dotyczą”.
2. Konstrukcja podstawy dla 14 dni po rezygnacji: lit. f (rekomendowana) czy element procesu usuwania „bez zbędnej zwłoki”.
3. Kopie zapasowe a stanowisko z biuletynu UODO z 28.11.2025 — czy obecne podejście (rotacja ≤ 37 dni i ponowne stosowanie rejestru usunięć) wystarczy w razie kontroli; ewentualnie aktualne stanowiska lub decyzje Prezesa UODO.
4. Wniosek, że odrębna DPIA dla oferty nie jest wymagana (wystarcza aneks), w świetle aktualnego wykazu UODO — należy sprawdzić, czy po 2019 r. nie ogłoszono nowego.
5. Dostawca poczty firmowej: transfery, umowa powierzenia, prawdziwość zdań o UE i EOG w karcie i klauzuli.
6. Art. 398 PKE (zgoda na kontakt marketingowy) — brzmienie i zakres po wejściu w życie ustawy z 12.07.2024 r.; zastosowanie do kontaktu po odrzuceniu oferty.
7. Wyrok NSA z 20.02.2024, III OSK 2700/22 — znany mi wyłącznie z omówień prasowych; sprawdzić w CBOSA sygnaturę, datę i tezę, jeśli analogia ma być powołana.
8. Treść klauzuli 1.2 i stopki oferty — redakcja końcowa i zgodność z praktyką, w tym zmieszczenie się na formacie A6.
9. Numeracja punktów wytycznych EROD 1/2024 w wersji 2.0 (przyjętej 10.11.2026) — odczytana z PDF; przy cytowaniu w dokumentach firmy sprawdzić w wersji polskiej, gdy zostanie opublikowana.

---

## 11. Źródła

**Akty prawne**
- RODO — rozporządzenie (UE) 2016/679, tekst polski: https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679
- Komunikat Prezesa UODO z 17.06.2019 r. w sprawie wykazu rodzajów operacji przetwarzania wymagających oceny skutków (M.P. 2019 poz. 666): https://eli.gov.pl/api/acts/MP/2019/666/text/O/M20190666.pdf
- Kodeks cywilny (art. 66 § 2, art. 95); Prawo komunikacji elektronicznej z 12.07.2024 r. (art. 398) — teksty w ISAP: https://isap.sejm.gov.pl

**Wytyczne i dokumenty EROD / Grupy Roboczej Art. 29**
- EROD, Wytyczne 2/2019 w sprawie art. 6 ust. 1 lit. b, wersja 2.0 z 8.10.2019 (pkt 22–25, 40–47, przykłady 4–6): https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf
- EROD, Wytyczne 1/2024 w sprawie art. 6 ust. 1 lit. f, wersja 2.0 przyjęta 10.11.2026 (pkt 6–7, 48–51, 65–66): https://www.edpb.europa.eu/system/files/2026-11/edpb_guidelines_202401_legitimateinterest_v2_en.pdf
- EROD, raport z akcji CEF 2025 „Implementation of the right to erasure by controllers”, przyjęty 10.02.2026 (Issue 6 — kopie zapasowe): https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf
- EROD, komunikat o raporcie CEF 2025: https://www.edpb.europa.eu/news/edpb-identifies-challenges-hindering-the-full-implementation-of-the-right-to-erasure_en
- Grupa Robocza Art. 29, Wytyczne w sprawie przejrzystości (WP260 rev.01): https://ec.europa.eu/newsroom/article29/items/622227/en
- Grupa Robocza Art. 29, Wytyczne dotyczące DPIA (WP248 rev.01) — przywołane w `docs/security/dpia.md`

**Orzecznictwo**
- TSUE, C-252/21 *Meta Platforms/Bundeskartellamt*, 4.07.2023, ECLI:EU:C:2023:537 (sentencja pkt 4–5; uzasadnienie pkt 90, 98, 106) — omówienie FRA: https://fra.europa.eu/pl/caselaw-reference/cjeu-case-c-25221-judgement
- TSUE, C-394/23 *Mousse/CNIL, SNCF Connect*, 9.01.2025, ECLI:EU:C:2025:2 (pkt 52 — według przypisu 94 wytycznych EROD 1/2024)
- TSUE, C-708/18 *TK/Asociaţia de Proprietari bloc M5A-ScaraA*, 11.12.2019, ECLI:EU:C:2019:1064 (pkt 40)
- TSUE, C-13/16 *Rīgas satiksme*, 4.05.2017, ECLI:EU:C:2017:336 (pkt 28)
- TSUE, C-621/22 *Koninklijke Nederlandse Lawn Tennisbond*, 4.10.2024, ECLI:EU:C:2024:858
- TSUE, C-77/21 *Digi Távközlési és Szolgáltató*, 20.10.2022 (ograniczenie przechowywania, baza testowa)
- NSA, wyrok z 20.02.2024, III OSK 2700/22 (dane kandydatów po rekrutacji) — według omówień, m.in. https://pro.rp.pl/prawo-w-firmie/art39880371-zapadl-precedensowy-i-korzystny-dla-firm-wyrok-ws-rekrutacji-pracownikow — **do weryfikacji w CBOSA**: https://orzeczenia.nsa.gov.pl

**UODO**
- Biuletyn UODO, „Usuwanie danych z kopii zapasowych systemów informatycznych”, 28.11.2025 (nie stanowi oficjalnego stanowiska organu): https://nowybiuletyn.uodo.gov.pl/usuwanie-danych-z-kopii-zapasowych-systemow-informatycznych/
- UODO, „Ochrona danych osobowych w miejscu pracy. Poradnik dla pracodawców” (2018) — przechowywanie danych kandydatów po rekrutacji (analogia; według omówień)

**Materiał z repozytorium (stan 2026-11-25)**
- `apps/web/src/privacy/content.ts` — klauzula „Klienci” 1.1, sekcja „Wizja lokalna” i lista okresów
- `docs/user/karta-wizji-lokalnej.md` — karta A6 i naklejka 1.1
- `docs/security/rodo.md` — „Cele i podstawy”, „Retencja”, „Obowiązek informacyjny”, czynność 9 rejestru, „Wizja lokalna — zasady”, „Klauzula 1.1 i dokumenty wizji”
- `docs/security/dpia.md` — § 1, § 4 (D14), § 7 (aneks v1.1), § 8 (aneks v1.2)
- `docs/architecture/adr/0025-dokumenty-wizji-lokalnej-przed-klientem.md`
- `docs/ops/runbooks/retencja.md` — sekcja 5
- `docs/ops/runbooks/prawa-osob.md` — „Wizja lokalna — art. 15, 17 i 21”
- `docs/user/instrukcja-dla-biura.md` — rozdz. 4
- `apps/api/src/modules/work-orders/domain/site-survey-extension.ts` — lista powodów przedłużenia
