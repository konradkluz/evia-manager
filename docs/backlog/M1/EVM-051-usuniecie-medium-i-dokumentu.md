---
id: EVM-051
title: Usunięcie medium lub dokumentu i trwałe usunięcie pliku (Administrator)
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-040, EVM-047]
---

# EVM-051: Usunięcie medium lub dokumentu i trwałe usunięcie pliku (Administrator)

## Historyjka
Jako **Administrator** chcę **ukryć zdjęcie lub dokument dodany przez pomyłkę, a zdjęcie dokumentu tożsamości zrobione omyłkowo — trwale usunąć**, aby **archiwum zlecenia było uporządkowane i zgodne z RODO, zanim trafią do systemu realne dane**.

## Kontekst
- Model: soft delete (A), purge pliku z zachowaniem rekordu = redakcja medium (A ze step-upem); P6 („zdjęcie zrobione omyłkowo Administrator usuwa”), SR-PRIV-03, SR-DATA-08, SR-PRIV-04 (rejestr usunięć z EVM-040).
- **Priorytet podniesiony z P2 do P1** (decyzja 11): pilot realny wymaga możliwości trwałego usunięcia pliku z danymi osobowymi.
- SR-FILE-11 (uzgadnianie storage'u z bazą) — w tej historyjce jako zadanie okresowe; konfiguracja alertu na prod — EVM-062.
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — „Usuń” (A), lightbox.

## Kryteria akceptacji
**AC1 — Usunięcie medium lub dokumentu**
- Zakładając zdjęcie i dokument w zleceniu
- Gdy Administrator wybiera „Usuń”
- Wtedy element znika dla Edytora i Tylko odczyt (pobranie po `id` — `404`, URL-e plików niedostępne), toast „Usunięto. [Cofnij]” przywraca go, a obie operacje są audytowane.

**AC2 — Trwałe usunięcie pliku (SR-PRIV-03, SR-SESS-08)**
- Zakładając zdjęcie dowodu osobistego klienta zrobione przez pomyłkę
- Gdy Administrator wybiera „Usuń plik trwale…”, potwierdza nieodwracalność w dialogu i tożsamość w W-04
- Wtedy oryginał i pochodne (z wersjami obiektu) są usunięte ze storage'u, rekord zostaje z oznaczeniem „Plik usunięty przez administratora 03.10.2026.”, a opis jest zredagowany; to samo dla dokumentu (wszystkie wersje pliku).

**AC3 — Rejestr usunięć przed operacją (SR-PRIV-04)**
- Gdy Administrator trwale usuwa plik
- Wtedy przed usunięciem do rejestru usunięć trafia identyfikator pliku i właściciela, kod operacji i czas
- Oraz gdy zapis do rejestru się nie udaje, operacja nie startuje, a plik jest nienaruszony.

**AC4 — Audyt bez wartości (SR-DATA-08, SR-LOG-03)**
- Gdy wykonuje się usunięcie, przywrócenie albo trwałe usunięcie
- Wtedy zdarzenie audytu zawiera identyfikatory, kod akcji i wynik — bez nazwy pliku i opisu.

**AC5 — Uzgadnianie storage'u z bazą (SR-FILE-11)**
- Zakładając w teście obiekt w storage'u bez rekordu i rekord pliku `ready` bez obiektu
- Gdy działa okresowe zadanie uzgadniania
- Wtedy zgłasza obie rozbieżności (metryka i alert bez danych osobowych), a klucze aplikacji klientów nie mają uprawnienia do listowania bucketu.

**AC6 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda usuwa medium albo plik
- Wtedy tylko Administrator (trwałe usunięcie — ze step-upem); Edytor ma „Usuń” wyłączone z podpowiedzią „Usunąć plik może tylko administrator.” i dostaje `403 forbidden`; R nie widzi akcji (`403`); niezalogowany — `401`; medium zlecenia B ścieżką zlecenia A — `404`.

**AC7 — Stany**
- Wtedy offline — akcje wyłączone; anulowanie W-04 — „Nie wykonano operacji.”; plik w trakcie przetwarzania — trwałe usunięcie czeka na zakończenie zadania albo je przerywa (bez osieroconych pochodnych).

## Poza zakresem
- Purge całego zlecenia i retencja danych biznesowych — M4 (P4). Usuwanie z telefonu — M2.

## UX / UI
- W-09: „Usuń” w lightboxie i `⋮`, „Usuń plik trwale…” (AlertDialog danger), W-04, oznaczenie usuniętego pliku. Stany: AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | usunięcie, przywrócenie; trwałe usunięcie pliku ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: pliki mediów i dokumentów, rejestr usunięć (identyfikatory).
- W AC: SR-PRIV-03, SR-SESS-08, SR-PRIV-04, SR-DATA-08, SR-LOG-03, SR-FILE-11, SR-AUTHZ-02, SR-AUTHZ-05. Polityki P4, P6.

## Notatki techniczne
- Moduły: `media`, `audit` (+ `platform`: rejestr usunięć), worker (uzgadnianie) + panel.
- Wersje obiektów w buckecie wygasają po 30 dniach (ADR-0009), kopie — wg RR-14; rejestr usunięć stosowany po odtworzeniu (EVM-062).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-051 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`; priorytet P2 → P1 — trwałe usunięcie pliku przed realnymi danymi)
