---
id: EVM-015
title: Makiety ekranów E1 — reset hasła, zaproszenie, konto, użytkownicy i dziennik audytu
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

# EVM-015: Makiety ekranów E1 — reset hasła, zaproszenie, konto, użytkownicy i dziennik audytu

## Historyjka
Jako **zespół wykonawców epiku E1** chcemy **makiet ekranów dostępu i administracji, które w EVM-004 zostały „bez makiety”**, aby **historyjki E1 miały jednoznaczną specyfikację UI, zanim zaczniemy je realizować**.

## Kontekst
- `docs/ux/flows/README.md` → „Ekrany”: W-12, W-13, W-15, W-16, W-18 mają status „bez makiety — przy refinemencie E1”. W-17 (urządzenia) przechodzi do E9 (M2).
- **W-13 jest potrzebne już na ścieżce pionowej:** pierwszy Administrator aktywuje konto jednorazowym linkiem z polecenia na serwerze (EVM-016) — to ten sam ekran co przyjęcie zaproszenia (EVM-024). Dlatego ta historyjka poprzedza EVM-016.
- Wejścia: makiety W-01–W-04 (`flows/01-logowanie-mfa.md`), polityki P1, P2, P9 (`docs/security/policies.md`), wymagania E1 (`docs/security/requirements.md`), decyzje z EVM-010 (README M1 → „Decyzje dla Konrada”, m.in. 10 — ostatni Administrator, 16 — kod odzyskiwania przy step-upie).
- Historyjki korzystające: EVM-016, EVM-024 (W-13), EVM-025 (W-12), EVM-028 (W-15), EVM-024 i EVM-027 (W-16), EVM-029 (W-18), EVM-023 (W-03 krok 3).

## Kryteria akceptacji
**AC1 — W-13 „Ustaw hasło” (zaproszenie i aktywacja pierwszego Administratora)**
- Zakładając, że osoba otwiera jednorazowy link (zaproszenie albo link z polecenia na serwerze)
- Gdy czyta makietę W-13
- Wtedy makieta ma formę z EVM-004 (cel, akcja główna, hierarchia, szkielet ASCII, tabela 5 stanów, tabela ról, responsywność, komponenty i tokeny, mikrocopy, dostępność), pokazuje ustawienie hasła (SR-AUTH-01: min. 15 znaków, podgląd, wklejanie) i przejście do W-03, a link nieważny, wygasły lub użyty ma jeden komunikat bez informacji o koncie.

**AC2 — W-12 „Nowe hasło z linku”**
- Zakładając link resetu hasła (prośba o link — W-01)
- Gdy czytam makietę W-12
- Wtedy pokazuje ustawienie nowego hasła, przejście do drugiego kroku logowania (reset nie omija MFA — SR-AUTH-11) i informację, że pozostałe sesje zostały zakończone.

**AC3 — W-15 „Konto”**
- Zakładając zalogowanego użytkownika dowolnej roli
- Gdy czytam makietę W-15
- Wtedy obejmuje: profil (nazwa wyświetlana), zmianę hasła, „Drugi krok logowania” (lista kluczy dostępu z dodaniem kolejnego i usunięciem, kod z aplikacji, nowe kody odzyskiwania — każda zmiana po pełnym ponownym uwierzytelnieniu, SR-AUTH-10) i „Moje sesje” (sesje web, zakończenie wybranej lub pozostałych); sekcja urządzeń jest oznaczona „od E9”.

**AC4 — W-16 „Użytkownicy” (tylko Administrator)**
- Zakładając Administratora
- Gdy czyta makietę W-16
- Wtedy obejmuje listę użytkowników (nazwa, e-mail, rola, status, ostatnie logowanie, stan zaproszenia), zaproszenie, ponowne wysłanie zaproszenia, zmianę roli, dezaktywację i reaktywację, zakończenie sesji użytkownika, reset MFA z potwierdzeniem weryfikacji tożsamości i komunikat ochrony ostatniego aktywnego Administratora — każda operacja z W-04 i dialogiem z podsumowaniem.

**AC5 — W-18 „Dziennik audytu” (tylko Administrator)**
- Zakładając Administratora po step-upie
- Gdy czyta makietę W-18
- Wtedy obejmuje listę zdarzeń (czas, osoba, akcja, wynik, obiekt, prefiks IP wg P9), filtry (akcja, osoba, wynik, okres) i paginację — bez wartości danych osobowych.

**AC6 — Treści e-maili E1**
- Zakładając e-maile z historyjek E1 (zaproszenie, reset hasła, blokada konta, zmiana hasła, zmiana drugiego kroku, użycie kodu odzyskiwania, logowanie z nowej przeglądarki, alert dla Administratorów)
- Gdy czytam ich treść
- Wtedy każdy e-mail zawiera wyłącznie link do panelu i informację o zdarzeniu — bez danych klientów (SR-INPUT-07) — i używa form bezosobowych.

**AC7 — Spójność z makietami EVM-004**
- Gdy porównuję nowe makiety z W-01–W-04 i styleguide'em 1.2.0
- Wtedy używają wyłącznie jego komponentów i tokenów, W-03 opisuje warianty bez kroku kodów odzyskiwania (do EVM-023) i z nim, mapa nawigacji i macierz ekran × rola w `flows/README.md` oznaczają W-12, W-13, W-15, W-16 i W-18 jako „z makietą”, a W-17 jako „bez makiety — E9”.

**AC8 — Jakość dokumentacji**
- Wtedy dane w makietach są wyłącznie syntetyczne, diagramy Mermaid renderują się lokalnie, a `npm run docs:check` kończy się wynikiem 0 błędów.

## Poza zakresem
- W-17 (urządzenia użytkowników) — E9 (M2).
- Ekrany klientów, lokalizacji, edycji zlecenia i prywatności — EVM-071.
- Zmiana adresu e-mail konta — poza M1 (README M1 → „Świadome przesunięcia”).

## UX / UI
Ekrany W-12, W-13, W-15, W-16, W-18 oraz W-03 (wariant bez kroku 3) i W-04 (tytuły dialogów dla nowych operacji). Każdy z tabelą stanów: pusty, ładowanie, błąd (z `429`), offline, brak uprawnień.

## Bezpieczeństwo i prywatność
| Rola | Dostęp (w makietach) |
|---|---|
| Administrator | W-12, W-13, W-15; W-16 i W-18 po step-upie |
| Edytor | W-12, W-13, W-15 |
| Tylko odczyt | W-12, W-13, W-15 |
| Niezalogowany | W-12 i W-13 tylko z ważnym linkiem |

Odwołania w makietach: SR-AUTH-01, SR-AUTH-03, SR-AUTH-05, SR-AUTH-10, SR-AUTH-11, SR-AUTH-12, SR-AUTH-13, SR-SESS-04, SR-SESS-07, SR-SESS-08, SR-INPUT-07; polityki P1, P2, P9. Przegląd `security-engineer` obowiązkowy.

## Notatki techniczne
Bez kodu. Makiety są wejściem do kontraktów API historyjek E1 — operacje i kody błędów ustalają wykonawcy w planach technicznych.

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
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
