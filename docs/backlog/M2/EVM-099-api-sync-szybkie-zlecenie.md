---
id: EVM-099
title: "API: wysyłanie szybkiego zlecenia (CreateQuickWorkOrder)"
type: story
milestone: M2
epic: E13 Nowe zlecenie z telefonu
status: in-progress
priority: P1
path: pelna             # synchronizacja offline, dane osobowe, uprawnienia
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-098]
---

# EVM-099: API — szybkie zlecenie z telefonu (`CreateQuickWorkOrder`)

## Cel
Jako **technik** chcę **założyć zlecenie z telefonu (klient + adres + szablon) także bez zasięgu**, aby **zacząć dokumentację od razu na miejscu**, a jako **biuro** chcę **zobaczyć, że zlecenie powstało w terenie, i uzupełnić jego dane**. Komenda `CreateQuickWorkOrder` z [`offline-sync.md`](../../architecture/offline-sync.md) (tabela „Komendy mobilne MVP”), przepływ [`10-mobile-szybkie-zlecenie.md`](../../ux/flows/10-mobile-szybkie-zlecenie.md), scenariusz A1′. Wysyłka, partie, idempotencja po `mutation_id` i autoryzacja żądania są z EVM-098 (ta sama operacja `POST /api/v1/sync/mutations`); tu dochodzi trzeci typ komendy. Kształt komendy jest już w kontrakcie (EVM-090: `CreateQuickWorkOrderPayload`, `SyncNewCustomer`, `SyncNewSite`).

## Kryteria akceptacji

**AC1 — Utworzenie zlecenia z istniejącym klientem i lokalizacją**
- Zakładając Edytora z zarejestrowanym urządzeniem, aktywny szablon oraz istniejącego, nieusuniętego i niezanonimizowanego klienta i lokalizację
- Gdy przychodzi `CreateQuickWorkOrder` z `workOrderId`, `templateId`, `title` (1–200 znaków), `customerId`, `siteId` i opcjonalną `note` (≤ 2000 znaków)
- Wtedy w jednej transakcji powstaje zlecenie w stanie „Nowe” z kompozycją wg szablonu (pozycje zakresu, procesy, etapy i plan płatności — ten sam przypadek użycia co `CreateWorkOrder` z panelu, [`domain-model.md`](../../architecture/domain-model.md#kompozycja-zlecenia-z-szablonu)), `origin = mobile_quick`, numerem z rocznego licznika nadanym przez serwer i zapisanym urządzeniem (`created_via_device_id`); wynik to `applied` z `workOrderNumber` (np. `ZL-2026-0042`); `note` staje się pierwszym wpisem dziennika zlecenia (rodzaj `note`, kategoria `other`, autor z sesji) w tej samej transakcji; powstają wpis dziennika `work_order_created`, zdarzenie audytu (identyfikatory i kody, bez nazw, telefonu i treści) oraz wiersze dziennika zmian (wyzwalacz z EVM-096), a zlecenie jest widoczne w panelu i w kolejnym pobraniu zmian.

**AC2 — Nowy klient i nowa lokalizacja**
- Zakładając komendę z `newCustomer` zamiast `customerId` i/lub `newSite` zamiast `siteId` (identyfikatory UUIDv7 nadane na telefonie)
- Gdy komenda dociera
- Wtedy w tej samej transakcji powstają nowy klient i/lub lokalizacja wyłącznie z pól komendy: klient — `kind` (osoba / firma), `displayName` (1–200 znaków) i telefon; lokalizacja — `siteType`, ulica, numer budynku, opcjonalnie numer lokalu i numer miejsca postojowego, kod pocztowy `NN-NNN`, miasto; telefon jest normalizowany do E.164 tak samo jak w panelu (zapis krajowy 9 cyfr, `+48`, `0048`, spacje i myślniki), a dla osoby `displayName` jest dzielone po ostatniej spacji na imię (wszystko przed) i nazwisko (ostatni wyraz) — pojedynczy wyraz daje `rejected: validation_failed`; pozostałe pola klienta i lokalizacji (e-mail, NIP, adres korespondencyjny, notatki, OSD, zarządca, moc, PPE) pozostają puste, a klient i lokalizacja mają zapisane `created_via_device_id`; obiekt istniejący może być połączony z nowym (np. `customerId` + `newSite`).

**AC3 — Duplikaty klientów i lokalizacji**
- Zakładając, że w bazie jest już klient o tym samym telefonie i tej samej nazwie (albo lokalizacja o tym samym adresie)
- Gdy przychodzi komenda z `newCustomer` / `newSite` o nowych identyfikatorach
- Wtedy serwer tworzy osobnego klienta i/lub lokalizację bez ostrzeżenia, bez łączenia i bez zmiany istniejących (deduplikacja i scalanie — poza v1; podpowiedź istniejących klientów jest lokalna w EVM-106), a dwie komendy z tym samym telefonem w jednej partii dają dwóch klientów.

**AC4 — Tylko INSERT i atomowość**
- Zakładając identyfikator zlecenia, nowego klienta lub nowej lokalizacji, który już istnieje (także cudzy, usunięty lub zanonimizowany), albo dwa takie same identyfikatory w jednej komendzie
- Gdy komenda dociera po raz pierwszy (nowy `mutation_id`)
- Wtedy wynik to `conflict` z kodem `id_conflict` (jak w EVM-098: nigdy upsert, bez ujawnienia obiektu), a w bazie nie zmienia się nic — także dla pozostałych identyfikatorów komendy; test sprawdza każdy z trzech identyfikatorów osobno i obejmuje cudze obiekty.

**AC5 — Walidacja, szablon i cele**
- Zakładając szablon nieaktywny, usunięty lub taki, którego kompozycji nie da się zastosować (m.in. plan płatności dłuższy niż 20 transz); nieistniejącego, usuniętego lub zanonimizowanego klienta/lokalizację z `customerId` / `siteId`; brak jednego z pary (`customerId` albo `newCustomer`, `siteId` albo `newSite` — dokładnie jedno z pary); zły format telefonu; nieznaną `commandVersion`
- Gdy komenda dociera
- Wtedy wynik to odpowiednio `rejected: template_unavailable` / `target_unavailable` / `validation_failed`, bez żadnych częściowych zapisów (ani klienta, ani lokalizacji, ani zlecenia, ani licznika numerów — numer nie jest „zużywany”); brak dostępu do istniejącego klienta lub lokalizacji daje ten sam wynik `target_unavailable` co brak obiektu (bez ujawnienia istnienia); błędy walidacji wskazują pole i kod, nigdy wartość (np. numer telefonu).

**AC6 — Idempotencja i zależności**
- Zakładając powtórkę komendy (ten sam `mutation_id`, użytkownik i urządzenie) albo wpisy czekające na to zlecenie
- Gdy dociera ponownie
- Wtedy ta sama treść daje `duplicate` z tym samym `workOrderNumber` (bez nowego numeru, klienta i lokalizacji), inna treść `rejected: idempotency_mismatch`, a po wygaśnięciu rekordu idempotencji (> 30 dni) ponowienie zlecenia utworzonego przez tego samego użytkownika **i** to samo urządzenie (`created_via_device_id`) daje `duplicate` z ostrzeżeniem `idempotency_expired`, w pozostałych przypadkach `id_conflict` (reguły jak w EVM-098); wpis lub komentarz do zlecenia, którego komenda jeszcze nie została zastosowana (albo została odrzucona), dostaje `target_unavailable` (zależności w kolejce pilnuje telefon — EVM-091), a po `applied` w tej samej lub późniejszej partii są przyjmowane normalnie (test integracyjny z mutacjami z EVM-098).

**AC7 — Limit nowych klientów i lokalizacji na urządzenie**
- Zakładając urządzenie, które w ciągu ostatnich 24 godzin (okno kroczące) utworzyło 20 nowych klientów albo 20 nowych lokalizacji (liczone z `created_via_device_id`; obie liczby niezależnie)
- Gdy przychodzi kolejna nowa komenda z `newCustomer` / `newSite` odpowiednio dla przekroczonego limitu
- Wtedy wynik to `rejected: quota_exceeded` (nowy kod w katalogu kontraktu, słownik otwarty) bez żadnego zapisu, a operator dostaje alert (metryka z licznikiem przekroczeń per urządzenie, bez danych osobowych) i zdarzenie audytu; komendy z istniejącym klientem i lokalizacją oraz `duplicate` nie są limitowane ani liczone; limit jest stałą w kodzie (20 / 24 h), nie konfiguracją.

**AC8 — Uprawnienia i oznaczenie w panelu**
- Zakładając role Administrator, Edytor, Tylko odczyt, niezalogowany oraz urządzenie do wyczyszczenia, a w panelu zlecenie z `origin = mobile_quick` w stanie „Nowe”
- Gdy wysyłają komendę, a biuro otwiera W-06
- Wtedy Administrator i Edytor tworzą zlecenie, Tylko odczyt dostaje `403 channel_not_allowed`, niezalogowany `401`, urządzenie do wyczyszczenia `401 device_wipe_required` dla całej partii (jak w EVM-098), a macierz ról obejmuje IDOR (cudze `workOrderId`, `customerId`, `siteId`, `templateId` bez dostępu); szczegół zlecenia zwraca dodatkowo pola tylko do odczytu `origin` oraz nazwę autora (`displayName`) i czas utworzenia, a W-06 pokazuje baner „Zlecenie założone w terenie (autor, data). Uzupełnij dane: klienta · lokalizacji · kwoty transz” z odnośnikami do akcji [wg specyfikacji W-06](../../ux/flows/03-szczegoly-zlecenia.md#w-06-szczegóły-zlecenia) (Administrator i Edytor; Tylko odczyt widzi sam pierwszy wiersz); baner znika po pierwszym przejściu zlecenia ze stanu „Nowe” i nie występuje dla zleceń z panelu (`origin = office`).

## Poza zakresem
Podpowiedź duplikatów klientów po stronie biura i telefonu (EVM-106) oraz deduplikacja i scalanie klientów na serwerze (poza v1); media do nowego zlecenia (E11, EVM-111); edycje zlecenia, klienta i lokalizacji z telefonu (po MVP); osobny znacznik „klient założony w terenie” na liście klientów (W-14) — baner z odnośnikiem do klienta wystarcza; ekran telefonu M-10 (EVM-106); retencja rekordów idempotencji (EVM-079).

## Decyzje i ograniczenia
- Serwer nie odrzuca „podobnych” klientów (wyszukiwanie lokalne w EVM-106; README planu, decyzja 15).
- Zmiana kontraktu w tej historyjce (tor A, razem z kodem): kod `quota_exceeded` w katalogu odrzuceń, pola `origin`, autor i czas utworzenia w szczegółach zlecenia (tylko do odczytu). Telefon traktuje nieznany kod jak ogólny „Wymaga uwagi” (słownik otwarty).
- Kolumny `origin` (zlecenie: `office` | `mobile_quick`, istniejące zlecenia = `office`) i `created_via_device_id` (zlecenie, klient, lokalizacja; puste dla panelu) wymagają migracji — numeracja migracji z torem A (README planu).
- Komenda wywołuje przypadek użycia kompozycji z `work-orders` oraz fasady `customers` i `sites` (bez zapytań do ich tabel); ten sam kod tworzenia co `CreateWorkOrder` z panelu — bez drugiej ścieżki kompozycji.
- Bezpieczeństwo i prywatność: `newCustomer` przyjmuje tylko rodzaj, nazwę i telefon (minimalizacja; schemat `additionalProperties: false`, pola serwera odrzucane — mass assignment, AB-13); telefon, nazwa i adres nie trafiają do logów, audytu ani dziennika zmian; limit z AC7 ogranicza masowe zakładanie klientów ze skradzionego lub zainfekowanego telefonu; odpowiedzi `Cache-Control: no-store`.
- Dane testowe wyłącznie syntetyczne (np. „Jan Przykładowy”, numer 600 000 001, ul. Fikcyjna).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
- 2026-10-29 — doprecyzowanie do DoR (product-owner): 8 AC (osobne: duplikaty, atomowość, limit), poprawiony baner (W-06, nie W-09; znika po opuszczeniu stanu „Nowe”), konkretny limit 20 / 24 h i kod `quota_exceeded`, reguła podziału nazwy osoby, kierunek `note`, recenzent solution-architect
- 2026-10-29 — zaakceptowano przez Konrada: AC1–8 w całości (bez podziału); nazwa osoby jednym wyrazem odrzucana; limit 20 nowych klientów i lokalizacji/24 h blokuje (quota_exceeded, drobny dodatek do katalogu kodów kontraktu EVM-090 z przeglądem architekta); note jako pierwszy wpis dziennika; baner na W-06 bez osobnego znacznika klienta; kolizja id jako outcome conflict; status ready
- 2026-10-31 — plan gotowy (backend-developer)
- 2026-10-31 — implementacja backendu (backend-developer): migracja 0058, wspólny WorkOrderComposer, komenda CreateQuickWorkOrder z limitem 20 / 24 h, kontrakt (quota_exceeded, errors[], origin w szczególe), dokumentacja; baner W-06 (web) czeka na web-developera
