---
id: EVM-141
title: "Wizja lokalna: dokumenty RODO i bezpieczeństwa, karta informacyjna, słownik domeny i instrukcja dla biura"
type: enabler
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: lekka             # dokumentacja bez kodu (wyjątek: tylko pliki w docs/ i materiał do druku)
owner: security-engineer
contributors: [product-owner, ux-designer]
reviewers: [code-reviewer]
model: opus             # owner security-engineer; zatwierdza Konrad (DPIA, rejestr czynności)
depends_on: [EVM-133]   # akapit klauzuli „Klienci” o wizji wchodzi do EVM-133 (decyzja 7)
---

# EVM-141: Wizja lokalna — dokumenty i RODO

## Cel
Jako **administrator danych** chcę **mieć opisane (rejestr, DPIA, model zagrożeń, retencję, prawa osób) i przekazywane osobom na miejscu zasady przetwarzania wizji lokalnych**, aby **funkcja mogła zostać włączona na danych realnych zgodnie z RODO (W4, W12) i by biuro i technicy wiedzieli, jak jej używać**. Brak tej historyjki = flaga wizji z EVM-135 zostaje wyłączona. Najlepiej wchodzi w tym samym przebiegu co EVM-135 (security: dokumenty w tym samym PR co pierwsza historyjka).

## Decyzje Konrada (2026-11-16)
1. Wizja bez klienta w „Wycena”. 2. Zwykły numer od razu.
3. Wygasanie 90 dni (przedłużenie A/E), odrzucona 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”.
5. Zakłada technik i biuro. 6. Oferta poza zakresem.
7. **Kolejność: najpierw EVM-133 (klauzule prywatności, z akapitem o wizji lokalnej)**, potem wizja, potem test terenowy EVM-112, EVM-111 za nimi.

## Kryteria akceptacji
Zmiana dokumentów — Konrad zatwierdza; bez danych osobowych w przykładach.

**AC1 — Rejestr czynności i `rodo.md`**
- Zakładając obecną inwentaryzację i rejestr czynności
- Gdy dodajemy wizję lokalną
- Wtedy `docs/security/rodo.md` ma: wiersz encji (wizja = zlecenie bez klienta), cel i podstawę („wizja lokalna i przygotowanie oferty na żądanie” — art. 6 ust. 1 lit. b; osoby trzecie w kadrze — lit. f), retencję (90 dni, przedłużenie ×2 do 270 dni, odrzucona 14 dni), obowiązek informacyjny na miejscu (art. 13) i zakaz wizji z inicjatywy firmy; rejestr ma nową czynność albo rozszerzenie czynności 1 i 2.

**AC2 — Aneks DPIA v1.1**
- Zakładając `dpia.md` v1.0
- Gdy dodajemy cel „wizja lokalna” i kategorię „potencjalni klienci”
- Wtedy powstaje aneks v1.1: § 2 (cel, osoby), § 3 (retencja), nowy wiersz D14 („wizje bez konwersji”: archiwum bez celu, brak informacji, adres w tekście swobodnym) z oceną po kontrolach W1–W8 i aktualizacja D6 o zakres repliki; do zatwierdzenia przez Konrada.

**AC3 — Model zagrożeń, wymagania i retencja**
- Zakładając `threat-model.md`, `requirements.md`, `retencja.md`
- Gdy domykamy dokumenty
- Wtedy są wiersze TM (tworzenie offline, przypisanie klienta i IDOR, automatyczne usuwanie i sekret rejestru, zakres repliki, adres w powiadomieniach), aktualizacja RR-96 i RR-98 (media i filmy wizji), nowe SR-PRIV-11/12 i SR-AUTHZ-13, mapa „okres → stała” w `retencja.md`, a runbook praw osób (`prawa-osob.md`) opisuje wyszukiwanie wizji po adresie (art. 15) i usunięcie na żądanie (art. 17).

**AC4 — Karta informacyjna dla osoby na miejscu**
- Zakładając klauzulę „Klienci” z akapitem o wizji (EVM-133)
- Gdy technik jedzie na wizję
- Wtedy ma kartę (A6 do druku i naklejkę): kto jest administratorem, cel, kategorie danych (adres, zdjęcia i filmy posesji), okres, prawa i **QR do klauzuli „Klienci”**; gotowy plik do wydruku w repozytorium materiałów firmowych (ścieżka do uzgodnienia), a w instrukcji punkt „wręcz kartę przed zdjęciami”.

**AC5 — Słownik domeny i instrukcja dla biura**
- Zakładając `domain.md` i `docs/user/`
- Gdy kończymy dokumentację
- Wtedy `domain.md` definiuje „Wizja lokalna” (zlecenie bez klienta w statusie „Wycena”, reguły: klient przy „Zaakceptowane”, wygasanie, odrzucenie, telefon zamawiającego) i aktualizuje zdanie „Zlecenie = Klient + Lokalizacja + Zakres”; instrukcja dla biura (`docs/user/`) opisuje: założenie, przypisanie klienta, odrzucenie, przedłużenie, zasady „na żądanie klienta” i „nie wpisuj imion i telefonów w opisach”; `npm run docs:check` bez błędów.

**AC6 — Warunki włączenia funkcji**
- Zakładając wszystkie powyższe
- Gdy Konrad ma włączyć wizje na danych realnych
- Wtedy lista kontrolna (w instrukcji administratora) wymaga: EVM-133 scalone, EVM-141 zatwierdzone (aneks DPIA, rejestr), EVM-139 wdrożone (usuwanie), karty wydrukowane, upoważnienia uczestników; do czasu EVM-139 — pisemne zobowiązanie Konrada do ręcznego usunięcia wizji nie później niż 90 dni od utworzenia (karta przeglądu w `retencja.md`), **wyłącznie na czas testu**.

## Poza zakresem
Kod; zmiana klauzul poza akapitem wizji (EVM-133); makiety (zadanie ux-designera w `/refine` EVM-137/138); pełna nowa DPIA; informacja o wizji w SMS/e-mail z potwierdzeniem terminu (termin wizyty poza zakresem).

## Decyzje i ograniczenia
- Ocena własna administratora (bez prawnika i IOD — RR-95), wariant bezpieczny; to nie porada prawna.
- **Pytania do Konrada:**
  1. Karta informacyjna: druk A6 + QR, czy naklejka na wizytówce technika? Rekomendacja: A6 i QR (wydruk robi Konrad); konsekwencja: koszt druku, brak zmian w aplikacji.
  2. Znacznik „informację przekazano” w aplikacji? Rekomendacja: nie w v1 (instrukcja + karta wystarczą; YAGNI); konsekwencja: rozliczalność art. 5 ust. 2 oparta na procedurze, nie na polu.
  3. Realne wizje w teście EVM-112? Rekomendacja: nie — wizje syntetyczne lub wewnętrzne do spełnienia AC6; konsekwencja: test pokaże sposób pracy, ale nie na realnych adresach.
- **Konsultacje przed `ready`:** security (autor), UX (karta, instrukcja).

## Dziennik
- 2026-11-16 — szkic (product-owner)
