---
id: EVM-143
title: "Aplikacja: odtwarzanie filmów zlecenia (online, bez zapisu na telefonie)"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
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

**AC1 — Film w siatce zdjęć**
- Zakładając zlecenie z filmem ze stanem `ready` i sieć
- Gdy otwieram „Zdjęcia zlecenia” (EVM-142)
- Wtedy film ma w siatce miniaturę (klatka) z oznaczeniem „Film”, kategorią i czasem; film w stanach `processing`, kwarantanny i `failed` pokazuje te same teksty co zdjęcie (EVM-142 AC2), bez adresu i bez przycisku odtwarzania.

**AC2 — Odtwarzanie po dotknięciu**
- Zakładając film `ready`
- Gdy go dotykam
- Wtedy otwiera się odtwarzacz z podglądem 720p, odtwarzanie rusza dopiero po dotknięciu „Odtwórz” (nic nie pobiera się samo), mam odtwarzanie, pauzę i zamknięcie; wideo jest przesyłane strumieniowo z krótkotrwałego adresu, bez zapisu pliku, w galerii ani w pamięci trwałej.

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
- Wtedy odtwarzanie zatrzymuje się natychmiast, odtwarzacz i adres są zwolnione, a po powrocie film nie startuje sam; nic nie jest ogłaszane czytnikowi; oryginał filmu nie jest nigdy pobierany na telefon.

**AC6 — Dostępność i dane**
- Zakładając czytnik ekranu i 200% czcionki
- Gdy używam odtwarzacza
- Wtedy przyciski mają nazwy dostępne i cele ≥ 48 dp, a nazwa filmu w siatce to „Film, [kategoria], [czas]” (bez nazwy pliku); odtwarzacz nie dodaje uprawnień, powiadomień ani dźwięku w tle po zamknięciu.

## Poza zakresem
- Pobieranie i zapis filmu, odtwarzanie offline, pełny ekran obrócony, napisy, prędkości, przewijanie z podglądem klatek.
- Odtwarzanie oryginału filmu; filmy 4K / HEVC jako obiecana funkcja (do pomiaru osobno); ostrzeżenie o zużyciu danych komórkowych (zob. pytanie 2).
- Zmiany procesora mediów, kontraktu API (adresy `thumbnail` / `preview` wydaje EVM-142).

## Decyzje i ograniczenia
- Odtwarzacz zapewne wymaga nowej zależności w aplikacji (Expo) — **wymaga konsultacji architekta i uzasadnienia SR-SUPPLY-06** (licencja, utrzymanie, brak własnej pamięci podręcznej na dysku, brak dostępu do plików lokalnych).
- Bezpieczeństwo: te same zasady co EVM-142 (adres tylko w pamięci, bez logów, bez cache na dysku); SR-FILE-07, SR-FILE-10, SR-MOB-05, SR-MOB-08.
- UX: rozszerzenie makiety siatki o film i odtwarzacz, komponenty ze styleguide'u.

## Do akceptacji przez Konrada
1. **Czy filmy robimy dopiero po teście zdjęć z EVM-142?** Rekomendacja: **tak** (zdjęcia dają 80% wartości, film dokłada nową zależność i pamięć). Konsekwencja: film pojawi się w aplikacji później.
2. **Ostrzeżenie o danych komórkowych przed odtworzeniem?** Rekomendacja: **nie** (odtwarzanie dopiero po dotknięciu wystarcza; film 720p jest krótki). Konsekwencja „tak”: dodatkowy AC i ustawienie „tylko Wi-Fi” dla podglądu.
3. **Czy filmy 4K z terenu mają być obiecane już teraz?** Rekomendacja: **nie** — najpierw pomiar procesora (propozycja (e) z posiedzenia 2026-11-18).

## Notatki
- Czas trwania filmu nie jest w replice; jeśli ma być w siatce, wymaga osobnej decyzji (kontrakt).

## Dziennik
- 2026-11-18 — utworzono jako szkic (product-owner); podział potrzeby Konrada z 2026-11-18 na zdjęcia (EVM-142) i filmy
