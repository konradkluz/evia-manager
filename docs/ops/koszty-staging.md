# Koszty stagingu i alerty budżetowe

> Dokument żywy. EVM-085 AC4 (ADR-0018, ADR-0011, ADR-0013). Właściciel: `devops-engineer`; akceptuje Konrad w sesji IaC. Budżet infrastruktury: ok. 300 zł/mies. łącznie ze środowiskiem produkcyjnym (E8). Kurs i ceny VM/storage: tabela w historyjce [EVM-007](../backlog/M0/EVM-007-staging-wdrozenia-backupy-monitoring.md) (ceny netto z cenników publicznych z 2026-10-21, kurs NBP 4,3716 zł/EUR). **Stan: wartości z dokumentacji publicznej, nie z faktur; potwierdzenie w konsolach dostawców w sesji IaC.**

## Miesięczny koszt środowiska staging (szacunek)
| Pozycja | Dostawca / plan | zł/mies. | Uwagi |
|---|---|---|---|
| VM (CAX11) i wolumen 10 GB | Hetzner | ok. 34,7 | CAX21: ok. 58,9 zł (EVM-007) |
| Wolumen roboczy 20 GB (filmy i skan, szyfrowany kluczem efemerycznym; EVM-084, RR-75/76) | Hetzner Volume | ok. 4,9 | 20 GB × stawka wolumenu 10 GB z wiersza wyżej (ok. 0,056 EUR/GB); **cena do potwierdzenia w konsoli przed `apply`** |
| Obiekty: baza (kopie, object lock), media, rejestr usunięć, eksporty ZIP (EVM-052, wygasają po 1 dniu), stan OpenTofu | Scaleway Object Storage `pl-waw` | wg zużycia, rząd kilku zł | cennik za GB; dane syntetyczne, małe wolumeny; potwierdzić w sesji IaC |
| Kopia mediów | Hetzner Storage Box | zgodnie z wybranym wariantem (EVM-084) | kwota po wyborze rozmiaru w sesji IaC |
| E-mail transakcyjny | Scaleway TEM Essential | 0 do 300 e-maili/mies. | potem 0,25 EUR za 1000 |
| Test odtworzenia | Hetzner, tymczasowa VM cax11 | poniżej 2 | zasoby usuwane po teście; sprzątacz co godzinę |
| Logi, metryki, alerty, monitoring dostępności | Grafana Cloud Free (jeden stos UE) | 0 | limity niżej |
| Błędy aplikacji | bez osobnego serwisu (decyzja 2026-11-12): alert `EviaApiUnhandledError` z logów Grafana Cloud | 0 | w ramach limitów Grafany niżej |
| Obrazy | GHCR (GitHub Free) | 0 | ryzyko zmiany cennika opisane w EVM-007 |
| **Razem (bez zmiennych kosztów obiektów)** | | **ok. 37 do 40** | pozostaje ok. 260 zł w budżecie 300 zł dla prod i zapasu |

Obserwowalność nie dodaje kosztu stałego (plany bezpłatne). Zmiana planu (np. Grafana płatna) wymaga decyzji Konrada; plan wyjścia: ADR-0018.

## Limity planów bezpłatnych (data sprawdzenia: 2026-10-28)
| Usługa | Limit | Jak go pilnujemy |
|---|---|---|
| Grafana Cloud Free | 10 000 aktywnych serii metryk, 50 GB logów na miesiąc, retencja logów 14 dni | alert `EviaGrafanaUsageHigh` (80%), limit szybkości i filtr źródeł w Alloy |
| Grafana Synthetic Monitoring (Free) | 100 000 wykonań testów API na miesiąc; wykonanie = check × lokalizacja × minuta interwału | `infra/observability/synthetic/checks.json` i test: ≤ 80% limitu (obliczenie niżej) |

Źródła: dokumentacja cennika Synthetic Monitoring i wpis blogowy Grafany z 2024-12 (linki w historyjce EVM-085, D8). Limity i ceny mogą się zmienić; kontrola przy każdej sesji IaC.

### Obliczenie wykonań Synthetic Monitoring (D8)
Dwa checki (`/healthz` panelu i API) × 2 sondy w UE × 14 880 wykonań na sondę (31 dni, co 3 minuty) = 59 520 wykonań na miesiąc, czyli ok. 60% limitu 100 000. Interwał 2 minuty dawałby 89 280 (ponad 80%), a 3 sondy co minutę ok. 268 000 (ponad limit), dlatego wybrano 2 sondy co 3 minuty.

## Alerty budżetowe (progi 50% i 80%)
| Dostawca | Co dostępne | Działanie |
|---|---|---|
| Hetzner Cloud | brak natywnego budżetu i alertu kosztowego (stan wiedzy z dokumentacji; do potwierdzenia w konsoli) | comiesięczny przegląd faktury i listy zasobów przez Konrada (przypomnienie w kalendarzu), alert `EviaRestoreResourcesLeftover` na osierocone zasoby testu, projekt `evia-restore-staging` bez innych zasobów |
| Scaleway | alerty zużycia/rozliczeń w konsoli organizacji (do potwierdzenia w sesji IaC, czy dostępne dla progów 50% i 80% budżetu) | ustawienie w sesji IaC, zrzut ekranu jako dowód w `docs/qa/EVM-085/` |
| Grafana | plan bezpłatny: koszt 0 zł; alert limitu zamiast budżetu | `EviaGrafanaUsageHigh` |
| GitHub | Free; minuty Actions | [github-i-ci](github-i-ci.md) „zużycie minut Actions” |

Gdy plan dostawcy nie pozwala na alert budżetowy, zastępczą kontrolą jest przegląd miesięczny: AC4 jest wtedy spełnione dla dostawców z funkcją, a wyjątki są zapisane tutaj (Hetzner).

## Rejestr zmian
- 2026-10-28 — pierwsza wersja (EVM-085); progi i interwały D8; brak płatnych zasobów dodanych przez obserwowalność.
