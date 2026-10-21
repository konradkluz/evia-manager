---
id: EVM-011
title: "Spike: kolejka offline i upload w tle"
type: spike
milestone: M0
epic: E00 Fundamenty
status: done
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
Spike poza workspace'em repozytorium: `spikes/offline-upload/` (własny `pnpm-workspace.yaml` i lockfile). Rdzeń protokołu w czystym TypeScript (`core/`, TDD, testy `EVM-011 AC#`), url-issuer i skrypty w Node (`host/`), SeaweedFS 4.48 przypięty po digeście (`infra/`), aplikacja Expo + własny moduł Kotlin z zadaniami UIDT (`app/`). Decyzja 2a/2b: biblioteka `@kesha-antonov/react-native-background-downloader` 4.6.3 nie spełnia strategii ADR-0007 na Androidzie (przegląd kodu) → własny moduł. Scenariusze na emulatorze API 35 (airplane, `force-stop`, `kill -9`, restart z PIN-em, 512 MiB, tło > 10 min). Szczegóły, wyniki i instrukcja dla Konrada (telefon: AC2/AC5): [raport](../../spikes/EVM-011-kolejka-offline-i-upload-w-tle.md); wnioski: [`media-pipeline.md`](../../architecture/media-pipeline.md), [`offline-sync.md`](../../architecture/offline-sync.md); zmiana ADR: [ADR-0020](../../architecture/adr/0020-android-upload-w-tle-wlasny-modul-expo.md) (Zaakceptowana 2026-10-21).

## Decyzje
- **2026-10-20 (Konrad):** noc: scenariusze na emulatorze Android (`Medium_Phone_API_35`, Maestro 2.11.0) i storage zgodny z S3 uruchamiany lokalnie; scenariusze wymagające fizycznego telefonu (AC2 część „telefon”, AC5) zostają do ręcznej weryfikacji Konrada — historyjka kończy nocą w `in-review`, nie `done`; raport oznacza jawnie, co zmierzono tylko na emulatorze.
- Ścieżka `pelna` (dwóch recenzentów, upload plików), model `sonnet`.

## Notatki (uwagi nieblokujące z przeglądów)
- **Dowody: emulator API 35 i jeden telefon z Androidem 13 (scenariusz samolotowy, 2026-10-21):** tryb oszczędzania (`deviceidle force-idle`) wymuszono 1 s po starcie zadania — nie sprawdzono zadania startującego w trakcie idle/restricted; pliki scenariuszy rozmiarowych i film ≥ 500 MB są syntetyczne, nie z kamery; na telefonie niezrobione: Wi-Fi ↔ LTE w trakcie wysyłki, restart, tło > 10 min, bateria, wysyłka wieloczęściowa i UIDT na Androidzie 14+ (Android 13 użył wariantu zastępczego).
- **Przed M2 (ADR-0020, Zaakceptowana 2026-10-21):** aktualizacja ADR-0014 (bramki Kotlin) i `docs/process/testing-strategy.md` (próg pokrycia modułu Kotlin); uwierzytelnianie natywnego workera bez JS (statyczny token testowy jest niedopuszczalny produkcyjnie — decyzja przed M2); nowy kod błędu `409 completed_object_mismatch` do kontraktu OpenAPI; `expo-camera` 58 dołącza ML Kit (`MlKitInitProvider`, `firebase-*`) — telemetria niezbadana (ruch sieciowy albo `react-native-vision-camera`).
- **Zależności spike'a:** Renovate nie obejmuje `spikes/**` (jest wyłączony, RR-21 Q1); OSV na lockfile spike'a: `braces`, `node-forge`, `uuid` (narzędzia budowania, poza APK) — do decyzji Konrada: `ignorePaths: ["spikes/**"]` albo usunięcie spike'a po decyzji o ADR-0020.
- **Proces:** po rundzie 2 (APPROVE) mobile-developer domknął 3 uwagi minor/nit bez ponownego przeglądu (UTF-8 w tytule testu, `complete()` ukończonego uploadu nie kasuje obiektu ani mapowania, wiersz pytania 7(b)) — commit 9eff742; weryfikacja orkiestratora: `core` 33/33, `host` 20/20 względem SeaweedFS.

## Uwagi do rozważenia
_—_

## Definition of Done
- [x] AC1–AC4 spełnione; AC5 potwierdzone przez Konrada — AC1–AC4 ✔ (QA PASS, emulator API 35); AC5 potwierdzony na telefonie z Androidem 13 (2026-10-21)
- [x] Przeglądy: solution-architect, security-engineer — APPROVE (runda 2)
- [x] Decyzja Konrada: kontynuujemy z podejściem z ADR / zmieniamy ADR — ADR-0020 zaakceptowana 2026-10-21 (zmieniamy ADR-0007 dla Androida)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — zmiana AC — do potwierdzenia przez Konrada: AC2 i AC5 tylko Android (emulator na Windows + fizyczny telefon; iOS odłożony, decyzja Konrada 2026-10-03, ADR-0015); iOS dopisany do „Poza zakresem”; „Notatki techniczne” wg ADR-0015 (product-owner)
- 2026-10-03 — zmiana AC (iOS odłożony, ADR-0015) potwierdzona przez Konrada; status bez zmian: ready
- 2026-10-20 — zmiana zakresu nocnego zaakceptowana przez Konrada: emulator tej nocy, fizyczny telefon (AC2/AC5) ręcznie rano; `path: pelna`, `model: sonnet`
- 2026-10-21 — ready → in-progress: start realizacji w kolejce B po EVM-009 (gałąź feature/EVM-009-011-aplikacja-mobilna, pelna, sonnet); emulator Android tej nocy, fizyczny telefon (AC2/AC5) ręcznie rano
- 2026-10-21 — implementacja spike'a na emulatorze (mobile-developer): prototyp, scenariusze AC2 (emulator), pomiary AC3, wnioski AC4 i ADR-0020 (Proponowana); AC5 i część „telefon” AC2 niewykonane — czekają na Konrada (instrukcja w raporcie)
- 2026-10-21 — QA (qa-engineer): AC1–AC4 PASS, AC5 manual (telefon). Przeglądy, runda 1: solution-architect i security-engineer — CHANGES_REQUIRED (5 problemów blokujących: `409 id_conflict` ze skutkami ubocznymi i możliwością nadpisania ukończonego obiektu, ADR-0020 bez uwierzytelniania workera bez JS i bez Kotlina jako drugiego języka, opis tras w media-pipeline); poprawki (mobile-developer, 5eaf8f3); runda 2: obaj APPROVE
- 2026-10-21 — drobne uwagi po rundzie 2 domknięte bez ponownego przeglądu (mobile-developer, 9eff742): kodowanie UTF-8 tytułu testu, `complete()` dla ukończonej sesji nigdy nie kasuje obiektu ani mapowania (`409 completed_object_mismatch` + zdarzenie w logu issuera), wiersz pytania 7(b) w raporcie, SHA-256 APK w instrukcji telefonu
- 2026-10-21 — weryfikacja orkiestratora: spike `core` 33/33 i `host` 20/20 względem SeaweedFS (compose up/down); `pnpm run gate` zielony w jednym przebiegu (start na HEAD 841e6c3, zmiany tools/scan fea00b4 i 3f9afaa przetestowane osobno: `npm run test:tools` 634/638 pass, 0 fail, `pnpm --filter @evia/scan run test:coverage` 53/53, `node tools/scan/cli.mjs licenses` ZIELONY, i wliczone do `coverage:diff` tego przebiegu): etap natywny 56 zadań, parytet Linux 17 zadań, testy integracyjne 130 plików / 1835 testów, `coverage:diff` zmienionego kodu — linie 98,9% (2419/2445), gałęzie 95,0% (995/1047); `docs:check` 0 błędów
- 2026-10-21 — in-progress → in-review: AC1–AC4 zweryfikowane na emulatorze; AC5, część „telefon” AC2 (instrukcja i SHA-256 APK w raporcie) oraz akceptacja ADR-0020 czekają na Konrada; historyjka nie przechodzi w `done` do czasu wyniku z telefonu
- 2026-10-21 — demo zaakceptowane przez Konrada (kolejka B); ADR-0020 zostaje „Proponowana” do wyniku z telefonu; AC5 i część „telefon” AC2 czekają na Konrada (instrukcja w raporcie)
- 2026-10-21 — test na fizycznym telefonie (Konrad, z asystą orkiestratora): Samsung SM-G781B, Android 13; dwa podejścia, 14 plików (11 zdjęć, 3 filmy), 14 × `uploaded`, 0 ponowień, `count-duplicates` 0 duplikatów i 0 osieroconych multipart, `verify-integrity` 14/14 zgodne SHA-256; w trybie samolotowym 3 zdjęcia i film czekały 11,6–18,5 s i dotarły po powrocie sieci; wynik i granice w raporcie („Wynik na telefonie”); aplikacja odinstalowana, serwisy testowe i klucze usunięte
- 2026-10-21 — AC5 potwierdzony przez Konrada; ADR-0020 zaakceptowana (zmiana ADR-0007 dla Androida: własny moduł Kotlin zamiast biblioteki) → in-review → done
