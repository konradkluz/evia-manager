---
id: EVM-147
title: "Wizja lokalna: API przyjmuje ofertę (dokument zlecenia) przed przypisaniem klienta; trwałe usuwanie dokumentów wizji i rejestr usunięć"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: in-progress
priority: P1
path: pelna             # dane osobowe (oferta zawiera dane zamawiającego), pliki, uprawnienia, retencja i trwałe usuwanie
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: opus             # zmiana wiążącej reguły ADR-0024 pkt 4 i rozszerzenie trwałego usuwania (EVM-139) o dokumenty
depends_on: [EVM-135, EVM-136, EVM-139]   # wszystkie done (zaakceptowane 2026-11-24); decyzja: ADR-0025 (zaakceptowany 2026-11-23)
---

# EVM-147: Wizja lokalna — oferta w API i usuwanie dokumentów wizji

## Cel
Jako **pracownik biura (Administrator, Edytor)** chcę **wgrać do wizji lokalnej ofertę/wycenę jeszcze przed przypisaniem klienta**, aby **komplet materiałów do wyceny był w jednym miejscu i przeszedł do zwykłego zlecenia po przypisaniu klienta**, a **oferta, której klient nie przyjął, znikała razem z wizją**. Dziś serwer odrzuca każdy dokument zlecenia bez klienta (`409 customer_required`, EVM-135 AC7, ADR-0024 pkt 4), a trwałe usuwanie wizji (EVM-139) dokumentów nie obejmuje — dlatego usuwanie jest warunkiem wgrywania (security H1). Panel: EVM-148; klauzula, karta, DPIA i rejestr: EVM-149.

## Kryteria akceptacji
Role: Administrator i Edytor — tak; Tylko odczyt — wizji nie widzi: odczyty (lista, pobranie, wyszukiwanie) `404` (jak EVM-135 AC4), zapisy (tworzenie, wersja, zmiana, usunięcie) `403 forbidden` (`404` tylko przy odczytach); niezalogowany — `401`; token mobilny — `403`. Decyzje techniczne: ADR-0025. Aplikacja mobilna poza zakresem.

**AC1 — Wgranie oferty do wizji**
- Zakładając otwartą wizję (zlecenie bez klienta w „Wycena” lub „Wstrzymane”) i Edytora lub Administratora
- Gdy tworzę dokument rodzaju `quote` (Oferta/wycena) przypięty do zlecenia
- Wtedy dokument powstaje i przechodzi skan jak przy zwykłym zleceniu (idempotencja, sesja wgrywania bez zmian); wpis w dzienniku zmian, audycie i logach nie zawiera tytułu, opisu, nazwy pliku ani adresu (test); macierz ról i IDOR (cudze `id`): A/E 2xx; Tylko odczyt — `404` przy odczytach (lista, link do pobrania), `403 forbidden` przy zapisach (tworzenie, wersja, aktualizacja); token mobilny `403`; niezalogowany `401`. Test kontraktu: odpowiedź `404` dla nieistniejącego `id`, zwykłego zlecenia i wizji niewidocznej dla Tylko odczyt jest identyczna (brak wycieku istnienia wizji).

**AC2 — Granice: kotwica, rodzaj, ZIP, płatności**
- Zakładając wizję bez klienta
- Gdy próbuję dodać dokument przypięty do lokalizacji lub klienta, dokument rodzaju innego niż `quote` (w tym `identity_data`), transzę płatności albo wyeksportować ZIP mediów
- Wtedy kotwica lokalizacji/klienta, transza i ZIP kończą się `409 customer_required`; rodzaj ≠ `quote` — `400 validation_failed` z błędem pola `/kindCode`, kod `requires_customer`; podniesienie klasy poufności do `identity_data` (`confidentialityOverride`, przy tworzeniu i zmianie) — `400` z `/confidentialityOverride`, `requires_customer` (podniesienie do `building_security` jest dozwolone); `400` bez wartości pola w odpowiedzi; nic się nie zapisuje; lista dozwolonych rodzajów jest jednym, rozszerzalnym miejscem; zamknięta lista blokad w teście (EVM-135 AC7 zawężone tylko o „dokument zlecenia rodzaju `quote`”).
- Kolejność sprawdzeń przy tworzeniu (test): zlecenie niewidoczne `404` → blokada zlecenia → struktura treści → `409 customer_required` dla kotwicy → `409 work_order_closed` → `400` pól.

**AC3 — Odczyt i zmiany dokumentu wizji**
- Zakładając dokument wizji
- Gdy Administrator lub Edytor go pobiera, zmienia opis, podmienia wersję lub usuwa (EVM-051)
- Wtedy działa jak przy zwykłym zleceniu, ale klasa poufności nie może zostać podniesiona do `identity_data` (`400`, `/confidentialityOverride`, jak w AC2); Tylko odczyt — `404` w każdym źródle odczytu (lista, pobranie, wyszukiwanie), `403` przy zmianie i usunięciu.

**AC4 — Przypisanie klienta, odrzucenie, przywrócenie**
- Zakładając wizję z dokumentami
- Gdy przypisuję klienta (EVM-136), odrzucam wizję albo ją przywracam
- Wtedy po przypisaniu dokumenty są dokumentami zwykłego zlecenia (te same `id`, wersje, klasy) i dalsze dokumenty mogą mieć każdy rodzaj; po odrzuceniu dokumenty zostają do 14 dni, tylko do odczytu (pobranie tak; tworzenie, wersja i zmiana — `409 work_order_closed`), bez eksportu; wyjątek do realizacji art. 17 RODO: `deleteDocument` (miękkie usunięcie) i `purgeDocumentFile` (trwałe usunięcie pliku — tylko Administrator, step-up, wpis w rejestrze usunięć) działają także w odrzuconej wizji; po przywróceniu dokumenty zostają, termin liczy EVM-136.

**AC5 — Trwałe usunięcie dokumentów razem z wizją (`enforce`)**
- Zakładając wizję bez klienta z dokumentem o dwóch wersjach (dane z testu — operacji „nowa wersja” w kodzie nie ma, dziś istnieje tylko wersja 1), `enforce` (EVM-139) i upłynięty termin (90 / 14 dni)
- Gdy działa zadanie usuwania
- Wtedy rejestr usunięć zawiera identyfikatory dokumentów (bez tytułów i nazw plików; błąd zapisu rejestru wstrzymuje usunięcie), a po usunięciu: obiekty wszystkich wersji i sesje wgrywania nie istnieją, tytuł jest neutralny, opis i nazwa pliku wyczyszczone, dokument oznaczony jako usunięty; lokalizacja wizji nie jest przez dokument blokowana przy anonimizacji; ponowne uruchomienie nie zmienia wyniku.
- `change_note` (ADR-0025 pkt 4) nie jest „wyczyszczone”, tylko zabezpieczone niezmiennikiem „zawsze `NULL`”: test potwierdza zapis `NULL`; kontrakt nie przyjmuje `change_note` (opis błędu odsyła do ADR-0025 pkt 4); przy niepustej wartości w jakiejkolwiek wersji usuwanie wizji przerywa się i alarmuje (log i alert bez treści, wizja zostaje); tryb `report` liczy takie naruszenia; w runbooku (`retencja.md`) jest krok postępowania na ten alarm.

**AC6 — Wyścig, `report`, przedłużenie, przypisanie klienta**
- Zakładając wizję z dokumentami
- Gdy dokument zostaje dodany w trakcie usuwania, zadanie działa w `report`, wizja zostaje przedłużona (EVM-140) albo klient zostaje przypisany
- Wtedy dokument dodany w trakcie przerywa usunięcie (`SurveyChangedDuringPurge`) i wizja jest usuwana w następnym przebiegu razem z nim; tworzenie dokumentu bierze blokadę zlecenia (`lockVisible`, `FOR NO KEY UPDATE`) — gdy usuwanie wygra wyścig, tworzenie czeka i dostaje `404` (test współbieżny); `report` liczy dokumenty (liczby, bez danych) i nic nie usuwa; przedłużenie nie zmienia dokumentów; po przypisaniu klienta zadanie ich nie rusza (test wyścigu „przypisanie ↔ usunięcie” obejmuje dokumenty).

**AC7 — Odtwarzanie rejestru i przypomnienie**
- Zakładając wpis rejestru usunięć z identyfikatorami dokumentów i przywrócenie bazy z kopii (EVM-062)
- Gdy narzędzie ponownie stosuje rejestr
- Wtedy dokumenty z rejestru są usuwane tak samo jak w AC5 (zmiana rejestru wyłącznie addytywna, stare wpisy bez dokumentów nadal działają); tekst e-maila z przypomnieniem o wygaśnięciu wizji wymienia dokumenty obok zdjęć i filmów.

**AC8 — Kontrakt i opisy**
- Zakładając kontrakt OpenAPI i `domain.md`
- Gdy sprawdzam opisy odpowiedzi `409` dokumentów i mediów oraz komentarze o kotwicy
- Wtedy mówią prawdę o nowej regule („dokument zlecenia rodzaju Oferta/wycena — tak; płatności i ZIP po przypisaniu klienta”), test kontraktu pokrywa odmowy z AC2 (w tym `400` z `/kindCode` i `/confidentialityOverride`), a `domain.md` zawiera regułę.

## Poza zakresem
Panel i komunikaty błędów (EVM-148); klauzula 1.1, karta A6, DPIA, `rodo.md`, rejestr i prawa osób (EVM-149); aplikacja mobilna; moduł ofert i generowanie ofert (decyzja 6: oferta to wgrany plik); dokumenty przypięte do lokalizacji lub klienta; inne rodzaje niż `quote` (lista rozszerzalna później); płatności i ZIP wizji; zmiana okresów 90 / 14 dni; nowa operacja „wersjonowanie dokumentu” (nie istnieje w kodzie; przyszła historyjka z warunkiem wiążącym ADR-0025 pkt 4: blokada wiersza i czyszczenie `change_note`); redakcja `change_note` przy zwykłym usuwaniu (EVM-051; luka → backlog); luka wyścigu dla mediów (EVM-139) — do backlogu, poza zakresem (propozycja osobnej historyjki w raporcie).

## Decyzje i ograniczenia
- Decyzje Konrada 2026-11-20: kotwica tylko „zlecenie” (site/customer nadal `409 customer_required`); wolno wyłącznie `quote`; dane zamawiającego w ofercie dozwolone (ostrzeżenie w panelu); dokumenty usuwane z wizją po 90 / 14 dniach; odrzucona wizja: do 14 dni, tylko odczyt, bez eksportu; ZIP i transze zablokowane; bez nowych ról; mobile poza zakresem; podział na EVM-147 / 148 / 149.
- **ADR-0025** (zaakceptowany przez Konrada 2026-11-23, po przeglądzie security; częściowo zastępuje pkt 4 i 9 ADR-0024): [adr/0025](../../architecture/adr/0025-dokumenty-wizji-lokalnej-przed-klientem.md). Rozstrzyga kod odmowy rodzaju (`400`), kolejność sprawdzeń, `change_note` i odrzuconą wizję.
- Dokumenty na wizji w produkcji (realne oferty) dopiero po EVM-147 i EVM-149 **oraz** włączonym `enforce` (EVM-139) — albo zaakceptowanym RR-102 z kartą przeglądu; do tego czasu zasada „tylko wizje testowe” (decyzja 16), a procedura ręczna `retencja.md` sekcja 5 obejmuje także dokumenty (M3: warunek realnych ofert).
- **Decyzje Konrada 2026-11-24 (plan):** (1) AC7 rozumiemy jako idempotentną operację modułu `media` „usuń dokumenty zlecenia o podanych `documentIds`”, wspólną z usuwaniem wizji (AC5); test integracyjny: zastosowanie `documentIds` z rejestru do stanu sprzed usunięcia daje wynik jak AC5, powtórzenie nic nie zmienia; czytnik rejestru i polecenie CLI zostają w EVM-084 (warunek `enforce`); (2) alarm niezmiennika `change_note` = istniejący alert `site_survey_purge_failed` (przyczyna `change_note_invariant` w logu i etykiecie licznika, bez treści; bez zmian w infra); (3) `documentIds` dopisane do białej listy wpisu `site_survey_purged` w `rejestr-usuniec.md` już w EVM-147 (pole opcjonalne).
- **Architekt (fakty z kodu):** jedyna blokada API to `create-document.service.ts:178-179` (`awaitsCustomer(order)` → `409`); zmiana na `awaitsCustomer(order) && anchor !== 'work_order'`. Sesja wgrywania, pobieranie, lista, edycja i wersje nie blokują. ZIP (`request-media-export.service.ts:111`) i transze (`create-milestone.service.ts:139`) zostają. Migracja niepotrzebna (0066 i triggery nie dotyczą `media.documents`; kotwica niezmienna 0059:70-76). Usuwanie: uczestnik `media` zbiera dziś tylko `media_assets` (`site-survey-purge.participant.ts:55-90`, `survey-purge-store.ts:11-33`, `deletion-register.ts:38-39`) — `identify` zwraca `documentIds` (`SurveyPurgeIdentity`, `site-survey-purge.job.ts:184-217`), rejestr dostaje opcjonalne `documentIds` (addytywnie), `erase`: blokada `FOR UPDATE` plików wszystkich wersji, `closeSessionsOf`, `markFilesErased`; `file_purged_at` przez `coalesce` (trigger 0062:56 pozwala raz); neutralny tytuł jak `markDocumentPurged` (`erasure-store.ts:148-161`), `description=null`, `deleted_at/deleted_by=created_by`; kolejność jak media (wpis rejestru w transakcji → oznaczenie → commit → abort multipart + `deleteObject documents/…/original` → `markObjectsErased`; `ErasureCompletionJob` działa na `stored_files`); narzędzie odtwarzania EVM-062 obsługuje `documentIds` (warunek `enforce`); tekst przypomnienia `site-survey-reminder.ts:45,51`. Testy do zmiany: `site-survey-blocks.test.ts:109-116`, `site-survey-contract.test.ts:184-203`; opisy: `components/media-responses.yaml:28`, `components/documents.yaml:54`, `paths/documents.yaml:79`; komentarze `document-anchor.ts:13,30`. Spike niepotrzebny.
- **Security (werdykt CHANGES REQUIRED → AC):** H1 → AC5, AC7; H2 → EVM-149; H3 (kotwica lokalizacji odpada: wyciek do Tylko odczyt, przeżywa usunięcie, blokuje anonimizację lokalizacji `survey-purge-store.ts:17-20`) → AC2. `document_versions` tylko insert (migracja 0059:152) — `change_note` dziś zawsze null (`document-store.ts:100`), mimo to zabezpieczony w AC5 (niezmiennik fail-closed). Medium: lista rodzajów (AC2, AC3), prawa osób i RR-102 (EVM-149). Low: brak tytułu w audycie/logach (AC1). Ryzyko rezydualne do akceptacji: usunięty dokument w starszych wersjach obiektów do 30 dni i w kopiach bazy do 37 dni (jak media).

## Otwarte pytania
Brak otwartych pytań — rozstrzygnięte: kod odmowy rodzaju (`400`, ADR-0025 pkt 2), ręczne usunięcie w odrzuconej wizji (wyjątek dla `deleteDocument` i `purgeDocumentFile` do art. 17, AC4), blokada techniczna (zasada organizacyjna bez przełącznika, ADR-0025 pkt 9).

## Notatki
Rozmiar M–L (nowy uczestnik purge dla dokumentów). Konsultacje wykonane: architekt (ADR-0025), security. Pozostałe luki do backlogu: redakcja `change_note` przy zwykłym usuwaniu EVM-051; luka wyścigu dla mediów (EVM-139) — nieobjęta tą historyjką; wersjonowanie dokumentu wizji (przyszła historyjka z warunkiem wiążącym ADR-0025 pkt 4).

## Dziennik
- 2026-11-20 — szkic na prośbę Konrada (product-owner)
- 2026-11-20 — przepisany po decyzjach Konrada i konsultacjach architekta i security: zakres „API + usuwanie”, podział na EVM-147/148/149 (product-owner)
- 2026-11-23 — uwzględniono ADR-0025 (zaakceptowany po przeglądzie security): `400` dla rodzaju i klasy, kolejność sprawdzeń, `403` dla Tylko odczyt przy zapisach, wyjątek art. 17 w odrzuconej wizji, niezmiennik `change_note`, warunek realnych ofert (product-owner)
- 2026-11-24 — zależności EVM-135, 136, 139 zaakceptowane (done); przegląd DoR: 8 AC (pełna), brak otwartych pytań; Konrad akceptuje; status `ready`
- 2026-11-24 — start realizacji (/deliver): gałąź `feature/EVM-147-oferta-w-wizji-lokalnej`, ścieżka `pelna`, wykonawca backend-developer (`opus`), recenzenci code-reviewer, security-engineer
- 2026-11-24 — plan gotowy (backend-developer)
- 2026-11-24 — plan blokował na AC7 i dwóch szczegółach; decyzje Konrada zapisane w „Decyzjach i ograniczeniach”; ponowne uruchomienie potoku
- 2026-11-24 — plan gotowy (backend-developer)
- 2026-11-24 — implementacja AC1–AC8 (kontrakt, domena, media, usuwanie dokumentów z wizją, rejestr `documentIds`, runbooki); bramka lokalna i testy integracyjne w kontenerze zielone (backend-developer)
