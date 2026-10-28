---
id: EVM-097
title: "API: pobieranie pozostałych encji, wejście i wyjście z zakresu"
type: story
milestone: M2
epic: E10 Zlecenia offline
status: draft
priority: P1
path: pelna             # synchronizacja offline, uprawnienia
owner: backend-developer
contributors: []
reviewers: [code-reviewer, security-engineer, solution-architect]
model: sonnet
depends_on: [EVM-096]
---

# EVM-097: API — pozostałe encje, wejście i wyjście z zakresu

## Cel
Jako **technik** chcę, aby **szczegóły zlecenia na telefonie były kompletne (etapy, strony, zakres, wpisy) i aby zlecenia wchodziły i wychodziły z telefonu zgodnie z zakresem**, aby **nie widzieć niepełnych zleceń ani nie nosić zbędnych danych**. Rozszerza EVM-096 o encje z projekcji „Zakres synchronizacji urządzenia” ([`offline-sync.md`](../../architecture/offline-sync.md)).

## Kryteria akceptacji

**AC1 — Encje powiązane**
- Zakładając zlecenie w zakresie
- Gdy pobieram zmiany
- Wtedy dostaję także procesy i etapy, strony (kontrahenci), pozycje zakresu, przypisania, wpisy dziennika, nazwy użytkowników (`id`, `displayName`) i globalną konfigurację potrzebną do szybkiego zlecenia, w projekcji z jawnej listy pól dla telefonu; test negatywny potwierdza, że płatności, audyt, e-mail kontrahentów i PPE nie występują w żadnej stronie; dla każdej encji działa wyzwalacz dziennika z testem kompletności z EVM-096.

**AC2 — Wejście do zakresu (scenariusz 5): migawka zlecenia**
- Zakładając nowe zlecenie dla istniejącego klienta spoza telefonu, przywrócenie po soft delete, ponowne otwarcie zamkniętego > N dni i wskazanie nowej strony w etapie
- Gdy telefon nie zna zlecenia lub brakuje mu referencji i pobiera `GET /api/v1/sync/work-orders/{id}` (kanał `mobile`)
- Wtedy dostaje migawkę agregatu (zlecenie z bieżącym stanem klienta, lokalizacji i encji powiązanych, w tej samej projekcji i z tym samym czytnikiem co pierwsze pobranie; test negatywny waliduje migawkę ścisłą walidacją projekcji `assertSyncProjectionStrict`, nie przez schemat odpowiedzi), a zlecenie spoza zakresu lub bez dostępu daje `404`/`403` bez ujawniania istnienia; agregat > 1 MB jest zgłaszany metryką (pomiar w EVM-107).

**AC3 — Wyjście z zakresu**
- Zakładając zlecenie zamknięte ponad N dni temu, usunięcie zlecenia lub utratę dostępu
- Gdy pobieram zmiany
- Wtedy serwer nie wysyła obiektów spoza zakresu; usunięcie daje znacznik `delete` (`type` + `id`, bez danych osobowych), wyjście czasowe (`closedAt` + N) obsługuje reguła klienta, a utrata dostępu daje `resync_required` (bez osobnego typu zdarzenia).

**AC4 — `resync_required` przy zmianie dostępu**
- Zakładając zmianę roli lub reguły zakresu (N)
- Gdy telefon pobiera zmiany
- Wtedy dostaje `resync_required` (zmiana N przez wersję reguły zakresu w kursorze); obiekty bez dostępu nie są zwracane, a telefon po resyncu nie zachowuje obiektów bez dostępu.

**AC5 — Uprawnienia**
- Zakładając wszystkie role i unieważnione urządzenie
- Gdy pobierają zmiany
- Wtedy jak w EVM-096 AC5 (w tym `device_wipe_required`); testy macierzy ról dla każdej nowej encji i operacji migawki.

## Poza zakresem
Metadane mediów i dokumentów (po E6: EVM-048), rola Monter (M4), edycje.

## Decyzje i ograniczenia
- **Wymaga ADR-0021 w statusie Zaakceptowana przed `ready`** (wejście do zakresu jednym mechanizmem sterowanym klientem, zmiana zasady „serwer dostarcza w tej samej stronie”; wyjście z zakresu bez nowego typu zdarzenia).
- Bezpieczeństwo i prywatność: projekcja przez jawną listę pól; znaczniki tylko dla obiektów wcześniej w zakresie urządzenia.

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — naniesiono konsultacje: architekt, security (product-owner)
