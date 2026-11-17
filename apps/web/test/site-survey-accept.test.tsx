import { screen, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { problem } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { NOW, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';
import { describeTransitionFailure, menuEntries } from '../src/work-orders/transition-actions.ts';
import { ApiError } from '../src/api/client.ts';

const TRANSITIONS = `POST ${SURVEY_URL}/transitions`;
const STATUS = 'Status zlecenia: Wycena. Zmień status';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('W-06 site survey: the rule of the acceptance (EVM-138 AC4; flows/17)', () => {
  it('EVM-138 AC4 "Zaakceptuj" on a survey without a customer: "Aby zaakceptować, przypisz klienta", nothing is sent, "Przypisz klienta" leads on', async () => {
    const api = surveyApi(surveyOrder(), { [TRANSITIONS]: () => problem(500, 'internal_error') });
    await renderPanel(SURVEY_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: STATUS }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zaakceptuj' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' });
    expect(within(alert).getByText('Wizja lokalna nie ma klienta. Przypisz klienta, a potem zaakceptuj zlecenie.')).toBeTruthy();
    // the focus starts on the way forward
    expect(document.activeElement).toBe(within(alert).getByRole('button', { name: 'Przypisz klienta' }));
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    await userEvent.click(within(alert).getByRole('button', { name: 'Przypisz klienta' }));
    // one dialog at a time: the first is gone, the assignment is open
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Przypisz klienta' })).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-138 AC4 "Anuluj" closes the dialog and sends nothing; the dialog has no axe violations', async () => {
    const api = surveyApi();
    await renderPanel(SURVEY_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: STATUS }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zaakceptuj' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' });
    expect(await axeViolations(alert)).toEqual([]);
    await userEvent.click(within(alert).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-138 AC4 the menu of a survey has no "Anuluj zlecenie…": the one way out is "Odrzuć wizję…"', async () => {
    await renderPanel(SURVEY_PATH, surveyApi());
    await userEvent.click(await screen.findByRole('button', { name: STATUS }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toContain('Zaakceptuj');
    expect(items).toContain('Wstrzymaj…');
    expect(items).not.toContain('Anuluj zlecenie…');
  });

  it('EVM-138 AC4 409 customer_required from the server gives the same dialog, not an error under the badge', async () => {
    // an order that the panel takes for an ordinary one (no marker) but that the server judges to be without a customer
    const order = surveyOrder({ siteSurvey: null });
    const api = surveyApi(order, { [TRANSITIONS]: () => problem(409, 'customer_required') });
    await renderPanel(SURVEY_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: STATUS }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zaakceptuj' }));
    expect(await screen.findByRole('alertdialog', { name: 'Aby zaakceptować, przypisz klienta' })).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-138 AC4 the logic: 409 customer_required is its own failure; a survey has no cancel and no restore in the menu', () => {
    expect(describeTransitionFailure(new ApiError(409, { code: 'customer_required' }))).toEqual({ kind: 'customerRequired' });
    expect(describeTransitionFailure(new ApiError(409, { code: 'invalid_state_transition' }))).toEqual({ kind: 'conflict' });
    const survey = { siteSurvey: surveyOrder().siteSurvey };
    const open = menuEntries({ ...survey, status: 'quoting', allowedTransitions: ['accepted', 'on_hold', 'cancelled'] }, 'administrator');
    expect(open.map((entry) => entry.action)).toEqual(['accept', 'hold']);
    expect(menuEntries({ ...survey, status: 'cancelled', allowedTransitions: ['on_hold'] }, 'administrator')).toEqual([]);
    // an ordinary order keeps both
    expect(menuEntries({ status: 'quoting', allowedTransitions: ['cancelled'] }, 'administrator').map((entry) => entry.action)).toEqual([
      'cancel',
    ]);
    expect(menuEntries({ status: 'cancelled', allowedTransitions: ['on_hold'] }, 'administrator').map((entry) => entry.action)).toEqual([
      'restore',
    ]);
  });
});
