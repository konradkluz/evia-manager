# Definition of Ready (DoR)

Historyjka może przejść do `ready` (i do `/deliver`), gdy:

- [ ] **Cel:** „Jako *rola* chcę *cel*, aby *korzyść*” — albo, dla enablera/spike'a, jasno opisany rezultat i pytanie, na które odpowiada.
- [ ] **AC:** numerowane `AC1…`, w formacie *Zakładając / Gdy / Wtedy*, testowalne i jednoznaczne; obejmują przypadki negatywne i walidację.
- [ ] **Uprawnienia:** opisane dla ról Administrator / Edytor / Tylko odczyt / niezalogowany (jeśli dotyczy).
- [ ] **Poza zakresem:** wypisane jawnie.
- [ ] **UX / UI:** dla zmian UI — ekrany, komponenty ze styleguide'u i stany (pusty / ładowanie / błąd / offline / brak uprawnień) albo „nie dotyczy”.
- [ ] **Bezpieczeństwo i prywatność:** dane, których dotyczy, i wymagane kontrole albo „nie dotyczy”.
- [ ] **Zależności:** wszystkie `depends_on` są `done` lub jawnie zastąpione atrapą.
- [ ] **Rozmiar:** mieści się w jednym cyklu `/deliver` (orientacyjnie ≤ 8 AC, ≤ 3 moduły); większa → podział.
- [ ] **Przypisanie:** `owner`, `contributors` (jeśli są) i `reviewers` we frontmatter.
- [ ] **Akceptacja użytkownika:** Konrad zatwierdził AC (wpis w „Dziennik”).
