---
lifecycle: living
review_by: 2026-12-31
---

# Propozycje po EVM-075: pierwszy przyrost, pakiety historyjek, podział dużych dokumentów

> Notatka robocza do decyzji Konrada (EVM-075, AC4 i AC5). **Nic z tego nie jest wdrożone** (poza podziałem EVM-008 z pkt 1) — przenoszenie treści dokumentów z `main` i zmiany historyjek wymagają Twojej decyzji (`CLAUDE.md` → „Bezpieczeństwo pracy agentów”).

## 1. Pierwszy pionowy przyrost produktu z M1 (rekomendacja)
Po 14 historyjkach `done` w repozytorium nie ma kodu produktu. Rekomendowana kolejność: **EVM-008 → EVM-016 → EVM-067** (szkielet API + panel → pierwszy Administrator → logowanie i sesje); dalej faza 1 z `docs/backlog/M1/README.md`.

- **Rozstrzygnięte 2026-10-05 (Konrad):** EVM-008 podzielono — część lokalna zostaje w EVM-008 bez zależności od EVM-007, wdrożenie na staging i test dymny po wdrożeniu to EVM-076 (zależy od EVM-007 i EVM-008; płatna infrastruktura tylko za Twoją zgodą na koszty).
- **Ścieżki:** EVM-008 — `pelna` (nowy wzorzec architektoniczny, nagłówki bezpieczeństwa, deny-by-default; model `opus` do rozważenia); EVM-016 i EVM-067 — `pelna` (uwierzytelnianie).

## 2. Pakiety zamiast scalania historyjek (propozycja, opcjonalna)
Historyjki fazy 1 mają po 7–8 AC (limit: lekka ≤ 6, pełna ≤ 8), więc ich łączenie w jedną historyjkę przekroczyłoby limit. Zamiast tego można realizować kilka historyjek **jednym przebiegiem `/deliver`** (jedna gałąź, jeden PR, jeden przegląd na pakiet; AC i testy `EVM-xxx AC#` zostają osobne). Kandydaci:

| Pakiet | Historyjki | Ścieżka | Uwaga |
|---|---|---|---|
| A | EVM-016 + EVM-067 | pełna | wspólny moduł uwierzytelniania |
| B | EVM-019 + EVM-020 + EVM-021 | pełna | migracje i dane osobowe klienta |
| C | EVM-022 + EVM-018 | lekka, jeśli bez zmian poza panelem i odczytem | nowe zlecenie i jego szczegóły |

Wymaga zmiany procesu (nagłówek `/deliver` dla listy ID, limit rozmiaru pakietu) — osobna historyjka, jeśli zdecydujesz się na ten kierunek.

## 3. Podział największych dokumentów żywych (propozycja)
Cztery dokumenty to ok. 500 KB. Zasada: oryginalna ścieżka zostaje **spisem treści** z tymi samymi kotwicami nagłówków (linki w ok. 37 plikach nie pękną), treść trafia do plików w katalogu o tej samej nazwie. Agent czyta spis i jeden plik, nie całość.

| Dokument (rozmiar) | Proponowane pliki | Największe części |
|---|---|---|
| `docs/ux/styleguide.md` (180 KB) | `styleguide/fundamenty.md`, `komponenty.md`, `wzorce.md`, `teren-tresci-dostepnosc.md`, `changelog.md` | § 3 Komponenty 54 KB, § 2 Fundamenty 41 KB, § 4 Wzorce 36 KB, § 8 Changelog 22 KB |
| `docs/security/requirements.md` (129 KB) | `requirements/katalog.md`, `w-ac-per-epik.md`, `asvs-masvs.md`, `bramki-ci.md` | Katalog wymagań 70 KB, per epik 18 KB, załącznik ASVS 16 KB, bramki CI 14 KB |
| `docs/security/threat-model.md` (102 KB) | `threat-model/analiza-stride.md`, `przypadki-naduzyc.md`, `ryzyka-rezydualne.md`, `zakres-aktywa-przeplywy.md` | ryzyka rezydualne 33 KB, nadużycia 26 KB, STRIDE 26 KB |
| `docs/architecture/domain-model.md` (88 KB) | `domain-model/encje.md`, `erd.md`, `stany-i-uprawnienia.md`, `dane-i-offline.md` | encje 20 KB, ERD 11 KB, stany 9 KB |

Koszt wdrożenia: jedna historyjka `lekka` (przeniesienie treści 1:1, bez zmian merytorycznych, walidator linków i `docs:check`) na dokument; kolejność wg tego, który agenci czytają najczęściej (styleguide, requirements). Ryzyka: (1) kotwice w ok. 37 plikach, które odwołują się do tych ścieżek — spis zachowuje nagłówki; (2) testy przypinające teksty; (3) równoległe edycje w trakcie przenoszenia — przenosić poza oknem pracy nad dokumentem. Wymagana jest Twoja decyzja, bo to przenoszenie treści z `main`.
