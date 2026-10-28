---
id: EVM-049
title: Kwarantanna plików — „Wymaga uwagi”, alert i ponowny skan
type: story
milestone: M1
epic: E6 Dokumenty i media (web)
status: in-review
priority: P1
path: pelna
model: sonnet
owner: backend-developer
contributors: [web-developer, devops-engineer]
reviewers: [code-reviewer, security-engineer, ux-designer]
depends_on: [EVM-024, EVM-044]
---

# EVM-049: Kwarantanna plików — „Wymaga uwagi”, alert i ponowny skan

## Historyjka
Jako **Administrator** chcę **dostać alert o każdym pliku zatrzymanym przez skan, zobaczyć przyczynę i zlecić ponowny skan**, aby **reagować na zagrożenia i odzyskać plik po fałszywym alarmie — bez ręcznego „zwalniania” plików**.

## Kontekst
- P5 (kwarantanna 30 dni, alert do Administratorów z samym linkiem, ponowny skan ze step-upem, brak zwolnienia bez skanu, nigdy zewnętrzne serwisy), SR-FILE-05, SR-LOG-07, SR-DATA-07 (usuwanie po 30 dniach od pierwszego wydania).
- Do tej historyjki z EVM-044 wolno było przenieść tylko UI „Wymaga uwagi”, alert i ponowny skan (konsultacja `security-engineer`, pkt 6a). Alert jest e-mailem — zależność od EVM-024.
- Makieta: [W-09](../../ux/flows/06-galeria-i-upload.md#w-09-media-i-dokumenty) — stan `quarantined`, filtr „Wymaga uwagi (n)”. Scenariusz C10.

## Kryteria akceptacji
**AC1 — Przyczyna tylko dla Administratora**
- Zakładając plik w kwarantannie z przyczyną `malware_detected`
- Gdy otwieram W-09
- Wtedy Administrator widzi „Wymaga uwagi” z przyczyną („Skan wykrył zagrożenie”, „Typ pliku niezgodny z rozszerzeniem”) i „Skanuj ponownie”, a Edytor i Tylko odczyt — „Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.” bez przyczyny i akcji (API nie zwraca im przyczyny).

**AC2 — Alert (SR-FILE-05, SR-LOG-07)**
- Gdy plik trafia do kwarantanny
- Wtedy wszyscy Administratorzy dostają e-mail z samym linkiem do zlecenia w panelu (bez nazwy pliku, klienta i adresu), a kanał alertów — alert bezpieczeństwa.

**AC3 — Ponowny skan (SR-SESS-08)**
- Zakładając plik w kwarantannie po aktualizacji sygnatur
- Gdy Administrator wybiera „Skanuj ponownie” i potwierdza tożsamość w W-04
- Wtedy plik jest skanowany ponownie: czysty wynik przywraca go do przepływu (`clean` → przetwarzanie → `ready`), wynik pozytywny zostawia go w kwarantannie; operacja jest audytowana.

**AC4 — Brak zwolnienia bez skanu (SR-ERR-01)**
- Gdy przeglądam kontrakt API
- Wtedy jedyną operacją zmieniającą stan pliku w kwarantannie jest ponowny skan, a żaden plik nie jest wysyłany do zewnętrznych serwisów.

**AC5 — Usunięcie po 30 dniach (SR-DATA-07, P4)**
- Zakładając plik w kwarantannie od 2026-09-01 (zegar kontrolowany)
- Gdy 2026-10-01 działa zadanie retencji
- Wtedy obiekt jest usunięty ze storage'u, a W-09 pokazuje kafel „Plik usunięty po 30 dniach kwarantanny” bez akcji.

**AC6 — Filtr „Wymaga uwagi”**
- Gdy wybieram filtr „Wymaga uwagi (1)”
- Wtedy widzę tylko pliki w kwarantannie, a brak takich plików pokazuje „Brak plików wymagających uwagi. [Pokaż wszystkie]”.

**AC7 — Sygnatury**
- Zakładając sygnatury ClamAV starsze niż 24 h
- Gdy działa monitoring
- Wtedy powstaje alert (po 72 h — codziennie), a skan działa dalej na starszych sygnaturach (test alertu na staging).

**AC8 — Uprawnienia (SR-AUTHZ-05)**
- Zakładając role Administrator, Edytor, Tylko odczyt i niezalogowanego
- Gdy każda zleca ponowny skan
- Wtedy tylko Administrator po step-upie; E i R — `403 forbidden`; niezalogowany — `401`; offline — akcja wyłączona.

## Poza zakresem
- Zgłoszenie próbki do producenta sygnatur — niedopuszczalne (P5). Kwarantanna plików z telefonu — ten sam mechanizm, widok na telefonie — M2.

## UX / UI
- W-09: znacznik [P-7] „Wymaga uwagi”, filtr, „Skanuj ponownie”, W-04 „Potwierdź tożsamość, aby ponownie przeskanować plik”. Stany: AC6, AC8.

## Bezpieczeństwo i prywatność
| Rola | Dostęp |
|---|---|
| Administrator | przyczyna, ponowny skan ze step-upem |
| Edytor | informacja bez przyczyny |
| Tylko odczyt | informacja bez przyczyny |
| Niezalogowany | brak (`401`) |

- Dane: pliki w kwarantannie (niedostępne dla nikogo), kody przyczyn.
- W AC: SR-FILE-05, SR-LOG-07, SR-SESS-08, SR-ERR-01, SR-DATA-07, SR-AUTHZ-05. W sekcji: SR-LOG-03. Polityki P4, P5.

## Notatki techniczne
- Moduły: `media`, worker, `audit` + panel. E-mail przez kolejkę z EVM-024.
- `devops-engineer`: alerty kwarantanny i wieku sygnatur (Grafana), lifecycle kwarantanny.
- Do potwierdzenia przez `solution-architect`: usunięcie po 30 dniach to retencja techniczna (lifecycle), a nie operacja z rejestru usunięć (README M1 → „Uwagi do potwierdzenia”).
- Zasady wspólne: [README.md](README.md#zasady-wspólne-dla-historyjek-m1).

## Plan techniczny
Backend (wykonane): migracje `0046` (kolumny `quarantined_at`/`purged_at` niezmienne, funkcja terminu `media.quarantine_expires_at`, powód `abandoned`), `0047` (`subject_id` w `email_outbox`), `0048` (kody alertów i indeks); kontrakt (`rescanMediaAsset`, `quarantine`, `quarantineReasonCode` przez `restrictedParams.mediaQuarantine.manage`, `needsAttention`, `needsAttentionCount`); moduł `media` (alert przy pierwszym wejściu, ponowny skan, trzy zadania pg-boss: retencja, porzucone uploady, monitor sygnatur; limity); porty `ObjectStorage.deleteObject` i `MalwareScanner.signatureDate`. Panel (kafle `held`/`purged`, filtr, „Skanuj ponownie” z W-04, etykiety) — `web-developer`; zmienne i sieć `evia-scan` w `compose.staging.yaml`, reguły Grafana i lifecycle bucketu — `devops-engineer`/T3. Plan szczegółowy: `.scratch/EVM-049/plan.md`.

## Decyzje
Wartości domyślne przyjęte z rekomendacji (do potwierdzenia przez Konrada na demo tam, gdzie zaznaczono):
- **D1 Kafel „usunięty”.** Bez nowego stanu pliku: `purged_at` (niezmienne) i `quarantine: { state: held | purged, expiresAt, purgedAt }`; `needsAttention` = `held` (kwarantanna albo trwający ponowny skan). Termin = początek dnia `Europe/Warsaw` pierwszego wejścia + 30 dni kalendarzowych (funkcja bazy, ta sama dla sweepera i API; 2026-09-01 → 2026-10-01 00:00); stała domenowa, nie zmienna środowiska. Ponowny skan z wynikiem pozytywnym terminu nie przesuwa; ponowny skan po terminie to `409 invalid_state_transition`.
- **D2 Retencja = retencja techniczna** (nie wpis rejestru usunięć; wiersz metadanych zostaje). Zadanie `media.quarantine-retention` co godzinę: najpierw magazyn (`DeleteObject` bez wersji = znacznik usunięcia, zgodnie z ADR-0009: blokada governance 30 d, brak bypass w aplikacji), potem `purged_at` + audyt. Stare wersje usuwa lifecycle noncurrent 30 d (T3), więc bajty fizycznie znikają po ok. 60 dniach — **do potwierdzenia przez Konrada**. Plik w `scanning` po terminie wraca do `quarantined` (przyczyna `malware_detected`, bo ta sprzed ponownego skanu jest wyczyszczona; po usunięciu przyczyny nikt nie widzi) i jest usuwany; spóźniony werdykt skanu nie ma czego zmienić.
- **D3 Alert e-mail:** wariant `administrator_media_quarantined` rodzaju `administrator_alert`, `subject_id` = zlecenie, link `{PANEL_ORIGIN}/work-orders/{id}` z konfiguracji; bez nazwy pliku, klienta, adresu i przyczyny; bez drugiego oczekującego e-maila dla tego samego odbiorcy i zlecenia. Alert bezpieczeństwa `media_quarantined` — jeden na każde wejście w kwarantannę. Ponowny skan nie wysyła ani e-maila, ani alertu.
- **D5 Sygnatury:** powyżej 24 h jeden `signature_stale` na epizod, powyżej 72 h `signature_stale_72h` raz na dobę; deduplikacja w `security_alert_outbox`; wiek nieznany (brak odpowiedzi, śmieci, data z przyszłości) dłużej niż 24 h liczy się jak stary (fail-closed). `clamd` z `TZ=UTC`.
- **D7 Przyczyna tylko dla Administratora** przez istniejący mechanizm `restrictedParams` (polityka `mediaQuarantine.manage`, ewaluator `canManageQuarantine`); dla Edytora i Tylko odczyt pole `quarantineReasonCode` w ogóle nie występuje. Filtr `needsAttention=true`; licznik `needsAttentionCount` dla wszystkich ról; kursor związany z filtrem i wariantem polityki.
- **D9 Porzucone uploady i limity** (do potwierdzenia przez Konrada: wartości): plik `pending_upload` bez aktywnej niewygasłej sesji przez 7 dni → `failed`/`abandoned` (wznawialny jak `checksum_mismatch`, ten sam klucz — telefon offline dłużej niż 7 dni nie traci medium); limity niedokończonych 200 na użytkownika i 500 na zlecenie, błąd **`422 limit_exceeded`** (limit obiektów podrzędnych wg `api-guidelines.md`; 429 zostaje dla `rate_limited`), liczone w transakcji pod blokadą doradczą. Wartości w `MEDIA_MAX_PENDING_PER_USER`, `MEDIA_MAX_PENDING_PER_ORDER`, `MEDIA_ABANDON_AFTER_DAYS`.
- **Dla EVM-048:** projekcja synchronizacji stosuje tę samą politykę pól (`quarantineReasonCode` tylko dla Administratora).
- **Ryzyka rezydualne (numery RR-NOC-T1-n; do `threat-model.md` przy scaleniu):** T1-9 (Średnie) reguły Grafana dla `media_quarantined`, wieku sygnatur i awarii retencji oraz **test alertu na stagingu (AC7) wymagają T3/chmury — niewykonane, zgłoszone na demo jako niespełniona część AC7**; dziś działa e-mail i `security_alert_outbox`. T1-10 (Niskie) lifecycle bucketu jako druga warstwa niewdrożony (T3); jedyną kontrolą jest sweeper. T1-11 (Niskie) kopia mediów (`rclone sync` do Storage Box) kopiuje też obiekty nieskanowane i z kwarantanny — rozważyć wykluczenie (T3). T1-12 (Niskie) początek „wieku nieznanego” sygnatur jest w pamięci workera (restart zaczyna odliczanie od nowa). T1-13 (Niskie) `original_filename` zostaje w `stored_files` po usunięciu obiektu (dane biznesowe, retencja M4) — odnotować w `rodo.md` przy scaleniu.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] Wszystkie AC spełnione i pokryte testami (`EVM-049 AC#`)
- [ ] Bramki CI zielone, progi pokrycia spełnione
- [ ] Przeglądy: kod / bezpieczeństwo / UX (wg `reviewers`) — APPROVE
- [ ] Dokumentacja i `CHANGELOG.md` zaktualizowane
- [ ] Demo i akceptacja użytkownika (scenariusz C10)

## Dziennik
- 2026-10-03 — utworzono (product-owner, EVM-010 — `/milestone plan M1`)
- 2026-10-03 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M1 na demo EVM-010)
- 2026-10-27 — nocna kolejka (tor T1): Konrad wskazał ścieżkę lekka, ale historyjka ma 8 AC i 3 recenzentów (lekka: ≤ 6 AC i 1 recenzent) — przyjęto pelna, model sonnet (Tech Lead); do potwierdzenia przez Konrada
- 2026-10-28 — start realizacji (nocna kolejka, tor T1), gałąź feature/EVM-044-049-media-upload-kwarantanna
- 2026-10-28 — plan gotowy (backend-developer)
- 2026-10-28 — implementacja backendu (backend-developer): migracje 0046–0048, kontrakt, ponowny skan, alert, retencja, porzucone uploady, monitor sygnatur, limity; testy EVM-049 AC1–AC8 zielone w kontenerze; do wykonania: panel (web-developer), zmienne i sieć `evia-scan` w `compose.staging.yaml` (devops), AC7 na stagingu (T3)
- 2026-10-28 — implementacja panelu (web-developer): kafle held/purged, filtr „Wymaga uwagi (n)", „Skanuj ponownie" z W-04, etykiety w media-labels.ts; testy komponentów i E2E (axe, zrzuty w docs/ux/reviews/EVM-049, PNG poza gitem); do wykonania: zmienne w compose.staging.yaml (devops)
- 2026-10-28 — krok devops: compose.staging.yaml bez zmian (kanał wdrożeń nie dopuszcza dodatkowych sieci, zmienne mediów all-or-nothing wymagają bucketu — T3/chmura; fail-closed 503), TZ=UTC dla clamd już w compose.infra.yaml; lokalna bramka zielona (natywnie, parytet Linux, integracja 2070 testów, coverage:diff, docs:check)
- 2026-10-28 — Tech Lead (nocna kolejka, bez pytania do Konrada), decyzje warunkowe do potwierdzenia na demo: (a) AC7 dzielimy na część kodową (monitor sygnatur i alert w outboxie — zrobione) i stagingową (reguły Grafana i test alertu — do sesji IaC / historyjki T3 z nowym ID); AC7 nie jest zamknięte do tego czasu; (b) AC5 „usunięty ze storage'u” = DeleteObject bez wersji (delete marker, ADR-0009) + lifecycle noncurrent (~60 dni, T3), do tego czasu kontrola przez sweeper (RR-NOC-T1-9). Web: poprawki po przeglądzie (stan „Sprawdzanie pliku” dla held+scanning, potwierdzenie ponownego skanu) w aa077b2. Status in-review jako kandydat; DoD/done dopiero po decyzji Konrada.
- 2026-10-28 — Decyzja Konrada (delegacja: „podejmij najlepsze decyzje”): przyjęte (a) podział AC7 — część stagingowa (reguły Grafana, test alertu) wykonywana w sesji IaC razem z EVM-085, bez osobnej historyjki; AC7 w pełni zamknięte dopiero wtedy, (b) interpretacja AC5 (delete marker + lifecycle noncurrent ~60 dni; do tego czasu sweeper). Historyjka zostaje `in-review`, `done` po dowodzie z sesji IaC.
