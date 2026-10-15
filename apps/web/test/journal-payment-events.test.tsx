import { screen, waitFor } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { NOW, TIMELINE, entry, eventEntry, journalApi } from './journal-api.ts';
import { renderPanel } from './render.tsx';
import { ORDER_ID } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const MILESTONE_ID = '01968f3e-0000-7000-8000-0000000c1001';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openJournal(api: ReturnType<typeof journalApi>) {
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
  await screen.findByRole('heading', { level: 2, name: 'Dziennik' });
  return api;
}

const items = () => screen.queryAllByRole('listitem', { name: /^Zmiana w zleceniu:/ });

const paymentEvent = (n: number, toStatus: string, name: string | null, fromStatus = 'planned') =>
  eventEntry(n, {
    code: 'payment_milestone_status_changed',
    objectType: 'payment_milestone',
    fromStatus,
    toStatus,
    paymentMilestone: { id: MILESTONE_ID, name },
  });

describe('W-08 Dziennik: the status changes of the instalments (EVM-054 AC3)', () => {
  it('EVM-054 AC3 each change is told with the name of now and the badge of the status, without an amount; a removed one without a name', async () => {
    await openJournal(
      journalApi({
        entries: [
          paymentEvent(1, 'invoiced', 'Zaliczka'),
          paymentEvent(2, 'paid', 'Zaliczka', 'invoiced'),
          paymentEvent(3, 'cancelled', null),
          paymentEvent(4, 'refunded', '<img src=x onerror=alert(1)>'),
        ],
      }),
    );
    await waitFor(() => {
      expect(items()).toHaveLength(4);
    });
    const text = items().map((item) => item.textContent);
    expect(text[0]).toContain('Zmiana statusu transzy „Zaliczka”: «Wystawiona»');
    expect(text[1]).toContain('Zmiana statusu transzy „Zaliczka”: «Opłacona»');
    expect(text[2]).toContain('Zmiana statusu transzy: «Anulowana»');
    // a status this panel does not know is "Nieznany status" (P-12) — never the code; a name is text, never markup
    expect(text[3]).toContain('Zmiana statusu transzy „<img src=x onerror=alert(1)>”: «Nieznany status»');
    expect(text.join(' ')).not.toContain('refunded');
    expect(document.querySelector('img')).toBeNull();
    // the compact badge of the status is the one of the payments (§ 4.4) and repeats the sentence for the eye only
    const badge = items()[2]?.querySelector('[aria-hidden="true"] [class*="bg-status-payment-cancelled-bg"]');
    expect(badge).not.toBeNull();
    for (const line of text) expect(line).not.toMatch(/zł/);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-054 AC3 "Płatności" asks for the group of the payments only; "Zmiany statusów" does not show them', async () => {
    const api = await openJournal(
      journalApi({
        entries: [
          paymentEvent(1, 'invoiced', 'Zaliczka'),
          eventEntry(2, { code: 'work_order_status_changed', objectType: 'work_order', fromStatus: 'new', toStatus: 'in_progress' }),
          entry(3),
        ],
      }),
    );
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Płatności' }));
    await waitFor(() => {
      expect(items()).toHaveLength(1);
    });
    expect(items()[0]?.textContent).toContain('Zmiana statusu transzy „Zaliczka”: «Wystawiona»');
    const last = api.calls(`GET ${TIMELINE}`).at(-1);
    expect(last?.query.get('eventGroup')).toBe('payments');
    expect(last?.query.get('kind')).toBeNull();
    expect(screen.getByRole('button', { name: 'Płatności' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Zmiany statusów' }));
    await waitFor(() => {
      expect(items()[0]?.textContent).toContain('Zmiana statusu zlecenia');
    });
    expect(items()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Płatności' }).getAttribute('aria-pressed')).toBe('false');
  });
});
