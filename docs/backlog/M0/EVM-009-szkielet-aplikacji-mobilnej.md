---
id: EVM-009
title: Chodzący szkielet — aplikacja mobilna
type: enabler
milestone: M0
epic: E00 Fundamenty
status: done
priority: P1
owner: mobile-developer
contributors: [devops-engineer]
reviewers: [code-reviewer, ux-designer, security-engineer]
depends_on: [EVM-003, EVM-006, EVM-008]
path: pelna
model: sonnet
---

# EVM-009: Chodzący szkielet — aplikacja mobilna

## Historyjka
Jako **zespół** chcemy **minimalnej aplikacji mobilnej budowanej w CI i instalowalnej na telefonach firmy**, aby **M2 zaczynać od działającego fundamentu i kanału dystrybucji**.

## Kontekst
Podejście mobilne i dystrybucja: ADR-y z EVM-001. API ze szkieletu: EVM-008.

## Kryteria akceptacji
**AC1 — Powłoka aplikacji**
- Gdy uruchamiam aplikację
- Wtedy widzę ekran startowy i nawigację wg styleguide'u (tokeny, teksty przez i18n pl) z pustym stanem listy zleceń.

**AC2 — Połączenie z API**
- Zakładając działający endpoint zdrowia (lokalne API z EVM-008 w kontenerze; staging od EVM-007 — zmiana AC 2026-10-20)
- Gdy aplikacja startuje z siecią i bez sieci
- Wtedy odpowiednio łączy się z API albo pokazuje czytelny stan „offline / brak połączenia z serwerem”.

**AC3 — Minimalna wersja**
- Zakładając, że API zwraca minimalną wspieraną wersję wyższą niż wersja aplikacji
- Gdy aplikacja startuje
- Wtedy pokazuje ekran z prośbą o aktualizację.

**AC4 — Testy**
- Wtedy testy jednostkowe i komponentowe działają w CI z progami pokrycia, a test dymny E2E mobile działa wg ADR.

**AC5 — Build i dystrybucja**
- Wtedy CI buduje niepodpisany APK Androida (lokalny build Gradle po `expo prebuild`) i publikuje go jako artefakt; podpis APK wykonuje Konrad lokalnie skryptem (apksigner) kluczem poza repozytorium i poza sekretami GitHuba; APK jest instalowany ręcznie (sideload) na telefonach firmy — bez Google Play i EAS na MVP (zmiana AC 2026-10-20, podpis lokalny wg decyzji Konrada 2026-10-20 po rekomendacji security-engineera, RR-21).
- Weryfikacja ręczna (Konrad): APK podpisany lokalnie z artefaktu CI zainstalowany na min. 1 telefonie Android.
- _iOS odłożony (decyzja Konrada 2026-10-03, ADR-0015) — bez buildu iOS i bez instalacji na iPhonie w tej historyjce._

**AC6 — Bezpieczeństwo bazowe**
- Wtedy paczka aplikacji nie zawiera sekretów, komunikacja odbywa się wyłącznie przez HTTPS, a bezpieczny magazyn na tokeny jest przygotowany (bez logowania).

## Poza zakresem
Logowanie (M2, E9), praca offline na danych, aparat i upload (spike EVM-011, potem M2).
iOS — odłożony (decyzja Konrada 2026-10-03, ADR-0015): build iOS w CI/EAS, kanał dystrybucji iOS, konto Apple Developer, testy na iPhonie i symulatorze iOS. Decyzja o iOS przed planowaniem wydania iOS; kod aplikacji pozostaje zgodny z iOS (Expo).

## UX / UI
Powłoka, pusty stan i ekran aktualizacji wg styleguide'u v1 (wytyczne „Teren”). Specyfikacja `ux-designer` 2026-10-20 (bez nowych tokenów i komponentów; jedno doprecyzowanie wzorca — changelog styleguide'u, „Propozycja do 1.3.0 — EVM-009”):

**Ekrany i przepływ.** Start → ekran ładowania (szkielet) → sprawdzenie `GET` zdrowia i minimalnej wersji (limit 10 s) → jeden z trzech wyników: (a) **S-01 Moje zlecenia** (pusty stan) z BottomNav; (b) **S-02 Aktualizacja wymagana** (wersja aplikacji < minimalna) — pusty stan blokujący, bez BottomNav; (c) **S-01 z banerem** „Brak połączenia z serwerem” (offline lub API nieosiągalne). Wersja za niska ma pierwszeństwo przed wszystkim; gdy nie da się sprawdzić wersji (offline), aplikacja działa dalej — blokada tylko po potwierdzeniu przez serwer. Brak logowania (M2) — nawigacja bez „Więcej”/konta.

**S-01 Moje zlecenia** (cel: od razu widać, że aplikacja działa i co dalej; główna akcja: brak — nie ma jeszcze funkcji, która by ją obsłużyła).
- Hierarchia: AppBar (§ 3.18: `color.bg.brand-strong`, tytuł „Moje zlecenia” `text.heading-3` `color.text.on-brand`, po prawej SyncIndicator) → ewentualny baner → EmptyState „bez akcji” (§ 3.15, wariant z changelogu 1.3.0 EVM-008) → BottomNav (`size.bottom-nav.height`, `elevation.bottom-bar`) z dwiema pozycjami: „Moje zlecenia” (aktywna) i „Kolejka” (bez licznika; ekran „Kolejka” = EmptyState „Nic nie czeka na wysłanie.”, bo SyncIndicator prowadzi do niej; AC1 wymaga nawigacji, a styleguide dopuszcza min. 3 pozycje — odstępstwo do 2 pozycji w szkielecie opisane w changelogu).
- EmptyState: ikona `clipboard-list` `size.icon.2xl` `color.icon.secondary` (`aria-hidden`), tytuł `text.heading-3` „Brak zleceń”, opis `text.body` `color.text.secondary` „Zlecenia pojawią się tu po zalogowaniu i synchronizacji.” Bez przycisku. Odstępy `space.stack.md`, wokół `space.stack.2xl`; tło `color.bg.canvas`.
- SyncIndicator: online → `cloud-check` „Połączono” (`color.sync.done.*`, bez godziny — nic jeszcze nie synchronizowano); offline → `wifi-off` „Offline” z obrysem `color.border.inverse` (§ 5.4). Kapsuła zawsze na własnym tle, cel dotyku ≥ `size.touch-target.min`; dotknięcie → ekran „Kolejka”.

**Stany S-01.**
- *Ładowanie:* AppBar + Skeleton (linie tekstu i karta, `aria-busy`), bez spinnera i bez kapsuły SyncIndicator (stan połączenia nieznany — reguła w changelogu styleguide'u). Po 5 s dopisek `text.body` „Ładowanie trwa dłużej niż zwykle…” (ogłoszony `polite`, bez przycisku — trwa jedno sprawdzenie). Po 10 s (limit sprawdzenia) przejście do stanu „Serwer niedostępny” (InlineAlert z [Spróbuj ponownie]) albo „Offline” (baner). *(propozycja po przeglądzie UX 2026-10-21, do akceptacji Konrada)*
- *Pusty:* jak wyżej (to stan docelowy szkieletu).
- *Offline (brak sieci urządzenia):* baner pod AppBar (§ 5.4): „Brak zasięgu. Pracuj dalej — wyślemy wszystko, gdy wróci połączenie.”; kapsuła „Offline”; treść bez zmian. Ogłoszone raz (`aria-live="polite"`).
- *Serwer niedostępny przy sieci (API nie odpowiada / 5xx / timeout 10 s):* InlineAlert (`color.feedback.error.*`, ikona `circle-alert`, `role="alert"`) nad EmptyState: tytuł „Brak połączenia z serwerem”, treść „Nie możemy połączyć się z serwerem EVia. Spróbuj ponownie za chwilę.” + przycisk tertiary [Spróbuj ponownie] (`size.touch-target.min`); kapsuła „Offline”. Po odzyskaniu połączenia alert znika sam (bez ogłoszeń poza „Połączono z serwerem.”, toast `polite`).
- *Błąd ogólny (nieoczekiwana odpowiedź):* jak powyżej, z kodem pomocniczym „Kod: …” wg § 6.4.
- *Brak uprawnień:* nie dotyczy (brak logowania i ról w tej historyjce); wzorzec § 4.13 wejdzie w M2.

**S-02 Aktualizacja wymagana** (cel: skłonić do aktualizacji; główna akcja: brak — APK przekazuje technikom administrator, decyzja Konrada 2026-10-20, SR-MOB-07/B6). Pusty stan blokujący § 3.15.1, wariant „Aktualizacja wymagana” z M-02: pełny ekran bez BottomNav i bez dolnego paska akcji, u góry „EVia Manager”, ikona `download` `size.icon.2xl`, tytuł `text.heading-2` „Zaktualizuj aplikację”, opis `text.body` „Ta wersja aplikacji jest już nieobsługiwana. Zainstaluj nowszą wersję, aby korzystać z EVia Manager.” Zamiast przycisku i adresu pobrania wiersz `text.body` „Poproś administratora o nową wersję aplikacji.” (ekran nie otwiera żadnych adresów). Pod nim mała linia `text.body-sm` `color.text.secondary`: „Twoja wersja: 0.1.0 · Wymagana: 0.2.0”. Stany: brak „błędu otwarcia linku” i „offline” (nie ma akcji); ładowanie nie dotyczy. Dane zleceń nie są renderowane ani pobierane; systemowe „wstecz” nie omija ekranu. Od M2, gdy w Kolejce są niewysłane dane, ekran pokaże informację o oczekującej Kolejce (nic nie ginie; SyncIndicator w tym wariancie wg § 3.15.1). *(propozycja po przeglądzie UX 2026-10-21, do akceptacji Konrada)*

**Responsywność.** Jedna kolumna; telefon 360 dp i większe; EmptyState wyśrodkowany w pionie w obszarze między AppBar i BottomNav, przewijany przy powiększonej czcionce (do 200 %, bez obcinania, kapsuła skraca tekst do „Offline” → nie do samej ikony); orientacja pozioma dozwolona (dolny pasek akcji S-02 zostaje); tablet: treść w kolumnie do `size.form.max-width`.

**Tokeny i komponenty.** Wyłącznie z `@evia/tokens` i biblioteki mobilnej (AppBar, BottomNav, SyncIndicator, EmptyState, Skeleton, InlineAlert, Button); żadnych zaszytych kolorów, rozmiarów ani fontów (egzekwowane w przeglądzie). Ikony Lucide: `clipboard-list`, `cloud-check`, `wifi-off`, `circle-alert`, `download`, `list-checks`/`clock` dla „Kolejka”.

**Mikrocopy (wszystko przez i18n `pl`, klucze np. `shell.*`).** „Moje zlecenia” · „Kolejka” · „Brak zleceń” · „Zlecenia pojawią się tu po zalogowaniu i synchronizacji.” · „Połączono” · „Offline” · „Brak zasięgu. Pracuj dalej — wyślemy wszystko, gdy wróci połączenie.” · „Brak połączenia z serwerem” · „Spróbuj ponownie” · „Ładowanie trwa dłużej niż zwykle…” · „Zaktualizuj aplikację” · „Nic nie czeka na wysłanie.” Ton: krótko, czasownik w przyciskach, bez kodów w treści.

**Dostępność (WCAG 2.2 AA + Teren).** Cele dotyku ≥ 48 dp (akcje główne 56 dp); kontrast tekstu ≥ 7:1 na jasnych tłach (§ 5.3), stany niosą ikonę + etykietę, nie sam kolor; fokus: `color.focus.ring-inverse` w AppBar, `color.focus.ring` w pozostałych miejscach; BottomNav aktywna pozycja jako kapsuła + `selected`; nazwa dostępna kapsuły „Offline. Otwórz kolejkę”; tytuł ekranu jako nagłówek, po wejściu na S-02 fokus czytnika na tytule; ikony dekoracyjne ukryte; zmiany stanu połączenia ogłaszane `polite`, bez spamu (jedno ogłoszenie na zmianę); komunikaty błędów wg „co się stało + co zrobić”; komponenty testowalne po `testID`/etykietach (Maestro: „Brak zleceń”, „Zaktualizuj aplikację”).

## Bezpieczeństwo i prywatność
Klucz podpisu APK wyłącznie lokalnie u Konrada (Bitwarden + kopia offline), poza repozytorium i GitHubem; CI bez sekretów podpisu i buduje tylko niepodpisany APK (RR-21, ADR-0019 — decyzja Konrada 2026-10-20); publikacja buildów wyłącznie za zgodą Konrada.

## Notatki techniczne
Konrad pracuje na Windows 11. Konto deweloperskie Google Play — odroczone (decyzja Konrada 2026-10-20, ADR-0019: na MVP APK z CI i podpis lokalny); konto Apple Developer niepotrzebne do decyzji o iOS (ADR-0015).

Testy (AC4) wg ADR-0015: jednostkowe i komponentowe natywnie i w CI Linux; test dymny E2E — Maestro na emulatorze Androida na Windows (jedyny dowód; E2E Android w CI odłożone do warunku powrotu z ADR-0015); w CI tylko joby bez emulatora. iOS odłożony (decyzja Konrada 2026-10-03, ADR-0015): bez buildów iOS w EAS i bez testów iOS; kod pozostaje zgodny z iOS (Expo), bez zależności tylko-Android bez uzasadnienia. Raport wykonawcy zawiera wynik Maestro z wersją API emulatora.

## Plan techniczny
Skrót wykonanego planu:
- **Aplikacja** `apps/mobile` (Expo SDK 58, React Native 0.88, offline-first): ekrany S-01 „Moje zlecenia” (pusty stan, BottomNav, SyncIndicator), „Kolejka” (pusta) i S-02 „Aktualizacja wymagana”; start sprawdza zdrowie i minimalną wersję API (limit 10 s), offline/serwer niedostępny pokazują czytelne stany; teksty przez i18n `pl`, tylko tokeny `@evia/tokens`; bezpieczny magazyn na tokeny przygotowany (bez logowania); tylko HTTPS (wyjątek HTTP do hosta emulatora wyłącznie w wariancie e2e).
- **Testy:** jednostkowe i komponentowe (Jest) z progami pokrycia w `packages/config`; test dymny Maestro 2.11.0 na emulatorze `Medium_Phone_API_35` przez `tools/mobile-e2e` (6 przepływów w `apps/mobile/e2e`, serwer scenariuszy o kształcie `/api/health`).
- **Build i dystrybucja (ADR-0019, zaakceptowana 2026-10-21):** job CI `mobile-apk` buduje niepodpisany APK jako artefakt (bez sekretów); `tools/mobile-apk` — weryfikacja paczki (uprawnienia, brak sekretów, HTTPS) i podpis lokalny (`apksigner` + `zipalign`, klucz poza repozytorium, hasła tylko ze zmiennych środowiska); runbook `docs/ops/dystrybucja-apk-android.md`; `tools/ci-changes` i `tools/repo-policy` pilnują zakresu zmian i reguł workflow.
- **Środowisko:** `compose.dev.yaml` — minimalna wersja aplikacji 0.1.0, żeby lokalne API nie blokowało wersji 0.1.0.

Notatka (2026-10-21, dowód AC4): test dymny Maestro przebiegł zielono (6/6 przepływów; emulator sdk_gphone64_x86_64, Android 15, API 35; Maestro 2.11.0; wersja aplikacji 0.1.0) na maszynie z LongPathsEnabled=0 i bez administratora — droga A z runbooka (krótki klon, nodeLinker: hoisted, EVIA_E2E_SHORT_PATHS=1). Pierwszy prawdziwy przebieg ujawnił cztery błędy narzędzia, nie aplikacji ani przepływów: (1) nazwy obiektów CMake i tak przekraczały limit — skrypt inicjujący Gradle z CMAKE_OBJECT_PATH_MAX=250; (2) serwer scenariuszy w wątku głównym nie odpowiadał, gdy runner czekał na Maestro (spawnSync) — przeniesiony do wątku roboczego; (3) świeży emulator zgłasza sys.boot_completed przed usługą pakietów — dodane czekanie na pm path; (4) pierwsze połączenie Maestro ze świeżym emulatorem może się nie udać — jedna powtórka pierwszego przepływu, jawnie raportowana (tabela: `passed (retried)`, linia `- Retried flows: …`; wynik pozostaje zielony).

Powtórzony przebieg po przeglądzie (2026-10-21, `--skip-build`, emulator API 35, Maestro 2.11.0, aplikacja 0.1.0): 6 passed, 0 failed, 0 skipped; `- Retried flows: none`; 5 żądań do serwera scenariuszy z nagłówkami zgodności; logcat 5 linii, 0 z adresem i 0 z hasłem.

Przebieg końcowy (2026-10-21, pełny build — prebuild z sumą `distributionSha256Sum` Gradle i allow-listą środowiska, emulator API 35, Maestro 2.11.0, aplikacja 0.1.0): 7 passed (siódmy przepływ: stan ładowania), 0 failed, 0 skipped; `- Retried flows: none`; 13 zrzutów do przeglądu UX w `docs/ux/reviews/EVM-009/` (PNG poza gitem).

## Decyzje
- **2026-10-20 (Konrad):** na MVP bez konta Google Play i bez EAS — dystrybucja APK jako artefakt CI (sideload); Play/EAS Submit odroczone do wydania szerszego. `solution-architect` dopisuje notkę do ADR-0007/0012 (zakres: dystrybucja Androida) do akceptacji Konrada. AC2 na lokalnym API, nie na staging. Maestro CLI 2.11.0 zainstalowane lokalnie (`%USERPROFILE%\.evia\tools\maestro-2.11.0`, suma SHA-256 zweryfikowana); emulator `Medium_Phone_API_35`.
- Ścieżka `pelna`, model `sonnet` (Konrad 2026-10-20).
- **2026-10-20 (Konrad), po raporcie wykonawcy:** (1) **Podpis lokalny** zamiast sekretów GitHuba (RR-21; utrata klucza bez Google Play nieodwracalna): usunąć job `mobile-sign` i cztery sekrety; CI buduje niepodpisany APK; skrypt podpisu lokalnego w `tools/mobile-apk`; klucz w Bitwarden Konrada; runbook `docs/ops/dystrybucja-apk-android.md` do przepisania; wyjątek od K7 niepotrzebny. (2) **Długie ścieżki Windows:** najpierw bez admina (krótki dysk przez `subst`, CMake 3.31.6 przez `EVIA_ANDROID_CMAKE_VERSION`, krótszy katalog builda); rejestr (`LongPathsEnabled`) i restart dopiero rano, gdy to nie wystarczy; obraz Docker z Android SDK odrzucony na razie. (3) **Identyfikator aplikacji `pl.eviacharge.manager`** potwierdzony; APK przekazuje technikom administrator (USB/plik), ekran aktualizacji bez przycisku pobrania (SR-MOB-07/B6); `EVIA_API_BASE_URL` ustawi Konrad po EVM-007. (4) **`compose.dev.yaml`:** `MIN_SUPPORTED_APP_VERSION_*` z 1.0.0 na 0.1.0 — zgoda; test dymny Maestro na serwerze scenariuszy o kształcie `/api/health` z kontraktu — zgoda na odchylenie od decyzji o kontenerowym API. (5) Znalezisko poza zakresem: OSV GHSA-587h-7wmj-h5pm (vite@8.3.2, apps/web) — osobna historyjka lub Renovate. Fonty Inter/Exo 2 w aplikacji — decyzja UX poza tą historyjką.

## Notatki (uwagi nieblokujące z przeglądów)
- Bezpieczeństwo: znane podatności w tranzytywnych zależnościach narzędzi build/test dodanych przez gałąź — node-forge@1.4.0 (GHSA-86w9-cpqp-85rv; `@expo/cli`, `@expo/code-signing-certificates`), braces@3.0.3 (GHSA-vfj7-8cjw-p6xm; `micromatch` ← `@jest/transform`, `metro-file-map`), sprintf-js@1.0.3 (GHSA-hp3w-g68c-fv3c; `argparse` ← `js-yaml@3` ← `babel-plugin-istanbul`); tylko narzędzia build/test, nie APK ani API; OSV nie podaje wersji naprawionej; Renovate wyłączony (RR-21 Q1), obserwujemy Dependabot i OSV; bez poprawki do 2027-01-19 → historyjka w backlogu.
- Narzędzia i CI: wykrycie adresu zastępczego API w `tools/mobile-apk sign` jest „fail-open” (dopasowanie tekstu w pakiecie JS) — zostają ostrzeżenie w podsumowaniu CI i runbook; po zmianie wersji Gradle w szablonie Expo prebuild celowo padnie do aktualizacji `distributionSha256Sum` w `with-hardening.ts`; `verify`/`digest` z allow-listą środowiska potwierdzi dopiero przebieg CI; backlog po końcowym przeglądzie security (APPROVE, minor): `JAVA_HOME`/`ANDROID_HOME` w `sign` tylko jako ścieżki bezwzględne, `verify` bez `JAVA_HOME` używa gołego `java`, nazwa zmiennej hasła nie może pokrywać się z listą dozwolonych, po podpisie `zipalign -c -P 16` (kontrola wyrównania 16 KB), `gradle-wrapper.jar` z szablonu bez weryfikacji.
- UX (re-review APPROVE): AppBar przy tekście 200% zawija tytuł do 2 linii (opcjonalnie `paddingVertical`); tekst „Spróbuj ponownie” ok. 14 dp na prawo od treści alertu; kontrast tertiary na tle błędu ok. 6,2:1 wobec celu „Teren” 7:1 — pytanie otwarte w styleguide'zie (1.3.0).
- Proces: test dymny powtarza raz pierwszy przepływ (instalacja sterownika Maestro na świeżym emulatorze), jawnie w raporcie; jednorazowy klon `C:\e` (ok. 1,6 GB) do sprzątnięcia po kolejce; commit f6da7c5 zawiera też zmiany `docs/security` (wspólny indeks agentów) — opisać w PR.
- Scalanie: `threat-model.md`, `requirements.md`, `CHANGELOG.md` i `pnpm-lock.yaml` zmienia także gałąź EVM-026/028 (RR-28…31) — przy scalaniu drugiej z gałęzi spodziewane konflikty tekstowe (numeracja RR-32 jest celowo osobna).

## Uwagi do rozważenia
- Poza zakresem EVM-009 (zapis, decyzja Konrada 2026-10-20): podatność OSV GHSA-587h-7wmj-h5pm (vite@8.3.2 w `apps/web`) — osobna historyjka albo Renovate (2026-10-21: naprawione wspólnym commitem z bumpem vite 8.3.4 w gałęziach obu kolejek, decyzja Konrada, commit 2e31e66); fonty Inter/Exo 2 w aplikacji — decyzja UX poza tą historyjką.
- ADR-0019 (APK z CI + podpis lokalny, Play/EAS Submit odroczone) jest **zaakceptowana (Konrad, 2026-10-21)**; ADR-0007 i ADR-0012 bez zmiany statusu (tylko linia w „Powiązane”). W `threat-model.md` nowe RR-32 (podpis lokalny i utrata klucza) zaakceptowane; numer RR może wymagać zmiany przy scaleniu z gałęzią EVM-026 (używa RR-28…31).
- Maestro na emulatorze: dowód 6/6 z 2026-10-21 bez administratora i bez zmiany rejestru (droga A: krótki klon, `nodeLinker: hoisted`, `EVIA_E2E_SHORT_PATHS=1`); droga B (`LongPathsEnabled=1` jako administrator + restart) zostaje opcją — opis w `docs/ops/dystrybucja-apk-android.md`.

## Definition of Done
- [x] AC1–AC4, AC6 pokryte testami (`EVM-009 AC#`); AC4 E2E: Maestro 7/7 na emulatorze API 35 (2026-10-21)
- [ ] AC5 zweryfikowane ręcznie przez Konrada: APK z CI (job `mobile-apk` buduje artefakt po scaleniu do `main`) → podpis lokalny → instalacja na min. 1 telefonie Android
- [x] Przeglądy: code-reviewer, ux-designer, security-engineer — APPROVE
- [x] `CHANGELOG.md` zaktualizowany
- [x] Demo i akceptacja Konrada (2026-10-21; w tym akceptacja ADR-0019 i propozycji styleguide'u 1.3.0)

## Dziennik
- 2026-10-02 — utworzono (setup zespołu)
- 2026-10-02 — draft → ready: AC zaakceptowane przez Konrada (akceptacja planu M0)
- 2026-10-03 — zmiana AC — do potwierdzenia przez Konrada: AC5 tylko Android (iOS odłożony, decyzja Konrada 2026-10-03, ADR-0015); iOS dopisany do „Poza zakresem”; „Notatki techniczne” wg ADR-0015 (product-owner)
- 2026-10-03 — zmiana AC (iOS odłożony, ADR-0015) potwierdzona przez Konrada; status bez zmian: ready
- 2026-10-20 — zmiana AC zaakceptowana przez Konrada: AC2 (lokalne API), AC5 (APK z CI jako artefakt, bez Google Play/EAS); `path: pelna`, `model: sonnet`
- 2026-10-20 — ready → in-progress: start realizacji (kolejka B: EVM-009 → EVM-011, gałąź feature/EVM-009-011-aplikacja-mobilna, pelna, sonnet)
- 2026-10-20 — plan gotowy (mobile-developer)
- 2026-10-20 — implementacja (mobile-developer): `apps/mobile` (Expo SDK 58, offline-first, S-01/„Kolejka”/S-02), `tools/mobile-e2e` (Maestro) i `tools/mobile-apk` (weryfikacja APK), joby CI `mobile-apk` i `mobile-sign`, testy `EVM-009 AC#`; dowód Maestro na emulatorze wstrzymany — natywny build na Windows wymaga długich ścieżek (`docs/ops/dystrybucja-apk-android.md`)
- 2026-10-20 — workflow „blocked” po implementacji (mobile-developer; 7 commitów; Maestro na APK zablokowane limitem ścieżek Windows); decyzje Konrada 2026-10-20 (podpis lokalny, ścieżki bez admina, id aplikacji, dostawa APK, compose.dev.yaml) zapisane w „Decyzjach”; kolejny przebieg: poprawki wg decyzji, Maestro, QA i przeglądy
- 2026-10-20 — plan gotowy (mobile-developer)
- 2026-10-21 — przebieg 2 (mobile-developer): podpis lokalny `tools/mobile-apk sign` (testy na atrapie), usunięty job `mobile-sign` i sekrety, reguła `secrets.` tylko w renovate.yml, runbook i dokumenty ops/security, ADR-0019 (proponowana), compose.dev.yaml minimum 0.1.0; build APK lokalnie zablokowany limitem ścieżek Windows (Maestro nieuruchomiony)
- 2026-10-21 — dowód AC4 (mobile-developer): Maestro 6/6 zielone na emulatorze API 35 bez administratora (droga A, krótki klon C:\e z nodeLinker: hoisted); poprawki tools/mobile-e2e: EVIA_E2E_SHORT_PATHS, skrypt inicjujący Gradle (CMAKE_OBJECT_PATH_MAX), serwer scenariuszy w wątku roboczym, gotowość usługi pakietów, powtórka pierwszego przepływu; runbook: droga A i B, próba #4
- 2026-10-21 — poprawki po przeglądzie (mobile-developer): jawne raportowanie powtórki pierwszego przepływu (`attempts`, `passed (retried)`, `Retried flows`), twardsze zamykanie serwera scenariuszy w wątku (worker, który padł; `requests()` po `close()`), krok budowy tokens/contracts w komunikacie preflightu; powtórzony test dymny 6/6, bez powtórek
- 2026-10-21 — zrzuty do przeglądu UX (mobile-developer): przepływy Maestro robią zrzuty (S-01 online/offline/serwer niedostępny/ładowanie/po powrocie sieci, „Kolejka”, S-02), runner zbiera je do `.scratch/mobile-e2e/screenshots/` i `docs/ux/reviews/EVM-009/` (PNG poza gitem); nowy przepływ `07-loading` (tryb `hang` serwera scenariuszy)
- 2026-10-21 — utwardzenie narzędzi podpisu lokalnego po przeglądach (mobile-developer): allow-lista środowiska procesów potomnych i hasła tylko dla `apksigner sign`, bezwzględne ścieżki `git` i `java`, jawne `--v4-signing-enabled false`, czytelne błędy `zipalign` (build-tools ≥ 35) i `git`, odmowa podpisu paczki z adresem zastępczym API i ostrzeżenie w podsumowaniu CI, `.nvmrc`/`.npmrc` na liście `mobile`, przypięta suma SHA-256 Gradle; `tools/mobile-apk` 82/82 testów, gałęzie 96,3%
- 2026-10-21 — dokumenty bezpieczeństwa uzgodnione z ADR-0019 (security-engineer): `rodo.md` (Expo/EAS i Google Play odroczone w MVP), `threat-model.md` (A-07, RR-21, RR-12), `requirements.md` (SR-CRYPTO-04), `policies.md` (P7); weszły do commita f6da7c5 razem z narzędziami (wspólny indeks agentów)
- 2026-10-21 — przegląd UX zrzutów z emulatora (ux-designer): CHANGES_REQUIRED (blocker: aktywna pozycja „Kolejka” w BottomNav jako prostokąt zamiast kapsuły); poprawki specyfikacji (ładowanie, S-02, reguła kapsuły SyncIndicator) zapisane jako propozycje do akceptacji Konrada (03b0370)
- 2026-10-21 — poprawki po przeglądzie UX (mobile-developer, 9637c63): kapsuła BottomNav przycięta `overflow: 'hidden'`, komunikat ładowania jako `aria-live polite`, „Spróbuj ponownie” przy lewej krawędzi alertu, tytuł InlineAlert jako `heading4`, sprawdzenie tekstu 200%; test dymny 7/7 z pełnym buildem; re-review ux-designer: APPROVE
- 2026-10-21 — weryfikacja orkiestratora: `pnpm run gate` zielony w jednym przebiegu na HEAD 9637c63 (+ dokumenty): etap natywny 56 zadań, parytet Linux 17 zadań, testy integracyjne 130 plików / 1835 testów, `coverage:diff` — zmieniony kod: linie 98,9% (2324/2350), gałęzie 95,5% (937/981); `docs:check` 0 błędów; Maestro 7/7 na emulatorze API 35 (pełny build, `Retried flows: none`, raport z 04:55 w C:/e/.scratch/mobile-e2e); przeglądy: code-reviewer APPROVE (delta runnera), ux-designer APPROVE (zrzuty), security-engineer APPROVE
- 2026-10-21 — in-progress → in-review: AC1–AC4 i AC6 zweryfikowane; AC5 (APK z CI po scaleniu do `main`, podpis lokalny, instalacja na telefonie), akceptacja ADR-0019 i propozycji styleguide'u 1.3.0 czekają na Konrada; EVM-011 (spike) startuje na tej samej gałęzi
- 2026-10-21 — końcowy przegląd security utwardzenia narzędzia podpisu (security-engineer): APPROVE (0 blocker/major, 5 minor do backlogu — zob. „Notatki”); runbook: hasło keystore bez echa (zamiast gołego Read-Host); Konrad może podpisać pierwszy APK z artefaktu zielonego przebiegu na main, z przypiętym odciskiem certyfikatu
- 2026-10-21 — CI PR #87 (b646803): czerwone `quality` (pierwszy test `app.test.tsx` > 5 s na zimnym cache Babel), `backend` (bramka 4: 57 opcjonalnych pakietów Expo bez licencji w Trivy) i `security` (OSV `vite@8.3.2` z `main` — znane); job `mobile-apk` zielony po raz pierwszy na Linuksie (artefakt `mobile-apk-unsigned` 15,6 MB, ok. 9 min). Poprawki: `testTimeout` 30 s w `apps/mobile/jest.config.mjs` (841e6c3); bramka licencji — 57 wpisów w `tools/scan/platform-licenses.json` (licencje MIT i MPL-2.0 sprawdzone w rejestrze npm, ważne do 2027-01-19) i rozszerzenie wyjątku tylko na pakiety osiągalne wyłącznie z pakietów platformowych (37305c0, fea00b4, 3f9afaa; security-engineer: APPROVE po 2 rundach, wcześniej CHANGES_REQUIRED za zbyt szeroki wyjątek); `@noxcturnal/*` (zależność `@expo/metro-config`) to młody pakiet z jednym opiekunem i bez provenance — do obserwacji przy aktualizacjach. Lekcja: przy historyjce z nowymi zależnościami uruchom lokalnie `pnpm run scan` (min. `licenses`) przed pushem
- 2026-10-21 — Koszt kolejki B (EVM-009 + EVM-011): brak rozbicia w dolarach (nie odczytane z /usage; do uzupełnienia z /cost); subagenci workflow w zachowanych licznikach ok. 3,3 mln tokenów (EVM-009: przebieg 1 — 1,07 mln, przebieg 2 — 0,77 mln, przebieg przerwany limitem sesji ok. 0,26 mln; EVM-011: 1,20 mln, 11 agentów, 435 wywołań narzędzi), plus agenci z narzędzia Agent poza workflow (zrzuty i przeglądy UX, przeglądy i utwardzenie security, poprawki, bramka licencji — devops 3 przebiegi, security 2 przeglądy, mobile-developer poprawki) bez zbiorczych liczników; rundy poprawek: EVM-009 2 w workflow plus poprawki po przeglądach UX i security, EVM-011 1 (runda 1: 5 blokujących, runda 2: 0); ścieżka pelna; sonnet; pliki historyjek 24,5 KB (EVM-009) i 5,6 KB (EVM-011) przed uzupełnieniem; vs baseline: brak danych
- 2026-10-21 — demo zaakceptowane przez Konrada (kolejka B): ADR-0019, RR-32 i propozycje styleguide'u 1.3.0 z EVM-009 zaakceptowane; bump vite 8.3.2 → 8.3.4 (2e31e66) jako wspólny commit z kolejką A (decyzja Konrada); PR #87; AC5 (APK z CI po scaleniu do `main`, podpis lokalny, telefon) czeka na Konrada
- 2026-10-27 — status done: demo zaakceptowane 2026-10-21, PR scalony; Konrad potwierdził akceptację przy planie M2 (Tech Lead)
