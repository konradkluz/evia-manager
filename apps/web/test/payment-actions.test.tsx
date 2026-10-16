import { screen, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { milestoneActions } from '../src/work-orders/milestone-actions.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { ALL, PAYMENTS_PATH, paymentsApi, roleSession } from './payment-api.ts';

const ADMIN_ONLY = 'Korektę płatności może wykonać tylko administrator.';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const ready = () => screen.findByRole('table', { name: 'Transze płatności zlecenia' });
const rowOf = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
};

/** The items of the menu `⋮` of an instalment as the person meets them: label, "disabled" and the separators between the groups. */
async function menuOf(name: string): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: `Akcje transzy: ${name}` }));
  const menu = screen.getByRole('menu', { name: `Akcje transzy: ${name}` });
  const entries = [...menu.children].map((child) => {
    if (child.getAttribute('role') === 'separator') return '—';
    const item = within(child as HTMLElement).getByRole('menuitem');
    const label = item.firstChild?.textContent ?? '';
    return item.getAttribute('aria-disabled') === 'true' ? `${label} [${item.getAttribute('title') ?? ''}]` : label;
  });
  await userEvent.keyboard('{Escape}');
  return entries;
}

describe('the actions of an instalment by status and role (EVM-054 AC5, AC8; flows/08 → "Akcje płatności — status × rola")', () => {
  it('EVM-054 AC5 EVM-057 AC8 the table of actions: the row button, the menu and the group of corrections — active for the Administrator, disabled for the Editor, none for Tylko odczyt', () => {
    expect(milestoneActions('planned', 'editor')).toEqual({
      primary: 'invoice',
      menu: [
        { action: 'amount', group: 'main' },
        { action: 'cancel', group: 'cancel' },
        { action: 'delete', group: 'cancel', correction: true, adminOnly: true },
      ],
    });
    expect(milestoneActions('invoiced', 'editor')).toEqual({
      primary: 'pay',
      menu: [
        { action: 'details', group: 'main' },
        { action: 'withdrawInvoice', group: 'corrections', correction: true, adminOnly: true },
        { action: 'cancelInvoice', group: 'corrections', correction: true, adminOnly: true },
        { action: 'correctAmount', group: 'corrections', correction: true, adminOnly: true },
        { action: 'delete', group: 'corrections', correction: true, adminOnly: true },
      ],
    });
    expect(milestoneActions('paid', 'editor').menu.map((entry) => entry.action)).toEqual([
      'paidOn',
      'undoPayment',
      'correctAmount',
      'delete',
    ]);
    expect(milestoneActions('cancelled', 'editor').menu.map((entry) => entry.action)).toEqual(['restore', 'delete']);
    // EVM-057 (the specification of "UX / UI" → "Dostępność pozycji"): the Administrator sees and uses the corrections
    expect(milestoneActions('planned', 'administrator')).toEqual({
      primary: 'invoice',
      menu: [
        { action: 'amount', group: 'main' },
        { action: 'cancel', group: 'cancel' },
        { action: 'delete', group: 'cancel', correction: true },
      ],
    });
    expect(milestoneActions('invoiced', 'administrator')).toEqual({
      primary: 'pay',
      menu: [
        { action: 'details', group: 'main' },
        { action: 'withdrawInvoice', group: 'corrections', correction: true },
        { action: 'cancelInvoice', group: 'corrections', correction: true },
        { action: 'correctAmount', group: 'corrections', correction: true },
        { action: 'delete', group: 'corrections', correction: true },
      ],
    });
    expect(milestoneActions('paid', 'administrator').menu.map((entry) => entry.action)).toEqual([
      'paidOn',
      'undoPayment',
      'correctAmount',
      'delete',
    ]);
    expect(milestoneActions('cancelled', 'administrator').menu.map((entry) => entry.action)).toEqual(['restore', 'delete']);
    // AC8: Tylko odczyt, no session and a status the panel does not know — no actions
    for (const status of ['planned', 'invoiced', 'paid', 'cancelled']) expect(milestoneActions(status, 'read_only')).toEqual({ menu: [] });
    expect(milestoneActions('planned', undefined)).toEqual({ menu: [] });
    expect(milestoneActions('refunded', 'administrator')).toEqual({ menu: [] });
  });

  it('EVM-054 AC5 the Editor: the buttons of the rows and the corrections disabled with "Korektę płatności może wykonać tylko administrator."', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => ALL, roleSession('editor')),
    );
    await ready();
    expect(within(rowOf('Zaliczka (20%)')).getByRole('button', { name: 'Wystaw fakturę…' })).toBeTruthy();
    expect(within(rowOf('Po uzyskaniu zgód (30%)')).getByRole('button', { name: 'Odnotuj wpłatę…' })).toBeTruthy();
    expect(within(rowOf('Po wykonaniu instalacji (30%)')).queryByRole('button', { name: /Wystaw|Odnotuj/ })).toBeNull();
    expect(await menuOf('Zaliczka (20%)')).toEqual(['Zmień kwotę…', '—', 'Anuluj transzę…', `Usuń transzę… [${ADMIN_ONLY}]`]);
    expect(await menuOf('Po uzyskaniu zgód (30%)')).toEqual([
      'Popraw dane faktury…',
      '—',
      `Wycofaj fakturę… [${ADMIN_ONLY}]`,
      `Anuluj fakturę… [${ADMIN_ONLY}]`,
      `Zmień kwotę… [${ADMIN_ONLY}]`,
      `Usuń transzę… [${ADMIN_ONLY}]`,
    ]);
    expect(await menuOf('Po wykonaniu instalacji (30%)')).toEqual([
      'Popraw datę wpłaty…',
      '—',
      `Cofnij wpłatę… [${ADMIN_ONLY}]`,
      `Zmień kwotę… [${ADMIN_ONLY}]`,
      `Usuń transzę… [${ADMIN_ONLY}]`,
    ]);
    expect(await menuOf('Płatność końcowa (20%)')).toEqual([`Przywróć transzę… [${ADMIN_ONLY}]`, `Usuń transzę… [${ADMIN_ONLY}]`]);
    // a disabled correction does nothing when chosen (the server would refuse it with 403 all the same)
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Płatność końcowa (20%)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Przywróć transzę…/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-057 AC8 the Administrator sees the corrections active in the group "Korekty"; a cancelled instalment has "Przywróć transzę…" and "Usuń transzę…"', async () => {
    await renderPanel(PAYMENTS_PATH, paymentsApi());
    await ready();
    expect(await menuOf('Zaliczka (20%)')).toEqual(['Zmień kwotę…', '—', 'Anuluj transzę…', 'Usuń transzę…']);
    expect(await menuOf('Po uzyskaniu zgód (30%)')).toEqual([
      'Popraw dane faktury…',
      '—',
      'Wycofaj fakturę…',
      'Anuluj fakturę…',
      'Zmień kwotę…',
      'Usuń transzę…',
    ]);
    expect(await menuOf('Po wykonaniu instalacji (30%)')).toEqual([
      'Popraw datę wpłaty…',
      '—',
      'Cofnij wpłatę…',
      'Zmień kwotę…',
      'Usuń transzę…',
    ]);
    expect(await menuOf('Płatność końcowa (20%)')).toEqual(['Przywróć transzę…', 'Usuń transzę…']);
    // the destructive items take the danger text (§ 3.20): those whose dialog has a danger button
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Po uzyskaniu zgód (30%)' }));
    for (const name of ['Wycofaj fakturę…', 'Anuluj fakturę…', 'Usuń transzę…']) {
      expect(screen.getByRole('menuitem', { name }).className).toContain('text-action-danger-text-subtle');
    }
    expect(screen.getByRole('menuitem', { name: 'Zmień kwotę…' }).className).not.toContain('text-action-danger-text-subtle');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' }));
    expect(screen.getByRole('menuitem', { name: 'Anuluj transzę…' }).className).toContain('text-action-danger-text-subtle');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-054 AC8 Tylko odczyt sees the instalments without any button of a row and without menus', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => ALL, roleSession('read_only')),
    );
    await ready();
    const section = within(screen.getByRole('region', { name: 'Płatności' }));
    expect(section.queryByRole('button', { name: /Wystaw fakturę|Odnotuj wpłatę|^Akcje transzy/ })).toBeNull();
    expect(section.getByText('FV/TEST/0021/2026')).toBeTruthy();
  });

  it('EVM-054 AC5 the row button stands under the status (the mockup) and stretches over the narrow card; the menu has a narrow column at the end', async () => {
    await renderPanel(PAYMENTS_PATH, paymentsApi());
    await ready();
    const row = within(rowOf('Zaliczka (20%)'));
    const button = row.getByRole('button', { name: 'Wystaw fakturę…' });
    expect(button.className).toContain('max-medium:flex-1');
    expect(button.className).toContain('bg-action-secondary-bg');
    // the table needs no wide column of actions: the button is in the cell of the status, under the badge
    const status = button.closest('td');
    expect(status?.textContent).toContain('Planowana');
    expect(button.parentElement?.className).toContain('max-medium:col-span-3');
    // the menu `⋮` alone in the last column: top right of the card, its list lined up with the end of the trigger
    const menu = row.getByRole('button', { name: 'Akcje transzy: Zaliczka (20%)' });
    const actions = menu.closest('td');
    expect(actions).not.toBe(status);
    expect(actions?.className).toContain('max-medium:col-start-3');
    expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(await axeViolations(rowOf('Zaliczka (20%)'))).toEqual([]);
  });

  it('EVM-054 AC1 the table of W-06 is dense and the number of an invoice may break after "/", so the status and the actions fit the column', async () => {
    await renderPanel(
      PAYMENTS_PATH,
      paymentsApi(() => ALL, roleSession('editor')),
    );
    await ready();
    expect(screen.getAllByRole('columnheader')[0]?.className).toContain('px-inset-sm');
    const invoice = within(screen.getByRole('region', { name: 'Płatności' })).getByText('FV/TEST/0021/2026');
    // the text stays whole for reading and copying; only the places of a line break are marked
    expect(invoice.textContent).toBe('FV/TEST/0021/2026');
    expect(invoice.querySelectorAll('wbr')).toHaveLength(3);
  });

  it.each([
    ['administrator', ACTIVE_SESSION, 'Zlecenie jest rozliczone — płatności są tylko do odczytu. Zmienisz je po przywróceniu zlecenia.'],
    [
      'editor',
      roleSession('editor'),
      'Zlecenie jest rozliczone — płatności są tylko do odczytu. Przywrócić zlecenie może tylko administrator.',
    ],
  ] as const)(
    'EVM-054 AC7 %s in a settled order: the buttons and every item are disabled with the hint for the role',
    async (_role, session, hint) => {
      await renderPanel(
        PAYMENTS_PATH,
        paymentsApi(() => ALL, session, {}, { status: 'settled', allowedTransitions: [] }),
      );
      await ready();
      const invoice = within(rowOf('Zaliczka (20%)')).getByRole('button', { name: 'Wystaw fakturę…' });
      expect(invoice.getAttribute('aria-disabled')).toBe('true');
      expect(invoice.getAttribute('title')).toBe(hint);
      await userEvent.click(invoice);
      expect(screen.queryByRole('dialog')).toBeNull();
      const entries = await menuOf('Po uzyskaniu zgód (30%)');
      expect(entries[0]).toBe(`Popraw dane faktury… [${hint}]`);
    },
  );

  it('EVM-054 AC8 EVM-057 AC8 offline the buttons of the rows and the items (the corrections too) say "Zmienisz po powrocie połączenia."', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await renderPanel(PAYMENTS_PATH, paymentsApi());
    await ready();
    const pay = within(rowOf('Po uzyskaniu zgód (30%)')).getByRole('button', { name: 'Odnotuj wpłatę…' });
    expect(pay.getAttribute('aria-disabled')).toBe('true');
    expect(pay.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    const offline = 'Zmienisz po powrocie połączenia.';
    expect(await menuOf('Po wykonaniu instalacji (30%)')).toEqual([
      `Popraw datę wpłaty… [${offline}]`,
      '—',
      `Cofnij wpłatę… [${offline}]`,
      `Zmień kwotę… [${offline}]`,
      `Usuń transzę… [${offline}]`,
    ]);
  });
});
