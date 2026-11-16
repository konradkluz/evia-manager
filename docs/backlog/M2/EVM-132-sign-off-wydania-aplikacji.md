---
id: EVM-132
title: "Sign-off wydania aplikacji: checklista MASVS L1, warunek RR-96, utrata telefonu"
type: story
milestone: M2
epic: E14 Dystrybucja i utrzymanie
status: draft
priority: P1
path: pelna             # dokumentacja i ocena plus mała zmiana API (walidacja kanału mobile, RR-96 wariant B) — obszar ryzyka
owner: security-engineer
contributors: [qa-engineer, backend-developer]
reviewers: [solution-architect, code-reviewer]
depends_on: [EVM-112]
---

# EVM-132: Sign-off wydania aplikacji — checklista MASVS L1, warunek RR-96, utrata telefonu

> **Szkic ramowy z danymi do uzupełnienia** — wydzielona 2026-11-15 z EVM-112 (decyzja Konrada „podziel 112 na dwie”). Brakuje: decyzji Konrada o źródle spisu floty (rekomendacja: lista urządzeń w panelu), listy dowodów z przeglądów do checklisty (przygotuje security-engineer po EVM-112) i numeru wydania. Wzór: [EVM-070](../M1/EVM-070-security-sign-off-1-0.md).

## Cel
Jako **Konrad** chcę **formalnego security sign-offu wydania aplikacji (1.1)**, aby **technicy mogli jej używać na stałe, mając pewność, że znane ryzyka są zamknięte albo świadomie zaakceptowane, a utrata telefonu ma przećwiczoną procedurę**. Test praktyczny i dystrybucja na telefony testowe nie czekają na tę historyjkę ([EVM-112](EVM-112-test-terenowy-i-masvs.md)).

## Kryteria akceptacji

**AC1 — Checklista MASVS L1 w sign-offie wydania 1.1**
- Zakładając checklistę MASVS v2.1 na poziomie L1 dla STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE i PRIVACY (RESILIENCE poza zakresem — jawne ryzyka resztkowe: brak wykrywania roota i obfuskacji poza R8), wypełnianą na podstawie dowodów z przeglądów historyjek `pelna` (m.in. plik bazy nieczytelny, brak danych osobowych w logach i schowku, `cleartextTrafficPermitted=false`, rotacja i reuse tokenów, reguła 7 dni, `FLAG_SECURE`, eksportowane komponenty, brak SDK analitycznych i telemetrii — EVM-102 AC5) oraz z wyników sprawdzeń z EVM-112
- Gdy security-engineer wykonuje security sign-off wydania 1.1
- Wtedy checklista jest częścią sign-offu (bez osobnego testu MASTG i pentestu), każda pozycja ma dowód albo jawne „nie dotyczy”, a brak otwartych Critical/High/Medium albo każde ma zaakceptowane ryzyko resztkowe.

**AC2 — Warunek RR-96 (media bez pliku)**
- Zakładając ryzyko RR-96 (komenda `CreateMediaAsset` tworzy medium bez pliku, niewidoczne w panelu, bez retencji i limitu) i decyzję Konrada o wariancie
- Gdy sprawdzam warunek przed wydaniem aplikacji z wysyłaniem
- Wtedy spełniony jest **wariant B (decyzja Konrada 2026-11-15; zastępuje jego decyzję z 2026-11-14/15 o warunkach (1)–(3) blokujących wydanie)**: serwer odrzuca `description` w `CreateMediaAsset` z kanału `mobile` kodem ze słownika mutacji (zmiana kontraktu i jednej walidacji, test macierzy kanałów, `backend-developer`) oraz jest zapisana akceptacja ryzyka dla warunków (1)–(3) z przeglądem przy zamknięciu M3 albo najpóźniej **2027-02-15**; do tego czasu Konrad sam liczy media bez pliku starsze niż 7 dni, a przy > 50 albo pierwszym żądaniu z art. 15/17 realizujemy warunki (1)–(3) (panel „Czeka na plik z telefonu” z usuwaniem, retencja 30 dni, limit przy `CreateMediaAsset`) w osobnej historyjce.

**AC3 — Utrata telefonu i spis floty**
- Zakładając fizyczny telefon z zalogowaną aplikacją i niewysłanymi elementami oraz spis floty zawierający poziom poprawek każdego telefonu (źródło spisu: decyzja Konrada)
- Gdy Administrator wykonuje „Zablokuj i wyczyść” (to samo ćwiczenie co M10 w EVM-112, dowód wspólny) i przeglądam spis floty
- Wtedy procedura utraty telefonu jest przećwiczona (telefon czyści dane i potwierdza to serwerowi, pliki znikają), każdy telefon w spisie ma model, wersję Androida i poziom poprawek, a Konrad podejmuje i zapisuje decyzję, czy włączyć tryb „blokuj” dla poprawek starszych niż 12 miesięcy (P7; z 30-dniowym uprzedzeniem).

**AC4 — Ponowna ocena ryzyk i dokumenty**
- Zakładając wyniki EVM-112 (czas oczekiwania plików bez zasięgu, spis floty) i oczekujące akceptacje
- Gdy security-engineer ocenia ponownie RR-07 i RR-98 (razem, z najdłuższym czasem oczekiwania filmu zmierzonym w EVM-112, M19), rozstrzyga RR-100 (do akceptacji Konrada) i sprawdza brak oczekujących odwołań ze starej wersji (RR-97)
- Wtedy `threat-model.md`, rejestr ryzyk resztkowych i `rodo.md` są zaktualizowane (lista telefonów, procedura utraty), odwołania „sign-off EVM-112” w dokumentach spoza backlogu (`threat-model.md`, `requirements.md`, `rodo.md`, `workflow.md`, `dystrybucja-apk-android.md`) wskazują EVM-132, a `policies.md` P7 pkt 3 nie wymienia już mikrofonu (decyzja 6); każda zmiana oceny ma datę i uzasadnienie.

**AC5 — Decyzja o stałym używaniu**
- Zakładając AC1–AC4 spełnione
- Gdy Konrad przegląda sign-off
- Wtedy zapisuje decyzję „stałe używanie przez techników: tak / nie” z listą warunków; do tego czasu aplikację ma wyłącznie zarząd na test (EVM-112), a przed udostępnieniem jej komukolwiek spoza zarządu spełnione są warunki dla pracowników (przeniesione z EVM-112): klauzula informacyjna o aplikacji (checklista wydania S8), upoważnienie i poufność, informacja o audycie, oświadczenie o prywatnym telefonie (wzór 2) — każdy element z datą i dowodem; przy „nie” lista braków trafia do backlogu.

## Poza zakresem
Test terenowy, dystrybucja paczki i lista sprawdzeń `manual` (EVM-112); warunki (1)–(3) RR-96 w kodzie (osobna historyjka dopiero po przekroczeniu progu z AC2); test MASTG i pentest; RESILIENCE; MDM i zdalne zarządzanie telefonem; Google Play; iOS.

## Decyzje i ograniczenia
- **Przeniesione z EVM-112 (2026-11-15):** AC2 (MASVS L1) i AC4 (utrata telefonu, spis floty) w całości; warunek sign-offu RR-96 (przegląd EVM-131, 2026-11-14: przed wydaniem aplikacji z wysyłaniem panel pokazuje media „Czeka na plik z telefonu” z usuwaniem, retencja 30 dni, limit — wariant zastępczy: zapisana akceptacja ryzyka Konrada; RR-96 zaakceptowane 2026-11-15 do sign-offu); „stałe używanie aplikacji przez techników — po sign-offie”; uproszczenie 2026-11-12 (MASVS L1 jako checklista w sign-offie wydania 1.1, bez testu i pentestu).
- **Powiązania do poprawienia przy scaleniu:** odwołania do „sign-offu EVM-112” poza `docs/backlog/` (m.in. `threat-model.md` RR-96, RR-98, `requirements.md`, `rodo.md`, `workflow.md`, `docs/ops/dystrybucja-apk-android.md`) oraz w EVM-109, 130, 131 i 108 powinny wskazywać EVM-132 (tam, gdzie chodzi o sign-off, nie o test).
- **Ścieżka i wykonawcy:** zmiana backendowa z AC2 (jedna walidacja i kontrakt) zostaje w tej historyjce (`backend-developer` w `contributors`, ścieżka `pelna` — API i kanały to obszar ryzyka), bo osobne ID dodałoby plik, wiersz i cykl za jedną walidację.
- **UX / UI:** brak nowego UI (warunki (1)–(3) RR-96 dodałyby ekran w panelu — osobna historyjka z konsultacją UX).
- **Bezpieczeństwo i prywatność:** obszar security-engineera; spis floty to dane o telefonach prywatnych (model, system, poprawki — bez numerów seryjnych, IMEI i lokalizacji, P7); lista telefonów z nazwiskami nie trafia do repozytorium. Konsultacja security — wyniki wklei Tech Lead.
- **Telefony prywatne (BYOD):** decyzja 4; tryb „blokuj” (P7) wymaga decyzji po spisie floty.

## Dziennik
- 2026-11-15 — decyzje Konrada: RR-96 wariant B (zastępuje decyzję o warunkach (1)–(3) blokujących wydanie), warunki dla pracowników przeniesione z EVM-112 do AC5 (uczestnicy testu to zarząd); `backend-developer` w `contributors`, ścieżka `pelna` (Tech Lead)
- 2026-11-15 — naniesiono konsultację security: wariant B RR-96 z terminem przeglądu 2027-02-15 (pytanie do Konrada), rozszerzone AC4 (pomiar czasu oczekiwania, odwołania w dokumentach, `policies.md` P7) (product-owner)
- 2026-11-15 — wydzielona z EVM-112 (decyzja Konrada „podziel 112 na dwie”): AC2→AC1, AC4→AC3, warunek RR-96→AC2, nowe AC4 (ponowna ocena RR-07/98, RR-97, RR-100, dokumenty) i AC5 (decyzja o stałym używaniu); status `draft`, szkic ramowy (product-owner)
