---
id: EVM-047
title: Dokumenty z rodzajem i klasą poufności
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: draft
priority: P1
owner: backend-developer
contributors: [web-developer, security-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer, solution-architect]
depends_on: [EVM-045]
---

# EVM-047: Dokumenty z rodzajem i klasą poufności

## Historyjka
Jako **pracownik biura** chcę **dodawać do zlecenia dokumenty (warunki przyłączenia, pełnomocnictwo, projekt) z rodzajem i klasą poufności**, aby **dokumentacja formalna była przy zleceniu, a dokumenty z danymi identyfikacyjnymi i bezpieczeństwem budynku widziały tylko uprawnione osoby**.

## Kontekst
- Model: `Document`, `DocumentVersion` (wersja 1), `DocumentKind.confidentiality` (`standard` < `building_security` < `identity_data`); P6 (Tylko odczyt pobiera tylko `standard`), SR-AUTHZ-07, AB-20.
- **`Document.confidentialityOverride`** (luka L4, uwaga 6 EVM-004, konsultacja `solution-architect` B4): kolumna w pierwszej migracji `media.documents`; ta historyjka aktualizuje `domain-model.md` (porządek klas, tylko podniesienie, kto ustawia, audyt, widoczność w `x-evia-authz`) — bez ADR, przegląd `solution-architect` i `security-engineer`.
- Upload i skan jak media (EVM-044), pobranie jak EVM-045. Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — „Dodaj dokument”, „Dokumenty zlecenia”. Scenariusze: A8, B2, B4, B8, C5, D2.

## Kryteria akceptacji
**AC1 — Dodaj dokument**
- Zakładając zlecenie
- Gdy wybieram „Dodaj dokument”, plik PDF (≤ 100 MB), rodzaj „Warunki przyłączenia” i tytuł
- Wtedy plik przechodzi wysyłanie i skan jak media, a „Dokumenty zlecenia (n)” pokazuje rodzaj, tytuł, wersję 1 i klasę „Standardowy”; w dzienniku powstaje zdarzenie dodania dokumentu (EVM-038).

**AC2 — Klasa z rodzaju**
- Gdy dodaję „Pełnomocnictwo” albo „Projekt instalacji”
- Wtedy klasa to odpowiednio „Dane identyfikacyjne” i „Bezpieczeństwo budynku”, wiersz pokazuje klasę tekstem i ikoną `lock` (klasy ograniczone dla Tylko odczyt).

**AC3 — Inny dokument (SR-AUTHZ-07)**
- Gdy wybieram rodzaj „Inny dokument”
- Wtedy muszę odpowiedzieć na „Czy dokument zawiera PESEL lub numer dokumentu tożsamości?” (brak odpowiedzi — błąd walidacji), a „Tak” ustawia klasę „Dane identyfikacyjne”.

**AC4 — Podniesienie klasy (SR-AUTHZ-07, SR-LOG-03)**
- Zakładając dokument rodzaju „Standardowy”
- Gdy Administrator albo Edytor wybiera „Podnieś klasę” (przy dodawaniu albo z `⋮`)
- Wtedy kontrolka oferuje tylko klasy wyższe niż z rodzaju, próba obniżenia przez API zwraca `400 validation_failed`, a zmiana tworzy zdarzenie audytu.

**AC5 — Pobranie wg klasy (SR-AUTHZ-06, SR-FILE-07)**
- Zakładając dokumenty trzech klas
- Gdy Tylko odczyt prosi o URL każdego z nich
- Wtedy dostaje URL do dokumentu „Standardowy” (pobranie audytowane), a dla „Bezpieczeństwo budynku” i „Dane identyfikacyjne” — `403 forbidden` i w wierszu `lock` „Plik dostępny dla administratora i edytora”; A i E pobierają wszystkie klasy z audytem i `Content-Disposition: attachment`.

**AC6 — Typy dozwolone (SR-FILE-01, SR-FILE-03)**
- Gdy wysyłam plik spoza listy (SVG, HTML, archiwum, `.docm`, `.xlsm`) albo DOCX z makrem lub o zawartości niezgodnej z rozszerzeniem
- Wtedy panel odrzuca go przed wysłaniem albo plik trafia do kwarantanny (makra, niezgodny typ — P5).

**AC7 — Uprawnienia (SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda dodaje dokument i ustawia klasę
- Wtedy A i E dodają i podnoszą klasę, R dostaje `403 forbidden` (brak „Dodaj dokument”), niezalogowany — `401`; dokument zlecenia B ścieżką zlecenia A — `404`; pola serwera (`versionNumber`, stan pliku) są odrzucane (`read_only_field`).

**AC8 — Stany**
- Wtedy: brak dokumentów — „Brak dokumentów. [Dodaj dokument]”; offline — wysyłanie wstrzymane; tytuł i opis wyświetlane jako tekst (SR-WEB-03); `429` przy pobieraniu — komunikat z EVM-045.

## Poza zakresem
- Nowe wersje dokumentu w UI — M3 (model ma wersje od v1). Dokumenty lokalizacji i klienta — EVM-050. Przypisanie do etapu — EVM-048.
- Pisma z szablonów — M3.

## UX / UI
- W-09: dialog „Dodaj dokument” (plik, rodzaj, pytanie o PESEL przy „Inny dokument”, tytuł, klasa z rodzaju, „Podnieś klasę”, opis), tabela „Dokumenty zlecenia” (DataTable § 3.6). Stany: AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | dodanie, podniesienie klasy, pobranie wszystkich klas |
| Edytor | dodanie, podniesienie klasy, pobranie wszystkich klas |
| Tylko odczyt | metadane wszystkich; pobranie tylko „Standardowy” |
| Niezalogowany | brak (`401`) |

- Dane: dokumenty (`identity_data` — PESEL, numer dowodu, podpis; `building_security`), `originalFilename`.
- W AC: SR-AUTHZ-07, SR-LOG-03, SR-AUTHZ-06, SR-FILE-07, SR-FILE-01, SR-FILE-03, SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-WEB-03.
- W sekcji: SR-DATA-01 (klasyfikacja `Document` z nadpisaniem klasy w `domain-model.md` i inwentaryzacja w `rodo.md` — `security-engineer`). Polityka P6.

## Notatki techniczne
- Moduły: `media` (`Document`, `DocumentVersion`), fasada `catalog` (`DocumentKind`), `timeline` + panel.
- Aktualizacja `domain-model.md` (`confidentialityOverride`) i ewentualnie `x-evia-authz` — przegląd `solution-architect` i `security-engineer`.
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
_Uzupełnia wykonawca przed implementacją._

## Decyzje
_—_

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-047 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX / architektura (wg `reviewers`) — APPROVE
- [ ] `domain-model.md`, `rodo.md` (przez `security-engineer`) i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz B4)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
