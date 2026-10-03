---
id: EVM-010
title: Backlog M1 gotowy do realizacji
type: enabler
milestone: M0
epic: E00 Fundamenty
status: in-review
priority: P0
owner: product-owner
contributors: []
reviewers: [solution-architect, ux-designer, security-engineer]
depends_on: [EVM-002, EVM-004, EVM-005]
---

# EVM-010: Backlog M1 gotowy do realizacji

## Historyjka
Jako **właściciel produktu** chcę **rozpisanego na małe historyjki zakresu MVP „Biuro”**, aby **zespół mógł realizować go krok po kroku, a ja wiedział, kiedy mogę zacząć korzystać z systemu**.

## Kontekst
Realizacja przez `/milestone plan M1`. Zakres: `docs/product/roadmap.md` (M1, epiki E1–E8). Wejścia: model domeny (EVM-002), makiety (EVM-004), wymagania bezpieczeństwa (EVM-005).

## Kryteria akceptacji
**AC1 — Kompletność**
- Wtedy wszystkie epiki M1 są rozpisane na historyjki w `docs/backlog/M1/` wg szablonu, a tabela „epik → historyjki” pokazuje pokrycie całego zakresu (lub świadome przesunięcie z uzasadnieniem).

**AC2 — Jakość historyjek**
- Wtedy każda historyjka spełnia DoR (poza akceptacją użytkownika): maks. 8 AC, uprawnienia ról, odwołania do makiet EVM-004, wymagania bezpieczeństwa z EVM-005 wplecione w AC, uzupełnione `owner` / `contributors` / `reviewers`.

**AC3 — Kolejność i pilot**
- Wtedy `depends_on` i priorytety są ustawione, a kolejność zaczyna się od pionowego przyrostu (logowanie → lista zleceń → utworzenie zlecenia) i wskazuje punkt pilota.

**AC4 — Decyzje**
- Wtedy jest lista decyzji potrzebnych od Konrada, każda z rekomendacją.

## Poza zakresem
Szczegółowe historyjki M2 (powstaną w `/milestone plan M2`).

## UX / UI
Nie dotyczy (odwołania do EVM-004).

## Bezpieczeństwo i prywatność
Wymagania z EVM-005 wplecione w AC.

## Notatki techniczne
_—_

## Plan techniczny
Historyjka dokumentacyjna (enabler, tryb `/milestone plan M1` z `.claude/skills/milestone/SKILL.md`, wykonawca `product-owner`): bez kodu aplikacji, kontraktu API, migracji i nowych zależności. Wynik: historyjki M1 w `docs/backlog/M1/` wg `_template.md` (status `draft`, numeracja od EVM-014) i indeks `docs/backlog/M1/README.md`. Weryfikacja AC przez inspekcję; pomocnicze skrypty i macierze robocze tylko w `.scratch/EVM-010/`. Przykłady w historyjkach wyłącznie syntetyczne (styleguide § 6.3, `docs/ux/flows/README.md` → „Dane w makietach”).

**Wejścia (zaakceptowane, `main`)**
- **EVM-002:** `docs/architecture/domain-model.md` (stany i przejścia, macierz uprawnień, kotwice autoryzacji, kompozycja zlecenia z szablonu), `api-guidelines.md`, `docs/product/service-catalog.md`; decyzje 1–7 i P1–P5; uwagi 1–5.
- **EVM-004:** `docs/ux/flows/` (W-01–W-11 z makietą, W-12–W-20 bez makiety), `scenariusze-a-d.md`, styleguide 1.1.0; decyzje 1–8 (kandydaci P1 / P2, propozycje [P-1…P-13] → styleguide 1.2.0 przed pierwszą historyjką, która ich używa; wpłaty — Edytor, księgowość — Tylko odczyt); uwagi do rozważenia 1–11, PO-1–PO-8, runda 2 pkt 1–10.
- **EVM-005:** `docs/security/requirements.md` → „Wymagania do wplecenia w AC — per epik” (E1–E8), `policies.md` P1–P12, `threat-model.md` RR-01…RR-20 (RR-10 — pentest, RR-16 — drugi Administrator, RR-20 — test odtworzenia); uwagi 1–22 i runda 3 pkt 1–8 (pkt 7: przykłady AC z urządzeniami w E1 → „od E9”).
- **Stan M0:** EVM-006 w toku — plan na gałęzi `feature/EVM-006-repo-i-ci`; `product-owner` nie ma powłoki, więc nie czytał go przez `git show` i przyjmuje ustalenia z polecenia orkiestratora (Node 26, pnpm 12, Turborepo, scalanie przez „Squash and merge” w PR — D2). EVM-007, EVM-008, EVM-009, EVM-011 i EVM-013 nie są zrobione. Konta: GitHub Free (prywatne repo — bez ochrony gałęzi, rulesetów i GitHub Environments), Hetzner (puste projekty `evia-staging`, `evia-prod`). Brak: Scaleway (storage mediów, kopie bazy, e-mail transakcyjny), Expo, Google Play.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/backlog/M1/README.md` | **nowy** (żywy, reguła 5 polityki dokumentów). Zawartość: cel M1; tabela „epik → historyjki” (ID, tytuł, typ, priorytet, `owner`, `depends_on`, ekrany); pokrycie zakresu roadmapy (każda fraza z kolumny „Zakres” E1–E8 → historyjka albo świadome przesunięcie z uzasadnieniem); mapy pokrycia: ekrany W-xx → historyjki, kroki web scenariuszy A–D → historyjki P1, `SR-…` z list E1–E8 → historyjki; kolejność (fazy i graf zależności w Mermaid); punkt pilota; zależności zewnętrzne (konta, zakupy); decyzje dla Konrada z rekomendacją i konsekwencją; ryzyka planu | AC1, AC3, AC4 |
| `docs/backlog/M1/EVM-014-…` … `EVM-066-…` | **nowe** (trwałe, reguła 6) wg `_template.md`, status `draft`; lista wstępna niżej. Liczba może się zmienić o kilka pozycji przy pisaniu — numeracja zostaje ciągła, bez luk | AC1–AC3 |
| `docs/product/roadmap.md` | sekcja M1: odnośnik do planu szczegółowego, kolejność faz, punkt pilota (wg decyzji), uwagi E8 (plan GitHub, pentest, import); „Plan działań — najbliższe kroki”. Zmiany do akceptacji Konrada | AC3 |
| `docs/backlog/README.md` | wiersz `M1/` z zakresem ID | — |
| `docs/README.md` | wiersz `backlog/M1/` | — |
| `docs/product/domain.md` | tylko jeśli historyjki wprowadzą nowe pojęcia (np. „Do wystawienia”) | — |
| `CHANGELOG.md` | „Unreleased”: Dodano — backlog M1 z indeksem; Zmieniono — roadmapa M1; z `[EVM-010]` | DoD |
| ten plik | plan, „Dziennik”, „Uwagi do rozważenia” (rozbieżności z ADR i modelem), po demo — „Decyzje” | — |

Bez zmian: ADR-y, `domain-model.md`, `api-guidelines.md`, `offline-sync.md`, `docs/security/*`, styleguide i `docs/ux/flows/*`. Zmiany makiet i styleguide'u wykonają EVM-014 i EVM-015 w swoich cyklach.

**Zasady podziału (INVEST)**
- Pionowe plasterki: ≤ 8 AC, ≤ 3 moduły backendu (+ panel); najpierw ścieżka szczęśliwa, a operacje Administratora i pozycje P2 w osobnych historyjkach.
- **Ścieżka pionowa nie czeka na nowe makiety.** Korzysta wyłącznie z makiet EVM-004: W-01–W-03, W-05 (z dialogami „Dodaj klienta” i „Dodaj stronę”), W-06 i W-10. Ekrany „bez makiety” dostają makiety w EVM-015, przed historyjkami, które ich używają.
- **Propozycje [P-n]** wdraża EVM-014 (styleguide 1.2.0) przed pierwszą historyjką z UI (EVM-016 używa P-4, P-5, P-11).
- **Kompozycja zlecenia z szablonu narasta** przez port z `domain-model.md`:
  - EVM-022 tworzy zlecenie i zakres;
  - kontrybutor `procedures` dochodzi w E4 (EVM-031);
  - kontrybutor `payments` dochodzi w E7 (EVM-053).
- **Lista W-10 i podsumowanie W-06 rosną z epikami, które dostarczają danych:** E3 — widok podstawowy; E4 — „Czekamy na…”; E7 — „Płatność” i sortowanie „Najpilniejsze”.
- **Urządzenia w E1 (M1 = tylko sesje web):** części wymagań z urządzeniami trafiają do „Poza zakresem” z oznaczeniem „od E9” (dezaktywacja → `device_wipe_required`, reset hasła i MFA → `session_revoked` urządzeń, zmiana roli na Tylko odczyt).
- **Scenariusze A–D (UAT M1):**
  - każdy krok web wskazuje historyjkę P1;
  - kroki mobilne to M2 — w M1 zastępuje je wysyłanie zdjęć z przeglądarki w telefonie (EVM-044, roadmapa M1: „Telefon może tymczasowo dodawać zdjęcia przez przeglądarkę”).

**Proponowany podział — wstępny** (ostateczna lista i treść: `docs/backlog/M1/README.md`). Skróty wykonawców: BE — `backend-developer`, WEB — `web-developer`, UX — `ux-designer`, PO — `product-owner`, SEC — `security-engineer`, OPS — `devops-engineer`. Domyślni recenzenci:
- historyjki z kodem: `code-reviewer`, `security-engineer`, `ux-designer` (gdy jest UI);
- infrastruktura: `security-engineer`, `solution-architect`;
- dokumenty: agenci, którzy będą z nich korzystać.

| ID | Historyjka | Epik | Prio | Wykonawca | Zależy od | Ekrany / uwagi |
|---|---|---|---|---|---|---|
| EVM-014 | Styleguide 1.2.0 — propozycje [P-1…P-13] i poprawki makiet z EVM-004 | E00 | P0 | UX | EVM-004 | P-1…P-13; uwagi EVM-004, runda 2, pkt 1, 2, 10 (formy bezosobowe, PO-3–PO-5) |
| EVM-015 | Makiety ekranów M1 „bez makiety” | E00 | P0 | UX + PO | EVM-014 | W-12, W-13, W-14, W-15 (bez urządzeń), W-16, W-18, W-19, W-20; W-06 — edycja zakresu, dodanie i usunięcie procesu lub etapu; W-17 → E9 (M2) |
| EVM-016 | Logowanie do panelu hasłem i kluczem dostępu, pierwszy Administrator, wylogowanie | E1 | P0 | BE + WEB | EVM-008, EVM-014 | W-01, W-02, W-03 (passkey); P-4, P-5, P-11 |
| EVM-017 | Lista zleceń — widok podstawowy | E3 | P1 | BE + WEB | EVM-016 | W-10 bez kolumn „Czekamy na”, „Termin”, „Płatność” |
| EVM-018 | Szczegóły zlecenia — nagłówek, lokalizacja i zakres | E3 | P1 | BE + WEB | EVM-017 | W-06 (nagłówek, karty „Lokalizacja” i „Zakres”) |
| EVM-019 | Katalog usług i szablony zleceń — dane startowe | E3 | P0 | BE | EVM-008 | enabler; `service-catalog.md` |
| EVM-020 | Klient w nowym zleceniu — wyszukiwanie i dodanie | E2 | P1 | BE + WEB | EVM-016 | W-05 — sekcja „Klient”, dialog „Dodaj klienta” |
| EVM-021 | Lokalizacja i strony w nowym zleceniu | E3 | P1 | BE + WEB | EVM-016 | W-05 — sekcja „Lokalizacja”, dialog „Dodaj stronę” |
| EVM-022 | Nowe zlecenie z szablonu | E3 | P1 | BE + WEB | EVM-018, EVM-019, EVM-020, EVM-021 | W-05 → W-06; P-3 |
| EVM-023 | Kod z aplikacji (TOTP) i kody odzyskiwania | E1 | P1 | BE + WEB | EVM-016 | W-02, W-03 |
| EVM-024 | Zaproszenie użytkownika i aktywacja konta | E1 | P1 | BE + WEB (+ OPS — e-mail) | EVM-007, EVM-015, EVM-023 | W-16, W-13, W-04 (step-up) |
| EVM-025 | Reset zapomnianego hasła | E1 | P1 | BE + WEB | EVM-024 | W-01, W-12 |
| EVM-026 | Ochrona przed zgadywaniem haseł i powiadomienia o bezpieczeństwie konta | E1 | P1 | BE + WEB | EVM-024 | W-01, W-02 (blokada, `429`) |
| EVM-027 | Role, dezaktywacja i reset MFA użytkownika | E1 | P1 | BE + WEB | EVM-024 | W-16, W-04 |
| EVM-028 | Konto — profil, hasło, drugi krok logowania i moje sesje | E1 | P1 | BE + WEB | EVM-015, EVM-023 | W-15 (sesje web; urządzenia → E9) |
| EVM-029 | Dziennik audytu — przegląd dla Administratora | E1 | P1 | BE + WEB | EVM-015, EVM-024 | W-18 |
| EVM-030 | Cykl życia zlecenia — zmiana statusu | E3 | P1 | BE + WEB | EVM-022 | W-06 (menu zlecenia), W-04 (przywrócenie) |
| EVM-031 | Procesy i etapy w zleceniu — z szablonu, osoba odpowiedzialna i termin | E4 | P1 | BE + WEB | EVM-022 | W-06 „Procesy”; P-2, P-6 |
| EVM-032 | Zmiana statusu etapu i „Czekamy na…” | E4 | P1 | BE + WEB | EVM-031 | W-07 (z „Cofnij”) |
| EVM-033 | Szybkie dodanie strony przy etapie z podpowiedzią z lokalizacji | E4 | P1 | BE + WEB | EVM-021, EVM-032 | W-07 — combobox „Czekamy na…” |
| EVM-034 | „Czekamy na…” na liście zleceń i w podsumowaniu zlecenia | E4 | P1 | BE + WEB | EVM-017, EVM-032 | W-10 (kolumna, filtr „dłużej niż X dni”, widok „Czekamy na OSD > 14 dni”), W-06 (kafel) |
| EVM-035 | Edycja danych i zakresu zlecenia | E3 | P1 | BE + WEB | EVM-015, EVM-031 | W-06 „Edytuj dane zlecenia”, „Edytuj zakres” (luka L7) |
| EVM-036 | Edycja lokalizacji i stron, inne zlecenia w tej lokalizacji | E3 | P1 | BE + WEB | EVM-015, EVM-022 | W-20, W-06 karta „Lokalizacja” (D5) |
| EVM-037 | Dziennik zlecenia — wpisy i komentarze | E5 | P1 | BE + WEB | EVM-018 | W-08 |
| EVM-038 | Automatyczna historia zmian w dzienniku | E5 | P1 | BE + WEB | EVM-030, EVM-032, EVM-037 | W-08 (zdarzenia) |
| EVM-039 | Klienci — lista, szczegóły, edycja i historia zleceń | E2 | P1 | BE + WEB | EVM-015, EVM-020, EVM-022 | W-14 |
| — | **punkt pilota** (niżej) | | | | | |
| EVM-040 | Usunięcie i redakcja wpisu w dzienniku (Administrator) | E5 | P1 | BE + WEB | EVM-037 | W-08, W-04; rejestr usunięć (SR-PRIV-04) |
| EVM-041 | Usunięcie i anonimizacja klienta (Administrator) | E2 | P1 | BE + WEB | EVM-039 | W-14, W-04 |
| EVM-042 | Ręczne dodanie i usunięcie procesu lub etapu | E4 | P2 | BE + WEB | EVM-015, EVM-031 | W-06 |
| EVM-043 | Podpowiedź lokalizacji klienta w nowym zleceniu | E3 | P2 | BE + WEB | EVM-022 | W-05 (D4) |
| EVM-044 | Zdjęcia w zleceniu — wysyłanie z panelu, skan i miniatury | E6 | P1 | BE + WEB (+ OPS) | EVM-007, EVM-018 | W-09 (Uploader; także przeglądarka w telefonie) |
| EVM-045 | Galeria — podgląd i pobranie oryginału | E6 | P1 | BE + WEB | EVM-044 | W-09 (Lightbox, bezpieczne linki) |
| EVM-046 | Filmy w zleceniu | E6 | P1 | BE + WEB | EVM-044 | W-09 |
| EVM-047 | Dokumenty z rodzajem i klasą poufności | E6 | P1 | BE + WEB | EVM-044 | W-09 (B4, C5); `confidentialityOverride` |
| EVM-048 | Kategorie, opis i przypisanie mediów i dokumentów do etapu | E6 | P1 | BE + WEB | EVM-031, EVM-045, EVM-047 | W-09 |
| EVM-049 | Kwarantanna plików — „Wymaga uwagi”, alert i ponowny skan | E6 | P1 | BE + WEB | EVM-044 | W-09, W-04 (C10) |
| EVM-050 | Dokumenty lokalizacji i klienta | E6 | P1 | BE + WEB | EVM-036, EVM-047 | W-09 (C3, D7 — scenariusze UAT, dlatego P1) |
| EVM-051 | Usunięcie medium lub dokumentu (Administrator) | E6 | P2 | BE + WEB | EVM-045, EVM-047 | W-09 |
| EVM-052 | Eksport ZIP zdjęć zlecenia (step-up) | E6 | P2 | BE + WEB | EVM-045 | W-09, W-04 |
| EVM-053 | Plan płatności z szablonu i transze w zleceniu | E7 | P1 | BE + WEB | EVM-022 | W-06 „Płatności” („Dodaj transzę”, „Zmień kwotę” transzy „Planowanej” — A1″) |
| EVM-054 | Wystawienie faktury, wpłata i anulowanie transzy planowanej | E7 | P1 | BE + WEB | EVM-053 | W-06, W-11 (akcje płatności) |
| EVM-055 | Zestawienie nieopłaconych i po terminie | E7 | P1 | BE + WEB | EVM-054 | W-11 (A12) |
| EVM-056 | Płatności na liście zleceń i w podsumowaniu zlecenia | E7 | P1 | BE + WEB | EVM-034, EVM-054 | W-10 (kolumna „Płatność”, widoki „Po terminie” i „Nieopłacone”, sortowanie „Najpilniejsze”), W-06 |
| EVM-057 | Korekty płatności (Administrator ze step-upem) | E7 | P1 | BE + WEB | EVM-024, EVM-054 | W-06, W-11, W-04 (C8) |
| EVM-058 | Rozliczenie i anulowanie zlecenia a płatności | E7 | P1 | BE + WEB | EVM-030, EVM-054 | W-06 „Rozlicz…” (A14) |
| EVM-059 | Filtr „Do wystawienia” w Płatnościach | E7 | P2 | BE + WEB | EVM-055 | W-11 |
| EVM-060 | Usunięcie i przywrócenie zlecenia (Administrator) | E3 | P2 | BE + WEB | EVM-058 | W-06 (menu), W-04 (SR-AUTHZ-10) |
| EVM-061 | Środowisko produkcyjne, wdrożenie i monitoring | E8 | P1 | OPS | EVM-007 | SR-INFRA-13 / SR-INFRA-14 a GitHub Free — decyzja |
| EVM-062 | Test odtworzenia kopii produkcji i rejestr usunięć | E8 | P1 | OPS | EVM-061 | SR-INFRA-07, SR-PRIV-04, RR-20 |
| EVM-063 | Prywatność i pomoc w panelu — klauzule informacyjne | E8 | P1 | WEB (+ SEC — treść) | EVM-015, EVM-016 | W-19, link w W-01 i w menu konta |
| EVM-064 | RODO przed startem — umowy powierzenia, rejestr czynności, ćwiczenie naruszeń | E8 | P1 | SEC (+ PO) | EVM-061 | SR-PRIV-06, SR-PRIV-07 |
| EVM-065 | Security sign-off wydania 1.0 — DAST, przegląd i pentest | E8 | P1 | SEC (+ OPS) | EVM-061 i ostatnie historyjki P1 | RR-10 (zakup za osobną zgodą Konrada) |
| EVM-066 | Krótka instrukcja dla biura | E8 | P1 | PO (+ UX) | ostatnie historyjki P1 z UI | nowa lokalizacja dokumentu → zmiana polityki dokumentów w tej historyjce |

**Świadome przesunięcia (README z uzasadnieniem):**
- import danych z CSV / Excel (E8 „jeśli potrzebny”) — decyzja Konrada; rekomendacja: nie w M1;
- wersje dokumentów → M3 (roadmapa);
- pełna historia lokalizacji → M3 (SR-AUTHZ-08);
- W-17 i urządzenia → E9;
- przypisanie techników i „Moje” na telefonie → M2;
- „Poproś administratora o korektę płatności” → M3;
- wartość zlecenia i podpowiedź kwot transz → M3 / M4;
- częściowe wpłaty → poza MVP (P5 z EVM-002);
- eksport CSV / XLSX i edytor katalogu oraz szablonów → M4;
- szkice i filtry zapamiętywane po stronie serwera → później (uwaga 1 EVM-004);
- baner „Zlecenie założone w terenie” → M2 (E13).

**Punkt pilota** — po fazie 3 (EVM-014–EVM-039: logowanie i konta, zlecenia, procesy i etapy, dziennik, klienci), zgodnie z roadmapą („po E1–E5”). **Konflikt do decyzji:** pilot z realnymi danymi wymaga produkcji (E8) i pentestu (RR-10 — „pentest przed produkcją z realnymi danymi”, decyzja Konrada). Warianty dla README:
- **A — pilot próbny.** Na staging, na danych syntetycznych, po fazie 3; realne użycie od wydania 1.0.
- **B — realny pilot przed płatnościami.** Po E1–E6 i minimum E8 (EVM-040, EVM-041, EVM-061–EVM-065, jeden pentest obejmujący logowanie, uprawnienia i pliki); E7 po starcie pilota.
- **C — realny pilot po E1–E5.** Produkcja i pentest przed E6, więc drugi pentest dla plików albo świadoma akceptacja ryzyka.

Rekomendacja wstępna: B, poprzedzony pilotem próbnym A po fazie 3. Ostateczną rekomendację zapiszę po konsultacji `security-engineer`.

**Treść każdej historyjki (checklista DoR, AC2)**
- **Frontmatter:** `id` jak w nazwie pliku, `milestone: M1`, `status: draft`, `epic: E# Nazwa`, `priority`, `owner`, `contributors`, `reviewers` (agenci z `.claude/agents/`), `depends_on`.
- **Sekcje:** wszystkie z szablonu. „Kontekst” z odwołaniami do roadmapy, kotwic makiet `docs/ux/flows/…#w-xx-…`, sekcji `domain-model.md` i decyzji z EVM-002, EVM-004 i EVM-005.
- **AC (1–8, „AC1…”):** w formacie Zakładając / Gdy / Wtedy. Zawsze:
  - ścieżka szczęśliwa;
  - walidacja i przypadki negatywne (`400` / `403` / `404` / `409` / `412`);
  - AC uprawnień: Administrator / Edytor / Tylko odczyt / niezalogowany, z odwołaniem do macierzy ról SR-AUTHZ-05;
  - IDOR (`404`) przy ścieżkach zagnieżdżonych;
  - stany: pusty, błąd, `429`, offline web (baner § 4.10, dane w pamięci karty).
- **`SR-…` w AC i w sekcji:** wymagania zmieniające zachowanie widoczne dla użytkownika lub klienta API — w AC z dopiskiem `(SR-…)`; pozostałe z listy epiku — w „Bezpieczeństwo i prywatność” (zasada z `requirements.md` → „Jak korzystać”).
- **„UX / UI”:** ekrany W-xx, komponenty i [P-n], stany, mikrocopy z makiet. Ekran bez makiety → zależność od EVM-015.
- **„Bezpieczeństwo i prywatność”:** tabela 4 ról, dane osobowe, lista `SR-…`, wartości polityk P#.
- **„Notatki techniczne”:** moduły (≤ 3 + panel), operacje z modelu, zależności zewnętrzne (Scaleway, domena e-mail, plan GitHub).
- **Pozostałe sekcje:**
  - „Plan techniczny” — „_Uzupełnia wykonawca._”;
  - DoD — wg szablonu;
  - Dziennik — „2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)”.
- **Status `ready` a zależności:** status ustawia orkiestrator po akceptacji Konrada — tak jak w M0 (np. EVM-008 jest `ready`, choć EVM-006 i EVM-007 nie są `done`). Punkt DoR „zależności `done`” orkiestrator sprawdza przed `/deliver` — zapis w README.

**Plan weryfikacji AC (inspekcja; skrypty QA tylko w `.scratch/EVM-010/`)**
| AC | Jak sprawdzić |
|---|---|
| AC1 | (a) Każdy plik `docs/backlog/M1/EVM-*.md` jest w tabeli README i odwrotnie (ID, tytuł, priorytet i `depends_on` zgodne z frontmatterem). (b) Każda fraza z kolumny „Zakres” E1–E8 w `roadmap.md` ma historyjkę albo wiersz „świadome przesunięcie” z uzasadnieniem. (c) Kandydaci z decyzji EVM-004 mają historyjki z ustalonym priorytetem — P1: szybkie dodanie strony, edycja lokalizacji i strony, inne zlecenia w lokalizacji, edycja zakresu; P2: podpowiedź lokalizacji klienta, „Do wystawienia”. (d) Każdy ekran W-01–W-20 ma historyjkę (W-17 — przesunięcie do E9). (e) Każdy krok web scenariuszy A–D (`scenariusze-a-d.md`) wskazuje historyjkę P1; kroki mobilne — przesunięcie do M2 z zastępstwem w M1. |
| AC2 | Checklista DoR wyżej dla każdego pliku. Dodatkowo:<br>• każde `SR-…` istnieje w `requirements.md`;<br>• każde `SR-…` z listy epiku występuje w co najmniej jednej historyjce tego epiku (w AC albo w sekcji);<br>• elementy urządzeń w E1 są oznaczone „od E9”;<br>• brak prawdziwych danych osobowych (tylko `example.com`, `*.test`, „Jan Przykładowy”, `ZL-2026-…`, numery z `TEST`). |
| AC3 | (a) Każde `depends_on` wskazuje istniejącą historyjkę (M0 lub M1), a graf nie ma cykli. (b) Kolejność w README zaczyna się od pionowego przyrostu EVM-016 → EVM-017 → EVM-022 (logowanie → lista → utworzenie). (c) Punkt pilota ma listę historyjek, warunki i warianty. (d) Każda historyjka ma priorytet P0–P2, a README podaje zasadę (P0 = blokuje inne). (e) Zależności zewnętrzne są w „Notatkach technicznych” historyjek i w README. |
| AC4 | README → „Decyzje dla Konrada”: każda pozycja ma pytanie, rekomendację, konsekwencję wyboru i historyjki, których dotyczy. Obejmuje co najmniej pozycje z listy niżej. |
| Bramki | `npm run docs:check` — 0 błędów (nowe pliki w regułach 5 i 6); diagram Mermaid w README renderuje się lokalnie, bez serwisów online (jak w EVM-002 i EVM-004). `product-owner` nie ma powłoki — uruchamia orkiestrator. |

**Kolejność kroków**
1. Macierze pokrycia w `.scratch/EVM-010/` (zakres roadmapy, ekrany, `SR-…` per epik, kroki scenariuszy A–D → historyjki) — robocze, nie do commitu.
2. Uwagi z konsultacji (niżej) → korekta listy i zależności.
3. Szkielet README: tabela, fazy, graf, pilot, przesunięcia, zależności zewnętrzne, decyzje.
4. Historyjki faz 0–3 (EVM-014–EVM-039), potem faz 4–7 (EVM-040–EVM-066). Po każdym epiku — samosprawdzenie: ≤ 8 AC, pokrycie `SR-…`, ekrany.
5. Roadmapa, `docs/backlog/README.md`, `docs/README.md`, `CHANGELOG.md`, ewentualnie `domain.md`.
6. Ta historyjka: „Uwagi do rozważenia” (rozbieżności), „Dziennik”; samosprawdzenie wg tabeli.
7. Orkiestrator: `npm run docs:check`, render Mermaid, commit.
8. QA (inspekcja AC1–AC4) → przeglądy `solution-architect`, `ux-designer`, `security-engineer` → demo i decyzje Konrada → `ready` dla historyjek z kompletem DoR.

**Konsultacje przed implementacją (propozycja)**
- **`solution-architect`:**
  1. Gdzie powstaje infrastruktura e-maila (Scaleway TEM, domena nadawcy, SPF / DKIM / DMARC), potoku mediów (bucket, ClamAV, media-processor) i rejestru usunięć — w EVM-007 czy w EVM-024, EVM-044 i EVM-040? Wpływa na `depends_on` i `contributors`.
  2. Agregaty listy i podsumowania (uwaga 5 EVM-004, luka L3) — czy potrzebny osobny enabler przed EVM-034 i EVM-056?
  3. Czy kompozycja zlecenia z szablonu może być rozłożona na EVM-022 → EVM-031 → EVM-053?
  4. `Document.confidentialityOverride` — zmiana modelu przed EVM-047.
  5. Reguły spoza modelu: zlecenie zamknięte tylko do odczytu po stronie serwera (PO-8), ochrona ostatniego aktywnego Administratora.
  6. Rozmiar (≤ 3 moduły) EVM-016, EVM-022 i EVM-044.
- **`security-engineer`:**
  1. Podział E1 i oznaczenia „od E9”.
  2. Punkt pilota a RR-10 (warianty A–C).
  3. GitHub Free a SR-INFRA-13, SR-INFRA-14 i RR-20 — kontrole kompensujące w E8 albo rekomendacja GitHub Pro.
  4. Które `SR-…` z list E1–E8 muszą trafić do AC, a które wystarczą w sekcji.
- **`ux-designer` (opcjonalnie):** zakres EVM-014 i EVM-015.

**Wstępna lista decyzji dla Konrada** (AC4; pełna treść z rekomendacją i konsekwencją — w README)
1. **Konto Scaleway przed EVM-007** (storage mediów, kopie bazy, e-mail).
   - Blokuje: EVM-007 → EVM-008 → całe M1.
   - Rekomendacja: tak.
2. **Domena i adres nadawcy e-maili** (zaproszenia, reset hasła, powiadomienia; SPF / DKIM / DMARC) przed EVM-024.
3. **Klucz dostępu Administratora** (Windows Hello, telefon albo klucz sprzętowy) przed demo EVM-016.
   - Rekomendacja: Windows Hello albo telefon, bez zakupu.
4. **Punkt pilota** — wariant A, B albo C (wyżej).
5. **GitHub Free a wdrożenie prod** (SR-INFRA-13, SR-INFRA-14, RR-20) przed EVM-061.
   - Rekomendacja: GitHub Pro (4 USD / mies., ujęte w kosztach EVM-001).
   - Alternatywa: kontrole kompensujące (wdrożenie prod bez sekretów w GitHubie, test odtworzenia w wariancie A — ręcznie co miesiąc).
6. **Pentest zewnętrzny** (RR-10) — zakres, termin i zgoda na zakup przed EVM-065.
7. **Drugi Administrator albo konto awaryjne** (RR-16) przed startem produkcji.
   - Klucz sprzętowy — za osobną zgodą.
8. **Import istniejących danych.**
   - Rekomendacja: nie w M1 — nowe zlecenia od startu, bieżące kończą się w dotychczasowych narzędziach.
9. **Dane rejestrowe firmy oraz prawnik / IOD** (`rodo.md`) przed EVM-063 i EVM-064.
10. **Ochrona ostatniego aktywnego Administratora** — rekomendacja: nie da się go dezaktywować ani zmienić mu roli.
11. **Priorytety P2** — mogą przejść do M2 / M3, jeśli spowalniają wydanie 1.0.
12. **Jedna historyjka UX na brakujące makiety** (EVM-015) — rekomendacja: tak.
13. **Zmiany w roadmapie M1** — kolejność faz, pilot, przesunięcia.

**Rozbieżności z ADR i modelem → „Uwagi do rozważenia”** (bez zmian ADR i modelu w tej historyjce):
- agregaty W-10 i W-06 (L3);
- `confidentialityOverride` (L4);
- PO-8 (zlecenie zamknięte tylko do odczytu po stronie serwera);
- ostatni Administrator;
- infrastruktura e-maila, mediów i rejestru usunięć poza AC EVM-007;
- SR-INFRA-13, SR-INFRA-14 i RR-20 a GitHub Free;
- pilot a RR-10;
- „Moje” na W-10 = opiekun (technik — M2).

### Ustalenia z konsultacji
Obie konsultacje (2026-10-03) zakończyły się werdyktem **CHANGES**; wszystkie punkty obowiązkowe są wdrożone w planie ([`docs/backlog/M1/README.md`](../M1/README.md)) i w historyjkach. ADR-y bez zmian; `npm run docs:check` przed zmianami: 0 błędów, 0 ostrzeżeń (wg recenzentów).

**`solution-architect` — CHANGES.** Zakres, podział na epiki, ścieżka pionowa bez nowych makiet, narastająca kompozycja i przesunięcia — zgodne z ADR-0001…0015 i `domain-model.md`.
| # | Ustalenie | Wdrożenie |
|---|---|---|
| W1 | enabler „ADR — model odczytu listy i podsumowania zlecenia (L3)”; warianty (a) projekcja `work_order_summaries` w module odczytu (rekomendacja), (b) widok SQL — wyjątek od ADR-0001, (c) składanie z fasad; „po terminie” liczone w zapytaniu | **EVM-069**; twarda zależność EVM-034 i EVM-056 |
| W2 | podział EVM-016: (a) pierwszy Administrator — polecenie CLI z linkiem 72 h, bez endpointu „setup” i e-maila, tylko bez aktywnego Administratora albo w trybie awaryjnym z audytem (RR-16), bramka MFA, fundament `audit`; (b) logowanie, wygasanie i rotacja sesji | EVM-016 (a), **EVM-067** (b) |
| W3 | podział EVM-044: (a) upload i skan (`StoredFile`, `UploadSession`, multipart, worker, `clamd`/`freshclam`, CORS bucketu z `ExposeHeaders: ETag`, CSP `connect-src`, lifecycle 7/30 dni, stan „Przetwarzanie”); (b) `media-processor` — `processing → ready`, miniatury; EVM-045 zależy od (b); (a), (b) i EVM-046 zależą od EVM-011 (`media-pipeline.md`) | EVM-044 (a), **EVM-068** (b); zależność od EVM-011 w EVM-044, EVM-068 i EVM-046 |
| W4 | brakujące krawędzie: e-mail → EVM-024 (EVM-023 — wybrana zależność od EVM-024, nie przesunięcie do EVM-026; EVM-049); rejestr usunięć — EVM-040 wprowadza port, zależą EVM-041, EVM-051 i purge; zdarzenia dziennika E6/E7 → EVM-038 (lista zdarzeń w EVM-038); EVM-034 i EVM-056 → W1 | `depends_on` w historyjkach; lista zdarzeń w EVM-038 AC1 |
| W5 | decyzja 5 (GitHub Free) — termin przed planem EVM-007; wariant Free wymaga zmiany ADR-0012 i SR-INFRA-13; wzorzec pull z weryfikacją na VM (commit na `main` i zielony `ci-gate` sprawdzane tokenem tylko do odczytu na VM) | README → „Decyzje”, pkt 5; EVM-061 AC2, EVM-062 AC4 |
| W6 | nowa decyzja: RAM stagingu od E6 — CX33 (8 GB) od EVM-044, ok. +13 zł/mies.; alternatywa — swap i niższe limity (ryzyko OOM) | decyzja 14 |
| W7 | „Uwagi”: uwaga 1 EVM-002 rozstrzygana w EVM-060 z aktualizacją `domain-model.md`; PO-8 to brak AC, nie rozbieżność modelu; pilot B — zlecenia sprzed EVM-053 bez transz, bez backfillu | niżej („Uwagi do rozważenia”); EVM-060; AC `409 work_order_closed`; README → „Punkt pilota” |
| W8 | tabela „zdolność przekrojowa → historyjka” | README → „Zdolności przekrojowe” (step-up przeniesiony do EVM-029 — konsultacja security pkt 3d) |
| B1 | infrastruktura: EVM-007 — buckety (media, kopie, rejestr usunięć), wersjonowanie, object lock; EVM-044 (+ `devops-engineer`) — CORS, lifecycle, kontenery, worker; EVM-024 (+ `devops-engineer`) — TEM, domena nadawcy, SPF/DKIM/DMARC, kolejka `email`, tryb staging; domena potrzebna już w EVM-007 | `contributors` i „Notatki techniczne” EVM-024, EVM-040, EVM-044, EVM-068 |
| B3 | kompozycja narastająca: port w EVM-022 bez implementacji (ta sama transakcja, kolejność, błąd wycofuje całość — test), EVM-031 → `procedures`, EVM-053 → `payments`; bez backfillu; EVM-019 seeduje cały katalog jedną migracją i daje odczyt dla W-05; EVM-022 zapisuje tylko `work-orders` | EVM-019, EVM-022 AC6, EVM-031 AC1, EVM-053 AC1 |
| B4 | `confidentialityOverride` bez ADR — kolumna w pierwszej migracji `media.documents` w EVM-047 + aktualizacja `domain-model.md`, przegląd architekta i security | EVM-047 |
| B5 | PO-8 — `409 work_order_closed` we wszystkich historyjkach zmieniających zakres, procesy, etapy i płatności (kod dopisuje pierwsza — EVM-031), wpisy/media/dokumenty przyjmowane, pola zlecenia — EVM-035; ostatni Administrator — reguła w `identity` (EVM-027), `409 last_active_administrator`, serializacja i test współbieżności, aktualizacja reguł `User` | EVM-031, EVM-032, EVM-035, EVM-042, EVM-053, EVM-054, EVM-057; EVM-027; decyzje 10 i 17 |
| C | wytyczne do „Notatek technicznych” (granice modułów, model danych, kontrakt API, offline-sync, wydajność, testowalność) | README → „Zasady wspólne dla historyjek M1”; „Notatki techniczne” historyjek |

**`security-engineer` — CHANGES.** Kierunek zgodny z EVM-005; ryzyko — backlog bez kontroli wymaganych przed realnymi danymi.
| # | Ustalenie | Wdrożenie |
|---|---|---|
| 1 | GitHub Free: każdy sekret CI to sekret repozytorium (także dla gałęzi wypchniętej kluczem agentów); dotyczy też SR-SUPPLY-05, RR-02, RR-11; decyzja przed EVM-007; poprawny opis alternatywy (zero sekretów prod w GitHubie, wdrożenie i test odtworzenia poza Actions, K6 `main-integrity`, nowe RR); konsekwencja sekretów prod w repo — 6 High, blocker sign-off; EVM-061/062 z obiema ścieżkami i zależnościami od EVM-006 i EVM-007 | decyzja 5; EVM-061, EVM-062 |
| 2 | pilot: B poprzedzony A; A tylko staging i dane syntetyczne; EVM-065 rozdzielona na pentest i sign-off pilota oraz sign-off 1.0; warunki wejścia pilota B; wariant C tylko z pentestem | README → „Punkt pilota”; EVM-065, **EVM-070**; decyzja 4 |
| 3 | fundamenty E1: EVM-016 — model ról × kanał, fikstury, generowana macierz z IDOR i kompletnością, audyt append-only; bootstrap (hasło nigdy w argumentach, link z TTL, blokada po istnieniu Administratora, audyt, wymuszony passkey); jednakowe odpowiedzi i 20 prób/min/IP już na starcie; step-up z właścicielem przed EVM-024; EVM-023 — AC: Administrator w panelu bez TOTP | EVM-016, EVM-067 AC2–AC3, **EVM-029** (step-up), EVM-023 AC3 |
| 4 | e-mail — zależności EVM-023, EVM-025–EVM-028, EVM-052 (i EVM-049); Mailpit w dev i testach, TEM z domeną i DMARC `p=reject` na staging i prod; obejścia tylko po przeglądzie security i decyzji Konrada; e-maile tylko z linkiem | `depends_on`; EVM-024 AC2, AC6; README → „Ryzyka planu” R5 |
| 5 | właściciele mitygacji: RR-13/AB-08 (masowy odczyt) → EVM-017 (+ EVM-039 — 300 klientów/h); SR-FILE-10 i audyt pobrań → EVM-045; SR-LOG-07 w historyjkach zdarzeń (EVM-026, EVM-027, EVM-049, EVM-052, EVM-061, EVM-062); SR-DATA-07 — sesje (EVM-028), kwarantanna (EVM-049), eksporty (EVM-052) | wskazane historyjki |
| 6 | pliki: EVM-044 fail-closed (do `clean` niedostępne, ponowienia przy braku `clamd`, typ po zawartości, limity, prywatny bucket, klucz od serwera, EICAR); GPS — pochodne bez metadanych (AC w EVM-068 — tam powstają pochodne), ostrzeżenie w EVM-045, instrukcja w EVM-066; EVM-047 — SR-AUTHZ-06/07; EVM-048 — etap z tego zlecenia; EVM-036 i EVM-050 — tylko metadane, polityka w zapytaniu, IDOR przez `siteId`, security w recenzentach; SR-FILE-11 → E6 | EVM-044, EVM-068 AC2, EVM-045, EVM-047, EVM-048, EVM-036, EVM-050, EVM-051 AC5 (+ EVM-062) |
| 7 | usuwanie (EVM-040, EVM-041, EVM-051, EVM-060): step-up, audyt bez wartości, rejestr usunięć przed operacją (nieudany zapis = operacja nie startuje), zależność od infrastruktury rejestru; EVM-060 — `paid` tylko A↑, `invoiced` → `409` | wskazane historyjki; EVM-051 P2 → P1 |
| 8 | „od E9” bezpieczne tylko bez operacji `channels: [mobile]` (warunek w README i EVM-016); lista „Przeniesione do E9”; klasyfikacja i `rodo.md` w historyjkach z danymi osobowymi (`security-engineer` jako contributor: EVM-020, EVM-021, EVM-036, EVM-039, EVM-047); SR-DATA-02; runbook awaryjnego resetu MFA kończy sesje | README → „Przeniesione do E9”; EVM-016 AC2, AC8; EVM-064 AC5 |
| 9 | które SR do AC, a które do sekcji; wartości P1–P12 bez dopisku „do akceptacji” | podział w historyjkach; README → „Wymagania bezpieczeństwa → historyjki” |
| 10 | podział E1 zaakceptowany z poprawkami; decyzja 3 (Windows Hello + telefon, ≥ 2 klucze, kody od EVM-023, osobne konta staging/prod); decyzja 10 — tak (+ zakaz dezaktywacji siebie i odebrania sobie roli; reset MFA Administratora tylko przez innego Administratora albo runbook); decyzja 8 — nie w M1 (warunki ewentualnej historyjki); decyzje 1 i 2 — tak, przed EVM-007 | README → „Decyzje dla Konrada” |

## Decyzje
_—_

## Uwagi do rozważenia
### Implementacja (product-owner, 2026-10-03) — rozbieżności z ADR i modelem
Bez zmian ADR i `domain-model.md` w tej historyjce; zmiany wykonują wskazane historyjki.
1. **Agregaty W-10 i W-06 (luka L3)** — wymagają decyzji architektonicznej → EVM-069 (ADR); EVM-034 i EVM-056 od niej zależą.
2. **`Document.confidentialityOverride` (L4)** — zmiana *expand* bez ADR; kolumna i aktualizacja `domain-model.md` w EVM-047 (przegląd architekta i security).
3. **PO-8** — nie jest rozbieżnością: `domain-model.md` (reguły `WorkOrder`) blokuje zakres, procesy i płatności w zleceniu zamkniętym; brakowało AC — dodane (`409 work_order_closed`, nowy kod dopisuje EVM-031). Pola samego zlecenia — decyzja 17 (rekomendacja: tylko do odczytu).
4. **Ostatni aktywny Administrator** — reguła spoza modelu; EVM-027 aktualizuje reguły `User` w `domain-model.md` i dopisuje kod `409 last_active_administrator`.
5. **Uwaga 1 EVM-002** (soft delete zlecenia z transzami `paid` bez step-upu łamie zasadę ścieżek) — rozstrzygnięcie w EVM-060 razem z aktualizacją `domain-model.md`: `paid` — tylko Administrator ze step-upem, `invoiced` — `409 has_active_dependents` (SR-AUTHZ-10).
6. **Infrastruktura e-maila, mediów i rejestru usunięć poza AC EVM-007** — AC EVM-007 nie wymieniają wprost bucketu rejestru usunięć ani domeny; SR-PRIV-04 i SR-INFRA-12 wskazują EVM-007 — warto doprecyzować w jego planie technicznym (buckety, wersjonowanie, object lock, domena z TLS).
7. **SR-INFRA-13, SR-INFRA-14, RR-20 a GitHub Free** — decyzja 5; wariant Free wymaga zmiany ADR-0012 i SR-INFRA-13 przed planem EVM-007.
8. **Pilot a RR-10** — pilot próbny wyłącznie na staging z danymi syntetycznymi; realne dane dopiero po pentescie i sign-off (EVM-065).
9. **„Moje” na W-10 = opiekun** (technik — M2, PO-7).
10. **Pilot B a płatności** — zlecenia założone przed EVM-053 nie mają transz (bez backfillu); biuro dodaje je ręcznie — konsekwencja wariantu B (decyzja 4).
11. **EVM-017 przed modułami `customers` i `sites`** — tabela `work_orders` bez kluczy obcych do klientów i lokalizacji do EVM-022 (zmiana addytywna) albo zmiana kolejności (EVM-017 po EVM-021) — do potwierdzenia przez architekta (README → „Ryzyka planu” R4). Literalna kolejność AC3 („logowanie → lista → utworzenie”) zachowana.
12. **Licznik wyników W-10** („6 zleceń”) a `api-guidelines.md` („bez liczników całkowitych na listach”) — do decyzji architekta; EVM-017 bez licznika.
13. **Step-up** — właściciel EVM-029 zamiast EVM-024 (W8 architekta) — zgodnie z konsultacją security (pkt 3d).
14. **„Nowa przeglądarka”** (SR-AUTH-15 w panelu, EVM-026) — mechanizm rozpoznania do ustalenia w planie technicznym (bez odcisku przeglądarki).
15. **Kwarantanna po 30 dniach** (EVM-049) — retencja techniczna z lifecycle czy operacja z rejestru usunięć; rekomendacja PO: retencja techniczna.
16. **EVM-016 zależy od EVM-015** (W-13) — odstępstwo od zasady planu „ścieżka pionowa nie czeka na nowe makiety”; EVM-015 jest mała i idzie w fazie 0 równolegle z EVM-006–EVM-008.
17. **Plan EVM-006** (gałąź `feature/EVM-006-repo-i-ci`) nie był czytany przez `product-owner` (brak powłoki) — odwołania do K6 `main-integrity` i nowego RR z EVM-006 przyjęte z konsultacji `security-engineer`.
18. **Nowa lokalizacja dokumentu** dla instrukcji użytkownika — zmiana polityki dokumentów i konfiguracji walidatora w EVM-066 (do akceptacji Konrada). Instrukcja jest dodatkowo publikowana w panelu (EVM-066 AC6), bo repozytorium jest prywatne.

### Poprawki — runda 1 (product-owner, 2026-10-03)
19. **`design/brand/logo-color.svg` — zmiana poza zakresem w drzewie roboczym** (QA, `solution-architect`, `ux-designer`): `borderopacity="0a` bez cudzysłowu zamykającego — niepoprawny XML. Plik **nie wchodzi do commitu EVM-010** (orkiestrator dodaje wskazane pliki, nie `git add -A`); przywrócenie wersji z `main` tylko za zgodą Konrada. `product-owner` pliku nie zmieniał.
20. **Telefon w pilocie B** — panel w przeglądarce prywatnych telefonów to nowy kanał spoza modelu zagrożeń (TM-01, P7 opisują tylko aplikację); nowe RR w EVM-065 AC4, decyzje 18 i 19.
21. **Tokeny w linkach jednorazowych** — ADR-0013 i SR-LOG-02 usuwają z logów tylko query z podpisami URL-i; zasada „token tylko we fragmencie URL” dopisana w README M1 → „Zasady wspólne” i w EVM-016, EVM-024, EVM-025 (bez zmian ADR; `security-engineer` może rozważyć dopisanie jej do `requirements.md` przy najbliższej aktualizacji).

### Uwagi nieblokujące z weryfikacji (runda 3, orkiestrator 2026-10-03)
Ustalenia minor / nit z QA i przeglądów rundy 3, niezałatwione w historyjce:
1. **Ostrzeżenie o transzach przy anulowaniu zlecenia** (ux-designer, minor; EVM-053 AC6 i „Poza zakresem” vs EVM-058 AC3). Ostrzeżenie „Planowane transze (N) zostaną anulowane.” i komunikat 422 w „Rozlicz…” należą do EVM-053 (skutek działa od tego wydania); EVM-058 rozszerza je o pełne podsumowanie — doprecyzować przy `/refine` EVM-053 / EVM-058, zanim staną się `ready` do realizacji.
2. **Testy wokół zmiany czasu** (QA, nit; README M1 → „Zasady wspólne”). Żadne AC nie używa dat zmiany czasu (2026-10-25, 2027-03-28), choć „> X dni”, „po terminie” i TTL zależą od Europe/Warsaw — dopisać przy refinemencie EVM-034, EVM-055, EVM-016 / EVM-067 (wymóg z `testing-strategy.md`).
3. **Format AC** (QA, nit). 181 z 438 AC bez „Zakładając”, 73 bez „Gdy” (głównie AC uprawnień i stanów) — zgodne z praktyką M0; ewentualne ujednolicenie przy refinemencie.
4. **Sekcja „Decyzje dla Konrada”** (QA, nit; README M1). Pozycje 8, 11–13 bez wiersza „Historyjki”, 13 bez konsekwencji; roadmapa wymienia grupę „z akceptacją planu” bez 18 i 19.
5. **Graf zależności** (QA, nit; README M1). 59 węzłów i 114 krawędzi — mało czytelny; rozważyć grafy per faza.
6. **Zależności zewnętrzne w „Kontekście”** (QA, nit; EVM-062–064) zamiast w „Notatkach technicznych”.
7. **Brak wpisu o poprawkach rundy 2 w „Dzienniku”** (QA, nit) — uzupełnione wpisem orkiestratora o rundach.
8. **Lista faz w `roadmap.md`** (QA + solution-architect, minor) — **naprawione przez orkiestratora** (pusta linia przed listą „0.”).
9. **`design/brand/logo-color.svg`** (QA, minor) — zmiana spoza zakresu w drzewie roboczym (`borderopacity="0a` bez cudzysłowu — niepoprawny XML); **nie weszła do commitów EVM-010**, decyzja o przywróceniu — Konrad.

## Definition of Done
- [x] AC1–AC4 spełnione (weryfikacja QA przez inspekcję) — QA runda 3: PASS (59 historyjek EVM-014…EVM-072, 7 × P0 / 47 × P1 / 5 × P2, 4–8 AC, pokrycie roadmapy, ekranów, scenariuszy A–D i SR E1–E8, graf bez cykli, 19 decyzji z rekomendacją); u orkiestratora: `npm run docs:check` 0 błędów / 0 ostrzeżeń, `npm run test:tools` 189/189
- [x] Przeglądy: solution-architect, ux-designer, security-engineer — APPROVE (runda 3; R1: 3× CHANGES, 12 ustaleń blocker/major; R2: security CHANGES, 1× major — poprawione); konsultacje planu: solution-architect i security-engineer (CHANGES — wdrożone)
- [ ] Akceptacja Konrada; zaakceptowane historyjki w statusie `ready`

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-010-backlog-m1` (decyzja Konrada: realizacja w czasie przerwy EVM-006 — praca koncepcyjna równolegle z historyjką z kodem)
- 2026-10-03 — plan techniczny (product-owner). Zawiera:
  - wstępny podział M1 na EVM-014–EVM-066;
  - punkt pilota z wariantami A–C;
  - wstępną listę decyzji dla Konrada;
  - pytania do konsultacji `solution-architect` i `security-engineer`.

  Planu EVM-006 z gałęzi `feature/EVM-006-repo-i-ci` nie czytałem (brak powłoki) — przyjąłem ustalenia z polecenia orkiestratora. `npm run docs:check` uruchamia orkiestrator.
- 2026-10-03 — implementacja (product-owner):
  - konsultacje `solution-architect` i `security-engineer` (CHANGES) wdrożone — „Plan techniczny” → „Ustalenia z konsultacji”;
  - 59 historyjek EVM-014 … EVM-072 w `docs/backlog/M1/` (status `draft`; P0: 7, P1: 47, P2: 5) — podziały EVM-015, EVM-016, EVM-044, EVM-065 oraz nowe EVM-069 i EVM-072;
  - indeks `docs/backlog/M1/README.md`: tabela epik → historyjki, fazy i graf zależności, punkt pilota (A → B), pokrycie roadmapy, ekranów, scenariuszy A–D i `SR-…`, zdolności przekrojowe, zasady wspólne, zależności zewnętrzne, 17 decyzji dla Konrada, ryzyka;
  - `roadmap.md` (sekcja M1 i najbliższe kroki — do akceptacji Konrada), `domain.md` (pojęcia z planu M1), `docs/backlog/README.md`, `docs/README.md`, `CHANGELOG.md`;
  - „Uwagi do rozważenia” — 18 pozycji (rozbieżności z ADR i modelem, sprawy dla architekta).

  Brak powłoki: `npm run docs:check` i render Mermaid (`docs/backlog/M1/README.md`) wykonuje orkiestrator; commit — orkiestrator.
- 2026-10-03 — poprawki, runda 1 (product-owner) — ustalenia QA, `solution-architect`, `ux-designer` i `security-engineer`:
  - tokeny linków tylko we fragmencie URL, otwarcie nie zużywa linku, polecenie na serwerze tylko na TTY — README → „Zasady wspólne”, EVM-016 AC1/AC5, EVM-024 AC1/AC3, EVM-025 AC2;
  - eksport ZIP widzi i pobiera tylko zlecający — EVM-052 AC7;
  - bramka wdrożeń prod w trakcie pilota B, P2 z operacjami wrażliwymi najwcześniej z EVM-070 — README → „Punkt pilota”, EVM-065 AC7 (+ EVM-052, EVM-060, EVM-061, EVM-070);
  - DPIA i transfery do USA — EVM-064 AC1/AC8, warunek 4 pilota B, EVM-065 AC5, decyzja 9;
  - telefon (BYOD) — EVM-065 AC4, EVM-066 AC2, README → „Punkt pilota”, decyzje 18 i 19, ryzyka R11 i R12;
  - wysyłanie z przeglądarki w telefonie — EVM-071 AC5 (makieta W-09 compact), EVM-044 AC4 (+ zależność od EVM-071), EVM-046 AC8;
  - podgląd szablonu pokazuje tylko to, co system tworzy — EVM-022 AC1, EVM-031 AC1, EVM-053 AC1, README → „Punkt pilota”;
  - instrukcja dla biura w panelu — EVM-066 AC6 (+ zależność od EVM-063), EVM-063 AC3;
  - `roadmap.md` (pilot B, DPIA, instrukcja w panelu — do akceptacji Konrada, decyzja 13), `domain.md` („Link aktywacyjny”).

  `design/brand/logo-color.svg` bez zmian z mojej strony — pytanie do Konrada („Uwagi do rozważenia”, pkt 19). Brak powłoki: `npm run docs:check` uruchamia orkiestrator.
- 2026-10-03 — poprawki, runda 1 (backend-developer) — ustalenie `solution-architect` (luka integralności płatności na prod w pilocie B):
  - uczestnik przejść `payments` przeniesiony z EVM-058 do EVM-053 — warunek rozliczenia (`422 transition_condition_not_met`, `unpaid_milestones`), skutek `planned → cancelled` przy anulowaniu w tej samej transakcji, test SR-API-06 i test współbieżności (EVM-053 AC6; Tylko odczyt połączony z macierzą ról w AC7);
  - blokada anulowania zlecenia z transzą „Wystawiona” (`422`, `invoiced_milestones`) z testami ścieżek i współbieżności — EVM-054 AC6 (zdarzenia dziennika transz dołączone do AC3);
  - EVM-058 — dialogi z podsumowaniem, akcje wyłączone przed wysłaniem, AC5 i spójność UI; `owner` → web-developer;
  - README → „Punkt pilota” (EVM-053 i EVM-054 na prod w jednym wydaniu), „Kolejność i fazy”, „Zdolności przekrojowe”, „Zasady wspólne” (granice modułów, testy współbieżności), tabela SR E7, „Zmiany względem planu wstępnego”; odwołania w EVM-030, EVM-038, EVM-070.

  `npm run docs:check` — 0 błędów, 0 ostrzeżeń.
- 2026-10-03 — workflow `deliver-story`: `passed` po 3 rundach (R1: 3× CHANGES — 12 ustaleń; R2: security CHANGES — zasada kopii zdjęć w chmurze w EVM-064 AC8, EVM-065 AC4, EVM-066 AC2, decyzje 18–19; R3: 3× APPROVE, QA PASS); zmiany product-owner zacommitowane przez orkiestratora (bez `design/brand/logo-color.svg`)
- 2026-10-03 — in-progress → in-review: DoD (AC + przeglądy) spełnione; czeka na demo i decyzje Konrada (akceptacja planu, decyzje „Teraz”: 4, 8, 10–13, 17–19)
