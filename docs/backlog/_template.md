---
id: EVM-000
title: Krótki tytuł
type: story            # story | enabler | spike | bug
milestone: M1
epic: E00 Nazwa epiku
status: draft          # draft | ready | in-progress | in-review | done | blocked
priority: P1           # P0 | P1 | P2 | P3
path: lekka            # lekka | pelna — ścieżka realizacji (workflow.md → „Ścieżki realizacji”); brak pola = pelna
owner: backend-developer
contributors: []       # np. [web-developer]
reviewers: [code-reviewer]
model: sonnet          # sonnet | opus — model wykonawców w /deliver; owner/contributor solution-architect lub security-engineer → opus albo usuń pole (workflow.md → „Modele i effort agentów”)
depends_on: []
---

# EVM-000: Krótki tytuł

> Szablon ma mieścić się w 1–2 stronach (ok. 6 KB). Plany, zapisy konsultacji i raporty agentów nie trafiają do tego pliku (`.scratch/`, raport w demo); „Dziennik” to jedna linia na zdarzenie. Definition of Done: `docs/process/definition-of-done.md` (nie kopiujemy go do historyjki).

## Cel
Jako **<rola>** chcę **<cel>**, aby **<korzyść>**. Jedno–dwa zdania kontekstu (powiązania, fakty z domeny).

## Kryteria akceptacji
3–6 AC (Zakładając / Gdy / Wtedy), testowalne; przypadki negatywne i uprawnienia tam, gdzie dotyczą. Więcej niż 6 AC → podział (pełna ścieżka: ≤ 8).

**AC1 — <nazwa>**
- Zakładając, że …
- Gdy …
- Wtedy …

**AC2 — <nazwa>**
- Zakładając, że …
- Gdy …
- Wtedy …

## Poza zakresem
- …

## Decyzje i ograniczenia
Decyzje użytkownika (data, decyzja) i twarde ograniczenia. Sekcje „UX / UI” (ekrany, stany, komponenty) i „Bezpieczeństwo i prywatność” (role → dostęp, dane, kontrole) dopisz tylko wtedy, gdy zmiana ich dotyczy — jako podpunkty tutaj.

## Notatki
Maks. 5 linii: ustalenia nieblokujące (minor/nit, Low w narzędziach wewnętrznych) i pomysły do backlogu. Nie są kryteriami akceptacji.

## Dziennik
- YYYY-MM-DD — utworzono (product-owner)
