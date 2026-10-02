# ADR-0013: Obserwowalność — logi strukturalne z redakcją, Grafana Cloud (UE) i Sentry (UE), alerty bezpieczeństwa

- **Status:** Zaakceptowana (Konrad, 2026-10-02)
- **Data:** 2026-10-02
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect (recenzja: devops-engineer, security-engineer)
- **Powiązane:** EVM-001, EVM-005 (retencja, RODO), EVM-007 (monitoring i alerty); ADR-0001, ADR-0005, ADR-0009, ADR-0010, ADR-0011

## Kontekst i problem
Mała firma bez dyżurów: trzeba szybko wiedzieć, że coś nie działa (API, kolejka, backup, upload, skan AV), i diagnozować błędy z web, API i telefonów — **bez danych osobowych w logach i raportach błędów** (baseline, RODO). Security-engineer wymaga: redakcji danych osobowych, braku ciał żądań w logach, error trackingu w UE bez session replay i ze scrubbingiem, alertów na anomalie uwierzytelniania i masowe pobrania, zdefiniowanej retencji. Budżet: rezerwa ~108 zł/mies. (ADR-0011, `../README.md` → Koszty) — preferowane darmowe progi.

## Kryteria decyzji
| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| RODO i podprocesorzy (region UE, redakcja, minimalny zakres) | 5 | baseline |
| Koszt | 5 | budżet |
| Narzut operacyjny | 4 | jedna osoba |
| Pokrycie: logi, metryki, błędy (API, web, mobile), alerty, uptime | 4 | wykrywanie problemów z terenu |
| Standardy i plan wyjścia (OpenTelemetry, Prometheus, protokół Sentry) | 3 | odwracalność |

## Rozważane opcje
1. **A. Grafana Cloud (region UE, plan Free) + Sentry (region UE, plan Developer)** — agent Grafana Alloy na VM, SDK Sentry w API, web i mobile.
2. **B. Samodzielnie hostowane:** Grafana + Loki + Prometheus + GlitchTip (zgodny z protokołem Sentry) na osobnej małej VM.
3. **C. Minimum:** Sentry (UE) + logi tylko na serwerze (Docker/journald) + prosty monitoring dostępności.

## Ocena
| Kryterium (waga) | A | B | C |
|---|---|---|---|
| RODO i podprocesorzy (5) | 4 | 5 | 4 |
| Koszt (5) | 5 | 3 | 5 |
| Narzut operacyjny (4) | 5 | 2 | 4 |
| Pokrycie (4) | 5 | 4 | 2 |
| Standardy i wyjście (3) | 4 | 5 | 3 |
| **Suma ważona (maks. 105)** | **97** | **79** | **78** |

Uwagi: Grafana Cloud Free: 10 tys. serii metryk, 50 GB logów i śladów, retencja 14 dni, region UE. Sentry: region UE (Frankfurt) dostępny w każdym planie, w tym darmowym Developer (1 użytkownik, 5 tys. błędów/mies.); Team 26 USD/mies. B daje pełną kontrolę danych, ale to kolejna VM (~6 EUR + storage) i stos do utrzymania. Obaj dostawcy w A to podmioty z USA — dane wyłącznie po redakcji (ryzyko rezydualne opisane w ADR-0011). Wersje i ceny zweryfikowane 2026-10-02 (źródła niżej).

## Decyzja
**A. Grafana Cloud (UE, Free) + Sentry (UE, Developer)**, z twardymi zasadami prywatności:

**Logi (backend, worker, proxy):**
- **pino** z logami JSON; **redakcja** pól wrażliwych na poziomie loggera (`authorization`, `cookie`, `set-cookie`, hasła, tokeny, kody MFA, adresy e-mail, telefony, imiona i nazwiska, adresy, nazwy plików użytkownika, parametry podpisanych URL-i); **bez ciał żądań i odpowiedzi**; logujemy identyfikatory techniczne (`traceId`, `userId` jako UUID, `deviceId`, id obiektów), trasę, status, czas.
- Logi dostępowe reverse proxy bez query stringów zawierających podpisy; adresy IP — skrócone lub pseudonimizowane (decyzja w EVM-005).
- Wysyłka przez **Grafana Alloy** do Grafana Cloud (region UE). Testy jednostkowe redakcji (żadne pole z listy nie trafia do wyjścia).
- **Dziennik audytu nie jest logiem** — żyje w bazie (ADR-0001, ADR-0003).

**Metryki:** host (node exporter), kontenery, PostgreSQL (exporter), aplikacja (Prometheus/OpenTelemetry: czasy i błędy endpointów, długość i wiek kolejek pg-boss, czas uploadu → `ready`, liczba plików w kwarantannie, wiek ostatniego backupu i WAL, wiek sygnatur ClamAV).

**Błędy:** **Sentry, region UE** (`de.sentry.io`) — SDK dla NestJS, React i React Native: `sendDefaultPii: false`, scrubbing po stronie SDK (`beforeSend`/`beforeBreadcrumb`) i serwera (reguły data scrubbing), **wyłączony session replay**, bez zrzutów ekranu i hierarchii widoków na mobile, bez ciał żądań; identyfikacja użytkownika tylko przez UUID.

**Dostępność:** sprawdzanie z zewnątrz (Grafana Synthetic Monitoring w ramach planu Free) dla `/api/health` i panelu.

**Alerty (e-mail do Konrada; kanał docelowy w EVM-007):**
- *Bezpieczeństwo:* skok nieudanych logowań (per konto/IP), blokady kont, **wykrycie ponownego użycia refresh tokenu**, zmiana ról/MFA administratora, logowanie Administratora z nowego urządzenia, **masowe pobrania** (przekroczenie progu podpisanych URL-i lub eksportów per użytkownik, ADR-0009), plik w kwarantannie.
- *Operacje:* 5xx > 2% przez 5 min, p95 > 1 s, kolejka z zadaniami w DLQ lub wiekiem > 30 min, **brak udanego backupu / WAL starszy niż 15 min**, dysk > 80%, certyfikat TLS < 14 dni, sygnatury ClamAV > 24 h, nieudany test odtworzenia.

**Retencja (do potwierdzenia w EVM-005):** logi operacyjne **14 dni** (Grafana Cloud Free), metryki 14 dni, błędy Sentry **30 dni** (domyślnie w planie), lokalne logi na VM 7 dni (rotacja); **dziennik audytu ≥ 2 lata** w bazie (archiwizacja w backupach).

## Konsekwencje
- **Pozytywne:** 0 zł w MVP; pełne pokrycie (logi, metryki, błędy z telefonów, alerty, uptime) bez utrzymywania stosu; standardowe protokoły (OTel/Prometheus, Sentry).
- **Negatywne / koszty:** dwa dodatkowe podmioty z USA (regiony UE, dane po redakcji); limity planów darmowych (1 użytkownik Sentry, 5 tys. błędów, 14 dni logów); Sentry Team (~101 zł/mies.) może być potrzebny przy większym zespole.
- **Ryzyka i mitygacje:**
  - *Wyciek danych osobowych do logów/Sentry* → redakcja testowana jednostkowo, scrubbing po obu stronach, przegląd próbek logów w przeglądzie security, zakaz logowania obiektów domenowych w całości (reguła lint).
  - *Przekroczenie darmowych limitów* → sampling śladów, limity w Alloy, alert zużycia.
  - *Alerty bez reakcji (jedna osoba)* → mała liczba alertów o wysokiej wartości, runbooki w EVM-007.

## Plan wyjścia
SDK Sentry działa z samodzielnie hostowanym **GlitchTip** (zgodny protokół) — zmiana DSN. Alloy/OpenTelemetry/Prometheus mogą wysyłać do samodzielnie hostowanego Loki/Prometheus lub innego dostawcy (np. Scaleway Cockpit w UE) — zmiana konfiguracji agenta. Koszt wyjścia: dzień–kilka dni plus dodatkowa VM.

## Weryfikacja
- EVM-007: alerty testowe (sztuczny błąd 5xx, zatrzymany backup, plik EICAR, symulowane brute force) docierają do Konrada; próbka logów bez danych osobowych (checklista security).
- Kwartalnie: zużycie limitów planów Free; liczba alertów fałszywych.

## Źródła (zweryfikowane 2026-10-02)
- Grafana Cloud — cennik i plan Free (10 tys. serii, 50 GB logów, 14 dni): https://grafana.com/pricing/
- Sentry — cennik (Developer, Team 26 USD) i region UE (Frankfurt, wszystkie plany): https://sentry.io/pricing/ , https://docs.sentry.io/organization/data-storage-location/
- @sentry/node 11.4.0, @sentry/react 11.4.0, @sentry/react-native 8.29.0 (MIT): https://www.npmjs.com/package/@sentry/node , https://www.npmjs.com/package/@sentry/react-native
- pino 10.4.0 (MIT): https://www.npmjs.com/package/pino ; Grafana Alloy 1.20.1: https://github.com/grafana/alloy/releases ; Loki 3.7.8: https://github.com/grafana/loki/releases
- Licencje (zweryfikowane 2026-10-02): Grafana Alloy — **Apache-2.0**: https://github.com/grafana/alloy/blob/main/LICENSE ; Loki — **AGPL-3.0**: https://github.com/grafana/loki/blob/main/LICENSE — w wybranej opcji A Loki jest usługą zarządzaną Grafana Cloud (nie uruchamiamy go sami); w planie wyjścia (samodzielny hosting) używany bez modyfikacji, więc AGPL nie obejmuje kodu systemu.
- GlitchTip 6.2.6 (2026-08-07): https://gitlab.com/glitchtip/glitchtip-backend
- OpenTelemetry JS SDK 0.222.0 (**Apache-2.0**, zweryfikowane 2026-10-02: https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE): https://www.npmjs.com/package/@opentelemetry/sdk-node
