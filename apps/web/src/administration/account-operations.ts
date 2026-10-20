import type { IdentityVerification, User, UserRole } from '@evia/contracts';

/** The operations of W-16 on an existing account (flows/12 → dialogs 3 to 7); the invitation has its own dialogs. */
export type AccountOperation = 'role' | 'sessions' | 'reset' | 'deactivate' | 'reactivate';

/**
 * What the menu of a row offers by the status of the account (flows/12 → "Menu wiersza"): an active account — role, sessions,
 * then the destructive reset and deactivation; an account that waits — role and deactivation (the second step does not exist
 * yet, and there are no sessions); a deactivated one — only the reactivation. Hiding is a convenience: the server decides.
 */
export function operationsOf(user: User): readonly AccountOperation[] {
  switch (user.status) {
    case 'active':
      return ['role', 'sessions', 'reset', 'deactivate'];
    case 'invited':
      return ['role', 'deactivate'];
    case 'deactivated':
      return ['reactivate'];
    default:
      return [];
  }
}

/** The strong ETag of the version of the account the Administrator decided on (`If-Match`, ADR-0004). */
export const ifMatchOf = (user: User): string => `"${String(user.version)}"`;

/**
 * Whether the operation sends the security alert to all active Administrators (AC7): granting or taking away the role, the
 * deactivation or reactivation of an Administrator and the reset of his or her second step. Edytor ↔ Tylko odczyt and the end of
 * sessions send none.
 */
export function alertsAdministrators(operation: AccountOperation, user: User, targetRole?: UserRole): boolean {
  switch (operation) {
    case 'role':
      return targetRole !== undefined && (user.role === 'administrator') !== (targetRole === 'administrator');
    case 'deactivate':
      return user.role === 'administrator' && user.status === 'active';
    case 'reactivate':
    case 'reset':
      return user.role === 'administrator';
    case 'sessions':
      return false;
  }
}

/** The account keeps a passkey: only an Administrator with a passkey may be made (a code from the app is not enough, P1). */
export const hasPasskey = (user: User): boolean => user.secondStepMethods.includes('passkey');

export const IDENTITY_VERIFICATIONS: readonly IdentityVerification[] = ['in_person', 'video_call'];
