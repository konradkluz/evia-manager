---
id: EVM-040
title: Usunięcie i redakcja wpisu w dzienniku (Administrator)
type: story
milestone: M1
epic: E5 Dziennik i komentarze
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-007, EVM-029, EVM-037]
---

# EVM-040: Usunięcie i redakcja wpisu w dzienniku (Administrator)

## Historyjka
Jako **Administrator** chcę **ukryć wpis dodany przez pomyłkę albo trwale usunąć z niego treść z danymi osobowymi**, aby **realizować prawo do usunięcia danych (RODO art. 17) bez niszczenia historii zlecenia**.

## Kontekst
- Model: „Usuwanie danych” — soft delete (A), redakcja treści (A ze step-upem, wyjątek od append-only); SR-PRIV-03, SR-PRIV-04, SR-DATA-08.
- **Wprowadza rejestr usunięć poza bazą** (konsultacja `solution-architect`, W4): port zapisu w `platform` do bucketu rejestru z EVM-007 (klucz aplikacji tylko `PutObject`), wpis przed operacją. Zależą od niego EVM-041, EVM-051 i EVM-062.
- Makieta: [W-08](../../ux/flows/05-wpis-i-komentarz.md#w-08-dziennik) (menu `⋮`: „Usuń wpis”, „Zredaguj treść…”), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie).

## Kryteria akceptacji
**AC1 — Usunięcie wpisu**
- Zakładając wpis „Ustalenie” w zleceniu
- Gdy Administrator wybiera „Usuń wpis”
- Wtedy wpis znika z dziennika Edytora i Tylko odczyt (pobranie po `id` — `404`), Administrator widzi go z oznaczeniem „Usunięty”, toast „Usunięto wpis. [Cofnij]” przywraca wpis, a obie operacje są audytowane.

**AC2 — Redakcja treści (SR-PRIV-03, SR-SESS-08)**
- Zakładając wpis z omyłkowo wpisanym numerem dowodu osobistego
- Gdy Administrator wybiera „Zredaguj treść…”, potwierdza dialog „Zredagować treść wpisu? Treść zostanie zastąpiona znacznikiem — tej operacji nie można cofnąć.” i tożsamość w W-04
- Wtedy treść jest zastąpiona znacznikiem „Treść usunięta przez administratora 03.10.2026.”, zapisany jest czas i autor redakcji, a metadane i miejsce wpisu na osi czasu zostają.

**AC3 — Rejestr usunięć przed operacją (SR-PRIV-04)**
- Gdy Administrator redaguje wpis
- Wtedy przed zmianą w bazie do rejestru usunięć trafia nowy obiekt z identyfikatorem wpisu, kodem operacji i czasem (bez treści)
- Oraz gdy zapis do rejestru się nie udaje (atrapa w teście), wtedy redakcja nie startuje, treść jest nienaruszona, a panel pokazuje „Nie udało się zredagować treści. Spróbuj ponownie później.”

**AC4 — Audyt bez treści (SR-LOG-03, SR-DATA-08)**
- Gdy wykonuje się usunięcie, przywrócenie albo redakcja
- Wtedy zdarzenie audytu zawiera identyfikator wpisu, kod akcji i wynik — bez treści wpisu.

**AC5 — Zdarzenia automatyczne**
- Zakładając zdarzenie automatyczne (zmiana statusu)
- Gdy Administrator otwiera menu wpisu
- Wtedy usunięcie i redakcja są niedostępne (zdarzenia nie zawierają danych osobowych), a API odrzuca takie operacje.

**AC6 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda usuwa i redaguje wpis
- Wtedy tylko Administrator (redakcja — ze step-upem) wykonuje operacje; Edytor ma pozycje wyłączone z podpowiedzią „Usunąć wpis może tylko administrator.” i dostaje `403 forbidden`; R nie widzi menu (`403`); niezalogowany — `401`; wpis zlecenia B ścieżką zlecenia A — `404`.

**AC7 — Stany**
- Wtedy offline — akcje wyłączone; anulowanie W-04 — „Nie wykonano operacji.”, brak zmian; `412` — komunikat z odświeżeniem.

## Poza zakresem
- Trwałe usunięcie (purge) całego zlecenia i retencja danych biznesowych — M4 (P4; do tego czasu procedura ręczna z runbooka EVM-064).
- Odtworzenie bazy z ponownym zastosowaniem rejestru — EVM-062.

## UX / UI
- W-08: menu `⋮` [P-1], AlertDialog (danger) dla redakcji, W-04, typ wpisu „Zredagowany” (`eye-off`). Stany: AC7; brak uprawnień — AC6.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie, przywrócenie; redakcja ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: treść wpisów (dane osobowe), rejestr usunięć (tylko identyfikatory).
- W AC: SR-PRIV-03, SR-SESS-08, SR-PRIV-04, SR-LOG-03, SR-DATA-08, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-ERR-01 (nieudany zapis rejestru = odmowa). Polityka P4 (rejestr 40 dni).

## Notatki techniczne
- Moduły: `timeline`, `platform` (port rejestru usunięć), `audit` + panel.
- `devops-engineer`: klucz aplikacji z wyłącznie `PutObject` do bucketu rejestru (EVM-007), konfiguracja na staging; atrapa portu w testach.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-040 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane (opis rejestru usunięć dla runbooka odtworzenia)
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
