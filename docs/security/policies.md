# Polityki bezpieczeństwa do decyzji — v1

> Dokument żywy (EVM-005). Właściciel: `security-engineer`; decyzje: Konrad. Wersja **v1, 2026-10-03** — rekomendacje **przyjęte przez Konrada 2026-10-03** na demo EVM-005. P1–P6 wynikają z AC3 historyjki EVM-005, P7–P12 — ze spraw, które ADR-y i model domeny (EVM-002) jawnie przekazały do EVM-005. Żadna rekomendacja nie zmienia decyzji ADR-0001…0015 — potwierdza ich wartości albo doprecyzowuje to, co ADR zostawił do EVM-005. Wymagania `SR-…`: [`requirements.md`](requirements.md); zagrożenia `TM`/`AB`/`RR`: [`threat-model.md`](threat-model.md); retencja i podstawy prawne: [`rodo.md`](rodo.md).

## Jak decydować
- Każda polityka ma **rekomendację**, **warianty z konsekwencjami**, **zgodność z ADR**, **wpływ** na model zagrożeń i epiki oraz pole **„Decyzja Konrada”**.
- Odpowiedź „akceptuję rekomendacje P1–P12” zamyka wszystkie punkty. Wybór innego wariantu zmienia wskazane `SR-…` i ryzyko rezydualne — `security-engineer` aktualizuje wtedy [`requirements.md`](requirements.md) i [`threat-model.md`](threat-model.md).
- Do czasu decyzji `product-owner` wpisuje w AC wartości rekomendowane z dopiskiem „(P#, do akceptacji)”.

## Podsumowanie
| # | Temat | Rekomendacja w jednym zdaniu | Główne `SR` | Decyzja Konrada |
|---|---|---|---|---|
| P1 | MFA | Obowiązkowe dla wszystkich ról; Administrator w panelu — passkey; funkcje administracyjne i step-up tylko w panelu; co najmniej dwóch Administratorów albo konto awaryjne. | SR-AUTH-06, SR-AUTH-13, SR-AUTHZ-12 | przyjęta rekomendacja (2026-10-03) |
| P2 | Hasła i sesje | Wartości z ADR-0005 bez zmian; limity równoległych sesji; 7 dni offline; dwa tryby unieważnienia urządzenia (automatyczne oraz reset hasła i MFA — jak „Wyloguj”, zmiana roli na Tylko odczyt — jak „Zablokuj i wyczyść”); ten sam `deviceId` po ponownym logowaniu na tej samej instalacji; jeden proces odświeżania tokenu z oknem tolerancji. | SR-SESS-03, SR-SESS-04, SR-SESS-06, SR-SESS-09, SR-MOB-04, SR-MOB-05, SR-SYNC-03 | przyjęta rekomendacja (2026-10-03) |
| P3 | EXIF / GPS | Aplikacja bez uprawnienia lokalizacji; pochodne zawsze bez metadanych; oryginały bez zmian, tylko dla Administratora i Edytora. | SR-FILE-08 | przyjęta rekomendacja (2026-10-03) |
| P4 | Retencja | Zlecenia z mediami i dokumentami 6 lat od końca roku zamknięcia; dane techniczne krótko; audyt 2 lata. | SR-DATA-07, SR-PRIV-01 | przyjęta rekomendacja (2026-10-03) |
| P5 | Skanowanie plików | ClamAV dla każdego pliku, fail-closed; filmy z aplikacji ≤ 2 GB (bitrate ≤ 8 Mb/s); większe — walidacja strukturalna. | SR-FILE-05, SR-FILE-12 | przyjęta rekomendacja (2026-10-03) |
| P6 | Rola Tylko odczyt | Widzi płatności i dokumenty `standard`; bez oryginałów mediów, dokumentów `identity_data` i `building_security`, eksportu i aplikacji mobilnej. | SR-AUTHZ-06, SR-AUTHZ-07, SR-AUTHZ-12 | przyjęta rekomendacja (2026-10-03) |
| P7 | Telefony i BYOD | Blokada ekranu sprawdzana przy logowaniu, uruchomieniu i wznowieniu aplikacji; próg poprawek z serwera — na start „tylko ostrzegaj”, „blokuj” po spisie floty (pytanie do Konrada); bez MDM; procedury utraty i odejścia. | SR-MOB-06, SR-PRIV-10 | przyjęta rekomendacja (2026-10-03) |
| P8 | Przypinanie certyfikatów | Bez przypinania w MVP; CAA, DNSSEC i monitoring CT. | SR-COMM-04, SR-INFRA-12 | przyjęta rekomendacja (2026-10-03) |
| P9 | Format adresu IP | Pełny IP krótko (sesje, logi lokalne); w audycie i logach u dostawców — prefiks /24 i /48. | SR-LOG-02, SR-LOG-03 | przyjęta rekomendacja (2026-10-03) |
| P10 | Limity i progi | 1200 żądań/min/IP; progi masowego odczytu, podpisanych URL-i i eksportów z alertami. | SR-API-02, SR-FILE-09, SR-FILE-10 | przyjęta rekomendacja (2026-10-03) |
| P11 | CSP i HSTS | CSP bez `unsafe-inline`/`unsafe-eval`, HSTS 1 rok z subdomenami, bez preload na start. | SR-WEB-01, SR-WEB-02, SR-WEB-08 | przyjęta rekomendacja (2026-10-03) |
| P12 | Szyfrowanie pól, `evia_readonly` | Szyfrujemy sekrety TOTP; pól danych osobowych w MVP nie; `evia_readonly` bez uprawnień do M4. | SR-CRYPTO-02, SR-INFRA-03 | przyjęta rekomendacja (2026-10-03) |

## P1 — MFA: kogo obejmuje i jaki mechanizm
**Rekomendacja**
1. **MFA obowiązkowe dla wszystkich ról** (Administrator, Edytor, Tylko odczyt) od pierwszego wydania. Konto bez MFA może wyłącznie dokończyć konfigurację (`403 mfa_enrollment_required`).
2. **Mechanizmy:**
   - panel web — passkey (Windows Hello, klucz bezpieczeństwa, passkey w telefonie) albo TOTP (aplikacja uwierzytelniająca);
   - **Administrator w panelu — passkey obowiązkowy** (odporny na phishing; TOTP Administratora działa wyłącznie w aplikacji mobilnej);
   - aplikacja mobilna — TOTP (passkeys natywne — decyzja w E9), **tylko operacje kanału `mobile`** (SR-AUTHZ-12): logowanie, synchronizacja, upload, miniatury, profil, wylogowanie. Funkcje administracyjne, operacje ze step-upem, eksporty i pobieranie oryginałów działają wyłącznie w panelu — przechwycone hasło i kod TOTP Administratora dają najwyżej dostęp technika do zakresu urządzenia, nie uprawnienia administracyjne (AB-02);
   - SMS, e-mail i powiadomienia push **nie są** czynnikami.
3. **Kody odzyskiwania:** 10 jednorazowych, pokazywane raz przy konfiguracji MFA, do zapisania poza telefonem.
4. **Kiedy MFA:** przy każdym pełnym logowaniu (web — najrzadziej co 12 h; mobile — najrzadziej co 30 dni albo po 14 dniach bezczynności) i przy step-upie (P2). Bez „zapamiętaj to urządzenie” w MVP.
5. **Odzyskiwanie MFA Administratora** (AB-22, RR-16):
   - co najmniej **dwa konta z rolą Administrator** należące do różnych osób (np. Konrad i wspólnik albo zaufany pracownik); jeśli druga osoba nie jest możliwa — **konto awaryjne Konrada** z kluczem sprzętowym FIDO2 przechowywanym w sejfie (ok. 250–300 zł jednorazowo), używane tylko w awarii, każde logowanie = alert do wszystkich Administratorów;
   - kody odzyskiwania wydrukowane i przechowywane w sejfie, nie w telefonie z TOTP;
   - ostateczność: runbook (EVM-007, E8) — polecenie na serwerze przez SSH z listy dozwolonych adresów, które resetuje MFA wskazanego Administratora, z audytem i e-mailem do wszystkich Administratorów; wymaga potwierdzenia tożsamości poza systemem; po resecie natychmiastowa ponowna rejestracja.
6. **Pozostali użytkownicy:** MFA resetuje Administrator ze step-upem po weryfikacji tożsamości (osobiście albo rozmowa wideo), z unieważnieniem sesji i e-mailem (SR-AUTH-13).

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** (wyżej) | zgodność z ASVS V6.3.3 (poziom 2 wymaga MFA do dostępu do aplikacji); credential stuffing nieskuteczny (TM-16: 9 Critical → 3 Medium); phishing w czasie rzeczywistym (AB-02, RR-17) — 4 Medium: passkey zamyka drogę do uprawnień Administratora w panelu, a SR-AUTHZ-12 — w aplikacji; zostają ścieżki TOTP w granicach roli; jedno konto na osobę; jednorazowa konfiguracja u każdego pracownika, kilka sekund przy logowaniu |
| B. MFA tylko dla Administratora (minimum z ADR-0005), dostępne dla pozostałych | odstępstwo od ASVS L2 V6.3.3; przejęcie hasła Edytora daje dostęp do wszystkich zleceń (TM-16 zostaje Critical) — ryzyko do akceptacji |
| C. Passkey obowiązkowy dla wszystkich w panelu (bez TOTP w panelu) | najwyższa odporność na phishing w panelu (ścieżki panelu w AB-02: 1 × 2 = 2 Low); RR-17 zostaje 4 Medium do czasu passkeys natywnych w aplikacji (E9), bo aplikacja używa TOTP; każdy komputer biura potrzebuje Windows Hello albo klucza (ok. 150–300 zł na osobę bez Windows Hello) |
| D. Administrator bez obowiązku passkey (TOTP wystarcza) | prostsze, ale konto Administratora podatne na phishing w czasie rzeczywistym w panelu — przejęcie całego systemu (AB-02 dla Administratora: 2 × 3 = 6 High) |
| E. Jeden Administrator bez konta awaryjnego | utrata telefonu Administratora blokuje zarządzanie systemem do czasu odzyskania (AB-22: 4 Medium bez procedury) |
| F. Administrator tylko w panelu (passkey, bez TOTP); do pracy w terenie osobne konto Edytora tej samej osoby | reguła rola × kanał odrzuca logowanie mobilne Administratora (`403 channel_not_allowed`); konto Administratora nie ma czynnika podatnego na phishing — droga do jego uprawnień zamknięta także przy błędzie w oznaczeniu kanałów (dodatkowa warstwa obok SR-AUTHZ-12); koszt: druga tożsamość tej samej osoby (osobne hasło i TOTP, audyt per konto, mapowanie „kto jest kim” w runbooku), a konto Edytora z TOTP jest podatne na phishing jak każde inne — RR-17 bez zmian (4 Medium); przełączanie kont, gdy Administrator potrzebuje aplikacji w terenie |

**Zgodność z ADR:** ADR-0005 — MFA obowiązkowe dla Administratora, „dostępne dla wszystkich (rozszerzenie obowiązku — EVM-005)”, TOTP i passkeys (passkeys najpierw w panelu, w aplikacji TOTP), 10 kodów odzyskiwania, procedura utraty telefonu Administratora w EVM-005. Rekomendacja rozszerza obowiązek w ramach delegacji — bez zmiany ADR. Ograniczenie kanału `mobile` (SR-AUTHZ-12) korzysta z istniejącego pola `x-evia-authz.channels` ([`api-guidelines.md` → „Autoryzacja”](../architecture/api-guidelines.md#autoryzacja-deny-by-default)) — bez zmiany ADR; nowy kod `403 channel_not_allowed` rozszerza katalog kodów v1 (uwaga dla `solution-architect`).

**Wpływ:** TM-16, TM-23, TM-90, AB-01, AB-02, AB-22, RR-16, RR-17; SR-AUTH-06, SR-AUTH-07, SR-AUTH-08, SR-AUTH-09, SR-AUTH-13, SR-AUTH-14, SR-AUTHZ-12; epiki E1, E9, E8 (runbook), EVM-008 (lint `channels`, macierz ról z wymiarem kanału). Po decyzji `solution-architect` aktualizuje wiersz „MFA” w NFR ([`../architecture/README.md`](../architecture/README.md#wymagania-niefunkcjonalne--wartości-docelowe)).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P2 — Hasła i sesje
**Rekomendacja — wartości**
| Parametr | Wartość | Źródło |
|---|---|---|
| długość hasła | min. 15, maks. ≥ 128 znaków | ADR-0005 — potwierdzenie |
| złożoność i okresowa zmiana | brak reguł złożoności; zmiana tylko po wycieku lub na życzenie | ADR-0005 — potwierdzenie |
| blokowane hasła | ≥ 3000 najpopularniejszych + słowa kontekstowe: „evia”, „eviacharge”, „evia charge”, „charge”, „wallbox”, „ładowarka”/„ladowarka”, „garaż”/„garaz”, „manager”, część lokalna e-maila użytkownika, imię i nazwisko z `displayName`, bieżący i poprzedni rok + Pwned Passwords (k-anonimowość) | ADR-0005, ASVS V6.1.2 |
| haszowanie | Argon2id, m ≥ 19 MiB, t ≥ 2, p = 1, ~250 ms | ADR-0005 — potwierdzenie |
| brute force | opóźnienia po 5 próbach; blokada 15 min po 10 próbach w 15 min + e-mail; 20 prób/min/IP | ADR-0005 — potwierdzenie |
| reset hasła / zaproszenie | token jednorazowy 30 min / 72 h | ADR-0005 — potwierdzenie |
| sesja web | bezczynność 60 min, maks. 12 h | ADR-0005 — potwierdzenie |
| równoległe sesje | web ≤ 5 na użytkownika (szósta zamyka najstarszą + e-mail); aktywne urządzenia mobilne (z ważną sesją) ≤ 2 — ponowne logowanie na tej samej instalacji wraca do tego samego `deviceId` i nie zajmuje nowego miejsca; trzecie urządzenie wymaga wylogowania albo unieważnienia jednego | nowe — ASVS V7.1.2 |
| step-up | MFA, gdy ostatnie uwierzytelnienie > 15 min temu (lista operacji niżej) | ADR-0005 — doprecyzowanie listy |
| tokeny mobilne | access 15 min (tylko w pamięci); refresh rotowany przy każdym użyciu, bezczynność 14 dni, maks. 30 dni | ADR-0005 — potwierdzenie |
| odświeżanie tokenu | jeden proces odświeżania w `sync-core`; okno tolerancji **30 s** dla bezpośrednio poprzedniego refresh tokenu (niżej) | nowe — ochrona przed fałszywym wykryciem ponownego użycia |
| praca offline | **7 dni** od ostatniego udanego kontaktu z serwerem → dane ukryte do zalogowania online; aparat i kolejka działają | ADR-0005 — decyzja przekazana do EVM-005 |
| urządzenie bez kontaktu | po 30 dniach bez kontaktu serwer kończy sesje urządzenia (refresh token i tak wygasł) — skutek jak „Wyloguj urządzenie”: kolejka zostaje, ponowne logowanie wraca do tego samego `deviceId`; rekord urządzenia usuwany po 90 dniach bez kontaktu (P4) | nowe — porządek listy urządzeń |
| unieważnienie urządzenia | dwa tryby: „Wyloguj urządzenie” i „Zablokuj i wyczyść”; unieważnienia automatyczne oraz reset hasła i MFA działają jak „Wyloguj urządzenie” (niżej) | ADR-0007 ryzyko (c), `offline-sync.md` otwarte 1–2 |
| tożsamość urządzenia | `deviceId` i sekret instalacji wydane przy rejestracji; ten sam `deviceId` przy ponownym logowaniu tego samego użytkownika na tej samej instalacji (niżej) | doprecyzowanie ADR-0005 — ciągłość idempotencji i sesji uploadu |

**Operacje wymagające step-upu:** zaproszenie, zmiana roli, dezaktywacja i reaktywacja konta, reset MFA innego użytkownika; unieważnianie cudzych sesji i urządzeń; eksport (także ZIP mediów); korekty płatności; trwałe usunięcie, anonimizacja, redakcja; przywrócenie zlecenia z `settled` lub `cancelled`; odczyt audytu; zmiany katalogu i szablonów. Zmiana własnego hasła, e-maila i MFA — pełne ponowne uwierzytelnienie (SR-AUTH-10).

**Unieważnienie urządzenia i los niewysłanej kolejki** (ADR-0007 ryzyko c; [`offline-sync.md` → „Otwarte — EVM-011”](../architecture/offline-sync.md#otwarte--evm-011), punkty 1–2)
| Tryb | Kiedy | Co robi serwer | Co robi telefon |
|---|---|---|---|
| **Wyloguj urządzenie** | prośba użytkownika, podejrzenie wycieku tokenu przy telefonie w rękach pracownika; **skutek zmian konta:** reset hasła (SR-AUTH-11), reset MFA przez Administratora (SR-AUTH-13), zmiana roli między Administratorem a Edytorem; **automatycznie:** wykrycie ponownego użycia refresh tokenu poza oknem tolerancji (z audytem i alertem), 30 dni bez kontaktu | kończy sesje urządzenia i rodzinę refresh tokenów; **urządzenie zostaje zarejestrowane** (ten sam `deviceId`) | po `401 session_revoked`: ukrywa i usuwa dane domenowe (projekcję), **zachowuje zaszyfrowaną kolejkę, pliki oczekujące i sekret instalacji**; po ponownym pełnym zalogowaniu **tego samego użytkownika** (z MFA) wraca do tego samego `deviceId` i wysyła kolejkę; logowanie innego użytkownika wymaga wyczyszczenia (SR-MOB-13) |
| **Zablokuj i wyczyść** | kradzież, zgubienie, odejście pracownika bez synchronizacji, dezaktywacja konta, zmiana roli na Tylko odczyt (niżej); Administrator po alercie o ponownym użyciu refresh tokenu, gdy podejrzewa kradzież | unieważnia urządzenie na stałe i oznacza je do wyczyszczenia; Administrator przed wyborem widzi liczbę niewysłanych elementów (`pendingItemsReported`) i potwierdza ich utratę | przy następnym kontakcie dostaje `401 device_wipe_required` (proponowany kod — uwaga dla architekta) i usuwa bazę, klucz, sekret instalacji, media, kolejkę i cache miniatur; następne logowanie rejestruje nowe urządzenie (nowy `deviceId`) |

Dezaktywacja konta działa jak „Zablokuj i wyczyść” dla wszystkich urządzeń użytkownika: następne żądanie z urządzenia zwraca `401 device_wipe_required`, a z sesji web — `401 session_revoked`. Dlatego procedura odejścia (P7) zaczyna się od synchronizacji telefonu. Sygnał czyszczenia działa, dopóki serwer przechowuje rekord urządzenia (90 dni od unieważnienia — P4) — także przy próbie logowania z sekretem instalacji takiego urządzenia, niezależnie od poprawności hasła. Po 7 dniach offline telefon sam ukrywa dane, ale kolejki nie czyści.

**Reset hasła i MFA nie czyści telefonów.** Reset hasła (SR-AUTH-11) i reset MFA przez Administratora (SR-AUTH-13) od razu odcinają dostęp: kończą sesje web i sesje wszystkich urządzeń jak „Wyloguj urządzenie” (`401 session_revoked`). Urządzeń nie unieważniają na stałe, bo zapomniane hasło nie może kasować niewysłanych zdjęć. Ponowne logowanie nowym hasłem i MFA wraca do tego samego `deviceId` i wysyła kolejkę. Gdy reset wynika z podejrzenia przejęcia konta albo drugi czynnik zginął razem z telefonem, Administrator przegląda listę urządzeń użytkownika i nieznane lub utracone urządzenia czyści ręcznie trybem „Zablokuj i wyczyść”. Automatyczne czyszczenie przy resecie nie dawałoby dodatkowej ochrony: dostęp odcina już zakończenie sesji, a dane usuwa tylko niezmodyfikowana aplikacja (TM-03).

**Zmiana roli na Tylko odczyt — najpierw synchronizacja.** Rola Tylko odczyt nie ma dostępu do aplikacji mobilnej (P6, SR-AUTHZ-12): ponowne logowanie mobilne kończy się `403 channel_not_allowed`, więc kolejka zostałaby na telefonie bez możliwości wysłania. Dlatego zmiana roli na Tylko odczyt działa jak „Zablokuj i wyczyść” dla wszystkich urządzeń użytkownika: przed zapisem Administrator widzi `pendingItemsReported` każdego urządzenia (z czasem ostatniego kontaktu) i potwierdza utratę niewysłanych elementów, tak jak przy „Zablokuj i wyczyść”. Procedura: najpierw synchronizacja telefonu (0 niewysłanych elementów na liście urządzeń), potem zmiana roli — jak przy odejściu pracownika (P7). Zmiana roli między Administratorem a Edytorem działa jak „Wyloguj urządzenie”: nowa sesja ma nowe uprawnienia (SR-SESS-02), kolejka zostaje, a jej mutacje serwer autoryzuje wg bieżącej roli (SR-SYNC-02).

**Tożsamość urządzenia — ciągłość kolejki po ponownym logowaniu.** Idempotencja (`offline-sync.md` zasada 5, SR-SYNC-03) i sesje uploadu (SR-SYNC-08) są przypisane do pary `user_id` + `device_id`. Gdyby każde logowanie dawało nowy `deviceId`, po „Wyloguj urządzenie” mutacja zastosowana na serwerze bez odebranego wyniku wróciłaby jako `rejected: id_conflict` na listę „Wymaga uwagi”, wielogigabajtowy film byłby wysyłany od nowa, a każde logowanie zajmowałoby miejsce w limicie urządzeń. Dlatego:
1. **Rejestracja** (pierwsze logowanie na instalacji) — serwer wydaje `deviceId` i **sekret instalacji** (256 bitów z CSPRNG). Telefon trzyma sekret w Keystore (`expo-secure-store`, ta sama klasa co refresh token, poza kopiami — SR-MOB-02), serwer — tylko skrót.
2. **Ponowne pełne logowanie** (hasło + MFA) tego samego użytkownika na tej samej instalacji po „Wyloguj urządzenie” albo unieważnieniu automatycznym — aplikacja przedstawia `deviceId` i sekret instalacji. Gdy urządzenie należy do tego użytkownika i nie jest unieważnione, serwer przypina nową sesję do **tego samego `deviceId`** i kończy poprzednie sesje urządzenia. Rekordy idempotencji, sesje uploadu, stan synchronizacji i miejsce w limicie urządzeń są ciągłe: zaległa mutacja wraca jako `duplicate`, a film wznawia się od ostatniej potwierdzonej części.
3. **Sekret instalacji nie jest czynnikiem uwierzytelniania** — bez hasła i MFA niczego nie odblokowuje (SR-AUTH-14). Brak sekretu, niezgodny sekret albo urządzenie innego użytkownika → serwer rejestruje nowe urządzenie i zapisuje zdarzenie audytu.
4. **„Zablokuj i wyczyść”** unieważnia urządzenie na stałe; telefon usuwa sekret razem z danymi, więc następne logowanie tworzy nowy `deviceId`.

**Odświeżanie tokenu bez fałszywych alarmów.** Aplikacja na pierwszym planie i zadanie uploadu w tle mogą jednocześnie potrzebować nowego access tokenu, a przy słabym zasięgu odpowiedź na odświeżenie może nie dotrzeć do telefonu, który ponowi żądanie starym tokenem. Drugie użycie tego samego refresh tokenu wyglądałoby dla serwera jak kradzież (ADR-0005: unieważnienie rodziny tokenów). Dlatego:
- **telefon:** odświeżanie wykonuje **jeden proces w `sync-core`** (pierwszy plan i zadania w tle czekają na to samo odświeżenie; blokada w lokalnej bazie), a nowy refresh token jest zapisany trwale, zanim aplikacja użyje nowego access tokenu;
- **serwer:** **okno tolerancji 30 s** — bezpośrednio poprzedni refresh token przedstawiony ponownie w ciągu 30 s od rotacji, zanim którykolwiek jego następnik został użyty, daje nową parę tokenów bez wykrycia; pierwszy użyty następnik unieważnia pozostałe. Użycie unieważnionego tokenu poza tym wyjątkiem (także poprzedniego po 30 s) to ponowne użycie: serwer kończy rodzinę i sesje urządzenia jak w trybie „Wyloguj urządzenie”, zapisuje audyt i wysyła alert do Administratorów;
- najgorszy przypadek fałszywego alarmu (np. awaria telefonu między odebraniem a zapisem tokenu) to ponowne logowanie z MFA — **kolejka zostaje**, a urządzenie wraca do tego samego `deviceId`.

**Warianty**
| Obszar | Wariant | Konsekwencje |
|---|---|---|
| sesja web | **A. 60 min / 12 h** (rekomendacja) | logowanie raz dziennie, wylogowanie po godzinie bezczynności |
| | B. 30 min / 8 h | bezpieczniej na współdzielonych komputerach; częstsze logowanie |
| | C. 8 h / 24 h | wygoda; dłuższe okno dla przejętej sesji (TM-10, TM-23) |
| praca offline | **A. 7 dni** (rekomendacja) | długi weekend bez zasięgu nie ukrywa danych; skradziony telefon pokazuje dane do 7 dni, jeśli złodziej zna PIN |
| | B. 72 h | krótsze okno dla telefonu offline (RR-07 niżej); technik po długim weekendzie musi połączyć się z siecią przed pracą |
| | C. 14 dni | dłuższe okno ekspozycji przy kradzieży |
| kolejka po unieważnieniu | **A. dwa tryby** (rekomendacja) | „nic nie ginie” przy zwykłym wylogowaniu; pełne czyszczenie przy kradzieży |
| | B. zawsze czyść | najprościej; każde unieważnienie traci niewysłane zdjęcia (sprzeczne z zasadą „nic nie ginie”) |
| | C. zawsze zachowuj do ponownego logowania | skradziony telefon przechowuje zdjęcia klientów bezterminowo (zaszyfrowane, ale dostępne przy znanym PIN-ie) |
| unieważnienia automatyczne | **A. jak „Wyloguj urządzenie”** (rekomendacja) | fałszywy alarm nie kasuje kolejki; przy podejrzeniu kradzieży Administrator po alercie wybiera „Zablokuj i wyczyść” |
| | B. jak „Zablokuj i wyczyść” | fałszywe wykrycie ponownego użycia refresh tokenu kasuje niewysłane zdjęcia — sprzeczne z „nic nie ginie” |
| reset hasła i MFA | **A. jak „Wyloguj urządzenie”** (rekomendacja) | zapomniane hasło nie kasuje niewysłanych zdjęć; dostęp odcięty natychmiast; nieznane lub utracone urządzenia Administrator czyści ręcznie |
| | B. jak „Zablokuj i wyczyść” (dosłowne „unieważnienie urządzeń” z ADR-0005) | każdy reset hasła kasuje kolejkę na telefonach użytkownika — sprzeczne z „nic nie ginie”; bez dodatkowej ochrony, bo dostęp odcina już zakończenie sesji |
| zmiana roli na Tylko odczyt | **A. jak „Zablokuj i wyczyść” po potwierdzeniu `pendingItemsReported`** (rekomendacja) | procedura zaczyna się od synchronizacji telefonu; telefon bez dostępu do aplikacji nie przechowuje danych firmowych |
| | B. jak „Wyloguj urządzenie” | kolejka zostaje na telefonie bez możliwości wysłania (`403 channel_not_allowed`) — zdjęcia klientów przechowywane bez celu do ręcznego wyczyszczenia albo przywrócenia roli; niewysłane elementy łatwo przeoczyć |
| tożsamość urządzenia | **A. ten sam `deviceId` na tej samej instalacji** (sekret instalacji, rekomendacja) | idempotencja, sesje uploadu i limit urządzeń ciągłe; nowe pole w `Device` (skrót sekretu instalacji — zmiana *expand*, uwaga dla architekta) |
| | B. nowy `deviceId` przy każdym logowaniu | zaległe mutacje z odpowiedzią utraconą przed wylogowaniem wracają jako `rejected: id_conflict` na „Wymaga uwagi”; duże filmy wysyłane od nowa; lista urządzeń rośnie, każde logowanie zajmuje miejsce w limicie |
| okno tolerancji odświeżenia | **A. 30 s i jeden proces odświeżania** (rekomendacja) | wyścig pierwszego planu i zadania w tle ani utracona odpowiedź przy słabym zasięgu nie wylogowują technika; poprzedni refresh token przechwycony i użyty przez napastnika w ciągu 30 s daje mu dostęp tylko do chwili, gdy telefon pracownika odświeży token — wtedy wykrycie unieważnia całą rodzinę |
| | B. bez okna tolerancji | każde ponowne użycie wykrywane od razu; utracona odpowiedź na odświeżenie (częsta w garażach) wylogowuje technika w terenie — kolejka zostaje, ale potrzebne ponowne logowanie z MFA |
| równoległe sesje | **A. limity 5 / 2** (rekomendacja) | ograniczenie rozproszonych sesji; czasem trzeba wylogować stare urządzenie |
| | B. bez limitu | prościej; ASVS V7.1.2 wymaga tylko udokumentowania |

**Zgodność z ADR:** wartości ADR-0005 potwierdzone bez zmian. Doprecyzowane w ramach delegacji: limity równoległych sesji, lista step-up, 7 dni offline („ostateczna decyzja w EVM-005”), dwa tryby unieważnienia (ADR-0007: „postępowanie z niewysłanymi danymi — polityka w EVM-005”). Tryb „Wyloguj urządzenie” czyści dane domenowe zgodnie z ADR-0005 i zachowuje wyłącznie kolejkę. Doprecyzowania ADR-0005, które `solution-architect` po akceptacji zapisze jako adnotacje w ADR-0005 i ADR-0007 (bez zmiany decyzji):
- „każde logowanie mobilne rejestruje urządzenie” — rejestracja nowego urządzenia albo powrót do zarejestrowanego `deviceId` po weryfikacji sekretu instalacji;
- „użycie unieważnionego refresh tokenu → unieważnienie całej rodziny tokenów i urządzenia” — zakończenie rodziny i wszystkich sesji urządzenia (dostęp odcięty natychmiast, jak w ADR); trwałe unieważnienie z czyszczeniem — tylko „Zablokuj i wyczyść” (wybór Administratora, także przy zmianie roli na Tylko odczyt) i dezaktywacja;
- „po resecie unieważnienie wszystkich sesji i urządzeń” — zakończenie wszystkich sesji web i sesji urządzeń w trybie „Wyloguj urządzenie” (dostęp odcięty natychmiast, kolejka zostaje, ponowne logowanie nowym hasłem i MFA wraca do tego samego `deviceId`); tak samo przy resecie MFA przez Administratora (SR-AUTH-13);
- okno tolerancji 30 s dla bezpośrednio poprzedniego refresh tokenu.

**Wpływ:** TM-01, TM-02, TM-06, TM-10, TM-23, AB-03, AB-04, AB-09; SR-AUTH-11, SR-AUTH-13, SR-AUTHZ-09, SR-SESS-03, SR-SESS-04, SR-SESS-06, SR-SESS-08, SR-SESS-09, SR-MOB-04, SR-MOB-05, SR-MOB-13, SR-SYNC-01, SR-SYNC-03, SR-SYNC-08; epiki E1, E9, E10, E11; EVM-011 (ciągłość `deviceId` i kolejki na Androidzie); kontrakt — kod `401 device_wipe_required`, `deviceId` i sekret instalacji w logowaniu mobilnym, okno tolerancji odświeżenia, podsumowanie urządzeń (`pendingItemsReported`) i potwierdzenie w operacji zmiany roli na Tylko odczyt; model — skrót sekretu instalacji w `Device` (zmiana *expand*) — uwagi dla `solution-architect`.

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P3 — EXIF i GPS w zdjęciach i filmach
**Rekomendacja**
1. **Aplikacja mobilna nie prosi o uprawnienie lokalizacji** — aparat w aplikacji nie zapisuje współrzędnych GPS w zdjęciach i filmach; brak importu z galerii (ADR-0007).
2. **Pochodne zawsze bez metadanych** (miniatury 320 i 1600 px, klatka podglądu, wideo 720p): EXIF, XMP, IPTC i GPS usuwane po zastosowaniu orientacji (ADR-0009).
3. **Oryginały bez zmian** (bajt w bajt — niezmiennik SHA-256 i wartość dowodowa). Metadane, w tym GPS, mogą mieć tylko pliki wgrane przez przeglądarkę lub pochodzące od osób trzecich.
4. Oryginały pobierają tylko Administrator i Edytor (P6), z audytem i `Content-Disposition: attachment`; przy pobraniu UI ostrzega: „Plik może zawierać metadane, np. lokalizację. Do udostępnienia poza firmą użyj podglądu.”
5. **Poza firmę** (klient, administracja, OSD) udostępniamy podgląd 1600 px lub wideo 720p, nie oryginał.
6. Baza nie przechowuje GPS (zgodnie z modelem EVM-002 — brak kolumn lokalizacji w `MediaAsset`); serwer nie odczytuje współrzędnych.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** (wyżej) | brak GPS w plikach z telefonu; oryginały z przeglądarki mogą zawierać GPS, ale są dostępne wąsko; bez nowych zależności |
| B. Usuwanie EXIF/GPS także z oryginałów po stronie serwera (po skanie i weryfikacji SHA-256 worker zapisuje oczyszczoną kopię jako oryginał) | **(1)** zmiana niezmiennika — skrót pliku przestaje odpowiadać plikowi z telefonu (nowe pole skrótu kopii — zmiana *expand* w modelu); **(2)** bezstratne usuwanie z JPEG/HEIC wymaga nowej zależności (np. exiftool — Perl, licencja GPL/Artistic; sharp przekodowuje ze stratą), a z filmów — ffmpeg remux plików do 4 GB (czas, podwójne miejsce w trakcie); **(3)** wersja z GPS zostaje 30 dni w niezmiennych wersjach bucketu i 14 dni w snapshotach kopii; **(4)** utrata wartości dowodowej oryginału; koszt ok. 2–3 dni pracy + przegląd nowej zależności |
| C. Usuwanie w przeglądarce przed uploadem | nowa zależność w panelu, nie obejmuje wideo; przy wariancie A zbędne dla telefonu |
| D. Przechowywanie GPS jako dowodu miejsca wykonania prac (kolumny w `MediaAsset`, uprawnienie lokalizacji w aplikacji) | przydatne w sporach, ale to dane lokalizacyjne pracowników (monitoring, ocena DPIA, informacja dla pracowników BYOD) i większa ekspozycja przy wycieku; niezalecane w MVP |

**Zgodność z ADR:** ADR-0009 — „pipeline usuwa EXIF/GPS z pochodnych zawsze, a z oryginałów — jeśli tak zdecyduje polityka w EVM-005” → rekomendacja: oryginałów nie zmieniamy. ADR-0007 — brak uprawnień do biblioteki zdjęć. Bez zmiany ADR.

**Wpływ:** SR-FILE-08; aktywo A-04; epiki E6, E11; ASVS V14.2.8 (L3) — częściowo; `rodo.md` (minimalizacja, klauzula BYOD).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P4 — Retencja mediów, dokumentów, dzienników, audytu, logów i kopii
**Rekomendacja.** Okresy poniżej to konfiguracja (SR-PRIV-01), wspólna z [`rodo.md` → „Retencja”](rodo.md#retencja). Podstawy okresów biznesowych to szkic do potwierdzenia `[PRAWNIK/IOD]` — zastępuje odpowiedź na pytanie 7 z roadmapy („wymagany okres przechowywania dokumentacji”), dopóki Konrad nie poda innego.

| Kategoria | Okres | Liczony od | Po upływie |
|---|---|---|---|
| Zlecenie z danymi powiązanymi (zakres, procesy, etapy, płatności, dziennik, media, dokumenty, przypisania) | 6 lat | końca roku kalendarzowego, w którym zlecenie zamknięto | purge zlecenia z encjami podrzędnymi i plikami |
| Zlecenie anulowane przed akceptacją (nigdy w stanie `accepted`) | 12 miesięcy | anulowania | purge |
| Klient | do końca retencji jego ostatniego zlecenia; klient bez zleceń — 12 miesięcy | utworzenia (bez zleceń) | anonimizacja |
| Lokalizacja i ładowarki | do końca retencji ostatniego zlecenia w lokalizacji | — | anonimizacja albo purge |
| Strona — organizacja | bez limitu (dane firmy); przegląd co 2 lata | — | — |
| Strona — osoba fizyczna i osoba kontaktowa | 2 lata | ostatniego zlecenia, w którym występuje | anonimizacja pól osobowych |
| Dokumenty z kotwicą klienta lub lokalizacji | jak klient albo lokalizacja | — | purge |
| Konto pracownika | 2 lata | dezaktywacji | anonimizacja e-maila i nazwy (identyfikator zostaje w polach `*_by`) |
| Sesje | 30 dni | wygaśnięcia lub unieważnienia | usunięcie |
| Urządzenia i stan synchronizacji | 90 dni | unieważnienia albo ostatniego kontaktu | usunięcie |
| Dane uwierzytelniające (hasła, sekrety TOTP, kody, passkeys, tokeny) | do zmiany, usunięcia lub wygaśnięcia | — | usunięcie |
| Dziennik audytu | 2 lata | zdarzenia | usunięcie partiami |
| Klucze idempotencji | 30 dni | zapisu | usunięcie |
| Dziennik zmian synchronizacji i znaczniki usunięcia | 90 dni | zapisu | usunięcie |
| Rejestr usunięć (identyfikatory purge, anonimizacji i redakcji; poza bazą) | 40 dni | zapisu | usunięcie (lifecycle) |
| Logi operacyjne (Grafana Cloud) | 14 dni | zapisu | usunięcie u dostawcy |
| Metryki | 14 dni | zapisu | usunięcie u dostawcy |
| Błędy (Sentry) | 30 dni | zdarzenia | usunięcie u dostawcy |
| Logi lokalne na VM (w tym dostępowe z pełnym IP) | 7 dni | zapisu | rotacja |
| Media w kwarantannie | 30 dni | kwarantanny | usunięcie |
| Niedokończone uploady | 7 dni | rozpoczęcia | usunięcie (lifecycle) |
| Stare wersje obiektów w buckecie mediów | 30 dni | zastąpienia lub usunięcia | wygaśnięcie (lifecycle) |
| Kopie bazy (PITR) i ich niezmienne wersje | 30 dni / 37 dni | wykonania | wygaśnięcie (lifecycle) |
| Kopia mediów — snapshoty Storage Box | 14 dni | snapshotu | usunięcie |
| Kopie dysku systemowego VM | 7 dni | wykonania | usunięcie |
| Pliki eksportu ZIP | 24 h | utworzenia | usunięcie (lifecycle) |
| Dane na telefonie (projekcja) | do wyjścia z zakresu (zlecenie zamknięte ponad 30 dni temu) | — | usunięcie z urządzenia; ukrycie po 7 dniach offline |
| Oryginały oczekujące na telefonie | do potwierdzenia `clean` przez serwer | — | usunięcie z urządzenia |

- **Archiwum wideo** (decyzja Konrada 2 z EVM-001): oryginały filmów starsze niż 12 miesięcy przechodzą do tańszej klasy storage'u — to zmiana klasy, nie retencji.
- **Wdrożenie:** retencja danych technicznych (sesje, urządzenia, klucze, dziennik zmian, kwarantanna, eksporty) od pierwszego wydania (E1, E8); retencja danych biznesowych i audytu — zadanie retencji przed pierwszym terminem (najwcześniej 12 miesięcy po starcie produkcji — zlecenia anulowane przed akceptacją), planowo M4 („polityki retencji i archiwizacji” w roadmapie); do tego czasu procedura ręczna Administratora (SR-DATA-07).
- Wymóg dla modelu: rozpoznanie „anulowane przed akceptacją” — z wpisów dziennika `event` (`work_order_status_changed`) albo nowej kolumny `acceptedAt` (zmiana *expand*) — uwaga dla `solution-architect`.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. 6 lat** od końca roku zamknięcia (rekomendacja) | pokrywa typowe przedawnienie roszczeń z umowy, rękojmię dla prac w budynku (do 5 lat) i przepisy podatkowe `[PRAWNIK/IOD]`; koszt storage'u rośnie liniowo przez 6 lat, potem się stabilizuje |
| B. 10 lat | dłuższe archiwum (np. roszczenia deliktowe do 10 lat) `[PRAWNIK/IOD]`; ok. 1,7× więcej danych w stanie ustalonym niż przy 6 latach — wyższy koszt storage'u i większa ekspozycja przy wycieku |
| C. 3 lata dla mediów, 6 lat dla danych zlecenia | niższy koszt (media to większość storage'u); brak zdjęć przy późnej reklamacji lub sporze |
| D. Jedna retencja dla wszystkich zleceń (także anulowanych przed akceptacją) | prostsze zadanie retencji; dane osób, które nie zostały klientami, przechowywane 6 lat — sprzeczne z minimalizacją |
| E. Audyt dłużej niż 2 lata (np. 6 lat jak zlecenia) | pełna historia korekt płatności przez cały okres zlecenia; dłużej przechowywane IP i aktywność pracowników |

**Zgodność z ADR:** ADR-0013 (logi 14 dni, błędy 30 dni, lokalne 7 dni, audyt „≥ 2 lata, do potwierdzenia w EVM-005”) — potwierdzone; ADR-0009 (kwarantanna 30, wersje 30, niedokończone uploady 7, okresy retencji dokumentacji — EVM-005); ADR-0003 i ADR-0011 (PITR 30, object lock 37, snapshoty 14, VM 7); ADR-0004 i ADR-0008 (30 i 90 dni). Bez zmiany ADR.

**Wpływ:** SR-DATA-07, SR-DATA-08, SR-PRIV-01, SR-PRIV-04; RR-14; epiki E1, E8, M4; `rodo.md` (retencja, rejestr czynności).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P5 — Skanowanie plików
**Rekomendacja**
1. **Każdy plik** (zdjęcie, film, dokument; z telefonu i z przeglądarki) przechodzi skan ClamAV (`clamd`) przed udostępnieniem; do stanu `clean` nikt go nie pobierze. **Fail-closed:** niedostępny `clamd` = oczekiwanie i ponowienie, nigdy pominięcie.
2. **Konfiguracja `clamd`:** `MaxFileSize` i `StreamMaxLength` na maksimum, które ClamAV skanuje (pliki powyżej 2 GB ClamAV pomija), `MaxScanSize 4000M`, `MaxRecursion 16`, `MaxFiles 10000`, `AlertExceedsMax yes` (przekroczenie limitu w archiwum, np. DOCX = kwarantanna), `AlertOLE2Macros yes`, `AlertEncryptedArchive yes`, `AlertEncryptedDoc no` (zaszyfrowane PDF-y od OSD i urzędów są normalne).
3. **Filmy:** aplikacja nagrywa 1080p z bitrate **≤ 8 Mb/s** (30 min ≈ 1,8 GB) — każdy film z telefonu mieści się w limicie skanu. Pliki > 2 GB (możliwe tylko z przeglądarki): walidacja strukturalna ffprobe (kontener MP4/MOV, kodeki H.264/HEVC i AAC, czas ≤ 30 min, brak nietypowych strumieni), w przeglądarce tylko podgląd 720p z piaskownicy, oryginał wyłącznie jako załącznik z oznaczeniem „nie skanowany AV — za duży” (SR-FILE-12); metryka, bez alertu.
4. **Kwarantanna:** 30 dni, plik niedostępny, alert do Administratorów (w e-mailu tylko link do panelu, bez nazwy pliku); przyczyna widoczna tylko w panelu; usunięcie automatyczne.
5. **Fałszywe alarmy:** Administrator ze step-upem może zlecić **ponowny skan** pliku z kwarantanny (np. po aktualizacji sygnatur) — czysty wynik przywraca plik do przepływu; brak ręcznego „zwolnienia” bez skanu. **Nigdy nie wysyłamy plików klientów do zewnętrznych serwisów** (np. VirusTotal, zgłoszenia próbek do producenta sygnatur).
6. **Sygnatury:** `freshclam` co najmniej co 2 h; alert, gdy sygnatury starsze niż 24 h (ADR-0009); po 72 h alert codzienny; skan działa dalej na starszych sygnaturach (nie wyłączamy go).
7. **Niezgodność typu** (zawartość ≠ rozszerzenie lub deklaracja) → kwarantanna `type_mismatch`; archiwa, SVG, HTML i pliki z makrami (`.docm`, `.xlsm`) poza listą dozwolonych.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** — bitrate ≤ 8 Mb/s, pliki > 2 GB z walidacją strukturalną | wszystkie filmy z telefonu skanowane; rzadkie duże filmy z przeglądarki bez skanu AV, ale tylko jako załącznik i podgląd z piaskownicy; bitrate do potwierdzenia pomiarem w EVM-011 (jakość obrazu) |
| B. Limit przesyłanych filmów 2 GB (odrzucenie większych) | każdy plik skanowany; zmiana limitu 4 GB z ADR-0009 i decyzji Konrada 3 z EVM-001 — wymaga nowego ADR (pytanie do Konrada) |
| C. Bitrate ~10 Mb/s jak w ADR-0009 | lepsza jakość; filmy z telefonu dłuższe niż ok. 25 min przekraczają 2 GB i nie są skanowane |
| D. Ręczne zwolnienie z kwarantanny bez skanu | szybsze odblokowanie fałszywego alarmu; Administrator może wpuścić złośliwy plik |
| E. Skan w zewnętrznym serwisie (np. VirusTotal) | **niedopuszczalny** — przekazanie danych klientów podmiotowi trzeciemu (ADR-0009, RODO) |

**Zgodność z ADR:** ADR-0009 — ClamAV w kontenerze bez sieci, kwarantanna 30 dni, alert sygnatur > 24 h, „limit rozmiaru skanowanego pliku dla bardzo dużych filmów — do weryfikacji w EVM-005/EVM-011”, bitrate opisany jako przybliżony (~10 Mb/s). Rekomendacja doprecyzowuje limit i bitrate — bez zmiany ADR (wariant B wymagałby ADR).

**Wpływ:** SR-FILE-05, SR-FILE-12, SR-FILE-03; TM-34, TM-38, AB-05; epiki E6, E11; EVM-011 (pomiar bitrate, czasu skanu i jakości).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P6 — Zakres danych dla roli Tylko odczyt
**Rekomendacja — komórki „EVM-005” z macierzy uprawnień** ([`domain-model.md` → „Macierz encja × operacja × rola”](../architecture/domain-model.md#macierz-encja--operacja--rola))
| Komórka | Tylko odczyt (R) | Uwagi |
|---|---|---|
| `PaymentMilestone` — odczyt i lista | **tak** — wszystkie pola (kwota, nr faktury, terminy, status, „po terminie”), bez zmian | pytanie P2 z EVM-002 — zgodnie z rekomendacją `product-owner` (księgowość, wspólnik) |
| eksport i masowe pobranie: `Customer`, `Site`, `Charger`, `Party`, `WorkOrder`, `PaymentMilestone`, `Document` | **nie** | Edytor też **nie** — eksport danych tylko Administrator ze step-upem (raporty dla R — decyzja w M4) |
| `MediaAsset` — pobranie oryginału | **nie** — miniatury, podgląd 1600 px i wideo 720p | Administrator i Edytor — tak, z audytem |
| `MediaAsset` — eksport ZIP | **nie** | Administrator i Edytor wg macierzy EVM-002, z limitami i powiadomieniem (P10) |
| `Document`, `DocumentVersion` — pobranie pliku `standard` | **tak**, z audytem | np. protokoły odbioru dla księgowości |
| `Document` — pobranie pliku `building_security` | **nie** (tylko metadane) | projekty, ekspertyzy, opinie ppoż — bezpieczeństwo budynków |
| `Document` — pobranie pliku `identity_data` | **nie** (tylko metadane) | PESEL, numer dowodu, podpis |
| aplikacja mobilna | **nie** — reguła rola × kanał w `identity` (SR-AUTHZ-12): logowanie mobilne i każde żądanie tokenem mobilnym → `403 channel_not_allowed` (proponowany kod — uwaga dla architekta). `x-evia-authz.channels` ogranicza operacje, nie role | minimalizacja danych na telefonach; zmiana roli na Tylko odczyt czyści urządzenia użytkownika po potwierdzeniu niewysłanych elementów (P2) |
| pola ukryte (`hiddenFields`) | brak w v1 — R widzi wszystkie pola metadanych | ograniczenia dotyczą plików, eksportu i kanału |

- **Pozostałe komórki „EVM-005” w macierzy** (nie dotyczą zakresu roli): `User` — anonimizacja konta po 2 latach od dezaktywacji (P4, procedura w [`rodo.md`](rodo.md#realizacja-praw-osób-art-1522)); `AuditEvent` — retencja 2 lata (P4).
- **Płatności poza telefonem** (pytanie P3 z EVM-002): potwierdzamy — technicy nie przyjmują płatności, etapy płatności nie trafiają na urządzenia. Gdyby to się zmieniło — osobna decyzja w M2 (na telefon tylko kwota do zapłaty).
- **Klasa poufności pojedynczego dokumentu** (uwaga 8 z EVM-002): klasę dokumentu można **podnieść, nigdy obniżyć** poniżej klasy rodzaju. Propozycja dla modelu (zmiana *expand*): `Document.confidentialityOverride` (puste albo `building_security` / `identity_data`), klasa efektywna = maksimum z rodzaju i nadpisania w porządku `standard` < `building_security` < `identity_data`; ustawia Administrator albo Edytor, zmiana audytowana. Przy rodzaju `other` UI pyta: „Czy dokument zawiera PESEL lub numer dokumentu tożsamości?” (tak → `identity_data`).
- **Zdjęcia dokumentów tożsamości:** nie robimy (instrukcja — SR-PRIV-10); zdjęcie zrobione omyłkowo Administrator usuwa (purge pliku z zachowaniem rekordu — redakcja).
- **Historia lokalizacji** (uwaga 5 z EVM-002): każdy element autoryzowany zleceniem źródłowym, bez `identity_data`, tylko w panelu (SR-AUTHZ-08).

**Warianty**
| Obszar | Wariant | Konsekwencje |
|---|---|---|
| płatności | **A. R widzi** (rekomendacja) | księgowość korzysta z systemu |
| | B. R nie widzi | zestawienie nieopłaconych tylko dla Administratora i Edytora; księgowość poza systemem |
| dokumenty `standard` | **A. R pobiera** (rekomendacja) | wspólnik i księgowość widzą protokoły i warunki przyłączenia |
| | B. tylko metadane | R mniej przydatna |
| oryginały mediów | **A. nie** (rekomendacja) | podglądy wystarczają do wglądu; mniejsza ekspozycja metadanych (P3) |
| | B. tak | R prawie jak Edytor bez zmian; więcej kopii oryginałów na komputerach |
| aplikacja mobilna | **A. nie** (rekomendacja) | mniej danych na prywatnych telefonach |
| | B. tak (podgląd) | dane na kolejnych urządzeniach (RR-08) |
| poufność dokumentu | **A. podniesienie klasy pojedynczego dokumentu** (rekomendacja) | zmiana *expand* w modelu (nowa kolumna opcjonalna) |
| | B. tylko ostrzeżenie przy `other` | bez zmiany modelu; skuteczność zależy od dyscypliny (AB-20) |

**Zgodność z ADR:** ADR nie przesądza zakresu ról; model EVM-002 (D12) deleguje komórki „EVM-005”. Bez zmiany ADR.

**Wpływ:** SR-AUTHZ-06, SR-AUTHZ-07, SR-AUTHZ-08, SR-AUTHZ-12, SR-FILE-09; AB-08, AB-19, AB-20; epiki E1, E6, E7, E9; model — `Document.confidentialityOverride`, reguła rola × kanał i kod `403 channel_not_allowed` (uwagi dla `solution-architect`).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P7 — Telefony i BYOD
**Rekomendacja**
1. **Wymagania techniczne sprawdzane przez aplikację** (bez MDM):
   - **włączona blokada ekranu** (PIN, hasło, wzór lub biometria) — sprawdzana przy logowaniu (bez niej logowanie odrzucone) oraz **przy każdym uruchomieniu i wznowieniu aplikacji**, bo refresh token żyje do 30 dni, a blokadę można wyłączyć po zalogowaniu; wyłączona blokada → dane zleceń ukryte jak po 7 dniach offline (SR-MOB-05: aparat i kolejka działają, nic nie jest usuwane) do ponownego włączenia blokady;
   - Android 10 lub nowszy (ADR-0007, decyzja 4 z EVM-001);
   - **poziom poprawek bezpieczeństwa — próg i tryb z serwera** (`meta/client-config`, zmiana bez nowej wersji aplikacji): tryb **„tylko ostrzegaj”** (na start) — ostrzeżenie dla pracownika przy poprawkach starszych niż 6 miesięcy, wyraźne ostrzeżenie powyżej 12 miesięcy, oznaczenie urządzenia na liście urządzeń Administratora; tryb **„blokuj”** — poprawki starsze niż 12 miesięcy → logowanie odrzucone; zalogowane urządzenie, które przekroczy próg, dostaje ostrzeżenie, a blokada działa przy następnym pełnym logowaniu (technik nie traci dostępu w trakcie pracy w terenie, kolejka zostaje). Tryb „blokuj” włączamy **po spisie floty** decyzją Konrada (pytanie niżej), z 30-dniowym uprzedzeniem pracowników;
   - instalacja wyłącznie z Google Play (ścieżka testów wewnętrznych); jedna instalacja = jeden użytkownik.
   - Kontrole po stronie aplikacji to higiena, nie granica bezpieczeństwa (zmodyfikowana aplikacja je pominie — MAS-R poza zakresem, TM-03); dane chroni autoryzacja na serwerze i szyfrowanie lokalne.
2. **Blokada aplikacji** biometrią lub PIN-em systemowym po 5 min w tle — **domyślnie włączona** (bramka UI, nie chroni kluczy — ADR-0007).
3. **Uprawnienia aplikacji:** aparat i mikrofon (nagrywanie filmu); bez lokalizacji, kontaktów, galerii i plików poza sandboxem.
4. **Czyszczenie danych firmowych:** zdalnie — P2 „Zablokuj i wyczyść”; lokalnie — przycisk „Wyczyść dane firmowe” (z ostrzeżeniem o niewysłanych elementach); odinstalowanie usuwa wszystko.
5. **Utrata lub kradzież:** pracownik zgłasza Administratorowi **od razu** (telefonicznie); Administrator wybiera „Zablokuj i wyczyść” i ocenia naruszenie wg [`rodo.md` → „Naruszenia”](rodo.md#procedura-naruszeń-72-h).
6. **Odejście pracownika:** przed ostatnim dniem — synchronizacja (0 niewysłanych elementów na liście urządzeń), potem dezaktywacja konta (czyści wszystkie urządzenia) i odinstalowanie aplikacji; zwrot telefonu firmowego.
7. **Prywatność pracownika:** zbieramy tylko model urządzenia, wersję systemu, poziom poprawek, wersję aplikacji, czasy kontaktu i IP; nie śledzimy lokalizacji, nie czytamy innych aplikacji, telemetria bez danych osobowych; klauzula informacyjna BYOD i regulamin ([`rodo.md`](rodo.md#obowiązek-informacyjny)).
8. **Telefony firmowe:** te same zasady; MDM (Android Enterprise) — opcja na później.

**Konsekwencja progu poprawek — pytanie do Konrada.** Decyzja 4 z EVM-001, ADR-0007 i NFR („Platformy”) obiecują wsparcie „Android 10+”. Część telefonów z Androidem 10–12 — zwłaszcza starsze i tańsze modele prywatne (BYOD) — nie dostaje już poprawek bezpieczeństwa od producenta. Tryb „blokuj” odrzuci takie telefony mimo zgody na „Android 10+”, czyli w praktyce podniesie minimalne wymaganie ponad wersję systemu, a technik z takim telefonem nie zaloguje się w terenie. Dlatego na start tylko ostrzegamy i zbieramy dane (model, wersja systemu, poziom poprawek — lista urządzeń), a blokadę włączamy świadomie.
- **Pytanie:** czy po spisie floty włączamy tryb „blokuj” (poprawki starsze niż 12 miesięcy), akceptując wymianę takich telefonów albo telefon firmowy dla tych osób?
- **Rekomendacja:** tak — pilotaż w trybie „tylko ostrzegaj”, spis floty z listy urządzeń najpóźniej przed udostępnieniem M2 wszystkim technikom, potem „blokuj” z 30-dniowym uprzedzeniem; telefon bez poprawek → telefon firmowy albo wymiana.
- **Konsekwencja innego wyboru:** „tylko ostrzegaj” na stałe — dane klientów na telefonach ze znanymi podatnościami (w tym obejściami blokady ekranu używanymi przez narzędzia śledcze); RR-07 i RR-08 do ponownej oceny (wyższe prawdopodobieństwo dla telefonów bez poprawek). „Blokuj” od pierwszego wydania — ryzyko, że część techników nie zaloguje się pierwszego dnia pilotażu.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** — wymagania sprawdzane przez aplikację, bez MDM; próg poprawek na start „tylko ostrzegaj”, „blokuj” po spisie floty | ochrona bez ingerencji w prywatny telefon; nie wymusimy szyfrowania urządzenia ani wymazania całego telefonu (RR-08); do włączenia blokady telefony bez poprawek przetwarzają dane klientów (ostrzeżenie i oznaczenie na liście urządzeń) |
| B. Dane klientów tylko na telefonach firmowych | koszt zakupu telefonów; możliwy MDM; mniej sporów o prywatność |
| C. MDM z profilem służbowym (Android Enterprise) na BYOD | wymazanie profilu służbowego, wymuszenie polityk; koszt licencji EMM i wdrożenia, ingerencja w prywatne telefony |
| D. Tylko regulamin, bez sprawdzania przez aplikację | telefony bez blokady ekranu i aktualizacji przetwarzają dane klientów (RR-07, RR-08 rosną do High) |
| E. Blokada aplikacji opcjonalna (wyłączona domyślnie) | szybsze otwieranie; odblokowany telefon pozostawiony bez nadzoru pokazuje dane |
| F. Jak A, ale próg poprawek „blokuj” od pierwszego wydania | telefony bez poprawek odcięte od razu — także te objęte zgodą „Android 10+”; technik może nie zalogować się w terenie, zanim dostanie inny telefon |

**Zgodność z ADR:** decyzja Konrada 4 z EVM-001 (flota mieszana, BYOD — polityka w EVM-005), ADR-0007 (blokada ekranu wymagana polityką, biometria tylko jako bramka UI, Android 10+). Minimalna wersja systemu bez zmian, a tryb „tylko ostrzegaj” nie zawęża wspieranych telefonów — bez zmiany ADR. Tryb „blokuj” w praktyce zawęża „Android 10+” do telefonów z aktualnymi poprawkami, dlatego jest osobną decyzją Konrada (pytanie wyżej); po jego włączeniu `solution-architect` dopisuje adnotację w ADR-0007 i w wierszu „Platformy” NFR.

**Wpływ:** SR-MOB-03, SR-MOB-04, SR-MOB-05, SR-MOB-06, SR-MOB-12, SR-PRIV-05, SR-PRIV-10; RR-07, RR-08; AB-03, AB-04; epiki E9, E14, E8; kontrakt — próg i tryb poprawek w `meta/client-config`; model — poziom poprawek w `Device` (zmiana *expand*) — uwagi dla `solution-architect`.

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P8 — Przypinanie certyfikatów (MASVS-NETWORK-2)
**Rekomendacja:** **bez przypinania w MVP.** W zamian:
- aplikacja nie ufa certyfikatom CA dodanym przez użytkownika (domyślne zachowanie Androida 7+, jawnie w `network_security_config`), ruch nieszyfrowany zabroniony;
- rekord DNS **CAA** dopuszczający tylko Let's Encrypt, **DNSSEC** (jeśli rejestrator wspiera), **monitoring Certificate Transparency** z powiadomieniem e-mail o nowym certyfikacie dla domeny (bezpłatna usługa monitoringu CT), MFA i blokada transferu u rejestratora (SR-INFRA-12).

**Dlaczego:** certyfikaty Let's Encrypt są krótkotrwałe, a jego pośrednie CA się zmieniają; błąd przypinania blokuje aplikację w terenie razem z kolejką offline do czasu aktualizacji (OTA wyłączone — ADR-0007), co jest sprzeczne z zasadą „nic nie ginie”. Zysk z przypinania — ochrona przed fałszywym certyfikatem od innego zaufanego CA — jest mały i pokrywa go monitoring CT.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** — bez przypinania, CAA + CT | brak ryzyka zablokowania aplikacji; MITM wymaga fałszywego certyfikatu (wykrywany przez CT) |
| B. Przypinanie klucza (SPKI) naszego certyfikatu + klucz zapasowy | silniejsze; wymaga stałego klucza w Caddy i procedury rotacji; błąd = aplikacja bez połączenia |
| C. Przypinanie do kluczy CA Let's Encrypt (główne ISRG) | mniejsze ryzyko blokady niż B; aktualizacja aplikacji przy zmianie hierarchii LE; do ponownej oceny przed sign-off M2 |

**Zgodność z ADR:** ADR-0007 — „przypinanie certyfikatów (MASVS-NETWORK-2) — decyzja w EVM-005”. Bez zmiany ADR.

**Wpływ:** SR-COMM-04, SR-INFRA-12; TM-53, TM-68; epiki E9, EVM-007.

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P9 — Format adresu IP w sesjach, audycie i logach
**Rekomendacja**
| Miejsce | Format | Retencja |
|---|---|---|
| limity żądań (pamięć procesu) | pełny IP | nie zapisywany |
| `Session.ipAddress` | pełny IP (widoczny dla użytkownika na liście własnych sesji) | z sesją — 30 dni po jej końcu |
| `AuditEvent.ipAddress` | **prefiks**: IPv4 /24 (np. `203.0.113.0/24`), IPv6 /48; pełny IP przez `sessionId`, dopóki istnieje sesja | 2 lata |
| logi lokalne na VM (Caddy, aplikacja) | pełny IP | 7 dni |
| logi i metryki w Grafana Cloud | prefiks /24 i /48 (redakcja w Alloy) | 14 dni |
| Sentry | bez IP (`sendDefaultPii: false`, wyłączony zapis IP po stronie serwera) | — |

**Dlaczego:** pełny IP jest potrzebny w pierwszych dniach reakcji na incydent (logi lokalne, sesje); w długim okresie (audyt 2 lata) wystarczy prefiks; przed wysyłką do podmiotów z USA (regiony UE) — minimalizacja.

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** | dochodzenia do ok. 30 dni z pełnym IP; dalej — prefiks |
| B. Pełny IP w audycie przez 2 lata | lepsze dochodzenia po czasie; więcej danych pracowników przechowywanych dłużej |
| C. Pseudonim IP (HMAC z rotowanym kluczem) w audycie | korelacja „to samo IP” bez ujawnienia adresu; kolejny sekret i złożoność |

**Zgodność z ADR:** ADR-0013 — „adresy IP skrócone lub pseudonimizowane (decyzja w EVM-005)”; model EVM-002 — `ipAddress` „wg EVM-005”. Bez zmiany ADR.

**Wpływ:** SR-LOG-02, SR-LOG-03; TM-49, TM-86; epiki E1, EVM-007, EVM-008; `rodo.md` (inwentaryzacja).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P10 — Limity żądań, progi masowego odczytu, podpisanych URL-i i eksportów
**Rekomendacja**
| Parametr | Wartość | Uwagi |
|---|---|---|
| żądania per IP (wszystkie) | **1200 / min** | biuro za NAT — wielu użytkowników z jednego IP; `api-guidelines.md` proponował 600 / min |
| żądania nieuwierzytelnione per IP (poza logowaniem) | 60 / min | |
| logowanie i MFA | 20 prób / min / IP + limity per konto | ADR-0005 |
| żądania per użytkownik | 300 / min | ADR-0004 |
| wyszukiwanie | 60 / min / użytkownik | `api-guidelines.md` |
| **masowy odczyt** (rekordy zwrócone przez listy i wyszukiwanie) | alert: > 2000 rekordów w 10 min **albo** > 300 różnych klientów w 1 h; blokada `429`: > 10 000 rekordów w 10 min | po 30 dniach pilota kalibracja: próg alertu = max(wartość startowa, 3 × p99 użytkowników) |
| podpisane URL-e — miniatury i podglądy | 1000 / 10 min / użytkownik (alert od 600) | galeria dużego zlecenia (scenariusz C) |
| podpisane URL-e — oryginały i dokumenty | 100 / 10 min / użytkownik (alert od 50) | doprecyzowanie przykładu „300 / 10 min” z ADR-0009 na dwie kategorie |
| eksport ZIP mediów zlecenia | 1 / 10 min, maks. 5 / dzień / użytkownik, ≤ 10 GB; plik dostępny 24 h; e-mail do Administratorów o każdym eksporcie | ADR-0009; Tylko odczyt — brak (P6) |
| eksport danych (CSV/XLSX, M4) | tylko Administrator ze step-upem | P6 |
| synchronizacja | partia ≤ 50 mutacji, mutacja ≤ 64 KB, strona zmian ≤ 1 MB | ADR-0008, `offline-sync.md` |

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** | blokady tylko przy wyraźnym nadużyciu; alerty wcześniej |
| B. Niższe limity (np. oryginały 30 / 10 min, 600 / min / IP) | szybsze wykrycie; częstsze fałszywe blokady w pracy biura |
| C. Same alerty, bez blokad | brak przerw w pracy; masowe pobranie wykrywane po fakcie (AB-08) |

**Zgodność z ADR:** ADR-0004 (300 / min / użytkownik; limit per IP — wartość w EVM-005), ADR-0005 (logowanie), ADR-0009 (limity podane jako przykłady — doprecyzowanie), ADR-0013 (alerty masowych pobrań). Bez zmiany ADR.

**Wpływ:** SR-API-02, SR-FILE-09, SR-FILE-10, SR-LOG-07; TM-22, AB-08, RR-13; epiki E1, E2, E3, E6, E11; zmiana wartości per IP w `api-guidelines.md` (uwaga dla `solution-architect`).

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P11 — Wartości CSP i HSTS
**Rekomendacja — panel (Caddy, EVM-008)**
```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://<domena-bucketu>; media-src 'self' blob: https://<domena-bucketu>; connect-src 'self' https://<domena-bucketu> https://<ingest-sentry-ue>; font-src 'self'; manifest-src 'self'; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Frame-Options: DENY
```
- **API:** `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` oraz nagłówki z [`api-guidelines.md` → „Nagłówki”](../architecture/api-guidelines.md#nagłówki) (`Cache-Control: no-store` i inne).
- `<domena-bucketu>` i `<ingest-sentry-ue>` — konkretne hosty ustala EVM-007/EVM-008 (bez symboli wieloznacznych szerszych niż jedna subdomena dostawcy).
- `style-src 'self'`: jeśli biblioteka komponentów wstrzykuje elementy `<style>` w czasie działania, EVM-008 dodaje hash lub nonce; `'unsafe-inline'` wyłącznie dla stylów i tylko jako zapisany wyjątek.
- Później (opcje): Trusted Types (najpierw w trybie raportowania), raportowanie naruszeń CSP.
- **HSTS preload** — nie na start: obejmuje wszystkie subdomeny i trudno go wycofać; decyzja po wyborze domeny (EVM-007).

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** | pełna zgodność z ASVS V3.4 dla L2 |
| B. `style-src 'self' 'unsafe-inline'` od początku | prostsza integracja bibliotek UI; dopuszcza wstrzyknięcie CSS (niskie ryzyko) |
| C. HSTS preload od razu | ochrona już przy pierwszej wizycie; praktycznie nieodwracalne przez miesiące, dotyczy wszystkich subdomen |

**Zgodność z ADR:** ADR-0006 (CSP bez `unsafe-inline`/`unsafe-eval`, `connect-src 'self'` + domena storage'u i error trackingu, `frame-ancestors 'none'`), ADR-0011 (HSTS `max-age=31536000; includeSubDomains`), `api-guidelines.md` („wartości wg EVM-005”). Bez zmiany ADR.

**Wpływ:** SR-WEB-01, SR-WEB-02, SR-WEB-08, SR-API-03; TM-08, TM-09, TM-75; EVM-008.

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## P12 — Szyfrowanie pól (`platform/crypto`) i widoki `evia_readonly`
**Rekomendacja**
1. **`platform/crypto`** (AES-256-GCM kopertowo, wersja klucza w szyfrogramie) w MVP stosujemy do **sekretów TOTP** (muszą być odwracalne — skrót niemożliwy) — E1. Hasła, kody odzyskiwania i tokeny przechowujemy jako skróty; klucze publiczne passkeys bez szyfrowania.
2. **Pól danych osobowych w MVP nie szyfrujemy** — model nie ma pól PESEL ani numerów dokumentów; dane chronią LUKS, kontrola dostępu, audyt i minimalizacja. Szyfrowanie pola jest **obowiązkowe**, gdy pojawi się: PESEL, numer dokumentu tożsamości, kody do bram lub alarmów, dane o zdrowiu — z przeglądem `security-engineer` i ewentualnym indeksem HMAC do wyszukiwania.
3. **Klucz główny** w menedżerze sekretów, osobny per środowisko, rotacja co 12 miesięcy (nowa wersja szyfruje, stare odszyfrowują, przeszyfrowanie w tle) i po incydencie (SR-CRYPTO-04).
4. **`evia_readonly`:** rola istnieje, ale **bez żadnych uprawnień w MVP** (deny-by-default) — nikt nie potrzebuje bezpośredniego odczytu bazy; raporty idą przez API z autoryzacją. W M4 (raporty) — wyłącznie widoki w osobnym schemacie raportowym **bez kolumn z danymi osobowymi** (agregaty, identyfikatory, statusy, kwoty, daty), każdy widok po przeglądzie security.
5. **Dostęp administracyjny do bazy** (incydent, naprawa danych): tylko tunel SSH i rola migracyjna, z wpisem w dzienniku operacji runbooka (kto, kiedy, po co).

**Warianty**
| Wariant | Konsekwencje |
|---|---|
| **A. Rekomendacja** | mała złożoność; wyszukiwanie z polskimi znakami działa bez zmian |
| B. Szyfrowanie pól DO-K (telefon, e-mail, adres) już w MVP | ochrona przed zrzutem bazy (np. SQL injection); utrata wyszukiwania trigramowego po tych polach (tylko dokładne dopasowanie przez HMAC), więcej kodu |
| C. `evia_readonly` z widokami od razu (np. dla arkusza księgowości) | wygoda; drugi kanał dostępu do danych poza autoryzacją aplikacji i audytem |

**Zgodność z ADR:** ADR-0003 — `platform/crypto` „włączamy, jeśli EVM-005 wskaże pola wrażliwe”; `evia_readonly` „tylko wybrane widoki”; model EVM-002 — „tylko widoki uzgodnione w EVM-005”. Bez zmiany ADR.

**Wpływ:** SR-CRYPTO-02, SR-AUTH-07, SR-INFRA-03, SR-DATA-02; TM-31; epiki E1, M4.

**Decyzja Konrada:** przyjęta rekomendacja (2026-10-03, demo EVM-005).

## Do przekazania po decyzjach
| Dla | Co |
|---|---|
| `solution-architect` | wiersze NFR „do potwierdzenia w EVM-005” w [`../architecture/README.md`](../architecture/README.md#wymagania-niefunkcjonalne--wartości-docelowe) (MFA, sesje, offline, audyt); w `api-guidelines.md` — limit per IP (P10), kod `401 device_wipe_required`, `deviceId` i sekret instalacji w logowaniu mobilnym oraz okno tolerancji odświeżenia (P2), próg i tryb poprawek w `meta/client-config` (P7), wartości CSP/HSTS (P11), reguła `x-evia-authz.channels` (obowiązkowe, wartość wyjściowa `[web]`, lista operacji `mobile`) i kod `403 channel_not_allowed` (SR-AUTHZ-12, P1, P6); w `domain-model.md` — komórki „EVM-005” (P6), `Document.confidentialityOverride` (P6), w `Device` skrót sekretu instalacji (P2) i poziom poprawek (P7), format `ipAddress` (P9), rozpoznanie zleceń anulowanych przed akceptacją (P4); w `offline-sync.md` — „Otwarte — EVM-011”, punkty 1–2 (P2); adnotacje w ADR-0005 i ADR-0007 — tożsamość urządzenia i unieważnienia automatyczne (P2), tryb „blokuj” poprawek po decyzji Konrada (P7) |
| `mobile-developer` (EVM-011, E9) | weryfikacja obu trybów unieważnienia i ciągłości `deviceId` po ponownym logowaniu (`duplicate` zamiast `id_conflict`, wznowienie uploadu), jednego procesu odświeżania tokenu (pierwszy plan i zadanie w tle), bitrate ≤ 8 Mb/s (P5), brak uprawnienia lokalizacji (P3), sprawdzanie blokady ekranu przy uruchomieniu i wznowieniu oraz progu poprawek z `client-config` (P7) |
| `devops-engineer` (EVM-006, EVM-007) | bramki CI z [`requirements.md`](requirements.md#bramki-bezpieczeństwa-ci-ac5), CAA/DNSSEC/CT i DMARC (P8), redakcja IP w Alloy (P9), tożsamość agentów (GitHub App) i wymagana akceptacja PR (RR-02, RR-11), kanał wdrożenia (SR-INFRA-14), tożsamość testu odtworzenia (RR-20), rejestr usunięć poza bazą (SR-PRIV-04) |
| `product-owner` (EVM-010) | wplecenie `SR-…` i wartości polityk w AC historyjek M1 |
