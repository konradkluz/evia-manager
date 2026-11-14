# Runbook: naruszenie ochrony danych (72 h) i spotkanie z checklistą

> Dokument żywy (EVM-064 AC3). Właściciel: `security-engineer`; prowadzi Konrad (osoba odpowiedzialna). Wymagania: SR-PRIV-07; procedura: [`rodo.md` → „Procedura naruszeń (72 h)”](../../security/rodo.md#procedura-naruszeń-72-h) (kroki 1–7 i przykłady oceny). Procedura operacyjna, nie porada prawna.

## 1. Karta incydentu
Kartę zakładasz w **rejestrze naruszeń** poza repozytorium ([`rodo.md` → „Rejestry poza repozytorium”](../../security/rodo.md#rejestry-poza-repozytorium)) od razu przy zgłoszeniu — także gdy okaże się, że zgłoszenia do UODO nie będzie.

| # | Krok | Termin | Odhacz / zapisz |
|---|---|---|---|
| 1 | Wykrycie, zgłoszenie do Konrada (telefonicznie), ustalenie **T0** (chwila, gdy z rozsądną pewnością wiemy o naruszeniu) | od razu | data i godzina T0, kto zgłosił (rola), źródło |
| 2 | Ograniczenie skutków — sekcja 2 | godziny od T0 | wykonane działania i godziny |
| 3 | Ocena ryzyka dla osób — sekcja 3 | T0 + 48 h | kategorie danych, przybliżona liczba osób, wynik: brak / ryzyko / wysokie |
| 4 | Zgłoszenie do Prezesa UODO, gdy jest ryzyko | **T0 + 72 h** (można uzupełniać etapami; po terminie — z wyjaśnieniem opóźnienia) | data, numer zgłoszenia albo uzasadnienie braku zgłoszenia |
| 5 | Zawiadomienie osób, gdy ryzyko jest wysokie | bez zbędnej zwłoki | data, kanał, liczba osób (bez danych) |
| 6 | Wpis w rejestrze naruszeń (fakty, skutki, działania, uzasadnienie decyzji) | przy zamknięciu | — |
| 7 | Wnioski: przyczyna, poprawki (`/refine`), aktualizacja modelu zagrożeń | do 2 tygodni | identyfikatory historyjek |

## 2. Ograniczenie skutków — ściąga
| Sytuacja | Działanie (Administrator, panel — chyba że zaznaczono) |
|---|---|
| Zgubiony lub skradziony komputer albo telefon z sesją panelu | Administracja → Użytkownicy → „Wyloguj ze wszystkich sesji” (stare ciasteczko daje `401 session_revoked`); klucz dostępu na tym urządzeniu (np. Windows Hello) — „Zresetuj drugi krok…” po zmianie hasła z innego urządzenia ([tryb awaryjny i reset drugiego kroku](aktywacja-i-tryb-awaryjny.md#reset-drugiego-kroku-pracownika-w-panelu-evm-027--kiedy-nie-używać-polecenia-serwerowego)) |
| Telefon z aplikacją mobilną (M2) | Urządzenia → „Zablokuj i wyczyść” (P2, P7) |
| Podejrzenie przejęcia konta albo były pracownik | dezaktywacja konta (sesje kończą się od razu) |
| Utrata dostępu Administratora | [tryb awaryjny](aktywacja-i-tryb-awaryjny.md) |
| Wyciek sekretu, klucza lub tokenu | [rotacja sekretów](../rotacja-sekretow.md), [rotacja sekretów kanału](rotacja-sekretow-kanalu.md) |
| Zabezpieczenie dowodów | dziennik audytu (Administrator, step-up): logowania, pobrania, eksporty od chwili utraty; logi na VM rotują po 7 dniach, w Grafanie po 14 — `devops-engineer` eksportuje je przed rotacją (bez kopiowania do repozytorium i do agentów — RR-93) |

## 3. Ocena ryzyka — pytania
1. Jakie dane: klasa dokumentów (`identity_data` = PESEL, dowód, podpis), zdjęcia wnętrz i garaży, dane kontaktowe?
2. Ile osób (rząd wielkości) i czy są wśród nich osoby szczególnie narażone?
3. Czy dane były zaszyfrowane (dysk, SQLCipher na telefonie), a klucz lub hasło bezpieczne? Czy urządzenie miało blokadę ekranu?
4. Jak długo trwał możliwy dostęp (od utraty do zakończenia sesji) i czy dziennik audytu pokazuje działania w tym czasie?
5. Skutki dla osób: kradzież tożsamości, szkoda majątkowa (np. informacja o zabezpieczeniach domu), naruszenie prywatności domu.

Wynik: **brak ryzyka** (tylko rejestr), **ryzyko** (zgłoszenie do UODO), **wysokie ryzyko** (zgłoszenie i zawiadomienie osób; wyjątki z art. 34 ust. 3, np. dane skutecznie zaszyfrowane). Przykłady: [`rodo.md`](../../security/rodo.md#procedura-naruszeń-72-h).

## 4. Dokument „poza systemem” (SR-PRIV-07)
Jedna strona przygotowana przez Konrada, **wydrukowana w biurze** i zapisana jako notatka w menedżerze haseł — dostępna także wtedy, gdy panel, VM albo poczta nie działają. W repozytorium są tylko nagłówki; wartości wyłącznie w dokumencie.

| Pozycja | Wartość |
|---|---|
| Dane administratora i osoba prowadząca | w dokumencie |
| Kontakt bezpieczeństwa / zgłoszeń: Hetzner, Scaleway, Grafana Labs, GitHub, OVH (rejestrator i DNS) | w dokumencie (z kont dostawców i ich stron „security / abuse”) |
| Zgłoszenie do Prezesa UODO: e-formularz (biznes.gov.pl), skrzynka ePUAP UODO, wzór formularza ze strony uodo.gov.pl, adres pocztowy | w dokumencie — adresy sprawdzone w dniu przygotowania |
| CERT Polska — zgłoszenie incydentu (phishing, ransomware) | w dokumencie |
| Kto z biura ma dostęp do dokumentu i gdzie jest wydruk | w dokumencie |
| Data ostatniej aktualizacji | w dokumencie — przegląd co 12 miesięcy i przy zmianie dostawcy |

## 5. Spotkanie z checklistą (AC3)
Jedno spotkanie przed pierwszymi realnymi danymi klientów (decyzja 2026-11-12 — zamiast ćwiczenia tabletop). Uczestnicy: Konrad (prowadzi), osoba z biura; ok. 45 minut. Protokół: [`docs/qa/EVM-064/protokoly.md` → „AC3”](../../qa/EVM-064/protokoly.md#ac3--spotkanie-z-checklistą-naruszenia); wnioski Konrad lub orkiestrator wpisuje do historyjki EVM-064.

**Scenariusz:** piątek, 17:00. Pracownik biura (Edytor) zgłasza, że zostawił laptop firmowy w pociągu. W przeglądarce była otwarta karta panelu (sesja do 60 min bezczynności, najwyżej 12 h), Windows Hello jest kluczem dostępu konta, w „Pobranych” może być pełnomocnictwo klienta i eksport ZIP zdjęć.

Przejdźcie kroki karty (sekcja 1) i odpowiedzcie na pytania:
- [ ] **Krok 1.** Kto i jak zgłasza (numer telefonu Konrada znany biuru)? Kiedy jest T0? Kto zakłada kartę incydentu i gdzie jest rejestr naruszeń?
- [ ] **Krok 2.** Kto i w ile minut kończy sesje konta („Wyloguj ze wszystkich sesji”)? Czy pracownik zmienia hasło z innego urządzenia, zanim Administrator zresetuje drugi krok? Czy laptop da się zablokować lub wyczyścić zdalnie (konto Microsoft — „Znajdź moje urządzenie”)?
- [ ] **Krok 2 — dowody.** Czy Administrator umie znaleźć w dzienniku audytu pobrania i eksporty konta po godzinie utraty?
- [ ] **Krok 3.** Czy dysk laptopa jest zaszyfrowany (BitLocker / „Szyfrowanie urządzenia”) i czy ekran blokuje się hasłem? Jakie pliki mogły być w „Pobranych”? Jaki wynik oceny w wariancie „zaszyfrowany” i „niezaszyfrowany z pełnomocnictwem”?
- [ ] **Krok 4.** Gdzie jest formularz UODO i kto go wypełnia? Czy zdążymy w 72 h przy T0 w piątek wieczorem (weekend)?
- [ ] **Krok 5.** Jak zawiadamiamy klientów (kanał, treść prostym językiem) i kto to robi?
- [ ] **Krok 6–7.** Co trafia do rejestru; jakie poprawki (np. szyfrowanie dysków laptopów biura, czyszczenie „Pobranych”)?
- [ ] **Dokument „poza systemem”** (sekcja 4) istnieje, jest wydrukowany i zawiera kontakty dostawców oraz formularz UODO.
