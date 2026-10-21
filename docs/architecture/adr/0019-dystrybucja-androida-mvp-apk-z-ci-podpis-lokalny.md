# ADR-0019: Dystrybucja Androida na MVP — APK z CI (niepodpisany) + podpis lokalny, sideload; Google Play i EAS Submit odroczone

- **Status:** Proponowana (do akceptacji Konrada)
- **Data:** 2026-10-20
- **Decydent:** Konrad (akceptacja) · **Autor:** solution-architect
- **Powiązane:** EVM-009 (decyzje Konrada 2026-10-20), EVM-011, EVM-007; ADR-0007 (częściowo zmienia — „Buildy i dystrybucja”: EAS Build/Submit, Google Play), ADR-0012 (częściowo zmienia — akapit „Aplikacja mobilna”), ADR-0015 (iOS odłożony), ADR-0016 (K7), ADR-0018; SR-MOB-07, SR-MOB-11, SR-SUPPLY-08, SR-INFRA-05; RR-21, TM-58, TM-59

## Kontekst i problem
ADR-0007 i ADR-0012 zakładały dystrybucję przez **EAS Build/Submit** i **Google Play** (Play App Signing, ścieżka testów wewnętrznych). Konrad nie ma kont Google Play ani Expo/EAS (ograniczenia kont zewnętrznych), a iOS jest odłożony (ADR-0015). Pierwsze instalacje na telefonach firmy muszą być możliwe bez sklepu: **sideload APK** budowanego w CI.

Powstaje pytanie, **gdzie leży klucz podpisu**. Na GitHub Free (ADR-0016, ADR-0018) każdy sekret repozytorium odczyta workflow z dowolnej gałęzi (RR-21: wypchnięta kluczem wdrożeniowym agentów lub przez złośliwy pakiet). Bez Google Play **nie ma resetu klucza**: wyciek jest nieodwracalny, a utrata klucza oznacza **nową aplikację** na telefonach — odinstalowanie kasuje lokalną bazę i kolejkę offline (od M2 to utrata danych terenowych).

## Kryteria decyzji
**Kryterium blokujące (K0):** klucz podpisu nie jest dostępny dla workflowu uruchomionego z dowolnej gałęzi.

| Kryterium | Waga (1–5) | Uzasadnienie |
|---|---|---|
| Ochrona klucza przed przejętą gałęzią, workflowem i stacją | 5 | wyciek = złośliwa „aktualizacja” na telefonach techników, bez unieważnienia |
| Koszt i konta zewnętrzne | 4 | brak kont Google Play/Expo, budżet |
| Zgodność z ograniczeniami (GitHub Free, K7 „bez wyjątków”, ADR-0018 „zero sekretów”) | 4 | spójność z ADR-0016 i ADR-0018 |
| Prostota i narzut operacyjny | 3 | jedna osoba, kilka wydań w miesiącu |
| Odwracalność | 3 | powrót do sklepu bez przebudowy |

## Rozważane opcje
1. **(A) Sekrety GitHuba:** job `mobile-sign` na `main` podpisuje kluczem z czterech sekretów repozytorium (wariant przygotowany w pierwszym przebiegu EVM-009; wymagał wyjątku od K7).
2. **(B) Podpis lokalny:** CI buduje niepodpisany APK i publikuje jego SHA-256, gałąź i commit; Konrad podpisuje go na swoim komputerze (`tools/mobile-apk` `sign`), klucz w Bitwarden z MFA i kopią offline. Wejście podpisu jest związane z SHA-256 z przebiegu na `main`, a wynik z przypiętym odciskiem certyfikatu.
3. **(C) Google Play z Play App Signing (EAS Submit lub ręczny upload):** klucz podpisujący trzyma Google; u nas tylko klucz wysyłania (upload key), który można zresetować.

## Ocena
| Kryterium (waga) | (A) | (B) | (C) |
|---|---|---|---|
| **K0 (blokujące)** | **nie** — klucz w sekretach czytelny z dowolnej gałęzi | tak | tak |
| Ochrona klucza (5) | 1 | 4 | 5 |
| Koszt i konta (4) | 5 | 5 | 2 |
| Zgodność z ograniczeniami (4) | 2 | 5 | 2 |
| Prostota (3) | 4 | 3 | 3 |
| Odwracalność (3) | 2 | 4 | 5 |
| **Suma ważona** | 5+20+8+12+6 = 51 | 20+20+20+9+12 = 81 | 25+8+8+9+15 = 65 |

(C) jest bezpieczniejsze, ale niewykonalne bez kont, których Konrad nie ma, i nie jest potrzebne dla kilkunastu telefonów firmy; (A) odpada na K0.

## Decyzja
Wybieramy **(B) — APK z CI bez klucza i podpis lokalny przez Konrada**; Google Play i EAS Submit są **odroczone** (iOS nadal odłożony, ADR-0015). CI nie ma żadnego sekretu podpisu (`tools/repo-policy` pilnuje reguły „`secrets.` wyłącznie w `renovate.yml`”), instalację przeprowadza administrator (USB/plik), a ekran „Aktualizacja wymagana” nie ma przycisku pobrania. Procedura: `docs/ops/dystrybucja-apk-android.md`.

Zakres zmiany względem poprzednich ADR (bez przepisywania ich treści; obie decyzje zachowują klasę „trwały” i swój status): ADR-0007 — „Buildy i dystrybucja bez Maca” dla Androida zastępuje lokalny build Gradle w CI po `expo prebuild`, a EAS Update zostaje wyłączone; ADR-0012 — wiersz „klucze podpisu: wyłącznie w EAS lub w sekretach CI” i mitygacja „Play App Signing” nie obowiązują na MVP.

## Konsekwencje
- **Pozytywne:** klucz nigdy nie trafia do GitHuba (zgodnie z ADR-0016 K7 i ADR-0018); zero kosztów i kont; gotowy plan wyjścia.
- **Negatywne / koszty:** ręczny krok przy każdym wydaniu (ok. 2 minuty); brak automatycznych aktualizacji — administrator instaluje każdą wersję; sideload jest jedynym kanałem, więc rośnie ryzyko fałszywego APK z phishingu (mitygacja: instalacja wyłącznie przez administratora, cofnięcie uprawnienia „Instalowanie nieznanych aplikacji”, porównanie SHA-256 pliku i certyfikatu).
- **Ryzyka:** (1) **utrata klucza = nowa aplikacja** i odinstalowanie (kasuje bazę i kolejkę offline) — dwie kopie klucza (Bitwarden + offline), ważność ≥ 25 lat, synchronizacja kolejki przed odinstalowaniem; (2) **klucz na stacji Konrada** (TM-58): odtwarzany poza repozytorium na czas podpisu, hasła wyłącznie przez zmienne środowiskowe, agenci nie podpisują; (3) **podpis zmienionego artefaktu lub złym kluczem:** skrypt wymaga `--expect-sha256` z przebiegu na `main` i weryfikuje paczkę przed podpisem, a **przypięty odcisk certyfikatu** (`--expected-cert-sha256`) ogranicza podpis niewłaściwym kluczem lub aliasem (aktualizacja takiej paczki nie zainstaluje się na telefonach); (4) planowana rotacja przez linię rotacji APK Signature Scheme v3 (`apksigner rotate`).
- **Wpływ na AC EVM-009:** AC5 (paczka podpisana lokalnie, CI bez sekretów) — zmiana zapisana w historyjce przez Konrada 2026-10-20.

## Plan wyjścia
Migracja do Google Play: założenie konta, **Play App Signing** — ten sam klucz można zarejestrować jako klucz aplikacji (przeniesienie) albo użyć go jako klucza wysyłania (upload key) i pozwolić Google podpisywać nową linią; potem EAS Submit lub ręczny upload paczki z CI. Warunki powrotu: większa liczba telefonów, potrzeba automatycznych aktualizacji, wymóg sklepu, utrata kontroli nad ręczną dystrybucją. Nie wymaga zmiany kodu aplikacji ani identyfikatora `pl.eviacharge.manager`.

## Do akceptacji
Konrad: akceptacja ADR-0019 (po akceptacji status „Zaakceptowana” oraz notki „częściowo zmieniona” w ADR-0007 i ADR-0012 i w indeksie); nie zmieniamy statusów ADR-0007 i ADR-0012 do tego czasu.
