---
id: EVM-145
title: "Wdrożenie: kontrola, że procesor mediów działa (i alert, gdy nie)"
type: enabler
milestone: M1
epic: E8 Gotowość produkcyjna
status: ready
priority: P1
path: pelna             # infrastruktura produkcyjna i kanał wdrożeń (`infra/deploy-agent/**`) — jedynym recenzentem jest security-engineer (workflow.md → „Ścieżki realizacji”)
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-085, EVM-144]
---

# EVM-145: Wdrożenie — kontrola, że procesor mediów działa

> **Szkic do akceptacji przez Konrada (2026-11-18).** Źródło: propozycje (b) i częściowo (c) z `docs/qa/EVM-084/posiedzenie-procesor-mediow-2026-11-18.md`.

## Cel
Jako **właściciel produktu** chcę, aby **po każdym wdrożeniu kanał sprawdzał, że kontener `media-processor` działa, a jego brak dawał alert**, aby **nowa wersja aplikacji nie wchodziła na produkcję z cicho wyłączonym przetwarzaniem mediów**.

## Kontekst
Kanał wdrożeń dziś nie uruchamia i nie sprawdza `media-processor` (osobny projekt Compose `evia-media`, manifest `/etc/evia/runtime/compose.media.yaml` z digestem podstawionym w sesji infrastruktury; obraz z CI `publish-infra`). Zastój 13–18.11 wynikł z tego, że kontenera nikt nie uruchomił. EVM-144 łapie skutek (pliki stoją); ta historyjka łapie **przyczynę** natychmiast po wdrożeniu i gdy kontener padnie w ciągu dnia. Kontrola nie może osłabiać zasad kanału (deny-by-default, weryfikacja na VM).

## Kryteria akceptacji

**AC1 — Metryka „procesor działa”**
- Zakładając VM z kanałem wdrożeń i projektem `evia-media`
- Gdy agent zbiera metryki hosta
- Wtedy publikuje `evia_media_processor_up` (1 = kontener `running` i zdrowy, a gniazdo robocze `/run/evia/media-work` istnieje i jest tmpfs; 0 = brak któregoś), bez nazw kontenerów, ścieżek i obrazów w etykietach; polecenia infrastruktury tylko do odczytu; testy agenta: kontener działa, zatrzymany, niezdrowy, brak projektu, brak gniazda. **Rozszerzenie (decyzja Konrada 2026-11-18):** ten sam zbiór publikuje `evia_worker_up` (1 = kontener `worker` aplikacji `running` i zdrowy; 0 = zatrzymany, niezdrowy albo brak) — z tymi samymi ograniczeniami etykiet i testami agenta (działa, zatrzymany, niezdrowy, brak).

**AC2 — Kontrola po wdrożeniu**
- Zakładając wydanie wdrażane przez kanał
- Gdy wdrożenie się kończy
- Wtedy kanał sprawdza `evia_media_processor_up` i przy 0 zapisuje to w wyniku wdrożenia oraz w podsumowaniu (kod ostrzeżenia, nie szczegóły), **nie wycofując wydania** (aplikacja działa i kolejkuje; pliki dokończą się po naprawie) i nie uruchamiając ani nie zatrzymując procesora sam; test: wdrożenie z nieobecnym procesorem kończy się ostrzeżeniem, nie błędem.

**AC3 — Alert „procesor niedostępny”**
- Zakładając metrykę z AC1
- Gdy `evia_media_processor_up` = 0 przez dłużej niż próg (domyślnie 10 min) albo brak metryki
- Wtedy reguła `EviaMediaProcessorDown` wysyła e-mail do Konrada tym samym kanałem co inne alerty; test `promtool` (brak alertu przy restarcie ≤ progu, alert przy trwałym 0, alert przy braku metryki dopiero po progu); próg w `thresholds.yaml`. **Rozszerzenie (decyzja Konrada 2026-11-18):** analogiczna reguła `EviaWorkerDown` dla `evia_worker_up` (ten sam kanał, próg w `thresholds.yaml`, te same przypadki `promtool`; wdrożenie, które chwilowo zatrzymuje `worker`, nie alarmuje poniżej progu).

**AC4 — Runbook i bezpieczeństwo kanału**
- Zakładając zmianę w `infra/deploy-agent/**`
- Gdy przegląda ją security-engineer
- Wtedy potwierdza, że kontrola jest tylko do odczytu (bez nowych uprawnień agenta, bez wywołań sieciowych, bez zmiany weryfikacji wydania), a `docs/ops/runbooks/media-processor.md` i `alerty.md` opisują reakcję i sprawdzenie po restarcie VM (`ls -ln /run/evia/media-work`, `docker compose -p evia-media ps` — „czego nie sprawdzono” z protokołu).

## Poza zakresem
- Automatyczne uruchamianie procesora przez kanał i podstawianie digestu (zostaje sesja infrastruktury — wariant do osobnej decyzji); wycofywanie wydania z powodu procesora.
- Jednostka tmpfs `/run/evia/media-work` w IaC i test kolejności przed Dockerem (propozycja (c)), komórki pochodnych w `bucket-verify` (d), pomiar filmów 4K (e), klucz `worker` (f).
- Zmiany kodu aplikacji i procesora.

## Decyzje i ograniczenia
- **Zakres rozszerzony o stan kontenera `worker` (decyzja Konrada 2026-11-18, „Zgadzam się na propozycje”):** EVM-144 AC3 zakładała, że ciszę samego `worker` pokryje alert braku danych — to założenie było błędne (alert patrzy na metryki hosta), więc zatrzymany `worker` przy działającej telemetrii nie dawał żadnego sygnału, a alert zastoju z EVM-144 powstaje właśnie z jego logów. Lukę domyka metryka `evia_worker_up` i reguła `EviaWorkerDown` w tej historyjce (AC1, AC3), bez zmian w aplikacji.
- **Wymaga sesji infrastruktury z Konradem:** nowy skrypt agenta trzeba zainstalować na VM (kanał wdraża agenta lub instalujemy go w sesji — do potwierdzenia przez devops-engineera w planie), załadować reguły do Grafany i sprawdzić alert na żywo; sam kod, testy agenta i reguły da się zrobić bez niego.
- Zmiana `infra/deploy-agent/**` → jedyny recenzent `security-engineer`.

## Decyzje Konrada (2026-11-18: przyjęte wszystkie rekomendacje poniżej)
1. **Tylko kontrola i alert, bez automatycznego uruchamiania procesora przez kanał?** Rekomendacja: **tak** (najprostsze i bezpieczne — uruchamianie wymaga digestu z CI i zmiany uprawnień kanału). Konsekwencja: po świeżej instalacji VM ktoś nadal uruchamia procesor ręcznie w sesji, ale już nie „po cichu” — dostaniesz alert po ok. 10 min.
2. **Wdrożenie z martwym procesorem ma tylko ostrzegać, nie blokować ani cofać?** Rekomendacja: **tak** (aplikacja działa, a pliki wrócą do przetwarzania same po naprawie). Konsekwencja „blokować”: błędny alert zablokowałby poprawkę produkcyjną.
3. **Czy EVM-144 i 145 w jednej sesji z ładowaniem reguł EVM-085?** Rekomendacja: **tak** (jedna sesja zamiast trzech).

## Notatki
- Obraz CI i podstawianie digestu: EVM-124 (`publish-infra`); nie zmieniamy.

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner) na podstawie propozycji (b) z protokołu posiedzenia procesora mediów
- 2026-11-18 — Konrad: „Akceptuję rekomendacje” — wszystkie pytania rozstrzygnięte wg rekomendacji; status `ready` (Tech Lead)
- 2026-11-19 — zakres rozszerzony o `evia_worker_up` i `EviaWorkerDown` (AC1, AC3) decyzją Konrada z 2026-11-18 — domknięcie luki EVM-144 AC3; status bez zmian (Tech Lead)
