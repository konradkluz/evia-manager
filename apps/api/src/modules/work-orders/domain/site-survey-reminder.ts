/**
 * The text of the reminder that a site survey will be deleted (EVM-140 AC1; ADR-0024 pt 9; docs/ux/flows/e-maile.md; SR-DATA-01, SR-LOG-03, DO-K). Plain text, a
 * template in the code, filled ONLY with the number of the order, the date of the deletion (a date in the business zone) and a link built from the origin of the
 * panel in the configuration (never from a request, CWE-640). It carries NO address, NO phone, NO title and NO name of a person: the page of the order in the panel,
 * behind the sign-in, shows the rest. Pure, no framework.
 */
import { emailFooter } from '../../identity/index.ts';

export const SITE_SURVEY_REMINDER_SUBJECT_PREFIX = 'EVia Manager: wizja lokalna';
/** The page of a work order in the panel (`apps/web/src/paths.ts`). */
export const WORK_ORDER_PANEL_PATH = '/work-orders';

const DATE = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' });

/** "14.02.2027" in the business zone. */
export const formatDeletionDate = (instant: Date): string => DATE.format(instant);

export interface SiteSurveyReminderInput {
  readonly panelOrigin: string;
  /** The number of the order, "ZL-2026-0001" - the only name of the survey in the text. */
  readonly number: string;
  readonly workOrderId: string;
  /** The deadline of the survey: the day it will be deleted. */
  readonly expiresAt: Date;
}

export function siteSurveyReminderText(input: SiteSurveyReminderInput): { readonly subject: string; readonly text: string } {
  return {
    subject: `${SITE_SURVEY_REMINDER_SUBJECT_PREFIX} ${input.number} zostanie usunięta`,
    text: [
      'Dzień dobry,',
      '',
      `Wizja lokalna ${input.number} zostanie usunięta dnia ${formatDeletionDate(input.expiresAt)}.`,
      'Przypisz klienta, przedłuż albo odrzuć.',
      '',
      'Zlecenie w panelu:',
      `${input.panelOrigin}${WORK_ORDER_PANEL_PATH}/${input.workOrderId}`,
      '',
      emailFooter(input.panelOrigin),
      '',
    ].join('\n'),
  };
}
