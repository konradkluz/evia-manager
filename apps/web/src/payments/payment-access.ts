import type { UserRole } from '@evia/contracts';

/**
 * The right to read payments (W4 of ADR-0017; EVM-056 AC7; P6): the column "Płatność", the views "Po terminie" and "Nieopłacone",
 * the sort "Najpilniejsze" of W-10 and the tile "Płatności" of W-06 exist only for a role that may read the instalments — the
 * roles of `listPaymentMilestones` (v1: Administrator, Edytor, Tylko odczyt; a test keeps both lists equal). A role this panel does
 * not know is denied (deny-by-default). Hiding is a convenience: the server enforces the same rule (`restrictedParams`).
 */
export function canReadPayments(role: UserRole | undefined): boolean {
  switch (role) {
    case 'administrator':
    case 'editor':
    case 'read_only':
      return true;
    default:
      return false;
  }
}
