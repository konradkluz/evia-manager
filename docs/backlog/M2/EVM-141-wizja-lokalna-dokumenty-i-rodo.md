---
id: EVM-141
title: "Wizja lokalna: dokumenty RODO i bezpieczeństwa, karta informacyjna, akapit klauzuli, instrukcja dla biura"
type: enabler
milestone: M2
epic: E15 Wizja lokalna
status: ready
priority: P1
path: lekka             # dokumentacja bez kodu
owner: security-engineer
contributors: [product-owner, ux-designer]
reviewers: [code-reviewer]
model: opus             # owner security-engineer; zatwierdza Konrad (DPIA, rejestr czynności)
depends_on: []          # EVM-133 nie blokuje: akapit do klauzuli powstaje tu, wstawia go EVM-133 (dane spółki od Konrada)
---

# EVM-141: Wizja lokalna — dokumenty i RODO

## Cel
Jako **administrator danych** chcę **mieć opisane (rejestr, DPIA, model zagrożeń, retencję, prawa osób) i przekazywane osobom na miejscu zasady przetwarzania wizji lokalnych**, aby **funkcja mogła przejść z wizji testowych na realne zgodnie z RODO (W4, W12), a biuro i technicy wiedzieli, jak jej używać**. Dokumenty wchodzą w tej samej kolejce co EVM-135 (security: dokumenty razem z pierwszą historyjką).

## Decyzje Konrada (2026-11-16)
1. Wizja = zlecenie bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”. 2. Zwykły numer od razu. 3. 90 dni (przedłużenie A/E), odrzucona 14 dni. 4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Bez ofert. 7. EVM-133 (klauzule, z akapitem o wizji) → wizja → EVM-112 → EVM-111.
Wieczorem („akceptuję wg rekomendacji”): 8. Nazwa „Wizja lokalna”. 9. Tylko odczyt bez dostępu; telefon: twórca i opiekun. 10. Adres tylko w szczegółach. 11. Klient po przypisaniu niezmienny, telefon czyszczony. 12. Luki w numeracji akceptowane. 13. Wizje na głównej liście. 14. Przypomnienie 15 dni przed; przedłużenie tylko w panelu ≤ 2; limit 20 / 100. 15. `enforce` po kopiach, do tego `report`. 16. **Do czasu EVM-139, EVM-141 i ostatecznych klauzul (EVM-133) tylko wizje testowe, bez prawdziwych klientów; przełącznik funkcji włączony po scaleniu (wyłączenie = jedna zmiana konfiguracji); zasada „tylko testowe” jest organizacyjna i zapisana tu oraz w instrukcji.** Karta informacyjna A6 z QR — tak; znacznik „informację przekazano” — nie; realne wizje w teście EVM-112 — nie.

## Kryteria akceptacji
Zmiana dokumentów — zatwierdza Konrad; tylko dane syntetyczne w przykładach.

**AC1 — `rodo.md` i rejestr czynności**
- Zakładając obecną inwentaryzację i rejestr czynności
- Gdy dodajemy wizję lokalną
- Wtedy `docs/security/rodo.md` ma: wiersz encji (zlecenie z terminem wygaśnięcia, telefon zamawiającego), cel i podstawę („wizja lokalna i przygotowanie oferty na żądanie” — art. 6 ust. 1 lit. b; osoby trzecie w kadrze — lit. f), retencję (90 dni, przedłużenia ×2 do 270 dni, anulowana 14 dni, nagrobek bez danych osobowych), obowiązek informacyjny na miejscu (art. 13), zakaz wizji „z inicjatywy firmy” i zasadę „tylko wizje testowe” do czasu warunków z AC6; rejestr ma nową czynność albo rozszerzenie czynności 1 i 2.

**AC2 — Aneks DPIA v1.1**
- Zakładając `dpia.md` v1.0
- Gdy dodajemy cel „wizja lokalna” i kategorię „potencjalni klienci”
- Wtedy powstaje aneks v1.1: § 2 (cel, osoby), § 3 (retencja), wiersz D14 („wizje bez konwersji”: archiwum bez celu, brak informacji, adres w tekście swobodnym) z oceną po kontrolach W1–W8 i aktualizacja D6 o zakres repliki (twórca i opiekun); do zatwierdzenia przez Konrada.

**AC3 — Model zagrożeń, wymagania, retencja, prawa osób**
- Zakładając `threat-model.md`, `requirements.md`, `retencja.md`, `prawa-osob.md`
- Gdy domykamy dokumenty
- Wtedy są wiersze TM (tworzenie offline, przypisanie klienta i IDOR, automatyczne usuwanie i klucz rejestru `worker`, zakres repliki, adres w powiadomieniach), aktualizacja RR-55, RR-96 i RR-98, nowe SR-PRIV-11/12 i SR-AUTHZ-13, mapa „okres → stała” w `retencja.md` z trybem `report`/`enforce`, a runbook praw osób opisuje wyszukiwanie wizji po adresie (art. 15) i usunięcie na żądanie (art. 17).

**AC4 — Akapit klauzuli i karta informacyjna**
- Zakładając, że EVM-133 czeka na dane spółki od Konrada
- Gdy technik jedzie na wizję
- Wtedy gotowy do wstawienia akapit o wizji lokalnej dla klauzuli „Klienci” (cel, kategorie: adres, zdjęcia i filmy posesji, telefon, źródło, okresy 90/270/14 dni) jest w `docs/security/rodo.md` (sekcja do skopiowania w EVM-133), a karta A6 z naklejką (administrator, cel, kategorie, okres, prawa, adres klauzuli „Klienci” i miejsce na QR) jest w `docs/user/`; QR generowany lokalnie bez usług zewnętrznych (jeśli narzędzia brak — Konrad dodaje obraz przy druku); instrukcja mówi „wręcz kartę przed zdjęciami”.

**AC5 — Instrukcja dla biura i technika**
- Zakładając `docs/user/`
- Gdy kończymy dokumentację
- Wtedy instrukcja opisuje: założenie wizji (aplikacja, panel), przypisanie klienta, odrzucenie, przedłużenie, wizje „na żądanie klienta”, „nie wpisuj imion i telefonów w opisach i komentarzach” oraz **zasadę „tylko wizje testowe”** (adres własny lub biura, zdjęcia bez osób i tablic); `domain.md` aktualizuje EVM-135, tu — wyłącznie spójność terminów („Wizja lokalna”, opiekun/koordynator); `npm run docs:check` bez błędów.

**AC6 — Warunki przejścia z wizji testowych na realne**
- Zakładając wszystkie powyższe
- Gdy Konrad chce przyjąć pierwszą realną wizję
- Wtedy lista kontrolna w instrukcji administratora wymaga: EVM-133 scalone (klauzula z akapitem), aneks DPIA i rejestr zatwierdzone, EVM-139 wdrożone (do czasu `enforce` — pisemne zobowiązanie Konrada do ręcznego usunięcia wizji nie później niż 90 dni od utworzenia, z kartą przeglądu w `retencja.md`), karty wydrukowane, upoważnienia uczestników; wyłączenie funkcji to jedna zmiana konfiguracji.

## Poza zakresem
Kod; treść klauzul poza akapitem wizji (EVM-133); makiety (ux-designer przy EVM-137/138); pełna nowa DPIA; znacznik „informację przekazano”; informacja w SMS/e-mailu z potwierdzeniem terminu (termin wizyty poza zakresem); aktualizacja `domain.md` (EVM-135).

## Decyzje i ograniczenia
- Ocena własna administratora (bez prawnika i IOD — RR-95), wariant bezpieczny; to nie porada prawna.
- Rozstrzygnięcie Tech Leada z delegacji, do potwierdzenia przy demo: lokalizacja karty w `docs/user/` (Markdown do wydruku) i sposób wygenerowania QR.

## Notatki
Rozmiar wg ADR-0024: M. Wejścia: `security.md` z oceny (W4, W12), ADR-0024.

## Dziennik
- 2026-11-16 — szkic (product-owner)
- 2026-11-16 — uzgodniono z ADR-0024, wpisano decyzje Konrada („akceptuję wg rekomendacji”); **status ready** (product-owner)
