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
_—_

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
