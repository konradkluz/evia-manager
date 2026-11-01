import type { CurrentSession } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, SESSION_ROUTE } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';
import { userEvent } from './user.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const QUICK = {
  ...HEADER,
  status: 'new',
  origin: 'mobile_quick',
  createdBy: { displayName: 'Piotr Testowy <b>' },
  createdAt: '2026-10-03T08:00:00.000Z',
  allowedTransitions: ['quoting'],
} as const;

const roleSession = (role: 'administrator' | 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

function api(header: object, role: 'administrator' | 'editor' | 'read_only' = 'editor'): ReturnType<typeof activeSessionApi> {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, roleSession(role)),
    ...workOrderRoutes(ORDER_ID, { header: () => json(200, { ...header, id: ORDER_ID }, { ETag: '"3"' }) }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const banner = () => screen.findByRole('region', { name: 'Zlecenie założone w terenie' });

describe('W-06 baner "Zlecenie założone w terenie" (EVM-099 AC8)', () => {
  it('EVM-099 AC8 an order from the field in "Nowe" shows the author and the date as text and the three ways to complete the data', async () => {
    await renderPanel(PATH, api(QUICK));
    const region = within(await banner());
    expect(region.getByText('Zlecenie założone w terenie (Piotr Testowy <b>, 03.10.2026).')).toBeTruthy();
    expect(region.getByRole('link', { name: 'Uzupełnij dane klienta — przejdź do klienta' }).getAttribute('href')).toBe(
      `/customers/${HEADER.customer?.id ?? ''}`,
    );
    expect(region.getByRole('button', { name: 'Uzupełnij dane lokalizacji' }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(region.getByRole('link', { name: 'Uzupełnij kwoty transz — przejdź do sekcji Płatności' }).getAttribute('href')).toBe(
      '#platnosci',
    );
    expect(await axeViolations(await banner())).toEqual([]);
  });

  it('EVM-099 AC8 the link "kwoty transz" moves the focus into the section "Płatności"', async () => {
    await renderPanel(PATH, api(QUICK, 'administrator'));
    await userEvent.click(await screen.findByRole('link', { name: 'Uzupełnij kwoty transz — przejdź do sekcji Płatności' }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('platnosci');
    });
  });

  it('EVM-099 AC8 the button "lokalizacji" opens W-20 "Edytuj lokalizację"', async () => {
    await renderPanel(PATH, api(QUICK));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edytuj lokalizację' })).toBeTruthy();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Uzupełnij dane lokalizacji' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('EVM-099 AC8 Tylko odczyt sees the first line only, without any link or button', async () => {
    await renderPanel(PATH, api(QUICK, 'read_only'));
    const region = within(await banner());
    expect(region.getByText(/Zlecenie założone w terenie \(Piotr/u)).toBeTruthy();
    expect(region.queryAllByRole('link')).toHaveLength(0);
    expect(region.queryAllByRole('button')).toHaveLength(0);
  });

  it('EVM-099 AC8 the banner does not exist once the order left "Nowe", nor for an order from the panel', async () => {
    await renderPanel(PATH, api({ ...QUICK, status: 'quoting' }));
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(screen.queryByRole('region', { name: 'Zlecenie założone w terenie' })).toBeNull();
  });

  it('EVM-099 AC8 an order from the panel in "Nowe" has no banner either', async () => {
    await renderPanel(PATH, api({ ...QUICK, origin: 'office' }));
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    expect(screen.queryByRole('region', { name: 'Zlecenie założone w terenie' })).toBeNull();
  });

  it('EVM-099 AC8 without a known author the line has only the date', async () => {
    const anonymous: Record<string, unknown> = { ...QUICK };
    delete anonymous['createdBy'];
    await renderPanel(PATH, api(anonymous));
    expect(within(await banner()).getByText('Zlecenie założone w terenie (03.10.2026).')).toBeTruthy();
  });
});
