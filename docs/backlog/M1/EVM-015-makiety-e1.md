---
id: EVM-015
title: Makiety ekranów E1 — reset hasła, zaproszenie, konto, użytkownicy i dziennik audytu
type: enabler
milestone: M1
epic: E00 Fundamenty
status: in-review
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
Historyjka dokumentacyjna (enabler, bez kodu), w formie jak EVM-004:
- makiety low-fi w Markdown, diagramy Mermaid i szkielety ASCII;
- odwołania wyłącznie do § i tokenów semantycznych styleguide'u **1.2.0** — bez literałów kolorów, rozmiarów i fontów, bez prototypu HTML;
- dane wyłącznie syntetyczne.

Kontrakt API, migracje, model danych i zależności — nie dotyczy. Makiety są wejściem do planów EVM-016, EVM-023–EVM-025 i EVM-027–EVM-029; operacje i kody błędów ustalają tamte plany („Notatki techniczne”). Styleguide i tokeny zostają bez zmian (rozstrzygnięcia 9 i 12). Baza porównania: `main`; gałąź robocza `claude/relaxed-franklin-7owvdc`.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/ux/flows/11-aktywacja-i-reset-hasla.md` — **nowy** (żywy, reguła 16; link z `flows/README.md`) | Przepływ 11 — diagram Mermaid z dwiema ścieżkami: link aktywacyjny z polecenia na serwerze albo zaproszenie → W-13 → W-03 → W-10; „Nie pamiętasz hasła?” w W-01 → e-mail → W-12 → W-02 (konto bez drugiego kroku → W-03 tylko w oknie konfiguracji po resecie przez Administratora) → W-10. Gałęzie: link nieważny, `429`, offline. Makiety **W-13** „Ustaw hasło” i **W-12** „Ustaw nowe hasło” w formie EVM-004: cel, akcja główna, hierarchia, szkielet ASCII, tabela 5 stanów (+ stany linku), tabela ról (A / E / R / niezalogowany), responsywność, komponenty i tokeny, mikrocopy, dostępność | AC1, AC2 |
| `docs/ux/flows/12-konto-i-administracja.md` — **nowy** | Przepływ 12 — diagramy: zmiana w W-15 z pełnym ponownym uwierzytelnieniem; operacja W-16: ActionMenu → dialog z podsumowaniem → W-04 → wynik albo `409` / `412`; wejście do W-18 ze step-upem. Makiety w formie EVM-004: **W-15** „Konto” (Profil, Hasło, Drugi krok logowania, Moje sesje; Urządzenia — „od E9”), **W-16** „Użytkownicy” (lista, „Zaproś użytkownika”, dialogi operacji), **W-18** „Dziennik audytu” (tabela, filtry, paginacja, etykiety akcji E1) | AC3, AC4, AC5 |
| `docs/ux/flows/e-maile.md` — **nowy** (żywy; kolejne epiki dopisują swoje e-maile) | Zasady treści e-maili i szablony E1 (lista niżej). Dla każdego: kiedy, odbiorca, temat, treść, link, historyjka i `SR-…` | AC6 |
| `docs/ux/flows/01-logowanie-mfa.md` | **W-03** — dwa warianty: „przed EVM-023” (EVM-016, EVM-024) i „od EVM-023” (3 kroki bez zmian) — rozstrzygnięcie 5. **W-04** — tytuły nowych operacji z W-15, W-16 i W-18; trzy zastosowania dialogu (rozstrzygnięcie 6); wiersz „Kod odzyskiwania” → „niedostępny przy step-upie (EVM-029 AC4)”. **W-01** — odnośnik do W-12. Odnośniki do W-15 prowadzą do nowej makiety | AC7 |
| `docs/ux/flows/README.md` | **Mapa nawigacji:** W-12, W-13, W-15, W-16 i W-18 bez dopisku „bez makiety”; W-17 — „bez makiety — E9”; krawędź W-12 → W-02; Administracja → W-16 i W-18. **„Ekrany”:** linki do makiet, przepływy 11 i 12, W-04 używany także w 12, W-17 → E9. **Macierz ekran × rola:** W-16, W-18 i W-17 w osobnych wierszach, W-17 „bez makiety — E9”. **„Jak czytać” i spis treści:** przepływy 11–12 i e-maile. **„Dane w makietach”:** adresy IP tylko z zakresów dokumentacyjnych (RFC 5737, RFC 3849); bez przykładowych tokenów i kodów. **„Zgodność z politykami”:** wiersze P1 i P2 + nowy wiersz P9. **Nowa sekcja „Pokrycie EVM-015”:** AC → plik → ekran. **Nota przy „Propozycje do styleguide'u”** — rozstrzygnięcie 12 | AC7, AC8 |
| `docs/product/domain.md` — **`product-owner`** (contributor) | „Pojęcia z makiet E1 (EVM-015)”: status konta (Aktywne / Oczekuje na aktywację / Dezaktywowane ↔ `UserStatus`), stan zaproszenia, drugi krok logowania, klucz dostępu, kod z aplikacji uwierzytelniającej, kod odzyskiwania, pełne ponowne uwierzytelnienie, dziennik audytu | AC7 (słownictwo UI) |
| `docs/ux/README.md`, `docs/README.md` | artefakty: makiety E1 (EVM-015) i treści e-maili | — |
| `CHANGELOG.md` | „Unreleased → Dodano”: makiety ekranów E1 i treści e-maili [EVM-015] | DoD |
| ten plik | plan, „Dziennik”, potem „Uwagi do rozważenia” i DoD | — |

**Szablony e-maili E1 (AC6):**
- zaproszenie (EVM-024);
- link do ustawienia nowego hasła (EVM-025);
- blokada konta — z odnośnikiem do formularza „Zresetuj hasło” w W-01, bez tokenu (EVM-026);
- hasło zmienione — po resecie i po zmianie w W-15 (EVM-025, EVM-028);
- zmiana drugiego kroku — warianty: klucz dostępu dodany albo usunięty, kod z aplikacji dodany albo usunięty, nowe kody odzyskiwania, reset przez Administratora (EVM-023, EVM-027, EVM-028);
- użycie kodu odzyskiwania (EVM-023);
- logowanie z nowej przeglądarki (EVM-026);
- zakończenie najstarszej sesji po szóstym logowaniu (EVM-028 AC6, SR-SESS-04) — e-mail z historyjki E1 spoza wyliczenia w AC6;
- alert dla Administratorów — warianty: logowanie Administratora z nowej przeglądarki, nadanie albo odebranie roli Administrator, reset drugiego kroku Administratora (EVM-026, EVM-027).

**Bez zmian:**
- `docs/ux/styleguide.md` i `design/tokens/` — 1.2.0 wystarcza (rozstrzygnięcia 9 i 12);
- ADR-y, `domain-model.md`, `api-guidelines.md`, `docs/security/*`, `design/prototypes/`;
- historyjki E1 — rozbieżności brzmienia (np. status „Zaproszony” w EVM-016 AC1 i EVM-024 AC1) trafią do „Uwag do rozważenia” dla `product-owner`.

**Rozstrzygnięcia projektowe** (kompetencja `ux-designer`; do wglądu w przeglądach i na demo)
1. **Pliki.**
   - Przepływ 11 to wejście z linku jednorazowego (W-13, W-12), a przepływ 12 — konto i administracja (W-15, W-16, W-18).
   - `e-maile.md` nie ma numeru, tak jak `scenariusze-a-d.md`, bo e-mail nie jest ekranem.
   - EVM-071 numeruje swoje przepływy od 13.
2. **W-13 i W-12 mają układ W-01:** karta na `color.bg.brand`, bez Sidebar i TopBar, jak każdy ekran przed zalogowaniem.
   - **Sprawdzenie linku przy wczytaniu** (`POST` z tokenem, bez zużycia — EVM-016 AC5) — nieważny link widać przed wpisaniem hasła. To rekomendacja dla planu EVM-016; jeśli kontrakt jej nie przewidzi, błąd linku pojawi się po „Ustaw hasło”.
   - **Token trzymamy tylko w pamięci karty.** Odświeżenie strony daje stan linku nieważnego z instrukcją „Otwórz link z wiadomości e-mail ponownie” — samo otwarcie linku go nie zużywa.
   - **Jeden komunikat** „Link jest nieważny lub wygasł.” dla linku użytego, wygasłego, zastąpionego, zmienionego i bez tokenu — bez e-maila, nazwy i roli. Akcja: W-12 — „Wyślij nowy link”, W-13 — „Przejdź do logowania”.
   - **Inna osoba zalogowana w tej przeglądarce** — informacja „Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.”
3. **Hasło.**
   - Jedno pole „Nowe hasło” z „Pokaż”, bez pola „Powtórz hasło” — podgląd zastępuje powtórzenie (WCAG 3.3.7).
   - Podpowiedź: „Co najmniej 15 znaków — może to być zdanie ze spacjami.”
   - Dla menedżera haseł: `autocomplete="new-password"` oraz e-mail konta jako pole tylko do odczytu z `autocomplete="username"` — menedżer zapisze parę (WCAG 3.3.8).
   - Długość sprawdzamy po opuszczeniu pola i przy zapisie.
   - Hasło z listy popularnych, ze słowem kontekstowym albo z wycieku dostaje jeden komunikat, bez wskazania, która lista je odrzuciła.
4. **Po zapisie w W-12 → W-02.**
   - W-02 pokazuje InlineAlert „Hasło zostało zmienione. Zakończyliśmy wszystkie sesje tego konta. Potwierdź logowanie drugim krokiem.” Urządzenia mobilne — od E9.
   - Konto bez drugiego kroku → W-03 **tylko w oknie konfiguracji** po resecie przez Administratora (długość — plan EVM-027, rekomendacja ≤ 24 h). Poza oknem konto nie dostaje linku resetu (komunikat W-01 bez zmian), a logowanie hasłem kończy się w W-01: „Konfiguracja drugiego kroku wygasła — poproś administratora o ponowny reset.” Termin podają dialog resetu w W-16 i e-mail 5. (Poprawka po przeglądzie `security-engineer`, runda 1 — `11` → „Konto bez drugiego kroku”.)
   - Gdy drugi krok trwa za długo → W-01; nowe hasło już działa.
5. **W-03 — dwa warianty.**
   - **„Przed EVM-023”** — dla każdej roli tylko klucz dostępu: jeden ekran bez licznika kroków, bez bloku kodu z aplikacji i bez kroku kodów odzyskiwania („UI pokazuje tylko to, co system robi” — README M1). Po rejestracji klucza od razu panel.
   - **„Od EVM-023”** — obecne 3 kroki.
6. **W-04 — trzy zastosowania jednego dialogu:**
   - **step-up** — drugi krok, gdy ostatnie uwierzytelnienie było ponad 15 min temu: operacje W-16, wejście do W-18, „Moje sesje” w W-15;
   - **pełne ponowne uwierzytelnienie** — hasło i drugi krok za każdym razem: zmiany drugiego kroku w W-15 (SR-AUTH-10);
   - **zmiana hasła** — bieżące hasło jest w formularzu „Zmień hasło”, więc W-04 pokazuje tylko drugi krok.
   - Formularz operacji chowa się na czas W-04 i wraca z danymi (§ 3.13).
   - Nowe tytuły „Potwierdź tożsamość, aby …” dla każdej operacji.
7. **W-15 — jedna kolumna kart:** Profil, Hasło, Drugi krok logowania, Moje sesje.
   - **Akcje kart są drugorzędne** (Button secondary: „Zapisz”, „Dodaj klucz dostępu”, „Pokaż sesje”, „Zakończ pozostałe sesje”). Jedyny primary widoku to „Zmień hasło” w rozwiniętym formularzu hasła (§ 3.1 — jedna akcja primary na widok / dialog). (Poprawka po przeglądzie `web-developer`, runda 1.)
   - **Kotwica `#drugi-krok`** — cel z W-02 (po zalogowaniu kodem odzyskiwania), z W-03 i z M-02.
   - **E-mail i rola** tylko do odczytu („Adres e-mail zmienia administrator.” — zmiana adresu jest poza M1).
   - **Reguły metod** (EVM-028 AC4) — akcje wyłączone z podpowiedzią, co trzeba najpierw dodać.
   - **Kody odzyskiwania** — ostrzeżenie z akcją, gdy konto nie ma kodów (konta sprzed EVM-023) albo zostały ≤ 3. Nowe kody — lista jak W-03 krok 3, pokazana raz; w makiecie bez przykładowych wartości.
   - **Moje sesje:** przeglądarka i system, pełny IP (P9), ostatnia aktywność, oznaczenie „Ta sesja”, „Zakończ sesję” i „Zakończ pozostałe sesje”; przy jednej sesji — „Tylko ta sesja”.
   - **Urządzenia** — opis zakresu z adnotacją „od E9 — w M1 sekcja niewidoczna”.
8. **Administracja — zakładki** „Użytkownicy” (W-16) i „Dziennik audytu” (W-18) (Tabs, § 3.17); zakładka „Urządzenia” — od E9.
   - **W-16 — lista bez step-upu** (P2 wymaga go dla operacji, nie dla podglądu). Każda operacja: ActionMenu wiersza → dialog z podsumowaniem skutku (§ 4.11) → W-04.
   - **Własny wiersz** oznaczony „(Ty)”, **bez menu akcji `⋮`**: żadna z 7 operacji nie jest dozwolona na własnym koncie, a menu bez dozwolonej pozycji nie jest pokazywane (§ 3.20). Pod nazwą link „Przejdź do Konta” — własne sesje i drugi krok są w W-15, rolę i dezaktywację wykonuje inny administrator. (Poprawka po przeglądzie `web-developer`, runda 1 — wcześniej menu z samymi pozycjami wyłączonymi.)
   - **Ostatni aktywny Administrator** — ostrzeżenie nad tabelą „Jesteś jedynym aktywnym administratorem…”; `409 last_active_administrator` (wyścig) — alert w dialogu. `412` — „To konto zmieniono w międzyczasie…”.
   - **Reset drugiego kroku** — obowiązkowy wybór „Jak potwierdzono tożsamość?” (osobiście / w rozmowie wideo), przycisk danger.
   - **Skutki dla urządzeń** w dialogach zmiany roli i dezaktywacji — adnotacja „od E9”.
9. **Status konta i wynik zdarzenia audytu — ikona i etykieta tekstowa, nie StatusBadge.** Ikona `size.icon.sm` w roli `color.icon.*`, tekst `color.text.primary`.
   - Dlaczego nie odznaka: § 3.9 i § 4.4 obejmują tylko statusy zlecenia, etapu i płatności, a nowa grupa odznak wymaga nowych tokenów (styleguide 1.3.0 — poza AC7).
   - **Etykiety konta są bezosobowe** (§ 6.1): „Aktywne”, „Oczekuje na aktywację”, „Dezaktywowane”. „Zaproszony” odmienia się przez płeć, a `User` ma tylko `displayName`.
   - **Stan zaproszenia** jest osobną kolumną: „Wysyłanie…”, „Wysłano [data] · ważne do [data]”, „Nie wysłano” z „Wyślij ponownie”, „Wygasło [data]”.
10. **W-18.**
    - **Wejście** → W-04 „…, aby przejrzeć dziennik audytu”. Po „Anuluj” — EmptyState z „Potwierdź tożsamość”, bez danych.
    - **Filtry** tylko w pamięci karty — osoba to dane osobowe (§ 3.7). Domyślny okres — ostatnie 30 dni.
    - **Paginacja:** 25 zdarzeń na stronę, „Następna strona” / „Poprzednia strona” (kursor), bez licznika całkowitego (`api-guidelines.md`).
    - **Kolumny „Osoba” i „Obiekt”:**
      - osoba i obiekt-użytkownik — `displayName`;
      - zlecenie — numer;
      - inne obiekty — tylko typ, bez nazw klientów, adresów, nazw plików i treści;
      - nieudane logowanie na nieistniejące konto — „Nieznane konto”, nigdy wpisany e-mail;
      - zdarzenia systemowe — „System”.
    - **Nieznany kod akcji** — „Nieznana akcja”, bez surowej wartości (zasada § 3.9.1).
    - **IP** — prefiks /24 albo /48 (P9); czas — format § 6.3.
11. **E-maile.**
    - **Zwykły tekst** — bez HTML, obrazów i pikseli śledzących. E-mail nie jest UI panelu, więc nie potrzebuje tokenów.
    - **Bez wartości wpisanych przez użytkowników** (SR-INPUT-07): powitanie „Dzień dobry,” bez `displayName`; bez nazwy klucza dostępu.
    - **Link** wyłącznie do panelu, z adresu w konfiguracji serwera (nie z nagłówka `Host`).
    - **Czas zdarzenia** w `Europe/Warsaw`.
    - **Stopka** „Nigdy nie prosimy o hasło ani kody w e-mailu.”
    - **Alert dla Administratorów** nie wskazuje osoby — szczegóły są w W-18.
    - **Formy** bezosobowe: „zaproszono Cię”, „zalogowano się”.
12. **Bez zmian w styleguide'zie.**
    - Kolumna „Ekrany” w § 8 i w nagłówkach § 3.x to zapis makiet EVM-004 dla 1.2.0 — nie zmieniam jej.
    - README makiet dostaje notę: użycie komponentów w makietach E1 pokazują listy „Komponenty i tokeny” ekranów W-12–W-18.
    - Odświeżenie tych list — przy najbliższej wersji styleguide'u („Uwagi do rozważenia”).

**Do potwierdzenia przez `security-engineer`** (konsultacja planu albo przegląd; makiety opisują wariant rekomendowany)
- **S1 — kod odzyskiwania w pełnym ponownym uwierzytelnieniu (W-15).** Rekomendacja: dozwolony (zużywa kod, wysyła e-mail). Bez tego Administrator po utracie klucza zaloguje się kodem (W-02 → „Dodaj klucz dostępu”), ale nie doda nowego klucza i potrzebuje resetu przez innego Administratora. Step-up dla operacji z P2 zostaje bez kodu odzyskiwania (EVM-029 AC4). Dotyka uzasadnienia decyzji 16 — pytanie do Konrada na demo.
- **S2 — „Moje sesje” po step-upie** (okno 15 min), a nie po pełnym ponownym uwierzytelnieniu (SR-SESS-07: „po ponownym uwierzytelnieniu”).
- **S3 — e-mail konta w W-13 i W-12** (w W-13 także rola), pokazany dopiero po sprawdzeniu ważnego linku.
- **S4 — lista w W-16 bez step-upu**, operacje ze step-upem.
- **S5 — W-18:** `displayName` w kolumnie „Obiekt” dla użytkowników; „Nieznane konto” zamiast wpisanego e-maila.
- **S6 — e-maile „nowa przeglądarka” i „najstarsza sesja”:** rodzina przeglądarki i system ze słownika (nie surowy user agent) oraz czas, bez IP.
- **S7 — błędne hasło i kod w pełnym ponownym uwierzytelnieniu** liczą się do limitów SR-AUTH-05.

**Ustalenia z konsultacji** (`security-engineer`, 2026-10-04 — **approve**; bez zmian w plikach `docs/security/*`; `npm run docs:check` na drzewie przed implementacją: 0 błędów, 0 ostrzeżeń)
- **Zakres.** Historyjka bez kodu i endpointów — testy macierzy ról jej nie dotyczą; makiety są wejściem do kontraktów EVM-016, EVM-023–EVM-029, więc kontrole niżej są obowiązkowe w treści makiet i przechodzą do planów tamtych historyjek. Plan zgodny z P1, P2, P9, SR-AUTH-01/03/05/10–13, SR-SESS-04/07/08, SR-INPUT-07 i zasadą M1 „Tokeny w linkach jednorazowych”.
- **Zagrożenia:** TM-44 (przechwycenie linku), TM-16 / AB-01 (zgadywanie haseł i enumeracja, także przez ponowne uwierzytelnienie), AB-02 / TM-90 (phishing zaproszeniem; zaproszenie własnego konta jako Administrator), TM-23 (przejęta sesja wyrzuca ofiarę albo dopisuje metodę MFA), TM-24 (operacja administracyjna bez step-upu), AB-03, AB-22, TM-80 (dane i wstrzyknięcie w e-mailach, CWE-93), zatruty link z nagłówka `Host` (CWE-640), TM-21 / TM-49 / TM-86 (dane i pełne IP w audycie), TM-10 (współdzielony komputer), STRIDE R (podszycie nazwą wyświetlaną w W-18).
- **S1 — kod odzyskiwania w pełnym ponownym uwierzytelnieniu: decyduje Konrad** (zmienia uzasadnienie decyzji 16, ryzyko rezydualne). Warunki przy przyjęciu: (a) tylko web i tylko przed „Dodaj klucz dostępu” / „Dodaj kod z aplikacji” — nie przy usuwaniu metod, nowych kodach, zmianie hasła ani step-upie (EVM-029 AC4 bez zmian); (b) kod zużywany, e-maile „użyto kodu odzyskiwania” i „dodano metodę”, audyt, dla konta Administratora alert do wszystkich Administratorów (SR-LOG-07); (c) limity SR-AUTH-05. Makieta pokazuje oba warianty; w wariancie „niedostępny” W-02 po logowaniu kodem (A) podpowiada „Poproś innego administratora o reset drugiego kroku” (SR-AUTH-13). ASVS V6.4.4, V6.5.1–V6.5.4, V7.5.1. **Ryzyko rezydualne (tylko przy S1):** kradzież hasła i wydrukowanych kodów pozwala dopisać klucz napastnika — trwały dostęp, także do operacji ze step-upem; P1 × W3 = 3 Medium (major — akceptacja Konrada); wykrywanie: e-maile do użytkownika konta, alert do Administratorów, audyt. Bez S1 Administrator po utracie wszystkich kluczy zależy od drugiego Administratora albo trybu awaryjnego (AB-22, RR-16).
- **S2 — akceptuję:** „Moje sesje” po step-upie (okno 15 min; ASVS V7.5.2); step-up obowiązkowy przy zakończeniu wybranej i pozostałych sesji; lista z pełnym IP (P9) też za step-upem.
- **S3 — akceptuję:** e-mail konta w W-13 i W-12, rola w W-13 — wyłącznie po sprawdzeniu ważnego tokenu na serwerze (`POST`, bez zużycia); stan przed odpowiedzią i link nieważny bez e-maila, nazwy i roli; `displayName` nigdzie; sprawdzenie linku z limitem 60/min/IP (P10) — stan `429`; W-12 i W-13 bez zasobów i linków zewnętrznych. ASVS V6.4.1, V14.2.1; CWE-204.
- **S4 — akceptuję:** lista W-16 bez step-upu, operacje ze step-upem (P2, macierz `User`); lista tylko dla Administratora w web (E, R — `403`, niezalogowany — `401`); w liście bez IP i szczegółów sesji i metod MFA innych osób; każda z 7 operacji przez W-04 — decyduje serwer (`403 step_up_required`), UI nie zapamiętuje ważności step-upu; macierz: W-16 „lista; operacje ↑”, W-18 „wejście ↑”. ASVS V8.2.1, V8.4.2.
- **S5 — akceptuję:** `displayName` w kolumnie „Obiekt”, „Nieznane konto” w W-18; audyt przechowuje tylko identyfikatory (nazwa rozwiązywana przy odczycie — SR-LOG-03); wpisany e-mail nieistniejącego konta nigdy zapisany ani pokazany; konto zanonimizowane — etykieta bez wartości; filtr „Osoba” — wybór konta po identyfikatorze, nie pole tekstowe; IP tylko jako prefiks, bez łączenia z pełnym IP sesji. ASVS V16.2.5, V16.3.1; CWE-532.
- **S6 — akceptuję:** e-maile „nowa przeglądarka” i „najstarsza sesja” — przeglądarka i system z zamkniętego słownika z wartością „Nieznana przeglądarka”, nigdy surowy User-Agent (SR-INPUT-07); bez IP i geolokalizacji; czas `Europe/Warsaw`; ten sam słownik w „Moje sesje”. ASVS V1.3.11, V6.3.5.
- **S7 — obowiązkowe:** błędne hasło i kod w pełnym ponownym uwierzytelnieniu liczą się do limitów SR-AUTH-05; w W-04 i „Zmień hasło” stany „Hasło jest nieprawidłowe”, blokada 15 min i `429` z `Retry-After`. Rekomendacja dla EVM-026 i EVM-028: blokada osiągnięta przy ponownym uwierzytelnieniu kończy sesję, z której szły próby. ASVS V6.3.1; CWE-307.
- **Obowiązkowe kontrole w treści makiet (1–12):** (1) W-12, W-13 — token tylko we fragmencie, usuwany z paska adresu, tylko w `POST`; odświeżenie = link nieważny; jeden komunikat dla linku użytego, wygasłego, zastąpionego, zmienionego i bez tokenu; bez „Kopiuj link” (SR-API-04, SR-AUTH-11, -12; CWE-598). (2) Hasło: min. 15 znaków, bez `maxlength` < 128, bez przycinania (wyłączone z SR-INPUT-05), wklejanie i „Pokaż”, `new-password` / `current-password` + `username` tylko do odczytu, bez reguł złożoności, pytań i podpowiedzi, jeden komunikat odrzucenia bez wskazania listy i bez powtórzenia hasła. (3) Po W-12 → W-02 (reset nie omija MFA), informacja o zakończonych sesjach, „Wyślij nowy link” → W-01 bez wpisanego e-maila (V6.4.3). (4) W-13 przy innej zalogowanej osobie — informacja o wylogowaniu, po aktywacji nowa sesja (SR-SESS-02). (5) W-15 — zmiany drugiego kroku po pełnym ponownym uwierzytelnieniu za każdym razem; zmiana hasła z bieżącym hasłem i drugim krokiem, potem „Zakończ pozostałe sesje” (V7.5.1, V7.4.3, CWE-620); Administrator w W-04 — tylko klucz dostępu; reguły ostatniej metody (EVM-028 AC4); nowe kody raz, bez przykładowych wartości; hasła i kody tylko w pamięci karty, czyszczone po sukcesie, „Anuluj” i wylogowaniu (SR-WEB-05); nazwa wyświetlana (≤ 200) i nazwa klucza — zwykły tekst. (6) „Moje sesje” — nieprzezroczysty identyfikator rekordu, nigdy token ani skrót; pełny IP tylko własnych sesji; IP w makietach z RFC 5737 / RFC 3849. (7) W-16 — każda z 7 operacji: dialog z podsumowaniem, potem W-04; własny wiersz i ostatni aktywny Administrator — pozycje wyłączone z podpowiedzią, stany `409 last_active_administrator` i `412`, egzekwuje serwer (EVM-027 AC5–AC6); reset drugiego kroku — zamknięta lista (osobiście / wideo), bez notatki; Administrator nigdy nie widzi linku ani tokenu zaproszenia; bez IP w liście; adnotacja „od E9” o skutkach dla urządzeń przy zmianie roli na Tylko odczyt i dezaktywacji (P2). (8) W-18 — wejście przez W-04, po „Anuluj” bez danych (zalecane czyszczenie strony po końcu okna); bez eksportu, druku i kopiowania zbiorczego (eksport — osobna historyjka, P10); filtry tylko w pamięci karty; kursor po 25, bez licznika całkowitego; przykłady bez e-maili, nazw klientów, adresów, nazw plików i pełnych IP; „Osoba” rozróżnia konta o tej samej nazwie (np. odnośnik do W-16 po identyfikatorze — minor, STRIDE R). (9) Stany: E i R przy bezpośrednim adresie Administracji — `403` z `lock` bez danych; W-12 i W-13 — `429` i offline; tytuły kart bez danych osobowych. (10) E-maile — zwykły tekst ze stałych szablonów; bez `displayName`, nazw kluczy, danych klientów, IP i surowego User-Agent; link z adresu panelu w konfiguracji, nie z `Host` (CWE-640), token tylko we fragmencie; ważność linku, stopka antyphishingowa, formy bezosobowe, adres panelu jako tekst; w zasadach: u dostawcy wyłączone śledzenie otwarć i kliknięć (wymóg też dla EVM-007 i EVM-024); alerty dla Administratorów także o zaproszeniu z rolą Administrator, reaktywacji konta Administratora (AB-02) i zmianie drugiego kroku konta Administratora (SR-LOG-07; przy S1 — kontrola kompensująca). (11) Dane syntetyczne: „Anna Testowa”, „Jan Przykładowy”, `example.com`; bez wartości tokenów i kodów; Mermaid renderowany lokalnie. (12) W-12–W-18 tylko web; step-up, zmiana hasła i zmiany MFA nie występują w aplikacji mobilnej (SR-AUTHZ-12).
- **Do planów E1 (poza EVM-015):** macierz ról A / E / R / niezalogowany × kanał z przypadkiem IDOR dla: sprawdzenia i użycia linku (operacje publiczne, limit P10), operacji W-15 (cudza sesja albo klucz po ID → `404`), 7 operacji W-16 (`stepUp: true`, `channels: [web]`, operacje na własnym koncie odrzucane), odczytu W-18 (step-up i audyt odczytu); dowód pełnego ponownego uwierzytelnienia jednorazowy, z krótkim TTL, związany z sesją i konkretną operacją (nie okno czasowe); test „hasło nie jest przycinane”.
- **Uwagi `security-engineer` poza EVM-015:** (a) brak AC alertu dla Administratorów w EVM-024 i EVM-027 (zaproszenie i reaktywacja z rolą Administrator) oraz w EVM-028 AC3 (zmiana drugiego kroku Administratora); (b) zachęta „Dodaj klucz dostępu” w EVM-023 AC5 zależy od decyzji 16 / S1; (c) doprecyzowanie SR-SESS-07 (S2), SR-AUTHZ-11 (S4), a po decyzji 16 także SR-AUTH-08, SR-AUTH-10 i modelu zagrożeń — osobną zmianą `security-engineer`.

**Realizacja ustaleń w makietach** (ux-designer): S1 — [01](../../ux/flows/01-logowanie-mfa.md) W-02 (oba warianty) i W-04 („Trzy zastosowania”), [12](../../ux/flows/12-konto-i-administracja.md) W-15; S2, S6 — W-15 „Moje sesje”, [e-maile](../../ux/flows/e-maile.md) 7 i 8; S3, kontrole 1–4 — [11](../../ux/flows/11-aktywacja-i-reset-hasla.md) („Zasady wspólne W-12 i W-13”, „Pole nowego hasła”); S4, kontrola 7 — W-16 (po przeglądzie `web-developer`, runda 1: własny wiersz bez menu akcji — § 3.20 — z linkiem „Przejdź do Konta” zamiast pozycji wyłączonych; komunikat ostatniego aktywnego Administratora — ostrzeżenie nad tabelą i alert `409`; **do potwierdzenia przez `security-engineer`**); ustalenie z przeglądu `security-engineer` (runda 1) — okno konfiguracji drugiego kroku po resecie: [11](../../ux/flows/11-aktywacja-i-reset-hasla.md) „Konto bez drugiego kroku”, W-01, W-03, M-02, W-16 dialog 7, e-mail 5; S5, kontrola 8 — W-18 („Zasady komórek”, „Filtry”); S7 — W-04 i W-15 (stany „Błąd”); kontrole 9–12 — tabele stanów, [e-maile](../../ux/flows/e-maile.md) „Zasady treści e-maili”, „Dane w makietach” w `flows/README.md`.

**Plan sprawdzenia AC** — inspekcja (QA); testów kodu nie ma.
| AC | Jak sprawdzić |
|---|---|
| AC1 | W `11` sekcja W-13 ma 10 bloków formy EVM-004. Mikrocopy zawiera „15 znaków” i „Pokaż”. Dostępność opisuje wklejanie, `autocomplete` `username` / `new-password`. Diagram i tabela stanów prowadzą do W-03. Link użyty, wygasły, zmieniony i bez tokenu dają ten sam tekst „Link jest nieważny lub wygasł.” — bez e-maila, nazwy i roli |
| AC2 | W-12 ma te same bloki. Po zapisie → W-02, nie W-10 (bez drugiego kroku → W-03 tylko w oknie konfiguracji po resecie przez Administratora; poza oknem brak linku i komunikat W-01 „Konfiguracja drugiego kroku wygasła…”). Jest komunikat o zakończonych sesjach i ważność linku 30 min |
| AC3 | W-15 ma Profil (nazwa wyświetlana), Hasło, Drugi krok logowania (klucze z nazwą i datą dodania, „Dodaj klucz dostępu”, „Usuń…”, kod z aplikacji, nowe kody) i Moje sesje (wybrana, pozostałe, „Ta sesja”). Każda zmiana drugiego kroku przechodzi przez W-04 „pełne ponowne uwierzytelnienie”. Urządzenia są oznaczone „od E9” |
| AC4 | W-16 ma 6 kolumn z AC i 7 operacji (zaproszenie, ponowne wysłanie, zmiana roli, dezaktywacja, reaktywacja, wylogowanie ze wszystkich sesji, reset drugiego kroku). Każda operacja ma dialog z podsumowaniem i tytuł W-04 z listy w `01`. Reset drugiego kroku wymaga wyboru sposobu potwierdzenia tożsamości i podaje termin konfiguracji. Jest komunikat ostatniego aktywnego Administratora (ostrzeżenie „Jesteś jedynym aktywnym administratorem…” nad tabelą + alert `409` w dialogu); własny wiersz „(Ty)” nie ma menu akcji (§ 3.20) i ma link „Przejdź do Konta” |
| AC5 | W-18 ma kolumny: czas, osoba, akcja, wynik, obiekt, IP z prefiksem /24 lub /48; filtry: akcja, osoba, wynik, okres; paginację kursorem bez licznika całkowitego; wejście przez W-04. W przykładach nie ma e-maili, nazw klientów, adresów, nazw plików ani pełnych IP |
| AC6 | W `e-maile.md` każdy typ z listy AC6 ma temat i treść, a treści zawierają tylko link do panelu i informację o zdarzeniu. Brak `displayName`, nazw klientów i adresów. Wyszukiwanie form z płcią (`łeś`, `łaś`, `zmienił`, `zaprosił`, `zresetował` i warianty żeńskie) w `e-maile.md`, `11`, `12` → 0 trafień |
| AC7 | Wyszukiwanie w nowych i zmienionych plikach: `#[0-9a-fA-F]{3,8}\b`, liczby z `px` / `dp` / `rem` / `pt`, nazwy fontów → 0 trafień. Każdy element z „Komponenty i tokeny” wskazuje § 1.2.0. W-03 ma oba warianty, a W-04 — tytuły nowych operacji. W `flows/README.md` „bez makiety” stoi tylko przy W-14, W-17 („— E9”), W-19, W-20 i M-11. Mapa i macierz są zgodne z tabelą „Ekrany” |
| AC8 | Dane: osoby jak w „Dane w makietach”, e-maile `example.com`, IP z RFC 5737 / RFC 3849; brak ciągów przypominających tokeny i kody (gitleaks w hooku). Wszystkie nowe i zmienione diagramy Mermaid renderują się lokalnie (`.scratch/EVM-002/mmdc` albo równoważnie, bez serwisów online). `npm run docs:check` — 0 błędów (orkiestrator) |

**Kolejność kroków**
1. Konsultacja `security-engineer` (S1–S7) — równolegle z krokiem 2. Ustalenia trafiają do „Ustaleń z konsultacji” w tym planie.
2. `ux-designer`: `11` (W-13, W-12).
3. `ux-designer`: `12` (W-15, W-16, W-18, etykiety akcji).
4. `ux-designer`: `e-maile.md`.
5. `ux-designer`: `01` (W-03, W-04, odnośniki).
6. `ux-designer`: `flows/README.md`, `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`, „Dziennik”.
7. `product-owner`: `domain.md` — pojęcia w brzmieniu z makiet.
8. Samokontrola `ux-designer` — wyszukiwania z planu sprawdzenia (AC6–AC8).
9. Przekazanie. `ux-designer` i `product-owner` nie mają powłoki, więc zmiany zostają w drzewie roboczym:
   - `npm run docs:check`, `npm run test:tools` i lokalny render Mermaid uruchamia orkiestrator;
   - QA i recenzenci przeglądają `git diff main` oraz `git status --porcelain` (nowe pliki są nieśledzone);
   - commit robi agent z powłoką: tylko jawne ścieżki z „Zakresu zmian”, hook pre-commit bez `--no-verify`.

## Decyzje
_—_

## Uwagi do rozważenia
1. **Decyzja 16 / S1 — dla Konrada (demo).** Czy kod odzyskiwania może zastąpić drugi krok w pełnym ponownym uwierzytelnieniu wyłącznie przed „Dodaj klucz dostępu” / „Dodaj kod z aplikacji” (warunki (a)–(c) w „Ustaleniach z konsultacji”)? Makiety pokazują oba warianty (W-02, W-04, W-15). Rekomendacja `ux-designer`: **przyjąć z warunkami** — Administrator i pracownik po utracie metody sami ją odtworzą, a wykrywanie zapewniają e-maile, alert i audyt; ryzyko rezydualne 3 Medium wymaga akceptacji Konrada. Wariant „niedostępny” jest wykonalny, jeśli jest drugi Administrator (decyzja 7). Step-up (W-04) bez kodu odzyskiwania w obu wariantach (EVM-029 AC4).
   - **Stanowisko `product-owner` (2026-10-04): odrzucić S1** — kod odzyskiwania niedostępny w każdym ponownym uwierzytelnieniu, decyzja 16 bez zmian. Powód: przy dwóch kluczach dostępu Administratora (decyzja 3) i drugim Administratorze albo koncie awaryjnym (decyzja 7 — i tak warunek pilota realnego) utrata wszystkich metod jest rzadka, a jej obsługa to jeden reset przez innego Administratora (SR-AUTH-13). S1 dokłada warianty do EVM-023 i EVM-028 i ryzyko rezydualne 3 Medium. Konsekwencja: obowiązuje wariant „S1 odrzucone” w W-02, kod odzyskiwania znika z W-04 i W-15, a EVM-023 AC5 zmienia zachętę (uwaga 2). Ponowna ocena po pilocie, jeśli resety okażą się częste. Alternatywa (rekomendacja `ux-designer`) — przyjąć S1 z warunkami (a)–(c) i zaakceptować ryzyko rezydualne.
   - **Drobna luka do uzupełnienia przez `ux-designer` po decyzji 16 (nie blokuje AC):** W-02 po logowaniu kodem odzyskiwania ma podpowiedź tylko dla Administratora. W wariancie „S1 odrzucone” Edytor i Tylko odczyt bez żadnej działającej metody też potrzebują wskazówki, np. „Jeśli nie masz już żadnej metody, poproś administratora o reset drugiego kroku logowania.”
2. **Rozbieżności brzmienia w historyjkach E1 — dla `product-owner`:**
   - status „Zaproszony” (EVM-016 AC1, EVM-024 AC1) — w UI „Oczekuje na aktywację” (forma bezosobowa, § 6.1; `User.status = invited`);
   - komunikat `412` w EVM-027 AC8 cytuje osobową formę wzorca § 4.9 — makieta W-16: „To konto zmieniono w międzyczasie. Sprawdź jego aktualny stan i wybierz operację ponownie.” (forma bezosobowa, znaczenie bez zmian);
   - EVM-023 AC5 („z zachętą Dodaj klucz dostępu”) zależy od decyzji 16 / S1 (uwaga 1);
   - brak AC alertów dla Administratorów: EVM-024 i EVM-027 (zaproszenie i reaktywacja z rolą Administrator), EVM-028 AC3 (zmiana drugiego kroku Administratora) — treści są w `flows/e-maile.md` (alert 9); dopisanie AC to zmiana zakresu tamtych historyjek (akceptacja Konrada).
   - **Stanowisko `product-owner` (2026-10-04):** brzmienie z makiet przyjmuję (słownik → „Status konta”), a alerty warto dopisać: koszt jest mały, bo to ten sam mechanizm co w EVM-027 AC7, a wartość to wykrycie utrwalenia dostępu (AB-02). Proponowane zmiany AC — do akceptacji Konrada; liczba AC się nie zmienia. Po akceptacji wprowadza je orkiestrator przed `/deliver` tych historyjek, z wpisem w ich „Dzienniku”:
     - EVM-016 AC1, EVM-024 AC1: „status „Zaproszony”” → „status „Oczekuje na aktywację” (`invited`)”;
     - EVM-027 AC8: „(„Ktoś zmienił to konto w międzyczasie…”)” → „(komunikat z makiety W-16)”;
     - EVM-023 AC5 — zależnie od decyzji 16: S1 przyjęte — bez zmian; S1 odrzucone — „(Administrator — z podpowiedzią „Poproś innego administratora o reset drugiego kroku logowania.”)”;
     - EVM-024 AC1 — dopisać: „Oraz gdy zaproszenie (także wysłane ponownie) ma rolę Administrator, wszyscy aktywni Administratorzy dostają alert bezpieczeństwa (SR-LOG-07).”;
     - EVM-027 AC7: „Gdy ktoś zostaje albo przestaje być Administratorem (także przez reaktywację konta z rolą Administrator), albo drugi krok Administratora jest resetowany”;
     - EVM-028 AC3 — dopisać: „…a zmiana na koncie Administratora wysyła też alert bezpieczeństwa do wszystkich aktywnych Administratorów (SR-LOG-07).”
3. **Do planów E1 — pytania z makiet:**
   - EVM-016 — skąd nazwa wyświetlana pierwszego Administratora (polecenie przyjmuje e-mail, W-13 nie zbiera nazwy); rekomendacja: polecenie pyta o nazwę na terminalu (TTY), jak o e-mail;
   - EVM-016 / EVM-024 / EVM-025 — sprawdzenie linku przy wczytaniu (`POST` bez zużycia) jako osobna operacja; bez niej W-12 / W-13 pokazują formularz bez e-maila konta, a błąd linku — po zapisie;
   - EVM-027 — zmiana roli na Administrator konta, które ma tylko kod z aplikacji: Administrator loguje się w panelu wyłącznie kluczem dostępu (P1), więc plan (z `security-engineer`) ustala, jak takie konto doda klucz przy następnym logowaniu; dialog „Zmień rolę” dopisze wtedy jedno zdanie o skutku;
   - EVM-028 — kod `403` pełnego ponownego uwierzytelnienia (odrębny od `step_up_required`), limit długości nazwy klucza, kolejność sprawdzeń przy zmianie hasła (bieżące hasło → reguły nowego → drugi krok);
   - EVM-029 — czas końca okna step-upu w odpowiedzi, żeby W-18 czyścił stronę po 15 min (zalecenie S4 / kontrola 8); kody akcji audytu i mapa etykiet — tabela „Etykiety akcji E1” w `flows/12` (kolejne historyjki z audytem dopisują swoje etykiety).
   - **Stanowisko `product-owner` (preferencje produktowe; mechanizmy ustalają plany):**
     - EVM-016 — popieram rekomendację: polecenie pyta o nazwę wyświetlaną na terminalu, tak jak o e-mail;
     - EVM-027 — zmiana roli na Administrator dla konta bez klucza dostępu ma być dozwolona; konto dodaje klucz przy najbliższym logowaniu w panelu (jak W-03 „przed EVM-023”); sposób ustala plan razem z `security-engineer`;
     - EVM-028 — lista „Moje sesje” dopiero po step-upie (S2) mieści się w AC6 („po ponownym uwierzytelnieniu kończy…”), więc AC się nie zmienia. Plan EVM-028 obejmuje step-up także dla samej listy, a tę uciążliwość akceptuję (pełny IP — P9).
4. **Styleguide — przy najbliższej wersji (rozstrzygnięcie 12):** odświeżyć kolumnę „Ekrany” (§ 8 i nagłówki § 3.x) o W-04, W-12–W-18 (m.in. ActionMenu § 3.20 w W-16, pole kodu § 3.2.1 w W-15, EmptyState § 3.15 w W-12, W-13, W-18); rozważyć bezosobową formę komunikatu konfliktu w § 4.9 i § 6.4 („…zmieniono w międzyczasie”) — spójność z § 6.1; ujednolicić zasadę akcji primary: § 2.1.3 mówi „na widok / sekcję / dialog”, a § 3.1 — „na widok / dialog” (makiety E1 stosują węższą regułę z § 3.1 — W-15 po przeglądzie `web-developer`, runda 1). Makiety E1 nie potrzebują nowych tokenów ani komponentów; styleguide 1.2.0 bez zmian i bez odstępstw.
5. **Mikrocopy W-15 względem planu (rozstrzygnięcie 7):** „Adres e-mail zmienia administrator.” → „Zmianę adresu e-mail zgłoś administratorowi.” — w M1 adresu nie zmienia nikt (obejście: nowe zaproszenie i dezaktywacja starego konta), więc pierwsze brzmienie byłoby nieprawdziwe.
   - **`product-owner`:** potwierdzam nowe brzmienie i obejście w M1. Zmiana adresu e-mail konta zostaje kandydatem poza M1 (README M1 → „Świadome przesunięcia”).
6. **Okno konfiguracji drugiego kroku po resecie — do planów EVM-025 i EVM-027** (ustalenie `security-engineer` z przeglądu, runda 1; makiety: `11` → „Konto bez drugiego kroku”):
   - **TTL okna** liczony od resetu przez Administratora — rekomendacja ≤ 24 h (makiety i e-mail 5 pokazują 24 h), najlepiej konfiguracja od razu, w trakcie rozmowy weryfikującej tożsamość; ponowny reset otwiera nowe okno; kod odpowiedzi logowania po końcu okna (W-01 „Konfiguracja drugiego kroku wygasła…”, M-02) — plan EVM-027;
   - **EVM-025:** konto bez drugiego kroku poza oknem nie dostaje linku resetu (odpowiedź W-01 bez zmian, bez enumeracji); link wydany w oknie wygasa najpóźniej z końcem okna;
   - **testy:** „po upływie okna brak linku resetu i brak W-03” (reset hasła i logowanie samym hasłem), „link wydany w oknie nie działa po jego końcu”, „ponowny reset otwiera nowe okno”;
   - **EVM-016 / EVM-024:** konto po W-13 bez dokończonego W-03 ma status „Oczekuje na aktywację” (`invited`), więc nie dostaje linku resetu — inaczej ta sama luka dotyczyłaby aktywacji;
   - aktualizację SR-AUTH-13 i TM-44 robi `security-engineer` osobną zmianą.

7. **Ustalenia nieblokujące z weryfikacji (runda 2: `qa-engineer`, `web-developer`, `security-engineer`) — do decyzji na demo:** poprawka w EVM-015 przed merge albo przeniesienie do planów E1. Nowych pozycji backlogu nie proponuję — wszystkie mieszczą się w EVM-015 albo w planach istniejących historyjek E1.
   - (a) W-13 „Link nieważny” — treść pasuje tylko do zaproszenia; pierwszy Administrator (EVM-016) dostaje link z polecenia na serwerze → jedna neutralna treść dla obu ścieżek (QA, minor).
   - (b) W-16 — reaktywacja konta nigdy nieaktywowanego: status po reaktywacji i droga do aktywacji nieokreślone (QA, minor; przypadek testowy do planu EVM-027).
   - (c) W-02 w `01` nie ma komunikatów po resecie hasła opisanych w `11` (tabela „Pokrycie EVM-015” wskazuje `01`) → odnośnik w W-02 albo poprawka tabeli pokrycia (QA, minor).
   - (d) `e-maile.md` — reguła kodowania: `text/plain; charset=UTF-8`, temat wg RFC 2047; test z polskimi znakami w Mailpit w EVM-007 / EVM-024 (QA, minor).
   - (e) W-15 — dwa przyciski „Zmień hasło” (przełącznik i zapis) o tej samej nazwie dostępnej; brak opisu fokusu po „Anuluj” i po sukcesie (QA i `web-developer`, minor).
   - (f) Kontrola 7 w „Ustaleniach z konsultacji” — adnotacja o formie zatwierdzonej przez `security-engineer` w rundzie 2 (własny wiersz bez menu, link do Konta) (`web-developer`, minor).
   - (g) W-16 offline — odwołanie do § 3.20 zamienić na § 3.1 i § 4.10 (wyłączony wyzwalacz z podpowiedzią; ukrywanie z § 3.20 dotyczy uprawnień) (`web-developer`, nit).
   - (h) Konto „Oczekuje na aktywację” z ustawionym hasłem, bez W-03 — logowanie do W-03 ograniczone ważnością zaproszenia (72 h), potem komunikat „Zaproszenie wygasło…”; do planów EVM-016 i EVM-024 z testem (`security-engineer`, minor, ryzyko 2 Low).
   - (i) Do planów: `If-Match` / `412` przy zapisie nazwy wyświetlanej w W-15 (EVM-028); daty wokół zmiany czasu i data przy godzinie końca ważności w e-mailach (EVM-024, EVM-025, EVM-027); dopasowanie w filtrze „Osoba” bez względu na wielkość liter i polskie znaki (EVM-029) (QA, nit).
   - (j) Tabela „Bezpieczeństwo i prywatność” tej historyjki: „W-16 i W-18 po step-upie” → zgodnie z S4 „W-16 — lista; operacje po step-upie; W-18 po step-upie” (QA, nit).

## Definition of Done
- [x] AC1–AC8 spełnione (weryfikacja QA przez inspekcję) — `qa-engineer` runda 2: PASS AC1–AC8; orkiestrator 2026-10-04: `npm run docs:check` 0 błędów / 0 ostrzeżeń (165 plików), `npm run test:tools` 328/328 (99,95% linii, 98,09% gałęzi), lokalny render Mermaid 7/7 (mermaid-cli 12.0.0, Chromium lokalnie), linki i kotwice — 0 zepsutych, tokeny 55 / 0 brakujących, § styleguide'u 29 / 0 brakujących, dane syntetyczne (`example.com`, `firma.test`, IP z RFC 5737 / 3849)
- [x] Przeglądy: web-developer, security-engineer — APPROVE (runda 2; runda 1: 3 × major naprawione — jeden primary w W-15, własny wiersz W-16 bez menu, okno konfiguracji drugiego kroku po resecie)
- [x] `CHANGELOG.md` zaktualizowany (Unreleased → Dodano, wpis EVM-015)
- [ ] Demo i akceptacja Konrada

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-04 — ready → in-progress: start `/deliver` (orkiestrator; sesja w chmurze — gałąź robocza `claude/relaxed-franklin-7owvdc` zamiast `feature/EVM-015-…`)
- 2026-10-04 — plan techniczny (ux-designer)
- 2026-10-04 — konsultacja `security-engineer` (approve): S2–S7 zaakceptowane z warunkami, S1 do decyzji Konrada (decyzja 16), kontrole 1–12 — zapis w „Ustaleniach z konsultacji”
- 2026-10-04 — implementacja (ux-designer): nowe `docs/ux/flows/11-aktywacja-i-reset-hasla.md` (W-13, W-12), `12-konto-i-administracja.md` (W-15, W-16, W-18, etykiety akcji E1) i `e-maile.md` (zasady i 9 szablonów); w `01-logowanie-mfa.md` W-01 (odnośnik do W-12, pusty formularz resetu), W-02 (wariant zależny od decyzji 16 — wymóg S1, poza pierwotnym zakresem pliku), W-03 (warianty „przed EVM-023” i „od EVM-023”), W-04 (trzy zastosowania, tytuły operacji E1, stany S7); `flows/README.md` (mapa, „Ekrany”, macierz, zasady 14–15, „Dane w makietach”, „Pokrycie EVM-015”, polityki P1, P2, P9, nota do propozycji), `docs/ux/README.md`, `docs/README.md`, `CHANGELOG.md`; „Uwagi do rozważenia” 1–5. Zmiany w drzewie roboczym bez commitu (agent bez powłoki); `npm run docs:check`, `npm run test:tools` i lokalny render Mermaid — orkiestrator; `domain.md` — `product-owner`
- 2026-10-04 — implementacja (product-owner): w `docs/product/domain.md` nowa sekcja „Pojęcia z makiet E1 (dodane w EVM-015)” — 13 pojęć w brzmieniu z makiet, w tym 8 z planu oraz nazwa wyświetlana, blokada konta, link do ustawienia nowego hasła, reset drugiego kroku logowania i alert bezpieczeństwa. Status konta mapuje się na `User.status` (`active` / `invited` / `deactivated`) — w modelu nie ma typu `UserStatus`. Dodano też odnośnik w nagłówku słownika i wzmiankę o słowniku we wpisie EVM-015 w `CHANGELOG.md`. W „Uwagach do rozważenia” 1–3 i 5 jest stanowisko `product-owner`: S1 odrzucić; brzmienie z makiet i alerty dla Administratorów jako zmiany AC w EVM-016, EVM-023, EVM-024, EVM-027 i EVM-028 do akceptacji Konrada. Zmiany zostały w drzewie roboczym bez commitu (agent bez powłoki), a `npm run docs:check` uruchamia orkiestrator
- 2026-10-04 — poprawki po przeglądach, runda 1 (ux-designer): (1) W-15 — jeden primary na widok (§ 3.1): akcje kart „Zapisz”, „Dodaj klucz dostępu”, „Zakończ pozostałe sesje” jako secondary, primary tylko „Zmień hasło” w rozwiniętym formularzu (`web-developer`, major); (2) W-16 — własny wiersz „(Ty)” bez menu akcji (§ 3.20) z linkiem „Przejdź do Konta”, offline — wyłączone wyzwalacze `⋮` zamiast pozycji; plan sprawdzenia AC4 poprawiony; forma kontroli 7 do potwierdzenia przez `security-engineer` (`web-developer`, major); (3) okno konfiguracji drugiego kroku po resecie przez Administratora: `11` (diagram, „Po zapisie”, role, nowa sekcja „Konto bez drugiego kroku”), `01` (W-01, W-03, M-02), `12` (dialog 7), `e-maile.md` (e-mail 5), `flows/README.md` (mapa, P1, P2), `domain.md` (link do ustawienia nowego hasła, reset drugiego kroku), rozstrzygnięcie 4, plan sprawdzenia AC2, „Uwagi do rozważenia” 6 (`security-engineer`, major); „Uwagi do rozważenia” 4 — ujednolicenie § 2.1.3 i § 3.1. Styleguide i tokeny bez zmian. Zmiany w drzewie roboczym bez commitu (agent bez powłoki); `npm run docs:check` i render Mermaid — orkiestrator
- 2026-10-04 — weryfikacja (workflow `deliver-story`, 2 rundy): runda 1 — QA PASS, `web-developer` i `security-engineer` changes_required (3 × major), poprawki `ux-designer`; runda 2 — QA PASS AC1–AC8, `web-developer` i `security-engineer` APPROVE; 14 ustaleń nieblokujących → „Uwagi do rozważenia” 7
- 2026-10-04 — Konrad zgodził się na wypychanie gałęzi roboczej `claude/relaxed-franklin-7owvdc` w trakcie realizacji (bez force, bez PR przed akceptacją; sesja w chmurze)
- 2026-10-04 — in-progress → in-review: weryfikacja orkiestratora (`docs:check` 0/0, `test:tools` 328/328, Mermaid 7/7, linki, tokeny i § styleguide'u, dane syntetyczne), DoD bez demo; demo dla Konrada z decyzją 16 / S1 i zmianami AC w EVM-016, EVM-023, EVM-024, EVM-027, EVM-028
