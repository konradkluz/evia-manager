import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

function Controlled({ onChange }: { readonly onChange: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(true);
  return (
    <fieldset>
      <legend>Procesy z tą pozycją</legend>
      <Checkbox
        label="Instalacja zasilająca"
        description="3 etapy „Do zrobienia”"
        checked={checked}
        onChange={(value) => {
          setChecked(value);
          onChange(value);
        }}
      />
    </fieldset>
  );
}

describe('Checkbox (styleguide § 3.4; EVM-035 AC2)', () => {
  it('EVM-035 AC2 the whole row is the label: clicking the text toggles, Space toggles, the description names the box', async () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: /Instalacja zasilająca/ });
    expect(box.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByRole('checkbox', { description: '3 etapy „Do zrobienia”' })).toBe(box);
    await userEvent.click(screen.getByText('Instalacja zasilająca'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    box.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-035 AC2 a disabled checkbox does not change', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Proces" checked={false} disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Proces' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
