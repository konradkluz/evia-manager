# Runbook: wysyłanie zdjęć i skan — magazyn, `clamd` i zadanie skanu workera

> Dokument żywy (EVM-044, EVM-049). Właściciel: `backend-developer`; przegląd: `security-engineer`, `devops-engineer`. Wykonuje Konrad (osoba z dostępem do serwera) i deweloper lokalnie. Wymagania: SR-FILE-02…05, SR-ERR-01, SR-ERR-02, SR-INFRA-02, SR-INFRA-11; polityka P5 (fail-closed). Architektura: [media-pipeline.md](../../architecture/media-pipeline.md), ADR-0009, ADR-0010.

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
Zmienne: `S3_ENDPOINT`, `S3_REGION`, `MEDIA_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` (na stagingu `MEDIA_S3_SECRET_ACCESS_KEY_FILE`), opcjonalnie `MEDIA_MAX_PENDING_PER_USER`, `MEDIA_MAX_PENDING_PER_ORDER`, `MEDIA_ABANDON_AFTER_DAYS` (limity niedokończonych i wiek porzuconego uploadu; domyślnie 200 / 500 / 7, zła wartość = błąd startu), `CLAMD_SOCKET`, `S3_FORCE_PATH_STYLE` (tylko serwer S3 testów), `MEDIA_BUCKET_ORIGIN` (jeden origin https bucketu dla CSP `connect-src`, bez ścieżki i wildcardów). Wzór: `.env.example`.
- **Żadna zmienna** → funkcja wyłączona: każda operacja na mediach odpowiada `503 media_storage_unavailable`, `/api/health` pozostaje zdrowy, worker nie uruchamia skanu (ostrzeżenie w logu).
- **Część zmiennych** → błąd startu z nazwami brakujących zmiennych (bez wartości).
- **Bez `CLAMD_SOCKET`** (przy skonfigurowanym magazynie) → pliki są przyjmowane, ale zostają w `uploaded` i nigdy nie stają się `clean`.

## Objawy i działania
| Objaw | Przyczyna | Działanie |
|---|---|---|
| Panel: pliki długo w „Sprawdzanie pliku” | `clamd` niedostępny albo worker nie działa | log workera: `media: a file could not be scanned` (typ błędu `scanner` lub `storage`, identyfikator pliku); po 30 min ostrzeżenie `media: files wait for a scan for over 30 minutes` z liczbą. Przywróć `clamd`; pliki zostaną skanowane same (ponowienie po 2 minutach), nic nie trzeba kolejkować ręcznie |
| `503 media_storage_unavailable` | brak konfiguracji albo magazyn niedostępny | sprawdź zmienne środowiska API i dostępność bucketu; usługa pozostaje zdrowa |
| Plik `failed` / `checksum_mismatch` | skrót różny od zawartości (uszkodzenie w transmisji) | użytkownik wybiera „Ponów” — nowa sesja dla tego samego medium (klucz ten sam, poprzednia wersja obiektu zostaje 30 dni w buckecie z wersjonowaniem) |
| Plik `quarantined` | `malware_detected` albo `type_mismatch` | Administratorzy dostają e-mail z linkiem do zlecenia i alert bezpieczeństwa; przyczynę widzi tylko Administrator, który może zlecić „Skanuj ponownie” (sekcja „Kwarantanna” niżej); plik jest niedostępny dla nikogo |
| Plik `failed` / `abandoned` | upload bez aktywnej sesji dłużej niż `MEDIA_ABANDON_AFTER_DAYS` (7) | nic nie zginęło: właściciel wybiera plik ponownie, to samo medium dostaje nową sesję (ten sam klucz obiektu); sprzątanie robi zadanie `media.abandoned-uploads` (02:40) |
| `422 limit_exceeded` przy dodawaniu zdjęć | ponad `MEDIA_MAX_PENDING_PER_USER` (200) albo `MEDIA_MAX_PENDING_PER_ORDER` (500) niedokończonych | dokończ albo przerwij wysyłanie; limit liczy tylko `pending_upload`; przy wyścigu równoległych żądań blokada doradcza zapobiega przekroczeniu |
| `clamd` zwraca `INSTREAM size limit exceeded` | limity `clamd` poniżej rozmiaru pliku | w infrastrukturze `StreamMaxLength`, `MaxFileSize` i `MaxScanSize` ≥ 64M oraz `AlertExceedsMax yes` (RR-NOC-T1-3); plik pozostaje w `scanning`, nigdy `clean` |

## Kwarantyna, ponowny skan i retencja (EVM-049; P4, P5; SR-DATA-07)
| Element | Jak działa |
|---|---|
| Wejście | pierwszy wynik pozytywny skanu ustawia `quarantined_at` (raz, niezmienne w bazie). W tej samej transakcji: zdarzenie audytu, po jednym e-mailu na aktywnego Administratora (bez drugiego, gdy dla tego zlecenia czeka już taki sam) i alert bezpieczeństwa `media_quarantined` (log: `alert: "security"`, `alertCode`) |
| E-mail | sam link do zlecenia: `{PANEL_ORIGIN}/work-orders/{id}` (origin z konfiguracji, nigdy z żądania); bez nazwy pliku, klienta, adresu i przyczyny |
| Ponowny skan | `POST …/media-assets/{id}/rescan` — Administrator, step-up, `Idempotency-Key`; `quarantined` → `scanning`, worker bierze plik od razu i wykonuje **pełny** skan (suma kontrolna, typ po zawartości, ClamAV). Wynik pozytywny: bez nowego e-maila i alertu, tylko audyt `media_file.rescanned`. Termin 30 dni się nie przesuwa. Po terminie: `409 invalid_state_transition` |
| Retencja | zadanie `media.quarantine-retention` (co godzinę, 5 min po pełnej): po 30 dniach kalendarzowych od pierwszego wejścia (początek dnia `Europe/Warsaw`; funkcja `media.quarantine_expires_at`) usuwa obiekt (`DeleteObject` bez wersji = znacznik usunięcia), potem ustawia `purged_at` i zapisuje audyt `media_file.quarantine_purged`. To retencja techniczna, nie wpis rejestru usunięć; wiersz metadanych zostaje (kafel „Plik usunięty po 30 dniach kwarantanny”). Błąd magazynu = brak `purged_at` i ponowienie za godzinę |
| Zgodność z ADR-0009 | aplikacja nie ma bypass blokady obiektów (tryb governance 30 dni), więc stare wersje obiektu znikają dopiero z lifecycle (noncurrent 30 d, T3): bajty fizycznie znikają po ok. 60 dniach. Do potwierdzenia przez Konrada na demo. Lifecycle bucketu jako druga warstwa działa tylko z tagiem albo prefiksem; do czasu wdrożenia (T3) **jedyną kontrolą jest sweeper** |
| Sygnatury | zadanie `media.signature-monitor` (co 15 min) czyta `VERSION` z `clamd` (kontener z `TZ=UTC`, data czytana jako UTC): powyżej 24 h jeden alert `signature_stale` na epizod, powyżej 72 h `signature_stale_72h` raz na dobę; wiek nieznany (brak odpowiedzi, śmieci, data z przyszłości) dłużej niż 24 h liczy się jak stary. Skan działa dalej na starszych sygnaturach. Deduplikacja w bazie (`platform.security_alert_outbox`) |
| Brak wysyłki na zewnątrz | `clamd` i `freshclam` nie mają ustawionej opcji raportowania wykryć (`SubmitDetectionStats` nieustawione); `clamd` jest w sieci `evia-scan` bez egressu, plik nigdy nie trafia do zewnętrznego serwisu (P5) |

| Objaw | Działanie |
|---|---|
| Alert `signature_stale` / `signature_stale_72h` | sprawdź `freshclam` (kontener w sieci `evia-updates`) i wolumen `evia-clamav-signatures`; skan nadal działa na starych sygnaturach |
| Plik `quarantined` starszy niż 31 dni, nie `purged` | sweeper nie działa (magazyn niedostępny albo worker): sprawdź log `quarantine retention: the object could not be removed`; zadanie ponawia się co godzinę. Reguła Grafana „wiek najstarszego nieusuniętego pliku w kwarantannie > 31 d” — zadanie T3 |
| Odtworzenie bazy z kopii | rekordy bez `purged_at` zostaną usunięte ponownie przez sweeper (usunięcie jest idempotentne); kopia mediów (`rclone sync` do Storage Box ze snapshotami) może przechowywać obiekty z kwarantanny dłużej niż 30 dni i nieskanowane — wykluczenie do rozważenia w T3 |

Zadania T3 (poza tą historyjką): reguły Grafana dla `media_quarantined`, wieku sygnatur i awarii retencji; test alertu na stagingu (AC7); lifecycle bucketu (kwarantanna 30 d, noncurrent 30 d). Dopóki ich nie ma, działa e-mail do Administratorów i wpis `security_alert_outbox` (log `alert: "security"`).

## Czego tu nie ma
Pobieranie i podgląd (EVM-045), miniatury i metadane (EVM-068), wideo (EVM-046), dokumenty (EVM-047), usuwanie (EVM-051).
