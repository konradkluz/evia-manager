/**
 * Polish labels of the stage statuses (docs/ux/styleguide.md § 4.4 "Status etapu"). A `Record` over the contract type makes a
 * new status of the contract a compile error here until it has a label; the panel shows "Nieznany status" for a value an older
 * panel does not know (P-12), never the raw code. It sits next to the i18n catalogue, like `work-order-labels.ts`.
 */
import type { StageStatus } from '@evia/contracts';

export const stageStatusLabels: Readonly<Record<StageStatus, string>> = {
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  waiting: 'Czekamy na…',
  done: 'Zakończony',
  not_applicable: 'Nie dotyczy',
  blocked: 'Zablokowany',
};
