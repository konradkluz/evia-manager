---
id: EVM-054
title: Wystawienie faktury, wpłata i anulowanie transzy planowanej
type: story
milestone: M1
epic: E7 Płatności etapowe
status: done
priority: P1
path: pelna
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: opus
depends_on: [EVM-053]
---

# EVM-054: Wystawienie faktury, wpłata i anulowanie transzy planowanej

## Historyjka
Jako **pracownik biura** chcę **odnotować wystawienie faktury, wpłatę i anulowanie niepotrzebnej transzy**, aby **status każdej płatności był aktualny bez arkusza**.

## Kontekst
- Model: tabela przejść „Etap płatności” — `planned → invoiced` (kwota, nr faktury, data; termin = data + dni z planu), `invoiced → paid` (data wpłaty nie z przyszłości), `planned → cancelled` (powód) — A, E; audytowane z kwotą. Korekty — tylko Administrator ze step-upem (EVM-057).
- Decyzje z EVM-004: wpłaty odnotowuje Edytor, Edytor anuluje tylko transzę „Planowaną”; zaliczka na proformę — pole „Nr faktury lub proformy” (P4 z EVM-002).
- **Uczestnik przejść zlecenia** (`payments`, zarejestrowany w EVM-053): od tej historyjki transza może być „Wystawiona”, więc tu dochodzi warunek anulowania zlecenia z `domain-model.md` → „Zlecenie” — brak transz `invoiced`. Bez niego anulowanie zlecenia ukryłoby wystawioną fakturę w zleceniu zamkniętym, czyli dałoby skutek zarezerwowany dla korekty Administratora ze step-upem (zasada ścieżek, SR-AUTHZ-10; przegląd EVM-010, `solution-architect`).
- Makiety: [akcje płatności](../../ux/flows/08-nieoplacone.md#akcje-płatności--status--rola) (W-06 i W-11), dialogi z podsumowaniem. Scenariusze: A11, A13, B3, B9, B12, C7, D3, D9.

## Kryteria akceptacji
**AC1 — Wystaw fakturę (SR-LOG-03)**
- Zakładając transzę „Planowana” z planem płatności 7 dni
- Gdy wybieram „Wystaw fakturę…”, podaję kwotę 1 230,00 zł, nr `FV/TEST/0021/2026` i datę wystawienia 2026-10-03, i potwierdzam dialog z podsumowaniem („Cofnąć wystawienie może tylko administrator.”)
- Wtedy transza jest „Wystawiona” z terminem 2026-10-10 (edytowalnym w dialogu), a zdarzenie audytu zawiera kwotę i kody statusów.

**AC2 — Odnotuj wpłatę**
- Zakładając transzę „Wystawiona”
- Gdy wybieram „Odnotuj wpłatę…” z datą wpłaty (domyślnie dziś) i potwierdzam
- Wtedy transza jest „Opłacona”, toast „Odnotowano wpłatę 1 230,00 zł za fakturę FV/TEST/0021/2026.” jest bez „Cofnij”, a data z przyszłości (zegar: dziś 2026-10-03, data 2026-10-04) zwraca błąd „Data wpłaty nie może być późniejsza niż dziś.”

**AC3 — Anuluj transzę planowaną**
- Zakładając transzę „Planowana”
- Gdy wybieram „Anuluj transzę…” z wymaganym powodem
- Wtedy transza ma status „Anulowana” (ton neutralny, ikona `ban`), dialog uprzedza „Przywrócić transzę może tylko administrator.”, a zdarzenie trafia do audytu.
- Oraz każda zmiana statusu transzy (AC1–AC3, także skutek anulowania zlecenia z EVM-053) tworzy w dzienniku zlecenia zdarzenie z kodami statusów, bez kwoty (EVM-038), a filtr „Płatności” w W-08 je pokazuje.

**AC4 — Poprawki danych faktury i wpłaty**
- Gdy w transzy „Wystawiona” poprawiam nr faktury, datę wystawienia albo termin, a w „Opłaconej” — datę wpłaty
- Wtedy zmiana zapisuje się z `If-Match` bez zmiany kwoty i statusu.

**AC5 — Korekty niedostępne dla Edytora (SR-AUTHZ-10)**
- Zakładając Edytora i transze „Wystawiona”, „Opłacona”, „Anulowana”
- Gdy próbuje wycofać fakturę, anulować fakturę, zmienić kwotę, cofnąć wpłatę, przywrócić albo usunąć transzę
- Wtedy pozycje są wyłączone z podpowiedzią „Korektę płatności może wykonać tylko administrator.”, a API zwraca `403 forbidden` — także dla zmiany kwoty przez edycję pola w stanie „Wystawiona” (testy ścieżek w grafie przejść).

**AC6 — Anulowanie zlecenia z transzą wystawioną (SR-AUTHZ-10, SR-API-06)**
- Zakładając zlecenie „W realizacji” albo „Wstrzymane” z transzą „Wystawiona” i transzą „Planowana”
- Gdy Administrator albo Edytor anuluje zlecenie z powodem
- Wtedy API zwraca `422 transition_condition_not_met` z powodem `invoiced_milestones`, zlecenie i obie transze zostają bez zmian (bez zdarzeń audytu i dziennika), a dialog „Anuluj zlecenie…” pokazuje „Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.”
- Oraz testy ścieżek w grafie przejść zlecenia i transz potwierdzają, że żadna sekwencja dostępna dla Edytora ani dla Administratora bez step-upu nie zamyka zlecenia z transzą „Wystawiona”. Test współbieżności: wystawienie faktury równolegle z anulowaniem zlecenia nie zostawia transzy „Wystawiona” w zleceniu „Anulowane”.

**AC7 — Zasady (SR-API-07, SR-INPUT-02)**
- Gdy wysyłam przejście spoza tabeli, brak `If-Match`, nieaktualną wersję albo przejście w zleceniu zamkniętym
- Wtedy API zwraca odpowiednio `409 invalid_state_transition`, `428`, `412` (alert z bieżącym statusem transzy i „Odśwież” — komunikat z makiety W-11, wspólny z sekcją „Płatności” W-06), `409 work_order_closed`.

**AC8 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-06, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda wykonuje akcje z tej historyjki
- Wtedy A i E je wykonują, R nie widzi akcji i dostaje `403 forbidden`, niezalogowany — `401`, transza zlecenia B ścieżką zlecenia A — `404`.

## Poza zakresem
- Korekty płatności — EVM-057. Warunek rozliczenia i skutek anulowania zlecenia dla transz planowanych — EVM-053; podsumowanie płatności w dialogach „Rozlicz…” i „Anuluj zlecenie…” i akcje wyłączone przed wysłaniem żądania — EVM-058.
- Integracja z systemem fakturowym (KSeF) — M5. „Poproś administratora o korektę” — M3.

## UX / UI
Specyfikacja ux-designer z konsultacji planu 2026-10-14 (decyzja Konrada 2026-10-14 → „Decyzje”: dialogi i toasty dopisuje ux-designer do makiety; wzorzec — dialogi „Dodaj transzę” / „Zmień kwotę”). **Wiążąca jest makieta** [08-nieoplacone.md → „Dialogi akcji transzy (EVM-054)”](../../ux/flows/08-nieoplacone.md#dialogi-akcji-transzy-evm-054); poniżej zapis z konsultacji. Wszystkie kwoty wg § 6.3, daty `DD.MM.RRRR`, każda akcja płatności **bez „Cofnij”**.

**Ekrany i wejścia** (W-06 „Płatności”, W-11 — ta sama tabela akcji, bez nowych ekranów)
- Planowana: przycisk wiersza „Wystaw fakturę…”; menu `⋮` („Akcje transzy: [nazwa]”): „Zmień kwotę…” (EVM-053), potem grupa „Anuluj transzę…”.
- Wystawiona (także po terminie): przycisk „Odnotuj wpłatę…”; `⋮`: „Popraw dane faktury…”. Korekty (Wycofaj fakturę…, Anuluj fakturę…, Zmień kwotę…, Usuń transzę…) w osobnej grupie na końcu.
- Opłacona: `⋮`: „Popraw datę wpłaty…”; w grupie korekt „Cofnij wpłatę…”, „Zmień kwotę…”, „Usuń transzę…”.
- Anulowana: tylko grupa korekt („Przywróć transzę…”, „Usuń transzę…”).
- Korekty: Edytor — pozycje widoczne, `aria-disabled`, podpowiedź „Korektę płatności może wykonać tylko administrator.” (klawiatura i dotyk też); Administrator — nie widzi ich do EVM-057 (przy Anulowanej bez `⋮`); Tylko odczyt — brak przycisków i `⋮`.

**Dialogi** (Dialog / AlertDialog § 3.13 `size.dialog.width.sm`, tytuł `text.heading-3`, zlecenie `text.body-sm` `color.text.secondary`, TextField § 3.2, DatePicker § 3.5, TextArea, InlineAlert § 3.19, Button primary + tertiary „Anuluj”; danger tylko przy anulowaniu)
1. **„Wystawić fakturę dla transzy „Zaliczka”?”** (dialog z podsumowaniem, § 4.11): pola — Kwota (wstawiona, jeśli była wpisana wcześniej; wymagana, reguły z „Zmień kwotę”), „Nr faktury lub proformy” (wymagany), „Data wystawienia” (domyślnie dziś; 01.01.2000–31.12.2100, może być przyszła), „Termin płatności” (domyślnie data wystawienia + dni z planu, edytowalny; transza ręczna bez dni — puste i wymagane; zmiana daty wystawienia przelicza termin, dopóki użytkownik go nie ruszył). Pod polami blok podsumowania (transza, zlecenie, kwota, nr, data, termin) na żywo; skutek „Cofnąć wystawienie może tylko administrator.”; przyciski „Anuluj” / „Wystaw fakturę”. Termin w przeszłości — wskazówka (nie błąd) „Termin już minął — faktura będzie od razu po terminie.”
2. **„Odnotować wpłatę za transzę „Zaliczka”?”** — wg makiety W-11 (data wpłaty domyślnie dziś, „Nie później niż dziś.”, „Cofnąć wpłatę może tylko administrator.”, przycisk „Odnotuj wpłatę”).
3. **„Anulować transzę „Zaliczka”?”** (z podsumowaniem): transza, udział, wymagane pole „Powód anulowania” (TextArea, zwykły tekst, limit z kontraktu, licznik znaków); skutek „Przywrócić transzę może tylko administrator.”; przyciski „Anuluj” (tertiary) / „Anuluj transzę” (danger).
4. **„Popraw dane faktury”** (zwykły dialog, odwracalny tą samą rolą — bez podsumowania): Nr faktury lub proformy, Data wystawienia, Termin płatności; kwota tylko do odczytu (`text.body-sm`, „Kwotę zmieni administrator korektą płatności.”); „Anuluj” / „Zapisz zmiany”; „Zapisz” aktywny dopiero po zmianie.
5. **„Popraw datę wpłaty”** (zwykły dialog): Data wpłaty (nie później niż dziś); „Anuluj” / „Zapisz datę”.
6. **„Anuluj zlecenie…” (AC6)**: przy `422` z powodem `invoiced_milestones` w dialogu InlineAlert błędu „Najpierw odnotuj wpłatę albo poproś administratora o anulowanie faktury.”; zlecenie i transze bez zmian, dialog zostaje otwarty (blokada przed wysłaniem — EVM-058).

**Walidacja** (pod polem + podsumowanie § 4.1): „Podaj nr faktury lub proformy.” · „Podaj kwotę większą od zera, np. 1 500,00 zł.” · „Kwota może mieć najwyżej 2 miejsca po przecinku.” · „Podaj datę z lat 2000–2100.” · „Podaj termin płatności.” · „Termin płatności nie może być wcześniejszy niż data wystawienia.” · „Data wpłaty nie może być późniejsza niż dziś.” (zarówno `400 in_future` w poprawce, jak i `422 transition_condition_not_met` przy odnotowaniu) · „Podaj powód anulowania.”

**Toasty** (`role="status"`, bez akcji, § 3.14): „Wystawiono fakturę FV/TEST/0021/2026 na 1 230,00 zł, termin płatności 10.10.2026.” · „Odnotowano wpłatę 1 230,00 zł za fakturę FV/TEST/0021/2026.” · „Anulowano transzę „Zaliczka”.” · „Zapisano dane faktury FV/TEST/0021/2026.” · „Zapisano datę wpłaty 03.10.2026.”

**Stany**
- Pusty: nie dotyczy (akcje na istniejących transzach); „Brak transz.” bez zmian (EVM-053).
- Ładowanie: przycisk główny w stanie ładowania, dialog nie zamyka się do wyniku, tabela odświeża się bez przeładowania; podsumowanie wypełnione z danych wiersza (bez spinnera).
- Błąd: `412` / `409 invalid_state_transition` — InlineAlert „Tę transzę zmieniono w międzyczasie (teraz: «Opłacona»). [Odśwież]” (wspólny z W-06/W-11, AC7), wprowadzone dane zostają; `409 work_order_closed` — „Zlecenie jest rozliczone — płatności są tylko do odczytu.”; `428`/błąd serwera/sieci — § 6.4 („Nie udało się zapisać. Spróbuj ponownie — nie wykonamy tej operacji dwa razy.”); `429` — wzór z README; `403` (po utracie roli) — „Nie masz uprawnień do tej operacji.”
- Offline: wiersze i `⋮` wyłączone z podpowiedzią „Zmienisz po powrocie połączenia.”; otwarty dialog zachowuje dane, przycisk operacji wyłączony z podpowiedzią „Zapiszesz po powrocie połączenia.”
- Brak uprawnień: Tylko odczyt bez akcji; Edytor — korekty wyłączone (wyżej); transza obcego zlecenia `404` — „Nie znaleziono transzy. Odśwież zlecenie.”
- Po terminie: w wierszu Wystawionej odznaka „Po terminie” (ikona `alarm-clock`, etykieta i liczba dni, nie sam kolor — § 4.2/4.4) obok akcji „Odnotuj wpłatę…”; po wpłacie odznaka znika (Opłacona).

**Responsywność:** `breakpoint.medium` i szersze — dialog `size.dialog.width.sm`, pola w jednej kolumnie, daty obok siebie dopiero od `breakpoint.expanded`; `breakpoint.compact` (360 px) — dialog na pełną szerokość, przyciski na dole (główny nad „Anuluj”), `inputmode="decimal"` dla kwoty, podsumowanie pod polami; przycisk wiersza „Wystaw fakturę…”/„Odnotuj wpłatę…” na pełną szerokość karty transzy.

**Dostępność:** pułapka fokusu, `aria-labelledby` (tytuł) i `aria-describedby` (transza, skutek); fokus przy otwarciu — dialogi 1 i 3 z polami: pierwsze pole (wymagane wprowadzenie danych), dialog 2 (bez pól do wypełnienia poza datą): „Anuluj”; po zamknięciu — wyzwalacz (przycisk wiersza albo `⋮`), po sukcesie `⋮` tej transzy; błąd — `role="alert"`, potem pole z błędem; błędy powiązane `aria-describedby`; podsumowanie na żywo bez `aria-live` (nie zalewać czytnika), wynik ogłasza toast; „zł” w nazwie dostępnej pola („Kwota, złote”); wyłączone pozycje `aria-disabled` z podpowiedzią osiągalną klawiaturą (§ 3.1); cele min. `size.control.height.web.md`, status nie tylko kolorem (ikona + etykieta: `file-text` Wystawiona, `circle-check` Opłacona, `ban` Anulowana).

**Styleguide:** dialog z podsumowaniem skutku, który zawiera też pola formularza (fokus na pierwszym polu zamiast „Anuluj”) — doprecyzowanie § 4.11 zapisane jako propozycja w changelogu styleguide'u (do akceptacji Konrada).

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | wszystkie akcje z tej historyjki |
| Edytor | wszystkie akcje z tej historyjki |
| Tylko odczyt | podgląd (`403`) |
| Niezalogowany | brak (`401`) |

- Dane: kwoty, numery faktur (WF), audyt z kwotą.
- W AC: SR-LOG-03, SR-AUTHZ-10, SR-API-06, SR-API-07, SR-INPUT-02, SR-AUTHZ-02, SR-AUTHZ-06, SR-AUTHZ-05.
- Warunek anulowania zlecenia nie dodaje operacji API: działa w `POST …/work-orders/{id}/transitions` z EVM-030 (macierz ról bez zmian).

## Notatki techniczne
- Moduły: `payments` (także warunek anulowania w uczestniku przejść z EVM-053), `timeline`, `audit` + panel. „Dziś” — wstrzykiwany zegar `Europe/Warsaw`.
- Kod powodu `invoiced_milestones` (obok `unpaid_milestones`) ta historyjka dopisuje addytywnie do katalogu `api-guidelines.md`. Przejścia transz serializują się z przejściami zlecenia na wierszu zlecenia (jak w EVM-053).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Pełny plan (backend-developer, 2026-10-14) — plik roboczy `.scratch/EVM-054/plan.md` (poza repo). Skrót:
- **Kontrakt (contract-first, addytywnie):** `POST …/payment-milestones/{milestoneId}/transitions` (`transitionPaymentMilestone`; A, E; `If-Match`, `Idempotency-Key`), poszerzony `PaymentMilestonePatch` (`invoiceNumber`, `invoicedOn`, `dueDate`, `paidOn`), `DELETE …/payment-milestones/{milestoneId}` (`deletePaymentMilestone` — do EVM-057 `403`, Q1), `PaymentMilestone.allowedTransitions`, `AuditEvent.fromCode`/`toCode`, grupa dziennika `payments`, kod powodu `invoiced_milestones`.
- **Migracje (expand):** `0028` — `status_reason` i CHECK-i spójności statusu transzy (`NOT VALID` + `VALIDATE`); `0029` — `audit.events.from_code`/`to_code`.
- **Moduły:** `payments` (czysta tabela przejść, warunki, zapis przez wspólny punkt z EVM-053, warunek `invoiced_milestones` przy anulowaniu zlecenia), `audit` (kody statusów), `timeline` (zdarzenie transzy; nowa zależność `timeline → payments` tylko przez `index.ts`), panel `apps/web/src/work-orders`.
- **Przegląd architekta i bezpieczeństwa (konsultacja planu 2026-10-14):** solution-architect — zgoda z uwagami (zależność `timeline → payments`, kolumny `audit.events`, kolejność kontroli PATCH); security-engineer — zgoda (K1–K14, m.in. wąski wyjątek macierzy dla `deletePaymentMilestone`); ux-designer — specyfikacja UI (sekcja „UX / UI”, makieta 08).
- **Testy:** każde AC → testy oznaczone `EVM-054 AC#` (jednostkowe domeny, integracyjne API z macierzą ról w kontenerze, komponenty i E2E panelu).

## Decyzje
- 2026-10-13 — Konrad zaakceptował (rekomendacje P1–P7 z `/refine` EVM-053): P2 — zmiana kwoty transzy innej niż „Planowana” zwraca `403 forbidden` dla Edytora (AC5) i `403 step_up_required` dla Administratora bez step-upu (EVM-057); `409 invalid_state_transition` zostaje dla przejść spoza tabeli (AC7); P4 — zdarzenia `PaymentMilestone` dopina EVM-056, więc zapisy transz idą przez wspólny punkt z EVM-053; P6 — `model: opus`.

- **2026-10-14 — pytania do Konrada (potok nocny `wf_7c4c9ec8-c62` zatrzymany na planie; plan w `.scratch/EVM-054/plan.md`, poza repo):**
  - **Q1 (blokuje, AC5):** AC5 wymaga `403` z API, gdy Edytor usuwa transzę, ale operacji usunięcia w API nie ma (soft delete = korekta Administratora ze step-upem, EVM-057) — bez trasy jest `404`. Rekomendacja: w EVM-054 dodać do kontraktu `DELETE …/payment-milestones/{milestoneId}` (`deletePaymentMilestone`, `roles [administrator]`, `channels [web]`, `stepUp: true`, `audit: true`) — Edytor i Tylko odczyt `403 forbidden`, Administrator bez step-upu `403 step_up_required`, Administrator ze step-upem do EVM-057 `403 forbidden`; skutek usunięcia dopisuje EVM-057. Alternatywa: AC5 dla usunięcia tylko w UI (pozycja wyłączona), test API w EVM-057.
  - **Q2 (rekomendacja, nie blokuje):** krawędzie korekty (wycofanie / anulowanie faktury, cofnięcie wpłaty, przywrócenie transzy, zmiana kwoty w „Wystawiona”/„Opłacona”) do EVM-057 — każda rola `403 forbidden` (deny-by-default jak zmiana kwoty w EVM-053); Administrator nie widzi pozycji korekt, u Edytora wyłączone z podpowiedzią (AC5).
  - **Q3 (rekomendacje, nie blokują):** (a) data wystawienia faktury może być przyszła, zakres 2000-01-01…2100-12-31; (b) termin płatności ≥ data wystawienia, inaczej `400`; (c) transza dodana ręcznie nie ma dni terminu z planu — termin wymagany (`400 /dueDate`); (d) poprawki AC4 wg tabeli makiety: dane faktury tylko w „Wystawiona”, data wpłaty tylko w „Opłacona”, inaczej `409 invalid_state_transition`; (e) przyszła data wpłaty: PATCH `400 /paidOn in_future`, przejście `422 transition_condition_not_met` (makieta W-11 „Stany”).
  - Ocena planu: potrzebny przegląd architekta (zależność `timeline → payments`, kolumny `audit.events.from_code`/`to_code`, nowe operacje) i specyfikacja UI dialogów „Wystaw fakturę…”, „Anuluj transzę…”, „Popraw dane faktury…”, „Popraw datę wpłaty…” i toastów (makiety ich nie opisują).
- **2026-10-14 — Konrad rozstrzygnął pytania z planu (rekomendacje Q1–Q3 + specyfikacja UI):**
  - **Q1:** EVM-054 dodaje do kontraktu `DELETE …/payment-milestones/{milestoneId}` (`deletePaymentMilestone`; `roles [administrator]`, `channels [web]`, `stepUp: true`, `audit: true`): Edytor i Tylko odczyt `403 forbidden`, Administrator bez step-upu `403 step_up_required`, Administrator ze step-upem do EVM-057 `403 forbidden` (opis w kontrakcie); skutek usunięcia dopisuje EVM-057.
  - **Q2:** krawędzie korekty (wycofanie / anulowanie faktury, cofnięcie wpłaty, przywrócenie transzy, zmiana kwoty w „Wystawiona”/„Opłacona”) do EVM-057 — każda rola `403 forbidden`; Administrator nie widzi pozycji korekt, u Edytora wyłączone z podpowiedzią (AC5).
  - **Q3 (a–e) przyjęte:** (a) data wystawienia faktury może być przyszła, zakres 2000-01-01…2100-12-31; (b) termin płatności ≥ data wystawienia, inaczej `400`; (c) transza dodana ręcznie — termin wymagany (`400 /dueDate`); (d) poprawki AC4 wg tabeli makiety: dane faktury tylko w „Wystawiona”, data wpłaty tylko w „Opłacona”, inaczej `409 invalid_state_transition`; (e) przyszła data wpłaty: PATCH `400 /paidOn in_future`, przejście `422 transition_condition_not_met`.
  - **Specyfikacja UI:** dialogi „Wystaw fakturę…”, „Anuluj transzę…”, „Popraw dane faktury…”, „Popraw datę wpłaty…” i toasty dopisuje ux-designer w konsultacji planu (`docs/ux/flows/08-nieoplacone.md`, wzorzec dialogów „Dodaj transzę” / „Zmień kwotę”), przed implementacją.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] Wszystkie AC spełnione i pokryte testami (`EVM-054 AC#`)
- [x] Bramki CI zielone, progi pokrycia spełnione
- [x] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane; instrukcja dla biura (EVM-066) uzupełniona — dokumentacja, CHANGELOG i makieta `08-nieoplacone.md` tak; instrukcji EVM-066 jeszcze nie ma (EVM-066 `ready`) — do decyzji Konrada na demo (jak w EVM-053)
- [x] Demo i akceptacja użytkownika

## Notatki
- Minor security domknięty przez orkiestratora (`37411cc`): warunki przejść zlecenia (`invoiced_milestones`, `unpaid_milestones`) czytają statusy wszystkich żywych transz bez limitu 20 (obrona w głąb; dziś bazę chroni CHECK pozycji 1–20).
- Propozycje do refinementu EVM-057 (security): (1) generator macierzy ról bez komórki IDOR dla operacji ze step-upem — dodać IDOR dla Administratora ze świeżym step-upem (`404`); (2) odrzucone próby korekt (`403`) bez śladu w audycie — SR-LOG-06 wymaga audytu nieudanych prób operacji wrażliwych: zdarzenie `denied` poza wycofaną transakcją albo akceptacja ryzyka w T7.
- Nit QA: niższe pokrycie gałęzi dialogów wpłaty / anulowania / poprawek (57–75%; łącznie diff gałęzie 90,9% — tuż nad progiem); E2E akcji transz przeliczone w tej rundzie tylko w Chromium.
- Specyfikacja dialogów (ux-designer) w „UX / UI” historyjki i w `docs/ux/flows/08-nieoplacone.md` → „Dialogi akcji transzy (EVM-054)”; `ActionMenu` w bibliotece z `position: fixed` (nie jest przycinane przez ramkę tabeli).

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — poprawki z przeglądu EVM-010 (`solution-architect`, wdrożył backend-developer): blokada anulowania zlecenia z transzą „Wystawiona” z testem ścieżek i współbieżności przeniesiona tu z EVM-058 (AC6); zdarzenia dziennika transz dołączone do AC3
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-05 — zmiana AC zaakceptowana przez Konrada na demo EVM-071 (EVM-071 → „Decyzje” 2; „Uwagi do rozważenia” 1; liczba AC bez zmian): AC7 — komunikat `412` wg makiety W-11 (tabela akcji płatności wspólna z W-06; forma bezosobowa z bieżącym statusem i „Odśwież”, `flows/README.md` → zasada wspólna 16) zamiast cytatu „Ktoś zmienił…”
- 2026-10-14 — ready → in-progress: start `/deliver` w kolejce nocnej (ścieżka pełna, model opus, gałąź `feature/EVM-054-faktura-wplata-anulowanie` ułożona na EVM-053 — PR #69 w przeglądzie; łańcuch nocny za zgodą Konrada)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — in-progress → blocked: plan zatrzymany na Q1 (operacja usunięcia transzy a AC5) — pytania Q1–Q3 w „Decyzje”; zależne EVM-055, EVM-056, EVM-057 pominięte w kolejce nocnej
- 2026-10-14 — Konrad odpowiedział na Q1–Q3 i sposób uzupełnienia makiet (wg rekomendacji, „Decyzje”); blocked → ready — ponowny `/deliver` jako nowy przebieg z decyzjami w `userNotes`
- 2026-10-14 — ready → in-progress: ponowny `/deliver` (nowy przebieg, decyzje Q1–Q3 i specyfikacja UI w `userNotes`; ścieżka pełna, opus, gałąź ułożona na EVM-053 — PR #69)
- 2026-10-14 — plan gotowy (backend-developer)
- 2026-10-14 — backend gotowy (backend-developer): kontrakt (`transitionPaymentMilestone`, poprawki w `updatePaymentMilestone`, `deletePaymentMilestone` → `403` do EVM-057), migracje `0028`/`0029`, warunek `invoiced_milestones`, audyt z kodami statusów, dziennik „Płatności”; testy AC1–AC8 zielone w kontenerze; panel — krok web-developera
- 2026-10-14 — panel gotowy (web-developer): akcje transz wg tabeli makiety (korekty Edytora wyłączone, Administratora ukryte do EVM-057), dialogi „Wystaw fakturę…”, „Odnotuj wpłatę…”, „Anuluj transzę…”, „Popraw dane faktury…”, „Popraw datę wpłaty…”, komunikat AC6 w „Anuluj zlecenie…”, filtr „Płatności” w dzienniku; testy komponentów i E2E (Chromium, Firefox, Edge) zielone; zrzuty w `docs/ux/reviews/EVM-054/`
- 2026-10-14 — poprawki runda 1 (backend-developer): specyfikacja dialogów akcji transzy, walidacji, toastów i stanów dopisana do makiety `08-nieoplacone.md` („Dialogi akcji transzy (EVM-054)”); fokus na pierwszym polu oznaczony jako zależny od akceptacji propozycji § 4.11; skrót planu technicznego w historyjce
- 2026-10-14 — potok `wf_d8aac767-926`: passed po 2 rundach (QA PASS AC1–AC8; runda 1: security-engineer APPROVE, code-reviewer i ux-designer changes — major w dokumentacji makiety, blocker przycinania menu akcji; runda 2: APPROVE)
- 2026-10-14 — orkiestrator: minor security (limit 20 w warunkach przejść) domknięty `37411cc`; `pnpm run gate` zielony (diff-coverage linie 1148/1163, gałęzie 1009/1110), `docs:check` 0/0; in-progress → in-review
- 2026-10-14 — Koszt: brak rozbicia w $; potok 15 wywołań agentów, ok. 2,04 mln tokenów subagentów, ok. 256 min (+ przebieg zablokowany na planie ok. 0,15 mln, poprawka ok. 0,06 mln); rundy poprawek 1; ścieżka pełna; opus
- 2026-10-15 — scalona do `main` (PR #70, `ea74c3f`); in-review → done. Instrukcja dla biura (EVM-066) pozostaje otwarta — realizuje ją EVM-066 (`ready`)
