---
id: EVM-143
title: "Aplikacja: odtwarzanie filmów zlecenia (online, bez zapisu na telefonie)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: in-review
priority: P3
path: pelna             # film na urządzeniu i prawdopodobna nowa zależność (odtwarzacz) — „media”, „dane na urządzeniu”, łańcuch dostaw
owner: mobile-developer
contributors: []
reviewers: [security-engineer, ux-designer, code-reviewer]
model: sonnet
depends_on: [EVM-142]
---

# EVM-143: Aplikacja — odtwarzanie filmów zlecenia (online, bez zapisu na telefonie)

> **Szkic do akceptacji przez Konrada (2026-11-18).** Druga część potrzeby „zobaczyć zdjęcia i film na aplikacji mobilnej”; korzysta z kanału `mobile` dla adresów z EVM-142.

## Cel
Jako **technik (Administrator lub Edytor)** chcę **odtworzyć film zlecenia na telefonie**, aby **zobaczyć na miejscu nagranie z wizji lub montażu bez prośby do biura**.

## Kontekst
Film po przetworzeniu ma klatkę-miniaturę (WebP) i podgląd wideo 720p (MP4 bez metadanych, `inline`); adres ważny 5 min, więc odtwarzacz po błędzie prosi o nowy. Pomiar dużych filmów (4K/HEVC) na procesorze nie został zrobiony (posiedzenie 2026-11-18) — ta historyjka nie obiecuje filmów z terenu o dużym rozmiarze. Telefon pokazuje stan z repliki `media_asset` (EVM-131).

## Kryteria akceptacji

**AC0 — API wydaje telefonowi adres miniatury i podglądu filmu, nigdy oryginału**
- Zakładając token telefonu Administratora albo Edytora i film zlecenia widoczny dla niego
- Gdy prosi o adres `thumbnail` albo `preview` filmu
- Wtedy dostaje krótkotrwały adres (≤ 300 s, `no-store`, bez zapisu w logach i audycie) pliku `image/webp` albo `video/mp4` (`inline`, bez metadanych); `original` filmu z telefonu → `403` przed odczytem medium; film innego zlecenia, usunięty, w `processing`, w kwarantannie, `failed` albo bez gotowej pochodnej → `404` w jednym kształcie; limity i testy macierzy ról i kanałów jak w EVM-142 AC1, rozszerzone o wideo.

**AC1 — Film w siatce zdjęć**
- Zakładając zlecenie z filmem ze stanem `ready` i sieć
- Gdy otwieram „Zdjęcia zlecenia” (EVM-142)
- Wtedy film ma w siatce miniaturę (klatka) z oznaczeniem „Film”, kategorią i czasem; film w stanach `processing`, kwarantanny i `failed` pokazuje te same teksty co zdjęcie (EVM-142 AC2), bez adresu i bez przycisku odtwarzania.

**AC2 — Odtwarzanie po dotknięciu**
- Zakładając film `ready`
- Gdy go dotykam
- Wtedy otwiera się odtwarzacz z podglądem 720p, odtwarzanie rusza dopiero po dotknięciu „Odtwórz” (nic nie pobiera się samo), mam odtwarzanie, pauzę i zamknięcie; wideo jest przesyłane strumieniowo z krótkotrwałego adresu, bez zapisu pliku, w galerii ani w pamięci trwałej. Odtwarzacz działa w oknie głównym aplikacji; pełny ekran, tryb obraz w obrazie, odtwarzanie w tle i powiadomienie multimedialne są wyłączone, a adres trafia wyłącznie do odtwarzacza (nie do `Linking`, przeglądarki, innych aplikacji ani schowka).

**AC3 — Wygasły adres i błędy**
- Zakładając oglądany film i adres, który wygasa albo zwraca błąd
- Gdy odtwarzanie się przerywa
- Wtedy aplikacja jednorazowo prosi o nowy adres i wznawia od tego samego miejsca; po drugim błędzie „Nie udało się odtworzyć filmu” z „Spróbuj ponownie”; `403`, `404`, `429` dają komunikat ogólny bez szczegółów.

**AC4 — Offline**
- Zakładając brak sieci albo jej utratę w trakcie
- Gdy otwieram film albo oglądam go
- Wtedy komunikat „Film wymaga internetu” (bez komunikatu o błędzie serwera), siatka z repliki działa; po powrocie sieci mogę ponowić ręcznie.

**AC5 — Tło, blokada i tryb ukrytych danych**
- Zakładając odtwarzany film
- Gdy aplikacja idzie w tło, blokuje się, przechodzi w tryb ukrytych danych, `session_revoked` albo wylogowanie
- Wtedy odtwarzanie zatrzymuje się natychmiast, odtwarzacz i adres są zwolnione, a po powrocie film nie startuje sam; nic nie jest ogłaszane czytnikowi; oryginał filmu nie jest nigdy pobierany na telefon. Odtwarzacz nie zapisuje wideo na dysku (pamięć podręczna wyłączona): po odtworzeniu, blokadzie i wylogowaniu katalogi aplikacji nie zawierają plików wideo (test na emulatorze w wariancie debug); żądanie adresu i odpowiedź spóźniona po tych zdarzeniach są odrzucane.

**AC6 — Dostępność i dane**
- Zakładając czytnik ekranu i 200% czcionki
- Gdy używam odtwarzacza
- Wtedy przyciski mają nazwy dostępne i cele ≥ 48 dp, a nazwa filmu w siatce to „Film, [kategoria], [czas]” (bez nazwy pliku); scalony manifest po dodaniu odtwarzacza przechodzi istniejący test `permissions-minimal` bez zmiany listy uprawnień (brak `FOREGROUND_SERVICE*`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`) i bez usług odtwarzania w tle; po zamknięciu nie ma dźwięku ani powiadomień.

## Poza zakresem
- Pobieranie i zapis filmu, odtwarzanie offline, pełny ekran obrócony, napisy, prędkości, przewijanie z podglądem klatek.
- Odtwarzanie oryginału filmu; filmy 4K / HEVC jako obiecana funkcja (do pomiaru osobno); ostrzeżenie o zużyciu danych komórkowych (zob. pytanie 2).
- Zmiany procesora mediów; zmiany kontraktu API inne niż AC0 (adresy dla zdjęć wydaje EVM-142).

## Decyzje i ograniczenia
- Odtwarzacz zapewne wymaga nowej zależności w aplikacji (Expo) — **wymaga konsultacji architekta i uzasadnienia SR-SUPPLY-06** (licencja, utrzymanie, brak własnej pamięci podręcznej na dysku, brak dostępu do plików lokalnych).
- **Bezpieczeństwo i prywatność (konsultacja security, skrót; 2026-11-18):** film oglądamy wyłącznie jako `preview` 720p MP4 bez metadanych, strumieniowo z adresu ≤ 300 s; `original` filmu nigdy nie jest wydawany kanałowi `mobile`. **Serwis wydawania adresów dziś zwraca `404` dla wideo**, więc zmiana serwera i kontraktu należy do tej historyjki (AC0). Odtwarzacz działa w oknie głównym aplikacji: bez pełnego ekranu i trybu obraz w obrazie (osobna aktywność ominęłaby nakładkę blokady i `FLAG_SECURE`), bez odtwarzania w tle i powiadomień, bez zapisu na dysk i bez przekazywania adresu innym aplikacjom; WebView i zewnętrzny odtwarzacz są zakazane (SR-MOB-07). Kandydat: `expo-video` (dostawca jak pozostałe pakiety Expo); uzasadnienie wg SR-SUPPLY-06 w PR obejmuje licencję, wersję zgodną z SDK, aktualizację sum Gradle i brak zmian uprawnień. Reszta zasad jak w EVM-142 (SR-MOB-14); SR-FILE-07, SR-FILE-10, SR-MOB-05, SR-MOB-08.
- **UX / UI (specyfikacja `ux-designer`, 2026-11-23; baza: M-08a / M-08b w `docs/ux/flows/09-mobile-zdjecia-filmy-offline.md`, wzorzec z EVM-142; nowe wzorce w changelogu styleguide'u, do akceptacji Konrada):**
  - **Przepływ:** M-03 → wiersz „Zdjęcia zlecenia” → M-08a (siatka zdjęć i filmów razem, od najnowszego czasu wykonania) → dotyk filmu `ready` → **M-08c „Odtwarzacz filmu”** (widok w oknie głównym pod `LockGate`, nie `Modal`, nie osobna aktywność; wzorzec M-08b) → „Zamknij” / systemowy Wstecz wraca do siatki, fokus na tym samym kaflu. Tytuł ekranu M-08a bez zmian. Belka i dolna nawigacja wg EVM-151 (`BackButton`, `useFontScaleTier`).
  - **Kafel filmu w M-08a (§ 3.11, wariant kafla siatki):** miniatura-klatka jak zdjęcia (kwadrat, `radius.thumbnail`, `color.bg.skeleton` w trakcie wczytywania). Oznaczenie „Film” jako **tekst pod miniaturą** z ikoną `video` (`text.label`, `color.text.primary`) przed kategorią i czasem — nie tekst na obrazie; na miniaturze wyłącznie dekoracyjna ikona `play` w kółku `color.bg.inverse` / `color.icon.inverse` (`size.icon.md`, w środku, bez własnej nazwy i bez funkcji osobnego celu). Czas trwania w siatce: **brak** (nie ma w replice — Notatki). Stany `processing` / kwarantanna / `failed` / `pending_upload`, błąd wczytania miniatury, `404`, offline (lista bez miniatur z wierszem „Film”), `403` (EmptyState), szkielety i tryb ukrytych danych — **dokładnie jak zdjęcie** (pole stanu, te same teksty, bez adresu i bez przycisku odtwarzania, kafel bez akcji = grupa tekstowa); dla stanów pliku ikonę „Film” zachowuje wiersz tekstu, ikony pola stanu bez zmian. Kolumny 3 / 2 / 1 wg skali czcionki jak EVM-142 (`useFontScaleTier`); kafel ≥ 96 × 96 dp.
  - **M-08c Odtwarzacz — układ (compact):** pasek u góry jak M-08b (`color.bg.inverse`; „Zamknij” `x` 48 × 48 dp, nazwa „Zamknij odtwarzacz”; kategoria `text.heading-4`, czas `text.body-sm`, „Film” jako etykieta pod czasem); środek: obszar wideo 16:9 do szerokości okna (`contain`, tło `color.bg.inverse`); do chwili „Odtwórz” pokazuje **miniaturę z siatki** (już w pamięci) z przyciskiem **„Odtwórz”** (Button primary w ciemnym wariancie § 3.24, ikona `play`, ≥ 48 dp, pod obszarem wideo, pełna szerokość w compact — strefa kciuka). Po starcie ten sam przycisk zmienia się w **„Pauza”** (ikona `pause`) i z powrotem w „Odtwórz”; po zakończeniu filmu — „Odtwórz ponownie”. Bez paska przewijania, głośności, pełnego ekranu, obrazu w obrazie, napisów, prędkości (poza zakresem; filmy z aplikacji są bez dźwięku, głośność systemowa). Bez własnych kontrolek natywnych odtwarzacza (`nativeControls` wyłączone) — jedna ścieżka sterowania, ten sam fokus i cele co w reszcie aplikacji. Nic nie pobiera się przed „Odtwórz” (adres podglądu prosimy dopiero po dotknięciu „Odtwórz”; wcześniej tylko adres miniatury z siatki).
  - **Stany M-08c:** *przygotowanie / buforowanie* — miniatura (lub szkielet) + przycisk w stanie ładowania (spinner w przycisku, § 3.1, wyłączony; bez pełnoekranowego spinnera); dla czytnika „Wczytywanie filmu…” raz. *Odtwarzanie / pauza* — jak wyżej. *Wygasły adres lub przerwane odtwarzanie (AC3)* — jednorazowo i bezgłośnie nowy adres, wznowienie od tej samej sekundy; podczas tego klatka zostaje, przycisk w stanie ładowania; bez komunikatu. *Drugi błąd, błąd sieci lub serwera, `429` (backoff)* — w obszarze wideo `cloud-alert` (`size.icon.2xl`, `color.icon.inverse`) + **„Nie udało się odtworzyć filmu”** + Button secondary **„Spróbuj ponownie”** (nowy adres; podczas oczekiwania na backoff przycisk wyłączony z ładowaniem, nie do spamowania); `role="alert"` raz. *`403` / `404`* — `ban` + **„Film niedostępny. Mógł zostać usunięty albo nie masz do niego dostępu.”**, bez przycisku ponowienia, bez kodu; zostaje „Zamknij” (brzmienie ogólne wg AC3; `429` traktujemy jako ponawialny — do potwierdzenia w przeglądzie). *Offline (przy otwarciu i utrata w trakcie)* — `wifi-off` + **„Film wymaga internetu”** (bez słowa „błąd”, bez kodów) + „Spróbuj ponownie”; odtwarzanie wstrzymane, klatka zostaje; po powrocie sieci **bez automatycznego startu** — tylko ręczne ponowienie (AC4). *Brak uprawnień* jak `403`. *Tło (aplikacja w tle)* — odtwarzacz zatrzymany i zwolniony, adres odrzucony; po powrocie ekran z miniaturą i „Odtwórz” (pozycja nie jest zachowywana), nic nie startuje samo. *Blokada, tryb ukrytych danych, `session_revoked`, wylogowanie, „Wyczyść dane firmowe” (§ 4.18)* — odtwarzacz znika z drzewa widoków od razu, dźwięk i adres zwolnione, żądania i spóźnione odpowiedzi odrzucone, czytnik nic nie ogłasza; po odblokowaniu wraca **siatka**, nie odtwarzacz.
  - **Responsywność:** compact (360–411 dp): układ pionowy jak wyżej; skala czcionki > 130% — pasek zawija kategorię i czas (Zamknij zostaje 48 × 48 dp), obszar wideo min. 35% wysokości okna, przy potrzebie ekran przewija się (otwarta uwaga z EVM-142: scenariusze 130% / 200% sprawdzamy z przewijaniem — przycisk „Odtwórz” zawsze osiągalny); orientacja pozioma: wideo po lewej, pasek i przycisk po prawej (jeśli orientacja zablokowana — bez zmian). Nic nie ma `numberOfLines`.
  - **Komponenty i tokeny:** Thumbnail „kafel siatki w aplikacji” (§ 3.11), Lightbox „w aplikacji” jako wariant „odtwarzacz filmu” (**nowy wariant, § 3.11**), IconButton `x`, Button primary / secondary (ciemny wariant § 3.24), Skeleton, EmptyState, InlineAlert, `BackButton`; tokeny jak M-08a / M-08b (`color.bg.inverse`, `color.text.inverse`, `color.icon.inverse`, `color.bg.skeleton`, `radius.thumbnail`, `text.heading-4`, `text.label`, `text.body-sm`, `size.icon.md`, `size.icon.2xl`, `size.touch-target.min`, `space.inset.md`, `space.stack.*`, `motion.transition.enter`); **bez nowych tokenów**. Ikony do `icons.ts` (głęboki import): `video`, `play`, `pause` (reszta jest: `x`, `cloud-alert`, `ban`, `wifi-off`, `lock`).
  - **Mikrocopy:** „Film” · „Odtwórz” · „Pauza” · „Odtwórz ponownie” · „Zamknij odtwarzacz” · „Wczytywanie filmu…” · „Film wymaga internetu” · „Nie udało się odtworzyć filmu” · „Spróbuj ponownie” · „Film niedostępny. Mógł zostać usunięty albo nie masz do niego dostępu.” · teksty stanów pliku i „Dane zleceń są ukryte…” bez zmian. Wiersz w M-03: „2 zdjęcia, 1 film” / „1 film” / „Brak zdjęć i filmów” (odmiana § 6.3); pusty M-08a: „Brak zdjęć i filmów w tym zleceniu”; pusty M-08: „…Zdjęcia i filmy zlecenia znajdziesz w wierszu „Zdjęcia zlecenia”.” (zastępuje „Filmy ogląda biuro w panelu”).
  - **Dostępność:** nazwa kafla „Film, [kategoria], [czas]” (+ stan na końcu dla kafli bez akcji; bez nazwy pliku, identyfikatorów, adresu — także w `testID`), podpowiedź „Otwiera odtwarzacz filmu”; po otwarciu fokus na grupie nagłówka z ogłoszeniem „Odtwarzacz filmu, [kategoria], [czas]”; przycisk „Odtwórz” / „Pauza” ma nazwę równą widocznemu tekstowi i zmienia ją przy zmianie stanu (bez osobnych ogłoszeń o postępie i buforowaniu); błąd raz (`role="alert"`); po zamknięciu fokus wraca na kafel; wideo samo nie jest elementem czytnika; brak dźwięku i powiadomień po zamknięciu; cele ≥ 48 dp, kontrast jak M-08b, a ruch (`motion.transition.enter`) przy „ograniczone animacje” natychmiast; brak automatycznego startu odtwarzania.

## Decyzje Konrada (2026-11-18: przyjęte wszystkie rekomendacje poniżej)
1. **Czy filmy robimy dopiero po teście zdjęć z EVM-142?** Rekomendacja: **tak** (zdjęcia dają 80% wartości, film dokłada nową zależność i pamięć). Konsekwencja: film pojawi się w aplikacji później.
2. **Ostrzeżenie o danych komórkowych przed odtworzeniem?** Rekomendacja: **nie** (odtwarzanie dopiero po dotknięciu wystarcza; film 720p jest krótki). Konsekwencja „tak”: dodatkowy AC i ustawienie „tylko Wi-Fi” dla podglądu.
3. **Czy filmy 4K z terenu mają być obiecane już teraz?** Rekomendacja: **nie** — najpierw pomiar procesora (propozycja (e) z posiedzenia 2026-11-18).

## Notatki
- Czas trwania filmu nie jest w replice; jeśli ma być w siatce, wymaga osobnej decyzji (kontrakt).
- Z konsultacji security (Low): w teście wymusić wygaśnięcie adresu w trakcie odtwarzania (żądania zakresów po wygaśnięciu kończą się błędem — AC3); logi natywne odtwarzacza sprawdzić w `adb logcat` jak w EVM-142; walidacja `https:` i hosta bucketu przed przekazaniem adresu odtwarzaczowi; do potwierdzenia w kodzie wybranej wersji: domyślne wyłączenie pamięci podręcznej i sposób otwierania pełnego ekranu.
- Historyjka ma 7 kryteriów (AC0–AC6) — AC0 doszło z konsultacji; przy planie rozważyć wydzielenie AC0 do osobnego, małego kroku API.

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner); podział potrzeby Konrada z 2026-11-18 na zdjęcia (EVM-142) i filmy
- 2026-11-18 — naniesiono konsultację security (Tech Lead): dodane AC0 (serwer dziś nie wydaje adresów wideo), AC2, AC5 i AC6 doprecyzowane (okno główne, brak zapisu na dysk, test uprawnień); status `draft`
- 2026-11-18 — Konrad: „Akceptuję rekomendacje” — wszystkie pytania rozstrzygnięte wg rekomendacji; status `ready` (Tech Lead)
- 2026-11-23 — start realizacji (/deliver): gałąź `feature/EVM-143-odtwarzanie-filmow`, ścieżka `pelna`, wykonawca mobile-developer (`sonnet`), recenzenci security-engineer, ux-designer, code-reviewer
- 2026-11-23 — implementacja (mobile-developer): AC0 API (`findReadyDerivative` bez filtra rodzaju, kontrola typu pochodnej, testy integracyjne wideo), `expo-video` 58.0.12 za portem (`video-player-adapter`), sesja odtwarzania, ekran M-08c, kafel filmu, plugin `with-video` i zakazy manifestu APK; dowód na emulatorze (AC5, AC6) i `backend-install` jeszcze do wykonania
- 2026-11-23 — poprawki rundy 1 (mobile-developer): scenariusze Maestro `film-*` (przepływy 160–165) i część filmową serwera scenariuszy; 22/22 przepływów na emulatorze, dowód AC5/AC6 w `docs/qa/EVM-143/`, zrzuty w `docs/ux/reviews/EVM-143/`; `verify` paczki release wykrył `WAKE_LOCK` z biblioteki odtwarzacza — usunięty wtyczką; natywne zwolnienie odtwarzacza odroczone do odmontowania widoku; otwarte: sieć tracona przy otwartym odtwarzaczu daje „Nie udało się odtworzyć filmu” do odświeżenia statusu; AC6 wspomina brak `POST_NOTIFICATIONS`, który należy do wysyłania plików (EVM-130)
- 2026-11-23 — przeglądy (security-engineer, ux-designer, code-reviewer): approve po 2 rundach; bramka `pnpm run gate` zielona u Tech Leada (diff coverage 99,6% linii / 95,4% gałęzi; część bazodanowa API tylko w CI); status `in-review`
- 2026-11-23 — Koszt: ścieżka `pelna`, 13 agentów, ok. 1,36 mln tokenów podagentów, 521 wywołań narzędzi, ok. 3 h, 2 rundy
