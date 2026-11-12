---
id: EVM-102
title: "Aplikacja: ekran prywatności i pomocy (bez raportowania błędów do dostawcy)"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
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
Jako **użytkownik** chcę **widzieć klauzulę informacyjną, wersję aplikacji i kontakt do biura także bez zasięgu**, aby **spełnić SR-MOB-12 i RODO** oraz wiedzieć, do kogo zgłosić problem. Makieta M-11 jest w przepływie 16 (patrz „Decyzje i ograniczenia”). Aplikacja **nie wysyła** raportów awarii ani telemetrii do żadnego dostawcy zewnętrznego.

## Kryteria akceptacji

**AC1 — Prywatność i pomoc (M-11)**
- Zakładając ekran „Więcej”
- Gdy otwieram „Prywatność i pomoc”
- Wtedy widzę trzy klauzule jako rozwijane sekcje z wersją i datą (treść z EVM-063, spakowana w aplikacji), wersję aplikacji z numerem kompilacji, noty licencji open source (m.in. SQLCipher) i kontakt do administratora (`mailto:`, opcjonalnie numer biura z konfiguracji).

**AC2 — Dostępność bez zasięgu i bez logowania**
- Zakładając brak sieci albo brak zalogowania
- Gdy otwieram ekran z M-01, M-02, M-09 lub „Więcej” (kotwice `#pomoc` i `#prywatnosc`)
- Wtedy widzę tę samą treść we wszystkich wejściach i wariantach M-02, a dla roli Tylko odczyt oraz użytkownika niezalogowanego ekran jest dostępny (treść publiczna).

**AC3 — Kontakt bez klienta poczty**
- Zakładając telefon bez skonfigurowanej poczty
- Gdy wybieram adres kontaktowy
- Wtedy widzę adres z akcją „Kopiuj adres”, a aplikacja nie zgłasza błędu.

**AC4 — Informacja o braku raportów awarii**
- Zakładając ekran z AC1
- Gdy czytam sekcję o danych technicznych
- Wtedy jest jasno napisane, że aplikacja nie wysyła raportów awarii ani danych analitycznych poza synchronizacją z serwerem EVia, a o awarii użytkownik informuje biuro (opisując objawy).

**AC5 — Brak telemetrii w paczce**
- Zakładając zbudowany APK
- Gdy sprawdzam paczkę (test `tools/mobile-apk verify`)
- Wtedy brak SDK raportowania błędów i analityki, identyfikatorów reklamowych, zrzutów ekranu i nagrywania sesji, a aplikacja nie nawiązuje połączeń do domen innych niż serwer EVia (lista dozwolonych hostów).

## Poza zakresem
Raportowanie błędów aplikacji do zewnętrznego dostawcy (Sentry i podobni), biblioteka telemetrii, mapy źródeł; **ewentualne późniejsze własne raportowanie błędów (np. własny endpoint do logów) — osobna historyjka po M2, jeśli test terenowy wykaże potrzebę**; push, analityka produktowa, zrzuty ekranu użytkownika, deklaracja Google Play (poza Play na MVP, ADR-0019).

## Decyzje i ograniczenia
- Decyzja Konrada 2026-11-12: bez Sentry — brak nowej zależności i brak ruchu do dostawców; w razie awarii diagnoza z logów serwera i opisu technika.
- UX / UI: M-11 „Prywatność i pomoc” (makieta, stany, mikrocopy, dostępność) — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md); numer telefonu biura (decyzja 11); ekran dostępny dla wszystkich ról, bez `FLAG_SECURE` (treść publiczna).
- Bezpieczeństwo i prywatność: brak danych osobowych w ekranie; przeglądy zmian w dokumentach prywatności (`rodo.md`, wzmianka o Sentry) wykonuje security-engineer poza tą historyjką.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: security, UX (product-owner)
- 2026-11-12 — zawężono do ekranu prywatności i pomocy: bez Sentry, biblioteki telemetrii i raportowania błędów; 6 → 5 AC (decyzja Konrada 2026-11-12)
- 2026-11-12 — path pelna → lekka, jedyny recenzent security-engineer (klauzule RODO); Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”
