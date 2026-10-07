import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorSummary, FieldError, SelectableCardGroup } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const OPTIONS = [
  { value: 'a', title: 'Garaż — pełny proces', description: '9 pozycji' },
  { value: 'b', title: 'Garaż — sama instalacja', description: '7 pozycji' },
  { value: 'empty', title: 'Puste zlecenie (bez szablonu)' },
];

function Group({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <SelectableCardGroup
      legend="3. Szablon"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      {...(error === undefined ? {} : { error })}
    />
  );
}

describe('SelectableCardGroup (styleguide § 3.22; EVM-022 AC1, AC3)', () => {
  it('EVM-022 AC1 every card is a radio named by its title and description, in a fieldset with a legend', async () => {
    render(<Group />);
    const group = screen.getByRole('group', { name: '3. Szablon' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getByRole('radio', { name: 'Garaż — pełny proces 9 pozycji' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Puste zlecenie (bez szablonu)' })).toBeTruthy();
    expect(await axeViolations(group)).toEqual([]);
  });

  it('EVM-022 AC1 a click anywhere on the card chooses it; the chosen card has the outline of the selected state, not only the background', async () => {
    render(<Group />);
    await userEvent.click(screen.getByText('7 pozycji'));
    const radio = screen.getByRole('radio', { name: 'Garaż — sama instalacja 7 pozycji' });
    expect((radio as HTMLInputElement).checked).toBe(true);
    const card = radio.closest('label');
    expect(card?.className).toContain('border-border-selected');
    expect(card?.className).toContain('border-w-indicator');
    expect(card?.className).toContain('bg-bg-selected');
    expect(screen.getByRole('radio', { name: 'Garaż — pełny proces 9 pozycji' }).closest('label')?.className).toContain(
      'border-border-default',
    );
  });

  it('EVM-022 AC1 the keyboard works like a radio group: arrows move the choice', async () => {
    render(<Group />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /sama instalacja/ }).checked).toBe(true);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Puste zlecenie (bez szablonu)' }).checked).toBe(true);
  });

  it('EVM-022 AC3 the error stands under the group as an alert tied to it, with an icon', async () => {
    render(<Group error="Wybierz szablon albo „Puste zlecenie”." />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Wybierz szablon albo „Puste zlecenie”.');
    expect(alert.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('group', { name: '3. Szablon' }).getAttribute('aria-describedby')).toBe(alert.id);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-022 AC3 the first radio can take the focus from the page (the link of the error summary)', () => {
    const first = createRef<HTMLInputElement>();
    render(<SelectableCardGroup legend="3. Szablon" options={OPTIONS} value="" onChange={vi.fn()} firstRadioRef={first} />);
    first.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /pełny proces/ }));
  });
});

describe('ErrorSummary and FieldError (styleguide § 4.1; EVM-022 AC3)', () => {
  it('EVM-022 AC3 the summary lists links to the fields, takes the focus and hands the chosen field to the page', async () => {
    const onSelect = vi.fn();
    const summaryRef = createRef<HTMLDivElement>();
    render(
      <ErrorSummary
        title="Popraw zaznaczone pola."
        items={[
          { field: 'customer', message: 'Wybierz klienta.' },
          { field: 'template', message: 'Wybierz szablon albo „Puste zlecenie”.' },
        ]}
        onSelect={onSelect}
        summaryRef={summaryRef}
      />,
    );
    summaryRef.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    await userEvent.click(screen.getByRole('link', { name: 'Wybierz szablon albo „Puste zlecenie”.' }));
    expect(onSelect).toHaveBeenCalledWith('template');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-022 AC3 the field error is an alert with an icon', () => {
    render(<FieldError>Nie znaleziono wybranego klienta. Wybierz innego.</FieldError>);
    expect(screen.getByRole('alert').textContent).toBe('Nie znaleziono wybranego klienta. Wybierz innego.');
  });
});
