# Runbook: wysyłanie zdjęć i skan — magazyn, `clamd` i zadanie skanu workera

> Dokument żywy (EVM-044). Właściciel: `backend-developer`; przegląd: `security-engineer`, `devops-engineer`. Wykonuje Konrad (osoba z dostępem do serwera) i deweloper lokalnie. Wymagania: SR-FILE-02…05, SR-ERR-01, SR-ERR-02, SR-INFRA-02, SR-INFRA-11; polityka P5 (fail-closed). Architektura: [media-pipeline.md](../../architecture/media-pipeline.md), ADR-0009, ADR-0010.

Zdjęcie przechodzi **jedną drogą**: panel tworzy medium (`createMediaAssets`) i sesję (`createUploadSession`) → części idą **bezpośrednio** do prywatnego bucketu podpisanymi URL-ami → `completeUploadSession` składa obiekt i ustawia `uploaded` → **worker** czyta obiekt raz (SHA-256, typ z zawartości, `INSTREAM` do `clamd`) i ustawia stan `clean`, `quarantined` albo `failed`. Plik w stanie innym niż `clean` i `ready` nie jest dostępny dla nikogo.

## Jak to działa
| Element | Gdzie | Co robi |
|---|---|---|
| Tabele | schemat `media` (migracja `0045`) | `media_assets`, `stored_files` (stan, klucz obiektu, skróty), `upload_sessions` (sesja 7 dni, jedna aktywna na plik) |
| Klucz obiektu | `media/{rok}/{miesiąc}/{id pliku}/original` | nadaje serwer; bez nazwy pliku, numeru zlecenia i danych osobowych |
| Sesja | API | części po 16 MiB, najwyżej 1000; URL części ważny 3600 s, związany z kluczem, numerem i `Content-Length` |
| Skan | worker, pętla co 5 s (`MediaScanService`) | bierze pliki `uploaded` i `scanning` nietknięte od 2 minut (compare-and-set); co najwyżej 5 na przebieg, po kolei |
| `clamd` | `CLAMD_SOCKET` | `tcp://host:port` (staging: kontener w sieci `evia-scan`) albo `unix:///ścieżka` |

## Konfiguracja (wszystko albo nic)
Zmienne: `S3_ENDPOINT`, `S3_REGION`, `MEDIA_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` (na stagingu `MEDIA_S3_SECRET_ACCESS_KEY_FILE`), opcjonalnie `CLAMD_SOCKET`, `S3_FORCE_PATH_STYLE` (tylko serwer S3 testów), `MEDIA_BUCKET_ORIGIN` (jeden origin https bucketu dla CSP `connect-src`, bez ścieżki i wildcardów). Wzór: `.env.example`.
- **Żadna zmienna** → funkcja wyłączona: każda operacja na mediach odpowiada `503 media_storage_unavailable`, `/api/health` pozostaje zdrowy, worker nie uruchamia skanu (ostrzeżenie w logu).
- **Część zmiennych** → błąd startu z nazwami brakujących zmiennych (bez wartości).
- **Bez `CLAMD_SOCKET`** (przy skonfigurowanym magazynie) → pliki są przyjmowane, ale zostają w `uploaded` i nigdy nie stają się `clean`.

## Objawy i działania
| Objaw | Przyczyna | Działanie |
|---|---|---|
| Panel: pliki długo w „Sprawdzanie pliku” | `clamd` niedostępny albo worker nie działa | log workera: `media: a file could not be scanned` (typ błędu `scanner` lub `storage`, identyfikator pliku); po 30 min ostrzeżenie `media: files wait for a scan for over 30 minutes` z liczbą. Przywróć `clamd`; pliki zostaną skanowane same (ponowienie po 2 minutach), nic nie trzeba kolejkować ręcznie |
| `503 media_storage_unavailable` | brak konfiguracji albo magazyn niedostępny | sprawdź zmienne środowiska API i dostępność bucketu; usługa pozostaje zdrowa |
| Plik `failed` / `checksum_mismatch` | skrót różny od zawartości (uszkodzenie w transmisji) | użytkownik wybiera „Ponów” — nowa sesja dla tego samego medium (klucz ten sam, poprzednia wersja obiektu zostaje 30 dni w buckecie z wersjonowaniem) |
| Plik `quarantined` | `malware_detected` albo `type_mismatch` | przyczyna, alert i ponowny skan — EVM-049; do tego czasu plik jest niedostępny dla nikogo |
| `clamd` zwraca `INSTREAM size limit exceeded` | limity `clamd` poniżej rozmiaru pliku | w infrastrukturze `StreamMaxLength`, `MaxFileSize` i `MaxScanSize` ≥ 64M oraz `AlertExceedsMax yes` (RR-NOC-T1-3); plik pozostaje w `scanning`, nigdy `clean` |

## Czego tu nie ma
Pobieranie i podgląd (EVM-045), miniatury i metadane (EVM-068), wideo (EVM-046), dokumenty (EVM-047), przyczyna kwarantanny i ponowny skan (EVM-049), usuwanie (EVM-051).
