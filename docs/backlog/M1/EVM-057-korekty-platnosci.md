---
id: EVM-057
title: Korekty płatności (Administrator ze step-upem)
type: story
milestone: M1
epic: E7 Płatności etapowe
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-029, EVM-054]
---

# EVM-057: Korekty płatności (Administrator ze step-upem)

## Historyjka
Jako **Administrator** chcę **poprawiać błędy w płatnościach już wystawionych lub opłaconych — po ponownym potwierdzeniu tożsamości —** aby **dane finansowe były poprawne, a każda korekta rozliczalna**.

## Kontekst
- Model: „Korekta płatności” (zagrożenie T7) — `invoiced → planned`, `invoiced → cancelled`, `paid → invoiced`, `cancelled → planned`, zmiana kwoty w `invoiced` / `paid`, soft delete transzy — wyłącznie Administrator ze step-upem; żadna inna ścieżka nie prowadzi do tego skutku (SR-AUTHZ-10, AB-17). Decyzja 1 z EVM-002.
- Makiety: [akcje płatności](../../ux/flows/08-nieoplacone.md#akcje-płatności--status--rola) (dialogi korekt z „przed i po”), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie) (tylko klucz dostępu). Scenariusz C8.

## Kryteria akceptacji
**AC1 — Wycofaj fakturę**
- Zakładając transzę „Wystawiona” `FV/TEST/0007/2026`
- Gdy Administrator wybiera „Wycofaj fakturę…”, widzi dialog „Wystawiona → Planowana” z kwotą i numerem („Operacja zostanie zapisana w dzienniku audytu.”) i potwierdza tożsamość w W-04
- Wtedy transza jest „Planowana”, dane faktury są wyczyszczone, a audyt zawiera kody statusów i kwotę.

**AC2 — Anuluj fakturę i cofnij wpłatę**
- Gdy Administrator wybiera „Anuluj fakturę…” (Wystawiona → Anulowana) albo „Cofnij wpłatę…” (Opłacona → Wystawiona; data wpłaty wyczyszczona) i potwierdza w W-04
- Wtedy status zmienia się zgodnie z tabelą przejść, a operacja jest audytowana.

**AC3 — Zmień kwotę wystawionej lub opłaconej (SR-LOG-03)**
- Zakładając transzę „Wystawiona” z kwotą 3 600,00 zł
- Gdy Administrator zmienia ją na 3 690,00 zł (dialog z kwotą przed i po, W-04)
- Wtedy kwota jest zmieniona, a zdarzenie audytu zawiera kwotę przed i po.

**AC4 — Przywróć i usuń transzę**
- Gdy Administrator przywraca transzę „Anulowana” (→ „Planowana”) albo usuwa transzę (soft delete) po W-04
- Wtedy operacja się wykonuje i jest audytowana; usunięta transza znika dla Edytora i Tylko odczyt.

**AC5 — Wymagany step-up (SR-SESS-08)**
- Zakładając Administratora uwierzytelnionego 20 min temu
- Gdy zatwierdza korektę
- Wtedy API zwraca `403 step_up_required`, panel pokazuje W-04; anulowanie W-04 daje „Nie wykonano korekty.” z zachowanymi danymi dialogu.

**AC6 — Brak obejść (SR-AUTHZ-10, SR-AUTHZ-05)**
- Zakładając Edytora i Administratora bez step-upu
- Gdy próbują osiągnąć skutek korekty innymi drogami — sekwencją przejść, edycją pól (np. kwoty w stanie „Wystawiona”), usunięciem transzy albo zlecenia
- Wtedy dostają `403 forbidden` albo `403 step_up_required` — potwierdzone testami ścieżek w grafie przejść.

**AC7 — Zlecenie zamknięte**
- Zakładając zlecenie „Rozliczone”
- Gdy Administrator próbuje korekty
- Wtedy API zwraca `409 work_order_closed`, a panel informuje „Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.”

**AC8 — Uprawnienia i stany**
- Wtedy Edytor ma korekty wyłączone z podpowiedzią „Korektę płatności może wykonać tylko administrator.”, R nie widzi akcji (`403`), niezalogowany — `401`, transza zlecenia B ścieżką zlecenia A — `404`; korekty tylko w kanale `web`; offline — akcje wyłączone; `412` — alert z bieżącym statusem transzy i „Odśwież” (komunikat z makiety W-11, wspólny z sekcją „Płatności” W-06).

## Poza zakresem
- „Poproś administratora o korektę” z poziomu transzy — M3 (w MVP komentarz w dzienniku, scenariusz C8). Faktury korygujące w systemie fakturowym — M5.

## UX / UI
- W-06 „Płatności” i W-11: menu `⋮` [P-1], AlertDialog z „przed i po”, W-04 „Potwierdź tożsamość, aby skorygować płatność”. Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | korekty ze step-upem |
| Edytor | brak (`403`) |
| Tylko odczyt | brak (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: kwoty, numery faktur; audyt z kwotą (wyjątek opisany w modelu).
- W AC: SR-LOG-03, SR-SESS-08, SR-AUTHZ-10, SR-AUTHZ-05. W sekcji: SR-API-07, SR-AUTHZ-12.

## Notatki techniczne
- Moduły: `payments`, `audit`, `timeline` (zdarzenia bez kwot) + panel.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-057 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz C8)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada (refinement EVM-013; EVM-071 → „Uwagi do rozważenia” 18; liczba AC bez zmian): AC8 — komunikat `412` w dialogu korekty wg makiety W-11 (wspólny z sekcją „Płatności” W-06; forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
