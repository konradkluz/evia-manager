---
name: review-branch
description: Niezależny przegląd bieżących zmian (gałąź vs main) przez code-reviewer, security-engineer i ux-designer (gdy zmieniono UI), ze skonsolidowaną listą ustaleń wg ważności. Do użycia poza /deliver, np. przy hotfixie lub zmianach wprowadzonych ręcznie.
argument-hint: "[EVM-ID]"
---

# Przegląd zmian $ARGUMENTS

1. Ustal zakres: `git status`, `git diff --stat main...HEAD` (oraz zmiany niezacommitowane). Brak zmian → poinformuj i zakończ.
2. Uruchom równolegle (jedna wiadomość, kilka wywołań Agent):
   - `code-reviewer` — zawsze;
   - `security-engineer` — gdy zmiany dotyczą uwierzytelniania, autoryzacji, danych osobowych, plików, API, zależności, infrastruktury lub danych na urządzeniu;
   - `ux-designer` — gdy zmieniono UI (podaj, jak uruchomić aplikację).
   Każdemu podaj zakres zmian, powiązaną historyjkę (jeśli jest) i oczekiwany format: werdykt + ustalenia (ważność, plik:linia, problem, poprawka).
3. Skonsoliduj: usuń duplikaty, posortuj (blocker → major → minor → nit), przy każdym wskaż źródło.
4. Przedstaw użytkownikowi i zaproponuj: naprawę blocker / major teraz (przez właściwego developera), pozycje backlogu dla reszty.
