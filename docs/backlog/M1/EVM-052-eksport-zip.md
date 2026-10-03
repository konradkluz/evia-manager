---
id: EVM-052
title: Eksport ZIP zdjęć zlecenia (step-up)
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: ready
priority: P2
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024, EVM-045]
---

# EVM-052: Eksport ZIP zdjęć zlecenia (step-up)

## Historyjka
Jako **pracownik biura** chcę **pobrać wszystkie zdjęcia zlecenia jednym plikiem ZIP**, aby **przekazać komplet dokumentacji zdjęciowej np. na potrzeby odbioru — w kontrolowany sposób**.

## Kontekst
- ADR-0009, P10 i SR-FILE-09: eksport ZIP mediów — Administrator i Edytor po step-upie, zadanie w tle, 1 eksport / 10 min i maks. 5 / dzień / użytkownika, ≤ 10 GB, plik 24 h, link jednorazowy, audyt i e-mail do wszystkich Administratorów; Tylko odczyt — nie (P6).
- Priorytet P2: scenariusze A–D nie wymagają eksportu (decyzja 11). E-mail — zależność od EVM-024.
- Nowa operacja wrażliwa (masowe pobranie oryginałów z GPS): na prod najwcześniej z sign-off EVM-070 albo po osobnym przeglądzie `security-engineer` (README M1 → „Punkt pilota” → „Wdrożenia prod w trakcie pilota B”).
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — „Eksportuj zdjęcia (ZIP)”, [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Eksport**
- Zakładając zlecenie z 48 zdjęciami w stanie `ready`
- Gdy Edytor wybiera „Eksportuj zdjęcia (ZIP)” i potwierdza tożsamość w W-04
- Wtedy zadanie w tle przygotowuje plik (W-09: „Przygotowujemy plik ZIP. Link pokażemy tutaj, gdy będzie gotowy — będzie ważny 24 godziny i zadziała raz.”), a gotowy eksport można pobrać jeden raz; pliki w kwarantannie i niegotowe nie trafiają do ZIP.

**AC2 — Limity (SR-FILE-09, P10)**
- Zakładając eksport sprzed 5 min albo 5 eksportów dzisiaj, albo zlecenie z mediami > 10 GB
- Gdy proszę o kolejny eksport
- Wtedy API zwraca `429` z komunikatem „Kolejny eksport możliwy za 10 min (maks. 5 dziennie).” albo informację o przekroczonym rozmiarze.

**AC3 — Powiadomienie i alert (SR-FILE-09, SR-LOG-07)**
- Gdy eksport się zaczyna
- Wtedy wszyscy Administratorzy dostają e-mail (tylko link do zlecenia, bez danych klientów), kanał alertów — alert, a zdarzenie trafia do audytu.

**AC4 — Usunięcie po 24 h (SR-DATA-07)**
- Zakładając plik eksportu z 2026-10-05 10:00 (zegar kontrolowany)
- Gdy jest 2026-10-06 10:01
- Wtedy plik jest usunięty (lifecycle), a link zwraca `404`.

**AC5 — Uprawnienia (SR-AUTHZ-06, SR-SESS-08, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda prosi o eksport
- Wtedy A i E — po step-upie (`403 step_up_required` bez niego), R nie widzi przycisku i dostaje `403 forbidden`, niezalogowany — `401`; eksport tylko w kanale `web`.

**AC6 — Stany**
- Wtedy brak zdjęć — przycisk wyłączony z podpowiedzią; błąd zadania — „Nie udało się przygotować pliku. Spróbuj ponownie.”; offline — przycisk wyłączony.

**AC7 — Dostęp do gotowego eksportu (SR-FILE-07, SR-AUTHZ-06, SR-AUTHZ-05)**
- Zakładając gotowy eksport zlecony przez Edytora „Anna Testowa”
- Gdy inny Administrator, inny Edytor, Tylko odczyt i niezalogowany otwierają W-09 tego zlecenia albo wywołują operacje odczytu i pobrania tego eksportu
- Wtedy eksport i jego plik widzi i pobiera wyłącznie zlecający: pozostali A, E i R nie widzą go w W-09, a API zwraca im `404 not_found`; niezalogowany — `401`
- Oraz „Pobierz ZIP” w W-09 to akcja wywołująca autoryzowane `POST …/download-url`, które wystawia podpisany link ważny ≤ 5 min (nie trwały adres „na okaziciela”), każde pobranie trafia do audytu, a operacje odczytu i pobrania eksportu są w macierzy ról z przypadkiem IDOR i wyłącznie w kanale `web`.

## Poza zakresem
- Eksport danych (CSV / XLSX) — M4, tylko Administrator. Eksport filmów i dokumentów — poza v1.

## UX / UI
- W-09: przycisk „Eksportuj zdjęcia (ZIP)”, InlineAlert z akcją „Pobierz ZIP” (widoczny tylko dla zlecającego), W-04 „Potwierdź tożsamość, aby wyeksportować zdjęcia (ZIP)”. Stany: AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | eksport po step-upie; odczyt i pobranie wyłącznie własnych eksportów (cudze — `404`) |
| Edytor | eksport po step-upie; odczyt i pobranie wyłącznie własnych eksportów (cudze — `404`) |
| Tylko odczyt | brak (`403` przy zleceniu eksportu, `404` przy odczycie i pobraniu) |
| Niezalogowany | brak (`401`) |

- Dane: oryginały zdjęć w ZIP (mogą mieć metadane — ostrzeżenie jak przy pobraniu oryginału, P3).
- W AC: SR-FILE-09, SR-LOG-07, SR-DATA-07, SR-AUTHZ-06, SR-SESS-08, SR-AUTHZ-05, SR-FILE-07 (przegląd `security-engineer` EVM-010: CWE-639). Polityki P3, P6, P10.

## Notatki techniczne
- Moduły: `media`, worker, `audit` + panel. Plik eksportu w buckecie z TTL 24 h.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-052 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (security-engineer): AC7 — eksport widzi i pobiera wyłącznie zlecający, pobranie przez autoryzowane `download-url` z audytem; warunek wdrożenia na prod
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
