---
id: EVM-147
title: "Wizja lokalna: API przyjmuje ofertę (dokument zlecenia) przed przypisaniem klienta; trwałe usuwanie dokumentów wizji i rejestr usunięć"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # dane osobowe (oferta zawiera dane zamawiającego), pliki, uprawnienia, retencja i trwałe usuwanie
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer]
model: opus             # zmiana wiążącej reguły ADR-0024 pkt 4 i rozszerzenie trwałego usuwania (EVM-139) o dokumenty
depends_on: [EVM-135, EVM-136, EVM-139]   # wszystkie w in-review: DoR wymaga done (scalenie wspólnego PR); dodatkowo ADR-0025 zaakceptowany przez Konrada przed kodem (treść: osobne /adr)
---

# EVM-147: Wizja lokalna — oferta w API i usuwanie dokumentów wizji

## Cel
Jako **pracownik biura (Administrator, Edytor)** chcę **wgrać do wizji lokalnej ofertę/wycenę jeszcze przed przypisaniem klienta**, aby **komplet materiałów do wyceny był w jednym miejscu i przeszedł do zwykłego zlecenia po przypisaniu klienta**, a **oferta, której klient nie przyjął, znikała razem z wizją**. Dziś serwer odrzuca każdy dokument zlecenia bez klienta (`409 customer_required`, EVM-135 AC7, ADR-0024 pkt 4), a trwałe usuwanie wizji (EVM-139) dokumentów nie obejmuje — dlatego usuwanie jest warunkiem wgrywania (security H1). Panel: EVM-148; klauzula, karta, DPIA i rejestr: EVM-149.

## Kryteria akceptacji
Role: Administrator i Edytor — tak; Tylko odczyt — wizji nie widzi (`404`, jak EVM-135 AC4); niezalogowany — `401`; token mobilny — `403`. Aplikacja mobilna poza zakresem.

**AC1 — Wgranie oferty do wizji**
- Zakładając otwartą wizję (zlecenie bez klienta w „Wycena” lub „Wstrzymane”) i Edytora lub Administratora
- Gdy tworzę dokument rodzaju `quote` (Oferta/wycena) przypięty do zlecenia
- Wtedy dokument powstaje i przechodzi skan jak przy zwykłym zleceniu (idempotencja, sesja wgrywania bez zmian); wpis w dzienniku zmian, audycie i logach nie zawiera tytułu, opisu, nazwy pliku ani adresu (test); macierz ról i IDOR (cudze `id`): A/E 2xx, Tylko odczyt `404`, token mobilny `403`, niezalogowany `401` — dla tworzenia, wersji, aktualizacji, listy i linku do pobrania.

**AC2 — Granice: kotwica, rodzaj, ZIP, płatności**
- Zakładając wizję bez klienta
- Gdy próbuję dodać dokument przypięty do lokalizacji lub klienta, dokument rodzaju innego niż `quote` (w tym `identity_data`), transzę płatności albo wyeksportować ZIP mediów
- Wtedy kotwica lokalizacji/klienta i transza oraz ZIP kończą się `409 customer_required`, rodzaj ≠ `quote` odmową walidacji (kod w kontrakcie wg architekta), nic się nie zapisuje; lista dozwolonych rodzajów jest jednym, rozszerzalnym miejscem; zamknięta lista blokad w teście (EVM-135 AC7 zawężone tylko o „dokument zlecenia rodzaju `quote`”).

**AC3 — Odczyt i zmiany dokumentu wizji**
- Zakładając dokument wizji
- Gdy Administrator lub Edytor go pobiera, zmienia opis, podmienia wersję lub usuwa (EVM-051)
- Wtedy działa jak przy zwykłym zleceniu, ale rodzaj i klasa poufności nie mogą wyjść poza dozwolony rodzaj (brak podnoszenia na `identity_data`, odmowa); Tylko odczyt — `404` w każdym źródle (lista, pobranie, wyszukiwanie).

**AC4 — Przypisanie klienta, odrzucenie, przywrócenie**
- Zakładając wizję z dokumentami
- Gdy przypisuję klienta (EVM-136), odrzucam wizję albo ją przywracam
- Wtedy po przypisaniu dokumenty są dokumentami zwykłego zlecenia (te same `id`, wersje, klasy) i dalsze dokumenty mogą mieć każdy rodzaj; po odrzuceniu dokumenty zostają do 14 dni, tylko do odczytu (pobranie tak; tworzenie, wersja, zmiana, usunięcie — odmowa), bez eksportu; po przywróceniu zostają, termin liczy EVM-136.

**AC5 — Trwałe usunięcie dokumentów razem z wizją (`enforce`)**
- Zakładając wizję bez klienta z dokumentem o dwóch wersjach, `enforce` (EVM-139) i upłynięty termin (90 / 14 dni)
- Gdy działa zadanie usuwania
- Wtedy rejestr usunięć zawiera identyfikatory dokumentów (bez tytułów i nazw plików; błąd zapisu rejestru wstrzymuje usunięcie), a po usunięciu: obiekty wszystkich wersji i sesje wgrywania nie istnieją, tytuł jest neutralny, opis, nazwa pliku i `change_note` wyczyszczone (także w wersjach), dokument oznaczony jako usunięty; lokalizacja wizji nie jest przez dokument blokowana przy anonimizacji; ponowne uruchomienie nie zmienia wyniku.

**AC6 — Wyścig, `report`, przedłużenie, przypisanie klienta**
- Zakładając wizję z dokumentami
- Gdy dokument zostaje dodany w trakcie usuwania, zadanie działa w `report`, wizja zostaje przedłużona (EVM-140) albo klient zostaje przypisany
- Wtedy dokument dodany w trakcie przerywa usunięcie (`SurveyChangedDuringPurge`) i wizja jest usuwana w następnym przebiegu razem z nim; `report` liczy dokumenty (liczby, bez danych) i nic nie usuwa; przedłużenie nie zmienia dokumentów; po przypisaniu klienta zadanie ich nie rusza (test wyścigu „przypisanie ↔ usunięcie” obejmuje dokumenty).

**AC7 — Odtwarzanie rejestru i przypomnienie**
- Zakładając wpis rejestru usunięć z identyfikatorami dokumentów i przywrócenie bazy z kopii (EVM-062)
- Gdy narzędzie ponownie stosuje rejestr
- Wtedy dokumenty z rejestru są usuwane tak samo jak w AC5 (zmiana rejestru wyłącznie addytywna, stare wpisy bez dokumentów nadal działają); tekst e-maila z przypomnieniem o wygaśnięciu wizji wymienia dokumenty obok zdjęć i filmów.

**AC8 — Kontrakt i opisy**
- Zakładając kontrakt OpenAPI i `domain.md`
- Gdy sprawdzam opisy odpowiedzi `409` dokumentów i mediów oraz komentarze o kotwicy
- Wtedy mówią prawdę o nowej regule („dokument zlecenia rodzaju Oferta/wycena — tak; płatności i ZIP po przypisaniu klienta”), test kontraktu pokrywa odmowy z AC2, a `domain.md` zawiera regułę.

## Poza zakresem
Panel i komunikaty błędów (EVM-148); klauzula 1.1, karta A6, DPIA, `rodo.md`, rejestr i prawa osób (EVM-149); aplikacja mobilna; moduł ofert i generowanie ofert (decyzja 6: oferta to wgrany plik); dokumenty przypięte do lokalizacji lub klienta; inne rodzaje niż `quote` (lista rozszerzalna później); płatności i ZIP wizji; zmiana okresów 90 / 14 dni; ręczne usuwanie dokumentu odrzuconej wizji (pytanie 2); redakcja `change_note` przy zwykłym usuwaniu (EVM-051; luka → backlog).

## Decyzje i ograniczenia
- Decyzje Konrada 2026-11-20: kotwica tylko „zlecenie” (site/customer nadal `409 customer_required`); wolno wyłącznie `quote`; dane zamawiającego w ofercie dozwolone (ostrzeżenie w panelu); dokumenty usuwane z wizją po 90 / 14 dniach; odrzucona wizja: do 14 dni, tylko odczyt, bez eksportu; ZIP i transze zablokowane; bez nowych ról; mobile poza zakresem; podział na EVM-147 / 148 / 149.
- **ADR-0025** (częściowo zastępuje pkt 4 i 9 ADR-0024, wzorzec jak adr/0011) musi być zaakceptowany przez Konrada przed kodem — treść przygotuje osobne `/adr`.
- Dokumenty na wizji w produkcji (realne oferty) dopiero po EVM-147 i EVM-149; do tego czasu zasada „tylko wizje testowe” (decyzja 16).
- **Architekt (fakty z kodu):** jedyna blokada API to `create-document.service.ts:178-179` (`awaitsCustomer(order)` → `409`); zmiana na `awaitsCustomer(order) && anchor !== 'work_order'`. Sesja wgrywania, pobieranie, lista, edycja i wersje nie blokują. ZIP (`request-media-export.service.ts:111`) i transze (`create-milestone.service.ts:139`) zostają. Migracja niepotrzebna (0066 i triggery nie dotyczą `media.documents`; kotwica niezmienna 0059:70-76). Usuwanie: uczestnik `media` zbiera dziś tylko `media_assets` (`site-survey-purge.participant.ts:55-90`, `survey-purge-store.ts:11-33`, `deletion-register.ts:38-39`) — `identify` zwraca `documentIds` (`SurveyPurgeIdentity`, `site-survey-purge.job.ts:184-217`), rejestr dostaje opcjonalne `documentIds` (addytywnie), `erase`: blokada `FOR UPDATE` plików wszystkich wersji, `closeSessionsOf`, `markFilesErased`; `file_purged_at` przez `coalesce` (trigger 0062:56 pozwala raz); neutralny tytuł jak `markDocumentPurged` (`erasure-store.ts:148-161`), `description=null`, `deleted_at/deleted_by=created_by`; kolejność jak media (wpis rejestru w transakcji → oznaczenie → commit → abort multipart + `deleteObject documents/…/original` → `markObjectsErased`; `ErasureCompletionJob` działa na `stored_files`); narzędzie odtwarzania EVM-062 obsługuje `documentIds` (warunek `enforce`); tekst przypomnienia `site-survey-reminder.ts:45,51`. Testy do zmiany: `site-survey-blocks.test.ts:109-116`, `site-survey-contract.test.ts:184-203`; opisy: `components/media-responses.yaml:28`, `components/documents.yaml:54`, `paths/documents.yaml:79`; komentarze `document-anchor.ts:13,30`. Spike niepotrzebny.
- **Security (werdykt CHANGES REQUIRED → AC):** H1 → AC5, AC7; H2 → EVM-149; H3 (kotwica lokalizacji odpada: wyciek do Tylko odczyt, przeżywa usunięcie, blokuje anonimizację lokalizacji `survey-purge-store.ts:17-20`) → AC2. `document_versions` tylko insert (migracja 0059:152) — `change_note` dziś zawsze null (`document-store.ts:100`), mimo to czyszczony w AC5. Medium: lista rodzajów (AC2, AC3), prawa osób i RR-102 (EVM-149). Low: brak tytułu w audycie/logach (AC1). Ryzyko rezydualne do akceptacji: usunięty dokument w starszych wersjach obiektów do 30 dni i w kopiach bazy do 37 dni (jak media).

## Otwarte pytania (dla Konrada, rekomendacja pierwsza)
1. **Kod odmowy dla rodzaju ≠ `quote`:** zwykły błąd walidacji (rek.; architekt potwierdzi w ADR-0025/kontrakcie) czy `409`. Konsekwencja: tylko kontrakt i komunikat w panelu.
2. **Ręczne usunięcie dokumentu odrzuconej wizji** (przed 14 dniami): poza zakresem (rek. — wizja jest tylko do odczytu, dokument i tak znika w 14 dni; prawo do usunięcia obsługuje procedura praw osób z EVM-149) czy dodać. Konsekwencja „dodać”: nowy wyjątek od „tylko do odczytu” i dodatkowe AC.
3. **Blokada techniczna wgrywania do czasu EVM-149:** zasada organizacyjna jak decyzja 16 (rek., YAGNI) czy przełącznik funkcji. Konsekwencja: przy samej zasadzie API przyjmie ofertę do wizji testowej od scalenia.

## Notatki
Rozmiar M–L (nowy uczestnik purge dla dokumentów). Konsultacje wykonane: architekt, security. Pozostałe luki do backlogu: redakcja `change_note` przy zwykłym usuwaniu EVM-051.

## Dziennik
- 2026-11-20 — szkic na prośbę Konrada (product-owner)
- 2026-11-20 — przepisany po decyzjach Konrada i konsultacjach architekta i security: zakres „API + usuwanie”, podział na EVM-147/148/149 (product-owner)
