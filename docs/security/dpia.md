# Uproszczona ocena skutków dla ochrony danych (DPIA) — EVia Manager

> Dokument żywy (EVM-064 AC8; art. 35 RODO). Właściciel: `security-engineer`; zatwierdza administrator — Konrad. Wersja **0.1, 2026-11-14 — projekt do zatwierdzenia na demo EVM-064**. Oparta na [`rodo.md`](rodo.md) (inwentaryzacja, podstawy, retencja, podmioty przetwarzające) i [`threat-model.md`](threat-model.md) (zagrożenia, ryzyka rezydualne RR). **Nie jest poradą prawną:** firma nie ma prawnika ani IOD (decyzja Konrada 2026-11-14) — ocena i wniosek to świadoma decyzja administratora na podstawie publicznych wytycznych. Bez danych osobowych.

## 1. Czy DPIA jest wymagana (punkt `[PRAWNIK/IOD]` 11)
**Wytyczne WP248 rev.01** (EROD) — wstępna ocena z `rodo.md`: dwa z dziewięciu kryteriów spełnione częściowo (dane o charakterze wysoce osobistym; osoby w nierównowadze — pracownicy z prywatnymi telefonami).

**Wykaz Prezesa UODO** — Komunikat z 17 czerwca 2019 r. (M.P. 2019 poz. 666), sprawdzony 2026-11-14: https://eli.gov.pl/api/acts/MP/2019/666/text/O/M20190666.pdf (nowszego komunikatu w wynikach wyszukiwania nie znaleziono). Zasada z wykazu: „co do zasady, przetwarzanie spełniające przynajmniej dwa z niej wymienionych kryteriów będzie wymagać oceny skutków”.

| # | Kategoria z wykazu UODO | EVia Manager |
|---|---|---|
| 1 | Ewaluacja lub ocena, w tym profilowanie | nie |
| 2 | Zautomatyzowane decyzje o skutkach prawnych | nie |
| 3 | Systematyczne monitorowanie (w tym w zakładzie pracy) | nie — audyt bezpieczeństwa i rejestr urządzeń nie służą ocenie pracy; brak lokalizacji, czasu pracy i monitorowania poczty (obszar graniczny — dlatego pracowników obejmuje ta ocena) |
| 4 | Dane szczególnych kategorii i dane o charakterze wysoce osobistym | **częściowo** — PESEL, numer i podpis w dokumentach `identity_data`; zdjęcia wnętrz domów i garaży |
| 5 | Dane biometryczne do identyfikacji | nie — klucz dostępu (Windows Hello, odcisk palca) weryfikuje urządzenie lokalnie; system dostaje tylko klucz publiczny |
| 6 | Dane genetyczne | nie |
| 7 | Duża skala | nie — jedna firma, setki–tysiące klientów |
| 8 | Łączenie zbiorów z różnych źródeł | nie |
| 9 | Osoby zależne od podmiotu z uprawnieniami nadzorczymi (pracownicy) | **częściowo** — dane pracowników i ich prywatne telefony (BYOD) |
| 10 | Innowacyjne technologie (np. analiza metadanych zdjęć z GPS) | nie — metadanych nie analizujemy, podglądy bez EXIF/GPS (P3) |
| 11 | Przetwarzanie uniemożliwiające korzystanie z prawa lub usługi | nie |
| 12 | Dane lokalizacyjne | nie — panel i aplikacja nie zbierają lokalizacji |

**Wniosek:** dwa kryteria częściowo spełnione w obu źródłach → DPIA jest co do zasady wymagana. Uczciwego uzasadnienia jej zbędności brak. **Rekomendacja `security-engineer`:** uproszczona DPIA (ten dokument) zamiast decyzji o zbędności — koszt niewielki, bo opiera się na istniejących dokumentach.

## 2. Opis przetwarzania
| Element | Opis (szczegóły w `rodo.md`) |
|---|---|
| Cel | obsługa zleceń instalacji ładowarek EV: oferta, realizacja, procesy z OSD i administracją, dokumentacja zdjęciowa, rozliczenia; konta pracowników i bezpieczeństwo systemu |
| Osoby | klienci, osoby kontaktowe stron, osoby przypadkowo na zdjęciach, pracownicy |
| Dane | identyfikacyjne i kontaktowe, adresy i dane lokalizacji, zdjęcia i filmy posesji, dokumenty (w tym `identity_data`), wpisy, kwoty; dane kont, sesji, urządzeń i audytu |
| Gdzie | jedno środowisko (VM Hetzner, Niemcy; Scaleway `pl-waw`); logi i metryki — Grafana Cloud (UE, 14 dni, po redakcji); e-mail — Scaleway TEM (Francja) |
| Kanały | panel w przeglądarce biura; **pilot B — panel w przeglądarce prywatnych telefonów techników** (decyzja 19) ze zdjęciami robionymi aparatem i wybieranymi z galerii (decyzja 18); **aplikacja mobilna (M2) na prywatnych telefonach** z replikacją offline w SQLCipher |
| Skala | jedna firma, kilka kont, setki–tysiące klientów |

## 3. Konieczność i proporcjonalność
- **Podstawy:** umowa (art. 6 ust. 1 lit. b), obowiązek prawny (lit. c), prawnie uzasadniony interes (lit. f) — tabela w `rodo.md`. Art. 9 i 10 — nie celowo.
- **Minimalizacja:** brak pól PESEL i numerów dokumentów, brak GPS, telefon bez płatności, PPE, e-maili, NIP i plików dokumentów; dokumenty `identity_data` tylko dla Administratora i Edytora.
- **Retencja:** P4 — dane techniczne usuwane automatycznie, dane biznesowe ręcznie do M4 ([`retencja.md`](../ops/runbooks/retencja.md)).
- **Prawa osób:** [`prawa-osob.md`](../ops/runbooks/prawa-osob.md); klauzule w panelu (W-19).
- **Podmioty przetwarzające i transfery:** dane klientów tylko w UE; z USA — Grafana Labs (telemetria po redakcji) i GitHub (bez danych klientów) — rozdział „Decyzje administratora” w `rodo.md`.

## 4. Ryzyka dla praw i wolności osób
Skala jak w modelu zagrożeń: prawdopodobieństwo (P) × wpływ (W), 1–3; ≥ 6 = wysokie.

| ID | Scenariusz | Skutek dla osób | Środki (odsyłacze) | Ryzyko rezydualne |
|---|---|---|---|---|
| D1 | Nieuprawniony dostęp do dokumentów `identity_data` (PESEL, dowód, podpis) | kradzież tożsamości, szkoda majątkowa | P6 (tylko A i E, audyt pobrań i odmów), MFA dla wszystkich, autoryzacja obiektowa, podpisane URL-e (AB-06, AB-07, AB-20, RR-81) | P1 × W3 = 3 Medium |
| D2 | Wyciek zdjęć wnętrz i garaży (informacja o zabezpieczeniach domu) | naruszenie prywatności domu, ryzyko włamania | prywatny bucket, SSE, krótkie URL-e, limity i alerty masowych pobrań P10 (AB-07, AB-08, AB-10) | P1 × W2 = 2 Low |
| D3 | Pilot B: kradzież odblokowanego prywatnego telefonu z otwartą sesją panelu | dostęp Edytora do wszystkich zleceń i klientów (RR-13) do 60 min bezczynności (maks. 12 h) | instrukcja EVM-066 AC2 (blokada ekranu, „Wyloguj” po wysłaniu, bez cudzych telefonów), zgłoszenie utraty od razu i „Wyloguj ze wszystkich sesji” ([runbook naruszeń](../ops/runbooks/naruszenie-danych.md)) | P2 × W2 = 4 Medium |
| D4 | Pilot B (decyzja 18): kopie zdjęć w galerii i **automatyczna kopia w prywatnej chmurze** (Zdjęcia Google, OneDrive, chmura producenta) | zdjęcia posesji poza umowami powierzenia, możliwie poza UE, także po odejściu pracownika | zasada z EVM-066 AC2: wyłączona kopia w chmurze albo wykluczony folder aparatu przed pierwszym zdjęciem, usuwanie z galerii i kosza po „Wysłano”, potwierdzenie usunięcia przy odejściu; bez MDM nie do sprawdzenia technicznie (RR-08) | P2 × W2 = 4 Medium (bez zasady 6 High — ocena z decyzji 18) |
| D5 | Pobrane oryginały i dokumenty na telefonie lub komputerze biura („Pobrane”, kopia w chmurze) | jak D1–D2 | instrukcja (bez pobierania na telefon), środki organizacyjne komputerów biura w `rodo.md` (szyfrowanie dysku, czyszczenie „Pobranych”) — sprawdzane na spotkaniu AC3 | P1 × W2 = 2 Low |
| D6 | Aplikacja M2: kradzież prywatnego telefonu z danymi offline | dostęp do repliki zleceń i niewysłanych wpisów | SQLCipher z kluczem w Keystore, blokada aplikacji, tryb ukrytych danych, limit 7 dni offline, zdalne „Zablokuj i wyczyść” (AB-04, AB-14, RR-07, RR-08) | P2 × W2 = 4 Medium (RR-07, RR-08 zaakceptowane) |
| D7 | Prywatność pracowników: poczucie monitorowania, aplikacja na prywatnym telefonie | nierównowaga, ingerencja w prywatne urządzenie | brak lokalizacji, dostępu do galerii i kontaktów w aplikacji; telemetria bez danych osobowych; audyt tylko do bezpieczeństwa; klauzula BYOD (W-19); telefony firmowe, gdy to możliwe | P1 × W2 = 2 Low |
| D8 | Przejęcie konta (phishing, przejęte urządzenie biura) | dostęp do danych w zakresie roli | MFA, klucz dostępu Administratora, limity prób, alerty (AB-01, AB-02, RR-17) | P2 × W2 = 4 Medium (RR-17 zaakceptowane) |
| D9 | Utrata danych bez kopii zapasowych (do posiedzenia B EVM-084) | utrata dokumentacji i historii zleceń | równoległe dotychczasowe narzędzia biura, twardy termin 2026-12-13 (RR-91) | P1 × W3 = 3 Medium (zaakceptowane 2026-11-13) |
| D10 | Błąd bezpieczeństwa bez zewnętrznego pentestu | jak D1–D2 | EVM-070, testy macierzy ról, ZAP baseline (RR-92) | P1 × W3 = 3 Medium (zaakceptowane 2026-11-13) |
| D11 | Dostęp organów USA do telemetrii albo błąd redakcji | ujawnienie fragmentu danych | region UE, redakcja, przegląd próbek logów ([checklista wydania](checklista-wydania.md)), DPF (RR-01, RR-15) | P1 × W2 = 2 Low |
| D12 | Niepełna realizacja prawa do usunięcia (kopie, zakres anonimizacji) | dane osoby zostają dłużej | rejestr usunięć, kopie ≤ 37 dni (RR-14), procedura ręczna dla zakresu RR-60 | P1 × W2 = 2 Low |
| D13 | Dane realne obok syntetycznych na jednym środowisku | pomyłka rekordów, wysyłka do złej osoby | reguły 1–6 RR-93 | P1 × W2 = 2 Low |

## 5. Wniosek
- **Ryzyko rezydualne:** brak ryzyk wysokich; ryzyka Medium mają decyzję Konrada (RR-07, RR-08, RR-13, RR-17, RR-91, RR-92) albo dotyczą pilota B (D3, D4) — ich akceptacja jest częścią zatwierdzenia tej DPIA (decyzje 18 i 19; RR pilota B w modelu zagrożeń — EVM-070).
- **Uprzednie konsultacje z Prezesem UODO (art. 36):** nie są wymagane, bo ryzyko rezydualne nie jest wysokie.
- **Warunki:** D4 — zasada o kopii w chmurze przyjęta przez każdego technika przed pierwszym zdjęciem; D9 — termin 2026-12-13; przegląd próbek logów przed startem (checklista wydania).
- **Ponowna ocena:** przed udostępnieniem aplikacji mobilnej technikom (wydanie 1.1), przy nowym dostawcy, kanale lub roli (np. Monter, portal klienta), po incydencie, najpóźniej co 12 miesięcy.

## 6. Zatwierdzenie
Wypełnia Konrad na demo EVM-064 (także w [protokole AC8](../qa/EVM-064/protokoly.md#ac8--zatwierdzenie-dpia)).

| Pole | Wartość |
|---|---|
| Data zatwierdzenia | _do wypełnienia_ |
| Decyzja (zatwierdzam / zatwierdzam z warunkami / nie zatwierdzam) | _do wypełnienia_ |
| Akceptacja ryzyk D3 i D4 (pilot B) | _do wypełnienia_ |
| Uwagi | _do wypełnienia_ |
