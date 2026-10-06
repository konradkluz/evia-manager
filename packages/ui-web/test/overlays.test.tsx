import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu, BlockingState, Button, EmptyState, KeyRound, Link2Off, Toast } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

afterEach(() => {
  vi.useRealTimers();
});

function menu(onLogout = vi.fn(), onAccount = vi.fn()) {
  render(
    <>
      <AccountMenu
        triggerText="Anna Testowa"
        triggerLabel="Menu konta: Anna Testowa"
        items={[
          { id: 'account', label: 'Konto', onSelect: onAccount },
          { id: 'logout', label: 'Wyloguj', onSelect: onLogout },
        ]}
      />
      <button type="button">Dalej</button>
    </>,
  );
  return { onLogout, onAccount, trigger: screen.getByRole('button', { name: 'Menu konta: Anna Testowa' }) };
}

describe('AccountMenu (styleguide § 3.17, § 3.20; EVM-016 AC6)', () => {
  it('EVM-016 AC6 the trigger announces a menu; opening moves focus to the first item and exposes menu roles', async () => {
    const { trigger } = menu();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('menu', { name: 'Menu konta: Anna Testowa' });
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Konto', 'Wyloguj']);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Konto' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-016 AC6 arrows wrap, Home and End jump, a letter moves to a matching item, Enter runs the item and closes', async () => {
    const { trigger, onLogout } = menu();
    await userEvent.click(trigger);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Konto' }));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Konto' }));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await userEvent.keyboard('k');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Konto' }));
    await userEvent.keyboard('x');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Konto' }));
    await userEvent.keyboard('{Control>}w{/Control}');
    await userEvent.keyboard('w');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Wyloguj' }));
    await userEvent.keyboard('{Enter}');
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-016 AC6 Escape closes and returns focus to the trigger; Tab closes and leaves the menu; a click outside closes', async () => {
    const { trigger } = menu();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await userEvent.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dalej' }));
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('EVM-016 AC6 clicking an item runs it', async () => {
    const { trigger, onAccount } = menu();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Konto' }));
    expect(onAccount).toHaveBeenCalledTimes(1);
  });
});

describe('Toast (styleguide § 3.14; EVM-016 AC4)', () => {
  it('EVM-016 AC4 the live region exists without a message; a message is announced with a close button and closes after 6 s', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<Toast message={null} closeLabel="Zamknij" onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<Toast message="Drugi krok logowania jest skonfigurowany." closeLabel="Zamknij" onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toContain('Drugi krok logowania jest skonfigurowany.');
    expect(screen.getByRole('button', { name: 'Zamknij' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EVM-016 AC4 the toast is accessible', async () => {
    const { container } = render(<Toast message="Zapisano." closeLabel="Zamknij" onClose={vi.fn()} />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-016 AC4 hover and focus pause the timer and leaving resumes it; the close button closes at once', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast message="Zapisano." closeLabel="Zamknij" onClose={onClose} duration={1000} />);
    const toast = screen.getByText('Zapisano.').parentElement;
    if (toast === null) throw new Error('toast missing');
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => {
      toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      toast.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      screen.getByRole('button', { name: 'Zamknij' }).click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('BlockingState and EmptyState title focus (styleguide § 3.15, § 3.15.1; EVM-016 AC4, AC5)', () => {
  it('EVM-016 AC4 blocking state: product name, level-1 title, description, alerts, one action and the top action; no Sidebar and no TopBar', async () => {
    const { container } = render(
      <BlockingState
        brand="EVia Manager"
        icon={KeyRound}
        title="Skonfiguruj drugi krok logowania"
        description="Logowanie wymaga klucza dostępu."
        topAction={<Button variant="tertiary">Wyloguj</Button>}
        action={<Button>Dodaj klucz dostępu</Button>}
      >
        <p>Treść pośrednia</p>
      </BlockingState>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' }).className).toContain('text-heading-2');
    expect(screen.getByText('Logowanie wymaga klucza dostępu.').className).toContain('text-text-secondary');
    expect(screen.getByText('Treść pośrednia')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dodaj klucz dostępu' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-016 AC5 the title of an empty state can take focus programmatically (focus after the link check)', () => {
    let heading: HTMLHeadingElement | null = null;
    render(
      <EmptyState
        icon={Link2Off}
        title="Link jest nieważny lub wygasł."
        description="Otwórz link jeszcze raz."
        titleRef={(element) => {
          heading = element;
        }}
      />,
    );
    (heading as HTMLHeadingElement | null)?.focus();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Link jest nieważny lub wygasł.' }));
  });
});
