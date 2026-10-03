---
id: EVM-044
title: Zdjęcia w zleceniu — wysyłanie z panelu i skan bezpieczeństwa
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-007, EVM-011, EVM-038, EVM-071]
---

# EVM-044: Zdjęcia w zleceniu — wysyłanie z panelu i skan bezpieczeństwa

## Historyjka
Jako **pracownik biura albo technik z przeglądarką w telefonie** chcę **wysłać zdjęcia do zlecenia, a system sprawdził każdy plik, zanim ktokolwiek go otworzy**, aby **dokumentacja zdjęciowa była w archiwum zlecenia i nie wprowadzała złośliwych plików**.

## Kontekst
- Część (a) podziału EVM-044 (konsultacja `solution-architect`, W3): upload i skan. Przetwarzanie i miniatury — EVM-068 (b).
- ADR-0009 (storage, multipart z podpisanymi URL-ami, ClamAV, kwarantanna 30 dni, niedokończone uploady 7 dni), P5 (fail-closed), `StoredFile` i `UploadSession` (`domain-model.md`). Wspólny protokół web i mobile — `docs/architecture/media-pipeline.md` z EVM-011 (rozmiar części, odświeżanie URL-i, SHA-256 / `checksum_mismatch`).
- Roadmapa M1: „Telefon może tymczasowo dodawać zdjęcia przez przeglądarkę” — ten sam protokół (zastępuje kroki mobilne A6, B10, C9 w UAT M1). Zanim technik wyjdzie z garażu bez zasięgu, przeglądarka może utracić kartę (blokada ekranu, wyładowanie z pamięci przy otwarciu aparatu), więc rekomendowanym źródłem zdjęć jest galeria telefonu, a panel mówi, co nie zostało wysłane (zasada „nic nie ginie”, przegląd `ux-designer` EVM-010). Wariant aparat / galeria — decyzja 18; panel na prywatnym telefonie (BYOD) — decyzja 19 i zasady z instrukcji EVM-066.
- Decyzja 14: staging CX33 (8 GB RAM) od tej historyjki. Makiety: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) (panel) i W-09 w szerokości `breakpoint.compact` — przeglądarka w telefonie (EVM-071).

## Kryteria akceptacji
**AC1 — Wysyłanie zdjęć**
- Zakładając zakładkę „Media i dokumenty” zlecenia
- Gdy wybieram albo upuszczam 5 zdjęć JPEG, ustawiam kategorię „W trakcie prac” i wybieram „Wyślij 5 plików”
- Wtedy panel tworzy media (UUIDv7 z klienta) i sesje uploadu, wysyła pliki częściami bezpośrednio do storage'u przez podpisane URL-e, pokazuje „Wysyłanie · 3 z 5 · nie zamykaj karty do końca wysyłania”, a po zakończeniu każdy plik ma stan „Sprawdzanie pliku”; w dzienniku zlecenia powstaje zdarzenie dodania mediów (EVM-038).

**AC2 — Typ i rozmiar (SR-FILE-01, SR-FILE-03)**
- Gdy wybieram plik SVG, HTML, archiwum albo zdjęcie > 50 MB
- Wtedy panel odrzuca go przed wysłaniem z komunikatem (np. „Plik „x.svg” ma nieobsługiwany format…”)
- Oraz gdy plik o rozszerzeniu `.jpg` ma inną zawartość, wtedy po wysłaniu trafia do kwarantanny z przyczyną `type_mismatch` (typ wykrywany z zawartości).

**AC3 — Skan fail-closed i plik z wirusem testowym (SR-FILE-05, SR-ERR-01, SR-ERR-02)**
- Zakładając, że `clamd` jest niedostępny
- Gdy plik czeka na skan
- Wtedy pozostaje w „Sprawdzanie pliku”, skan jest ponawiany i plik nigdy nie przechodzi do `clean` bez skanu; plik jest niedostępny dla nikogo, dopóki nie jest `clean`
- Oraz gdy wysyłam plik testowy EICAR (prawdziwy ClamAV w CI — Testcontainers), plik ma stan kwarantanny z przyczyną `malware_detected`, nie jest przetwarzany ani dostępny do pobrania, a W-09 pokazuje przy nim znacznik „Wymaga uwagi” (przyczyna, alert i ponowny skan — EVM-049).

**AC4 — Wysyłanie z przeglądarki w telefonie (makieta W-09 compact z EVM-071)**
- Zakładając Edytora w przeglądarce telefonu z Androidem (szerokość `breakpoint.compact`) i 12 zdjęć zrobionych aparatem systemowym — zdjęcia są w galerii telefonu (wariant z decyzji 18)
- Gdy wybiera „Dodaj zdjęcia” → „Wybierz z galerii”, zaznacza 12 zdjęć i je wysyła
- Wtedy każdy plik ma własny status (w kolejce, wysyłanie z postępem, „Sprawdzanie pliku”, „Wysłano”, „Nie wysłano”), wszystkie cele dotyku mają co najmniej `size.touch-target.min`, a po zakończeniu panel pokazuje „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”; zdjęcia zostają w galerii jako kopia do tego potwierdzenia
- Oraz po zablokowaniu ekranu i powrocie wysyłanie wznawia się od ostatniej potwierdzonej części, a gdy karta została zamknięta albo wyładowana z pamięci przed końcem, po ponownym otwarciu zlecenia panel pokazuje „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” z nazwami tych plików (na podstawie niedokończonych sesji uploadu użytkownika — bez zapisu danych w pamięci przeglądarki, SR-WEB-05).

**AC5 — Integralność (SR-CRYPTO-05)**
- Zakładając zadeklarowany skrót SHA-256 różny od zawartości
- Gdy kończy się wysyłanie
- Wtedy plik ma stan `failed` z przyczyną `checksum_mismatch`, a W-09 pokazuje „Nie wysłano — plik uszkodzony w transmisji” z „Ponów” (plik jest w pamięci karty do jej zamknięcia).

**AC6 — Sesja uploadu (SR-FILE-02)**
- Gdy sesję uploadu wystawia serwer
- Wtedy klucz obiektu nadaje serwer (bez nazwy pliku, numeru zlecenia i danych osobowych), URL części ma TTL 60 min i jest związany z kluczem, numerem i rozmiarem części, `complete` weryfikuje łączny rozmiar, a sesję może kontynuować tylko jej twórca (inny użytkownik — `404`).

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wysyła zdjęcie
- Wtedy A i E wysyłają, R nie widzi Uploadera i dostaje `403 forbidden`, niezalogowany — `401`; sesja uploadu medium zlecenia B ścieżką zlecenia A — `404`.

**AC8 — Stany**
- Wtedy: offline — wysyłanie wstrzymane („Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.”) i wznawiane od ostatniej potwierdzonej części; próba zamknięcia karty z niewysłanymi plikami — ostrzeżenie przeglądarki; brak mediów — „To zlecenie nie ma jeszcze zdjęć…”; `429` — wzór z README makiet; „Wstrzymaj” przy pliku.

## Poza zakresem
- Miniatury, podglądy i usuwanie metadanych z pochodnych — EVM-068. Podgląd i pobranie — EVM-045. Filmy — EVM-046. Dokumenty — EVM-047.
- Przyczyna kwarantanny, alert i ponowny skan — EVM-049. Usuwanie — EVM-051.
- Rozpoznawanie zdjęć już wysłanych przy ponownym wyborze z galerii (duplikaty) — poza M1; komunikat z AC4 podaje nazwy niewysłanych plików. Upload w tle i kolejka offline — aplikacja (M2).

## UX / UI
- W-09: Uploader i UploadQueueItem (§ 3.12) z „Wybierz pliki” obok strefy upuszczania, dialog „Dodaj 5 plików” (kategoria, opcjonalnie opis), znaczniki pliku [P-7] („Sprawdzanie pliku”, „Wymaga uwagi”, „Nie wysłano”), panel postępu.
- W-09 w przeglądarce telefonu (`breakpoint.compact`, makieta EVM-071): „Dodaj zdjęcia” z wyborem źródła wg decyzji 18, status przy każdym pliku, cele dotyku ≥ `size.touch-target.min`, potwierdzenie „Wysłano 12 zdjęć — możesz je usunąć z telefonu.”, stan po powrocie do karty „Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.” (AC4).
- Stany: AC4, AC8; brak uprawnień — AC7. Wybór etapu w dialogu — od EVM-048.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wysyłanie zdjęć |
| Edytor | wysyłanie zdjęć |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: zdjęcia (mogą zawierać twarze, tablice rejestracyjne, GPS w oryginale — P3), `originalFilename` (oczyszczona metadana).
- Telefon pracownika (M1, przejściowo do aplikacji M2): kopie zdjęć w galerii prywatnego telefonu do potwierdzenia „Wysłano” i sesja panelu w przeglądarce — ryzyko do akceptacji Konrada (decyzje 18 i 19, nowe RR w `threat-model.md` — EVM-065 AC4); zasady pracy na telefonie (w tym wyłączona automatyczna kopia zdjęć w chmurze i opróżniany kosz galerii) — instrukcja EVM-066 AC2.
- W AC: SR-FILE-01, SR-FILE-03, SR-FILE-05, SR-ERR-01, SR-ERR-02, SR-CRYPTO-05, SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05, SR-WEB-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-01, SR-FILE-04 (limity ClamAV), SR-INFRA-02 (bucket prywatny — test „anonimowy GET = 403”), SR-INFRA-11 (limity zasobów), SR-WEB-01 (CSP `connect-src` z domeną bucketu), SR-DATA-01, SR-LOG-03. Polityki P3, P5, P10.

## Notatki techniczne
- Moduły: `media` (`MediaAsset`, `StoredFile`, `UploadSession`), `timeline` (zdarzenie), worker + panel.
- `devops-engineer`: CORS bucketu dla `PUT` z originu panelu (`ExposeHeaders: ETag`), CSP `connect-src`, lifecycle (niedokończone uploady 7 dni, kwarantanna 30 dni), kontenery `clamd` i `freshclam`, wdrożenie workera na staging (CX33 — decyzja 14).
- Atrapa skanera i S3 w testach jednostkowych; prawdziwy ClamAV z EICAR w CI. Media w testach — wyłącznie generowane syntetycznie.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-044 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] Dokumentacja (runbook mediów) i `CHANGELOG.md` zaktualizowane
- [ ] Demo (także z przeglądarki w telefonie z Androidem) i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; część (a) podziału EVM-044 — konsultacja solution-architect W3)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer, security-engineer): AC3 i AC4 połączone (skan), nowe AC4 — wysyłanie z przeglądarki w telefonie; zależność od EVM-071 (makieta W-09 compact); decyzje 18 i 19
