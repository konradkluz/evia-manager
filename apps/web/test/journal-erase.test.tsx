import type { TimelineEntry } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { json, problem, type Handler } from './api-fake.ts';
import { NOW, TIMELINE, entry, eventEntry, journalApi, roleSession } from './journal-api.ts';
import { renderPanel } from './render.tsx';
import { ORDER_ID } from './work-order-api.ts';
import { userEvent } from './user.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby zredagować treść wpisu';
const CANARY = 'PESEL 00000000000 w treści';
const MARKER = 'Treść usunięta przez administratora 11.10.2026.';
const REDACTED_AT = '2026-10-11T12:00:00.000Z';

const STEP_UP_ROUTES: Record<string, Handler> = {
  'POST /api/v1/auth/step-up/options': () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  'POST /api/v1/auth/step-up': () => json(200, { csrfToken: 'csrf-rotated' }),
};

function stubWebAuthn() {
  const credential = {
    id: 'Y3JlZA',
    rawId: 'Y3JlZA',
    type: 'public-key',
    response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  };
  class Fake {
    static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
    toJSON() {
      return credential;
    }
  }
  vi.stubGlobal('PublicKeyCredential', Fake);
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(() => Promise.resolve(new Fake())) }, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  stubWebAuthn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

const NOTE = entry(1, { body: CANARY });
const itemRoute = (id: string) => `${TIMELINE}/${id}`;
const inTurn = (...answers: Array<() => Response>): Handler => {
  let index = 0;
  return () => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer === undefined) throw new Error('no answer');
    return answer();
  };
};

/** A fake of the store of the journal: the list honours `includeDeleted` (the Administrator only), the reads carry the ETag. */
function eraseApi(
  initial: readonly TimelineEntry[],
  routes: Record<string, Handler> | ((put: (changed: TimelineEntry) => void) => Record<string, Handler>) = {},
  session?: Parameters<typeof journalApi>[0]['session'],
) {
  let items = [...initial];
  const put = (changed: TimelineEntry) => {
    items = items.map((item) => (item.id === changed.id ? changed : item));
  };
  const own: Record<string, Handler> = {};
  for (const item of initial) {
    own[`GET ${itemRoute(item.id)}`] = () =>
      json(
        200,
        items.find((other) => other.id === item.id),
        { ETag: '"3"' },
      );
    own[`DELETE ${itemRoute(item.id)}`] = () => {
      put({ ...item, deletedAt: REDACTED_AT });
      return new Response(null, { status: 204 });
    };
    own[`POST ${itemRoute(item.id)}/restore`] = () => {
      put({ ...item, deletedAt: null });
      return json(200, { ...item, deletedAt: null }, { ETag: '"5"' });
    };
    own[`POST ${itemRoute(item.id)}/redact`] = () => {
      const redacted = { ...item, body: MARKER, redactedAt: REDACTED_AT };
      put(redacted);
      return json(200, redacted, { ETag: '"4"' });
    };
  }
  return journalApi({
    entries: [],
    ...(session === undefined ? {} : { session }),
    list: (request) => {
      const withDeleted = request.query.get('includeDeleted') === 'true';
      return json(200, { items: items.filter((item) => withDeleted || item.deletedAt === null), nextCursor: null });
    },
    routes: { ...STEP_UP_ROUTES, ...own, ...(typeof routes === 'function' ? routes(put) : routes) },
  });
}

async function openJournal(api: ReturnType<typeof eraseApi>) {
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
  await screen.findByRole('heading', { level: 2, name: 'Dziennik' });
}

const menuButton = () => screen.findByRole('button', { name: /^Akcje wpisu/ });
async function choose(item: string) {
  await userEvent.click(await menuButton());
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('W-08 usunięcie wpisu (EVM-040 AC1, AC7)', () => {
  it('EVM-040 AC1 "Usuń wpis" sends the version of the entry, shows the toast with "Cofnij" and marks the entry "Usunięty" for the Administrator', async () => {
    const api = eraseApi([NOTE]);
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Usuń wpis');

    expect(await screen.findByText('Usunięto wpis.')).toBeTruthy();
    const [call] = api.calls(`DELETE ${itemRoute(NOTE.id)}`);
    expect(call?.headers.get('If-Match')).toBe('"3"');
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUID_V7);
    // the Administrator reads the journal with the deleted entries and sees the mark
    expect(api.calls(`GET ${TIMELINE}`).every((read) => read.query.get('includeDeleted') === 'true')).toBe(true);
    expect(await screen.findByText('Usunięty')).toBeTruthy();
  });

  it('EVM-040 AC1 "Przywróć wpis" restores a deleted entry with its own version and the entry loses the mark', async () => {
    const api = eraseApi([{ ...NOTE, deletedAt: '2026-10-11T11:00:00.000Z' }]);
    await openJournal(api);
    expect(await screen.findByText('Usunięty')).toBeTruthy();
    await choose('Przywróć wpis');

    expect(await screen.findByText('Przywrócono wpis.')).toBeTruthy();
    const [call] = api.calls(`POST ${itemRoute(NOTE.id)}/restore`);
    expect(call?.headers.get('If-Match')).toBe('"3"');
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUID_V7);
    await waitFor(() => {
      expect(screen.queryByText('Usunięty')).toBeNull();
    });
  });

  it('EVM-040 AC1 the toast "Cofnij" after a delete restores the entry', async () => {
    const api = eraseApi([NOTE]);
    await openJournal(api);
    await choose('Usuń wpis');
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByText('Przywrócono wpis.')).toBeTruthy();
    expect(api.calls(`POST ${itemRoute(NOTE.id)}/restore`)).toHaveLength(1);
  });

  it('EVM-040 AC7 a version conflict (412) is told in words and the journal is read again', async () => {
    const api = eraseApi([NOTE], { [`DELETE ${itemRoute(NOTE.id)}`]: () => problem(412, 'version_conflict') });
    await openJournal(api);
    await screen.findByText(CANARY);
    const reads = () => api.calls(`GET ${TIMELINE}`).length;
    const before = reads();
    await choose('Usuń wpis');
    expect(await screen.findByText('Wpis zmieniono w międzyczasie. Dziennik został odświeżony — spróbuj ponownie.')).toBeTruthy();
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(before);
    });
  });

  it('EVM-040 AC7 offline: the items are disabled with the reason and nothing is sent', async () => {
    const api = eraseApi([NOTE]);
    await openJournal(api);
    await screen.findByText(CANARY);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await userEvent.click(await menuButton());
    const remove = await screen.findByRole('menuitem', { name: /^Usuń wpis/ });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /^Zredaguj treść…/ }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(remove);
    expect(api.calls(`DELETE ${itemRoute(NOTE.id)}`)).toHaveLength(0);
  });
});

describe('W-08 redakcja treści (EVM-040 AC2, AC3, AC7)', () => {
  it('EVM-040 AC2 the dialog warns, W-04 follows 403 step_up_required, the same call is sent again and the cache holds the marker, not the old text', async () => {
    const api = eraseApi([NOTE], (put) => ({
      [`POST ${itemRoute(NOTE.id)}/redact`]: inTurn(
        () => problem(403, 'step_up_required'),
        () => {
          const redacted = { ...NOTE, body: MARKER, redactedAt: REDACTED_AT };
          put(redacted);
          return json(200, redacted, { ETag: '"4"' });
        },
      ),
    }));
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Zredaguj treść…');

    const dialog = await screen.findByRole('alertdialog', { name: 'Zredagować treść wpisu?' });
    const view = within(dialog);
    expect(view.getByText('Treść zostanie zastąpiona znacznikiem — tej operacji nie można cofnąć.')).toBeTruthy();
    expect(dialog.textContent).not.toContain(CANARY);
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Anuluj' }));
    expect(view.getByRole('button', { name: 'Zredaguj treść' }).className).toContain('bg-action-danger-bg');
    expect(await axeViolations(dialog)).toEqual([]);

    await userEvent.click(view.getByRole('button', { name: 'Zredaguj treść' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    expect(screen.queryByRole('alertdialog', { name: 'Zredagować treść wpisu?' })).toBeNull();
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));

    expect(await screen.findByText('Zredagowano treść wpisu.')).toBeTruthy();
    const calls = api.calls(`POST ${itemRoute(NOTE.id)}/redact`);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.headers.get('If-Match')).toBe('"3"');
    await waitFor(() => {
      expect(screen.queryByText(CANARY)).toBeNull();
    });
    expect(await screen.findByText(MARKER)).toBeTruthy();
    expect(document.body.textContent).not.toContain(CANARY);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('EVM-040 AC7 cancelling W-04 says "Nie wykonano operacji." and changes nothing', async () => {
    const api = eraseApi([NOTE], { [`POST ${itemRoute(NOTE.id)}/redact`]: () => problem(403, 'step_up_required') });
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Zredaguj treść…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zredaguj treść' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Zredagować treść wpisu?' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Nie wykonano operacji.');
    expect(screen.getByText(CANARY)).toBeTruthy();
    expect(api.calls('POST /api/v1/auth/step-up')).toHaveLength(0);
  });

  it('EVM-040 AC3 a refused register (503) shows "Nie udało się zredagować treści. Spróbuj ponownie później." and the text stays', async () => {
    const api = eraseApi([NOTE], { [`POST ${itemRoute(NOTE.id)}/redact`]: () => problem(503, 'deletion_register_unavailable') });
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Zredaguj treść…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Zredagować treść wpisu?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zredaguj treść' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Nie udało się zredagować treści. Spróbuj ponownie później.');
    expect(screen.getByText(CANARY)).toBeTruthy();
    expect(screen.queryByText('Zredagowano treść wpisu.')).toBeNull();
  });

  it('EVM-040 AC7 a version conflict (412) keeps the dialog open with the words', async () => {
    const api = eraseApi([NOTE], { [`POST ${itemRoute(NOTE.id)}/redact`]: () => problem(412, 'version_conflict') });
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Zredaguj treść…');
    const dialog = await screen.findByRole('alertdialog', { name: 'Zredagować treść wpisu?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zredaguj treść' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Wpis zmieniono w międzyczasie. Dziennik został odświeżony — spróbuj ponownie.',
    );
  });

  it('EVM-040 AC2 a deleted entry can be redacted too and "Anuluj" closes the dialog without a call', async () => {
    const api = eraseApi([{ ...NOTE, deletedAt: '2026-10-11T11:00:00.000Z' }]);
    await openJournal(api);
    await screen.findByText('Usunięty');
    await choose('Zredaguj treść…');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(`POST ${itemRoute(NOTE.id)}/redact`)).toHaveLength(0);
  });

  it('EVM-040 AC2 an entry that is redacted already has the item disabled with the reason', async () => {
    const api = eraseApi([{ ...NOTE, body: MARKER, redactedAt: '2026-10-11T10:00:00.000Z' }]);
    await openJournal(api);
    await screen.findByText(MARKER);
    await userEvent.click(await menuButton());
    expect(screen.getByRole('menuitem', { name: /^Zredaguj treść…/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Treść wpisu jest już zredagowana.')).toBeTruthy();
  });
});

describe('W-08 uprawnienia i zdarzenia (EVM-040 AC5, AC6)', () => {
  it('EVM-040 AC6 the Editor sees "Usuń wpis" and "Zredaguj treść…" disabled with "Usunąć wpis może tylko administrator." and asks for no deleted entries', async () => {
    const api = eraseApi([NOTE], {}, roleSession('editor'));
    await openJournal(api);
    await screen.findByText(CANARY);
    await userEvent.click(await menuButton());
    for (const name of ['Usuń wpis', 'Zredaguj treść…']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getAllByText('Usunąć wpis może tylko administrator.').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('menuitem', { name: /^Usuń wpis/ }));
    expect(api.calls(`DELETE ${itemRoute(NOTE.id)}`)).toHaveLength(0);
    expect(api.calls(`GET ${TIMELINE}`).every((read) => read.query.get('includeDeleted') === null)).toBe(true);
  });

  it('EVM-040 AC6 Tylko odczyt has no menu of the entry', async () => {
    await openJournal(eraseApi([NOTE], {}, roleSession('read_only')));
    await screen.findByText(CANARY);
    expect(screen.queryByRole('button', { name: /^Akcje wpisu/ })).toBeNull();
  });

  it('EVM-040 AC5 an automatic entry has no menu: it cannot be deleted or redacted', async () => {
    await openJournal(eraseApi([eventEntry(1, { toStatus: 'done' })]));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem', { name: /^Zmiana w zleceniu:/ })).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /^Akcje wpisu/ })).toBeNull();
  });

  it('EVM-040 AC5 when the API refuses an automatic entry (409 entry_is_event) the toast says it cannot be deleted', async () => {
    const api = eraseApi([NOTE], { [`DELETE ${itemRoute(NOTE.id)}`]: () => problem(409, 'entry_is_event') });
    await openJournal(api);
    await screen.findByText(CANARY);
    await choose('Usuń wpis');
    expect(await screen.findByText('Zmian wprowadzonych automatycznie nie można usunąć ani zredagować.')).toBeTruthy();
  });
});
