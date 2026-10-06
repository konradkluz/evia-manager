import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, ClipboardList, EmptyState } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

describe('EmptyState (styleguide § 3.15; EVM-008 AC3)', () => {
  it('EVM-008 AC3 variant without action: decorative icon, level-2 title and description, no button', async () => {
    const { container } = render(<EmptyState icon={ClipboardList} title="Brak zleceń" description="Opis pustego stanu." />);
    expect(screen.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toHaveProperty(
      'className',
      expect.stringContaining('text-heading-3'),
    );
    expect(screen.getByText('Opis pustego stanu.').className).toContain('text-text-secondary');
    expect(screen.queryByRole('button')).toBeNull();
    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('class')).toContain('size-icon-2xl');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-008 AC3 variant with action and a custom heading level', async () => {
    const { container } = render(
      <EmptyState
        icon={ClipboardList}
        title="Coś poszło nie tak"
        description="Odśwież stronę."
        headingLevel={1}
        action={<Button>Odśwież</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Odśwież' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
