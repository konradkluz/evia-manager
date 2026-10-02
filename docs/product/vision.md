# Wizja produktu — EVia Manager

## Problem
EVia Charge realizuje zlecenia o dużej zmienności: od samego montażu ładowarki klienta, przez instalację z dedykowanym obwodem i zwiększeniem mocy przyłączeniowej, po pełny proces przyłączeniowy w garażach podziemnych budynków wielorodzinnych (dokumentacja od administracji, ekspertyza, opinia ppoż, projekt, uzgodnienia z OSD, zgody). Informacje o statusach, płatnościach, kontaktach i dokumentacji (zdjęcia, filmy, pisma) są rozproszone — trudno szybko odpowiedzieć: *na jakim etapie jest zlecenie, na kogo czekamy, co jest nieopłacone, gdzie są zdjęcia*.

## Cel
Jedno źródło prawdy o klientach, zleceniach, etapach, płatnościach i dokumentacji — w biurze (panel web) i w terenie (aplikacja mobilna działająca bez zasięgu).

## Rezultaty biznesowe i mierniki
| Rezultat | Miernik (cel) |
|---|---|
| Pełna ewidencja | 100% nowych zleceń prowadzonych w systemie od startu MVP |
| Kontrola statusów | Dla każdego zlecenia widać etap, „na kogo czekamy” i od kiedy; 0 zleceń bez aktywności dłużej niż ustalony próg bez oznaczenia |
| Kontrola płatności | Lista nieopłaconych i przeterminowanych etapów płatności w < 10 s |
| Kompletna dokumentacja | Zdjęcia i filmy z terenu trafiają do archiwum zlecenia automatycznie; 0 utraconych plików |
| Szybkość pracy | Znalezienie dokumentacji zlecenia < 1 min; utworzenie zlecenia z szablonu < 3 min |

## Użytkownicy i role
| Persona | Kontekst | Rola na start |
|---|---|---|
| Właściciel / kierownik | przegląd całości, decyzje, płatności, użytkownicy | Administrator |
| Koordynator (biuro) | zakłada zlecenia, prowadzi procesy z OSD i administracją, pilnuje płatności | Edytor |
| Technik / monter (teren) | zdjęcia, filmy, wpisy z montażu, szybkie zakładanie zleceń | Edytor (w M4 rozważymy rolę „Monter”) |
| Podgląd (np. księgowość, wspólnik) | wgląd bez zmian | Tylko odczyt |

- **Administrator** — pełny dostęp, w tym zarządzanie użytkownikami i rolami, konfiguracja, archiwizacja/usuwanie.
- **Edytor** — dodaje, edytuje i aktualizuje klientów, zlecenia, etapy, płatności, wpisy i media.
- **Tylko odczyt** — wgląd w dane bez możliwości zmian.
- Później: Monter (tylko przypisane zlecenia), partnerzy zewnętrzni (projektant, rzeczoznawca), portal klienta, deweloper.

## Zakres docelowy (ekosystem)
- **Panel web:** klienci, zlecenia (zakres składany z katalogu usług i szablonów), procesy i etapy, płatności etapowe, dziennik i komentarze, galeria i dokumenty, raporty, administracja użytkownikami i konfiguracją.
- **Aplikacja mobilna (iOS / Android):** te same konta; zlecenia dostępne offline; zdjęcia i filmy z automatycznym uploadem po odzyskaniu zasięgu; wpisy i komentarze offline; szybkie zakładanie zleceń.
- **API / backend:** wspólne dla obu klientów, bezpieczne i audytowalne.
- **Później:** integracje (system fakturowy z KSeF, e-mail, kalendarz, formularz ze strony www), portal klienta, inwestycje deweloperskie, projekty DC.

## Zasady produktu
1. **Status na pierwszy rzut oka** — etap, na kogo czekamy, co po terminie, co nieopłacone.
2. **Nic nie ginie** — zwłaszcza dane z terenu (offline, trwała kolejka, potwierdzenia).
3. **Elastyczność przez kompozycję** — zakres zlecenia składamy z klocków, nie z twardych typów (`domain.md`).
4. **Bezpieczeństwo domyślnie** — dane klientów i dokumentacja chronione na każdym etapie.
5. **Małe przyrosty** — system używany wcześnie, rozwijany na podstawie realnego użycia.

## Wymagania niefunkcjonalne (wstępne — do potwierdzenia w M0)
- **Bezpieczeństwo:** OWASP ASVS 5.0 poziom 2 (web / API), OWASP MASVS (mobile), MFA (obowiązkowe dla Administratora), dziennik audytu, szyfrowanie w tranzycie i w spoczynku.
- **RODO:** hosting i kopie w UE, minimalizacja danych, retencja, umowy powierzenia.
- **Dostępność:** WCAG 2.2 AA (web), dostępność platformowa (mobile).
- **Offline:** rejestracja zdjęć, filmów i wpisów bez sieci; kolejka przetrwa restart telefonu; wznawialny upload dużych plików.
- **Niezawodność:** RPO ≤ 1 h dla bazy, RTO ≤ 8 h; kopie regularnie testowo odtwarzane.
- **Wydajność:** listy i widoki szczegółów < 1 s (p95) przy typowych danych.
- **Skala:** dziesiątki użytkowników, tysiące zleceń, terabajty mediów w perspektywie lat (koszt storage'u pod kontrolą).
- **Lokalizacja:** polski UI (gotowość na i18n), strefa `Europe/Warsaw`, poprawne sortowanie i wyszukiwanie z polskimi znakami.
- **Platformy:** aktualne Chrome, Edge, Safari, Firefox; minimalne wersje iOS / Android wg floty telefonów firmy (EVM-001).

## Poza zakresem (na teraz)
Wystawianie faktur (robi to system fakturowy zintegrowany z KSeF — u nas tylko status płatności, integracja później), sklep internetowy, monitoring ładowarek (OCPP), magazyn, kadry.
