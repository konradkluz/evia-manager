---
id: EVM-123
title: Kontrola main-integrity (K6) przestaje zgłaszać fałszywe alarmy (wiele ID w tytule, potwierdzenie historii)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: draft
priority: P1
path: pelna            # plik wrażliwy (tools/main-integrity/, .github/) i kontrola kompensująca łańcucha dostaw/CI (ADR-0016): rozluźnienie reguły wymaga przeglądu security-engineer
owner: devops-engineer
contributors: []
reviewers: [security-engineer, code-reviewer]
model: sonnet
depends_on: []
---

# EVM-123: Kontrola main-integrity (K6) przestaje zgłaszać fałszywe alarmy

## Cel
Jako **właściciel produktu (Konrad)** chcę, aby `main-integrity` (K6) była czerwona tylko przy prawdziwym odstępstwie od ścieżki „PR scalony przez Konrada + zielony `ci-gate`”, aby alarm znów znaczył incydent, a nie szum.

Stan z 2026-11-12: K6 jest czerwona codziennie od ok. 2026-11-01 („15 commit(ów) na main bez ścieżki PR + zielony ci-gate”). 14 commitów z tytułem odrzucono wyłącznie za format pierwszej linii (kilka ID w nawiasie, np. `[EVM-101, EVM-107]`, albo brak ID) — to fałszywe alarmy; wszystkie weszły przez „Squash and merge” Konrada. Jeden commit (#106) to **rzeczywisty incydent**: PR scalono 2026-10-27 o 20:53:32Z, gdy przebieg `pull_request` jeszcze trwał, a `ci-gate` skończył się porażką o 20:55:01Z (`quality` → „Tests with coverage thresholds”); przebieg `push` na `main` też był czerwony. Razem 15. PR-y tylko z dokumentacją mają pełny przebieg `pull_request` z `ci-gate`, więc osobna reguła dla nich nie jest potrzebna. Potrzebne dwie zmiany: format tytułu zgodny z praktyką kolejek (EVM-087) i jednorazowe, jawne potwierdzenie commitów historycznych. Powiązane: EVM-088 (rebase merge) — inna reguła, ten sam plik.

## Kryteria akceptacji

**AC1 — Wiele ID w tytule jest akceptowane**
- Zakładając, że pierwsza linia commitu to Conventional Commit z listą ID w jednym nawiasie, np. `feat(mobile): … [EVM-101, EVM-107] (#125)`, i pozostałe warunki K6 są spełnione
- Gdy `main-integrity` sprawdza ten commit
- Wtedy commit jest zgodny; lista może zawierać wiele `EVM-###` (ograniczona rozsądnym limitem ustalonym w realizacji), `[renovate]` i `[M#]` nadal są akceptowane pojedynczo.

**AC2 — Literówka, brak ID i zły separator nadal są czerwone**
- Zakładając, że pierwsza linia nie ma żadnego ID (np. `fix(deps): override node-forge (#118)`), ma niepoprawne ID (`EVM-12`, `EVM-`), pustą pozycję na liście (`[EVM-101, ]`), mieszankę `[renovate, EVM-101]`, nieznany typ albo nawiasy poza końcem tytułu
- Gdy `main-integrity` sprawdza taki commit pochodzący z innego niż historyczny (AC3) PR
- Wtedy przebieg jest czerwony z powodem „pierwsza linia nie jest Conventional Commit …” i SHA w logu.

**AC3 — Jednorazowe potwierdzenie historycznych commitów przez Konrada**
- Zakładając, że 15 commitów z logu 2026-11-12 (13 za format, 1 za brak `ci-gate`, SHA wymienione w PR) to potwierdzone przez Konrada wyjątki historyczne
- Gdy PR dopisujący ich pełne SHA do `ACKNOWLEDGED` (z powodem per SHA) zostanie scalony przez Konrada po sprawdzeniu każdego commitu w Activity i PR-ze
- Wtedy kolejny przebieg jest zielony, log nadal wypisuje każdy z nich jako „potwierdzony incydent” wraz z powodem, a commit spoza listy naruszający reguły nadal czerwieni przebieg.
- Wśród potwierdzanych SHA commit z #106 jest oznaczony jako rzeczywisty incydent (scalenie przed zakończeniem `ci-gate`, `ci-gate` = failure), z regułą `gate`, wpisem w „Dzienniku” i retrospektywie; pozostałe z regułą `title`. PR wymienia każde SHA z dokładnymi powodami z logu.

**AC4 — Potwierdzenie nie zagłusza istotnych naruszeń**
- Zakładając, że SHA jest na liście `ACKNOWLEDGED`
- Gdy ten commit ma też naruszenie innego rodzaju niż format tytułu lub brak zielonego `ci-gate` (bezpośredni push bez PR, scalił ktoś inny niż `MAIN_MERGER`, wiele rodziców) albo push na `main` to force push / nie-przewinięcie
- Wtedy przebieg pozostaje czerwony: potwierdzenie obejmuje wyłącznie wymienione powody, nie wycisza reszty ani kontroli pushu.
- Wpis `ACKNOWLEDGED` ma postać `<pełne SHA>:<reguła>[+<reguła>]` z zamkniętego zbioru `title`, `gate`; nieznana reguła, zły format albo duplikat = kod 2 (fail-closed); powód spoza wpisanych reguł czerwieni przebieg. (Dziś `lib/main.mjs` ok. l. 133 wycisza wszystkie powody danego SHA.)

**AC5 — Brak cichego wyciszania w przyszłości**
- Zakładając, że PR (także agenta) zmienia `ACKNOWLEDGED`, regułę formatu albo `BASELINE`
- Gdy taki PR jest przygotowywany i scalany
- Wtedy przed scaleniem krok K3 w jobie `security` wypisuje zmiany w `tools/main-integrity/` i `tools/scan/` (ścieżki dopisane także do `CODEOWNERS`), a po scaleniu K6 wypisuje commit na liście plików wrażliwych; dokumentacja (procedura „Czerwony main”, szablon PR) wymaga jawnej zgody Konrada w PR, a `BASELINE` nie jest przesuwany, by uciszyć alarm. Reguła i wpisy w jednym PR są dopuszczalne (ocena łączna).

**AC6 — Testy i dokumentacja**
- Zakładając, że zmiana jest zaimplementowana
- Gdy uruchamiane są testy `tools/main-integrity/` (oznaczone `EVM-123 AC#`) i walidator dokumentacji
- Wtedy testy pokrywają AC1–AC5 (w tym 2–3 prawdziwe tytuły z listy incydentu jako przypadki zgodne i każdy przypadek negatywny), progi pokrycia nie są obniżone, a `docs/ops/github-i-ci.md`, `docs/process/conventions.md`, `.github/pull_request_template.md` i ADR-0016 (dopisek „Aktualizacja” wiersza K6, do akceptacji Konrada) opisują format tytułu i zasady potwierdzania.

## Poza zakresem
- „Rebase and merge” (EVM-088) i zmiana wymogu jednego rodzica.
- Zmiana okna (`WINDOW`), `BASELINE`, uprawnień workflow, innych kontroli K1–K5; zmiana kanału powiadomień.
- Automatyczne potwierdzanie (bot, etykieta PR, komentarz) — potwierdza wyłącznie Konrad własnym scaleniem PR.
- Poprawianie tytułów historycznych commitów (przepisywanie historii `main` jest zabronione).

## Decyzje i ograniczenia
- Bezpieczeństwo: kontrola kompensująca (brak płatnych ochron gałęzi, ADR-0016); zasada fail-closed, brak nowych zależności, brak sekretów w logach. Rozluźnienie formatu nie może dopuścić commitu bez ID.
- Bezpieczeństwo i prywatność (konsultacja security 2026-11-12): lista ID to identyfikowalność, nie autoryzacja (ryzyko Low). Format: do 10 ID, separator dokładnie `, `, każde `EVM-\d{3,}`, bez duplikatów, bez sprawdzania istnienia pliku historyjki (limit API); regex bez ReDoS. Potwierdzenie nigdy nie obejmuje PR, mergera, rodziców ani pushu. Wpis dla SHA bez naruszeń lub spoza okna logowany jako „zbędny”; powód bez danych osobowych, przez `oneLine`.
- Mechanizm `ACKNOWLEDGED` już istnieje; zmiana go zawęża (powód per SHA, AC4), a nie rozszerza.
- Zasada „commit z ID per historyjka” z konwencji pozostaje celem; wiele ID w nawiasie dotyczy squash PR-a z kolejki (EVM-087).

## Notatki
- Ryzyko procesowe poza zakresem (osobny `/refine`): scalanie przed zakończeniem `ci-gate` (#106, wcześniej #70) — K6 wykrywa dopiero po fakcie.

## Otwarte pytania
1. Commity bez ID (`docs`, `chore(deps)`, `fix(deps)`): nadal wymagać ID? Rekomendacja: tak, historyczne potwierdzić (AC3). Konsekwencja: pełna identyfikowalność, ale tytuł PR trzeba poprawić przed scaleniem.
2. Limit 10 ID w tytule? Rekomendacja: tak. Konsekwencja: większe kolejki dzielimy albo używamy `[M#]`.
3. Czy #106 zapisać jako rzeczywisty incydent (reguła `gate`, „Dziennik”, retrospektywa) i potwierdzić? Rekomendacja: tak. Konsekwencja: zielony K6 bez ukrywania faktu.
4. Czy dopisać aktualizację ADR-0016 (K6) w tej historyjce? Rekomendacja: tak, dopisek „Aktualizacja”. Konsekwencja: decyzja zostaje w ADR, wymaga Twojej akceptacji.

## Dziennik
- 2026-11-12 — utworzono (product-owner), po czerwonym przebiegu main-integrity z 2026-11-12
