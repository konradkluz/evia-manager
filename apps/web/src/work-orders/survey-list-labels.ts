import { pluralForm } from './order-form.ts';
import { SURVEY_WARNING_DAYS } from './site-survey.ts';

/**
 * Polish texts of the site surveys in W-10 "Zlecenia" (EVM-138 AC1; docs/ux/flows/17-wizja-lokalna.md → W-10). Plain maps and functions
 * next to the screens (like `site-survey-labels.ts`); the Polish plural of the count is made here. No address, phone or name of a customer.
 */
export const surveyListText = {
  groupLegend: 'Wizje lokalne',
  all: 'Wszystkie zlecenia',
  only: 'Tylko wizje',
  exclude: 'Bez wizji',
  expiringView: 'Wygasające wizje',
  expiringChip: `Wygasają w ciągu ${String(SURVEY_WARNING_DAYS)} dni`,
  emptyOnlyTitle: 'Brak wizji lokalnych.',
  emptyOnlyDescription: 'Wizje zakłada się w aplikacji na telefonie albo w oknie „Nowe zlecenie”.',
  newSurvey: 'Nowa wizja lokalna',
  emptyExpiringTitle: `Żadna wizja nie wygasa w ciągu ${String(SURVEY_WARNING_DAYS)} dni.`,
  emptyExpiringDescription: 'Wizje, którym zostało więcej dni, znajdziesz w widoku „Tylko wizje”.',
  showAll: 'Pokaż wszystkie wizje',
  /** What a survey has no answer for in the columns of an ordinary order (the dash alone says nothing to a screen reader). */
  noStages: 'Wizja lokalna nie ma etapów',
  noDue: 'Wizja lokalna nie ma terminu etapu',
  noPayment: 'Wizja lokalna nie ma transz',
  /** The part of the name of a row of a survey whose title does not say it ("Wizja lokalna" is the default title). */
  rowMark: 'wizja lokalna',
  rowRejected: 'odrzucona',
  rowNoCustomer: 'brak klienta',
} as const;

/** "Wygasające wizje (3)" — the saved view with the count of the surveys that wait for a decision. */
export const expiringViewLabel = (count: number | undefined): string =>
  count === undefined ? surveyListText.expiringView : `${surveyListText.expiringView} (${String(count)})`;

/** "3 wizje do rozstrzygnięcia — wygasają w ciągu 15 dni" (1 wizja / 2–4 wizje / 5 wizji). */
export function toResolveText(count: number): string {
  const word = { one: 'wizja', few: 'wizje', many: 'wizji' }[pluralForm(count)];
  return `${String(count)} ${word} do rozstrzygnięcia — wygasają w ciągu ${String(SURVEY_WARNING_DAYS)} dni`;
}
