---
id: EVM-142
title: "Aplikacja: podgląd zdjęć zlecenia (online, bez zapisu na telefonie)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: ready
priority: P2
path: pelna             # nowy dostęp mobilny do plików (kanał `mobile` dla adresów pochodnych) i obrazy na urządzeniu — obszar „media” i „dane na urządzeniu”
owner: mobile-developer
contributors: [backend-developer]
reviewers: [security-engineer, ux-designer, code-reviewer]
model: sonnet
depends_on: [EVM-111, EVM-131]
---

# EVM-142: Aplikacja — podgląd zdjęć zlecenia (online, bez zapisu na telefonie)

> **Szkic do akceptacji przez Konrada (2026-11-18).** Zmienia decyzję z 2026-11-12 („galeria mediów tylko w panelu web”). Zdjęcia najpierw; filmy w EVM-143.

## Cel
Jako **technik (Administrator lub Edytor)** chcę **w szczegółach zlecenia obejrzeć zdjęcia tego zlecenia — także te zrobione przez kolegę albo dodane w biurze**, aby **sprawdzić na miejscu, co już udokumentowano, bez dzwonienia do biura**. Konrad, 2026-11-18: „możliwość zobaczenia zdjęć i filmu na aplikacji mobilnej”.

## Kontekst
- **To zmiana wcześniejszej decyzji:** 2026-11-12 zakres zawężono do panelu web, a EVM-111 ma w „Poza zakresem” podgląd i miniatury oraz pusty stan „Zdjęcia i filmy zlecenia przegląda biuro w panelu”. Od 2026-11-18 procesor mediów działa na produkcji, więc miniatury i podglądy powstają.
- **Co już jest:** replika `media_asset` na telefonie (EVM-131) niesie typ, kategorię, opis, czas wykonania i stan pliku (`clean`, `processing`, `ready`, kwarantanna, `failed`), ale bez nazw i adresów. Adresy miniatury (320 px) i podglądu (1600 px) wydaje dziś operacja `createMediaAssetDownloadUrl` — **tylko dla kanału `web`**; adres żyje 5 min, limit 1000 adresów / 10 min / użytkownik. Brakuje więc kanału `mobile` (zmiana kontraktu i reguł dostępu) i ekranu.
- **Wizja lokalna:** jeśli jej zdjęcia są mediami zlecenia, są objęte automatycznie; osobnego ekranu nie ma (do weryfikacji w planie).

## Kryteria akceptacji

**AC1 — API wydaje telefonowi adresy miniatury i podglądu, nigdy oryginału**
- Zakładając token telefonu Administratora albo Edytora i zlecenie widoczne dla niego
- Gdy prosi o adres `thumbnail` albo `preview` zdjęcia tego zlecenia
- Wtedy dostaje krótkotrwały adres (`no-store`, bez zapisu w logach i audycie); `original` z telefonu, zdjęcie z innego zlecenia, usunięte, bez gotowej pochodnej, w kwarantannie albo plik nieistniejący → odmowa bez ujawniania powodu (`403` dla oryginału, `404` dla reszty); token Tylko odczyt → `403 channel_not_allowed`; po przekroczeniu limitu `429`; testy macierzy ról i kanałów.

**AC2 — Siatka zdjęć zlecenia z miniaturami**
- Zakładając otwarte zlecenie, sieć i zdjęcia w replice
- Gdy wybieram wiersz „Zdjęcia zlecenia” w szczegółach
- Wtedy widzę siatkę od najnowszych: miniatura, kategoria, czas wykonania; miniatury ładują się leniwie, a stan pliku jest czytelny tekstem: `processing` → „Przygotowujemy podgląd”, kwarantanna → „Plik zatrzymany do sprawdzenia” (bez przyczyny i szczegółów skanu), `failed` → „Nie udało się przygotować podglądu” — bez adresu i bez żądania do serwera dla takiego pliku; w siatce nie ma nazw plików ani danych klienta.

**AC3 — Podgląd pełnoekranowy**
- Zakładając zdjęcie ze stanem `ready`
- Gdy je dotykam
- Wtedy otwiera się podgląd (wariant 1600 px) z kategorią, czasem i opisem oraz zamknięciem; wygasły adres (po 5 min) jest odświeżany jednorazowo bez migania, a drugi błąd daje „Nie udało się wczytać zdjęcia” z „Spróbuj ponownie”. Podgląd pełnoekranowy jest widokiem w oknie głównym aplikacji (nie `Modal`, nie osobna aktywność): jest potomkiem korzenia `LockGate`, więc nakładka blokady go przykrywa, a w kompilacji produkcyjnej okno ma `FLAG_SECURE` (sprawdzenie `screencap` na buildzie release w demo).

**AC4 — Offline i brak uprawnień**
- Zakładając brak sieci albo token odrzucony przez serwer
- Gdy otwieram siatkę albo podgląd
- Wtedy siatka pokazuje wiersze z repliki (kategoria, czas) z jasnym komunikatem „Podgląd zdjęć wymaga internetu” zamiast miniatur i bez komunikatu o błędzie serwera; po powrocie sieci miniatury doładowują się same; rola Tylko odczyt nie loguje się do aplikacji, a odmowa `403` pokazuje komunikat ogólny bez szczegółów.

**AC5 — Nic nie zostaje na telefonie; tryb ukrytych danych i blokada**
- Zakładając otwartą siatkę lub podgląd, także z żądaniem adresu albo pobieraniem obrazu w toku
- Gdy aplikacja przechodzi w tryb ukrytych danych (dowolny powód z `hiddenReason`), blokadę, `session_revoked`, wylogowanie albo „Wyczyść dane firmowe”
- Wtedy siatka i podgląd znikają z drzewa widoków od razu (czytnik niczego nie ogłasza), żądania w toku są przerywane, a odpowiedź spóźniona (obraz lub adres) jest odrzucana i niczego nie wyświetla; w tych stanach aplikacja nie prosi o nowe adresy i nie odświeża wygasłych; wiersza „Zdjęcia zlecenia” w trybie ukrytym nie ma. Obrazy są trzymane wyłącznie w pamięci procesu: po obejrzeniu zdjęć, po blokadzie i po wylogowaniu katalogi aplikacji (`cache/`, `files/`) nie zawierają plików obrazów (test na emulatorze w wariancie debug), a galeria jest bez zmian. Adres nie trafia do logów (`adb logcat` po wczytaniu udanym, nieudanym i po wygaśnięciu adresu nie zawiera hosta bucketu ani `X-Amz-Signature`), do nazw dostępnych, schowka, intencji ani innych aplikacji (bez `Linking`, przeglądarki i `DownloadManager`).

**AC6 — Stan pusty, dostępność i spójność z EVM-111**
- Zakładając zlecenie bez zdjęć albo użytkownika czytnika ekranu
- Gdy otwieram siatkę
- Wtedy stan pusty: „Brak zdjęć w tym zleceniu” (bez przycisku — „Zrób zdjęcie” jest w pasku zlecenia); miniatura ma nazwę dostępną „[kategoria], [czas]” (nie nazwę pliku), cele dotyku ≥ 48 dp, 200% czcionki bez ucinania; tekst pustego stanu „Pliki zlecenia” z EVM-111 przestaje odsyłać do panelu („Zdjęcia i filmy zlecenia przegląda biuro w panelu”) i prowadzi do tej siatki, a komentarz w kodzie synchronizacji („galeria tylko w panelu”) jest zaktualizowany.

## Poza zakresem
- Filmy (EVM-143); powiększanie szczypaniem, przeciąganie między zdjęciami, udostępnianie, zapis do galerii, pobieranie oryginału (oryginał zostaje w panelu, bo może zawierać lokalizację).
- Praca bez internetu na zapisanych kopiach (świadomie: nic nie zapisujemy); podgląd zdjęcia, które dopiero czeka w kolejce telefonu (lokalnie — wycięte decyzją 2026-11-15).
- Dodawanie, edycja i usuwanie mediów; osobny ekran wizji lokalnej; zmiany w procesorze mediów.

## Decyzje i ograniczenia
- Zdjęcia online z pochodnych serwera (propozycja Tech Leada 2026-11-18); decyzja Konrada czeka — sekcja niżej.
- **Bezpieczeństwo i prywatność (konsultacja security, skrót; 2026-11-18):** kanał `mobile` dla `createMediaAssetDownloadUrl` otwieramy wyłącznie dla `thumbnail` i `preview` (WebP bez metadanych, adres ≤ 300 s, `no-store`, bez logu i audytu); `original` z telefonu serwer odrzuca (`403`, przed odczytem medium), więc oryginał z lokalizacją zostaje w panelu. Aplikacja nie ma dziś żadnego komponentu obrazów zdalnych, a domyślny `Image` na Androidzie (Fresco) zapisuje pobrane obrazy w cache na dysku i nie da się tego wyłączyć z JS — **plan zaczyna się od próby (spike):** `fetch` bajtów i wyświetlenie z adresu `data:` (bez nowej zależności) oraz test, że po obejrzeniu, blokadzie i wylogowaniu nie powstają pliki obrazów w katalogach aplikacji; warianty zapasowe (czyszczenie cache Fresco, `expo-image` z `cachePolicy: 'none'` — nowa zależność) tylko po decyzji Tech Leada. Zdekodowane bitmapy zostają w pamięci procesu do jej przycięcia przez system (ryzyko rezydualne jak w EVM-146: zrzut pamięci, root). Przyrost ryzyka mały (telefon i tak trzyma oryginały czekające w kolejce), ale podgląd 1600 px może pokazywać twarze i tablice. Przy realizacji security dopisuje SR-MOB-14 (media zlecenia w aplikacji tylko online i w pamięci), wiersz Low w `threat-model.md` i wzmiankę w `rodo.md` (kanał mobilny, bez nowego celu i retencji). Wymagania: SR-FILE-07, SR-FILE-10, SR-AUTHZ-02, SR-AUTHZ-06, SR-MOB-05, SR-MOB-08, SR-LOG-02.
- **UX:** komponenty ze styleguide'u; makieta M-08 z EVM-111 do rozszerzenia (siatka); stany: pusty, ładowanie (szkielet), błąd, offline, ukryte dane.
- Zmiana kontraktu `packages/contracts` (kanały operacji) — wymaga baseline'u OpenAPI i testu zgodności.

## Decyzje Konrada (2026-11-18: przyjęte wszystkie rekomendacje poniżej)
1. **Czy potwierdzasz zmianę decyzji z 2026-11-12 (galeria tylko w panelu) i zakres „zdjęcia najpierw, filmy osobno”?** Rekomendacja: **tak**. Konsekwencja „nie”: zostaje wersja z EVM-111, technik nie widzi zdjęć na telefonie.
2. **Online bez zapisu na telefonie?** Rekomendacja: **tak** (najtaniej i najbezpieczniej: żadnych kopii obrazów na urządzeniu, żadnych nowych danych do czyszczenia). Konsekwencja: bez zasięgu zdjęć nie zobaczy; podgląd offline wymagałby szyfrowanego magazynu i osobnej historyjki.
3. **Powiększanie szczypaniem w podglądzie?** Rekomendacja: **nie w pierwszym kroku** (może wymagać nowej biblioteki gestów; oceń po teście w terenie, 1600 px zwykle wystarcza). Konsekwencja „tak”: dochodzi AC lub osobna historyjka i konsultacja zależności.
4. **Zdjęcia wizji lokalnej tym samym ekranem?** Rekomendacja: **tak, jeśli są mediami zlecenia** — bez dodatkowej pracy. Konsekwencja: jeśli to osobny byt, dostaną osobną historyjkę.

## Notatki
- Siatka korzysta z repliki (bez nowego `list`); liczba zapytań o adresy mieści się w limicie (1000 / 10 min / użytkownik), ale leniwe ładowanie jest wymagane.
- Test na emulatorze: Maestro (zdjęcie `ready` → podgląd; offline → komunikat).
- Z konsultacji security (Low): `403` dla `original` przed odczytem medium, jak w web; do macierzy ról dodać „zlecenie niewidoczne dla roli → 404” i pełną macierz rola × kanał × wariant (`apps/api/test/authorization/role-matrix.test.ts`); limit 1000 / 10 min jest wspólny z panelem (alert od 600 zostaje, osobny limit mobilny niepotrzebny); obrazy zwalniać już przy przejściu w tło; przed `fetch` sprawdzić `https:` i host zgodny z konfiguracją bucketu (SR-MOB-10); `testID` i nazwy dostępne siatki bez identyfikatorów medium i zlecenia.

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner); potrzeba Konrada z 2026-11-18, zmiana decyzji z 2026-11-12
- 2026-11-18 — naniesiono konsultację security (Tech Lead): AC3 (podgląd w oknie głównym) i AC5 (kryteria sprawdzalne: brak plików obrazów, brak adresu w logach, przerwanie żądań w toku) doprecyzowane, spike cache obrazów na początku planu; status `draft`
- 2026-11-18 — Konrad: „Akceptuję rekomendacje” — wszystkie pytania rozstrzygnięte wg rekomendacji; status `ready` (Tech Lead)
- 2026-11-19 — specyfikacja UI (ux-designer): M-08a siatka i M-08b podgląd w `docs/ux/flows/09-mobile-zdjecia-filmy-offline.md`, wiersz w M-03 (`flows/03`), changelog styleguide'u
- 2026-11-19 — AC1 (backend): kanał `mobile` dla `createMediaAssetDownloadUrl` tylko dla `thumbnail`/`preview` zdjęć (`original` → 403 przed odczytem medium, film → 404), kontrakt i baseline (ADR-0021, aneks), testy macierzy i integracyjne (backend-developer)
- 2026-11-20 — AC2–AC6 w aplikacji (mobile-developer): siatka, podgląd w oknie głównym, offline, tryb ukrytych danych i blokada, stan pusty; 50 testów ekranów, pokrycie zmienionego kodu 99,3% / 94,7%; gate zielony (Tech Lead zweryfikował, `pnpm` 12.8.1 zainstalowany globalnie po przeniesieniu projektu na D:)
- 2026-11-20 — przegląd security (security-engineer): CHANGES REQUIRED — S1 (High): bajty zdjęć w cache HTTP OkHttp na dysku telefonu, łamało AC5; dopisano SR-MOB-14, TM-152 i notę w rodo.md
- 2026-11-20 — Konrad: „tak i tak” — poprawki S2 i serwerowy `no-store`; zrobione: nagłówek `Cache-Control: no-store` w żądaniu obrazu (S1), host bucketu z `EVIA_STORAGE_HOSTS` jako `extra.storageHosts` i odrzucanie innych hostów (S2), `response-cache-control: no-store` w adresach kanału `mobile` oraz wymagany kanał w `mayRequest` (S3); kontrakt OpenAPI bez zmian; test EVM-068 AC7 dostosowany (cookie sesji telefonu = 401, ścieżkę tokenu pokrywa `media-download-mobile.test.ts`)
- 2026-11-20 — do zrobienia: dowód AC5 na emulatorze (przeszukanie `cache/` i `files/` po zawartości `RIFF…WEBP`, `logcat`, `FLAG_SECURE`), QA, przegląd kodu, ponowny przegląd security, demo
