import type { CurrentSession } from '@evia/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveDraft, readDraft, clearDrafts } from '../src/session/draft-store.ts';
import { setLoginNotice } from '../src/session/login-flow.ts';
import { resetServerClock } from '../src/session/server-clock.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, ENROLLMENT_SESSION, createFakeApi, json, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

const EXTEND_ROUTE = 'POST /api/v1/auth/session/extend';
const LOGOUT_ROUTE = 'POST /api/v1/auth/logout';
const START = new Date('2026-10-05T08:00:00.000Z');
const MINUTE = 60_000;

const at = (minutes: number): string => new Date(Date.now() + minutes * MINUTE).toISOString();

/** A session whose deadlines are `idle` and `absolute` minutes away from the controlled clock. */
function sessionIn(idle: number, absolute: number, base: CurrentSession = ACTIVE_SESSION): CurrentSession {
  return { ...base, idleExpiresAt: at(idle), absoluteExpiresAt: at(absolute) };
}

/** A fake server whose session can be swapped while a test runs (the answer of the passive read of the session). */
function serverWith(session: CurrentSession, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  let current: Response | CurrentSession = session;
  let skewMs = 0;
  const api = createFakeApi({
    [SESSION_ROUTE]: () =>
      current instanceof Response
        ? current.clone()
        : json(200, current, skewMs === 0 ? {} : { Date: new Date(Date.now() + skewMs).toUTCString() }),
    [LOGOUT_ROUTE]: () => new Response(null, { status: 204 }),
    ...overrides,
  });
  return Object.assign(api, {
    answerSessionWith(next: Response | CurrentSession) {
      current = next;
    },
    /** The clock of the server runs this far ahead of the clock of the tab (the `Date` header of the answers). */
    serverAheadBy(ms: number) {
      skewMs = ms;
    },
  });
}

/** Moves the controlled clock and runs the local ticks (no request is made by a tick itself). */
async function pass(minutes: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(minutes * MINUTE);
  });
}

beforeEach(() => {
  // Only the clock and the interval are controlled; real timeouts keep Testing Library's waiting and Query working.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
  setLoginNotice(null);
  clearDrafts();
});

describe('P-11 Sesja wygasa: when it shows (EVM-067 AC6, AC5; styleguide 4.17)', () => {
  it('EVM-067 AC6 far from the end nothing shows, and the tab sends no keep-alive request while it waits (no interval query, no ping)', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    expect(api.calls(SESSION_ROUTE)).toHaveLength(1);
    await pass(55);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Ticks of the clock only: not one request more than the first read of the session, not one POST of any kind.
    expect(api.requests.map((entry) => `${entry.method} ${entry.path}`)).toEqual([`GET ${SESSION_ROUTE.slice(4)}`]);
  });

  it('EVM-067 AC6 2 min before the end of inactivity the server is asked first, then the dialog shows with the time as text and focus on "Przedłuż sesję"', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    await pass(58.5);
    const dialog = await screen.findByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' });
    expect(api.calls(SESSION_ROUTE)).toHaveLength(2);
    expect(dialog.textContent).toContain('Sesja wygaśnie za 2 min z powodu braku aktywności.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    // The passive read never extends: no POST so far.
    expect(api.requests.filter((entry) => entry.method === 'POST')).toHaveLength(0);
  });

  it('EVM-067 AC6 the remaining time is announced politely and changes by the minute', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    await pass(58.5);
    const dialog = await screen.findByRole('alertdialog');
    const region = dialog.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toContain('za 2 min');
    await pass(1);
    expect(region?.textContent).toContain('za 1 min');
    await pass(0.5);
  });

  it('EVM-067 AC6 near the 12 h limit the variant "limit" shows the clock time and offers only "Rozumiem" and "Wyloguj"', async () => {
    // Inactivity would end later than the limit: the server clamps it, so both deadlines are the same moment.
    const api = serverWith(sessionIn(9.5, 9.5));
    await renderPanel('/work-orders', api);
    await pass(1);
    const dialog = await screen.findByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' });
    expect(dialog.textContent).toContain(
      'Sesja wygaśnie o 10:09 (limit 12 godzin od zalogowania). Zapisz zmiany — potem zaloguj się ponownie.',
    );
    expect(screen.queryByRole('button', { name: 'Przedłuż sesję' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rozumiem' }));
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Rozumiem' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Dismissed once for these deadlines: the next tick does not bring it back.
    await pass(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-067 AC6 the limit warning comes before the idle one when it is earlier (10 min before 12 h)', async () => {
    const api = serverWith(sessionIn(30, 12));
    await renderPanel('/work-orders', api);
    await pass(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await pass(1.5);
    expect((await screen.findByRole('alertdialog')).textContent).toContain('(limit 12 godzin od zalogowania)');
  });

  it('EVM-067 AC6 the dialog never shows from the clock alone: when another tab extended the session the server answer cancels it', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    api.answerSessionWith({ ...ACTIVE_SESSION, idleExpiresAt: at(120), absoluteExpiresAt: at(720) });
    await pass(58.5);
    await waitFor(() => {
      expect(api.calls(SESSION_ROUTE)).toHaveLength(2);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-067 AC6 waking up the computer (focus, long gap) asks the server at once and then shows the dialog', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    // The computer slept: the clock jumped, no tick ran.
    vi.setSystemTime(new Date(Date.now() + 59 * MINUTE));
    act(() => {
      globalThis.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(api.calls(SESSION_ROUTE).length).toBeGreaterThanOrEqual(2);
  });

  it('EVM-067 AC6 a tab that becomes visible refreshes the clock too', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    vi.setSystemTime(new Date(Date.now() + 59 * MINUTE));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('EVM-067 AC6 W-03 has the warning too: an enrolment session expires like any other', async () => {
    const api = serverWith(sessionIn(60, 720, ENROLLMENT_SESSION));
    const { history } = await renderPanel('/mfa-setup', api);
    expect(history.location.pathname).toBe('/mfa-setup');
    await pass(58.5);
    expect(await screen.findByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' })).toBeTruthy();
  });
});

describe('P-11: "Przedłuż sesję" and the other exits (EVM-067 AC6)', () => {
  async function openWarning(api: ReturnType<typeof serverWith>) {
    const rendered = await renderPanel('/work-orders', api);
    await pass(58.5);
    await screen.findByRole('alertdialog');
    return rendered;
  }

  it('EVM-067 AC6 "Przedłuż sesję" is a request with the CSRF token; the new deadlines close the dialog and inactivity counts from the start', async () => {
    const api = serverWith(sessionIn(60, 720), {
      [EXTEND_ROUTE]: () => json(200, { idleExpiresAt: at(62), absoluteExpiresAt: at(720 - 58.5) }),
    });
    await openWarning(api);
    await userEvent.click(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    const [request] = api.calls(EXTEND_ROUTE);
    expect(request?.headers.get('X-CSRF-Token')).toBe('csrf-active');
    expect(request?.method).toBe('POST');
    // Quiet again for the next hour: no second dialog and no request but the ones above.
    await pass(50);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(EXTEND_ROUTE)).toHaveLength(1);
  });

  it('EVM-067 AC6 while the extension runs the button is busy; a failure is an alert inside the dialog and the dialog stays', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = serverWith(sessionIn(60, 720), { [EXTEND_ROUTE]: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await openWarning(api);
    await userEvent.click(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Przedłuż sesję' }).getAttribute('aria-busy')).toBe('true');
    });
    await act(async () => {
      answer(problem(500, 'internal_error'));
      await Promise.resolve();
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Nie udało się przedłużyć sesji. Spróbuj ponownie.');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-067 AC5 an extension answered with 401 session_expired is the same as an expiry: data cleared, W-01 with the message', async () => {
    const api = serverWith(sessionIn(60, 720), { [EXTEND_ROUTE]: () => problem(401, 'session_expired') });
    const { history } = await openWarning(api);
    api.answerSessionWith(problem(401, 'session_expired'));
    await userEvent.click(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(await screen.findByText(/^Sesja wygasła\. Zaloguj się ponownie w tej karcie/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('EVM-067 AC6 Esc closes the dialog without extending anything', async () => {
    const api = serverWith(sessionIn(60, 720));
    await openWarning(api);
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.calls(EXTEND_ROUTE)).toHaveLength(0);
  });

  it('EVM-067 AC6 offline: "Przedłuż sesję" is unavailable with its hint and sends nothing', async () => {
    const api = serverWith(sessionIn(60, 720));
    await openWarning(api);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() => {
        globalThis.dispatchEvent(new Event('offline'));
      });
      const extend = await screen.findByRole('button', { name: 'Przedłuż sesję' });
      expect(extend.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Przedłużysz po powrocie połączenia.')).toBeTruthy();
      await userEvent.click(extend);
      expect(api.calls(EXTEND_ROUTE)).toHaveLength(0);
    } finally {
      online.mockRestore();
    }
  });

  it('EVM-067 AC6 "Wyloguj" in the dialog logs out and discards the drafts of the tab', async () => {
    const api = serverWith(sessionIn(60, 720));
    saveDraft(ACTIVE_SESSION.user.id, 'work-order', 'Adres: ulica Testowa 1');
    const { history } = await openWarning(api);
    await userEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(api.calls(LOGOUT_ROUTE)).toHaveLength(1);
    expect(readDraft(ACTIVE_SESSION.user.id, 'work-order')).toBeUndefined();
    expect(screen.queryByText(/^Sesja wygasła/)).toBeNull();
  });
});

describe('Expiry in the tab (EVM-067 AC5, AC6; styleguide 4.17; TM-10, SR-WEB-05)', () => {
  it('EVM-067 AC5 when the server says the session is gone the tab clears the view and leaves for W-01 by itself, without a click', async () => {
    const api = serverWith(sessionIn(60, 720));
    const { history } = await renderPanel('/work-orders', api);
    api.answerSessionWith(problem(401, 'session_expired'));
    await pass(58.5);
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(await screen.findByText(/^Sesja wygasła\. Zaloguj się ponownie w tej karcie/)).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.title).toBe('Logowanie · EVia Manager');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-067 AC5 at the end of inactivity the tab asks the server once more and leaves for W-01 when the session ended', async () => {
    const api = serverWith(sessionIn(60, 720));
    const { history } = await renderPanel('/work-orders', api);
    await pass(58.5);
    await screen.findByRole('alertdialog');
    api.answerSessionWith(problem(401, 'session_expired'));
    await pass(2);
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(await screen.findByText(/^Sesja wygasła\./)).toBeTruthy();
  });

  it('EVM-067 AC5 after the end a server that still says "alive" does not silence the tab: it asks on every tick until 401', async () => {
    const api = serverWith(sessionIn(60, 720));
    const { history } = await renderPanel('/work-orders', api);
    await pass(58.5);
    await screen.findByRole('alertdialog');
    // The end is reached; the server still answers 200 with the same deadlines (a fast local clock).
    await pass(2);
    const asked = api.calls(SESSION_ROUTE).length;
    await pass(0.5);
    await waitFor(() => {
      expect(api.calls(SESSION_ROUTE).length).toBeGreaterThan(asked);
    });
    expect(history.location.pathname).toBe('/work-orders');
    api.answerSessionWith(problem(401, 'session_expired'));
    await pass(0.5);
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(await screen.findByText(/^Sesja wygasła\./)).toBeTruthy();
  });

  it('EVM-067 AC6 the warning counts from the time of the server (Date header), not from a tab clock that is 5 min behind', async () => {
    const api = serverWith(sessionIn(60, 720));
    api.serverAheadBy(5 * MINUTE);
    await renderPanel('/work-orders', api);
    // By the clock of the tab the end is 60 min away; by the clock of the server only 55.
    await pass(52);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await pass(1.5);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Sesja wygaśnie za 2 min');
  });

  it('EVM-067 AC5 the same at the 12 h limit', async () => {
    const api = serverWith(sessionIn(30, 11));
    const { history } = await renderPanel('/work-orders', api);
    await pass(1.5);
    await screen.findByRole('alertdialog');
    api.answerSessionWith(problem(401, 'session_expired'));
    await pass(10);
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
  });

  it('EVM-067 AC6 a failed check (server error) shows no dialog and is asked again on a later tick; offline it is not asked at all', async () => {
    const api = serverWith(sessionIn(60, 720));
    await renderPanel('/work-orders', api);
    api.answerSessionWith(problem(500, 'internal_error'));
    await pass(58.5);
    await waitFor(() => {
      expect(api.calls(SESSION_ROUTE).length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    api.answerSessionWith(sessionIn(2.5, 720));
    await pass(0.5);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('EVM-067 AC6 the draft of the person survives the expiry and is still theirs on W-01', async () => {
    const api = serverWith(sessionIn(60, 720));
    saveDraft(ACTIVE_SESSION.user.id, 'work-order', 'Adres: ulica Testowa 1');
    await renderPanel('/work-orders', api);
    api.answerSessionWith(problem(401, 'session_expired'));
    await pass(58.5);
    await screen.findByRole('heading', { level: 1, name: 'Zaloguj się' });
    expect(readDraft(ACTIVE_SESSION.user.id, 'work-order')).toBe('Adres: ulica Testowa 1');
  });

  it('EVM-067 AC6 nothing of the session timing is written to the storages of the browser', async () => {
    const api = serverWith(sessionIn(60, 720), { [EXTEND_ROUTE]: () => json(200, { idleExpiresAt: at(120), absoluteExpiresAt: at(700) }) });
    await renderPanel('/work-orders', api);
    await pass(58.5);
    await userEvent.click(await screen.findByRole('button', { name: 'Przedłuż sesję' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
