/**
 * Polish texts of W-05 "Nowe zlecenie" for the site survey (EVM-138 AC2; docs/ux/flows/17-wizja-lokalna.md → W-05). Plain maps like
 * `site-survey-labels.ts`; no address, phone or name in any of them.
 */
export const newSurveyText = {
  kindLegend: 'Rodzaj',
  kindOrder: 'Zlecenie z szablonu',
  kindOrderHint: 'Klient, lokalizacja, zakres i procesy',
  kindSurvey: 'Wizja lokalna',
  kindSurveyHint: 'Oględziny bez klienta — tylko adres i zdjęcia. Klienta przypiszesz po akceptacji oferty.',
  kindAnnouncement: 'Formularz wizji lokalnej',
  kindOrderAnnouncement: 'Formularz zlecenia z szablonu',
  locationSection: '1. Lokalizacja',
  requesterSection: '2. Zamawiający',
  keeperSection: '3. Opiekun',
  phoneLabel: 'Telefon zamawiającego (opcjonalnie)',
  phoneHint: 'Tylko numer — nie wpisuj imion w opisach.',
  phoneInvalid: 'Podaj numer telefonu, np. 600 123 456.',
  keeperLabel: 'Opiekun',
  noKeeper: 'Bez opiekuna',
  keeperHint: 'Wizja będzie widoczna na telefonie opiekuna.',
  noKeeperHint: 'Bez opiekuna wizja nie będzie widoczna na żadnym telefonie.',
  keeperUnavailable: 'Ta osoba nie może być opiekunem. Wybierz inną.',
  siteRequired: 'Podaj adres lokalizacji.',
  submit: 'Załóż wizję lokalną',
  offlineHint: 'Zapiszesz po powrocie połączenia.',
  offline: 'Brak połączenia. Wpisane dane zostają w tej karcie — zapisz je, gdy połączenie wróci.',
  summary: 'Popraw te pola, aby założyć wizję lokalną',
  created: (number: string) => `Utworzono wizję lokalną ${number}.`,
  discardTitle: 'Odrzucić szkic wizji lokalnej?',
  failure: {
    fields: 'Nie udało się założyć wizji. Sprawdź zaznaczone pola.',
    network: 'Nie udało się założyć wizji. Spróbuj ponownie — nie założymy jej dwa razy.',
    inProgress: 'Ta wizja jest właśnie zapisywana. Poczekaj chwilę i spróbuj ponownie.',
    forbidden: 'Nie możesz zakładać wizji lokalnych. Poproś administratora.',
    notFound:
      'Nie udało się założyć wizji lokalnej: lokalizacja jest niedostępna albo wizje lokalne są teraz wyłączone. Odśwież stronę, załóż zwykłe zlecenie albo zapytaj administratora.',
    rate: (seconds: number) => `Zbyt wiele prób. Spróbuj ponownie za ${String(seconds)} s.`,
    server: (code: string) => `Nie udało się założyć wizji. Spróbuj ponownie — nie założymy jej dwa razy. Kod błędu: ${code}.`,
  },
} as const;
