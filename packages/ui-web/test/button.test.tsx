import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton, Menu } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

describe('Button and IconButton (styleguide § 3.1; EVM-008 AC3)', () => {
  it('EVM-008 AC3 Button is a primary, keyboard-operable button with token classes and a visible focus ring', async () => {
    const onClick = vi.fn();
    const { container } = render(<Button onClick={onClick}>Odśwież stronę</Button>);
    const button = screen.getByRole('button', { name: 'Odśwież stronę' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toMatch(/bg-action-primary-bg\b/);
    expect(button.className).toContain('focus-visible:focus-ring');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-008 AC3 IconButton has an accessible name, a touch target ≥ size.touch-target.min and a tone for dark surfaces', async () => {
    const { container, rerender } = render(<IconButton icon={Menu} label="Menu" />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button.className).toContain('size-touch-target-min');
    expect(button.className).toContain('focus-visible:focus-ring ');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
    rerender(<IconButton icon={Menu} label="Menu" tone="brand" />);
    expect(screen.getByRole('button', { name: 'Menu' }).className).toContain('focus-visible:focus-ring-inverse');
  });
});
