---
id: EVM-049
title: Kwarantanna plików — „Wymaga uwagi”, alert i ponowny skan
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024, EVM-044]
---

# EVM-049: Kwarantanna plików — „Wymaga uwagi”, alert i ponowny skan

## Historyjka
Jako **Administrator** chcę **dostać alert o każdym pliku zatrzymanym przez skan, zobaczyć przyczynę i zlecić ponowny skan**, aby **reagować na zagrożenia i odzyskać plik po fałszywym alarmie — bez ręcznego „zwalniania” plików**.

## Kontekst
- P5 (kwarantanna 30 dni, alert do Administratorów z samym linkiem, ponowny skan ze step-upem, brak zwolnienia bez skanu, nigdy zewnętrzne serwisy), SR-FILE-05, SR-LOG-07, SR-DATA-07 (usuwanie po 30 dniach od pierwszego wydania).
- Do tej historyjki z EVM-044 wolno było przenieść tylko UI „Wymaga uwagi”, alert i ponowny skan (konsultacja `security-engineer`, pkt 6a). Alert jest e-mailem — zależność od EVM-024.
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — stan `quarantined`, filtr „Wymaga uwagi (n)”. Scenariusz C10.

## Kryteria akceptacji
**AC1 — Przyczyna tylko dla Administratora**
- Zakładając plik w kwarantannie z przyczyną `malware_detected`
- Gdy otwieram W-09
- Wtedy Administrator widzi „Wymaga uwagi” z przyczyną („Skan wykrył zagrożenie”, „Typ pliku niezgodny z rozszerzeniem”) i „Skanuj ponownie”, a Edytor i Tylko odczyt — „Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.” bez przyczyny i akcji (API nie zwraca im przyczyny).

**AC2 — Alert (SR-FILE-05, SR-LOG-07)**
- Gdy plik trafia do kwarantanny
- Wtedy wszyscy Administratorzy dostają e-mail z samym linkiem do zlecenia w panelu (bez nazwy pliku, klienta i adresu), a kanał alertów — alert bezpieczeństwa.

**AC3 — Ponowny skan (SR-SESS-08)**
- Zakładając plik w kwarantannie po aktualizacji sygnatur
- Gdy Administrator wybiera „Skanuj ponownie” i potwierdza tożsamość w W-04
- Wtedy plik jest skanowany ponownie: czysty wynik przywraca go do przepływu (`clean` → przetwarzanie → `ready`), wynik pozytywny zostawia go w kwarantannie; operacja jest audytowana.

**AC4 — Brak zwolnienia bez skanu (SR-ERR-01)**
- Gdy przeglądam kontrakt API
- Wtedy jedyną operacją zmieniającą stan pliku w kwarantannie jest ponowny skan, a żaden plik nie jest wysyłany do zewnętrznych serwisów.

**AC5 — Usunięcie po 30 dniach (SR-DATA-07, P4)**
- Zakładając plik w kwarantannie od 2026-09-01 (zegar kontrolowany)
- Gdy 2026-10-01 działa zadanie retencji
- Wtedy obiekt jest usunięty ze storage'u, a W-09 pokazuje kafel „Plik usunięty po 30 dniach kwarantanny” bez akcji.

**AC6 — Filtr „Wymaga uwagi”**
- Gdy wybieram filtr „Wymaga uwagi (1)”
- Wtedy widzę tylko pliki w kwarantannie, a brak takich plików pokazuje „Brak plików wymagających uwagi. [Pokaż wszystkie]”.

**AC7 — Sygnatury**
- Zakładając sygnatury ClamAV starsze niż 24 h
- Gdy działa monitoring
- Wtedy powstaje alert (po 72 h — codziennie), a skan działa dalej na starszych sygnaturach (test alertu na staging).

**AC8 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda zleca ponowny skan
- Wtedy tylko Administrator po step-upie; E i R — `403 forbidden`; niezalogowany — `401`; offline — akcja wyłączona.

## Poza zakresem
- Zgłoszenie próbki do producenta sygnatur — niedopuszczalne (P5). Kwarantanna plików z telefonu — ten sam mechanizm, widok na telefonie — M2.

## UX / UI
- W-09: znacznik [P-7] „Wymaga uwagi”, filtr, „Skanuj ponownie”, W-04 „Potwierdź tożsamość, aby ponownie przeskanować plik”. Stany: AC6, AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | przyczyna, ponowny skan ze step-upem |
| Edytor | informacja bez przyczyny |
| Tylko odczyt | informacja bez przyczyny |
| Niezalogowany | brak (`401`) |

- Dane: pliki w kwarantannie (niedostępne dla nikogo), kody przyczyn.
- W AC: SR-FILE-05, SR-LOG-07, SR-SESS-08, SR-ERR-01, SR-DATA-07, SR-AUTHZ-05. W sekcji: SR-LOG-03. Polityki P4, P5.

## Notatki techniczne
- Moduły: `media`, worker, `audit` + panel. E-mail przez kolejkę z EVM-024.
- `devops-engineer`: alerty kwarantanny i wieku sygnatur (Grafana), lifecycle kwarantanny.
- Do potwierdzenia przez `solution-architect`: usunięcie po 30 dniach to retencja techniczna (lifecycle), a nie operacja z rejestru usunięć (README M1 → „Uwagi do potwierdzenia”).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-049 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz C10)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
