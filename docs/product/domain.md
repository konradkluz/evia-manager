# Domena — słownik i model zleceń

> Właściciele: `product-owner` (pojęcia) i `solution-architect` (model w kodzie). Nazwy w kodzie **potwierdzone w EVM-002** (2026-10-03, do akceptacji Konrada na demo) — zmiany względem propozycji z uzasadnieniem: [Zmiany nazw w kodzie](#zmiany-nazw-w-kodzie-evm-002). Znaczenia pojęć i etykiety zweryfikowane biznesowo przez `product-owner` (2026-10-03); terminologia makiet MVP (`docs/ux/flows/`) zweryfikowana w EVM-004 (2026-10-03) — [pojęcia z makiet](#pojęcia-z-makiet-mvp-dodane-w-evm-004); terminologia makiet E1 (dostęp, konto, administracja, e-maile) — EVM-015 (2026-10-04) — [pojęcia z makiet E1](#pojęcia-z-makiet-e1-dodane-w-evm-015); terminy w UI — styleguide § 6.2 (np. kontrahenta w UI nazywamy „stroną”). Model danych: [`../architecture/domain-model.md`](../architecture/domain-model.md); dane startowe katalogu i szablonów: [`service-catalog.md`](service-catalog.md).

## Jak zapanować nad różnorodnością zleceń? (rekomendacja)
Nie narzucamy sztywnych „typów zleceń”, ale też nie robimy formularzy bez struktury. **Zlecenie składamy z klocków:**

```
Zlecenie = Klient + Lokalizacja + Zakres (pozycje z katalogu usług)
         + Procesy z etapami (wynikające z zakresu lub dodane ręcznie)
         + Etapy płatności + Dziennik + Media i dokumenty + Parametry techniczne
```

- **Katalog usług** — klocki, np. dostawa ładowarki (z oferty) / ładowarka klienta, montaż ładowarki, instalacja zasilająca (obwód dedykowany lub istniejący), zwiększenie mocy przyłączeniowej, ekspertyza, opinia ppoż, projekt, uzgodnienia z OSD, zgody administracji, pomiary i odbiór.
- **Szablony zleceń** — gotowe zestawy klocków do szybkiego startu (np. „Dom — pełny pakiet”, „Dom — sam montaż”, „Garaż — pełny proces”, „Garaż — sama instalacja”). Po utworzeniu wszystko można zmienić w konkretnym zleceniu.
- **Procesy i etapy** — każdy proces (np. „Uzgodnienia z OSD”) ma uporządkowane etapy ze statusem, datami, osobą odpowiedzialną i informacją „na kogo czekamy”. To one odpowiadają na pytanie „na jakim jesteśmy etapie w Stoen / z administracją”.
- **Status zlecenia** — krótki, stały cykl życia (np. Nowe → Wycena → Zaakceptowane → W realizacji → Zakończone → Rozliczone; plus Wstrzymane, Anulowane). Szczegóły postępu niosą etapy procesów.

**Dlaczego tak:** dowolna kombinacja usług bez programowania nowych typów, a jednocześnie struktura, która pozwala filtrować i raportować („wszystkie zlecenia czekające na OSD > 14 dni”, „nieopłacone etapy”). **W MVP** katalog i szablony są danymi startowymi (konfiguracja; propozycja: [`service-catalog.md`](service-catalog.md)), a edytor dla administratora powstaje w M4 — bez przepisywania modelu. **Czego unikamy:** własnego silnika BPMN i w pełni dowolnych formularzy w MVP.

## Słownik
| Pojęcie | Znaczenie | Nazwa w kodzie |
|---|---|---|
| Klient | osoba lub firma zamawiająca usługę | `Customer` (nie `Client` — koliduje z „HTTP client”) |
| Lokalizacja / obiekt | miejsce realizacji: adres, typ obiektu, numer miejsca postojowego, zarządca, OSD, PPE, moc przyłączeniowa; niezależna od klienta — w jednej lokalizacji może być wiele zleceń w czasie | `Site` |
| Typ obiektu | dom jednorodzinny, garaż w budynku wielorodzinnym, obiekt komercyjny… | `SiteType` |
| Zlecenie | jednostka pracy dla klienta w lokalizacji | `WorkOrder` (nie `Order` — koliduje z zamówieniem ładowarki i sortowaniem; nie `Job` — koliduje z zadaniami w tle) |
| Szablon zlecenia | predefiniowany zestaw pozycji zakresu i procesów | `WorkOrderTemplate` |
| Katalog usług / pozycja zakresu | klocek usługi i jego wystąpienie w zleceniu | `ServiceCatalogItem` / `ScopeItem` |
| Proces | ścieżka formalna lub realizacyjna złożona z etapów | `Procedure` (nie `Process` / `Workflow` — kolizje techniczne) |
| Etap | krok procesu ze statusem, datami, odpowiedzialnym | `ProcedureStage` |
| Status etapu | Do zrobienia, W toku, Czekamy na… (na klienta albo na stronę — patrz „Na kogo czekamy”), Zablokowany, Zakończony, Nie dotyczy | `StageStatus` (`todo`, `in_progress`, `waiting`, `blocked`, `done`, `not_applicable`) |
| Etap płatności | transza do zapłaty: nazwa, kwota (brutto do zapłaty), nr faktury, termin, status (planowana / wystawiona / opłacona / anulowana); „po terminie” jest wyliczane, nie zapisywane | `PaymentMilestone` (status: `PaymentMilestoneStatus`, wyliczane `isOverdue`) |
| Dziennik | chronologiczna historia zlecenia: wpisy, komentarze, zmiany statusów | `TimelineEntry` (tabela); `Timeline` — widok (zapytanie), nie encja |
| Wpis / komentarz | notatka (rozmowa, ustalenie) / komentarz użytkownika | `TimelineEntry` z `kind` = `note` / `comment` (komendy mobilne `CreateNote` / `CreateComment`) |
| Media | zdjęcie lub film z metadanymi (kategoria, autor, czas, etap) | `MediaAsset` |
| Dokument | plik formalny (projekt, ekspertyza, zgoda, warunki przyłączenia, protokół) z wersjami | `Document` + `DocumentVersion` (rodzaj: `DocumentKind`) |
| Strona / kontrahent | administracja, zarządca, wspólnota / spółdzielnia, projektant, rzeczoznawca (ppoż, ekspertyza), OSD, podwykonawca, dostawca; w UI — „Strona” (klient nie jest stroną) | `Party` (rodzaj: `PartyKind`) |
| OSD | Operator Systemu Dystrybucyjnego, np. Stoen Operator (Warszawa); **nie zaszywamy „Stoen” w kodzie** | `Party` z `kind` = `distribution_system_operator` |
| Moc przyłączeniowa | maksymalna moc [kW] określona w umowie o przyłączenie (i warunkach przyłączenia), na którą przygotowano przyłącze; jej zwiększenie wymaga procesu z OSD. Nie mylić z mocą umowną (zamawianą w umowie dystrybucyjnej lub kompleksowej, nie większą niż przyłączeniowa) | `connectionPowerKw` |
| PPE | punkt poboru energii (identyfikator u OSD) | `meteringPointId` |
| WLZ | wewnętrzna linia zasilająca w budynku wielorodzinnym | `internalSupplyLine` |
| Obwód dedykowany | osobny obwód zasilający ładowarkę | `dedicatedCircuit` |
| Wallbox / ładowarka AC / DC | urządzenie ładujące; DC — duża moc, inne procedury | `Charger` (`powerKw`, `currentType`: `ac` / `dc`) |
| Ekspertyza | ocena techniczna możliwości instalacji (np. w garażu); w budynku wielorodzinnym podstawa zgody zarządu na punkt ładowania (tryb ustawowy — do weryfikacji, [`service-catalog.md`](service-catalog.md#9-źródła-do-weryfikacji)) | `DocumentKind` `technical_assessment`; proces `technical_assessment` |
| Opinia ppoż | opinia rzeczoznawcy ds. zabezpieczeń przeciwpożarowych | `DocumentKind` `fire_safety_opinion`; proces `fire_safety_opinion` |
| Warunki przyłączenia | dokument OSD określający warunki przyłączenia lub zmiany mocy, wydawany na wniosek razem z projektem umowy o przyłączenie | `DocumentKind` `connection_conditions`; etap `connection_conditions` procesu `dso_connection` |
| Zgłoszenie gotowości instalacji | dokument, którym instalator informuje OSD, że instalacja odbiorcy jest gotowa do przyłączenia; po nim OSD wymienia licznik lub zabezpieczenie i załącza zasilanie | `DocumentKind` `dso_readiness_declaration`; etap `readiness_declaration` procesu `dso_connection` |
| Pełnomocnictwo | umocowanie firmy do działania w imieniu klienta (np. wobec OSD) | `DocumentKind` `power_of_attorney` |
| Inwestycja (przyszłość) | projekt deweloperski grupujący budynki, garaże i miejsca postojowe | `Investment` |
| UDT (przyszłość) | Urząd Dozoru Technicznego — procedury dla wybranych stacji ładowania (np. ogólnodostępnych) | etap procesu |

### Pojęcia modelu (dodane w EVM-002)
| Pojęcie | Znaczenie | Nazwa w kodzie |
|---|---|---|
| Status zlecenia | Nowe, Wycena, Zaakceptowane, W realizacji, Zakończone (prace wykonane, czeka na rozliczenie), Rozliczone; Wstrzymane, Anulowane | `WorkOrderStatus` |
| Zlecenie aktywne / zamknięte / niezamknięte | **aktywne** — Nowe, Wycena, Zaakceptowane, W realizacji; **zamknięte** — Rozliczone, Anulowane; **niezamknięte** — wszystkie poza zamkniętymi (także Wstrzymane i Zakończone) | wyliczane ze `status` (bez osobnego pola) |
| Numer zlecenia | czytelny numer nadawany przez serwer (propozycja formatu: ZL-2026-0042) | `number` (pole `WorkOrder`) |
| Szybkie zlecenie | zlecenie założone z telefonu (klient + adres + szablon), uzupełniane potem w biurze | komenda `CreateQuickWorkOrder` |
| Przypisanie do zlecenia | opiekun (koordynator) albo technik przypisany do zlecenia | `WorkOrderAssignment` |
| Pozycja szablonu zlecenia | pozycja katalogu w szablonie, z domyślnymi parametrami | `WorkOrderTemplateItem` |
| Proces wnoszony przez usługę | powiązanie pozycji katalogu z szablonem procesu | `ServiceCatalogItemProcedure` |
| Szablon procesu / szablon etapu | wzorzec procesu z uporządkowanymi etapami („na kogo czekamy”, dokumenty wynikowe) | `ProcedureTemplate` / `ProcedureStageTemplate` |
| Plan płatności (transza w szablonie) | transza w szablonie zlecenia: nazwa, udział %, podpowiedź, termin płatności | `PaymentMilestoneTemplate` |
| Status etapu płatności | planowana / wystawiona (faktura lub proforma wystawiona, czekamy na wpłatę) / opłacona / anulowana | `PaymentMilestoneStatus` |
| Nieopłacone / po terminie (zestawienia) | **nieopłacone** — etapy płatności w stanie „wystawiona” (w tym po terminie); **po terminie** — „wystawiona” z terminem wcześniejszym niż dziś (`Europe/Warsaw`); „planowana” nie jest nieopłacona — dokument do zapłaty nie został jeszcze wystawiony | filtr `status = invoiced`; `isOverdue` |
| Na kogo czekamy | klient albo strona (kontrahent), na której odpowiedź lub działanie czeka etap, i od kiedy; gdy etap nie czeka, „piłka jest po naszej stronie” | `waitingOn` (`customer` / `party`; + `waitingOnPartyId`, `waitingSince`) |
| Rodzaj strony (kontrahenta) | administracja, zarządca, wspólnota / spółdzielnia, projektant, rzeczoznawca ppoż, rzeczoznawca (ekspertyza), OSD, podwykonawca, dostawca, inny | `PartyKind` |
| Kategoria usługi | grupa pozycji katalogu: urządzenia, instalacja i montaż, formalności i uzgodnienia, projekt i ekspertyzy, pomiary i odbiór, inne | `category` (pole `ServiceCatalogItem`) |
| Kategoria wpisu | rodzaj wpisu w dzienniku: rozmowa telefoniczna, spotkanie, ustalenie, wizyta na miejscu, inne | `noteCategory` (pole `TimelineEntry` dla `kind = note`) |
| Parametry techniczne / zestaw parametrów | wartości techniczne pozycji zakresu (bez danych osobowych) wg zestawu zdefiniowanego w kodzie | `parameters` / `parameterSetCode` |
| Kategoria mediów | oględziny, stan przed pracami, w trakcie, po zakończeniu, usterka, pomiary, inne | `MediaCategory` |
| Rodzaj dokumentu | słownik rodzajów dokumentów z poziomem poufności | `DocumentKind` |
| Wersja dokumentu | kolejna wersja pliku dokumentu (nowa wersja zamiast edycji) | `DocumentVersion` |
| Plik | obiekt w storage'u ze stanem skanu i przetwarzania, współdzielony przez media i wersje dokumentów | `StoredFile` |
| Sesja uploadu | wznawialne wysyłanie pliku porcjami | `UploadSession` |
| Użytkownik | konto pracownika | `User` |
| Rola | Administrator / Edytor / Tylko odczyt | `UserRole` (`administrator` / `editor` / `read_only`) |
| Sesja | zalogowanie w panelu lub w aplikacji mobilnej | `Session` |
| Urządzenie | telefon zarejestrowany przy logowaniu w aplikacji | `Device` |
| Stan synchronizacji urządzenia | m.in. flaga ponownej pełnej synchronizacji | `DeviceSyncState` |
| Zdarzenie audytu | wpis dziennika audytu: kto, co, kiedy, skąd, wynik | `AuditEvent` |
| Zmiana w dzienniku zmian | techniczny wpis kanału zmian dla urządzeń (tylko identyfikatory) | `SyncChange` |
| Rekord idempotencji | zapamiętany wynik mutacji dla klucza idempotencji | `IdempotencyRecord` |

### Pojęcia z makiet MVP (dodane w EVM-004)
Pojęcia, których używają makiety ([`docs/ux/flows/`](../ux/flows/README.md)) — bez nowych encji; nazwy w kodzie wg modelu.

| Pojęcie | Znaczenie | Nazwa w kodzie |
|---|---|---|
| Klasa poufności dokumentu | kto może pobrać plik dokumentu; wynika z rodzaju dokumentu: **Standardowy** (pozostałe dokumenty — nadal mogą zawierać dane osobowe), **Bezpieczeństwo budynku** (projekt, ekspertyza, opinia ppoż, dokumentacja budynku), **Dane identyfikacyjne** (PESEL, numer dokumentu tożsamości, podpis — np. pełnomocnictwo, wniosek do OSD). Rola Tylko odczyt pobiera wyłącznie pliki „Standardowy”. Przy rodzaju „Inny dokument” pytamy, czy dokument zawiera PESEL lub numer dokumentu tożsamości („tak” = Dane identyfikacyjne). Klasę pojedynczego dokumentu Administrator i Edytor mogą tylko podnieść | `DocumentKind.confidentiality` (`standard` / `building_security` / `identity_data`); podniesienie klasy — `Document.confidentialityOverride` (do dopisania w modelu przed E6 — uwaga z EVM-004) |
| Korekta płatności | cofnięcie albo poprawka skutku finansowego transzy już wystawionej lub opłaconej: wycofanie faktury, anulowanie faktury, cofnięcie wpłaty, zmiana kwoty transzy wystawionej lub opłaconej, przywrócenie anulowanej transzy, usunięcie transzy. Wykonuje **tylko Administrator** z ponownym uwierzytelnieniem, wyłącznie w panelu. Korektą nie jest wystawienie faktury, odnotowanie wpłaty ani **anulowanie transzy „Planowanej”** (z powodem) — te operacje wykonuje także Edytor (doprecyzowanie decyzji z EVM-002: Edytor anuluje tylko transzę „Planowaną”) | przejścia `invoiced → planned`, `invoiced → cancelled`, `paid → invoiced`, `cancelled → planned`; edycja `amountMinor` w `invoiced` / `paid`; soft delete `PaymentMilestone` — wszystkie: Administrator ze step-upem |
| Dokumenty lokalizacji / klienta | dokument przypisany do lokalizacji (np. dokumentacja budynku od administracji) albo do klienta, a nie do jednego zlecenia — widoczny w każdym zleceniu tej lokalizacji lub tego klienta, bez kopiowania | kotwica `Document`: `Site` albo `Customer` (zamiast `WorkOrder`) |
| Inne zlecenia w tej lokalizacji | wcześniejsze i równoległe zlecenia w tej samej lokalizacji, pokazane w szczegółach zlecenia (tylko panel): numer, tytuł, status, data zamknięcia — bez danych klienta innego zlecenia (scenariusz D) | lista `WorkOrder` po `siteId`, filtrowana tą samą polityką co lista zleceń |
| Oczekuje na numer | szybkie zlecenie zapisane w telefonie, zanim serwer nada mu numer; można już dodawać do niego zdjęcia i wpisy — wyślemy je po utworzeniu zlecenia | zlecenie z `CreateQuickWorkOrder` bez `number` do wyniku `applied` / `duplicate` |
| Wymaga uwagi | stan elementu, który nie trafił do archiwum zlecenia automatycznie i czeka na decyzję człowieka: plik zatrzymany przez skan bezpieczeństwa albo wpis, zdjęcie lub szybkie zlecenie z telefonu odrzucone przy synchronizacji; nic nie znika bez decyzji użytkownika | plik: `StoredFile.state = quarantined`; telefon: wynik mutacji `rejected` ([`offline-sync.md`](../architecture/offline-sync.md)) |

### Pojęcia z planu M1 (dodane w EVM-010)
Pojęcia używane w historyjkach M1 ([`docs/backlog/M1/README.md`](../backlog/M1/README.md)) — bez nowych encji poza wskazanymi w historyjkach.

| Pojęcie | Znaczenie | Nazwa w kodzie |
|---|---|---|
| Do wystawienia | transze w stanie „Planowana” w zleceniach niezamkniętych — faktura (albo proforma) jeszcze nie wystawiona; filtr w Płatnościach (EVM-059) | filtr `status = planned` |
| Ponowne uwierzytelnienie (step-up) | ponowne potwierdzenie tożsamości drugim krokiem przed operacją wrażliwą, gdy ostatnie uwierzytelnienie było ponad 15 min temu (lista operacji — polityka P2) | `403 step_up_required`; `Session.lastAuthenticatedAt` |
| Link aktywacyjny | jednorazowy link do ustawienia hasła i drugiego kroku: dla pierwszego Administratora z polecenia na serwerze (EVM-016), dla pozostałych — z zaproszenia (EVM-024); ważny 72 h; samo otwarcie linku go nie zużywa; dezaktywacja konta unieważnia link, a reaktywacja go nie przywraca (nowy link — „Wyślij zaproszenie ponownie”, W-16) | token zaproszenia (w bazie tylko skrót; w adresie wyłącznie we fragmencie `#…` — tak samo link resetu hasła, EVM-025) |
| Rejestr usunięć | lista identyfikatorów obiektów usuniętych trwale, zanonimizowanych albo zredagowanych (bez danych), przechowywana poza bazą, żeby po odtworzeniu kopii usunięte dane nie wróciły (SR-PRIV-04) | port w `platform`, osobny bucket |
| Zlecenie zamknięte — tylko do odczytu | w zleceniu „Rozliczone” albo „Anulowane” zakres, procesy, etapy, płatności i dane zlecenia są tylko do odczytu; wpisy, media i dokumenty nadal można dodawać (PO-8 z EVM-004) | `409 work_order_closed` |
| Ostatni aktywny Administrator | konto Administratora, którego nie można dezaktywować ani pozbawić roli, bo system zostałby bez Administratora (EVM-027) | `409 last_active_administrator` |

### Pojęcia z makiet E1 (dodane w EVM-015)
Pojęcia, których używają makiety dostępu i administracji ([`11-aktywacja-i-reset-hasla.md`](../ux/flows/11-aktywacja-i-reset-hasla.md), [`12-konto-i-administracja.md`](../ux/flows/12-konto-i-administracja.md), W-02–W-04 w [`01-logowanie-mfa.md`](../ux/flows/01-logowanie-mfa.md)) i treści e-maili ([`e-maile.md`](../ux/flows/e-maile.md)) — bez nowych encji. Nazwy encji danych uwierzytelniających (klucze dostępu, kody z aplikacji, kody odzyskiwania, tokeny linków) ustalają plany historyjek E1 (moduł `identity`, ADR-0005). W UI, e-mailach i dokumentacji dla użytkownika obowiązuje brzmienie z kolumny „Pojęcie”.

| Pojęcie | Znaczenie | Nazwa w kodzie |
|---|---|---|
| Status konta | stan konta pracownika w W-16: **Aktywne** (może się logować), **Oczekuje na aktywację** (konto zaproszone, które nie ustawiło jeszcze hasła i drugiego kroku), **Dezaktywowane** (logowanie i sesje wyłączone; dane i historia zostają; Administrator może konto reaktywować). Reaktywacja przywraca status sprzed dezaktywacji: konto aktywowane wraca do „Aktywne” z dotychczasowymi metodami drugiego kroku (EVM-027 AC2), a konto nigdy nieaktywowane — do „Oczekuje na aktywację” bez działającego linku aktywacyjnego (stan zaproszenia „Unieważniono [data]”; nowy link — tylko osobną operacją „Wyślij zaproszenie ponownie”). Etykiety są bezosobowe — opisują konto, nie osobę; to samo brzmienie mają EVM-016 AC1 i EVM-024 AC1. Blokada konta nie jest statusem | `User.status` (`active` / `invited` / `deactivated`) |
| Stan zaproszenia | co się dzieje z e-mailem z linkiem aktywacyjnym konta „Oczekuje na aktywację” (kolumna „Zaproszenie” w W-16): **Wysyłanie…**, **Wysłano [data] · ważne do [data, godzina]**, **Nie wysłano** (wysyłka nieudana po ponowieniach), **Wygasło [data]**, **Unieważniono [data]** (link unieważniony dezaktywacją konta — widoczne po reaktywacji konta nigdy nieaktywowanego); przy trzech ostatnich „Wyślij ponownie” — nowy link ważny 72 h, poprzedni przestaje działać. Administrator nigdy nie widzi linku ani tokenu | bez osobnego pojęcia w modelu — źródło stanu (ważność tokenu zaproszenia, wysyłka e-maila) ustala plan EVM-024 |
| Nazwa wyświetlana | nazwa pracownika widoczna dla innych użytkowników (np. w dzienniku zlecenia, W-16, W-18); nadaje ją Administrator w zaproszeniu, potem zmienia sam pracownik w W-15; do 200 znaków, zwykły tekst. Nie trafia do e-maili ani do dziennika audytu | `User.displayName` |
| Drugi krok logowania | potwierdzenie tożsamości drugą metodą po haśle — obowiązkowe dla każdej roli (P1). Metody: klucz dostępu i kod z aplikacji uwierzytelniającej; awaryjnie, tylko przy logowaniu — kod odzyskiwania. W UI zawsze „drugi krok logowania” — nie „MFA”, „2FA” ani „uwierzytelnianie dwuskładnikowe” | MFA (ADR-0005); konto bez skonfigurowanego drugiego kroku — `403 mfa_enrollment_required` |
| Klucz dostępu | logowanie bez przepisywania kodu — odciskiem palca, twarzą albo PIN-em urządzenia (np. Windows Hello, telefon) lub kluczem sprzętowym; działa tylko w panelu web. **Jedyna metoda Administratora w panelu** — konto Administratora ma zawsze co najmniej jeden klucz (P1, EVM-028 AC4). Pracownik nadaje kluczowi nazwę (np. „Laptop w biurze”) — zwykły tekst, który nie trafia do e-maili ani do audytu | passkey (WebAuthn, ADR-0005) |
| Kod z aplikacji uwierzytelniającej | jednorazowy kod z aplikacji uwierzytelniającej na telefonie (skrót w UI: „kod z aplikacji”); wymagany do logowania w aplikacji mobilnej. Administrator używa go wyłącznie w aplikacji mobilnej (w panelu — tylko klucz dostępu, P1); Edytor — w panelu i w aplikacji; Tylko odczyt — tylko w panelu, bez informacji o telefonie (P6) | TOTP (RFC 6238, ADR-0005; sekret szyfrowany — P12) |
| Kod odzyskiwania | jeden z 10 jednorazowych kodów zapasowych pokazanych raz (W-03 od EVM-023 albo „Wygeneruj nowe kody” w W-15) — do wydrukowania i przechowania w bezpiecznym miejscu. Zastępuje drugi krok **wyłącznie przy logowaniu** (W-02), gdy metoda jest niedostępna (właściciel konta dostaje e-mail); nowe kody unieważniają poprzednie. **Nie działa w żadnym ponownym uwierzytelnieniu** — ani przy step-upie (EVM-029 AC4), ani przy pełnym ponownym uwierzytelnieniu (decyzja 16, potwierdzona przez Konrada na demo EVM-015 2026-10-04). Logowanie kodem odzyskiwania nie liczy się jako świeże uwierzytelnienie — nie otwiera okna step-upu, więc pierwsza operacja wrażliwa po nim zawsze wymaga klucza dostępu albo kodu z aplikacji (W-02, W-04). Kto po zalogowaniu kodem nie ma już działającej metody, prosi administratora o reset drugiego kroku logowania; Administrator — innego Administratora (EVM-023 AC5), a bez drugiego Administratora pozostaje tryb awaryjny (EVM-016 AC2). Konta aktywowane przed EVM-023 nie mają kodów, dopóki ich nie wygenerują w W-15 | SR-AUTH-08 |
| Pełne ponowne uwierzytelnienie | hasło **i** drugi krok **za każdym razem** (bez okna 15 min) przed zmianą metod drugiego kroku własnego konta: dodanie i usunięcie klucza dostępu albo kodu z aplikacji, nowe kody odzyskiwania (SR-AUTH-10). Drugi krok — klucz dostępu albo kod z aplikacji (Administrator — tylko klucz dostępu); kod odzyskiwania nie działa (decyzja 16). Przy „Zmień hasło” bieżące hasło jest w formularzu, więc dialog pyta już tylko o drugi krok. Różni się od step-upu, który wymaga samego drugiego kroku i tylko wtedy, gdy ostatnie uwierzytelnienie było ponad 15 min temu. Błędne próby liczą się do limitów logowania (SR-AUTH-05). Tylko panel web | dialog W-04 (trzy zastosowania); kod odpowiedzi — plan EVM-028 |
| Blokada konta | tymczasowe (15 min) wstrzymanie logowania po 10 nieudanych próbach w ciągu 15 min — także w ponownym uwierzytelnieniu (SR-AUTH-05). Właściciel konta dostaje e-mail; blokadę zdejmuje upływ czasu albo ustawienie nowego hasła z linku. Komunikat na ekranie nie ujawnia, czy konto istnieje. To nie jest status konta | mechanizm EVM-026 (nie pole `User.status`) |
| Link do ustawienia nowego hasła | jednorazowy link z e-maila po „Nie pamiętasz hasła?” (W-01) — tylko dla aktywnego konta, ważny 30 min, działa tylko najnowszy; samo otwarcie go nie zużywa. Ustawienie hasła kończy wszystkie sesje konta i zdejmuje blokadę, a logowanie i tak wymaga drugiego kroku (W-12 → W-02). Wyjątek: konto bez drugiego kroku po resecie przez Administratora dostaje link i przechodzi do konfiguracji (W-12 → W-03) tylko w oknie konfiguracji; poza nim link nie jest wysyłany | token resetu hasła (w bazie tylko skrót; w adresie wyłącznie we fragmencie `#…`) — EVM-025 |
| Reset drugiego kroku logowania | operacja Administratora (W-16, step-up) po utracie metod drugiego kroku przez pracownika: usuwa wszystkie metody i kody odzyskiwania konta i kończy jego sesje; przy następnym logowaniu konto konfiguruje drugi krok od nowa (W-03) — tylko w **oknie konfiguracji** (długość — plan EVM-027, rekomendacja ≤ 24 h); po jego upływie logowanie kończy się komunikatem „Konfiguracja drugiego kroku wygasła — poproś administratora o ponowny reset.”, a konto nie dostaje linku do ustawienia nowego hasła. Wymaga wskazania, jak potwierdzono tożsamość — osobiście albo w rozmowie wideo (wybór z listy, bez notatki). Drugi krok Administratora resetuje tylko inny Administrator albo tryb awaryjny (decyzja 10) | SR-AUTH-13; EVM-027 AC4 |
| Dziennik audytu | rejestr zdarzeń bezpieczeństwa i operacji wrażliwych: **kto** (osoba, „System” albo „Osoba niezalogowana”), **co** (akcja), **kiedy**, **z jakim wynikiem** („Udane”, „Odmowa”, „Błąd”), **na czym** (obiekt) i **skąd** (prefiks adresu IP — P9). Bez wartości danych osobowych: zapisuje identyfikatory, a nazwy osób panel pokazuje z bieżących danych konta. Tylko do odczytu, wyłącznie dla Administratora po step-upie (W-18); każdy odczyt też trafia do dziennika. Nie mylić z **dziennikiem zlecenia** (historia pracy nad zleceniem) | `AuditEvent` (`actorType`: `user` / `system` / `anonymous`; `outcome`: `success` / `denied` / `failed`); dziennik zlecenia — `TimelineEntry` |
| Alert bezpieczeństwa (dla Administratorów) | e-mail do wszystkich aktywnych Administratorów o zdarzeniu dotyczącym uprawnień administratora — w E1: logowanie Administratora z nowej przeglądarki (EVM-026); nadanie albo odebranie roli Administrator, reaktywacja konta z rolą Administrator i reset drugiego kroku Administratora (EVM-027 AC7); zaproszenie z rolą Administrator, także wysłane ponownie (EVM-024 AC1); zmiana drugiego kroku konta Administratora, także nowe kody odzyskiwania (EVM-028 AC3 i AC5). Alert nie wskazuje osoby — szczegóły są w W-18. Nie mylić z alertem technicznym w kanale alertów monitoringu (EVM-007; np. tryb awaryjny — EVM-016 AC2) | SR-LOG-07; treści — [`e-maile.md`](../ux/flows/e-maile.md) (e-mail 9) |

## Zmiany nazw w kodzie (EVM-002)
Zmiany względem propozycji sprzed EVM-002; pozostałe nazwy potwierdzone bez zmian.

| Pojęcie | Było | Jest | Uzasadnienie |
|---|---|---|---|
| Etap płatności | `PaymentMilestone`; status z wartością „po terminie” | `PaymentMilestone` (status: `PaymentMilestoneStatus`: planowana / wystawiona / opłacona / anulowana; wyliczane `isOverdue`) | „po terminie” zależy od daty, więc jest wyliczane przy odczycie (bez zadania cyklicznego zmieniającego dane); „anulowana” potrzebna przy korektach i anulowaniu zlecenia |
| Status etapu | `StageStatus`; wartość „czekamy na stronę trzecią” | `StageStatus` (`todo`, `in_progress`, `waiting`, `blocked`, `done`, `not_applicable`); `waiting` = „Czekamy na…” | czekamy także na klienta (pełnomocnictwo, termin montażu, opłata przyłączeniowa), a klient nie jest „stroną”; na kogo — pole `waitingOn`. Etykieta w styleguide: „Czekamy na…” (decyzja Konrada P1 z EVM-002; styleguide 1.1.0, EVM-004) |
| Dziennik | `Timeline` / `TimelineEntry` | `TimelineEntry` (tabela); `Timeline` — widok | dziennik zlecenia to zapytanie po wpisach, nie osobny obiekt do przechowywania |
| Wpis / komentarz | `Note` / `Comment` | `TimelineEntry` z `kind` = `note` / `comment` | jedna tabela tylko do dopisywania dla wpisów, komentarzy i zdarzeń — jedna polityka synchronizacji offline i kolejności; nazwy `Note` / `Comment` zostają w komendach mobilnych |
| Dokument | `Document` | `Document` + `DocumentVersion` (rodzaj: `DocumentKind`) | wersje dokumentów od v1 (bez przebudowy w M3); rodzaj dokumentu jako konfiguracja z poziomem poufności |
| Strona / kontrahent | `Party` | `Party` (rodzaj: `PartyKind`) | jawny słownik rodzajów; dodany dostawca i rzeczoznawca do ekspertyz (dane startowe) |
| OSD | `DistributionSystemOperator` | `Party` z `kind` = `distribution_system_operator` | OSD to rodzaj kontrahenta, nie osobna encja — „czekamy na OSD” to filtr, bez specjalnych przypadków w kodzie |
| Wallbox / ładowarka AC / DC | `Charger` (`acPowerKw`, `type`) | `Charger` (`powerKw`, `currentType`: `ac` / `dc`) | jedna nazwa mocy dla AC i DC (stacja DC w M7 bez zmiany schematu); `type` zbyt ogólne i koliduje z nazwami technicznymi |
| Ekspertyza | rodzaj `Document` / etap | `DocumentKind` `technical_assessment`; proces `technical_assessment` | doprecyzowanie: stałe kody rodzaju dokumentu i szablonu procesu |
| Opinia ppoż | rodzaj `Document` / etap | `DocumentKind` `fire_safety_opinion`; proces `fire_safety_opinion` | doprecyzowanie: stałe kody rodzaju dokumentu i szablonu procesu; poufność `building_security` |
| Warunki przyłączenia | rodzaj `Document` | `DocumentKind` `connection_conditions`; etap `connection_conditions` procesu `dso_connection` | doprecyzowanie: stały kod rodzaju dokumentu i etapu, na którym dokument powstaje |
| Pełnomocnictwo | rodzaj `Document` | `DocumentKind` `power_of_attorney` | doprecyzowanie: stały kod rodzaju dokumentu; poufność `identity_data` (dane identyfikacyjne) |

## Scenariusze walidujące model
Model (EVM-002) musi obsłużyć te scenariusze bez specjalnych przypadków w kodzie (przejście scenariuszy przez model: [`domain-model.md`](../architecture/domain-model.md#walidacja-scenariuszy-af); szablony A–D: [`service-catalog.md`](service-catalog.md#5-szablony-zleceń)):
- **A. Dom — sam montaż:** klient ma własną ładowarkę i gotowe zasilanie; tylko montaż i uruchomienie, jedna płatność.
- **B. Dom — pełny pakiet:** zwiększenie mocy (proces z OSD), nowy obwód dedykowany, ładowarka z oferty, montaż, pomiary; płatność zaliczka + końcowa.
- **C. Garaż podziemny — pełny proces:** dokumentacja od administracji → ekspertyza → opinia ppoż → projekt → uzgodnienia z OSD → zgoda administracji/wspólnoty → instalacja → montaż → pomiary i odbiór; płatności etapowe; dużo zdjęć bez zasięgu.
- **D. Garaż — sama instalacja pod wallbox:** bez montażu urządzenia (klient zamówi później — kolejne zlecenie powiązane z tą samą lokalizacją).
- **E. (przyszłość) Inwestycja deweloperska:** 100+ miejsc, instalacja przygotowawcza + montaże na zamówienie mieszkańców; raport postępu dla dewelopera.
- **F. (przyszłość) Stacja DC:** przyłącze o dużej mocy, UDT, projekt, harmonogram, podwykonawcy.
