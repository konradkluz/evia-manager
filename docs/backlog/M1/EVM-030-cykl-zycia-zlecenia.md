---
id: EVM-030
title: Cykl życia zlecenia — zmiana statusu
type: story
milestone: M1
epic: E3 Zlecenia — rdzeń
status: ready
priority: P1
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-018, EVM-029]
---

# EVM-030: Cykl życia zlecenia — zmiana statusu

## Historyjka
Jako **pracownik biura** chcę **przeprowadzać zlecenie przez statusy od „Nowe” do „Rozliczone” — z wstrzymaniem i anulowaniem —** aby **status zlecenia zawsze mówił, w jakiej fazie jest współpraca z klientem**.

## Kontekst
- Model: „Stany i przejścia” → „Zlecenie” (`domain-model.md`), zasada ścieżek, decyzja 1 z EVM-002 (przywrócenie tylko Administrator ze step-upem).
- Makieta: [W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) — menu przejść odznaki zlecenia, dialogi „Wstrzymaj…”, „Anuluj zlecenie…”, „Rozlicz…”; lista [„Cofnij”](../../ux/flows/04-aktualizacja-etapu.md#cofnij--lista-przejść).
- Warunki płatności przy anulowaniu i rozliczeniu dochodzą przez port uczestnika przejść razem z transzami: EVM-053 (warunek rozliczenia, skutek dla transz planowanych) i EVM-054 (blokada anulowania przy transzy „Wystawiona”). Do EVM-053 zlecenie nie ma transz, więc warunki są spełnione.
- Scenariusze: A2, A5, A10, B2, B12, C11, D3, D9.

## Kryteria akceptacji
**AC1 — Przejścia (menu odznaki)**
- Zakładając zlecenie „Nowe”
- Gdy wybieram kolejno „Zaakceptuj bez wyceny” (albo „Rozpocznij wycenę” → „Zaakceptuj”), „Rozpocznij realizację”, „Zakończ” (dialog; `completedOn` domyślnie dziś), „Rozlicz…” (dialog z podsumowaniem)
- Wtedy status zmienia się zgodnie z tabelą przejść, menu pokazuje tylko przejścia dozwolone dla mnie (`allowedTransitions`), a toasty zachowują się wg listy „Cofnij” (np. „Zakończono zlecenie. [Cofnij]” = „Otwórz ponownie”; „Zaakceptuj” — bez „Cofnij”).

**AC2 — Wstrzymanie i wznowienie**
- Zakładając zlecenie „W realizacji”
- Gdy wybieram „Wstrzymaj…” z powodem (wymagany, ≤ 500 znaków), a potem „Wznów”
- Wtedy zlecenie przechodzi do „Wstrzymane”, a po wznowieniu wraca do „W realizacji”; toast „Wstrzymano zlecenie. [Cofnij]”.

**AC3 — Anulowanie (SR-LOG-03)**
- Gdy wybieram „Anuluj zlecenie…” z powodem
- Wtedy zlecenie ma status „Anulowane” i datę zamknięcia, dialog uprzedza „Przywrócić zlecenie może tylko administrator.”, a powstaje zdarzenie audytu bez treści powodu.

**AC4 — Przywrócenie (SR-SESS-08)**
- Zakładając zlecenie „Rozliczone” albo „Anulowane”
- Gdy Administrator wybiera „Przywróć zlecenie…” i potwierdza tożsamość (W-04)
- Wtedy zlecenie wraca do „Zakończone” (z „Rozliczone”) albo „Wstrzymane” (z „Anulowane”), data zamknięcia jest czyszczona, a operacja jest audytowana; u Edytora pozycja jest wyłączona z podpowiedzią „Przywrócić zlecenie może tylko administrator.”, a API zwraca mu `403 forbidden`.

**AC5 — Zasady przejść (SR-API-07, SR-AUTHZ-04)**
- Gdy wysyłam przejście spoza tabeli, `PATCH` z polem `status`, przejście bez `If-Match` albo z nieaktualną wersją
- Wtedy API zwraca odpowiednio `409 invalid_state_transition`, `400 validation_failed` (`read_only_field`), `428 precondition_required`, `412 version_conflict`; panel przy `412` pokazuje alert konfliktu z odświeżeniem (komunikat z makiety W-06).

**AC6 — Zlecenie zamknięte**
- Zakładając zlecenie „Rozliczone” albo „Anulowane”
- Gdy je otwieram
- Wtedy widzę baner zlecenia zamkniętego w wariancie zależnym od statusu i roli (komunikat z makiety W-06 (b); blokady po stronie serwera — `409 work_order_closed` w EVM-031, EVM-032, EVM-035, EVM-053).

**AC7 — Uprawnienia i ścieżki (SR-AUTHZ-05, SR-AUTHZ-10)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wykonuje przejścia
- Wtedy A i E wykonują przejścia bez przywrócenia, R ma odznakę statyczną i dostaje `403 forbidden`, niezalogowany — `401`; testy ścieżek w grafie przejść potwierdzają, że Edytor nie osiąga skutku przywrócenia sekwencją innych przejść.

**AC8 — Stany**
- Wtedy offline akcje są wyłączone z podpowiedzią „Zmienisz po powrocie połączenia.”, błąd serwera i `429` pokazują alert, a dane dialogu (powód) zostają.

## Poza zakresem
- Skutki dla transz (anulowanie planowanych, warunek rozliczenia) — EVM-053; blokada anulowania przy transzy „Wystawiona” — EVM-054; podsumowanie płatności w dialogach — EVM-058. Ostrzeżenie o otwartych etapach — EVM-031.
- Wpis dziennika o zmianie statusu — EVM-038. Usunięcie zlecenia — EVM-060.

## UX / UI
- W-06: StatusBadge jako przycisk z ActionMenu [P-1], AlertDialog (§ 3.13), Toast z „Cofnij” (§ 3.14), Banner (§ 3.19), W-04.
- Stany: AC5, AC8; brak uprawnień — AC4, AC7.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wszystkie przejścia; przywrócenie ze step-upem |
| Edytor | przejścia bez przywrócenia |
| Tylko odczyt | podgląd statusu (`403` dla przejść) |
| Niezalogowany | brak (`401`) |

- Dane: powód wstrzymania i anulowania (pole swobodne — może zawierać dane osobowe; nie trafia do audytu).
- W AC: SR-LOG-03, SR-SESS-08, SR-API-07, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-10.
- W sekcji: SR-AUTHZ-01, SR-AUTHZ-02, SR-API-06.

## Notatki techniczne
- Moduły: `work-orders`, `audit` + panel.
- Zdolności przekrojowe wprowadzane tutaj: `ETag` / `If-Match` (`428` / `412`); port uczestnika przejść zlecenia — `payments` rejestruje się w EVM-053 (warunek `settled`, skutek `planned → cancelled`, synchronicznie w tej samej transakcji), a EVM-054 dopisuje warunek `cancelled` (brak transz `invoiced`). Port od początku pozwala uczestnikowi zgłosić warunek niespełniony (`422 transition_condition_not_met` z kodem powodu) i wykonać skutek w transakcji komendy; bez uczestników — test z uczestnikiem testowym.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-030 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): uczestnik `payments` rejestruje się w EVM-053 i EVM-054 zamiast EVM-058 (Kontekst, Poza zakresem, Notatki techniczne)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC5 — komunikat `412` wg makiety W-06 (forma bezosobowa, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada (refinement EVM-013; EVM-071 → „Uwagi do rozważenia” 18; liczba AC bez zmian): AC6 — baner zlecenia zamkniętego wg makiety W-06 (b) (wariant zależny od statusu „Rozliczone” / „Anulowane” i roli; po decyzji 17 obejmuje też dane zlecenia) zamiast dosłownego cytatu sprzed decyzji 17
