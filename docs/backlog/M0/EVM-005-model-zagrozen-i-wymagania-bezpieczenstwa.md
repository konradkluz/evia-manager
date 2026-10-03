---
id: EVM-005
title: Model zagrożeń v1, wymagania bezpieczeństwa i RODO
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P0
owner: security-engineer
contributors: []
reviewers: [solution-architect, devops-engineer]
depends_on: [EVM-001]
---

# EVM-005: Model zagrożeń v1, wymagania bezpieczeństwa i RODO

## Historyjka
Jako **właściciel firmy** chcę **znać zagrożenia dla danych klientów i dokumentacji oraz mieć konkretne wymagania bezpieczeństwa wplecione w plan**, aby **bezpieczeństwo było budowane od początku, a nie łatane po fakcie**.

## Kontekst
Baseline: `docs/security/README.md`. Architektura: wynik EVM-001.

## Kryteria akceptacji
**AC1 — Model zagrożeń**
- Gdy otwieram `docs/security/threat-model.md`
- Wtedy znajduję analizę STRIDE dla kontenerów i przepływów danych z C4 (EVM-001), przypadki nadużyć (m.in. przejęcie konta, były pracownik, kradzież telefonu z danymi offline, złośliwy plik, IDOR na mediach, wyciek podpisanego URL-a, masowe pobranie archiwum, replay kolejki offline), ocenę ryzyka i mitygacje.

**AC2 — Wymagania**
- Gdy otwieram `docs/security/requirements.md`
- Wtedy kontrole OWASP ASVS 5.0 L2 i MASVS istotne dla systemu są zmapowane na moduły i epiki M1–M2, tak by product-owner mógł wpleść je w AC.

**AC3 — Polityki do decyzji**
- Wtedy dla: MFA (kogo obejmuje, mechanizm), haseł i sesji, EXIF / GPS w zdjęciach, retencji mediów i logów, skanowania plików, zakresu danych dla roli Tylko odczyt — jest rekomendacja do akceptacji Konrada.

**AC4 — RODO**
- Gdy otwieram `docs/security/rodo.md`
- Wtedy znajduję: inwentaryzację danych osobowych, podstawy przetwarzania, retencję, podmioty przetwarzające (umowy powierzenia), realizację praw osób, procedurę naruszeń (72 h) i szkic rejestru czynności przetwarzania.

**AC5 — Bramki CI**
- Wtedy jest lista skanów i progów blokujących (SAST, zależności, sekrety, IaC / kontenery, DAST na staging) gotowa do wdrożenia w EVM-006 / EVM-007.

**AC6 — Ryzyka rezydualne**
- Wtedy jest lista ryzyk rezydualnych do świadomej akceptacji przez Konrada.

## Poza zakresem
Implementacja kontroli (powstaje w historyjkach M1–M2), zewnętrzny pentest (rozważany przed produkcją).

## UX / UI
Nie dotyczy.

## Bezpieczeństwo i prywatność
To jest specyfikacja bezpieczeństwa.

## Notatki techniczne
Uwaga prawna: dokument RODO to szkic operacyjny, nie porada prawna — wskaż punkty do konsultacji z prawnikiem / IOD, jeśli są.

## Plan techniczny
Historyjka dokumentacyjna (enabler). Nie obejmuje kodu aplikacji, kontraktu OpenAPI ani migracji. AC weryfikujemy przez inspekcję (QA i recenzenci `solution-architect`, `devops-engineer`). Powstają cztery nowe dokumenty żywe w `docs/security/` (reguła 16 polityki dokumentów); odwołuje się do nich `docs/security/README.md`, więc nie będą osierocone.

**Bez zmiany decyzji ADR-0001…0015.** Dokumenty rozstrzygają tylko sprawy, które ADR-y i EVM-002 jawnie przekazały do EVM-005 (tabela „Wejścia” niżej). Wartości z ADR potwierdzamy albo proponujemy inne jako rekomendację do akceptacji Konrada — bez edycji ADR. Gdyby rekomendacja wymagała zmiany ADR, zapisuję ją jako pytanie z rekomendacją; BLOCKED tylko wtedy, gdy bez decyzji nie da się spełnić AC.

**Wejścia z EVM-002** (gałąź `feature/EVM-002-model-domeny-i-api`, status in-review):
- czytam je wyłącznie przez `git show`; nie kopiuję ich i nie edytuję;
- odwołuję się do nich ścieżkami docelowymi na `main`: `docs/architecture/domain-model.md`, `docs/architecture/offline-sync.md`, `docs/architecture/api-guidelines.md`, `docs/product/service-catalog.md`, `docs/product/domain.md`;
- rozbieżności z modelem trafiają do „Uwag do rozważenia” jako uwagi dla `solution-architect`.

**Kolejność merge:** EVM-005 po EVM-002 — inaczej linki do dokumentów EVM-002 na `main` nie działają.

**Zakres zmian (pliki)**
| Plik | Zmiana | AC |
|---|---|---|
| `docs/security/threat-model.md` | **nowy** (żywy) — model zagrożeń v1: STRIDE dla elementów i przepływów C4 L2 oraz łańcucha dostaw, przypadki nadużyć, ocena ryzyka, mitygacje zmapowane na wymagania `SR-…` (te mają przypisane ASVS / MASVS, moduły, epiki i historyjki), ryzyka rezydualne | AC1, AC6 |
| `docs/security/requirements.md` | **nowy** (żywy) — katalog wymagań `SR-<obszar>-NN` z odwołaniami do ASVS 5.0.0 L2 i MASVS 2.1.0; mapowanie na moduły i epiki E1–E14 oraz historyjki M0; listy „do wplecenia w AC” per epik; pokrycie ASVS (rozdziały i załącznik ID → SR / N/D); tabela MASVS; bramki bezpieczeństwa CI | AC2, AC5 |
| `docs/security/policies.md` | **nowy** (żywy) — polityki do decyzji: P1–P6 z AC3, P7–P12 przekazane z ADR i EVM-002 (każda z rekomendacją, wariantami, konsekwencją innego wyboru i polem decyzji Konrada) | AC3 |
| `docs/security/rodo.md` | **nowy** (żywy) — szkic operacyjny RODO z oznaczeniami `[PRAWNIK/IOD]` | AC4 |
| `docs/security/README.md` | w nagłówku linki do 4 dokumentów i ich status; w punktach o MFA, EXIF/GPS i retencji — odesłanie do `policies.md`; treść baseline bez zmian do czasu akceptacji polityk | spójność |
| `docs/README.md` | 4 wiersze w obszarze „Bezpieczeństwo”. Możliwy konflikt z EVM-002 (zmienia sąsiednie wiersze) — rozwiązuje orkiestrator | — |
| `CHANGELOG.md` | krótki wpis w „Unreleased / Dodano” z `[EVM-005]` (konflikt z EVM-002 — orkiestrator) | DoD |
| ten plik | plan, „Dziennik”, później DoD i uwagi | — |

Bez zmian:
- ADR-y i ich indeks;
- `docs/architecture/README.md` — wartości NFR oznaczone „do potwierdzenia w EVM-005” aktualizuje `solution-architect` po akceptacji polityk (uwaga do przekazania);
- dokumenty EVM-002, `CLAUDE.md`, `tools/`, `.claude/`.

**Zawartość dokumentów**
1. **`threat-model.md`**
   - **Zakres i metoda:** STRIDE dla każdego elementu i każdego przepływu. Wersja v1 = M0. Aktualizacja przy `/milestone close`, nowej integracji lub roli, zmianie architektury i po incydencie.
   - **Aktywa:** klasy danych z klasyfikacji EVM-002 (DO-K, DO-3, DO-P, WF, WEW, KONF, SEK) oraz aktywa niebędące danymi: konta i sesje, klucze podpisu, sekrety, backupy, dostępność.
   - **Aktorzy zagrożeń:**
     - napastnik zewnętrzny i phishing;
     - złodziej telefonu;
     - były pracownik;
     - insider z rolą Edytor albo Tylko odczyt;
     - skompromitowany dostawca lub zależność;
     - nadawca złośliwego pliku;
     - przejęta stacja deweloperska albo agent AI w trybie bypass.
   - **Elementy i przepływy:**
     - elementy `C-xx` i przepływy `DF-xx` 1:1 z C4 L2 (`docs/architecture/README.md`, granice TB1–TB6);
     - dodatkowe granice: TB7 łańcuch dostaw i CI (GitHub, Actions, GHCR, Renovate, EAS, Google Play — ADR-0012) oraz TB8 stacja deweloperska z agentami (ADR-0015).
   - **Tabela STRIDE**, kolumny:
     - `TM-xx`, element lub przepływ, kategoria S/T/R/I/D/E, zagrożenie;
     - prawdopodobieństwo (P), wpływ (W), ryzyko bazowe;
     - mitygacje (ADR + `SR-…`), ryzyko rezydualne, `RR-xx`.
   - **Przypadki nadużyć `AB-xx`.** Każdy opisany polami: aktor, scenariusz, warunki, wpływ, P × W, mitygacje (`SR-…`), wykrywanie (alert z ADR-0013), weryfikacja (rodzaj testu, epik). Lista:
     - wszystkie z AC1;
     - publiczny bucket, podatna zależność, SSRF z integracji (M5 — zasady na przyszłość), phishing;
     - zagrożenia T1–T9 z konsultacji EVM-002;
     - IDOR przez historię lokalizacji (`siteId`, uwaga 5 EVM-002) i skan dowodu jako `other` (uwaga 8);
     - oszustwo na płatnościach;
     - ransomware i usunięcie backupów z przejętej VM;
     - utrata MFA Administratora;
     - wyciek danych do telemetrii;
     - R1–R3 z ADR-0015.
   - **Skala ryzyka 3 × 3:** P i W od 1 do 3; wynik 1–2 = Low, 3–4 = Medium, 6 = High, 9 = Critical. Mapowanie na klasyfikację ustaleń: blocker / major / minor.
   - **Ryzyka rezydualne (AC6) `RR-xx`.** Każde opisane polami: opis, źródło, ryzyko po mitygacjach, rekomendacja (akceptuj albo dodatkowa mitygacja z kosztem), konsekwencja innego wyboru, pole decyzji Konrada. Lista obejmuje każde zagrożenie z ryzykiem rezydualnym co najmniej Medium oraz co najmniej:
     - CLOUD Act i podprocesorzy z USA (ADR-0011);
     - R1–R3 (ADR-0015);
     - klucz LUKS na VM (ADR-0003);
     - brak drobnoziarnistego IAM w Hetzner;
     - klucze lokalnej bazy dostępne po pierwszym odblokowaniu (ADR-0007);
     - BYOD bez MDM;
     - iOS bez weryfikacji MASVS (ADR-0015);
     - własny moduł `identity` przed pentestem;
     - wdrożenie prod wyzwalane z konta Konrada (ADR-0012);
     - EAS bez raportu SOC 2;
     - każdy Edytor widzi wszystkie zlecenia do M4;
     - kopie zapasowe a art. 17 (≤ 37 dni);
     - skuteczność redakcji telemetrii;
     - pojedyncza VM i jeden administrator.
2. **`requirements.md`**
   - **Jak korzystać:**
     - wzór wplatania `SR-…` w AC dla `product-owner` (EVM-010);
     - sposób weryfikacji dla QA;
     - wersje standardów: ASVS 5.0.0 L2 (L1 + L2); MASVS 2.1.0 z profilem MAS-L1 i wybranymi kontrolami MAS-L2 — nota, że od MASVS v2 „L1/L2” to profile testowe, a nie poziomy standardu.
   - **Katalog `SR-<obszar>-NN`** w obszarach: AUTH, SESS, AUTHZ, INPUT, API, WEB, FILE, DATA, CRYPTO, COMM, LOG, ERR, MOB, SYNC, INFRA, SUPPLY, PRIV. Kolumny:
     - wymaganie sformułowane tak, by dało się je wkleić do AC;
     - ASVS / MASVS;
     - moduł lub warstwa: `platform`, `identity`, `authorization`, `audit`, `parties`, `customers`, `sites`, `catalog`, `work-orders`, `procedures`, `payments`, `timeline`, `media`, `sync`, web, mobile, proxy i infrastruktura, CI;
     - epik (E1–E14) albo historyjka M0 (EVM-006, 007, 008, 009, 011, 013);
     - weryfikacja: rodzaj testu albo bramka;
     - źródło: ADR, `TM`, `AB`, polityka.
   - **Listy per epik** (E1–E14 i historyjki M0): numery `SR-…` do wplecenia oraz 2–3 przykładowe AC.
   - **Pokrycie ASVS:**
     - stosowalność rozdziałów V1–V17, np. V9 tokeny samowystarczalne — N/D, bo tokeny są nieprzezroczyste (ADR-0005), do ponownej oceny przy JWT; V10 OAuth/OIDC — N/D do M5; V17 WebRTC — N/D;
     - załącznik: każdy wymóg L1 i L2 rozdziałów stosowalnych → `SR-…` albo N/D z uzasadnieniem.
   - **MASVS:** wszystkie 24 kontrole ze stosowalnością, `SR-…` i epikiem; elementy specyficzne dla iOS oznaczone „odłożone (ADR-0015)”.
   - **Bramki bezpieczeństwa CI (AC5)** — tabela:
     - kolumny: obszar, narzędzie (ADR-0012), zakres, wyzwalacz (pre-commit / PR / `main` / nocą / przed wdrożeniem / przed wydaniem), środowisko (ADR-0015: gitleaks natywnie w pre-commit, reszta w CI Linux), próg blokujący, obsługa wyjątków (plik w repo z uzasadnieniem, właścicielem i datą wygaśnięcia; akceptuje `security-engineer`), historyjka wdrażająca;
     - wiersze: SAST (Semgrep CE + własne reguły, np. zakaz konkatenacji SQL i `dangerouslySetInnerHTML`), SCA podatności (OSV-Scanner + `pnpm audit`), licencje (Trivy, lista dozwolonych i wyjątki dla narzędzi nierozpowszechnianych), sekrety (gitleaks, pierwszy przebieg na pełnej historii), IaC i konfiguracja (Trivy: OpenTofu, Compose, Dockerfile), obrazy kontenerów (Trivy przed wdrożeniem i nocny skan wdrożonych obrazów), DAST (ZAP baseline po każdym wdrożeniu na staging; przed wydaniem dodatkowo skan API z OpenAPI — wyłącznie staging, nigdy produkcja), testy bezpieczeństwa z ADR-0004/0014 jako bramki (lint `x-evia-authz`, kompletność macierzy ról i IDOR), kontrole wdrożenia z ADR-0009/0011 (anonimowy `GET` = 403, skan portów z zewnątrz, niezmienność backupu), walidator dokumentacji (EVM-013);
     - wymaganie dla EVM-006: lokalne uruchamianie skanów przez agentów bez `docker run` (zakaz z ADR-0015).

     Narzędzia spoza ADR-0012 (np. analiza workflowów GitHub Actions, weryfikacja podpisów obrazów dla R3) są w osobnej sekcji „propozycje” do decyzji architekta i Konrada. Nie trafiają na listę blokującą.
3. **`policies.md`.** Każda polityka zawiera: rekomendację, warianty z konsekwencjami, zgodność z ADR (potwierdzenie albo doprecyzowanie przekazane do EVM-005), wpływ na model i epiki oraz pole „Decyzja Konrada”.
   - **AC3:**
     - **P1 MFA** — kogo obejmuje, mechanizm, odzyskiwanie MFA Administratora (ADR-0005);
     - **P2 Hasła i sesje** — web, tokeny mobilne, step-up, praca offline 7 dni, unieważnienie urządzenia i los niewysłanej kolejki (ADR-0007 ryzyko c, `offline-sync.md` otwarte 1–2);
     - **P3 EXIF/GPS** — oryginały i pochodne, telefon i upload z przeglądarki; wariant „usuwanie z oryginałów” ze skutkami dla niezmiennika SHA-256 i zależności;
     - **P4 Retencja mediów, dokumentów, dzienników, audytu, logów i kopii** — wartości wspólne z `rodo.md`;
     - **P5 Skanowanie plików** — ClamAV, limit dla dużych filmów (ADR-0009), kwarantanna, wiek sygnatur, fałszywe alarmy;
     - **P6 Zakres roli Tylko odczyt** — komórki „EVM-005” z macierzy uprawnień: płatności (P2 EVM-002), dokumenty `identity_data` i `building_security`, oryginały mediów, eksport, aplikacja mobilna; płatności poza telefonem (P3 EVM-002); podniesienie klasy pojedynczego dokumentu, nigdy obniżenie (uwaga 8).
   - **Przekazane z ADR i EVM-002:**
     - **P7** telefony i BYOD: blokada ekranu, minimalne wersje systemów, czyszczenie danych firmowych bez MDM, prywatność pracownika;
     - **P8** przypinanie certyfikatów (MASVS-NETWORK-2);
     - **P9** format adresu IP w sesjach, audycie i logach;
     - **P10** limit żądań per IP, progi masowego odczytu, podpisanych URL-i i eksportów;
     - **P11** wartości CSP i HSTS;
     - **P12** szyfrowanie pól (`platform/crypto`) i widoki `evia_readonly`.
4. **`rodo.md`** — szkic operacyjny, nie porada prawna; punkty do konsultacji oznaczone `[PRAWNIK/IOD]` i zebrane w jednej liście.
   - Administrator danych i role podmiotów: OSD i administracje jako odrębni administratorzy; ocena obowiązku wyznaczenia IOD.
   - Inwentaryzacja danych osobowych: kategorie osób × kategorie danych × miejsce (encja, storage, logi, telemetria, backupy, e-mail, telefon) × źródło × odbiorcy — na podstawie klasyfikacji EVM-002.
   - Cele i podstawy prawne (art. 6; ocena art. 9 i 10; PESEL w dokumentach `identity_data`).
   - Retencja — tabela zgodna z P4.
   - Podmioty przetwarzające i umowy powierzenia: tabela z ADR-0011, status DPA, transfery (SCC / DPF), checklista przed produkcją (E8).
   - Realizacja praw z art. 15–22: kanał, weryfikacja tożsamości, terminy, mapowanie na operacje systemu (eksport, anonimizacja, redakcja, purge) z wyjątkiem od append-only.
   - Obowiązek informacyjny: punkty klauzul dla klientów, osób trzecich na zdjęciach i pracowników (BYOD).
   - Privacy by design i wstępna ocena potrzeby DPIA.
   - Procedura naruszeń z terminem 72 h: wykrycie, ocena, ograniczenie, zgłoszenie do UODO, zawiadomienie osób, rejestr naruszeń prowadzony poza repozytorium, kontakty dostawców.
   - Szkic rejestru czynności przetwarzania (art. 30).
   - Dane rejestrowe firmy jako pola do uzupełnienia przez Konrada — bez prawdziwych danych osobowych.

**Kontrakt API / migracje:** nie dotyczy. Wymagania wobec przyszłego kontraktu (np. `hiddenFields` dla Tylko odczyt, sygnał „wyczyść urządzenie” przy unieważnieniu) i ewentualne rozszerzenia modelu (np. podniesienie klasy poufności pojedynczego dokumentu — zmiana *expand*) zapisuję jako `SR-…` i uwagi dla architekta. Nie zmieniam `api-guidelines.md` ani `domain-model.md`.

**Wejścia → gdzie rozstrzygane**
| Wejście | Źródło | Dokument |
|---|---|---|
| zakres roli Tylko odczyt; P2 (płatności); P3 (płatności poza telefonem); uwaga 8 (poufność per dokument) | `domain-model.md` → macierz uprawnień, EVM-002 | `policies.md` P6 |
| uwaga 5 (historia lokalizacji nie jest kotwicą autoryzacji) | EVM-002 | `threat-model.md` (AB), `requirements.md` (SR-AUTHZ, E3/E6) |
| EXIF/GPS | ADR-0009, `domain-model.md` (`MediaAsset`) | `policies.md` P3 |
| retencja i podstawy prawne (tabela klasyfikacji) | `domain-model.md`, ADR-0009, ADR-0013 | `policies.md` P4, `rodo.md` |
| soft delete / purge / anonimizacja / redakcja; wyjątek od append-only (art. 17) | `domain-model.md` → „Usuwanie danych” | `rodo.md` → prawa osób |
| zakres MFA, odzyskiwanie MFA Administratora; hasła, sesje, 7 dni offline | ADR-0005 | `policies.md` P1, P2 |
| los niewysłanej kolejki po unieważnieniu urządzenia | ADR-0007 (ryzyko c), `offline-sync.md` (otwarte 1–2) | `policies.md` P2 |
| limit skanu dużych filmów | ADR-0009 | `policies.md` P5 |
| przypinanie certyfikatów; BYOD (decyzja 4 EVM-001) | ADR-0007, `docs/architecture/README.md` | `policies.md` P7–P8, `rodo.md` |
| format IP; limit per IP; próg masowego odczytu; CSP/HSTS; szyfrowanie pól; `evia_readonly` | ADR-0013, ADR-0003, `api-guidelines.md`, `domain-model.md` | `policies.md` P9–P12 |
| lista skanów i progów | ADR-0012, ADR-0014, ADR-0015 | `requirements.md` → bramki CI |
| CLOUD Act; R1–R3; klucz LUKS | ADR-0011, ADR-0015, ADR-0003 | `threat-model.md` → ryzyka rezydualne |
| podprocesorzy i DPA | ADR-0011 | `rodo.md` |

**Plan weryfikacji AC** (inspekcja; skrypty pomocnicze wyłącznie w `.scratch/EVM-005/`, dane syntetyczne)
| AC | Jak sprawdzić |
|---|---|
| AC1 | Skrypt porównuje węzły i krawędzie Mermaid C4 L2 z `docs/architecture/README.md` z tabelą STRIDE: każdy element i każdy przepływ ma co najmniej jeden wiersz (100%). Wszystkie przypadki nadużyć wymienione w AC1 mają `AB-xx` z oceną P × W i mitygacjami. Skrypt przelicza wynik ryzyka (P × W) i porównuje z ratingiem. Każde `SR-…` użyte w modelu istnieje w `requirements.md`. Diagramy, jeśli powstaną, renderują się lokalnie (mermaid-cli w `.scratch/`, bez serwisów online). |
| AC2 | Skrypt pobiera oficjalny CSV ASVS 5.0.0 i listę kontroli MASVS 2.1.0 do `.scratch/` i sprawdza:<br>- każdy cytowany identyfikator istnieje i ma poziom ≤ L2 (L3 tylko jawnie oznaczony);<br>- każdy wymóg L1 i L2 rozdziałów stosowalnych ma `SR-…` albo N/D z uzasadnieniem;<br>- każda z 24 kontroli MASVS ma wiersz;<br>- każde `SR-…` ma moduł z mapy modułów (z `parties`) i epik E1–E14 albo historyjkę M0;<br>- każdy epik E1–E14 ma listę „do wplecenia w AC”.<br>Identyfikatory ASVS cytowane w ADR-ach i w `api-guidelines.md` sprawdzam tym samym skryptem; rozbieżności → uwagi. |
| AC3 | `policies.md` ma P1–P6 z AC3, każda z rekomendacją, wariantami, konsekwencją, zgodnością z ADR i polem decyzji. Wartości są zgodne z ADR-0005/0007/0009/0013, a odstępstwa oznaczone jako propozycje. Wejścia P2, P3, uwaga 5 i uwaga 8 z EVM-002 są obsłużone, a każda komórka „EVM-005” z macierzy uprawnień ma odpowiedź w P6. |
| AC4 | `rodo.md` ma 7 elementów z AC4 i zastrzeżenie „szkic operacyjny, nie porada prawna”. Znaczniki `[PRAWNIK/IOD]` są zebrane w liście. Inwentaryzacja obejmuje każdą encję z tabeli klasyfikacji EVM-002 (porównanie skryptem). Podmioty przetwarzające są zgodne z ADR-0011. Retencja jest zgodna z P4 (porównanie skryptem). Brak prawdziwych danych osobowych. |
| AC5 | Tabela obejmuje SAST, SCA (podatności i licencje), sekrety, IaC, kontenery i DAST na staging. Każdy wiersz ma narzędzie z ADR-0012, wyzwalacz, środowisko zgodne z ADR-0015, próg blokujący, obsługę wyjątków i historyjkę wdrażającą (EVM-006 / EVM-007 / EVM-013 / E8). Na liście blokującej nie ma narzędzia spoza ADR-0012. |
| AC6 | Każde `RR-xx` ma opis, źródło, ryzyko, rekomendację, konsekwencję i pole decyzji. Lista obejmuje CLOUD Act, R1–R3 i każde `TM` / `AB` z ryzykiem rezydualnym ≥ Medium (porównanie skryptem). |
| Bramki | `npm run docs:check`: 0 błędów (cel: 0 ostrzeżeń). `npm run test:tools`: 189/189, bez regresji. Linki względne i kotwice są poprawne; linki do dokumentów EVM-002 sprawdzam względem drzewa gałęzi EVM-002 (`git show`). |

**Kolejność kroków**
1. Przygotowanie w `.scratch/EVM-005/`:
   - pobranie ASVS 5.0.0 (CSV) i kontroli MASVS 2.1.0;
   - szkielet listy identyfikatorów L1 + L2;
   - inwentarz elementów i przepływów C4 L2;
   - zebranie zagrożeń z ADR-ów i EVM-002.
2. `threat-model.md`: zakres, aktywa i aktorzy → elementy, przepływy i granice → STRIDE → przypadki nadużyć → ocena ryzyka.
3. `requirements.md`: katalog `SR-…` (z mitygacji z kroku 2) → listy per epik → pokrycie ASVS i załącznik → MASVS → bramki CI.
4. `policies.md` (P1–P12), potem `rodo.md` (retencja wspólna z P4).
5. Ryzyka rezydualne w `threat-model.md` po ustaleniu polityk, bo rekomendacje zmieniają ryzyko rezydualne.
6. `docs/security/README.md`, `docs/README.md`, `CHANGELOG.md`; samosprawdzenie wg tabeli wyżej; `npm run docs:check`, `npm run test:tools`; wpis w „Dzienniku”; uwagi do EVM-002 w „Uwagach do rozważenia”.

**Na demo (nieblokujące):**
- decyzje P1–P12 i akceptacja ryzyk `RR-xx` — rekomendacje zostaną wpisane w dokumentach;
- dane do uzupełnienia przez Konrada (w dokumentach jako pola):
  - dane rejestrowe administratora;
  - czy firma ma prawnika lub IOD do konsultacji;
  - oczekiwany okres przechowywania dokumentacji (roadmapa, „Czego potrzebujemy od Ciebie”, pkt 7). Do czasu odpowiedzi stosuję rekomendację domyślną z oznaczeniem `[PRAWNIK/IOD]`.

**Ryzyka planu**
- Duży załącznik ASVS → szkielet generowany z oficjalnego CSV w `.scratch/`, mapowanie ręczne.
- Niepewności prawne → oznaczenia `[PRAWNIK/IOD]`, bez rozstrzygnięć prawnych.
- Konflikty przy merge z EVM-002 (`docs/README.md`, `CHANGELOG.md`) → rozwiązuje orkiestrator.

## Decyzje
- 2026-10-03 — Konrad: start EVM-005 po zakończeniu potoku EVM-002 (kolejka zamiast równoległego worktree); model domeny z EVM-002 jako wejście.
- 2026-10-03 — Konrad (demo): **akceptacja przyrostu** wraz z rekomendacjami polityk P1–P12 (`policies.md`) i ryzyk rezydualnych RR-01…RR-20 (`threat-model.md` § 8). Pozycje płatne — zewnętrzny pentest przed produkcją (RR-10, E8) i klucz sprzętowy dla konta awaryjnego (RR-16) — trafiają do planu; zakup wymaga osobnej zgody Konrada. Do uzupełnienia przez Konrada (do tego czasu obowiązują rekomendacje): dane rejestrowe firmy (`rodo.md`), prawnik / IOD do konsultacji punktów `[PRAWNIK/IOD]`, liczba telefonów we flocie (próg poprawek w P7).

## Uwagi do rozważenia
### Implementacja (security-engineer, 2026-10-03)
**Uwagi do modelu EVM-002 i dokumentów architektury** — dla `solution-architect`, nieblokujące. Dokumentów EVM-002 ani ADR nie zmieniałem; zmiany po akceptacji polityk.
1. `api-guidelines.md` cytuje ASVS 1.2.10 (formula injection) — to wymaganie **L3**; przyjęte świadomie w SR-API-14 (M4). Pozostałe 16 cytowanych identyfikatorów istnieje i ma poziom L1 albo L2. ADR-y cytują tylko rozdziały ASVS.
2. Macierz uprawnień w `domain-model.md`: komórki „EVM-005” rozstrzyga P6 — Tylko odczyt widzi płatności i pobiera dokumenty `standard`; bez oryginałów mediów, dokumentów `identity_data` i `building_security`, eksportów i aplikacji mobilnej; eksport danych (CSV) — tylko Administrator ze step-upem; eksport ZIP mediów — bez zmian (Administrator, Edytor).
3. Propozycja zmiany *expand*: `Document.confidentialityOverride` — podniesienie klasy pojedynczego dokumentu, nigdy obniżenie (P6, uwaga 8 EVM-002).
4. Retencja zleceń anulowanych przed akceptacją (P4) wymaga rozpoznania „nigdy w `accepted`” — z dziennika `event` albo nowej kolumny `acceptedAt` (*expand*).
5. `offline-sync.md` → „Otwarte — EVM-011”, punkty 1–2: odpowiedź w P2 (tryby „Wyloguj urządzenie” i „Zablokuj i wyczyść”, 7 dni offline); w katalogu kodów `api-guidelines.md` potrzebny kod czyszczenia urządzenia (propozycja `device_wipe_required`).
6. Limit żądań per IP: rekomendacja 1200 / min (P10) zamiast propozycji 600 / min w `api-guidelines.md` (biuro za NAT).
7. Format `ipAddress` (P9): `AuditEvent` — prefiks /24 i /48; `Session` — pełny IP.
8. Uwaga 1 EVM-002 (soft delete zlecenia a transze): rekomendacja wariantu (a) — soft delete zlecenia z transzami `paid` tylko Administrator ze step-upem (SR-AUTHZ-10); z transzami `invoiced` — `409`, jak w modelu.
9. Uwaga 2 EVM-002 (kursor po odtworzeniu bazy): runbook odtworzenia (EVM-007) powinien obejmować też ponowne zastosowanie rejestru usunięć (SR-PRIV-04).
10. ADR-0011: kopie dysku systemowego VM (Hetzner Backups) zawierają plik klucza LUKS — RR-05 (opcja: klucz pobierany przy starcie z menedżera sekretów innego dostawcy).
11. ASVS V11.3.3: pgBackRest szyfruje wyłącznie `aes-256-cbc` (bez uwierzytelnionego szyfrowania) — integralność kopii zapewnia object lock; informacyjnie.
12. P5 doprecyzowuje bitrate wideo do ≤ 8 Mb/s (ADR-0009: „~10 Mb/s”), bo ClamAV pomija pliki > 2 GB; do potwierdzenia pomiarem jakości w EVM-011.
13. NFR „do potwierdzenia w EVM-005” w `docs/architecture/README.md` (MFA, sesje, offline, audyt) — aktualizacja po decyzjach P1, P2, P4.
14. CVE-2026-33634 (Trivy, marzec 2026: przepisane tagi `trivy-action`, złośliwa binarka) — EVM-006 instaluje narzędzia skanujące z wersji i sumy kontrolnej, nie przez akcje po tagu (SR-SUPPLY-04).
15. Najmniejsze uprawnienia kanału (SR-AUTHZ-12, przegląd architekta — runda poprawek 1): w `api-guidelines.md` → „Autoryzacja” `x-evia-authz.channels` obowiązkowe z wartością wyjściową `[web]`; `mobile` tylko dla operacji aplikacji (logowanie i odświeżenie tokenu, synchronizacja, sesje uploadu, URL-e miniatur, profil, wylogowanie, `meta/client-config`); `stepUp: true` i funkcje administracyjne tylko `web` (reguła lint); kanał z typu sesji (`Session.channel`), nie z `X-Client-*`. Dostęp roli do kanału to reguła rola × kanał w `identity` (Tylko odczyt bez `mobile`), nie `channels`. Do katalogu kodów — propozycja `403 channel_not_allowed`. Macierz ról generowana z wymiarem kanału.
16. Tożsamość urządzenia (P2, SR-MOB-04 — runda poprawek 1): rejestracja urządzenia wydaje `deviceId` i sekret instalacji (256 bitów, Keystore; w `Device` tylko skrót — zmiana *expand*); ponowne logowanie tego samego użytkownika na tej samej instalacji po „Wyloguj urządzenie” albo unieważnieniu automatycznym wraca do tego samego `deviceId`, więc idempotencja i sesje uploadu (`offline-sync.md` zasada 5, ADR-0009) są ciągłe. Unieważnienia automatyczne (ponowne użycie refresh tokenu poza oknem tolerancji 30 s, 30 dni bez kontaktu) działają jak „Wyloguj urządzenie”; trwałe unieważnienie i dezaktywacja → `401 device_wipe_required` (do katalogu kodów). Kontrakt logowania mobilnego: `deviceId` i sekret instalacji. Adnotacje w ADR-0005 („każde logowanie mobilne rejestruje urządzenie”, „unieważnienie … urządzenia” przy ponownym użyciu refresh tokenu) i ADR-0007 (ryzyko c) po akceptacji P2. Retencja urządzeń: 90 dni od unieważnienia albo ostatniego kontaktu (P4, `rodo.md`).
17. Próg poprawek bezpieczeństwa (P7, SR-MOB-06 — runda poprawek 1): tryb i próg w `meta/client-config` („tylko ostrzegaj” na start, „blokuj” po spisie floty), poziom poprawek jako atrybut `Device` (zmiana *expand*). Tryb „blokuj” zawęża w praktyce „Android 10+” (decyzja 4 z EVM-001, ADR-0007, NFR „Platformy”) — po decyzji Konrada adnotacja w ADR-0007 i NFR.
18. Rejestr usunięć poza odtwarzaną bazą (SR-PRIV-04 — runda poprawek 1): osobny bucket w projekcie Scaleway środowiska (`pl-waw`) z wersjonowaniem i lifecycle 40 dni (IaC), klucz aplikacji tylko `PutObject`, wpis przed wykonaniem operacji, odczyt tylko w runbooku odtworzenia; rejestr obejmuje też redakcję (art. 17, SR-PRIV-03) i jest stosowany do bazy po PITR oraz do mediów z Storage Box albo starszych wersji obiektów. Dodatkowy bucket w modułach IaC — bez zmiany decyzji ADR-0009 i ADR-0011; dotyczy też uwagi 9.
19. Kanał wdrożenia CI → VM (SR-INFRA-14 — runda poprawek 1): **otwarta decyzja EVM-007** (`solution-architect` i `devops-engineer`) — rekomendacja: wzorzec pull (manifest digestów zapisywany tylko przez środowisko ograniczone do `main`, agent na VM, token GHCR `read:packages`), alternatywa: SSH z tymczasową regułą dla IP runnera i poleceniem wymuszonym (wtedy token Hetzner w jobie wdrożenia — RR-06). ADR-0012 nie opisuje kanału CI → VM — po wyborze adnotacja w ADR-0012.
20. Test odtworzenia (SR-INFRA-07, RR-20 — runda poprawek 1): odtworzenie wyłącznie na tymczasowej VM w projekcie prod, CI tylko orkiestruje; na prod test miesięczny nieniszczący, scenariusz „backup usunięty z przejętej VM” co miesiąc na staging (ten sam moduł backupu z IaC) i na prod w corocznym ćwiczeniu DR — zgodnie z ADR-0011. Pytanie do architekta: czy dedykowany projekt Hetzner testów odtworzenia na koncie prod (rekomendacja RR-20 — token bez dostępu do VM prod) mieści się w „projekcie prod” z ADR-0003 i ADR-0011; po decyzji Konrada (wariant A albo B) adnotacja w ADR-0012 o środowisku `prod-restore-test`.
21. Tożsamość agentów w GitHub (RR-02, RR-11 — runda poprawek 1): GitHub nie pozwala użyć tokenu fine-grained w repozytorium, w którym konto jest tylko collaboratorem — rekomendacja: GitHub App zainstalowana tylko w tym repozytorium (bez `actions` i `administration`); przy wymaganej akceptacji PR i braku obejść wszystkie PR-y zakłada aplikacja, Renovate używa jej tokenu, a „Allow GitHub Actions to create and approve pull requests” jest wyłączone.
22. Reset hasła i MFA a urządzenia (SR-AUTH-11, SR-AUTH-13, P2 — runda poprawek 2): ADR-0005 „po resecie unieważnienie wszystkich sesji i urządzeń” doprecyzowane jako zakończenie sesji web i sesji urządzeń w trybie „Wyloguj urządzenie” (`401 session_revoked`, kolejka zostaje, ten sam `deviceId` po zalogowaniu nowym hasłem i MFA) — kolejna adnotacja w ADR-0005 po akceptacji P2, bez zmiany decyzji. Zmiana roli na Tylko odczyt działa jak „Zablokuj i wyczyść” (rola bez kanału `mobile`) — przed zapisem Administrator widzi `pendingItemsReported` i potwierdza utratę (kontrakt operacji zmiany roli: podsumowanie urządzeń i potwierdzenie, SR-AUTHZ-09); zmiana między Administratorem a Edytorem — „Wyloguj urządzenie”.

**Do przekazania (nieblokujące)**
- `product-owner` (EVM-010): listy `SR-…` per epik z przykładowymi AC — `requirements.md` → „Wymagania do wplecenia w AC — per epik”.
- `devops-engineer` (EVM-006, EVM-007): tabela bramek CI, skany lokalne bez `docker run`, propozycje (zizmor, cosign, tożsamość agentów jako GitHub App), kanał wdrożenia (SR-INFRA-14 — otwarta decyzja EVM-007), test odtworzenia (SR-INFRA-07, RR-20), rejestr usunięć poza bazą (SR-PRIV-04).
- `mobile-developer` (EVM-011, E9): weryfikacja trybów unieważnienia i ciągłości `deviceId` po ponownym logowaniu, jednego procesu odświeżania tokenu (P2), bitrate (P5), brak uprawnienia lokalizacji (P3), sprawdzanie blokady ekranu przy uruchomieniu i wznowieniu oraz progu poprawek z `client-config` (P7).

**Na demo (rekomendacje wpisane w dokumentach)**
1. Polityki P1–P12 (`policies.md`) — akceptacja rekomendacji lub inny wariant.
2. Ryzyka rezydualne RR-01…RR-20 (`threat-model.md`, rozdział 8), w tym dodatkowe mitygacje: osobna tożsamość GitHub dla agentów — GitHub App (RR-02, RR-11), zewnętrzny pentest przed produkcją (RR-10), drugi Administrator albo konto awaryjne (RR-16), opcjonalnie klucz LUKS z menedżera sekretów (RR-05), tożsamość testu odtworzenia — środowisko `prod-restore-test` z harmonogramem albo miesięczne uruchomienie przez Konrada (RR-20).
3. Dane rejestrowe administratora i informacja, czy firma ma prawnika lub IOD (`rodo.md`).
4. Okres przechowywania dokumentacji (pytanie 7 z roadmapy) — rekomendacja 6 lat od końca roku zamknięcia zlecenia (P4).
5. Próg poprawek bezpieczeństwa telefonów (P7): czy po spisie floty włączamy tryb „blokuj” (poprawki starsze niż 12 miesięcy), choć odetnie część telefonów z Androidem 10+ — rekomendacja: tak, pilotaż w trybie „tylko ostrzegaj”, potem blokada z 30-dniowym uprzedzeniem.

### Uwagi nieblokujące z weryfikacji (runda 3, orkiestrator 2026-10-03)
Ustalenia minor / nit z QA i przeglądów rundy 3, niezałatwione w historyjce:
1. **Bramka 4 (licencje) niewdrażalna dosłownie** (QA, minor; `requirements.md` → „Bramki bezpieczeństwa CI”). Brakuje OFL-1.1 (fonty Inter, Exo 2, JetBrains Mono ze styleguide), a skan licencji obrazów serwerowych zgłosi pakiety systemowe (GPL/LGPL) i ClamAV. → przed EVM-006: dodać OFL-1.1, „dystrybuowane” = paczka panelu i aplikacja mobilna (obrazy serwerowe nie są redystrybuowane) albo `--pkg-types library`.
2. **Kolejność sprawdzeń przy logowaniu mobilnym na urządzeniu do czyszczenia** (solution-architect, minor; `requirements.md` SR-AUTHZ-12, SR-MOB-04; `policies.md` P2). Najpierw stan urządzenia (`401 device_wipe_required`), potem poświadczenia i reguła rola × kanał (`403 channel_not_allowed`). → doprecyzować w SR-MOB-04 przed E1 / E9.
3. **Awaryjny reset MFA Administratora przez SSH nie kończy sesji** (devops-engineer, minor; `policies.md` P1 pkt 5 vs SR-AUTH-13). → dopisać w P1 pkt 5 i w runbooku EVM-007: zakończenie sesji w trybie „Wyloguj urządzenie” i przegląd urządzeń („Zablokuj i wyczyść” dla utraconego telefonu).
4. **AB-22 nieaktualny po rundzie 1** (QA, nit; `threat-model.md`). Administrator w panelu loguje się passkey, więc scenariusz to utrata passkey i kodów odzyskiwania, nie telefonu z TOTP.
5. **Odwołania zwrotne w załączniku ASVS** (QA, nit; `requirements.md` → Załącznik A, V8.2.1–V8.3.1) i **wiersze MASVS** wskazujące SR bez cytowania kontroli (STORAGE-2, AUTH-1, AUTH-3, NETWORK-2, CODE-4, RESILIENCE-3). Pokrycie niezagrożone.
6. **Powiązania RR ↔ TM niesymetryczne** (QA, nit; `threat-model.md` RR-19 / TM-97, RR-20 / TM-101–102).
7. **Przykładowe AC spoza listy epiku** (QA, nit; `requirements.md` E1, E2, E5). Przykłady urządzeń w E1 zależą od rejestracji urządzeń z E9 (M2). → oznaczyć „od E9” przy wplataniu w AC (product-owner).
8. **Gałąź sprzed EVM-002** (QA, nit). Przy merge zachować w `CHANGELOG.md` oba wpisy (EVM-002 i EVM-005); po scaleniu linki do dokumentów EVM-002 działają (próbny merge: `docs:check` 0/0).

## Definition of Done
- [x] AC1–AC6 spełnione (weryfikacja QA przez inspekcję) — QA runda 3: PASS dla AC1–AC6 (niezależne skrypty, ID ASVS 5.0.0 / MASVS 2.1.0 sprawdzone z oficjalnymi źródłami); bramki u orkiestratora: `npm run docs:check` 0 błędów / 0 ostrzeżeń, `npm run test:tools` 189/189, pokrycie 100%
- [x] Przeglądy: solution-architect, devops-engineer — APPROVE (runda 3; R1: 7× major, R2: 1× major — poprawione)
- [x] Demo i akceptacja Konrada (polityki z AC3, ryzyka z AC6) — 2026-10-03: „Akceptuję” z rekomendacjami (sekcja „Decyzje”)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — ready → in-progress: start /deliver, gałąź `feature/EVM-005-model-zagrozen` (decyzja Konrada: start po zakończeniu potoku EVM-002; model domeny z EVM-002 jako wejście)
- 2026-10-03 — plan techniczny (security-engineer)
- 2026-10-03 — implementacja (security-engineer): `docs/security/threat-model.md` (21 elementów, 29 przepływów, 96 wierszy STRIDE — pokrycie C4 L2: 14/14 węzłów i 19/19 krawędzi; 27 przypadków nadużyć; 19 ryzyk rezydualnych; po mitygacjach 0 ryzyk High i Critical), `requirements.md` (164 wymagania `SR-…` w 17 obszarach; listy per epik E1–E14 i historyjki M0 z przykładowymi AC; ASVS 5.0.0: 210 wymagań L1 + L2 z 14 rozdziałów stosowalnych → 187 przypisanych do `SR-…`, 23 N/D z uzasadnieniem, 22 wymagania L3 przyjęte świadomie; MASVS 2.1.0: 24/24; 12 bramek CI z progami i wyjątkami + propozycje poza ADR-0012), `policies.md` (P1–P12), `rodo.md` (szkic operacyjny, 36 znaczników `[PRAWNIK/IOD]` zebranych w 14 punktach); odwołania w `docs/security/README.md`, `docs/README.md`, `CHANGELOG.md`. Samosprawdzenie skryptami w plikach roboczych: identyfikatory ASVS i MASVS z oficjalnych plików wydań (0 nieistniejących), P × W i oceny, pokrycie C4, odwołania `SR`/`RR`, inwentaryzacja = klasyfikacja EVM-002 (28/28), retencja P4 = `rodo.md` (28 pozycji), 87 linków i kotwic (dokumenty EVM-002 sprawdzone na ich gałęzi) — 0 błędów; diagram Mermaid renderuje się lokalnie; `npm run docs:check` — 0 błędów, 0 ostrzeżeń; `npm run test:tools` — 189/189, pokrycie 100%. Bez zmian ADR-0001…0015 i dokumentów EVM-002; uwagi dla architekta w „Uwagach do rozważenia”.
- 2026-10-03 — poprawki, runda 1 (backend-developer; ustalenie major `solution-architect` — kanał `mobile` Administratora z TOTP): nowe SR-AUTHZ-12 (najmniejsze uprawnienia kanału; `requirements.md` — 165 wymagań `SR-…`, 24 wymagania L3 przyjęte świadomie: dodane V8.1.3 i V8.2.4); SR-AUTH-06, SR-AUTH-14, SR-SESS-08, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-11, MASVS-AUTH-3, bramka 9 i listy E1, E9, E10, E11, EVM-008 zaktualizowane; P1 — TOTP Administratora tylko w kanale `mobile`, nowy wariant F (Administrator tylko w panelu); P6 — odmowa logowania mobilnego roli Tylko odczyt jako reguła rola × kanał (`403 channel_not_allowed`, uwaga 15); AB-02 przeliczony per ścieżka — rezydualnie 4 Medium (v1: 3 Medium dzięki passkey, który nie obejmował logowania mobilnego Administratora; bez SR-AUTHZ-12 ta ścieżka to 6 High), RR-17 i TM-90 — 4 Medium; podsumowanie ryzyka bez zmian (0 High i Critical).
- 2026-10-03 — poprawki, runda 1 (mobile-developer; ustalenia major `solution-architect` — tożsamość urządzenia po „Wyloguj urządzenie” i próg poprawek): P2 — sekret instalacji i ten sam `deviceId` przy ponownym logowaniu tego samego użytkownika na tej samej instalacji, unieważnienia automatyczne jak „Wyloguj urządzenie”, jeden proces odświeżania tokenu w `sync-core` z oknem tolerancji 30 s, dezaktywacja → `401 device_wipe_required`, nowe warianty; doprecyzowane SR-AUTH-14, SR-SESS-04, SR-SESS-06, SR-SESS-09, SR-CRYPTO-03, SR-MOB-04, SR-MOB-13, SR-SYNC-01, SR-SYNC-03, SR-SYNC-08 i przykłady AC (E1, E9, E11, EVM-011); P7 — konsekwencja progu poprawek wobec „Android 10+”, tryby „tylko ostrzegaj” i „blokuj” z `client-config`, pytanie do Konrada („Na demo”, pkt 5), wariant F; SR-MOB-06 — blokada ekranu sprawdzana też przy uruchomieniu i wznowieniu; TM-02, TM-06, AB-03, AB-04, AB-09, RR-07, RR-08 zaktualizowane (oceny bez zmian); retencja urządzeń — 90 dni od unieważnienia albo ostatniego kontaktu (P4, `rodo.md`); uwagi 16–17. Liczba `SR-…` bez zmian (165).
- 2026-10-03 — poprawki, runda 1 (devops-engineer; po 2 ustalenia major `solution-architect` i `devops-engineer`): **rejestr usunięć** — SR-PRIV-04 przechowuje go poza odtwarzaną bazą (osobny bucket, klucz aplikacji tylko `PutObject`, odczyt tylko w runbooku), obejmuje redakcję i jest stosowany do bazy po PITR i do mediów z kopii; RR-14, P4, `rodo.md` i przykładowe AC (E8, EVM-007) zaktualizowane. **Tożsamość agentów** — RR-02 i RR-11 bez tokenu fine-grained konta-collaboratora (GitHub tego nie obsługuje): warianty (a) GitHub App (rekomendacja), (b) classic PAT konta maszynowego, (c) organizacja GitHub Team; wszystkie PR-y zakłada tożsamość agentów; propozycje, AB-24 i „Do przekazania” w `policies.md` zaktualizowane. **Kanał wdrożenia** — nowe SR-INFRA-14 (wzorzec pull albo SSH z regułą tymczasową; zakaz zakresów IP GitHub Actions; otwarta decyzja EVM-007), TM-97…TM-99 (DF-24: S, I, E); SR-INFRA-01, SR-COMM-05, SR-INFRA-13, bramka 5, RR-06, RR-19 i AB-27 powiązane. **Test odtworzenia** — SR-INFRA-07 i bramka 10: odtworzenie wyłącznie na tymczasowej VM w projekcie prod (CI tylko orkiestruje), na prod test nieniszczący, scenariusz z usuwaniem na staging i w corocznym ćwiczeniu DR; nowy przepływ DF-30, TM-100…TM-102 i RR-20 (tożsamość jobu); AB-21. Uwagi 18–21. Liczby: 166 `SR-…`, 30 przepływów, 102 wiersze STRIDE (bazowo 2 Critical, 24 High, 47 Medium, 29 Low; rezydualnie 35 Medium, 67 Low), 20 ryzyk rezydualnych; po mitygacjach nadal 0 ryzyk High i Critical. Kontrola spójności skryptem w plikach roboczych (oceny P × W, tabela podsumowania, odwołania `SR`/`RR`/`TM`/`DF`, listy per epik, 4 ustalenia) — przed poprawką 14 błędów, po — 0.
- 2026-10-03 — poprawki, runda 2 (backend-developer; ustalenie major `solution-architect` — reset hasła i MFA a tryb unieważnienia urządzeń): SR-AUTH-11 i SR-AUTH-13 — reset kończy sesje web i sesje urządzeń w trybie „Wyloguj urządzenie” (kolejka zostaje, ten sam `deviceId`), trwałe czyszczenie tylko „Zablokuj i wyczyść” i dezaktywacja, nieznane urządzenia Administrator czyści ręcznie, przy utracie telefonu z drugim czynnikiem — „Zablokuj i wyczyść”; P2 — reset hasła i MFA w kolumnie „Kiedy” trybu „Wyloguj”, adnotacja do ADR-0005, zmiana roli na Tylko odczyt jak „Zablokuj i wyczyść” po potwierdzeniu `pendingItemsReported` (procedura: najpierw synchronizacja), nowe warianty; SR-AUTHZ-09 i SR-MOB-04 doprecyzowane; przykłady AC w E1 (reset → `401 session_revoked`, zmiana roli na Tylko odczyt → `pendingItemsReported`) i E9 (kolejka po resecie); SR-AUTH-11 także w E9; uwaga 22. Liczba `SR-…` bez zmian (166). Kontrola skryptem w plikach roboczych — przed poprawką 16 z 17 sprawdzeń czerwonych, po — 17/17; weryfikacja QA (listy per epik, odwołania, linki) — 0 błędów.
- 2026-10-03 — workflow `deliver-story`: `passed` po 3 rundach (R1: SA + devops CHANGES, 7× major; R2: SA CHANGES, 1× major; R3: 2× APPROVE, QA PASS)
- 2026-10-03 — in-progress → in-review: DoD (AC + przeglądy) spełnione, uwagi minor / nit w „Uwagach do rozważenia”; czeka na demo i decyzje Konrada (P1–P12, RR-01…RR-20)
- 2026-10-03 — in-review → done: akceptacja Konrada na demo (P1–P12, RR-01…RR-20 z rekomendacjami); decyzje wpisane w `policies.md` i `threat-model.md`; squash merge do `main`
