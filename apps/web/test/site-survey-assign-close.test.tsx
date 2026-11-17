import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { JAN, NOW, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';

// QA (EVM-138): the close button "Zamknij okno" of the dialog "Przypisz klienta" is guarded like Esc when the data of a new customer are typed.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('W-06 site survey: closing "Przypisz klienta" with typed data (EVM-138 AC3)', () => {
  it('EVM-138 AC3 "Zamknij okno" with a typed surname asks "Odrzucić zmiany?", "Wróć do edycji" keeps the data, "Odrzuć zmiany" closes and sends no PUT', async () => {
    const api = surveyApi(surveyOrder(), { 'POST /api/v1/customers/search': () => json(200, { items: [JAN], nextCursor: null }) });
    await renderPanel(SURVEY_PATH, api);
    const banner = await screen.findByRole('region', { name: 'Wizja lokalna — brak klienta' });
    await userEvent.click(within(banner).getByRole('button', { name: 'Przypisz klienta' }));
    const dialog = () => screen.getByRole('dialog', { name: 'Przypisz klienta' });
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj nowego klienta' }));
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Nazwisko' }), 'Nowak');

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Zamknij okno' }));
    const ask = await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Wróć do edycji' }));
    expect(within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Nazwisko' }).value).toBe('Nowak');

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Zamknij okno' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('region', { name: 'Wizja lokalna — brak klienta' })).toBeTruthy();
    expect(api.calls(`PUT ${SURVEY_URL}/customer`)).toHaveLength(0);
    expect(api.calls('POST /api/v1/customers')).toHaveLength(0);
  });
});
