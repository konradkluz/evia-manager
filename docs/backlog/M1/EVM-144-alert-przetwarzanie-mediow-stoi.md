---
id: EVM-144
title: "Alert: przetwarzanie mediów stoi (pliki czekają zbyt długo)"
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: draft
priority: P1
path: lekka             # tylko konfiguracja obserwowalności (Alloy, reguły, testy `promtool`, runbook), zero zmian w aplikacji, bez danych osobowych, bez `infra/deploy-agent/**`
owner: devops-engineer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-085]
---

# EVM-144: Alert — przetwarzanie mediów stoi

> **Szkic do akceptacji przez Konrada (2026-11-18).** Źródło: posiedzenie `docs/qa/EVM-084/posiedzenie-procesor-mediow-2026-11-18.md` (propozycja a).

## Cel
Jako **właściciel produktu** chcę **dostać e-mail, gdy pliki czekają na skan albo przetworzenie dłużej niż rozsądny czas**, aby **nie powtórzyła się sytuacja z 13–18.11, gdy wszystkie pliki stały na „Przygotowujemy podgląd”, a nikt o tym nie wiedział**.

## Kontekst
- Aplikacja **już loguje ostrzeżenia** (poziom `warn`, usługa `worker`, z liczbą `stuck`): „media: photos wait for their derivatives for over 30 minutes”, „media: films wait for their previews for over 2 hours” i „media: files wait for a scan for over 30 minutes” (plus „the processor is unreachable”). Brakuje tylko licznika w potoku logów i reguły alertu — **zero zmian w kodzie aplikacji**.
- Wzorzec istnieje: alert „unhandled error” z EVM-085 (selektor logu → licznik Alloy → reguła w `infra/observability/alerts/` → test `promtool`). EVM-085 (w toku) dostarcza kanał e-mail i ładowanie reguł do Grafany — ta historyjka **dopisuje reguły, nie buduje kanału**. Sentry odrzucony.

## Kryteria akceptacji

**AC1 — Liczniki z istniejących ostrzeżeń**
- Zakładając potok logów Alloy z listą dozwolonych usług
- Gdy usługa `worker` loguje któreś z czterech ostrzeżeń (zdjęcia czekają na pochodne, filmy na podgląd, pliki czekają na skan, procesor niedostępny)
- Wtedy powstaje licznik z zamkniętą etykietą rodzaju (`photo_derivatives`, `video_preview`, `scan`, `processor_unreachable`); treść komunikatu, identyfikatory i liczba plików nie są etykietami ani nie trafiają do metryk (test: wstrzyknięty log z danymi nie zmienia etykiet; inne komunikaty nie podnoszą licznika).

**AC2 — Reguła alertu e-mail**
- Zakładając licznik z AC1
- Gdy ostrzeżenie pojawia się w co najmniej dwóch kolejnych przebiegach (czyli stan trwa, nie jednorazowy skok) albo licznik „procesor niedostępny” rośnie przez 15 min
- Wtedy reguła `EviaMediaProcessingStalled` wysyła e-mail do Konrada tym samym kanałem co inne alerty, z rodzajem zastoju i odesłaniem do runbooka; progi (czas, liczba przebiegów) są w `thresholds.yaml`, nie w regule; test `promtool` obejmuje: brak alertu bez ostrzeżeń, alert przy trwałym zastoju, brak alertu po ustaniu, brak fałszywego alertu przy jednym przebiegu.

**AC3 — Brak ciszy, gdy sam proces stoi**
- Zakładając, że `worker` nie działa albo nie loguje (ostrzeżenie nie powstaje, bo nie ma kto go zapisać)
- Gdy to trwa
- Wtedy odpowiada za to istniejący alert braku danych / dostępności z EVM-085 (reguła `EviaStagingNoData`); w historyjce jest to wpisane do runbooka i **sprawdzone testem** (symulowany brak logów `worker`), bez nowej metryki w agencie.

**AC4 — Runbook i dowód działania**
- Zakładając reguły załadowane do Grafany (z pakietem EVM-085, w sesji infrastruktury)
- Gdy wywołuję alert testowo (syntetyczny log lub reguła testowa)
- Wtedy e-mail dochodzi, a runbook `docs/ops/runbooks/alerty.md` ma dla `EviaMediaProcessingStalled` kroki: sprawdź `docker compose -p evia-media ps` i gniazdo, odsyłacz do `media-processor.md`, rozróżnienie „skan” vs „pochodne” vs „film”; dowód w `docs/qa/EVM-144/` (bez danych osobowych).

## Poza zakresem
- Alert zdrowia kontenera procesora i kontrola przy wdrożeniu (EVM-145); komórki pochodnych w `bucket-verify`; pomiar filmów 4K (propozycje c–e posiedzenia).
- Nowa metryka w `metrics.sh` / agencie wdrożeń; nowe konta, płatne plany, zmiany kodu aplikacji.
- Dashboard; powiadomienia inne niż e-mail do Konrada.

## Decyzje i ograniczenia
- **Kod bez Konrada:** liczniki, reguły, progi, testy `promtool`, runbook (AC1–AC3, część AC4) — da się zrobić i przetestować lokalnie.
- **Wymaga sesji infrastruktury z Konradem:** załadowanie reguł do Grafany (ręcznie / CLI, bez modułów OpenTofu — decyzja 2026-11-12) i próba e-mailem (AC4); najlepiej razem z ładowaniem reguł EVM-085 (posiedzenie C), żeby nie robić drugiej sesji.
- Progi startowe do kalibracji na produkcji: zdjęcia 30 min, skan 30 min, film 2 h — jak w aplikacji.
- Jedno środowisko = produkcja: etykieta `env` zgodna z dzisiejszymi regułami (obecnie `staging` w nazwach — nie zmieniamy w tej historyjce).

## Do akceptacji przez Konrada
1. **Alert tylko z istniejących logów aplikacji (bez nowej metryki w agencie)?** Rekomendacja: **tak** — najtaniej, bez zmian w kanale wdrożeń; wystarcza do przypadku z 13–18.11. Konsekwencja: alert wykrywa zastój po 30 min (zdjęcia) i dopiero gdy `worker` działa; „kontener procesora padł” bez plików w kolejce nie da alertu (to EVM-145).
2. **Próg 30 min dla zdjęć i 2 h dla filmów, e-mail do Ciebie?** Rekomendacja: **tak** (zgodne z kodem). Konsekwencja: przy dużym zaległym imporcie po awarii alert może się odezwać mimo że procesor pracuje — kalibrujemy po tygodniu.

## Notatki
- Samo ładowanie reguł może wejść do wspólnej sesji z EVM-085 (posiedzenie C); sprawdź w jej planie, zanim zaplanujesz osobną.

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner) na podstawie propozycji (a) z protokołu posiedzenia procesora mediów
