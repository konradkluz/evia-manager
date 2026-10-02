# Architektura

> Uzupełnia `solution-architect` w M0 (EVM-001, EVM-002). Do tego czasu: czynniki architektoniczne poniżej.

## Czynniki architektoniczne (drivers)
1. **Elastyczny model zleceń** — kompozycja: katalog usług + szablony + procesy z etapami (`docs/product/domain.md`).
2. **Mobile offline-first** — garaże bez zasięgu; trwała kolejka zmian; zdjęcia i duże filmy z wznawialnym uploadem w tle (iOS + Android); zero utraty danych.
3. **Archiwum mediów i dokumentów** — lata retencji, terabajty, bezpieczny dostęp, kontrola kosztów.
4. **Bezpieczeństwo** — ASVS L2, MASVS, RBAC, audyt, MFA; RODO i UE (`docs/security/README.md`).
5. **Mała firma** — niski koszt, mały narzut operacyjny, jeden człowiek akceptujący zmiany; zespół agentów AI jako wykonawcy (silne typowanie, dojrzałe narzędzia testowe, dobra dokumentacja).
6. **Ewolucja** — przyszłe integracje (fakturowanie / KSeF, e-mail, kalendarz), inwestycje deweloperskie, projekty DC — bez budowania ich na zapas.

## Planowane dokumenty
| Dokument | Zawartość | Kiedy |
|---|---|---|
| ten plik | przegląd, diagramy C4 (poziom 1–2, Mermaid), mapa modułów, NFR | EVM-001 |
| `adr/` | decyzje architektoniczne (indeks: `adr/README.md`) | od EVM-001 |
| `domain-model.md` | model domeny i danych (ERD), walidacja na scenariuszach A–F | EVM-002 |
| `api-guidelines.md` | styl API, błędy, paginacja, idempotencja, wersjonowanie, kompatybilność | EVM-002 |
| `offline-sync.md` | identyfikatory, kolejka, kursory zmian, konflikty | EVM-002 / EVM-011 |
| `media-pipeline.md` | upload, przetwarzanie, przechowywanie, dostęp, retencja | EVM-002 / EVM-011 |
