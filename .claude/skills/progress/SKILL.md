---
name: progress
description: Raport postępu projektu EVia Manager — stan kamieni milowych i historyjek (w toku, do akceptacji, zablokowane, gotowe do realizacji), decyzje czekające na użytkownika i rekomendacja następnego kroku. Używaj, gdy użytkownik pyta „co dalej?” albo o stan projektu.
---

# Postęp projektu

1. Odczytaj `docs/product/roadmap.md` (kamienie milowe) oraz frontmatter wszystkich `docs/backlog/**/EVM-*.md` (id, title, milestone, status, priority, depends_on, owner).
2. Dla każdego kamienia milowego: liczba historyjek wg statusu i % `done`.
3. Wypisz:
   - **Czeka na Ciebie:** historyjki `in-review` (akceptacja), `draft` gotowe do akceptacji, ADR-y o statusie „Proponowana”, otwarte pytania w historyjkach;
   - **W toku** i **zablokowane** (z powodem);
   - **Następne do realizacji:** `ready` wg priorytetu, których zależności są `done` (maks. 3).
4. Rekomendacja: 1–3 konkretne komendy (np. `/deliver EVM-003`, `/refine EVM-014`).

Format: krótko, po polsku, tabele. Nie zmieniaj plików.
