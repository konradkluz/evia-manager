---
id: EVM-037
title: Dziennik zlecenia — wpisy i komentarze
type: story
milestone: M1
epic: E5 Dziennik i komentarze
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-031]
---

# EVM-037: Dziennik zlecenia — wpisy i komentarze

## Historyjka
Jako **pracownik biura** chcę **zapisywać przy zleceniu rozmowy, ustalenia i komentarze — także przy konkretnym etapie —** aby **cała historia zlecenia była w jednym miejscu zamiast w komunikatorach**.

## Kontekst
- Model: `TimelineEntry` (`kind` = `note` / `comment`, tylko do dopisywania, korekta = nowy wpis z `supersedesEntryId` — D3), kategorie wpisu (`noteCategory`).
- Zlecenie zamknięte nadal przyjmuje wpisy („nic nie ginie”, PO-8).
- Makieta: [W-08](../../ux/flows/05-wpis-i-komentarz.md#w-08-dziennik). Scenariusze: A4, B2, B7, C8 (komentarz do Administratora).

## Kryteria akceptacji
**AC1 — Dodaj wpis**
- Zakładając zakładkę „Dziennik” zlecenia
- Gdy wybieram „Wpis”, kategorię „Rozmowa telefoniczna”, opcjonalnie etap tego zlecenia i wpisuję treść (≤ 10 000 znaków)
- Wtedy wpis pojawia się na górze osi czasu z autorem, czasem serwera, kategorią i etapem, a toast mówi „Dodano wpis.”

**AC2 — Komentarz**
- Gdy wybieram „Komentarz” i wpisuję treść
- Wtedy komentarz pojawia się na osi czasu z innym znacznikiem (`message-square-text`).

**AC3 — Poprawka zamiast edycji**
- Zakładając wpis z błędem
- Gdy wybieram „Popraw wpis” i zapisuję nową treść
- Wtedy powstaje nowy wpis „Poprawka wpisu z [czas]: …”, a poprzedni jest zwinięty z napisem „Zastąpiony poprawką z [czas]” i „Pokaż treść”; treści wpisu nie da się zmienić żadną operacją API.

**AC4 — Treść jako tekst (SR-WEB-03, SR-INPUT-05)**
- Zakładając wpis z treścią `<script>alert(1)</script>` i linkiem `javascript:alert(1)`
- Gdy wyświetlam dziennik
- Wtedy treść jest pokazana jako tekst, żaden skrypt się nie wykonuje, aktywne są tylko linki `https:`, `tel:`, `mailto:`, a znaki sterujące (poza nową linią) są usuwane przy zapisie.

**AC5 — Ponowienie bez duplikatu**
- Zakładając zapis wpisu przerwany błędem sieci
- Gdy ponawiam zapis
- Wtedy powstaje jeden wpis (to samo `id` i `Idempotency-Key`), a komunikat brzmi „Nie udało się dodać wpisu. Spróbuj ponownie — nie dodamy go dwa razy.”

**AC6 — Oś czasu i filtry**
- Zakładając 60 wpisów
- Gdy przeglądam dziennik
- Wtedy wpisy są od najnowszych, pogrupowane po dniach, z „Pokaż starsze” (paginacja kursorem z zachowaniem pozycji), a filtry „Wpisy”, „Komentarze” i etap zawężają listę.

**AC7 — Zlecenie zamknięte i spójność (SR-AUTHZ-02)**
- Zakładając zlecenie „Rozliczone”
- Gdy dodaję wpis
- Wtedy wpis jest przyjęty; etap innego zlecenia wskazany we wpisie zwraca `400 validation_failed`, a wpis zlecenia B pobierany ścieżką zlecenia A — `404 not_found`.

**AC8 — Uprawnienia i stany (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda czyta i dodaje wpisy
- Wtedy A i E dodają, R widzi oś czasu i filtry bez pola nowego wpisu (`403 forbidden` przy zapisie), niezalogowany — `401`; stan pusty — „Brak wpisów. Dodaj pierwszą notatkę.”; offline — „Dodaj wpis” wyłączony, treść zostaje w pamięci karty; treść za długa — komunikat z limitem.

## Poza zakresem
- Zdarzenia automatyczne (zmiany statusów) — EVM-038. Usunięcie i redakcja — EVM-040.
- Wpisy z telefonu offline — M2 (E12). Powiadomienia o komentarzach — M3.

## UX / UI
- W-08: pole nowego wpisu (radio Wpis / Komentarz, FilterChip kategorii, Select etapu, TextArea z podpowiedzią „Nie wpisuj PESEL…”), Timeline (§ 3.10), filtry, menu `⋮` („Popraw wpis”), szkic w pamięci karty.
- Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | odczyt, wpis, komentarz, poprawka |
| Edytor | odczyt, wpis, komentarz, poprawka |
| Tylko odczyt | odczyt |
| Niezalogowany | brak (`401`) |

- Dane: treść wpisów (może zawierać dane osobowe klientów, stron i pracowników), autor.
- W AC: SR-WEB-03, SR-INPUT-05, SR-AUTHZ-02, SR-AUTHZ-05.
- W sekcji: SR-AUTHZ-01, SR-INPUT-01, SR-API-05, SR-DATA-01 (klasyfikacja `TimelineEntry` — bez nowych pól), SR-DATA-02 (ostrzeżenie przy treści).

## Notatki techniczne
- Moduły: `timeline` (pierwsza historyjka modułu), fasada `procedures` (walidacja etapu) + panel.
- Kolejność wg czasu serwera. Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-037 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
