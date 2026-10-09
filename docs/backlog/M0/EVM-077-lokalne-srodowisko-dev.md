---
id: EVM-077
title: Lokalne środowisko do ręcznego testu (pnpm run dev) z kontem Administratora i danymi demo
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P2
path: pelna
owner: devops-engineer
contributors: [backend-developer, web-developer]
reviewers: [code-reviewer, security-engineer]
model: sonnet
depends_on: [EVM-016, EVM-019]
---

# EVM-077: Lokalne środowisko do ręcznego testu (pnpm run dev) z kontem Administratora i danymi demo

## Cel
Jako **Konrad (właściciel produktu) i deweloper** chcę **uruchomić lokalnie jednym poleceniem panel, API (w kontenerze, zbliżonym do staging/produkcji) i PostgreSQL, zalogować się kluczem dostępu i zobaczyć ekrany z syntetycznymi danymi demo**, aby **ręcznie sprawdzać dostarczone funkcje (nowe zlecenie, szczegóły i statusy, klienci, edycja lokalizacji, dziennik audytu ze step-upem) bez ustawiania środowiska krok po kroku**. Dotyczy wyłącznie maszyny lokalnej (nie staging, nie produkcja).

## Kontekst
- Podniesiony z P3 na P2 (decyzja Konrada 2026-10-09): dziś nie ma żadnego ręcznego testu na prawdziwym stosie, a sekcje „jak sprawdzić” z dem zakładają działający stos.
- Stan dzisiejszy: korzeń `dev` = `turbo run dev` (panel: Vite na `127.0.0.1:5173` z proxy `/api`; API startowane natywnie), brak bazy dla trybu `dev`, brak seedu i danych demo. `compose.yaml` jest wyłącznie dla bramek (brak portów, sieci wewnętrzne, baza w pamięci) i zostaje bez zmian.
- Pierwszego Administratora tworzy wyłącznie procedura z EVM-016 (`bootstrap-admin`: jednorazowy link tylko na terminalu interaktywnym, hasło i klucz dostępu ustawia użytkownik — SR-AUTH-12, SR-AUTH-14). Środowisko lokalne ją **wywołuje**, nie powiela i nie omija.
- Układ (zgodny z ADR-0015): API i baza w kontenerach Docker Desktop (osobny plik `compose.dev.yaml`), panel natywnie na Windows (Vite) z proxy `/api` na ten sam origin `http://localhost:5173`.

## Kryteria akceptacji

**AC1 — Konfiguracja lokalna bez sekretów w repozytorium**
- Zakładając zainstalowane zależności i brak pliku `.env`
- Gdy uruchamiam `pnpm run dev:init`
- Wtedy powstaje `.env` z wartościami z `.env.example` i losowym, wygenerowanym `CURSOR_KEY` (32 bajty, base64url; wartość nie jest wypisywana; `.env` ignorowany przez git); gdy `.env` już istnieje, niczego nie nadpisuje i informuje o tym
- Oraz `.env.example` ma `CURSOR_KEY` pusty, nie zawiera żadnych sekretów ani domyślnych haseł poza jawnie syntetycznym hasłem lokalnej bazy dev, a każda nowa zmienna ma opis.

**AC2 — Jedno polecenie uruchamia całość**
- Zakładając wykonane `dev:init` i działający Docker Desktop
- Gdy uruchamiam `pnpm run dev` w terminalu interaktywnym
- Wtedy najpierw, na pierwszym planie i przed startem panelu, wykonuje się przygotowanie: start bazy i API z `compose.dev.yaml`, migracje, konto Administratora (AC5), dane demo (AC7); potem startuje panel, a w konsoli widać adresy (panel `http://localhost:5173`, API, baza) i jedyny wspierany adres wejścia (`localhost`, nie `127.0.0.1`); powtórne uruchomienie jest bezpieczne i nie traci danych
- Oraz gdy Docker nie działa, port jest zajęty, brakuje `.env` albo strażnik (AC4) odmawia, polecenie kończy się kodem ≠ 0 z komunikatem po polsku (nazwa problemu i poprawka, bez śladu stosu, bez wartości zmiennych) i nie zostawia częściowo uruchomionego stosu; bez terminala interaktywnego wypisuje komunikat z poleceniem do wykonania ręcznie i nie wydaje linku.

**AC3 — Zatrzymanie i czyszczenie**
- Zakładając uruchomione środowisko lokalne
- Gdy uruchamiam `pnpm run dev:stop`
- Wtedy kontenery środowiska dev są zatrzymane, a dane bazy zostają
- Oraz gdy uruchamiam `pnpm run dev:reset`, wtedy po jawnym potwierdzeniu z ostrzeżeniem, że usunięcie danych jest nieodwracalne, usuwane są wyłącznie kontenery i wolumen dev z `compose.dev.yaml` (bez potwierdzenia — odmowa i brak zmian); kontenery i wolumeny bramek (`compose.yaml`) pozostają nietknięte.

**AC4 — Wyłącznie lokalnie (strażnik)**
- Zakładając polecenie `dev`, `dev:admin`, `dev:seed` albo `dev:reset`
- Gdy strażnik sprawdza środowisko przed jakimkolwiek zapisem
- Wtedy zgoda wymaga koniunkcji wszystkich warunków: `NODE_ENV=development`; `DATABASE_URL` sparsowany jako adres URL ma host wyłącznie z listy dozwolonych (`localhost`, `127.0.0.1`, `::1` oraz nazwa usługi bazy dev w sieci kontenerów) i nie zawiera parametrów `host`/`hostaddr`; nazwa bazy `evia_dev`; `WEBAUTHN_RP_ID=localhost`; oraz znacznik w samej bazie (`evia.env='local-dev'`, ustawiany wyłącznie przez inicjalizację bazy dev z `compose.dev.yaml`, której skrypt jest montowany tylko do odczytu), sprawdzany po połączeniu, przed zapisem
- Oraz każdy brak któregokolwiek warunku daje odmowę z czytelnym komunikatem, bez zmian w bazie i bez opcji `--force`; strażnik jest czystą funkcją z testem każdej gałęzi, w tym przypadków negatywnych: tunel `localhost` do bazy o nazwie `evia`, `?host=` w adresie, inny `NODE_ENV`, brak znacznika w bazie.

**AC5 — Administrator przez procedurę EVM-016**
- Zakładając uruchomione środowisko i pustą bazę
- Gdy w terminalu interaktywnym `dev` (lub `dev:admin`) uruchamia procedurę z EVM-016 i wpisuję fikcyjny adres e-mail
- Wtedy powstaje konto Administratora ze statusem „Oczekuje na aktywację” (`invited`), a jednorazowy link z tokenem we fragmencie adresu pojawia się wyłącznie na terminalu (kontrola terminala interaktywnego powtórzona także w wejściu dev; produkcyjne polecenie nie jest osłabiane); hasło i klucz ustawia użytkownik, w repozytorium nie ma kont domyślnych ani haseł
- Oraz idempotencja: gdy Administrator jest już aktywny, nic się nie dzieje (informacja i brak zmian); gdy konto czeka na aktywację, a link wygasł, wydawany jest nowy link; bez terminala interaktywnego — odmowa z komunikatem z EVM-016, bez wydania linku.

**AC6 — Aktywacja i logowanie na localhost**
- Zakładając link z AC5 otwarty w przeglądarce biura na `http://localhost:5173`
- Gdy ustawiam hasło i rejestruję klucz dostępu (zgodnie z runbookiem aktywacji), wylogowuję się i loguję ponownie
- Wtedy aktywacja i logowanie działają bez przełączników osłabiających zabezpieczenia (origin `http://localhost:5173` i RP ID `localhost` z konfiguracji, ciasteczko `__Host-` i kontrola CSRF jak na produkcji, API dostępne tylko przez ten sam origin pod `/api`), a dziennik audytu ze step-upem (W-18) otwiera się po ponownym potwierdzeniu kluczem
- Oraz gdy panel otwarto pod innym adresem niż skonfigurowany origin (np. `http://127.0.0.1:5173`), logowanie jest odrzucone z czytelnym komunikatem, a kontrola origin nie jest osłabiana.

**AC7 — Dane demo (syntetyczne)**
- Zakładając uruchomione środowisko po migracjach i pozytywny wynik strażnika (AC4)
- Gdy przygotowanie z `dev` (lub `pnpm run dev:seed`) tworzy dane demo
- Wtedy powstają: kilku klientów (osoby i firmy), kilka lokalizacji ze stronami oraz kilka zleceń z istniejących szablonów w różnych statusach (m.in. nowe, w toku, zakończone), tak aby listy, szczegóły, klienci i „inne zlecenia w tej lokalizacji” nie były puste; dane są wyraźnie fikcyjne (adresy e-mail w domenach zarezerwowanych do testów — zgodnych z walidatorem kontraktu, bez PESEL, telefony fikcyjne, bez wysyłki SMS i e-maili w dev) i powstają przez te same reguły domeny co dane z panelu, nie przez ich obchodzenie
- Oraz powtórne uruchomienie nie tworzy duplikatów i nie rusza danych wprowadzonych ręcznie, a kod seeda leży poza artefaktem produkcyjnym (osobny katalog, wyłączony z budowy i obrazu API; reguła granic modułów zabrania importu z niego przez kod produkcyjny; test, że artefakt nie zawiera seeda).

**AC8 — Instrukcja i reguły repozytorium**
- Zakładając nowego dewelopera czytającego README
- Gdy wykonuje kroki z sekcji „Uruchomienie lokalne” (wymagania, `dev:init`, `dev`, aktywacja, adresy, `dev:stop`, `dev:reset` z ostrzeżeniem o nieodwracalności, typowe problemy)
- Wtedy dociera do działającego logowania i ekranów z danymi demo bez dodatkowej wiedzy
- Oraz `compose.dev.yaml` (baza + API; `compose.yaml` bez zmian) podlega tym samym regułom `tools/repo-policy` co `compose.yaml` (obrazy po digeście, Dockerfile przypięty digestem, utwardzenie, brak `env_file`, brak gniazda Dockera), a wyjątki są wąskie i testowane: porty wyłącznie `127.0.0.1:<port ≠ 5432>` i nazwany wolumen dev; polecenia Dockera dla tego pliku wyłącznie z listy dokładnych form (`up`, `down`, `down -v`); test negatywny dla każdego naruszenia; `pnpm run gate` i `npm run docs:check` zielone.

## Poza zakresem
- Staging, produkcja, aplikacja mobilna, Caddy/TLS, obserwowalność, uruchamianie panelu w kontenerze.
- Drugi i kolejni użytkownicy (Edytor, Tylko odczyt) — powstają przez zaproszenia (EVM-024); profil demo z kontami ról to kandydat na osobną historyjkę.
- Import danych z produkcji lub plików klientów; dane demo dla funkcji jeszcze niedostarczonych (procesy, etapy, dziennik wpisów).
- Zmiana reguł bezpieczeństwa (CSRF, CORS, ciasteczka, origin, WebAuthn, kontrola TTY) pod wygodę lokalną; przełączniki je osłabiające.

## UX / UI
Bez zmian UI. Wyjątek: jeśli `http://localhost:5173` nie działa (Vite nasłuchuje na `127.0.0.1`, a `localhost` może wskazywać `::1`), minimalna korekta konfiguracji panelu — bez zmiany ekranów.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator / Edytor / Tylko odczyt / niezalogowany | bez zmian — środowisko lokalne nie wprowadza nowych ról, endpointów ani uprawnień; API nie zyskuje endpointu „seed” ani „setup” |

- Obszar ryzyka: konto Administratora i seed w bazie. Kontrole: brak kont domyślnych i haseł w repozytorium (SR-AUTH-12, SR-AUTH-14), link wyłącznie na terminalu (SR-LOG-02), strażnik wielowarunkowy z znacznikiem w bazie (AC4), baza i API publikowane tylko na `127.0.0.1` (nie w sieci lokalnej), brak `env_file`, sekrety wyłącznie w ignorowanym `.env` (SR-INFRA-05), kod seeda poza artefaktem produkcyjnym, dane syntetyczne (P9).
- Konsultacja `security-engineer` (CHANGES REQUIRED) uwzględniona w AC1, AC2, AC4, AC5, AC7, AC8.
- Docker wyłącznie przez `docker compose -f <plik> …` (nigdy `docker run`).

## Decyzje i ograniczenia
- **2026-10-09 (Konrad) — czwarta dozwolona forma polecenia Dockera:** `docker compose -f compose.dev.yaml exec api node dist/src/cli/bootstrap-admin.js` (terminal interaktywny dla procedury EVM-016); test repo-policy wymaga dokładnie tej formy, a `run` i inne `exec` są odrzucane.
- **2026-10-09 (Konrad) — seed dwuetapowo:** dane demo powstają, gdy jest aktywny Administrator (autor); przy pierwszym `dev` (Administrator `invited`) komunikat: „dane demo pojawią się po aktywacji — uruchom ponownie `pnpm run dev` (lub `dev:seed`)”. Bez nowego aktora systemowego.
- **2026-10-09 (zaakceptowane przez Konrada) — zmiana względem pierwotnego „Poza zakresem”:** dane demo (klienci, lokalizacje, zlecenia) są w zakresie, bo bez nich ekrany są puste.
- **2026-10-09 (Konrad) — wyjątek repo-policy w wąskim kształcie:** osobny `compose.dev.yaml` (`compose.yaml` bez zmian), te same reguły utwardzenia; wyjątki wyłącznie: port `127.0.0.1:<port ≠ 5432>` i nazwany wolumen dev; lista dokładnych form poleceń `up`, `down`, `down -v` dla tego pliku.
- **2026-10-09 (Konrad) — układ:** API w kontenerze Docker Desktop w środowisku zbliżonym do staging/produkcji (obraz budowany z Dockerfile przypiętego digestem, wzorzec jak `backend-tests`, utwardzony, port tylko na `127.0.0.1`, sieć wspólna z bazą `postgres-dev`); panel Vite natywnie na Windows. Zgodne z ADR-0015, bez odstępstwa i bez nowego ADR. Korzeń `dev` nie startuje już API natywnie.
- **2026-10-09 (Konrad) — Administrator:** przez procedurę EVM-016 (`invited`, link tylko na terminalu, hasło i klucz ustawia Konrad); seed nie tworzy konta z hasłem ani klucza. Hasło bazy dev jest stałe i jawnie syntetyczne.
- Kolejność zależna od implementacji: czy dane demo wymagają istniejącego autora — rozstrzyga `backend-developer` (np. seed po aktywacji albo jawnie oznaczony aktor systemowy w audycie); do potwierdzenia z Konradem, jeśli wymaga nowego rodzaju aktora.
- Ścieżka `pelna`: infrastruktura + obszar ryzyka (konto Administratora, seed) + 3 moduły (infra/tools, API, panel/dokumentacja).

## Notatki
- Dostęp wyłącznie przez `http://localhost:5173` (nie `127.0.0.1`); API publikowane tylko na `127.0.0.1`.
- Dane demo: sprawdzić domeny e-mail akceptowane przez walidator kontraktu (`example.invalid` / `example.test`); telefony — brak puli zarezerwowanej, więc wyraźnie fikcyjne; PESEL nie występuje.
- `down -v` jest nieodwracalne — ostrzeżenie w README i przy `dev:reset`.
- Konsultacje: `security-engineer` (przegląd pliku compose dev, strażnika, seeda). `solution-architect` nie jest potrzebny (zgodność z ADR-0015).
- Kandydat do podziału, jeśli wykonawca uzna za za duże: dane demo (AC7) jako osobna historyjka.

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-077 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo (wg `reviewers`)
- [ ] Dokumentacja (README „Uruchomienie lokalne”, `.env.example`) i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (Konrad loguje się lokalnie i przegląda dane demo)

## Dziennik
- 2026-10-07 — utworzono (product-owner)
- 2026-10-09 — refinement (product-owner): priorytet P3 → P2, ścieżka `lekka` → `pelna`, 8 AC; decyzje Konrada: dane demo w zakresie, wyjątek repo-policy (`compose.dev.yaml`), API w kontenerze, Administrator przez EVM-016; uwzględniona konsultacja security-engineer (strażnik, seed poza artefaktem); status `draft`
- 2026-10-09 — draft → ready: AC i decyzje zaakceptowane przez Konrada (/refine; dane demo w zakresie, wąski wyjątek repo-policy dla compose.dev.yaml, API w kontenerze, seed po aktywacji Administratora, bez podziału)
- 2026-10-09 — ready → in-progress (/deliver; ścieżka pelna: infrastruktura, konto Administratora, seed; gałąź feature/EVM-077-local-dev)
- 2026-10-09 — plan gotowy (devops-engineer)
