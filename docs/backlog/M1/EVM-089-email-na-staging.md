---
id: EVM-089
title: E-mail transakcyjny na jedynym środowisku — Scaleway TEM, strażnik odbiorców, SPF / DKIM / DMARC
type: enabler
milestone: M1
epic: E1 Dostęp i użytkownicy
status: ready
priority: P0
path: pelna            # wysyłka do realnych adresów (dane osobowe, przepływy uwierzytelniania), infrastruktura, DNS
owner: devops-engineer
contributors: [backend-developer]
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: [EVM-007, EVM-024]
---

# EVM-089: E-mail transakcyjny na jedynym środowisku — Scaleway TEM, strażnik odbiorców, SPF / DKIM / DMARC

> Część „staging” wydzielona z EVM-024 (2026-10-16), wzorem podziału EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md). Lokalna kolejka `email`, port e-mail i Mailpit — EVM-024.
> **Zmiana 2026-11-13 (decyzja Konrada: jedno środowisko, realni użytkownicy od pierwszego dnia):** aktualny staging (`staging.eviacharge.pl`) jest jedynym środowiskiem i od startu obsługuje realnych użytkowników (Konrad i biuro), więc to jest **następny obowiązkowy element po EVM-124** — zaproszenia idą wyłącznie e-mailem. Lista dozwolonych adresów (decyzja 15) przestaje być jedynym trybem — AC2. Zależność od EVM-076 usunięta (kanał wdrożeń działa — EVM-007 `done`; test dymny to osobna sprawa).

## Cel
Jako **właściciel produktu** chcę **żeby zaproszenia, reset hasła i e-maile bezpieczeństwa docierały na prawdziwe adresy pracowników biura przez Scaleway TEM**, aby **biuro mogło założyć konta i pracować w systemie bez ręcznego przekazywania linków**. Kod adaptera TEM może wytworzyć `backend-developer` (współpraca z `devops-engineer`).

## Kryteria akceptacji
**AC1 — Wysyłka przez TEM do prawdziwych adresów**
- Zakładając działające środowisko z EVM-007, port e-mail z EVM-024 i zweryfikowaną domenę nadawczą (AC3)
- Gdy Administrator zaprasza osobę z biura na jej adres, a ona prosi o reset hasła
- Wtedy oba e-maile docierają do skrzynki przez adapter Scaleway TEM, a link z tokenem we fragmencie jest nienaruszony; klucz dostępu do TEM jest tylko plikiem sekretu na VM (`/etc/evia/secrets/`, dostarczony w kolejnej sesji na VM) — nie w repozytorium, obrazach ani logach; TEM przez HTTP API na porcie 443 (decyzja 2026-10-21).

**AC2 — Strażnik odbiorców (SR-API-13)**
- Zakładając tryb wysyłki w konfiguracji poza repozytorium: `lista` (domyślny, deny-by-default: adres spoza listy i pusta lista = przechwycenie lokalne) albo `otwarty` (każdy poprawny adres poza zarezerwowanymi)
- Gdy system próbuje wysłać e-mail na adres spoza listy (tryb `lista`) albo na `example.com` / `.test` / inną domenę zarezerwowaną (każdy tryb)
- Wtedy wiadomość nie opuszcza środowiska przez TEM, jest przechwycona lokalnie (bez treści w logach), a zadanie nie kończy się błędem ani ponowieniami; dzięki temu dane syntetyczne (adresy `.test`) nigdy nie wysyłają poczty, a pracownicy biura nie są blokowani listą.
- Oraz adapter TEM da się zbudować wyłącznie razem ze strażnikiem odbiorców, a przechodzi wspólny zestaw testów kontraktu portu z EVM-024; tryb `otwarty` jest włączany wyłącznie świadomą zmianą konfiguracji na VM, a zaproszenie można wysłać tylko z konta Administratora (inne role i niezalogowany — odmowa, test macierzy ról z EVM-024 pozostaje zielony).

**AC3 — Uwierzytelnienie domeny nadawczej (SR-INFRA-12)**
- Zakładając domenę nadawczą `staging.eviacharge.pl` (nadawca `powiadomienia@…`) i rekordy DNS dodane **jednorazowo przez Konrada w OVH** wg listy w runbooku (SPF, DKIM z TEM, DMARC z `rua`; CAA i `rua` z EVM-121 w tej samej sesji, jeśli to możliwe)
- Gdy sprawdzam nagłówki wiadomości testowej z TEM
- Wtedy SPF i DKIM mają wynik `pass`, DMARC jest zgodny (alignment), a polityka DMARC jest podniesiona do `p=reject` natychmiast po potwierdzeniu zgodności w nagłówkach (bez oczekiwania na raporty); pierwsza wysyłka na adres realnego użytkownika następuje dopiero po tym kroku.

**AC4 — Worker i ruch wychodzący (SR-API-13, SR-ERR-02)**
- Zakładając worker wdrożony kanałem wdrożeń z EVM-007
- Gdy API i worker wysyłają ruch wychodzący, a TEM jest niedostępny albo klucz jest nieprawidłowy
- Wtedy ruch wychodzący prowadzi wyłącznie do TEM (host stały, bez przekierowań, z timeoutem — wzorzec `pwned-passwords.ts`; test: połączenie z innym hostem zablokowane), lista komunikacji w modelu zagrożeń jest zaktualizowana, wysyłka jest ponawiana z wydłużającymi się przerwami, a po wyczerpaniu prób zadanie trafia do kolejki martwych zadań i widać je w W-16 jako „Nie wysłano”; zaproszenie nie ginie.

**AC5 — Runbook kolejki e-mail**
- Gdy awaria wysyłki wymaga interwencji
- Wtedy runbook opisuje: podgląd kolejki i martwych zadań bez danych osobowych, ponowienie, rotację klucza TEM, zmianę trybu i listy adresów, sprawdzenie DNS oraz listę rekordów dla Konrada (AC3); kroki wykonane przynajmniej raz na środowisku.

**AC6 — Demo (do akceptacji Konrada)**
- Zakładając adres osoby z biura i konto Administratora Konrada
- Gdy Konrad zaprasza ją na środowisko, ona aktywuje konto (EVM-024 AC3) i wykonuje reset hasła
- Wtedy cały przepływ działa przez TEM; zaproszenie na adres `.test` nie wychodzi (AC2); w kolejce martwych zadań nic nie leży.

## Poza zakresem
- Przemianowanie staging → produkcja i zmiana domeny nadawcy — EVM-125 (wtedy rekordy DNS z AC3 powtarzamy dla nowej nazwy).
- Alerty o kolejce e-mail w kanale monitoringu — EVM-085 (tu tylko zdarzenie lokalne i metryka).
- Nowe rodzaje e-maili i ich treści — historyjki E1 (EVM-023, 025–028).

## Decyzje i ograniczenia
- 2026-11-13 — Konrad: jedno środowisko, realni użytkownicy od startu; e-mail to następny obowiązkowy element.
- Wymaga od Konrada: jednorazowego dodania rekordów DNS w OVH (AC3) i kolejnej sesji na VM (plik sekretu z kluczem TEM); konto Scaleway i domena — decyzje 1 i 2 (zrealizowane 2026-10-13). Koszt: 0 zł w progu 300 e-maili / mies. (`docs/ops/koszty-staging.md`).
- Bezpieczeństwo: SR-API-13, SR-INFRA-12, SR-INPUT-07 (kodowanie nagłówków); brak danych klientów w e-mailach; klucz TEM to sekret (SEK); tryb `otwarty` potwierdzony przez `security-engineer` 2026-11-13 (RR-93) (pytanie 2).

## Notatki
- Jeśli subdomena nadawcy istnieje wcześniej, EVM-007a ustawia na niej `v=spf1 -all` i DMARC `p=reject`/`p=none` z raportami — AC3 zmienia to na właściwe wartości; sprawdzić stan rekordów i weryfikacji domeny w TEM przed sesją (część mogła zostać zrobiona w EVM-007).
- Test dymny po wdrożeniu (EVM-076) nie jest warunkiem tej historyjki.

## Decyzje Konrada 2026-11-13 (dawne otwarte pytania — przyjęte rekomendacje)
1. **Domena nadawcy teraz:** zostajemy przy `powiadomienia@staging.eviacharge.pl` (rekomendacja — zero dodatkowej pracy teraz; po przemianowaniu EVM-125 dodajemy rekordy DNS dla nowej nazwy, ok. 15 min) czy od razu ustalamy docelową nazwę (np. `app.eviacharge.pl`) i robimy DNS raz — dłuższa decyzja teraz, opóźnia start.
2. **Tryb wysyłki:** `otwarty` z zarezerwowanymi domenami zablokowanymi (rekomendacja — zaproszenia tworzy tylko Administrator, biuro się zmienia, lista wymagałaby ręcznej pracy; ryzyko niskie, wymaga potwierdzenia `security-engineer`) czy `lista` z adresami biura (bezpieczniej, ale każde nowe konto = zmiana konfiguracji na VM).
3. **Skrzynka na raporty DMARC (`rua`) i odbicia TEM:** dedykowany alias w skrzynce Konrada (rekomendacja — bez nowych kont) czy osobna skrzynka firmowa.

## Dziennik
- 2026-10-16 — utworzono jako część staging wydzieloną z EVM-024 (product-owner; propozycja do akceptacji Konrada)
- 2026-10-16 — warunki security-engineer: `depends_on` + EVM-076, doprecyzowane AC2–AC4, notatki
- 2026-10-16 — utworzona przy podziale EVM-024 (product-owner, warunki security-engineer); podział zaakceptowany przez Konrada, historyjka do refinementu przed realizacją
- 2026-11-13 — refinement wg decyzji Konrada „jedno środowisko, realni użytkownicy od startu” (product-owner): tytuł i cel (jedyne środowisko, prawdziwe adresy biura), P1 → P0, AC2 (tryb `lista` / `otwarty`, strażnik dla danych syntetycznych), AC3 (DNS jednorazowo przez Konrada, `p=reject` po sprawdzeniu nagłówków), AC1/AC4 (klucz jako plik sekretu, nieudana wysyłka nie gubi zaproszenia), `depends_on` bez EVM-076, `path: pelna`, reviewers + code-reviewer; 3 otwarte pytania; status `draft` do akceptacji Konrada (6 AC)
- 2026-11-13 — akceptacja Konrada (DoR): nadawca `powiadomienia@staging.eviacharge.pl` (nowe rekordy przy EVM-125), tryb `otwarty` z blokadą `example.com` i `.test` (security-engineer: akceptowalne, RR-93), raporty DMARC i odbicia na alias w skrzynce Konrada; status `ready` (Tech Lead)
- 2026-11-13 — zmiana decyzji Konrada: docelowy adres panelu **`panel.eviacharge.pl`** ustalony już teraz (zamiast późniejszego przemianowania): nadawca e-mail z domeny `panel.eviacharge.pl` (SPF/DKIM/DMARC dla niej), `PANEL_ORIGIN` i `WEBAUTHN_RP_ID` = `panel.eviacharge.pl`, CORS bucketu mediów, Caddy i `staging-verify` na nowy adres — w tym samym posiedzeniu co klucz TEM; `staging.eviacharge.pl` przekierowuje na nowy adres. Konrad rejestruje swój klucz dostępu ponownie (RP ID się zmienia) przed zaproszeniem biura (Tech Lead)
