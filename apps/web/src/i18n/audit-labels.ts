/**
 * Polish labels of the audit log vocabularies (docs/ux/flows/12-konto-i-administracja.md → "Etykiety akcji E1", "Wynik
 * zdarzenia"; EVM-029 AC5). The API sends stable codes; this is where the panel turns them into words. A `Record` over
 * the contract type makes a new value of the contract a compile error here until it has a label (the panel shows
 * "Nieznana akcja" for a value an older panel does not know — never the raw code). It sits next to the i18n catalogue,
 * like `catalog-labels.ts`, so that the "every key is used" check of `pl.ts` keeps its meaning.
 */
import type { AuditAction, AuditObjectType, AuditOutcome } from '@evia/contracts';

export const auditActionLabels: Readonly<Record<AuditAction, string>> = {
  'login.succeeded': 'Logowanie',
  'login.failed': 'Próba logowania',
  'session.created': 'Rozpoczęcie sesji',
  'session.revoked': 'Zakończenie sesji',
  'session.expired': 'Wygaśnięcie sesji',
  'step_up.succeeded': 'Ponowne uwierzytelnienie',
  'step_up.failed': 'Nieudane ponowne uwierzytelnienie',
  'account.password_set': 'Ustawienie hasła z linku',
  'passkey.registered': 'Dodanie klucza dostępu',
  'activation_link.issued': 'Wydanie linku aktywacyjnego',
  'account.activated': 'Aktywacja konta',
  'account.emergency_reset': 'Tryb awaryjny',
  'audit.read': 'Odczyt dziennika audytu',
  'bulk_read.alerted': 'Alert masowego odczytu',
  'bulk_read.rejected': 'Odrzucony masowy odczyt',
  'customer.created': 'Dodanie klienta',
  'site.created': 'Dodanie lokalizacji',
  'party.created': 'Dodanie strony',
  'work_order.created': 'Utworzenie zlecenia',
  'work_order.cancelled': 'Anulowanie zlecenia',
  'work_order.restored': 'Przywrócenie zlecenia',
};

/** Groups of the "Akcja" filter, in the order of the table of labels (the story EVM-015 → W-18). */
export const auditActionGroups: ReadonlyArray<{ readonly label: string; readonly actions: readonly AuditAction[] }> = [
  {
    label: 'Logowanie i sesje',
    actions: [
      'login.succeeded',
      'login.failed',
      'session.created',
      'session.revoked',
      'session.expired',
      'step_up.succeeded',
      'step_up.failed',
    ],
  },
  { label: 'Hasło i drugi krok', actions: ['account.password_set', 'passkey.registered'] },
  { label: 'Użytkownicy', actions: ['activation_link.issued', 'account.activated', 'account.emergency_reset'] },
  { label: 'Dziennik audytu', actions: ['audit.read', 'bulk_read.alerted', 'bulk_read.rejected'] },
  { label: 'Klienci', actions: ['customer.created'] },
  { label: 'Lokalizacje i strony', actions: ['site.created', 'party.created'] },
  { label: 'Zlecenia', actions: ['work_order.created', 'work_order.cancelled', 'work_order.restored'] },
];

export const auditOutcomeLabels: Readonly<Record<AuditOutcome, string>> = {
  success: 'Udane',
  denied: 'Odmowa',
  failed: 'Błąd',
};

export const auditObjectTypeLabels: Readonly<Record<AuditObjectType, string>> = {
  user: 'Konto',
  session: 'Sesja',
  passkey: 'Klucz dostępu',
  audit: 'Dziennik audytu',
  work_order: 'Zlecenie',
  customer: 'Klient',
  site: 'Lokalizacja',
  party: 'Strona',
};

/** Events of the server itself (a job, an emergency command) — the API sends no person for them ("System"). */
export const SYSTEM_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'activation_link.issued',
  'session.expired',
  'account.emergency_reset',
]);
