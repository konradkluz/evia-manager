---
id: EVM-133
title: Klauzule prywatności w wersji ostatecznej (panel i aplikacja) — odblokowanie podpisu APK
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: ready
priority: P0
path: lekka             # zmiana treści statycznej (bez nowych endpointów, danych i komponentów); ryzyko prawne ogranicza obowiązkowy przegląd agenta prawnego, nie liczba recenzentów kodu
owner: web-developer    # jeden wykonawca dla obu plików `content.ts` (zwykła edycja stałych i testów; wspólna treść)
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-063, EVM-102]
---

# EVM-133: Klauzule prywatności w wersji ostatecznej (panel i aplikacja)

## Cel
Jako **Konrad (właściciel produktu)** chcę **ostatecznych klauzul prywatności w panelu i w aplikacji**, aby **móc podpisać pierwszy APK do testu terenowego (EVM-112) i spełnić warunek startu realnych danych (`rodo.md` → „Checklista przed produkcją” pkt 9)**. Dziś `tools/mobile-apk sign` odrzuca paczkę (EVM-102 AC6), bo klauzule są projektem (`DRAFT`, znaczniki `[DO UZUPEŁNIENIA]` i `[PRAWNIK/IOD]`), a klauzula dla pracowników mówi, że aplikacja jest „planowana na późniejszy etap” (checklista wydania S8).

Wejście: propozycje rozstrzygnięć 7 punktów `[PRAWNIK/IOD]` i akapit o aplikacji mobilnej — `.scratch/EVM-133/legal-review.md` (agent prawny, RR-95). Treść zatwierdza Konrad.

## Kryteria akceptacji

**AC1 — Dane administratora i kontakt, jedna treść w panelu i aplikacji**
- Zakładając dane podane przez Konrada (sekcja „Pytania do Konrada”)
- Gdy otwieram „Prywatność i pomoc” w panelu (W-19) i w aplikacji (M-11)
- Wtedy obie klauzule pokazują te same dane administratora (nazwa, forma prawna, numery rejestrowe, adres, kontakt w sprawach danych osobowych) i ten sam adres kontaktowy; test zgodności `apps/web` ↔ `apps/mobile` (treść, wersja, data) jest zielony (istniejący test rozszerzyć albo dodać); w kodzie nie ma przykładowych danych prawdziwych firm.

**AC2 — Wersja ostateczna bez znaczników**
- Zakładając pliki `content.ts` w panelu i w aplikacji
- Gdy sprawdzam stan i treść pokazywaną użytkownikowi
- Wtedy `DRAFT = false`, wersja `1.0`, data obowiązywania uzupełniona, a w treści nie ma żadnego znacznika `[DO UZUPEŁNIENIA]` ani `[PRAWNIK/IOD]`; testy dziś wymagające znacznika w stanie projektu (`apps/web/test/privacy-content.test.ts`) sprawdzają stan „final”.

**AC3 — Każdy z 7 punktów rozstrzygnięty albo świadomie usunięty**
- Zakładając 7 miejsc `[PRAWNIK/IOD]` w treści klauzul
- Gdy przeglądam treść i `docs/security/rodo.md`
- Wtedy każde miejsce ma rozstrzygnięty zapis w klauzuli albo zostało usunięte, a uzasadnienie (wariant wybrany przez agenta prawnego, zatwierdzony przez Konrada) jest w `rodo.md`; punkty `[PRAWNIK/IOD]` niedotyczące treści klauzul zostają bez zmian.

**AC4 — Klauzula dla pracowników opisuje aplikację mobilną (S8)**
- Zakładając klauzulę dla pracowników i współpracowników
- Gdy ją czytam
- Wtedy zamiast „planowana na późniejszy etap” opisuje przetwarzanie w aplikacji: dane na urządzeniu, lokalną zaszyfrowaną bazę, kolejkę offline, media (zdjęcia i filmy bez dźwięku, bez uprawnienia do mikrofonu), cele, podstawy, okresy i adres do zgłoszenia utraty telefonu; test w panelu, który dziś potwierdza „późniejszy etap”, jest zaktualizowany.

**AC5 — Podpis paczki przestaje być blokowany klauzulami**
- Zakładając klauzule w stanie „final”
- Gdy uruchamiam `tools/mobile-apk sign` (test narzędzia)
- Wtedy podpis nie jest odrzucany z powodu klauzul; paczka z `DRAFT` albo ze znacznikiem nadal jest odrzucana (testy obu stanów), a `verify` w CI pozostaje zielony.

**AC6 — Ekrany pokazują wersję i datę; dokumenty zaktualizowane**
- Zakładając ostateczne klauzule
- Gdy otwieram W-19 i M-11 (także offline, przy czcionce 200%)
- Wtedy każda klauzula pokazuje wersję `1.0` i datę obowiązywania bez zmian komponentów i układu (istniejące testy stanów i dostępności zielone); `rodo.md` (pkt 9 checklisty, tabela punktów do konsultacji) i `checklista-wydania.md` (S8) mają status „zamknięte” z datą i odwołaniem do EVM-133.

## Poza zakresem
Pozostałe punkty `[PRAWNIK/IOD]` w `rodo.md` niedotyczące treści klauzul; wzory dokumentów dla pracowników (regulamin BYOD itp.); DPIA (osobny akapit dla testu — EVM-112); zmiany komponentów i makiet W-19 / M-11; zmiana mechanizmu bramki w `tools/mobile-apk`.

## Decyzje i ograniczenia
- RR-95: bez prawnika i IOD — przegląd agenta prawnego (rola radcy od RODO) jest obowiązkowy przed akceptacją treści i wchodzi do DoD; wariant bezpieczny wybiera Tech Lead „z delegacji”; **treść zatwierdza Konrad**.
- Scalenie = wdrożenie panelu z ostatecznymi klauzulami na jedynym środowisku (produkcja); nie wpisujemy danych, których Konrad nie podał — brak danych = historyjka `blocked`.
- **Wersja aplikacji 1.0.0 (decyzja Konrada 2026-11-19, „zgoda na wersje 1.0.0”):** `APP_VERSION` w `apps/mobile/plugins/expo-config.ts` podniesiona z 0.1.0 do 1.0.0 w gałęzi tej historyjki — produkcja wymaga wersji co najmniej 1.0.0 (`MIN_SUPPORTED_APP_VERSION_ANDROID`), więc paczka 0.1.0 pokazywała „Aktualizacja wymagana”; bez zmiany konfiguracji serwera.
- Blokuje EVM-112 (AC2: podpisany APK do testu terenowego). Wersja ostateczna to 1.0; późniejsze zmiany treści = nowa wersja i data.
- Ścieżka `lekka`: brak nowych endpointów, danych i komponentów; jeden wykonawca zmienia oba pliki, `security-engineer` recenzuje zgodność z SR-PRIV-05 / SR-MOB-12; przegląd prawny w DoD (nie jako recenzent kodu).

## Pytania do Konrada
**Odpowiedzi (Konrad, 2026-11-19; historyjka `ready`):**
1. **Dane administratora** (podane przez Konrada, potwierdzone z odpisem pełnym KRS z 2026-11-19 — publiczne API Ministerstwa Sprawiedliwości, za zgodą Konrada): Electroplus Realty spółka z ograniczoną odpowiedzialnością, Aleja „Solidarności” 68 / 121, 00-240 Warszawa; KRS 0001109597, Sąd Rejonowy dla m.st. Warszawy w Warszawie, XII Wydział Gospodarczy Krajowego Rejestru Sądowego; NIP 5253005645; REGON 528831324; kapitał zakładowy 5 000 zł. **Marka:** w klauzuli dopisujemy, że spółka działa pod marką EVia Charge (decyzja Konrada).
2. **Kontakt w sprawach danych osobowych:** `kontakt@electroplus.io` (skrzynka funkcyjna) albo listownie na adres siedziby z dopiskiem „Dane osobowe”; inspektor ochrony danych nie jest wyznaczony.
3. **Adres pomocy (`CONTACT_EMAIL`):** ta sama skrzynka (z delegacji Konrada — wariant rekomendowany); numer telefonu biura niepodany → nie pokazujemy.
4. **Data obowiązywania:** dzień scalenia PR (z delegacji — wariant rekomendowany).
5. **Treść:** rozstrzygnięcia A1–A8, akapit B i ustalenia C z `legal-review.md` w wariancie bezpiecznym wybiera Tech Lead z delegacji Konrada (RR-95); punkt kontrolny Konrada = scalenie PR.

Pytania pierwotne:
Warunek `ready`; bez nich nie wpisujemy niczego do kodu.
1. **Dane administratora:** pełna nazwa spółki, forma prawna, KRS, NIP, REGON, adres siedziby (jak w rejestrze).
2. **Kontakt w sprawach danych osobowych:** adres e-mail **funkcyjny** (np. skrzynka „dane osobowe” w domenie firmy), nie imienny — rekomendacja: nie zależy od jednej osoby, przeżyje zmianę składu i nie ujawnia osoby w klauzuli publicznej.
3. **Adres pomocy / zgłoszeń utraty telefonu (`CONTACT_EMAIL`):** ten sam co w pkt 2 (rekomendacja: jedna skrzynka, mniej do pilnowania) czy osobny? Numer telefonu biura — tylko jeśli ma być pokazany (opcjonalny).
4. **Data obowiązywania klauzul:** rekomendacja: dzień scalenia PR (wtedy nie ma rozjazdu z wdrożeniem); alternatywa: data stała podana z góry.
5. **Zatwierdzenie treści** z `legal-review.md` (7 rozstrzygnięć + akapit o aplikacji) — po przeglądzie, przed `ready` albo przed scaleniem.

## Notatki
- Zgodność treści web ↔ mobile: sprawdzić, czy istniejący test (`apps/mobile/test/privacy-help.test.tsx`) porównuje treść, wersję i datę; jeśli nie — dopisać w AC1.
- `apps/mobile/plugins/expo-config.ts` zawiera odwołanie do znaczników — sprawdzić przy realizacji, czy wymaga zmiany.

## Dziennik
- 2026-11-16 — utworzono jako draft (product-owner); wejście: `.scratch/EVM-133/legal-review.md` (agent prawny)
- 2026-11-19 — wersja aplikacji podniesiona do 1.0.0 (decyzja Konrada 2026-11-19); status bez zmian — czeka na dane spółki (Tech Lead)
- 2026-11-19 — Konrad podał dane spółki i adres kontaktowy, zgodził się na sprawdzenie sądu rejestrowego w publicznym KRS i na dopisanie marki; pozostałe punkty z delegacji (RR-95); status `ready` (Tech Lead)
