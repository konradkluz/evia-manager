import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineAlert } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

describe('InlineAlert tones (styleguide § 3.19; EVM-025 AC4 success message above W-02)', () => {
  it('EVM-025 AC4 the success tone is a polite status with the success colours and an icon (colour is not the only signal)', async () => {
    const { container } = render(<InlineAlert tone="success">Hasło zostało zmienione.</InlineAlert>);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Hasło zostało zmienione.');
    expect(status.className).toContain('bg-feedback-success-bg');
    expect(status.className).toContain('border-s-indicator-success');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('text-feedback-success-icon');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-025 AC4 only the error tone is an alert; the info tone is plain content', () => {
    const { container, rerender } = render(<InlineAlert tone="info">Informacja.</InlineAlert>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<InlineAlert tone="error">Błąd.</InlineAlert>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('text-feedback-error-icon');
  });
});
