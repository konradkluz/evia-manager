import type { UserRole } from '@evia/contracts';
import type { TFunction } from 'i18next';

export const ROLES: readonly UserRole[] = ['editor', 'read_only', 'administrator'];

/** The name of a role (domain glossary): Administrator, Edytor, Tylko odczyt; a value of a newer API is shown as a dash, never raw. */
export function roleLabel(t: TFunction, role: string): string {
  switch (role) {
    case 'administrator':
      return t('roles.administrator');
    case 'editor':
      return t('roles.editor');
    case 'read_only':
      return t('roles.readOnly');
    default:
      return t('users.table.none');
  }
}

/** The name of the status of an account; a status the panel does not know is "Nieznany status". */
export function statusLabel(t: TFunction, status: string): string {
  switch (status) {
    case 'active':
      return t('users.status.active');
    case 'invited':
      return t('users.status.invited');
    case 'deactivated':
      return t('users.status.deactivated');
    default:
      return t('users.status.unknown');
  }
}
