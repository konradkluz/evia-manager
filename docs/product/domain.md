# Domena — słownik i model zleceń

> Właściciele: `product-owner` (pojęcia) i `solution-architect` (model w kodzie). Nazwy w kodzie to **propozycja do potwierdzenia w EVM-002**.

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

**Dlaczego tak:** dowolna kombinacja usług bez programowania nowych typów, a jednocześnie struktura, która pozwala filtrować i raportować („wszystkie zlecenia czekające na OSD > 14 dni”, „nieopłacone etapy”). **W MVP** katalog i szablony są danymi startowymi (konfiguracja), a edytor dla administratora powstaje w M4 — bez przepisywania modelu. **Czego unikamy:** własnego silnika BPMN i w pełni dowolnych formularzy w MVP.

## Słownik
| Pojęcie | Znaczenie | Nazwa w kodzie (propozycja) |
|---|---|---|
| Klient | osoba lub firma zamawiająca usługę | `Customer` (nie `Client` — koliduje z „HTTP client”) |
| Lokalizacja / obiekt | miejsce realizacji: adres, typ obiektu, numer miejsca postojowego, zarządca | `Site` |
| Typ obiektu | dom jednorodzinny, garaż w budynku wielorodzinnym, obiekt komercyjny… | `SiteType` |
| Zlecenie | jednostka pracy dla klienta w lokalizacji | `WorkOrder` (nie `Order` — koliduje z zamówieniem ładowarki i sortowaniem; nie `Job` — koliduje z zadaniami w tle) |
| Szablon zlecenia | predefiniowany zestaw pozycji zakresu i procesów | `WorkOrderTemplate` |
| Katalog usług / pozycja zakresu | klocek usługi i jego wystąpienie w zleceniu | `ServiceCatalogItem` / `ScopeItem` |
| Proces | ścieżka formalna lub realizacyjna złożona z etapów | `Procedure` (nie `Process` / `Workflow` — kolizje techniczne) |
| Etap | krok procesu ze statusem, datami, odpowiedzialnym | `ProcedureStage` |
| Status etapu | np. do zrobienia, w toku, czekamy na stronę trzecią, zakończony, nie dotyczy, zablokowany | `StageStatus` |
| Etap płatności | transza do zapłaty: nazwa, kwota, nr faktury, termin, status (planowana / wystawiona / opłacona / po terminie) | `PaymentMilestone` |
| Dziennik | chronologiczna historia zlecenia: wpisy, komentarze, zmiany statusów | `Timeline` / `TimelineEntry` |
| Wpis / komentarz | notatka (rozmowa, ustalenie) / komentarz użytkownika | `Note` / `Comment` |
| Media | zdjęcie lub film z metadanymi (kategoria, autor, czas, etap) | `MediaAsset` |
| Dokument | plik formalny (projekt, ekspertyza, zgoda, warunki przyłączenia, protokół) z wersjami | `Document` |
| Strona / kontrahent | administracja, zarządca, wspólnota, projektant, rzeczoznawca ppoż, OSD, podwykonawca | `Party` |
| OSD | Operator Systemu Dystrybucyjnego, np. Stoen Operator (Warszawa); **nie zaszywamy „Stoen” w kodzie** | `DistributionSystemOperator` |
| Moc przyłączeniowa | moc umowna przyłącza [kW]; jej zwiększenie wymaga procesu z OSD | `connectionPowerKw` |
| PPE | punkt poboru energii (identyfikator u OSD) | `meteringPointId` |
| WLZ | wewnętrzna linia zasilająca w budynku wielorodzinnym | `internalSupplyLine` |
| Obwód dedykowany | osobny obwód zasilający ładowarkę | `dedicatedCircuit` |
| Wallbox / ładowarka AC / DC | urządzenie ładujące; DC — duża moc, inne procedury | `Charger` (`acPowerKw`, `type`) |
| Ekspertyza | ocena techniczna możliwości instalacji (np. w garażu) | rodzaj `Document` / etap |
| Opinia ppoż | opinia rzeczoznawcy ds. zabezpieczeń przeciwpożarowych | rodzaj `Document` / etap |
| Warunki przyłączenia | dokument OSD określający warunki zmiany przyłącza | rodzaj `Document` |
| Pełnomocnictwo | umocowanie firmy do działania w imieniu klienta (np. wobec OSD) | rodzaj `Document` |
| Inwestycja (przyszłość) | projekt deweloperski grupujący budynki, garaże i miejsca postojowe | `Investment` |
| UDT (przyszłość) | Urząd Dozoru Technicznego — procedury dla wybranych stacji ładowania (np. ogólnodostępnych) | etap procesu |

## Scenariusze walidujące model
Model (EVM-002) musi obsłużyć te scenariusze bez specjalnych przypadków w kodzie:
- **A. Dom — sam montaż:** klient ma własną ładowarkę i gotowe zasilanie; tylko montaż i uruchomienie, jedna płatność.
- **B. Dom — pełny pakiet:** zwiększenie mocy (proces z OSD), nowy obwód dedykowany, ładowarka z oferty, montaż, pomiary; płatność zaliczka + końcowa.
- **C. Garaż podziemny — pełny proces:** dokumentacja od administracji → ekspertyza → opinia ppoż → projekt → uzgodnienia z OSD → zgoda administracji/wspólnoty → instalacja → montaż → pomiary i odbiór; płatności etapowe; dużo zdjęć bez zasięgu.
- **D. Garaż — sama instalacja pod wallbox:** bez montażu urządzenia (klient zamówi później — kolejne zlecenie powiązane z tą samą lokalizacją).
- **E. (przyszłość) Inwestycja deweloperska:** 100+ miejsc, instalacja przygotowawcza + montaże na zamówienie mieszkańców; raport postępu dla dewelopera.
- **F. (przyszłość) Stacja DC:** przyłącze o dużej mocy, UDT, projekt, harmonogram, podwykonawcy.
