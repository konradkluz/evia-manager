# Runbook: przetwarzanie zdjęć w izolacji (`media-processor`)

> Dokument żywy. EVM-068 (ADR-0009 „Przetwarzanie w izolacji”, SR-FILE-04, SR-FILE-06, SR-INPUT-04, SR-INFRA-11; TM-35, TM-36, TM-76). Właściciel: `devops-engineer`; recenzja: `security-engineer`. Powiązane: [wysyłanie zdjęć i skan](wysylanie-zdjec-i-skan.md), [wdrożenie stagingu](wdrozenie-staging.md), [`media-pipeline.md`](../../architecture/media-pipeline.md). **Stan: kod, konfiguracja i testy gotowe, nieaktywne do sesji IaC** (kontener, tmpfs hosta i zmiana polityki bucketu wymagają sesji IaC; w historyjce nie wykonano `tofu apply`).

## Co to jest
Worker (`worker`) bierze zdjęcia w stanie `clean`, przekazuje oryginał kontenerowi `media-processor` (libvips przez `sharp`) i zapisuje miniaturę 320 px oraz podgląd 1600 px (WebP, bez EXIF/GPS/XMP/IPTC/ICC, z zastosowaną orientacją) obok oryginału w prywatnym bucketcie. Potem plik jest `ready`.

- Kontener nie ma sieci (`network_mode: none`), root FS tylko do odczytu, `cap_drop: ALL`, `no-new-privileges`, użytkownik `10005:10002`, pamięć 1,5 GB, 2 CPU, limit procesów. Komunikacja wyłącznie gniazdem Unix `/run/media-work/processor.sock`.
- **Obszar roboczy** `/run/media-work` to **tmpfs hosta** współdzielony z workerem (zdjęcia prywatnych posesji nie trafiają na dysk hosta — P3). Montuje go tylko `worker` (i `media-processor`); nie `api`, nie `clamd`. Worker sprząta katalogi zadań po każdej próbie i przy starcie.
- Każde zadanie działa w osobnym procesie potomnym, który po 60 s dostaje `SIGKILL`. Zadania idą po jednym. Worker czeka na odpowiedź najwyżej 75 s.
- Wynik procesora jest traktowany jako niezaufany: worker czyta pliki wyjściowe wyłącznie pod stałymi nazwami, przez `lstat` + `O_NOFOLLOW` (zwykły plik, jedna nazwa, nie dowiązanie), ≤ 2 MB, kontener RIFF/WEBP z wymiarami z nagłówka zgodnymi z odpowiedzią. Dopiero wtedy `PutObject`.

## Instalacja (sesja IaC, kolejność ma znaczenie)
1. **Tmpfs hosta.** Jednostka `run-evia-media\x2dwork.mount` (`What=tmpfs`, `Where=/run/evia/media-work`, `Type=tmpfs`, `Options=size=512m,mode=2770,uid=10005,gid=10002,nosuid,nodev,noexec`). Katalog ma grupę workera (`10002`) i bit setgid, więc pliki zadań są wspólne dla grupy; `noexec` — nic z obszaru nie może być uruchomione.
2. **Obraz.** `docker build -f infra/images/media-processor/Dockerfile -t evia-media-processor:local .` z katalogu głównego commitu wydania (kontekst ograniczony przez `Dockerfile.dockerignore`). Obraz bazowy przypięty digestem, ten sam co obraz API. Zeskanuj Trivy (obraz i konfiguracja) przed uruchomieniem — publikacja obrazu w `publish` i skan w CI to osobny krok (dług, patrz niżej).
3. **Polityka bucketu** (`tofu apply` w sesji IaC): `media_worker` dostaje `PutObject` wyłącznie na `media/*/thumbnail.webp` i `media/*/preview.webp`, warunkowo (`If-None-Match: *`, bez nadpisywania), a oryginały `media/*/original` mają jawny Deny. Klucz workera już istnieje (RR-42); nie powstaje nowy.
4. **Kontener.** `docker compose --project-name evia-media -f /etc/evia/runtime/compose.media.yaml up -d`. Sprawdź `docker compose ... ps` (zdrowy) i że gniazdo `/run/evia/media-work/processor.sock` ma `0660`, grupę `10002`.
5. **Kanał wdrożeń.** Dopiero teraz zwykłe wdrożenie wydania: worker w `compose.staging.yaml` montuje `/run/evia/media-work` i ma `MEDIA_PROCESSOR_SOCKET`/`MEDIA_PROCESSOR_WORKDIR`. **Weryfikator (`deploy-agent`) musi być już w wersji, która dopuszcza ten jeden wolumen workera** (zmiana `compose-policy.ts` z EVM-068; obraz agenta aktualizuje sesja IaC). W produkcji (`NODE_ENV=production`, staging też) worker **nie startuje**, jeśli skan jest włączony, a brak tych dwóch zmiennych — zamiast cicho pominąć przetwarzanie.
6. **Weryfikacja kluczy** (`bucket-verify.sh`, prawdziwymi kluczami, bez zmian w macierzy): zwykły `PUT` kluczem workera nadal `403`. Ręcznie uzupełnij dwie komórki, których macierz jeszcze nie ma: `PUT` z `If-None-Match: *` na `media/9999/12/<uuid>/thumbnail.webp` → OK (potem obiekt usuń kluczem workera nie jest możliwy — sprzątanie przez IaC), `PUT` na `.../original` → `403` także z nagłówkiem. Dowód do `docs/qa/EVM-068/`.

## Pliki sprzed wdrożenia i kolejka
Pętla bierze każde zdjęcie w stanie `clean` albo `processing` nietknięte od 5 minut — pliki, które były `clean` przed wdrożeniem, zostaną przetworzone automatycznie (10 na przebieg, bez czekania na interwał, dopóki jest zaległość). Filmy są pomijane (EVM-046). Ostrzeżenie w logu `media: photos wait for their derivatives for over 30 minutes` (z liczbą) znaczy, że procesor nie nadąża albo jest niedostępny.

## Błędy i reakcje
| Objaw | Znaczenie | Reakcja |
|---|---|---|
| plik `failed` / `processing_error`, panel: „Nie udało się przygotować podglądu. Spróbujemy ponownie.” | trzy próby wyczerpane albo błąd trwały (bomba pikseli > 100 MP, nieobsługiwany format, uszkodzony plik, zły wynik procesora, suma kontrolna oryginału inna niż po skanie) | oryginał zostaje i jest po udanym skanie (do pobrania w EVM-045); sprawdź log workera (`job: media.process`, kod: `pixel_limit`, `unsupported`, `invalid_output`, `timeout`, `internal`, `storage`, `original_changed`) |
| wszystkie nowe zdjęcia `failed` | procesor nie działa albo zła grupa/uprawnienia obszaru | `docker compose -p evia-media ps`, `ls -ln /run/evia/media-work`, sprawdź gniazdo; po naprawie pliki `failed` nie wracają same (tylko `clean`/`processing` są brane) — zgłoś, jeśli trzeba je ponowić ręcznie (osobna decyzja, nie ma jeszcze operacji) |
| OOM kontenera | bomba dekompresji mimo limitu 100 MP | próba została zużyta już przy przejęciu pliku, więc plik kończy `failed` po trzech próbach; kontener wstaje sam (`restart: unless-stopped`) |
| katalogi UUID w `/run/media-work` | pozostałość po awarii workera | zniknie przy starcie workera (`cleanup`); ręcznie: usuń katalogi, nie dotykaj `processor.sock` |

## HEIC
Upload przyjmuje `image/heic`, ale prebuilt libvips z `sharp` nie dekoduje HEVC. Takie pliki kończą jako `failed` / `processing_error` od razu (błąd trwały `unsupported`, bez ponowień). Pełne wsparcie HEIC (własny build libvips z libheif+x265, licencje GPL/patenty) to osobna decyzja — historyjka EVM-068, „Uwagi do rozważenia”.

## Licencje
`sharp` 0.35.5 — Apache-2.0. Prebuilt `@img/sharp-libvips-*` (libvips z zależnościami) — LGPL-3.0-or-later, linkowany dynamicznie, niemodyfikowany, bez dystrybucji poza naszą infrastrukturą. Skrypt `build` pakietu `sharp` (kompilacja ze źródeł) jest zablokowany w `pnpm-workspace.yaml` (`sharp: false`).

## Dług i otwarte kroki
- Publikacja obrazu `evia-media-processor` w CI (`publish`, manifest wydania) i skan Trivy (obraz) w `pnpm run scan`/CI — dziś obraz buduje sesja IaC.
- Macierz `bucket-verify` (`bucket-matrix.tsv`) bez komórek `PUT pochodnej = OK` / `PUT oryginału = odmowa` — wymaga rozszerzenia skryptu o sufiks klucza próbnego.
- SR-FILE-10 (limity wystawiania adresów miniatur, P10) dochodzi w EVM-045; do tego czasu chroni globalny limit 300/min/użytkownika.
