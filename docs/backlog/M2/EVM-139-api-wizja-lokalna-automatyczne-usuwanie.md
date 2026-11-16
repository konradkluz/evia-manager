---
id: EVM-139
title: "API: wizja lokalna — automatyczne trwałe usuwanie (90 / 14 dni) z rejestrem usunięć"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # pierwsze automatyczne usuwanie danych biznesowych, art. 17 RODO
owner: backend-developer
contributors: [devops-engineer]   # dystrybucja sekretu rejestru usunięć do procesu usuwającego (RR-55)
reviewers: [code-reviewer, security-engineer]
model: opus             # operacja nieodwracalna, sekret rejestru, zegar w testach
depends_on: [EVM-135, EVM-136, EVM-051]
---

# EVM-139: API — automatyczne usuwanie wizji

## Cel
Jako **administrator danych (EVia Charge)** chcę, aby **wizje lokalne, które nie zostały klientem, były usuwane automatycznie i trwale — wraz ze zdjęciami, filmami, adresem i polami swobodnymi**, aby **realny zysk prywatności z „wizji bez klienta” faktycznie istniał (dziś anulowane zlecenie leży 12 miesięcy)**. To warunek (W1, blocker) włączenia wizji na danych realnych.

## Decyzje Konrada (2026-11-16)
1. Wizja bez klienta w „Wycena”; klient dopiero przy „Zaakceptowane”. 2. Zwykły numer od razu.
3. **Wygasanie: wizja bez klienta usuwana automatycznie po 90 dniach (przypomnienie wcześniej; przedłużenie przez Edytora/Administratora — EVM-140); odrzucona — po 14 dniach.**
4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Oferta poza zakresem. 7. EVM-133 → wizja → EVM-112 → EVM-111.

## Kryteria akceptacji
Operacja systemowa (bez użytkownika); ślad dla Administratora w audycie i panelu.

**AC1 — Wygaśnięcie po 90 dniach**
- Zakładając wizję bez klienta, nieodrzuconą, której data wygaśnięcia (utworzenie + 90 dni, z uwzględnieniem przedłużeń z EVM-140) minęła
- Gdy działa zadanie usuwające
- Wtedy wizja jest trwale usunięta: zlecenie, wpisy i komentarze, adres (lokalizacja, jeśli nie jest użyta przez inne zlecenie), telefon zamawiającego i pola swobodne, a pliki mediów są usunięte tak jak przy trwałym usunięciu z EVM-051; test integracyjny z kontrolowanym zegarem (dzień 89 — zostaje, 91 — usunięta).

**AC2 — Odrzucona po 14 dniach, przypisanie klienta chroni**
- Zakładając wizję „Anulowaną” z kodem powodu odrzucenia
- Gdy mija 14 dni od odrzucenia
- Wtedy jest usuwana jak w AC1; wizja, której przypisano klienta (także przez Administratora w ostatniej chwili), nie jest usuwana, bo jest zwykłym zleceniem; wizja przywrócona przez Administratora nie jest usuwana wg starej daty; test wyścigu „przypisanie klienta ↔ usunięcie” (jeden wygrywa, bez uszkodzenia danych).

**AC3 — Rejestr usunięć przed zmianą w bazie**
- Zakładając wizję do usunięcia
- Gdy zadanie ją przetwarza
- Wtedy najpierw powstaje wpis w rejestrze usunięć (identyfikatory i numer zlecenia, data, powód „wygaśnięcie” / „odrzucona”, bez adresu i telefonu), dopiero potem zmiana w bazie; gdy zapis do rejestru się nie powiedzie, wizja nie jest usuwana, a Administrator dostaje alert; ponowne uruchomienie jest bezpieczne (idempotentne).

**AC4 — Ślad, synchronizacja i kolejki telefonów**
- Zakładając usuniętą wizję
- Gdy telefony i panel pobierają zmiany
- Wtedy telefon dostaje znacznik usunięcia (same identyfikatory, bez adresu), pliki i mutacje z kolejki do usuniętej wizji dostają `rejected` z kodem (`order_deleted`), a `change_log` i audyt nie zawierają adresu ani telefonu; eksport ZIP wizji nie istnieje.

**AC5 — Odporność zadania**
- Zakładając awarię w trakcie (część mediów usunięta) albo błąd usuwania pliku
- Gdy zadanie ponawia
- Wtedy kończy usuwanie bez duplikatów i bez osieroconych obiektów (SR-FILE-11), pozostałe wizje są przetwarzane, a trwały błąd tworzy alert i widoczny ślad dla Administratora; zadanie ma limit liczby usunięć na przebieg i dziennik bez danych osobowych.

**AC6 — Uprawnienia i konfiguracja**
- Zakładając Edytora i Tylko odczyt
- Gdy próbują usunąć wizję „od ręki” albo zmienić okresy
- Wtedy nie ma takiej operacji (usuwa wyłącznie zadanie systemowe; wcześniejsze usunięcie to zwykłe trwałe usunięcie Administratora z EVM-051), a okresy 90 i 14 dni są stałymi konfiguracji w kodzie (SR-PRIV-01) z testem granic.

## Poza zakresem
Przypomnienia, przedłużenie, limit wizji (EVM-140); ekrany; anonimizacja zamiast usunięcia; zmiana retencji zwykłych zleceń (zlecenie z klientem — jak dotąd); odtwarzanie usuniętych wizji z kopii (kopie wygasają ≤ 37 dni — RR-14).

## Decyzje i ograniczenia
- **Bezpieczeństwo:** W1, W2, W5, W10, W11; wiersze `change_log` tombstone do 2027-02-11 bez zmian; sekret rejestru usunięć jest dziś tylko w `api` (RR-55) — decyzja: zmiana dystrybucji sekretu (przegląd devops + security) albo wykonywanie usuwania przez proces `api`; do ADR-0024.
- **Numeracja:** usunięta wizja zostawia lukę w numerach `ZL-…` (numer w rejestrze usunięć).
- **Pytania do Konrada:** czy luki w numeracji zleceń są akceptowalne? Rekomendacja: tak (numer nie jest danymi osobowymi; ewidencja usunięć je tłumaczy); konsekwencja „nie”: osobna numeracja wizji (odradzana przez architekta).
- **Konsultacje przed `ready`:** architekt (ADR-0024: proces usuwający, sekret rejestru, kolejka), security (W1, RR-55, RR-96), devops (sekret, harmonogram).

## Dziennik
- 2026-11-16 — szkic (product-owner)
