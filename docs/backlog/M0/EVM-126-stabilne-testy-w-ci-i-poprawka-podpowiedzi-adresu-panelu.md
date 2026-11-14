---
id: EVM-126
title: Stabilne testy w CI i poprawka podpowiedzi adresu panelu
type: bug
milestone: M0
epic: E00 Fundamenty
status: done
priority: P1
path: lekka
owner: web-developer
contributors: [backend-developer]
reviewers: [code-reviewer]
model: sonnet
depends_on: []
---

# EVM-126: Stabilne testy w CI i poprawka podpowiedzi adresu panelu

## Cel
Jako **właściciel produktu** chcę **deterministycznych testów w CI i poprawnej podpowiedzi adresu panelu**, aby **scalanie i wdrożenia nie stawały przez losowe czerwone testy, a biuro dostawało w komunikacie prawdziwy adres panelu**. W dniach 2026-11-12/13 cztery testy blokowały scalenia i wdrożenia (przechodziły po ponowieniu), a obraz wydania web ma wbity `VITE_PANEL_ORIGIN = http://localhost:5173` (`apps/web/vite.config.ts`: wartość domyślna, gdy brak `PANEL_ORIGIN` przy budowie), więc komunikat „zły adres” (`supportedPanelAddress` w `apps/web/src/api/panel-address.ts`) podsuwa localhost zamiast `https://panel.eviacharge.pl`.

Zasada nadrzędna (`CLAUDE.md`, reguła 3): przyczynę usuwamy w teście lub kodzie — nie osłabiamy, nie wyłączamy testów i nie podnosimy limitów czasu „na ślepo”. Historyjka ma być wykonana bez udziału człowieka.

## Kryteria akceptacji

**AC1 — Testy web deterministyczne**
- Zakładając testy `apps/web/test/site-suggestions.test.tsx` (EVM-043 AC1; 5078 ms > limit 5000 ms) i test EVM-046 AC4 (film dostaje nowy adres tuż przed końcem ważności; oczekiwano 2 liczników, jest 1)
- Gdy przyczyna zostanie ustalona i usunięta (zegary sterowane testem albo jawne oczekiwanie na warunek, a nie czas zegarowy; bez podnoszenia limitu)
- Wtedy oba testy przechodzą 20 razy z rzędu lokalnie (także pod obciążeniem procesora) i nie mają osłabionych asercji.

**AC2 — Testy API deterministyczne**
- Zakładając testy integracyjne `worker-email.test.ts` (EVM-024 AC5; SMTP niedostępny, ponowienia: „wiersz kończy jako nieudany po ponowieniach”) i `security-alerts.test.ts` (EVM-016 AC2; alert w logu API, przekroczone 120 s)
- Gdy przyczyna zostanie ustalona i usunięta (jawne oczekiwanie na stan wiersza lub wpis w logu, kontrola odstępów ponowień przez test; bez wydłużania limitów)
- Wtedy oba testy przechodzą 10 razy z rzędu w kontenerze Linux (`gate:backend` / `test:integration`) z zachowaniem asercji.

**AC3 — Adres panelu w obrazie wydania**
- Zakładając budowę obrazu web do wdrożenia (CI i wydanie)
- Gdy budowa dostaje adres panelu środowiska (`https://panel.eviacharge.pl`)
- Wtedy komunikat „zły adres” podaje ten adres, a obraz wydania nie zawiera `localhost` jako adresu panelu; test (`EVM-126 AC3`) sprawdza, że bez konfiguracji wydania budowa kończy się błędem albo komunikat nie zawiera żadnego adresu.

**AC4 — Dev bez zmian**
- Zakładając lokalne uruchomienie (`compose.dev.yaml`, `PANEL_ORIGIN = http://localhost:5173`)
- Gdy użytkownik wchodzi na panel pod innym adresem
- Wtedy komunikat nadal wskazuje adres lokalny (istniejące testy `login` i `activation` zielone).

**AC5 — Bramki**
- Gdy PR jest gotowy
- Wtedy `ci-gate` (w tym `e2e-web`) jest zielony, pokrycie zmienionego kodu ≥ 90%, żaden próg ani test nie został obniżony, wyłączony ani pominięty (przegląd `code-reviewer` to potwierdza).

## Poza zakresem
- Przepisywanie pozostałych testów, ogólna zmiana strategii testowania, zmiana progów pokrycia.
- Zmiany domeny i DNS panelu (EVM-089), przemianowanie staging → produkcja (EVM-125).

## Decyzje i ograniczenia
- Ścieżka `lekka` (CI i testy, bez uwierzytelniania i danych osobowych), jeden recenzent `code-reviewer` (`workflow.md` → „Ścieżki realizacji”).
- Właściciel: `web-developer` (trzy z czterech testów i poprawka adresu); `backend-developer` odpowiada za AC2.
- Bez interakcji człowieka: blokadę (np. brak powtarzalności awarii) wykonawca zapisuje w dzienniku i raporcie, nie zgaduje.

## Notatki
- Kontekst: czerwone `quality` / `e2e-web` / integracja przy scalaniu PR 2026-11-12/13; po ponowieniu zielone.

## Dziennik
- 2026-11-13 — utworzono (product-owner), draft; gotowość ustawia orkiestrator po akceptacji Konrada
- 2026-11-13 — akceptacja Konrada (DoR) do nocnej kolejki `/noc-2026-11-13`: kolejność toru A 104 → 105 → 127 → 106 (tor B: 126 → 066), autokorekta zostaje w długich tekstach (wyłączona w polach klienta, telefonu, adresu; autofill wszędzie wyłączony), bez szkiców i „ostatnio otwieranych” w M2, EVM-126 — budowa panelu bez adresu kończy się błędem; status `ready` (Tech Lead)
- 2026-11-14 — start realizacji w kolejce nocnej `/noc-2026-11-13` (Tech Lead): status `in-progress`, gałąź `feature/EVM-126-066-testy-i-instrukcja`
- 2026-11-14 — wykonanie (web-developer, wznowienie po awarii): AC1 testy web deterministyczne (rozdzielony test EVM-043 AC1, jawne oczekiwanie w EVM-046 AC4; 20/20 pod obciążeniem), AC2 test worker-email steruje odstępami ponowień, emiter alertów bez nakładających się odpytań (10/10 w kontenerze), AC3/AC4 budowa wydania wymaga PANEL_ORIGIN
- 2026-11-14 — workflow `deliver-story` (lekka) `passed`, code-reviewer: approve (uwagi nieblokujące: CHANGELOG — dopisany; nit: `--build-arg PANEL_ORIGIN` trafia też do obrazu api). Bramka orkiestratora: `pnpm run gate` zielona (pokrycie zmienionego kodu 100% linii i gałęzi; `security-alerts.ts` mierzy CI), `pnpm run gate:deploy` zielona. Weryfikacja AC3 lokalnie: `vite build` z `EVIA_RELEASE_BUILD=true` bez `PANEL_ORIGIN` kończy się błędem, z `https://panel.eviacharge.pl` — w paczce jest adres panelu i brak `localhost:5173`. AC5 potwierdzi `ci-gate` i `e2e-web` na PR; budowę obrazu `evia-web` z argumentem sprawdzi dopiero job publikacji po scaleniu. Koszt: 3 agentów, ok. 176 tys. tokenów, 34 min. Status `in-review` (Tech Lead, kolejka nocna)
- 2026-11-14 — akceptacja Konrada przez scalenie PR #137 (main `fb06b296`, wdrożenie na `panel.eviacharge.pl`); status `done` (Tech Lead)
