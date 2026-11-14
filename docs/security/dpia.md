# Uproszczona ocena skutków dla ochrony danych (DPIA) — EVia Manager

> Dokument żywy (EVM-064 AC8; art. 35 RODO). Właściciel: `security-engineer`; zatwierdza administrator — Konrad. Wersja **0.2, 2026-11-14 — projekt do zatwierdzenia** (po zatwierdzeniu: wersja **1.0** z datą zatwierdzenia; daty nie antydatujemy). Oparta na [`rodo.md`](rodo.md) (inwentaryzacja, podstawy, retencja, podmioty przetwarzające) i [`threat-model.md`](threat-model.md) (zagrożenia, ryzyka rezydualne RR). **Ocena własna administratora na podstawie wytycznych EROD i UODO (bez prawnika i IOD — decyzja Konrada 2026-11-14); nie jest poradą prawną.** „Uproszczona” znaczy krótka — dokument zawiera elementy wymagane przez art. 35 ust. 7 lit. a–d: opis operacji i celów (§ 2), ocenę niezbędności i proporcjonalności (§ 3), ocenę ryzyka dla praw i wolności (§ 4) oraz środki zaradcze (§ 4–5). Bez danych osobowych.

## 1. Czy DPIA jest wymagana (punkt `[PRAWNIK/IOD]` 11)
**Wytyczne WP 248 rev.01** Grupy Roboczej Art. 29 (zatwierdzone przez EROD) — wstępna ocena z `rodo.md`: dwa z dziewięciu kryteriów spełnione częściowo (dane o charakterze wysoce osobistym; osoby w nierównowadze — pracownicy z prywatnymi telefonami).

**Wykaz Prezesa UODO** — Komunikat z 17 czerwca 2019 r. (M.P. 2019 poz. 666), tekst sprawdzony 2026-11-14: https://eli.gov.pl/api/acts/MP/2019/666/text/O/M20190666.pdf (nowszego komunikatu w wynikach wyszukiwania nie znaleziono). Zasada z wykazu: „Co do zasady, przetwarzanie spełniające przynajmniej dwa z niżej wymienionych kryteriów będzie wymagać oceny skutków dla ochrony danych”. Nazwy kategorii — dosłownie z kolumny I wykazu (długie skrócone znakiem „…”).

| # | Kategoria z wykazu UODO | EVia Manager |
|---|---|---|
| 1 | Ewaluacja lub ocena, w tym profilowanie i przewidywanie (analiza behawioralna) w celach wywołujących negatywne skutki prawne, fizyczne, finansowe lub inne niedogodności dla osób fizycznych | nie |
| 2 | Zautomatyzowane podejmowanie decyzji wywołujących skutki prawne, finansowe lub podobne istotne skutki | nie |
| 3 | Systematyczne monitorowanie na dużą skalę miejsc dostępnych publicznie wykorzystujące elementy rozpoznawania cech lub właściwości obiektów… | nie co do treści kategorii; **obszar graniczny** — wykaz podaje tu przykład „Zakłady pracy (monitoring systemów informatycznych poczty elektronicznej, używanego oprogramowania…)”, a dziennik audytu działań pracowników w systemie może być uznany za taki monitoring (D7, warunki w § 5) |
| 4 | Przetwarzanie szczególnych kategorii danych osobowych i dotyczących wyroków skazujących i czynów zabronionych (danych wrażliwych wg opinii WP 29) | **częściowo** — PESEL, numer i podpis w dokumentach `identity_data`; zdjęcia wnętrz domów i garaży (dane o charakterze wysoce osobistym wg WP 248) |
| 5 | Przetwarzanie danych biometrycznych wyłącznie w celu identyfikacji osoby fizycznej bądź w celu kontroli dostępu | nie — klucz dostępu (Windows Hello, odcisk palca) weryfikuje urządzenie lokalnie; system dostaje tylko klucz publiczny |
| 6 | Przetwarzanie danych genetycznych | nie |
| 7 | Dane przetwarzane na dużą skalę… | nie — jedna firma, setki–tysiące klientów |
| 8 | Przeprowadzanie porównań, ocena lub wnioskowanie na podstawie analizy danych pozyskanych z różnych źródeł | nie |
| 9 | Przetwarzanie danych dotyczących osób, których ocena i świadczone im usługi są uzależnione od podmiotów lub osób, które dysponują uprawnieniami nadzorczymi i/lub ocennymi | **częściowo** — dane pracowników i ich prywatne telefony (BYOD) |
| 10 | Innowacyjne wykorzystanie lub zastosowanie rozwiązań technologicznych lub organizacyjnych | nie — metadanych zdjęć nie analizujemy, podglądy bez EXIF/GPS (P3) |
| 11 | Gdy przetwarzanie samo w sobie uniemożliwia osobom, których dane dotyczą, wykonywanie prawa lub korzystanie z usługi lub umowy | nie |
| 12 | Przetwarzanie danych lokalizacyjnych | nie — panel i aplikacja nie zbierają lokalizacji |

**Wniosek:** dwa kryteria częściowo spełnione (trzecie graniczne) w obu źródłach → DPIA jest co do zasady wymagana. Uczciwego uzasadnienia jej zbędności brak. **Rekomendacja `security-engineer`:** uproszczona DPIA (ten dokument) zamiast decyzji o zbędności — koszt niewielki, bo opiera się na istniejących dokumentach.

## 2. Opis przetwarzania
| Element | Opis (szczegóły w `rodo.md`) |
|---|---|
| Cel | obsługa zleceń instalacji ładowarek EV: oferta, realizacja, procesy z OSD i administracją, dokumentacja zdjęciowa, rozliczenia; konta pracowników i bezpieczeństwo systemu |
| Osoby | klienci, osoby kontaktowe stron, osoby przypadkowo na zdjęciach, pracownicy |
| Dane | identyfikacyjne i kontaktowe, adresy i dane lokalizacji, zdjęcia i filmy posesji, dokumenty (w tym `identity_data`), wpisy, kwoty; dane kont, sesji, urządzeń i audytu |
| Gdzie | jedno środowisko (VM Hetzner, Niemcy; Scaleway `pl-waw`); logi i metryki — Grafana Cloud (UE, 14 dni, po redakcji); e-mail — Scaleway TEM (Francja) |
| Kanały | panel w przeglądarce biura; **pilot B — panel w przeglądarce prywatnych telefonów techników (rola Edytor)** (decyzja 19) ze zdjęciami robionymi aparatem i wybieranymi z galerii (decyzja 18); **aplikacja mobilna (M2) na prywatnych telefonach** z replikacją offline w SQLCipher |
| Skala | jedna firma, kilka kont, setki–tysiące klientów |

## 3. Konieczność i proporcjonalność
- **Podstawy:** umowa (art. 6 ust. 1 lit. b), obowiązek prawny (lit. c), prawnie uzasadniony interes (lit. f) — tabela w `rodo.md`. Art. 9 i 10 — nie celowo.
- **Minimalizacja:** brak pól PESEL i numerów dokumentów, brak GPS, telefon bez płatności, PPE, e-maili, NIP i plików dokumentów; dokumenty `identity_data` tylko dla Administratora i Edytora.
- **Retencja:** P4 — dane techniczne usuwane automatycznie, dane biznesowe ręcznie do M4 ([`retencja.md`](../ops/runbooks/retencja.md)).
- **Prawa osób:** [`prawa-osob.md`](../ops/runbooks/prawa-osob.md); klauzule w panelu (W-19).
- **Podmioty przetwarzające i transfery:** dane klientów tylko w UE; z USA — Grafana Labs (telemetria po redakcji) i GitHub (bez danych osobowych firmy) — rozdział „Decyzje administratora” w `rodo.md`.

## 4. Ryzyka dla praw i wolności osób
Skala jak w modelu zagrożeń: prawdopodobieństwo (P) × wpływ (W), 1–3; ≥ 6 = wysokie. P1 = „wymaga kilku warunków naraz lub ukierunkowanego ataku z dużym nakładem”; W3 obejmuje dokumenty `identity_data`.

| ID | Scenariusz | Skutek dla osób | Środki (odsyłacze) | Ryzyko rezydualne |
|---|---|---|---|---|
| D1 | Nieuprawniony dostęp do dokumentów `identity_data` (PESEL, dowód, podpis) | kradzież tożsamości, szkoda majątkowa | P6 (tylko A i E, audyt pobrań i odmów), MFA dla wszystkich, autoryzacja obiektowa, podpisane URL-e (AB-06, AB-07, AB-20, RR-81) | P1 × W3 = 3 Medium |
| D2 | Wyciek zdjęć wnętrz i garaży (informacja o zabezpieczeniach domu) | naruszenie prywatności domu, ryzyko włamania | prywatny bucket, SSE, krótkie URL-e, limity i alerty masowych pobrań P10 (AB-07, AB-08, AB-10) | P1 × W2 = 2 Low |
| D3 | Pilot B: kradzież albo zgubienie prywatnego telefonu technika z otwartą sesją panelu | dostęp w zakresie roli Edytor (RR-13): wszystkie zlecenia i klienci **oraz pobieranie dokumentów `identity_data`** (PESEL — jak D1) | technicznie: wygaśnięcie sesji po 60 min bezczynności (maks. 12 h), „Wyloguj ze wszystkich sesji” przez Administratora po zgłoszeniu ([runbook naruszeń](../ops/runbooks/naruszenie-danych.md)), audyt pobrań; organizacyjnie: instrukcja EVM-066 AC2 (blokada ekranu, „Wyloguj” po wysłaniu, bez cudzych telefonów) potwierdzona pisemnym oświadczeniem technika (§ 5), zgłoszenie utraty od razu | bez środków P2 × W3 = 6 High; **po środkach: P1 × W3 = 3 Medium** — dostęp wymaga trzech warunków naraz: (a) telefon w chwili utraty jest odblokowany (blokada ekranu w oświadczeniu), (b) sesja jest aktywna — technik nie wylogował się po wysyłce, a od ostatniej czynności minęło < 60 min (wymuszane przez serwer), (c) znalazca celowo szuka i pobiera dokumenty w panelu, zanim Administrator zakończy sesje po zgłoszeniu. Słaby punkt: pobranie `identity_data` przez Edytora nie wymaga step-upu (P2), a (a) i „Wyloguj” to zasady bez kontroli technicznej. Jeżeli oświadczeń nie ma albo incydent pokaże, że zasady nie działają — ocena wraca do 6 High i potrzebny jest środek techniczny (kandydat w historyjce EVM-064 → „Uwagi do rozważenia”) |
| D4 | Pilot B (decyzja 18): kopie zdjęć w galerii i **automatyczna kopia w prywatnej chmurze** (Zdjęcia Google, OneDrive, chmura producenta) | zdjęcia posesji poza umowami powierzenia, możliwie poza UE, także po odejściu pracownika | zasada z EVM-066 AC2 (wyłączona kopia w chmurze albo wykluczony folder aparatu przed pierwszym zdjęciem, usuwanie z galerii i kosza po „Wysłano”, potwierdzenie usunięcia przy odejściu) — **z dowodem**: pisemne oświadczenie każdego technika przed pierwszym zdjęciem i przy odejściu; pilot ograniczony w czasie i liczbie osób; wykryta kopia = incydent (§ 5); bez MDM nie do sprawdzenia technicznie (RR-08) | P2 × W2 = 4 Medium pod warunkami z § 5 (bez nich 6 High — ocena z decyzji 18) |
| D5 | Pobrane oryginały i dokumenty na telefonie lub komputerze biura („Pobrane”, kopia w chmurze) | jak D1–D2 | instrukcja (bez pobierania na telefon), środki organizacyjne komputerów biura w `rodo.md` (szyfrowanie dysku, czyszczenie „Pobranych”) — sprawdzane na spotkaniu AC3 | P1 × W2 = 2 Low |
| D6 | Aplikacja M2: kradzież prywatnego telefonu z danymi offline | dostęp do repliki zleceń i niewysłanych wpisów | SQLCipher z kluczem w Keystore, blokada aplikacji, tryb ukrytych danych, limit 7 dni offline, zdalne „Zablokuj i wyczyść” (AB-04, AB-14, RR-07, RR-08) | P2 × W2 = 4 Medium (RR-07, RR-08 zaakceptowane) |
| D7 | Prywatność pracowników: dziennik audytu działań (może być uznany za inną formę monitoringu — art. 22³ § 4 Kodeksu pracy), aplikacja i panel na prywatnym telefonie | nierównowaga, ingerencja w prywatne urządzenie | brak lokalizacji, dostępu do galerii i kontaktów w aplikacji; telemetria bez danych osobowych; audyt tylko do bezpieczeństwa i rozliczalności, nie do oceny pracy; upoważnienia, informacja o audycie i zgoda na prywatny telefon (§ 5); klauzula BYOD (W-19); telefony firmowe, gdy to możliwe | P1 × W2 = 2 Low pod warunkami z § 5 |
| D8 | Przejęcie konta (phishing, przejęte urządzenie biura) | dostęp do danych w zakresie roli | MFA, klucz dostępu Administratora, limity prób, alerty (AB-01, AB-02, RR-17) | P2 × W2 = 4 Medium (RR-17 zaakceptowane) |
| D9 | Utrata danych bez kopii zapasowych (do posiedzenia B EVM-084) | utrata dokumentacji i historii zleceń | równoległe dotychczasowe narzędzia biura; oryginały dokumentów klientów także poza systemem (§ 5); twardy termin 2026-12-13 (RR-91) | P1 × W3 = 3 Medium (zaakceptowane 2026-11-13) |
| D10 | Błąd bezpieczeństwa bez zewnętrznego pentestu | jak D1–D2 | EVM-070, testy macierzy ról, ZAP baseline (RR-92) | P1 × W3 = 3 Medium (zaakceptowane 2026-11-13) |
| D11 | Dostęp organów USA do telemetrii, błąd redakcji albo utrata podstawy transferu (spory o DPF — `rodo.md`, pkt 10) | ujawnienie fragmentu danych | region UE, redakcja, przegląd próbek logów ([checklista wydania](checklista-wydania.md)); podstawa: decyzja 2023/1795, o ile wpis DPF jest aktywny i obejmuje dany rodzaj danych, równolegle SCC z DPA; przegląd co ≤ 6 miesięcy (RR-01, RR-15) | P1 × W2 = 2 Low |
| D12 | Niepełna realizacja prawa do usunięcia (kopie, zakres anonimizacji) | dane osoby zostają dłużej | rejestr usunięć, kopie ≤ 37 dni (RR-14), procedura ręczna dla zakresu RR-60 | P1 × W2 = 2 Low |
| D13 | Dane realne obok syntetycznych na jednym środowisku | pomyłka rekordów, wysyłka do złej osoby | reguły 1–6 RR-93 | P1 × W2 = 2 Low |

## 5. Wniosek
- **Ryzyko rezydualne:** po środkach i pod warunkami niżej brak ryzyk wysokich. Bez warunków D3 i D4 są wysokie (6) — dlatego warunki są częścią zatwierdzenia, a ich niespełnienie wstrzymuje pilota B. Ryzyka Medium mają decyzję Konrada (RR-07, RR-08, RR-13, RR-17, RR-91, RR-92) albo dotyczą pilota B (D3, D4) — ich akceptacja jest częścią zatwierdzenia tej DPIA (decyzje 18 i 19; RR pilota B w modelu zagrożeń — EVM-070).
- **Uprzednie konsultacje z Prezesem UODO (art. 36):** niewymagane, o ile warunki są spełnione (ryzyko rezydualne nie jest wysokie). Jeżeli warunku D3 albo D4 nie da się spełnić — albo zmiana przetwarzania (np. bez pilota B do aplikacji M2), albo konsultacja z art. 36.
- **Warunki** (dowody poza repozytorium; status w [protokole AC8](../qa/EVM-064/protokoly.md#ac8--zatwierdzenie-dpia); wzory: [`wzory-dla-pracownikow.md`](wzory-dla-pracownikow.md)):
  1. **Upoważnienie i poufność (art. 29, art. 32 ust. 4):** każda osoba z kontem w systemie ma pisemne upoważnienie do przetwarzania danych i zobowiązanie do poufności — przed pierwszym dostępem do realnych danych (wzór 1).
  2. **Audyt działań (D7):** wszystkie osoby z kontem dostają pisemną informację o celu, zakresie i sposobie audytu (wzór 3). Gdy osoba jest zatrudniona na umowie o pracę — obwieszczenie (albo regulamin pracy) i informacja co najmniej 2 tygodnie przed objęciem jej audytem (art. 22² i 22³ Kodeksu pracy); forma zatrudnienia nie jest znana w repozytorium — Konrad zaznacza w protokole, czy dotyczy.
  3. **Pilot B — oświadczenie technika (D3, D4):** pisemna zgoda na użycie prywatnego telefonu i oświadczenie (blokada ekranu, wylogowanie po wysyłce, wyłączona kopia w chmurze albo wykluczony folder aparatu, zgłoszenie utraty od razu, usunięcie zdjęć przy odejściu) — przed pierwszym zdjęciem; drugie potwierdzenie przy odejściu (wzór 2).
  4. **Pilot B — ograniczenia:** tylko do udostępnienia aplikacji M2 technikom i tylko dla liczby techników wpisanej przy zatwierdzeniu (§ 6); poszerzenie = ponowna ocena.
  5. **Kopia zdjęcia klienta w prywatnej chmurze** wykryta u technika = naruszenie wg [runbooka naruszeń](../ops/runbooks/naruszenie-danych.md): karta w rejestrze naruszeń (art. 33 ust. 5), ocena ryzyka, usunięcie kopii z potwierdzeniem.
  6. **D9:** do uruchomienia kopii zapasowych (posiedzenie B EVM-084, najpóźniej 2026-12-13) oryginały dokumentów klientów pozostają także poza systemem (dotychczasowe miejsce biura).
  7. **Logi:** przegląd próbek logów przed startem (checklista wydania).
- **Opinia osób, których dane dotyczą (art. 35 ust. 9):** opinię techników (pilot B, BYOD, audyt) Konrad zbiera na krótkim spotkaniu — data w § 6. Opinii klientów nie zasięgamy: przetwarzanie to standardowa obsługa zlecenia klienta w małej firmie, a ankieta klientów byłaby nieproporcjonalna do skali; ich głos uwzględniamy przez żądania i skargi (ponowna ocena niżej).
- **Ponowna ocena:** przed udostępnieniem aplikacji mobilnej technikom (wydanie 1.1), przy nowym dostawcy, kanale lub roli (np. Monter, portal klienta), po incydencie, przy pierwszej skardze klienta, najpóźniej co 12 miesięcy.

## 6. Zatwierdzenie
Wypełnia Konrad (także w [protokole AC8](../qa/EVM-064/protokoly.md#ac8--zatwierdzenie-dpia)). Przy zatwierdzeniu wersja dokumentu zmienia się na **1.0**.

| Pole | Wartość |
|---|---|
| Data zatwierdzenia (dzień faktycznego zatwierdzenia) | _do wypełnienia_ |
| Czy przed zatwierdzeniem wprowadzono realne dane klientów (tak / nie; od kiedy) | _do wypełnienia_ |
| Opinia techników (art. 35 ust. 9) — data spotkania, krótko wnioski (bez danych osób) | _do wypełnienia_ |
| Liczba techników w pilocie B | _do wypełnienia_ |
| Decyzja (zatwierdzam / zatwierdzam z warunkami § 5 / nie zatwierdzam) | _do wypełnienia_ |
| Akceptacja ryzyk D3 i D4 (pilot B) pod warunkami § 5 | _do wypełnienia_ |
| Uwagi | _do wypełnienia_ |
