import type { StageAction } from '../work-orders/stage-transitions.ts';

/**
 * Texts of the menu of the badge of a stage (W-07, EVM-032), kept as a map like the other labels of the panel: the menu is
 * chosen by the action, so the keys are not written out one by one at the call. "…" at the end opens a dialog (styleguide § 3.20).
 */
export const stageActionLabels: Readonly<Record<StageAction, string>> = {
  start: 'Rozpocznij',
  wait: 'Czekamy na…',
  finish: 'Zakończ…',
  notApplicable: 'Nie dotyczy',
  block: 'Zablokuj…',
  answered: 'Odpowiedź otrzymana',
  changeWaiting: 'Zmień, na kogo czekamy…',
  unblock: 'Odblokuj',
  reopen: 'Otwórz ponownie',
  restore: 'Przywróć',
};
