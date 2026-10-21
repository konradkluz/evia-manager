---
id: EVM-011
title: "Spike: kolejka offline i upload w tle"
type: spike
milestone: M0
epic: E00 Fundamenty
status: in-progress
priority: P1
owner: mobile-developer
contributors: []
reviewers: [solution-architect, security-engineer]
depends_on: [EVM-001]
path: pelna
model: sonnet
---

# EVM-011: Spike — kolejka offline i upload w tle

## Cel
Sprawdzić w praktyce, czy podejście mobilne z ADR spełnia najtrudniejsze wymaganie systemu: **zdjęcia i duże filmy zrobione bez zasięgu trafiają na serwer automatycznie, w tle i bez strat** — zanim zbudujemy na nim M2. Time-box: jedna sesja realizacji; kod spike'a nie trafia na produkcję.

## Kryteria akceptacji
**AC1 — Prototyp**
- Wtedy w `spikes/offline-upload/` jest prototyp: aparat → trwały zapis lokalny → trwała kolejka → wznawialny upload porcjami do storage'u zgodnego z ADR (staging albo lokalny emulator S3).

**AC2 — Scenariusze (Android: emulator na Windows i fizyczny telefon)**
- Wtedy raport zawiera wyniki na Androidzie — osobno dla emulatora na Windows i fizycznego telefonu (scenariusze wymagające sprzętu, np. przełączenie Wi-Fi ↔ LTE i restart telefonu, co najmniej na fizycznym telefonie) — dla: tryb samolotowy → powrót sieci; zabicie aplikacji w trakcie uploadu; restart telefonu; aplikacja w tle przez ponad 10 min; film ≥ 500 MB; przełączenie Wi-Fi ↔ LTE.
- _iOS odłożony (decyzja Konrada 2026-10-03, ADR-0015) — bez scenariuszy iOS w tym spike'u._

**AC3 — Pomiary**
- Wtedy raport podaje: czas uploadu, orientacyjne zużycie baterii, liczbę ponowień, liczbę duplikatów (oczekiwane 0) i wynik weryfikacji integralności (suma kontrolna).

**AC4 — Rekomendacja**
- Wtedy `docs/architecture/offline-sync.md` i `docs/architecture/media-pipeline.md` zawierają wnioski; jeśli podejście z ADR się nie sprawdza — jest propozycja zmiany ADR.

**AC5 — Weryfikacja na telefonie (ręczna)**
- Gdy Konrad lub technik wykonuje scenariusz „tryb samolotowy → zdjęcia i film → powrót sieci” na fizycznym telefonie z Androidem
- Wtedy pliki docierają na serwer bez duplikatów.

## Poza zakresem
Jakość produkcyjna kodu, UI zgodny ze styleguide'em, uwierzytelnianie (prototyp może używać tokenu testowego bez danych klientów).
iOS — odłożony (decyzja Konrada 2026-10-03, ADR-0015): scenariusze i pomiary na iPhonie, build iOS. Ryzyka uploadu w tle na iOS (ADR-0007/0009) pozostają niezweryfikowane — do sprawdzenia przed planowaniem wydania iOS.

## UX / UI
Nie dotyczy (prototyp techniczny).

## Bezpieczeństwo i prywatność
Tylko dane testowe; storage testowy prywatny; żadnych sekretów w kodzie spike'a.

## Notatki techniczne
Scenariusze Androida na emulatorze na Windows i na fizycznym telefonie (ADR-0015). iOS odłożony — prototyp nie musi działać na iOS; wnioski w AC4 jawnie oznaczają, które dotyczą tylko Androida.

## Plan techniczny
Spike poza workspace'em repozytorium: `spikes/offline-upload/` (własny `pnpm-workspace.yaml` i lockfile). Rdzeń protokołu w czystym TypeScript (`core/`, TDD, testy `EVM-011 AC#`), url-issuer i skrypty w Node (`host/`), SeaweedFS 4.48 przypięty po digeście (`infra/`), aplikacja Expo + własny moduł Kotlin z zadaniami UIDT (`app/`). Decyzja 2a/2b: biblioteka `@kesha-antonov/react-native-background-downloader` 4.6.3 nie spełnia strategii ADR-0007 na Androidzie (przegląd kodu) → własny moduł. Scenariusze na emulatorze API 35 (airplane, `force-stop`, `kill -9`, restart z PIN-em, 512 MiB, tło > 10 min). Szczegóły, wyniki i instrukcja dla Konrada (telefon: AC2/AC5): [raport](../../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md); wnioski: [`media-pipeline.md`](../../architecture/media-pipeline.md), [`offline-sync.md`](../../architecture/offline-sync.md); propozycja zmiany ADR: [ADR-0020](../../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (Proponowana).

## Decyzje
- **2026-10-20 (Konrad):** noc: scenariusze na emulatorze Android (`Medium_Phone_API_35`, Maestro 2.11.0) i storage zgodny z S3 uruchamiany lokalnie; scenariusze wymagające fizycznego telefonu (AC2 część „telefon”, AC5) zostają do ręcznej weryfikacji Konrada — historyjka kończy nocą w `in-review`, nie `done`; raport oznacza jawnie, co zmierzono tylko na emulatorze.
- Ścieżka `pelna` (dwóch recenzentów, upload plików), model `sonnet`.

## Uwagi do rozważenia
_—_

## Definition of Done
- [ ] AC1–AC4 spełnione; AC5 potwierdzone przez Konrada
- [ ] Przeglądy: solution-architect, security-engineer — APPROVE
- [ ] Decyzja Konrada: kontynuujemy z podejściem z ADR / zmieniamy ADR

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — zmiana AC — do potwierdzenia przez Konrada: AC2 i AC5 tylko Android (emulator na Windows + fizyczny telefon; iOS odłożony, decyzja Konrada 2026-10-03, ADR-0015); iOS dopisany do „Poza zakresem”; „Notatki techniczne” wg ADR-0015 (product-owner)
- 2026-10-03 — zmiana AC (iOS odłożony, ADR-0015) potwierdzona przez Konrada; status bez zmian: ready
- 2026-10-20 — zmiana zakresu nocnego zaakceptowana przez Konrada: emulator tej nocy, fizyczny telefon (AC2/AC5) ręcznie rano; `path: pelna`, `model: sonnet`
- 2026-10-21 — ready → in-progress: start realizacji w kolejce B po EVM-009 (gałąź feature/EVM-009-011-aplikacja-mobilna, pelna, sonnet); emulator Android tej nocy, fizyczny telefon (AC2/AC5) ręcznie rano
- 2026-10-21 — implementacja spike'a na emulatorze (mobile-developer): prototyp, scenariusze AC2 (emulator), pomiary AC3, wnioski AC4 i ADR-0020 (Proponowana); AC5 i część „telefon” AC2 niewykonane — czekają na Konrada (instrukcja w raporcie)
