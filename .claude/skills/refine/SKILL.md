---
name: refine
description: Doprecyzowuje pomysł lub istniejącą pozycję backlogu do historyjki gotowej do realizacji (Definition of Ready) — z product-owner oraz, gdy potrzeba, z UX, architektem i security — i kończy się akceptacją użytkownika. Użycie — /refine <opis potrzeby> lub /refine EVM-012
argument-hint: <opis potrzeby | EVM-ID>
---

# Refinement: $ARGUMENTS

1. **Rozpoznaj wejście.** ID `EVM-###` → wczytaj plik historyjki. W przeciwnym razie to nowa potrzeba: sprawdź w `docs/backlog/`, czy podobna pozycja już nie istnieje.
2. **product-owner** (Agent): przygotuj lub uzupełnij historyjkę wg `docs/backlog/_template.md` i `docs/process/definition-of-ready.md` — cel, AC (Zakładając / Gdy / Wtedy, z rolami i przypadkami negatywnymi), poza zakresem, zależności, kamień milowy i epik, sugerowana `path` (`lekka` domyślnie; `pelna` tylko dla uwierzytelniania, uprawnień, danych osobowych, płatności, synchronizacji offline, migracji i infrastruktury produkcyjnej — `docs/process/workflow.md` → „Ścieżki realizacji”), sugerowany `owner`, `contributors`, `reviewers` (lekka: dokładnie jeden) i `model` wykonawców (`sonnet`; `opus` wg kryteriów z `docs/process/workflow.md` → „Modele i effort agentów”, z uzasadnieniem w „Decyzjach i ograniczeniach”; gdy wykonawcą jest `solution-architect` albo `security-engineer` — `opus` albo bez pola). Historyjka krótka: 3–6 AC (pełna ≤ 8), 1–2 strony wg szablonu; za duża → propozycja podziału na kilka ID. Status `draft`.
3. **Konsultacje równolegle — tylko gdy dotyczy i proporcjonalnie do ryzyka** (ścieżka `lekka` zwykle bez konsultacji; pytanie wąskie, odpowiedź kilka punktów; konsultacja nie dodaje AC — ustalenia Low w narzędziach wewnętrznych idą do „Notatek”, AC rozszerza tylko ustalenie Medium lub wyższe):
   - UI → `ux-designer`: podpunkt „UX / UI” w „Decyzjach i ograniczeniach” (ekrany, stany, komponenty, mikrocopy);
   - dane osobowe / uprawnienia / pliki / integracje / infrastruktura → `security-engineer`: podpunkt „Bezpieczeństwo i prywatność” (role → dostęp, dane, kontrole);
   - niepewność techniczna → `solution-architect`: ograniczenia i ryzyka do „Decyzji i ograniczeń” (ewentualnie spike).
   Konsultanci zwracają treść w raporcie, a Ty wklejasz jej skrót do pliku (nie cały zapis konsultacji) (jeden piszący — bez konfliktów).
4. **Przedstaw użytkownikowi** zwięźle: historyjka, proponowana ścieżka (`path`) z uzasadnieniem, lista AC, poza zakresem, otwarte pytania. Pytania zadaj przez AskUserQuestion (rekomendowana odpowiedź jako pierwsza).
5. **Po akceptacji** wpisz decyzje do historyjki, ustaw `status: ready`, dopisz wpis w „Dziennik”. Bez akceptacji status zostaje `draft`.
6. Zaproponuj następny krok (`/deliver EVM-###` albo kolejna pozycja do refinementu).
