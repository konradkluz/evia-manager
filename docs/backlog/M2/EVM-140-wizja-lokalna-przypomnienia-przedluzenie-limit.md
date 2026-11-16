---
id: EVM-140
title: "Wizja lokalna: przypomnienie przed usunięciem, przedłużenie z powodem i limit otwartych wizji"
type: story
milestone: M2
epic: E15 Wizja lokalna
status: draft
priority: P1
path: pelna             # audyt, e-mail, limity nadużyć; zmiana w API i panelu
owner: backend-developer
contributors: [web-developer]
reviewers: [code-reviewer, security-engineer, ux-designer]
model: sonnet
depends_on: [EVM-139, EVM-138]
---

# EVM-140: Wizja lokalna — przypomnienie, przedłużenie, limit

## Cel
Jako **pracownik biura** chcę **dostać przypomnienie, zanim wizja zniknie, i móc ją świadomie przedłużyć (np. gdy wspólnota czeka na uchwałę)**, aby **nie tracić dokumentacji oferty, która jeszcze trwa**, a jako administrator chcę **limitu otwartych wizji**, aby **nie powstawało „dzikie archiwum” adresów**.

## Decyzje Konrada (2026-11-16)
1. Wizja bez klienta w „Wycena”. 2. Zwykły numer od razu.
3. **Wizja bez klienta usuwana po 90 dniach (przypomnienie wcześniej; przedłużenie przez Edytora/Administratora), odrzucona po 14 dniach.**
4. Jedno opcjonalne pole „telefon zamawiającego”. 5. Zakłada technik i biuro. 6. Oferta poza zakresem. 7. EVM-133 → wizja → EVM-112 → EVM-111.

## Kryteria akceptacji
Role: przedłużenie — Administrator i Edytor (panel); przypomnienie — twórca i Administratorzy; Tylko odczyt — brak.

**AC1 — Przypomnienie**
- Zakładając wizję bez klienta, nieodrzuconą, do wygaśnięcia 15 dni
- Gdy zadanie przypomnień się wykonuje
- Wtedy twórca i każdy Administrator dostają jedno przypomnienie (e-mail; treść wyłącznie z numerem zlecenia i datą, **bez adresu i telefonu**: „Wizja lokalna ZL-… zostanie usunięta dnia … Przypisz klienta, przedłuż albo odrzuć.”), z linkiem do zlecenia w panelu; powtórne uruchomienie nie wysyła drugiego; wizja z klientem lub odrzucona nie dostaje przypomnienia; w panelu i aplikacji „Wygasa za N dni” podkreśla stan „pilne” poniżej 15 dni.

**AC2 — Przedłużenie z powodem**
- Zakładając wizję bez klienta
- Gdy Edytor lub Administrator przedłuża ją o 90 dni, wybierając powód z listy („Czeka na decyzję klienta”, „Czeka na uchwałę wspólnoty / zarządcy”, „Wymaga drugiej wizyty”)
- Wtedy data wygaśnięcia przesuwa się o 90 dni, powstaje audyt z kodem powodu (bez treści swobodnej), wpis w dzienniku zlecenia i znika oznaczenie „pilne”; przedłużenie nie wysyła kolejnego przypomnienia przed nowym terminem − 15 dni.

**AC3 — Maksymalnie dwa przedłużenia**
- Zakładając wizję przedłużoną już dwa razy (łącznie ≤ 270 dni)
- Gdy próbuję przedłużyć trzeci raz
- Wtedy akcja jest wyłączona z podpowiedzią „Przypisz klienta albo odrzuć wizję”, API zwraca `409 extension_limit_reached`; Tylko odczyt i niezalogowany nie mają dostępu (`403`/`401`); wizje po terminie (już usunięte) nie mają akcji.

**AC4 — Limit otwartych wizji**
- Zakładając Edytora z 20 otwartymi wizjami (bez klienta, nieodrzuconymi) i globalny limit 100 (wartości konfigurowalne)
- Gdy zakłada kolejną (telefon lub panel)
- Wtedy mutacja jest odrzucona kodem ze słownika (`survey_limit_reached` / `survey_limit_global`) z komunikatem po polsku („Masz za dużo otwartych wizji — przypisz klienta, odrzuć lub usuń wizje”) i trafia do „Wymaga uwagi” w aplikacji z „Usuń z telefonu”; przypisanie klienta lub odrzucenie zwalnia miejsce; limit nie dotyczy zwykłych zleceń.

**AC5 — Widok „wizje starzejące się”**
- Zakładając Administratora lub Edytora w panelu
- Gdy otwieram filtr „Wizje lokalne” sortowany po dacie wygaśnięcia
- Wtedy widzę wizje od najbliższego terminu z liczbą dni i licznik „Wizje do rozstrzygnięcia: N” (do 15 dni); stan pusty: „Brak wizji do rozstrzygnięcia”; Administrator widzi wszystkich, Edytor — wszystkie wizje (biuro zarządza listą), Tylko odczyt — brak (decyzja w EVM-135 pyt. 1).

## Poza zakresem
Przedłużenie z aplikacji (wymaga decyzji — pytanie 2); powiadomienia push; przypomnienia o ofercie i CRM; raport konwersji wizja → zlecenie; dashboard (poza licznikiem z AC5).

## Decyzje i ograniczenia
- **Bezpieczeństwo:** W1 (przedłużenie ×2 z powodem i audytem), W2, W5 (przypomnienie bez adresu), W7.
- E-mail przez istniejący kanał transakcyjny (EVM-089); treść bez danych osobowych.
- **Pytania do Konrada:**
  1. Przypomnienie: kanał i odbiorcy? Rekomendacja: e-mail na 15 dni przed terminem do twórcy i wszystkich Administratorów + znacznik „pilne” w panelu i aplikacji; konsekwencja: bez e-maila ryzyko nieprzeczytanego znacznika (technik rzadko zagląda do panelu). Czy 15 dni wystarcza (security: 75. dzień)?
  2. Czy technik (Edytor w aplikacji) może przedłużyć wizję? Rekomendacja: nie w v1 — przedłużenie w panelu; konsekwencja: technik prosi biuro, ale zarządzanie retencją pozostaje w jednym miejscu.
  3. Limit 20 na twórcę / 100 globalnie — czy pasuje? Rekomendacja: tak; do zmiany konfiguracją.
  4. Maksymalnie dwa przedłużenia (≤ 270 dni) — decyzja 3 nie określa górnej granicy. Rekomendacja: tak (security; zostaje < 12 miesięcy); konsekwencja: dłuższa oferta wymaga przypisania klienta.
- **Konsultacje przed `ready`:** UX (dialog przedłużenia, oznaczenie „pilne”, treść e-maila), security (W7, treść), architekt (harmonogram, ADR-0024).

## Dziennik
- 2026-11-16 — szkic (product-owner)
