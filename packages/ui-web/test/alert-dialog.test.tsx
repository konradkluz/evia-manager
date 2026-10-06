import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog, Button, InlineAlert } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

function dialog(open = true, onDismiss = vi.fn()) {
  return {
    onDismiss,
    ui: (
      <>
        <button type="button">Otwórz</button>
        <AlertDialog
          open={open}
          title="Sesja wkrótce wygaśnie"
          onDismiss={onDismiss}
          actions={
            <>
              <Button data-initial-focus>Przedłuż sesję</Button>
              <Button variant="tertiary">Wyloguj</Button>
            </>
          }
        >
          Sesja wygaśnie za 2 min z powodu braku aktywności.
        </AlertDialog>
      </>
    ),
  };
}

describe('AlertDialog (styleguide § 3.13, § 4.17; EVM-067 AC6)', () => {
  it('EVM-067 AC6 it is a labelled alertdialog on the dialog tokens, polite content and focus on the marked action', async () => {
    const { ui } = dialog();
    const { container } = render(ui);
    const element = screen.getByRole('alertdialog', { name: 'Sesja wkrótce wygaśnie' });
    expect(element.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(element.getAttribute('aria-describedby') ?? '')?.getAttribute('aria-live')).toBe('polite');
    expect(element.className).toContain('max-w-dialog-width-sm');
    expect(element.className).toContain('rounded-dialog');
    expect(element.className).toContain('shadow-dialog');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    expect(screen.getByText('Sesja wygaśnie za 2 min z powodu braku aktywności.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-067 AC6 without a marked action the first button gets the focus', () => {
    render(
      <AlertDialog open title="T" onDismiss={vi.fn()} actions={<Button>Rozumiem</Button>}>
        Treść
      </AlertDialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rozumiem' }));
  });

  it('EVM-067 AC6 Esc asks to dismiss without closing by itself and a closed dialog renders nothing', () => {
    const { ui, onDismiss } = dialog();
    const { rerender } = render(ui);
    const element = screen.getByRole('alertdialog');
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(element, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(element.hasAttribute('open')).toBe(true);
    rerender(dialog(false, onDismiss).ui);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Closed, the element stays attached (so `close()` can return the focus) but has no content and is not open.
    expect(element.isConnected).toBe(true);
    expect(element.hasAttribute('open')).toBe(false);
    expect(element.textContent).toBe('');
  });

  it('EVM-067 AC6 closing closes the dialog on an attached element (the condition for returning the focus)', () => {
    const { ui } = dialog();
    const { rerender } = render(ui);
    const element = screen.getByRole<HTMLDialogElement>('alertdialog');
    let attachedOnClose: boolean | undefined;
    const original = element.close.bind(element);
    element.close = () => {
      attachedOnClose = element.isConnected;
      original();
    };
    rerender(dialog(false).ui);
    expect(attachedOnClose).toBe(true);
  });

  it('EVM-067 AC6 the actions are reachable and run', async () => {
    const onExtend = vi.fn();
    render(
      <AlertDialog open title="T" onDismiss={vi.fn()} actions={<Button onClick={onExtend}>Przedłuż sesję</Button>}>
        Treść
      </AlertDialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Przedłuż sesję' }));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });
});

describe('InlineAlert focus target (styleguide § 4.1; EVM-067 AC2)', () => {
  it('EVM-067 AC2 an alert with a ref is focusable programmatically, one without stays out of the tab order', () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(
      <InlineAlert tone="error" alertRef={ref}>
        Nieprawidłowy e-mail lub hasło.
      </InlineAlert>,
    );
    ref.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByRole('alert').getAttribute('tabindex')).toBe('-1');
    rerender(<InlineAlert tone="error">Nieprawidłowy e-mail lub hasło.</InlineAlert>);
    expect(screen.getByRole('alert').hasAttribute('tabindex')).toBe(false);
  });
});
