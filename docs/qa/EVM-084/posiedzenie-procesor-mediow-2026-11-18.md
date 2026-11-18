# EVM-084 — posiedzenie „procesor mediów” sesji IaC (produkcja, 2026-11-18)

Środowisko: produkcja (VM Hetzner CAX11 `evia-staging`, jedno środowisko od 2026-11-13). Historyjka: [EVM-084](../../backlog/M0/EVM-084-backupy-i-test-odtworzenia-staging.md). Wykonał krok A10 odłożony w [posiedzeniu A](posiedzenie-a-2026-11-13.md): orkiestrator przez SSH w obecności właściciela (Konrad); port 22 otwarty ręcznie w konsoli Hetznera na czas sesji i zamknięty po niej (potwierdzone: połączenie kończy się limitem czasu). Żadne tokeny chmurowe nie powstały. Dowody bez sekretów, adresów i identyfikatorów kluczy.

**Wynik: PASS — `media-processor` działa na produkcji od 2026-11-18.** Przed sesją procesor nigdy nie działał (A10 z 2026-11-13 odłożony), 6 plików stało w stanie `processing` (najstarszy z 2026-11-13), żadnego `ready`. Po sesji: kontener `healthy`, wszystkie zaległe pliki i test właściciela `ready`, 0 OOM.

## Obraz (dowód pochodzenia)
- Obraz: `ghcr.io/konradkluz/evia-media-processor@sha256:e1f4e2a029b5f97e8ebb803ce02e0fedf146c517b9568ade532aca9babad1eb6`, `linux/arm64`; przebieg CI `44167153515` (`push` na `main`, `ci.yml`, commit `9d984bbf`).
- Trivy: 0 High/Critical, 0 wyjątków (procesor nie ma rejestru wyjątków); SBOM CycloneDX z przebiegu zawiera pakiet `ffmpeg` (wersja przypięta w Dockerfile).
- Atestacja pochodzenia zweryfikowana (`gh attestation verify`; `ci.yml@refs/heads/main`, runner GitHuba, bez self-hosted).
- Dowody (rekord, SBOM, wynik Trivy, atestacja) są artefaktami przebiegu CI — nie są kopiowane do repozytorium.

## Kroki
| Krok | Wynik | Dowód / uwagi |
|---|---|---|
| P1–P4 przed sesją (stacja): przebieg, rekord, Trivy + SBOM, atestacja | PASS | przebieg `44167153515`, commit `9d984bbf`; Trivy 0 High/Critical; atestacja OK |
| S0 połączenie | PASS | SSH kluczem, port 22 z reguły tymczasowej w konsoli Hetznera |
| S1 rozpoznanie | PASS | brak kontenera `media-processor`; `compose.media.yaml` z zerowym digestem (kopia z 2026-11-13); tmpfs `/run/evia/media-work` `drwxrws---` `10005:10002`; `/var/lib/evia/media-video` dm-crypt 15 G (14 G wolne); root 28%; `available` 1913 MB, bez swapu; 0 OOM; `docker.service` `After` zawiera `evia-work-volumes.service` i mount tmpfs `media-work` (kolejność poprawna); sieć `evia-scan` internal; kontenery zdrowe, `RestartCount` 0 |
| S2 licznik kolejki (za zgodą właściciela) | PASS | `processing` × 6 (najstarszy 2026-11-13 12:35 UTC), `ready` × 0; jedno zapytanie licznikowe (same liczby stanów, bez treści i danych osobowych) |
| S3 obraz po digeście | PASS | `docker pull` po digeście; `linux/arm64`; `RepoDigests` = digest z rekordu CI |
| S4 plik compose | PASS | `compose.media.yaml` z commita `9d984bbf` zainstalowany (0644 root), digest podstawiony w kopii na VM (w repozytorium zostaje zerowy zaślepek), `config -q` = OK; kopia poprzedniego pliku: `/root/compose.media.yaml.bak-2026-11-18` |
| S5 start (07:37 UTC) | PASS | `up -d --pull never`; `evia-media-media-processor-1` `healthy`; gniazdo `srw-rw---- 10005:10002 processor.sock`; `Memory` 2147483648, `OomScoreAdj` 500, 0 restartów |
| S6 zaległość | PASS | 6 zaległych plików → `ready` (5 zdjęć, 1 film) do 07:42 UTC; kody w logu procesora wyłącznie `ok`; zapis pochodnych do bucketu działa (pierwsze potwierdzenie na żywo polityki `media_worker` dla pochodnych) |
| S7 testy właściciela | PASS | zdjęcie + film ≤ 1 min → `ready`; łącznie 6 zdjęć i 2 filmy `ready`, 10 zadań z kodem `ok`; właściciel potwierdził podglądy w panelu |
| S8 pomiar zasobów | PASS | szczyt pamięci (cgroup `memory.peak`): procesor 210 MB (spoczynek 61 MB; limit 2 GiB), worker 132 MB; `oom` i `oom_kill` = 0; `available` ok. 1,9 GB; `media-video` i `media-work` puste po przetworzeniu |
| S9 restart VM | pominięty | kolejność jednostek poprawna (S1); nie był warunkiem sukcesu |
| Zamknięcie | PASS | reguła portu 22 usunięta w konsoli Hetznera; test z zewnątrz: limit czasu połączenia |

## Odstępstwa od planu
- Rola bazy w zapytaniu licznikowym: `evia_owner` (plan zakładał `postgres`).
- `docker image inspect --format '{{.Id}}'` na VM zwraca digest manifestu (magazyn obrazów containerd), nie `imageId` z rekordu CI; porównanie obrazu opiera się na `RepoDigests` (runbook już to opisuje).
- S9 (restart VM) pominięty.
- VM zostaje CAX11 (decyzja właściciela).

## Czego nie sprawdzono
- Film 4K / HEVC: nie testowano (pamięć i czas ffmpeg względem limitu 15 min nieznane); do czasu pomiaru nie obiecujemy dużych filmów z terenu.
- Restart VM po instalacji procesora (czy gniazdo i kontener wstają same): nie sprawdzono; po każdym restarcie VM sprawdź `ls -ln /run/evia/media-work` i `docker compose -p evia-media ps`.
- Zdjęcie i film z telefonu (online i po synchronizacji offline), eksport ZIP, czas przetwarzania filmu w sekundach i obciążenie CPU: w notatkach sesji brak wyników — nie sprawdzono.
- Wywołanie `bucket-verify` z komórkami pochodnych: nie wykonano (test zdjęcia i filmu jest dowodem pośrednim, że `PUT` pochodnych przechodzi, a `original` pozostaje 403 wg macierzy z 2026-11-13).

## Stan po sesji
- `media-processor` działa (projekt `evia-media`), obraz po digeście jak wyżej; zainstalowany `/etc/evia/runtime/compose.media.yaml` pochodzi z commita `9d984bbf` z podstawionym digestem.
- Kopia poprzedniego manifestu na VM: `/root/compose.media.yaml.bak-2026-11-18`.
- Port 22 zamknięty. Nie powstały tokeny do unieważnienia.
- Zdarzenie procesora i kolejka: brak alertu „przetwarzanie stoi” — zastój od 2026-11-13 do 2026-11-18 nie dał żadnego sygnału (zob. propozycje).

## Do zrobienia w kodzie (nie da się poprawić samą dokumentacją)
- `infra/runtime/compose.media.yaml`, nagłówek: zdanie „The image is built by the IaC session from the commit of the release …” jest nieaktualne po EVM-124; zamiast tego: „obraz z CI (`publish-infra`), digest podstawia sesja IaC” (sam komentarz, bez zmiany zachowania; R6).
- `compose.staging.yaml` (komentarz przy `MEDIA_PROCESSOR_*`) i `wdrozenie-staging.md`: nazwy „staging” przy jednym środowisku produkcyjnym — kosmetyka (R8, bez pilności).

## Wnioski i propozycje (do backlogu przez `/refine`; historyjek nie tworzono)
- (a) Alert „przetwarzanie stoi”: metryka liczby plików `clean` / `processing` starszych niż 30 min + reguła alertu oraz alert zdrowia kontenera procesora — zastój od 2026-11-13 do 2026-11-18 nie dał żadnego sygnału.
- (b) Test wdrożeniowy / kontrola kanału wdrożeń: obecność i zdrowie `media-processor` (kanał go nie uruchamia ani nie sprawdza).
- (c) R4 / R5: jednostka tmpfs `/run/evia/media-work` w IaC (`user-data`; dziś istnieje tylko jako opis w runbooku) i kolejność przed Dockerem (na VM kolejność jest poprawna — sprawdzone w S1) wraz z testem w `repo-policy`.
- (d) R7: komórki pochodnych (`thumbnail.webp`, `preview.webp`, `preview.mp4`) w macierzy `bucket-verify`.
- (e) Pomiar pamięci i czasu dla filmu 4K / HEVC przed dopuszczeniem dużych filmów z terenu.
- (f) Klucz `worker` do rejestru usunięć (EVM-139 AC6) — razem z posiedzeniem B (najpóźniej do 2026-12-06, żeby tydzień w trybie `report` mieścił się przed terminem RR-91).
