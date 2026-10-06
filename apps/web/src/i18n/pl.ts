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
