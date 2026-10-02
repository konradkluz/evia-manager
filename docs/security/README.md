# Bezpieczeństwo — wymagania bazowe (non-negotiable)

> Baseline obowiązuje od pierwszej linii kodu. Szczegóły i mapowanie na historyjki: `threat-model.md`, `requirements.md`, `rodo.md` (powstają w EVM-005, właściciel: `security-engineer`).

## Standardy
- **OWASP ASVS 5.0, poziom 2** — web i API.
- **OWASP MASVS** (profil L1 + wybrane kontrole L2 dla danych wrażliwych) — aplikacja mobilna.
- **RODO** — dane osobowe klientów; hosting, kopie i przetwarzanie w UE.

## Uwierzytelnianie i sesje
- Hasła wg NIST SP 800-63B (długość zamiast reguł złożoności, blokada haseł z wycieków), bezpieczne haszowanie (algorytm wg ADR).
- **MFA obowiązkowe dla Administratora**, dostępne dla wszystkich (TOTP lub passkeys — wg ADR).
- Ochrona przed brute force (limity, opóźnienia), bezpieczny reset hasła, powiadomienie o istotnych zmianach konta.
- Web: ciasteczka `HttpOnly`, `Secure`, `SameSite`; mobile: krótkie tokeny dostępu + rotowane tokeny odświeżania w bezpiecznym magazynie urządzenia; zdalne unieważnianie sesji i urządzeń.

## Autoryzacja
- Deny-by-default, sprawdzanie po stronie serwera przy każdym żądaniu, kontrola na poziomie obiektu (IDOR).
- Testy macierzy ról dla 100% endpointów.

## Dane
- TLS (1.2+, preferowane 1.3) i HSTS; szyfrowanie w spoczynku (baza, storage, kopie).
- Media i dokumenty w prywatnym storage'u, dostęp przez krótkotrwałe podpisane URL-e wydawane po autoryzacji.
- Minimalizacja: bez PESEL i numerów dokumentów, chyba że proces formalny tego wymaga (wtedy szyfrowanie pola i zawężony dostęp).
- Polityka EXIF / GPS dla zdjęć (decyzja w EVM-005).
- Brak danych osobowych i sekretów w logach, raportach błędów i danych testowych.

## Wejście / wyjście
- Walidacja schematem na granicy API, zapytania parametryzowane, kodowanie wyjścia.
- Nagłówki bezpieczeństwa i CSP, restrykcyjny CORS, rate limiting.
- Upload: typ weryfikowany po zawartości, limity rozmiaru, skan plików (wg ADR), nazwy plików nie z danych użytkownika.

## Audyt i operacje
- Dziennik audytu (kto, co, kiedy, skąd) dla logowań, zmian ról i użytkowników, usunięć, eksportów i masowych pobrań; tylko do dopisywania, z retencją.
- Backupy automatyczne, szyfrowane, poza głównym miejscem; odtworzenie testowane przed każdym wydaniem i cyklicznie.
- Monitoring i alerty; procedura reagowania na incydent (w tym zgłoszenie naruszenia do UODO w 72 h).

## Łańcuch dostaw i sekrety
- Lockfile, automatyczne aktualizacje zależności, skan podatności i licencji w CI, akcje CI przypięte do wersji/SHA.
- Sekrety wyłącznie w menedżerze sekretów / sekretach CI; skan sekretów w pre-commit i CI; rotacja po wycieku lub odejściu pracownika.
- Agenci AI nie mają dostępu do plików z sekretami (`.claude/settings.json` → `permissions.deny`).

## W procesie
- Model zagrożeń aktualizowany co kamień milowy; wymagania bezpieczeństwa wplecione w AC historyjek.
- Przegląd `security-engineer` dla zmian wrażliwych (lista w `docs/process/workflow.md`), sign-off przed każdym wydaniem.
- Przed startem produkcyjnym z realnymi danymi: rozważyć zewnętrzny test penetracyjny.
