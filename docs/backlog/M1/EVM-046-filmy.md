---
id: EVM-046
title: Filmy w zleceniu
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-011, EVM-045]
---

# EVM-046: Filmy w zleceniu

## Historyjka
Jako **pracownik biura albo technik z przeglądarką w telefonie** chcę **dodać do zlecenia film (np. z pomiarów) i obejrzeć go w panelu**, aby **dokumentacja zawierała też nagrania, a duże pliki nie blokowały pracy**.

## Kontekst
- ADR-0009 (wideo ≤ 4 GB i ≤ 30 min, MP4/MOV H.264/HEVC, podgląd 720p, kolejka wideo — współbieżność 1), P5 (pliki > 2 GB — walidacja strukturalna, „nieskanowany antywirusem”), SR-FILE-12.
- Protokół uploadu wspólny z aplikacją — `media-pipeline.md` (EVM-011). Etykieta dużego pliku z EVM-014 („Nieskanowany antywirusem — plik za duży”).
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty). Scenariusz B10 (w M1 — przez przeglądarkę).

## Kryteria akceptacji
**AC1 — Wysyłanie filmu (SR-FILE-01)**
- Zakładając film MP4 (H.264) 600 MB, 4 min
- Gdy go wysyłam z kategorią „Pomiary”
- Wtedy wysyłanie idzie częściami z postępem w procentach, wznawia się od ostatniej części po utracie połączenia (karta otwarta), a film > 4 GB, > 30 min albo w innym formacie jest odrzucony z komunikatem („Film jest dłuższy niż 30 min.”).

**AC2 — Weryfikacja i skan (SR-FILE-03, SR-FILE-05)**
- Gdy film trafia na serwer
- Wtedy kontener, kodeki i czas trwania są sprawdzane parsowaniem (ffprobe), niezgodność daje kwarantannę `type_mismatch`, a film ≤ 2 GB przechodzi skan antywirusowy jak zdjęcia.

**AC3 — Film większy niż limit skanu (SR-FILE-12, P5)**
- Zakładając film 2,5 GB wysłany z przeglądarki
- Gdy kończy się weryfikacja strukturalna
- Wtedy plik ma znacznik „Nieskanowany antywirusem — plik za duży”, w przeglądarce jest dostępny tylko podgląd 720p, oryginał tylko jako załącznik (Administrator, Edytor), a zdarzenie trafia do metryki (bez alertu).

**AC4 — Podgląd 720p bez metadanych (SR-FILE-08)**
- Gdy kończy się przetwarzanie
- Wtedy powstaje wideo 720p i klatka podglądu bez metadanych, kafel pokazuje czas trwania („▶ 4:02”), a lightbox odtwarza 720p z obsługą klawiatury.

**AC5 — Zasoby (SR-INFRA-11, SR-FILE-04)**
- Zakładając dwa filmy wysłane jednocześnie
- Gdy trwa przetwarzanie
- Wtedy kolejka wideo przetwarza jeden film naraz, a przekroczenie limitu czasu przetwarzania daje `failed` (`processing_error`) z komunikatem w W-09; przetwarzanie odbywa się w `media-processor` w izolacji (SR-FILE-06, SR-INPUT-04).

**AC6 — Uprawnienia (SR-AUTHZ-06, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wysyła, ogląda i pobiera film
- Wtedy A i E wysyłają, oglądają i pobierają oryginał; R ogląda 720p, a URL oryginału zwraca `403 forbidden`; niezalogowany — `401`.

**AC7 — Dziennik i stany**
- Wtedy dodanie filmu tworzy zdarzenie w dzienniku (EVM-038); offline — wysyłanie wstrzymane; zamknięcie karty z niewysłanym filmem — ostrzeżenie przeglądarki; `429` — wzór z README makiet.

**AC8 — Film z przeglądarki w telefonie (makieta W-09 compact z EVM-071)**
- Zakładając Edytora w przeglądarce telefonu z Androidem i film 600 MB nagrany aparatem systemowym (w galerii telefonu — decyzja 18)
- Gdy wybiera film z galerii
- Wtedy przed wysłaniem widzi rozmiar i ostrzeżenie „Film ma 600 MB. Przez sieć komórkową wysyłanie zużyje pakiet danych i może potrwać długo — najlepiej wyślij przez Wi-Fi.” z akcjami „Wyślij teraz” i „Anuluj” (ostrzeżenie dla filmów powyżej progu z makiety EVM-071 — propozycja: 100 MB); przy filmie jest status z postępem w procentach, cele dotyku mają co najmniej `size.touch-target.min`, a po zakończeniu panel pokazuje „Wysłano film — możesz go usunąć z telefonu.”
- Oraz gdy karta została zamknięta albo wyładowana z pamięci przed końcem, po ponownym otwarciu zlecenia panel pokazuje „Nie wysłano filmu „…” — wybierz go ponownie z galerii.” (jak AC4 w EVM-044).

## Poza zakresem
- Opcja „filmy tylko przez Wi-Fi” i upload w tle — aplikacja (M2, E11). Archiwizacja filmów starszych niż 12 miesięcy (zmiana klasy storage'u) — M4.

## UX / UI
- W-09: Uploader (limity filmów), kafel filmu z czasem, lightbox z odtwarzaczem, znaczniki [P-7]. Stany: AC7.
- W-09 w przeglądarce telefonu (`breakpoint.compact`, makieta EVM-071): ostrzeżenie przed wysłaniem dużego filmu, status filmu, potwierdzenie „Wysłano film — możesz go usunąć z telefonu.” (AC8). Przeglądarka nie rozpoznaje wiarygodnie typu sieci, więc ostrzeżenie zależy od rozmiaru, nie od wykrytej sieci komórkowej.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wysyłanie, podgląd, oryginał |
| Edytor | wysyłanie, podgląd, oryginał |
| Tylko odczyt | podgląd 720p |
| Niezalogowany | brak (`401`) |

- Dane: filmy (mogą zawierać osoby, tablice rejestracyjne, metadane lokalizacji w oryginale).
- W AC: SR-FILE-01, SR-FILE-03, SR-FILE-05, SR-FILE-12, SR-FILE-08, SR-INFRA-11, SR-FILE-04, SR-FILE-06, SR-INPUT-04, SR-AUTHZ-06, SR-AUTHZ-05. Polityki P3, P5.

## Notatki techniczne
- Moduły: `media`, worker, `media-processor` (ffmpeg / ffprobe) + panel.
- `devops-engineer`: ffmpeg w `media-processor`, kolejka wideo, limity czasu i zasobów na staging (CX33).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
- **Do akceptacji na demo (odstępstwo od P3 i ADR-0009, ustalone z architektem i security-engineerem):** obszar roboczy filmów to osobny wolumen **na dysku hosta** (`noexec,nosuid,nodev`, 2770, tylko worker i `media-processor`, sprzątany po zadaniu i przy starcie), bo tmpfs ≥ 4 GiB nie mieści się w RAM serwera CX33; zdjęcia zostają na tmpfs. Zalecenie security-engineera: dm-crypt z kluczem efemerycznym — do wyboru przez Konrada. Bez szyfrowania: ryzyko rezydualne (kopie robocze filmów na dysku do sprzątania). Opis: `media-pipeline.md` §11, runbook `media-processor.md`.
- **Limity w bajtach:** film ≤ 4 294 967 296 B (4 GiB), skan antywirusowy do 2 000 000 000 B (świadomie poniżej granicy ClamAV ~2^31 B; interfejs pokazuje „4 GB” / „2 GB” dziesiętnie). Film > 2 000 000 000 B nie jest skanowany (AC3, P5).
- **Adres podglądu żyje 300 s,** film trwa do 30 min: odtwarzacz przy błędzie pobiera nowy adres i wraca do `currentTime` (jedna próba na błąd, potem W-09). Czasu ważności nie wydłużamy.
- **Pomiar na stagingu przed demo (nieblokujący):** czy CX33 zdąży z transkodowaniem HEVC 30 min w 15 min (AC5).

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-046 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (ux-designer): AC8 — film z przeglądarki w telefonie (ostrzeżenie o rozmiarze przed wysłaniem przez sieć komórkową, status, stan po utracie karty)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-31 — backend-developer: część backendowa gotowa (migracja 0057 (pierwotnie 0055), wideo w `media`, procesor ffprobe/ffmpeg, pętla filmów ze współbieżnością 1 w bazie, kwarantanna `type_mismatch`, adresy filmu, CSP `media-src`, clamd 2000M); web (AC1, AC4, AC7, AC8 po stronie panelu) czeka na web-developera
- 2026-10-31 — web-developer: część panelu gotowa (wybór i kontrola filmu, hash po kawałkach, ostrzeżenie > 100 MB, kafel z czasem, znacznik nieskanowanego, odtwarzacz 720p z klawiaturą i odnawianiem adresu, teksty „Wysłano film…” / „Nie wysłano filmu…”); brak zrzutów ekranu (brak żywej aplikacji) — do demo
- 2026-10-31 — devops-engineer: przegląd infrastruktury filmów (wolumen roboczy, clamd 2000M + dysk, CSP media-src, ffmpeg przypięty); poprawiono komentarz licencji ffmpeg w Dockerfile (pakiet OS, SR-SUPPLY-06); `pnpm run gate` zielony; aktywacja w sesji IaC
- 2026-10-31 — backend-developer, poprawki rundy 1: obraz `backend-tests` ma teraz prawdziwe ffmpeg/ffprobe (pakiet `7:7.1.5-0+deb13u1`, `EVIA_REQUIRE_FFMPEG=1` — brak narzędzia = czerwony test, nie pominięcie; wyjątek w W9 repo-policy tylko dla tej instalacji). `ffmpeg-real.test.ts` uruchomiony w kontenerze: 4/4 zielone i od razu wykrył błąd — `ffprobe` nie zna opcji `-nostdin` (każdy film kończyłby jako `unsupported`); usunięto. Dodano test integracyjny AC7 (audyt `media_asset.created` i wpis `media_assets_added` dla filmu) oraz asercję etykiety w panelu.
- 2026-10-31 — migracja wideo przenumerowana 0055 → 0057 (kolizja z torem A, EVM-096–098)
