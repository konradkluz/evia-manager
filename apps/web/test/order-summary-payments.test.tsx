import type { CurrentSession, UserRole } from '@evia/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem } from './api-fake.ts';
import {
  CANCELLED,
  INVOICED,
  milestone,
  PAID,
  paymentsApi,
  paymentsOf,
  PAYMENTS_LIST,
  PAYMENTS_PATH,
  PLANNED,
  roleSession,
} from './payment-api.ts';
import { renderPanel } from './render.tsx';

// W-06, the tile "Płatności" of the card "Podsumowanie" (EVM-056 AC4, AC7, AC8): read from the instalments of the order (the same
// read as the section "Płatności"); the server says which instalment is after its due date and for how many days.
const NBSP = ' ';

const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' as const });
// The four instalments of AC4: one invoiced 5 days after its due date (3 600,00 zł) and three planned.
const OVERDUE = milestone(11, {
  name: 'Zaliczka',
  status: 'invoiced',
  amount: pln(360_000),
  invoiceNumber: 'FV/TEST/0042/2026',
  invoicedOn: '2026-09-25',
  dueDate: '2026-10-02',
  isOverdue: true,
  overdueDays: 5,
});
const planned = (n: number) => milestone(n, { name: `Transza ${String(n)}`, amount: pln(100_000) });
const FOUR = paymentsOf([OVERDUE, planned(12), planned(13), planned(14)]);

const card = async () => within(await screen.findByRole('region', { name: /^Podsumowanie/ }));
const paymentsTile = async () => within((await card()).getByRole('group', { name: 'Płatności' }));

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-06 tile "Płatności" (EVM-056 AC4)', () => {
  it('EVM-056 AC4 four instalments: "Nieopłacone: 3 600,00 zł (1)", "Po terminie" with the days, "Planowane: 3", "Opłacone: 0 z 4"', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => FOUR),
    );
    const tile = await paymentsTile();
    expect(await tile.findByText(`Nieopłacone: 3 600,00 zł (1)`)).toBeTruthy();
    const badge = tile.getByText('Po terminie');
    expect(badge.closest('span')?.className).toContain('bg-status-payment-overdue-bg');
    expect(badge.closest('span')?.querySelector('svg')).not.toBeNull();
    expect(tile.getByText('5 dni')).toBeTruthy();
    expect(tile.getByText('Planowane: 3')).toBeTruthy();
    expect(tile.getByText('Opłacone: 0 z 4')).toBeTruthy();
    const link = tile.getByRole('link');
    expect(link.getAttribute('href')).toBe('#platnosci');
    expect(link.getAttribute('aria-label')).toBe(
      `Płatności: nieopłacone 3${NBSP}600,00${NBSP}zł, 1 transza, po terminie 5 dni, planowane 3, opłacone 0 z 4`,
    );
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-056 AC4 a cancelled instalment is not counted in "z y" (P3); the days are those of the longest overdue instalment', async () => {
    const older = { ...OVERDUE, id: milestone(15).id, amount: pln(100_000), overdueDays: 12 };
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => paymentsOf([OVERDUE, older, PAID, CANCELLED, PLANNED])),
    );
    const tile = await paymentsTile();
    expect(await tile.findByText(`Nieopłacone: 4 600,00 zł (2)`)).toBeTruthy();
    expect(tile.getByText('12 dni')).toBeTruthy();
    expect(tile.getByText('Planowane: 1')).toBeTruthy();
    expect(tile.getByText('Opłacone: 1 z 4')).toBeTruthy();
    expect(tile.getByRole('link').getAttribute('aria-label')).toContain(
      `nieopłacone 4${NBSP}600,00${NBSP}zł, 2 transze, po terminie 12 dni`,
    );
  });

  it('EVM-056 AC4 one day is "1 dzień"; five invoiced instalments are "5 transz"', async () => {
    const one = { ...OVERDUE, overdueDays: 1 };
    const more = [2, 3, 4, 5].map((n) => ({ ...INVOICED, id: milestone(20 + n).id }));
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => paymentsOf([one, ...more])),
    );
    const tile = await paymentsTile();
    expect(await tile.findByText('1 dzień')).toBeTruthy();
    expect(tile.getByRole('link').getAttribute('aria-label')).toContain(', 5 transz, po terminie 1 dzień,');
  });

  it('EVM-056 AC4 nothing after its due date: no row "Po terminie" (never "0"); nothing invoiced: "Nieopłacone: 0,00 zł"', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => paymentsOf([PLANNED, PAID])),
    );
    const tile = await paymentsTile();
    expect(await tile.findByText(`Nieopłacone: 0,00 zł`)).toBeTruthy();
    expect(tile.queryByText('Po terminie')).toBeNull();
    expect(tile.getByText('Opłacone: 1 z 2')).toBeTruthy();
    expect(tile.getByRole('link').getAttribute('aria-label')).toBe(`Płatności: nieopłacone 0,00${NBSP}zł, planowane 1, opłacone 1 z 2`);
  });

  it('EVM-056 AC4 an order without instalments: one line "Brak transz." without a button of its own', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => paymentsOf([])),
    );
    const tile = await paymentsTile();
    expect(await tile.findByText('Brak transz.')).toBeTruthy();
    expect(tile.queryByRole('button')).toBeNull();
    expect(tile.getByRole('link').getAttribute('aria-label')).toBe('Płatności: brak transz');
  });

  it('EVM-056 AC4 the tile leads to the section "Płatności" (#platnosci) of the tab "Przegląd" and moves the focus there', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => FOUR),
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
    await userEvent.click((await paymentsTile()).getByRole('link'));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Płatności' });
    expect(heading.id).toBe('platnosci');
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getByRole('tab', { name: 'Przegląd' }).getAttribute('aria-selected')).toBe('true');
  });

  it('EVM-056 AC4 the tile is reached by keyboard and Enter follows it', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => FOUR),
    );
    const link = (await paymentsTile()).getByRole('link');
    link.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('platnosci');
    });
  });
});

describe('W-06 tile "Płatności" and the roles (EVM-056 AC7)', () => {
  it('EVM-056 AC7 Edytor and Tylko odczyt see the tile', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const { unmount } = await renderPanel(
        PAYMENTS_PATH,
        paymentsApi(() => FOUR, roleSession(role)),
      );
      expect(await (await paymentsTile()).findByText('Planowane: 3')).toBeTruthy();
      unmount();
    }
  });

  it('EVM-056 AC7 a role without the right to read payments (not in v1) has no tile; the other three stay', async () => {
    const session: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'auditor_of_a_newer_api' as UserRole } };
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => FOUR, session),
    );
    const summary = await card();
    await summary.findByRole('region', { name: 'Terminy' });
    expect(summary.queryByRole('group', { name: 'Płatności' })).toBeNull();
    expect(summary.getAllByRole('region')).toHaveLength(3);
  });
});

describe('W-06 tile "Płatności" and the states (EVM-056 AC8)', () => {
  it('EVM-056 AC8 an error of the tile: "Nie udało się wczytać płatności." with a retry; the other tiles work', async () => {
    let failing = true;
    const api = paymentsApi();
    api.set(PAYMENTS_LIST, () => (failing ? problem(500, 'internal_error') : json(200, FOUR)));
    await renderPanel(PAYMENTS_PATH, api);
    const tile = await paymentsTile();
    const alert = await tile.findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się wczytać płatności.');
    expect(tile.queryByRole('link')).toBeNull();
    expect((await card()).getByRole('region', { name: 'Terminy' }).querySelector('[role="alert"]')).toBeNull();
    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await tile.findByText('Planowane: 3')).toBeTruthy();
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-056 AC8 a 429 of the tile says how long to wait (Retry-After)', async () => {
    const api = paymentsApi();
    api.set(PAYMENTS_LIST, () => problem(429, 'rate_limited', {}, { 'Retry-After': '90' }));
    await renderPanel(PAYMENTS_PATH, api);
    const alert = await (await paymentsTile()).findByRole('alert');
    expect(alert.textContent).toContain('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.');
  });

  it('EVM-056 AC8 loading: a skeleton in the tile', async () => {
    const api = paymentsApi();
    api.set(PAYMENTS_LIST, () => new Promise<Response>(() => undefined));
    await renderPanel(PAYMENTS_PATH, api);
    const tile = await paymentsTile();
    expect(tile.getByText('Wczytujemy sekcję…', { exact: false }).closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('EVM-056 AC8 offline: the tile keeps the data of the memory of the tab under the banner of the page', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => FOUR),
    );
    const tile = await paymentsTile();
    await tile.findByText('Planowane: 3');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText(/^Dane mogą być nieaktualne/)).toBeTruthy();
    expect(tile.getByText(`Nieopłacone: 3 600,00 zł (1)`)).toBeTruthy();
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });
});
