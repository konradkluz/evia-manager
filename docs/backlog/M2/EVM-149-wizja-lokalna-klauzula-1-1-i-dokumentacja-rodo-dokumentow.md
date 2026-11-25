---
id: EVM-149
title: "Wizja lokalna: klauzula informacyjna 1.1 (oferta na wizji), karta A6, DPIA D14, rodo.md, model zagrożeń i prawa osób dla dokumentów wizji"
type: enabler
milestone: M2
epic: E15 Wizja lokalna
status: in-progress
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
- **Decyzje Konrada 2026-11-24:** (1) zdanie klauzuli 1.1: „na etapie wizji możemy zapisać ofertę z Twoim imieniem i nazwiskiem” (retencja jak wizji: 90 / 14 dni), podstawa art. 6 ust. 1 lit. b RODO — do weryfikacji przez prawnika przed realnymi danymi; (2) data wersji 1.1 = data scalenia EVM-149, wymagane ponowne potwierdzenie wg mechanizmu wersji z EVM-133; (3) stare wydrukowane karty A6 wycofujemy przed pierwszą realną wizją z ofertą (wydruk poza repozytorium).
- Pokrewne: do czasu wydania obowiązuje zasada „tylko wizje testowe” (decyzja 16); realne oferty dopiero po EVM-147, EVM-149 i włączonym `enforce` albo zaakceptowanym RR-102 z kartą przeglądu.

## Otwarte pytania
Brak — rozstrzygnięte przez Konrada 2026-11-24 (patrz „Decyzje i ograniczenia”). Weryfikacja podstawy prawnej przez prawnika przed pierwszą realną wizją z ofertą pozostaje warunkiem produkcji.

## Notatki
Warunek wydania łączy dwie historyjki: dokumenty na wizji w produkcji dopiero po EVM-147 i EVM-149.

- **Data wersji 1.1 (decyzja 2 — dzień scalenia):** mechanizm z EVM-133 wymaga stałej (`VALID_FROM` w `apps/web/src/privacy/content.ts`, dosłowna kopia w aplikacji). W gałęzi jest **25.11.2026** — dzień przygotowania treści, nie przewidywany dzień scalenia. Jeśli PR zostanie scalony innego dnia, ostatni commit przed scaleniem (Tech Lead) zmienia datę w czterech miejscach naraz: `VALID_FROM` w obu `content.ts`, nagłówek i stopka karty A6 (`docs/user/karta-wizji-lokalnej.md`), zdanie „Wersja bieżąca” w `rodo.md` → „Rozstrzygnięcia klauzul”. Testy `EVM-149 AC1`/`AC2` (`apps/web/test/privacy-content.test.ts`, `apps/mobile/test/privacy-help.test.tsx`) nie mają daty na sztywno — sprawdzają zgodność tych miejsc i to, że data jest późniejsza niż 19.11.2026.
- **Ponowne potwierdzenie** = mechanizm wersji z EVM-133 (system nie zbiera potwierdzeń od klientów): nowa wersja i data widoczne w panelu i aplikacji, przegląd treści i zatwierdzenie Konrada przy scaleniu PR, karta A6 w nowej wersji i zniszczenie starych wydruków; aplikacja pokaże 1.1 od następnej paczki APK (`privacyClauses.versions = 1.1`). Opis: `rodo.md` → „Klauzula 1.1 i dokumenty wizji”, pkt 3.
- **Warunek produkcji:** weryfikacja podstawy prawnej (art. 6 ust. 1 lit. b dla oferty na wizji) przez prawnika przed pierwszą realną wizją z ofertą — `rodo.md` (pkt 6), DPIA aneks v1.2 (warunek 3), lista kontrolna `wizja-lokalna.md` pkt 12, lista E15 w `docs/backlog/M2/README.md`.
- **Numer zagrożenia (AC4):** TM-152 nadała 2026-11-20 EVM-142 (podgląd zdjęć) — „dokumenty wizji” mają pierwszy wolny numer **TM-153** (zapis w nagłówku aktualizacji `threat-model.md`).
- **Ustalenie przy realizacji (Low, kandydat do backlogu):** dokument miękko usunięty („Usuń”) znika z panelu także dla Administratora, a w wizji odrzuconej nie da się go przywrócić (`409 work_order_closed`) — przed `enforce` jego pliku nie usuniemy w panelu. Mitygacja proceduralna w `retencja.md` sekcja 5 i `prawa-osob.md` (najpierw „Usuń plik trwale…”, nigdy samo „Usuń”); usuwa go zadanie w `enforce` (`documentIds` obejmuje dokumenty miękko usunięte).

## Dziennik
- 2026-11-20 — utworzono przy podziale EVM-147 na trzy historyjki (product-owner)
- 2026-11-23 — uwzględniono ADR-0025: RR-14 z odnośnikiem, instrukcja o kopiach poza systemem, RR-102 dla dokumentów, warunek `enforce` (product-owner)
- 2026-11-24 — decyzje Konrada w sprawie klauzuli 1.1, daty wersji i kart A6; status `ready`
- 2026-11-25 — start realizacji (/deliver): gałąź `feature/EVM-149-klauzula-1-1-wizja`, ścieżka `lekka`, wykonawca security-engineer (`opus`), recenzent code-reviewer
- 2026-11-25 — realizacja (security-engineer): klauzule 1.1 w panelu i aplikacji (testy `EVM-149 AC1`, `AC2`), karta A6 1.1, instrukcja dla biura, `rodo.md`, DPIA aneks v1.2, `retencja.md`, TM-153, RR-14, RR-102, SR-PRIV-04/11/12, SR-AUTHZ-13, `prawa-osob.md`, `rejestr-usuniec.md`, lista kontrolna E15; data 1.1 = 25.11.2026 do korekty przy scaleniu (Notatki); `pnpm run gate` zielona (68/68, pokrycie zmian 100%), `docs:check` 0 błędów
- 2026-11-25 — weryfikacja AC (product-owner): AC1–AC5 pokryte; odchylenia do akceptacji Konrada: TM-153 zamiast TM-152 (numer zajęty), data 1.1 = 25.11.2026 do korekty przy scaleniu, ustalenie Low (miękko usunięty dokument w wizji odrzuconej) — kandydat do backlogu; bramkę i `docs:check` ponownie uruchamia orkiestrator (brak powłoki)
- 2026-11-25 — weryfikacja implementacji (web-developer): `content.ts` w panelu i aplikacji identyczne; testy prywatności web 39/39 (Vitest), mobile 45/45 (Jest); `pnpm run gate` zielona (pokrycie zmian 6/6 linii, 4/4 gałęzi), `docs:check` 0 błędów, 0 ostrzeżeń; bez zmian w kodzie
