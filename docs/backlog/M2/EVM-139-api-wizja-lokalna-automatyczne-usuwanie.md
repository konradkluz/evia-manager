---
id: EVM-139
title: "API i worker: wizja lokalna — automatyczne trwałe usuwanie (90 / 14 dni), rejestr usunięć, tryb report i enforce"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-progress
priority: P1
path: pelna             # pierwsze automatyczne usuwanie danych biznesowych, art. 17 RODO, nowy sekret
owner: backend-developer
contributors: [devops-engineer]   # osobny klucz rejestru usunięć dla `worker` (RR-55), manifest sekretów i polityka bucketu w IaC
reviewers: [code-reviewer, security-engineer]
model: opus             # operacja nieodwracalna, sekrety, zegar w testach
depends_on: [EVM-135, EVM-136, EVM-140, EVM-051]
---

# EVM-139: Automatyczne usuwanie wizji

## Cel
Jako **administrator danych (EVia Charge)** chcę, aby **wizje lokalne, które nie zostały klientem, były usuwane automatycznie i trwale — zdjęcia, filmy, adres i pola swobodne — a po zleceniu został anonimowy „nagrobek”**, aby **zysk prywatności z „wizji bez klienta” był realny (dziś anulowane zlecenie leży 12 miesięcy)** (W1, blocker). Wykonuje się w `worker` zgodnie z [ADR-0024](../../architecture/adr/0024-wizja-lokalna-zlecenie-bez-klienta.md) pkt 9.

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”. 2. Zwykły numer od razu. 3. **Wizja bez klienta usuwana po 90 dniach (przedłużenie A/E), odrzucona po 14 dniach.** 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Bez ofert. 7. EVM-133 → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. Tylko odczyt bez dostępu; telefon: twórca i opiekun. 10. Adres tylko w szczegółach. 11. Klient po przypisaniu niezmienny, telefon czyszczony. 12. **Luki w numeracji akceptowane** (nagrobek zachowuje numer, więc luk nie ma). 13. Wizje na głównej liście. 14. Przypomnienie 15 dni przed; przedłużenie tylko w panelu ≤ 2; limit 20 / 100. 15. **Trwałe usuwanie (`enforce`) dopiero po uruchomieniu kopii zapasowych; do tego czasu tryb `report` (tylko liczy).** 16. Tylko wizje testowe do czasu EVM-139/141/133; przełącznik włączony po scaleniu.

## Kryteria akceptacji
Operacja systemowa (bez użytkownika); ślad w audycie i alertach dla Administratora.

**AC1 — Wybór kandydatów i tryb `report`**
- Zakładając tryb `report` (domyślny do czasu kopii) i wizje: po terminie, przed terminem, z klientem, już usunięte
- Gdy działa zadanie
- Wtedy wybiera wyłącznie wiersze `site_survey_expires_at < now() AND customer_id IS NULL AND site_survey_purged_at IS NULL` (trzy warunki), **nic nie usuwa**, zapisuje liczbę kandydatów (bez danych osobowych) w dzienniku i metryce; test z kontrolowanym zegarem (dzień 89 — poza, 91 — kandydat); przejście na `enforce` to zmiana konfiguracji (decyzja Konrada po starcie kopii, poza tą historyjką).

**AC2 — `enforce`: rejestr przed zmianą, potem usunięcie**
- Zakładając tryb `enforce` i wizję-kandydata
- Gdy zadanie ją przetwarza (partie, jedna transakcja na wizję)
- Wtedy najpierw powstaje wpis w rejestrze usunięć (identyfikatory zlecenia i mediów, bez treści, adresu i telefonu), potem: media ścieżką EVM-051 (obiekty kasowane po commicie z dokończeniem), wpisy dziennika zredagowane, lokalizacja utworzona dla wizji i niewskazywana przez inne zlecenie ani dokument zanonimizowana (migracja `sites`: `anonymized_at`, `anonymized_by`, CHECK i trigger nieodwracalności), tytuł i opis zlecenia neutralne, telefon `NULL`, `deleted_at` i `site_survey_purged_at` (jednokrotny zapis); zlecenie zostaje jako anonimowy nagrobek z numerem; gdy wpis do rejestru się nie powiedzie, wizja nie jest ruszana i jest alert.

**AC3 — Anulowane po 14 dniach, ochrona zleceń z klientem, wyścig**
- Zakładając wizję anulowaną (termin = najmniejsza z wartości, EVM-136), wizję z przypisanym klientem i wizję przywróconą
- Gdy mija termin lub równolegle przypisuję klienta
- Wtedy anulowana znika po 14 dniach jak w AC2; zlecenie z klientem (także przypisanym w ostatniej chwili) nigdy nie jest usuwane (CHECK i warunek zapytania); przywrócona dostaje nowy termin z EVM-136; test wyścigu „przypisanie ↔ usunięcie”: wygrywa jedno, bez uszkodzenia danych.

**AC4 — Synchronizacja i kolejki telefonów**
- Zakładając usuniętą wizję
- Gdy telefony i panel pobierają zmiany
- Wtedy `sync.change_log` dostaje znacznik `delete` (same identyfikatory), telefon usuwa wizję, a mutacje i pliki z kolejki do niej dostają `rejected target_unavailable` bez ponawiania (W10); `change_log`, audyt i logi nie zawierają adresu ani telefonu; eksportu ZIP wizji nie ma; media usuniętej wizji nie są dostępne dla żadnej roli.

**AC5 — Odporność i ponowienia**
- Zakładając awarię w trakcie (część mediów usunięta) albo błąd usuwania obiektu
- Gdy zadanie ponawia
- Wtedy kończy usuwanie bez duplikatów wpisów w rejestrze i bez osieroconych obiektów (SR-FILE-11), pozostałe wizje są przetwarzane, trwały błąd daje alert i ślad dla Administratora; zadanie ma limit liczby usunięć na przebieg i dziennik bez danych osobowych.

**AC6 — Uprawnienia, konfiguracja i klucz rejestru**
- Zakładając Edytora, Administratora i `worker`
- Gdy ktoś próbuje usunąć wizję „od ręki” albo zmienić okresy
- Wtedy nie ma takiej operacji (usuwa wyłącznie zadanie; wcześniej — zwykłe trwałe usunięcie z EVM-051); okresy 90/14 dni są stałymi w kodzie (SR-PRIV-01) z testem granic; `worker` zapisuje do rejestru własnym poświadczeniem wyłącznie `PutObject` (manifest sekretów i polityka bucketu w IaC; przegląd devops i security) i nie ma `DELETE` na tabelach aplikacji poza zakresem zadania.

## Poza zakresem
Przypomnienia, przedłużenie, limit (EVM-140); ekrany; anonimizacja zamiast usunięcia dla zleceń z klientem; zmiana retencji zwykłych zleceń; odtwarzanie z kopii; samo włączenie `enforce`.

## Decyzje i ograniczenia
- Konsultacja architekta — ADR-0024 (pkt 9, migracje): `worker`, nagrobek, rejestr w tej samej transakcji (TM-128), `report` → `enforce`; pierwsze terminy 90 dni przypadają po 2027-02-14, anulowane wizje czekają najwyżej do włączenia `enforce`. Bezpieczeństwo: W1, W2, W5, W10, W11; RR-55 do aktualizacji przy scaleniu.
- Kopie bazy: termin 2026-12-13 (RR-91) — `enforce` włącza Konrad po ich starcie.

## Notatki
Rozmiar wg ADR-0024: **L**. Ostatnia w kolejności (po 138); do tego czasu wszystkie wizje są testowe (decyzja 16).

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
- 2026-11-17 — start realizacji w kolejce `/noc-2026-11-16` (tor E, klon n1, gałąź `feature/queue-2026-11-17-wizja-lokalna-usuwanie` od części API EVM-140 `75050884`); **status `in-progress`** (Tech Lead)
