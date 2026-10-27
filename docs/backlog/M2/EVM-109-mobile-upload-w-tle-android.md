---
id: EVM-109
title: "Aplikacja: wysyłanie plików w tle (moduł natywny Android)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P1
path: pelna             # synchronizacja offline, pliki, uwierzytelnianie workera
owner: mobile-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-093, EVM-044, EVM-084, EVM-113]
---

# EVM-109: Aplikacja — wysyłanie plików w tle (moduł natywny Android)

> **Szkic ramowy** — AC do doprecyzowania po EVM-044 (endpointy sesji uploadu) i po decyzji o uwierzytelnianiu workera natywnego.

## Cel
Jako **technik** chcę, aby **zdjęcia i filmy zrobione bez zasięgu same się wysyłały w tle, wznawiały po przerwie i nigdy nie dublowały**, aby **kryteria wyjścia M2 (30 zdjęć, 3 filmy) były spełnione**. Produkcyjna wersja modułu z [ADR-0020](../../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (Kotlin, UIDT) i protokołu z [`media-pipeline.md`](../../architecture/media-pipeline.md).

## Kryteria akceptacji (ramowe)

**AC1 — Wysyłka wznawialna w tle**
- Zakładając plik w trwałej kolejce i sesję uploadu
- Gdy aplikacja jest w tle, zabita lub telefon restartuje albo sieć zanika
- Wtedy wysyłanie wznawia się od ostatniej potwierdzonej części, bez duplikatu obiektu i bez osieroconego multipartu.

**AC2 — Uwierzytelnianie bez JavaScriptu**
- Zakładając wygasły token dostępu
- Gdy worker natywny wysyła
- Wtedy jedyny właściciel odświeżania po stronie natywnej odnawia uprawnienie bez uruchamiania JS (token odświeżania tylko w magazynie natywnym; jedna blokada między procesami; nowy token zapisany trwale przed użyciem; brak sieci przy odświeżaniu nie jest „reuse”) albo przechodzi w stan oczekiwania (`paused_revoked` przy odwołaniu); plik zadania nie zawiera żadnego tokenu na okaziciela (tylko `assetId`, sesję i części), a w paczce nie ma statycznych tokenów.

**AC3 — Oryginał zostaje do potwierdzenia**
- Zakładając plik wysłany
- Gdy serwer nie potwierdził stanu `clean`
- Wtedy lokalny oryginał nie jest usuwany (`offline-sync.md`, pkt 7); `failed: checksum_mismatch` → „Ponów”, `quarantined` → „Wymaga uwagi”.

**AC4 — Reakcja na odwołanie i wersję**
- Zakładając zadania wysyłania w toku
- Gdy serwer odpowie `401 session_revoked`, `401 device_wipe_required` lub `426`
- Wtedy zadania przechodzą w `paused_revoked` (odwołanie), są anulowane razem z plikami (czyszczenie urządzenia) lub wstrzymane (`426`).

**AC5 — Adresy części i powiadomienia**
- Zakładając wysyłkę części przez podpisane adresy
- Gdy zadanie działa lub system pokazuje powiadomienie
- Wtedy adresy mają ważność ≤ 15 min na jedną część i nie trafiają do logów ani raportów błędów; sesję wysyłania kontynuuje tylko jej twórca; powiadomienie ma ogólny tekst („Wysyłanie 3 plików”) i widoczność prywatną na ekranie blokady; usługa zadania nie jest eksportowana.

## Poza zakresem
iOS; ekran aparatu (EVM-108); filmy ponad ustalony rozmiar (EVM-110); powiązanie tokenu odświeżania z kluczem urządzenia (PoP — backlog po tej historyjce).

## Decyzje i ograniczenia
- **Start wymaga:** EVM-113 (bramki Kotlin: ktlint, JUnit, pokrycie) oraz decyzji o właścicielu odświeżania tokenów (rekomendacja: opcja (a) ADR-0020 — jeden właściciel natywny, adnotacja ADR-0020a, aktualizacja SR-SESS-09; README planu, decyzja 17). Tokeny w aplikacji są za portem z EVM-100, więc zmiana właściciela nie dotyka ekranów.
- Telemetria `expo-camera`/ML Kit — EVM-108.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
