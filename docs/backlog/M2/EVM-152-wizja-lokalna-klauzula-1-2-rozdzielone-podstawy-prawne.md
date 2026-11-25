---
id: EVM-152
title: "Wizja lokalna: klauzula 1.2 z rozdzielonymi podstawami prawnymi, karta A6 1.2, test równowagi, formuły i stopka oferty, aktualizacja rejestru i DPIA"
type: enabler
milestone: M2
epic: E15 Wizja lokalna
status: ready
priority: P1
path: lekka             # tylko treści i dokumentacja (content.ts bez zmiany logiki); jak EVM-141 i EVM-149 — uzasadnienie w „Decyzje i ograniczenia”
owner: security-engineer
contributors: [product-owner, web-developer, mobile-developer]
reviewers: [code-reviewer]
model: opus             # owner security-engineer; treść prawna i DPIA zatwierdza Konrad
depends_on: [EVM-149, EVM-147, EVM-148]
---

# EVM-152: Klauzula 1.2 — rozdzielone podstawy prawne dla wizji i oferty

## Cel
Jako **administrator danych** chcę **poprawić klauzulę, kartę A6, instrukcję i rejestr tak, by podstawy przetwarzania na wizji były rozdzielone (art. 6 ust. 1 lit. b i lit. f) i podane osobom w chwili zbierania danych**, aby **przed pierwszą realną ofertą spełnić warunki W1–W5 i W8 z opinii prawnej modelu AI z 2026-11-25 (werdykt: „podstawa wystarczająca pod warunkami”)**. Klauzula 1.1 (EVM-149) opiera całą wizję na lit. b, a opinia uznaje ją za wystarczającą tylko dla osoby, która sama prosi o oględziny lub ofertę; dla zamawiającego działającego za kogoś, adresata oferty, właściciela i mieszkańców, osób w kadrze oraz 14 dni po rezygnacji potrzebna jest lit. f z pisemnym testem równowagi (TSUE C-394/23 wymaga poinformowania o interesie przy zbieraniu danych).

## Kryteria akceptacji
Treści wzorowane na rozdz. 9 opinii (redakcja końcowa: Konrad); tylko dane syntetyczne w przykładach; zmiany zatwierdza Konrad.

**AC1 — Klauzula 1.2 w panelu i aplikacji (W1)**
- Zakładając klauzulę 1.1 w `apps/web/src/privacy/content.ts` i `apps/mobile/src/privacy/content.ts` oraz `rodo.md`
- Gdy dopisuję wersję 1.2
- Wtedy obie treści są identyczne i mają: osobną podstawę dla każdego z przypadków (lit. b — osoba prosząca dla siebie; lit. f z nazwanym interesem — zamawiający za kogoś innego, adresat oferty, który nie prosił, właściciel i mieszkańcy, osoby w kadrze; lit. f — przechowywanie do 14 dni po rezygnacji, na żądanie usunięcie od razu) oraz informację o prawie sprzeciwu; zdanie o ofercie jako regułę (bez „możemy zapisać”); kategorie danych i okresy z adresem e-mail i kopiami oferty poza systemem; cel zdjęć po zawarciu umowy; brak dwuznacznego „ich” (obecnie osoby postronne i właściciel/mieszkańcy); nową wersję 1.2 z datą wg mechanizmu EVM-133/149; testy treści i wersji przechodzą.

**AC2 — Karta A6 i naklejka 1.2 (W1)**
- Zakładając kartę `docs/user/karta-wizji-lokalnej.md` w wersji 1.1 (nie drukujemy jej)
- Gdy ją aktualizuję
- Wtedy karta i naklejka mają wersję 1.2 i datę zgodną z klauzulą, te same rozdzielone podstawy, okresy 90 / 270 / 14 dni (usunięcie od razu na żądanie), kategorie z adresem e-mail i kopiami oferty; sprawdzono, że tekst mieści się na A6 przy ≥ 9 pt; zdania o UE/EOG dotyczące poczty są zgodne z faktami (do czasu wyniku W7 nie twierdzą więcej, niż potwierdzono — otwarte pytanie 3).

**AC3 — Instrukcja dla biura, formuły i stopka oferty (W3, W4, W5)**
- Zakładając instrukcję dla biura w `docs/user/`
- Gdy dopisuję zasady i gotowe teksty
- Wtedy instrukcja mówi: pytaj, czy oferta jest dla zamawiającego, czy dla innej osoby; imię i nazwisko innej osoby do oferty dopiero po potwierdzeniu, że osoba wie o zapytaniu (inaczej oferta na zamawiającego z oznaczeniem nieruchomości); przedłużenie wizji tylko po potwierdzeniu zainteresowania, datę rozmowy zapisać w karcie przeglądu bez imion i telefonów; po rezygnacji lub odrzuceniu od razu „Odrzuć wizję”; na żądanie usunięcia — usunięcie od razu, bez czekania 14 dni, także po `enforce`; w `docs/user/` są gotowe teksty: stopka informacyjna każdej oferty (art. 13 i 14), formuła ustna przy przyjęciu zgłoszenia i wiadomość SMS/e-mail z linkiem do klauzuli (bez adresu posesji i imienia).

**AC4 — Test równowagi interesów (W2)**
- Zakładając brak pisemnego testu równowagi
- Gdy dodaję dokument w `docs/security/` (klasa „żywy” wg `document-lifecycle.md`)
- Wtedy zawiera pięć przetworzeń F1–F5 na lit. f (kontakt zamawiającego za inną osobę; oferta dla adresata, który nie prosił; właściciel i mieszkańcy, którzy nie zamawiali; osoby w kadrze; 14 dni po rezygnacji), każde z interesem, niezbędnością, równowagą, zabezpieczeniami, wynikiem i terminem przeglądu (≤ 12 miesięcy); pole „zatwierdził / data” czeka na Konrada; brak danych osobowych; `rodo.md` i czynność 9 odsyłają do niego.

**AC5 — `rodo.md`, rejestr, DPIA, retencja i prawa osób (W8)**
- Zakładając `docs/security/rodo.md` (czynność 9), `docs/security/dpia.md` (aneks), `docs/ops/runbooks/retencja.md` i `prawa-osob.md`
- Gdy je aktualizuję
- Wtedy czynność 9 ma pola z opinii (cel, podstawa b/f z odnośnikiem do testu równowagi, kategorie osób i danych z adresem e-mail, odbiorcy, okresy, źródło danych, informacja); nowa wersja aneksu DPIA ocenia dodane kategorie i ryzyko rezydualne i wymaga zatwierdzenia Konrada przed pierwszą realną ofertą; runbooki opisują usunięcie na żądanie od razu (bez 14 dni, także w `enforce`); `npm run docs:check` bez błędów.

**AC6 — Spójność, status prawny i lista E15**
- Zakładając zmiany z AC1–AC5 oraz listę kontrolną E15 (`docs/backlog/M2/README.md`, `docs/ops/runbooks/wizja-lokalna.md` pkt 12)
- Gdy je domykam
- Wtedy żaden dokument ani treść w aplikacji nie nazywa opinii AI „weryfikacją przez prawnika” (W9 pozostaje otwarty — zob. Decyzje); lista E15 i pkt 12 mają warunki: klauzula i karta 1.2, test równowagi, `enforce`, W6, W7, W9; data wersji 1.2 jest spójna we wszystkich miejscach (lista z EVM-149 Notatki, w tym `CHANGELOG.md`); wpis w `CHANGELOG.md` (wersja 1.2).

## Poza zakresem
- Kod: pole „rola zamawiającego” (R1), usuwanie lokalizacji z plików wgrywanych w panelu (R3), kasowanie starszych wersji plików oferty na żądanie (R5), wysyłka SMS z linkiem, termin ważności oferty w systemie (R4), przywrócenie odrzuconej wizji z kodem powodu (R6) — osobne pozycje backlogu (kandydaci; ID nadaje się przy `/refine`).
- W6 (usuwanie kopii oferty poza systemem z dowodem w karcie przeglądu) i W7 (sprawdzenie dostawcy poczty: EOG, umowa powierzenia) — działania organizacyjne Konrada, tu tylko warunki wydania.
- W9 (weryfikacja przez licencjonowanego radcę prawnego lub adwokata); wydruk kart; dane spółki; zmiana okresów 90 / 270 / 14 dni; wizje z inicjatywy firmy (brak podstawy — zakaz pozostaje).

## Decyzje i ograniczenia
- Decyzje Konrada 2026-11-25: robimy klauzulę 1.2; kart A6 1.1 nie drukujemy, czekamy na 1.2; warunkiem realnych ofert jest włączony `enforce` (EVM-139), nie samo RR-102; agent AI zastępuje prawnika w opinii, ale nie jest weryfikacją W9 jako warunkiem formalnym (potwierdzić — pytanie 1).
- Bezpieczeństwo i prywatność: wizja z inicjatywy firmy nie ma podstawy; podstawa 14 dni to lit. f, nie art. 17 ust. 3; nazwisko innej osoby w ofercie tylko po potwierdzeniu zamawiającego.
- **Ścieżka `lekka`** (dane osobowe zwykle = pełna): zmiana to wyłącznie treści i dokumenty, bez nowego przetwarzania, endpointu, migracji ani logiki (`content.ts` to stałe tekstów); tak samo szły EVM-141 i EVM-149 bez uwag; ryzyko merytoryczne zamyka zatwierdzenie Konrada (treść prawna, DPIA) i W9, a spójność treści z testami — jeden recenzent `code-reviewer`. Gdy dojdzie zmiana kodu (pola, UI), osobna historyjka na ścieżce pełnej.
- Cel wersji i data: mechanizm wersji z EVM-133/149 (data 1.2 ustalana przy scaleniu; pięć miejsc do korekty wg Notatek EVM-149).

## Otwarte pytania

Brak — rozstrzygnięte przez Konrada 2026-11-25: (1) W9 zostaje jako osobny warunek pierwszej realnej oferty i nie blokuje scalenia EVM-152; (2) opinia AI zapisana w `docs/notes/opinia-prawna-ai-wizja-art-6-1-b.md` (`lifecycle: milestone`, M2) z zastrzeżeniem, że nie jest weryfikacją prawnika; (3) zdanie o UE w klauzuli 1.2 ograniczone do Hetzner i Scaleway, o poczcie neutralnie do czasu W7 (ewentualnie wersja 1.3); (4) test równowagi w `docs/security/` bez danych osób, z wpisem „zatwierdził / data”.

## Notatki
- Aneks DPIA: nowa wersja (po v1.2 z EVM-149) — numer nada wykonawca.
- Kandydaci backlogu z opinii: R1, R3, R4, R5, R6 (wyżej), R7 (zawężenie kadru do elementów potrzebnych do wyceny) — w tej historyjce tylko jako zdanie w instrukcji.
- Zapis stanu: do czasu 1.2 nadal obowiązuje „tylko wizje testowe”; dokumenty na wizji w produkcji po EVM-147, EVM-148, EVM-152, `enforce` i W6, W7, W9.

## Dziennik
- 2026-11-25 — utworzono (product-owner) po opinii prawnej modelu AI i decyzji Konrada „klauzula 1.2”
- 2026-11-25 — decyzje Konrada w sprawie W9, miejsca opinii AI i zdania o UE/EOG; opinia zapisana w `docs/notes/`; status `ready`
