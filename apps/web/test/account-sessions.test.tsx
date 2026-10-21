import type { AccountSession } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, problem, type Handler } from './api-fake.ts';
import {
  accountApi,
  EDITOR_ACCOUNT,
  END_OTHERS,
  goOffline,
  OTHER_SESSION_ID,
  resetAccountTest,
  SESSION_ID,
  SESSIONS,
  STEP_UP,
} from './account-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

const NOW = new Date('2026-10-20T10:00:00Z');
const THIRD_ID = '66666666-6666-4666-8666-666666666666';
const END_FIREFOX = `DELETE /api/v1/account/sessions/${OTHER_SESSION_ID}`;

const THIS: AccountSession = {
  id: SESSION_ID,
  current: true,
  browser: 'Edge',
  os: 'Windows',
  ipAddress: '198.51.100.23',
  lastSeenAt: '2026-10-20T09:59:50Z',
};
const FIREFOX: AccountSession = {
  id: OTHER_SESSION_ID,
  current: false,
  browser: 'Firefox',
  os: 'Windows',
  ipAddress: '203.0.113.45',
  lastSeenAt: '2026-10-20T06:10:00Z',
};
const CHROME: AccountSession = {
  id: THIRD_ID,
  current: false,
  browser: 'Chrome',
  os: 'Android',
  ipAddress: '2001:db8:5::17',
  lastSeenAt: '2026-10-19T16:40:00Z',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  resetAccountTest();
});

/** The list of sessions behind a step-up: the first read is refused, the confirmation lets the next ones through. */
function sessionsApi(lists: AccountSession[][], routes: Record<string, Handler> = {}) {
  let stepped = false;
  let read = 0;
  return accountApi(EDITOR_ACCOUNT, {
    [STEP_UP]: () => {
      stepped = true;
      return json(200, { csrfToken: 'csrf-stepped' });
    },
    [SESSIONS]: () => {
      if (!stepped) return problem(403, 'step_up_required');
      const items = lists[Math.min(read, lists.length - 1)] ?? [];
      read += 1;
      return json(200, { items }, { 'Cache-Control': 'no-store' });
    },
    ...routes,
  });
}

async function showSessions(api: ReturnType<typeof sessionsApi>) {
  await renderPanel('/account', api);
  await screen.findByRole('heading', { level: 2, name: 'Moje sesje' });
  await userEvent.click(screen.getByRole('button', { name: 'Pokaż sesje' }));
}

async function stepUp(title: string) {
  const dialog = await screen.findByRole('alertdialog', { name: title });
  await userEvent.type(within(dialog).getByLabelText('Kod z aplikacji uwierzytelniającej'), '123456');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Potwierdź' }));
}

describe('W-15 Moje sesje (EVM-028 AC6, AC8)', () => {
  it('EVM-028 AC6 "Pokaż sesje" asks for the step-up first (W-04); the table shows the browser and the system, the FULL IP, the last activity and "Ta sesja"; the focus is on the heading of the table', async () => {
    const api = sessionsApi([[THIS, FIREFOX, CHROME]]);
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    const table = await screen.findByRole('table', { name: 'Lista moich sesji' });
    expect(within(table).getByText('Edge · Windows')).toBeTruthy();
    expect(within(table).getByText('198.51.100.23')).toBeTruthy();
    expect(within(table).getByText('203.0.113.45')).toBeTruthy();
    expect(within(table).getByText('2001:db8:5::17')).toBeTruthy();
    expect(within(table).getByText('Chrome · Android')).toBeTruthy();
    expect(within(table).getByText('teraz')).toBeTruthy();
    expect(within(table).getByText(/^dziś, 0?8:10$/)).toBeTruthy();
    expect(within(table).getByText(/^wczoraj, 18:40$/)).toBeTruthy();
    expect(within(table).getByText('Ta sesja')).toBeTruthy();
    // The current session has no button: it is ended by "Wyloguj".
    expect(within(table).getAllByRole('button', { name: /^Zakończ sesję/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Zakończ pozostałe sesje' })).toBeTruthy();
    expect(screen.getByText('Konto może mieć najwyżej 5 sesji naraz — szóste logowanie zakończy najstarszą.')).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 3, name: 'Zalogowane przeglądarki · 3' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    // No raw User-Agent, no token anywhere in the page.
    expect(document.body.innerHTML).not.toMatch(/Mozilla|AppleWebKit/);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-028 AC6 without a step-up window nothing is asked twice: the confirmed step-up lets the list through', async () => {
    const api = sessionsApi([[THIS, FIREFOX]]);
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await screen.findByRole('table', { name: 'Lista moich sesji' });
    expect(api.calls(SESSIONS)).toHaveLength(2);
    expect(api.calls(STEP_UP)).toHaveLength(1);
  });

  it('EVM-028 AC6 "Anuluj" in W-04 shows nothing and says nothing', async () => {
    const api = sessionsApi([[THIS, FIREFOX]]);
    await showSessions(api);
    const dialog = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby zobaczyć swoje sesje' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pokaż sesje' })).toBeTruthy();
  });

  it('EVM-028 AC6 one session is "Konto jest zalogowane tylko w tej przeglądarce." — no table and no "Zakończ pozostałe sesje"', async () => {
    const api = sessionsApi([[THIS]]);
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    expect(await screen.findByText('Konto jest zalogowane tylko w tej przeglądarce.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zakończ pozostałe sesje' })).toBeNull();
  });

  it('EVM-028 AC6 a session without a recorded address shows a dash', async () => {
    const api = sessionsApi([[THIS, { ...FIREFOX, ipAddress: null }]]);
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    const table = await screen.findByRole('table', { name: 'Lista moich sesji' });
    expect(within(table).getByText('—')).toBeTruthy();
  });

  it('EVM-028 AC6 "Zakończ sesję" ends the chosen session by its record id, says so in a toast and reads the list again', async () => {
    const api = sessionsApi(
      [
        [THIS, FIREFOX, CHROME],
        [THIS, CHROME],
      ],
      { [END_FIREFOX]: () => new Response(null, { status: 204 }) },
    );
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ sesję Firefox · Windows, 203.0.113.45' }));
    expect(await screen.findByText('Zakończono sesję: Firefox · Windows.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Firefox · Windows')).toBeNull();
    });
    expect(api.calls(END_FIREFOX)).toHaveLength(1);
    expect(screen.getByText('Chrome · Android')).toBeTruthy();
  });

  it("EVM-028 AC8 a session that is no longer there (a stranger's looks the same: 404) is a toast and a fresh list", async () => {
    const api = sessionsApi([[THIS, FIREFOX], [THIS]], { [END_FIREFOX]: () => problem(404, 'not_found') });
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await userEvent.click(await screen.findByRole('button', { name: /^Zakończ sesję Firefox/ }));
    expect(await screen.findByText('Nie znaleziono sesji.')).toBeTruthy();
    expect(await screen.findByText('Konto jest zalogowane tylko w tej przeglądarce.')).toBeTruthy();
  });

  it('EVM-028 AC6 "Zakończ pozostałe sesje" ends all the others; the list is read again', async () => {
    const api = sessionsApi([[THIS, FIREFOX, CHROME], [THIS]], { [END_OTHERS]: () => json(200, { ended: 2 }) });
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ pozostałe sesje' }));
    expect(await screen.findByText('Zakończono 2 sesje.')).toBeTruthy();
    expect(await screen.findByText('Konto jest zalogowane tylko w tej przeglądarce.')).toBeTruthy();
  });

  it.each([
    [1, 'Zakończono 1 sesję.'],
    [5, 'Zakończono 5 sesji.'],
    [0, 'Nie było innych sesji do zakończenia.'],
  ])('EVM-028 AC6 ending %i other sessions is told with the right form', async (ended, text) => {
    const api = sessionsApi([[THIS, FIREFOX]], { [END_OTHERS]: () => json(200, { ended }) });
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ pozostałe sesje' }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('EVM-028 AC6 each change asks the server again: after the window ends, W-04 opens for "Zakończ sesję" and the same call goes again', async () => {
    let stepped = true;
    let listed = 0;
    const api = accountApi(EDITOR_ACCOUNT, {
      [STEP_UP]: () => {
        stepped = true;
        return json(200, { csrfToken: 'csrf-stepped' });
      },
      [SESSIONS]: () => {
        listed += 1;
        return listed === 1 ? problem(403, 'step_up_required') : json(200, { items: listed === 2 ? [THIS, FIREFOX] : [THIS] });
      },
      [END_FIREFOX]: () => {
        if (stepped) {
          stepped = false;
          return new Response(null, { status: 204 });
        }
        return problem(403, 'step_up_required');
      },
    });
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    stepped = false;
    await userEvent.click(await screen.findByRole('button', { name: /^Zakończ sesję Firefox/ }));
    await stepUp('Potwierdź tożsamość, aby zakończyć sesję');
    expect(await screen.findByText('Zakończono sesję: Firefox · Windows.')).toBeTruthy();
    expect(api.calls(END_FIREFOX)).toHaveLength(2);
  });

  it('EVM-028 AC8 a 429 and a failure of the network are told on the card; the data stays', async () => {
    let status = 429;
    const api = sessionsApi([[THIS, FIREFOX]], {
      [END_OTHERS]: () => (status === 429 ? problem(429, 'rate_limited', {}, { 'Retry-After': '120' }) : problem(500, 'internal_error')),
    });
    await showSessions(api);
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await userEvent.click(await screen.findByRole('button', { name: 'Zakończ pozostałe sesje' }));
    expect(await screen.findByText('Zbyt wiele prób. Spróbuj ponownie za 2 min.')).toBeTruthy();
    status = 500;
    await userEvent.click(screen.getByRole('button', { name: 'Zakończ pozostałe sesje' }));
    expect(
      await screen.findByText(
        'Nie udało się wykonać zmiany. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Lista moich sesji' })).toBeTruthy();
  });

  it('EVM-028 AC8 offline: "Pokaż sesje" is off; a loaded list stays under "Dane mogą być nieaktualne" with its buttons off', async () => {
    const api = sessionsApi([[THIS, FIREFOX]]);
    await renderPanel('/account', api);
    await screen.findByRole('heading', { level: 2, name: 'Moje sesje' });
    goOffline();
    expect(screen.getByRole('button', { name: 'Pokaż sesje' }).getAttribute('aria-disabled')).toBe('true');
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż sesje' }));
    await stepUp('Potwierdź tożsamość, aby zobaczyć swoje sesje');
    await screen.findByRole('table', { name: 'Lista moich sesji' });
    goOffline();
    expect(screen.getByText(/Dane mogą być nieaktualne \(z \d{2}:\d{2}\)\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Zakończ sesję Firefox/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Zakończ pozostałe sesje' }).getAttribute('aria-disabled')).toBe('true');
  });
});
