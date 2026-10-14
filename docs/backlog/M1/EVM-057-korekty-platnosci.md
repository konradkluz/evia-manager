---
id: EVM-057
title: Korekty płatności (Administrator ze step-upem)
type: story
milestone: M1
epic: E7 Płatności etapowe
status: in-progress
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: opus
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
Specyfikacja `ux-designer` (2026-10-14). Źródła: [akcje płatności](../../ux/flows/08-nieoplacone.md#akcje-płatności--status--rola), [dialogi akcji transzy](../../ux/flows/08-nieoplacone.md#dialogi-akcji-transzy-evm-054), [W-04](../../ux/flows/01-logowanie-mfa.md#w-04-ponowne-uwierzytelnienie); styleguide § 3.13, § 3.20, § 4.11, § 4.13. Bez nowych komponentów i tokenów.

**Ekrany i przepływ.** Brak nowych ekranów — korekty są pozycjami osobnej grupy (oddzielonej separatorem; „Korekty” to nazwa tylko w dokumentacji, bez nagłówka w menu) w ActionMenu `⋮` („Akcje transzy: [nazwa]”) transzy w sekcji „Płatności” W-06 i w wierszu W-11. Przepływ: pozycja menu → AlertDialog z „przed i po” → przycisk z czasownikiem → `POST`/`PATCH`/`DELETE` → gdy `403 step_up_required`, nad dialogiem otwiera się W-04 (tylko klucz dostępu, Administrator) → po sukcesie operacja wysyłana ponownie automatycznie (ten sam `Idempotency-Key`), W-04 i dialog zamykają się, toast, odświeżony wiersz. Przy świeżym step-upie (≤ 15 min) W-04 się nie pojawia. Zmiana wobec makiety EVM-054: Administrator **widzi i może użyć** pozycji korekt (także „Usuń transzę…”, a przy transzy „Anulowana” `⋮` ma „Przywróć transzę…” i „Usuń transzę…”); Edytor widzi je wyłączone; Tylko odczyt — bez `⋮`.

**Dostępność pozycji** (wg tabeli akcji; pozycje w osobnej grupie z separatorem, na końcu menu; bez nagłówka grupy):
| Status | Pozycje korekt (A) |
|---|---|
| Wystawiona (także po terminie) | „Wycofaj fakturę…”, „Anuluj fakturę…”, „Zmień kwotę…”, „Usuń transzę…” |
| Opłacona | „Cofnij wpłatę…”, „Zmień kwotę…”, „Usuń transzę…” |
| Anulowana | „Przywróć transzę…”, „Usuń transzę…” |
| Planowana | „Usuń transzę…” (jak dotąd w grupie na końcu; „Zmień kwotę…” i „Anuluj transzę…” to zwykłe akcje EVM-053/054) |

Edytor: te same pozycje `aria-disabled`, podpowiedź „Korektę płatności może wykonać tylko administrator.” (hover, fokus klawiatury, dotyk). Zlecenie „Rozliczone”/„Anulowane”: wszystkie pozycje wyłączone z podpowiedzią z wiersza tabeli akcji (Administrator: „Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.”; Edytor: „…Przywrócić zlecenie może tylko administrator.”). Wyścig (`409 work_order_closed` w dialogu) — tekst z AC7 dla każdej roli. Uwaga: AC7 dla Administratora cytuje wariant „Przywrócić zlecenie może tylko administrator.” (zdanie bezosobowe, prawdziwe też dla A) — w dialogu zostaje on. **Do decyzji Konrada (bez zmiany AC ani kodu):** ujednolicić brzmienie — proponowany wspólny tekst dla obu ról, w menu i w dialogu: „Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.” (zamiast „Zmienisz je po przywróceniu zlecenia.” w podpowiedzi menu dla Administratora). Offline: `⋮` i pozycje wyłączone — „Zmienisz po powrocie połączenia.”

**Dialogi** (AlertDialog `size.dialog.width.sm`, tytuł-pytanie `text.heading-3`, zlecenie `text.body-sm` `color.text.secondary`, układ „przed → po” w `text.numeric`, tabular-nums; ostatnie zdanie zawsze „Operacja zostanie zapisana w dzienniku audytu.”; kwoty „3 600,00 zł” z NBSP, daty `DD.MM.RRRR`):
| # | Tytuł | Podsumowanie (przed → po) | Skutek poza audytem | Przyciski |
|---|---|---|---|---|
| K1 | „Wycofać fakturę FV/TEST/0007/2026?” | „Wystawiona → Planowana” · kwota 3 600,00 zł · zlecenie, transza | „Numer faktury, data wystawienia i termin zostaną wyczyszczone.” | „Anuluj” / „Wycofaj fakturę” (danger) |
| K2 | „Anulować fakturę FV/TEST/0007/2026?” | „Wystawiona → Anulowana” · kwota 3 600,00 zł | „Transzę będzie można przywrócić jako Planowaną.” | „Anuluj” / „Anuluj fakturę” (danger) |
| K3 | „Cofnąć wpłatę za fakturę FV/TEST/0007/2026?” | „Opłacona → Wystawiona” · kwota · „Data wpłaty 03.10.2026 zostanie wyczyszczona.” | „Transza może od razu być po terminie, jeśli termin minął.” (gdy dotyczy; **propozycja na później, do decyzji Konrada, bez zmiany kodu:** „Termin {{date}} minął — transza od razu będzie po terminie.”) | „Anuluj” / „Cofnij wpłatę” (primary) |
| K4 | „Zmienić kwotę transzy „Zaliczka”?” | pole „Nowa kwota” (TextField kwota, „zł” jako opis pola (`aria-describedby`, § 3.2), reguły jak EVM-053/054); podsumowanie na żywo „3 600,00 zł → 3 690,00 zł”, status bez zmian, nr faktury | „Status i dane faktury zostają bez zmian.” | „Anuluj” / „Zmień kwotę” (primary; wyłączony, dopóki kwota nie różni się od bieżącej) |
| K5 | „Przywrócić transzę „Zaliczka”?” | „Anulowana → Planowana” · udział, kwota (lub „—”) | „Transza wróci na swoje miejsce na liście.” | „Anuluj” / „Przywróć transzę” (primary) |
| K6 | „Usunąć transzę „Zaliczka”?” | status i kwota transzy, nr faktury (jeśli jest) | „Transza zniknie z listy. Edytor i osoba z rolą Tylko odczyt jej nie zobaczą.” | „Anuluj” / „Usuń transzę” (danger) |

Układ K1 (K2, K3, K5, K6 analogicznie — AlertDialog § 3.13 bez przycisku [x], zamyka się Esc i „Anuluj”; [x] ma tylko K4, bo to Dialog):
```text
│ Wycofać fakturę FV/TEST/0007/2026?
│ ZL-2026-0042 · Garaż — pełny proces · „Zaliczka”
│ Stan:   Wystawiona → Planowana
│ Kwota:  3 600,00 zł
│ Numer faktury, data wystawienia i termin zostaną wyczyszczone.
│ Operacja zostanie zapisana w dzienniku audytu.
│                          [Anuluj]  [[ Wycofaj fakturę ]]
```
Stan „przed → po” to dwie StatusBadge (ikona + etykieta, `color.status.payment.*`: `invoiced` — `file-text`, `planned`, `paid` — `circle-check`, `cancelled` — `ban`), a nie sam tekst; w czytniku: „Stan: z Wystawiona na Planowana”.

**W-04 (po `403 step_up_required`).** Tytuł „Potwierdź tożsamość, aby skorygować płatność”; podsumowanie (jedna linia pod tytułem) zależnie od dialogu: „Wycofanie faktury FV/TEST/0007/2026” · „Anulowanie faktury FV/TEST/0007/2026” · „Cofnięcie wpłaty za fakturę FV/TEST/0007/2026” · „Zmiana kwoty transzy „Zaliczka”: 3 600,00 zł → 3 690,00 zł” · „Przywrócenie transzy „Zaliczka”” · „Usunięcie transzy „Zaliczka””; druga linia: „Transza „Zaliczka” · ZL-2026-0042 · 3 600,00 zł”. Anulowanie W-04 (przycisk „Anuluj”, `x`, Esc): wraca AlertDialog korekty z InlineAlert (`role="alert"`) „Nie wykonano korekty.”, dane dialogu (np. kwota K4) zachowane, fokus na „Anuluj” dialogu korekty (w K4 — na polu kwoty).

**Fokus.** Otwarcie K1–K3, K5, K6 (brak pól) — „Anuluj” (§ 4.11); K4 — pole „Nowa kwota” (wartość zaznaczona; zgodnie z propozycją § 4.11 z changelogu, do decyzji Konrada — bez akceptacji „Anuluj”). Zamknięcie dialogu (Anuluj, `x`, Esc) — wyzwalacz `⋮` tej transzy. Sukces — wyzwalacz `⋮` tej transzy (wiersz odświeżony); po K6 — `⋮` następnej transzy, a gdy jej nie ma — przycisk „Dodaj transzę” (wiersz przestał istnieć). Błąd — alert, potem pole z błędem. Po wyjściu z W-04 fokus wraca do przycisku metody, a po zamknięciu — do dialogu korekty.

**Toasty** (`role="status"`, bez akcji): „Wycofano fakturę FV/TEST/0007/2026 — transza jest Planowana.” · „Anulowano fakturę FV/TEST/0007/2026.” · „Cofnięto wpłatę za fakturę FV/TEST/0007/2026 — transza jest Wystawiona.” · „Zmieniono kwotę transzy „Zaliczka”: 3 600,00 zł → 3 690,00 zł.” · „Przywrócono transzę „Zaliczka” — jest Planowana.” · „Usunięto transzę „Zaliczka”.”

**Stany.**
| Stan | Zachowanie |
|---|---|
| Pusty | Nie dotyczy (akcje na istniejących transzach); po usunięciu ostatniej transzy sekcja pokazuje „Brak transz. [Dodaj transzę]” (EVM-053); W-11 — transza znika z listy i sum. |
| Ładowanie | Przycisk główny w stanie ładowania, dialog nie zamyka się do wyniku; podsumowanie z danych wiersza (bez spinnera); wiersz po sukcesie — skeleton wiersza do odświeżenia, nie przeładowanie strony. W-04 — przycisk metody w stanie ładowania. |
| Błąd | `412` / `409 invalid_state_transition` — InlineAlert „Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»). [Odśwież]” (wspólny z W-06 i W-11, forma bezosobowa); „Odśwież” ładuje bieżącą transzę, dialog zamyka się, jeśli korekta przestała mieć sens, a dane K4 zostają. `409 work_order_closed` — „Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.”, przycisk operacji wyłączony. `422 transition_condition_not_met` / `400` (kwota) — komunikat pod polem K4 jak w EVM-053/054. `404` — „Nie znaleziono transzy. Odśwież zlecenie.” `403 forbidden` (utrata roli w trakcie) — „Nie masz uprawnień do tej operacji.” `429` — wzór z README. Błąd sieci/serwera — „Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.” (ten sam klucz idempotencji). Anulowanie W-04 — „Nie wykonano korekty.” (wyżej). |
| Offline | `⋮` i pozycje wyłączone — „Zmienisz po powrocie połączenia.”; otwarty dialog zachowuje dane, przycisk operacji wyłączony — „Zapiszesz po powrocie połączenia.”; W-04 — „Brak połączenia. Potwierdzenie wymaga połączenia z internetem.” |
| Brak uprawnień | Edytor — pozycje korekt widoczne, `aria-disabled`, „Korektę płatności może wykonać tylko administrator.”; Tylko odczyt — bez `⋮` (tylko odczyt kwot, statusów, „Po terminie”); niezalogowany — przekierowanie do logowania (`401`); korekty tylko w panelu (kanał `web`) — w aplikacji mobilnej brak akcji. |
| Po terminie | Po korekcie odznaka „Po terminie” (`workOrders.status.paymentOverdue`, ikona `alarm-clock`, etykieta + liczba dni) liczona ponownie: znika po „Wycofaj fakturę…” i „Anuluj fakturę…”; pojawia się po „Cofnij wpłatę…”, jeśli termin minął. Zmiana odzwierciedlona w kolumnie „Płatność” W-10 (EVM-056) po odświeżeniu danych. |

**Responsywność.** `breakpoint.medium` i szersze — dialog `size.dialog.width.sm`; `breakpoint.compact` (360 px) — dialogi zgodnie z § 3.13 (bieżące zachowanie; układ compact AlertDialog/Dialog to propozycja osobnej historyjki), „przed → po” w dwóch liniach („Przed: …” / „Po: …”), `inputmode="decimal"` w K4; `⋮` ma cel dotyku ≥ 44×44 px (web) i pozycje menu min. 44 px wysokości.

**Komponenty i tokeny.** ActionMenu (§ 3.20, grupa z separatorem, pozycje `aria-disabled`); AlertDialog (§ 3.13) i Dialog (K4); TextField kwota (§ 3.2, `text.numeric`); StatusBadge (§ 3.9, `color.status.payment.{planned,invoiced,paid,cancelled,overdue}.*`); InlineAlert (§ 3.19, `color.feedback.error.*` / `warning.*` dla „Nie wykonano korekty.”); Button danger/primary/tertiary (§ 3.1); Toast (§ 3.14); W-04 bez zmian (tylko nowe teksty). Brak zaszytych kolorów i rozmiarów.

**Dostępność.** Pułapka fokusu i przywrócenie fokusu wg sekcji „Fokus”; `aria-labelledby` (tytuł), `aria-describedby` (podsumowanie i skutek); zmiana statusu niesiona ikoną + etykietą, nie kolorem; „zł” jako opis pola (`aria-describedby`, § 3.2), nazwa dostępna pola to „Nowa kwota”; `aria-disabled` + podpowiedź osiągalna klawiaturą i dotykiem (§ 3.1); strzałki/Home/End w menu; wynik ogłasza toast; błędy `role="alert"` powiązane z polem; W-04 dostępny klawiaturą, bez limitu czasu na dialogu.

**Mikrocopy (komplet).** „Wycofaj fakturę…” · „Anuluj fakturę…” · „Cofnij wpłatę…” · „Zmień kwotę…” · „Przywróć transzę…” · „Usuń transzę…” · „Operacja zostanie zapisana w dzienniku audytu.” · „Korektę płatności może wykonać tylko administrator.” · „Nie wykonano korekty.” · „Potwierdź tożsamość, aby skorygować płatność” · teksty tabel i toastów wyżej. Terminologia wg `domain.md` („transza”, „Wystawiona”, „Opłacona”, „Anulowana”, „Po terminie”).

**Dla implementacji / procesu.** (1) Dopisać do flows `01-logowanie-mfa.md` → „Tytuły operacji M1” wiersz korekt płatności (tytuł i podsumowania wyżej) oraz zmienić w `08-nieoplacone.md` zdanie „Administrator nie widzi ich” (EVM-054) na stan od EVM-057. (2) Test e2e ze stałym zegarem w mocku (odznaka „Po terminie”). (3) Odrzucone próby korekt w audycie (SR-LOG-06) — decyzja planu/architekta, bez wpływu na UI.

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
- 2026-10-13 — Konrad zaakceptował (P1–P7 z `/refine` EVM-053): P2 — próba zmiany kwoty transzy innej niż „Planowana” bez step-upu zwraca `403` (Edytor `forbidden`, Administrator `step_up_required`), a ze step-upem jest korektą z AC3; P6 — `model: opus`.

## Uwagi do rozważenia
- **Ryzyko do akceptacji Konrada — SR-LOG-06 (audyt nieudanych prób operacji wrażliwych; ASVS V16.3.3 L2), ocena P2 × W1 (security-engineer).** Odrzucone próby korekt (`403 forbidden` / `403 step_up_required` — z guardu dla `DELETE`, z serwisu dla przejść i `PATCH`) nie zostawiają wpisu w audycie (wycofanie transakcji kasuje też audyt). To luka całej platformy (dotyczy też innych operacji ze step-upem, np. przywrócenia zlecenia; brak metryki 403/404 per użytkownik); AC EVM-057 tego nie wymagają, udane korekty są audytowane, a skutek finansowy odmowy jest zablokowany. Decyzja architekta (2026-10-14): nie robić częściowo w `payments`. **Rekomendacja:** zaakceptować ryzyko dla wydania M1 i założyć osobną historyjkę platformową E1 (`/refine`): audyt `denied` dla odmów `403` operacji ze step-upem i korekt w guardzie lub filtrze wyjątków (osobna transakcja, deduplikacja jak `bulk_read.rejected`, bez danych żądania) oraz metryka 403/404 per użytkownik z alertem.

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
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce (ścieżka pełna, model opus, gałąź `feature/EVM-057-korekty-platnosci` ułożona na EVM-056 → EVM-055 → EVM-054 → EVM-053 — łańcuch za zgodą Konrada)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — implementacja API (backend-developer): korekty przejściami, korekta kwoty, `DELETE` transzy z zagęszczeniem pozycji, 6 akcji audytu, kod dziennika `payment_milestone_deleted`, komórka IDOR dla operacji ze step-upem w macierzy ról; bez migracji; ryzyko SR-LOG-06 w „Uwagach do rozważenia” do akceptacji Konrada
- 2026-10-14 — implementacja panelu (web-developer): dialogi K1–K6 w W-06 i W-11, W-04 z podsumowaniem korekty i jednym ponowieniem z tym samym `Idempotency-Key`, „Nie wykonano korekty.”, kod dziennika `payment_milestone_deleted`; E2E z zamrożonym czasem (Chromium, Edge, Firefox), zrzuty `docs/ux/reviews/EVM-057/`
