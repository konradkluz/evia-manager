/**
 * Polish UI texts (the only language today; styleguide § 6, domain glossary docs/product/domain.md). Keys follow the
 * story EVM-008 → "UX / UI" → "Mikrocopy i i18n". Every key is used (test/i18n.test.ts).
 */
export const pl = {
  app: {
    name: 'EVia Manager',
    pageTitle: '{{page}} · EVia Manager',
  },
  nav: {
    label: 'Główna nawigacja',
    workOrders: 'Zlecenia',
  },
  shell: {
    skipToContent: 'Przejdź do treści',
    menu: 'Menu',
    closeMenu: 'Zamknij menu',
    offline: 'Brak połączenia. Panel działa po jego powrocie.',
    accountMenu: 'Menu konta: {{name}}',
    logout: 'Wyloguj',
    logoutError: 'Nie udało się wylogować. Spróbuj ponownie.',
    closeToast: 'Zamknij powiadomienie',
    loading: 'Ładowanie…',
  },
  roles: {
    administrator: 'Administrator',
    editor: 'Edytor',
    readOnly: 'Tylko odczyt',
  },
  login: {
    pageTitle: 'Logowanie',
    title: 'Logowanie nie jest jeszcze dostępne',
    description:
      'Konto aktywujesz jednorazowym linkiem od administratora. Logowanie przy kolejnych wejściach pojawi się w następnej wersji panelu.',
  },
  activation: {
    pageTitle: 'Aktywacja konta',
    title: 'Ustaw hasło',
    role: 'Aktywacja konta · rola: {{role}}',
    checking: 'Sprawdzamy link…',
    otherAccount: 'Ustawienie hasła wyloguje bieżące konto w tej przeglądarce.',
    email: 'E-mail',
    password: 'Nowe hasło',
    hint: 'Co najmniej 15 znaków — może to być zdanie ze spacjami.',
    show: 'Pokaż',
    hide: 'Ukryj',
    submit: 'Ustaw hasło',
    next: 'Następny krok: drugi krok logowania.',
    offlineLoad: 'Brak połączenia. Ustawienie hasła wymaga połączenia z internetem.',
    offlineSubmit: 'Ustawisz hasło po powrocie połączenia.',
    retry: 'Spróbuj ponownie',
    rateLimited: 'Zbyt wiele prób. Spróbuj ponownie za {{minutes}} min.',
    checkFailed: 'Nie udało się sprawdzić linku. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: {{code}}).',
    submitFailed: 'Nie udało się ustawić hasła. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: {{code}}).',
    noConnection: 'Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.',
    tooShort: 'Hasło musi mieć co najmniej 15 znaków.',
    tooLong: 'Hasło może mieć najwyżej 256 znaków.',
    tooWeak: 'To hasło jest zbyt łatwe do odgadnięcia albo pojawiło się w wycieku danych. Wybierz inne — np. zdanie z kilku słów.',
    invalid: {
      title: 'Link jest nieważny lub wygasł.',
      description: 'Otwórz link jeszcze raz — w całości, tak jak go otrzymano. Jeśli nadal nie działa, poproś administratora o nowy link.',
      action: 'Przejdź do logowania',
    },
  },
  mfa: {
    pageTitle: 'Konfiguracja logowania',
    title: 'Skonfiguruj drugi krok logowania',
    description:
      'Logowanie do EVia Manager wymaga drugiego kroku — klucza dostępu: Windows Hello, klucza bezpieczeństwa albo klucza dostępu w telefonie.',
    add: 'Dodaj klucz dostępu',
    inProgress: 'Postępuj zgodnie z instrukcją systemu.',
    failed: 'Nie udało się dodać klucza dostępu. Spróbuj ponownie.',
    done: 'Drugi krok logowania jest skonfigurowany.',
  },
  workOrders: {
    title: 'Zlecenia',
    empty: {
      title: 'Brak zleceń',
      description: 'Zlecenia pojawią się tutaj, gdy zostaną dodane do systemu.',
    },
  },
  error: {
    boundary: {
      title: 'Coś poszło nie tak',
      description: 'Odśwież stronę i spróbuj ponownie. Jeśli problem wraca, skontaktuj się z administratorem.',
      action: 'Odśwież stronę',
    },
  },
} as const;
