---
id: EVM-028
title: Konto — profil, hasło, drugi krok logowania i moje sesje
type: story
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-023]
---

# EVM-028: Konto — profil, hasło, drugi krok logowania i moje sesje

## Historyjka
Jako **użytkownik** chcę **samodzielnie zmienić nazwę, hasło i metody drugiego kroku oraz zobaczyć i zakończyć swoje sesje**, aby **dbać o bezpieczeństwo konta bez proszenia Administratora**.

## Kontekst
- SR-AUTH-03, SR-AUTH-10 (pełne ponowne uwierzytelnienie, e-mail, audyt), SR-SESS-04 (limit 5 sesji web), SR-SESS-07, SR-DATA-07 (retencja sesji — P4: 30 dni).
- Decyzja 3: Administrator rejestruje co najmniej dwa klucze dostępu (Windows Hello i telefon) — drugi klucz dodaje tutaj; konta aktywowane przed EVM-023 generują tu kody odzyskiwania.
- **Od E9:** „Moje urządzenia” (sekcja W-15 i limit 2 urządzeń mobilnych).
- Makieta: W-15 (EVM-015).

## Kryteria akceptacji
**AC1 — Profil**
- Gdy zmieniam nazwę wyświetlaną (≤ 200 znaków)
- Wtedy nowa nazwa jest widoczna w nagłówku i u innych użytkowników (tylko `id` i `displayName` — SR-DATA-03).

**AC2 — Zmiana hasła (SR-AUTH-03, SR-AUTH-10)**
- Zakładając zalogowanego użytkownika z dwiema sesjami
- Gdy zmienia hasło
- Wtedy musi podać bieżące hasło i przejść pełne ponowne uwierzytelnienie (hasło + drugi krok), nowe hasło przechodzi reguły SR-AUTH-01 i SR-AUTH-02, użytkownik dostaje e-mail „Hasło zostało zmienione”, panel proponuje „Zakończ pozostałe sesje”, a zmiana jest audytowana.

**AC3 — Metody drugiego kroku (SR-AUTH-10, SR-AUTH-15)**
- Zakładając „Drugi krok logowania” w W-15
- Gdy po pełnym ponownym uwierzytelnieniu dodaję kolejny klucz dostępu, usuwam klucz, dodaję albo usuwam kod z aplikacji
- Wtedy lista metod pokazuje nazwę i datę dodania każdego klucza, a każda zmiana wysyła e-mail na adres konta i tworzy zdarzenie audytu.

**AC4 — Reguły metod**
- Zakładając Administratora z jednym kluczem dostępu albo dowolne konto z jedną metodą
- Gdy próbuje usunąć ostatni klucz (Administrator) albo ostatnią metodę
- Wtedy operacja jest odrzucona z komunikatem, co trzeba najpierw dodać.

**AC5 — Nowe kody odzyskiwania (SR-AUTH-08)**
- Gdy po pełnym ponownym uwierzytelnieniu generuję nowe kody
- Wtedy widzę 10 nowych kodów jeden raz, poprzednie przestają działać, liczba pozostałych kodów jest widoczna w W-15, a zmiana ma e-mail i audyt.

**AC6 — Moje sesje (SR-SESS-07, SR-SESS-04)**
- Zakładając 5 aktywnych sesji web użytkownika
- Gdy loguje się szósty raz
- Wtedy najstarsza sesja kończy się, a użytkownik dostaje e-mail; w W-15 widzi swoje sesje (przeglądarka, pełny IP — P9, ostatnia aktywność, oznaczenie „ta sesja”) i po ponownym uwierzytelnieniu kończy wybraną albo wszystkie pozostałe.

**AC7 — Retencja sesji (SR-DATA-07, P4)**
- Zakładając sesję wygasłą 2026-09-01 (zegar kontrolowany)
- Gdy 2026-10-02 działa zadanie retencji
- Wtedy rekord sesji jest usunięty, a raport zadania nie zawiera danych osobowych.

**AC8 — Uprawnienia i stany (SR-AUTHZ-05)**
- Zakładając dowolną rolę
- Gdy użytkownik odwołuje się do profilu albo sesji innej osoby po identyfikatorze
- Wtedy API zwraca `404 not_found`; niezalogowany dostaje `401`; offline — akcje wyłączone, dane formularza w pamięci karty; `429` — wzór z README makiet; sekcja urządzeń niewidoczna (od E9).

## Poza zakresem
- Zmiana adresu e-mail konta — poza M1 (obejście: Administrator zaprasza nowy adres i dezaktywuje stary).
- Urządzenia mobilne — od E9.

## UX / UI
- W-15 (sekcje: Profil, Hasło, Drugi krok logowania, Moje sesje), dialog pełnego ponownego uwierzytelnienia (wzorzec W-04), lista kodów jak W-03 krok 3.
- Stany: AC8; pusty (jedna sesja — „Tylko ta sesja”).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | własne konto (min. 1 klucz dostępu) |
| Edytor | własne konto |
| Tylko odczyt | własne konto |
| Niezalogowany | brak (`401`) |

- Dane: nazwa, metody MFA (SEK), sesje (IP, user agent).
- W AC: SR-DATA-03, SR-AUTH-03, SR-AUTH-10, SR-AUTH-15, SR-AUTH-08, SR-SESS-07, SR-SESS-04, SR-DATA-07, SR-AUTHZ-05.
- W sekcji: SR-AUTH-01, SR-AUTH-02, SR-CRYPTO-05, SR-LOG-03. Polityki P1, P2, P4, P9.

## Notatki techniczne
- Moduły: `identity`, `audit` (+ `platform`: zadanie retencji w pg-boss) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-028 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (decyzja 3 — drugi klucz dostępu Administratora)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
