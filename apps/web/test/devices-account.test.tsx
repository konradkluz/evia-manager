import type { AccountDevice, Account } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, problem, type Handler } from './api-fake.ts';
import { accountApi, DEVICES, EDITOR_ACCOUNT, goOffline, resetAccountTest, STEP_UP } from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const NOW = new Date('2026-10-20T12:00:00Z');
const PIXEL_ID = '77777777-7777-4777-8777-777777777777';
const SAMSUNG_ID = '88888888-8888-4888-8888-888888888888';
const LOGOUT_PIXEL = `POST /api/v1/account/devices/${PIXEL_ID}/logout`;

const SAMSUNG: AccountDevice = {
  id: SAMSUNG_ID,
  model: 'Samsung SM-G781B',
  osVersion: '13',
  appVersion: '1.0.0',
  lastContactAt: '2026-10-20T11:30:00Z',
  createdAt: '2026-10-01T08:00:00Z',
  state: 'active',
};
const PIXEL: AccountDevice = {
  id: PIXEL_ID,
  model: 'Pixel 7',
  osVersion: '14',
  appVersion: '1.0.0',
  lastContactAt: '2026-10-16T11:30:00Z',
  createdAt: '2026-10-02T08:00:00Z',
  state: 'active',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  resetAccountTest();
});

function devicesApi(lists: AccountDevice[][], routes: Record<string, Handler> = {}, account: Account = EDITOR_ACCOUNT) {
  let read = 0;
  return accountApi(account, {
    [STEP_UP]: () => json(200, { csrfToken: 'csrf-stepped' }),
    [DEVICES]: () => {
      const items = lists[Math.min(read, lists.length - 1)] ?? [];
      read += 1;
      return json(200, { items }, { 'Cache-Control': 'no-store' });
    },
    ...routes,
  });
}

async function stepUp(title: string) {
  const dialog = await screen.findByRole('alertdialog', { name: title });
  await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
}

describe('W-15 Urządzenia (EVM-095 AC1, AC3)', () => {
  it('EVM-095 AC1 the section lists the own phones: model, system, app, last contact and state (icon + word), with no secret on the page', async () => {
    const api = devicesApi([[SAMSUNG, PIXEL]]);
    await renderPanel('/account', api);
    const table = await screen.findByRole('table', { name: 'Lista moich telefonów' });
    expect(within(table).getByText('Samsung SM-G781B · Android 13 · aplikacja 1.0.0')).toBeTruthy();
    expect(within(table).getByText('Pixel 7 · Android 14 · aplikacja 1.0.0')).toBeTruthy();
    expect(within(table).getByText('Zarejestrowano 01.10.2026')).toBeTruthy();
    expect(within(table).getAllByText('Aktywne')).toHaveLength(2);
    // the Pixel is silent for 4 days: the clock says so
    expect(within(table).getByText('Brak kontaktu od 4 dni')).toBeTruthy();
    expect(within(table).getAllByRole('button', { name: /^Wyloguj telefon/ })).toHaveLength(2);
    expect(screen.getByText(/Do wyczyszczenia telefonu poproś administratora/)).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-095 AC1 the section is hidden for Tylko odczyt and the panel does not ask for phones', async () => {
    const api = devicesApi([[SAMSUNG]], {}, { ...EDITOR_ACCOUNT, role: 'read_only' });
    await renderPanel('/account', api);
    await screen.findByRole('heading', { level: 2, name: 'Moje sesje' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Urządzenia' })).toBeNull();
    expect(api.calls(DEVICES)).toHaveLength(0);
  });

  it('EVM-095 AC1 an account without phones says so; a phone that is signed out has no button', async () => {
    const api = devicesApi([[]]);
    await renderPanel('/account', api);
    expect(await screen.findByText(/Nie masz zalogowanych telefonów/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Lista moich telefonów' })).toBeNull();
  });

  it('EVM-095 AC1 a signed-out, a pending and a wiped phone show their state and offer no logout', async () => {
    const api = devicesApi([
      [
        { ...SAMSUNG, state: 'signed_out' },
        { ...PIXEL, state: 'wipe_required' },
        { ...PIXEL, id: '99999999-9999-4999-8999-999999999999', model: 'Moto G', state: 'wiped' },
      ],
    ]);
    await renderPanel('/account', api);
    const table = await screen.findByRole('table', { name: 'Lista moich telefonów' });
    expect(within(table).getByText('Wylogowane')).toBeTruthy();
    expect(within(table).getByText('Czeka na wyczyszczenie')).toBeTruthy();
    expect(within(table).getByText('Wyczyszczone')).toBeTruthy();
    expect(within(table).queryByRole('button', { name: /^Wyloguj telefon/ })).toBeNull();
  });

  it('EVM-095 AC1 a failed read shows the error with a retry', async () => {
    let calls = 0;
    const api = devicesApi([[SAMSUNG]], {
      [DEVICES]: () => {
        calls += 1;
        return calls === 1 ? problem(500, 'internal_error') : json(200, { items: [SAMSUNG] });
      },
    });
    await renderPanel('/account', api);
    expect(await screen.findByText('Nie udało się wczytać listy telefonów.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table', { name: 'Lista moich telefonów' })).toBeTruthy();
  });

  it('EVM-095 AC1 offline the buttons are off and say they need a connection', async () => {
    const api = devicesApi([[SAMSUNG]]);
    await renderPanel('/account', api);
    await screen.findByRole('table', { name: 'Lista moich telefonów' });
    goOffline();
    expect(screen.getByRole('button', { name: 'Wyloguj telefon Samsung SM-G781B' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Wyloguj telefon Samsung SM-G781B' }).getAttribute('title')).toBe('Wymaga połączenia');
  });

  it('EVM-095 AC1 AC3 "Wyloguj telefon" asks first (focus on Anuluj), then logs out after the step-up, says the effect comes at the next connection and reads the list again', async () => {
    let stepped = false;
    const api = devicesApi([[SAMSUNG, PIXEL], [SAMSUNG]], {
      [STEP_UP]: () => {
        stepped = true;
        return json(200, { csrfToken: 'csrf-stepped' });
      },
      [LOGOUT_PIXEL]: () => (stepped ? new Response(null, { status: 204 }) : problem(403, 'step_up_required')),
    });
    await renderPanel('/account', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyloguj telefon Pixel 7' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować telefon „Pixel 7”?' });
    expect(within(dialog).getByText(/wyloguje się przy najbliższym połączeniu/)).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    });
    expect(await axeViolations(dialog, { bestPractice: true })).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj telefon' }));
    await stepUp('Potwierdź tożsamość, aby wylogować telefon');
    expect(await screen.findByText('Wylogowano telefon. Wyloguje się przy najbliższym połączeniu.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/Pixel 7/)).toBeNull();
    });
    expect(api.calls(LOGOUT_PIXEL)).toHaveLength(2);
    // the id of the record is in the path, nothing else is sent
    expect(api.calls(LOGOUT_PIXEL)[0]?.body).toBe('');
  });

  it('EVM-095 AC1 "Anuluj" in the dialog sends nothing', async () => {
    const api = devicesApi([[SAMSUNG]], {
      [`POST /api/v1/account/devices/${SAMSUNG_ID}/logout`]: () => new Response(null, { status: 204 }),
    });
    await renderPanel('/account', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyloguj telefon Samsung SM-G781B' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(api.calls(`POST /api/v1/account/devices/${SAMSUNG_ID}/logout`)).toHaveLength(0);
  });

  it("EVM-095 AC1 a phone that is not there (a stranger's looks the same: 404) is a toast and a fresh list", async () => {
    const api = devicesApi([[PIXEL], []], { [LOGOUT_PIXEL]: () => problem(404, 'not_found') });
    await renderPanel('/account', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyloguj telefon Pixel 7' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Wyloguj telefon' }));
    expect(await screen.findByText('Nie znaleziono telefonu.')).toBeTruthy();
    expect(await screen.findByText(/Nie masz zalogowanych telefonów/)).toBeTruthy();
  });

  it('EVM-095 AC1 another failure of the logout is told in a toast', async () => {
    const api = devicesApi([[PIXEL], [PIXEL]], { [LOGOUT_PIXEL]: () => problem(500, 'internal_error') });
    await renderPanel('/account', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wyloguj telefon Pixel 7' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Wyloguj telefon' }));
    expect(await screen.findByText('Nie udało się wylogować telefonu. Spróbuj ponownie.')).toBeTruthy();
  });
});
