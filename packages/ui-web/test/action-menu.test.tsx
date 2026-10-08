import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionMenu, Info, StatusBadgeButton, Toast, Banner } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

function menu(onSelect = vi.fn(), onRestore = vi.fn()) {
  render(
    <>
      <ActionMenu
        label="Zmień status zlecenia"
        items={[
          {
            id: 'restore',
            label: 'Przywróć zlecenie…',
            onSelect: onRestore,
            disabledHint: 'Przywrócić zlecenie może tylko administrator.',
          },
          { id: 'hold', label: 'Wstrzymaj…', onSelect },
          { id: 'finish', label: 'Zakończ', onSelect },
        ]}
        trigger={(props) => (
          <StatusBadgeButton
            {...props}
            status="in-progress"
            label="W realizacji"
            aria-label="Status zlecenia: W realizacji. Zmień status"
          />
        )}
      />
      <button type="button">Dalej</button>
    </>,
  );
  return { onSelect, onRestore, trigger: screen.getByRole('button', { name: 'Status zlecenia: W realizacji. Zmień status' }) };
}

describe('ActionMenu with the status badge as the trigger (styleguide § 3.9, § 3.20; EVM-030 AC1)', () => {
  it('EVM-030 AC1 the trigger announces a menu; opening focuses the first AVAILABLE item and a disabled item stays reachable with its reason', async () => {
    const { trigger } = menu();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('menu', { name: 'Zmień status zlecenia' });
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wstrzymaj…' }));
    const disabled = screen.getByRole('menuitem', { name: /Przywróć zlecenie…/ });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.textContent).toContain('Przywrócić zlecenie może tylko administrator.');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-030 AC1 Enter runs the item, closes the menu and the focus is already on the trigger; a disabled item does nothing', async () => {
    const { trigger, onSelect, onRestore } = menu();
    await userEvent.click(trigger);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Przywróć zlecenie…/ }));
    await userEvent.keyboard('{Enter}');
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeNull();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('EVM-030 AC1 arrows wrap, Home and End jump, a letter moves, Esc and Tab close and return the focus to the trigger', async () => {
    const { trigger } = menu();
    await userEvent.click(trigger);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Zakończ' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Przywróć/ }));
    await userEvent.keyboard('{Home}w');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wstrzymaj…' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('menu')).not.toBeNull();
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-030 AC8 a disabled badge keeps the focus, drops the chevron, explains why and does not open', async () => {
    render(
      <StatusBadgeButton
        status="settled"
        label="Rozliczone"
        aria-label="Status zlecenia: Rozliczone"
        disabledHint="Zmienisz po powrocie połączenia."
      />,
    );
    const badge = screen.getByRole('button', { name: 'Status zlecenia: Rozliczone' });
    expect(badge.getAttribute('aria-disabled')).toBe('true');
    expect(badge.getAttribute('title')).toBe('Zmienisz po powrocie połączenia.');
    expect(badge.querySelectorAll('svg')).toHaveLength(1);
    expect(badge.textContent).toContain('Zmienisz po powrocie połączenia.');
    await userEvent.click(badge);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Toast with an action and Banner info (styleguide § 3.14, § 3.19; EVM-030 AC1, AC6)', () => {
  it('EVM-030 AC2 the action closes the toast and runs; with an action the toast lasts 10 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<Toast message="Wstrzymano zlecenie." closeLabel="Zamknij" onClose={onClose} action={{ label: 'Cofnij', onSelect }} />);
    vi.advanceTimersByTime(9900);
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('EVM-030 AC6 a named info banner is a region with the info tokens; without a name it stays a status', async () => {
    const { container, rerender } = render(
      <Banner icon={Info} tone="info" label="Stan zlecenia">
        <p>Zlecenie jest rozliczone.</p>
        <p>Przywrócić zlecenie może tylko administrator.</p>
      </Banner>,
    );
    const region = screen.getByRole('region', { name: 'Stan zlecenia' });
    expect(region.className).toContain('bg-feedback-info-bg');
    expect(region.className).toContain('border-s-indicator-info');
    expect(await axeViolations(container)).toEqual([]);
    rerender(<Banner icon={Info}>Brak połączenia.</Banner>);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
