---
name: refine
description: Doprecyzowuje pomysł lub istniejącą pozycję backlogu do historyjki gotowej do realizacji (Definition of Ready) — z product-owner oraz, gdy potrzeba, z UX, architektem i security — i kończy się akceptacją użytkownika. Użycie — /refine <opis potrzeby> lub /refine EVM-012
argument-hint: <opis potrzeby | EVM-ID>
---

# Refinement: $ARGUMENTS

1. **Rozpoznaj wejście.** ID `EVM-###` → wczytaj plik historyjki. W przeciwnym razie to nowa potrzeba: sprawdź w `docs/backlog/`, czy podobna pozycja już nie istnieje.
2. **product-owner** (Agent): przygotuj lub uzupełnij historyjkę wg `docs/backlog/_template.md` i `docs/process/definition-of-ready.md` — cel, AC (Zakładając / Gdy / Wtedy, z rolami i przypadkami negatywnymi), poza zakresem, zależności, kamień milowy i epik, sugerowany `owner`, `contributors`, `reviewers` i `model` wykonawców (`sonnet`; `opus` wg kryteriów z `docs/process/workflow.md` → „Modele i effort agentów”, z uzasadnieniem w „Notatkach technicznych”; gdy wykonawcą jest `solution-architect` albo `security-engineer` — `opus` albo bez pola). Za duża → propozycja podziału na kilka ID. Status `draft`.
3. **Konsultacje równolegle — tylko gdy dotyczy:**
   - UI → `ux-designer`: treść sekcji „UX / UI” (ekrany, stany, komponenty, mikrocopy);
   - dane osobowe / uprawnienia / pliki / integracje / infrastruktura → `security-engineer`: treść sekcji „Bezpieczeństwo i prywatność”;
   - niepewność techniczna → `solution-architect`: treść „Notatek technicznych” (ograniczenia, ryzyka, ewentualny spike).
   Konsultanci zwracają treść sekcji w raporcie, a Ty wklejasz ją do pliku (jeden piszący — bez konfliktów).
4. **Przedstaw użytkownikowi** zwięźle: historyjka, lista AC, poza zakresem, otwarte pytania. Pytania zadaj przez AskUserQuestion (rekomendowana odpowiedź jako pierwsza).
5. **Po akceptacji** wpisz decyzje do historyjki, ustaw `status: ready`, dopisz wpis w „Dziennik”. Bez akceptacji status zostaje `draft`.
6. Zaproponuj następny krok (`/deliver EVM-###` albo kolejna pozycja do refinementu).
