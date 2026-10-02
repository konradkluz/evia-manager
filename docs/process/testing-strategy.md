# Strategia testów

> Wersja wstępna. Narzędzia dla każdej warstwy wybierają `solution-architect` i `qa-engineer` w EVM-001 / EVM-006 i wpisują je w sekcji „Narzędzia”.

## Zasady
1. **TDD:** test przed kodem; każde AC ma co najmniej jeden test automatyczny z oznaczeniem `EVM-xxx AC#` w nazwie lub opisie (śledzenie AC → test).
2. **Testujemy zachowanie, nie implementację:** asercje na wynikach widocznych dla użytkownika lub klienta API.
3. **Deterministycznie:** bez sztucznych opóźnień, z kontrolowanym czasem, strefą i danymi.
4. **Tylko dane syntetyczne** (np. generatory z lokalizacją `pl`) — nigdy kopie danych klientów (RODO).
5. **Niestabilny test** → kwarantanna z ID historyjki naprawczej i termin naprawy; nigdy ciche wyłączenie.

## Piramida i rodzaje testów
| Rodzaj | Co obejmuje | Kiedy |
|---|---|---|
| Jednostkowe | logika domenowa, walidacje, silnik synchronizacji i kolejka uploadu (mobile), logika komponentów | każda historyjka |
| Integracyjne | API + prawdziwa baza w kontenerze, storage, zadania w tle | każda zmiana backendu |
| Kontraktowe | zgodność API ze specyfikacją; wygenerowani klienci web / mobile | każda zmiana API |
| Uprawnień (macierz ról) | każdy endpoint × Administrator / Edytor / Tylko odczyt / niezalogowany + IDOR | każdy nowy lub zmieniony endpoint |
| Komponentowe UI | stany, warianty, dostępność (axe) | każda zmiana UI |
| E2E web | ścieżki AC przechodzące przez cały stos | historyjki z UI web |
| E2E mobile | kluczowe przepływy, scenariusze offline (tryb samolotowy → powrót sieci) | historyjki mobile |
| Mutacyjne | jakość testów modułów domenowych i synchronizacji | od M1, cyklicznie (np. nocą) |
| Bezpieczeństwa | SAST, zależności, sekrety w CI; DAST baseline na staging | CI / przed wydaniem |
| Wydajnościowe (smoke) | listy, wyszukiwanie, upload dużych plików | przed wydaniem (od M1) |

## Progi (bramki CI — spadek blokuje merge)
| Obszar | Linie i gałęzie |
|---|---|
| **Zmieniony kod w każdej zmianie (diff coverage)** | **≥ 90%** |
| Backend — całość | ≥ 85% |
| Backend — moduły domenowe | ≥ 95%, wynik testów mutacyjnych ≥ 70% (cel 80%) |
| Web — całość | ≥ 80% |
| Mobile — całość | ≥ 80% |
| Mobile — synchronizacja i kolejka uploadu | ≥ 95% |
| Macierz ról | 100% endpointów |

Progi globalne działają jak zapadka: mogą tylko rosnąć. Obniżenie wymaga ADR i zgody użytkownika. Wykluczenia z pokrycia (kod generowany, konfiguracja) są jawnie wypisane w konfiguracji; każde inne wymaga komentarza z uzasadnieniem.

## Przypadki brzegowe specyficzne dla domeny
- Polskie znaki (ąćęłńóśźż) w nazwach, wyszukiwaniu („Lodz” → „Łódź”), sortowaniu i nazwach plików.
- Daty i terminy wokół zmiany czasu w strefie `Europe/Warsaw`; zapis w UTC.
- Duże pliki (filmy kilkaset MB+), przerwany i wznowiony upload, duplikaty.
- Równoczesna edycja zlecenia przez dwie osoby.
- Kwoty (grosze, zaokrąglenia, waluta PLN).

## Test terenowy (checklista przed wydaniem mobile)
1. Telefon w trybie samolotowym (lub garaż podziemny bez zasięgu): 30 zdjęć, 3 filmy (w tym jeden > 2 min), 2 wpisy w jednym zleceniu.
2. Wymuszone zamknięcie aplikacji w trakcie i restart telefonu.
3. Powrót zasięgu: wszystko trafia do właściwego zlecenia automatycznie, bez duplikatów; statusy plików poprawne.
4. Opcja „filmy tylko przez Wi-Fi”: filmy czekają na Wi-Fi, zdjęcia idą przez sieć komórkową.
5. Wynik i obserwacje zapisane w historyjce wydania.

## Narzędzia
_Do uzupełnienia w EVM-001 / EVM-006._
