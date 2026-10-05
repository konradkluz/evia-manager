import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner, WifiOff } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

describe('Banner (styleguide § 3.19, § 4.10; EVM-008 AC3 offline state)', () => {
  it('EVM-008 AC3 warning banner is a polite status with an icon and the message (colour is not the only signal)', async () => {
    const { container } = render(<Banner icon={WifiOff}>Brak połączenia.</Banner>);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Brak połączenia.');
    expect(status.className).toContain('bg-feedback-warning-bg');
    expect(status.className).toContain('border-s-indicator');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });
});
