---
id: EVM-120
title: Caddy z poprawionym golang.org/x/net — usunięcie ostatniego wyjątku dla binarki (RR-89 a)
type: enabler
milestone: M0
epic: E00 Fundamenty
status: ready
priority: P2
path: lekka            # podbicie przypiętej wersji; recenzent security-engineer (łańcuch dostaw, zob. workflow.md „Ścieżki realizacji”)
owner: devops-engineer
contributors: []
reviewers: [security-engineer]
model: sonnet
depends_on: [EVM-007]
---

# EVM-120: Caddy z poprawionym golang.org/x/net — usunięcie ostatniego wyjątku dla binarki (RR-89 a)

## Cel
Jako **właściciel produktu** chcę **podbić Caddy (obraz `evia-web` i brzeg) do pierwszego wydania z `golang.org/x/net` ≥ 0.62.0 i usunąć ostatni wpis w `.trivyignore.yaml` dla binarki Caddy**, aby **jedyne środowisko (`panel.eviacharge.pl`, realne dane) miało zero wyjątków skanera dla Caddy, a ryzyko RR-89(a) zostało zamknięte**.

Stan wyjściowy (2026-11-15): pakiety OS i RR-37/RR-38 zamknięte w #128 (Caddy 2.11.9, `publish` zielony na `linux/arm64`). Został wpis `CVE-2026-78661` (`golang.org/x/net/html` 0.60.0 w Caddy 2.11.9, DoS CPU; ścieżki `usr/bin/caddy`, `usr/local/bin/caddy`; `expired_at: 2026-12-10`). Najnowsze wydanie Caddy (2026-11-15) to nadal v2.11.9 — poprawki jeszcze nie ma.

**Kiedy zacząć:** dopiero po wydaniu Caddy z `x/net` ≥ 0.62.0 (sprawdzane w uwagach wydania / `go.mod` tagu). Do tego czasu historyjka czeka (nie ma pracy do zrobienia); Tech Lead sprawdza wydania przy okazji `/progress`, a najpóźniej **2026-12-07** — wtedy uruchamia AC4, jeśli wydania nadal nie ma.

## Kryteria akceptacji

**AC1 — Podbicie i zero wyjątków dla Caddy**
- Zakładając wydanie Caddy z `golang.org/x/net` ≥ 0.62.0
- Gdy przypinam nową wersję w `infra/images/web/Dockerfile` (etap `caddy-src`) i `infra/runtime/infra-images.json` (klucz `caddy`) i uruchamiam bramkę 6 (Trivy)
- Wtedy 0 HIGH/CRITICAL dla binarki Caddy bez wyjątków, a wpis `CVE-2026-78661` dla `usr/bin/caddy` i `usr/local/bin/caddy` jest usunięty z `.trivyignore.yaml` (wpisy Alloy i pozostałe sekcji (B) poza zakresem); nowa wersja przypięta dokładnie (tag + digest), bez nowej zależności.

**AC2 — Multiarch i zachowanie bez zmian**
- Zakładając obraz po zmianie
- Gdy `publish` buduje `evia-web` i brzeg oraz `evia-web` serwuje panel pod flagami wdrożenia (user nie-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `tmpfs`)
- Wtedy kontrola platformy w `publish` jest zielona dla `linux/arm64`, a odpowiedzi, nagłówki bezpieczeństwa i healthcheck są jak przed zmianą (istniejące testy E2E web / kontrole obrazu przechodzą bez osłabiania), reguła `repo-policy` (brak file capability na binarce Caddy) zielona. Dowody tylko z CI — nikt nie loguje się na `panel.eviacharge.pl`.

**AC3 — Zamknięcie RR-89(a)**
- Zakładając zmianę z AC1–AC2 scaloną
- Gdy `security-engineer` przegląda zmianę
- Wtedy punkt (a) RR-89 w `docs/security/threat-model.md` jest oznaczony jako zamknięty (data, odnośnik do PR), „Decyzja Konrada — do potwierdzenia” z aktualizacji 2026-11-13 jest rozstrzygnięta lub oznaczona jako bezprzedmiotowa, a komentarz i `statement` „staging only” przy wpisie nie występują (wpis usunięty).

**AC4 — Brak wydania do 2026-12-07 (wariant awaryjny)**
- Zakładając, że do 2026-12-07 nie ma wydania Caddy z `x/net` ≥ 0.62.0
- Gdy `security-engineer` ponawia analizę osiągalności CVE-2026-78661 w Caddy 2.11.9 (dowód z CI: ścieżki wywołań, konfiguracja handlerów) i przedstawia Konradowi wniosek
- Wtedy, po potwierdzeniu przez Konrada, `expired_at` wpisu zostaje przedłużone **jednorazowo o nie więcej niż 30 dni** (nowy termin zapisany w RR-89 razem ze `statement` poprawionym na „jedno środowisko, realne dane; wpływ ogranicza się do dostępności brzegu”), a bez potwierdzenia `publish` pozostaje czerwony po 2026-12-10 (brak cichego przedłużenia, bez własnej budowy Caddy).

## Poza zakresem
- Wariant A (`distroless/static` dla `evia-web`) — zob. „Decyzje i ograniczenia”.
- Własna budowa Caddy (`xcaddy`) — odrzucona (utrzymanie własnego łańcucha budowy, koszt nieproporcjonalny do ryzyka Low).
- Wpisy Alloy w sekcji (B) `.trivyignore.yaml` (`CVE-2026-78661` w `usr/bin/alloy`, apt/libapt-pkg; EVM-084) — mają ten sam termin 2026-12-10, ale własne warunki wyjścia; decyzję o ich przedłużeniu warto podjąć razem z AC4, bez zmiany zakresu tej historyjki.
- Wyjątek RR-36 (`gosu` w PostgreSQL); aktualizacja Node.js w `api`; automatyzacja aktualizacji (Renovate, EVM-117).

## Decyzje i ograniczenia
- **Wariant A (`distroless`) — rekomendacja PO: zrezygnować w tej historyjce** (odroczyć bez terminu kalendarzowego, wróci tylko gdy pojawi się wyjątek skanera dla pakietu OS w `evia-web`). Uzasadnienie: po #128 obraz ma zero wyjątków dla pakietów OS, a koszt przebudowy obrazu bez konkretnej podatności jest zbędny przy zasadzie „najprościej, bez zbędnych rzeczy”; kolejne CVE w Alpine łapie ta sama bramka 6. **Decyzja Konrada 2026-11-15:** rezygnujemy (zmiana decyzji z 2026-10-28 „distroless warunkiem wejścia na produkcję”).
- **Poprawka `statement` „staging only”:** nie robimy osobnego PR-a (minimum ręcznej roboty, wpis i tak znika w AC1). Poprawiamy przy najbliższej zmianie `.trivyignore.yaml` z innego powodu (np. przedłużenie w AC4 albo sprzątanie wpisów Alloy) — Tech Lead może dołączyć do dowolnego PR dotykającego tego pliku. Do tego czasu rzeczywisty status opisuje RR-89 (aktualizacja 2026-11-13), nie komentarz w pliku.
- **Kolejność ryzyka:** RR-89(a) ocenione jako Low (P1 × W1) także dla danych realnych (wpływ: dostępność brzegu, nie poufność); dlatego brak wydania nie uzasadnia pilnej własnej budowy.
- Ścieżka `lekka`: ≤ 6 AC i jeden recenzent (`security-engineer`, bo zmiana dotyczy łańcucha dostaw); `pelna` nie jest potrzebna — brak nowego kodu, endpointów ani danych.
- Termin twardy: wpis wygasa 2026-12-10; po tym dniu bez AC1 albo AC4 bramka 6 jest czerwona.

## Dziennik
- 2026-10-27 — utworzono (product-owner) z RR-37/RR-38
- 2026-10-28 — decyzja Konrada (pytania po nocnej kolejce): wariant B robimy teraz; `distroless` zostaje warunkiem wejścia na produkcję.
- 2026-11-13 — triage wg decyzji „jedno środowisko” (product-owner): twardy termin 2026-11-20 (RR-37/RR-38) dotyczy teraz środowiska z realnymi danymi — **pierwsza w kolejności pozycja utwardzająca** (wariant B przed terminem); „warunek wejścia na produkcję” (`distroless`, wariant A) = start realnych danych albo świadome odroczenie z terminem zapisane przez Konrada; AC bez zmian.
- 2026-11-13 — korekta triage (Tech Lead): AC2–AC4 zrealizowane w #128 (Caddy 2.11.9 w `evia-web` i na brzegu, wyjątki RR-37/RR-38 usunięte i zamknięte w modelu zagrożeń, `publish` zielony na `linux/arm64`); termin 2026-11-20 nieaktualny. Zostaje AC1 „zero wyjątków”: wpis RR-89(a) (`golang.org/x/net` 0.60.0 w Caddy) do pierwszego wydania Caddy z x/net ≥ 0.62.0, najpóźniej 2026-12-10 — wtedy historyjka do zamknięcia bez osobnej pracy.
- 2026-11-15 — refinement (product-owner): historyjka przepisana na pozostały zakres (podbicie Caddy po wydaniu z x/net ≥ 0.62.0, zamknięcie RR-89(a), wariant awaryjny przy braku wydania); 4 AC, ścieżka `lekka` (propozycja), status `draft`. Wariant A: rekomendacja rezygnacji; `statement` „staging only” poprawiany przy najbliższej zmianie pliku. Do akceptacji Konrada.
- 2026-11-15 — akceptacja Konrada (DoR, wg rekomendacji): rezygnacja z wariantu A (`distroless`); wyjątek RR-89(a) zaakceptowany do 2026-12-10 także przy danych realnych; przy braku wydania Caddy do 2026-12-07 jedno przedłużenie o najwyżej 30 dni po ponownej analizie `security-engineer` i potwierdzeniu Konrada (AC4); ścieżka `lekka`; **status `ready`** — start po wydaniu Caddy z x/net ≥ 0.62.0 (Tech Lead)
- 2026-11-15 — próba realizacji w kolejce nocnej 15/16.11 zatrzymana na starcie: najnowsze wydanie Caddy to nadal v2.11.9 (2026-11-05) bez `golang.org/x/net` ≥ 0.62.0, więc nie ma czego podbijać; bez zmian w obrazie; status zostaje `ready` (czeka na wydanie Caddy; sprawdzenie przy `/progress`, najpóźniej 2026-12-07 AC4) (devops-engineer, Tech Lead)
