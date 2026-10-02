---
name: adr
description: Przygotowuje decyzję architektoniczną (ADR) przez solution-architect — kontekst, kryteria z wagami, warianty, ocena, rekomendacja, konsekwencje i plan wyjścia — i przedstawia ją użytkownikowi do akceptacji. Użycie — /adr <temat decyzji>
argument-hint: <temat decyzji>
---

# ADR: $ARGUMENTS

1. Sprawdź `docs/architecture/adr/` — czy decyzja już istnieje (wtedy aktualizacja albo zastąpienie). Nowy numer = najwyższy istniejący + 1.
2. **solution-architect** (Agent): przygotuj ADR wg `docs/architecture/adr/0000-template.md` ze statusem „Proponowana”; aktualne informacje (wersje, licencje, koszty) zweryfikuj w sieci. Gdy decyzja dotyczy bezpieczeństwa lub danych osobowych — poproś następnie o uwagi `security-engineer`; gdy kosztów lub infrastruktury — `devops-engineer`.
3. Przedstaw użytkownikowi: problem, opcje (tabela), rekomendacja, konsekwencje, koszty. Zapytaj o decyzję (AskUserQuestion).
4. Zapisz decyzję: status „Zaakceptowana” / „Odrzucona”, data, decydent; zaktualizuj indeks `docs/architecture/adr/README.md` i — jeśli dotyczy — sekcję „Stack i komendy” w `CLAUDE.md`.
