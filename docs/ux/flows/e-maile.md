# Treści e-maili

> Dokument żywy (EVM-015; kolejne epiki dopisują swoje e-maile). Prowadzi: `ux-designer`. E-mail nie jest ekranem, więc plik nie ma numeru przepływu (jak `scenariusze-a-d.md`). Indeks makiet: [README.md](README.md); ekrany, do których prowadzą linki: [11](11-aktywacja-i-reset-hasla.md) (W-13, W-12), [01](01-logowanie-mfa.md) (W-01), [12](12-konto-i-administracja.md) (W-15, W-18).
> Źródła: SR-INPUT-07, SR-AUTH-05, -08, -10, -11, -12, -13, -15, SR-SESS-04, SR-LOG-07, SR-API-04; polityki P1, P2, P9 ([`policies.md`](../../security/policies.md)); README M1 → „Zasady wspólne” → „Tokeny w linkach jednorazowych”; decyzja Konrada 16 (kod odzyskiwania tylko w logowaniu — potwierdzona na demo EVM-015 2026-10-04); konsultacja `security-engineer` w EVM-015 (S6, kontrola 10). Historyjki: EVM-023, EVM-024, EVM-025, EVM-026, EVM-027, EVM-028.

## Zasady treści e-maili
1. **Zwykły tekst** — bez HTML, obrazów i pikseli śledzących. E-mail nie jest interfejsem panelu, więc nie korzysta z tokenów styleguide'u.
2. **Stałe szablony w kodzie** — temat i treść pochodzą ze stałych szablonów; odbiorca i temat wyłącznie z walidowanych pól bez CR/LF (SR-INPUT-07, CWE-93). Zmienne w szablonach to tylko wartości z listy niżej.
3. **Wyłącznie informacja o zdarzeniu i link do panelu** — bez danych klientów, `displayName`, nazw kluczy dostępu, adresów IP i surowego User-Agent (TM-80). Dopuszczalne zmienne: rola konta (zaproszenie), czas zdarzenia i koniec ważności linku, koniec okna konfiguracji drugiego kroku (reset przez Administratora), przeglądarka i system ze słownika, liczba pozostałych kodów odzyskiwania.
4. **Powitanie bez nazwy** — „Dzień dobry,”; formy bezosobowe (§ 6.1): „zaproszono Cię”, „zalogowano się”, „zmieniono”.
5. **Link tylko do panelu**, budowany przez serwer z adresu panelu w konfiguracji — nigdy z nagłówka `Host` żądania (CWE-640). Token jednorazowy wyłącznie we fragmencie adresu (`#…`), nigdy w ścieżce ani query; wartości tokenu nie pokazujemy w makietach. Zapis w szablonach:
   - `[link]` — link jednorazowy z tokenem: `[adres panelu]/[ścieżka ekranu]#[token]` (W-13, W-12);
   - `[link: Zresetuj hasło]` — formularz „Zresetuj hasło” w W-01, bez tokenu i bez wpisanego adresu;
   - `[link: Drugi krok logowania]`, `[link: Moje sesje]` — W-15 (kotwica `#drugi-krok` albo sekcja sesji), bez tokenu;
   - `[link: Dziennik audytu]` — W-18, bez tokenu (wejście przez W-04).
6. **Ważność linku w treści** — reset hasła 30 minut, zaproszenie 72 godziny (P2) — z godziną końca ważności.
7. **Adres panelu widoczny jako tekst** w stopce — odbiorca może wpisać go sam zamiast klikać.
8. **Czas zdarzenia** w strefie `Europe/Warsaw`, format § 6.3 („04.10.2026, 14:05”).
9. **Przeglądarka i system** (e-maile 7 i 8) z zamkniętego słownika — rodzina przeglądarki · system, bez wersji, z wartością zastępczą „Nieznana przeglądarka” / „Nieznany system”; ten sam słownik co „Moje sesje” w W-15 (S6). Bez adresu IP i bez geolokalizacji — żadnej nowej usługi zewnętrznej.
10. **Alert dla Administratorów nie wskazuje osoby** — kto i kiedy: W-18 (po step-upie).
11. **U dostawcy e-maili wyłączone śledzenie otwarć i kliknięć** — przepisanie linków przez dostawcę wysłałoby mu token z fragmentu adresu. Wymóg dla EVM-007 i EVM-024 (konfiguracja Scaleway TEM).
12. **Stopka antyphishingowa** — w każdym e-mailu (niżej).
13. **Środowiska:** staging — wyłącznie adresy z listy dozwolonych (decyzja 15), dev i testy — Mailpit; nigdy wysyłka przez dostawcę na domeny `example.com` ani `.test` (EVM-024 AC6).
14. **Kodowanie** (SR-INPUT-07; ASVS V1.3.11, V1.3.7; CWE-93, CWE-116):
    - `Content-Type: text/plain; charset=UTF-8`, `Content-Transfer-Encoding: quoted-printable` albo `base64`;
    - temat z polskimi znakami jako encoded-word UTF-8 (RFC 2047);
    - nagłówki i treść koduje biblioteka pocztowa — bez ręcznego składania nagłówków; walidacja odbiorcy i tematu bez CR/LF — zasada 2;
    - test w Mailpit (EVM-007, EVM-024): polskie znaki w temacie i treści są poprawne, a link z tokenem we fragmencie zostaje nienaruszony i klikalny — nie dzieli go zawijanie wierszy.

**Stopka (każdy e-mail)**
```text
--
Wiadomość automatyczna z EVia Manager (EVia Charge) — nie odpowiadaj na nią.
Adres panelu: [adres panelu]
Nigdy nie prosimy o hasło ani kody w e-mailu. Jeśli wiadomość budzi wątpliwości,
wpisz adres panelu samodzielnie i skontaktuj się z administratorem.
```

**Przegląd**
| # | E-mail | Odbiorca | Link | Historyjka | Wymagania |
|---|---|---|---|---|---|
| 1 | Zaproszenie | zapraszany adres | W-13 z tokenem (72 h) | EVM-024 | SR-AUTH-12, SR-INPUT-07 |
| 2 | Link do ustawienia nowego hasła | adres aktywnego konta | W-12 z tokenem (30 min) | EVM-025 | SR-AUTH-11 |
| 3 | Blokada konta | adres konta | W-01 „Zresetuj hasło” — bez tokenu | EVM-026 | SR-AUTH-05, SR-AUTH-15 |
| 4 | Hasło zostało zmienione | adres konta | W-01 „Zresetuj hasło” — bez tokenu | EVM-025, EVM-028 | SR-AUTH-03, SR-AUTH-10, SR-AUTH-15 |
| 5 | Zmiana drugiego kroku (6 wariantów) | adres konta | W-15 `#drugi-krok` — bez tokenu | EVM-023, EVM-027, EVM-028 | SR-AUTH-10, SR-AUTH-13, SR-AUTH-15 |
| 6 | Użycie kodu odzyskiwania | adres konta | W-15 `#drugi-krok` — bez tokenu | EVM-023 | SR-AUTH-08, SR-AUTH-15 |
| 7 | Logowanie z nowej przeglądarki | adres konta | W-01 „Zresetuj hasło”, W-15 — bez tokenu | EVM-026 | SR-AUTH-15 |
| 8 | Zakończenie najstarszej sesji | adres konta | W-15 — bez tokenu | EVM-028 | SR-SESS-04 |
| 9 | Alert dla Administratorów (7 wariantów) | wszyscy aktywni Administratorzy | W-18 — bez tokenu | EVM-024, EVM-026, EVM-027, EVM-028 | SR-LOG-07, SR-AUTH-15 |

Logowanie z nowego urządzenia mobilnego (SR-AUTH-15) — od E9.

## 1. Zaproszenie
- **Kiedy:** Administrator zaprasza osobę albo wysyła zaproszenie ponownie (W-16, EVM-024). Polecenie aktywacji pierwszego Administratora na serwerze (EVM-016) nie wysyła e-maili.
- **Temat:** `EVia Manager: zaproszenie do panelu`

```text
Dzień dobry,

zaproszono Cię do panelu EVia Manager firmy EVia Charge z rolą: Edytor.

Aby aktywować konto, otwórz link i ustaw hasło, a potem drugi krok logowania:
[link]

Link jest jednorazowy i ważny 72 godziny — do 06.10.2026, 10:00.
Po tym czasie poproś administratora o nowe zaproszenie.

Jeśli nie spodziewasz się tego zaproszenia, zignoruj tę wiadomość —
konto nie zostanie aktywowane.

[stopka]
```
Zmienne: rola, koniec ważności. Ponowne wysłanie — ta sama treść; poprzedni link przestaje działać.

## 2. Link do ustawienia nowego hasła
- **Kiedy:** prośba o link w W-01 „Zresetuj hasło” dla aktywnego konta (EVM-025 AC1). Na ekranie zawsze ten sam komunikat, niezależnie od tego, czy e-mail wyszedł.
- **Temat:** `EVia Manager: link do ustawienia nowego hasła`

```text
Dzień dobry,

otrzymaliśmy prośbę o ustawienie nowego hasła do konta w EVia Manager.

Aby ustawić nowe hasło, otwórz link:
[link]

Link jest jednorazowy i ważny 30 minut — do 14:35.
Po ustawieniu hasła zakończymy wszystkie sesje konta, a logowanie
potwierdzisz drugim krokiem.

Jeśli ta prośba nie pochodzi od Ciebie, zignoruj tę wiadomość —
hasło się nie zmieni.

[stopka]
```

## 3. Blokada konta
- **Kiedy:** 10 nieudanych prób w 15 minut (SR-AUTH-05, EVM-026 AC3) — także w pełnym ponownym uwierzytelnieniu (S7).
- **Temat:** `EVia Manager: konto tymczasowo zablokowane`

```text
Dzień dobry,

po wielu nieudanych próbach logowania konto w EVia Manager zostało
zablokowane na 15 minut — do 09:25.

Po tym czasie zalogujesz się jak zwykle. Jeśli nie pamiętasz hasła
albo próby nie pochodziły od Ciebie, ustaw nowe hasło — nowe hasło
zdejmuje blokadę:
[link: Zresetuj hasło]

[stopka]
```
Link prowadzi do formularza „Zresetuj hasło” w W-01 — bez tokenu i bez wpisanego adresu (EVM-026 AC3).

## 4. Hasło zostało zmienione
- **Kiedy:** po ustawieniu hasła z linku (W-12, EVM-025 AC5) i po zmianie w W-15 (EVM-028 AC2).
- **Temat:** `EVia Manager: hasło zostało zmienione`

```text
Dzień dobry,

hasło do konta w EVia Manager zostało zmienione 04.10.2026, 14:05.

[po resecie z linku]
Zakończyliśmy wszystkie sesje konta.
[po zmianie w Koncie]
Pozostałe sesje możesz zakończyć w panelu: Konto → Moje sesje
[link: Moje sesje]

Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:
[link: Zresetuj hasło]

[stopka]
```

## 5. Zmiana drugiego kroku logowania
- **Kiedy:** po każdej zmianie metod drugiego kroku (SR-AUTH-10; EVM-023 AC6, EVM-028 AC3, AC5) i po resecie przez Administratora (EVM-027 AC4). Wysyłany na adres konta.
- **Temat:** `EVia Manager: zmiana drugiego kroku logowania`

```text
Dzień dobry,

w koncie w EVia Manager zmieniono drugi krok logowania 04.10.2026, 14:05:
[wariant]

Metody konta sprawdzisz w panelu: Konto → Drugi krok logowania
[link: Drugi krok logowania]

Jeśli to nie Ty, od razu ustaw nowe hasło i powiadom administratora:
[link: Zresetuj hasło]

[stopka]
```

| Wariant | Treść `[wariant]` |
|---|---|
| Klucz dostępu dodany | „dodano klucz dostępu.” |
| Klucz dostępu usunięty | „usunięto klucz dostępu.” |
| Kod z aplikacji dodany | „dodano kod z aplikacji uwierzytelniającej.” |
| Kod z aplikacji usunięty | „usunięto kod z aplikacji uwierzytelniającej.” |
| Nowe kody odzyskiwania | „wygenerowano nowe kody odzyskiwania — poprzednie kody przestały działać.” |
| Reset przez Administratora | „zresetowano drugi krok logowania w panelu administracji. Wszystkie sesje konta zostały zakończone. Przy następnym logowaniu panel poprowadzi przez konfigurację od nowa. Skonfiguruj drugi krok do 05.10.2026, 14:05 — po tym czasie poproś administratora o ponowny reset.” — zamiast „Jeśli to nie Ty…”: „Jeśli nie zgłaszasz utraty drugiego kroku, od razu skontaktuj się z administratorem.” |

Bez nazwy klucza dostępu i bez wskazania, kto wykonał reset. Termin w wariancie „Reset przez Administratora” to koniec okna konfiguracji — długość z planu EVM-027 (rekomendacja ≤ 24 h; przykład: reset 04.10.2026, 14:05 + 24 h); zasady okna — [11 → Konto bez drugiego kroku](11-aktywacja-i-reset-hasla.md#konto-bez-drugiego-kroku).

## 6. Użycie kodu odzyskiwania
- **Kiedy:** logowanie kodem odzyskiwania w W-02 (EVM-023 AC5). Kod odzyskiwania działa wyłącznie w logowaniu — w żadnym ponownym uwierzytelnieniu (decyzja 16), więc e-mail ma jeden wariant.
- **Temat:** `EVia Manager: użyto kodu odzyskiwania`

```text
Dzień dobry,

zalogowano się do konta w EVia Manager kodem odzyskiwania
04.10.2026, 14:05. Pozostało 9 kodów.

Każdy kod działa raz. Gdy zostaną 3 lub mniej, wygeneruj nowe:
Konto → Drugi krok logowania
[link: Drugi krok logowania]
Jeśli nie masz już żadnej metody drugiego kroku, poproś administratora
o reset drugiego kroku logowania.

Jeśli to nie Ty, ktoś zna hasło i ma kody odzyskiwania — od razu
ustaw nowe hasło i powiadom administratora:
[link: Zresetuj hasło]

[stopka]
```
Zmienne: czas zdarzenia, liczba pozostałych kodów. Zdanie o resecie przez administratora jest stałe — nowe kody wymagają działającej metody (pełne ponowne uwierzytelnienie bez kodu odzyskiwania); blok „Jeśli to nie Ty…” zostaje bez zmian.

## 7. Logowanie z nowej przeglądarki
- **Kiedy:** udane logowanie z przeglądarki, z której konto wcześniej się nie logowało (EVM-026 AC4; mechanizm rozpoznania — plan EVM-026, bez odcisku przeglądarki). Konto Administratora — dodatkowo alert 9.
- **Temat:** `EVia Manager: logowanie z nowej przeglądarki`

```text
Dzień dobry,

zalogowano się do konta w EVia Manager z przeglądarki, której konto
wcześniej nie używało:

Przeglądarka: Firefox · Windows
Czas: 04.10.2026, 14:05

Jeśli to Ty — nic nie musisz robić.
Jeśli nie, od razu ustaw nowe hasło i powiadom administratora:
[link: Zresetuj hasło]
Sesje konta zobaczysz w panelu: Konto → Moje sesje
[link: Moje sesje]

[stopka]
```

## 8. Zakończenie najstarszej sesji
- **Kiedy:** szóste równoczesne logowanie — serwer kończy najstarszą sesję web (SR-SESS-04, EVM-028 AC6). E-mail z historyjki E1 spoza wyliczenia w AC6 EVM-015.
- **Temat:** `EVia Manager: zakończono najstarszą sesję`

```text
Dzień dobry,

nowe logowanie do konta w EVia Manager przekroczyło limit 5 równoczesnych
sesji, więc zakończyliśmy najstarszą sesję:

Zakończona sesja: Edge · Windows, ostatnia aktywność 03.10.2026, 16:20
Nowe logowanie: Firefox · Windows, 04.10.2026, 14:05

Jeśli nowe logowanie nie pochodzi od Ciebie, od razu ustaw nowe hasło
i powiadom administratora:
[link: Zresetuj hasło]
Sesje konta zobaczysz w panelu: Konto → Moje sesje
[link: Moje sesje]

[stopka]
```

## 9. Alert dla Administratorów
- **Kiedy:** zdarzenia uprawnień administratora (SR-LOG-07; P1 pkt 5). Odbiorcy: wszyscy aktywni Administratorzy — także ten, którego konta dotyczy zdarzenie.
- **Temat:** `EVia Manager: alert bezpieczeństwa — [rodzaj]`

```text
Dzień dobry,

w EVia Manager wystąpiło zdarzenie dotyczące uprawnień administratora
(04.10.2026, 14:05):
[wariant]

Szczegóły — kto i kiedy — są w panelu: Administracja → Dziennik audytu
(wymaga potwierdzenia tożsamości):
[link: Dziennik audytu]

Jeśli zdarzenie nie było zaplanowane, sprawdź dziennik audytu
i skontaktuj się z pozostałymi administratorami.

[stopka]
```

| Wariant | `[rodzaj]` w temacie | Treść `[wariant]` | Historyjka |
|---|---|---|---|
| Logowanie Administratora z nowej przeglądarki | nowa przeglądarka | „zalogowano się do konta administratora z nowej przeglądarki.” | EVM-026 AC4 |
| Nadanie roli Administrator | nowy administrator | „nadano rolę Administrator jednemu z kont.” | EVM-027 AC7 |
| Odebranie roli Administrator | odebrana rola | „odebrano rolę Administrator jednemu z kont.” | EVM-027 AC7 |
| Zaproszenie z rolą Administrator (także wysłane ponownie) | zaproszenie administratora | „wysłano zaproszenie z rolą Administrator.” | EVM-024 AC1 |
| Reaktywacja konta Administratora | reaktywacja administratora | „reaktywowano konto z rolą Administrator.” | EVM-027 AC7 |
| Reset drugiego kroku Administratora | reset drugiego kroku | „zresetowano drugi krok logowania konta administratora.” | EVM-027 AC7 |
| Zmiana drugiego kroku konta Administratora | zmiana drugiego kroku | „zmieniono drugi krok logowania konta administratora (dodano albo usunięto metodę albo wygenerowano nowe kody).” | EVM-028 AC3 i AC5 (nowe kody — alert wymagany przez SR-LOG-07; wejście do planu EVM-028) |

Bez wskazania osoby, nazwy konta, adresu e-mail i adresu IP — te dane zobaczy Administrator w W-18 po step-upie.
