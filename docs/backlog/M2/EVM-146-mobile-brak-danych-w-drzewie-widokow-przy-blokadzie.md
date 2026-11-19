---
id: EVM-146
title: "Aplikacja: pod nakładką blokady nie ma danych zleceń w drzewie widoków"
type: story
milestone: M2
epic: E9 Dostęp mobilny
status: in-progress
priority: P2
path: pelna             # dane na urządzeniu, bezpieczeństwo aplikacji mobilnej (SR-MOB-03/05/06/08); zmiana wspólnej powłoki ekranów, ryzyko utraty niezapisanych danych
owner: mobile-developer
contributors: []
reviewers: [security-engineer, ux-designer, code-reviewer]
model: sonnet
depends_on: [EVM-101]
---

# EVM-146: Aplikacja — pod nakładką blokady nie ma danych zleceń w drzewie widoków

> **Szkic do akceptacji przez Konrada (2026-11-18).** Z przeglądu security poprawki blokady (PR #150, dziennik EVM-101): rekomendacja „osobna historyjka przed szerszym wdrożeniem dla techników”.

## Cel
Jako **właściciel firmy** chcę, aby **zablokowana aplikacja nie zawierała danych zleceń i klientów w żadnej postaci odczytywalnej z telefonu**, a **technik po odblokowaniu wracał dokładnie tam, gdzie był, bez utraty wpisanych danych**, aby **zgubiony lub pożyczony telefon nie ujawniał klientów nawet przy użyciu adb albo usługi dostępności**.

## Kontekst
- Dziś (`apps/mobile/src/screens/LockOverlay.tsx`, `LockGate`) nakładka „Aplikacja zablokowana” zasłania ekran, blokuje dotyk i czytnik ekranu, `FLAG_SECURE` blokuje zrzuty, ale **treść pod nakładką jest nadal wyrenderowana** — odczytuje ją `adb` (zrzut hierarchii) albo usługa dostępności z flagą widoków „nieistotnych”.
- Blokada zakłada się po 5 min w tle (EVM-101) i jest **bramką interfejsu**, nie szyfruje danych (SR-MOB-03); baza SQLCipher nie jest tu zmieniana.
- **Tryb ukrytych danych już istnieje** (`hidden-mode.ts`, EVM-101): ekrany zlecenia i listy w tym stanie nie renderują danych osobowych (`HiddenDataNotice`), a aparat i Kolejka działają. To naturalny kandydat do ponownego użycia dla blokady, ale **zamontowanie ekranu od nowa gubi jego stan lokalny** (wpisane pola) — to główne ryzyko tej historyjki.
- Wymagania: SR-MOB-03, SR-MOB-05, SR-MOB-06, SR-MOB-08 (`docs/security/requirements.md`); ryzyko dopisać obok TM-04 w `docs/security/threat-model.md` (security-engineer).

## Kryteria akceptacji

**AC1 — Zablokowana aplikacja nie ma danych w drzewie widoków**
- Zakładając zalogowanego Administratora lub Edytora z otwartym zleceniem, listą zleceń albo formularzem
- Gdy aplikacja przechodzi w stan zablokowany (po 5 min w tle albo start aplikacji)
- Wtedy w hierarchii widoków — także widoków „nieistotnych dla dostępności” — nie ma numeru zlecenia, nazwy klienta, adresu, telefonu, opisu, nazw plików ani wpisanych wartości pól; zostaje tylko nakładka „Aplikacja zablokowana” z przyciskiem „Odblokuj”; test na emulatorze zrzuca drzewo poleceniem `adb shell uiautomator dump` w trybie bez kompresji (z widokami nieistotnymi dla dostępności; widok hierarchii Maestro nie wystarcza) i sprawdza brak syntetycznych wartości kontrolnych (numer zlecenia, nazwa klienta, adres, telefon, opis, nazwa pliku, wartość pola) w `text`, `content-desc`, `hint` i `resource-id`; test jest najpierw czerwony na kodzie sprzed tej historyjki, co dowodzi, że wykrywa wyciek.

**AC2 — Po odblokowaniu użytkownik wraca tam, gdzie był**
- Zakładając wcześniej otwarty ekran (lista, szczegóły zlecenia, formularz wpisu, szybkie zlecenie, wizja lokalna) i dane wpisane, a niezapisane
- Gdy odblokowuję aplikację
- Wtedy widzę ten sam ekran i to samo zlecenie, a wpisane dane (formularze, wybrane kategorie, opisy) są zachowane bez ponownego wpisywania; dane niezapisane nie trafiają na dysk poza dotychczasowymi mechanizmami (pamięć procesu), a utrata ich po zabiciu aplikacji przez system jest zgodna z dzisiejszym zachowaniem.

**AC3 — Wysyłanie plików w tle nie zatrzymuje się**
- Zakładając pliki w kolejce telefonu i zablokowaną aplikację
- Gdy blokada trwa
- Wtedy wysyłanie i synchronizacja działają dalej (usługa w tle, bez interfejsu), a po odblokowaniu liczniki i stany plików w Kolejce odpowiadają rzeczywistości; w trakcie blokady żadne dane zleceń nie trafiają do powiadomień ani do drzewa widoków; zdjęcie lub film w toku nagrywania nie są tracone przez samą blokadę.

**AC4 — Przypadki negatywne**
- Zakładając anulowane, nieudane albo ponawiane odblokowanie, restart aplikacji, `session_revoked`, wylogowanie albo brak blokady ekranu urządzenia
- Gdy te zdarzenia zachodzą
- Wtedy dane nadal nie pojawiają się w drzewie przed udanym odblokowaniem; start aplikacji zawsze zaczyna od blokady bez danych; po wylogowaniu i „Wyczyść dane firmowe” żadne wpisane dane nie zostają w pamięci; zachowanie bez blokady ekranu urządzenia (dane ukryte trybem EVM-101) i przy wygasłym kontakcie z serwerem (7 dni) bez zmian.

**AC5 — Zachowania dotychczasowe bez regresji**
- Zakładając istniejące poprawki blokady (EVM-101 AC3) i czytnik ekranu
- Gdy blokuję i odblokowuję aplikację (biometria / kod, powrót z tła, dwa szybkie naciśnięcia „Odblokuj”)
- Wtedy okno systemowe odblokowania pojawia się jak dotąd, nakładka pozostaje jedynym elementem dla czytnika ekranu, `FLAG_SECURE` i brak ogłoszeń o danych zostają; wydajność: ekran zlecenia wraca w czasie porównywalnym z dzisiejszym (bez widocznego „migania” danych przy zdejmowaniu nakładki).

**AC6 — Dowód i dokumentacja ryzyka**
- Zakładając zakończoną implementację
- Gdy kończymy historyjkę
- Wtedy jest test automatyczny drzewa widoków (AC1) w bramce emulatora, test zachowania formularzy (AC2) i zapis w `docs/security/requirements.md` / `threat-model.md` (rozszerzenie SR-MOB-08 z odwołaniem w SR-MOB-03, uzupełnienie TM-04 o odczyt drzewa widoków przy zablokowanej aplikacji i ryzyko rezydualne) wykonany przez security-engineera.

## Poza zakresem
- Szyfrowanie bazy kluczem zależnym od blokady (SR-MOB-03 zostaje bramką UI), skracanie 5 min, blokada po bezczynności na pierwszym planie.
- Zapis szkiców formularzy na dysku (przetrwanie zabicia aplikacji) — osobna decyzja (pytanie 2).
- Nowe uprawnienia, zależności i zmiany API; ukrywanie danych w powiadomieniach (brak takich).

## Decyzje i ograniczenia
- Sposób techniczny (ponowne użycie trybu ukrytych danych z zachowaniem stanu pól, np. stan formularzy poza usuwanymi widokami, albo inny) wybiera wykonawca po **konsultacji architekta** (wąskie pytanie niżej); AC opisują efekt.
- **Bezpieczeństwo i prywatność (konsultacja security, skrót; 2026-11-18):** model zagrożenia — odczyt drzewa widoków zablokowanej aplikacji przez autoryzowane adb (`uiautomator dump`) albo usługę dostępności; dotyczy telefonu pożyczonego, odblokowanego systemowo albo z malware, **nie** telefonu zgubionego z blokadą ekranu (SR-MOB-06). Kontrola obejmuje tylko stan zablokowany — usługa dostępności czyta dane także przy odblokowanej aplikacji, więc to redukcja ryzyka, nie bariera (ocena 2×2 = Medium, jak TM-04). Poza zakresem zostają zrootowany telefon, zrzut pamięci procesu (klucz bazy i dane w pamięci, synchronizacja w tle) i kompilacja debug; ryzyko rezydualne (Low) czeka na akceptację właściciela (pytanie 4). Zapis: rozszerzenie SR-MOB-08 (MASVS-PLATFORM-3) z odwołaniem w SR-MOB-03 oraz uzupełnienie TM-04. Termin: przed drugim telefonem lub technikiem; nie blokuje testu na telefonie Konrada.
- **UX:** zdjęcie nakładki nie może pokazywać na ułamek sekundy danych ani „migać” — ux-designer potwierdza przejście.

## Decyzje Konrada (2026-11-18: przyjęte wszystkie rekomendacje poniżej)
1. **Czy to ma być zrobione przed drugim telefonem lub technikiem, z priorytetem P2?** Rekomendacja: **tak** (security: ryzyko Medium; test na Twoim telefonie tego nie wymaga, przy kilku technikach ryzyko rośnie). Konsekwencja „później”: znane ryzyko odczytu danych z zablokowanej aplikacji na pożyczonym lub zainfekowanym telefonie zostaje do zamknięcia.
2. **Niezapisane dane formularza: wystarczy pamięć aplikacji (znikają, gdy system ubije aplikację w tle)?** Rekomendacja: **tak** — tak jest dziś i nie dokładamy danych klienta na dysk. Konsekwencja „zapisuj na dysku”: nowy szyfrowany magazyn szkiców, więcej kodu i przeglądów (osobna historyjka).
3. **Kolejność względem EVM-142 (podgląd zdjęć)?** Rekomendacja: **EVM-146 przed EVM-142** — obie zmieniają wspólną powłokę aplikacji, więc ta kolejność oszczędza konfliktów (względy bezpieczeństwa są tu drugorzędne: pikseli zdjęć nie ma w drzewie widoków, a EVM-142 i tak musi znikać z drzewa przy blokadzie — AC5 tam).
4. **Czy akceptujesz ryzyko rezydualne po tej historyjce (zrootowany telefon, zrzut pamięci, kompilacja debug)?** Rekomendacja: **tak** — to standardowa granica dla blokady będącej bramką ekranu; pełna ochrona wymagałaby szyfrowania bazy kluczem zależnym od blokady (poza zakresem, dużo większa praca).

## Notatki
- Rozważany wariant: dane pozostają w pamięci, ale widoki z nimi są wycofywane z drzewa (nie tylko niewidoczne) — sprawdzić, czy wystarcza ukrycie przez zamianę zawartości na neutralne etykiety (decyzja wykonawcy z architektem).

- Z konsultacji security (Low): test AC1 próbkować wielokrotnie podczas wznowienia z tła po > 5 min (decyzja o blokadzie przed pierwszym renderem treści); szkice formularzy w pamięci kasować przy każdym zakończeniu sesji (wylogowanie, `session_revoked`, „Wyczyść dane firmowe”, zmiana właściciela instalacji), zachować tylko przy zwykłej blokadzie; hipoteza do sprawdzenia testem AC1: `<Activity mode="hidden">` z React 19 zachowuje stan bez odmontowania; `testID` z identyfikatorami zleceń są widoczne jako `resource-id` — sprawdzić build release i to, że hooki e2e do niego nie trafiają; pasek aparatu pod nakładką bez numeru zlecenia. Recenzenta ux-designer można zastąpić jednym pytaniem na demo („czy przy zdejmowaniu nakładki nic nie miga”).

- Wykonanie (etap 2, 2026-11-19): technika = `<Activity mode="hidden">` w `LockGate` (widoki wycofane z drzewa, stan w pamięci zachowany; efekty ekranów są sprzątane i uruchamiane od nowa po odblokowaniu). Hak e2e `unlockHeld` żyje wyłącznie w panelu haków (`e2e-hooks/panel.tsx`) i w `DeviceOverrides`, które resolver Metro (`plugins/e2e-hooks-resolver.ts`, testy EVM-093 AC1: wydanie i każdy inny wariant = pusty slot, fail closed) podmienia tylko w wariancie e2e — w wydaniu go nie ma. `testID` z identyfikatorami zleceń przy ODBLOKOWANEJ aplikacji (widoczne jako `resource-id`) są poza zakresem tej historyjki; przy zablokowanej aplikacji ich nie ma (drzewo bez widoków treści).
- Dowód `hint`: zrzut `uiautomator dump` przy ODBLOKOWANEJ aplikacji (emulator, przebieg s2-lock-b, krok `view-tree-unlocked`) podaje placeholdery pól ("Nie wpisuj PESEL…", "Szukaj: adres, nazwisko, numer") w atrybucie `text`, nie `hint` — kontrola dodatnia znalazła 10 z 12 wartości kontrolnych (239 węzłów); dla zablokowanej aplikacji sprawdzane są mimo to wszystkie cztery atrybuty (`text`, `content-desc`, `hint`, `resource-id`), 19 węzłów, zero wartości.
- Skutki `Activity` poprawione w kodzie: `CameraScreen` (`useForeground` czyta stan aplikacji z `guard.appState` przy każdej subskrypcji — zdarzenie `active` zgubione pod nakładką nie zostawia ciemnego podglądu) i `useAllSentAnnouncement` (pierwsze uruchomienie efektu po odblokowaniu przejmuje stan, nie ogłasza „Wszystko wysłane” za pliki potwierdzone w trakcie blokady). Zostawione bez zmian: ogłoszenie liczby plików w `OrderFilesScreen` po odblokowaniu (sama liczba, bez danych zlecenia) i ponowne odczytanie listy / szczegółów zleceń przy odblokowaniu (świeży stan z bazy lokalnej). Trzeci skutek `Activity` (wykryty przez emulator, przebieg s2-lock-b): sprzątanie efektu w `Shell` zamykało prośbę o aparat przy każdej blokadzie — zamykanie przeniesione do `SessionRoot` (kończy się z sesją, nie z blokadą), test Jest `EVM-146 AC2` w `camera-entries.test.tsx`. Notyfikacja wysyłki: cel startu („Kolejka”) jest odczytywany dopiero po odblokowaniu (zaktualizowana asercja w `queue-files.test.tsx`; Kolejka i tak otwiera się po odblokowaniu). W `apps/mobile/src` nie ma `<Modal` ani innego natywnego okna poza drzewem.

- Pomiar na emulatorze (2026-11-19, runda poprawek): `Activity hidden` NIE usuwa natywnych widoków treści z hierarchii okna — `dumpsys activity top` pokazuje przy blokadzie 162 widoki React (przy odblokowaniu 160), z czego widocznych (z wszystkimi przodkami) 9 (nakładka; odblokowana: 160) i 0 `ReactEditText` widocznych (odblokowana: 2 z 2). Treść wisi pod JEDNYM niewidocznym rodzicem (flaga `I`, rozmiar 0), więc `uiautomator` i usługi dostępności jej nie widzą — to jest mechanizm ochrony, nie fizyczne usunięcie widoków. Zapisy w `docs/security/*` i ADR mówiące o „wycofaniu z drzewa” warto doprecyzować (poza zakresem rundy). Progi kroku: zablokowana ≤ 25 widocznych widoków React i 0 widocznych `ReactEditText`; odblokowana ≥ 100 i ≥ 1.
- Pomiar kamery (S2): pod nakładką (blokada przytrzymana, aparat otwarty przed Home) `dumpsys media.camera` pokazywał aplikację jako aktywnego klienta kamery przez ponad 20 s (CONNECT po powrocie z tła). Przyczyna: właściwość `active` widoku `expo-camera` działa tylko na iOS, a ukryty `Activity` nie renderuje się ponownie do odblokowania (test: zmiana magazynu w ukrytym drzewie nie wywołuje renderu), więc nic nie wyłączało kamery. Poprawka: sprzątanie efektu LAYOUT w `CameraCapture` wywołuje `pausePreview()` (efekt zwykły nie wystarcza: ukrycie odpina ref widoku biblioteki przed nim i pierwsza próba na emulatorze nadal pokazywała klienta), ponowne uruchomienie — `resumePreview()`; przy trwającym nagraniu kamera zostaje podłączona do odblokowania (odpięcie mogłoby uciąć plik). Krok emulatora `camera-client-absent` (przebieg f3) potwierdza zwolnienie kamery pod nakładką, `camera-client-present` — że kontrola widzi klienta przy otwartym aparacie.
- Przyciski Wstecz (M2): kolejność rejestracji po odblokowaniu to dzieci → rodzic; potwierdzone dla `Shell` względem formularza i aparatu (test czerwony). NIE potwierdziło się dla dialogów `AlertDialog` (inline `onCancel` rejestruje je od nowa przy każdym renderze formularza) ani dla nakładki pomocy w `SessionRoot` (efekt poza `Activity`, rejestruje się po dzieciach) — kodu tam nie zmieniano.
- m4: nie potwierdziło się powtórzenie ogłoszenia liczby wyników w `OrdersScreen` (stan `announced` jest ten sam, więc ponowne ustawienie nic nie zmienia; ewentualne ponowne odczytanie żywego regionu przez TalkBack po odsłonięciu widoku da się sprawdzić tylko na urządzeniu).

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner) na podstawie ustalenia security z przeglądu poprawki blokady (EVM-101, PR #150)
- 2026-11-18 — naniesiono konsultację security (Tech Lead): test AC1 zaostrzony (`uiautomator dump`, najpierw czerwony), zapis wymagań w AC6 wskazany, priorytet P1 → P2 z terminem „przed drugim technikiem”, pytanie 4 o ryzyko rezydualne; status `draft`
- 2026-11-18 — Konrad: „Akceptuję rekomendacje” — wszystkie pytania rozstrzygnięte wg rekomendacji; status `ready` (Tech Lead)
- 2026-11-19 — status `in-progress`; etap 2 (mobile-developer): `LockGate` na `Activity` (zamiast spike'u), testy Jest AC1–AC4 (`lock-view-tree.test.tsx`, aparat, „Wszystko wysłane”), kroki emulatora `view-tree-unlocked` / `view-tree-resume`, scenariusze `lock-*`
- 2026-11-19 — runda poprawek po przeglądach (mobile-developer): B1 (`useSettled` — wynik zapisu pod nakładką czeka na ponowne uruchomienie efektów, formularze nie wiszą w „zapisywanie”), M2 (`Shell` ustępuje przyciskowi Wstecz, gdy nad nim jest formularz / aparat / dialog), m3 (kontrola dodatnia wymaga 10 z 12 wartości, wyjątki nazwane), m4 (`useNotice`, brak ogłoszenia „połączono ponownie” po ponownym uruchomieniu efektu), m5–m7, S1 (strukturalna kontrola `dumpsys activity top`), S2 (kontrola usługi kamery; wykryła, że aparat zostaje zajęty pod nakładką — poprawione `pausePreview` / `resumePreview`); szczegóły pomiarów w Notatkach
