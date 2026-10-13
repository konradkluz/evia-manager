import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type OrderStatusKey, type PaymentStatusKey } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const KEYS: readonly OrderStatusKey[] = [
  'new',
  'quoting',
  'accepted',
  'in-progress',
  'completed',
  'settled',
  'on-hold',
  'cancelled',
  'unknown',
];

describe('StatusBadge (styleguide § 3.9, § 3.9.1; EVM-017 AC1)', () => {
  it('EVM-017 AC1 every status has the full label next to a decorative icon and its own token colours', async () => {
    const { container } = render(
      <ul>
        {KEYS.map((key) => (
          <li key={key}>
            <StatusBadge status={key} label={`Etykieta ${key}`} />
          </li>
        ))}
      </ul>,
    );
    for (const key of KEYS) {
      const badge = screen.getByText(`Etykieta ${key}`);
      expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      const group = key === 'unknown' ? 'unknown' : `order-${key}`;
      expect(badge.className).toContain(`bg-status-${group}-bg`);
      expect(badge.className).toContain(`text-status-${group}-text`);
      expect(badge.className).toContain('rounded-pill');
    }
    // The icon of each status differs (colour is not the only signal).
    const shapes = KEYS.map(
      (key) =>
        screen
          .getByText(`Etykieta ${key}`)
          .querySelector('svg')
          ?.getAttribute('class')
          ?.match(/lucide-[\w-]+/)?.[0],
    );
    expect(new Set(shapes).size).toBe(KEYS.length);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-017 AC1 a hint is a tooltip and the accessible description of the unknown status (P-12)', () => {
    render(<StatusBadge status="unknown" label="Nieznany status" hint="Odśwież stronę, aby zobaczyć szczegóły." />);
    const badge = screen.getByText('Nieznany status', { exact: false });
    expect(badge.getAttribute('title')).toBe('Odśwież stronę, aby zobaczyć szczegóły.');
    expect(document.getElementById(badge.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Odśwież stronę, aby zobaczyć szczegóły.',
    );
  });

  it('EVM-053 AC2 the payment statuses (§ 4.4: color.status.payment.*) have their own icons and "Po terminie" is the strong variant', async () => {
    const PAYMENT: readonly PaymentStatusKey[] = ['planned', 'invoiced', 'paid', 'cancelled', 'overdue'];
    const { container } = render(
      <ul>
        {PAYMENT.map((key) => (
          <li key={key}>
            <StatusBadge status={key} group="payment" label={`Płatność ${key}`} />
          </li>
        ))}
      </ul>,
    );
    const shapes = PAYMENT.map((key) => {
      const badge = screen.getByText(`Płatność ${key}`);
      expect(badge.className).toContain(`bg-status-payment-${key}-bg`);
      expect(badge.className).toContain(`text-status-payment-${key}-text`);
      expect(badge.querySelector('svg')?.getAttribute('class')).toContain(`text-status-payment-${key}-icon`);
      return badge
        .querySelector('svg')
        ?.getAttribute('class')
        ?.match(/lucide-[\w-]+/)?.[0];
    });
    // planned: calendar-clock, invoiced: file-text, paid: circle-check, cancelled: ban, overdue: alarm-clock
    expect(shapes).toEqual(['lucide-calendar-clock', 'lucide-file-text', 'lucide-circle-check', 'lucide-ban', 'lucide-alarm-clock']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-053 AC2 a payment badge of an unknown value is the shared "Nieznany status" (§ 3.9.1)', () => {
    render(<StatusBadge status="unknown" group="payment" label="Nieznany status" />);
    expect(screen.getByText('Nieznany status').className).toContain('bg-status-unknown-bg');
  });
});
