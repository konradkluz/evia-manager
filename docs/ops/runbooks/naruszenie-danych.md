# Runbook: naruszenie ochrony danych (72 h) i spotkanie z checklistą

> Dokument żywy (EVM-064 AC3). Właściciel: `security-engineer`; prowadzi Konrad (osoba odpowiedzialna). Wymagania: SR-PRIV-07; procedura: [`rodo.md` → „Procedura naruszeń (72 h)”](../../security/rodo.md#procedura-naruszeń-72-h) (kroki 1–7 i przykłady oceny). Procedura operacyjna, nie porada prawna.

## 1. Karta incydentu
Kartę zakładasz w **rejestrze naruszeń** poza repozytorium ([`rodo.md` → „Rejestry poza repozytorium”](../../security/rodo.md#rejestry-poza-repozytorium)) od razu przy zgłoszeniu — także gdy okaże się, że zgłoszenia do UODO nie będzie.

| # | Krok | Termin | Odhacz / zapisz |
|---|---|---|---|
| 1 | Wykrycie, zgłoszenie do Konrada (telefonicznie), ustalenie **T0** (chwila, gdy z rozsądną pewnością wiemy o naruszeniu) | od razu | data i godzina T0, kto zgłosił (rola), źródło |
| 2 | Ograniczenie skutków — sekcja 2 | godziny od T0 | wykonane działania i godziny |
| 3 | Ocena ryzyka dla osób — sekcja 3 | T0 + 48 h | kategorie danych, przybliżona liczba osób, wynik: mało prawdopodobne (z pisemnym uzasadnieniem) / ryzyko / wysokie |
| 4 | Zgłoszenie do Prezesa UODO — **zawsze, chyba że pisemnie uzasadnimy, że ryzyko jest mało prawdopodobne** | **T0 + 72 h** (w razie wątpliwości zgłoszenie wstępne, potem uzupełnienie; po terminie — z wyjaśnieniem opóźnienia) | data, numer zgłoszenia i urzędowe poświadczenie odbioru albo uzasadnienie braku zgłoszenia |
| 5 | Zawiadomienie osób, gdy ryzyko jest wysokie — niezależnie od zgłoszenia do UODO | bez zbędnej zwłoki | data, kanał, liczba osób (bez danych) |
| 6 | Wpis w rejestrze naruszeń (fakty, skutki, działania, uzasadnienie decyzji) | przy zamknięciu | — |
| 7 | Wnioski: przyczyna, poprawki (`/refine`), aktualizacja modelu zagrożeń | do 2 tygodni | identyfikatory historyjek |

**Zgłoszenie do UODO zawiera (art. 33 ust. 3):** (a) charakter naruszenia, kategorie i przybliżoną liczbę osób oraz kategorie i przybliżoną liczbę wpisów danych; (b) imię i nazwisko oraz kontakt osoby odpowiedzialnej (punkt kontaktowy — firma nie ma IOD); (c) możliwe konsekwencje; (d) środki zastosowane lub proponowane, w tym minimalizujące skutki. **Zawiadomienie osób (art. 34 ust. 2):** jasnym i prostym językiem charakter naruszenia oraz elementy (b)–(d); przy ujawnieniu PESEL dodaj zdanie: „Zalecamy zastrzeżenie numeru PESEL (np. w aplikacji mObywatel albo w urzędzie gminy) i włączenie alertów o zapytaniach kredytowych (np. w BIK).”

## 2. Ograniczenie skutków — ściąga
| Sytuacja | Działanie (Administrator, panel — chyba że zaznaczono) |
|---|---|
| Zgubiony lub skradziony komputer albo telefon z sesją panelu | Administracja → Użytkownicy → „Wyloguj ze wszystkich sesji” (stare ciasteczko daje `401 session_revoked`); klucz dostępu na tym urządzeniu (np. Windows Hello) — „Zresetuj drugi krok…” po zmianie hasła z innego urządzenia ([tryb awaryjny i reset drugiego kroku](aktywacja-i-tryb-awaryjny.md#reset-drugiego-kroku-pracownika-w-panelu-evm-027--kiedy-nie-używać-polecenia-serwerowego)) |
| Telefon z aplikacją mobilną (M2) | Urządzenia → „Zablokuj i wyczyść” (P2, P7) |
| Podejrzenie przejęcia konta albo były pracownik | dezaktywacja konta (sesje kończą się od razu) |
| Utrata dostępu Administratora | [tryb awaryjny](aktywacja-i-tryb-awaryjny.md) |
| Zdjęcia klientów w prywatnej chmurze technika (warunek 6 [DPIA](../../security/dpia.md#5-wniosek)) | karta w rejestrze naruszeń; technik usuwa kopie z chmury i kosza w obecności Administratora i potwierdza to na oświadczeniu; ocena ryzyka (kto ma dostęp do konta chmury, czy były udostępniane) |
| Wyciek sekretu, klucza lub tokenu | [rotacja sekretów](../rotacja-sekretow.md), [rotacja sekretów kanału](rotacja-sekretow-kanalu.md) |
| Zabezpieczenie dowodów | dziennik audytu (Administrator, step-up): logowania, pobrania, eksporty od chwili utraty; logi na VM rotują po 7 dniach, w Grafanie po 14 — `devops-engineer` eksportuje je przed rotacją (bez kopiowania do repozytorium i do agentów — RR-93) |

## 3. Ocena ryzyka — pytania
1. Jakie dane: klasa dokumentów (`identity_data` = PESEL, dowód, podpis), zdjęcia wnętrz i garaży, dane kontaktowe?
2. Ile osób (rząd wielkości) i czy są wśród nich osoby szczególnie narażone?
3. Czy dane były zaszyfrowane (dysk, SQLCipher na telefonie), a klucz lub hasło bezpieczne? Czy urządzenie miało blokadę ekranu?
4. Jak długo trwał możliwy dostęp (od utraty do zakończenia sesji) i czy dziennik audytu pokazuje działania w tym czasie?
5. Skutki dla osób: kradzież tożsamości, szkoda majątkowa (np. informacja o zabezpieczeniach domu), naruszenie prywatności domu.

Wynik: **ryzyko mało prawdopodobne** (tylko rejestr — wyłącznie z pisemnym uzasadnieniem w karcie; art. 33 ust. 1, ciężar wykazania po naszej stronie), **ryzyko** (zgłoszenie do UODO), **wysokie ryzyko** (zgłoszenie i zawiadomienie osób; wyjątki z art. 34 ust. 3, np. dane skutecznie zaszyfrowane). **Zgłaszamy zawsze, chyba że umiemy pisemnie uzasadnić, że ryzyko jest mało prawdopodobne; w razie wątpliwości zgłaszamy (wstępnie, potem uzupełnienie).** Ujawnienie numeru PESEL z imieniem i nazwiskiem traktujemy jako wysokie ryzyko: zgłoszenie i zawiadomienie osób; przy takim naruszeniu warto jednorazowo skonsultować zgłoszenie z prawnikiem. Zawiadomienia osób nie uzależniamy od zgłoszenia do UODO. Przykłady: [`rodo.md`](../../security/rodo.md#procedura-naruszeń-72-h).

## 4. Dokument „poza systemem” (SR-PRIV-07)
Jedna strona przygotowana przez Konrada, **wydrukowana w biurze** i zapisana jako notatka w menedżerze haseł — dostępna także wtedy, gdy panel, VM albo poczta nie działają. W repozytorium są tylko nagłówki; wartości wyłącznie w dokumencie.

| Pozycja | Wartość |
|---|---|
| Dane administratora i osoba prowadząca | w dokumencie |
| Kontakt bezpieczeństwa / zgłoszeń: Hetzner, Scaleway, Grafana Labs, GitHub, OVH (rejestrator i DNS) | w dokumencie (z kont dostawców i ich stron „security / abuse”) |
| Zgłoszenie do Prezesa UODO: e-formularz na biznes.gov.pl (podpis kwalifikowany albo Profil Zaufany; zachowaj urzędowe poświadczenie odbioru), papierowy wzór formularza ze strony uodo.gov.pl i adres pocztowy (zachowaj kopię i dowód nadania) — kanały sprawdzone 2026-11-14: https://uodo.gov.pl/pl/525/2582 · https://www.biznes.gov.pl/pl/portal/ou889 | w dokumencie — adresy sprawdzone w dniu przygotowania |
| CERT Polska — zgłoszenie incydentu (phishing, ransomware) | w dokumencie |
| Kto z biura ma dostęp do dokumentu i gdzie jest wydruk | w dokumencie |
| Data ostatniej aktualizacji | w dokumencie — przegląd co 12 miesięcy i przy zmianie dostawcy |

## 5. Spotkanie z checklistą (AC3)
Jedno spotkanie — niezwłocznie, najpóźniej do 2026-11-28 (środowisko przyjmuje realne dane od 2026-11-13 — RR-93; decyzja 2026-11-12 — zamiast ćwiczenia tabletop). Uczestnicy: Konrad (prowadzi), osoba z biura; ok. 45 minut. Protokół: [`docs/qa/EVM-064/protokoly.md` → „AC3”](../../qa/EVM-064/protokoly.md#ac3--spotkanie-z-checklistą-naruszenia); wnioski Konrad lub orkiestrator wpisuje do historyjki EVM-064.

**Scenariusz:** piątek, 17:00. Pracownik biura (Edytor) zgłasza, że zostawił laptop firmowy w pociągu. W przeglądarce była otwarta karta panelu (sesja do 60 min bezczynności, najwyżej 12 h), Windows Hello jest kluczem dostępu konta, w „Pobranych” może być pełnomocnictwo klienta i eksport ZIP zdjęć.

Przejdźcie kroki karty (sekcja 1) i odpowiedzcie na pytania:
- [ ] **Krok 1.** Kto i jak zgłasza (numer telefonu Konrada znany biuru)? Kiedy jest T0? Kto zakłada kartę incydentu i gdzie jest rejestr naruszeń?
- [ ] **Krok 2.** Kto i w ile minut kończy sesje konta („Wyloguj ze wszystkich sesji”)? Czy pracownik zmienia hasło z innego urządzenia, zanim Administrator zresetuje drugi krok? Czy laptop da się zablokować lub wyczyścić zdalnie (konto Microsoft — „Znajdź moje urządzenie”)?
- [ ] **Krok 2 — dowody.** Czy Administrator umie znaleźć w dzienniku audytu pobrania i eksporty konta po godzinie utraty?
- [ ] **Krok 3.** Czy dysk laptopa jest zaszyfrowany (BitLocker / „Szyfrowanie urządzenia”) i czy ekran blokuje się hasłem? Jakie pliki mogły być w „Pobranych”? Jaki wynik oceny w wariancie „zaszyfrowany” i „niezaszyfrowany z pełnomocnictwem”?
- [ ] **Krok 4.** Gdzie jest formularz UODO i kto go wypełnia? Czy zdążymy w 72 h przy T0 w piątek wieczorem (weekend)? Konrad ma działający Profil Zaufany (albo podpis kwalifikowany); po wysłaniu zachowujemy urzędowe poświadczenie odbioru.
- [ ] **Krok 5.** Jak zawiadamiamy klientów (kanał, treść prostym językiem) i kto to robi?
- [ ] **Krok 6–7.** Co trafia do rejestru; jakie poprawki (np. szyfrowanie dysków laptopów biura, czyszczenie „Pobranych”)?
- [ ] **Dokument „poza systemem”** (sekcja 4) istnieje, jest wydrukowany i zawiera kontakty dostawców oraz formularz UODO.
