---
id: EVM-142
title: "Aplikacja: podgląd zdjęć zlecenia (online, bez zapisu na telefonie)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
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
- Wtedy otwiera się podgląd (wariant 1600 px) z kategorią, czasem i opisem oraz zamknięciem; wygasły adres (po 5 min) jest odświeżany jednorazowo bez migania, a drugi błąd daje „Nie udało się wczytać zdjęcia” z „Spróbuj ponownie”.

**AC4 — Offline i brak uprawnień**
- Zakładając brak sieci albo token odrzucony przez serwer
- Gdy otwieram siatkę albo podgląd
- Wtedy siatka pokazuje wiersze z repliki (kategoria, czas) z jasnym komunikatem „Podgląd zdjęć wymaga internetu” zamiast miniatur i bez komunikatu o błędzie serwera; po powrocie sieci miniatury doładowują się same; rola Tylko odczyt nie loguje się do aplikacji, a odmowa `403` pokazuje komunikat ogólny bez szczegółów.

**AC5 — Nic nie zostaje na telefonie; tryb ukrytych danych i blokada**
- Zakładając otwarty podgląd lub siatkę
- Gdy aplikacja przechodzi w tryb ukrytych danych, blokadę, `session_revoked` albo wylogowanie
- Wtedy obrazy i adresy znikają z ekranu i z pamięci od razu (czytnik niczego nie ogłasza), wiersza „Zdjęcia zlecenia” w trybie ukrytym nie ma; obrazy nie trafiają do trwałej pamięci podręcznej ani galerii, a adres nie trafia do logów i nazw dostępnych; po wylogowaniu i „Wyczyść dane firmowe” nie zostaje żaden obraz.

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
- **Bezpieczeństwo (konsultacja security przed planem):** adres krótkotrwały i tylko w pamięci; wyłączenie trwałego cache obrazów (dysk) i potwierdzenie, że biblioteka nie zapisuje adresów ani obrazów w kopiach; `FLAG_SECURE` zostaje; rozszerzenie reguł `createMediaAssetDownloadUrl` na kanał `mobile` tylko dla `thumbnail` i `preview`. Wymagania: SR-FILE-07, SR-FILE-10, SR-AUTHZ-02, SR-AUTHZ-06, SR-MOB-05, SR-MOB-08, SR-LOG-02.
- **UX:** komponenty ze styleguide'u; makieta M-08 z EVM-111 do rozszerzenia (siatka); stany: pusty, ładowanie (szkielet), błąd, offline, ukryte dane.
- Zmiana kontraktu `packages/contracts` (kanały operacji) — wymaga baseline'u OpenAPI i testu zgodności.

## Do akceptacji przez Konrada
1. **Czy potwierdzasz zmianę decyzji z 2026-11-12 (galeria tylko w panelu) i zakres „zdjęcia najpierw, filmy osobno”?** Rekomendacja: **tak**. Konsekwencja „nie”: zostaje wersja z EVM-111, technik nie widzi zdjęć na telefonie.
2. **Online bez zapisu na telefonie?** Rekomendacja: **tak** (najtaniej i najbezpieczniej: żadnych kopii obrazów na urządzeniu, żadnych nowych danych do czyszczenia). Konsekwencja: bez zasięgu zdjęć nie zobaczy; podgląd offline wymagałby szyfrowanego magazynu i osobnej historyjki.
3. **Powiększanie szczypaniem w podglądzie?** Rekomendacja: **nie w pierwszym kroku** (może wymagać nowej biblioteki gestów; oceń po teście w terenie, 1600 px zwykle wystarcza). Konsekwencja „tak”: dochodzi AC lub osobna historyjka i konsultacja zależności.
4. **Zdjęcia wizji lokalnej tym samym ekranem?** Rekomendacja: **tak, jeśli są mediami zlecenia** — bez dodatkowej pracy. Konsekwencja: jeśli to osobny byt, dostaną osobną historyjkę.

## Notatki
- Siatka korzysta z repliki (bez nowego `list`); liczba zapytań o adresy mieści się w limicie (1000 / 10 min / użytkownik), ale leniwe ładowanie jest wymagane.
- Test na emulatorze: Maestro (zdjęcie `ready` → podgląd; offline → komunikat).

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner); potrzeba Konrada z 2026-11-18, zmiana decyzji z 2026-11-12
