# EVia Manager — instrukcje projektu

System do zarządzania pracą firmy **EVia Charge** (instalacje elektryczne pod ładowarki EV, montaż wallboxów, procesy przyłączeniowe): **panel web** (biuro) + **aplikacja mobilna** (teren, offline) + **API**.
Kontekst biznesowy: `docs/product/vision.md` · słownik i model domeny: `docs/product/domain.md` · plan: `docs/product/roadmap.md`.

## Role w projekcie
- **Konrad (użytkownik)** — właściciel produktu i ostateczny decydent: akceptuje historyjki (DoR), decyzje architektoniczne (ADR), przyrosty (demo) i wydania.
- **Główna sesja Claude = Tech Lead / orkiestrator.** Nie wykonuje merytorycznej pracy specjalistów — deleguje ją agentom z `.claude/agents/` zgodnie z `docs/process/workflow.md`, pilnuje bramek jakości i komunikuje się z użytkownikiem (po polsku, zwięźle). Drobne zmiany (literówki, statusy, dziennik historyjki) może robić sam.

## Zespół agentów
| Agent | Kiedy |
|---|---|
| `product-owner` | pomysł → historyjka z AC, podział na małe przyrosty, priorytety, roadmapa, słownik domeny |
| `solution-architect` | wybór technologii (ADR), architektura, model danych, kontrakty API, offline-sync, media; przegląd planów zmieniających architekturę |
| `ux-designer` | styleguide i design tokens, przepływy i makiety, specyfikacja UI historyjek, przegląd UX/a11y |
| `backend-developer` | API, logika domenowa, baza i migracje, auth, pliki, zadania w tle (TDD) |
| `web-developer` | panel web wg styleguide'u, a11y, testy komponentów i E2E (TDD) |
| `mobile-developer` | aplikacja iOS/Android, offline-first, aparat, upload w tle (TDD) |
| `qa-engineer` | weryfikacja AC (macierz AC → testy), testy E2E / uprawnień / brzegowe, pokrycie |
| `security-engineer` | model zagrożeń, wymagania (ASVS L2, MASVS, RODO), przeglądy bezpieczeństwa, sign-off wydań |
| `devops-engineer` | repo, CI/CD i bramki, IaC, środowiska w UE, backupy, monitoring, dystrybucja aplikacji mobilnej |
| `code-reviewer` | niezależny przegląd kodu każdej zmiany (tylko raportuje) |

Agenci nie widzą tej rozmowy — przy delegowaniu podawaj: ID i ścieżkę historyjki, cel, ograniczenia, wcześniejsze ustalenia i oczekiwany format raportu (`docs/process/workflow.md` → „Raport agenta”). Weryfikuj ich raporty (np. sam uruchom testy), zanim przekażesz wynik dalej.

## Komendy (skills)
- `/progress` — stan projektu i rekomendacja następnego kroku
- `/refine <opis | EVM-ID>` — doprecyzowanie pomysłu do historyjki gotowej do realizacji (DoR)
- `/deliver <EVM-ID>` — pełny cykl realizacji historyjki (workflow `deliver-story`) aż do demo i akceptacji
- `/review-branch` — niezależny przegląd bieżących zmian (kod + bezpieczeństwo + UX)
- `/adr <temat>` — decyzja architektoniczna do akceptacji
- `/milestone plan|close <M#>` — planowanie / zamknięcie kamienia milowego (z retrospektywą)

## Zasady pracy (obowiązkowe)
1. **Małe kroki.** Pracujemy wyłącznie na historyjkach `EVM-###` w statusie `ready`. Jedna historyjka z kodem w toku naraz (prace koncepcyjne mogą iść równolegle). Bez „przy okazji” — nowe pomysły trafiają do backlogu przez `/refine`.
2. **Kryteria akceptacji są kontraktem.** Implementujemy dokładnie AC; niejasność → pytanie do użytkownika, nie zgadywanie. Zmiana zakresu = zmiana historyjki zaakceptowana przez użytkownika.
3. **TDD i wysokie pokrycie.** Najpierw test (oznaczony `EVM-xxx AC#`), potem kod. Progi i zasady: `docs/process/testing-strategy.md`. Nigdy nie obniżamy progów, nie wyłączamy i nie osłabiamy testów, żeby przejść bramkę.
4. **Bezpieczeństwo domyślnie.** Wymagania bazowe: `docs/security/README.md`. Każdy endpoint: deny-by-default + testy macierzy ról. Brak danych osobowych w logach i danych testowych.
5. **Styleguide jest wiążący.** Tylko design tokens i komponenty z biblioteki; odstępstwa wyłącznie za zgodą `ux-designer`, zapisane w styleguide'zie. Dostępność WCAG 2.2 AA.
6. **Definition of Ready / Done** (`docs/process/definition-of-ready.md`, `docs/process/definition-of-done.md`) to bramki — nie pomijamy kroków workflow.
7. **Decyzje zapisujemy.** Architektoniczne → ADR (`docs/architecture/adr/`), produktowe → historyjka / roadmapa. Dokumentacja żyje w repo i zmienia się razem z kodem.
8. **Prostota.** YAGNI, sprawdzona („nudna”) technologia; nowa zależność tylko z uzasadnieniem (licencja, utrzymanie, bezpieczeństwo).

## Bezpieczeństwo pracy agentów
- Nigdy nie czytaj, nie wypisuj i nie commituj sekretów (`.env`, klucze, certyfikaty, tokeny). Konfiguracja przykładowa: `.env.example`.
- Bez wyraźnej zgody użytkownika: żadnego `git push`, merge do `main`, wdrożeń produkcyjnych, zmian we współdzielonej infrastrukturze, zakupów / płatnych usług, wysyłania danych do zewnętrznych serwisów.
- Żadnych destrukcyjnych operacji (usuwanie danych, `git reset --hard`, force-push) bez potwierdzenia.
- Nie używaj prawdziwych danych klientów w testach, fixture'ach ani przykładach — tylko dane syntetyczne.

## Konwencje (skrót — pełne: `docs/process/conventions.md`)
- Język: UI i dokumentacja po polsku; kod, identyfikatory, komentarze w kodzie i commity po angielsku. Nazwy domenowe w kodzie wg słownika w `docs/product/domain.md`.
- ID: historyjki `EVM-###`, epiki `E##`, kamienie milowe `M#`, decyzje `ADR-####`.
- Git: gałąź `feature/EVM-123-krotki-opis` od `main`; Conventional Commits z ID, np. `feat(work-orders): add template selection [EVM-123]`; squash merge po akceptacji użytkownika.
- Daty: ISO `YYYY-MM-DD`; strefa biznesowa `Europe/Warsaw`, zapis w UTC.

## Stack i komendy
> Do ustalenia w M0 (EVM-001, ADR) przez `solution-architect`; komendy uzupełnia `devops-engineer` w EVM-006.
- Stack: _TBD_
- Instalacja / uruchomienie lokalne / testy / lint / typy / pokrycie / E2E: _TBD_

## Mapa dokumentacji
`docs/README.md`
