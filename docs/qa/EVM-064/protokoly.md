# EVM-064 — protokoły czynności ręcznych (do wypełnienia przez Konrada)

Historyjka: [EVM-064](../../backlog/M1/EVM-064-rodo-przed-startem.md). Przygotował: `security-engineer`, 2026-11-14. Czynności wykonuje Konrad (RR-93: agenci nie logują się na środowisko, nie czytają jego danych ani kont dostawców). **Wpisuj tylko daty, role, wyniki i liczby — bez danych osobowych, adresów e-mail, numerów umów i identyfikatorów kont** (repozytorium jest publiczne). Puste pole = czynność niewykonana.

Kolejność: AC1 → AC2 → AC5 → AC4 → AC3 → AC7 → AC8 (zatwierdzenie DPIA na końcu). Szacowany czas łącznie: ok. 3–4 h.

## AC1 — Umowy powierzenia, regiony i retencje
Na koncie każdego dostawcy: umowa powierzenia zawarta albo warunki zaakceptowane, region UE, retencja, MFA. Wskazówki — [`rodo.md` → „Weryfikacja dostawców 2026-11-14”](../../security/rodo.md#weryfikacja-dostawców-2026-11-14-evm-064-ac1).

| Dostawca | Co sprawdzić | Umowa (tak / nie, data dokumentu) | Region | Retencja | MFA | Data | Wynik |
|---|---|---|---|---|---|---|---|
| Hetzner | DPA (AVV) zawarta w koncie (accounts → DPA); VM w DE, Storage Box w FI; kopie VM 7 dni | | | | | | |
| Scaleway (z TEM) | DPA zaakceptowana (konsola → kontrakty); projekt w `pl-waw`; TEM — Francja | | | | | | |
| Grafana Labs | DPA (z SCC) zaakceptowana; stos w regionie UE; logi i metryki 14 dni | | | | | | |
| GitHub | warunki z DPA (GitHub Customer Agreement); w repozytorium brak danych klientów | | — | — | | | |
| OVH (rejestrator, DNS) | tylko MFA i blokada transferu — nie jest podmiotem przetwarzającym danych systemu | — | — | — | | | |

**Transfery do USA (pkt 10):** Grafana Labs i GitHub na liście Data Privacy Framework (https://www.dataprivacyframework.gov/list — wyszukaj nazwę, status „Active”): Grafana Labs _do wypełnienia_ · GitHub _do wypełnienia_ · data _do wypełnienia_.

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
| [`dpia.md`](../../security/dpia.md) przeczytana; decyzja (zatwierdzam / z warunkami / nie) | _do wypełnienia_ |
| Punkt `[PRAWNIK/IOD]` 11 — rekomendacja przyjęta (uproszczona DPIA) | _tak / nie_ |
| Punkt `[PRAWNIK/IOD]` 10 — rekomendacja przyjęta (podstawa transferów) | _tak / nie_ |
| Data | _do wypełnienia_ |
