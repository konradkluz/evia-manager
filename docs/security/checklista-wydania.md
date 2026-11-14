# Checklista wydania — sign-off bezpieczeństwa

> Dokument żywy (EVM-064 AC7). Właściciel: `security-engineer`; wykonuje `security-engineer` (część repozytorium) i Konrad (część na środowisku — agenci nie czytają jego logów ani danych, RR-93). Wymagania: SR-PRIV-09 (przegląd próbek logów), SR-PRIV-06, SR-PRIV-07; sign-off 1.0 — EVM-070.

**Kiedy:** przed startem z realnymi danymi klientów (pilot realny), przy każdym wydaniu wersji (1.0, 1.1, …) i po każdej zmianie loggera, redakcji w Alloy albo listy zbieranych usług. Między wydaniami wdrożenia z `main` chronią testy redakcji w CI. Wynik każdego przebiegu — w protokole (pierwszy: [`docs/qa/EVM-064/protokoly.md` → „AC7”](../qa/EVM-064/protokoly.md#ac7--przegląd-próbek-logów)), bez treści logów.

## 1. Przegląd próbek logów (SR-PRIV-09) — Konrad
W Grafanie: Explore → źródło Loki → zakres **ostatnie 7 dni** (przed startem: od ostatniego wdrożenia). Każde zapytanie uruchom osobno; zapisz **tylko liczbę trafień i nazwę usługi** — nie kopiuj linii logów do plików, zgłoszeń, czatu ani do agentów.

| # | Czego szukamy | Oczekiwane |
|---|---|---|
| L1 | adresy e-mail | 0 |
| L2 | numery telefonów | 0 |
| L3 | PESEL (11 cyfr) | 0 |
| L4 | tokeny w treści (nagłówek `Bearer`, `token=`, link aktywacyjny) | 0 |
| L5 | adresy IPv4 | tylko prefiksy zgodne z P9 (adres sieci), żadnych pełnych adresów osób |
| L6 | pola z danymi osób i hasła z wartością (wartość `[Redacted]` jest w porządku) | 0 |
| L7 | przegląd ręczny: 20 losowych linii `{service="api"}` i 10 z `{service="worker"}` — imię, adres, treść wpisu, nazwa pliku | brak |

Zapytania L1–L6 (LogQL; wyrażenie w odwrotnych apostrofach — bez dodatkowego escapowania):

```
L1  {service=~".+"} |~ `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`
L2  {service=~".+"} |~ `(\+48[ -]?)?\b\d{3}[ -]\d{3}[ -]\d{3}\b`
L3  {service=~".+"} |~ `\b\d{11}\b`
L4  {service=~".+"} |~ `(?i)(bearer [a-z0-9._-]{10,}|token=[a-z0-9._-]{6,}|/activate#[a-z0-9_-]+)`
L5  {service=~".+"} |~ `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`
L6  {service=~".+"} |~ `(?i)"(phone|email|street|nip|pesel|notes|description|title|content|originalName|fileName|password)"\s*:\s*"[^"\[]`
```

**Wynik:** wszystkie „Oczekiwane” spełnione → PASS. Trafienie z danymi osobowymi → FAIL: zgłoś `security-engineer` nazwę usługi i wzorzec (bez wartości), poprawka redakcji jako historyjka (`/refine`), ocena wg [runbooka naruszeń](../ops/runbooks/naruszenie-danych.md) (logi w Grafana Cloud, region UE, 14 dni — zwykle tylko wpis w rejestrze). Aplikacja mobilna: logi systemowe telefonu sprawdza sign-off 1.1 (SR-LOG-08, MAS-L1).

## 2. Pozostałe warunki sign-off
| # | Warunek | Kto | Źródło |
|---|---|---|---|
| S1 | Brak otwartych ustaleń blocker i major (albo ryzyko zaakceptowane przez Konrada i zapisane) | `security-engineer` | przeglądy historyjek, `threat-model.md` |
| S2 | Model zagrożeń aktualny (zmiany kamienia milowego, nowe RR z decyzją) | `security-engineer` | [`threat-model.md`](threat-model.md) |
| S3 | Skany czyste albo z uzasadnionymi wyjątkami: `pnpm run scan` lokalnie i job `security` w CI na commicie wydania | `security-engineer` | `.scratch/scans/`, CI |
| S4 | Odtworzenie kopii przetestowane | `devops-engineer` | **nie dotyczy do posiedzenia B EVM-084** (RR-91, twardy termin 2026-12-13); potem [restore](../ops/runbooks/restore.md) |
| S5 | MFA dla wszystkich Administratorów, co najmniej dwa konta Administratora, MFA na kontach dostawców | Konrad | EVM-061 AC1 |
| S6 | RODO: checklista „przed produkcją” w `rodo.md` zamknięta, klauzule bez znacznika „projekt” i `[DO UZUPEŁNIENIA]`, DPIA zatwierdzona i jej warunki z § 5 spełnione (upoważnienia, informacja o audycie, oświadczenia techników), procedury przećwiczone | Konrad, `security-engineer` | [`rodo.md`](rodo.md#podmioty-przetwarzające-i-umowy-powierzenia), [`dpia.md`](dpia.md), [protokoły EVM-064](../qa/EVM-064/protokoly.md) |
| S7 | Przegląd próbek logów (sekcja 1) — PASS | Konrad | protokół |
