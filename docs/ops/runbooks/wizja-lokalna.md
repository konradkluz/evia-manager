# Instrukcja administratora: wizja lokalna — od wizji testowych do realnych

> Dokument żywy (EVM-141 AC6). Właściciel: `security-engineer`; wykonuje Administrator (Konrad). Zasady przetwarzania: [`rodo.md` → „Wizja lokalna”](../../security/rodo.md#wizja-lokalna--zasady-przetwarzania-evm-141); model: [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md); instrukcja dla pracowników: [instrukcja dla biura](../../user/instrukcja-dla-biura.md), rozdział 4. Stan na 2026-11-16: funkcja w budowie (EVM-135…EVM-140), **realnych wizji nie ma**. Procedura operacyjna, nie porada prawna (RR-95).

## 1. Teraz: tylko wizje testowe
Decyzja Konrada 16 (2026-11-16): po scaleniu EVM-135 przełącznik `SITE_SURVEYS_ENABLED` jest **włączony**, ale do spełnienia listy z sekcji 2 zakładamy **wyłącznie wizje testowe** — adres własny uczestnika albo biura (za zgodą osoby, której dotyczy), zdjęcia i filmy bez osób, tablic rejestracyjnych, tabliczek z nazwiskami i dokumentów, telefon zamawiającego pusty albo syntetyczny. To zasada organizacyjna — system nie odróżnia wizji testowej od realnej.
- Każdej osobie, która dostaje dostęp do zakładania wizji (Edytor, Administrator — panel i aplikacja), przekaż zasadę i rozdział 4 instrukcji dla biura.
- W teście terenowym EVM-112 — wyłącznie wizje testowe (decyzja Konrada: realne wizje w teście — nie).
- **Pomyłka** (realny adres klienta, osoba w kadrze): usuń wizję ręcznie wg [`retencja.md` → „Procedura ręczna”](retencja.md#procedura-ręczna-do-włączenia-enforce-zobowiązanie-konrada) tego samego dnia, zapisz kartę przeglądu, oceń zdarzenie w rejestrze naruszeń ([`naruszenie-danych.md`](naruszenie-danych.md)) — z pisemnym uzasadnieniem, jeśli bez zgłoszenia.

## 2. Lista kontrolna przed pierwszą realną wizją (AC6)
Wszystkie punkty muszą być spełnione **przed** pierwszą wizją u prawdziwego klienta. Dowody trzymaj poza repozytorium (jak protokoły EVM-064); w kolumnie „Stan” wpisz datę spełnienia.

| # | Warunek | Dowód | Stan |
|---|---|---|---|
| 1 | **EVM-133 scalone** — klauzula „Klienci” w wersji ostatecznej zawiera akapit o wizji lokalnej ([tekst do wstawienia](../../security/rodo.md#akapit-klauzuli-klienci-o-wizji-lokalnej--do-wstawienia-w-evm-133)); jeśli EVM-133 weszła bez akapitu — wersja 1.1 z nową datą | PR EVM-133 (albo PR wersji 1.1); „Prywatność i pomoc” w panelu i w aplikacji pokazuje sekcję „Wizja lokalna” | _do wypełnienia_ |
| 2 | **Aneks DPIA v1.1 zatwierdzony** przez Konrada | [`dpia.md` § 7](../../security/dpia.md#7-aneks-v11--wizja-lokalna-evm-141) — tabela zatwierdzenia wypełniona | _do wypełnienia_ |
| 3 | **Rejestr czynności zatwierdzony** — czynność 9 „Wizje lokalne” przepisana do pełnego rejestru poza repozytorium | [`rodo.md` → rejestr czynności](../../security/rodo.md#szkic-rejestru-czynności-przetwarzania-art-30); wpis w rejestrze poza repozytorium | _do wypełnienia_ |
| 4 | **EVM-139 wdrożone** (zadanie usuwania co najmniej w trybie `report`); **do włączenia `enforce`**: pisemne zobowiązanie Konrada do ręcznego usunięcia każdej wizji bez klienta najpóźniej 90 dni od utworzenia (odrzuconej — 14 dni), karta przeglądu założona, procedura ręczna wykonalna w panelu (także wyczyszczenie telefonu zamawiającego) i akceptacja RR-102 | podpisane zobowiązanie ([wzór](retencja.md#procedura-ręczna-do-włączenia-enforce-zobowiązanie-konrada)); pierwsza karta przeglądu; decyzja o RR-102 w [modelu zagrożeń](../../security/threat-model.md#rr-102--realne-wizje-lokalne-przed-trybem-enforce-usuwanie-ręczne-evm-141); po włączeniu `enforce` — data w karcie | _do wypełnienia_ |
| 5 | **Pozostałe historyjki wizji wdrożone** — EVM-135, EVM-136, EVM-138 i EVM-140 (przypomnienie, przedłużenie, limit), EVM-137, jeśli wizje mają być zakładane z telefonu (ADR-0024: realne dane po przyrostach 1–5 i dokumentach, z EVM-139 co najmniej w `report`); przeglądy bezpieczeństwa tych historyjek bez otwartych blocker i major | statusy `done` w backlogu M2; raporty przeglądów `security-engineer` | _do wypełnienia_ |
| 6 | **Karty A6 wydrukowane** wg [specyfikacji](../../user/karta-wizji-lokalnej.md#specyfikacja-wydruku); kod QR sprawdzony dwoma telefonami, prowadzi do klauzuli „Klienci” w wersji ostatecznej; zapas u każdej osoby zakładającej wizje | wydruk próbny; data wydania kart | _do wypełnienia_ |
| 7 | **Upoważnienia uczestników** — każda osoba, która zakłada wizje albo ma do nich dostęp, ma pisemne upoważnienie i zobowiązanie do poufności (wzór 1), zna rozdział 4 instrukcji dla biura i zasadę „wręcz kartę przed zdjęciami” | podpisane upoważnienia ([wzory](../../security/wzory-dla-pracownikow.md)); potwierdzenie zapoznania się z instrukcją | _do wypełnienia_ |
| 8 | **Warunki DPIA v1.0 dla pierwszych realnych danych** (§ 5: klauzule, upoważnienia, informacja o audycie, przegląd próbek logów) spełnione | [protokół AC8 EVM-064](../../qa/EVM-064/protokoly.md#ac8--zatwierdzenie-dpia) | _do wypełnienia_ |

**Decyzja o przejściu:** gdy punkty 1–8 mają datę, Konrad zapisuje w rejestrze poza repozytorium „realne wizje od dnia …” i przekazuje pracownikom, że zasada z sekcji 1 przestaje obowiązywać. Od tego dnia obowiązuje przegląd z sekcji 4 (do włączenia `enforce`).

## 3. Wyłączenie funkcji — jedna zmiana konfiguracji
Gdy trzeba natychmiast zatrzymać zakładanie wizji (nadużycie, wątpliwość prawna, błąd): **wyłącz `SITE_SURVEYS_ENABLED` w konfiguracji wdrożenia** (miejsce i sposób zmiany wpisuje EVM-135 / `devops-engineer` przy scaleniu). Skutek (ADR-0024 pkt 10): telefon dostaje `feature_disabled` przy nowej wizji („Wymaga uwagi”), panel chowa wybór „Wizja lokalna” i zwraca „nie znaleziono” dla zakładania. Istniejące wizje zostają — biuro przypisuje klienta albo wizje wygasają i są usuwane jak zwykle. Ponowne włączenie — tą samą zmianą. Zapisz datę i powód w rejestrze poza repozytorium.

## 4. Stała obsługa (od pierwszej realnej wizji)
- **Co tydzień** — przegląd filtrem „Wygasające” i „Tylko wizje”: przypisz klienta, przedłuż z powodem (najwyżej 2 razy), odrzuć albo — do włączenia `enforce` — usuń ręcznie wizje po terminie ([`retencja.md` → sekcja 5](retencja.md#5-wizja-lokalna--okresy-tryb-report-i-enforce-procedura-ręczna-evm-141)); karta przeglądu.
- **Przypomnienia e-mailem** (15 dni przed terminem, do twórcy i Administratorów) — reaguj w ciągu tygodnia.
- **Limit** 20 otwartych wizji na osobę i 100 łącznie — odmowa „Masz za dużo otwartych wizji…” oznacza zaległe decyzje, nie błąd systemu.
- **Żądania osób** dotyczące wizji — [`prawa-osob.md` → „Wizja lokalna”](prawa-osob.md#wizja-lokalna--art-15-17-i-21-evm-141).
- **Włączenie `enforce`** po starcie kopii zapasowych — warunki w [`retencja.md` → „Tryb `report` i `enforce`”](retencja.md#tryb-report-i-enforce); od tego dnia przegląd ręczny zastępuje kontrola, czy liczba usuniętych wizji w dzienniku zadania zgadza się z listą „Wygasające”.
