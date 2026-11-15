---
id: EVM-102
title: "Aplikacja: ekran prywatności i pomocy (bez raportowania błędów do dostawcy)"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: in-progress
priority: P2
path: lekka             # statyczny ekran prywatności i pomocy (M-11) bez telemetrii; klauzule RODO sprawdza security-engineer (2026-11-12, Tech Lead z delegacji)
owner: mobile-developer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-009, EVM-063]
---

# EVM-102: Aplikacja — ekran prywatności i pomocy (bez raportowania błędów do dostawcy)

> Zakres zawężony 2026-11-12 (decyzja Konrada: bez Sentry). Nazwa pliku zostaje historyczna (zachowanie odnośników).

## Cel
Jako **użytkownik** chcę **widzieć klauzulę informacyjną, wersję aplikacji i kontakt do biura także bez zasięgu i przed zalogowaniem**, aby **spełnić SR-MOB-12 i RODO** oraz wiedzieć, do kogo zgłosić problem. Aplikacja **nie wysyła** raportów awarii ani telemetrii do żadnego dostawcy zewnętrznego.

## Kontekst
Makieta M-11 „Prywatność i pomoc” — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md) (sekcja M-11); treść klauzul — panel W-19 (EVM-063), `apps/web/src/privacy/content.ts`.

## Kryteria akceptacji

**AC1 — Treść: klauzule, wersja, licencje**
- Zakładając ekran „Więcej”
- Gdy otwieram „Prywatność i pomoc”
- Wtedy widzę trzy klauzule jako rozwijane sekcje z wersją i datą, których treść pochodzi z jednego źródła wspólnego z W-19 (albo test równości wersji i treści z panelem), numer wersji aplikacji z kompilacją, „Licencje open source” (m.in. SQLCipher) jako sekcję rozwijaną na tym samym ekranie (bez drugiego poziomu) i kontakt do administratora.

**AC2 — Wejścia, nakładka i dostępność bez zasięgu i bez logowania**
- Zakładając brak sieci albo brak zalogowania, albo rolę Tylko odczyt
- Gdy otwieram ekran z „Więcej” (nowe wiersze „Pomoc” i „Prywatność”), M-01, M-02 lub M-12
- Wtedy to samo wejście pokazuje tę samą treść, ekran jest nakładką (bez routera) z obsługą „wstecz”, wejście „Pomoc” ustawia sekcję początkową (`#pomoc`) a „Prywatność” sekcję `#prywatnosc` z fokusem na jej nagłówku, przed zalogowaniem nie ma „Ostatniej synchronizacji”, a ekran działa też w trybie ukrytych danych.

**AC3 — Kontakt bez klienta poczty i bez adresu**
- Zakładając telefon bez skonfigurowanej poczty albo kompilację bez adresu kontaktowego
- Gdy wybieram adres kontaktowy
- Wtedy widzę adres z akcją „Kopiuj adres” i komunikat „Nie udało się otworzyć poczty.” bez zgłaszania błędu; bez adresu w konfiguracji: „Kontakt z administratorem: zapytaj przełożonego.”; numer biura (`tel:`) pojawia się tylko gdy jest w konfiguracji.

**AC4 — Informacja o braku raportów awarii**
- Zakładając sekcję „O aplikacji”
- Gdy czytam wiersz o danych technicznych
- Wtedy brzmi on: „Aplikacja nie wysyła raportów awarii ani danych analitycznych — tylko synchronizuje się z serwerem EVia. Gdy coś nie działa, opisz objawy w biurze.” (zastępuje „Raporty awarii: włączone” z makiety).

**AC5 — Brak telemetrii w paczce (statycznie)**
- Zakładając zbudowany APK
- Gdy uruchamiam `tools/mobile-apk verify` (kontrola w nowym pliku `tools/mobile-apk/src/telemetry.mjs`)
- Wtedy paczka nie zawiera SDK raportowania błędów i analityki (komponenty manifestu, pakiety DEX, uprawnienie `AD_ID`), identyfikatorów reklamowych, zrzutów ekranu ani nagrywania sesji, a lista adresów hostów w konfiguracji paczki zawiera wyłącznie API i magazyn obiektów; kontrola nie twierdzi niczego o ruchu sieciowym (analiza ruchu — EVM-112).

**AC6 — Podpis paczki odmawia klauzul w stanie projektu**
- Zakładając paczkę z klauzulami w stanie projektu (`DRAFT`) albo ze znacznikami `[DO UZUPEŁNIENIA]` / `[PRAWNIK/IOD]`
- Gdy uruchamiam `tools/mobile-apk sign`
- Wtedy podpisanie jest odrzucane z czytelnym komunikatem, a `verify` w CI nie czerwieni się z tego powodu.

## Poza zakresem
Raportowanie błędów do dostawcy (Sentry i podobni), biblioteka telemetrii, mapy źródeł; ewentualne własne raportowanie błędów — osobna historyjka po M2; push, analityka produktowa, deklaracja Google Play (ADR-0019); przeglądy prawne klauzul i `rodo.md` (security-engineer, poza historyjką); zmiany w makiecie M-11.

## Decyzje i ograniczenia
- Decyzja Konrada 2026-11-12: bez Sentry. Decyzja 11 planu: numer telefonu biura z konfiguracji.
- **Repozytorium jest publiczne:** dane kontaktowe i dane administratora pochodzą z konfiguracji budowania albo zostają znacznikami „[DO UZUPEŁNIENIA]”; do repozytorium nie wpisujemy prawdziwych adresów ani nazwisk. Kontrola `sign` odmawia podpisania paczki ze znacznikami (propozycja security — dodana do `sign`, nie do CI `verify`).
- UX / UI: ekran dostępny dla wszystkich ról; `FLAG_SECURE` obowiązuje wg decyzji 5 planu (całe okno w wydaniu), więc nic do implementacji osobno. **Uwaga dla ux-designera (nie edytujemy makiety w tej historyjce):** w M-11 zastąpić wiersz „Raporty awarii: włączone…” tekstem z AC4, usunąć zapis „bez `FLAG_SECURE`”, opisać nakładkę z „wstecz” i kotwice jako początkową sekcję oraz Disclosure dla licencji. Stany: pusty (brak adresu — AC3), ładowanie (nie dotyczy — treść zapakowana), błąd (AC3), offline (pełna treść), brak uprawnień (nie dotyczy).
- Bezpieczeństwo i prywatność: brak danych osobowych w ekranie i w repozytorium; klauzule z jednego źródła z W-19 (nie rozjeżdżają się po przeglądzie prawnym EVM-064).
- Do `manual` w EVM-112: czytelność klauzul na 360 dp i 200%, Disclosure, „Kopiuj adres”.

## Notatki techniczne
- Pliki wspólne z torem A (ograniczyć zmiany): `apps/mobile/src/i18n/pl.ts` (nowe klucze w osobnym bloku na końcu sekcji), `screens/MoreScreen.tsx`, `Shell.tsx`, `SessionRoot.tsx` (tylko tor B dopisuje pozycje „Więcej”), `tools/mobile-apk/src/verify.mjs` (jedna linia wywołująca `telemetry.mjs`; tor A zmienia tylko tablicę `allowed` w `manifest.mjs`), `CHANGELOG.md`, README M2.
- Przepływy Maestro toru B: numery 70–79.

## Definition of Done
- [ ] AC1–AC6 pokryte testami oznaczonymi `EVM-102 AC#`; `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Recenzja: security-engineer (jedyny recenzent) — approve; `CHANGELOG.md`.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
- 2026-11-12 — zawężono do ekranu prywatności i pomocy: bez Sentry, biblioteki telemetrii i raportowania błędów; 6 → 5 AC (decyzja Konrada 2026-11-12)
- 2026-11-12 — path pelna → lekka, jedyny recenzent security-engineer (klauzule RODO); Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”
- 2026-11-14 — refinement do DoR (product-owner): 6 AC wg konsultacji UX i security (źródło klauzul, odmowa podpisu, statyczna kontrola telemetrii); ścieżka `lekka` ujednolicona w README planu
- 2026-11-14 — draft → ready: kryteria zatwierdzone przez Tech Leada z delegacji Konrada (pytanie przed nocą 2026-11-14); Konrad przegląda je rano w PR
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-14` (Tech Lead): status `in-progress`, gałąź `feature/queue-2026-11-14-api-media-i-drobne`
- 2026-11-15 — implementacja (mobile-developer): M-11 z kopią klauzul W-19 i testem równości, kontakt ze zmiennych budowania, wejścia M-01/M-02/M-12/„Więcej”, kontrola telemetrii w `verify` i odmowa `sign` przy klauzulach w stanie projektu, przepływy Maestro 78–79 (E2E czeka na orkiestratora)
- 2026-11-15 — poprawki po przeglądzie security (mobile-developer): AC5 — kontrola hostów obejmuje każdą meta-data i `extra`; opis kontaktu biura zgodny z prawdą; „wstecz” nie zamyka M-11 pod blokadą
