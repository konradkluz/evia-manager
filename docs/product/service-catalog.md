# Katalog usług, szablony procesów i zleceń — dane startowe

> Dokument żywy (EVM-002). Właściciele: `product-owner` (treść), `solution-architect` (struktura). **Zaakceptowane przez Konrada 2026-10-03** na demo EVM-002, razem z rekomendacjami z [§ 8](#8-założenia-do-weryfikacji-przez-konrada) (weryfikacja biznesowa `product-owner`: 2026-10-03). Dane wyłącznie syntetyczne: **bez klientów, adresów, osób kontaktowych, telefonów, e-maili, NIP-ów, numerów PPE, cen i kwot** — plany płatności podają tylko udział procentowy. OSD występuje wyłącznie jako rodzaj strony (kontrahenta), bez danych kontaktowych. Założenia o procesach OSD i administracji są oznaczone „do weryfikacji przez Konrada”; informacje publiczne, na których się opierają — [rozdział 9](#9-źródła-do-weryfikacji). W UI kontrahenta nazywamy „stroną” (styleguide § 6.2). Model: [`../architecture/domain-model.md`](../architecture/domain-model.md) (decyzje D1, D2); słownik: [`domain.md`](domain.md).

## Jak czytać
- **Kody** (`snake_case`, po angielsku) są stałe — używają ich raporty i filtry. **Nazwy** można zmieniać.
- Utworzenie zlecenia **kopiuje** pozycje, procesy z etapami i plan płatności z szablonu. Późniejsza zmiana szablonu nie zmienia istniejących zleceń; w zleceniu wszystko można zmienić (dodać, usunąć, przestawić).
- Pozycja katalogu **wnosi procesy**; ten sam proces wniesiony przez kilka pozycji powstaje w zleceniu raz (np. „Uzgodnienia z OSD”).
- „Domyślnie czekamy na” to podpowiedź dla UI przy oznaczaniu etapu jako „Czekamy na…”, a nie automatyka.
- Wdrożenie: w MVP dane trafiają do systemu migracją danych w M1 (E3, E4), idempotentnie po `code`; edytor dla Administratora powstaje w M4.

## 1. Kategorie usług
| Kod | Nazwa |
|---|---|
| `equipment` | Urządzenia |
| `installation` | Instalacja i montaż |
| `formal` | Formalności i uzgodnienia |
| `engineering` | Projekt i ekspertyzy |
| `acceptance` | Pomiary i odbiór |
| `other` | Inne |

## 2. Katalog usług
| Kod | Nazwa | Kategoria | Zestaw parametrów | Wnoszone procesy |
|---|---|---|---|---|
| `charger_supply` | Dostawa ładowarki (z oferty) | `equipment` | `charger_spec` | `charger_procurement` |
| `customer_charger` | Ładowarka klienta | `equipment` | `charger_spec` | `customer_charger_check` |
| `charger_installation` | Montaż i uruchomienie ładowarki | `installation` | `charger_installation` | `charger_installation` |
| `supply_installation` | Instalacja zasilająca (obwód dedykowany lub istniejący) | `installation` | `supply_circuit` | `electrical_installation` |
| `connection_power_increase` | Zwiększenie mocy przyłączeniowej | `formal` | `connection_power` | `dso_connection` |
| `dso_agreement` | Uzgodnienia z OSD | `formal` | `dso_request` | `dso_connection` |
| `building_management_approval` | Zgody administracji / wspólnoty | `formal` | — | `building_management_approval` |
| `technical_assessment` | Ekspertyza techniczna | `engineering` | — | `technical_assessment` |
| `fire_safety_opinion` | Opinia ppoż | `engineering` | — | `fire_safety_opinion` |
| `installation_design` | Projekt instalacji | `engineering` | — | `installation_design` |
| `measurements_acceptance` | Pomiary i odbiór | `acceptance` | — | `measurements_acceptance` |
| `custom_service` | Inna usługa (opis w zleceniu) | `other` | — | — |

## 3. Zestawy parametrów technicznych
Schematy w kodzie (Zod), ścisłe — **tylko wartości techniczne**; dane osobowe i identyfikatory (PPE, numery liczników, adresy, numery miejsc postojowych) są w kolumnach klienta i lokalizacji. Nowy zestaw parametrów wymaga zmiany kodu; nowa pozycja katalogu — nie.

| Zestaw | Parametry (typ; wymagany?) |
|---|---|
| `charger_spec` | `currentType` (`ac` / `dc`; tak), `powerKw` (liczba; tak), `phases` (1 / 3; dla AC), `outlet` (`socket` / `tethered_cable`), `manufacturer` (tekst), `model` (tekst) |
| `charger_installation` | `mountingType` (`wall` / `pedestal`), `loadBalancing` (tak / nie), `networkConnection` (`none` / `wifi` / `lan` / `lte`) |
| `supply_circuit` | `dedicatedCircuit` (tak / nie; tak), `internalSupplyLine` (zasilanie z WLZ budynku; tak / nie), `cableLengthM` (liczba), `cableCrossSectionMm2` (liczba), `residualCurrentDeviceType` (`a` / `a_ev` / `b`), `overcurrentProtectionA` (liczba) |
| `connection_power` | `requestedConnectionPowerKw` (liczba; tak), `phasesAfter` (1 / 3) |
| `dso_request` | `requestType` (`power_increase` / `new_connection` / `separate_meter` / `other`; tak), `requestedConnectionPowerKw` (liczba) |

## 4. Szablony procesów
„Czekamy na”: **klient** albo **strona** (kontrahent) wskazanego rodzaju (`PartyKind`); „—” = etap po naszej stronie. Etap zbędny w konkretnym zleceniu oznaczamy „Nie dotyczy” (zostaje w historii) albo usuwamy; kolejność etapów można zmienić w zleceniu. Dokumenty wynikowe — kody z [rozdziału 6](#6-rodzaje-dokumentów).

### `charger_procurement` — Zamówienie i dostawa ładowarki
Wnoszony przez: `charger_supply`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `model_confirmation` | Potwierdzenie modelu z klientem | klient | — |
| 2 | `supplier_order` | Zamówienie u dostawcy | — | — |
| 3 | `delivery` | Dostawa ładowarki | strona: dostawca (`supplier`) | — |

### `customer_charger_check` — Weryfikacja ładowarki klienta
Wnoszony przez: `customer_charger`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `compatibility_check` | Weryfikacja modelu i parametrów urządzenia | klient | — |
| 2 | `device_availability` | Urządzenie dostępne na miejscu montażu | klient | — |

### `electrical_installation` — Instalacja zasilająca
Wnoszony przez: `supply_installation`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `site_survey` | Oględziny i pomiar trasy | — | — |
| 2 | `installation_work` | Wykonanie instalacji | — | — |
| 3 | `protection_connection` | Zabezpieczenia i podłączenie | — | — |

### `charger_installation` — Montaż i uruchomienie
Wnoszony przez: `charger_installation`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `scheduling` | Umówienie terminu montażu | klient | — |
| 2 | `mounting` | Montaż ładowarki | — | — |
| 3 | `commissioning` | Konfiguracja i uruchomienie | — | `commissioning_report` |
| 4 | `handover` | Instruktaż i przekazanie klientowi | — | — |

### `dso_connection` — Uzgodnienia z OSD
Wnoszony przez: `connection_power_increase`, `dso_agreement`. **Do weryfikacji przez Konrada:** kolejność etapów, czy firma składa wniosek jako pełnomocnik, kto podpisuje umowę lub aneks ([założenie 1](#8-założenia-do-weryfikacji-przez-konrada)). Przebieg oparty na publicznych informacjach OSD ([rozdział 9](#9-źródła-do-weryfikacji)): warunki przyłączenia wydawane razem z projektem umowy (dla przyłączy do 40 kW — do 21 dni), opłata przyłączeniowa po stronie klienta, zgłoszenie gotowości instalacji przez instalatora, na końcu licznik i załączenie przez OSD. Etapy, które w danym zleceniu nie występują (np. prace sieciowe OSD przy samej wymianie zabezpieczenia), oznaczamy „Nie dotyczy”.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `power_of_attorney` | Pełnomocnictwo od klienta | klient | `power_of_attorney` |
| 2 | `dso_application` | Wniosek do OSD (warunki przyłączenia / zmiana mocy) | — | `dso_application` |
| 3 | `connection_conditions` | Warunki przyłączenia i projekt umowy | strona: OSD (`distribution_system_operator`) | `connection_conditions` |
| 4 | `dso_agreement_signed` | Umowa z OSD podpisana, opłata przyłączeniowa wniesiona | klient | `dso_agreement` |
| 5 | `dso_works` | Prace sieciowe po stronie OSD (jeśli wymagane, np. przebudowa przyłącza) | strona: OSD (`distribution_system_operator`) | — |
| 6 | `readiness_declaration` | Zgłoszenie gotowości instalacji do OSD | — | `dso_readiness_declaration` |
| 7 | `meter_connection` | Wymiana licznika lub zabezpieczenia i załączenie przez OSD | strona: OSD (`distribution_system_operator`) | — |

### `building_management_approval` — Zgody administracji / wspólnoty
Wnoszony przez: `building_management_approval`. **Do weryfikacji przez Konrada:** dokumentacja na początku i zgoda na końcu w jednym procesie (kolejność ze scenariusza C); czy uchwała wspólnoty wymaga osobnego etapu ([założenie 2](#8-założenia-do-weryfikacji-przez-konrada)). Jeden proces na jedną stronę odpowiada na pytanie „na jakim etapie jesteśmy z administracją”. **Tryb ustawowy (do weryfikacji, [rozdział 9](#9-źródła-do-weryfikacji)):** wniosek o zgodę na punkt ładowania na miejscu postojowym składa osoba uprawniona do lokalu i miejsca; zarząd zleca ekspertyzę w ciągu 30 dni (na koszt wnioskodawcy) i rozpatruje wniosek w ciągu 30 dni od jej otrzymania; dla mocy od 11 kW potrzebna jest uchwała właścicieli. W tym trybie wniosek o zgodę (etap 3) przesuwamy w zleceniu przed ekspertyzę.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `building_docs_request` | Wniosek o dokumentację budynku | — | — |
| 2 | `building_docs_received` | Dokumentacja budynku otrzymana | strona: administracja (`building_administration`) | `building_documentation` |
| 3 | `consent_request` | Wniosek o zgodę na instalację (z projektem i opiniami) | — | — |
| 4 | `consent_received` | Zgoda administracji / uchwała wspólnoty | strona: wspólnota / spółdzielnia (`housing_community`) | `building_management_consent` |

### `technical_assessment` — Ekspertyza techniczna
Wnoszony przez: `technical_assessment`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `expert_order` | Zlecenie ekspertyzy | — | — |
| 2 | `site_inspection` | Wizja lokalna rzeczoznawcy | strona: rzeczoznawca (`technical_expert`) | — |
| 3 | `assessment_received` | Ekspertyza otrzymana | strona: rzeczoznawca (`technical_expert`) | `technical_assessment` |

### `fire_safety_opinion` — Opinia ppoż
Wnoszony przez: `fire_safety_opinion`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `expert_order` | Zlecenie opinii rzeczoznawcy ppoż | — | — |
| 2 | `opinion_received` | Opinia ppoż otrzymana | strona: rzeczoznawca ppoż (`fire_safety_expert`) | `fire_safety_opinion` |

### `installation_design` — Projekt instalacji
Wnoszony przez: `installation_design`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `design_order` | Zlecenie projektu | — | — |
| 2 | `design_received` | Projekt otrzymany | strona: projektant (`designer`) | `installation_design` |

### `measurements_acceptance` — Pomiary i odbiór
Wnoszony przez: `measurements_acceptance`.
| Lp. | Kod etapu | Etap | Domyślnie czekamy na | Dokument wynikowy |
|---|---|---|---|---|
| 1 | `electrical_measurements` | Pomiary elektryczne | — | `measurement_report` |
| 2 | `acceptance` | Odbiór z klientem | klient | `acceptance_report` |

## 5. Szablony zleceń
Udziały transz i terminy płatności są **przykładowe**; kwotę transzy wpisuje biuro w zleceniu (brutto do zapłaty). „Kiedy wystawiamy” to podpowiedź, nie automatyka. Termin płatności liczony od daty wystawienia faktury.

### „Dom — pełny pakiet” (`house_full_package`)
Typ obiektu (podpowiedź): dom jednorodzinny. Scenariusz B.

Pozycje zakresu (kolejno): `connection_power_increase` → `supply_installation` (`dedicatedCircuit` = tak) → `charger_supply` → `charger_installation` → `measurements_acceptance`.
Procesy w zleceniu: `dso_connection`, `electrical_installation`, `charger_procurement`, `charger_installation`, `measurements_acceptance`.

**Plan płatności**
| Nr | Kod | Transza | Udział | Kiedy wystawiamy | Termin |
|---|---|---|---|---|---|
| 1 | `advance` | Zaliczka | 30% | przy akceptacji zlecenia | 7 dni |
| 2 | `final` | Płatność końcowa | 70% | po odbiorze | 14 dni |

### „Dom — sam montaż” (`house_installation_only`)
Typ obiektu (podpowiedź): dom jednorodzinny. Scenariusz A.

Pozycje zakresu: `customer_charger` → `charger_installation` → `measurements_acceptance` ([założenie 6](#8-założenia-do-weryfikacji-przez-konrada)).
Procesy w zleceniu: `customer_charger_check`, `charger_installation`, `measurements_acceptance`.

**Plan płatności**
| Nr | Kod | Transza | Udział | Kiedy wystawiamy | Termin |
|---|---|---|---|---|---|
| 1 | `final` | Płatność za montaż | 100% | po uruchomieniu | 7 dni |

### „Garaż — pełny proces” (`garage_full_process`)
Typ obiektu (podpowiedź): garaż w budynku wielorodzinnym. Scenariusz C.

Pozycje zakresu: `building_management_approval` → `technical_assessment` → `fire_safety_opinion` → `installation_design` → `dso_agreement` → `supply_installation` (`dedicatedCircuit` = tak, `internalSupplyLine` = tak) → `charger_supply` → `charger_installation` → `measurements_acceptance`.
Procesy w zleceniu: `building_management_approval`, `technical_assessment`, `fire_safety_opinion`, `installation_design`, `dso_connection`, `electrical_installation`, `charger_procurement`, `charger_installation`, `measurements_acceptance`.

**Plan płatności**
| Nr | Kod | Transza | Udział | Kiedy wystawiamy | Termin |
|---|---|---|---|---|---|
| 1 | `advance` | Zaliczka | 20% | przy akceptacji zlecenia | 7 dni |
| 2 | `approvals` | Po uzyskaniu zgód i uzgodnień | 30% | po zgodzie administracji i warunkach OSD | 14 dni |
| 3 | `installation` | Po wykonaniu instalacji | 30% | po zakończeniu instalacji zasilającej | 14 dni |
| 4 | `final` | Płatność końcowa | 20% | po odbiorze | 14 dni |

### „Garaż — sama instalacja” (`garage_installation_only`)
Typ obiektu (podpowiedź): garaż w budynku wielorodzinnym. Scenariusz D (pierwsze zlecenie — instalacja pod wallbox bez urządzenia). **Do weryfikacji przez Konrada:** przyjęto, że szablon obejmuje formalności (bez nich instalacji w garażu zwykle nie da się wykonać); w zleceniu można je usunąć.

Pozycje zakresu: `building_management_approval` → `technical_assessment` → `fire_safety_opinion` → `installation_design` → `dso_agreement` → `supply_installation` (`dedicatedCircuit` = tak, `internalSupplyLine` = tak) → `measurements_acceptance`.
Procesy w zleceniu: jak „Garaż — pełny proces” bez `charger_procurement` i `charger_installation`.

**Plan płatności**
| Nr | Kod | Transza | Udział | Kiedy wystawiamy | Termin |
|---|---|---|---|---|---|
| 1 | `advance` | Zaliczka | 30% | przy akceptacji zlecenia | 7 dni |
| 2 | `approvals` | Po uzyskaniu zgód i uzgodnień | 30% | po zgodzie administracji i warunkach OSD | 14 dni |
| 3 | `final` | Płatność końcowa | 40% | po odbiorze instalacji | 14 dni |

### „Garaż — montaż ładowarki” (`garage_charger_installation`)
Typ obiektu (podpowiedź): garaż w budynku wielorodzinnym. Scenariusz D (drugie zlecenie w tej samej lokalizacji, gdy klient zamówi urządzenie). Szablon dodatkowy — poza czterema wymaganymi.

Pozycje zakresu: `charger_supply` → `charger_installation` (dla urządzenia klienta: `customer_charger` zamiast `charger_supply`).
Procesy w zleceniu: `charger_procurement`, `charger_installation`.

**Plan płatności**
| Nr | Kod | Transza | Udział | Kiedy wystawiamy | Termin |
|---|---|---|---|---|---|
| 1 | `final` | Płatność za urządzenie i montaż | 100% | po uruchomieniu | 7 dni |

## 6. Rodzaje dokumentów
Poufność (atrybut `DocumentKind.confidentiality`) jest podstawą polityk dla roli Tylko odczyt i telefonu (decyzje w EVM-005): `identity_data` — dane identyfikacyjne osób; `building_security` — informacje istotne dla bezpieczeństwa budynku; `standard` — pozostałe (nadal mogą zawierać dane osobowe). Kryterium: dokument zawierający PESEL lub numer dokumentu tożsamości (np. formularz OSD z danymi i podpisem klienta) ma klasę `identity_data`. Oferta (`quote`) i umowa z klientem (`customer_contract`) dotyczą całego zlecenia (status „Wycena” / „Zaakceptowane”), dlatego nie są dokumentami wynikowymi żadnego etapu.

| Kod | Nazwa | Poufność |
|---|---|---|
| `power_of_attorney` | Pełnomocnictwo | `identity_data` |
| `dso_application` | Wniosek do OSD | `identity_data` |
| `connection_conditions` | Warunki przyłączenia | `standard` |
| `dso_agreement` | Umowa / aneks z OSD | `identity_data` |
| `dso_readiness_declaration` | Zgłoszenie gotowości instalacji do OSD | `identity_data` |
| `customer_contract` | Umowa z klientem | `identity_data` |
| `quote` | Oferta / wycena | `standard` |
| `technical_assessment` | Ekspertyza techniczna | `building_security` |
| `fire_safety_opinion` | Opinia ppoż | `building_security` |
| `installation_design` | Projekt instalacji | `building_security` |
| `building_documentation` | Dokumentacja budynku (od administracji) | `building_security` |
| `building_management_consent` | Zgoda administracji / uchwała wspólnoty | `standard` |
| `measurement_report` | Protokół pomiarów | `standard` |
| `commissioning_report` | Protokół uruchomienia | `standard` |
| `acceptance_report` | Protokół odbioru | `standard` |
| `other` | Inny dokument | `standard` |

## 7. Słowniki w kodzie (etykiety do akceptacji)
Wartości są stałe w kodzie (nowa wartość = zmiana kodu, typ *expand*); etykiety polskie do akceptacji. Statusy zlecenia, etapu i etapu płatności — [`domain-model.md`](../architecture/domain-model.md#stany-i-przejścia).

| Słownik | Wartości (kod — etykieta) |
|---|---|
| `SiteType` (typ obiektu) | `single_family_house` — Dom jednorodzinny; `multi_family_garage` — Garaż w budynku wielorodzinnym; `commercial` — Obiekt komercyjny; `other` — Inny |
| `PartyKind` (rodzaj strony) | `building_administration` — Administracja; `property_manager` — Zarządca; `housing_community` — Wspólnota / spółdzielnia; `designer` — Projektant; `fire_safety_expert` — Rzeczoznawca ppoż; `technical_expert` — Rzeczoznawca (ekspertyza); `distribution_system_operator` — OSD; `subcontractor` — Podwykonawca; `supplier` — Dostawca; `other` — Inny |
| `MediaCategory` (kategoria mediów) | `site_survey` — Oględziny; `before_work` — Stan przed pracami; `in_progress` — W trakcie prac; `completed_work` — Po zakończeniu; `defect` — Usterka / problem; `measurement` — Pomiary; `other` — Inne |
| kategoria wpisu (`noteCategory`) | `phone_call` — Rozmowa telefoniczna; `meeting` — Spotkanie; `arrangement` — Ustalenie; `site_visit` — Wizyta na miejscu; `other` — Inne |

## 8. Założenia do weryfikacji przez Konrada
Każde założenie ma rekomendowaną odpowiedź — „akceptuję rekomendacje” zamyka listę. Zmiana któregokolwiek punktu to zmiana danych startowych (bez zmiany modelu i kodu).

**Decyzja (Konrad, 2026-10-03):** rekomendacje 1–8 przyjęte. Rekomendacja 6 jest uwzględniona w szablonie „Dom — sam montaż” (§ 5). Udziały transz pozostają przykładowe, dopóki Konrad nie poda typowych (założenie 5).

| # | Założenie / pytanie | Rekomendacja | Konsekwencja innego wyboru |
|---|---|---|---|
| 1 | Przebieg **uzgodnień z OSD**: 7 etapów (pełnomocnictwo → wniosek → warunki i projekt umowy → umowa i opłata przyłączeniowa → prace OSD → zgłoszenie gotowości → licznik i załączenie). Firma działa wobec OSD jako **pełnomocnik klienta**; umowę z OSD podpisuje klient. Zmiana umowy kompleksowej lub dystrybucyjnej klienta (nowa moc) — wpis w dzienniku, bez osobnego etapu. | przyjąć | gdy klient składa wniosek sam: etap 1 „Nie dotyczy”, etap 2 czeka na klienta; gdy opóźnienia w zmianie umowy kompleksowej są częste — dodajemy etap (bez kodu) |
| 2 | **Zgody administracji / wspólnoty** — jeden proces: dokumentacja na początku, zgoda na końcu (kolejność ze scenariusza C). Tryb ustawowy (ekspertyzę zleca zarząd, terminy 30 + 30 dni, od 11 kW uchwała) obsługujemy przestawieniem etapów w zleceniu. | przyjąć; Konrad potwierdza, jak pracujemy w praktyce (sami zlecamy ekspertyzę czy robi to zarząd) | jeśli zwykle działamy w trybie ustawowym — w szablonie przestawiamy „Wniosek o zgodę” przed ekspertyzę, a w ekspertyzie „czekamy na” = administracja; automatyczne terminy (30 dni) dopiero w M3 |
| 3 | **„Garaż — sama instalacja”** obejmuje formalności (ekspertyza, opinia ppoż, projekt, OSD, zgody). | przyjąć — bez formalności instalacji w garażu zwykle nie da się wykonać | szablon bez formalności = szybszy start, ale ryzyko pominięcia zgód; zbędne pozycje i tak usuwa się w zleceniu |
| 4 | **Ekspertyza i opinia ppoż** zawsze w szablonach garażowych. | przyjąć; gdy nie są wymagane — „Nie dotyczy” w zleceniu | usunięcie z szablonu = częstsze ręczne dodawanie w zleceniu |
| 5 | **Udziały transz i terminy płatności** są przykładowe (30/70, 100, 20/30/30/20, 30/30/40, 100; 7 i 14 dni). | Konrad podaje typowe udziały i terminy; do tego czasu przyjąć przykładowe | — (kwoty zawsze wpisuje biuro w zleceniu) |
| 6 | **„Dom — sam montaż”** bez osobnych pomiarów (wystarcza protokół uruchomienia). | **dodać** pozycję „Pomiary i odbiór” — protokół pomiarów po podłączeniu urządzenia chroni firmę przy reklamacji i gwarancji producenta | bez pomiarów proces jest krótszy, ale brak dowodu sprawdzenia instalacji; scenariusz A w obu wariantach bez specjalnych przypadków |
| 7 | Osobna usługa **„Oględziny przed wyceną”**. | nie w MVP — oględziny dokumentujemy w statusie „Wycena” wpisem (kategoria „Wizyta na miejscu”) i zdjęciami (kategoria „Oględziny”) | osobna pozycja katalogu, gdy oględziny będą płatne lub planowane jako osobna wizyta (dodanie bez kodu) |
| 8 | Piąty szablon **„Garaż — montaż ładowarki”** dla drugiego zlecenia w scenariuszu D. | zostawić | bez szablonu drugie zlecenie trzeba składać ręcznie z pozycji katalogu |

## 9. Źródła (do weryfikacji)
Informacje publiczne użyte w propozycji procesów; sprawdzone 2026-10-03, **do weryfikacji przez Konrada** (praktyka może się różnić od opisów, a przepisy — zmieniać).
- OSD — przyłączenie stacji ładowania i zmiana mocy (terminy wydania warunków przyłączenia wg grup, projekt umowy, opłata przyłączeniowa, zgłoszenie gotowości instalacji, montaż licznika i załączenie): [stoen.pl — Chcę przyłączyć stację ładowania](https://www.stoen.pl/strona/chce-przylaczyc-stacje-ladowania).
- Zgoda na punkt ładowania w budynku wielorodzinnym (art. 12b ustawy o elektromobilności i paliwach alternatywnych — ekspertyza zlecana przez zarząd w 30 dni, decyzja w 30 dni, próg 11 kW): [cclaw.com.pl — Budowa stacji ładowania w budynkach wielorodzinnych](https://cclaw.com.pl/publikacje/budowa-stacji-ladowania-w-budynkach-wielorodzinnych-prawo-i-procedury/), [prawo-budowlane.info — Punkt ładowania w garażu w świetle ustawy o elektromobilności](https://www.prawo-budowlane.info/punkt-ladowania-w-garazu-w-swietle-ustawy-o-elektromobilnosci,929,material_prawo_budowlane.html). Dokładne brzmienie progu mocy (poniżej 11 kW — zgoda zarządu; od 11 kW — uchwała) do sprawdzenia w tekście ustawy.
