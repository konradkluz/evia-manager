---
id: EVM-066
title: Krótka instrukcja dla biura
type: story
milestone: M1
epic: E8 Gotowość produkcyjna
status: in-review
priority: P1
path: lekka
owner: product-owner
contributors: [web-developer, devops-engineer]
reviewers: [ux-designer]
model: sonnet
depends_on: [EVM-025, EVM-026, EVM-027, EVM-028, EVM-033, EVM-034, EVM-035, EVM-036, EVM-041, EVM-046, EVM-048, EVM-049, EVM-050, EVM-051, EVM-063, EVM-072]
---

# EVM-066: Krótka instrukcja dla biura

## Historyjka
Jako **pracownik biura** chcę **krótkiej instrukcji krok po kroku z zasadami bezpiecznej pracy, dostępnej w panelu**, aby **zacząć prowadzić zlecenia w systemie bez szkolenia i nie popełnić błędów z danymi klientów**.

## Kontekst
- Zakres roadmapy E8: „krótka instrukcja”. SR-PRIV-10 (nie fotografujemy dokumentów tożsamości, osób ani tablic rejestracyjnych bez potrzeby; zgłaszamy utratę telefonu od razu), P3 (wyłączenie lokalizacji w aparacie telefonu przy zdjęciach z przeglądarki), P7.
- **Stan 2026-11-13:** jedno środowisko pod `https://panel.eviacharge.pl` (rzeczywiste dane; biuro zapraszane e-mailem; zasady kluczy dostępu i MFA jak w AC1). Instrukcja opisuje tylko to środowisko — bez podziału staging / produkcja i bez odniesień do pilota; adres panelu podajemy w niej wprost (z konfiguracji, nie z localhost).
- Instrukcja obejmuje zakres użycia realnego (fazy 1–4); rozdział o płatnościach dopisują historyjki E7 (punkt w ich DoD).
- **Telefon w pilocie B (BYOD):** technicy (rola Edytor) używają pełnego panelu w przeglądarce prywatnych telefonów. Kontrole aplikacji (SQLCipher, blokada ekranu, limit offline — P7, TM-01) w przeglądarce nie działają, więc zasady pracy na telefonie są w instrukcji (AC2) do czasu aplikacji M2 (przegląd `security-engineer` EVM-010; decyzje 18 i 19 w README M1).
- **Publikacja dla użytkowników:** repozytorium jest prywatne, a biuro nie ma do niego dostępu, więc instrukcja jest publikowana w panelu, a repozytorium pozostaje jej źródłem (przegląd `ux-designer` EVM-010; pomoc w stałym miejscu — WCAG 3.2.6). Odnośnik z W-19 dodaje ta historyjka (EVM-063 przygotowuje sekcję „Pomoc”).
- **Nowa lokalizacja dokumentu:** dokumentacja dla użytkowników nie ma dziś reguły w `docs/process/document-lifecycle.md` — ta historyjka dodaje regułę (np. `docs/user/**/*.md`, klasa „żywy”) razem z konfiguracją walidatora (`devops-engineer`); zmiana polityki do akceptacji Konrada.

## Kryteria akceptacji
**AC1 — Zakres instrukcji**
- Gdy pracownik biura czyta instrukcję
- Wtedy znajduje w niej: adres panelu i pierwsze wejście z zaproszenia e-mail, logowanie z kluczem dostępu albo kodem z aplikacji i kody odzyskiwania, nowe zlecenie z szablonu, statusy zlecenia i etapów oraz „Czekamy na…”, dziennik, zdjęcia (także z przeglądarki w telefonie), filmy i dokumenty z klasą poufności, klientów, wylogowanie — z przejściem scenariuszy A–D krok po kroku (bez płatności do E7).

**AC2 — Zasady bezpiecznej pracy (SR-PRIV-10, P3, P7)**
- Wtedy instrukcja mówi: nie fotografujemy dokumentów tożsamości, twarzy ani tablic rejestracyjnych, gdy nie jest to potrzebne; przed zdjęciami z przeglądarki w telefonie wyłączamy lokalizację w aparacie; omyłkowe zdjęcie zgłaszamy Administratorowi (trwałe usunięcie — EVM-051); utratę telefonu lub laptopa zgłaszamy od razu; nie wpisujemy PESEL, numerów dokumentów ani kodów do bram
- Oraz zasady pracy na telefonie:
  - telefon ma blokadę ekranu; po wysłaniu zdjęć wybieramy „Wyloguj”; nie logujemy się na cudzych telefonach; na telefonie nie pobieramy oryginałów zdjęć ani dokumentów;
  - przed pierwszym zdjęciem do pracy wyłączamy automatyczną kopię zdjęć i filmów w chmurze (Zdjęcia Google, OneDrive, chmura producenta telefonu) albo wykluczamy z niej folder aparatu — instrukcja pokazuje, gdzie to sprawdzić w Zdjęciach Google;
  - zdjęcia i filmy usuwamy z galerii telefonu po potwierdzeniu „Wysłano” (wariant z decyzji 18), a potem opróżniamy kosz galerii;
  - przy odejściu z firmy potwierdzamy Administratorowi usunięcie zdjęć i filmów z pracy z telefonu, kosza galerii i chmury.

**AC3 — Dane syntetyczne**
- Wtedy zrzuty ekranu i przykłady zawierają wyłącznie dane syntetyczne (Jan Przykładowy, `example.com`, `ZL-2026-…`, `FV/TEST/…`), wykonane wyłącznie w lokalnym środowisku deweloperskim — agenci nie logują się do rzeczywistego środowiska (RR-93).

**AC4 — Język i spójność**
- Wtedy instrukcja jest napisana prostym językiem, nazwy przycisków i komunikatów są zgodne z panelem (mikrocopy ze styleguide'u), a treść ma przegląd `ux-designer`.

**AC5 — Polityka dokumentów**
- Wtedy `document-lifecycle.md` ma nową regułę lokalizacji dokumentacji dla użytkowników, konfiguracja walidatora jest zgodna (test spójności zielony), a `npm run docs:check` kończy się wynikiem 0 błędów.

**AC6 — Instrukcja w panelu (SR-WEB-07, SR-AUTHZ-05)**
- Zakładając instrukcję w repozytorium (jedyne źródło treści)
- Gdy użytkownik dowolnej roli albo niezalogowany (z W-01 → „Prywatność · Pomoc”) wybiera w W-19 → „Pomoc” odnośnik „Instrukcja dla biura”
- Wtedy instrukcja otwiera się w panelu jako strona z własnego originu — bez zewnętrznych skryptów, fontów i CDN, zgodnie z CSP (P11) — z nagłówkami w hierarchii, spisem treści i tytułem karty „Instrukcja dla biura · EVia Manager”; offline — „Treść wymaga połączenia.” (chyba że jest w pamięci karty)
- Oraz treść w panelu powstaje ze źródła w repozytorium przy budowaniu panelu (bez ręcznego kopiowania — test: zmiana w źródle widoczna po kolejnym wdrożeniu), nie zawiera danych osobowych ani szczegółów konfiguracji bezpieczeństwa (adresy serwerów, procedury Administratora z runbooków).

## Poza zakresem
- Instrukcja aplikacji mobilnej — M2. Materiały wideo, szkolenia — poza zakresem.
- Runbooki Administratora (`docs/ops/runbooks/`) — nie są publikowane w panelu.
- Wersja PDF instrukcji — poza zakresem (strona w panelu jest dostępna i przeszukiwalna).

## UX / UI
- Strona treści „Instrukcja dla biura” w panelu (ten sam układ i mechanizm treści statycznej co W-19 z EVM-063: nagłówki, spis treści, zrzuty ekranu z danymi syntetycznymi i tekstem alternatywnym); odnośnik w W-19 → „Pomoc”.
- Stany: ładowanie — Skeleton tekstu; offline — AC6; pusty i brak uprawnień — nie dotyczy (treść dostępna dla wszystkich).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt |
| Edytor | odczyt |
| Tylko odczyt | odczyt |
| Niezalogowany | odczyt (z W-19 przed zalogowaniem — pomoc przy logowaniu; treść bez danych osobowych i bez szczegółów konfiguracji bezpieczeństwa) |

- W AC: SR-PRIV-10, SR-WEB-07, SR-AUTHZ-05. Polityki P3, P7, P11.
- Zasady pracy na telefonie (AC2) są kontrolą kompensującą dla panelu w przeglądarce prywatnych telefonów — nowe RR w `threat-model.md` (EVM-065 AC4), decyzja 19. W wariancie „galeria” (decyzja 18) zasada o wyłączonej automatycznej kopii w chmurze i opróżnianiu kosza zastępuje SR-MOB-02 (brak zapisu do galerii — dopiero w aplikacji M2); bez niej zdjęcia klientów trafiają na prywatne konta w chmurze poza umowami powierzenia (TM-04, TA-3, art. 28 i 32 RODO).

## Notatki techniczne
- `product-owner` — treść instrukcji; `web-developer` — strona w panelu ze źródła w repozytorium i odnośnik w W-19 (ten sam mechanizm treści statycznej co EVM-063); `devops-engineer` — reguła walidatora (`tools/docs-lifecycle/lifecycle.config.json`) i testy narzędzi (`npm run test:tools`).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- 2026-11-14 — źródło instrukcji: `docs/user/instrukcja-dla-biura.md` (klasa „żywy”, reguła walidatora dodawana w tej historyjce) — do potwierdzenia rano.
- 2026-11-14 — zrzutów ekranu nie ma (noc, brak MCP playwright): instrukcja tekstowa krok po kroku; zrzuty z testów E2E na danych syntetycznych do uzupełnienia po demo — do potwierdzenia rano.
- 2026-11-14 — klasy poufności dokumentów opisane wg etykiet panelu (`document-labels.ts`): „Bezpieczeństwo budynku” i „Dane identyfikacyjne” pobierają tylko Administrator i Edytor — do potwierdzenia rano.
- 2026-11-14 — strona instrukcji pod adresem `/guide` (otwarta jak W-19: z sesją i bez); w kontekście budowy obrazu `evia-web` dozwolony wyłącznie katalog `docs/user` (reguła `repo-policy` zawężona do `docs(?!/user$)`) — do potwierdzenia rano.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC5 spełnione (weryfikacja QA przez inspekcję); AC6 pokryte testami (`EVM-066 AC6`)
- [ ] `npm run docs:check` i `npm run test:tools` zielone; bramki CI zielone
- [ ] Przeglądy: code-reviewer, ux-designer, security-engineer — APPROVE
- [ ] `CHANGELOG.md` zaktualizowany
- [ ] Akceptacja Konrada (także zmiany polityki dokumentów)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer, security-engineer): AC6 — instrukcja opublikowana w panelu z odnośnikiem z W-19 (przeniesiony z EVM-063 AC3), zależność od EVM-063; AC2 — zasady pracy na telefonie (BYOD); `web-developer` i `code-reviewer` w zespole historyjki
- 2026-10-03 — poprawki z przeglądu EVM-010, runda 2 (security-engineer): AC2 — wyłączenie automatycznej kopii zdjęć w chmurze, opróżnianie kosza galerii, potwierdzenie usunięcia przy odejściu z firmy (warunek rekomendacji „galeria” w decyzji 18)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-11-13 — dostosowanie do jednego środowiska `panel.eviacharge.pl` (product-owner): `path: lekka`, jeden recenzent `ux-designer`, `model: sonnet`; AC1 — adres i zaproszenie e-mail; AC3 — zrzuty tylko z lokalnego środowiska (RR-93). Recenzje `code-reviewer` i `security-engineer` zdjęte (treść bez kodu; wyjątek: zmiana polityki dokumentów w AC5 zatwierdza Konrad)
- 2026-11-13 — decyzja Konrada: przegląd tylko `ux-designer` (ścieżka `lekka`); w nocnej kolejce `/noc-2026-11-13` (tor B po EVM-126) (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-13` (Tech Lead): status `in-progress`, gałąź `feature/EVM-126-066-testy-i-instrukcja`
- 2026-11-14 — treść instrukcji napisana (product-owner): `docs/user/instrukcja-dla-biura.md`, nazwy z kodu panelu; bez zrzutów ekranu; strona w panelu, odnośnik W-19, reguła walidatora i testy — web-developer / devops-engineer
- 2026-11-14 — poprawki treści po przeglądzie UX: kroki scenariuszy A–D, kontakt w Pomocy (product-owner)
- 2026-11-14 — strona `/guide` w panelu budowana z `docs/user/instrukcja-dla-biura.md` (`?raw` + własny czytnik podzbioru Markdown, bez nowej zależności), odnośnik w W-19 → „Pomoc”, testy `EVM-066 AC6`, minimalna reguła walidatora `docs/user/**/*.md` (żywy), `!docs/user` w kontekście obrazu web, CHANGELOG (web-developer); reguła i testy narzędzi do dopracowania przez devops-engineer

- 2026-11-14 — bramka lokalna zielona (gate, test:tools, docs:check 0 błędów); zrzutów ekranu brak (do uzupełnienia po demo); do sprawdzenia w CI: e2e-web i gate:deploy (kontekst obrazu web z docs/user)
- 2026-11-14 — reguła docs/user (żywy) potwierdzona testem config; wyjątek `!docs/user` w repo-policy zawężony do obrazu web (api nadal bez docs/); `pnpm run gate` i `npm run test:tools` zielone, docs:check 0 błędów (devops-engineer)
- 2026-11-14 — poprawka E2E w kontenerze Linux (devops-engineer): `docs/user` zamontowany tylko w `web-e2e-linux` (tylko do odczytu); zmiana w `docs/user/**` uruchamia e2e-web i publikację obrazów (filtr `changes`), testy `EVM-066 AC6`
- 2026-11-14 — workflow `deliver-story` (lekka) `passed`, ux-designer: approve (uwagi minor). Po przeglądzie: kroki scenariuszy A–D i zdanie o braku kontaktu w „Pomocy” (product-owner). Końcowe sprawdzenie orkiestratora wykryło czerwony `web-e2e-linux` (kontener nie widział `docs/user`) — poprawka devops-engineer (montowanie `docs/user` tylko w `web-e2e-linux`; `docs/user/**` jako wejście budowy panelu w filtrze zmian CI: uruchamia `e2e-web` w PR i publikację na `main`). Wyniki: `pnpm run gate` zielona (pokrycie zmienionego kodu 100% linii i gałęzi), `gate:deploy` zielona, `web-e2e-linux` 1291 passed, 0 failed, 2 flaky na Firefoksie (EVM-067 AC6, EVM-035 AC5 — przeszły przy ponowieniu), `test:tools` 761 pass. Bez zrzutów ekranu (do uzupełnienia po demo). Do akceptacji Konrada także zmiana polityki dokumentów (reguła 16: `docs/user/**/*.md`, „żywy”). Koszt: 6 agentów, ok. 447 tys. tokenów, ok. 50 min. Status `in-review` (Tech Lead, kolejka nocna)
