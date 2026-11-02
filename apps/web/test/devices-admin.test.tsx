import type { ManagedDevice, ManagedDeviceList } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import {
  accountApi,
  ADMINISTRATOR_ACCOUNT,
  ASSERTION_OPTIONS,
  EDITOR_ACCOUNT,
  goOffline,
  resetAccountTest,
  STEP_UP,
  STEP_UP_OPTIONS,
  stubWebAuthn,
} from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const NOW = new Date('2026-10-20T12:00:00Z');
const LIST = 'GET /api/v1/devices';
const PIXEL_ID = '77777777-7777-4777-8777-777777777777';
const SAMSUNG_ID = '88888888-8888-4888-8888-888888888888';
const MOTO_ID = '99999999-9999-4999-8999-999999999999';
const ANNA = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const PIOTR = { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Piotr Testowy' };
const LOGOUT_PIXEL = `POST /api/v1/devices/${PIXEL_ID}/logout`;
const WIPE_PIXEL = `POST /api/v1/devices/${PIXEL_ID}/wipe`;

const SAMSUNG: ManagedDevice = {
  id: SAMSUNG_ID,
  user: PIOTR,
  model: 'Samsung SM-G781B',
  osVersion: '13',
  appVersion: '1.0.0',
  patchLevel: 'current',
  lastContactAt: '2026-10-20T11:30:00Z',
  state: 'active',
  pendingItemsReported: 0,
};
const PIXEL: ManagedDevice = {
  id: PIXEL_ID,
  user: ANNA,
  model: 'Pixel 7',
  osVersion: '14',
  appVersion: '1.0.0',
  patchLevel: 'older_12m',
  lastContactAt: '2026-10-11T11:30:00Z',
  state: 'active',
  pendingItemsReported: 4,
};
const MOTO: ManagedDevice = {
  id: MOTO_ID,
  user: PIOTR,
  model: 'Moto G',
  osVersion: '12',
  appVersion: '0.9.2',
  patchLevel: 'unknown',
  lastContactAt: '2026-10-02T11:30:00Z',
  state: 'wipe_required',
  pendingItemsReported: 0,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  stubWebAuthn();
});
afterEach(() => {
  vi.useRealTimers();
  resetAccountTest();
});

const page = (items: ManagedDevice[], nextCursor: string | null = null): ManagedDeviceList => ({ items, nextCursor });

/** The list behind a step-up (the first read is refused, the confirmation lets the next ones through); `pages` answer one read after another. */
function devicesApi(
  pages: Array<ManagedDeviceList | Response>,
  routes: Record<string, Handler> = {},
  stepped = false,
  onStepUp: () => void = () => undefined,
) {
  let isStepped = stepped;
  let read = 0;
  return accountApi(ADMINISTRATOR_ACCOUNT, {
    [STEP_UP_OPTIONS]: () => json(200, ASSERTION_OPTIONS),
    [STEP_UP]: () => {
      isStepped = true;
      onStepUp();
      return json(200, { csrfToken: 'csrf-stepped' });
    },
    'GET /api/v1/account/devices': () => json(200, { items: [] }),
    [LIST]: () => {
      if (!isStepped) return problem(403, 'step_up_required');
      const answer = pages[Math.min(read, pages.length - 1)];
      read += 1;
      return answer instanceof Response ? answer : json(200, answer ?? page([]), { 'Cache-Control': 'no-store' });
    },
    ...routes,
  });
}

async function stepUp(title: string) {
  const dialog = await screen.findByRole('alertdialog', { name: title });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Użyj klucza dostępu' }));
}

async function openList(api: ReturnType<typeof devicesApi>) {
  await renderPanel('/administration/devices', api, { heading: false });
  await stepUp('Potwierdź tożsamość, aby zobaczyć urządzenia');
  return screen.findByRole('table', { name: 'Urządzenia użytkowników' });
}

async function openMenu(label: string, item: string) {
  await userEvent.click(await screen.findByRole('button', { name: label }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('W-17 Urządzenia użytkowników (EVM-095 AC2)', () => {
  it('EVM-095 AC2 step-up on entry, then all devices with last contact, level of patches and state as icon + word; the tab is there', async () => {
    const api = devicesApi([page([SAMSUNG, PIXEL, MOTO])]);
    const table = await openList(api);
    expect(screen.getByRole('tab', { name: 'Urządzenia', selected: true })).toBeTruthy();
    expect(within(table).getByText('Samsung SM-G781B')).toBeTruthy();
    expect(within(table).getByText('Anna Testowa')).toBeTruthy();
    expect(within(table).getByText('Aktualne')).toBeTruthy();
    expect(within(table).getByText('Starsze niż 12 mies.')).toBeTruthy();
    expect(within(table).getByText('nieznane')).toBeTruthy();
    expect(within(table).getAllByText('Aktywne')).toHaveLength(2);
    expect(within(table).getByText('Czeka na wyczyszczenie')).toBeTruthy();
    // 9 days of silence: the clock and "data hidden in the phone"
    expect(within(table).getByText('Brak kontaktu od 9 dni · Dane zleceń ukryte w telefonie')).toBeTruthy();
    expect(screen.getByText('3 urządzenia')).toBeTruthy();
    expect(api.calls(STEP_UP)).toHaveLength(1);
    // no secret, address or serial number anywhere in the page
    expect(document.body.innerHTML).not.toMatch(/secret|serial|imei|ipAddress/i);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-095 AC2 "Anuluj" in W-04 shows no data, only the empty state with a way back, and sends no further request', async () => {
    const api = devicesApi([page([SAMSUNG])]);
    await renderPanel('/administration/devices', api, { heading: false });
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zobaczyć urządzenia' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByText('Potwierdź tożsamość, aby zobaczyć urządzenia.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Samsung SM-G781B')).toBeNull();
    expect(api.calls(LIST)).toHaveLength(1);
    expect(api.calls(STEP_UP)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź tożsamość' }));
    await stepUp('Potwierdź tożsamość, aby zobaczyć urządzenia');
    expect(await screen.findByRole('table', { name: 'Urządzenia użytkowników' })).toBeTruthy();
  });

  it('EVM-095 AC2 an Editor sees "Brak dostępu" with no tab and the panel does not ask for devices', async () => {
    const api = accountApi(EDITOR_ACCOUNT, { [LIST]: () => problem(403, 'forbidden') });
    await renderPanel('/administration/devices', api, { heading: false });
    expect(await screen.findByText('Nie masz dostępu do administracji.')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Urządzenia' })).toBeNull();
    expect(api.calls(LIST)).toHaveLength(0);
  });

  it('EVM-095 AC2 a 403 forbidden from the server shows "Brak dostępu" without data', async () => {
    const api = devicesApi([], { [LIST]: () => problem(403, 'forbidden') });
    await renderPanel('/administration/devices', api, { heading: false });
    expect(await screen.findByText('Nie masz dostępu do administracji.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('EVM-095 AC2 an empty list, a list empty under filters and a failed read have their own states', async () => {
    const api = devicesApi([page([]), page([]), problem(500, 'internal_error'), page([SAMSUNG])], {}, true);
    await renderPanel('/administration/devices', api, { heading: false });
    expect(await screen.findByText('Żaden telefon nie jest zalogowany.')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Stan'), 'wiped');
    expect(await screen.findByText('Żadne urządzenie nie pasuje do filtrów.')).toBeTruthy();
    expect(api.calls(LIST).at(-1)?.query.get('state')).toBe('wiped');
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    expect(await screen.findByText('Nie udało się wczytać urządzeń.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('table', { name: 'Urządzenia użytkowników' })).toBeTruthy();
  });

  it('EVM-095 AC2 filters by user and state are sent to the server and the pages follow the cursor', async () => {
    const api = devicesApi([page([SAMSUNG, PIXEL], 'cursor-1'), page([MOTO]), page([SAMSUNG, PIXEL], 'cursor-1'), page([PIXEL])], {}, true);
    await renderPanel('/administration/devices', api, { heading: false });
    await screen.findByRole('table', { name: 'Urządzenia użytkowników' });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Moto G')).toBeTruthy();
    expect(api.calls(LIST).at(-1)?.query.get('cursor')).toBe('cursor-1');
    expect(screen.getByText('1 urządzenie')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    await screen.findByText('Pixel 7');
    await userEvent.selectOptions(screen.getByLabelText('Użytkownik'), ANNA.userId);
    await waitFor(() => {
      expect(api.calls(LIST).at(-1)?.query.get('userId')).toBe(ANNA.userId);
    });
    expect(api.calls(LIST).at(-1)?.query.get('cursor')).toBeNull();
  });

  it('EVM-095 AC2 a cursor the server refuses brings the first page back with a message', async () => {
    const api = devicesApi([page([SAMSUNG], 'cursor-1'), problem(400, 'invalid_cursor'), page([SAMSUNG])], {}, true);
    await renderPanel('/administration/devices', api, { heading: false });
    await screen.findByRole('table', { name: 'Urządzenia użytkowników' });
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('Lista została zaktualizowana — wracamy na pierwszą stronę.')).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Urządzenia użytkowników' })).toBeTruthy();
  });

  it('EVM-095 AC2 offline the paging and the menus are off', async () => {
    const api = devicesApi([page([SAMSUNG], 'cursor-1')], {}, true);
    await renderPanel('/administration/devices', api, { heading: false });
    await screen.findByRole('table', { name: 'Urządzenia użytkowników' });
    goOffline();
    expect(screen.getByRole('button', { name: 'Następna strona' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Akcje dla Samsung SM-G781B, Piotr Testowy' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Wymaga połączenia')).toBeTruthy();
  });
});

describe('W-17 Wyloguj urządzenie (EVM-095 AC3)', () => {
  it('EVM-095 AC3 "Wyloguj urządzenie…" asks first (focus on Anuluj), logs out after the confirmation, says so and reads the list again', async () => {
    const api = devicesApi([page([SAMSUNG, PIXEL]), page([{ ...PIXEL, state: 'signed_out' }, SAMSUNG])], {
      [LOGOUT_PIXEL]: () => new Response(null, { status: 204 }),
    });
    await openList(api);
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Wyloguj urządzenie…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Wylogować „Pixel 7” użytkownika Anna Testowa?' });
    expect(within(dialog).getByText(/Miejsce w limicie 2 telefonów się zwolni/)).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj urządzenie' }));
    expect(await screen.findByText('Zlecono wylogowanie urządzenia.')).toBeTruthy();
    expect(await within(screen.getByRole('table', { name: 'Urządzenia użytkowników' })).findByText('Wylogowane')).toBeTruthy();
    expect(api.calls(LOGOUT_PIXEL)).toHaveLength(1);
  });

  it('EVM-095 AC3 a device without an active session cannot be logged out, and the item says why', async () => {
    const api = devicesApi([page([{ ...PIXEL, state: 'signed_out' }])], {}, true);
    await renderPanel('/administration/devices', api, { heading: false });
    await screen.findByRole('table', { name: 'Urządzenia użytkowników' });
    await userEvent.click(screen.getByRole('button', { name: 'Akcje dla Pixel 7, Anna Testowa' }));
    const item = await screen.findByRole('menuitem', { name: /^Wyloguj urządzenie…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Urządzenie nie ma aktywnej sesji.')).toBeTruthy();
  });

  it('EVM-095 AC3 a failure and a vanished device are told; "Anuluj" sends nothing', async () => {
    const api = devicesApi([page([PIXEL]), page([])], {
      [LOGOUT_PIXEL]: () => problem(500, 'internal_error'),
    });
    await openList(api);
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Wyloguj urządzenie…');
    let dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj urządzenie' }));
    expect(await within(dialog).findByText('Nie udało się wykonać operacji. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    api.set(LOGOUT_PIXEL, () => problem(404, 'not_found'));
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Wyloguj urządzenie…');
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyloguj urządzenie' }));
    expect(await screen.findByText('Nie znaleziono urządzenia.')).toBeTruthy();
    expect(await screen.findByText('Żaden telefon nie jest zalogowany.')).toBeTruthy();
  });

  it('EVM-095 AC3 a step-up asked by the server meanwhile opens W-04 and the same call goes again', async () => {
    let stepped = false;
    const api = devicesApi(
      [page([PIXEL]), page([PIXEL])],
      { [LOGOUT_PIXEL]: () => (stepped ? new Response(null, { status: 204 }) : problem(403, 'step_up_required')) },
      false,
      () => {
        stepped = true;
      },
    );
    await openList(api);
    stepped = false;
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Wyloguj urządzenie…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Wyloguj urządzenie' }));
    await stepUp('Potwierdź tożsamość, aby wylogować urządzenie');
    expect(await screen.findByText('Zlecono wylogowanie urządzenia.')).toBeTruthy();
    expect(api.calls(LOGOUT_PIXEL)).toHaveLength(2);
  });
});

describe('W-17 Zablokuj i wyczyść (EVM-095 AC4)', () => {
  it('EVM-095 AC4 the dialog shows the number of unsent items of THIS phone, warns, speaks of company data and keeps the button off until the model is typed', async () => {
    const api = devicesApi([page([PIXEL]), page([{ ...PIXEL, state: 'wipe_required' }])], {
      [WIPE_PIXEL]: () => new Response(null, { status: 204 }),
    });
    await openList(api);
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Zablokuj i wyczyść…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Zablokować i wyczyścić „Pixel 7”?' });
    expect(within(dialog).getByText(/wszystkie dane firmowe/)).toBeTruthy();
    expect(within(dialog).getByText(/nie można cofnąć/)).toBeTruthy();
    expect(within(dialog).getByText('Ostatnio zgłoszona liczba niewysłanych elementów na tym telefonie: 4.')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    });
    const confirm = within(dialog).getByRole('button', { name: 'Zablokuj i wyczyść' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(await axeViolations(dialog, { bestPractice: true })).toEqual([]);
    const field = within(dialog).getByLabelText('Wpisz „Pixel 7”, aby potwierdzić');
    await userEvent.type(field, 'pixel 7');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await userEvent.clear(field);
    await userEvent.type(field, '  Pixel 7 ');
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(confirm);
    expect(await screen.findByText(/Zlecono zablokowanie i wyczyszczenie urządzenia/)).toBeTruthy();
    expect(await within(screen.getByRole('table', { name: 'Urządzenia użytkowników' })).findByText('Czeka na wyczyszczenie')).toBeTruthy();
    expect(parseBody(api.calls(WIPE_PIXEL)[0]?.body ?? '')).toEqual({ confirmModel: '  Pixel 7 ' });
  });

  it('EVM-095 AC4 the server compares the model again: 400 device_model_mismatch is told without echo and the dialog stays', async () => {
    const api = devicesApi([page([PIXEL])], { [WIPE_PIXEL]: () => problem(400, 'device_model_mismatch') });
    await openList(api);
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Zablokuj i wyczyść…');
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText('Wpisz „Pixel 7”, aby potwierdzić'), 'Pixel 7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj i wyczyść' }));
    expect(await within(dialog).findByText('Wpisana nazwa nie zgadza się z modelem urządzenia.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('EVM-095 AC4 a pending or wiped device cannot be wiped again, and the item says why; another failure is told; a vanished device refreshes the list', async () => {
    const api = devicesApi([page([MOTO, PIXEL]), page([MOTO])], {
      [WIPE_PIXEL]: () => problem(500, 'internal_error'),
    });
    await openList(api);
    await userEvent.click(screen.getByRole('button', { name: 'Akcje dla Moto G, Piotr Testowy' }));
    const item = await screen.findByRole('menuitem', { name: /^Zablokuj i wyczyść…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Wyczyszczenie jest już zlecone.')).toBeTruthy();
    await userEvent.keyboard('{Escape}');

    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Zablokuj i wyczyść…');
    let dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText('Wpisz „Pixel 7”, aby potwierdzić'), 'Pixel 7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj i wyczyść' }));
    expect(await within(dialog).findByText('Nie udało się wykonać operacji. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));

    api.set(WIPE_PIXEL, () => problem(404, 'not_found'));
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Zablokuj i wyczyść…');
    dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText('Wpisz „Pixel 7”, aby potwierdzić'), 'Pixel 7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj i wyczyść' }));
    expect(await screen.findByText('Nie znaleziono urządzenia.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Pixel 7')).toBeNull();
    });
  });

  it('EVM-095 AC4 the wipe goes through W-04 when the server asks and then repeats the same call', async () => {
    let stepped = false;
    const api = devicesApi(
      [page([PIXEL]), page([PIXEL])],
      { [WIPE_PIXEL]: () => (stepped ? new Response(null, { status: 204 }) : problem(403, 'step_up_required')) },
      false,
      () => {
        stepped = true;
      },
    );
    await openList(api);
    stepped = false;
    await openMenu('Akcje dla Pixel 7, Anna Testowa', 'Zablokuj i wyczyść…');
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText('Wpisz „Pixel 7”, aby potwierdzić'), 'Pixel 7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zablokuj i wyczyść' }));
    await stepUp('Potwierdź tożsamość, aby zablokować i wyczyścić urządzenie');
    expect(await screen.findByText(/Zlecono zablokowanie i wyczyszczenie urządzenia/)).toBeTruthy();
    expect(api.calls(WIPE_PIXEL)).toHaveLength(2);
  });
});
