---
id: EVM-111
title: "Aplikacja: status każdego pliku w kolejce telefonu"
type: story
milestone: M2
epic: E11 Zdjęcia i filmy
status: draft
priority: P2
path: lekka             # tylko ekran nad lokalną kolejką; bez pobierania miniatur i podpisanych adresów (zawężone 2026-11-12); reviewer — pytanie 4
owner: mobile-developer
contributors: []
reviewers: [code-reviewer]
model: sonnet
depends_on: [EVM-108, EVM-131]
---

# EVM-111: Aplikacja — status każdego pliku w kolejce telefonu

> **Szkic do akceptacji Konrada (2026-11-15, `/refine`).** Zakres zawężony 2026-11-12: galeria i przegląd mediów zlecenia (zdjęcia i filmy z biura, miniatury z serwera) **tylko w panelu web**. Szkic jest minimalny: wszystko, czego nie potrzebuje test terenowy EVM-112, jest w „Poza zakresem”. Pytania — sekcja „Pytania do Konrada”.

## Cel
Jako **technik** chcę **w szczegółach zlecenia zobaczyć, ile plików z mojego telefonu dotarło do biura („Wysłano 3 z 5”) i co dzieje się z resztą**, aby **mieć pewność, że nic nie brakuje, zanim odjadę sprzed domu klienta**. Kolejka (EVM-108, EVM-110) pokazuje pliki wszystkich zleceń naraz; ta historyjka dodaje widok **jednego zlecenia**, wskaźnik „wysłano n z m”, przyczyny w prostych słowach i retencję rekordów wysłanych plików.

## Kontekst
Gotowe: wspólny wiersz pliku `FileRow`, etykiety stanów, „Ponów” i „Usuń z telefonu” (EVM-108, EVM-130), stany mediów w replice (EVM-131: `clean`, kwarantanna bez przyczyny). EVM-110 (w realizacji) dodaje stan „Czeka na Wi-Fi” i wiersz filmu (czas trwania, rozmiar) — ten ekran ich używa, więc **startuje po scaleniu EVM-110** (pytanie 5). Test terenowy EVM-112 **nie wymaga** tej historyjki — wystarcza Kolejka.

## Kryteria akceptacji

**AC1 — „Pliki zlecenia”: lista plików tego zlecenia z tego telefonu**
- Zakładając zalogowanego Administratora lub Edytora, otwarte zlecenie i pliki w kolejce telefonu przypisane do tego zlecenia (także wysłane — w granicach retencji z AC5)
- Gdy w szczegółach zlecenia wybieram wiersz „Pliki z tego telefonu” (stały, w treści nad dziennikiem; druga linia „Wysłano n z m”, całość jednym celem dotyku z chevronem)
- Wtedy otwiera się ekran „Pliki zlecenia”: **lista płaska** (bez nagłówków sekcji) wierszy wspólnego komponentu pliku — kategoria, czas wykonania, typ (dla filmu także czas trwania i rozmiar, jak w EVM-110) i jedna etykieta stanu: „Oczekuje”, „Wysyła się n%”, „Czeka na Wi-Fi”, „Nie wysłano”, „Wysłano” albo „Wymaga uwagi”; kolejność: Wymaga uwagi, Nie wysłano, w toku, na końcu Wysłano (w grupach od najnowszego); nie ma plików innych zleceń ani innych telefonów; wiersze nie pokazują nazwy klienta, adresu, nazwy pliku ani ścieżki; „Czeka na Wi-Fi” bez banera i dodatkowego objaśnienia (baner zostaje w Kolejce).

**AC2 — „Wysłano n z m”**
- Zakładając pliki zlecenia w różnych stanach
- Gdy postęp lub stan pliku się zmienia
- Wtedy nagłówek listy („Wysłano n z m” + pasek postępu — ten sam komponent i ta sama reguła liczenia co podsumowanie w Kolejce, zawężone do zlecenia, bez dopisku „· n w kolejce”) i wiersz w szczegółach zlecenia pokazują te same liczby bez odświeżania ręcznego: n = pliki ze stanem „Wysłano” (ten sam stan co w Kolejce — jedna reguła dla zdjęć i filmów), m = wszystkie pliki zlecenia z tego telefonu w granicach retencji; „Oczekuje”, „Wysyła się”, „Czeka na Wi-Fi”, „Nie wysłano” i „Wymaga uwagi” liczą się do m, nie do n; przy n = m (m > 0) nagłówek i wiersz pokazują „Wszystko wysłane” z ikoną `check` (pasek znika), ogłoszone raz czytnikowi ekranu; zmiany liczb w nagłówku ogłaszane zbiorczo, nie przy każdym procencie, a w szczegółach zlecenia tylko przez aktualizację nazwy dostępnej („Pliki z tego telefonu, wysłano 3 z 5”).

**AC3 — Stany: pusty, wczytywanie, błąd, offline**
- Zakładając zlecenie bez plików z tego telefonu, brak sieci albo błąd odczytu lokalnej bazy
- Gdy otwieram „Pliki zlecenia”
- Wtedy: **pusty** — EmptyState „Z tego telefonu nie ma tu jeszcze zdjęć ani filmów. Zdjęcia i filmy zlecenia przegląda biuro w panelu.” bez przycisku i bez nagłówka z paskiem (wiersz w szczegółach: „Wysłano 0 z 0”; „Zrób zdjęcie” jest w stałym pasku zlecenia); **wczytywanie** — szkielet 3 wierszy, dla czytnika „Wczytywanie plików…”, bez spinnera; **offline** — wszystkie pliki i stany jak z siecią, bez komunikatu o błędzie i bez banera (jest tylko kapsuła „Offline · n”); **błąd odczytu** — „Nie udało się wczytać listy plików.” z [Spróbuj ponownie] (wiersz w szczegółach bez drugiej linii, jeśli nie zna liczb), żaden rekord ani plik nie zostaje zmieniony.

**AC4 — Przyczyny prostym językiem i akcje**
- Zakładając plik „Wymaga uwagi” albo „Nie wysłano” (w tym kwarantanna, konflikt identyfikatora, brak oryginału, plik uszkodzony w transmisji, kod nieznany tej wersji)
- Gdy oglądam go na liście
- Wtedy pod etykietą jest przyczyna zwykłymi słowami z zamkniętego słownika (teksty z makiety 09 / EVM-108) i te same akcje co w Kolejce: „Ponów” tam, gdzie ponowienie ma sens, „Usuń z telefonu” (z potwierdzeniem) tam, gdzie nie ma; **kod nieznany tej wersji** (także treść przypominająca ścieżkę lub klucz obiektu) → tylko „Nie udało się wysłać pliku. Spróbuj ponownie.” i wyłącznie „Ponów”, nigdy „Usuń z telefonu”; „Oczekuje”, „Wysyła się” i „Czeka na Wi-Fi” akcji nie mają; po akcji lista i „Wysłano n z m” aktualizują się; „Ponów” bez sieci nie daje błędu (plik czeka na sieć); przyczyna techniczna kwarantanny, surowy kod, klucz obiektu i nazwa pliku nie pojawiają się na ekranie, w nazwach dostępnych ani w logach (kod zostaje w bazie).

**AC5 — Retencja rekordów wysłanych plików (7 dni)**
- Zakładając pliki w stanie „Wysłano” (oryginał na telefonie już usunięty po potwierdzeniu serwera — EVM-130)
- Gdy od uznania pliku za wysłany (znacznik `sentAt`) mija 7 dni i aplikacja startuje albo otwieram „Pliki zlecenia” lub Kolejkę
- Wtedy rekord takiego pliku (kategoria, czas, typ, rozmiar, identyfikator zlecenia) znika z listy, z liczników „n z m” i z lokalnej bazy; 6 d 23 h — zostaje, 7 d 0 h — znika (test ze sterowanym zegarem); wiek liczy się od chwili wysłania, nie od zrobienia zdjęcia; `sentAt` z przyszłości (cofnięty zegar) = rekord wygasły; istniejące rekordy „Wysłano” bez `sentAt` dostają czas migracji; retencja działa także w trybie ukrytych danych i po `session_revoked`; usuwa tylko lokalny wiersz (bez modułu natywnego, bez mutacji w kolejce synchronizacji, serwer nietknięty); pliki niewysłane, „Nie wysłano”, „Wymaga uwagi” i „Czeka na Wi-Fi” nie są usuwane bez względu na wiek; ten sam próg dotyczy sekcji „Wysłane pliki” w Kolejce.

**AC6 — Role, prywatność i dostępność**
- Zakładając różne role i stany aplikacji
- Gdy otwieram ekran albo wiersz w szczegółach zlecenia
- Wtedy Administrator i Edytor widzą listę (Tylko odczyt nie loguje się do aplikacji, niezalogowany widzi logowanie); w trybie ukrytych danych, przy blokadzie aplikacji i po `session_revoked` wiersza „Pliki z tego telefonu” w szczegółach nie ma, a ekran „Pliki zlecenia” pokazuje tylko komunikat „Dane zleceń są ukryte. Pliki wyślą się dalej — status zobaczysz w Kolejce.” z akcją wyjścia jak w całej aplikacji (bez wierszy, liczników, numeru zlecenia i nazw dostępnych); przejście w ten stan przy otwartym ekranie usuwa wiersze i liczniki od razu, a czytnik niczego nie ogłasza (także „Wszystko wysłane” i zmian „n z m”); po odblokowaniu lista wraca; po wylogowaniu i wymuszonym czyszczeniu danych rekordy plików są usunięte wg EVM-130 AC5; żadnych nowych powiadomień ani uprawnień; wiersz jest jedną grupą czytaną „[kategoria], [typ], [czas], [stan]”, a przyciski są poza grupą; cele dotyku ≥ 48 dp, 200% czcionki bez ucinania, stan niesie tekst (nie sam kolor lub ikona).

## Poza zakresem
Miniatury i podgląd pliku, także lokalny (pytanie 1); galeria i przegląd mediów zlecenia na telefonie, miniatury z serwera, podpisane adresy, pliki z innych telefonów i „Czeka na plik” (panel web); filtr „Niewysłane”, siatka, przełączniki widoku; rozwijane „Szczegóły techniczne” z kodem i wiekiem pliku; „Wstrzymaj”, „Ponów wszystkie” na tym ekranie (są w Kolejce); usuwanie niewysłanego pliku (decyzja Konrada 2026-11-15); zmiana układu Kolejki (docelowe „Wysłano 9 z 12” w Kolejce, „Zsynchronizowano 14:05”); osobny przycisk „Zrób zdjęcie” na ekranie (jest stały pasek w szczegółach zlecenia); nowe powiadomienia; pobieranie oryginałów; zmiany API, kontraktów i serwera.

## Decyzje i ograniczenia
- **Z wcześniejszych ustaleń:** stan „Wysłano” pochodzi z `clean` w replice `media_asset` (EVM-131); aplikacja zachowuje lokalnie kategorię, czas wykonania i rozmiar (replika ich nie niesie); przyczyna kwarantanny nie jest w ładunku — na telefonie tylko kod ze słownika; retencja 7 dni i „wysłano n z m” przeniesione z EVM-108 (2026-11-15).
- **UX / UI (konsultacja UX, skrót; 2026-11-15):** tylko istniejące komponenty (`FileRow`, EmptyState, Banner, ProgressBar, SyncIndicator) i tokeny, zero nowych. Wiersz „Pliki z tego telefonu” w przewijanej treści M-03, pierwszy nad dziennikiem (nie w dolnym pasku — ten jest od akcji); druga linia `text.body-sm` „Wysłano n z m” (liczebnik się nie odmienia), po prawej chevron, całość celem ≥ 48 dp zawijanym przy 200% czcionki; nazwa dostępna „Pliki z tego telefonu, wysłano 3 z 5” (przy komplecie „…, wszystko wysłane”), podpowiedź „Otwiera listę plików zlecenia”. Ekran: lista płaska, nagłówek z paskiem jak w Kolejce, stany z AC3, brak „Zrób zdjęcie” na pustym ekranie (jedna główna akcja, jest stały pasek), brak banera Wi-Fi i objaśnień filmu. Tryb ukrytych danych: wiersza w M-03 nie ma; ekran = Banner § 4.18 + EmptyState `eye-off`.
- **Bezpieczeństwo i prywatność (konsultacja security, skrót; 2026-11-15):** rekord pliku przez 7 dni po wysłaniu akceptowalny (metadane bez danych osobowych; blokada = tryb ukrycia, nic nie jest usuwane, więc czyszczenie przy blokadzie zbędne). Role: Administrator i Edytor; Tylko odczyt — `403 channel_not_allowed`. FLAG_SECURE (SR-MOB-08) pokrywa zrzuty i podgląd aplikacji; sam brak wierszy, liczników i numeru zlecenia w trybie ukrytym jest wystarczający, region na żywo też jest kanałem ujawnienia. Zamknięty słownik przyczyn spełnia SR-MOB-10/11 i SR-LOG (aplikacja nie ma zdalnego logowania). Bez zmian na serwerze; dane testowe syntetyczne.
- **Ścieżka `lekka`:** 6 AC, jeden moduł (aplikacja), bez API. Security: wystarczy jeden recenzent `security-engineer` pod warunkiem przeglądu migracji `sentAt` i zapytania retencji oraz testów z DoD (pytanie 4).
- **Dokumenty UX po akceptacji historyjki** (zrobi ux-designer, nie teraz): makieta 09 — M-08 z „Media zlecenia” (siatka) na uproszczone „Pliki zlecenia”, wiersz w opisie M-03, znaczniki „od EVM-111” (nagłówek, diagram, linie ok. 9, 31, 374, 419), mikrocopy; styleguide § 4.18 (M-08 = „Pliki zlecenia”, tekst EmptyState) i ewentualny wpis w changelogu; wiersz nawigacyjny w specyfikacji M-03.

## Pytania do Konrada
> Zmiany makiety 09 / M-03 i styleguide'u (lista w „Decyzjach i ograniczeniach”) ux-designer zrobi po akceptacji historyjki.

1. **Miniatury lokalne (były w AC2 ramowym).** Rekomendacja: **wyciąć** z tej historyjki. Konsekwencja wycięcia: lista jest tekstowa (kategoria, czas, typ, stan), co wystarcza do „czy dotarło”; zdjęcie rozpoznajesz po kategorii i czasie. Konsekwencja dodania: generowanie podglądów z plików (pamięć, dostępność tekstu alternatywnego, dodatkowy plik/cache z obrazem klienta na telefonie — przegląd security), wyraźnie większy koszt.
2. **Retencja rekordów wysłanych plików: 7 dni.** Rekomendacja: 7 dni (zbieżne z maksymalnym czasem czekania filmu na Wi-Fi). Krócej (np. 1 dzień) — mniej danych na telefonie, ale technik po weekendzie nie sprawdzi „co poszło”; dłużej — więcej metadanych na urządzeniu.
3. **Wejście do ekranu.** Rekomendacja (potwierdzona konsultacją UX): stały wiersz „Pliki z tego telefonu” z drugą linią „Wysłano n z m” w szczegółach zlecenia, widoczny także przy 0 plików (w trybie ukrytych danych go nie ma). Alternatywa: ukrywać wiersz, gdy brak plików — mniej szumu, ale ekran pusty nie jest wtedy osiągalny i wskaźnik „n z m” znika, gdy rekordy wygasną.
4. **Ścieżka i recenzent.** Rekomendacja: `lekka` z jednym recenzentem — security-engineer (dane na urządzeniu, retencja, tryb ukrytych danych) zamiast code-reviewera (potwierdzone przez security, pod warunkiem przeglądu migracji `sentAt` i zapytania retencji oraz testów z DoD). Konsekwencja: taniej niż `pelna`; błędy w ekranie i układzie łapią testy i ux-designer statycznie, bez drugiego recenzenta kodu. Alternatywa: `pelna` (+ qa, +2 recenzentów) — koszt większy, wartość dla terenu mała.
5. **Zależność od EVM-110 i kolejność względem EVM-112.** Rekomendacja: dopisać EVM-110 do `depends_on` (wspólny wiersz, „Czeka na Wi-Fi”, film) i robić EVM-111 **po** EVM-110, **równolegle lub po** EVM-112; test terenowy nie czeka na tę historyjkę. Konsekwencja: wcześniejszy start = konflikty w `FileRow`, `QueueFiles` i słowniku `i18n`.

## Konsultacje
Naniesione 2026-11-15: UX (5 pytań — wiersz, układ, stany, brak „Zrób zdjęcie”, brak objaśnień Wi-Fi) i security (4 pytania — rekord 7 dni, tryb ukryty, słownik przyczyn, testy retencji); wszystkie rozstrzygnięcia są w AC, „Decyzjach i ograniczeniach”, notatkach i DoD. Dalszych konsultacji przed implementacją nie trzeba.

## Notatki techniczne
- Nowy znacznik `sentAt` wyłącznie w bazie SQLCipher (nie w pliku zadania natywnego, WorkManager `Data`, SharedPreferences ani nazwach plików); migracja nadaje istniejącym rekordom „Wysłano” czas migracji (nigdy `null` = „bez terminu”). Predykat retencji = ten sam co etykieta „Wysłano” (`clean` lub późniejszy z repliki); rekord z `sentAt`, ale bez potwierdzenia w replice, nie jest usuwany.
- Reakcja na stan: przejście w tryb ukrycia przy otwartym ekranie (nie tylko przy montowaniu) czyści wiersze, liczniki i region na żywo; `DISCARDABLE_CODES` nie rozszerzać o kod nieznany (`reasonKey` w `QueueFiles.tsx`).
- Wiersz `FileRow` i `QueueFiles` istnieją; `MediaFileView` nie niesie identyfikatora zlecenia — pole potrzebne do filtra (nie do wyświetlania). Selektor „pliki zlecenia” nad tym samym źródłem co Kolejka; bez nowej kolejki, bez zmian w silniku EVM-130.
- Retencja: oś czasu „od uznania za wysłany” może wymagać nowego znacznika czasu; dziś nie widać jawnego usuwania rekordów wysłanych (do weryfikacji w kodzie). Przejście `clean` ↔ usunięcie oryginału bez zmian.
- Pliki wspólne z EVM-110: `FileRow.tsx`, `QueueFiles.tsx`, `i18n/pl.ts` (osobny blok kluczy); Maestro: kolejny wolny zakres numeracji.
- Bez nowych zależności, uprawnień, powiadomień i zmian kontraktu.

## Definition of Done
- [ ] AC1–AC6 pokryte testami oznaczonymi `EVM-111 AC#` (Jest ze sterowanym zegarem dla retencji; jeden przepływ Maestro: zdjęcia w zleceniu → „Wysłano n z m” po wysłaniu); `pnpm run gate` i `npm run docs:check` zielone.
- [ ] Testy negatywne (Jest, sterowany zegar): (a) każdy stan inny niż „Wysłano” (Oczekuje, Wysyła się, Czeka na Wi-Fi, Nie wysłano, Wymaga uwagi — `quarantined`, `id_conflict`, `missing_original`, kod nieznany) w wieku 30 dni: rekord, oryginał i plik zadania nietknięte; (b) rekord z `sentAt`, ale bez potwierdzenia w replice — nie usuwany; (c) retencja nie woła modułu natywnego ani nie dodaje mutacji do kolejki; (d) `sentAt` z przyszłości = wygasły, migracja bez `sentAt` → czas migracji; (e) kod spoza słownika (także z treścią jak ścieżka / klucz obiektu) → tylko tekst ogólny i „Ponów”, bez „Usuń z telefonu”, bez kodu na ekranie, w nazwie dostępnej i w logach; (f) przejście w tryb ukrycia przy otwartym ekranie czyści wiersze i liczniki, bez ogłoszeń czytnika.
- [ ] Przegląd: `security-engineer` (w tym migracja `sentAt` i zapytanie retencji — wg pytania 4) i ux-designer statycznie; `CHANGELOG.md`; po akceptacji historyjki ux-designer aktualizuje makietę 09 (M-08, M-03) i styleguide § 4.18 (lista w „Decyzjach i ograniczeniach”).

## Dziennik
- 2026-10-27 — utworzono (product-owner)
- 2026-10-27 — ścieżka zmieniona na `pelna` po konsultacji security (product-owner)
- 2026-11-12 — zawężono do statusu plików w kolejce telefonu; galeria mediów tylko w panelu web; ścieżka `pelna` → `lekka` (brak pobierania miniatur i podpisanych adresów), zależności 045/068 usunięte, 4 AC (decyzja Konrada 2026-11-12 / Tech Lead z delegacji Konrada „tanio, szybko, bezpiecznie”)
- 2026-11-14 — `depends_on` + EVM-131; uwagi z konsultacji (product-owner): stan `clean` wyłącznie z repliki `media_asset`; offline — tylko dane lokalne; w trybie ukrytym i po `session_revoked` ekran nie renderuje danych; przyczyna kwarantanny tylko jako kod ze słownika; retencja 7 dni i jeden komponent listy — do potwierdzenia w `/refine`
- 2026-11-14 — uwaga z EVM-131 (backend-developer): replika `media_asset` niesie minimalny ładunek (rozmiary `null`), więc aplikacja zachowuje lokalny opis i czas wykonania; `clean` i `quarantined` (bez przyczyny) z `fileState`; wersja synchronizacji to `version` + licznik stanu pliku
- 2026-11-15 — z doprecyzowania EVM-108: retencja rekordów wysłanych plików 7 dni i „wysłano n z m” należą do tej historyjki; lista plików reużywa wspólnego komponentu z EVM-108 (Tech Lead)
- 2026-11-15 — szkic `/refine` (product-owner): 6 AC (lista zlecenia, „n z m”, stany, przyczyny i akcje, retencja 7 dni, role/prywatność/dostępność), miniatury i `Szczegóły techniczne` do „Poza zakresem”, ścieżka `lekka`, 5 pytań do Konrada i konsultacje UX/security do zlecenia; status `draft`
- 2026-11-15 — naniesiono konsultacje UX i security; status draft, czeka na decyzje Konrada (product-owner)
