# Definition of Ready (DoR)

Historyjka może przejść do `ready` (i do `/deliver`), gdy:

- [ ] **Cel:** „Jako *rola* chcę *cel*, aby *korzyść*” — albo, dla enablera/spike'a, jasno opisany rezultat i pytanie, na które odpowiada.
- [ ] **AC:** numerowane `AC1…`, w formacie *Zakładając / Gdy / Wtedy*, testowalne i jednoznaczne; obejmują przypadki negatywne i walidację.
- [ ] **Uprawnienia:** opisane dla ról Administrator / Edytor / Tylko odczyt / niezalogowany (jeśli dotyczy).
- [ ] **Poza zakresem:** wypisane jawnie.
- [ ] **UX / UI:** dla zmian UI — ekrany, komponenty ze styleguide'u i stany (pusty / ładowanie / błąd / offline / brak uprawnień); bez UI pomiń.
- [ ] **Bezpieczeństwo i prywatność:** dane, których dotyczy, i wymagane kontrole, gdy zmiana dotyka obszarów ryzyka; w przeciwnym razie pomiń.
- [ ] **Zależności:** wszystkie `depends_on` są `done` lub jawnie zastąpione atrapą.
- [ ] **Rozmiar:** mieści się w jednym cyklu `/deliver` (ścieżka lekka ≤ 6 AC, pełna ≤ 8 AC i ≤ 3 moduły); większa → podział.
- [ ] **Ścieżka:** pole `path` (`lekka` albo `pelna`) zgodne z kryteriami z `workflow.md` → „Ścieżki realizacji”; brak pola = `pelna`, a `/deliver` proponuje ścieżkę przy starcie.
- [ ] **Przypisanie:** `owner`, `contributors` (jeśli są) i `reviewers` we frontmatter; opcjonalnie `model` wykonawców (`sonnet` albo `opus` — kryteria: `workflow.md` → „Modele i effort agentów”; brak pola = modele z definicji agentów; przy `solution-architect` albo `security-engineer` wśród wykonawców — `opus` albo bez pola).
- [ ] **Akceptacja użytkownika:** Konrad zatwierdził AC (wpis w „Dziennik”).
