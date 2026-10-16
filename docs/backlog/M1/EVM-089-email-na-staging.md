---
id: EVM-089
title: E-mail transakcyjny na staging — Scaleway TEM, lista dozwolonych adresów, SPF / DKIM / DMARC
type: enabler
milestone: M1
epic: E1 Dostęp i użytkownicy
status: draft
priority: P1
path: pelna
owner: devops-engineer
contributors: [backend-developer]
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007, EVM-024, EVM-076]
---

# EVM-089: E-mail transakcyjny na staging — Scaleway TEM, lista dozwolonych adresów, SPF / DKIM / DMARC

> Część „staging” wydzielona z EVM-024 (2026-10-16), wzorem podziału EVM-007 wg [ADR-0018](../../architecture/adr/0018-wdrozenia-pull-z-weryfikacja-na-vm-github-free.md). Lokalna kolejka `email`, port e-mail i Mailpit — EVM-024.

## Cel
Jako **właściciel produktu** chcę **żeby zaproszenia i inne e-maile systemu działały na staging przez Scaleway TEM, ale tylko na adresy z listy dozwolonych**, aby **sprawdzić dostarczalność i uwierzytelnienie domeny nadawcy bez ryzyka wysyłki na obce adresy**. Kod adaptera TEM może wytworzyć `backend-developer` (współpraca z `devops-engineer`).

## Kryteria akceptacji
**AC1 — Wysyłka przez TEM na staging**
- Zakładając staging z EVM-007, port e-mail z EVM-024 i konto Scaleway (decyzja 1)
- Gdy Administrator zaprasza osobę na adres z listy dozwolonych (decyzja 15)
- Wtedy e-mail trafia do skrzynki przez adapter Scaleway TEM, a link z tokenem we fragmencie jest nienaruszony; klucz dostępu do TEM jest tylko na VM stagingu (nie w repozytorium, obrazach ani logach).

**AC2 — Lista dozwolonych adresów (decyzja 15)**
- Zakładając tryb staging z listą adresów w konfiguracji poza repozytorium (deny-by-default)
- Gdy system próbuje wysłać e-mail na adres spoza listy, na `example.com` albo `.test`
- Wtedy wiadomość nie opuszcza stagingu przez TEM, jest przechwycona lokalnie (bez treści w logach), a zadanie nie kończy się błędem ani ponowieniami; pusta albo brakująca lista oznacza, że wszystko jest przechwytywane lokalnie.
- Oraz blokada `example.com` i `.test` działa w każdym środowisku, także na produkcji, a adapter TEM da się zbudować wyłącznie razem ze strażnikiem odbiorców; adapter przechodzi wspólny zestaw testów kontraktu portu z EVM-024.

**AC3 — Uwierzytelnienie domeny nadawczej (SR-INFRA-12)**
- Zakładając domenę nadawczą stagingu (decyzja 2)
- Gdy sprawdzam rekordy DNS i nagłówki wiadomości testowej
- Wtedy SPF, DKIM i DMARC (`p=reject`) są skonfigurowane i stanowią warunek pierwszej wysyłki przez TEM, a nagłówki odebranej wiadomości pokazują wynik `pass` dla SPF i DKIM oraz zgodność DMARC.

**AC4 — Worker na staging i ruch wychodzący (SR-API-13, SR-ERR-02)**
- Zakładając worker wdrożony na staging kanałem wdrożeń z EVM-007
- Gdy proces API i worker wysyłają ruch wychodzący, a TEM jest chwilowo niedostępny
- Wtedy ruch wychodzący prowadzi wyłącznie do TEM — host stały, bez przekierowań, z timeoutem (wzorzec `apps/api/src/modules/identity/infrastructure/pwned-passwords.ts`; test: próba połączenia z innym hostem jest zablokowana), lista komunikacji w modelu zagrożeń jest zaktualizowana, wysyłka jest ponawiana z wydłużającymi się przerwami, a po wyczerpaniu prób zadanie trafia do kolejki martwych zadań i widać je w W-16 jako „Nie wysłano”.

**AC5 — Runbook kolejki e-mail (staging)**
- Gdy awaria wysyłki wymaga interwencji
- Wtedy runbook opisuje: podgląd kolejki i martwych zadań bez danych osobowych, ponowienie, rotację klucza TEM, zmianę listy dozwolonych i sprawdzenie DNS — a kroki zostały wykonane na staging przynajmniej raz.

**AC6 — Demo na staging**
- Zakładając adres z listy dozwolonych (alias Konrada)
- Gdy Administrator zaprasza go na staging, a on aktywuje konto (EVM-024 AC3)
- Wtedy cały przepływ działa przez TEM, a zaproszenie na adres spoza listy nie wychodzi (AC2) — do akceptacji użytkownika.

## Poza zakresem
- Środowisko produkcyjne: TEM, domena i DMARC prod — EVM-061.
- Alerty o kolejce e-mail w kanale monitoringu — EVM-085 (tu tylko zdarzenie lokalne i metryka).
- Nowe rodzaje e-maili i ich treści — historyjki E1 (EVM-023, 025–028).

## Decyzje i ograniczenia
- Wymaga decyzji Konrada: 1 (konto Scaleway), 2 (domena i adres nadawcy), 15 (lista adresów na staging).
- Sesja IaC Konrada jest potrzebna (zmiany DNS i Scaleway); wdrożenia i płatne usługi tylko za jego zgodą.
- Bezpieczeństwo: SR-API-13, SR-INFRA-12, SR-INPUT-07 (kodowanie nagłówków); brak danych klientów w e-mailach; klucz TEM to sekret (SEK).

## Notatki
- Jeśli subdomena nadawcy istnieje wcześniej, EVM-007a ustawia na niej `v=spf1 -all` i DMARC `p=reject`, dopóki EVM-089 nie włączy wysyłki.
- Zależność od EVM-076 (szkielet na staging); EVM-089 jest zależnością pilota A — żadne wdrożenie z prawdziwymi użytkownikami przed nią.

## Dziennik
- 2026-10-16 — utworzono jako część staging wydzieloną z EVM-024 (product-owner; propozycja do akceptacji Konrada)
- 2026-10-16 — warunki security-engineer: `depends_on` + EVM-076, doprecyzowane AC2–AC4, notatki
- 2026-10-16 — utworzona przy podziale EVM-024 (product-owner, warunki security-engineer); podział zaakceptowany przez Konrada, historyjka do refinementu przed realizacją
