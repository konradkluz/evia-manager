# Synchronizacja offline — szkic

> Dokument żywy. Właściciel: `solution-architect` (recenzja: `mobile-developer`, `security-engineer`). Stan: **szkic z EVM-002** — zasady, komendy mobilne MVP i zakres synchronizacji. Wnioski ze spike'a EVM-011 w części uploadu plików na Androidzie (emulator; iOS odłożony, ADR-0015; telefon czeka na ręczną weryfikację Konrada) są w sekcji „Wnioski ze spike'a EVM-011” na końcu; szczegóły protokołu z epików E10–E13 uzupełnią go przed M2. Decyzja: [ADR-0008](adr/0008-synchronizacja-offline.md) — ten dokument jej **nie zmienia**, tylko doprecyzowuje. Model encji i tabela gotowości offline: [`domain-model.md`](domain-model.md#gotowość-offline). Upload plików: [ADR-0009](adr/0009-storage-i-przetwarzanie-mediow.md) i [`media-pipeline.md`](media-pipeline.md) (wnioski ze spike'a EVM-011, Android).

## Zakres
- **Dane i metadane** (wpisy, komentarze, metadane mediów, szybkie zlecenia, dane zleceń do przeglądania) — kolejka mutacji (push) i kanał zmian z kursorem (pull).
- **Pliki** (zdjęcia, filmy) — osobny kanał: sesja uploadu i S3 multipart z podpisanymi URL-ami (ADR-0009). Tu tylko zależności kolejki.
- **Poza zakresem szkicu:** schemat lokalnej bazy (EVM-009), UI listy „Wymaga uwagi” (E10–E13), wartości liczbowe do pomiaru w EVM-011.

## Zasady
### 1. Identyfikatory nadawane po stronie klienta
- Obiekty tworzone na telefonie dostają **UUIDv7 na urządzeniu**: `TimelineEntry` (`CreateNote`, `CreateComment`), `MediaAsset` (`CreateMediaAsset`), `UploadSession`, a w `CreateQuickWorkOrder` — `WorkOrder` oraz nowy `Customer` i nowa `Site`. Każda mutacja ma też własny `mutation_id` (UUIDv7).
- Serwer waliduje format (wersja 7, wariant RFC 9562), unikalność i **uprawnienia**. Identyfikator nie jest sekretem ani dowodem dostępu (CWE-639).
- **Komendy `Create*` wykonują wyłącznie `INSERT`.** Istniejący identyfikator — także cudzego lub usuniętego obiektu — daje `rejected: id_conflict`, **nigdy upsert** (CWE-915). Duplikat własnej mutacji rozpoznajemy po `mutation_id` (zasada 5), nie po istnieniu obiektu. Dotyczy zwłaszcza `CreateQuickWorkOrder` (trzy identyfikatory w jednej komendzie).
- Składnik czasu w UUIDv7 pochodzi z zegara telefonu — nie służy do kolejności ani audytu.

### 2. Soft delete i znaczniki usunięcia
- Usuwanie danych domenowych odbywa się wyłącznie na serwerze (soft delete, trwałe usunięcie, anonimizacja — [`domain-model.md`](domain-model.md#usuwanie-danych)); telefon w MVP niczego nie usuwa.
- Każde usunięcie trafia do dziennika zmian jako operacja `delete` (**znacznik usunięcia**): typ i identyfikator obiektu, kotwica — **bez danych osobowych**. Urządzenie usuwa lokalną kopię obiektu (i obiektów podrzędnych przez kotwicę) — **z wyjątkiem obiektów lokalnych oczekujących** (następny punkt).
- **Obiekty lokalne oczekujące należą do kolejki, nie do danych domenowych.** Są to obiekty utworzone na urządzeniu, których mutacja nie ma jeszcze wyniku `applied` lub `duplicate` (wpisy, komentarze, `MediaAsset`, szybkie zlecenie z nowym klientem i nową lokalizacją), oraz **pliki oryginałów** do potwierdzenia przez serwer (rekomendacja: stan `clean` lub późniejszy — [punkt 7](#otwarte--evm-011)). Znacznik usunięcia, resync (także kontrolny) i wyjście z zakresu **ich nie usuwają**. Pozostają widoczne w UI (oznaczone jako oczekujące) do wyniku mutacji; przy `rejected` trafiają **razem z plikiem** na listę „Wymaga uwagi”. Wyjątek: unieważnienie sesji lub urządzenia — otwarte ([punkt 1](#otwarte--evm-011)).
- Gdy obiekt nadrzędny zniknął z urządzenia (np. zlecenie usunięte w biurze albo poza zakresem), obiekt oczekujący zostaje na liście oczekujących — bez danych obiektu nadrzędnego. Po `rejected: target_unavailable` albo `forbidden` przechodzi na „Wymaga uwagi”. Sesja uploadu do usuniętego lub niedostępnego obiektu kończy się błędem (`404` / `403`): plik trafia na „Wymaga uwagi”, nie jest kasowany. Rozdzielenie repliki i obiektów oczekujących w lokalnej bazie — EVM-009.
- Mutacja z kolejki wskazująca usunięty obiekt docelowy daje `rejected: target_unavailable`; dane zostają na urządzeniu na liście **„Wymaga uwagi”** (ADR-0008).
- Retencja znaczników: 90 dni (jak dziennik zmian); starszy kursor → `resync_required`.

### 3. Wersjonowanie i dziennik zmian
- Każdy wiersz ma `version` (od 1, zwiększany przy każdej zmianie, także serwerowej). W pobieranych danych służy jako `base_version` dla przyszłych edycji z telefonu i jako `ETag` w API.
- **Dziennik zmian** `sync.change_log` (`SyncChange`): monotoniczny `seq`, `txid` (`xid8` = `pg_current_xact_id()`), `entity_type`, `entity_id`, `operation` (`upsert` / `delete`), `work_order_id` (kotwica do filtrowania zakresu; pusta dla [encji bez kotwicy zlecenia](#zakres-synchronizacji-urządzenia)), `recorded_at`. Zapis **w tej samej transakcji** co zmiana — generyczny trigger na tabelach objętych synchronizacją (moduły domenowe nie zależą od `sync`; alternatywa — otwarte dla EVM-011).
- **Kursor** — nieprzezroczysty token (szyfrowany i uwierzytelniony kluczem serwera) z **pozycją w dzienniku zmian: parą (`txid`, `seq`)** ostatniego odczytanego wiersza i czasem wydania (kursor starszy niż retencja → `resync_required`). Kursor jest powiązany z parą **użytkownik + urządzenie**; kursor innej pary jest odrzucany. Nie zawiera danych osobowych.
- **Bezpieczny horyzont i kolejność odczytu** (ADR-0008). Serwer czyta wyłącznie wiersze z `txid` < `pg_snapshot_xmin(pg_current_snapshot())`. Wszystkie transakcje o niższym `txid` są już zakończone, więc poniżej horyzontu nie pojawi się żaden nowy wiersz. Wiersze idą w kolejności (`txid`, `seq`) od pozycji kursora:
  `WHERE (txid, seq) > (:txid, :seq) AND txid < pg_snapshot_xmin(pg_current_snapshot()) ORDER BY txid, seq LIMIT :limit`, z indeksem (`txid`, `seq`).
  Nowy kursor to para z ostatniego **odczytanego** wiersza dziennika — także wtedy, gdy filtr zakresu i polityk nie przekazał go temu urządzeniu. Gdy poniżej horyzontu nie ma nowych wierszy, pozycja się nie zmienia. `seq` porządkuje zmiany w obrębie jednej transakcji i rozstrzyga remisy przy stronicowaniu.
- **Kursor z samym `seq` gubi zmiany.** `seq` nadaje sekwencja w chwili zapisu do dziennika, a `txid` — pierwszy zapis transakcji. Transakcja z niższym `txid` może dopisać do dziennika później (wyższy `seq`) i zatwierdzić się wcześniej niż transakcja z wyższym `txid` i niższym `seq`. Odczyt „po `seq` do pierwszego wiersza z `txid` ≥ horyzont” przesunąłby wtedy kursor za niezatwierdzony jeszcze wiersz, a zmiana (także znacznik usunięcia) zginęłaby po cichu do kontrolnego resyncu. Przypadek testowy — [scenariusz 6](#scenariusze-testowe-nic-nie-ginie-evm-011-e10e13).
- Długa transakcja zapisująca wstrzymuje horyzont: opóźnia pobieranie zmian, ale ich nie gubi ([punkt 5](#otwarte--evm-011)).
- Dla operacji `upsert` serwer zwraca **bieżący stan** obiektu w projekcji dla urządzenia (kilka zmian jednego obiektu na stronie = jeden stan), z `version`.
- **Stan pliku:** `StoredFile` nie jest synchronizowany osobno. Zmiana jego stanu (i podsumowania: rozmiar, wymiary, czas trwania) zapisuje w dzienniku zmian, w tej samej transakcji, `upsert` **właściciela** — `MediaAsset` albo `DocumentVersion` (jedna reguła dla obu). Na telefonie stan pliku niesie projekcja `MediaAsset` ([projekcja](#zakres-synchronizacji-urządzenia)); pliki dokumentów są dostępne tylko online. `version` właściciela się nie zmienia, bo stan pliku nie jest polem edytowalnym i nie blokuje edycji metadanych przez `If-Match`. Sposób zapisu — [punkt 5](#otwarte--evm-011).

### 4. Append-only dla danych z terenu
- Dane z terenu w MVP to wyłącznie **tworzenie**: wpisy, komentarze, media (metadane + plik), szybkie zlecenie. **Zero edycji pól współdzielonych** → w MVP konflikty nie występują.
- Korekta wpisu = nowy wpis z `supersedesEntryId` (w MVP tworzony w panelu). Kolejność w dzienniku zlecenia wg **czasu serwera** (`created_at`, w ADR-0008 `received_at`).
- `capturedAt` (zegar telefonu) to tylko metadana z walidowanym zakresem (propozycja: od 60 dni wstecz do 10 min w przód względem czasu serwera). Wartość spoza zakresu nie odrzuca mutacji — zapisujemy ją bez `capturedAt`, wynik `applied` z ostrzeżeniem `captured_at_out_of_range` (dane nie giną). Zakres — do potwierdzenia w EVM-011.
- **Po MVP:** `UpdateStageStatus` niesie `base_version`; gdy obiekt zmienił się w międzyczasie → `conflict` z aktualnym stanem, **bez cichego nadpisywania** (brak last-write-wins); decyzję podejmuje użytkownik.

### 5. Idempotencja mutacji
- `mutation_id` = **klucz idempotencji** (ADR-0004, ADR-0008). Rekord `IdempotencyRecord` jest powiązany z `user_id` + `device_id` **z sesji serwerowej** i z typem komendy; przechowuje skrót SHA-256 treści i **wynik minimalny** (status, kod, identyfikator zasobu) — nie pełną odpowiedź.
- Powtórka tej samej mutacji → `duplicate` z zapisanym wynikiem. Ten sam klucz z inną treścią → `rejected: idempotency_mismatch`. Mutacja z tym samym kluczem wciąż przetwarzana → `rejected: idempotency_in_progress` (klient ponawia później; w REST — `409`).
- Retencja kluczy: **30 dni** (dłużej niż 7 dni pracy offline bez ponownego uwierzytelnienia, ADR-0005).
- Każda mutacja w partii wykonuje się we **własnej transakcji** (komenda domenowa + rekord idempotencji + audyt + dziennik zmian).

## Tożsamość urządzenia i autoryzacja przy synchronizacji
- **Urządzenie rejestruje serwer przy logowaniu mobilnym** (ADR-0005); `user_id` i `device_id` pochodzą **wyłącznie z sesji serwerowej**, nigdy z nagłówka ani treści żądania. Nagłówki `X-Client-*` służą tylko kompatybilności (ADR-0004).
- **Sekret instalacji — rotacja dwufazowa:** każde udane logowanie mobilne zwraca nowy sekret, ale poprzedni (ostatni udowodniony) pozostaje ważny dla tego samego `deviceId`, dopóki urządzenie nie udowodni nowego (pierwsze odświeżenie tokenu, pierwsze żądanie z nowym tokenem dostępu albo logowanie nowym sekretem). Poprzedni sekret traci ważność najpóźniej po czasie życia tokenu odświeżania (nie dłużej niż 7 dni) od wydania nowego; w danej chwili są NAJWYŻEJ dwa ważne sekrety (ostatni udowodniony i najnowszy wydany) — wydany, a nieudowodniony sekret przestaje działać po wydaniu następnego (w wyniku kolejnego logowania poprzednim sekretem). Oba są unieważniane przy potwierdzeniu wyczyszczenia, usunięciu urządzenia i dezaktywacji konta. Zgubiona odpowiedź (słaby zasięg) nie tworzy więc nowego urządzenia: zachowuje zapisy idempotencji, kursor, zakres i miejsce w limicie urządzeń.
- **Odczyt zmian po stronie telefonu:** `SyncEntity` to otwarta koperta (zgodność w przód); encji nie czyta się przez wygenerowany `zSyncChangesResponse` (Zod usuwa pola projekcji), tylko przez `parseSyncChange` z `@evia/contracts/sync` (osobny punkt wejścia: główny nie ciągnie Zod do pakietu panelu, bo próba `eval` Zod łamie CSP `script-src 'self'`). Czytnik klienta jest tolerancyjny (dodanie pola przez serwer nie łamie starej aplikacji): znany `type` zachowuje znane pola i odrzuca nieznane, nieznany jest pomijany bez odrzucenia strony. Zmiana znanego typu niezgodna z projekcją albo uszkodzona daje `invalid` z `resync: true` — nie jest zapisywana ani po cichu pomijana, klient planuje resync; telemetria zawiera tylko powód i słownikowy `type`, nigdy treść. Ścisła walidacja bez dodatkowych pól (`assertSyncProjectionStrict`) służy testom serwera (brak wycieku danych). Mapa typ → projekcja to `x-evia-sync-projections`; narzędzie zmian łamiących porównuje projekcje przez tę mapę.
- Przy każdym żądaniu synchronizacji: sesja ważna i urządzenie nieunieważnione — inaczej **`401 session_revoked` dla całej partii** (ADR-0005, ADR-0008).
- **Autoryzacja w momencie synchronizacji**, nie utworzenia na telefonie: bieżąca rola i polityki obiektowe (ten sam silnik co API, przez [kotwicę](domain-model.md#kotwica-autoryzacji)). Utrata dostępu do obiektu → `rejected: forbidden` (dane na liście „Wymaga uwagi”) i flaga `resync_required` urządzenia.
- **Te same schematy i limity co API:** walidacja kontraktem (`additionalProperties: false`, limity długości), partia ≤ 50 mutacji, mutacja ≤ 64 KB, treść ≤ 1 MB, limity żądań ([`api-guidelines.md`](api-guidelines.md#limity)).
- Pobieranie zwraca wyłącznie obiekty w zakresie urządzenia, przefiltrowane politykami — przy każdym odczycie.
- **Pierwszeństwo wyczyszczenia (SR-SESS-06):** token urządzenia w stanie `wipe_required` (także unieważniony, zużyty lub wygasły, o ile rekord istnieje) zawsze daje `401 device_wipe_required` — przed `session_revoked` i `unauthenticated`; token nieznany daje tylko `session_revoked`. Tak samo pierwszy krok logowania: para `deviceId` + sekret instalacji zgodna z takim urządzeniem daje `device_wipe_required` jeszcze przed sprawdzeniem hasła.
- **Zgodność w przód typów encji (EVM-090):** `SyncEntityType` jest słownikiem otwartym, a `SyncEntity` otwartą kopertą `{type, id, version}`. Klient parsuje każdą zmianę osobno; upsert lub delete z nieznanym `type` pomija (licznik w telemetrii) i nie odrzuca strony ani nie wstrzymuje kursora. Dodanie typu projekcji podbija `scopeRuleVersion`, więc zaktualizowana aplikacja dostaje `resync_required` (`scope_changed`) i pobiera nowe obiekty. Dodanie typu nie jest zmianą łamiącą.

## Komendy mobilne MVP
Telefon w MVP **tylko tworzy** (zgodnie z M2: E11–E13). Kolejka `outbox` w szyfrowanej bazie: FIFO w obrębie obiektu, przetrwa zabicie aplikacji i restart telefonu.

| Komenda | Tworzy | Najważniejsze pola | Walidacja i autoryzacja | Możliwe `rejected` | Zależności w kolejce |
|---|---|---|---|---|---|
| `CreateNote` | `TimelineEntry` (`kind = note`) | `id`, `workOrderId`, `noteCategory`, `body`, `procedureStageId?`, `capturedAt` | rola A lub E; zlecenie dostępne i nieusunięte (także `settled` / `cancelled`); etap należy do zlecenia | `forbidden`, `target_unavailable`, `id_conflict`, `validation_failed`, `idempotency_mismatch` | po `CreateQuickWorkOrder` tego zlecenia |
| `CreateComment` | `TimelineEntry` (`kind = comment`) | `id`, `workOrderId`, `body`, `capturedAt` | jak wyżej | jak wyżej | jak wyżej |
| `CreateMediaAsset` | `MediaAsset` (metadane) | `id`, `workOrderId`, `mediaType`, `category`, `description?`, `procedureStageId?`, `capturedAt` | jak wyżej; plik deklarowany dopiero w sesji uploadu | jak wyżej | po `CreateQuickWorkOrder`; **przed** utworzeniem sesji uploadu (`POST …/media-assets/{id}/upload-sessions`, ADR-0009) |
| `CreateQuickWorkOrder` | `WorkOrder` (+ nowy `Customer`, nowa `Site`) z kompozycją wg szablonu | `workOrderId`, `templateId`, `title`, `customerId` **albo** `newCustomer` (`id`, `kind`, nazwa, `phone`), `siteId` **albo** `newSite` (`id`, `siteType`, adres, `parkingSpotNumber?`), `note?` | rola A lub E; szablon aktywny; istniejący klient i lokalizacja dostępne; nowe identyfikatory — tylko `INSERT`; numer nadaje serwer (do synchronizacji „oczekuje na numer”) | `id_conflict` (dowolny z identyfikatorów), `forbidden`, `template_unavailable`, `validation_failed`, `idempotency_mismatch` | pierwsza dla swojego zlecenia; wpisy i media do tego zlecenia czekają na jej wynik |
| `UpdateStageStatus` *(po MVP)* | zmiana `ProcedureStage.status` | `stageId`, `workOrderId`, `to`, `base_version`, pola przejścia | jak w tabeli przejść etapu ([`domain-model.md`](domain-model.md#etap-procesu)) | `conflict` (z aktualnym stanem), `invalid_state_transition`, `forbidden`, `target_unavailable` | — |

Wynik każdej mutacji: `applied` / `duplicate` / `conflict` / `rejected` (kod). **Odrzucone mutacje nie są usuwane** — trafiają na listę „Wymaga uwagi” (np. ponowne przypisanie wpisu do innego zlecenia), a Administrator widzi liczbę niewysłanych elementów urządzenia (ADR-0007).

## Polityka synchronizacji per encja
Skrót — pełna tabela: [`domain-model.md`](domain-model.md#gotowość-offline).

| Encja | Kierunek | Konflikty |
|---|---|---|
| `TimelineEntry`, `MediaAsset` | ↑ tworzenie, ↓ pobieranie | brak (append-only); usunięcie i redakcja tylko serwerowe → `delete` / `upsert` |
| `StoredFile`, `UploadSession` | ↑ sesja uploadu (ADR-0009); ↓ stan pliku tylko w projekcji `MediaAsset` | brak (stan pliku nadaje serwer) |
| `WorkOrder`, `Customer`, `Site` | ↑ tylko w `CreateQuickWorkOrder`, ↓ pobieranie | brak w MVP (telefon nie edytuje); edycje biura nadpisują stan lokalny |
| `ProcedureStage` | ↓ (po MVP ↑ `UpdateStageStatus`) | po MVP: `base_version` → `conflict`, bez last-write-wins |
| pozostałe w zakresie (`Party`, `Charger`, `ScopeItem`, `Procedure`, `WorkOrderAssignment`, `Document`, konfiguracja, `User`) | ↓ | brak (tylko odczyt na telefonie) |
| `PaymentMilestone`, `AuditEvent`, cudze `Session` i `Device` | — | poza urządzeniem |

## Zakres synchronizacji urządzenia
Delegowane z ADR-0008 („definicja zakresu w EVM-002”).

**Kto:** użytkownicy z rolą Administrator lub Edytor. Rola Tylko odczyt na telefonie — decyzja w EVM-005 (AC3).

**Które zlecenia:** nieusunięte zlecenia **niezamknięte** (aktywne `new`, `quoting`, `accepted`, `in_progress` oraz `on_hold` i `completed` — definicje w [`domain.md`](../product/domain.md#pojęcia-modelu-dodane-w-evm-002)) oraz **zamknięte** (`settled`, `cancelled`) z `closedAt` w ostatnich **N dniach** (propozycja N = 30; pomiar w EVM-011). W v1 każdy Edytor widzi wszystkie zlecenia; od M4 rola Monter — tylko przypisane (`WorkOrderAssignment`).

**Dane powiązane:** klient, lokalizacja (z ładowarkami), kontrahenci wskazani w lokalizacji i etapach, pozycje zakresu, procesy i etapy, przypisania, wpisy dziennika, metadane mediów (z podsumowaniem pliku) i dokumentów, użytkownicy wskazani w danych (tylko `id`, `displayName`). **Globalnie:** konfiguracja potrzebna do szybkiego zlecenia (`ServiceCatalogItem`, `ServiceCatalogItemProcedure`, `WorkOrderTemplate`, `WorkOrderTemplateItem`, `ProcedureTemplate`, `ProcedureStageTemplate`, `DocumentKind`).

**Encje bez kotwicy zlecenia:** `Customer`, `Site` (z `Charger`), `Party` oraz dokumenty z kotwicą klienta lub lokalizacji nie mają `work_order_id` (w dzienniku zmian ta kotwica jest pusta). Są w zakresie, gdy wskazuje je dowolne zlecenie z zakresu urządzenia: przez `customerId`, `siteId`, `Site.managerPartyId`, `Site.distributionSystemOperatorPartyId` albo `ProcedureStage.waitingOnPartyId`. Filtr ocenia to **przy każdym odczycie**, według tych samych reguł i polityk co dla zleceń. Zmiana takiej encji w biurze trafia więc na urządzenie tylko wtedy, gdy encja jest w zakresie.

**Wejście do zakresu:** obiekt wchodzi do zakresu urządzenia, gdy:
- biuro tworzy zlecenie dla istniejącego klienta lub lokalizacji, których nie ma na urządzeniu;
- Administrator wykonuje przywrócenie zlecenia albo encji powiązanej po soft delete;
- następuje ponowne otwarcie zlecenia zamkniętego ponad N dni temu (`settled → completed`, `cancelled → on_hold`);
- obiekt z zakresu zaczyna wskazywać nową encję (np. zmiana `siteId`, `waitingOnPartyId`, `managerPartyId`);
- rozszerza się dostęp (od M4 — przypisanie Montera).

Kanał zmian zawiera tylko obiekty zmienione, a w tych przypadkach encje powiązane często się nie zmieniły. **Zasada ([ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md), D3; zmienia wcześniejsze „serwer dostarcza w tej samej stronie”):** strona zawiera tylko zmienione obiekty, a kompletność agregatu zapewnia **migawka zlecenia** (`GET /api/v1/sync/work-orders/{id}`) dociągana przez klienta, zanim zlecenie pokaże się w UI. Upsert obiektu, którego zlecenie jest lokalnie nieznane, albo który wskazuje nieznaną lokalnie encję (klient, lokalizacja, strona, użytkownik), **nie jest stosowany do repliki**: zlecenie trafia na trwałą listę dociągnięć (zapisywaną w tej samej transakcji co strona i kursor). Nowe zlecenie jest więc niewidoczne do zastosowania migawki, a znane pokazuje poprzedni stan — nigdy niepełny szkielet. Stronę urządzenie stosuje atomowo, w jednej transakcji lokalnej, ze strażnikiem `version` (także dla znaczników usunięcia, które są zapisywane w replice do pełnego resyncu). Implementacja: `packages/sync-core` (EVM-092). Punkt 12 poniżej — rozstrzygnięty.

**Poza urządzeniem (minimalizacja):** `PaymentMilestone` i `PaymentMilestoneTemplate`, `AuditEvent`, dane innych użytkowników poza nazwą wyświetlaną, cudze sesje i urządzenia, **pliki dokumentów i oryginały mediów** (nie są automatycznie przechowywane offline), PPE.

**Projekcja pól na telefonie**
| Encja | Pola na urządzeniu | Pola wyłączone |
|---|---|---|
| `Customer` | `id`, `kind`, `displayName`, `phone`, `version` | e-mail, NIP, adres korespondencyjny, `notes` |
| `Site` | `id`, `siteType`, adres, `parkingSpotNumber`, `garageLevel`, `connectionPowerKw`, `managerPartyId`, `distributionSystemOperatorPartyId`, `notes`, `version` | `meteringPointId` (PPE) — rekomendacja; decyzja EVM-005 |
| `Party` | `id`, `kind`, `displayName`, `contactPersonName`, `phone`, `version` | `email`, `notes`, `legalForm` |
| `WorkOrder` i encje podrzędne (bez płatności) | pola z modelu poza kolumnami technicznymi (`search_text`, `deleted_*`) | — |
| `MediaAsset` | metadane; **podsumowanie pliku**: `fileState`, `fileStateReasonCode` (tylko przy `failed`: `checksum_mismatch`, `processing_error`), `sizeBytes`, `durationSeconds`, `widthPx`, `heightPx`; **miniatury na żądanie** (gdy `fileState = ready`) — w sandboxie aplikacji, wykluczone z backupu urządzenia, kasowane przy unieważnieniu | oryginały (poza własnymi plikami do potwierdzenia przez serwer — [punkt 7](#otwarte--evm-011)); `objectKey`, skróty SHA-256, `originalFilename`; przyczyna kwarantanny (tylko panel) |
| `Document`, `DocumentVersion` | metadane (rodzaj, tytuł, numer wersji, data) | pliki — tylko online, na żądanie |
| `User` | `id`, `displayName` | e-mail, rola, czasy logowania |

**Wyjście z zakresu ([ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md), D1 — reguła klienta):** obiekt, który wypada z zakresu, jest **usuwany z urządzenia** razem z obiektami podrzędnymi. Reguły klienta, uruchamiane po każdym **udanym** cyklu pobierania i po dociągnięciu migawek (nigdy offline ani po cyklu częściowym): zlecenie `settled`/`cancelled` z `closedAt` starszym niż N dni (N z `meta/client-config`, czas wg `serverTime`, nie zegara telefonu); klient, lokalizacja (z ładowarkami), strona i nazwa użytkownika, których nie wskazuje już żadne zlecenie z zakresu ani obiekt oczekujący. Zostają kolejka i obiekty lokalne oczekujące z plikami ([zasada 2](#2-soft-delete-i-znaczniki-usunięcia)). Utrata dostępu to osobna ścieżka (`resync_required` `access_changed` albo `session_revoked`): usuwa **całą** replikę, także encje, które wskazuje obiekt oczekujący.

## Wysyłanie (push) — sekwencja
```mermaid
sequenceDiagram
  autonumber
  participant App as Aplikacja (outbox w SQLCipher)
  participant API as API POST /api/v1/sync/mutations
  participant Auth as identity + authorization
  participant Dom as Moduł domenowy
  participant DB as PostgreSQL
  App->>API: partia ≤ 50 mutacji (mutation_id, typ, wersja komendy, ładunek)
  API->>Auth: sesja ważna? urządzenie nieunieważnione?
  alt sesja lub urządzenie unieważnione
    API-->>App: 401 session_revoked (cała partia)
  else sesja ważna
    loop każda mutacja, osobna transakcja
      API->>DB: IdempotencyRecord (user_id, device_id, mutation_id)
      alt klucz znany, ta sama treść
        API-->>API: wynik duplicate (zapisany wynik minimalny)
      else klucz znany, inna treść
        API-->>API: rejected idempotency_mismatch
      else nowy klucz
        API->>Auth: autoryzacja teraz (rola, polityka obiektowa przez kotwicę)
        API->>Dom: komenda domenowa (tylko INSERT dla Create*)
        Dom->>DB: zmiana + audyt + dziennik zmian + rekord idempotencji
        API-->>API: applied / rejected (kod)
      end
    end
    API-->>App: wyniki per mutacja
    App->>App: applied, duplicate → usuń z kolejki
    App->>App: rejected, conflict → lista „Wymaga uwagi”
  end
```

## Pobieranie (pull) — sekwencja
```mermaid
sequenceDiagram
  autonumber
  participant App as Aplikacja
  participant API as API GET /api/v1/sync/changes
  participant Auth as identity + authorization
  participant DB as PostgreSQL
  App->>API: cursor, limit
  API->>Auth: sesja i urządzenie ważne?
  API->>DB: resync_required dla urządzenia?
  alt resync wymagany lub kursor starszy niż 90 dni
    API-->>App: resync_required
    App->>App: zasięg: nowa replika "w cieniu" od zera, podmiana po komplecie (access_changed: usuń od razu); kolejka i obiekty oczekujące nietknięte
  else przyrost
    API->>DB: SyncChange od pozycji kursora po (txid, seq), tylko txid poniżej pg_snapshot_xmin, LIMIT
    API->>Auth: filtr zakresu i polityk dla każdej zmiany
    API->>DB: bieżący stan obiektów (projekcja dla urządzenia)
    API-->>App: zmiany (upsert z version, delete jako znacznik) + nowy kursor (txid, seq)
    App->>App: zastosuj w jednej transakcji lokalnej, zapisz kursor
  end
```

## Resync, utrata dostępu i wyjście z zakresu
- **`resync_required`** ustawia serwer, gdy: zmieni się rola użytkownika lub polityka dostępu (od M4 — odpięcie od zlecenia), kursor jest starszy niż retencja dziennika zmian (90 dni), zmieni się reguła zakresu (np. wartość N), lokalna baza urządzenia została utracona (np. przywrócenie telefonu), a także okresowo jako kontrolny pełny resync (propozycja: co 7 dni, ADR-0008).
- Klient po `resync_required` ([ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md), D2) pobiera **nową generację repliki obok starej**: od zera (bez kursora), z migawką stronicowaną po agregatach; UI czyta starą do kompletu, stara nie przyjmuje w tym czasie przyrostów. Komplet = faza `snapshot` przeszła w `changes` do `hasMore = false` i lista dociągnięć generacji jest pusta; wtedy podmiana (jedna transakcja lokalna). Przerwanie zostawia starą replikę i kursor nowej generacji, ponowienie kontynuuje od niego. Powody: `periodic`, `scope_changed`, `cursor_expired`, `cursor_invalid` (nieznany powód = `periodic`; lokalnie nieczytelny kursor = `cursor_invalid`) oraz lokalny `invalid_change` (zmiana niezgodna z projekcją — zapisywany trwale razem ze stroną). **Wyjątek: `access_changed`** — replika (obie generacje, kursory, lista dociągnięć, znaczniki) jest usuwana natychmiast, przed pobraniem; obiekty bez dostępu znikają z urządzenia. Kolejki i obiektów oczekujących resync nie dotyka. `400 invalid_cursor` to zdarzenie bezpieczeństwa serwera: wstrzymanie samego pobierania (`unexpected_response`; wysyłka kolejki działa dalej), bez pętli resyncu. Klient czyta **tolerancyjnie** (nieznane pola pomija — zmiana addytywna nie powoduje resyncu). Resync w cieniu, który 3 razy z rzędu trafia na niepoprawną zmianę, wstrzymuje pobieranie z sygnałem `replica_stale` (UI: „dane mogą być nieaktualne”). Pierwsze pobranie ma trwały znacznik `initialLoadDone`; do jego ustawienia UI nie pokazuje listy częściowej.
- **Kolejka obejmuje obiekty lokalne oczekujące i ich pliki** ([zasada 2](#2-soft-delete-i-znaczniki-usunięcia)): wpisy, komentarze, `MediaAsset` i szybkie zlecenie bez wyniku `applied` / `duplicate` oraz oryginały przed potwierdzeniem przez serwer. Resync (także kontrolny), znacznik usunięcia i wyjście z zakresu ich nie usuwają. Technik nadal widzi swoje szybkie zlecenie jako oczekujące i może dodawać do niego zdjęcia. Przy `rejected` obiekty trafiają z plikami na „Wymaga uwagi”.
- Dezaktywacja konta i unieważnienie urządzenia → `401 session_revoked`; aplikacja czyści dane zgodnie z ADR-0005 i ADR-0007 — **los niewysłanej kolejki (w tym obiektów oczekujących i plików) — wynik EVM-011 dla uploadu: nic nie jest usuwane, wznowienie na tej samej instalacji ([punkt 1](#otwarte--evm-011)); polityka końcowa w EVM-005**.
- **Replika po `session_revoked` (EVM-092):** replika jest usuwana natychmiast (obie generacje; kolejka i obiekty oczekujące zostają), niezależnie od tego, czy unieważnienie zauważył push, czy pull. To ostrzejsze niż samo ukrycie danych w scenariuszu E9 i jest zgodne z celem: dane z serwera znikają, praca niewysłana zostaje. Wznowienie tylko dla tego samego użytkownika; replika jest przypisana do właściciela jak kolejka (inny użytkownik w sesji = usunięcie repliki i sygnał `owner_mismatch`). `device_wipe_required` — natychmiastowy stop, pełne czyszczenie należy do hosta (EVM-093/107).

## Wersje komend i kompatybilność
- Każda mutacja ma `type` i `commandVersion` (liczba całkowita). Zmiany ładunku w ramach wersji tylko addytywne; zmiana łamiąca = nowa wersja komendy.
- Serwer obsługuje każdą wersję komendy, którą może wysłać wspierana aplikacja — także mutację utworzoną przez starszą wersję i czekającą w kolejce po aktualizacji aplikacji. Wersję komendy usuwamy dopiero, gdy `minSupportedVersion` jej nie obejmuje **i** minęło 30 dni (retencja kluczy).
- `426 client_version_unsupported` blokuje pracę online, ale **zachowuje kolejkę** (ADR-0004); po aktualizacji aplikacja wysyła kolejkę bez utraty danych (`sync-core` zachowuje serializację starszych wersji albo podnosi je do bieżącej).
- Nowe wartości słowników w pobieranych danych: klient obsługuje wartość nieznaną (ADR-0004).

## Limity i retencje
| Parametr | Wartość | Źródło |
|---|---|---|
| partia mutacji | ≤ 50 | ADR-0008 |
| rozmiar mutacji / treści żądania | ≤ 64 KB / ≤ 1 MB | ten dokument / ADR-0004 |
| strona zmian (`limit`) | domyślnie 200, maks. 500 (odpowiedź ≤ 1 MB) — do pomiaru w EVM-011 | ten dokument |
| retencja kluczy idempotencji | 30 dni | ADR-0004, ADR-0008 |
| retencja dziennika zmian i znaczników usunięcia | 90 dni | ADR-0008 |
| zamknięte zlecenia w zakresie | N = 30 dni (propozycja; wartość w `GET /api/v1/meta/client-config` → `closedWorkOrdersInScopeDays`, EVM-090) | ten dokument, EVM-011 |
| praca offline bez ponownego uwierzytelnienia | 7 dni przeglądania; rejestracja mediów zawsze | ADR-0005, EVM-005 |
| limity żądań | jak API (300 żądań/min/użytkownik + limit per IP) | ADR-0004 |

## Zgodność z ADR-0008 (checklista)
| Element ADR-0008 | Gdzie |
|---|---|
| UUIDv7 nadawany na urządzeniu; nie zastępuje autoryzacji | zasada 1 |
| `mutation_id` = klucz idempotencji, powiązany z `user_id` + `device_id`; `duplicate`, `idempotency_mismatch`; retencja 30 dni | zasada 5 |
| `base_version` dla edycji, `conflict` bez last-write-wins; w MVP zero edycji | zasady 3–4, komendy |
| kursor nieprzezroczysty z `seq` i `xid8`, bezpieczny horyzont `pg_snapshot_xmin` | zasada 3 (kursor = para (`txid`, `seq`), odczyt tylko `txid` < `pg_snapshot_xmin` w kolejności (`txid`, `seq`)), sekwencja pull, scenariusz 6 |
| kursory filtrowane uprawnieniami; `resync_required` przy utracie dostępu | autoryzacja, resync |
| retencja dziennika zmian i znaczników 90 dni; starszy kursor → resync | zasady 2–3 |
| `401 session_revoked` dla całej partii; autoryzacja w momencie synchronizacji | autoryzacja, sekwencja push |
| odrzucone mutacje na liście „Wymaga uwagi”; `target_unavailable` | zasada 2, komendy |
| po `resync_required` klient usuwa dane domenowe, nie kolejkę | zasada 2 (obiekty lokalne oczekujące), resync |
| `captured_at` tylko metadana, kolejność wg czasu serwera | zasada 4 |
| partie do 50 mutacji | komendy, limity |

## Scenariusze testowe „nic nie ginie” (EVM-011, E10–E13)
Wymagania testowe dla spike'a i historyjek M2 (test `sync-core`, testy serwerowe na PostgreSQL w Testcontainers oraz E2E na Androidzie):
1. **Usunięcie zlecenia w biurze przy niewysłanych zdjęciach** (metadane w kolejce, pliki przed uploadem lub w trakcie). Zdjęcia z plikami trafiają na „Wymaga uwagi”, żaden plik nie znika.
2. **Resync przy niewysłanym szybkim zleceniu** (także kontrolny, co 7 dni) z nowym klientem i lokalizacją. Zlecenie zostaje widoczne jako oczekujące, technik dodaje kolejne zdjęcia, a po powrocie sieci wszystko trafia na serwer bez duplikatów.
3. **Wyjście z zakresu przy niewysłanych wpisach** (zlecenie zamknięte ponad N dni temu). Wpisy zostają do wyniku mutacji.
4. **Plik `quarantined` lub `failed` (`checksum_mismatch`).** Lokalny oryginał zostaje, a aplikacja pokazuje „Wymaga uwagi” albo „Ponów” ([punkt 7](#otwarte--evm-011)).
5. **Wejście do zakresu** ([punkt 12](#otwarte--evm-011)). Zlecenie od razu ma klienta, adres, etapy i wpisy w przypadkach:
   - nowe zlecenie dla istniejącego klienta i lokalizacji spoza urządzenia;
   - przywrócenie zlecenia po soft delete;
   - ponowne otwarcie zlecenia zamkniętego ponad N dni temu;
   - wskazanie w etapie strony spoza urządzenia.
6. **Kursor przy przeplocie transakcji** (test serwerowy, deterministyczny: dwa połączenia sterowane krok po kroku, bez opóźnień):
   1. T2 zaczyna pierwsza i dowolnym zapisem dostaje niższy `txid`;
   2. T1 zapisuje zmianę — niższy `seq`, wyższy `txid`;
   3. T2 zapisuje zmianę (wyższy `seq`) i zatwierdza się;
   4. pobranie;
   5. T1 zatwierdza się;
   6. kolejne pobranie.

   Oczekiwane: urządzenie dostaje obie zmiany, bez duplikatów — także przy `limit = 1`, kilku zmianach w jednej transakcji i znaczniku usunięcia. Test „opóźnionego commitu” (ADR-0008, ryzyko 4) tego przypadku nie wykrywa, bo transakcja z niższym `txid` musi dopisać do dziennika później.

## Otwarte — EVM-011
Do rozstrzygnięcia w spike'u EVM-011 (Android; iOS odłożony — ADR-0015) i w historyjkach E10–E13; wnioski wpisujemy tutaj.
1. **Los niewysłanej kolejki i listy „Wymaga uwagi” po unieważnieniu sesji lub urządzenia** — czyszczenie vs bezpieczne zachowanie do ponownego logowania tego samego użytkownika (ADR-0007, ryzyko c; polityka w EVM-005). *Wynik EVM-011 (Android, emulator; test integracyjny Node z SeaweedFS i zachowanie zadania natywnego):* po `401 session_revoked` kolejka, oczekujące pliki i sekret instalacji **zostają**, a zadanie przechodzi w stan `paused_revoked`; po ponownym zalogowaniu **na tej samej instalacji** (to samo `deviceId`) upload wznawia się od ostatniej potwierdzonej części (`ListParts`, bez ponownego `PUT` części z ETag-iem), a **inne urządzenie** dla tego samego `assetId` dostaje `id_conflict` i zaczyna od nowa (nowy `assetId`); `409 id_conflict` **nie ma skutków ubocznych** — serwer nie przerywa cudzego multipartu ani nie kasuje i nie nadpisuje obiektu (porzucone multiparty sprząta lifecycle bucketu, np. po 7 dniach; test spike'a: urządzenie B nie przerywa ani nie nadpisuje uploadu A). Sesję uploadu kontynuuje tylko jej twórca (cudza → `403`). Rekomendacja dla EVM-005: nie czyścić kolejki przy `session_revoked`, tylko wstrzymać; czyszczenie dopiero decyzją użytkownika/administratora. Niezmierzone: mutacje (nie ma serwera mutacji w spike'u) — wynik `duplicate` dla mutacji zastosowanej bez odebranego wyniku pozostaje do sprawdzenia w testach `sync-core` (zasada 2).
2. **Limit pracy offline 7 dni** (ADR-0005) — zachowanie aplikacji po przekroczeniu (ukrycie danych, dalsza rejestracja mediów); wartość ostateczna w EVM-005.
3. **Wartość N** (zamknięte zlecenia w zakresie; propozycja 30 dni) — pomiar rozmiaru i czasu pełnej synchronizacji na szyfrowanej bazie.
4. **Mechanizm wyjścia z zakresu** — *rozstrzygnięte w [ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md) (D1): reguła klienta (N z konfiguracji, czas wg `serverTime`) + sprzątanie osieroconych; implementacja EVM-092.*
5. **Zapis dziennika zmian** — *rozstrzygnięte w [ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md) (D4, D5): generyczny trigger `sync.record_change()`, limity czasu transakcji i metryka opóźnienia horyzontu; implementacja EVM-096. Przeplot z [scenariusza 6](#scenariusze-testowe-nic-nie-ginie-evm-011-e10e13) testuje serwer.*
6. **Zakres `capturedAt`** — dopuszczalne przesunięcie zegara telefonu.
7. **Pliki lokalne — kiedy usuwać własny oryginał z urządzenia.** *Rekomendacja do potwierdzenia w EVM-011:* usuwamy go **dopiero**, gdy projekcja `MediaAsset` pokaże `fileState` równe `clean`, `processing` lub `ready`. Niezmiennik: `clean` tylko przy zgodnym SHA-256 i pozytywnym skanie ([`domain-model.md`](domain-model.md#storedfile-i-uploadsession)). Nie usuwamy po `uploaded`, bo `complete` sprawdza tylko rozmiar (ADR-0009). Przy `quarantined` lub `failed` przed `clean` lokalna kopia zostaje:
   - `failed` z `checksum_mismatch` → „Ponów” (nowa sesja uploadu z lokalnego pliku);
   - `quarantined` → „Wymaga uwagi”;
   - `failed` z `processing_error` (po `clean`) nie dotyczy oryginału — serwer ponawia przetwarzanie (do trzech prób; niedostępność procesora nie zużywa prób); po wyczerpaniu prób ponowienie to świadoma operacja wg runbooka `media-processor.md`.

   *Wynik EVM-011 (Android, emulator):* rekomendacja potwierdzona jako ostrożna. W spike'u „potwierdzone przez serwer” oznaczało tylko zgodne SHA-256 obiektu w S3 (usunięcie lokalnego pliku odbywa się wyłącznie przy stanie `uploaded` **i** zgodnym SHA-256); produkcyjnym warunkiem pozostaje `clean` (SR-FILE-05). Do czasu `clean` oryginał zostaje także po `uploaded` i po weryfikacji SHA-256 przez klienta.

   Do ustalenia: rozmiar i czyszczenie pamięci podręcznej miniatur, zachowanie przy braku miejsca na urządzeniu (**niezmierzone w EVM-011** — próg miejsca i ostrzeżenie, pytanie 10 ADR-0007).
8. **Mutacja starsza niż retencja kluczy (30 dni)** — rozpoznanie własnego, już zapisanego obiektu przy `id_conflict` (np. porównanie twórcy i skrótu treści).
9. **Duplikaty klientów i lokalizacji z szybkich zleceń offline** — wyszukiwanie lokalne przed utworzeniem; scalanie w biurze poza v1.
10. **Rozmiar strony zmian i projekcji** — wartości `limit` i czas przyrostowej synchronizacji po dniu offline.
11. **Okresowy kontrolny resync** — *rozstrzygnięte w [ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md) (D2): co 7 dni (`periodicResyncDays`), sterowany serwerem, w cieniu; implementacja klienta EVM-092.*
12. **Mechanizm wejścia do zakresu** — *rozstrzygnięte w [ADR-0021](adr/0021-sync-zakres-migawka-zlecenia-dziennik-zmian-kursor.md) (D3): jeden mechanizm sterowany klientem — migawka zlecenia i trwała lista dociągnięć (zob. [zakres](#zakres-synchronizacji-urządzenia)); rozmiar agregatu większego niż 1 MB mierzy EVM-107. Testy scenariusza 5: EVM-092.*

## Wnioski ze spike'a EVM-011 — upload plików (Android)
> **Zakres dowodów:** emulator Androida 15 (API 35) i lokalny SeaweedFS 4.48. **Nie dotyczy iOS. Fizyczny telefon: niezweryfikowany** (ręczny krok Konrada, AC2/AC5). Szczegóły i liczby: [raport](../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md); protokół i rekomendacje: [`media-pipeline.md`](media-pipeline.md).

Dotyczy punktów „Otwarte — EVM-011” związanych z plikami (punkty 1 i 7 wyżej oraz zasada kolejki plików):
- **Kolejka plików przetrwała** zabicie procesu (`kill -9` i `force-stop`), restart emulatora (także z blokadą ekranu, po pierwszym odblokowaniu) i utratę sieci; w żadnym przebiegu nie powstał duplikat obiektu ani osierocony multipart.
- **`force-stop` kasuje zadania systemowe** — wznowienie następuje dopiero po otwarciu aplikacji (odtworzenie zadań z trwałej kolejki); `kill -9` i restart telefonu wznawiają zadanie same (UIDT trwały).
- **Idempotencja po stronie API jest warunkiem „bez duplikatów”:** `assetId` z urządzenia, sesja i `complete` idempotentne, `ListParts` jako źródło prawdy o częściach (kolejka mutacji metadanych nie rozwiązuje tego problemu dla plików).
- **Pozostają niezmierzone w tym spike'u** (nie dotyczą uploadu plików lub wymagają telefonu): rozmiar strony zmian (200/500), wartość N = 30 dni, mechanizm wyjścia z zakresu, zakres `capturedAt`, kontrolny resync co 7 dni; zachowanie przy braku miejsca na urządzeniu; bateria; wydajność szyfrowanej bazy na telefonie.
