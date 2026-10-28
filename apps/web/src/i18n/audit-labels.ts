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
  // EVM-024: only the labels the contract needs (the screen W-16 itself is a story of the panel)
  'user.invited': 'Zaproszenie użytkownika',
  'invitation.resent': 'Ponowne wysłanie zaproszenia',
  // EVM-025: labels the contract needs (the reset screens W-12 are a story of the panel)
  'password.reset_requested': 'Prośba o reset hasła',
  'password_reset_link.issued': 'Wydanie linku do resetu hasła',
  'password.reset': 'Reset hasła',
  // EVM-023: labels the contract needs (the screens W-02, W-03 and W-04 of the second step are the work of the web developer)
  'mfa.totp_enrolled': 'Dodanie kodu z aplikacji uwierzytelniającej',
  'mfa.recovery_codes_generated': 'Wygenerowanie kodów odzyskiwania',
  'login.recovery_code_used': 'Logowanie kodem odzyskiwania',
  // EVM-027: labels the contract needs (the screen W-16 with its dialogs is the work of the web developer)
  'user.role_changed': 'Zmiana roli użytkownika',
  'user.deactivated': 'Dezaktywacja konta',
  'user.reactivated': 'Reaktywacja konta',
  'user.sessions_ended': 'Zakończenie sesji użytkownika',
  'user.second_step_reset': 'Reset drugiego kroku logowania',
  // EVM-026: a lock of the sign-in after ten failed tries (for the browsers the account does not know / for one browser it knows)
  'account.locked': 'Blokada logowania konta',
  'account.browser_locked': 'Blokada logowania z przeglądarki znanej koncie',
  // EVM-028: the owner's own changes of the account (the screen W-15 is a story of the panel)
  'account.profile_updated': 'Zmiana nazwy wyświetlanej',
  'password.changed': 'Zmiana hasła',
  'passkey.removed': 'Usunięcie klucza dostępu',
  'mfa.totp_removed': 'Usunięcie kodu z aplikacji uwierzytelniającej',
  'reauthentication.succeeded': 'Pełne ponowne uwierzytelnienie',
  'reauthentication.failed': 'Nieudane pełne ponowne uwierzytelnienie',
  // EVM-094: the register of mobile devices (the screen of the devices is the story EVM-095)
  'device.registered': 'Rejestracja urządzenia mobilnego',
  'device.recognized': 'Rozpoznanie urządzenia mobilnego po poprzednim sekrecie',
  'device.wipe_confirmed': 'Potwierdzenie wyczyszczenia urządzenia',
  'account.emergency_reset': 'Tryb awaryjny',
  'audit.read': 'Odczyt dziennika audytu',
  'bulk_read.alerted': 'Alert masowego odczytu',
  'bulk_read.rejected': 'Odrzucony masowy odczyt',
  'customer.created': 'Dodanie klienta',
  'customer.updated': 'Zmiana danych klienta',
  'site.created': 'Dodanie lokalizacji',
  'site.updated': 'Zmiana danych lokalizacji',
  'party.created': 'Dodanie strony',
  'party.updated': 'Zmiana danych strony',
  'work_order.created': 'Utworzenie zlecenia',
  'work_order.cancelled': 'Anulowanie zlecenia',
  'work_order.restored': 'Przywrócenie zlecenia',
  'work_order.deleted': 'Usunięcie zlecenia',
  'work_order.undeleted': 'Przywrócenie usuniętego zlecenia',
  'work_order.updated': 'Zmiana danych zlecenia',
  'scope_item.created': 'Dodanie pozycji zakresu zlecenia',
  'scope_item.updated': 'Zmiana pozycji zakresu zlecenia',
  'scope_item.deleted': 'Usunięcie pozycji zakresu zlecenia',
  'procedure_stage.updated': 'Zmiana etapu procesu (osoba odpowiedzialna, termin, na kogo czekamy)',
  'procedure_stage.transitioned': 'Zmiana statusu etapu procesu',
  'procedure.created': 'Dodanie procesu do zlecenia',
  'procedure.deleted': 'Usunięcie procesu ze zlecenia',
  'procedure.restored': 'Przywrócenie procesu zlecenia',
  'procedure_stage.created': 'Dodanie etapu procesu',
  'procedure_stage.deleted': 'Usunięcie etapu procesu',
  'procedure_stage.restored': 'Przywrócenie etapu procesu',
  'timeline_entry.created': 'Dodanie wpisu w dzienniku zlecenia',
  'payment_milestone.created': 'Dodanie transzy płatności',
  'payment_milestone.amount_changed': 'Zmiana kwoty transzy płatności',
  'payment_milestone.cancelled': 'Anulowanie transzy płatności',
  'payment_milestone.invoiced': 'Wystawienie faktury za transzę płatności',
  'payment_milestone.paid': 'Odnotowanie wpłaty za transzę płatności',
  'payment_milestone.details_changed': 'Poprawka danych faktury albo daty wpłaty transzy płatności',
  'payment_milestone.invoice_withdrawn': 'Korekta: wycofanie faktury za transzę płatności',
  'payment_milestone.invoice_cancelled': 'Korekta: anulowanie faktury za transzę płatności',
  'payment_milestone.payment_undone': 'Korekta: cofnięcie wpłaty za transzę płatności',
  'payment_milestone.restored': 'Korekta: przywrócenie transzy płatności',
  'payment_milestone.amount_corrected': 'Korekta: zmiana kwoty transzy płatności',
  'payment_milestone.deleted': 'Korekta: usunięcie transzy płatności',
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
      'account.locked',
      'account.browser_locked',
      'reauthentication.succeeded',
      'reauthentication.failed',
      'device.registered',
      'device.recognized',
      'device.wipe_confirmed',
    ],
  },
  {
    label: 'Hasło i drugi krok',
    actions: [
      'account.password_set',
      'passkey.registered',
      'mfa.totp_enrolled',
      'mfa.recovery_codes_generated',
      'login.recovery_code_used',
      'password.changed',
      'passkey.removed',
      'mfa.totp_removed',
    ],
  },
  {
    label: 'Użytkownicy',
    actions: [
      'user.invited',
      'invitation.resent',
      'activation_link.issued',
      'account.activated',
      'account.emergency_reset',
      'account.profile_updated',
    ],
  },
  {
    label: 'Reset hasła',
    actions: ['password.reset_requested', 'password_reset_link.issued', 'password.reset'],
  },
  { label: 'Dziennik audytu', actions: ['audit.read', 'bulk_read.alerted', 'bulk_read.rejected'] },
  { label: 'Klienci', actions: ['customer.created', 'customer.updated'] },
  { label: 'Lokalizacje i strony', actions: ['site.created', 'site.updated', 'party.created', 'party.updated'] },
  {
    label: 'Zlecenia',
    actions: [
      'work_order.created',
      'work_order.updated',
      'work_order.cancelled',
      'work_order.restored',
      'work_order.deleted',
      'work_order.undeleted',
    ],
  },
  { label: 'Zakres zlecenia', actions: ['scope_item.created', 'scope_item.updated', 'scope_item.deleted'] },
  {
    label: 'Procesy i etapy',
    actions: [
      'procedure_stage.updated',
      'procedure_stage.transitioned',
      'procedure.created',
      'procedure.deleted',
      'procedure.restored',
      'procedure_stage.created',
      'procedure_stage.deleted',
      'procedure_stage.restored',
    ],
  },
  { label: 'Dziennik zlecenia', actions: ['timeline_entry.created'] },
  {
    label: 'Płatności',
    actions: [
      'payment_milestone.created',
      'payment_milestone.amount_changed',
      'payment_milestone.cancelled',
      'payment_milestone.invoiced',
      'payment_milestone.paid',
      'payment_milestone.details_changed',
      'payment_milestone.invoice_withdrawn',
      'payment_milestone.invoice_cancelled',
      'payment_milestone.payment_undone',
      'payment_milestone.restored',
      'payment_milestone.amount_corrected',
      'payment_milestone.deleted',
    ],
  },
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
  device: 'Urządzenie mobilne',
  audit: 'Dziennik audytu',
  work_order: 'Zlecenie',
  scope_item: 'Pozycja zakresu',
  customer: 'Klient',
  site: 'Lokalizacja',
  party: 'Strona',
  procedure: 'Proces',
  procedure_stage: 'Etap procesu',
  timeline_entry: 'Wpis dziennika',
  payment_milestone: 'Transza płatności',
};

/** Events of the server itself (a job, an emergency command) — the API sends no person for them ("System"). */
export const SYSTEM_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'activation_link.issued',
  'password_reset_link.issued',
  'session.expired',
  'account.emergency_reset',
]);
