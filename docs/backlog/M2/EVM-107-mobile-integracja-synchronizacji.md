---
id: EVM-107
title: "Aplikacja: integracja synchronizacji — pierwsze pobranie, wskaźnik, Kolejka, „Wymaga uwagi”"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: draft
priority: P0
path: pelna             # synchronizacja offline, uwierzytelnianie
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-092, EVM-093, EVM-094, EVM-096, EVM-098, EVM-100]
---

# EVM-107: Aplikacja — integracja synchronizacji

## Cel
Jako **technik** chcę, aby **aplikacja sama pobierała moje zlecenia i wysyłała zapisane elementy, gdy jest zasięg, i pokazywała, co czeka lub wymaga uwagi**, aby **nie musieć o tym pamiętać**. Spina `sync-core`, bazę lokalną, prawdziwe logowanie (adapter do klienta z EVM-090) i API. Węzeł zbiegu torów A, B, C. Makiety: M-07 (Kolejka), SyncIndicator, „Przygotowujemy dane…” (M-01).

## Kryteria akceptacji

**AC1 — Pierwsze pobranie po logowaniu**
- Zakładając świeże logowanie z siecią
- Gdy kończę logowanie
- Wtedy aplikacja pokazuje ekran M-12 „Przygotowujemy dane” (krok i postęp, Skeleton, ostrzeżenie o słabym zasięgu po 30 s), pobiera zakres, zapisuje go w bazie szyfrowanej i przechodzi do listy bez częściowej listy; błąd (sieć, `429`, brak miejsca, zapis) nie zostawia niepełnych danych i można ponowić „Spróbuj ponownie”; po zabiciu aplikacji pobieranie jest wznawiane; konto bez zleceń trafia na pustą listę (wynik poprawny).

**AC2 — Wyzwalacze synchronizacji**
- Zakładając zalogowanego użytkownika
- Gdy uruchamiam aplikację, wraca sieć, wracam na pierwszy plan albo dotykam SyncIndicator
- Wtedy najpierw wysyłana jest kolejka, potem pobierane zmiany; równoległe wyzwalacze nie uruchamiają dwóch synchronizacji; żądania synchronizacji niosą liczbę niewysłanych elementów (`pendingItems`, razem z „Wymaga uwagi”), a nowo zainstalowana aplikacja przy pierwszym pobraniu stosuje bezpieczną kolejność ustaloną w ADR-0021.

**AC3 — Wskaźnik i Kolejka**
- Zakładając elementy oczekujące, w trakcie wysyłki i odrzucone
- Gdy otwieram „Kolejka” (M-07)
- Wtedy widzę liczbę i stan każdego elementu (oczekuje, wysyła się, wysłano, wymaga uwagi), a SyncIndicator pokazuje czas ostatniej synchronizacji lub „Offline · N”.

**AC4 — Wymaga uwagi**
- Zakładając mutację odrzuconą przez serwer
- Gdy ją otwieram na liście „Wymaga uwagi”
- Wtedy widzę wiek elementu, przyczynę prostym językiem wg tabeli odrzuceń (powód → akcje: wpis i komentarz — „Dodaj do innego zlecenia”, „Kopiuj treść”; szybkie zlecenie z grupą zależnych — „Utwórz ponownie”; zawsze osobno „Usuń z telefonu”), szczegóły techniczne w rozwijanej sekcji i „Kopiuj treść”, która oznacza schowek jako wrażliwy (`EXTRA_IS_SENSITIVE`) i czyści go po 60 s; nic nie jest usuwane bez mojej decyzji, a „Wymaga uwagi” nie ma automatycznego wygasania.

**AC5 — Wersja i sesja**
- Zakładając `426`, `401 session_revoked`, `401 device_wipe_required`
- Gdy synchronizacja je odbiera
- Wtedy aplikacja pokazuje stany z EVM-100; po `session_revoked` replika jest usunięta, a kolejka i „Wymaga uwagi” zostają zaszyfrowane i niewidoczne do pełnego logowania tego samego `userId`; po `426` kolejka zostaje, a praca online jest zablokowana bez usuwania repliki; po `device_wipe_required` następuje czyszczenie wg EVM-101.

**AC6 — Test „bez zasięgu” (E2E)**
- Zakładając emulator Androida z lokalnym API
- Gdy w trybie samolotowym dodaję elementy testowe (symulacja mutacji), zabijam aplikację i wracam do sieci
- Wtedy elementy docierają na serwer raz (0 duplikatów, 0 strat), a test Maestro i test integracyjny potwierdzają zgodność z kontraktem EVM-090.

**AC7 — Zgodność `sync-core` z kontraktem**
- Zakładając adapter między typami wygenerowanymi z kontraktu a kopertami `sync-core` (rdzeń nie zna kontraktu)
- Gdy uruchamiam testy kontraktowe
- Wtedy zbiory wartości (statusy wyniku, kody `rejected`, operacje `upsert`/`delete`, kody błędów urządzenia) zgadzają się w obu kierunkach na poziomie typów, każdy fixture `sync-core` przechodzi walidację schematem kontraktu, a każdy przykład odpowiedzi z kontraktu jest dekodowany przez `sync-core` (kontrakt jako zależność deweloperska testów).

**AC8 — Błędy synchronizacji we wskaźniku**
- Zakładając nieudaną wysyłkę, nieudane pobranie zmian, `resync_required` i `429`
- Gdy aplikacja je odbiera
- Wtedy SyncIndicator i baner pokazują stan wg tabeli UX (np. „Błąd · Ponów”, „Pokazujemy dane z 14:05”, „Odświeżamy dane zleceń… Lista działa dalej”), z komunikatem „nic nie jest tracone”; zamiana repliki po resyncu jest atomowa, a przy błędzie zostają stare dane.

## Poza zakresem
Ekrany funkcji (EVM-103…106), pliki (E11), powiadomienia push.

## Decyzje i ograniczenia
- Pomiary nieblokujące: rozmiar i czas pierwszej synchronizacji na SQLCipher dla syntetycznych 300 zleceń, rozmiar agregatu (rezerwa przy > 1 MB: stronicowanie dziennika agregatu), parametry N i `limit` (ADR-0021).
- UX / UI: M-12, układ „Wymaga uwagi”, stany błędów SyncIndicator — [`16-m2-uzupelnienia-teren-i-urzadzenia.md`](../../ux/flows/16-m2-uzupelnienia-teren-i-urzadzenia.md); Jest w `apps/mobile` musi transformować pakiet `@evia/sync-core` (sprawdzić w EVM-093).
- Bezpieczeństwo i prywatność: schowek, wiek elementów i liczniki niewysłanych — AC2, AC4; brak danych osobowych w diagnostyce.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security, UX (product-owner)
