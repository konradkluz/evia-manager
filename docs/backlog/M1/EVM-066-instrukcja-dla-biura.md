---
id: EVM-066
title: Krótka instrukcja dla biura
type: story
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
owner: product-owner
contributors: [web-developer, ux-designer, devops-engineer]
reviewers: [code-reviewer, ux-designer, security-engineer]
depends_on: [EVM-025, EVM-026, EVM-027, EVM-028, EVM-033, EVM-034, EVM-035, EVM-036, EVM-041, EVM-046, EVM-048, EVM-049, EVM-050, EVM-051, EVM-063, EVM-072]
---

# EVM-066: Krótka instrukcja dla biura

## Historyjka
Jako **pracownik biura** chcę **krótkiej instrukcji krok po kroku z zasadami bezpiecznej pracy, dostępnej w panelu**, aby **zacząć prowadzić zlecenia w systemie bez szkolenia i nie popełnić błędów z danymi klientów**.

## Kontekst
- Zakres roadmapy E8: „krótka instrukcja”. SR-PRIV-10 (nie fotografujemy dokumentów tożsamości, osób ani tablic rejestracyjnych bez potrzeby; zgłaszamy utratę telefonu od razu), P3 (wyłączenie lokalizacji w aparacie telefonu przy zdjęciach z przeglądarki), P7.
- Instrukcja obejmuje zakres pilota realnego (fazy 1–4); rozdział o płatnościach dopisują historyjki E7 (punkt w ich DoD).
- **Telefon w pilocie B (BYOD):** technicy (rola Edytor) używają pełnego panelu w przeglądarce prywatnych telefonów. Kontrole aplikacji (SQLCipher, blokada ekranu, limit offline — P7, TM-01) w przeglądarce nie działają, więc zasady pracy na telefonie są w instrukcji (AC2) do czasu aplikacji M2 (przegląd `security-engineer` EVM-010; decyzje 18 i 19 w README M1).
- **Publikacja dla użytkowników:** repozytorium jest prywatne, a biuro nie ma do niego dostępu, więc instrukcja jest publikowana w panelu, a repozytorium pozostaje jej źródłem (przegląd `ux-designer` EVM-010; pomoc w stałym miejscu — WCAG 3.2.6). Odnośnik z W-19 dodaje ta historyjka (EVM-063 przygotowuje sekcję „Pomoc”).
- **Nowa lokalizacja dokumentu:** dokumentacja dla użytkowników nie ma dziś reguły w `docs/process/document-lifecycle.md` — ta historyjka dodaje regułę (np. `docs/user/**/*.md`, klasa „żywy”) razem z konfiguracją walidatora (`devops-engineer`); zmiana polityki do akceptacji Konrada.

## Kryteria akceptacji
**AC1 — Zakres instrukcji**
- Gdy pracownik biura czyta instrukcję
- Wtedy znajduje w niej: logowanie z kluczem dostępu albo kodem z aplikacji i kody odzyskiwania, nowe zlecenie z szablonu, statusy zlecenia i etapów oraz „Czekamy na…”, dziennik, zdjęcia (także z przeglądarki w telefonie), filmy i dokumenty z klasą poufności, klientów, wylogowanie — z przejściem scenariuszy A–D krok po kroku (bez płatności do E7).

**AC2 — Zasady bezpiecznej pracy (SR-PRIV-10, P3, P7)**
- Wtedy instrukcja mówi: nie fotografujemy dokumentów tożsamości, twarzy ani tablic rejestracyjnych, gdy nie jest to potrzebne; przed zdjęciami z przeglądarki w telefonie wyłączamy lokalizację w aparacie; omyłkowe zdjęcie zgłaszamy Administratorowi (trwałe usunięcie — EVM-051); utratę telefonu lub laptopa zgłaszamy od razu; nie wpisujemy PESEL, numerów dokumentów ani kodów do bram
- Oraz zasady pracy na telefonie:
  - telefon ma blokadę ekranu; po wysłaniu zdjęć wybieramy „Wyloguj”; nie logujemy się na cudzych telefonach; na telefonie nie pobieramy oryginałów zdjęć ani dokumentów;
  - przed pierwszym zdjęciem do pracy wyłączamy automatyczną kopię zdjęć i filmów w chmurze (Zdjęcia Google, OneDrive, chmura producenta telefonu) albo wykluczamy z niej folder aparatu — instrukcja pokazuje, gdzie to sprawdzić w Zdjęciach Google;
  - zdjęcia i filmy usuwamy z galerii telefonu po potwierdzeniu „Wysłano” (wariant z decyzji 18), a potem opróżniamy kosz galerii;
  - przy odejściu z firmy potwierdzamy Administratorowi usunięcie zdjęć i filmów z pracy z telefonu, kosza galerii i chmury.

**AC3 — Dane syntetyczne**
- Wtedy zrzuty ekranu i przykłady zawierają wyłącznie dane syntetyczne (Jan Przykładowy, `example.com`, `ZL-2026-…`, `FV/TEST/…`).

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
_—_

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
