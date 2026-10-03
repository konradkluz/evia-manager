---
id: EVM-050
title: Dokumenty lokalizacji i klienta
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-036, EVM-047]
---

# EVM-050: Dokumenty lokalizacji i klienta

## Historyjka
Jako **pracownik biura** chcę **przypisać dokument do lokalizacji albo klienta, a nie tylko do jednego zlecenia**, aby **dokumentacja budynku od administracji była widoczna w każdym zleceniu w tym garażu bez kopiowania**.

## Kontekst
- Luka L1 z EVM-004; scenariusze C3 i D7 (UAT M1 — dlatego P1). Model: kotwica `Document` — dokładnie jedna z `workOrderId`, `customerId`, `siteId`.
- To częściowa historia lokalizacji (konsultacja `security-engineer`, pkt 6e): przez `siteId` dostępne są wyłącznie dokumenty z kotwicą lokalizacji — nigdy media ani dokumenty innego zlecenia (SR-AUTHZ-08, AB-19). Przegląd `security-engineer` obowiązkowy.
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — „Przypisz do: Zlecenia / Lokalizacji / Klienta”, „Dokumenty lokalizacji (n) · Dokumenty klienta (n)”; W-14 (EVM-071) — dokumenty klienta.

## Kryteria akceptacji
**AC1 — Przypisanie do lokalizacji albo klienta**
- Zakładając „Dodaj dokument” w zleceniu
- Gdy wybieram „Przypisz do: Lokalizacji” i rodzaj „Dokumentacja budynku”
- Wtedy dokument ma kotwicę lokalizacji (bez etapu), klasę „Bezpieczeństwo budynku” i trafia do sekcji „Dokumenty lokalizacji (1)”; analogicznie „Klienta” → „Dokumenty klienta”.

**AC2 — Widoczność bez kopiowania**
- Zakładając dokument lokalizacji dodany w zleceniu `ZL-2026-0017`
- Gdy otwieram nowe zlecenie `ZL-2026-0058` w tej samej lokalizacji
- Wtedy sekcja „Dokumenty lokalizacji (1)” pokazuje ten dokument (ten sam rekord), a dokumenty klienta są widoczne w każdym jego zleceniu i w szczegółach klienta (W-14).

**AC3 — Autoryzacja kotwicy (SR-AUTHZ-02)**
- Gdy pobieram dokument lokalizacji A ścieżką lokalizacji B albo dokument klienta ścieżką innego klienta
- Wtedy API zwraca `404 not_found`.

**AC4 — Brak dostępu do innych zleceń przez lokalizację (SR-AUTHZ-08)**
- Zakładając zlecenia A i B w tej samej lokalizacji
- Gdy użytkownik zlecenia A pobiera listę dokumentów lokalizacji
- Wtedy dostaje tylko dokumenty z kotwicą lokalizacji — bez dokumentów i mediów zlecenia B (test IDOR przez `siteId`); sekcja jest tylko w panelu.

**AC5 — Klasy poufności (SR-AUTHZ-06, SR-AUTHZ-07)**
- Gdy Tylko odczyt otwiera „Dokumenty lokalizacji”
- Wtedy widzi metadane, a pobranie dokumentu „Bezpieczeństwo budynku” albo „Dane identyfikacyjne” zwraca `403 forbidden` (`lock`); „Standardowy” — pobiera z audytem.

**AC6 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda dodaje i pobiera dokument lokalizacji i klienta
- Wtedy A i E dodają i pobierają, R — wg AC5, niezalogowany — `401`.

**AC7 — Stany**
- Wtedy brak dokumentów — „Dokumenty lokalizacji (0) · Dokumenty klienta (0)” bez listy; offline — dodawanie wyłączone; lokalizacja usunięta — dokumenty niewidoczne dla E i R.

## Poza zakresem
- Pełna historia lokalizacji (dokumenty i zdjęcia poprzednich zleceń) — M3, z przeglądem `security-engineer`.
- Przeniesienie dokumentu między kotwicami — poza v1.

## UX / UI
- W-09: radio „Przypisz do”, sekcje „Dokumenty lokalizacji” i „Dokumenty klienta”; W-14 — lista dokumentów klienta. Stany: AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | dodanie, pobranie wszystkich klas |
| Edytor | dodanie, pobranie wszystkich klas |
| Tylko odczyt | metadane; pobranie tylko „Standardowy” |
| Niezalogowany | brak (`401`) |

- Dane: dokumentacja budynku (`building_security`), dokumenty klienta.
- W AC: SR-AUTHZ-02, SR-AUTHZ-08, SR-AUTHZ-06, SR-AUTHZ-07, SR-AUTHZ-05. W sekcji: SR-DATA-01, SR-FILE-07.

## Notatki techniczne
- Moduły: `media` (kotwice `Site` / `Customer`), fasady `sites`, `customers` + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-050 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusze C3, D7)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
