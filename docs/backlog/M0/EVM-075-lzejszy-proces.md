---
id: EVM-075
title: Lżejszy proces — ścieżki lekka i pełna, krótki szablon, mniej kontekstu, pomiar kosztu
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P0
path: lekka
owner: devops-engineer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: []
---

# EVM-075: Lżejszy proces — ścieżki lekka i pełna, krótki szablon, mniej kontekstu, pomiar kosztu

## Cel
Jako **właściciel produktu** chcę **obniżyć koszt i czas realizacji historyjki**, aby **szybciej dostarczać działający kod produktu**. Pomiar EVM-013: ok. $59 na historyjkę „uruchom `docs:check` w CI” (orkiestrator ok. $18, implementacja ok. $15, plan ok. $7, przegląd security ok. $9); ok. 95% kosztu to wczytywany kontekst (cache). Kierunek zaakceptowany 2026-10-05 w sesji `/deliver EVM-013`; propozycja i odpowiedzi — „Decyzje”. Nie powtarzamy EVM-074 (model i effort agentów).

## Kryteria akceptacji
**AC1 — Dwie ścieżki realizacji**
- Zakładając, że historyjka ma pole `path` (`lekka` | `pelna`; brak pola = `pelna`)
- Gdy `/refine` ją przygotowuje, a `/deliver` startuje
- Wtedy `workflow.md` → „Ścieżki realizacji”, `/refine`, `/deliver`, DoR/DoD i `backlog/README.md` opisują obie ścieżki i kryteria wyboru (PEŁNA tylko dla uwierzytelniania, uprawnień, danych osobowych, płatności, synchronizacji offline, migracji i infrastruktury produkcyjnej); dla historyjek bez pola `/deliver` proponuje ścieżkę użytkownikowi i zapisuje ją we frontmatter.

**AC2 — Workflow respektuje ścieżkę**
- Zakładając, że `deliver-story` dostaje `path`
- Gdy `path: lekka`
- Wtedy workflow nie uruchamia planu, konsultacji ani QA, wymaga dokładnie jednego recenzenta, robi najwyżej jedną rundę poprawek bez ponownego przeglądu i zwraca `fixed` (do weryfikacji przez orkiestratora); minor nie wywołuje kolejnego przeglądu. Dla `pelna` (i braku pola) przebieg jak dotąd, ale w rundzie > 1 ponownie przeglądają tylko ci recenzenci, którzy zgłosili blocker/major. Nieznana wartość `path` kończy się błędem przed startem agentów.

**AC3 — Krótki szablon i konsultacje proporcjonalne**
- Zakładając, że powstaje nowa historyjka
- Gdy `product-owner` używa `_template.md`
- Wtedy szablon mieści się w 1–2 stronach (cel, 3–6 AC, poza zakresem, decyzje, notatki, dziennik), nie ma w nim planu technicznego ani zapisów konsultacji, a `/refine` i `workflow.md` zawężają konsultacje do ryzyka historyjki i kierują ustalenia Low w narzędziach wewnętrznych do „Notatek”, nie do AC.

**AC4 — Mniej kontekstu**
- Zakładając, że agent startuje z `CLAUDE.md` i własną definicją
- Gdy zaczyna pracę
- Wtedy `CLAUDE.md` ma ≤ 10 KB (z 11,2 KB; tabela agentów jest w `workflow.md`, a dalsze odchudzanie wymagałoby przeniesienia „Stack i komendy”, przypiętego testami EVM-006/013), każdy agent ma regułę „czytaj wybiórczo”, a plan podziału największych dokumentów żywych jest tylko propozycją w `docs/notes/` — żadna treść dokumentu z `main` nie jest przenoszona.

**AC5 — Priorytety**
- Zakładając, że M1 czeka na pierwszy kod produktu
- Gdy czytam `backlog/M1/README.md` i `roadmap.md`
- Wtedy EVM-073 jest wstrzymany decyzją Konrada, historyjka „Porządki walidatora dokumentacji” nie powstaje, a pierwszym przyrostem jest rekomendacja EVM-008 → EVM-016 → EVM-067; łączenie drobnych historyjek M1 jest opisane wyłącznie jako propozycja.

**AC6 — Pomiar kosztu**
- Zakładając, że historyjka kończy się demem
- Gdy `/deliver` przygotowuje demo
- Wtedy `workflow.md` → „Pomiar kosztu” podaje baseline EVM-013 i cele (lekka ≤ $12, pełna ≤ $30; hipoteza do korekty po trzech pomiarach), a `/deliver` dopisuje w „Dzienniku” wpis „Koszt” (łącznie, rola, wywołania, rundy, ścieżka, rozmiar historyjki) i porównuje go z baseline.

## Poza zakresem
- Przenoszenie lub dzielenie treści dokumentów z `main` (tylko propozycja).
- Przepisywanie 57 historyjek `ready`.
- Zmiana modeli i effortu agentów (EVM-074), progów testów i bramek jakości.

## Decyzje i ograniczenia
- 2026-10-05 — Konrad: brak `path` = `pelna`, ścieżkę proponuje orkiestrator przy `/deliver`; `CLAUDE.md` do ok. 6 KB z tabelą agentów w `workflow.md`; cele kosztowe lekka ≤ $12 / pełna ≤ $30; rekomendacja EVM-008 → 016 → 067, łączenie historyjek jako propozycja w notatce.
- `.claude/` to plik wrażliwy (K3): PR do uwagi Konrada. Testy `tools/repo-policy` i `tools/docs-lifecycle` zmieniane razem z tekstami.

## Notatki
- Ta historyjka sama nie przeszła `/deliver` (zmiany procesu wprowadzone bezpośrednio na prośbę Konrada), więc jej koszt nie jest porównywalny z baseline.

## Dziennik
- 2026-10-05 — utworzono i `ready` po akceptacji propozycji przez Konrada; realizacja bezpośrednio przez orkiestratora (`in-progress`)
- 2026-10-05 — wdrożono (AC1–AC6) z testami `tools/repo-policy`; bramka lokalna zielona (format, lint, typy, testy z pokryciem, `deps:check`, `test:tools`, `docs:check` 0 błędów; `turbo` nie uruchamia zadań w tym środowisku także na czystym `main`, więc kroki bramki uruchomiono przez `pnpm -r`); `in-review`
- 2026-10-05 — odchylenie od propozycji: `CLAUDE.md` 11,2 → 9,8 KB zamiast ok. 6 KB (sekcja „Stack i komendy” jest przypięta testami EVM-006/013); EVM-008 zależy od EVM-007 (staging) — rozstrzygnięcie w `docs/notes/propozycje-po-evm-075.md`
- 2026-10-05 — przegląd `code-reviewer` (sonnet): 4 major, poprawione — M1 recenzent lekkiej dobierany do ryzyka (UI → `ux-designer`, endpoint/pliki/zależność → `security-engineer`) i rozszerzona eskalacja; M2 brak wyniku poprawiającego ≠ `fixed`; M3 usunięte odwołania do nieistniejących sekcji szablonu; M4 testy AC5, AC3 (`/refine`) i fallbacku recenzenta
- 2026-10-05 — decyzje Konrada po przeglądzie: lekka z recenzentem dobieranym do ryzyka wystarczy; EVM-008 podzielony (wdrożenie → nowy EVM-076, `ready`); push i PR zatwierdzone
- 2026-10-05 — PR #12 scalony przez Konrada (`c2e1d88`); `done`
