---
id: EVM-149
title: "Wizja lokalna: klauzula informacyjna 1.1 (oferta na wizji), karta A6, DPIA D14, rodo.md, model zagrożeń i prawa osób dla dokumentów wizji"
type: enabler
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: lekka             # dokumentacja i treści klauzul; kod tylko w plikach treści (content.ts)
owner: security-engineer
contributors: [product-owner, web-developer, mobile-developer]
reviewers: [code-reviewer]
model: opus             # owner security-engineer; zatwierdza Konrad (treść prawna, DPIA)
depends_on: [EVM-133]   # klauzula 1.0 scalona (#155); warunek wydania: dokumenty na wizji w produkcji dopiero po EVM-147 i EVM-149
---

# EVM-149: Klauzula 1.1 i dokumentacja RODO dla dokumentów wizji

## Cel
Jako **administrator danych** chcę **poinformować osoby na wizji i opisać w dokumentacji RODO, że na etapie wizji może powstać oferta z ich imieniem i nazwiskiem**, aby **przed pierwszą realną wizją z dokumentem klauzula, karta i rejestr mówiły prawdę (security H2) i funkcja z EVM-147/148 mogła działać na realnych danych**. Klauzula 1.0 i karta A6 twierdzą dziś, że przed przypisaniem klienta nie ma danych osobowych poza adresem i telefonem — po EVM-147 byłoby to nieprawdą.

## Kryteria akceptacji
Zmiany dokumentów i treści zatwierdza Konrad; tylko dane syntetyczne w przykładach.

**AC1 — Klauzula informacyjna 1.1**
- Zakładając klauzulę 1.0 w panelu i w aplikacji (`apps/web/src/privacy/content.ts`, `apps/mobile/src/privacy/content.ts`, `rodo.md`)
- Gdy dopisuję wersję 1.1
- Wtedy obie treści zawierają to samo zdanie, że na etapie wizji można zapisać ofertę z imieniem i nazwiskiem zamawiającego (retencja jak wizji: 90 / 14 dni), mają nową wersję z datą i obowiązują wymóg ponownego potwierdzenia wg istniejącego mechanizmu wersji; testy treści i wersji przechodzą.

**AC2 — Karta A6 i instrukcja**
- Zakładając kartę `docs/user/karta-wizji-lokalnej.md` (linia 23) i instrukcję dla biura
- Gdy je aktualizuję
- Wtedy karta nie twierdzi już, że nie ma danych osobowych poza adresem i telefonem, mówi o ofercie na wizji i o usunięciu razem z wizją; instrukcja ma zasady (tylko oferta, bez skanów tożsamości, bez imion w tytule); wersja karty i data zgodne z klauzulą 1.1.

**AC3 — `rodo.md`, DPIA i retencja**
- Zakładając `docs/security/rodo.md` (m.in. linia 419), `docs/security/dpia.md` i `docs/ops/runbooks/retencja.md`
- Gdy je uzupełniam
- Wtedy czynność 9 i inwentaryzacja obejmują dokumenty wizji (kategoria danych: imię, nazwisko i adres zamawiającego w ofercie), retencja 90 / 14 dni i usunięcie razem z wizją są opisane, aneks DPIA D14 ocenia nową kategorię, ryzyko rezydualne (starsze wersje obiektów do 30 dni, kopie bazy do 37 dni) jest zapisane do akceptacji jako RR-14 (źródła: media i dokumenty wizji) z odnośnikiem do ADR-0025; procedura ręczna w `retencja.md` (sekcja 5) obejmuje dokumenty.

**AC4 — Wymagania, model zagrożeń i lista E15**
- Zakładając `docs/security/requirements.md` i `threat-model.md`
- Gdy je aktualizuję
- Wtedy SR-PRIV-04/11/12 i SR-AUTHZ-13 obejmują dokumenty wizji; model zagrożeń ma TM-152 „dokumenty wizji” i RR-102 (prawa osób i ręczne usuwanie przed `enforce` obejmują dokumenty); lista kontrolna E15 w `docs/backlog/M2/README.md` ma nowy warunek: dokumenty na wizji w produkcji dopiero po EVM-147 i EVM-149.

**AC5 — Prawa osób i rejestr usunięć**
- Zakładając runbooki `prawa-osob.md` i `rejestr-usuniec.md`
- Gdy je uzupełniam
- Wtedy procedura praw osób (dostęp, usunięcie) wskazuje, jak znaleźć i usunąć ofertę osoby w wizji (także w wizji odrzuconej — wyjątek art. 17 z EVM-147 AC4); rejestr usunięć opisuje wpisy z identyfikatorami dokumentów; `npm run docs:check` bez błędów.
- Instrukcja dla biura (`docs/user/instrukcja-dla-biura.md`) mówi, że kopie oferty poza systemem (plik źródłowy oferty, e-mail do zamawiającego) nie znikają razem z wizją i biuro usuwa je samo (prawa osób obejmują także te kopie).

## Poza zakresem
Kod API i usuwania (EVM-147), panel (EVM-148); wydruk kart i dane spółki (poza repozytorium); zmiana okresów 90 / 14 dni; inne rodzaje dokumentów niż oferta; aplikacja mobilna jako miejsce wgrywania dokumentów.

## Decyzje i ograniczenia
- Decyzje Konrada 2026-11-20: dane zamawiającego w ofercie dozwolone z ostrzeżeniem; dokumenty usuwane z wizją; odrzucona wizja 14 dni, tylko odczyt.
- Security: H2 (klauzula 1.0 i karta A6 byłyby nieprawdziwe: `rodo.md:419`, `apps/web/src/privacy/content.ts:125`, `apps/mobile/src/privacy/content.ts`, `docs/user/karta-wizji-lokalnej.md:23`) → klauzula 1.1 przed pierwszą realną wizją z dokumentem; Medium: prawa osób i ręczne usuwanie przed `enforce` (RR-102).
- Decyzje techniczne: [ADR-0025](../../architecture/adr/0025-dokumenty-wizji-lokalnej-przed-klientem.md) (zaakceptowany 2026-11-23); RR-102 (prawa osób i ręczne usunięcie przed `enforce`) obejmuje dokumenty wizji.
- Pokrewne: do czasu wydania obowiązuje zasada „tylko wizje testowe” (decyzja 16); realne oferty dopiero po EVM-147, EVM-149 i włączonym `enforce` albo zaakceptowanym RR-102 z kartą przeglądu.

## Otwarte pytania (dla Konrada, rekomendacja pierwsza)
1. **Treść zdania klauzuli 1.1 i podstawa prawna:** propozycja „na etapie wizji możemy zapisać ofertę z Twoim imieniem i nazwiskiem” (rek.) — podstawa: działania przed zawarciem umowy na żądanie osoby (art. 6 ust. 1 lit. b RODO, do weryfikacji przez prawnika). Wymaga Twojej decyzji o treści prawnej.
2. **Data i numer wersji 1.1:** data wejścia w życie i czy wymagamy ponownego potwierdzenia przez użytkowników (rek.: tak, wg mechanizmu wersji z EVM-133). Konsekwencja: przy „nie” istniejący użytkownicy nie zobaczą zmiany.
3. **Wydruk karty A6:** czy stare wydrukowane karty wycofać (rek.: tak, przed pierwszą realną wizją z ofertą). Konsekwencja: koszt wydruku.

## Notatki
Warunek wydania łączy dwie historyjki: dokumenty na wizji w produkcji dopiero po EVM-147 i EVM-149.

## Dziennik
- 2026-11-20 — utworzono przy podziale EVM-147 na trzy historyjki (product-owner)
- 2026-11-23 — uwzględniono ADR-0025: RR-14 z odnośnikiem, instrukcja o kopiach poza systemem, RR-102 dla dokumentów, warunek `enforce` (product-owner)
