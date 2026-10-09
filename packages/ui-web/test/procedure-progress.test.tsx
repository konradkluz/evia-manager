import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Disclosure, ProcedureProgress, StatusBadge, type StageStatusKey } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const STAGE_KEYS: readonly StageStatusKey[] = ['todo', 'in-progress', 'waiting', 'done', 'not-applicable', 'blocked'];

describe('ProcedureProgress (styleguide § 3.23, P-6; EVM-031 AC2)', () => {
  it('EVM-031 AC2 "n z m etapów" comes with a decorative bar proportional to n / m', () => {
    const { container } = render(<ProcedureProgress done={3} total={7} text="3 z 7 etapów" completeText="Wszystkie zakończone" />);
    expect(screen.getByText('3 z 7 etapów')).toBeTruthy();
    expect(screen.queryByText('Wszystkie zakończone')).toBeNull();
    const bar = container.querySelector('[aria-hidden="true"]');
    expect(bar?.getAttribute('class')).toContain('bg-progress-track');
    const fill = bar?.querySelector('rect');
    expect(fill?.getAttribute('class')).toContain('fill-progress-fill');
    expect(fill?.getAttribute('width')).toBe('43');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('EVM-031 AC2 n = m > 0 says "Wszystkie zakończone" next to a check mark', () => {
    const { container } = render(<ProcedureProgress done={3} total={3} text="3 z 3 etapów" completeText="Wszystkie zakończone" />);
    expect(screen.getByText('Wszystkie zakończone')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-check');
  });

  it('EVM-031 AC2 m = 0 is "Nie dotyczy" with a minus icon and no bar; the compact variant is the text alone', () => {
    const { container, rerender } = render(<ProcedureProgress done={0} total={0} text="Nie dotyczy" completeText="Wszystkie zakończone" />);
    expect(screen.getByText('Nie dotyczy')).toBeTruthy();
    expect(screen.queryByText('Wszystkie zakończone')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-minus');
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    rerender(<ProcedureProgress done={1} total={4} text="1 z 4 etapów" completeText="x" variant="compact" />);
    expect(container.querySelectorAll('rect')).toHaveLength(0);
  });

  it('EVM-031 AC2 inside the header of a Disclosure it is part of the accessible name and passes axe', async () => {
    const { container } = render(
      <Disclosure
        title="Uzgodnienia z OSD"
        summary={<ProcedureProgress done={2} total={7} text="2 z 7 etapów" completeText="Wszystkie zakończone" />}
        expanded={false}
        onExpandedChange={() => undefined}
      >
        <p>treść</p>
      </Disclosure>,
    );
    expect(screen.getByRole('button', { name: /^Uzgodnienia z OSD\s*2 z 7 etapów$/ })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('StatusBadge of the stage statuses (styleguide § 4.4; EVM-031 AC2)', () => {
  it('EVM-031 AC2 every stage status has the label, its own icon and the colours of color.status.stage.*', async () => {
    const { container } = render(
      <ul>
        {STAGE_KEYS.map((key) => (
          <li key={key}>
            <StatusBadge status={key} group="stage" label={`Etap ${key}`} />
          </li>
        ))}
      </ul>,
    );
    const shapes = STAGE_KEYS.map((key) => {
      const badge = screen.getByText(`Etap ${key}`);
      expect(badge.className).toContain(`bg-status-stage-${key}-bg`);
      expect(badge.className).toContain(`text-status-stage-${key}-text`);
      return badge
        .querySelector('svg')
        ?.getAttribute('class')
        ?.match(/lucide-[\w-]+/)?.[0];
    });
    expect(new Set(shapes).size).toBe(STAGE_KEYS.length);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-031 AC2 the unknown value keeps its own look in the stage group', () => {
    render(<StatusBadge status="unknown" group="stage" label="Nieznany status" />);
    expect(screen.getByText('Nieznany status').className).toContain('bg-status-unknown-bg');
  });
});
