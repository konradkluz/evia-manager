---
id: EVM-143
title: "Aplikacja: odtwarzanie filmów zlecenia (online, bez zapisu na telefonie)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: in-progress
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
- UX: rozszerzenie makiety siatki o film i odtwarzacz, komponenty ze styleguide'u.

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
