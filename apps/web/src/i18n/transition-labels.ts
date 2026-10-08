import type { TransitionAction } from '../work-orders/transition-actions.ts';

/**
 * Texts of the status menu and its dialogs (W-06, EVM-030), kept as maps like the other labels of the panel: the menu, the toast
 * and the dialog are chosen by the action, so the keys are not written out one by one at the call.
 */
export const transitionActionLabels: Readonly<Record<TransitionAction, string>> = {
  quote: 'Rozpocznij wycenę',
  acceptWithoutQuote: 'Zaakceptuj bez wyceny',
  accept: 'Zaakceptuj',
  start: 'Rozpocznij realizację',
  complete: 'Zakończ',
  settle: 'Rozlicz…',
  reopen: 'Otwórz ponownie',
  hold: 'Wstrzymaj…',
  resume: 'Wznów',
  cancel: 'Anuluj zlecenie…',
  restore: 'Przywróć zlecenie…',
};

/** The toast after the action ("Cofnij" is added when the table has the reverse transition for the same role). */
export const transitionToastLabels: Readonly<Record<TransitionAction, string>> = {
  quote: 'Rozpoczęto wycenę zlecenia.',
  acceptWithoutQuote: 'Zaakceptowano zlecenie.',
  accept: 'Zaakceptowano zlecenie.',
  start: 'Rozpoczęto realizację zlecenia.',
  complete: 'Zakończono zlecenie.',
  settle: 'Rozliczono zlecenie.',
  reopen: 'Otwarto ponownie zlecenie.',
  hold: 'Wstrzymano zlecenie.',
  resume: 'Wznowiono zlecenie.',
  cancel: 'Anulowano zlecenie.',
  restore: 'Przywrócono zlecenie.',
};

export const transitionUndoneToast = 'Cofnięto zmianę statusu zlecenia.';

export type TransitionDialogKey = 'hold' | 'cancel' | 'complete' | 'settle' | 'restoreSettled' | 'restoreCancelled';

export interface TransitionDialogLabels {
  readonly title: (number: string) => string;
  readonly description: string;
  readonly submit: string;
}

export const transitionDialogLabels: Readonly<Record<TransitionDialogKey, TransitionDialogLabels>> = {
  hold: {
    title: (number) => `Wstrzymaj zlecenie ${number}`,
    description: 'Zlecenie otrzyma status „Wstrzymane”. Możesz je wznowić w każdej chwili.',
    submit: 'Wstrzymaj zlecenie',
  },
  cancel: {
    title: (number) => `Anuluj zlecenie ${number}`,
    description: 'Zlecenie otrzyma status „Anulowane”. Przywrócić zlecenie może tylko administrator.',
    submit: 'Anuluj zlecenie',
  },
  complete: {
    title: (number) => `Zakończ zlecenie ${number}`,
    description: 'Zlecenie otrzyma status „Zakończone”. Możesz je otworzyć ponownie.',
    submit: 'Zakończ zlecenie',
  },
  settle: {
    title: (number) => `Rozliczyć zlecenie ${number}?`,
    description: 'Zlecenie otrzyma status „Rozliczone”. Cofnąć rozliczenie może tylko administrator.',
    submit: 'Rozlicz zlecenie',
  },
  restoreSettled: {
    title: (number) => `Przywrócić zlecenie ${number}?`,
    description: 'Zlecenie wróci do statusu „Zakończone”, a data zamknięcia zostanie wyczyszczona.',
    submit: 'Przywróć zlecenie',
  },
  restoreCancelled: {
    title: (number) => `Przywrócić zlecenie ${number}?`,
    description: 'Zlecenie wróci do statusu „Wstrzymane”, a data zamknięcia zostanie wyczyszczona.',
    submit: 'Przywróć zlecenie',
  },
};

/** The label of the reason field and of the date field of the dialogs. */
export const transitionFieldLabels = {
  holdReason: 'Powód wstrzymania',
  cancelReason: 'Powód anulowania',
  completedOn: 'Data zakończenia',
} as const;
