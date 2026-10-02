# UX — zasady i styleguide

> Styleguide (`styleguide.md`) i design tokens (`design/tokens/`) powstają w EVM-003 (właściciel: `ux-designer`). Do tego czasu obowiązują poniższe zasady.

## Dwa konteksty
| | Biuro (panel web) | Teren (aplikacja mobilna) |
|---|---|---|
| Urządzenie | desktop / laptop, duży ekran | telefon, jedna ręka, rękawice |
| Otoczenie | biuro | garaż bez zasięgu, słabe światło lub słońce |
| Priorytet | gęstość informacji, filtry, praca z klawiatury | aparat, szybkość, duże cele dotyku (≥ 48×48 dp), wysoki kontrast |
| Krytyczne | widać etap, „na kogo czekamy”, terminy, płatności | widać status synchronizacji i uploadu każdego pliku; nic nie ginie |

## Zasady
1. **Status na pierwszy rzut oka** — każdy widok zlecenia odpowiada: na jakim etapie, na kogo czekamy i od kiedy, co jest po terminie, co nieopłacone.
2. **Spójność** — jeden design system (tokeny) dla web i mobile; konwencje platform (HIG / Material) tam, gdzie styleguide na to pozwala.
3. **Wszystkie stany** — pusty, ładowanie (szkielety), błąd (z wyjściem z sytuacji), offline, brak uprawnień.
4. **Nie gubimy pracy użytkownika** — autozapis szkiców, cofnij zamiast pytać, potwierdzenia tylko dla operacji nieodwracalnych.
5. **Progresywne ujawnianie** — złożone zlecenia (wiele procesów) pokazujemy warstwowo.
6. **Dostępność WCAG 2.2 AA** — kontrast, klawiatura, fokus, etykiety; kolor nigdy nie jest jedynym nośnikiem informacji (statusy: ikona + etykieta).
7. **Język** — prosty, konkretny polski; terminy ze słownika domeny; formaty dat, kwot i telefonów zgodne z polskimi zwyczajami.

## Styleguide jest wiążący
- Implementacja używa wyłącznie tokenów i komponentów z biblioteki; reguły lint wyłapują zaszyte wartości.
- Odstępstwo = decyzja `ux-designer` zapisana w changelogu styleguide'u.
- Przegląd UX (zrzuty w kilku szerokościach, a11y, zgodność) jest bramką w `/deliver` dla każdej zmiany UI.

## Artefakty (po EVM-003 / EVM-004)
- `docs/ux/styleguide.md` — fundamenty, komponenty, wzorce, treści, dostępność, changelog.
- `design/tokens/` — design tokens (format W3C DTCG) — jedno źródło prawdy dla web i mobile.
- `docs/ux/flows/` — przepływy i makiety MVP; `design/prototypes/` — prototypy HTML (opcjonalnie).
- `docs/ux/reviews/EVM-xxx/` — zrzuty z przeglądów UX (lokalnie, poza repo).
