/**
 * The actions of an instalment in W-06 (EVM-054 AC5, AC8; flows/08 → "Akcje płatności — status × rola"). The panel shows what the
 * table of the mockup gives the role in the status; the server decides all the same (`403`, `409`).
 * - `invoice`, `pay` — the visible button of the row; `amount`, `cancel`, `details`, `paidOn` — the menu `⋮`;
 * - the corrections of payments (EVM-057; the story → "UX / UI" → "Dostępność pozycji") are the Administrator's with step-up: the
 *   Administrator uses them (the server asks for W-04 with `403 step_up_required`), the Editor sees them disabled with the reason
 *   (`adminOnly`), Tylko odczyt sees no action.
 */
export type MilestoneAction =
  | 'invoice'
  | 'pay'
  | 'amount'
  | 'cancel'
  | 'details'
  | 'paidOn'
  | 'withdrawInvoice'
  | 'cancelInvoice'
  | 'correctAmount'
  | 'undoPayment'
  | 'restore'
  | 'delete';

export interface MilestoneMenuEntry {
  readonly action: MilestoneAction;
  /** `main` first; `cancel` and `corrections` are separate groups at the end of the menu (§ 3.20). */
  readonly group: 'main' | 'cancel' | 'corrections';
  /** A correction of payments (EVM-057): a dialog with "before → after", then W-04 when the server asks for a step-up. */
  readonly correction?: true;
  /** The role may not run it: disabled with "Korektę płatności może wykonać tylko administrator." (the Editor). */
  readonly adminOnly?: true;
}

export interface MilestoneActions {
  readonly primary?: 'invoice' | 'pay';
  readonly menu: readonly MilestoneMenuEntry[];
}

const NONE: MilestoneActions = { menu: [] };

export function milestoneActions(status: string, role: string | undefined): MilestoneActions {
  if (role !== 'administrator' && role !== 'editor') return NONE;
  const editor = role === 'editor';
  const corrections = (group: 'cancel' | 'corrections', actions: readonly MilestoneAction[]): MilestoneMenuEntry[] =>
    actions.map((action) => (editor ? { action, group, correction: true, adminOnly: true } : { action, group, correction: true }));
  switch (status) {
    case 'planned':
      return {
        primary: 'invoice',
        menu: [{ action: 'amount', group: 'main' }, { action: 'cancel', group: 'cancel' }, ...corrections('cancel', ['delete'])],
      };
    case 'invoiced':
      return {
        primary: 'pay',
        menu: [
          { action: 'details', group: 'main' },
          ...corrections('corrections', ['withdrawInvoice', 'cancelInvoice', 'correctAmount', 'delete']),
        ],
      };
    case 'paid':
      return { menu: [{ action: 'paidOn', group: 'main' }, ...corrections('corrections', ['undoPayment', 'correctAmount', 'delete'])] };
    case 'cancelled':
      return { menu: corrections('corrections', ['restore', 'delete']) };
    default:
      return NONE;
  }
}
