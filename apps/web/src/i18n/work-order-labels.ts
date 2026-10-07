/**
 * Polish labels of the work order vocabularies (docs/ux/styleguide.md § 4.4 "Status zlecenia"; EVM-017 AC1). The API
 * sends stable codes; this is where the panel turns them into words. A `Record` over the contract type makes a new
 * status of the contract a compile error here until it has a label — and the panel shows "Nieznany status" for a value
 * an older panel does not know (P-12), never the raw code. It sits next to the i18n catalogue, like `audit-labels.ts`.
 */
import type { WorkOrderSort, WorkOrderStatus } from '@evia/contracts';

export const workOrderStatusLabels: Readonly<Record<WorkOrderStatus, string>> = {
  new: 'Nowe',
  quoting: 'Wycena',
  accepted: 'Zaakceptowane',
  in_progress: 'W realizacji',
  completed: 'Zakończone',
  settled: 'Rozliczone',
  on_hold: 'Wstrzymane',
  cancelled: 'Anulowane',
};

/** Sorting offered by the panel in this story (W-10): "Numer" and "Utworzono" in both directions. */
export const workOrderSortLabels: Readonly<Record<WorkOrderSort, string>> = {
  '-number': 'Numer — od najwyższego',
  number: 'Numer — od najniższego',
  '-createdAt': 'Utworzono — od najnowszych',
  createdAt: 'Utworzono — od najstarszych',
};
