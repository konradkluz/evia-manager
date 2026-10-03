---
id: EVM-071
title: Makiety ekranów M1 — klienci, lokalizacja, edycja zlecenia i prywatność
type: enabler
milestone: M1
epic: E00 Fundamenty
status: ready
priority: P0
owner: ux-designer
contributors: [product-owner]
reviewers: [web-developer, security-engineer]
depends_on: [EVM-014]
---

# EVM-071: Makiety ekranów M1 — klienci, lokalizacja, edycja zlecenia i prywatność

## Historyjka
Jako **zespół wykonawców epików E2, E3, E4, E7 i E8** chcemy **makiet ekranów i dialogów, które w EVM-004 zostały „bez makiety”**, aby **historyjki edycji zlecenia, klientów i prywatności miały jednoznaczną specyfikację UI**.

## Kontekst
- `docs/ux/flows/README.md` → „Ekrany”: W-14 (Klienci), W-19 (Prywatność i pomoc), W-20 (Edycja lokalizacji i strony) — bez makiety; W-06 — „Edytuj dane zlecenia”, „Edytuj zakres”, dodanie i usunięcie procesu lub etapu oraz dialog „Dodaj transzę” bez makiety (luka L7, PO-1).
- Kandydaci z EVM-004 (decyzja 5 i 8): edycja lokalizacji i strony (P1), edycja zakresu (P1), filtr „Do wystawienia” (P2); uwaga PO-6 (lokalizacja w kolumnie „Klient” na W-10).
- W-09 ma makietę tylko dla panelu na komputerze; wysyłanie z przeglądarki w telefonie zastępuje w UAT M1 kroki terenowe A6, B10 i C9, więc potrzebuje makiety w szerokości `breakpoint.compact` (przegląd `ux-designer` EVM-010; decyzja 18).
- Historyjki korzystające: EVM-035, EVM-036, EVM-039, EVM-041, EVM-042, EVM-044, EVM-046, EVM-050, EVM-053, EVM-059, EVM-063, EVM-066, EVM-072.

## Kryteria akceptacji
**AC1 — W-14 „Klienci”**
- Zakładając rolę Administrator, Edytor albo Tylko odczyt
- Gdy czytam makietę W-14
- Wtedy obejmuje listę (wyszukiwanie przez `POST …/search`, sortowanie wg polskiego alfabetu, paginacja), szczegóły klienta (dane, „Historia zleceń”, „Dokumenty klienta”), edycję w dialogu (pola jak „Dodaj klienta” z W-05), usunięcie i przywrócenie (Administrator) oraz anonimizację (Administrator ze step-upem, dialog nieodwracalny); dla Tylko odczyt — podgląd bez akcji.

**AC2 — W-20 „Edycja lokalizacji i strony”**
- Zakładając kartę „Lokalizacja” w W-06 i baner zlecenia z telefonu
- Gdy czytam makietę dialogu W-20
- Wtedy ma pola sekcji „2. Lokalizacja” z W-05 wypełnione bieżącymi danymi, informację „Zmiana dotyczy wszystkich zleceń w tej lokalizacji (n).”, „Edytuj stronę” z informacją o stronie wspólnej i „Dodaj stronę” bez dialogu na dialogu, z obsługą `412`.

**AC3 — W-06 „Edytuj dane zlecenia” i zlecenie zamknięte**
- Gdy czytam makietę dialogu edycji danych zlecenia (tytuł, opis, opiekun, planowana data)
- Wtedy makieta pokazuje też stan zlecenia „Rozliczone” / „Anulowane”, w którym edycja danych zlecenia, zakresu, procesów i płatności jest niedostępna z podpowiedzią (decyzja 17 w README M1), a wpisy, media i dokumenty — dostępne.

**AC4 — W-06 „Edytuj zakres”, procesy, etapy i transze**
- Gdy czytam makietę edycji zakresu
- Wtedy obejmuje dodanie pozycji z katalogu z propozycją procesów wnoszonych przez pozycję (bez duplikatów), usunięcie pozycji (procesy zostają — z informacją, gdzie je usunąć), edycję parametrów technicznych wg zestawu parametrów oraz pozycję „Inna usługa” z opisem (wariant A z EVM-002: brak gotowego zasilania)
- Oraz makiety dodania i usunięcia procesu lub etapu oraz dialogi „Dodaj transzę” i „Zmień kwotę” (transza „Planowana”) mają tabelę stanów i ról, a usunięcie etapu zaleca „Nie dotyczy” jako zachowujące historię.

**AC5 — W-09 w przeglądarce telefonu (`breakpoint.compact`)**
- Zakładając Edytora wysyłającego zdjęcia i filmy z przeglądarki prywatnego telefonu z Androidem (M1 — przejściowo do aplikacji M2; EVM-044, EVM-046)
- Gdy czytam makietę W-09 w szerokości `breakpoint.compact`
- Wtedy obejmuje: wybór źródła („Wybierz z galerii” / „Zrób zdjęcie” wg decyzji 18), cele dotyku ≥ `size.touch-target.min`, status przy każdym pliku, potwierdzenie „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”, stan po powrocie do karty po blokadzie ekranu albo wyładowaniu karty („Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.”), ostrzeżenie przed wysłaniem dużego filmu przez sieć komórkową z progiem rozmiaru, stany offline i `429` oraz formy bezosobowe w mikrocopy.

**AC6 — W-19 „Prywatność i pomoc”**
- Gdy czytam makietę W-19
- Wtedy obejmuje klauzule informacyjne (miejsce na treść od `security-engineer`, wersja i data), pomoc (odnośnik do instrukcji dla biura opublikowanej w panelu — strona treści w układzie W-19, EVM-066 — i kontakt do Administratora) w stałym miejscu (WCAG 3.2.6), wejście z menu konta i ze stopki W-01 przed zalogowaniem.

**AC7 — Uzupełnienia list**
- Wtedy W-10 ma lokalizację (miasto, ulica) pod nazwą klienta (PO-6) i filtry „Więcej filtrów” (typ obiektu, szablon), a W-11 — chip „Do wystawienia” (transze „Planowane”) z akcją „Wystaw fakturę”.

**AC8 — Spójność i jakość**
- Wtedy wszystkie makiety używają wyłącznie komponentów i tokenów styleguide'u 1.2.0, mapa nawigacji i macierz ekran × rola są zaktualizowane, dane są syntetyczne, a `npm run docs:check` kończy się wynikiem 0 błędów.

## Poza zakresem
- Ekrany E1 — EVM-015. Pełna historia lokalizacji (M3). Przypisanie techników (M2). Edytor katalogu i szablonów (M4).

## UX / UI
Ekrany W-14, W-19, W-20 i rozszerzenia W-06, W-09 (`breakpoint.compact` — przeglądarka w telefonie), W-10, W-11; każdy z tabelą 5 stanów i tabelą ról.

## Bezpieczeństwo i prywatność
| Rola | Dostęp (w makietach) |
|---|---|
| Administrator | wszystkie akcje; usunięcie i anonimizacja klienta (anonimizacja — step-up) |
| Edytor | edycja klientów, lokalizacji, stron, zlecenia, zakresu i transz „Planowanych”; wysyłanie zdjęć i filmów z przeglądarki w telefonie (W-09 compact) |
| Tylko odczyt | podgląd bez akcji |
| Niezalogowany | tylko W-19 (z W-01) |

Odwołania: SR-AUTHZ-03 (licznik „n zleceń” tą samą polityką), SR-AUTHZ-08 (bez danych innych klientów), SR-DATA-02 (ostrzeżenia przy notatkach), SR-PRIV-05 (klauzule), SR-WEB-05 (stan niewysłanych plików z serwera, nie z pamięci przeglądarki), P3 i P7 (telefon prywatny — decyzje 18 i 19). Przegląd `security-engineer` obowiązkowy.

## Notatki techniczne
Bez kodu.

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC8 spełnione (weryfikacja QA przez inspekcję)
- [ ] Przeglądy: web-developer, security-engineer — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; wydzielona z EVM-015 planu wstępnego)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): AC4 i AC5 połączone (W-06), nowe AC5 — makieta W-09 w przeglądarce telefonu
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
