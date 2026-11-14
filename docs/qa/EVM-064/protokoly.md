# EVM-064 — protokoły czynności ręcznych (do wypełnienia przez Konrada)

Historyjka: [EVM-064](../../backlog/M1/EVM-064-rodo-przed-startem.md). Przygotował: `security-engineer`, 2026-11-14. Czynności wykonuje Konrad (RR-93: agenci nie logują się na środowisko, nie czytają jego danych ani kont dostawców). **Wpisuj tylko daty, role, wyniki i liczby — bez danych osobowych, adresów e-mail, numerów umów i identyfikatorów kont** (repozytorium jest publiczne). Puste pole = czynność niewykonana.

Kolejność: AC1 → AC2 → AC5 → AC4 → AC3 → AC7 → AC8 (zatwierdzenie DPIA na końcu; wcześniej podpisane wzory z [`wzory-dla-pracownikow.md`](../../security/wzory-dla-pracownikow.md) i krótkie spotkanie z technikami). Szacowany czas łącznie: ok. 4–5 h.

## AC1 — Umowy powierzenia, regiony i retencje
Na koncie każdego dostawcy: umowa powierzenia zawarta albo warunki zaakceptowane, region UE, retencja, MFA. Wskazówki — [`rodo.md` → „Weryfikacja dostawców 2026-11-14”](../../security/rodo.md#weryfikacja-dostawców-2026-11-14-evm-064-ac1).

| Dostawca | Co sprawdzić | Umowa (tak / nie, data dokumentu) | Kopia DPA i lista podprocesorów zapisane poza repozytorium (data) | Region | Retencja | MFA | Data | Wynik |
|---|---|---|---|---|---|---|---|---|
| Hetzner | DPA (AVV) zawarta w koncie (accounts → DPA); VM w DE, Storage Box w FI; kopie VM 7 dni | | | | | | | |
| Scaleway (z TEM) | DPA zaakceptowana (konsola → kontrakty); projekt w `pl-waw`; TEM — Francja | | | | | | | |
| Grafana Labs | DPA (z SCC) zaakceptowana; stos w regionie UE; logi i metryki 14 dni | | | | | | | |
| GitHub | plan Free: umowa powierzenia **nie dotyczy** (GitHub — odrębny administrator danych kont; w repozytorium, zgłoszeniach i logach CI brak danych osobowych firmy); adres noreply w commitach | nie dotyczy (plan Free) | — | — | — | | | |
| OVH (rejestrator, DNS) | tylko MFA i blokada transferu — nie jest podmiotem przetwarzającym danych systemu | — | — | — | — | | | |

**Transfery do USA (pkt 10):** lista Data Privacy Framework (https://www.dataprivacyframework.gov/list) — **sprawdzone 2026-11-14, Tech Lead (przeglądarka):** „Grafana Labs” (New York, NY) — **Active**; „GitHub” (San Francisco, CA) — **Active**; oba w EU-U.S. DPF (oraz Swiss-U.S. i UK Extension), zakres „Non-HR Data”. Konrad nie musi tego powtarzać; następne sprawdzenie — przy przeglądzie z [`rodo.md`, pkt 10](../../security/rodo.md#decyzje-administratora-bez-prawnika-i-iod-evm-064) (co ≤ 6 miesięcy).

## AC2 — Rejestr czynności poza repozytorium
| Pozycja | Wynik |
|---|---|
| Rejestr czynności (art. 30) założony poza repozytorium, z danymi administratora (decyzja 9) i czynnościami 1–8 z `rodo.md` + czynności spoza systemu | _tak / nie_ |
| Rejestr żądań osób i rejestr naruszeń założone (to samo miejsce) | _tak / nie_ |
| Miejsce opisane w `rodo.md` → „Rejestry poza repozytorium” (opis bez danych, np. „dysk firmy, folder z dostępem tylko dla Konrada”) | _tak / nie_ |
| Data, kto | _do wypełnienia_ |

## AC3 — Spotkanie z checklistą naruszenia
Checklista i scenariusz: [`naruszenie-danych.md` → sekcja 5](../../ops/runbooks/naruszenie-danych.md#5-spotkanie-z-checklistą-ac3).

| Pole | Wynik |
|---|---|
| Data, czas trwania | _do wypełnienia_ |
| Uczestnicy (role) | _do wypełnienia_ |
| Wszystkie pozycje checklisty przejrzane | _tak / nie (które nie)_ |
| Dokument „poza systemem” z kontaktami dostawców i formularzem UODO istnieje i jest wydrukowany | _tak / nie_ |
| Wnioski (krótko, bez danych) — przenieść do historyjki EVM-064 | _do wypełnienia_ |

## AC4 — Prawa osób (ćwiczenie)
Na danych syntetycznych wg [`prawa-osob.md` → sekcja 5](../../ops/runbooks/prawa-osob.md#5-ćwiczenie-ac4--przed-pierwszymi-realnymi-danymi-klientów).

| Krok | Wynik (OK / problem) | Uwagi |
|---|---|---|
| Karta żądania w rejestrze żądań | | |
| Art. 15 — zestawienie i eksport ZIP | | |
| Art. 16 — sprostowanie | | |
| Art. 18 — usunięcie i przywrócenie klienta | | |
| Art. 17 — redakcja wpisu | | |
| Art. 17 — trwałe usunięcie pliku zdjęcia i dokumentu | | |
| Art. 17 — edycja lokalizacji i strony na wartości neutralne | | |
| Art. 17 — anonimizacja klienta | | |
| Data, kto, czas całości | | |

## AC5 — Awaryjny reset MFA Administratora (ćwiczenie)
Wg [`aktywacja-i-tryb-awaryjny.md` → „Awaryjny reset MFA Administratora”](../../ops/runbooks/aktywacja-i-tryb-awaryjny.md#awaryjny-reset-mfa-administratora--procedura-sr-auth-13-p1-pkt-5-evm-064-ac5).

| Krok | Wynik (OK / problem) | Uwagi |
|---|---|---|
| 1. Tożsamość potwierdzona poza systemem (sposób) | | |
| 2. Brak oczekujących zaproszeń albo ponownie wysłane | | |
| 3. Polecenie z `--emergency --reason other` | | |
| 4. Stara sesja → ekran logowania (`401 session_revoked`) | | |
| 5. Aktywacja: hasło, klucz, drugi klucz, nowe kody odzyskiwania | | |
| 6. Przegląd kont, urządzeń i dziennika audytu (7 dni) | | |
| 7. E-mail alertu `emergency_reset` dotarł (do kogo — role) | | |
| Data, kto, konto (rola: drugi Administrator / konto awaryjne / własne) | | |

## AC6 — Decyzje o retencji
Pytania z [`retencja.md` → sekcja 4](../../ops/runbooks/retencja.md#4-pytania-do-decyzji-konrada-evm-064-demo): 1 (SR-PRIV-01) _decyzja i data_ · 2 (luki `sync.change_log`, `media.media_exports`) _decyzja i data_.

## AC7 — Przegląd próbek logów
Wg [`checklista-wydania.md` → sekcja 1](../../security/checklista-wydania.md#1-przegląd-próbek-logów-sr-priv-09--konrad); wykonać przed wpisaniem pierwszych realnych danych klientów.

| Zapytanie | Liczba trafień | Usługa (gdy > 0) | Wynik |
|---|---|---|---|
| L1 e-mail | | | |
| L2 telefon | | | |
| L3 PESEL | | | |
| L4 tokeny | | | |
| L5 IPv4 | | | |
| L6 pola z danymi | | | |
| L7 przegląd ręczny | | | |
| Data, zakres czasu, kto | | | |

## AC8 — Zatwierdzenie DPIA
| Pole | Wynik |
|---|---|
| [`dpia.md`](../../security/dpia.md) przeczytana; decyzja (zatwierdzam / z warunkami / nie); wersja zmieniona na 1.0 | _do wypełnienia_ |
| Punkt `[PRAWNIK/IOD]` 11 — rekomendacja przyjęta (uproszczona DPIA) | _tak / nie_ |
| Punkt `[PRAWNIK/IOD]` 10 — rekomendacja przyjęta (podstawa transferów) | _tak / nie_ |
| Czy przed zatwierdzeniem wprowadzono realne dane klientów (tak / nie; od kiedy) | _do wypełnienia_ |
| Opinia techników (art. 35 ust. 9) — data spotkania | _do wypełnienia_ |
| Warunek 1 — upoważnienia i zobowiązania do poufności ([wzór 1](../../security/wzory-dla-pracownikow.md#wzór-1--upoważnienie-do-przetwarzania-danych-osobowych-i-zobowiązanie-do-poufności)): liczba osób z kontem / liczba podpisanych, data | _do wypełnienia_ |
| Warunek 2 — informacja o audycie ([wzór 3](../../security/wzory-dla-pracownikow.md#wzór-3--informacja-dla-osób-z-kontem-o-audycie-działań-w-systemie)): liczba osób / podpisanych, data; umowy o pracę — dotyczy / nie dotyczy; data obwieszczenia i dzień objęcia audytem (≥ 2 tygodnie później) | _do wypełnienia_ |
| Warunek 3 — oświadczenia techników ([wzór 2](../../security/wzory-dla-pracownikow.md#wzór-2--oświadczenie-technika-prywatny-telefon-w-pracy-pilot-b)) przed pierwszym zdjęciem: liczba techników w pilocie B / liczba oświadczeń, data | _do wypełnienia_ |
| Warunek 6 — oryginały dokumentów klientów także poza systemem do uruchomienia kopii (tak / nie) | _do wypełnienia_ |
| Kopia DPA Grafany (z SCC) zapisana poza repozytorium (data) | _do wypełnienia_ |
| Data | _do wypełnienia_ |
