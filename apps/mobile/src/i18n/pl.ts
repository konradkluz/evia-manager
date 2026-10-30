/** Polish catalogue of the mobile app (EVM-009 AC1, AC3; UX copy of the story). Keys: `shell.*`, `localData.*` (EVM-093 AC5, AC6), `update.*`. */
export const pl = {
  shell: {
    appName: 'EVia Manager',
    orders: { title: 'Moje zlecenia', emptyTitle: 'Brak zleceń', emptyBody: 'Zlecenia pojawią się tu po zalogowaniu i synchronizacji.' },
    queue: { title: 'Kolejka', emptyTitle: 'Nic nie czeka na wysłanie.' },
    nav: { label: 'Nawigacja główna' },
    sync: {
      online: 'Połączono',
      offline: 'Offline',
      offlineOpenQueue: 'Offline. Otwórz kolejkę',
      onlineOpenQueue: 'Połączono. Otwórz kolejkę',
    },
    loading: { label: 'Ładowanie', slow: 'Ładowanie trwa dłużej niż zwykle…' },
    retry: 'Spróbuj ponownie',
    errorCode: 'Kod: {{code}}',
    offlineBanner: 'Brak zasięgu. Pracuj dalej — wyślemy wszystko, gdy wróci połączenie.',
    serverUnavailable: {
      title: 'Brak połączenia z serwerem',
      body: 'Nie możemy połączyć się z serwerem EVia. Spróbuj ponownie za chwilę.',
    },
    reconnected: 'Połączono z serwerem.',
  },
  localData: {
    lostTitle: 'Dane zapisane na tym telefonie, które nie zostały wysłane, są niedostępne.',
    lostBody: 'Dane zleceń pobierzemy ponownie.',
    acknowledge: 'Rozumiem',
    wiping: 'Kończymy czyszczenie…',
    wipingRetry: 'Spróbuj ponownie',
  },
  update: {
    title: 'Zaktualizuj aplikację',
    body: 'Ta wersja aplikacji jest już nieobsługiwana. Zainstaluj nowszą wersję, aby korzystać z EVia Manager.',
    contact: 'Poproś administratora o nową wersję aplikacji.',
    versions: 'Twoja wersja: {{current}} · Wymagana: {{required}}',
  },
} as const;
